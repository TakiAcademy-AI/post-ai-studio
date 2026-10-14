// "Chrome Flow" — một Chrome riêng (thư mục dữ liệu riêng + cổng DevTools) để server tự tạo video trên Google Flow,
// làm theo taki-agentic-ai (packages/orchestrator/src/flow-browser.ts). Đăng nhập Google lấy bằng cách CHÉP profile
// Chrome người dùng chọn một lần; Chrome hằng ngày không bị đụng tới. Chrome được mở như Chrome thường (không cờ
// tự động hoá); KHÔNG có mẹo che giấu nào.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { config } from './config.js';

export const CDP_PORT = Number(process.env.FLOW_CDP_PORT || 9334); // 9333 là của taki-agentic-ai
export const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const DIR = () => path.join(config.dataDir, 'flow-chrome');
const SOURCE = () => path.join(DIR(), '.post-ai-source.json');
const CHROME_HOME = path.join(os.homedir(), '.config', 'google-chrome');
const CHROME_BIN = process.env.CHROME_BIN || '/usr/bin/google-chrome';
// Bộ nhớ đệm, extension, phiên tab, lịch sử không cần (và làm chép chậm).
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Extensions', 'Sessions',
  'History', 'History-journal', 'Service Worker', 'optimization_guide_model_store', 'IndexedDB', 'File System']);

export function source() {
  try { return JSON.parse(fs.readFileSync(SOURCE(), 'utf8')); } catch { return null; }
}

/** Các profile Chrome trên máy (tên + email) để chọn profile chép sang. */
export function listProfiles() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(CHROME_HOME, 'Local State'), 'utf8'));
    return Object.entries(st.profile?.info_cache || {}).map(([dir, v]) => ({ dir, name: v.name || dir, email: v.user_name || null }))
      .sort((a, b) => (a.email || '~').localeCompare(b.email || '~'));
  } catch { return []; }
}

export async function isUp() {
  try { return (await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

export async function connect() {
  return chromium.connectOverCDP(CDP_URL, { timeout: 15000 });
}

export async function close() {
  if (!(await isUp())) return;
  const b = await connect().catch(() => null);
  if (b) {
    const s = await b.newBrowserCDPSession().catch(() => null);
    await s?.send('Browser.close').catch(() => {});
    await b.close().catch(() => {});
  }
  for (let i = 0; i < 20 && (await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
}

/** Chép profile đã chọn (cookie = đăng nhập Google) sang thư mục Chrome Flow. */
export async function syncProfile(dir) {
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
  st.profile = { ...st.profile, info_cache: { Default: { ...entry, name: 'Post AI Flow' } }, last_used: 'Default', last_active_profiles: ['Default'] };
  fs.writeFileSync(path.join(DIR(), 'Local State'), JSON.stringify(st));
  const s = { dir, name: prof.name, email: prof.email, syncedAt: new Date().toISOString() };
  fs.writeFileSync(SOURCE(), JSON.stringify(s, null, 2));
  return s;
}

/** Mở Chrome Flow nếu chưa chạy. show=false: cửa sổ đẩy gần hết ra mép phải màn hình (không thu nhỏ — thu nhỏ thì trang ngừng vẽ). */
export async function ensure({ show = false } = {}) {
  if (!(await isUp())) {
    if (!fs.existsSync(path.join(DIR(), 'Default'))) throw new Error('Chưa chuẩn bị Chrome Flow — vào tab Tài khoản → Google Flow → chọn profile và bấm "Chép profile & mở"');
    if (!fs.existsSync(CHROME_BIN)) throw new Error(`Không thấy Google Chrome (${CHROME_BIN})`);
    const p = spawn(CHROME_BIN, [
      `--user-data-dir=${DIR()}`, `--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', '--lang=vi', '--window-size=1440,1000',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      'about:blank',
    ], { detached: true, stdio: 'ignore' });
    p.unref();
    let up = false;
    for (let i = 0; i < 40 && !(up = await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!up) throw new Error('Chrome Flow không khởi động được');
  }
  await setWindow(show ? 'normal' : 'parked').catch(() => {});
}

export async function setWindow(state) {
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

/** Kiểm tra Chrome Flow đã vào được Flow chưa (không phải trang giới thiệu / trang đăng nhập Google). */
export async function checkLogin() {
  await ensure();
  const b = await connect();
  try {
    const page = await b.contexts()[0].newPage();
    await page.goto('https://flow.google.com/?hl=vi', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    const url = page.url();
    const email = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))
      .find((t) => t && t.includes('@'))?.match(/\(([^)]+@[^)]+)\)/)?.[1] || null).catch(() => null);
    await page.close();
    const ok = /flow\.google\.com\/?($|project|\?)/.test(url) && !url.includes('/about');
    return { ok, url, email };
  } finally {
    await b.close().catch(() => {});
  }
}
