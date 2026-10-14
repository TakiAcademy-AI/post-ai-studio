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

function creds(pageId = null) {
  if (pageId) return pageCredentials(pageId);
  const c = pageCredentials();
  if (!c) throw new Error('Chưa chọn Page — vào tab "Tài khoản" đăng nhập Facebook và chọn Page (hoặc khai FB_PAGE_ID/FB_PAGE_TOKEN trong .env)');
  return c;
}

export async function checkPage() {
  const c = creds();
  return call(`${graph()}/${c.pageId}`, { params: { fields: 'id,name' }, token: c.token });
}

export async function videoStatus(videoId, pageId = null) {
  return call(`${graph()}/${videoId}`, { params: { fields: 'status,permalink_url,published' }, token: creds(pageId).token });
}

export async function fbVideo(pageId, videoId) {
  return call(`${graph()}/${videoId}`, {
    params: { fields: 'status,published,scheduled_publish_time,permalink_url,created_time' }, token: creds(pageId).token,
  });
}

// Đổi giờ đăng của video đang hẹn/nháp. Tài liệu Reels không mô tả bước này — dùng cập nhật Video node chung của Graph API.
export async function rescheduleVideo(pageId, videoId, ts) {
  const r = await call(`${graph()}/${videoId}`, {
    method: 'POST', params: { scheduled_publish_time: String(ts), published: 'false' }, token: creds(pageId).token,
  });
  if (r.success === false) throw new Error('Facebook không cho đổi giờ — sửa trực tiếp trong Business Suite');
  return r;
}

export async function deleteVideo(pageId, videoId) {
  const r = await call(`${graph()}/${videoId}`, { method: 'DELETE', params: {}, token: creds(pageId).token });
  if (r.success === false) throw new Error('Facebook không cho xoá video này');
  return r;
}

/** Tìm video vừa đăng bằng trình duyệt (để đưa vào sổ Lịch đăng): mới tạo sau sinceSec, mô tả khớp đầu caption. */
export async function findRecentVideo(pageId, sinceSec, caption = '') {
  const token = creds(pageId).token;
  const head = caption.replace(/\s+/g, ' ').trim().slice(0, 40);
  const fields = 'id,description,created_time,published,scheduled_publish_time,permalink_url';
  for (const edge of ['videos', 'video_reels']) {
    const r = await call(`${graph()}/${pageId}/${edge}`, { params: { fields, limit: '15' }, token }).catch(() => null);
    const hit = (r?.data || []).find((v) => Date.parse(v.created_time) / 1000 >= sinceSec - 120
      && (!head || (v.description || '').replace(/\s+/g, ' ').trim().startsWith(head)));
    if (hit) return hit;
  }
  return null;
}
