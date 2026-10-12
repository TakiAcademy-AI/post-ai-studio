import fs from 'node:fs/promises';
import { config } from './config.js';
import { run, tail } from './proc.js';

const EXIT_HINTS = {
  37: 'Hết credit Flow cho model này — thử hạ xuống veo-lite hoặc nạp thêm credit.',
  28: 'Không mở được giao diện Flow classic (không tốn credit). Kiểm tra lại đăng nhập: gflow auth status.',
};

// Lấy object JSON cuối cùng trong stdout (gflow có thể in log trước khi in kết quả).
function parseJson(stdout) {
  const s = stdout.trim();
  try { return JSON.parse(s); } catch { /* thử tách */ }
  const i = s.lastIndexOf('\n{');
  for (const start of [i >= 0 ? i + 1 : -1, s.indexOf('{')]) {
    if (start < 0) continue;
    try { return JSON.parse(s.slice(start)); } catch { /* tiếp */ }
  }
  return null;
}

/**
 * Tạo 1 cảnh.
 *  mode 'r2v': ảnh nhân vật làm reference (cảnh 1 có ảnh)
 *  mode 't2v': chỉ có chữ (cảnh 1 không ảnh)
 *  mode 'i2v': khung đầu = khung cuối cảnh trước
 * Không truyền --duration: account hiện tại không có ô chọn độ dài → bị từ chối.
 */
export async function generateClip({ mode, prompt, image, model, output, onLine }) {
  const common = ['--aspect', '9:16', '--model', model || config.gflowModel, '-o', output, '--json'];
  if (config.gflowProfile) common.push('--profile', config.gflowProfile);

  let args;
  if (mode === 'r2v') args = ['video', 'r2v', prompt, '--ref', image, ...common];
  else if (mode === 'i2v') args = ['video', 'i2v', '--initial-frame', image, prompt, ...common];
  else args = ['video', 't2v', prompt, ...common];

  const res = await run(config.gflowBin, args, { timeoutMs: 20 * 60 * 1000, onLine });
  const json = parseJson(res.stdout);

  if (res.code !== 0 || !json || json.status !== 'ok') {
    const reason = json?.failure_reasons?.join(', ') || json?.error_message || json?.error || '';
    const hint = EXIT_HINTS[res.code] || '';
    throw new Error(
      [`gflow ${mode} lỗi (exit ${res.code ?? res.signal})`, reason, hint, tail(res.stderr, 600)]
        .filter(Boolean).join(' — '),
    );
  }
  const file = json.local_path || output;
  await fs.access(file);
  if (file !== output) await fs.copyFile(file, output);
  return { mediaId: json.media_id };
}
