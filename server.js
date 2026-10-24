import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config, readSettings, writeSettings } from './lib/config.js';
import { toCleanJpg } from './lib/media.js';
import { fbConfigured, checkPage } from './lib/facebook.js';
import crypto from 'node:crypto';
import * as FB from './lib/fb-auth.js';
import * as P from './lib/posts.js';
import * as CA from './lib/claude-accounts.js';
import { VOICES, isVoice } from './lib/voices.js';
import * as FC from './lib/flow-chrome.js';
import * as FBC from './lib/fb-chrome.js';
import * as FBB from './lib/fb-browser.js';
import * as FI from './lib/fb-insights.js';
import * as PB from './lib/playbook.js';
import * as AP from './lib/autopilot.js';
import * as BOSS from './lib/boss.js';
import * as SC from './lib/scout.js';
import * as BM from './lib/benchmark.js';
import { grokStatus, defaultBrain } from './lib/grok.js';
import { FLOW_MODELS } from './lib/flow-auto.js';
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
    fbConfigured: fbConfigured(),
    voices: VOICES,
    flowModels: FLOW_MODELS,
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
    setting: b.setting?.trim() || '',
    mustSay: b.mustSay?.trim() || '',
    avoid: b.avoid?.trim() || '',
    tone: b.tone?.trim() || '',
    flowModel: FLOW_MODELS.includes(b.flowModel) ? b.flowModel : 'Veo 3.1 - Fast',
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
app.post('/api/jobs/:id/look', action((job) => J.startLook(job)));
app.post('/api/jobs/:id/auto', action((job, b) => J.startAutoFlow(job, { from: b.from ?? null })));

// ---------- Chrome Flow (tự động hoàn toàn) ----------
app.get('/api/flow/status', wrap(async (_req, res) => res.json({ up: await FC.isUp(), source: FC.source(), profiles: FC.listProfiles(), port: FC.CDP_PORT })));
app.post('/api/flow/sync', wrap(async (req, res) => { const s = await FC.syncProfile(String(req.body?.dir || '')); await FC.ensure({ show: true }); res.json(s); }));
app.post('/api/flow/show', wrap(async (req, res) => { await FC.ensure({ show: req.body?.show !== false }); res.json({ ok: true }); }));
app.post('/api/flow/check', wrap(async (_req, res) => res.json(await FC.checkLogin())));
app.post('/api/flow/close', wrap(async (_req, res) => { await FC.close(); res.json({ ok: true }); }));
const fbSelectedPageId = () => FBB.browserPage()?.id || FB.status().selectedPageId || config.fbPageId || null;
app.get('/api/fbchrome/status', wrap(async (_req, res) => res.json({
  up: await FBC.isUp(), source: FBC.source(), profiles: FBC.listProfiles(), port: FBC.CDP_PORT,
  page: FBB.browserPage(), pages: readSettings().fbBrowserPages || [],
})));
// Danh sách Page lấy từ bảng chuyển tài sản của Business Suite (không cần Graph API).
app.post('/api/fbchrome/pages', wrap(async (_req, res) => {
  const r = await FBB.listPages();
  writeSettings({ fbBrowserPages: r.pages });
  if (!FBB.browserPage() && r.current?.id) writeSettings({ fbBrowserPage: r.current });
  res.json({ pages: r.pages, page: FBB.browserPage() });
}));
app.post('/api/fbchrome/page', wrap(async (req, res) => res.json(await FBB.selectPage(String(req.body?.name || '')))));
app.post('/api/fbchrome/sync', wrap(async (req, res) => { const s = await FBC.syncProfile(String(req.body?.dir || '')); await FBC.ensure({ show: true }); res.json(s); }));
app.post('/api/fbchrome/show', wrap(async (req, res) => { await FBC.ensure({ show: req.body?.show !== false }); res.json({ ok: true }); }));
app.post('/api/fbchrome/check', wrap(async (_req, res) => {
  const id = fbSelectedPageId();
  const r = await FBB.checkLogin(id);
  res.json({ ...r, page: r.ok && id ? FBB.browserPage()?.name || FB.status().pages?.find((p) => p.id === id)?.name || id : null });
}));
app.post('/api/fbchrome/close', wrap(async (_req, res) => { await FBC.close(); res.json({ ok: true }); }));

app.post('/api/jobs/:id/cancel', action((job) => J.cancelGenerate(job)));
app.post('/api/jobs/:id/thumbnail', wrap(async (req, res) => { const job = J.getJob(req.params.id); if (!job) throw new Error('Không có video này'); if (typeof req.body?.text === 'string') J.updateJob(job, { thumbnailText: req.body.text }); res.json(await J.makeJobThumbnail(job)); }));
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

// ---------- Hiệu quả & sổ tay tối ưu (vòng phản hồi) ----------
let insightsRun = null;
let insightsState = { lastError: null, lastRunAt: null };
function insightPages() {
  const pages = new Map();
  const bp = FBB.browserPage();
  if (bp?.id) pages.set(bp.id, bp.name);
  for (const p of P.listPosts()) if (p.pageId && !pages.has(p.pageId)) pages.set(p.pageId, p.pageName);
  for (const c of AP.view().channels) if (c.page?.id && !pages.has(c.page.id)) pages.set(c.page.id, c.page.name);
  return [...pages].filter(([id]) => id).map(([pageId, pageName]) => ({ pageId, pageName }));
}
async function collectInsights() {
  if (insightsRun) return insightsRun;
  insightsRun = (async () => {
    const out = [];
    try {
      if (!FBC.source()) throw new Error('Chưa chuẩn bị Chrome Facebook (tab Tài khoản)');
      for (const pg of insightPages()) out.push(await FI.collectPage(pg));
      insightsState = { lastError: null, lastRunAt: new Date().toISOString() };
    } catch (e) {
      insightsState = { lastError: e.message, lastRunAt: new Date().toISOString() };
      throw e;
    } finally {
      insightsRun = null;
    }
    return out;
  })();
  return insightsRun;
}
// Tự thu mỗi 6 giờ (lần đầu sau 3 phút khởi động); lỗi (vd. chưa đăng nhập) chỉ ghi lại, không làm sập server.
setTimeout(() => { collectInsights().catch(() => {}); setInterval(() => collectInsights().catch(() => {}), 6 * 3600 * 1000); }, 3 * 60 * 1000);

app.get('/api/insights', (_req, res) => {
  const d = FI.readInsights();
  res.json({ rows: PB.performanceRows(), pages: Object.fromEntries(Object.entries(d.pages || {}).map(([id, pg]) => [id, { name: pg.name, collectedAt: pg.collectedAt }])), running: Boolean(insightsRun), ...insightsState });
});
app.post('/api/insights/collect', wrap(async (_req, res) => res.json(await collectInsights())));
app.get('/api/playbook', (_req, res) => res.json(PB.readPlaybook()));
app.post('/api/playbook/analyze', wrap(async (_req, res) => res.json(await PB.analyze())));
app.post('/api/playbook/approve', wrap(async (req, res) => res.json(PB.approve(req.body?.text))));
app.post('/api/playbook/enabled', wrap(async (req, res) => res.json(PB.setEnabled(req.body?.on))));
app.post('/api/playbook/discard', wrap(async (_req, res) => res.json(PB.discardDraft())));

// ---------- Tự nuôi kênh (nhiều kênh) ----------
app.get('/api/autopilot', (_req, res) => res.json({ ...AP.view(), pagesList: readSettings().fbBrowserPages || [] }));
app.post('/api/autopilot/channels', wrap(async (req, res) => res.json(AP.addChannel({ name: req.body?.name }))));
app.delete('/api/autopilot/channels/:cid', wrap(async (req, res) => { AP.removeChannel(req.params.cid); res.json({ ok: true }); }));
app.post('/api/autopilot/channels/:cid', wrap(async (req, res) => {
  const b = req.body || {};
  // Đổi Page theo tên → Business Suite đọc mã Page (không đổi Page mặc định của web).
  if (b.pageName && b.pageName !== AP.readAutopilot(req.params.cid).page?.name) b.page = await FBB.selectPage(String(b.pageName), { save: false });
  const before = AP.readAutopilot(req.params.cid).page?.id;
  const ch = AP.saveSettings(req.params.cid, b);
  if (ch.retopic) AP.ideate(req.params.cid).catch(() => {}); // vừa đổi định vị → nghĩ lại chủ đề
  if (ch.enabled) AP.tick().catch(() => {});
  else if (ch.page?.id && ch.page.id !== before) AP.profile(req.params.cid).catch(() => {}); // vừa chọn Page → quét định vị kênh ngay

  res.json({ ok: true });
}));
app.post('/api/autopilot/channels/:cid/profile', wrap(async (req, res) => { await AP.profile(req.params.cid); res.json({ ok: true }); }));
app.post('/api/autopilot/channels/:cid/ideate', wrap(async (req, res) => { await AP.ideate(req.params.cid); res.json({ ok: true }); }));
app.post('/api/autopilot/channels/:cid/approve', wrap(async (req, res) => { const m = req.body?.mode; await AP.approve(req.params.cid, String(req.body?.slot || ''), { mode: m === 'draft' || m === 'schedule' ? m : null }); res.json({ ok: true }); }));
app.post('/api/autopilot/channels/:cid/skip', wrap(async (req, res) => { AP.skip(req.params.cid, String(req.body?.slot || '')); res.json({ ok: true }); }));
app.post('/api/autopilot/channels/:cid/redo', wrap(async (req, res) => { AP.redo(req.params.cid, String(req.body?.slot || ''), { sameTopic: Boolean(req.body?.sameTopic) }); res.json({ ok: true }); }));
app.post('/api/autopilot/run', wrap(async (_req, res) => { AP.tick().catch(() => {}); res.json({ ok: true }); }));
AP.startLoop();

// ---------- Agent boss (Grok CLI) ----------
let grokCache = null;
app.get('/api/brain', (_req, res) => res.json({ brain: defaultBrain(), grok: grokCache }));
app.post('/api/brain', wrap(async (req, res) => { const b = req.body?.brain; if (b !== 'claude' && b !== 'grok') throw new Error('Chọn claude hoặc grok'); writeSettings({ brain: b }); res.json({ brain: defaultBrain() }); }));
app.get('/api/boss', (_req, res) => res.json({ ...BOSS.view(), grok: grokCache }));
app.post('/api/boss/grok-check', wrap(async (_req, res) => { grokCache = { ...(await grokStatus()), at: new Date().toISOString() }; res.json(grokCache); }));
app.post('/api/boss/report', wrap(async (_req, res) => res.json(await BOSS.supervise())));
app.post('/api/boss/chat', wrap(async (req, res) => res.json(await BOSS.chat(req.body?.message))));
app.post('/api/boss/settings', wrap(async (req, res) => res.json(BOSS.saveSettings(req.body || {}))));
app.post('/api/boss/proposals/:id/apply', wrap(async (req, res) => res.json(await BOSS.applyProposal(req.params.id))));
app.post('/api/boss/proposals/:id/dismiss', wrap(async (req, res) => res.json(BOSS.dismissProposal(req.params.id))));
BOSS.startLoop();

// ---------- Trinh sát (Scout) ----------
app.get('/api/scout', (req, res) => res.json(SC.overview({ cid: req.query.cid || null, days: Number(req.query.days) || 30 })));
app.post('/api/scout/settings', wrap(async (req, res) => res.json(SC.saveSettings(req.body || {}))));
app.post('/api/scout/sources', wrap(async (req, res) => { const s = SC.addSource(req.body || {}); SC.queueScan([s.id], 'mới thêm'); res.json(s); }));
app.post('/api/scout/sources/:id', wrap(async (req, res) => res.json(SC.updateSource(req.params.id, req.body || {}))));
app.delete('/api/scout/sources/:id', wrap(async (req, res) => res.json(SC.removeSource(req.params.id))));
app.post('/api/scout/scan', wrap(async (req, res) => res.json(SC.queueScan(Array.isArray(req.body?.ids) ? req.body.ids : null))));
app.post('/api/scout/decode', wrap(async (req, res) => res.json(SC.queueDecode(String(req.body?.sourceId || ''), String(req.body?.key || '')))));
app.post('/api/scout/clone', wrap(async (req, res) => res.json(SC.clone(String(req.body?.sourceId || ''), String(req.body?.key || ''), { cid: req.body?.cid || null }))));
SC.startLoop();

// ---------- Video chuẩn ----------
app.get('/api/benchmarks', (_req, res) => res.json({ items: BM.list(), ...BM.status() }));
app.post('/api/benchmarks', wrap(async (req, res) => res.json(BM.add(req.body || {}))));
app.post('/api/benchmarks/:id/retry', wrap(async (req, res) => res.json(BM.retry(req.params.id))));
app.delete('/api/benchmarks/:id', wrap(async (req, res) => res.json(BM.remove(req.params.id))));

app.listen(config.port, config.host, () => {
  console.log(`Post AI Studio: http://${config.host}:${config.port}`);
});
