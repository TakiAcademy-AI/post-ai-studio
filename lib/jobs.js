import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const md5 = async (file) => crypto.createHash('md5').update(await fsp.readFile(file)).digest('hex');
import { config } from './config.js';
import { generateScript, compressPrompts, rewriteForPolicy, designOutfit, checkOutfit, PROMPT_LIMIT } from './llm.js';
import { lastFrame, stitch, probe, startFrameDiff, frameAt } from './media.js';
import { videoStatus, findRecentVideo } from './facebook.js';
import { postReel, browserPage } from './fb-browser.js';
import { pageCredentials } from './fb-auth.js';
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
    job.mode = 'auto'; // gflow-cli và bán tự động (extension) đã bỏ
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
    mode: 'auto', // Chrome Flow tự điền + tự bấm tạo (chế độ bán tự động bằng extension đã bỏ)
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
  return { enabled: job.text?.enabled === true, style: job.text?.style || 'brand' }; // chèn chữ chỉ khi người dùng bật
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
  if (patch.restorePrompt && s.promptOriginal) { s.prompt = s.promptOriginal; s.promptOriginal = null; s.policyRewrites = 0; }
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
  save(job);
}

// ---------- ② Tạo video từng cảnh, tuần tự ----------
// Hàng đợi toàn cục: Flow chạy qua 1 Chrome profile nên chỉ tạo 1 clip mỗi lúc.
let queue = Promise.resolve();
const cancelled = new Set();

// ---------- ② Gắn clip vào cảnh (Chrome Flow tải về, hoặc người dùng tự tải lên) ----------
export async function attachClip(job, i, tmpPath, { force = false, allowBusy = false } = {}) {
  const s = job.scenes[i];
  try {
    if (!s) throw new Error('Không có cảnh này');
    if (job.busy && !allowBusy) throw new Error(`Job đang bận: ${job.busy}`);
    const info = await probe(tmpPath).catch(() => { throw new Error('File không phải video đọc được'); });
    if (!info.width || !info.height) throw new Error('File không có hình');
    // Chặn clip trùng y hệt clip đã có (vd. tải nhầm lại video cảnh trước).
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
    // (@me không dùng khung cuối cảnh trước → thay clip không làm lệch các cảnh sau)
    if (replaced && job.voice !== 'me') for (let j = i + 1; j < job.scenes.length; j++) if (job.scenes[j].clip) job.scenes[j].stale = true;
    job.final = null;
    job.stage = job.scenes.every((x) => x.clip) ? 'clips_ready' : 'script_ready';

    const portrait = info.height > info.width;
    log(job, `Cảnh ${i + 1}: đã nhận clip tải lên (${info.width}x${info.height}, ${info.duration.toFixed(1)}s)${portrait ? '' : ' — CẢNH BÁO: không phải khung dọc 9:16'}.`);
    save(job);
    if (!job.busy) setImmediate(() => autoStitch(job)); // tải clip tay: đủ cảnh thì tự ghép
    return s;
  } finally {
    await fsp.rm(tmpPath, { force: true });
  }
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
        if (job.voice === 'me') await ensureOutfit(job).catch((e) => log(job, `Không phân tích được trang phục DNA (${e.message}) — bỏ qua khoá trang phục.`));
        const { mode, images } = sceneRecipe(job, i);
        const imgs = await loadImages(images, jobDir(job.id));
        let wrongSeen = '';
        try {
          // @me: tạo → kiểm tra áo → sai thì nhấn mạnh + tạo lại (tối đa OUTFIT_RETRIES lần).
          for (let attempt = 0; ; attempt++) {
            const note = job.voice === 'me' && job.outfit ? outfitNote(job, wrongSeen) : '';
            let body = s.prompt.replace(/^OUTFIT LOCK[\s\S]*?\n\n/, '');
            if (wrongSeen) { // lần tạo lại: nhắc trang phục ở cả CHARACTER LOCK và cuối prompt (Veo hay bỏ qua câu đầu)
              body = body.replace(/^(CHARACTER LOCK:.*)$/m, `$1 Exact outfit: ${job.outfit.text}.`)
                + `\n\nOUTFIT CHECK: in every frame the presenter wears ${job.outfit.text} — ${job.outfit.avoid}.`;
            }
            const prompt = await fitPrompt(note, body, s.dialogue, i);
            const pending = { mode, prompt, voice: mode !== 'frames' ? job.voice || null : null, images: imgs };
            const file = await generateScene({
              job, pending, model: job.flowModel || 'Veo 3.1 - Fast',
              downloadDir: path.join(config.dataDir, 'uploads'),
              log: (m) => { log(job, `Cảnh ${i + 1}: ${m}`); save(job); },
              isCancelled: () => cancelled.has(job.id),
              onPolicyBlock: (n, failText) => policyStep(job, i, n, failText),
            });
            await attachClip(job, i, file, { allowBusy: true }); // tự kiểm trùng / khớp khung đầu như mọi đường khác
            if (!(job.voice === 'me' && job.outfit)) break;
            const chk = await verifyOutfit(job, i).catch((e) => { log(job, `Cảnh ${i + 1}: không kiểm tra được áo (${e.message}).`); return null; });
            if (!chk || chk.match) { if (chk) log(job, `Cảnh ${i + 1}: áo đúng DNA ✓ (${chk.seen}).`); break; }
            s.outfitMismatch = chk.seen;
            if (attempt >= OUTFIT_RETRIES || cancelled.has(job.id)) { log(job, `Cảnh ${i + 1}: vẫn sai áo sau ${attempt + 1} lần (thấy: ${chk.seen}) — giữ clip này, bấm "↻ Tự tạo lại cảnh này" nếu muốn thử tiếp.`); break; }
            wrongSeen = chk.seen;
            log(job, `Cảnh ${i + 1}: áo SAI (thấy: ${chk.seen}) → nhấn mạnh trang phục và tạo lại (${attempt + 1}/${OUTFIT_RETRIES}).`);
            save(job);
          }
          log(job, `Cảnh ${i + 1}: xong, đã gắn clip.`);
        } catch (e) {
          s.status = s.clip ? 'done' : 'error';
          s.error = e.message;
          save(job);
          throw new Error(`Cảnh ${i + 1}: ${e.message}`);
        }
      }
      job.stage = job.scenes.every((x) => x.clip) ? 'clips_ready' : 'script_ready';
      done(job);
      autoStitch(job);
    } catch (e) {
      for (const x of job.scenes) if (x.status === 'queued' || x.status === 'running') x.status = x.clip ? 'done' : 'pending';
      job.stage = 'script_ready';
      done(job, e);
    }
  });
}

// ---------- Trang phục DNA (@me) ----------
// @me chiếm hết 3 suất ảnh tham chiếu của Flow → không gắn được ảnh trang phục; khoá bằng chữ (OUTFIT LOCK đầu prompt)
// và kiểm tra từng cảnh bằng Claude (xem 2 khung hình), sai thì nhấn mạnh + tạo lại.
const OUTFIT_RETRIES = 3;

async function ensureOutfit(job) {
  if (job.voice !== 'me' || job.outfit?.text) return job.outfit;
  const d = await designOutfit({ topic: job.input.topic, character: job.input.character, scenePrompts: job.scenes.map((x) => x.prompt) });
  job.outfit = { text: d.outfit, avoid: d.avoid };
  log(job, `Trang phục DNA: ${d.outfit} · tránh: ${d.avoid}`);
  save(job);
  return job.outfit;
}

function outfitNote(job, wrongSeen = '') {
  const o = job.outfit;
  return `OUTFIT LOCK (top priority, every frame of this scene): the presenter wears ${o.text}. ${o.avoid}. `
    + 'Ignore the clothes, prints and logos from the @me avatar\'s own recording.'
    + (wrongSeen ? ` A previous attempt was WRONG — it showed: ${wrongSeen}. Do NOT show that; show exactly the outfit above.` : '');
}

// Ghép câu khoá vào đầu prompt; quá 4000 ký tự (Flow cắt phần thừa) thì rút gọn phần prompt cho vừa, giữ nguyên lời thoại.
async function fitPrompt(note, body, dialogue, i) {
  if (!note) return body.slice(0, PROMPT_LIMIT);
  if (note.length + body.length + 2 > PROMPT_LIMIT - 20) {
    const c = await compressPrompts([{ scene: i + 1, prompt: body }], PROMPT_LIMIT - 40 - note.length).catch(() => null);
    if (c?.prompts[0]?.prompt && (!dialogue || c.prompts[0].prompt.includes(dialogue))) body = c.prompts[0].prompt;
  }
  return `${note}\n\n${body}`.slice(0, PROMPT_LIMIT);
}

async function verifyOutfit(job, i) {
  const s = job.scenes[i];
  const frames = [];
  for (const t of [2, Math.max(2.5, (s.duration || 8) - 1.5)]) {
    const f = abs(job, `check-${i + 1}-${Math.round(t * 10)}.jpg`);
    await frameAt(abs(job, s.clip), t, f);
    frames.push(f);
  }
  try {
    const r = await checkOutfit({ frames, outfit: `${job.outfit.text}. ${job.outfit.avoid}` });
    s.outfitOk = r.match; s.outfitSeen = r.seen;
    return r;
  } finally {
    for (const f of frames) await fsp.rm(f, { force: true });
  }
}

// Thang xử lý khi Flow chặn "người nổi tiếng" (mỗi lượt bị chặn Flow hoàn credit):
// 1 thử lại nguyên prompt · 2–4 Claude viết lại prompt, mỗi bậc né mạnh hơn · 5 thử lại bản tối giản · sau đó mới báo lỗi.
async function policyStep(job, i, n, failText) {
  const s = job.scenes[i];
  const say = (m) => { log(job, `Cảnh ${i + 1}: ${m}`); save(job); };
  if (cancelled.has(job.id)) return null;
  if (n === 1) { say('Flow chặn "người nổi tiếng" → thử lại nguyên prompt (bộ lọc có lúc chấm ngẫu nhiên).'); return {}; }
  if (n <= 4) {
    const level = n - 1;
    say(`Flow vẫn chặn → Claude tự viết lại prompt (bậc ${level}/3: ${['reframe, bỏ từ nhạy cảm', 'người nhỏ trong khung, góc nghiêng, tập trung tay + bối cảnh', 'bản ngắn tối giản'][level - 1]}), giữ nguyên lời thoại…`);
    try {
      const r = await rewriteForPolicy({ prompt: s.prompt, dialogue: s.dialogue, level, failText });
      if (!s.promptOriginal) s.promptOriginal = s.prompt;
      s.prompt = r.prompt;
      s.policyRewrites = level;
      say(`Đã viết lại prompt (${r.prompt.length} ký tự) — tạo lại.`);
      return { prompt: r.prompt };
    } catch (e) {
      say(`Không viết lại được prompt (${e.message}) — thử lại prompt hiện tại.`);
      return {};
    }
  }
  if (n === 5) { say('Vẫn bị chặn → thử thêm một lần bản tối giản.'); return {}; }
  return null; // hết bậc → báo lỗi, người dùng sửa prompt tay (prompt gốc lưu ở promptOriginal)
}

export function cancelGenerate(job) {
  cancelled.add(job.id);
  log(job, 'Sẽ dừng sau khi cảnh hiện tại tạo xong (cảnh đang chạy vẫn tốn credit).');
  save(job);
}

// ---------- ③ Ghép ----------
// Đủ video mọi cảnh thì tự ghép luôn (không ghép khi còn cảnh "lệch nối" — nên tạo lại cảnh đó trước).
function autoStitch(job) {
  if (job.busy || job.final || !job.scenes.length || !job.scenes.every((x) => x.clip)) return;
  const stale = job.scenes.filter((x) => x.stale).map((x) => x.index + 1);
  if (stale.length) { log(job, `Đủ cảnh nhưng cảnh ${stale.join(', ')} lệch nối — tạo lại rồi web tự ghép, hoặc bấm Ghép video.`); save(job); return; }
  log(job, 'Đủ cảnh — tự ghép video.');
  try { startStitch(job); } catch (e) { log(job, `Không tự ghép được: ${e.message}`); save(job); }
}

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
// Đăng qua Meta Business Suite trong Chrome Facebook (như người đăng tay), không qua Graph API.
export function startFacebook(job, { mode = 'draft', scheduledAt = null } = {}) {
  if (!['publish', 'schedule', 'draft'].includes(mode)) mode = 'draft';
  if (mode === 'schedule') checkScheduleTime(Number(scheduledAt));
  if (!job.final) throw new Error('Chưa có video thành phẩm — bấm ghép trước');
  const d = job.final.duration;
  if (d < 3 || d > 90) throw new Error(`Reel phải dài 3–90 giây, video hiện ${d.toFixed(1)}s. Bớt cảnh hoặc cắt bớt đầu/cuối.`);
  // Page chọn trong Chrome Facebook (không cần API); chưa chọn thì dùng Page của kết nối API (nếu có).
  const bp = browserPage();
  const oauth = bp ? null : pageCredentials();
  const pageId = bp?.id || oauth?.pageId;
  if (!pageId) throw new Error('Chưa chọn Page — tab Tài khoản → Chrome Facebook → "Page để đăng"');
  const pageName = bp?.name || oauth?.pageName || 'Page';
  let c = null; // token API của Page này (tuỳ chọn) — chỉ để dò lại video_id cho tab Lịch đăng
  try { c = pageCredentials(pageId); } catch { c = null; }
  const when = mode === 'schedule' ? new Date(Number(scheduledAt) * 1000).toLocaleString('vi-VN') : null;
  const kind = { publish: 'đăng công khai', schedule: `hẹn đăng lúc ${when}`, draft: 'lưu nháp' }[mode];
  guard(job, `Đang ${kind} qua trình duyệt`);
  log(job, `Đăng qua trình duyệt (Business Suite) lên ${pageName}: ${kind}…`);
  (async () => {
    const since = Math.floor(Date.now() / 1000);
    try {
      await postReel({
        pageId, file: abs(job, job.final.file), caption: job.caption || '', mode, scheduledAt: Number(scheduledAt) || null,
        log: (m) => { log(job, `Trình duyệt: ${m}`); save(job); },
      });
      const postState = { publish: 'published', schedule: 'scheduled', draft: 'draft' }[mode];
      const schedIso = mode === 'schedule' ? new Date(Number(scheduledAt) * 1000).toISOString() : null;
      // Tìm lại video trên Facebook để tab Lịch đăng quản lý được (đổi giờ, huỷ). Không tìm thấy vẫn coi là đã đăng.
      let v = null;
      if (c?.token) for (let k = 0; k < 6 && !v; k++) { await new Promise((r) => setTimeout(r, 5000)); v = await findRecentVideo(pageId, since, job.caption || '').catch(() => null); }
      const id = v?.id || `browser-${since}`;
      job.facebook = { videoId: v?.id || null, pageId, pageName, published: mode === 'publish', state: postState, scheduledAt: schedIso, file: job.final.file, at: new Date().toISOString(), status: null, via: 'browser' };
      addPost({ id, jobId: job.id, topic: job.input.topic, pageId, pageName, state: postState, scheduledAt: schedIso, file: job.final.file, caption: (job.caption || '').slice(0, 200), via: 'browser', permalink: v?.permalink_url || null });
      job.stage = { published: 'posted', scheduled: 'scheduled', draft: 'posted_draft' }[postState];
      log(job, `Xong (qua trình duyệt): ${kind} trên ${pageName}${v ? `, video_id ${v.id}` : ' — chưa dò được video_id qua API, xem trong Business Suite'}.`);
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
