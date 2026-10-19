// Tự nuôi kênh: mỗi ngày N khung giờ (mặc định 3). Với khung giờ sắp tới chưa có video, web tự làm trọn dây chuyền:
// chủ đề (hàng đợi, hết thì Claude nghĩ) → kịch bản → Chrome Flow tạo cảnh (kiểm tra áo) → ghép → Chrome Facebook HẸN GIỜ đăng
// đúng khung giờ (còn thời gian xem / huỷ). Tuỳ chọn "cần duyệt": làm xong video thì chờ người bấm duyệt mới hẹn đăng.
// Mỗi lúc chỉ làm 1 video; lỗi thì ghi lại, sang khung giờ kế tiếp.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as J from './jobs.js';
import { ideateTopics, reviewVideo } from './llm.js';
import { frameAt } from './media.js';
import { activePlaybook } from './playbook.js';
import { browserPage } from './fb-browser.js';
import * as FC from './flow-chrome.js';
import * as FBC from './fb-chrome.js';
import { readInsights } from './fb-insights.js';

const file = () => path.join(config.dataDir, 'autopilot.json');
const DEFAULTS = {
  enabled: false,
  requireApproval: false,
  autoReview: true,      // Claude tự chấm video: đạt ngưỡng thì tự đăng, chưa đạt thì làm lại
  minScore: 70,
  fallbackScore: 55,     // hết lượt làm lại: bản tốt nhất ≥ mức này thì vẫn đăng
  maxRedo: 2,
  slots: ['11:30', '14:30', '20:30'], // giờ Việt Nam
  horizonHours: 20,                    // làm trước cho các khung giờ trong vòng N giờ tới
  channel: '',                         // định vị kênh: chủ đề, đối tượng, giọng điệu
  template: { sceneCount: 3, voice: 'me', character: 'Áo polo đen trơn, cổ bẻ, hàng cúc ngắn, tay ngắn, không in hình, không logo', setting: '', audience: '', tone: '', avoid: '', cta: '', mustSay: '', flowModel: 'Veo 3.1 - Fast' },
  topics: [],
  plan: [],                            // [{ slot, topic, jobId, status, error, at }]
  log: [],
};
export function readAutopilot() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* chưa có */ }
  return { ...DEFAULTS, ...d, template: { ...DEFAULTS.template, ...(d.template || {}) } };
}
function write(d) { fs.writeFileSync(file(), JSON.stringify(d, null, 2)); }
// Dây chuyền chạy lâu: mọi cập nhật đọc lại file mới nhất rồi chỉ sửa phần của mình (không ghi đè cài đặt người dùng vừa đổi).
function mutate(fn) { const d = readAutopilot(); const r = fn(d); write(d); return r; }
function note(msg) { mutate((d) => { d.log = [{ at: new Date().toISOString(), msg }, ...(d.log || [])].slice(0, 200); }); }
function upsertPlan(entry) { mutate((d) => { d.plan = [{ ...entry }, ...d.plan.filter((p) => p.slot !== entry.slot)].slice(0, 120); }); }

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

export function saveSettings(patch) {
  const d = readAutopilot();
  if ('enabled' in patch) d.enabled = Boolean(patch.enabled);
  if ('requireApproval' in patch) d.requireApproval = Boolean(patch.requireApproval);
  if ('autoReview' in patch) d.autoReview = Boolean(patch.autoReview);
  if (patch.minScore != null) d.minScore = Math.min(95, Math.max(30, Math.round(Number(patch.minScore)) || 70));
  if (patch.fallbackScore != null) d.fallbackScore = Math.min(d.minScore, Math.max(0, Math.round(Number(patch.fallbackScore)) || 55));
  if (patch.maxRedo != null) d.maxRedo = Math.min(4, Math.max(0, Math.round(Number(patch.maxRedo)) || 0));
  if (Array.isArray(patch.slots)) d.slots = patch.slots.map((x) => String(x).trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).slice(0, 6).sort();
  if (patch.horizonHours) d.horizonHours = Math.min(36, Math.max(4, Number(patch.horizonHours) || 20));
  if (typeof patch.channel === 'string') d.channel = patch.channel.slice(0, 2000);
  if (patch.template && typeof patch.template === 'object') {
    const t = patch.template;
    d.template = { ...d.template, ...Object.fromEntries(['character', 'setting', 'audience', 'tone', 'avoid', 'cta', 'mustSay', 'voice', 'flowModel'].filter((k) => typeof t[k] === 'string').map((k) => [k, t[k].slice(0, 1500)])) };
    if (t.sceneCount) d.template.sceneCount = Math.min(11, Math.max(2, Math.round(Number(t.sceneCount)) || 3));
  }
  if (Array.isArray(patch.topics)) d.topics = patch.topics.map((x) => String(x).trim()).filter(Boolean).slice(0, 100);
  write(d);
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

async function nextTopic() {
  let d = readAutopilot();
  if (!d.topics.length) {
    const recent = Object.values(readInsights().pages || {}).flatMap((pg) => Object.values(pg.posts || {}).map((p) => p.title)).filter((t) => t && !t.startsWith('('));
    const mine = J.listJobs().map((j) => j.topic);
    const more = await ideateTopics({ channel: d.channel || d.template.audience || 'Kênh Reel', playbook: activePlaybook(), recent: [...mine, ...recent] });
    if (!more.length) throw new Error('Không có chủ đề');
    mutate((x) => { x.topics.push(...more); });
    note(`Claude nghĩ thêm ${more.length} chủ đề.`);
  }
  return mutate((x) => x.topics.shift());
}

let running = false;
let current = null; // { slot, jobId, step }
export function status() { return { running, current }; }

/** Làm 1 video hoàn chỉnh (kịch bản → Flow → ghép) cho chủ đề; feedback = nhận xét của lần chấm trước. */
async function makeVideo(slot, topic, feedback, set) {
  const t = readAutopilot().template;
  set({ step: feedback ? 'viết lại kịch bản theo nhận xét' : 'viết kịch bản' });
  const job = await J.createJob({
    topic, sceneCount: t.sceneCount, audience: t.audience, cta: t.cta, character: t.character, setting: t.setting, mustSay: t.mustSay,
    avoid: t.avoid, tone: t.tone, flowModel: t.flowModel, consistency: 'identity', voice: t.voice || null, autopilot: slot, feedback: feedback || '',
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
async function reviewJob(job) {
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
    const d = readAutopilot();
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

/** Làm video cho 1 khung giờ; tự chấm → đạt thì tự hẹn đăng, chưa đạt thì làm lại cùng chủ đề theo nhận xét. */
async function produce(slot) {
  const entry = { slot, topic: null, jobId: null, status: 'đang làm', at: new Date().toISOString(), attempts: [] };
  const set = (patch) => { Object.assign(entry, patch); current = { slot, jobId: entry.jobId, step: entry.step }; upsertPlan(entry); };
  try {
    set({ step: 'chọn chủ đề' });
    set({ topic: await nextTopic() });
    const cfg = readAutopilot();
    const review = cfg.autoReview && !cfg.requireApproval;
    let feedback = '';
    let best = null;
    let fixJob = null; // kịch bản ổn, chỉ vài cảnh lỗi hình → tạo lại đúng các cảnh đó trên cùng video
    for (let attempt = 0; attempt <= (review ? cfg.maxRedo : 0); attempt++) {
      const job = fixJob ? await refixScenes(fixJob.job, fixJob.r, set) : await makeVideo(slot, entry.topic, feedback, set);
      fixJob = null;
      const now = readAutopilot(); // đọc lại: người dùng có thể vừa tắt chấm điểm / bật duyệt
      if (!(now.autoReview && !now.requireApproval)) {
        if (now.requireApproval) { set({ status: 'chờ duyệt', step: null, jobId: job.id }); note(`Video cho ${fmt(slot)} xong, chờ duyệt: ${entry.topic}`); return; }
        return await schedulePost(entry, job);
      }
      if (!review) {
        if (cfg.requireApproval) { set({ status: 'chờ duyệt', step: null }); note(`Video cho ${fmt(slot)} xong, chờ duyệt: ${entry.topic}`); return; }
        return await schedulePost(entry, job);
      }
      set({ step: `tự chấm (lần ${attempt + 1})` });
      const r = await reviewJob(job);
      entry.attempts.push({ jobId: job.id, score: r.score, verdict: r.verdict, issues: r.issues.slice(0, 300) });
      set({ score: r.score });
      if (!best || r.score > best.r.score) best = { job, r };
      if (r.score >= cfg.minScore) break;
      if (attempt < cfg.maxRedo) {
        const bad = r.badScenes.filter((n) => n <= job.scenes.length);
        if (r.scriptOk && bad.length && bad.length < job.scenes.length) {
          fixJob = { job, r: { ...r, badScenes: bad } };
          note(`Khung ${fmt(slot)}: ${r.score}/100 < ${cfg.minScore} → kịch bản ổn, tạo lại cảnh ${bad.join(', ')} (${attempt + 1}/${cfg.maxRedo}).`);
        } else {
          note(`Khung ${fmt(slot)}: ${r.score}/100 < ${cfg.minScore} → viết lại kịch bản cùng chủ đề (${attempt + 1}/${cfg.maxRedo}).`);
          feedback = `${r.issues} — Cách sửa: ${r.fixes}`.slice(0, 900);
        }
      }
    }
    if (!review || !best) return;
    const { job, r } = best;
    if (r.score < cfg.minScore && r.score < cfg.fallbackScore) {
      set({ status: 'không đạt', step: null, jobId: job.id, score: r.score, error: `Điểm cao nhất ${r.score}/100 < ${cfg.fallbackScore}: ${r.issues}`.slice(0, 400) });
      note(`Khung ${fmt(slot)}: không đăng — điểm cao nhất ${r.score}/100.`);
      return;
    }
    if (r.caption && r.caption.trim() && r.caption.trim() !== (job.caption || '').trim()) J.updateJob(job, { caption: r.caption.trim() });
    set({ jobId: job.id, score: r.score });
    await schedulePost(entry, job);
  } catch (e) {
    set({ status: 'lỗi', error: e.message.slice(0, 400), step: null });
    note(`Lỗi khung ${fmt(slot)}: ${e.message.slice(0, 200)}`);
  }
}

const fmt = (iso) => new Date(Date.parse(iso) + VN).toISOString().slice(5, 16).replace('T', ' ');

async function schedulePost(entry, job) {
  // Khung giờ đã qua / quá sát → hẹn sớm nhất có thể (Facebook đòi > 10 phút).
  // Business Suite khoá nút Lên lịch nếu giờ hẹn quá sát (~< 20 phút) → luôn cách hiện tại ≥ 25 phút.
  const ts = Math.max(Math.floor(Date.parse(entry.slot) / 1000), Math.floor(Date.now() / 1000) + 25 * 60);
  Object.assign(entry, { step: 'hẹn giờ đăng' }); upsertPlan(entry);
  J.startFacebook(job, { mode: 'schedule', scheduledAt: ts });
  await waitIdle(job, 20 * 60 * 1000);
  if (job.facebook?.state !== 'scheduled') throw new Error(`Hẹn giờ đăng lỗi: ${job.error || ''}`);
  Object.assign(entry, { status: 'đã hẹn', step: null, postAt: new Date(ts * 1000).toISOString() });
  upsertPlan(entry);
  note(`Đã hẹn đăng ${fmt(entry.postAt)}: ${entry.topic}`);
}

/** Một vòng: nếu đang bật và có khung giờ sắp tới chưa làm → làm video cho khung sớm nhất. */
export async function tick() {
  if (running) return { skipped: 'đang chạy' };
  const d = readAutopilot();
  if (!d.enabled) return { skipped: 'đang tắt' };
  if (!FC.source() || !FBC.source() || !browserPage()) {
    note('Chưa đủ điều kiện: cần Chrome Flow, Chrome Facebook và Page để đăng (tab Tài khoản).');
    return { skipped: 'thiếu điều kiện' };
  }
  // Lỗi ở bước đăng mà video đã làm xong → chỉ đăng lại video đó (không tạo video mới).
  const repost = d.plan.find((p) => p.status === 'lỗi' && p.jobId && J.getJob(p.jobId)?.final && !J.getJob(p.jobId)?.facebook
    && Date.parse(p.slot) > Date.now() - 3 * 3600 * 1000 && Date.now() - Date.parse(p.at) > 5 * 60 * 1000);
  if (repost) {
    running = true; current = { slot: repost.slot, jobId: repost.jobId, step: 'đăng lại video đã làm' };
    note(`Đăng lại video đã làm xong cho khung ${fmt(repost.slot)}.`);
    try { await schedulePost({ ...repost, error: null, at: new Date().toISOString() }, J.getJob(repost.jobId)); }
    catch (e) { upsertPlan({ ...repost, status: 'lỗi', error: e.message.slice(0, 400), at: new Date().toISOString() }); }
    finally { running = false; current = null; }
    return { reposted: repost.slot };
  }
  const done = new Set(d.plan.filter((p) => p.status !== 'lỗi' || Date.now() - Date.parse(p.at) < 45 * 60 * 1000).map((p) => p.slot));
  const slot = upcomingSlots(d).find((s) => !done.has(s));
  if (!slot) return { skipped: 'không có khung giờ cần làm' };
  running = true;
  current = { slot, step: 'bắt đầu' };
  try { await produce(slot); } finally { running = false; current = null; }
  return { slot };
}

export async function approve(slot) {
  const d = readAutopilot();
  const entry = d.plan.find((p) => p.slot === slot && p.status === 'chờ duyệt');
  if (!entry) throw new Error('Không có video chờ duyệt ở khung giờ này');
  const job = J.getJob(entry.jobId);
  if (!job?.final) throw new Error('Không tìm thấy video đã ghép');
  try { await schedulePost(entry, job); } catch (e) { Object.assign(entry, { status: 'lỗi', error: e.message }); upsertPlan(entry); throw e; }
  return entry;
}

export function skip(slot) {
  const d = readAutopilot();
  const entry = d.plan.find((p) => p.slot === slot);
  if (entry) entry.status = 'bỏ qua'; else d.plan.unshift({ slot, status: 'bỏ qua', at: new Date().toISOString() });
  write(d);
  return d;
}

/** Làm lại video cho 1 khung giờ chưa tới (đã bỏ qua / chờ duyệt / lỗi): xoá mục cũ khỏi lịch rồi chạy vòng mới.
 *  sameTopic: đưa chủ đề cũ lên đầu hàng đợi (viết kịch bản + tạo video mới hoàn toàn). Video cũ vẫn giữ trong danh sách Video. */
export function redo(slot, { sameTopic = false } = {}) {
  if (!(Date.parse(slot) > Date.now() + 20 * 60 * 1000)) throw new Error('Khung giờ này đã qua hoặc quá sát giờ — không làm lại được');
  if (current?.slot === slot) throw new Error('Khung giờ này đang được làm');
  const entry = readAutopilot().plan.find((p) => p.slot === slot);
  if (entry?.status === 'đã hẹn') throw new Error('Video của khung giờ này đã hẹn đăng — huỷ ở tab Lịch đăng trước');
  mutate((d) => {
    d.plan = d.plan.filter((p) => p.slot !== slot);
    if (sameTopic && entry?.topic) d.topics.unshift(entry.topic);
  });
  note(`Làm lại khung ${fmt(slot)}${sameTopic && entry?.topic ? ' (cùng chủ đề)' : ' (chủ đề mới)'}.`);
  if (readAutopilot().enabled) tick().catch(() => {});
  return view();
}

export async function ideate() {
  const d = readAutopilot();
  const recent = Object.values(readInsights().pages || {}).flatMap((pg) => Object.values(pg.posts || {}).map((p) => p.title)).filter((t) => t && !t.startsWith('('));
  const more = await ideateTopics({ channel: d.channel || 'Kênh Reel', playbook: activePlaybook(), recent: [...d.topics, ...J.listJobs().map((j) => j.topic), ...recent] });
  return mutate((x) => { x.topics.push(...more); return x; });
}

export function view() {
  const d = readAutopilot();
  return { ...d, upcoming: upcomingSlots(d), status: status(), page: browserPage(), ready: { flow: Boolean(FC.source()), fb: Boolean(FBC.source()), page: Boolean(browserPage()) } };
}

/** Vòng lặp nền: 5 phút / lần. */
async function resumeInterrupted() {
  const stale = readAutopilot().plan.filter((p) => p.status === 'đang làm');
  for (const entry of stale) {
    const job = entry.jobId && J.getJob(entry.jobId);
    if (job?.final && !job.facebook && Date.parse(entry.slot) > Date.now() - 2 * 3600 * 1000) {
      note(`Khởi động lại: video khung ${fmt(entry.slot)} đã ghép xong → hẹn đăng tiếp.`);
      running = true; current = { slot: entry.slot, jobId: job.id, step: 'hẹn giờ đăng' };
      try { await schedulePost(entry, job); } catch (e) { Object.assign(entry, { status: 'lỗi', error: e.message.slice(0, 400), step: null }); upsertPlan(entry); }
      finally { running = false; current = null; }
    } else {
      Object.assign(entry, { status: 'lỗi', error: 'Server khởi động lại giữa chừng', step: null, at: new Date().toISOString() });
      upsertPlan(entry);
    }
  }
}

export function startLoop() {
  setTimeout(() => resumeInterrupted().catch(() => {}), 20 * 1000);
  setInterval(() => tick().catch(() => {}), 5 * 60 * 1000);
  setTimeout(() => tick().catch(() => {}), 60 * 1000);
}
