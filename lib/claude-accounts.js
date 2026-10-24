// Nhiều tài khoản Claude cho phần viết kịch bản (claude -p).
// Mỗi tài khoản thêm từ web có thư mục cấu hình riêng (CLAUDE_CONFIG_DIR = data/claude/<id>), nên đăng nhập/đăng xuất
// không đụng tới tài khoản mặc định của máy (~/.claude) — tài khoản đó còn dùng cho Claude Code.
//
// Đăng nhập: `claude auth login --claudeai` in ra link → người dùng đăng nhập trên trình duyệt, nhận mã → dán vào web
// → web ghi mã vào stdin của tiến trình đang chờ.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { resolveCmd } from './platform.js';
import { run, tail } from './proc.js';

const baseDir = () => path.join(config.dataDir, 'claude');
const storeFile = () => path.join(config.dataDir, 'claude-accounts.json');
const DEFAULT = 'default';

function read() {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { return { active: DEFAULT, accounts: [] }; }
}
function write(d) {
  fs.writeFileSync(storeFile(), JSON.stringify(d, null, 2), { mode: 0o600 });
}

/** Biến môi trường cho claude -p theo tài khoản đang chọn. */
export function envForActive() {
  const d = read();
  const acc = d.accounts.find((a) => a.id === d.active);
  return acc ? { CLAUDE_CONFIG_DIR: acc.dir } : {};
}

export function activeLabel() {
  const d = read();
  const acc = d.accounts.find((a) => a.id === d.active);
  return acc ? acc.email || acc.id : 'mặc định của máy';
}

async function authStatus(dir) {
  const res = await run(config.claudeBin, ['auth', 'status', '--json'], {
    env: dir ? { CLAUDE_CONFIG_DIR: dir } : {}, timeoutMs: 20000,
  });
  try { return JSON.parse(res.stdout); } catch { return { loggedIn: false, error: tail(res.stderr || res.stdout, 200) }; }
}

export async function list() {
  const d = read();
  const def = await authStatus(null);
  const out = [{
    id: DEFAULT, email: def.email || null, plan: def.subscriptionType || null, loggedIn: Boolean(def.loggedIn),
    builtin: true, active: d.active === DEFAULT,
  }];
  for (const a of d.accounts) {
    const st = await authStatus(a.dir);
    if (st.email && st.email !== a.email) { a.email = st.email; }
    out.push({ id: a.id, email: st.email || a.email, plan: st.subscriptionType || a.plan, loggedIn: Boolean(st.loggedIn), builtin: false, active: d.active === a.id });
  }
  write(d);
  return out;
}

export function setActive(id) {
  const d = read();
  if (id !== DEFAULT && !d.accounts.some((a) => a.id === id)) throw new Error('Không có tài khoản này');
  d.active = id;
  write(d);
}

// ---------- đăng nhập ----------
const sessions = new Map(); // sid → { proc, dir, out, url, done, exitCode }

export function startLogin() {
  for (const [sid, s] of sessions) if (s.done) sessions.delete(sid);
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(baseDir(), id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // BROWSER=echo: không mở trình duyệt trên máy chạy server — link hiện trên web để người dùng tự mở.
  const { cmd, pre } = resolveCmd(config.claudeBin);
  const proc = spawn(cmd, [...pre, 'auth', 'login', '--claudeai'], {
    windowsHide: true,
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir, BROWSER: 'echo' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const s = { id, proc, dir, out: '', url: null, done: false, exitCode: null };
  const onData = (d) => {
    s.out += d;
    const m = s.out.match(/https:\/\/\S+oauth\/authorize\S+/);
    if (m) s.url = m[0];
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', (code) => { s.done = true; s.exitCode = code; });
  // Bỏ phiên treo sau 15 phút.
  setTimeout(() => { if (!s.done) { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); } }, 15 * 60 * 1000).unref();
  sessions.set(id, s);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (s.url) return resolve({ sessionId: id, url: s.url });
      if (s.done || Date.now() - t0 > 20000) {
        proc.kill();
        return reject(new Error(`Không lấy được link đăng nhập: ${tail(s.out, 300)}`));
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

export async function submitCode(sessionId, code) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error('Phiên đăng nhập đã hết hạn — bấm "Thêm tài khoản" lại');
  if (s.done) throw new Error('Phiên đăng nhập đã kết thúc — bấm "Thêm tài khoản" lại');
  const clean = String(code || '').trim();
  if (!clean) throw new Error('Chưa dán mã');
  s.proc.stdin.write(clean + '\n');
  // Đợi CLI đổi mã lấy token và thoát.
  const t0 = Date.now();
  while (!s.done && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 300));
  if (!s.done) { s.proc.kill(); throw new Error('Quá thời gian chờ đăng nhập'); }
  const st = await authStatus(s.dir);
  if (!st.loggedIn) {
    sessions.delete(sessionId);
    fs.rmSync(s.dir, { recursive: true, force: true });
    // Chỉ lấy dòng báo lỗi cuối (bỏ link đăng nhập dài ở đầu output).
    const why = s.out.split(/>\s*|\n/).map((x) => x.trim()).filter(Boolean).pop() || 'mã sai hoặc đã hết hạn';
    throw new Error(`Đăng nhập không thành công: ${why.slice(0, 200)}. Mã có thể sai hoặc đã dùng — bấm "Thêm tài khoản" để lấy link mới.`);
  }
  const d = read();
  // Cùng email đã có → thay thư mục cũ bằng phiên mới.
  const old = d.accounts.find((a) => a.email && a.email === st.email);
  if (old) {
    fs.rmSync(old.dir, { recursive: true, force: true });
    d.accounts = d.accounts.filter((a) => a !== old);
    if (d.active === old.id) d.active = s.id;
  }
  d.accounts.push({ id: s.id, dir: s.dir, email: st.email || null, plan: st.subscriptionType || null, addedAt: new Date().toISOString() });
  d.active = s.id;
  write(d);
  sessions.delete(sessionId);
  return { email: st.email, plan: st.subscriptionType };
}

export function cancelLogin(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (!s.done) s.proc.kill();
  // Chỉ xoá thư mục nếu chưa thành tài khoản đã lưu.
  if (!read().accounts.some((a) => a.id === s.id)) fs.rmSync(s.dir, { recursive: true, force: true });
  sessions.delete(sessionId);
}

export async function logout(id) {
  if (id === DEFAULT) throw new Error('Không đăng xuất tài khoản mặc định của máy từ web (nó còn dùng cho Claude Code)');
  const d = read();
  const a = d.accounts.find((x) => x.id === id);
  if (!a) throw new Error('Không có tài khoản này');
  await run(config.claudeBin, ['auth', 'logout'], { env: { CLAUDE_CONFIG_DIR: a.dir }, timeoutMs: 20000 }).catch(() => {});
  fs.rmSync(a.dir, { recursive: true, force: true });
  d.accounts = d.accounts.filter((x) => x.id !== id);
  if (d.active === id) d.active = DEFAULT;
  write(d);
}
