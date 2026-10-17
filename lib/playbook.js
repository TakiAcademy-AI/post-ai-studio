// Sổ tay tối ưu: Claude rút quy luật từ "công thức" + số liệu các video đã đăng. Bản phân tích mới là NHÁP —
// chỉ áp dụng khi người dùng duyệt; khi bật, sổ tay được đưa vào brief lúc viết kịch bản video mới.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { analyzePerformance } from './llm.js';
import { listPosts } from './posts.js';
import { readInsights } from './fb-insights.js';

const file = () => path.join(config.dataDir, 'playbook.json');
export function readPlaybook() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return { text: '', enabled: false, draft: null, history: [] }; }
}
function write(p) { fs.writeFileSync(file(), JSON.stringify(p, null, 2)); }

/** Đoạn sổ tay đưa vào brief (rỗng nếu chưa duyệt / đang tắt). */
export function activePlaybook() {
  const p = readPlaybook();
  return p.enabled && p.text ? p.text : '';
}

const norm = (t) => String(t || '').replace(/\s+/g, ' ').replace(/[…]+$/, '').trim().toLowerCase();

/** Mọi Reel đã đăng của các Page có số liệu (từ Business Suite), ghép "công thức" nếu bài do Post AI đăng. */
export function performanceRows() {
  const ins = readInsights();
  const posts = listPosts();
  const rows = [];
  for (const [pageId, pg] of Object.entries(ins.pages || {})) {
    for (const [key, p] of Object.entries(pg.posts || {})) {
      const m = p.snapshots?.[p.snapshots.length - 1];
      if (!m) continue;
      const head = norm(p.title).slice(0, 45);
      const mine = posts.find((x) => x.pageId === pageId && head && norm(x.captionFull || x.caption).startsWith(head));
      const vn = new Date(Date.parse(p.postedAt) + 7 * 36e5);
      const dur = p.durationSec || mine?.recipe?.durationSec || null;
      rows.push({
        key, pageId, page: pg.name, postedAt: p.postedAt, ageH: m.ageH, title: p.title, durationSec: dur,
        source: mine ? 'Post AI' : 'khác', jobId: mine?.jobId || null,
        recipe: mine?.recipe || { caption: p.title, durationSec: dur, postHourVN: vn.getUTCHours(), postWeekdayVN: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][vn.getUTCDay()] },
        metrics: m,
        derived: {
          watchPct: dur && m.avgWatchSec != null ? Math.round((m.avgWatchSec / dur) * 100) : null,
          hold3sPct: m.views ? Math.round(((m.views3s || 0) / m.views) * 100) : null,
          engRatePct: m.reach ? Math.round(((m.engagements || 0) / m.reach) * 1000) / 10 : null,
          sharesPer1k: m.reach ? Math.round(((m.shares || 0) / m.reach) * 10000) / 10 : null,
        },
      });
    }
  }
  return rows.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

let running = null;
export async function analyze() {
  if (running) throw new Error('Đang phân tích, chờ chút');
  // Bài dưới 24 giờ chưa ổn định số liệu → không đưa vào phân tích.
  const rows = performanceRows().filter((r) => r.ageH >= 24 && r.durationSec).map(({ key, pageId, jobId, ...r }) => r);
  if (!rows.length) throw new Error('Chưa có Reel nào đủ 24 giờ có số liệu — bấm "Cập nhật số liệu" hoặc chờ thêm');
  running = (async () => {
    const p = readPlaybook();
    const r = await analyzePerformance({ rows, currentPlaybook: p.text });
    p.draft = { text: r.playbook, evidence: r.evidence, confidence: r.confidence, topics: r.topics, basedOn: rows.length, at: new Date().toISOString(), costUsd: r.costUsd };
    write(p);
    return p;
  })();
  try { return await running; } finally { running = null; }
}

export function approve(text) {
  const p = readPlaybook();
  const t = String(text ?? p.draft?.text ?? '').trim();
  if (!t) throw new Error('Sổ tay trống');
  if (p.text) p.history = [{ text: p.text, at: p.updatedAt }, ...(p.history || [])].slice(0, 10);
  Object.assign(p, { text: t.slice(0, 3000), enabled: true, updatedAt: new Date().toISOString(), basedOn: p.draft?.basedOn ?? p.basedOn, topics: p.draft?.topics ?? p.topics, draft: null });
  write(p);
  return p;
}

export function setEnabled(on) { const p = readPlaybook(); p.enabled = Boolean(on) && Boolean(p.text); write(p); return p; }
export function discardDraft() { const p = readPlaybook(); p.draft = null; write(p); return p; }
