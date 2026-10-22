// Agent "boss" — bộ não Grok (Grok CLI) giám sát Tự nuôi kênh:
//  • Báo cáo mỗi ngày (và khi bấm): đọc cài đặt, kế hoạch, nhật ký, số liệu Page của mọi kênh → nhận định + danh sách ĐỀ XUẤT.
//  • Chat ra lệnh: người dùng nói bằng lời, boss trả lời + đề xuất thao tác.
//  • Xem video trước khi đăng (kênh bật "Boss duyệt video"): đề xuất đăng / lưu nháp / làm lại.
// Boss KHÔNG tự thay đổi gì: mỗi đề xuất chờ người dùng bấm "Áp dụng".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { callGrok } from './grok.js';
import * as AP from './autopilot.js';
import * as J from './jobs.js';
import { readInsights } from './fb-insights.js';
import { activePlaybook } from './playbook.js';

const file = () => path.join(config.dataDir, 'boss.json');
const VN = 7 * 3600 * 1000;
function read() {
  try { return { dailyAt: '07:30', daily: true, reports: [], chat: [], ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; }
  catch { return { dailyAt: '07:30', daily: true, reports: [], chat: [] }; }
}
function write(d) { fs.writeFileSync(file(), JSON.stringify(d, null, 2)); }
const vnTime = (iso) => (iso ? new Date(Date.parse(iso) + VN).toISOString().slice(5, 16).replace('T', ' ') : '');

// ---------- Đề xuất (thao tác boss được phép đề nghị) ----------
const ACTIONS = ['set_field', 'add_topics', 'replace_topics', 'set_slots', 'set_enabled', 'set_post_mode', 'set_scene_count', 'redo_slot', 'skip_slot', 'approve_slot', 'rescan_channel'];
const FIELDS = ['channel', 'audience', 'tone', 'avoid', 'character', 'setting', 'camera', 'cta'];
const PROPOSAL = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ACTIONS },
    cid: { type: 'string' },
    slot: { type: 'string' },
    field: { type: 'string' },
    value: { type: 'string' },
    list: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['action', 'cid', 'slot', 'field', 'value', 'list', 'reason'],
};
const ACTION_GUIDE = `CÁC THAO TÁC ĐƯỢC ĐỀ XUẤT (mỗi đề xuất là 1 object; trường không dùng để "" hoặc []):
- set_field: đổi 1 ô của kênh — field ∈ ${FIELDS.join(', ')} (channel = Định vị kênh; character = DNA trang phục; setting = bối cảnh; camera = góc quay), value = nội dung mới đầy đủ.
- add_topics / replace_topics: list = các chủ đề (mỗi chủ đề 1 câu cụ thể, đúng định vị kênh).
- set_slots: list = giờ đăng "HH:MM" giờ Việt Nam (tối đa 6).
- set_enabled: value "true" (bật) / "false" (tắt) kênh.
- set_post_mode: value "schedule" (hẹn giờ đăng) / "draft" (lưu nháp chờ duyệt).
- set_scene_count: value = số cảnh mỗi video (2–11).
- redo_slot: slot = mã khung giờ ISO trong kế hoạch, value "same" (cùng chủ đề) / "new" (chủ đề mới) — chỉ khung chưa tới, đang lỗi / chờ duyệt / nháp / bỏ qua.
- skip_slot: slot = mã khung giờ ISO — bỏ qua khung đó.
- approve_slot: slot = khung đang "chờ duyệt", value "schedule" (hẹn giờ đăng) / "draft" (lưu nháp).
- rescan_channel: quét lại Page để định vị kênh.
cid = mã kênh (trường "id" của kênh). Chỉ đề xuất khi có lý do rõ ("reason": 1–2 câu, có số liệu nếu có). Không đề xuất trùng lặp, không quá 8 đề xuất.`;

function snapshot() {
  const ins = readInsights();
  const mine = new Set(J.listJobs().filter((j) => j.facebook && j.caption).map((j) => j.caption.replace(/\s+/g, ' ').trim().slice(0, 50)));
  const { channels, status } = AP.view();
  return {
    now_vn: vnTime(new Date().toISOString()),
    pipeline: status,
    playbook: activePlaybook() || '(chưa có)',
    channels: channels.map((c) => {
      const pg = c.page?.id ? ins.pages?.[c.page.id] : null;
      const posts = Object.values(pg?.posts || {}).sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, 25).map((p) => {
        const m = p.snapshots[p.snapshots.length - 1] || {};
        return { at: vnTime(p.postedAt), by_web: [...mine].some((x) => x && p.title.startsWith(x)), caption: p.title.slice(0, 140), views: m.views, avgWatchSec: m.avgWatchSec, comments: m.comments, shares: m.shares };
      });
      return {
        id: c.id, name: c.name, page: c.page?.name || null, enabled: c.enabled, postMode: c.postMode, brain: c.brain, bossReview: c.bossReview,
        slots: c.slots, sceneCount: c.template.sceneCount, positioning: c.channel, audience: c.template.audience, tone: c.template.tone, avoid: c.template.avoid,
        character: c.template.character, setting: c.template.setting, camera: c.template.camera, cta: c.template.cta,
        topics_queue: c.topics.slice(0, 15),
        plan: c.plan.slice(0, 12).map((p) => ({ slot: p.slot, slot_vn: vnTime(p.slot), status: p.status, topic: (p.topic || '').slice(0, 160), score: p.score, error: p.error ? p.error.slice(0, 160) : undefined, boss: p.boss ? `${p.boss.verdict} ${p.boss.score}` : undefined })),
        upcoming_vn: c.upcoming.map(vnTime),
        log: c.log.slice(0, 12).map((l) => `${vnTime(l.at)} ${l.msg.slice(0, 200)}`),
        page_posts_recent: posts,
      };
    }),
  };
}

const BOSS_ROLE = 'Bạn là "Boss" — giám đốc nội dung dày dạn kinh nghiệm, điều hành nhiều kênh Facebook Reels tự động (mỗi kênh = 1 Page, '
  + 'web tự viết kịch bản, tạo video AI bằng Google Flow với người dẫn @me, rồi hẹn giờ đăng / lưu nháp). Bạn nói tiếng Việt, thẳng, ngắn, '
  + 'dựa trên số liệu; ưu tiên: đúng định vị từng kênh, giữ chân người xem, đều đặn, không lỗi. Không đề xuất giật tít sai sự thật, '
  + 'công kích cá nhân, chính trị/tôn giáo nhạy cảm. Bạn KHÔNG tự làm — chỉ đề xuất để người dùng bấm duyệt.';

const withIds = (proposals) => (proposals || []).filter((p) => ACTIONS.includes(p.action)).slice(0, 8)
  .map((p) => ({ ...p, id: crypto.randomBytes(4).toString('hex'), status: 'mới' }));

// ---------- Báo cáo giám sát ----------
const REPORT_SCHEMA = { type: 'object', properties: { report: { type: 'string' }, proposals: { type: 'array', items: PROPOSAL } }, required: ['report', 'proposals'] };
let reporting = null;
export function supervise() {
  if (reporting) return reporting;
  reporting = (async () => {
    try {
      const r = await callGrok({
        systemPrompt: `${BOSS_ROLE}\n\nNHIỆM VỤ: báo cáo giám sát. "report" (tối đa 1800 ký tự, gạch đầu dòng): mỗi kênh 2–4 dòng — tình hình (video làm / lỗi / đăng), `
          + 'chất lượng & số liệu bài gần đây (bài by_web=true là do web làm), định vị có còn đúng không, việc cần làm; cuối cùng 1–3 ưu tiên chung. '
          + `"proposals": các thao tác cụ thể nên làm ngay.\n\n${ACTION_GUIDE}`,
        schema: REPORT_SCHEMA,
        input: JSON.stringify(snapshot()),
        effort: 'high',
      });
      const d = read();
      const rep = { id: crypto.randomBytes(4).toString('hex'), at: new Date().toISOString(), text: String(r.data.report || '').trim(), proposals: withIds(r.data.proposals), costUsd: r.costUsd };
      d.reports = [rep, ...d.reports].slice(0, 30);
      d.lastReportAt = rep.at; d.lastError = null;
      write(d);
      return rep;
    } catch (e) {
      const d = read(); d.lastError = e.message.slice(0, 400); d.lastErrorAt = new Date().toISOString(); write(d);
      throw e;
    } finally { reporting = null; }
  })();
  return reporting;
}

// ---------- Chat ra lệnh ----------
const CHAT_SCHEMA = { type: 'object', properties: { reply: { type: 'string' }, proposals: { type: 'array', items: PROPOSAL } }, required: ['reply', 'proposals'] };
let chatting = false;
export async function chat(message) {
  const text = String(message || '').trim().slice(0, 3000);
  if (!text) throw new Error('Tin nhắn trống');
  if (chatting) throw new Error('Boss đang trả lời tin trước');
  chatting = true;
  const d0 = read();
  d0.chat.push({ role: 'user', text, at: new Date().toISOString() });
  write(d0);
  try {
    const history = d0.chat.slice(-12, -1).map((m) => `${m.role === 'user' ? 'Người dùng' : 'Boss'}: ${m.text.slice(0, 800)}`).join('\n');
    const r = await callGrok({
      systemPrompt: `${BOSS_ROLE}\n\nNHIỆM VỤ: trả lời tin nhắn của người dùng ("reply", ngắn gọn, tiếng Việt). Nếu người dùng ra lệnh thay đổi kênh, `
        + 'chuyển lệnh thành "proposals" chính xác (người dùng sẽ bấm Áp dụng); nếu lệnh mơ hồ (không rõ kênh nào…) thì hỏi lại trong reply, proposals = []. '
        + `Câu hỏi thuần tuý thì proposals = [].\n\n${ACTION_GUIDE}`,
      schema: CHAT_SCHEMA,
      input: JSON.stringify({ state: snapshot(), recent_chat: history || '(chưa có)', message: text }),
      effort: 'medium',
    });
    const d = read();
    const msg = { role: 'boss', text: String(r.data.reply || '').trim(), at: new Date().toISOString(), proposals: withIds(r.data.proposals) };
    d.chat = [...d.chat, msg].slice(-60);
    write(d);
    return msg;
  } catch (e) {
    const d = read();
    d.chat = [...d.chat, { role: 'boss', text: `⚠ ${e.message.slice(0, 300)}`, at: new Date().toISOString(), error: true }].slice(-60);
    write(d);
    throw e;
  } finally { chatting = false; }
}

// ---------- Áp dụng / bỏ đề xuất ----------
function findProposal(d, id) {
  for (const r of d.reports) { const p = r.proposals.find((x) => x.id === id); if (p) return p; }
  for (const m of d.chat) { const p = (m.proposals || []).find((x) => x.id === id); if (p) return p; }
  return null;
}
async function execute(p) {
  const cid = p.cid;
  AP.readAutopilot(cid); // ném lỗi nếu không có kênh
  const yes = (v) => /^(true|1|bật|on|yes)$/i.test(String(v).trim());
  switch (p.action) {
    case 'set_field': {
      if (!FIELDS.includes(p.field)) throw new Error(`Ô không hợp lệ: ${p.field}`);
      if (p.field === 'channel') return AP.saveSettings(cid, { channel: p.value });
      return AP.saveSettings(cid, { template: { [p.field]: p.value } });
    }
    case 'add_topics': return AP.saveSettings(cid, { topics: [...AP.readAutopilot(cid).topics, ...p.list] });
    case 'replace_topics': return AP.saveSettings(cid, { topics: p.list });
    case 'set_slots': return AP.saveSettings(cid, { slots: p.list });
    case 'set_enabled': { const r = AP.saveSettings(cid, { enabled: yes(p.value) }); if (r.enabled) AP.tick().catch(() => {}); return r; }
    case 'set_post_mode': return AP.saveSettings(cid, { postMode: p.value === 'draft' ? 'draft' : 'schedule' });
    case 'set_scene_count': return AP.saveSettings(cid, { template: { sceneCount: Number(p.value) } });
    case 'redo_slot': return AP.redo(cid, p.slot, { sameTopic: p.value === 'same' });
    case 'skip_slot': return AP.skip(cid, p.slot);
    case 'approve_slot': return AP.approve(cid, p.slot, { mode: p.value === 'draft' ? 'draft' : 'schedule' });
    case 'rescan_channel': return AP.profile(cid);
    default: throw new Error(`Thao tác lạ: ${p.action}`);
  }
}
export async function applyProposal(id) {
  const p = findProposal(read(), id);
  if (!p) throw new Error('Không thấy đề xuất');
  if (p.status === 'đã áp dụng') return p;
  const set = (patch) => { const d = read(); Object.assign(findProposal(d, id), patch); write(d); };
  set({ status: 'đang làm' });
  try {
    await execute(p);
    set({ status: 'đã áp dụng', at: new Date().toISOString(), error: null });
  } catch (e) {
    set({ status: 'lỗi', error: e.message.slice(0, 300) });
    throw e;
  }
  return findProposal(read(), id);
}
export function dismissProposal(id) {
  const d = read(); const p = findProposal(d, id);
  if (!p) throw new Error('Không thấy đề xuất');
  p.status = 'bỏ qua'; write(d); return p;
}

// ---------- Xem video trước khi đăng ----------
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['đăng', 'nháp', 'làm lại'] },
    score: { type: 'integer' },
    reason: { type: 'string' },
    fixes: { type: 'string' },
  },
  required: ['verdict', 'score', 'reason', 'fixes'],
};
export async function reviewVideo(cid, job) {
  const ch = AP.readAutopilot(cid);
  const frames = await AP.reviewFrames(job, [0.35, 0.8]);
  try {
    const r = await callGrok({
      systemPrompt: `${BOSS_ROLE}\n\nNHIỆM VỤ: duyệt 1 video Reel TRƯỚC KHI ĐĂNG. Mở từng ảnh khung hình (2 khung mỗi cảnh, theo thứ tự cảnh). `
        + 'Chấm 0–100 (hook 3 giây đầu, đúng định vị kênh, lời thoại tự nhiên, người dẫn / áo / bối cảnh nhất quán giữa các cảnh, KHÔNG có chữ / phụ đề lỗi, '
        + 'hình không méo, caption hợp). verdict: "đăng" (≥ 75, không lỗi hình), "nháp" (dùng được nhưng nên xem lại / sửa caption), "làm lại" (lỗi hình, '
        + 'chữ lỗi, sai áo giữa các cảnh, lệch kênh, nhàm). reason ≤ 300 ký tự, fixes = cách sửa cụ thể ≤ 300 ký tự (rỗng nếu không cần).',
      schema: REVIEW_SCHEMA,
      input: JSON.stringify({
        channel: { name: ch.name, positioning: ch.channel, audience: ch.template.audience },
        topic: job.input.topic, caption: job.caption, duration_sec: Math.round(job.final?.duration || 0),
        scenes: job.scenes.map((s, i) => ({ scene: i + 1, dialogue: s.dialogue, outfit_check: s.outfitOk === false ? `SAI áo: ${s.outfitSeen}` : s.outfitOk ? 'đúng' : 'chưa kiểm', text_check: s.textSeen ? `CÓ CHỮ: ${s.textSeen}` : 'không thấy chữ' })),
        outfit_expected: job.outfit?.text || job.input.character || '',
      }),
      images: frames,
      effort: 'medium',
    });
    const b = { ...r.data, score: Math.max(0, Math.min(100, Number(r.data.score) || 0)), at: new Date().toISOString() };
    job.boss = b;
    J.log(job, `Boss Grok: ${b.verdict} (${b.score}/100) — ${b.reason}`);
    J.save(job);
    return b;
  } finally {
    for (const f of frames) fs.rmSync(f, { force: true });
  }
}

// ---------- Trạng thái + lịch báo cáo hằng ngày ----------
export function view() {
  const d = read();
  return { daily: d.daily, dailyAt: d.dailyAt, lastReportAt: d.lastReportAt || null, lastError: d.lastError || null, reporting: Boolean(reporting), chatting, reports: d.reports.slice(0, 10), chat: d.chat.slice(-40) };
}
export function saveSettings({ daily, dailyAt } = {}) {
  const d = read();
  if (daily != null) d.daily = Boolean(daily);
  if (typeof dailyAt === 'string' && /^\d{1,2}:\d{2}$/.test(dailyAt)) d.dailyAt = dailyAt;
  write(d);
  return view();
}
export function startLoop() {
  AP.setBossReviewer(reviewVideo);
  setInterval(() => {
    const d = read();
    if (!d.daily || reporting) return;
    const [h, m] = d.dailyAt.split(':').map(Number);
    const vn = new Date(Date.now() + VN);
    const due = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), h, m) - VN;
    if (Date.now() >= due && (!d.lastReportAt || Date.parse(d.lastReportAt) < due) && (!d.lastErrorAt || Date.now() - Date.parse(d.lastErrorAt) > 3600 * 1000)) {
      supervise().catch(() => {});
    }
  }, 10 * 60 * 1000);
}
