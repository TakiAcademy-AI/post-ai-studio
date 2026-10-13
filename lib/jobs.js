import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const md5 = async (file) => crypto.createHash('md5').update(await fsp.readFile(file)).digest('hex');
import { config } from './config.js';
import { generateScript, compressPrompts, PROMPT_LIMIT } from './llm.js';
import { lastFrame, stitch, probe, startFrameDiff } from './media.js';
import { uploadReel, videoStatus } from './facebook.js';
import { addPost, checkScheduleTime, importLegacy } from './posts.js';
import { parseOverlays, sanitize as sanitizeOverlays } from './overlays.js';
import { isVoice } from './voices.js';
import { generateScene, loadImages, FLOW_MODELS } from './flow-auto.js';

const jobs = new Map();
const jobsDir = path.join(config.dataDir, 'jobs');

export const jobDir = (id) => path.join(jobsDir, id);
const abs = (job, rel) => (rel ? path.join(jobDir(job.id), rel) : null);

function save(job) {
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2));
}

function log(job, msg) {
  job.log.push(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
}

export function loadAll() {
  fs.mkdirSync(jobsDir, { recursive: true });
  for (const id of fs.readdirSync(jobsDir)) {
    const f = path.join(jobsDir, id, 'job.json');
    if (!fs.existsSync(f)) continue;
    const job = JSON.parse(fs.readFileSync(f, 'utf8'));
    // Server tắt giữa chừng → đánh dấu các việc đang chạy là bị gián đoạn.
    if (job.busy) {
      job.busy = null;
      log(job, 'Server khởi động lại — tác vụ đang chạy bị gián đoạn.');
    }
    // Đang viết kịch bản dở mà server tắt → cho về trạng thái lỗi để hiện nút "Viết lại kịch bản".
    if (job.stage === 'scripting' && !job.script) job.stage = 'script_failed';
    if (job.mode === 'gflow') job.mode = 'manual'; // chế độ gflow-cli đã bỏ
    for (const s of job.scenes || []) {
      if (s.status === 'running' || s.status === 'queued') { s.status = s.clip ? 'done' : 'pending'; }
      if (s.clip && !s.md5) {
        try { s.md5 = crypto.createHash('md5').update(fs.readFileSync(path.join(jobsDir, id, s.clip))).digest('hex'); } catch { /* file mất */ }
      }
    }
    save(job);
    jobs.set(id, job);
    importLegacy(job);
  }
}

export const listJobs = () =>
  [...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ id, input, createdAt, busy, stage }) => ({ id, topic: input.topic, sceneCount: input.sceneCount, createdAt, busy, stage }));

export const getJob = (id) => jobs.get(id);

export async function createJob(input, refImagePath) {
  const id = new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + crypto.randomBytes(3).toString('hex');
  await fsp.mkdir(jobDir(id), { recursive: true });
  const job = {
    id,
    createdAt: new Date().toISOString(),
    input: { ...input, hasRefImage: Boolean(refImagePath) },
    refImage: null,
    // 'manual': extension điền, người bấm tạo · 'auto': Chrome Flow tự điền + tự bấm tạo
    mode: input.mode === 'auto' ? 'auto' : 'manual',
    flowModel: FLOW_MODELS.includes(input.flowModel) ? input.flowModel : 'Veo 3.1 - Fast',
    // 'identity': cảnh 2+ dùng Thành phần (ảnh nhân vật + khung cuối cảnh trước) → giữ mặt, nối kiểu match cut.
    // 'frames'  : cảnh 2+ dùng Khung hình (khung đầu = khung cuối cảnh trước) → nối liền, mặt dễ trôi.
    consistency: input.consistency === 'frames' || !refImagePath ? 'frames' : 'identity',
    voice: isVoice(input.voice) ? input.voice : null, // giọng Flow gắn vào mọi cảnh
    stage: 'scripting',
    busy: null,
    script: null,
    scenes: [],
    caption: '',
    final: null,
    facebook: null,
    log: [],
  };
  if (refImagePath) {
    job.refImage = 'ref.jpg';
    await fsp.rename(refImagePath, abs(job, 'ref.jpg'));
  }
  jobs.set(id, job);
  save(job);
  startScript(job);
  return job;
}

// Chữ của cảnh: có danh sách thì dùng; kịch bản cũ chỉ có onScreenText thì tự chuyển (lưu lại để sửa được).
export function sceneOverlays(job, i) {
  const s = job.scenes[i];
  if (!Array.isArray(s.overlays)) { s.overlays = parseOverlays(s.onScreenText, s.duration || 8); save(job); }
  return s.overlays;
}

export function textSettings(job) {
  return { enabled: job.text?.enabled !== false, style: job.text?.style || 'brand' };
}

export function consistencyOf(job) {
  if (!job.refImage) return 'frames';
  return job.consistency || 'identity';
}

// Cảnh i được tạo bằng chế độ nào trong Flow, kèm các ảnh cần đưa vào.
export function sceneRecipe(job, i) {
  // @me: mặt + giọng lấy từ hình đại diện "Tôi". KHÔNG đưa ảnh có mặt người (ảnh nhân vật, khung cuối cảnh trước):
  // Flow coi đó là ảnh người thật không có quyền → chặn "vi phạm chính sách… người nổi tiếng" (đo 2026-10-13).
  if (job.voice === 'me') return { mode: 'ingredients', images: [] };
  const prev = i > 0 ? job.scenes[i - 1] : null;
  const ref = job.refImage ? { file: job.refImage, name: `adsai-${job.id}-nhan-vat.jpg` } : null;
  if (i === 0) return ref ? { mode: 'ingredients', images: [ref] } : { mode: 'text', images: [] };
  const frame = prev?.lastFrame ? { file: prev.lastFrame, name: `adsai-${job.id}-canh${i + 1}-tu-canh${i}.jpg` } : null;
  if (consistencyOf(job) === 'identity' && ref) return { mode: 'ingredients', images: [ref, frame].filter(Boolean) };
  return { mode: 'frames', images: frame ? [frame] : [] };
}

function guard(job, what) {
  if (job.busy) throw new Error(`Job đang bận: ${job.busy}`);
  job.busy = what;
  job.error = null;
  save(job);
}

function done(job, err) {
  if (err) {
    job.error = err.message;
    log(job, `LỖI: ${err.message}`);
  }
  job.busy = null;
  save(job);
}

// ---------- ① Kịch bản ----------
export function startScript(job) {
  guard(job, 'Đang viết kịch bản');
  log(job, 'Claude đang viết kịch bản theo skill Video AI…');
  (async () => {
    try {
      const { script, costUsd, compressed } = await generateScript(
        { ...job.input, consistency: consistencyOf(job), voice: job.voice },
        { refImagePath: job.refImage && job.voice !== 'me' ? abs(job, job.refImage) : null },
      );
      if (compressed.length) log(job, `Đã tự rút gọn prompt cảnh ${compressed.join(', ')} cho vừa giới hạn ${PROMPT_LIMIT} ký tự của Flow.`);
      job.script = { summary: script.summary, continuityMap: script.continuityMap };
      job.caption = script.caption;
      job.scenes = script.scenes.map((s, i) => ({
        index: i,
        title: s.title,
        dialogue: s.dialogue,
        onScreenText: s.onScreenText,
        overlays: sanitizeOverlays(s.textOverlays),
        prompt: s.prompt,
        status: 'pending',
        clip: null,
        lastFrame: null,
        trimStart: 0,
        trimEnd: 0,
        stale: false,
        attempts: 0,
        error: null,
      }));
      job.stage = 'script_ready';
      job.final = null;
      log(job, `Xong kịch bản ${job.scenes.length} cảnh (~$${costUsd.toFixed(3)} quy đổi). Duyệt/sửa prompt rồi bấm tạo video.`);
      done(job);
    } catch (e) {
      job.stage = job.script ? job.stage : 'script_failed';
      done(job, e);
    }
  })();
}

export function updateScene(job, index, patch) {
  const s = job.scenes[index];
  if (!s) throw new Error('Không có cảnh này');
  if (s.status === 'running') throw new Error('Cảnh đang được tạo, chờ xong rồi sửa');
  for (const k of ['prompt', 'dialogue', 'onScreenText', 'title']) {
    if (typeof patch[k] === 'string') s[k] = patch[k];
  }
  for (const k of ['trimStart', 'trimEnd']) {
    if (patch[k] !== undefined) s[k] = Math.min(4, Math.max(0, Number(patch[k]) || 0));
  }
  if (Array.isArray(patch.overlays)) { s.overlays = sanitizeOverlays(patch.overlays, s.duration || 8); job.final = null; }
  save(job);
  return s;
}

export function startCompress(job, index) {
  const s = job.scenes[index];
  if (!s) throw new Error('Không có cảnh này');
  guard(job, `Đang rút gọn prompt cảnh ${index + 1}`);
  (async () => {
    try {
      const r = await compressPrompts([{ scene: index + 1, prompt: s.prompt }]);
      const p = r.prompts[0]?.prompt;
      if (p) {
        log(job, `Cảnh ${index + 1}: rút gọn prompt ${s.prompt.length} → ${p.length} ký tự.`);
        s.prompt = p;
      }
      done(job);
    } catch (e) {
      done(job, e);
    }
  })();
}

export function updateJob(job, patch) {
  if (typeof patch.caption === 'string') job.caption = patch.caption;
  if (patch.consistency === 'identity' || patch.consistency === 'frames') job.consistency = patch.consistency;
  if ('voice' in patch) job.voice = isVoice(patch.voice) ? patch.voice : null;
  if (patch.text && typeof patch.text === 'object') {
    job.text = { ...textSettings(job), ...('enabled' in patch.text ? { enabled: Boolean(patch.text.enabled) } : {}),
      ...(['brand', 'dark', 'light'].includes(patch.text.style) ? { style: patch.text.style } : {}) };
    job.final = null;
  }
  if (patch.flowModel && FLOW_MODELS.includes(patch.flowModel)) job.flowModel = patch.flowModel;
  if (patch.mode === 'manual' || patch.mode === 'auto') {
    job.mode = patch.mode;
    // Lỗi lần chạy tự động trước không còn liên quan khi chuyển sang tự bấm trong Flow.
    if (job.mode === 'manual') {
      job.error = null;
      for (const s of job.scenes) if (s.status === 'error') Object.assign(s, { status: s.clip ? 'done' : 'pending', error: null });
    }
  }
  save(job);
}

// ---------- ② Tạo video từng cảnh, tuần tự ----------
// Hàng đợi toàn cục: Flow chạy qua 1 Chrome profile nên chỉ tạo 1 clip mỗi lúc.
let queue = Promise.resolve();
const cancelled = new Set();

// ---------- ② (bán tự động) Nhận clip người dùng tự tạo trong Flow ----------
export async function attachClip(job, i, tmpPath, { force = false, allowBusy = false } = {}) {
  const s = job.scenes[i];
  try {
    if (!s) throw new Error('Không có cảnh này');
    if (job.busy && !allowBusy) throw new Error(`Job đang bận: ${job.busy}`);
    const info = await probe(tmpPath).catch(() => { throw new Error('File không phải video đọc được'); });
    if (!info.width || !info.height) throw new Error('File không có hình');
    // Chặn clip trùng y hệt clip đã có (vd. extension tải lại nhầm video cảnh trước).
    const hash = await md5(tmpPath);
    const dup = job.scenes.find((x, j) => j !== i && x.clip && x.md5 === hash);
    if (dup) throw new Error(`Clip này trùng y hệt clip cảnh ${dup.index + 1} — có vẻ tải nhầm video cũ, chưa gắn vào cảnh ${i + 1}`);
    // Cảnh 2+ được tạo từ khung cuối cảnh trước → khung đầu clip phải gần như trùng ảnh đó.
    const prev = job.scenes[i - 1];
    if (!force && prev?.lastFrame && sceneRecipe(job, i).mode === 'frames') {
      const d = await startFrameDiff(tmpPath, abs(job, prev.lastFrame));
      if (d > 25) {
        const e = new Error(`Khung đầu clip không khớp khung cuối cảnh ${i} (lệch ${d.toFixed(0)}/255) — có vẻ là video khác, chưa gắn vào cảnh ${i + 1}`);
        e.code = 'START_MISMATCH';
        throw e;
      }
    }

    s.attempts += 1;
    const base = `scene-${String(i + 1).padStart(2, '0')}-v${s.attempts}`;
    await fsp.rename(tmpPath, abs(job, `${base}.mp4`));
    await lastFrame(abs(job, `${base}.mp4`), abs(job, `${base}-last.jpg`));

    const replaced = Boolean(s.clip);
    Object.assign(s, {
      clip: `${base}.mp4`, lastFrame: `${base}-last.jpg`, duration: info.duration,
      status: 'done', stale: false, error: null, uploaded: true, md5: hash,
    });
    // Đổi clip giữa chừng → khung cuối đổi → các cảnh sau không còn nối khớp.
    if (replaced) for (let j = i + 1; j < job.scenes.length; j++) if (job.scenes[j].clip) job.scenes[j].stale = true;
    job.final = null;
    job.stage = job.scenes.every((x) => x.clip) ? 'clips_ready' : 'script_ready';

    const portrait = info.height > info.width;
    log(job, `Cảnh ${i + 1}: đã nhận clip tải lên (${info.width}x${info.height}, ${info.duration.toFixed(1)}s)${portrait ? '' : ' — CẢNH BÁO: không phải khung dọc 9:16'}.`);
    save(job);
    return s;
  } finally {
    await fsp.rm(tmpPath, { force: true });
  }
}

// ---------- Cầu nối với extension Chrome "Post AI → Flow" ----------
// Một cảnh "đang chờ" tại một thời điểm: web bấm "Gửi sang Flow", extension đọc, người bấm tạo trong Flow,
// tải 720p về ~/Downloads, extension báo đường dẫn file → web gắn vào cảnh rồi chuyển sang cảnh kế tiếp.
// Lưu ra đĩa để khởi động lại server không làm mất cảnh đang chờ.
const bridgeFile = path.join(config.dataDir, 'bridge.json');
let bridge = (() => { try { return JSON.parse(fs.readFileSync(bridgeFile, 'utf8')); } catch { return null; } })(); // { jobId, index, at }
function setBridge(b) {
  bridge = b;
  try { if (b) fs.writeFileSync(bridgeFile, JSON.stringify(b)); else fs.rmSync(bridgeFile, { force: true }); } catch { /* không quan trọng */ }
}

export function bridgeSend(job, index) {
  if (!job.scenes[index]) throw new Error('Không có cảnh này');
  if (index > 0 && !job.scenes[index - 1].lastFrame) throw new Error(`Cảnh ${index} chưa có video — làm cảnh trước nó trước`);
  setBridge({ jobId: job.id, index, at: new Date().toISOString() });
  log(job, `Cảnh ${index + 1}: đã gửi sang extension Flow — tab Flow tự điền, chờ bấm nút tạo.`);
  save(job);
  return bridge;
}

export function bridgeClear() { setBridge(null); }

export function bridgeEvent(level, text) {
  const job = bridge && jobs.get(bridge.jobId);
  if (!job) return;
  log(job, `Extension${level === 'err' ? ' LỖI' : ''} (cảnh ${bridge.index + 1}): ${text}`);
  save(job);
}

export function bridgeState() {
  if (!bridge) return { pending: null };
  const job = jobs.get(bridge.jobId);
  const s = job?.scenes[bridge.index];
  if (!s) { setBridge(null); return { pending: null }; }
  const i = bridge.index;
  const { mode, images } = sceneRecipe(job, i);
  return {
    pending: {
      jobId: job.id, index: i, total: job.scenes.length, topic: job.input.topic,
      title: s.title, prompt: s.prompt, mode,
      images: images.map((im) => ({ url: `/files/${job.id}/${im.file}`, name: im.name })),
      // Giọng chỉ gắn được ở chế độ Thành phần (Khung hình không có nút +).
      voice: mode !== 'frames' ? job.voice || null : null,
      at: bridge.at,
    },
  };
}

export async function bridgeClip(filePath, want = {}) {
  if (!bridge) throw new Error('Không có cảnh nào đang chờ — bấm "Gửi sang Flow" trên web trước');
  const job = jobs.get(bridge.jobId);
  if (!job) throw new Error('Job không còn');
  // Extension gửi kèm cảnh mà video này được tạo cho; lệch với cảnh đang chờ → không gắn bừa.
  if (want.jobId && (want.jobId !== bridge.jobId || Number(want.index) !== bridge.index)) {
    throw new Error(`Video này được tạo cho cảnh ${Number(want.index) + 1}, nhưng cảnh đang chờ là ${bridge.index + 1} — bỏ qua`);
  }
  const i = bridge.index;
  // attachClip xoá file tạm sau khi dùng → copy ra file tạm, giữ nguyên file trong ~/Downloads.
  const tmp = path.join(config.dataDir, 'uploads', `bridge-${Date.now()}.mp4`);
  await fsp.copyFile(filePath, tmp);
  const s = await attachClip(job, i, tmp);
  log(job, `Cảnh ${i + 1}: nhận từ extension (${path.basename(filePath)}).`);
  const next = i + 1 < job.scenes.length && !job.scenes[i + 1].clip ? i + 1 : null;
  setBridge(next != null ? { jobId: job.id, index: next, at: new Date().toISOString() } : null);
  save(job);
  return { scene: i, next, clip: s.clip };
}

// Bỏ clip của một cảnh (clip sai/hỏng). Các cảnh sau đã dựa trên khung cuối của nó → đánh dấu lệch nối.
export function removeClip(job, i) {
  const s = job.scenes[i];
  if (!s) throw new Error('Không có cảnh này');
  if (job.busy) throw new Error(`Job đang bận: ${job.busy}`);
  if (!s.clip) return s;
  Object.assign(s, { clip: null, lastFrame: null, md5: null, status: 'pending', stale: false, error: null });
  for (let j = i + 1; j < job.scenes.length; j++) if (job.scenes[j].clip) job.scenes[j].stale = true;
  job.final = null;
  job.stage = 'script_ready';
  if (bridge?.jobId === job.id && bridge.index > i) setBridge(null);
  log(job, `Cảnh ${i + 1}: đã bỏ clip.`);
  save(job);
  return s;
}

// ---------- ② (tự động hoàn toàn) Chrome Flow tự điền + tự bấm tạo từng cảnh ----------
export function startAutoFlow(job, { from = null } = {}) {
  if (!job.scenes.length) throw new Error('Chưa có kịch bản');
  const start = from != null ? Number(from) : job.scenes.findIndex((s) => !s.clip);
  if (start < 0) throw new Error('Các cảnh đều đã có video');
  if (start > 0 && !job.scenes[start - 1].lastFrame) throw new Error(`Cảnh ${start} chưa có video — làm cảnh trước nó trước`);
  const tooLong = job.scenes.slice(start).filter((s) => s.prompt.length > PROMPT_LIMIT).map((s) => s.index + 1);
  if (tooLong.length) throw new Error(`Prompt cảnh ${tooLong.join(', ')} dài quá ${PROMPT_LIMIT} ký tự — bấm "Rút gọn" trước`);
  guard(job, `Tự động tạo từ cảnh ${start + 1} trên Flow`);
  cancelled.delete(job.id);
  job.stage = 'generating';
  for (let i = start; i < job.scenes.length; i++) if (!job.scenes[i].clip || i === start) job.scenes[i].status = 'queued';
  save(job);

  queue = queue.then(async () => {
    try {
      for (let i = start; i < job.scenes.length; i++) {
        if (cancelled.has(job.id)) { log(job, 'Đã dừng theo yêu cầu.'); break; }
        if (job.scenes[i].clip && i !== start) continue;
        const s = job.scenes[i];
        s.status = 'running'; s.error = null; save(job);
        const { mode, images } = sceneRecipe(job, i);
        const pending = {
          mode, prompt: s.prompt, voice: mode !== 'frames' ? job.voice || null : null,
          images: await loadImages(images, jobDir(job.id)),
        };
        try {
          const file = await generateScene({
            job, pending, model: job.flowModel || 'Veo 3.1 - Fast',
            downloadDir: path.join(config.dataDir, 'uploads'),
            log: (m) => { log(job, `Cảnh ${i + 1}: ${m}`); save(job); },
            isCancelled: () => cancelled.has(job.id),
          });
          await attachClip(job, i, file, { allowBusy: true }); // tự kiểm trùng / khớp khung đầu như mọi đường khác
          log(job, `Cảnh ${i + 1}: xong, đã gắn clip.`);
        } catch (e) {
          s.status = s.clip ? 'done' : 'error';
          s.error = e.message;
          save(job);
          throw new Error(`Cảnh ${i + 1}: ${e.message}`);
        }
      }
      job.stage = job.scenes.every((x) => x.clip) ? 'clips_ready' : 'script_ready';
      if (job.stage === 'clips_ready') log(job, 'Đủ cảnh — bấm Ghép video (hoặc ghép ngay bên dưới).');
      done(job);
    } catch (e) {
      for (const x of job.scenes) if (x.status === 'queued' || x.status === 'running') x.status = x.clip ? 'done' : 'pending';
      job.stage = 'script_ready';
      done(job, e);
    }
  });
}

export function cancelGenerate(job) {
  cancelled.add(job.id);
  log(job, 'Sẽ dừng sau khi cảnh hiện tại tạo xong (cảnh đang chạy vẫn tốn credit).');
  save(job);
}

// ---------- ③ Ghép ----------
export function startStitch(job, { removeWatermark = true } = {}) {
  const missing = job.scenes.filter((s) => !s.clip).map((s) => s.index + 1);
  if (missing.length) throw new Error(`Còn cảnh chưa có video: ${missing.join(', ')}`);
  guard(job, 'Đang ghép video');
  log(job, `Đang ghép các cảnh (xoá watermark, 1080x1920${textSettings(job).enabled ? ', chèn chữ' : ''})…`);
  (async () => {
    try {
      const rel = `final-${Date.now()}.mp4`;
      const ts = textSettings(job);
      const { duration } = await stitch(
        job.scenes.map((s, i) => ({
          clip: abs(job, s.clip), trimStart: s.trimStart, trimEnd: s.trimEnd,
          overlays: ts.enabled ? sceneOverlays(job, i) : [],
        })),
        abs(job, rel),
        { removeWatermark, textStyle: ts.style, overlayDir: abs(job, 'overlays') },
      );
      job.final = { file: rel, duration, createdAt: new Date().toISOString() };
      job.stage = 'stitched';
      log(job, `Đã ghép xong: ${duration.toFixed(1)} giây.`);
      done(job);
    } catch (e) {
      done(job, e);
    }
  })();
}

// ---------- ④ Đăng nháp Facebook ----------
export function startFacebook(job, { mode = 'draft', scheduledAt = null } = {}) {
  if (mode === 'schedule') checkScheduleTime(Number(scheduledAt));
  const publish = mode === 'publish';
  if (!job.final) throw new Error('Chưa có video thành phẩm — bấm ghép trước');
  const d = job.final.duration;
  if (d < 3 || d > 90) throw new Error(`Reel phải dài 3–90 giây, video hiện ${d.toFixed(1)}s. Bớt cảnh hoặc cắt bớt đầu/cuối.`);
  const when = mode === 'schedule' ? new Date(Number(scheduledAt) * 1000).toLocaleString('vi-VN') : null;
  const kind = { publish: 'đăng công khai', schedule: `hẹn đăng lúc ${when}`, draft: 'đăng nháp' }[mode] || 'đăng nháp';
  guard(job, `Đang ${kind} Facebook`);
  log(job, `Đang tải video lên Facebook (${kind})…`);
  (async () => {
    try {
      const state = { publish: 'PUBLISHED', schedule: 'SCHEDULED' }[mode] || 'DRAFT';
      const r = await uploadReel({ file: abs(job, job.final.file), description: job.caption, state, scheduledAt: mode === 'schedule' ? Number(scheduledAt) : null });
      const postState = { PUBLISHED: 'published', SCHEDULED: 'scheduled', DRAFT: 'draft' }[state];
      const schedIso = mode === 'schedule' ? new Date(Number(scheduledAt) * 1000).toISOString() : null;
      job.facebook = { videoId: r.videoId, pageId: r.pageId, pageName: r.pageName, published: publish, state: postState, scheduledAt: schedIso, file: job.final.file, at: new Date().toISOString(), status: null };
      addPost({ id: r.videoId, jobId: job.id, topic: job.input.topic, pageId: r.pageId, pageName: r.pageName, state: postState, scheduledAt: schedIso, file: job.final.file, caption: (job.caption || '').slice(0, 200) });
      job.stage = { published: 'posted', scheduled: 'scheduled', draft: 'posted_draft' }[postState];
      log(job, {
        published: `Đã đăng Reel lên ${r.pageName || 'Page'}, video_id ${r.videoId}. Facebook xử lý vài phút rồi bài mới hiện.`,
        scheduled: `Đã hẹn đăng Reel lên ${r.pageName || 'Page'} lúc ${when}, video_id ${r.videoId}. Quản lý ở tab "Lịch đăng".`,
        draft: `Đã gửi nháp Reel lên ${r.pageName || 'Page'}, video_id ${r.videoId}.`,
      }[postState]);
      done(job);
    } catch (e) {
      done(job, e);
    }
  })();
}

export async function refreshFacebook(job) {
  if (!job.facebook?.videoId) throw new Error('Chưa đăng');
  job.facebook.status = await videoStatus(job.facebook.videoId, job.facebook.pageId);
  save(job);
  return job.facebook;
}
