// Một "Chrome riêng" do server điều khiển (thư mục dữ liệu riêng + cổng DevTools), đăng nhập bằng cách CHÉP profile
// Chrome người dùng chọn một lần; Chrome hằng ngày không bị đụng tới. Mở như Chrome thường (không cờ tự động hoá),
// KHÔNG có mẹo che giấu nào. Dùng cho Chrome Flow (tạo video) và Chrome Facebook (đăng Reel).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { config } from './config.js';
import { chromeHome, chromeBin } from './platform.js';

const CHROME_HOME = chromeHome(); // Linux ~/.config/google-chrome · macOS ~/Library/Application Support/Google/Chrome · Windows %LOCALAPPDATA%\Google\Chrome\User Data
const CHROME_BIN = chromeBin();
// Bộ nhớ đệm, extension, phiên tab, lịch sử không cần (và làm chép chậm).
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Extensions', 'Sessions',
  'History', 'History-journal', 'Service Worker', 'optimization_guide_model_store', 'IndexedDB', 'File System']);

/** Các profile Chrome trên máy (tên + email) để chọn profile chép sang. */
export function listProfiles() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(CHROME_HOME, 'Local State'), 'utf8'));
    return Object.entries(st.profile?.info_cache || {}).map(([dir, v]) => ({ dir, name: v.name || dir, email: v.user_name || null }))
      .sort((a, b) => (a.email || '~').localeCompare(b.email || '~'));
  } catch { return []; }
}

/** label: tên hiện trong lỗi; dirName: thư mục trong data/; port: cổng DevTools; lang: ngôn ngữ giao diện. */
export function makeChrome({ label, dirName, port, lang = 'vi' }) {
  const CDP_PORT = port;
  const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
  const DIR = () => path.join(config.dataDir, dirName);
  const SOURCE = () => path.join(DIR(), '.post-ai-source.json');

  function source() {
    try { return JSON.parse(fs.readFileSync(SOURCE(), 'utf8')); } catch { return null; }
  }

  async function isUp() {
    try { return (await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
  }

  async function connect() {
    return chromium.connectOverCDP(CDP_URL, { timeout: 15000 });
  }

  async function close() {
    if (!(await isUp())) return;
    const b = await connect().catch(() => null);
    if (b) {
      const s = await b.newBrowserCDPSession().catch(() => null);
      await s?.send('Browser.close').catch(() => {});
      await b.close().catch(() => {});
    }
    for (let i = 0; i < 20 && (await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
  }

  /** Chép profile đã chọn (cookie = các phiên đăng nhập) sang thư mục riêng của Chrome này. */
  async function syncProfile(dir) {
    const prof = listProfiles().find((p) => p.dir === dir);
    if (!prof) throw new Error('Không thấy profile Chrome này');
    await close();
    fs.rmSync(DIR(), { recursive: true, force: true });
    fs.mkdirSync(DIR(), { recursive: true });
    const src = path.join(CHROME_HOME, dir);
    fs.cpSync(src, path.join(DIR(), 'Default'), {
      recursive: true,
      filter: (p) => p === src || !SKIP.has(p.slice(src.length + 1).split(path.sep)[0]),
    });
    const st = JSON.parse(fs.readFileSync(path.join(CHROME_HOME, 'Local State'), 'utf8'));
    const entry = st.profile?.info_cache?.[dir] || {};
    st.profile = { ...st.profile, info_cache: { Default: { ...entry, name: `Post AI — ${label}` } }, last_used: 'Default', last_active_profiles: ['Default'] };
    fs.writeFileSync(path.join(DIR(), 'Local State'), JSON.stringify(st));
    const s = { dir, name: prof.name, email: prof.email, syncedAt: new Date().toISOString() };
    fs.writeFileSync(SOURCE(), JSON.stringify(s, null, 2));
    return s;
  }

  /** Mở Chrome Flow nếu chưa chạy. show=false: cửa sổ đẩy gần hết ra mép phải màn hình (không thu nhỏ — thu nhỏ thì trang ngừng vẽ). */
  async function ensure({ show = false } = {}) {
    if (!(await isUp())) {
      if (!fs.existsSync(path.join(DIR(), 'Default'))) throw new Error(`Chưa chuẩn bị ${label} — vào tab Tài khoản → ${label} → chọn profile và bấm "Chép profile & mở"`);
      if (!fs.existsSync(CHROME_BIN)) throw new Error(`Không thấy Google Chrome (${CHROME_BIN}) — cài Chrome hoặc đặt CHROME_BIN trong .env`);
      const p = spawn(CHROME_BIN, [
        `--user-data-dir=${DIR()}`, `--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=127.0.0.1',
        '--no-first-run', '--no-default-browser-check', `--lang=${lang}`, '--window-size=1440,1000',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
        'about:blank',
      ], { detached: true, stdio: 'ignore' });
      p.unref();
      let up = false;
      for (let i = 0; i < 40 && !(up = await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
      if (!up) throw new Error(`${label} không khởi động được`);
    }
    await setWindow(show ? 'normal' : 'parked').catch(() => {});
  }

  async function setWindow(state) {
    const b = await connect();
    try {
      const ctx = b.contexts()[0];
      const page = ctx.pages()[0] || (await ctx.newPage());
      const s = await ctx.newCDPSession(page);
      const { windowId } = await s.send('Browser.getWindowForTarget');
      await s.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      const scr = await page.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight, l: screen.availLeft || 0, t: screen.availTop || 0 }));
      const bounds = state === 'parked'
        ? { left: scr.l + scr.w - 24, top: scr.t, width: 1440, height: Math.max(800, scr.h) }
        : { left: scr.l + 40, top: scr.t + 20, width: Math.min(1440, scr.w - 80), height: Math.max(700, scr.h - 40) };
      await s.send('Browser.setWindowBounds', { windowId, bounds });
      if (state === 'normal') await page.bringToFront();
    } finally {
      await b.close().catch(() => {});
    }
  }

  return { CDP_PORT, CDP_URL, source, listProfiles, isUp, connect, close, syncProfile, ensure, setWindow };
}
