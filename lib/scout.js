// Trinh sát nội dung (tham khảo Scout của taki-agentic-ai), gắn với Tự nuôi kênh.
// Người dùng thêm nguồn quan sát (kênh đối thủ / kênh tham khảo trên TikTok, Facebook, YouTube, Instagram) cho từng kênh tự nuôi →
// Chrome Facebook mở trang CÔNG KHAI (chỉ đọc), lấy ~30 video gần nhất + lượt xem → trung vị kênh, mức gấp trung vị →
// video "bùng nổ" (≥ N× trung vị, mới ≤ D ngày) được decode (hook, khuôn, cấu trúc, vì sao nổ, góc clone riêng) →
// "Clone vào hàng đợi" đưa chủ đề theo khuôn đó lên đầu hàng đợi của kênh. Chỉ dùng số liệu đọc thật từ trang, không đoán số.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import * as FB from './fb-chrome.js';
import * as AP from './autopilot.js';
import { decodeVideo } from './llm.js';

const file = () => path.join(config.dataDir, 'scout.json');
const DAY = 86400 * 1000;
const VN = 7 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const DEFAULTS = { scanTimes: ['06:59'], hotMultiple: 3, boomMultiple: 5, boomDays: 7, autoDecode: true, maxDecodePerScan: 3 };

function read() {
  let d;
  try { d = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { d = {}; }
  return { settings: { ...DEFAULTS, ...(d.settings || {}) }, sources: d.sources || [], videos: d.videos || {}, lastSlot: d.lastSlot || null };
}
function write(d) { fs.writeFileSync(file(), JSON.stringify(d, null, 1)); }
function mutate(fn) { const d = read(); const r = fn(d); write(d); return r; }
const mustSource = (d, id) => { const s = d.sources.find((x) => x.id === id); if (!s) throw new Error('Không thấy nguồn'); return s; };

// ---------- Nguồn ----------
/** Nhận diện nền tảng + handle + trang lưới video + mẫu link video từ link người dùng dán. */
export function parseChannelUrl(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { throw new Error('Link kênh chưa đúng'); }
  const host = u.hostname.replace(/^(www|m|vt|vm|web)\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (host.endsWith('tiktok.com')) {
    const h = seg.find((x) => x.startsWith('@'));
    if (!h) throw new Error('Link TikTok cần có @tên kênh (vd tiktok.com/@abc)');
    return { platform: 'tiktok', url: `https://www.tiktok.com/${h}`, handle: h, grid: `https://www.tiktok.com/${h}`, pattern: `/${esc(h)}/video/\\d+` };
  }
  if (host.endsWith('youtube.com') || host === 'youtu.be') {
    const h = seg.find((x) => x.startsWith('@')) || (seg[0] === 'channel' || seg[0] === 'c' ? `${seg[0]}/${seg[1]}` : seg[0]);
    if (!h) throw new Error('Link YouTube cần là link kênh (vd youtube.com/@abc)');
    const base = `https://www.youtube.com/${h}`;
    return { platform: 'youtube', url: base, handle: h, grid: `${base}/shorts`, pattern: '/shorts/[\\w-]+' };
  }
  if (host.endsWith('facebook.com') || host === 'fb.com') {
    if (seg[0] === 'profile.php' || u.searchParams.get('id')) {
      const id = u.searchParams.get('id');
      if (!id) throw new Error('Link Facebook thiếu id');
      return { platform: 'facebook', url: `https://www.facebook.com/profile.php?id=${id}`, handle: id, grid: `https://www.facebook.com/profile.php?id=${id}&sk=reels_tab`, pattern: '/reel/\\d+' };
    }
    if (!seg[0]) throw new Error('Link Facebook cần là link Page');
    return { platform: 'facebook', url: `https://www.facebook.com/${seg[0]}`, handle: seg[0], grid: `https://www.facebook.com/${seg[0]}/reels/`, pattern: '/reel/\\d+' };
  }
  if (host.endsWith('instagram.com')) {
    if (!seg[0]) throw new Error('Link Instagram cần là link tài khoản');
    return { platform: 'instagram', url: `https://www.instagram.com/${seg[0]}`, handle: seg[0], grid: `https://www.instagram.com/${seg[0]}/reels/`, pattern: '/reel/[\\w-]+' };
  }
  throw new Error('Chỉ hỗ trợ kênh TikTok, Facebook, YouTube, Instagram');
}

export function addSource({ url, cid, owner = 'competitor', name = '', notes = '' } = {}) {
  if (!cid) throw new Error('Chọn kênh tự nuôi mà nguồn này phục vụ');
  AP.readAutopilot(cid);
  const c = parseChannelUrl(String(url || ''));
  return mutate((d) => {
    if (d.sources.some((s) => s.url === c.url && s.cid === cid)) throw new Error('Nguồn này đã có trong danh sách của kênh');
    const s = { id: crypto.randomBytes(4).toString('hex'), ...c, cid, owner: owner === 'mine' ? 'mine' : 'competitor', name: String(name || '').trim().slice(0, 120) || c.handle,
      notes: String(notes || '').slice(0, 500), enabled: true, median: null, followers: null, lastScanAt: null, lastError: null, createdAt: new Date().toISOString() };
    d.sources.push(s);
    return s;
  });
}
export function updateSource(id, patch = {}) {
  return mutate((d) => {
    const s = mustSource(d, id);
    if ('enabled' in patch) s.enabled = Boolean(patch.enabled);
    if (typeof patch.name === 'string' && patch.name.trim()) s.name = patch.name.trim().slice(0, 120);
    if (patch.owner === 'mine' || patch.owner === 'competitor') s.owner = patch.owner;
    if (patch.cid) { AP.readAutopilot(patch.cid); s.cid = patch.cid; }
    if (typeof patch.notes === 'string') s.notes = patch.notes.slice(0, 500);
    return s;
  });
}
export function removeSource(id) {
  return mutate((d) => { mustSource(d, id); d.sources = d.sources.filter((s) => s.id !== id); delete d.videos[id]; return { ok: true }; });
}
export function saveSettings(patch = {}) {
  return mutate((d) => {
    const s = d.settings;
    if (Array.isArray(patch.scanTimes)) s.scanTimes = patch.scanTimes.map((x) => String(x).trim()).filter((x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)).slice(0, 6).sort();
    const num = (k, lo, hi) => { if (patch[k] != null && Number.isFinite(Number(patch[k]))) s[k] = Math.min(hi, Math.max(lo, Number(patch[k]))); };
    num('hotMultiple', 1.5, 50); num('boomMultiple', 2, 100); num('boomDays', 1, 30); num('maxDecodePerScan', 0, 20);
    if ('autoDecode' in patch) s.autoDecode = Boolean(patch.autoDecode);
    return s;
  });
}

// ---------- Đọc số ----------
/** "3,4 Tr" · "3.4M" · "215,9K" · "26 N" · "12.345" · "1.2B" → số. */
export function parseCount(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text) : null;
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const m = /(\d+(?:[.,]\d+)*)\s*(tỷ|ty|b|tr|triệu|trieu|m|n|nghìn|nghin|ngàn|ngan|k)?(?![\p{L}\d])/u.exec(t);
  if (!m) return null;
  let n = m[1];
  const unit = m[2] || '';
  if (unit) n = n.replace(',', '.');
  else n = n.replace(/[.,](?=\d{3}(?!\d))/g, '').replace(',', '.');
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const mul = /^(tỷ|ty|b)$/.test(unit) ? 1e9 : /^(tr|triệu|trieu|m)$/.test(unit) ? 1e6 : /^(n|nghìn|nghin|ngàn|ngan|k)$/.test(unit) ? 1e3 : 1;
  return Math.round(v * mul);
}
/** Lượt xem trong chữ của ô video: ưu tiên số đứng trước "lượt xem / views", không thì số đầu tiên. */
function viewsOf(text) {
  const t = String(text || '');
  const m = /(\d+(?:[.,]\d+)*\s*(?:tỷ|tr|triệu|n|nghìn|ngàn|k|m|b)?)\s*(?:lượt xem|views?)/i.exec(t);
  return parseCount(m ? m[1] : t);
}
const tiktokDate = (url) => { const id = /\/video\/(\d{15,22})/.exec(url)?.[1]; if (!id) return null; try { return new Date(Number(BigInt(id) >> 32n) * 1000).toISOString(); } catch { return null; } };
const extId = (url) => /\/(?:video|reel|reels|shorts|p)\/([\w-]+)/.exec(url)?.[1] || url;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return 0; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const GENERIC = /^(Bản xem trước ô thước phim|Reel preview|Thước phim|Reels?)$/i;

// ---------- Quét 1 nguồn (Chrome Facebook, chỉ đọc) ----------
async function readGrid(src) {
  await FB.ensure();
  const b = await FB.connect();
  const page = await b.contexts()[0].newPage();
  try {
    await page.setViewportSize({ width: 1400, height: 1000 });
    try { await page.goto(src.grid, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {
      await page.waitForTimeout(5000); // TikTok / FB thỉnh thoảng trả mã lỗi tạm thời → mở lại 1 lần
      await page.goto(src.grid, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForTimeout(6000);
    await page.keyboard.press('Escape').catch(() => {}); // đóng hộp mời đăng nhập / cookie (không bấm gì khác)
    let items = [];
    for (let k = 0; k < 6; k++) {
      items = await page.evaluate((pat) => {
        const re = new RegExp(pat);
        const key = (h) => h.split('?')[0].replace(/\/$/, '');
        const out = new Map();
        for (const a of document.querySelectorAll('a[href]')) {
          if (!re.test(a.href)) continue;
          const k2 = key(a.href);
          if (out.has(k2)) continue;
          // ô video = tổ tiên lớn nhất chỉ chứa đúng 1 link video
          let tile = a;
          while (tile.parentElement && new Set([...tile.parentElement.querySelectorAll('a[href]')].filter((x) => re.test(x.href)).map((x) => key(x.href))).size === 1) tile = tile.parentElement;
          out.set(k2, { url: k2, text: tile.innerText.replace(/\s+/g, ' ').trim().slice(0, 300), aria: a.getAttribute('aria-label') || '', alt: (a.querySelector('img')?.alt || tile.querySelector('img')?.alt || '').slice(0, 300) });
        }
        return [...out.values()];
      }, src.pattern);
      if (items.length >= 30) break;
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(1800);
    }
    const head = await page.evaluate(() => ({ title: document.title, url: location.href, body: document.body.innerText.slice(0, 3000) }));
    if (/login|checkpoint|accounts\/login/.test(head.url) && !items.length) throw new Error('Trang bắt đăng nhập — không đọc được');
    if (!items.length && /captcha|verify|xác minh/i.test(head.body)) throw new Error('Trang hiện kiểm tra chống bot (captcha) — mở trang bằng tay trong Chrome Facebook rồi quét lại');
    const followers = parseCount((/([\d.,]+\s*(?:tr|triệu|n|nghìn|k|m)?)\s*(?:người theo dõi|followers|người đăng ký|subscribers|Follower)/i.exec(head.body) || [])[1]);
    return { items: items.slice(0, 40), followers };
  } finally {
    await page.close().catch(() => {});
    await b.close().catch(() => {});
  }
}

let busy = null; // nguồn đang quét / video đang decode
const queue = [];
let draining = false;
function enqueue(task) {
  queue.push(task);
  if (draining) return;
  draining = true;
  (async () => {
    while (queue.length) {
      const t = queue.shift();
      busy = t.label;
      try { await t.run(); } catch (e) { console.error('scout:', t.label, e.message); }
      busy = null;
    }
    draining = false;
  })();
}

export async function scanSource(id) {
  const src = mustSource(read(), id);
  mutate((d) => { mustSource(d, id).scanning = new Date().toISOString(); });
  try {
    let got;
    for (let attempt = 1; ; attempt++) {
      try { got = await readGrid(src); break; } catch (e) {
        if (attempt >= 2 || !/ECONN|ERR_|Target|closed|Timeout/i.test(e.message)) throw e;
        await sleep(8000);
      }
    }
    const at = new Date().toISOString();
    return mutate((d) => {
      const s = mustSource(d, id);
      const vids = (d.videos[id] ||= {});
      const seen = [];
      for (const it of got.items) {
        const views = viewsOf(it.text);
        if (views == null) continue;
        const ext = extId(it.url);
        const titleRaw = [it.alt, GENERIC.test(it.aria) ? '' : it.aria].find((x) => x && x.trim()) || it.text.replace(/(\d+(?:[.,]\d+)*\s*(?:tỷ|tr|triệu|n|nghìn|ngàn|k|m|b)?)\s*(?:lượt xem|views?)/ig, '').replace(/Đã ghim|Pinned/ig, '').trim();
        const v = vids[ext] || { url: it.url, firstSeenAt: at, history: [] };
        Object.assign(v, { url: it.url, title: titleRaw.slice(0, 300) || v.title || '', views, pinned: /Đã ghim|Pinned/i.test(it.text), lastSeenAt: at,
          postedAt: v.postedAt || (s.platform === 'tiktok' ? tiktokDate(it.url) : null) });
        v.history = [...(v.history || []), { at, views }].slice(-40);
        vids[ext] = v;
        seen.push(v);
      }
      if (!seen.length) throw new Error('Trang kênh không có video nào đọc được lượt xem');
      const base = seen.filter((v) => !v.pinned).map((v) => v.views);
      const med = median(base.length ? base : seen.map((v) => v.views));
      for (const v of Object.values(vids)) v.multiple = med > 0 ? Math.round((v.views / med) * 10) / 10 : null;
      Object.assign(s, { median: med, followers: got.followers ?? s.followers, lastScanAt: at, lastError: null, scanning: null, lastCount: seen.length });
      return { source: s.name, videos: seen.length, median: med };
    });
  } catch (e) {
    mutate((d) => { const s = mustSource(d, id); Object.assign(s, { lastError: e.message.slice(0, 300), lastScanAt: new Date().toISOString(), scanning: null }); });
    throw e;
  }
}

// ---------- Decode ----------
async function readVideoPage(url, shotPath) {
  await FB.ensure();
  const b = await FB.connect();
  const page = await b.contexts()[0].newPage();
  try {
    await page.setViewportSize({ width: 1200, height: 1000 });
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {
      await page.waitForTimeout(5000);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForTimeout(5000);
    await page.keyboard.press('Escape').catch(() => {});
    await page.screenshot({ path: shotPath, timeout: 15000 }).catch(() => {});
    return await page.evaluate(() => {
      const meta = (n) => document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content || '';
      return { title: document.title.slice(0, 300), description: (meta('og:description') || meta('description')).slice(0, 1500), ogTitle: meta('og:title').slice(0, 300), body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 2500) };
    });
  } finally {
    await page.close().catch(() => {});
    await b.close().catch(() => {});
  }
}

export async function decode(sourceId, ext) {
  const d0 = read();
  const src = mustSource(d0, sourceId);
  const v = d0.videos[sourceId]?.[ext];
  if (!v) throw new Error('Không thấy video');
  const ch = AP.readAutopilot(src.cid);
  const shot = path.join(config.dataDir, 'uploads', `scout-${ext.slice(0, 40)}.png`);
  let pageInfo = null;
  try { pageInfo = await readVideoPage(v.url, shot); } catch (e) { pageInfo = { error: e.message.slice(0, 200) }; }
  try {
    const r = await decodeVideo({
      video: {
        platform: src.platform, source: src.name, owner: src.owner === 'mine' ? 'kênh của mình' : 'đối thủ / tham khảo',
        views: v.views, channel_median: src.median, multiple_of_median: v.multiple, posted: v.postedAt || `lần đầu thấy ${v.firstSeenAt.slice(0, 10)}`,
        grid_title: v.title, page: pageInfo,
      },
      target: { name: ch.name, positioning: ch.channel, audience: ch.template.audience, tone: ch.template.tone, avoid: ch.template.avoid },
      image: fs.existsSync(shot) ? shot : null,
      engine: AP.brainOf(ch),
    });
    mutate((d) => { const x = d.videos[sourceId]?.[ext]; if (x) { x.decode = r; x.decodeAt = new Date().toISOString(); x.decodeError = null; } });
    return r;
  } catch (e) {
    mutate((d) => { const x = d.videos[sourceId]?.[ext]; if (x) x.decodeError = e.message.slice(0, 300); });
    throw e;
  } finally {
    fs.rmSync(shot, { force: true });
  }
}

// ---------- Clone vào hàng đợi chủ đề của kênh ----------
export function clone(sourceId, ext, { cid = null } = {}) {
  const d = read();
  const src = mustSource(d, sourceId);
  const v = d.videos[sourceId]?.[ext];
  if (!v) throw new Error('Không thấy video');
  const target = cid || src.cid;
  const ch = AP.readAutopilot(target);
  const x = v.decode;
  if (!x) throw new Error('Decode video trước rồi mới clone');
  const topic = `${x.cloneTitle} — ${x.cloneIdea} (CLONE KHUÔN, KHÔNG CHÉP: khuôn "${x.format}", hook kiểu "${x.hookType}", nhịp: ${x.structure.join(' → ')}; không dùng lại lời, tên, hình ảnh của kênh khác)`.slice(0, 900);
  AP.saveSettings(target, { topics: [topic, ...ch.topics] });
  mutate((dd) => { const y = dd.videos[sourceId]?.[ext]; if (y) { y.clonedTo = [...new Set([...(y.clonedTo || []), target])]; y.clonedAt = { ...(y.clonedAt || {}), [target]: new Date().toISOString() }; } });
  return { ok: true, topic, cid: target };
}

/** Tự nuôi kênh: tự clone video bùng nổ (đã decode, chưa clone) của nguồn kênh này, tối đa N chủ đề / 24 giờ. */
export function autoClone(cid) {
  const ch = AP.readAutopilot(cid);
  if (!ch.scoutAutoClone || !ch.scoutClonePerDay) return [];
  const d = read();
  const st = d.settings;
  const mine = d.sources.filter((s) => s.cid === cid && s.owner === 'competitor');
  let used = 0;
  const cands = [];
  for (const s of mine) for (const [ext, v] of Object.entries(d.videos[s.id] || {})) {
    if (v.clonedAt?.[cid] && Date.now() - Date.parse(v.clonedAt[cid]) < DAY) used++;
    if (v.decode && !v.pinned && !(v.clonedTo || []).includes(cid) && (v.multiple || 0) >= st.boomMultiple
      && Date.now() - Date.parse(v.postedAt || v.firstSeenAt) <= st.boomDays * DAY) cands.push([s.id, ext, v.multiple]);
  }
  const out = [];
  for (const [sid, ext] of cands.sort((a, b) => b[2] - a[2]).slice(0, Math.max(0, ch.scoutClonePerDay - used))) {
    try { out.push(clone(sid, ext, { cid }).topic); } catch (e) { console.error('scout autoClone:', e.message); }
  }
  if (out.length) AP.note(cid, `Trinh sát: thêm ${out.length} chủ đề clone khuôn từ video đối thủ đang bùng nổ lên đầu hàng đợi.`);
  return out;
}

// ---------- Tổng quan ----------
export function overview({ cid = null, days = 30 } = {}) {
  const d = read();
  const s = d.settings;
  const from = Date.now() - days * DAY;
  const chans = AP.view().channels;
  const sources = d.sources.filter((x) => !cid || x.cid === cid);
  const list = [];
  for (const src of sources) {
    for (const [ext, v] of Object.entries(d.videos[src.id] || {})) {
      const t = Date.parse(v.postedAt || v.firstSeenAt);
      if (t < from) continue;
      list.push({ key: ext, sourceId: src.id, ...v, ageDays: v.postedAt ? (Date.now() - Date.parse(v.postedAt)) / DAY : null,
        isNew: Date.now() - Date.parse(v.firstSeenAt) < DAY,
        source: { id: src.id, name: src.name, platform: src.platform, owner: src.owner, cid: src.cid, median: src.median } });
    }
  }
  list.sort((a, b) => (b.multiple || 0) - (a.multiple || 0));
  const comp = list.filter((v) => v.source.owner === 'competitor' && !v.pinned);
  const recent = (v) => Date.now() - Date.parse(v.postedAt || v.firstSeenAt) <= s.boomDays * DAY;
  const boom = comp.filter((v) => (v.multiple || 0) >= s.boomMultiple && recent(v)).slice(0, 30);
  const hot = comp.filter((v) => (v.multiple || 0) >= s.hotMultiple).slice(0, 60);
  const formats = new Map();
  for (const v of hot) if (v.decode?.format) formats.set(v.decode.format, (formats.get(v.decode.format) || 0) + 1);
  return {
    settings: s, days, busy, queued: queue.length,
    channels: chans.map((c) => ({ id: c.id, name: c.name })),
    sources: sources.map((x) => ({ ...x, channelName: chans.find((c) => c.id === x.cid)?.name || '?', videoCount: Object.keys(d.videos[x.id] || {}).length })),
    boom, hot, topFormats: [...formats].sort((a, b) => b[1] - a[1]).slice(0, 5),
    lastScan: d.sources.map((x) => x.lastScanAt).filter(Boolean).sort().pop() || null,
  };
}

/** Tóm tắt cho Boss: video bùng nổ đã decode của từng kênh. */
export function bossDigest() {
  const o = overview({ days: 14 });
  return o.boom.slice(0, 12).map((v) => ({ signal: `${v.sourceId}:${v.key}`, for_channel: v.source.cid, source: v.source.name, platform: v.source.platform, views: v.views, multiple: v.multiple,
    title: (v.title || '').slice(0, 120), decoded: v.decode ? { hook: v.decode.hookText, format: v.decode.format, why: v.decode.whyItWorks.slice(0, 200), clone: v.decode.cloneTitle } : null, cloned: v.clonedTo || [] }));
}

// ---------- Lịch quét ----------
export function queueScan(ids = null, reason = 'manual') {
  const d = read();
  const list = ids?.length ? ids.map((id) => mustSource(d, id)) : d.sources.filter((x) => x.enabled);
  for (const src of list) {
    enqueue({
      label: `quét ${src.name}`,
      run: async () => {
        await scanSource(src.id);
        const st = read().settings;
        if (!st.autoDecode || !st.maxDecodePerScan) return;
        const vids = read().videos[src.id] || {};
        const boom = Object.entries(vids).filter(([, v]) => !v.decode && !v.pinned && (v.multiple || 0) >= st.boomMultiple
          && Date.now() - Date.parse(v.postedAt || v.firstSeenAt) <= st.boomDays * DAY && src.owner === 'competitor')
          .sort((a, b) => b[1].multiple - a[1].multiple).slice(0, st.maxDecodePerScan);
        for (const [ext] of boom) enqueue({ label: `decode ${src.name}`, run: () => decode(src.id, ext) });
        enqueue({ label: `clone cho kênh`, run: async () => autoClone(src.cid) }); // sau khi decode xong
      },
    });
  }
  return { queued: list.length, reason };
}
export function queueDecode(sourceId, ext) {
  mustSource(read(), sourceId);
  enqueue({ label: 'decode', run: () => decode(sourceId, ext) });
  return { queued: 1 };
}
export function startLoop() {
  setInterval(() => {
    const d = read();
    if (!d.settings.scanTimes.length || !d.sources.some((x) => x.enabled)) return;
    const now = new Date(Date.now() + VN).toISOString();
    const today = now.slice(0, 10); const hhmm = now.slice(11, 16);
    const due = d.settings.scanTimes.filter((t) => t <= hhmm).sort().pop();
    if (!due) return;
    const key = `${today} ${due}`;
    if (d.lastSlot === key) return;
    mutate((x) => { x.lastSlot = key; });
    queueScan(null, `lịch ${key}`);
  }, 10 * 60 * 1000);
}
