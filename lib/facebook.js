import fs from 'node:fs/promises';
import { config } from './config.js';

const graph = () => `https://graph.facebook.com/${config.fbGraphVersion}`;

// Facebook có lúc trả HTTP 200 kèm khối error → luôn kiểm json.error trước, không tin res.ok.
async function call(url, { method = 'GET', params = {}, headers, body } = {}) {
  let res;
  if (method === 'GET') {
    const q = new URLSearchParams({ ...params, access_token: config.fbPageToken });
    res = await fetch(`${url}?${q}`);
  } else {
    res = await fetch(url, {
      method,
      headers: headers || { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body ?? new URLSearchParams({ ...params, access_token: config.fbPageToken }),
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
  return Boolean(config.fbPageId && config.fbPageToken);
}

export async function checkPage() {
  if (!fbConfigured()) throw new Error('Chưa khai FB_PAGE_ID / FB_PAGE_TOKEN trong .env');
  return call(`${graph()}/${config.fbPageId}`, { params: { fields: 'id,name' } });
}

// Reels Publishing API: start → upload nhị phân lên rupload → finish với video_state=DRAFT.
export async function uploadReelDraft({ file, description }) {
  if (!fbConfigured()) throw new Error('Chưa khai FB_PAGE_ID / FB_PAGE_TOKEN trong .env');
  const reels = `${graph()}/${config.fbPageId}/video_reels`;

  const start = await call(reels, { method: 'POST', params: { upload_phase: 'start' } });
  const videoId = start.video_id;
  if (!videoId) throw new Error('Facebook không trả video_id ở bước start');

  const data = await fs.readFile(file);
  const up = await call(start.upload_url || `https://rupload.facebook.com/video-upload/${config.fbGraphVersion}/${videoId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${config.fbPageToken}`,
      offset: '0',
      file_size: String(data.length),
    },
    body: data,
  });
  if (up.success === false) throw new Error('Upload video lên Facebook thất bại');

  const finish = await call(reels, {
    method: 'POST',
    params: { upload_phase: 'finish', video_id: videoId, video_state: 'DRAFT', description: description || '' },
  });
  if (finish.success === false) throw new Error('Facebook từ chối bước finish');
  return { videoId };
}

export async function videoStatus(videoId) {
  return call(`${graph()}/${videoId}`, { params: { fields: 'status,permalink_url,published' } });
}
