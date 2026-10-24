// Việt sub kiểu karaoke (theo video chuẩn của người dùng): chữ lấy đúng từ lời thoại kịch bản, faster-whisper căn mốc từng từ
// (lib/subs.py), ffmpeg + libass vẽ lên video. Trả về file mới; video gốc không phụ đề vẫn giữ để ghép lại / tắt sub.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { run, tail } from './proc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.WHISPER_PYTHON || (fs.existsSync('/usr/bin/python3.12') ? '/usr/bin/python3.12' : 'python3');
const FONTS = process.env.SUB_FONTS_DIR || '/usr/share/fonts/truetype/noto';

/** input: video đã ghép; dialogues: lời thoại từng cảnh; out: file đích (cùng thư mục). */
export async function burnSubtitles({ input, dialogues, out }) {
  const dir = path.dirname(out);
  const dlg = path.join(dir, 'subs-dialogue.json');
  const ass = path.join(dir, 'subs.ass');
  fs.writeFileSync(dlg, JSON.stringify(dialogues || []));
  const r1 = await run(PY, [path.join(here, 'subs.py'), input, dlg, ass, process.env.WHISPER_MODEL || 'medium'], { timeoutMs: 15 * 60 * 1000 });
  if (r1.code !== 0) throw new Error(`Căn phụ đề (faster-whisper) lỗi: ${tail(r1.stderr, 400)}`);
  const stats = JSON.parse(r1.stdout.trim().split('\n').pop());
  const esc = (p) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const r2 = await run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', `ass=${esc(ass)}:fontsdir=${esc(FONTS)}`, '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out],
  { timeoutMs: 10 * 60 * 1000 });
  if (r2.code !== 0) throw new Error(`Vẽ phụ đề lỗi: ${tail(r2.stderr, 400)}`);
  return stats;
}
