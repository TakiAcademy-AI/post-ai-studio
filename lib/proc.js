import { spawn } from 'node:child_process';
import { resolveCmd } from './platform.js';

// Chạy một tiến trình con, gom stdout/stderr. Không dùng shell nên prompt dài/có dấu nháy vẫn an toàn.
export function run(bin, args, { input, cwd, env, timeoutMs = 0, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const { cmd, pre } = resolveCmd(bin); // Windows: claude/grok/… là .cmd/.exe
    const child = spawn(cmd, [...pre, ...args], { cwd, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (onLine) String(d).split('\n').filter(Boolean).forEach(onLine);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        const name = String(bin).split(/[\\/]/).pop();
        const hint = /ffmpeg|ffprobe/i.test(name) ? 'cài ffmpeg (Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg) hoặc đặt FFMPEG_BIN / FFPROBE_BIN trong .env'
          : /python|^py$/i.test(name) ? 'cài Python 3 + "pip install faster-whisper pillow", hoặc đặt WHISPER_PYTHON trong .env'
          : /claude/i.test(name) ? 'cài Claude Code CLI (npm i -g @anthropic-ai/claude-code) hoặc đặt CLAUDE_BIN trong .env'
          : /grok/i.test(name) ? 'cài Grok CLI (x.ai/cli) hoặc đặt GROK_BIN trong .env' : 'cài chương trình này hoặc thêm vào PATH';
        return reject(new Error(`Không tìm thấy lệnh "${name}" — ${hint}`));
      }
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function tail(text, n = 1500) {
  const s = String(text || '').trim();
  return s.length > n ? '…' + s.slice(-n) : s;
}
