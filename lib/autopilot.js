// Tự nuôi kênh: mỗi ngày N khung giờ (mặc định 3). Với khung giờ sắp tới chưa có video, web tự làm trọn dây chuyền:
// chủ đề (hàng đợi, hết thì Claude nghĩ) → kịch bản → Chrome Flow tạo cảnh (kiểm tra áo) → ghép → Chrome Facebook HẸN GIỜ đăng
// đúng khung giờ (còn thời gian xem / huỷ). Tuỳ chọn "cần duyệt": làm xong video thì chờ người bấm duyệt mới hẹn đăng.
// Mỗi lúc chỉ làm 1 video; lỗi thì ghi lại, sang khung giờ kế tiếp.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as J from './jobs.js';
import { ideateTopics, reviewVideo, profileChannel, varyLook } from './llm.js';
import { frameAt } from './media.js';
import { activePlaybook } from './playbook.js';
import { browserPage } from './fb-browser.js';
import * as FC from './flow-chrome.js';
import * as FBC from './fb-chrome.js';
import { readInsights, collectPage } from './fb-insights.js';
import * as BM from './benchmark.js';
import { defaultBrain } from './grok.js';
/** Bộ não thực dùng của kênh: chọn riêng, hoặc theo tab Tài khoản. */
export const brainOf = (ch) => (ch?.brain === 'claude' || ch?.brain === 'grok' ? ch.brain : defaultBrain());

const file = () => path.join(config.dataDir, 'autopilot.json');
// Mỗi kênh = 1 Page với cài đặt riêng (khung giờ, định vị, khuôn video, chủ đề, lịch, nhật ký). Dây chuyền dùng chung: mỗi lúc 1 video.
const DEFAULTS = {
  enabled: false,
  name: 'Kênh',
  page: null,                          // { id, name } — Page để đăng (asset_id của Business Suite)
  requireApproval: false,
  postMode: 'schedule',  // 'schedule' = hẹn giờ đăng trực tiếp · 'draft' = lưu nháp lên Business Suite để người dùng duyệt
  autoReview: false,     // Claude tự chấm video: đạt ngưỡng thì tự đăng, chưa đạt thì làm lại
  minScore: 70,
  fallbackScore: 55,     // hết lượt làm lại: bản tốt nhất ≥ mức này thì vẫn đăng
  maxRedo: 2,
  slots: ['11:30', '14:30', '20:30'], // giờ Việt Nam
  horizonHours: 20,                    // làm trước cho các khung giờ trong vòng N giờ tới
  channel: '',                         // định vị kênh: chủ đề, đối tượng, giọng điệu
  brain: 'auto', // bộ não viết chủ đề + kịch bản + chọn trang phục: 'auto' (theo tab Tài khoản) | 'claude' | 'grok'
  bossReview: false, // agent boss (Grok) xem video trước khi đăng → đề xuất đăng / nháp / làm lại, người dùng bấm duyệt
  scoutAutoClone: true, // Trinh sát: video bùng nổ đã decode của nguồn kênh này → tự đưa chủ đề clone khuôn lên đầu hàng đợi
  scoutClonePerDay: 2,
  benchmarkId: null, // Video chuẩn (lib/benchmark.js) mà kênh bám theo hình thức
  subtitles: true, // Việt sub karaoke theo video chuẩn
  walkRatio: 40, // % video quay kiểu vừa đi vừa nói (selfie cầm tay ngoài trời, như video chuẩn); còn lại ngồi nói
  varyLook: true, // mỗi video đổi trang phục + bối cảnh (Claude chọn, khác video gần đây); góc quay giữ nguyên
  looks: [], // các bộ trang phục / bối cảnh đã dùng gần đây
  template: { sceneCount: 3, voice: 'me', character: 'Áo polo đen trơn, cổ bẻ, hàng cúc ngắn, tay ngắn, không in hình, không logo', setting: '', camera: 'Nhân vật ngồi đối diện camera chuẩn bị chia sẻ, chiếm 80% khung hình, ánh sáng chiếu đều mặt. Các phân cảnh đều chung 1 góc quay.', walkCamera: 'Quay selfie cầm tay khung dọc 9:16 như tự quay bằng điện thoại: nhân vật vừa đi chậm vừa nói thẳng vào camera, camera ngang tầm mắt cách mặt khoảng một cánh tay, mặt và vai chiếm khoảng nửa trên khung hình, khung hơi rung nhẹ tự nhiên theo bước chân, nền phía sau trôi chậm và hơi xoá phông, ánh sáng tự nhiên ban ngày. Mọi cảnh cùng một con đường, cùng hướng đi, cùng ánh sáng — cảnh sau đi tiếp đoạn đường của cảnh trước.', audience: '', tone: '', avoid: '', cta: '', mustSay: '', flowModel: 'Veo 3.1 - Fast' },
  topics: [],
  plan: [],                            // [{ slot, topic, jobId, status, error, at }]
  log: [],
};
const norm = (c) => ({ ...DEFAULTS, ...c, template: { ...DEFAULTS.template, ...(c.template || {}) } });
const newId = () => Math.random().toString(36).slice(2, 8);
function readAll() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* chưa có */ }
  if (!Array.isArray(d.channels)) { // dữ liệu cũ (1 kênh) → kênh thứ nhất
    const bp = browserPage();
    d = { channels: [{ ...d, id: newId(), name: d.name || bp?.name || 'Kênh 1', page: d.page || bp || null }] };
    if (Object.keys(d.channels[0]).length > 3) fs.writeFileSync(file(), JSON.stringify(d, null, 2));
  }
  d.channels = d.channels.map(norm);
  return d;
}
function writeAll(d) { fs.writeFileSync(file(), JSON.stringify(d, null, 2)); }
export function readAutopilot(cid) {
  const d = readAll();
  const ch = d.channels.find((c) => c.id === cid);
  if (!ch) throw new Error('Không có kênh này');
  return ch;
}
// Dây chuyền chạy lâu: mọi cập nhật đọc lại file mới nhất rồi chỉ sửa phần của mình (không ghi đè cài đặt người dùng vừa đổi).
function mutate(cid, fn) { const d = readAll(); const ch = d.channels.find((c) => c.id === cid); if (!ch) throw new Error('Không có kênh này'); const r = fn(ch); writeAll(d); return r; }
export function note(cid, msg) { try { mutate(cid, (d) => { d.log = [{ at: new Date().toISOString(), msg }, ...(d.log || [])].slice(0, 200); }); } catch { /* kênh đã xoá */ } }
function upsertPlan(cid, entry) { mutate(cid, (d) => { d.plan = [{ ...entry }, ...d.plan.filter((p) => p.slot !== entry.slot)].slice(0, 120); }); }

export function addChannel({ name } = {}) {
  const d = readAll();
  const base = d.channels[0] ? { template: d.channels[0].template, slots: d.channels[0].slots } : {};
  const ch = norm({ ...base, id: newId(), name: name || `Kênh ${d.channels.length + 1}`, enabled: false, page: null, topics: [], plan: [], log: [] });
  d.channels.push(ch);
  writeAll(d);
  return ch;
}
export function removeChannel(cid) {
  if (current?.cid === cid) throw new Error('Kênh này đang làm video — chờ xong rồi xoá');
  const d = readAll();
  d.channels = d.channels.filter((c) => c.id !== cid);
  writeAll(d);
}

const VN = 7 * 3600 * 1000;
/** Các khung giờ (ISO, UTC) từ bây giờ đến hết N giờ tới. */
function upcomingSlots(d, now = Date.now()) {
  const out = [];
  const vnNow = new Date(now + VN);
  for (let day = 0; day < 3; day++) {
    for (const hm of d.slots) {
      const [h, m] = hm.split(':').map(Number);
      if (!Number.isFinite(h)) continue;
      const t = Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + day, h, m || 0) - VN;
      if (t > now + 20 * 60 * 1000 && t <= now + d.horizonHours * 3600 * 1000) out.push(new Date(t).toISOString());
    }
  }
  return out.sort();
}

export function saveSettings(cid, patch) {
  const all = readAll();
  const d = all.channels.find((c) => c.id === cid);
  if (!d) throw new Error('Không có kênh này');
  if ('enabled' in patch) d.enabled = Boolean(patch.enabled);
  if (typeof patch.name === 'string' && patch.name.trim()) d.name = patch.name.trim().slice(0, 80);
  if (patch.page && patch.page.id) {
    if (d.page?.id !== String(patch.page.id)) d.profile = null; // đổi Page → phải quét lại để định vị kênh
    d.page = { id: String(patch.page.id), name: String(patch.page.name || '') };
  }
  if ('requireApproval' in patch) d.requireApproval = Boolean(patch.requireApproval);
  if (patch.postMode === 'draft' || patch.postMode === 'schedule') d.postMode = patch.postMode;
  if ('autoReview' in patch) d.autoReview = Boolean(patch.autoReview);
  if ('varyLook' in patch) d.varyLook = Boolean(patch.varyLook);
  if (patch.walkRatio != null && Number.isFinite(Number(patch.walkRatio))) d.walkRatio = Math.min(100, Math.max(0, Math.round(Number(patch.walkRatio))));
  if ('subtitles' in patch) d.subtitles = Boolean(patch.subtitles);
  if ('benchmarkId' in patch) d.benchmarkId = patch.benchmarkId ? String(patch.benchmarkId) : null;
  if ('scoutAutoClone' in patch) d.scoutAutoClone = Boolean(patch.scoutAutoClone);
  if (patch.scoutClonePerDay != null) d.scoutClonePerDay = Math.min(6, Math.max(0, Math.round(Number(patch.scoutClonePerDay)) || 0));
  if (['auto', 'claude', 'grok'].includes(patch.brain)) d.brain = patch.brain;
  if ('bossReview' in patch) d.bossReview = Boolean(patch.bossReview);
  if (patch.minScore != null) d.minScore = Math.min(95, Math.max(30, Math.round(Number(patch.minScore)) || 70));
  if (patch.fallbackScore != null) d.fallbackScore = Math.min(d.minScore, Math.max(0, Math.round(Number(patch.fallbackScore)) || 55));
  if (patch.maxRedo != null) d.maxRedo = Math.min(4, Math.max(0, Math.round(Number(patch.maxRedo)) || 0));
  if (Array.isArray(patch.slots)) d.slots = patch.slots.map((x) => String(x).trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).slice(0, 6).sort();
  if (patch.horizonHours) d.horizonHours = Math.min(36, Math.max(4, Number(patch.horizonHours) || 20));
  if (typeof patch.channel === 'string') {
    const next = patch.channel.slice(0, 2000);
    // Đổi định vị → chủ đề trong hàng đợi (nghĩ theo định vị cũ) bỏ hết; server cho Claude nghĩ lại theo định vị mới.
    if (next.trim() !== (d.channel || '').trim() && !Array.isArray(patch.topics)) { d.topics = []; d.retopic = true; }
    d.channel = next;
  }
  if (patch.template && typeof patch.template === 'object') {
    const t = patch.template;
    d.template = { ...d.template, ...Object.fromEntries(['character', 'setting', 'camera', 'walkCamera', 'audience', 'tone', 'avoid', 'cta', 'mustSay', 'voice', 'flowModel'].filter((k) => typeof t[k] === 'string').map((k) => [k, t[k].slice(0, 1500)])) };
    if (t.sceneCount) d.template.sceneCount = Math.min(11, Math.max(2, Math.round(Number(t.sceneCount)) || 3));
  }
  if (Array.isArray(patch.topics)) d.topics = patch.topics.map((x) => String(x).trim()).filter(Boolean).slice(0, 100);
  writeAll(all);
  return d;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Chờ job hết bận (các bước của jobs.js chạy nền). */
async function waitIdle(job, maxMs) {
  const t0 = Date.now();
  await sleep(1500);
  while (job.busy) {
    if (Date.now() - t0 > maxMs) throw new Error(`Quá ${Math.round(maxMs / 60000)} phút: ${job.busy}`);
    await sleep(5000);
  }
}

// Chỉ video của chính kênh này (video kênh khác làm lệch chủ đề khi Claude nghĩ "đừng trùng").
const channelJobTopics = (cid) => J.listJobs().filter((j) => j.input?.channelId === cid).map((j) => j.topic);
const channelBrief = (d) => [d.channel || d.name, d.template.audience && `Khán giả: ${d.template.audience}`, d.template.tone && `Giọng: ${d.template.tone}`, d.template.avoid && `Tránh: ${d.template.avoid}`].filter(Boolean).join('\n');
function recentTitles(ch) {
  const pg = ch.page?.id && readInsights().pages?.[ch.page.id];
  return Object.values(pg?.posts || {}).map((p) => p.title).filter((t) => t && !t.startsWith('('));
}
async function nextTopic(cid) {
  const d = readAutopilot(cid);
  if (!d.topics.length) {
    const mine = channelJobTopics(cid);
    const more = await ideateTopics({ channel: channelBrief(d), playbook: activePlaybook(), recent: [...mine, ...recentTitles(d)], engine: brainOf(d), benchmark: BM.briefFor(d.benchmarkId) });
    if (!more.length) throw new Error('Không có chủ đề');
    mutate(cid, (x) => { x.topics.push(...more); x.retopic = false; });
    note(cid, `Claude nghĩ thêm ${more.length} chủ đề.`);
  }
  return mutate(cid, (x) => x.topics.shift());
}

let running = false;
let current = null; // { cid, slot, jobId, step }
export function status() { return { running, current }; }

/** Làm 1 video hoàn chỉnh (kịch bản → Flow → ghép) cho chủ đề; feedback = nhận xét của lần chấm trước. */
async function makeVideo(cid, slot, topic, feedback, set) {
  const ch = readAutopilot(cid);
  const t = ch.template;
  // Mỗi video 1 bộ trang phục + bối cảnh mới (mọi cảnh trong video vẫn y hệt nhau); góc quay của kênh giữ nguyên.
  let character = t.character;
  let place = t.setting;
  // Kiểu quay của video này: bốc ngẫu nhiên theo tỉ lệ (cả video 1 kiểu, mọi cảnh giống nhau).
  const walk = Math.random() * 100 < (ch.walkRatio ?? 40) && (t.walkCamera || '').trim();
  const camera = walk ? t.walkCamera : t.camera;
  set({ mode: walk ? 'vừa đi vừa nói' : 'ngồi nói' });
  if (walk && !ch.varyLook) place = ''; // bối cảnh cố định của kênh là chỗ ngồi → để Grok/Claude tả đường đi theo góc quay
  if (ch.varyLook) {
    set({ step: 'chọn trang phục & bối cảnh' });
    try {
      const look = await varyLook({ channel: ch.channel || ch.name, topic, outfitHint: t.character, settingHint: walk ? '' : t.setting, camera, walking: Boolean(walk), recent: ch.looks, engine: brainOf(ch) });
      if (look.outfit) character = look.outfit;
      if (look.setting) place = look.setting;
      set({ look: { outfit: character, setting: place, walk: Boolean(walk) } });
      mutate(cid, (d) => { d.looks = [{ outfit: character, setting: place, walk: Boolean(walk), at: new Date().toISOString() }, ...(d.looks || [])].slice(0, 20); });
    } catch (e) { note(cid, `Chọn trang phục / bối cảnh mới lỗi (${e.message.slice(0, 120)}) — dùng trang phục & bối cảnh của kênh.`); }
  }
  const setting = [place, camera].map((x) => (x || '').trim()).filter(Boolean).join('. ');
  set({ step: feedback ? 'viết lại kịch bản theo nhận xét' : 'viết kịch bản' });
  const job = await J.createJob({
    topic, sceneCount: t.sceneCount, audience: t.audience, cta: t.cta, character, setting, mustSay: t.mustSay,
    avoid: t.avoid, tone: t.tone, channelBrief: ch.channel || '', benchmark: BM.briefFor(ch.benchmarkId), engine: brainOf(ch), subs: ch.subtitles !== false, flowModel: t.flowModel, consistency: 'identity', voice: t.voice || null, autopilot: slot, channelId: cid, feedback: feedback || '',
  }, null);
  set({ jobId: job.id });
  await waitIdle(job, 20 * 60 * 1000);
  if (job.stage !== 'script_ready') throw new Error(`Viết kịch bản lỗi: ${job.error || job.stage}`);
  set({ step: 'tạo cảnh trên Flow' });
  J.startAutoFlow(job);
  await waitIdle(job, 120 * 60 * 1000);
  if (!job.scenes.every((s) => s.clip)) throw new Error(`Tạo cảnh chưa xong: ${job.error || 'thiếu clip'}`);
  if (!job.final) { set({ step: 'ghép video' }); J.startStitch(job); await waitIdle(job, 20 * 60 * 1000); }
  if (!job.final) throw new Error(`Ghép lỗi: ${job.error || ''}`);
  return job;
}

/** Tạo lại đúng các cảnh bị lỗi hình (thêm câu sửa lỗi vào prompt), rồi ghép lại. */
async function refixScenes(job, r, set) {
  for (const n of r.badScenes) {
    const i = n - 1;
    const s = job.scenes[i];
    if (!s) continue;
    const fix = r.visualFix && !s.prompt.includes(r.visualFix) && s.prompt.length + r.visualFix.length + 20 < 3950 ? `\n\nVISUAL FIX: ${r.visualFix}` : '';
    if (fix) J.updateScene(job, i, { prompt: s.prompt + fix });
    set({ step: `tạo lại cảnh ${n}` });
    J.startAutoFlow(job, { from: i });
    await waitIdle(job, 60 * 60 * 1000);
    if (!job.scenes[i].clip) throw new Error(`Tạo lại cảnh ${n} lỗi: ${job.error || ''}`);
  }
  if (!job.final) { set({ step: 'ghép lại video' }); J.startStitch(job); await waitIdle(job, 20 * 60 * 1000); }
  if (!job.final) throw new Error(`Ghép lỗi: ${job.error || ''}`);
  return job;
}

/** Claude chấm video đã ghép (khung đầu/giữa/cuối mỗi cảnh + lời thoại + caption + sổ tay). */
async function reviewJob(cid, job) {
  const dir = path.join(config.dataDir, 'jobs', job.id);
  const frames = [];
  try {
    for (const [i, s] of job.scenes.entries()) {
      const d = s.duration || 8;
      for (const [k, at] of [[0, 0.4], [1, d / 2], [2, Math.max(0.5, d - 0.5)]]) {
        const f = path.join(dir, `review-${i + 1}-${k}.jpg`);
        await frameAt(path.join(dir, s.clip), at, f);
        frames.push(f);
      }
    }
    const d = readAutopilot(cid);
    const r = await reviewVideo({
      frames, topic: job.input.topic, dialogues: job.scenes.map((s) => s.dialogue), caption: job.caption, durationSec: Math.round(job.final.duration),
      playbook: activePlaybook(), channel: d.channel, outfit: job.outfit?.text || job.input.character || '',
    });
    job.review = { ...r, at: new Date().toISOString() };
    J.log(job, `Tự chấm: ${r.score}/100 (${r.verdict}). Điểm trừ: ${r.issues}`);
    J.save(job);
    return r;
  } finally {
    for (const f of frames) fs.rmSync(f, { force: true });
  }
}

// Agent boss (lib/boss.js) đăng ký hàm xem video ở đây (tránh import vòng).
let bossReviewer = null;
export function setBossReviewer(fn) { bossReviewer = fn; }
export { reviewFrames };
async function reviewFrames(job, perScene = [0.5]) {
  const dir = path.join(config.dataDir, 'jobs', job.id);
  const frames = [];
  for (const [i, s] of job.scenes.entries()) {
    const d = s.duration || 8;
    for (const [k, r] of perScene.entries()) {
      const f = path.join(dir, `boss-${i + 1}-${k}.jpg`);
      await frameAt(path.join(dir, s.clip), Math.min(d - 0.3, Math.max(0.3, d * r)), f);
      frames.push(f);
    }
  }
  return frames;
}

/** Làm video cho 1 khung giờ; tự chấm → đạt thì tự hẹn đăng, chưa đạt thì làm lại cùng chủ đề theo nhận xét. */
async function produce(cid, slot) {
  const entry = { slot, topic: null, jobId: null, status: 'đang làm', at: new Date().toISOString(), attempts: [] };
  const set = (patch) => { Object.assign(entry, patch); current = { cid, slot, jobId: entry.jobId, step: entry.step }; upsertPlan(cid, entry); };
  const fmtN = (m) => note(cid, m);
  try {
    set({ step: 'chọn chủ đề' });
    set({ topic: await nextTopic(cid) });
    const cfg = readAutopilot(cid);
    const review = cfg.autoReview && !cfg.requireApproval;
    let feedback = '';
    let best = null;
    let fixJob = null; // kịch bản ổn, chỉ vài cảnh lỗi hình → tạo lại đúng các cảnh đó trên cùng video
    for (let attempt = 0; attempt <= (review ? cfg.maxRedo : 0); attempt++) {
      const job = fixJob ? await refixScenes(fixJob.job, fixJob.r, set) : await makeVideo(cid, slot, entry.topic, feedback, set);
      fixJob = null;
      const now = readAutopilot(cid); // đọc lại: người dùng có thể vừa tắt chấm điểm / bật duyệt
      if (now.bossReview && bossReviewer) { // boss Grok xem video → đề xuất; người dùng bấm duyệt
        set({ step: 'boss Grok xem video', jobId: job.id });
        let b = null;
        try { b = await bossReviewer(cid, job); } catch (e) { fmtN(`Boss xem video lỗi: ${e.message.slice(0, 200)}`); }
        set({ status: 'chờ duyệt', step: null, jobId: job.id, boss: b });
        fmtN(`Video cho ${fmt(slot)} xong — boss đề xuất: ${b ? `${b.verdict} (${b.score}/100) — ${b.reason}` : '(không xem được)'}; chờ anh duyệt.`);
        return;
      }
      if (!(now.autoReview && !now.requireApproval)) {
        if (now.requireApproval) { set({ status: 'chờ duyệt', step: null, jobId: job.id }); fmtN(`Video cho ${fmt(slot)} xong, chờ duyệt: ${entry.topic}`); return; }
        return await schedulePost(cid, entry, job);
      }
      set({ step: `tự chấm (lần ${attempt + 1})` });
      const r = await reviewJob(cid, job);
      entry.attempts.push({ jobId: job.id, score: r.score, verdict: r.verdict, issues: r.issues.slice(0, 300) });
      set({ score: r.score });
      if (!best || r.score > best.r.score) best = { job, r };
      if (r.score >= cfg.minScore) break;
      if (attempt < cfg.maxRedo) {
        const bad = r.badScenes.filter((n) => n <= job.scenes.length);
        if (r.scriptOk && bad.length && bad.length < job.scenes.length) {
          fixJob = { job, r: { ...r, badScenes: bad } };
          fmtN(`Khung ${fmt(slot)}: ${r.score}/100 < ${cfg.minScore} → kịch bản ổn, tạo lại cảnh ${bad.join(', ')} (${attempt + 1}/${cfg.maxRedo}).`);
        } else {
          fmtN(`Khung ${fmt(slot)}: ${r.score}/100 < ${cfg.minScore} → viết lại kịch bản cùng chủ đề (${attempt + 1}/${cfg.maxRedo}).`);
          feedback = `${r.issues} — Cách sửa: ${r.fixes}`.slice(0, 900);
        }
      }
    }
    if (!review || !best) return;
    const { job, r } = best;
    if (r.score < cfg.minScore && r.score < cfg.fallbackScore) {
      set({ status: 'không đạt', step: null, jobId: job.id, score: r.score, error: `Điểm cao nhất ${r.score}/100 < ${cfg.fallbackScore}: ${r.issues}`.slice(0, 400) });
      fmtN(`Khung ${fmt(slot)}: không đăng — điểm cao nhất ${r.score}/100.`);
      return;
    }
    if (r.caption && r.caption.trim() && r.caption.trim() !== (job.caption || '').trim()) J.updateJob(job, { caption: r.caption.trim() });
    set({ jobId: job.id, score: r.score });
    await schedulePost(cid, entry, job);
  } catch (e) {
    set({ status: 'lỗi', error: e.message.slice(0, 400), step: null });
    fmtN(`Lỗi khung ${fmt(slot)}: ${e.message.slice(0, 200)}`);
  }
}

const fmt = (iso) => new Date(Date.parse(iso) + VN).toISOString().slice(5, 16).replace('T', ' ');

async function schedulePost(cid, entry, job, { mode = null } = {}) {
  const ch = readAutopilot(cid);
  if (!ch.page?.id) throw new Error('Kênh chưa chọn Page để đăng');
  if ((mode || ch.postMode) === 'draft') { // Đăng nháp: lưu nháp lên Business Suite để người dùng xem lại rồi tự đăng / hẹn giờ
    Object.assign(entry, { step: 'lưu nháp lên Business Suite' }); upsertPlan(cid, entry);
    J.startFacebook(job, { mode: 'draft', page: ch.page });
    await waitIdle(job, 20 * 60 * 1000);
    if (job.facebook?.state !== 'draft') throw new Error(`Lưu nháp lỗi: ${job.error || ''}`);
    Object.assign(entry, { status: 'nháp', step: null, error: null });
    upsertPlan(cid, entry);
    note(cid, `Đã lưu nháp lên ${ch.page.name} (khung ${fmt(entry.slot)}) — xem trong Business Suite → Nội dung → Bản nháp: ${entry.topic}`);
    return;
  }
  // Khung giờ đã qua / quá sát → hẹn sớm nhất có thể (Facebook đòi > 10 phút).
  // Business Suite khoá nút Lên lịch nếu giờ hẹn quá sát (~< 20 phút) → luôn cách hiện tại ≥ 25 phút.
  const ts = Math.max(Math.floor(Date.parse(entry.slot) / 1000), Math.floor(Date.now() / 1000) + 25 * 60);
  Object.assign(entry, { step: 'hẹn giờ đăng' }); upsertPlan(cid, entry);
  J.startFacebook(job, { mode: 'schedule', scheduledAt: ts, page: ch.page });
  await waitIdle(job, 20 * 60 * 1000);
  if (job.facebook?.state !== 'scheduled') throw new Error(`Hẹn giờ đăng lỗi: ${job.error || ''}`);
  Object.assign(entry, { status: 'đã hẹn', step: null, postAt: new Date(ts * 1000).toISOString() });
  upsertPlan(cid, entry);
  note(cid, `Đã hẹn đăng ${fmt(entry.postAt)} lên ${ch.page.name}: ${entry.topic}`);
}

// ---------- Quét Page để định vị lại kênh ----------
const profiling = new Set();
const OWN = /đã cập nhật (ảnh|tiểu sử)|đã thêm (một |\d+ )?ảnh|đã thay đổi|updated (their|his|her) (cover|profile)/i;
/** Đọc bài Page đã đăng (Business Suite) → Claude định vị lại kênh: định vị, khán giả, giọng, điều tránh, hàng đợi chủ đề mới. */
export async function profile(cid) {
  const ch = readAutopilot(cid);
  if (!ch.page?.id) throw new Error('Kênh chưa chọn Page');
  if (profiling.has(cid)) throw new Error('Kênh này đang được quét');
  profiling.add(cid);
  try {
    note(cid, `Quét Page ${ch.page.name} để định vị lại kênh…`);
    const pg = readInsights().pages?.[ch.page.id];
    if (!pg?.collectedAt || Date.now() - Date.parse(pg.collectedAt) > 6 * 3600 * 1000) await collectPage({ pageId: ch.page.id, pageName: ch.page.name });
    // Bỏ bài do chính web tự làm (định vị cũ có thể sai) và bài cập nhật ảnh bìa / đại diện.
    const mine = J.listJobs().filter((j) => j.facebook && j.caption).map((j) => j.caption.replace(/\s+/g, ' ').trim().slice(0, 50));
    const posts = Object.values(readInsights().pages?.[ch.page.id]?.posts || {})
      .filter((p) => p.title && !p.title.startsWith('(') && !OWN.test(p.title) && !mine.some((m) => m && p.title.startsWith(m)))
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, 150)
      .map((p) => { const m = p.snapshots[p.snapshots.length - 1] || {}; return { caption: p.title.slice(0, 300), postedAt: p.postedAt.slice(0, 10), durationSec: p.durationSec, views: m.views, avgWatchSec: m.avgWatchSec, comments: m.comments, shares: m.shares }; });
    if (posts.length < 3) {
      mutate(cid, (d) => { d.profile = { at: new Date().toISOString(), pageId: ch.page.id, posts: posts.length, summary: 'Page có quá ít bài để định vị — giữ định vị đang nhập.' }; });
      note(cid, `Page ${ch.page.name} chỉ có ${posts.length} bài có caption — giữ định vị đang nhập.`);
      return readAutopilot(cid);
    }
    const r = await profileChannel({ pageName: ch.page.name, posts, current: ch.channel, engine: brainOf(ch) });
    mutate(cid, (d) => {
      d.channel = r.channel.slice(0, 2000);
      d.template = { ...d.template, audience: r.audience.slice(0, 1500), tone: r.tone.slice(0, 1500), avoid: r.avoid.slice(0, 1500) };
      d.topics = (r.topics || []).map((t) => String(t).trim()).filter(Boolean); d.retopic = false; // chủ đề cũ có thể lệch kênh → thay hết
      d.profile = { at: new Date().toISOString(), pageId: ch.page.id, posts: posts.length, summary: r.summary };
    });
    note(cid, `Đã định vị lại kênh từ ${posts.length} bài của Page: ${r.summary}`);
    return readAutopilot(cid);
  } catch (e) {
    mutate(cid, (d) => { d.profile = { at: new Date().toISOString(), pageId: ch.page.id, error: e.message.slice(0, 300) }; });
    note(cid, `Quét Page lỗi: ${e.message.slice(0, 300)} — bấm "Quét lại kênh" để thử lại.`);
    throw e;
  } finally {
    profiling.delete(cid);
  }
}

/** Một vòng: trong mọi kênh đang bật, làm video cho khung giờ sớm nhất chưa có video (mỗi lúc 1 video). */
export async function tick() {
  if (running) return { skipped: 'đang chạy' };
  const chans = readAll().channels.filter((c) => c.enabled);
  if (!chans.length) return { skipped: 'không kênh nào bật' };
  if (!FC.source() || !FBC.source()) {
    for (const c of chans) note(c.id, 'Chưa đủ điều kiện: cần Chrome Flow và Chrome Facebook (tab Tài khoản).');
    return { skipped: 'thiếu điều kiện' };
  }
  // Lỗi ở bước đăng mà video đã làm xong → chỉ đăng lại video đó (không tạo video mới).
  for (const ch of chans) {
    const repost = ch.plan.find((p) => p.status === 'lỗi' && p.jobId && J.getJob(p.jobId)?.final && !J.getJob(p.jobId)?.facebook
      && Date.parse(p.slot) > Date.now() - 3 * 3600 * 1000 && Date.now() - Date.parse(p.at) > 5 * 60 * 1000);
    if (!repost || !ch.page?.id) continue;
    running = true; current = { cid: ch.id, slot: repost.slot, jobId: repost.jobId, step: 'đăng lại video đã làm' };
    note(ch.id, `Đăng lại video đã làm xong cho khung ${fmt(repost.slot)}.`);
    try { await schedulePost(ch.id, { ...repost, error: null, at: new Date().toISOString() }, J.getJob(repost.jobId)); }
    catch (e) { upsertPlan(ch.id, { ...repost, status: 'lỗi', error: e.message.slice(0, 400), at: new Date().toISOString() }); }
    finally { running = false; current = null; }
    return { reposted: repost.slot };
  }
  // Kênh mới bật / vừa đổi Page → quét Page định vị lại kênh trước khi làm video đầu tiên.
  const unprofiled = chans.find((c) => c.page?.id && c.profile?.pageId !== c.page.id && !profiling.has(c.id));
  if (unprofiled) {
    running = true; current = { cid: unprofiled.id, slot: null, step: 'quét Page định vị kênh' };
    try { await profile(unprofiled.id); } catch { /* đã ghi nhật ký */ } finally { running = false; current = null; }
    return { profiled: unprofiled.id };
  }
  const todo = [];
  for (const ch of chans) {
    if (!ch.page?.id) { note(ch.id, 'Kênh chưa chọn Page để đăng.'); continue; }
    const done = new Set(ch.plan.filter((p) => p.status !== 'lỗi' || Date.now() - Date.parse(p.at) < 45 * 60 * 1000).map((p) => p.slot));
    const slot = upcomingSlots(ch).find((x) => !done.has(x));
    if (slot) todo.push({ cid: ch.id, slot });
  }
  todo.sort((a, b) => a.slot.localeCompare(b.slot));
  const next = todo[0];
  if (!next) return { skipped: 'không có khung giờ cần làm' };
  running = true;
  current = { cid: next.cid, slot: next.slot, step: 'bắt đầu' };
  try { await produce(next.cid, next.slot); } finally { running = false; current = null; }
  return next;
}

export async function approve(cid, slot, { mode = null } = {}) {
  const entry = readAutopilot(cid).plan.find((p) => p.slot === slot && ['chờ duyệt', 'nháp'].includes(p.status));
  if (!entry) throw new Error('Không có video chờ duyệt / nháp ở khung giờ này');
  const job = J.getJob(entry.jobId);
  if (!job?.final) throw new Error('Không tìm thấy video đã ghép');
  // Chờ duyệt → đăng theo cách của kênh; nháp → hẹn giờ đăng thật (bản nháp cũ trên Business Suite vẫn còn, xoá tay nếu muốn).
  try { await schedulePost(cid, entry, job, { mode: mode || (entry.status === 'nháp' ? 'schedule' : null) }); } catch (e) { Object.assign(entry, { status: 'lỗi', error: e.message }); upsertPlan(cid, entry); throw e; }
  return entry;
}

export function skip(cid, slot) {
  return mutate(cid, (d) => {
    const entry = d.plan.find((p) => p.slot === slot);
    if (entry) entry.status = 'bỏ qua'; else d.plan.unshift({ slot, status: 'bỏ qua', at: new Date().toISOString() });
  });
}

/** Làm lại video cho 1 khung giờ chưa tới (đã bỏ qua / chờ duyệt / lỗi / không đạt). Video cũ vẫn giữ trong danh sách Video. */
export function redo(cid, slot, { sameTopic = false } = {}) {
  if (!(Date.parse(slot) > Date.now() + 20 * 60 * 1000)) throw new Error('Khung giờ này đã qua hoặc quá sát giờ — không làm lại được');
  if (current?.cid === cid && current?.slot === slot) throw new Error('Khung giờ này đang được làm');
  const entry = readAutopilot(cid).plan.find((p) => p.slot === slot);
  if (entry?.status === 'đã hẹn') throw new Error('Video của khung giờ này đã hẹn đăng — huỷ ở tab Lịch đăng trước');
  mutate(cid, (d) => {
    d.plan = d.plan.filter((p) => p.slot !== slot);
    if (sameTopic && entry?.topic) d.topics.unshift(entry.topic);
  });
  note(cid, `Làm lại khung ${fmt(slot)}${sameTopic && entry?.topic ? ' (cùng chủ đề)' : ' (chủ đề mới)'}.`);
  if (readAutopilot(cid).enabled) tick().catch(() => {});
}

export async function ideate(cid) {
  const d = readAutopilot(cid);
  const more = await ideateTopics({ channel: channelBrief(d), playbook: activePlaybook(), recent: [...d.topics, ...channelJobTopics(cid), ...recentTitles(d)], engine: brainOf(d), benchmark: BM.briefFor(d.benchmarkId) });
  mutate(cid, (x) => { x.topics.push(...more); x.retopic = false; });
  note(cid, `Claude nghĩ ${more.length} chủ đề theo định vị kênh.`);
}

export function view() {
  const d = readAll();
  return {
    channels: d.channels.map((c) => ({ ...c, upcoming: upcomingSlots(c), profiling: profiling.has(c.id) })),
    status: status(),
    ready: { flow: Boolean(FC.source()), fb: Boolean(FBC.source()) },
  };
}

/** Khởi động lại giữa chừng: video đã ghép thì hẹn đăng tiếp, chưa thì đánh dấu lỗi. */
async function resumeInterrupted() {
  for (const ch of readAll().channels) {
    for (const entry of ch.plan.filter((p) => p.status === 'đang làm')) {
      const job = entry.jobId && J.getJob(entry.jobId);
      if (job?.final && !job.facebook && ch.page?.id && Date.parse(entry.slot) > Date.now() - 2 * 3600 * 1000) {
        note(ch.id, `Khởi động lại: video khung ${fmt(entry.slot)} đã ghép xong → hẹn đăng tiếp.`);
        running = true; current = { cid: ch.id, slot: entry.slot, jobId: job.id, step: 'hẹn giờ đăng' };
        try { await schedulePost(ch.id, entry, job); } catch (e) { Object.assign(entry, { status: 'lỗi', error: e.message.slice(0, 400), step: null }); upsertPlan(ch.id, entry); }
        finally { running = false; current = null; }
      } else {
        Object.assign(entry, { status: 'lỗi', error: 'Server khởi động lại giữa chừng', step: null, at: new Date().toISOString() });
        upsertPlan(ch.id, entry);
      }
    }
  }
}

export function startLoop() {
  setTimeout(() => resumeInterrupted().catch(() => {}), 20 * 1000);
  setInterval(() => tick().catch(() => {}), 5 * 60 * 1000);
  setTimeout(() => tick().catch(() => {}), 60 * 1000);
}
