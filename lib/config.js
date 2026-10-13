import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Khoá mã hoá: ưu tiên ENCRYPTION_KEY trong .env; máy mới chưa có thì tự tạo 1 lần ở data/secret.key (quyền 600).
function loadKey() {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  const f = path.join(dataDir, 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch { /* chưa có */ }
  const k = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, k, { mode: 0o600 });
  return k;
}
const encryptionKey = loadKey();

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob) {
  const [iv, tag, data] = String(blob).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// Cài đặt nhập trên web (tab Tài khoản) — .env luôn được ưu tiên.
const settingsFile = path.join(dataDir, 'settings.json');
export function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; }
}
export function writeSettings(patch) {
  const s = { ...readSettings(), ...patch };
  for (const k of Object.keys(s)) if (s[k] == null) delete s[k];
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2), { mode: 0o600 });
}
function webSecret(name) {
  const v = readSettings()[name];
  if (!v) return '';
  try { return decrypt(v); } catch { return ''; }
}

export const config = {
  root,
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3200),
  dataDir,
  skillFile: path.resolve(root, process.env.SKILL_FILE || 'skill/SKILL.md'),

  claudeBin: process.env.CLAUDE_BIN || 'claude',
  claudeModel: process.env.CLAUDE_MODEL || '',

  gflowBin: process.env.GFLOW_BIN || '/home/taki/Downloads/gflow-cli/.venv/bin/gflow',
  gflowProfile: process.env.GFLOW_PROFILE || '',
  gflowModel: process.env.GFLOW_MODEL || 'veo-lite',
  gflowModels: ['veo-lite', 'veo-fast', 'veo-quality', 'omni-flash', 'veo-lite-lp'],

  ffmpeg: process.env.FFMPEG_BIN || 'ffmpeg',
  ffprobe: process.env.FFPROBE_BIN || 'ffprobe',

  // App Facebook: .env trước, không có thì lấy từ cài đặt nhập trên web.
  get fbAppId() { return process.env.FB_APP_ID || readSettings().fbAppId || ''; },
  get fbAppSecret() { return process.env.FB_APP_SECRET || webSecret('fbAppSecret'); },
  get fbAppSource() { return process.env.FB_APP_ID && process.env.FB_APP_SECRET ? 'env' : readSettings().fbAppId ? 'web' : null; },
  encryptionKey,
  fbPageId: process.env.FB_PAGE_ID || '',
  fbPageToken: process.env.FB_PAGE_TOKEN || '',
  fbGraphVersion: process.env.FB_GRAPH_VERSION || 'v23.0',
};
