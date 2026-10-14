// "Chrome Flow" — Chrome riêng để server tự tạo video trên Google Flow, làm theo taki-agentic-ai
// (packages/orchestrator/src/flow-browser.ts). Phần mở/chép profile dùng chung ở chrome-box.js.
import { makeChrome } from './chrome-box.js';

const box = makeChrome({ label: 'Chrome Flow', dirName: 'flow-chrome', port: Number(process.env.FLOW_CDP_PORT || 9334) }); // 9333 là của taki-agentic-ai
export const { CDP_PORT, source, listProfiles, isUp, connect, close, syncProfile, ensure, setWindow } = box;

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
