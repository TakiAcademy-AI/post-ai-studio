// Thu số liệu Reel từ bảng "Bài viết đã đăng" của Meta Business Suite trong Chrome Facebook (không cần Graph API).
// Mỗi hàng: caption, ngày đăng, người tiếp cận, lượt xem, người xem, theo dõi, tương tác, thích, bình luận, chia sẻ, lưu,
// click liên kết, tổng thời gian xem (ms), thời gian xem trung bình, lượt xem ≥3 giây. Lưu ở data/insights.json theo Page.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as FB from './fb-chrome.js';

const BS = 'https://business.facebook.com/latest';
const file = () => path.join(config.dataDir, 'insights.json');
export function readInsights() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return { pages: {} }; } }
function write(d) { fs.writeFileSync(file(), JSON.stringify(d, null, 2)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tên cột (tiếng Việt / tiếng Anh) → khoá.
const COLS = [
  [/^(Số người tiếp cận|Reach)/i, 'reach'], [/^(Lượt xem trong tối thiểu 3 giây|3-second)/i, 'views3s'], [/^(Lượt xem|Views)/i, 'views'],
  [/^(Người xem|Viewers)/i, 'viewers'], [/^(Lượt theo dõi|Follows)/i, 'follows'], [/^(Lượt tương tác|Engagement)/i, 'engagements'],
  [/^(Lượt thích|Reactions)/i, 'reactions'], [/^(Bình luận|Comments)/i, 'comments'], [/^(Lượt chia sẻ|Shares)/i, 'shares'],
  [/^(Lượt lưu|Saves)/i, 'saves'], [/^(Lượt click|Link clicks)/i, 'linkClicks'], [/^(Thời gian phát video trung bình|Average)/i, 'avgWatchSec'],
  [/^(Thời gian xem|Watch time)/i, 'watchMs'],
];
const num = (s) => { const t = String(s || '').trim(); if (!t || /^[‑-]+$/.test(t)) return null; const n = Number(t.replace(/[.\s]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const secs = (s) => { const t = String(s || ''); if (/^[‑-]+$/.test(t.trim())) return null; let v = 0; let hit = false;
  for (const [re, k] of [[/(\d+)\s*(giờ|h)/, 3600], [/(\d+)\s*(phút|m)/, 60], [/(\d+)\s*(giây|s)/, 1]]) { const m = t.match(re); if (m) { v += Number(m[1]) * k; hit = true; } }
  return hit ? v : num(t); };
const MONTHS_EN = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
/** "16 Tháng 10 17:33" (giờ VN) → ISO; năm suy ra (không quá hiện tại). */
function parseDate(s) {
  let m = String(s).match(/(\d{1,2})\s*Tháng\s*(\d{1,2})(?:,?\s*(\d{4}))?\s+(\d{1,2}):(\d{2})/i);
  let d, mo, y, h, mi;
  if (m) [, d, mo, y, h, mi] = m;
  else { m = String(s).match(/([A-Z][a-z]{2})\s+(\d{1,2})(?:,?\s*(\d{4}))?\s+(?:at\s+)?(\d{1,2}):(\d{2})/); if (!m) return null; [, mo, d, y, h, mi] = m; mo = MONTHS_EN[mo]; }
  const now = new Date();
  let year = y ? Number(y) : now.getUTCFullYear();
  let t = Date.UTC(year, Number(mo) - 1, Number(d), Number(h) - 7, Number(mi));
  if (!y && t > Date.now() + 86400000) t = Date.UTC(year - 1, Number(mo) - 1, Number(d), Number(h) - 7, Number(mi));
  return new Date(t).toISOString();
}
export const postKey = (title, postedAt) => crypto.createHash('md5').update(`${String(title).replace(/\s+/g, ' ').trim().slice(0, 80)}|${postedAt}`).digest('hex').slice(0, 12);

/** Đọc toàn bộ bảng bài đã đăng (90 ngày) của Page. */
export async function scrapePublished(pageId, { log = () => {}, maxRows = 400 } = {}) {
  await FB.ensure();
  const b = await FB.connect();
  const page = await b.contexts()[0].newPage();
  try {
    await page.setViewportSize({ width: 1700, height: 1000 });
    await page.goto(`${BS}/posts/published_posts?asset_id=${pageId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (/loginpage|login\.php|checkpoint/.test(page.url())) throw new Error('Chrome Facebook chưa đăng nhập Business Suite — tab Tài khoản → Chrome Facebook → Hiện cửa sổ và đăng nhập');
    await page.waitForFunction(() => document.querySelectorAll('[role=row]').length > 1 && document.querySelector('[role=row] [role=columnheader]'), null, { timeout: 60000 });
    await sleep(2500);
    const header = await page.evaluate(() => [...document.querySelector('[role=row]').children].map((c) => c.innerText.replace(/[\s​]+/g, ' ').trim()));
    const keys = header.map((h, i) => (i === 1 ? 'title' : i === 2 ? 'date' : (COLS.find(([re]) => re.test(h)) || [])[1] || null));
    const seen = new Map();
    for (let k = 0, stable = 0; k < 120 && stable < 6 && seen.size < maxRows; k++) {
      const rows = await page.evaluate(() => [...document.querySelectorAll('[role=row]')].slice(1).map((r) => [...r.children].map((c, i) => {
        const t = c.innerText.replace(/[​]/g, '').trim();
        if (i !== 1) return t;
        // Ô tiêu đề gồm nhiều dòng: thời lượng, caption, "Thước phim", tên Page, "Quảng bá", "Mở menu thả xuống" → giữ thời lượng + caption.
        const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
        const dur = /^\d+:\d{2}$/.test(lines[0]) ? lines.shift() : '';
        return `${dur} ${lines[0] || ''}`.trim();
      })));
      const before = seen.size;
      for (const cells of rows) {
        const raw = Object.fromEntries(keys.map((key, i) => [key, cells[i]]).filter(([key]) => key));
        if (!raw.title || !raw.date) continue;
        const dur = raw.title.match(/^(\d+):(\d{2})\s*/);
        let title = raw.title.replace(/^\d+:\d{2}\s*/, '').replace(/\s+/g, ' ').trim();
        if (/^Bài viết này không có văn bản|^This post has no text/i.test(title)) title = '(không có caption)';
        const postedAt = parseDate(raw.date);
        if (!postedAt) continue;
        const m = { reach: num(raw.reach), views: num(raw.views), viewers: num(raw.viewers), follows: num(raw.follows), engagements: num(raw.engagements),
          reactions: num(raw.reactions), comments: num(raw.comments), shares: num(raw.shares), saves: num(raw.saves), linkClicks: num(raw.linkClicks),
          watchMs: num(raw.watchMs), avgWatchSec: secs(raw.avgWatchSec), views3s: num(raw.views3s) };
        seen.set(postKey(title, postedAt), { title, postedAt, durationSec: dur ? Number(dur[1]) * 60 + Number(dur[2]) : null, metrics: m });
      }
      stable = seen.size === before ? stable + 1 : 0;
      // cuộn: khung cuộn chứa bảng (và cả trang) xuống cuối để Business Suite nạp thêm hàng
      await page.evaluate(() => {
        const last = [...document.querySelectorAll('[role=row]')].pop();
        last?.scrollIntoView({ block: 'end' });
        for (let el = last; el; el = el.parentElement) if (el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
      });
      const box = await page.locator('[role=row]').last().boundingBox().catch(() => null);
      if (box) { await page.mouse.move(box.x + 300, Math.max(5, box.y - 10)); await page.mouse.wheel(0, 1200); }
      await sleep(1800);
    }
    log(`Đọc được ${seen.size} bài đã đăng.`);
    return [...seen.values()];
  } finally {
    await page.close().catch(() => {});
    await b.close().catch(() => {});
  }
}

/** Thu số liệu Page, lưu snapshot cho từng bài (mỗi bài tối đa 30 snapshot, cách nhau ≥ 3 giờ). */
export async function collectPage({ pageId, pageName, log = () => {} }) {
  const rows = await scrapePublished(pageId, { log });
  const d = readInsights();
  const pg = d.pages[pageId] ||= { name: pageName, posts: {} };
  pg.name = pageName || pg.name;
  const now = Date.now();
  for (const r of rows) {
    const key = postKey(r.title, r.postedAt);
    const p = pg.posts[key] ||= { title: r.title, postedAt: r.postedAt, durationSec: r.durationSec, snapshots: [] };
    p.durationSec = r.durationSec ?? p.durationSec;
    const last = p.snapshots[p.snapshots.length - 1];
    const snap = { at: new Date(now).toISOString(), ageH: Math.round((now - Date.parse(r.postedAt)) / 36e5), ...r.metrics };
    if (last && now - Date.parse(last.at) < 3 * 36e5) p.snapshots[p.snapshots.length - 1] = snap; else p.snapshots.push(snap);
    if (p.snapshots.length > 30) p.snapshots.splice(1, p.snapshots.length - 30);
  }
  pg.collectedAt = new Date(now).toISOString();
  write(d);
  return { pageId, count: rows.length };
}
