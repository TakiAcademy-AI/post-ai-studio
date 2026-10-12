import { spawn } from 'node:child_process';

// Chạy một tiến trình con, gom stdout/stderr. Không dùng shell nên prompt dài/có dấu nháy vẫn an toàn.
export function run(bin, args, { input, cwd, env, timeoutMs = 0, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
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
