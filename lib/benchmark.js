// Video chuẩn: video viral của chính người dùng làm TIÊU CHUẨN cho Tự nuôi kênh.
// Thêm link (Reel Facebook / video công khai) → Chrome Facebook mở trang (chỉ đọc), ghi lại đúng video đang phát (captureStream,
// có tiếng) → faster-whisper chép lời có mốc thời gian → ffmpeg cắt khung hình → Claude rút "chuẩn": hook, cấu trúc, nhịp,
// thủ pháp, giọng, hình ảnh, phụ đề, vì sao viral, quy tắc viết. Kênh chọn video chuẩn → brief kịch bản, nghĩ chủ đề và Boss duyệt
// đều bám theo hình thức đó (chủ đề vẫn theo định vị kênh).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { run, tail } from './proc.js';
import * as FB from './fb-chrome.js';
import { analyzeBenchmark } from './llm.js';

const file = () => path.join(config.dataDir, 'benchmarks.json');
const dirOf = (id) => path.join(config.dataDir, 'benchmarks', id);
function read() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return { items: [] }; } }
function write(d) { fs.writeFileSync(file(), JSON.stringify(d, null, 1)); }
function mutate(fn) { const d = read(); const r = fn(d); write(d); return r; }
const PY = process.env.WHISPER_PYTHON || (fs.existsSync('/usr/bin/python3.12') ? '/usr/bin/python3.12' : 'python3');
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'medium';

export function list() { return read().items; }
export function get(id) { return read().items.find((x) => x.id === id) || null; }

/** Ghi lại video đang phát trên trang (kèm tiếng) + đọc caption / số tương tác hiển thị. */
async function record(url, out) {
  await FB.ensure();
  const b = await FB.connect();
  const page = await b.contexts()[0].newPage();
  try {
    await page.setViewportSize({ width: 1200, height: 1000 });
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {
      await page.waitForTimeout(5000);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForTimeout(6000);
    await page.keyboard.press('Escape').catch(() => {});
    const info = await page.evaluate(() => {
      const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientHeight - a.clientHeight)[0];
      const meta = (n) => document.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content || '';
      return { duration: v?.duration || null, w: v?.videoWidth, h: v?.videoHeight, title: document.title, desc: meta('og:description'), body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 2500) };
    });
    if (!info.duration || !Number.isFinite(info.duration)) throw new Error('Trang không có video phát được (cần đăng nhập Chrome Facebook / link công khai)');
    if (info.duration > 180) throw new Error('Video dài quá 3 phút — chọn video ngắn (Reel)');
    const b64 = await page.evaluate(async () => {
      const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientHeight - a.clientHeight)[0];
      v.pause(); v.currentTime = 0; v.loop = false; v.muted = false; v.volume = 1;
      const rec = new MediaRecorder(v.captureStream(), { mimeType: 'video/webm;codecs=vp9,opus' });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((r) => { rec.onstop = r; });
      rec.start(1000);
      await v.play();
      await new Promise((r) => { v.onended = r; setTimeout(r, (v.duration + 2) * 1000); });
      rec.stop(); await done;
      const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    });
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    return info;
  } finally {
    await page.close().catch(() => {});
    await b.close().catch(() => {});
  }
}

async function transcribe(media) {
  const code = [
    'import sys, json, os',
    "sys.path.insert(0, os.path.expanduser('~/.local/lib/python3.12/site-packages'))",
    'from faster_whisper import WhisperModel',
    `m = WhisperModel(${JSON.stringify(WHISPER_MODEL)}, device='cpu', compute_type='int8')`,
    "segs, _ = m.transcribe(sys.argv[1], language='vi')",
    "print(json.dumps([{'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()} for s in segs], ensure_ascii=False))",
  ].join('\n');
  const res = await run(PY, ['-c', code, media], { timeoutMs: 15 * 60 * 1000 });
  if (res.code !== 0) throw new Error(`Chép lời (faster-whisper) lỗi: ${tail(res.stderr, 400)}`);
  return JSON.parse(res.stdout.trim().split('\n').pop());
}

const stats = (body) => {
  // Facebook Reel: "… caption … 67,6K 3,6K 4,6K …" (thích, bình luận, chia sẻ) ngay sau caption.
  const m = /(\d[\d.,]*\s*[KkMTr]*)\s+(\d[\d.,]*\s*[KkMTr]*)\s+(\d[\d.,]*\s*[KkMTr]*)/.exec(body || '');
  return m ? { likes: m[1], comments: m[2], shares: m[3] } : null;
};

let working = null;
export function status() { return { working }; }

/** Thêm video chuẩn: ghi → chép lời → khung hình → phân tích. Chạy nền, trả ngay bản ghi. */
export function add({ url, note = '' } = {}) {
  const u = String(url || '').trim();
  if (!/^https?:\/\/\S+$/.test(u)) throw new Error('Link video chưa đúng');
  if (working) throw new Error(`Đang xử lý video chuẩn khác (${working})`);
  const item = mutate((d) => {
    if (d.items.some((x) => x.url === u)) throw new Error('Video này đã có trong danh sách video chuẩn');
    const it = { id: crypto.randomBytes(4).toString('hex'), url: u, note: String(note).slice(0, 500), status: 'đang xử lý', step: 'mở video', createdAt: new Date().toISOString() };
    d.items.unshift(it);
    return it;
  });
  processItem(item.id).catch(() => {});
  return item;
}

function set(id, patch) { mutate((d) => { const x = d.items.find((i) => i.id === id); if (x) Object.assign(x, patch); }); }

async function processItem(id) {
  const it = get(id);
  working = it.url;
  const dir = dirOf(id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    set(id, { step: 'ghi lại video (chạy đúng thời lượng video)' });
    const media = path.join(dir, 'video.webm');
    const info = await record(it.url, media);
    set(id, { step: 'chép lời (faster-whisper)', duration: Math.round(info.duration * 10) / 10, size: `${info.w}x${info.h}`, pageText: info.body.slice(0, 1500), stats: stats(info.body) });
    const transcript = await transcribe(media);
    set(id, { step: 'cắt khung hình', transcript });
    const frames = [];
    const n = Math.min(8, Math.max(4, Math.round(info.duration / 3)));
    for (let k = 0; k < n; k++) {
      const f = path.join(dir, `f${k + 1}.jpg`);
      const t = Math.min(info.duration - 0.2, (info.duration * (k + 0.5)) / n);
      const r = await run(config.ffmpeg, ['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', media, '-frames:v', '1', '-vf', 'scale=480:-1', f]);
      if (r.code === 0 && fs.existsSync(f)) frames.push(f);
    }
    set(id, { step: 'Claude rút tiêu chuẩn' });
    const a = await analyzeBenchmark({ url: it.url, note: it.note, duration: info.duration, pageText: info.body.slice(0, 1500), transcript, frames });
    set(id, { analysis: a, status: 'xong', step: null, error: null, doneAt: new Date().toISOString() });
  } catch (e) {
    set(id, { status: 'lỗi', step: null, error: e.message.slice(0, 400) });
  } finally {
    working = null;
  }
}

export function retry(id) {
  if (working) throw new Error('Đang xử lý video chuẩn khác');
  if (!get(id)) throw new Error('Không thấy video chuẩn');
  set(id, { status: 'đang xử lý', step: 'mở video', error: null });
  processItem(id).catch(() => {});
  return get(id);
}
export function remove(id) {
  mutate((d) => { d.items = d.items.filter((x) => x.id !== id); });
  fs.rmSync(dirOf(id), { recursive: true, force: true });
  return { ok: true };
}

/** Đoạn "tiêu chuẩn" đưa vào brief / nghĩ chủ đề / Boss duyệt. */
export function briefFor(id) {
  const it = id && get(id);
  if (!it?.analysis) return '';
  const a = it.analysis;
  const lines = it.transcript.map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}s] ${s.text}`).join('\n');
  return [
    `VIDEO CHUẨN (video viral thật của chính người dùng, ${Math.round(it.duration)} giây${it.stats ? `, ${it.stats.likes} thích · ${it.stats.comments} bình luận · ${it.stats.shares} chia sẻ` : ''}) — LÀM THEO HÌNH THỨC, KHÔNG CHÉP NỘI DUNG:`,
    `Vì sao viral: ${a.whyViral}`,
    `Hook: ${a.hookPattern}`,
    `Cấu trúc: ${a.structure.join(' → ')}`,
    `Nhịp: ${a.pacing}`,
    `Thủ pháp: ${a.devices.join('; ')}`,
    `Giọng: ${a.tone}`,
    `QUY TẮC VIẾT: ${a.rules.map((r, i) => `(${i + 1}) ${r}`).join(' ')}`,
    'LƯU Ý: chỗ nào quy tắc / ví dụ nhắc tới nhóm khán giả, giới tính hay chủ đề cụ thể của video chuẩn (vd phụ nữ, đàn ông, hôn nhân) thì đó chỉ là ví dụ — thay bằng đúng nhóm khán giả và ngách của kênh này; giữ nguyên CÔNG THỨC (hook khẳng định, đối lập, nói quá, dẫn câu quen thuộc, chơi chữ lật nghĩa, câu chốt). Không thêm phụ đề / chữ vào prompt video.',
    `TRÁNH: ${a.avoid.join('; ')}`,
    `Lời thoại video chuẩn (chỉ để cảm nhịp và giọng, không chép):\n${lines}`,
  ].join('\n');
}
