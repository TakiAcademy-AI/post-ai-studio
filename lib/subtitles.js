// Việt sub kiểu karaoke (theo video chuẩn của người dùng): chữ lấy đúng từ lời thoại kịch bản, faster-whisper căn mốc từng từ
// (lib/subs.py), ffmpeg + libass vẽ lên video. Trả về file mới; video gốc không phụ đề vẫn giữ để ghép lại / tắt sub.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { run, tail } from './proc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
import { pythonCmd, FONTS_DIR, ffPath } from './platform.js';

/** input: video đã ghép; dialogues: lời thoại từng cảnh; out: file đích (cùng thư mục). */
export async function burnSubtitles({ input, dialogues, out }) {
  const dir = path.dirname(out);
  const dlg = path.join(dir, 'subs-dialogue.json');
  const ass = path.join(dir, 'subs.ass');
  fs.writeFileSync(dlg, JSON.stringify(dialogues || []));
  const py = pythonCmd();
  const r1 = await run(py.cmd, [...py.pre, path.join(here, 'subs.py'), input, dlg, ass, process.env.WHISPER_MODEL || 'medium'], { timeoutMs: 15 * 60 * 1000 });
  if (r1.code !== 0) throw new Error(`Căn phụ đề (faster-whisper) lỗi: ${tail(r1.stderr, 400)}`);
  const stats = JSON.parse(r1.stdout.trim().split('\n').pop());
  const r2 = await run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', `ass=${ffPath(ass)}:fontsdir=${ffPath(FONTS_DIR)}`, '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out],
  { timeoutMs: 10 * 60 * 1000 });
  if (r2.code !== 0) throw new Error(`Vẽ phụ đề lỗi: ${tail(r2.stderr, 400)}`);
  return stats;
}
