import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './lib/config.js';
import { toCleanJpg } from './lib/media.js';
import { fbConfigured, checkPage } from './lib/facebook.js';
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
    gflowFound: fs.existsSync(config.gflowBin),
  });
});

app.get('/api/fb/check', wrap(async (_req, res) => res.json(await checkPage())));

app.get('/api/jobs', (_req, res) => res.json(J.listJobs()));

app.post('/api/jobs', upload.single('refImage'), wrap(async (req, res) => {
  const b = req.body;
  const sceneCount = Math.round(Number(b.sceneCount));
  if (!b.topic?.trim()) throw new Error('Thiếu chủ đề');
  if (!(sceneCount >= 2 && sceneCount <= 12)) throw new Error('Số cảnh phải từ 2 đến 12');
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
  };
  const job = await J.createJob(input, ref);
  res.json({ id: job.id });
}));

app.get('/api/jobs/:id', (req, res) => {
  const job = jobOr404(req, res);
  if (job) res.json(job);
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
app.post('/api/jobs/:id/compress', action((job, b) => J.startCompress(job, Number(b.i))));
app.post('/api/jobs/:id/cancel', action((job) => J.cancelGenerate(job)));
app.post('/api/jobs/:id/stitch', action((job, b) => J.startStitch(job, { removeWatermark: b.removeWatermark !== false })));
app.post('/api/jobs/:id/facebook', action((job) => J.startFacebook(job)));
app.post('/api/jobs/:id/facebook/refresh', action((job) => J.refreshFacebook(job)));

app.listen(config.port, config.host, () => {
  console.log(`Ads AI Studio: http://${config.host}:${config.port}`);
});
