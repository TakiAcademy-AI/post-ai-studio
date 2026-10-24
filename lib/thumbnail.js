// Ảnh bìa (thumbnail) cho Reel: khung hình đầu video (không phụ đề) + câu hook chữ lớn cùng kiểu Việt sub
// (chữ đứng đậm IN HOA, trắng viền đen, cụm cuối màu vàng), đặt trong vùng giữa để lưới Page cắt vuông vẫn thấy.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { run, tail } from './proc.js';

const FONTS = process.env.SUB_FONTS_DIR || '/usr/share/fonts/truetype/noto';
const FONT = 'Noto Sans ExtraCondensed Black';

/** Tách câu thành 2–3 dòng ≤ 14 ký tự; cụm cuối tô vàng. */
function layout(text) {
  const words = text.replace(/[#"“”]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().split(' ').filter(Boolean).slice(0, 9);
  // chia đều độ dài các dòng (tránh dòng cuối trơ 1 chữ)
  const total = words.join(' ').length;
  const n = Math.min(3, Math.max(1, Math.ceil(total / 15)));
  const target = total / n;
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && lines.length < n - 1 && Math.abs(next.length - target) > Math.abs(cur.length - target)) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function fallbackText(job) {
  const first = String(job.caption || job.scenes?.[0]?.dialogue || job.input?.topic || '').split(/[.!?\n]/)[0];
  return first.split(/\s+/).slice(0, 9).join(' ');
}

/** video: file video KHÔNG phụ đề; out: .jpg 1080×1920. */
export async function makeThumbnail({ video, text, out, at = 1.2 }) {
  const dir = path.dirname(out);
  const frame = path.join(dir, 'thumb-frame.png');
  const r1 = await run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', video, '-frames:v', '1', '-vf', 'scale=1080:1920', frame]);
  if (r1.code !== 0 || !fs.existsSync(frame)) throw new Error(`Cắt khung ảnh bìa lỗi: ${tail(r1.stderr, 300)}`);
  const lines = layout(text || '');
  if (!lines.length) { fs.renameSync(frame, out.replace(/\.jpg$/, '.png')); return out.replace(/\.jpg$/, '.png'); }
  const YELLOW = '&H0000E6FF&';
  const WHITE = '&H00FFFFFF&';
  const body = lines.map((l, i) => (i === lines.length - 1 && lines.length > 1 ? `{\\c${YELLOW}}${l}{\\c${WHITE}}` : l)).join('\\N');
  const ass = path.join(dir, 'thumb.ass');
  fs.writeFileSync(ass, `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: T,${FONT},150,${WHITE},${WHITE},&H00000000&,&H99000000&,0,0,0,0,100,100,0,0,1,9,5,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,T,,0,0,0,,{\\pos(540,1230)}${body}
`);
  const esc = (p) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const r2 = await run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', frame, '-vf', `ass=${esc(ass)}:fontsdir=${esc(FONTS)}`, '-frames:v', '1', '-q:v', '2', out]);
  fs.rmSync(frame, { force: true });
  if (r2.code !== 0) throw new Error(`Vẽ chữ ảnh bìa lỗi: ${tail(r2.stderr, 300)}`);
  return out;
}
