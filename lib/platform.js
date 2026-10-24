// Khác biệt giữa Linux / macOS / Windows: đường dẫn Chrome, tìm lệnh trong PATH (Windows: .exe / .cmd), Python,
// đường dẫn file trong bộ lọc ffmpeg. Mọi chỗ gọi tiến trình con đi qua resolveCmd() để chạy được trên cả 3 hệ.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FONTS_DIR = process.env.SUB_FONTS_DIR || path.join(ROOT, 'assets', 'fonts'); // font kèm repo (Noto, OFL)

/** Thư mục dữ liệu Chrome của người dùng (nơi có "Local State" + các profile). */
export function chromeHome() {
  if (process.env.CHROME_USER_DATA) return process.env.CHROME_USER_DATA;
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(os.homedir(), '.config', 'google-chrome');
}

/** File chạy Google Chrome. */
export function chromeBin() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const c = IS_WIN
    ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : IS_MAC
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];
  return c.find((p) => fs.existsSync(p)) || c[0];
}

/** Tìm lệnh trong PATH (Windows thử thêm .exe/.cmd/.bat theo PATHEXT). */
export function which(name) {
  if (path.isAbsolute(name) || name.includes('/') || name.includes('\\')) return fs.existsSync(name) ? name : null;
  const exts = IS_WIN ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';').filter(Boolean)] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const e of exts) {
      const p = path.join(dir, name + e);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* không có */ }
    }
  }
  return null;
}

/**
 * Lệnh → { cmd, pre } để spawn KHÔNG qua shell (prompt dài / dấu nháy vẫn an toàn).
 * Windows: lệnh npm cài toàn cục là file .cmd (Node không cho spawn .cmd nếu không có shell) → đọc file .cmd lấy script .js
 * bên trong rồi chạy bằng node.
 */
const cache = new Map();
export function resolveCmd(bin) {
  if (!IS_WIN) return { cmd: bin, pre: [] };
  if (cache.has(bin)) return cache.get(bin);
  let r = { cmd: bin, pre: [] };
  const p = which(bin);
  if (p && /\.(cmd|bat)$/i.test(p)) {
    const txt = fs.readFileSync(p, 'utf8');
    const m = txt.match(/"%~?dp0%?\\?([^"]+\.(?:c?js|mjs))"/i) || txt.match(/%~?dp0%?\\([^\s"]+\.(?:c?js|mjs))/i);
    if (m) r = { cmd: process.execPath, pre: [path.join(path.dirname(p), m[1])] };
  } else if (p) r = { cmd: p, pre: [] };
  cache.set(bin, r);
  return r;
}

/** Python có faster-whisper / Pillow: WHISPER_PYTHON → (Linux) python3.12 hệ thống → python3 / py -3 (Windows). */
export function pythonCmd() {
  const env = process.env.WHISPER_PYTHON || process.env.PYTHON;
  if (env) return { cmd: env, pre: [] };
  if (IS_WIN) return which('py') ? { cmd: 'py', pre: ['-3'] } : { cmd: 'python', pre: [] };
  if (!IS_MAC && fs.existsSync('/usr/bin/python3.12')) return { cmd: '/usr/bin/python3.12', pre: [] };
  return { cmd: 'python3', pre: [] };
}

/** Đường dẫn file đặt trong bộ lọc ffmpeg (ass=…, fontsdir=…): dùng "/" và thoát ":" (ổ đĩa Windows "C:"). */
export function ffPath(p) {
  return `'${p.replace(/\\/g, '/').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\:')}'`;
}
