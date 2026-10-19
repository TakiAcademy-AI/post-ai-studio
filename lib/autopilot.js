// Tự nuôi kênh: mỗi ngày N khung giờ (mặc định 3). Với khung giờ sắp tới chưa có video, web tự làm trọn dây chuyền:
// chủ đề (hàng đợi, hết thì Claude nghĩ) → kịch bản → Chrome Flow tạo cảnh (kiểm tra áo) → ghép → Chrome Facebook HẸN GIỜ đăng
// đúng khung giờ (còn thời gian xem / huỷ). Tuỳ chọn "cần duyệt": làm xong video thì chờ người bấm duyệt mới hẹn đăng.
// Mỗi lúc chỉ làm 1 video; lỗi thì ghi lại, sang khung giờ kế tiếp.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import * as J from './jobs.js';
import { ideateTopics } from './llm.js';
import { activePlaybook } from './playbook.js';
import { browserPage } from './fb-browser.js';
import * as FC from './flow-chrome.js';
import * as FBC from './fb-chrome.js';
import { readInsights } from './fb-insights.js';

const file = () => path.join(config.dataDir, 'autopilot.json');
const DEFAULTS = {
  enabled: false,
  requireApproval: false,
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

/** Làm trọn 1 video cho 1 khung giờ. */
async function produce(slot) {
  const entry = { slot, topic: null, jobId: null, status: 'đang làm', at: new Date().toISOString() };
  const set = (patch) => { Object.assign(entry, patch); current = { slot, jobId: entry.jobId, step: entry.step }; upsertPlan(entry); };
  try {
    set({ step: 'chọn chủ đề' });
    set({ topic: await nextTopic() });
    const t = readAutopilot().template;
    set({ step: 'viết kịch bản' });
    const job = await J.createJob({
      topic: entry.topic, sceneCount: t.sceneCount, audience: t.audience, cta: t.cta, character: t.character, setting: t.setting, mustSay: t.mustSay,
      avoid: t.avoid, tone: t.tone, flowModel: t.flowModel, consistency: 'identity', voice: t.voice || null, autopilot: slot,
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
    if (readAutopilot().requireApproval) { set({ status: 'chờ duyệt', step: null }); note(`Video cho ${fmt(slot)} xong, chờ duyệt: ${entry.topic}`); return; }
    await schedulePost(entry, job);
  } catch (e) {
    set({ status: 'lỗi', error: e.message.slice(0, 400), step: null });
    note(`Lỗi khung ${fmt(slot)}: ${e.message.slice(0, 200)}`);
  }
}

const fmt = (iso) => new Date(Date.parse(iso) + VN).toISOString().slice(5, 16).replace('T', ' ');

async function schedulePost(entry, job) {
  // Khung giờ đã qua / quá sát → hẹn sớm nhất có thể (Facebook đòi > 10 phút).
  const ts = Math.max(Math.floor(Date.parse(entry.slot) / 1000), Math.floor(Date.now() / 1000) + 15 * 60);
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
export function startLoop() {
  setInterval(() => tick().catch(() => {}), 5 * 60 * 1000);
  setTimeout(() => tick().catch(() => {}), 60 * 1000);
}
