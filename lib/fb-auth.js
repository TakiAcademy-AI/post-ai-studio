// Facebook Login (OAuth qua popup) — làm theo Ads OS: code → token ngắn hạn → token dài hạn (~60 ngày)
// → token riêng của từng Page qua /me/accounts. Token Page chỉ lấy được ở bước này, bỏ lỡ là phải đăng nhập lại.
// Token lưu trên đĩa ở dạng mã hoá AES-256-GCM (data/facebook.json, quyền 600).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const GRAPH = 'https://graph.facebook.com';
const DIALOG = 'https://www.facebook.com';
const store = () => path.join(config.dataDir, 'facebook.json');

// Đăng Reel lên Page cần pages_manage_posts + pages_read_engagement; pages_show_list để /me/accounts không trả
// mảng rỗng; business_management để thấy cả Page nằm trong Business Manager.
export const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management'];

export function oauthReady() {
  return Boolean(config.fbAppId && config.fbAppSecret && config.encryptionKey);
}

// ---------- mã hoá ----------
function key() {
  if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey)) throw new Error('ENCRYPTION_KEY trong .env phải là 64 ký tự hex');
  return Buffer.from(config.encryptionKey, 'hex');
}
function enc(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
function dec(blob) {
  const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// ---------- lưu trữ ----------
function read() {
  try { return JSON.parse(fs.readFileSync(store(), 'utf8')); } catch { return null; }
}
function write(obj) {
  fs.writeFileSync(store(), JSON.stringify(obj, null, 2), { mode: 0o600 });
}

// ---------- OAuth ----------
export function redirectUri(origin) {
  return `${origin}/api/fb/callback`;
}

export function authorizeUrl(origin, state) {
  const u = new URL(`${DIALOG}/${config.fbGraphVersion}/dialog/oauth`);
  u.searchParams.set('client_id', config.fbAppId);
  u.searchParams.set('redirect_uri', redirectUri(origin));
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(','));
  return u.toString();
}

async function graphGet(pathname, params) {
  const u = new URL(`${GRAPH}/${config.fbGraphVersion}/${pathname}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  // Facebook có lúc trả 200 kèm error → kiểm json.error trước.
  if (json.error || !res.ok) throw new Error(json.error?.message || `Facebook trả HTTP ${res.status}`);
  return json;
}

async function fetchPages(userToken) {
  const out = [];
  let after = null;
  do {
    const params = { fields: 'id,name,access_token,tasks', limit: '100', access_token: userToken };
    if (after) params.after = after;
    const j = await graphGet('me/accounts', params);
    for (const p of j.data || []) out.push(p);
    after = j.paging?.next ? j.paging?.cursors?.after : null;
  } while (after && out.length < 500);
  return out;
}

export async function completeLogin(origin, code) {
  const short = await graphGet('oauth/access_token', {
    client_id: config.fbAppId, client_secret: config.fbAppSecret, redirect_uri: redirectUri(origin), code,
  });
  // Không đổi sang token dài hạn thì kết nối chết sau 1–2 giờ.
  const long = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: config.fbAppId, client_secret: config.fbAppSecret,
    fb_exchange_token: short.access_token,
  });
  const me = await graphGet('me', { fields: 'id,name', access_token: long.access_token });
  const pages = await fetchPages(long.access_token);
  const prev = read();
  const canPost = (p) => !p.tasks || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE');
  const data = {
    user: { id: me.id, name: me.name },
    userToken: enc(long.access_token),
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
    connectedAt: new Date().toISOString(),
    pages: pages.map((p) => ({ id: p.id, name: p.name, canPost: canPost(p), token: p.access_token ? enc(p.access_token) : null })),
    selectedPageId: null,
  };
  // Giữ Page đã chọn lần trước nếu vẫn còn quyền.
  const keep = prev?.selectedPageId && data.pages.find((p) => p.id === prev.selectedPageId && p.token);
  data.selectedPageId = keep ? keep.id : (data.pages.find((p) => p.token && p.canPost)?.id || null);
  write(data);
  return { user: data.user, pages: data.pages.length };
}

export function status() {
  const d = read();
  if (!d) return { connected: false };
  return {
    connected: true,
    user: d.user,
    expiresAt: d.expiresAt,
    connectedAt: d.connectedAt,
    selectedPageId: d.selectedPageId,
    pages: d.pages.map(({ id, name, canPost, token }) => ({ id, name, canPost, hasToken: Boolean(token) })),
  };
}

export function selectPage(pageId) {
  const d = read();
  if (!d) throw new Error('Chưa đăng nhập Facebook');
  const p = d.pages.find((x) => x.id === pageId);
  if (!p) throw new Error('Không có Page này trong tài khoản đã đăng nhập');
  if (!p.token) throw new Error('Không có token cho Page này — đăng nhập lại và cấp quyền cho Page');
  d.selectedPageId = pageId;
  write(d);
}

export function disconnect() {
  fs.rmSync(store(), { force: true });
}

/** Page + token để đăng bài. Ưu tiên Page đã chọn qua đăng nhập; không có thì dùng FB_PAGE_ID/FB_PAGE_TOKEN dán tay. */
export function pageCredentials() {
  const d = read();
  if (d?.selectedPageId) {
    const p = d.pages.find((x) => x.id === d.selectedPageId);
    if (p?.token) return { pageId: p.id, pageName: p.name, token: dec(p.token), source: 'login' };
  }
  if (config.fbPageId && config.fbPageToken) return { pageId: config.fbPageId, pageName: null, token: config.fbPageToken, source: 'env' };
  return null;
}

/** Trang nhỏ đóng popup và báo về cửa sổ cha — targetOrigin đúng origin của app, không dùng '*'. */
export function closePopupHtml(origin, payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>Facebook</title></head>
<body style="font:14px system-ui;padding:28px">
<p>${payload.ok ? 'Đã kết nối Facebook. Đang đóng cửa sổ…' : 'Kết nối thất bại: ' + String(payload.error || '').replace(/[<>&]/g, '')}</p>
<script>
  try { window.opener && window.opener.postMessage(${json}, ${JSON.stringify(origin)}); } catch (e) {}
  setTimeout(function(){ window.close(); }, ${payload.ok ? 500 : 4000});
</script></body></html>`;
}
