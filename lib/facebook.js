import fs from 'node:fs/promises';
import { config } from './config.js';
import { pageCredentials } from './fb-auth.js';

const graph = () => `https://graph.facebook.com/${config.fbGraphVersion}`;

// Facebook có lúc trả HTTP 200 kèm khối error → luôn kiểm json.error trước, không tin res.ok.
async function call(url, { method = 'GET', params = {}, headers, body, token } = {}) {
  let res;
  if (method === 'GET') {
    const q = new URLSearchParams({ ...params, access_token: token });
    res = await fetch(`${url}?${q}`);
  } else {
    res = await fetch(url, {
      method,
      headers: headers || { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body ?? new URLSearchParams({ ...params, access_token: token }),
    });
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (json.error || !res.ok) {
    const e = json.error || {};
    const msg = e.error_user_msg || e.message || text.slice(0, 300);
    throw new Error(`Facebook lỗi${e.code ? ` ${e.code}${e.error_subcode ? '/' + e.error_subcode : ''}` : ''}: ${msg}`);
  }
  return json;
}

export function fbConfigured() {
  return Boolean(pageCredentials());
}

function creds() {
  const c = pageCredentials();
  if (!c) throw new Error('Chưa chọn Page — bấm "Đăng nhập Facebook" rồi chọn Page (hoặc khai FB_PAGE_ID/FB_PAGE_TOKEN trong .env)');
  return c;
}

export async function checkPage() {
  const c = creds();
  return call(`${graph()}/${c.pageId}`, { params: { fields: 'id,name' }, token: c.token });
}

// Reels Publishing API: start → upload nhị phân lên rupload → finish với video_state = DRAFT (nháp) hoặc PUBLISHED.
export async function uploadReel({ file, description, state = 'DRAFT' }) {
  const c = creds();
  const reels = `${graph()}/${c.pageId}/video_reels`;

  const start = await call(reels, { method: 'POST', params: { upload_phase: 'start' }, token: c.token });
  const videoId = start.video_id;
  if (!videoId) throw new Error('Facebook không trả video_id ở bước start');

  const data = await fs.readFile(file);
  const up = await call(start.upload_url || `https://rupload.facebook.com/video-upload/${config.fbGraphVersion}/${videoId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${c.token}`,
      offset: '0',
      file_size: String(data.length),
    },
    body: data,
  });
  if (up.success === false) throw new Error('Upload video lên Facebook thất bại');

  const finish = await call(reels, {
    method: 'POST',
    params: { upload_phase: 'finish', video_id: videoId, video_state: state, description: description || '' },
    token: c.token,
  });
  if (finish.success === false) throw new Error('Facebook từ chối bước finish');
  return { videoId, pageId: c.pageId, pageName: c.pageName };
}

export async function videoStatus(videoId) {
  return call(`${graph()}/${videoId}`, { params: { fields: 'status,permalink_url,published' }, token: creds().token });
}
