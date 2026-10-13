// Chữ trên màn hình do web vẽ (Veo vẽ tiếng Việt có dấu sai). Mỗi cảnh: [{ text, start, end, position }]
// — thời gian tính theo giây trong cảnh (0–8), trước khi cắt đầu/cuối.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, tail } from './proc.js';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'render_text.py');
const FONT_CANDIDATES = [
  process.env.OVERLAY_FONT,
  '/usr/share/fonts/truetype/noto/NotoSans-ExtraBold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].filter(Boolean);

export const POSITIONS = ['top', 'middle', 'bottom'];
export const STYLES = ['brand', 'dark', 'light'];

export function fontPath() {
  const f = FONT_CANDIDATES.find((p) => fs.existsSync(p));
  if (!f) throw new Error('Không tìm thấy font để vẽ chữ (đặt OVERLAY_FONT trong .env)');
  return f;
}

/**
 * Chuyển trường "onScreenText" kiểu cũ thành danh sách có thời gian.
 *   '"23:47 — 37 TIN" (0.5s) → "AI LÀM THAY?" (5s)'  → 2 mục, mốc 0.5s và 5s
 *   '4 TUAN'                                          → 1 mục cả cảnh
 */
export function parseOverlays(text, duration = 8) {
  const s = String(text || '').trim();
  if (!s) return [];
  const items = [];
  const re = /["“]([^"”]+)["”](?:[^"“]*?\((\d+(?:[.,]\d+)?)\s*s\))?/g;
  let m;
  while ((m = re.exec(s))) items.push({ text: m[1].trim(), start: m[2] != null ? Number(m[2].replace(',', '.')) : null });
  if (!items.length) {
    // Bỏ ghi chú đạo diễn trong ngoặc: "(không có chữ)", "COMMENT AI (chữ vàng nảy lên)".
    const plain = s.replace(/\([^)]*\)/g, '').trim();
    if (!plain || /^(none|không|không có chữ|no text)$/i.test(plain) || plain.length > 60) return [];
    return [{ text: plain, start: 0.3, end: Math.max(1, duration - 0.3), position: 'top' }];
  }
  // Thiếu mốc thời gian → chia đều trong cảnh.
  items.forEach((it, k) => { if (it.start == null) it.start = 0.3 + (k * (duration - 0.6)) / items.length; });
  items.sort((a, b) => a.start - b.start);
  return items.map((it, k) => ({
    text: it.text,
    start: Math.max(0, it.start),
    end: Math.min(duration - 0.2, k + 1 < items.length ? items[k + 1].start - 0.1 : duration - 0.2),
    position: 'top',
  })).filter((it) => it.end - it.start >= 0.4);
}

export function sanitize(list, duration = 8) {
  return (Array.isArray(list) ? list : []).map((o) => ({
    text: String(o.text || '').trim().slice(0, 80),
    start: Math.max(0, Math.min(duration, Number(o.start) || 0)),
    end: Math.max(0, Math.min(duration, Number(o.end) || duration)),
    position: POSITIONS.includes(o.position) ? o.position : 'top',
  })).filter((o) => o.text && o.end - o.start >= 0.3).slice(0, 6);
}

/** Vẽ các PNG 1080x1920 trong suốt. items: [{ text, out, position, style }] */
export async function renderPngs(items) {
  if (!items.length) return;
  for (const it of items) fs.mkdirSync(path.dirname(it.out), { recursive: true });
  const res = await run('python3', [SCRIPT], { input: JSON.stringify({ font: fontPath(), items }), timeoutMs: 120000 });
  if (res.code !== 0) throw new Error(`Vẽ chữ lỗi: ${tail(res.stderr, 400)}`);
}
