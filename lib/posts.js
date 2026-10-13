// Sổ các bài đã gửi lên Facebook (nháp / hẹn giờ / đã đăng) — nguồn dữ liệu cho tab "Lịch đăng".
// Lưu ở data/posts.json; trạng thái thật luôn lấy lại từ Facebook khi bấm "Làm mới".
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { fbVideo, rescheduleVideo, deleteVideo } from './facebook.js';

const file = () => path.join(config.dataDir, 'posts.json');
const MIN_AHEAD = 10 * 60 + 30; // Facebook đòi > 10 phút
const MAX_AHEAD = 29 * 86400;   // và trong vòng 29 ngày

function read() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; }
}
function write(list) {
  fs.writeFileSync(file(), JSON.stringify(list, null, 2));
}

export function checkScheduleTime(ts) {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts)) throw new Error('Thiếu thời gian hẹn đăng');
  if (ts < now + MIN_AHEAD) throw new Error('Giờ hẹn phải sau hiện tại ít nhất 11 phút');
  if (ts > now + MAX_AHEAD) throw new Error('Giờ hẹn phải trong vòng 29 ngày tới');
}

export function addPost(p) {
  const list = read().filter((x) => x.id !== p.id);
  list.push({ ...p, createdAt: new Date().toISOString() });
  write(list);
}

export function listPosts() {
  return read().sort((a, b) => (b.scheduledAt || b.createdAt).localeCompare(a.scheduledAt || a.createdAt));
}

function update(id, patch) {
  const list = read();
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error('Không có bài này trong lịch');
  Object.assign(p, patch);
  write(list);
  return p;
}

// Đọc trạng thái thật từ Facebook. Video bị xoá ngoài Business Suite → đánh dấu 'deleted'.
export async function syncPost(id) {
  const p = read().find((x) => x.id === id);
  if (!p) throw new Error('Không có bài này trong lịch');
  try {
    const v = await fbVideo(p.pageId, id);
    let state = 'draft';
    if (v.published) state = 'published';
    else if (v.scheduled_publish_time) state = 'scheduled';
    return update(id, {
      state,
      scheduledAt: v.scheduled_publish_time ? new Date(Number(v.scheduled_publish_time) * 1000).toISOString() : (state === 'published' ? p.scheduledAt : null),
      fbStatus: v.status?.video_status || null,
      publishStatus: v.status?.publishing_phase?.publish_status || null,
      permalink: v.permalink_url || p.permalink,
      checkedAt: new Date().toISOString(),
      error: null,
    });
  } catch (e) {
    if (/does not exist|Unsupported get request|cannot be loaded/i.test(e.message)) {
      return update(id, { state: 'deleted', checkedAt: new Date().toISOString(), error: null });
    }
    return update(id, { checkedAt: new Date().toISOString(), error: e.message });
  }
}

export async function syncAll() {
  const out = [];
  for (const p of read()) {
    if (p.state === 'deleted') { out.push(p); continue; }
    out.push(await syncPost(p.id));
  }
  return out;
}

export async function reschedule(id, ts) {
  checkScheduleTime(ts);
  const p = read().find((x) => x.id === id);
  if (!p) throw new Error('Không có bài này trong lịch');
  if (p.state === 'published') throw new Error('Bài đã đăng rồi, không đổi giờ được');
  await rescheduleVideo(p.pageId, id, ts);
  update(id, { state: 'scheduled', scheduledAt: new Date(ts * 1000).toISOString() });
  return syncPost(id);
}

export async function cancel(id) {
  const p = read().find((x) => x.id === id);
  if (!p) throw new Error('Không có bài này trong lịch');
  if (p.state === 'published') throw new Error('Bài đã đăng công khai — xoá trong Business Suite nếu muốn gỡ');
  await deleteVideo(p.pageId, id);
  return update(id, { state: 'deleted', checkedAt: new Date().toISOString(), error: null });
}

// Đưa bản ghi job.facebook cũ (trước khi có sổ lịch) vào sổ.
export function importLegacy(job) {
  const f = job.facebook;
  if (!f?.videoId || read().some((x) => x.id === f.videoId)) return;
  addPost({
    id: f.videoId, jobId: job.id, topic: job.input.topic, pageId: f.pageId || config.fbPageId, pageName: f.pageName || null,
    state: f.published ? 'published' : 'draft', scheduledAt: null, file: f.file, caption: job.caption?.slice(0, 200) || '',
  });
}
