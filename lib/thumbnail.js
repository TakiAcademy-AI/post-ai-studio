// Ảnh bìa (thumbnail) cho Reel, kiểu ảnh bìa Reels Việt: khung hình đẹp nhất (Claude chọn trong 8 khung của video chưa phụ đề),
// cắt cận cho mặt to, nửa dưới tối dần, chữ hook rất to: dòng trên trắng viền đen, dòng cuối chữ đen trên nền vàng.
// Chữ nằm trong vùng giữa để lưới Page cắt vuông vẫn thấy.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { run, tail } from './proc.js';
import { pickThumbFrame } from './llm.js';

const FONTS = process.env.SUB_FONTS_DIR || '/usr/share/fonts/truetype/noto';
const FONT = 'Noto Sans Display Condensed Black';

/** Tách câu thành 1–3 dòng đều nhau (tránh dòng cuối trơ 1 chữ). */
function layout(text) {
  const words = text.replace(/[#"“”]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().split(' ').filter(Boolean).slice(0, 9);
  const total = words.join(' ').length;
  const n = Math.min(3, Math.max(1, Math.ceil(total / 13)));
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

const ff = (args) => run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const esc = (p) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");

async function probeDuration(video) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]);
  return Number(r.stdout.trim()) || 8;
}

/** video: file video KHÔNG phụ đề; out: .jpg 1080×1920. */
export async function makeThumbnail({ video, text, out, pick = true }) {
  const dir = path.dirname(out);
  const dur = await probeDuration(video);
  // 8 khung ứng viên (bỏ 0,6s đầu / cuối) → Claude chọn khung đẹp nhất
  const times = Array.from({ length: 8 }, (_, i) => 0.6 + ((dur - 1.2) * i) / 7);
  const cands = [];
  for (const [i, t] of times.entries()) {
    const f = path.join(dir, `thumb-cand-${i + 1}.jpg`);
    const r = await ff(['-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=360:-1', f]);
    if (r.code === 0 && fs.existsSync(f)) cands.push({ f, t });
  }
  if (!cands.length) throw new Error('Không cắt được khung hình cho ảnh bìa');
  let k = 0;
  if (pick && cands.length > 1) { try { k = await pickThumbFrame({ frames: cands.map((c) => c.f) }); } catch { k = 0; } }
  const at = cands[k].t;
  for (const c of cands) fs.rmSync(c.f, { force: true });

  const lines = layout(text || '');
  const ass = path.join(dir, 'thumb.ass');
  const YELLOW = '&H0000D7FF&'; // vàng đậm (255,215,0)
  const n = lines.length;
  const size = n >= 3 ? 150 : 172;
  const gap = size * 1.12;
  const lastY = 1560; // dòng cuối (nền vàng)
  const ev = lines.map((l, i) => {
    const y = Math.round(lastY - (n - 1 - i) * gap);
    const last = i === n - 1 && n > 1;
    return `Dialogue: 0,0:00:00.00,0:00:05.00,${last ? 'Box' : 'Top'},,0,0,0,,{\\pos(540,${y})}${l}`;
  }).join('\n');
  fs.writeFileSync(ass, `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Top,${FONT},${size},&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H80000000&,0,0,0,0,100,100,1,0,1,11,6,5,40,40,0,1
Style: Box,${FONT},${size},&H00101010&,&H00101010&,${YELLOW},&H00000000&,0,0,0,0,100,100,1,0,3,22,0,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev}
`);
  // cắt cận (phóng 1,22×, lệch lên trên giữ mặt) → nửa dưới tối dần (các dải mờ chồng nhau) → chữ
  // nửa dưới tối dần mượt (ảnh gradient tạo bằng geq rồi phủ lên — không lộ vạch)
  const grad = path.join(dir, 'thumb-grad.png');
  const rg = await ff(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1920,format=rgba', '-frames:v', '1', '-vf', "geq=r=0:g=0:b=0:a='if(lt(Y,900),0,min(190,pow((Y-900)/1020,1.4)*190))'", grad]);
  if (rg.code !== 0) throw new Error(`Tạo nền tối dần lỗi: ${tail(rg.stderr, 200)}`);
  const fc = `[0:v]scale=1318:2342,crop=1080:1920:119:150,eq=contrast=1.06:saturation=1.12[v];[v][1:v]overlay=0:0,ass=${esc(ass)}:fontsdir=${esc(FONTS)}`;
  const r = await ff(['-ss', at.toFixed(2), '-i', video, '-i', grad, '-frames:v', '1', '-filter_complex', fc, '-q:v', '2', out]);
  fs.rmSync(grad, { force: true });
  if (r.code !== 0) throw new Error(`Vẽ ảnh bìa lỗi: ${tail(r.stderr, 300)}`);
  return out;
}
