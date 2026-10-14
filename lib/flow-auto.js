// Tự động hoàn toàn trên Google Flow qua "Chrome Flow" (Playwright/CDP), làm theo taki-agentic-ai:
// điền cảnh (dùng lại đúng code điền của extension) → bấm tạo → chờ video / bắt lỗi Flow → tải 720p → gắn vào cảnh.
// Không có mẹo che giấu tự động hoá. Mỗi lúc chỉ chạy 1 video (hàng đợi chung ở jobs.js).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import * as FC from './flow-chrome.js';

export const FLOW_MODELS = ['Veo 3.1 - Fast', 'Veo 3.1 - Lite', 'Veo 3.1 - Quality', 'Omni 1.1 Flash'];

// Code chạy trong trang Flow: shim chọn file (main-world.js) + các bước điền của extension (content.js, phần trước bảng
// điều khiển) + vài hàm theo dõi ô video. Đọc lại từ file mỗi lần để luôn khớp bản extension mới nhất.
export function injectedSource() {
  const dir = path.join(config.root, 'extension');
  const mainWorld = fs.readFileSync(path.join(dir, 'main-world.js'), 'utf8');
  const content = fs.readFileSync(path.join(dir, 'content.js'), 'utf8');
  const core = content.slice(0, content.indexOf('// ---------- bảng điều khiển ----------'));
  if (!core.includes('async function fill(')) throw new Error('Không đọc được phần điền trong extension/content.js');
  return `window.__postai = window.__postai || (() => {
${mainWorld}
${core}
function status(t) { (window.__postaiLog = window.__postaiLog || []).push(String(t)); }
const THUMB = 'img[alt="Hình thu nhỏ của video đã tạo"]';
// Ô video = tổ tiên cao nhất chỉ chứa ĐÚNG MỘT ảnh thu nhỏ, đã xong khi có nút ⋮.
function videoTiles() {
  return [...document.querySelectorAll(THUMB)].map((img) => {
    let t = img;
    while (t.parentElement && t.parentElement.querySelectorAll(THUMB).length === 1) t = t.parentElement;
    const menu = t.querySelector('button[aria-label="Tuỳ chọn khác"]');
    return menu ? { root: t, menu, src: img.getAttribute('src') } : null;
  }).filter(Boolean);
}
function failTexts() {
  return [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent.trim() === 'Không thành công' && visible(e))
    .map((n) => { let b = n; for (let k = 0; k < 4 && b.parentElement && b.innerText.length < 40; k++) b = b.parentElement;
      return b.innerText.replace(/\\s+/g, ' ').replace(/Theo dõi trạng thái.*$/i, '').trim().slice(0, 220); });
}
async function downloadBySrc(src) {
  const tile = videoTiles().find((t) => t.src === src);
  if (!tile) throw new Error('Không thấy ô video vừa tạo');
  press(tile.menu);
  const dl = await waitFor(() => byText('[role="menuitem"]', 'Tải xuống'), 'mục "Tải xuống"', 5000);
  for (const n of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) dl.dispatchEvent(new MouseEvent(n, { bubbles: true }));
  press(dl);
  const q = await waitFor(() => byText('[role="menuitem"]', '720p'), 'mục "720p"', 5000);
  press(q);
}
return { fill, videoTiles: () => videoTiles().map((t) => t.src), failTexts, downloadBySrc, composerChips: () => composerChips().length };
})(); true;`;
}

// Code điền dò theo nhãn tiếng Việt của Flow; tài khoản Google để tiếng Anh thì Flow hiện tiếng Anh → luôn ép hl=vi.
const vi = (url) => { const u = new URL(url); u.searchParams.set('hl', 'vi'); return u.toString(); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureInjected(page) {
  const has = await page.evaluate(() => Boolean(window.__postai)).catch(() => false);
  if (!has) await page.evaluate(injectedSource());
}

/** Mở (hoặc tạo) dự án Flow riêng cho video này, trả về tab đang ở dự án. */
export async function openProject(browser, job, log) {
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => job.flowProject && p.url().startsWith(job.flowProject));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(vi(job.flowProject || 'https://flow.google.com/'), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
  }
  const url = page.url();
  if (url.includes('/about') || url.includes('accounts.google')) {
    throw new Error('Chrome Flow chưa đăng nhập Flow — tab Tài khoản → Google Flow → "Hiện cửa sổ" rồi đăng nhập');
  }
  if (await page.evaluate(() => document.documentElement.lang).catch(() => '') !== 'vi') {
    await page.goto(vi(url), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
  }
  if (!url.includes('/project/')) {
    log('Tạo dự án Flow mới cho video này…');
    await page.getByRole('button', { name: /Dự án mới|New project/ }).first().click({ timeout: 20000 });
    await page.waitForURL(/\/project\//, { timeout: 30000 });
    await page.waitForTimeout(3000);
    job.flowProject = page.url().split('?')[0];
  }
  await ensureInjected(page);
  return page;
}

/**
 * Tạo 1 cảnh. pending: { mode, prompt, voice, images:[{b64,mime,name}] }. Trả về đường dẫn file mp4 tải về.
 * onTimeoutRetry: số lần tự thử lại khi Flow báo "hết thời gian tạo".
 */
export async function generateScene({ job, pending, model, downloadDir, log, isCancelled, retries = 2 }) {
  await FC.ensure();
  const browser = await FC.connect();
  try {
    const page = await openProject(browser, job, log);
    page.on('framenavigated', () => {}); // giữ tab sống
    for (let attempt = 0; ; attempt++) {
      if (isCancelled()) throw new Error('Đã dừng theo yêu cầu');
      await ensureInjected(page);
      log(`Đang điền (${pending.mode}${pending.voice ? `, giọng ${pending.voice === 'me' ? '@me' : pending.voice}` : ''}, ${model})…`);
      await page.evaluate(async ({ p, m }) => { window.__postaiLog = []; await window.__postai.fill(p, m); }, { p: pending, m: model });
      const before = await page.evaluate(() => ({ tiles: window.__postai.videoTiles(), fails: window.__postai.failTexts().length }));

      // Bấm tạo bằng cú bấm của Playwright (như taki-agentic-ai).
      await page.locator('button[aria-label="Bắt đầu tạo"]').click({ timeout: 15000 });
      log('Đã bấm tạo — chờ Flow render…');

      const t0 = Date.now();
      let result = null;
      while (!result) {
        if (isCancelled()) throw new Error('Đã dừng theo yêu cầu (video đang tạo trên Flow vẫn tốn credit)');
        if (Date.now() - t0 > 20 * 60 * 1000) throw new Error('Quá 20 phút Flow chưa tạo xong');
        await sleep(4000);
        await ensureInjected(page);
        result = await page.evaluate(({ beforeTiles, beforeFails }) => {
          const fails = window.__postai.failTexts();
          if (fails.length > beforeFails) return { fail: fails[0] };
          const fresh = window.__postai.videoTiles().slice(0, 4).find((s) => s && !beforeTiles.includes(s));
          return fresh ? { src: fresh } : null;
        }, { beforeTiles: before.tiles, beforeFails: before.fails });
      }

      if (result.fail) {
        const timeout = /hết thời gian|thử lại|timed out|try again/i.test(result.fail);
        if (timeout && attempt < retries) { log(`Flow báo: ${result.fail} → tự thử lại (${attempt + 1}/${retries})`); continue; }
        throw new Error(`Flow tạo thất bại: ${result.fail}`);
      }

      log(`Video xong sau ${Math.round((Date.now() - t0) / 1000)}s — đang tải 720p…`);
      await page.waitForTimeout(1500);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 180000 }),
        page.evaluate((src) => window.__postai.downloadBySrc(src), result.src),
      ]);
      await fsp.mkdir(downloadDir, { recursive: true });
      const file = path.join(downloadDir, `flow-${Date.now()}.mp4`);
      await download.saveAs(file);
      return file;
    }
  } finally {
    await browser.close().catch(() => {}); // chỉ ngắt kết nối, Chrome Flow vẫn chạy
  }
}

/** Đọc ảnh tham chiếu của cảnh thành base64 cho phần điền. */
export async function loadImages(images, jobDirPath) {
  const out = [];
  for (const im of images) {
    const buf = await fsp.readFile(path.join(jobDirPath, im.file));
    out.push({ b64: buf.toString('base64'), mime: 'image/jpeg', name: im.name });
  }
  return out;
}
