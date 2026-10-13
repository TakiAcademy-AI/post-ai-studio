import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, readSettings } from './lib/config.js';
import { toCleanJpg } from './lib/media.js';
import { fbConfigured, checkPage } from './lib/facebook.js';
import crypto from 'node:crypto';
import * as FB from './lib/fb-auth.js';
import * as P from './lib/posts.js';
import * as CA from './lib/claude-accounts.js';
import { VOICES, isVoice } from './lib/voices.js';
import * as J from './lib/jobs.js';

fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
J.loadAll();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(config.root, 'public')));
// File của từng job (clip, khung hình, video cuối) — chỉ phục vụ trong thư mục data/jobs.
app.use('/files', express.static(path.join(config.dataDir, 'jobs'), { index: false, dotfiles: 'deny' }));

const upload = multer({
  dest: path.join(config.dataDir, 'uploads'),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// Clip mp4 người dùng tải về từ Flow (thường 5–30MB / 8 giây).
const uploadVideo = multer({
  dest: path.join(config.dataDir, 'uploads'),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^video\//.test(file.mimetype) || /\.(mp4|mov|webm)$/i.test(file.originalname)),
});

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

function jobOr404(req, res) {
  const job = J.getJob(req.params.id);
  if (!job) res.status(404).json({ error: 'Không tìm thấy job' });
  return job;
}

app.get('/api/config', (_req, res) => {
  res.json({
    models: config.gflowModels,
    defaultModel: config.gflowModel,
    fbConfigured: fbConfigured(),
    voices: VOICES,
    gflowFound: fs.existsSync(config.gflowBin),
  });
});

app.get('/api/fb/check', wrap(async (_req, res) => res.json(await checkPage())));

// ---------- Đăng nhập Facebook (OAuth popup, giống Ads OS) ----------
// Origin lấy theo Host người dùng đang mở (localhost hay 127.0.0.1) để cookie state và redirect_uri khớp nhau.
const originOf = (req) => `${req.protocol}://${req.get('host')}`;
const readCookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];

app.get('/api/fb/status', (req, res) => res.json({
  oauthReady: FB.oauthReady(), app: { ...FB.appInfo(originOf(req)), name: readSettings().fbAppName || null },
  ...FB.status(), envPage: Boolean(config.fbPageId && config.fbPageToken),
}));
app.post('/api/fb/app', wrap(async (req, res) => res.json(await FB.saveApp(req.body?.appId, req.body?.appSecret))));
app.delete('/api/fb/app', wrap(async (_req, res) => { FB.clearApp(); res.json({ ok: true }); }));

app.get('/api/fb/start', (req, res) => {
  if (!FB.oauthReady()) return res.status(503).send('Chưa cấu hình FB_APP_ID / FB_APP_SECRET / ENCRYPTION_KEY trong .env');
  const state = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Set-Cookie', `fb_state=${state}; HttpOnly; SameSite=Lax; Path=/api/fb; Max-Age=600`);
  res.redirect(FB.authorizeUrl(originOf(req), state));
});

app.get('/api/fb/callback', async (req, res) => {
  const origin = originOf(req);
  const send = (payload, code = 200) => res.status(code).type('html').send(FB.closePopupHtml(origin, payload));
  res.setHeader('Set-Cookie', 'fb_state=; HttpOnly; SameSite=Lax; Path=/api/fb; Max-Age=0');
  if (req.query.error) return send({ type: 'fb-login', ok: false, error: req.query.error_description || req.query.error });
  const expected = readCookie(req, 'fb_state');
  const state = String(req.query.state || '');
  // State phải khớp cookie — chặn trang khác ép nối tài khoản Facebook lạ vào web này.
  if (!expected || expected.length !== state.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(state))) {
    return send({ type: 'fb-login', ok: false, error: 'State không khớp — thử đăng nhập lại' }, 400);
  }
  try {
    const r = await FB.completeLogin(origin, String(req.query.code || ''));
    send({ type: 'fb-login', ok: true, user: r.user.name, pages: r.pages });
  } catch (e) {
    send({ type: 'fb-login', ok: false, error: e.message });
  }
});

app.post('/api/fb/page', wrap(async (req, res) => { FB.selectPage(String(req.body?.pageId || '')); res.json(FB.status()); }));
app.post('/api/fb/disconnect', (_req, res) => { FB.disconnect(); res.json({ ok: true }); });

app.get('/api/jobs', (_req, res) => res.json(J.listJobs()));

app.post('/api/jobs', upload.single('refImage'), wrap(async (req, res) => {
  const b = req.body;
  const sceneCount = Math.round(Number(b.sceneCount));
  if (!b.topic?.trim()) throw new Error('Thiếu chủ đề');
  if (!(sceneCount >= 2 && sceneCount <= 11)) throw new Error('Số cảnh phải từ 2 đến 11 (Reel tối đa 90 giây)');
  let ref = null;
  if (req.file) {
    ref = req.file.path + '.jpg';
    await toCleanJpg(req.file.path, ref);
    fs.rmSync(req.file.path, { force: true });
  }
  const input = {
    topic: b.topic.trim(),
    sceneCount,
    audience: b.audience?.trim() || '',
    cta: b.cta?.trim() || '',
    character: b.character?.trim() || '',
    mustSay: b.mustSay?.trim() || '',
    avoid: b.avoid?.trim() || '',
    tone: b.tone?.trim() || '',
    model: config.gflowModels.includes(b.model) ? b.model : config.gflowModel,
    mode: b.mode === 'gflow' ? 'gflow' : 'manual',
    consistency: b.consistency === 'frames' ? 'frames' : 'identity',
    voice: isVoice(b.voice) ? b.voice : null,
  };
  const job = await J.createJob(input, ref);
  res.json({ id: job.id });
}));

app.get('/api/jobs/:id', (req, res) => {
  const job = jobOr404(req, res);
  if (!job) return;
  // Kịch bản cũ chỉ có onScreenText → chuyển sẵn thành danh sách chữ để sửa trên web.
  job.scenes.forEach((_, i) => J.sceneOverlays(job, i));
  res.json(job);
});

app.patch('/api/jobs/:id', wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (!job) return;
  J.updateJob(job, req.body);
  res.json({ ok: true });
}));

app.patch('/api/jobs/:id/scenes/:i', wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (!job) return;
  res.json(J.updateScene(job, Number(req.params.i), req.body));
}));

const action = (fn) => wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (!job) return;
  const out = await fn(job, req.body || {});
  res.json(out ?? { ok: true });
});

app.post('/api/jobs/:id/script', action((job) => J.startScript(job)));
app.post('/api/jobs/:id/generate', action((job, b) => J.startGenerate(job, { from: Number(b.from) || 0, only: b.only ?? null })));
app.post('/api/jobs/:id/scenes/:i/clip', uploadVideo.single('clip'), wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (!job) { if (req.file) fs.rmSync(req.file.path, { force: true }); return; }
  if (!req.file) throw new Error('Chưa chọn file video (mp4)');
  res.json(await J.attachClip(job, Number(req.params.i), req.file.path, { force: req.body?.force === '1' }));
}));
app.delete('/api/jobs/:id/scenes/:i/clip', wrap(async (req, res) => {
  const job = jobOr404(req, res);
  if (job) res.json(J.removeClip(job, Number(req.params.i)));
}));
app.post('/api/jobs/:id/compress', action((job, b) => J.startCompress(job, Number(b.i))));
app.post('/api/jobs/:id/cancel', action((job) => J.cancelGenerate(job)));
app.post('/api/jobs/:id/stitch', action((job, b) => J.startStitch(job, { removeWatermark: b.removeWatermark !== false })));
app.post('/api/jobs/:id/facebook', action((job, b) => J.startFacebook(job, { mode: b.mode, scheduledAt: b.scheduledAt })));

// ---------- Tài khoản Claude ----------
app.get('/api/claude/accounts', wrap(async (_req, res) => res.json(await CA.list())));
app.post('/api/claude/active', wrap(async (req, res) => { CA.setActive(String(req.body?.id || '')); res.json({ ok: true }); }));
app.post('/api/claude/login/start', wrap(async (_req, res) => res.json(await CA.startLogin())));
app.post('/api/claude/login/code', wrap(async (req, res) => res.json(await CA.submitCode(String(req.body?.sessionId || ''), req.body?.code))));
app.post('/api/claude/login/cancel', (req, res) => { CA.cancelLogin(String(req.body?.sessionId || '')); res.json({ ok: true }); });
app.post('/api/claude/logout', wrap(async (req, res) => { await CA.logout(String(req.body?.id || '')); res.json({ ok: true }); }));

// ---------- Lịch đăng ----------
app.get('/api/posts', (_req, res) => res.json(P.listPosts()));
app.post('/api/posts/sync', wrap(async (_req, res) => res.json(await P.syncAll())));
app.post('/api/posts/:id/sync', wrap(async (req, res) => res.json(await P.syncPost(req.params.id))));
app.post('/api/posts/:id/reschedule', wrap(async (req, res) => res.json(await P.reschedule(req.params.id, Number(req.body?.at)))));
app.post('/api/posts/:id/cancel', wrap(async (req, res) => res.json(await P.cancel(req.params.id))));
app.post('/api/jobs/:id/facebook/refresh', action((job) => J.refreshFacebook(job)));

// ---------- Cầu nối extension ----------
app.post('/api/jobs/:id/bridge', action((job, b) => J.bridgeSend(job, Number(b.i))));
app.get('/api/bridge', (_req, res) => res.json(J.bridgeState()));
app.delete('/api/bridge', (_req, res) => { J.bridgeClear(); res.json({ ok: true }); });

app.post('/api/bridge/event', (req, res) => {
  J.bridgeEvent(req.body?.level, String(req.body?.text || '').slice(0, 500));
  res.json({ ok: true });
});

// Extension báo file vừa tải xong. Chỉ nhận mp4 nằm trong ~/Downloads để không thành lỗ đọc file tuỳ ý.
const downloadsDir = fs.realpathSync(path.join(os.homedir(), 'Downloads'));
app.post('/api/bridge/clip', wrap(async (req, res) => {
  const p = String(req.body?.path || '');
  if (!/\.(mp4|mov|webm)$/i.test(p)) throw new Error('Chỉ nhận file video .mp4/.mov/.webm');
  const real = fs.realpathSync(p);
  if (!real.startsWith(downloadsDir + path.sep)) throw new Error('File phải nằm trong thư mục Downloads');
  res.json(await J.bridgeClip(real, { jobId: req.body?.jobId, index: req.body?.index }));
}));

app.listen(config.port, config.host, () => {
  console.log(`Post AI Studio: http://${config.host}:${config.port}`);
});
