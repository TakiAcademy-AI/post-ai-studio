const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let cfg = {};
let currentId = null;
let currentJob = null;
let pollTimer = null;
let fb = { connected: false }; // trạng thái đăng nhập Facebook
let fbEditingApp = false;      // đang mở form đổi App ID/Secret
const LIMIT = 4000; // Flow cắt prompt sau 4000 ký tự

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function toast(msg, ms = 4000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

function show(view) {
  for (const v of ['new', 'job', 'empty', 'posts', 'accounts']) $(`#view-${v}`).hidden = v !== view;
  $('#tab-posts').classList.toggle('active', view === 'posts');
  $('#tab-accounts').classList.toggle('active', view === 'accounts');
  $('#tab-videos').classList.toggle('active', !['posts', 'accounts'].includes(view));
  document.body.dataset.view = view;
  $('.side').classList.remove('open'); // mobile: mở video xong thì gấp danh sách lại
  if (typeof sideLabel === 'function') sideLabel();
  window.scrollTo({ top: 0 });
}

const STAGE = {
  scripting: 'Đang viết kịch bản', script_failed: 'Lỗi kịch bản', script_ready: 'Chờ tạo cảnh',
  generating: 'Đang tạo cảnh', clips_ready: 'Đủ cảnh — chờ ghép', stitched: 'Đã ghép', posted_draft: 'Đã gửi nháp FB', posted: 'Đã đăng FB', scheduled: 'Đã hẹn giờ FB',
};

// ---------- danh sách ----------
async function loadList() {
  const jobs = await api('/api/jobs');
  $('#job-list').innerHTML = jobs.map((j) => `
    <li data-id="${j.id}" class="${j.id === currentId ? 'active' : ''} ${j.busy ? 'st-busy' : ({ posted: 'st-done', posted_draft: 'st-done', scheduled: 'st-scheduled', stitched: 'st-done' }[j.stage] || '')}">
      ${esc(j.topic.slice(0, 60))}
      <div class="meta">${j.sceneCount} cảnh · ${esc(STAGE[j.stage] || j.stage)}${j.busy ? ' · ⏳' : ''}</div>
    </li>`).join('') || '<li class="muted">Chưa có video nào</li>';
  sideJobs = jobs;
  sideLabel();
}
let sideJobs = [];
function sideLabel() {
  const cur = document.body.dataset.view === 'job' && sideJobs.find((j) => j.id === currentId);
  $('#side-toggle').innerHTML = `<span>${cur ? esc(cur.topic.slice(0, 60)) : `Các video (${sideJobs.length})`}</span><span class="chev">▾</span>`;
}
$('#side-toggle').addEventListener('click', () => $('.side').classList.toggle('open'));

$('#job-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openJob(li.dataset.id);
});

// ---------- tạo mới ----------
$('#btn-new').addEventListener('click', () => {
  currentId = null;
  stopPoll();
  loadList();
  show('new');
});

// Số cảnh: nhập tự do 2–11 (11 × 8s = 88s, vừa giới hạn 90s của Reel), có nút −/+ và chọn nhanh.
const sceneSel = $('#form-new [name=sceneCount]');
const MIN_SCENES = 2, MAX_SCENES = 11;
const setScenes = (n) => {
  sceneSel.value = Math.min(MAX_SCENES, Math.max(MIN_SCENES, Math.round(Number(n) || 8)));
  durHint();
};
const durHint = () => {
  const n = Number(sceneSel.value) || 0;
  $('#dur-hint').textContent = `${n} cảnh ≈ ${n * 8} giây${n * 8 > 90 ? ' — vượt 90s, không đăng Reel được' : ''}`;
  for (const b of document.querySelectorAll('#scene-chips button')) b.classList.toggle('on', Number(b.dataset.n) === n);
  document.querySelector('.count-btn[data-step="-1"]').disabled = n <= MIN_SCENES;
  document.querySelector('.count-btn[data-step="1"]').disabled = n >= MAX_SCENES;
};
sceneSel.addEventListener('input', durHint);
sceneSel.addEventListener('change', () => setScenes(sceneSel.value));
document.querySelectorAll('.count-btn').forEach((b) => b.addEventListener('click', () => setScenes(Number(sceneSel.value) + Number(b.dataset.step))));
$('#scene-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) setScenes(b.dataset.n); });

$('#form-new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const { id } = await api('/api/jobs', { method: 'POST', body: new FormData(e.target) });
    e.target.reset();
    durHint();
    openJob(id);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- chi tiết job ----------
async function openJob(id) {
  currentId = id;
  currentJob = null;
  show('job');
  await refresh(true);
  loadList();
}

function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }

async function refresh(force = false) {
  stopPoll();
  if (!currentId) return;
  try {
    const job = await api(`/api/jobs/${currentId}`);
    const editing = document.activeElement?.matches?.('#view-job textarea, #view-job input');
    if (force || !editing) {
      if (force || !currentJob || job.updatedAt !== currentJob.updatedAt) {
        const wasBusy = currentJob?.busy;
        currentJob = job;
        renderJob(job);
        if (wasBusy && !job.busy) loadList();
      }
    }
    pollTimer = setTimeout(refresh, job.busy ? 2500 : 8000);
  } catch (e) {
    toast(e.message);
  }
}

function renderJob(job) {
  const busy = Boolean(job.busy);
  const doneCount = job.scenes.filter((s) => s.clip).length;
  const total = job.scenes.reduce((a, s) => a + (s.duration || 8) - (s.trimStart || 0) - (s.trimEnd || 0), 0);
  const nextIdx = job.scenes.findIndex((s) => !s.clip);
  const fileUrl = (rel) => `/files/${job.id}/${rel}`;

  const head = `
    <div class="card">
      <div class="job-head">
        <div class="grow">
          <h1>${esc(job.input.topic)}</h1>
          <div class="muted">${job.input.sceneCount} cảnh · ${doneCount}/${job.scenes.length} cảnh có video · ${esc(STAGE[job.stage] || job.stage)}
          </div>
        </div>
        ${busy ? `<div class="busy"><span class="spin"></span>${esc(job.busy)}</div>` : ''}
      </div>
      ${stepper(job)}
      ${job.error ? `<div class="error-box">${esc(job.error)}</div>` : ''}
      ${!job.script && !busy ? `<div class="row"><button data-act="script" class="primary">Viết lại kịch bản</button></div>` : ''}
    </div>`;

  if (!job.script) {
    $('#view-job').innerHTML = head + logCard(job);
    return;
  }

  const s = job.script.summary;
  const summary = `
    <div class="card">
      <h2>✦ Mạch video</h2>
      <dl class="summary">
        <dt>Hook</dt><dd>${esc(s.hook)}</dd>
        <dt>Lời hứa chính</dt><dd>${esc(s.corePromise)}</dd>
        <dt>Biến đổi</dt><dd>${esc(s.transformation)}</dd>
        <dt>Cao trào</dt><dd>${esc(s.climax)}</dd>
        <dt>CTA</dt><dd>${esc(s.cta)}</dd>
      </dl>
      <details><summary>B. Bảng nối cảnh</summary>
        <table class="cmap"><tr><th>Cảnh</th><th>Bắt đầu từ</th><th>Kết thúc bằng</th></tr>
        ${job.script.continuityMap.map((c) => `<tr><td>${c.scene}</td><td>${esc(c.startsFrom)}</td><td>${esc(c.endsWith)}</td></tr>`).join('')}
        </table>
      </details>
      <div class="row">
        <button data-act="script" ${busy ? 'disabled' : ''}>Viết lại toàn bộ kịch bản</button>
      </div>
    </div>`;

  const genBar = `
    <div class="card">
      <h2>Tạo video trên Flow (tự động)</h2>
      <div class="row" style="margin:0 0 10px">
        <label style="display:flex;gap:8px;align-items:center;font-weight:600">Giọng đọc:
          <select id="job-voice" style="width:auto;margin:0" ${busy ? 'disabled' : ''}>
            <option value="">Không cố định — mỗi cảnh một giọng</option>${window.voiceOpts ? window.voiceOpts(job.voice) : ''}
          </select></label>
        ${job.voice === 'me' ? '<span class="muted" style="font-size:12px">@me: mặt + giọng lấy từ hình đại diện "Tôi"; không dùng ảnh nhân vật hay khung cuối cảnh trước (Flow chặn ảnh mặt người thật)</span>'
          : job.voice && job.refImage && (job.consistency || 'identity') === 'frames' ? '<span class="over" style="font-size:12px">Chế độ "Nối cảnh liền khung" không gắn được giọng cho cảnh 2+</span>' : ''}
      </div>
      ${job.refImage && job.voice !== 'me' ? `<div class="row" style="margin:0 0 10px">
        <label style="display:flex;gap:8px;align-items:center;font-weight:600">Cảnh 2 trở đi:
          <select id="job-consistency" style="width:auto;margin:0" ${busy ? 'disabled' : ''}>
            <option value="identity" ${(job.consistency || 'identity') === 'identity' ? 'selected' : ''}>Giữ đúng mặt nhân vật (ảnh nhân vật + khung cuối cảnh trước)</option>
            <option value="frames" ${job.consistency === 'frames' ? 'selected' : ''}>Nối cảnh liền khung (chỉ khung đầu — mặt dễ trôi)</option>
          </select></label></div>` : ''}
      <div class="auto-box">
        <div class="row" style="margin:0">
          <label style="display:flex;gap:8px;align-items:center;font-weight:600">Model Flow:
            <select id="job-flow-model" style="width:auto;margin:0" ${busy ? 'disabled' : ''}>
              ${(cfg.flowModels || []).map((m) => `<option ${m === (job.flowModel || 'Veo 3.1 - Fast') ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select></label>
          ${nextIdx >= 0 ? `<button class="primary" data-act="auto-run" data-i="${nextIdx}" ${busy ? 'disabled' : ''}>▶ Tự tạo ${nextIdx === 0 ? `cả ${job.scenes.length} cảnh` : `từ cảnh ${nextIdx + 1} (${job.scenes.length - nextIdx} cảnh)`}</button>` : '<span class="badge done">Đủ cảnh</span>'}
          ${busy && job.stage === 'generating' ? '<button class="danger" data-act="cancel">Dừng sau cảnh này</button>' : ''}
        </div>
        <p class="muted" style="margin:8px 0 0;font-size:13px">Server mở <b>Chrome Flow</b> (tab Tài khoản), tự điền, <b>tự bấm tạo</b>, chờ, tải clip và gắn vào từng cảnh — mỗi cảnh trừ credit Flow. Flow báo "hết thời gian" thì tự thử lại 2 lần; vi phạm chính sách / hết credit thì dừng và báo.</p>
      </div>
    </div>`;

  const scenes = job.scenes.map((sc, i) => {
    const st = sc.stale ? 'stale' : sc.status;
    const label = { pending: 'Chưa tạo', queued: 'Đang chờ', running: 'Đang tạo…', done: 'Xong', error: 'Lỗi', stale: 'Lệch nối cảnh' }[st];
    const locked = busy || sc.status === 'running';
    return `
    <div class="card" id="scene-${i}">
      <div class="scene">
        <div>
          <div class="scene-head">
            <span class="scene-no">${i + 1}</span><h3>${esc(sc.title)}</h3>
            <span class="badge ${st}">${label}</span>
            ${sc.attempts ? `<span class="muted" style="font-size:12px">đã tạo ${sc.attempts} lần</span>` : ''}
          </div>
          <div class="dialogue">🎙 ${esc(sc.dialogue)}</div>
          ${overlayEditor(sc, i, locked)}
          ${sc.stale ? `<div class="error-box" style="color:var(--warn)">Cảnh trước đã được tạo lại nên khung đầu cảnh này không còn khớp. Nên tạo lại từ cảnh này.</div>` : ''}
          ${sc.error ? `<div class="error-box">${esc(sc.error)}</div>` : ''}
          <details ${sc.clip ? '' : 'open'}><summary>Prompt Flow (sửa được, tự lưu khi rời ô) ·
            <span class="${sc.prompt.length > LIMIT ? 'over' : ''}" data-count="${i}">${sc.prompt.length}/${LIMIT} ký tự</span></summary>
            <textarea class="prompt" rows="14" data-field="prompt" data-i="${i}" ${locked ? 'disabled' : ''}>${esc(sc.prompt)}</textarea>
          </details>
          ${sc.promptOriginal ? `<div class="manual" style="border-color:#f3d9a8;background:var(--warn-bg)">Prompt đã được <b>tự viết lại ${sc.policyRewrites || 1} lần</b> để né bộ lọc "người nổi tiếng" của Flow (lời thoại giữ nguyên).
            <div class="row"><button class="small" data-act="restore-prompt" data-i="${i}" ${locked ? 'disabled' : ''}>Dùng lại prompt gốc</button></div></div>` : ''}
          ${sceneSteps(job, i)}
          ${sc.prompt.length > LIMIT - 300 ? `<div class="row"><button class="small" data-act="compress" data-i="${i}" ${locked ? 'disabled' : ''}>Rút gọn prompt</button></div>` : ''}
        </div>
        <div class="player">
          ${sc.clip
            ? `<video src="${fileUrl(sc.clip)}" controls preload="metadata" playsinline></video>
               <div class="trim">
                 <label>Cắt đầu (s)<input type="number" min="0" max="4" step="0.1" value="${sc.trimStart}" data-field="trimStart" data-i="${i}" ${busy ? 'disabled' : ''}></label>
                 <label>Cắt cuối (s)<input type="number" min="0" max="4" step="0.1" value="${sc.trimEnd}" data-field="trimEnd" data-i="${i}" ${busy ? 'disabled' : ''}></label>
               </div>`
            : `<div class="ph drop" data-drop="${i}">${sc.status === 'running'
                ? '<span class="busy"><span class="spin"></span>Flow đang render</span>'
                : 'Kéo file mp4 từ Flow vào đây<br>hoặc bấm để chọn file'}</div>`}
          ${sc.clip ? `<button class="small block" style="margin-top:8px" data-act="pick" data-i="${i}" ${busy ? 'disabled' : ''}>Thay clip khác…</button>
             <button class="small block danger" style="margin-top:6px" data-act="unclip" data-i="${i}" ${busy ? 'disabled' : ''}>Bỏ clip cảnh này</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  const allClips = job.scenes.every((s) => s.clip);
  const final = `
    <div class="card">
      <h2>Ghép video & đăng Facebook</h2>
      <div class="final">
        <div class="player">
          ${job.final ? `<video src="${fileUrl(job.final.file)}" controls preload="metadata" playsinline></video>
                         <div class="row"><a href="${fileUrl(job.final.file)}" download>Tải MP4</a> · ${job.final.duration.toFixed(1)}s</div>`
                      : `<div class="ph">Chưa ghép</div>`}
        </div>
        <div>
          <p class="muted" style="margin-top:0">Độ dài dự kiến ≈ ${total.toFixed(1)}s (Reel cho phép 3–90s). Ghép sẽ xoá watermark "Veo", cắt đầu/cuối theo từng cảnh, chèn chữ (nếu bật), xuất 1080×1920.</p>
          <div class="row">
            <button data-act="stitch" class="${job.final ? '' : 'primary'}" ${busy || !allClips ? 'disabled' : ''}>${job.final ? 'Ghép lại' : 'Ghép video'}</button>
            <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="wm" checked style="width:auto"> Xoá watermark Veo</label>
            <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="txt-on" ${job.text?.enabled === false ? '' : 'checked'} style="width:auto"> Chèn chữ</label>
            <select id="txt-style" style="width:auto" ${job.text?.enabled === false ? 'disabled' : ''}>
              ${[['brand', 'Khung gradient tím-xanh'], ['dark', 'Khung nền tối'], ['light', 'Khung nền sáng']].map(([v, l]) => `<option value="${v}" ${(job.text?.style || 'brand') === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          ${job.scenes.some((s) => s.stale) ? `<div class="error-box" style="color:var(--warn)">Có cảnh bị lệch nối — vẫn ghép được nhưng chỗ nối sẽ giật.</div>` : ''}
          <label style="margin-top:16px">Caption Facebook
            <textarea rows="4" data-field="caption" ${busy ? 'disabled' : ''}>${esc(job.caption)}</textarea>
          </label>
          <div class="row" style="align-items:center">
            <select id="fb-mode" style="width:auto">
              <option value="schedule" selected>Hẹn giờ đăng</option>
              <option value="publish">Đăng ngay (công khai)</option>
              <option value="draft">Lưu nháp</option>
            </select>
            <input type="datetime-local" id="fb-when" style="width:auto" value="${defaultWhen()}">
            <button data-act="facebook" class="primary" ${busy || !job.final || !cfg.fbReady ? 'disabled' : ''}>Đăng lên ${esc(fbc.page?.name || 'Page')}</button>
          </div>
          ${!cfg.fbReady ? '<div class="muted">Chưa sẵn sàng đăng — tab <a href="#" data-goto-accounts>Tài khoản</a> → Chrome Facebook: chép profile, đăng nhập Facebook và chọn <b>Page để đăng</b>.</div>' : ''}
          ${job.facebook ? `
            <div class="dialogue" style="margin-top:12px">
              ${{ published: 'Đã đăng công khai', scheduled: `Đã hẹn đăng lúc ${job.facebook.scheduledAt ? new Date(job.facebook.scheduledAt).toLocaleString('vi-VN') : ''}`, draft: 'Đã gửi nháp' }[job.facebook.state || (job.facebook.published ? 'published' : 'draft')]}${job.facebook.pageName ? ` lên <b>${esc(job.facebook.pageName)}</b>` : ''}${job.facebook.videoId ? ` · video_id <code>${esc(job.facebook.videoId)}</code>` : ''} · ${new Date(job.facebook.at).toLocaleString('vi-VN')}
              ${job.facebook.file !== job.final?.file ? '<br><b>Lưu ý:</b> bản nháp là video ghép trước đó, không phải bản hiện tại.' : ''}
              ${job.facebook.status?.status?.publishing_phase?.publish_status ? `<br>Facebook: <b>${esc(job.facebook.status.status.video_status)}</b> · ${esc(job.facebook.status.status.publishing_phase.publish_status)}` : ''}
              <div class="row"><button class="small" data-act="fb-refresh">Kiểm tra trạng thái</button>
              ${postLinks({ id: job.facebook.videoId, state: job.facebook.state || (job.facebook.published ? 'published' : 'draft'), jobId: job.id, file: job.facebook.file })}
              <a href="#" data-goto-posts>Quản lý ở tab Lịch đăng</a></div>
            </div>` : ''}
        </div>
      </div>
    </div>`;

  $('#view-job').innerHTML = head + summary + genBar + scenes + final + logCard(job);
}

// Chữ trên màn hình (web vẽ lúc ghép): mỗi dòng = nội dung + giây bắt đầu/kết thúc + vị trí.
function overlayEditor(sc, i, locked) {
  const rows = (sc.overlays || []).map((o, k) => `
    <div class="ov-row" data-k="${k}">
      <input class="ov-text" value="${esc(o.text)}" placeholder="Chữ hiển thị (có dấu)" ${locked ? 'disabled' : ''}>
      <input class="ov-start" type="number" step="0.1" min="0" max="8" value="${o.start}" title="Hiện từ giây" placeholder="từ" ${locked ? 'disabled' : ''}>
      <input class="ov-end" type="number" step="0.1" min="0" max="8" value="${o.end}" title="Ẩn ở giây" placeholder="đến" ${locked ? 'disabled' : ''}>
      <select class="ov-pos" ${locked ? 'disabled' : ''}>${[['top', 'Trên'], ['middle', 'Giữa'], ['bottom', 'Dưới']].map(([v, l]) => `<option value="${v}" ${o.position === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="small ov-del" title="Xoá" ${locked ? 'disabled' : ''}>✕</button>
    </div>`).join('');
  return `<div class="ov" data-ov="${i}">
    <div class="ov-head"><span>Chữ trên màn hình <small class="muted" style="display:inline">· web vẽ khi ghép, đúng dấu</small></span>
      <button class="small ov-add" ${locked || (sc.overlays || []).length >= 6 ? 'disabled' : ''}>＋ Thêm chữ</button></div>
    ${rows || '<div class="muted" style="font-size:13px">Không có chữ.</div>'}
  </div>`;
}

async function saveOverlays(box) {
  const i = Number(box.dataset.ov);
  const overlays = [...box.querySelectorAll('.ov-row')].map((r) => ({
    text: r.querySelector('.ov-text').value,
    start: Number(r.querySelector('.ov-start').value),
    end: Number(r.querySelector('.ov-end').value),
    position: r.querySelector('.ov-pos').value,
  }));
  await api(`/api/jobs/${currentJob.id}/scenes/${i}`, { method: 'PATCH', body: { overlays } });
}

$('#view-job').addEventListener('click', async (e) => {
  const box = e.target.closest('[data-ov]');
  if (!box || !currentJob) return;
  const i = Number(box.dataset.ov);
  const sc = currentJob.scenes[i];
  try {
    if (e.target.closest('.ov-add')) {
      const last = sc.overlays?.[sc.overlays.length - 1];
      const start = last ? Math.min(7, last.end + 0.1) : 0.3;
      await api(`/api/jobs/${currentJob.id}/scenes/${i}`, { method: 'PATCH', body: { overlays: [...(sc.overlays || []), { text: 'Chữ mới', start, end: Math.min(8, start + 2.5), position: 'top' }] } });
      refresh(true);
    } else if (e.target.closest('.ov-del')) {
      e.target.closest('.ov-row').remove();
      await saveOverlays(box);
      refresh(true);
    }
  } catch (err) { toast(err.message); }
});
$('#view-job').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-ov]');
  if (!box || !e.target.closest('.ov-row')) return;
  try { await saveOverlays(box); toast('Đã lưu chữ', 1200); } catch (err) { toast(err.message); }
}, true);

// Cách Chrome Flow tạo cảnh này + nút tự tạo lại.
function sceneSteps(job, i) {
  const ready = i === 0 || job.scenes[i - 1]?.lastFrame;
  return `<div class="manual"><div>Tự động: ${job.voice === 'me' ? 'Thành phần + <b>@me</b>' : job.refImage && (job.consistency || 'identity') === 'identity' ? 'Thành phần (ảnh nhân vật' + (i ? ' + khung cuối cảnh trước' : '') + ')' : i ? 'Khung hình (khung cuối cảnh trước)' : 'chỉ prompt'}${job.voice && job.voice !== 'me' ? ` · giọng <b>${esc(job.voice)}</b>` : ''}</div>
    <div class="row"><button class="small" data-act="auto-run" data-i="${i}" ${currentJob?.busy || !ready ? 'disabled' : ''}>${job.scenes[i].clip ? '↻ Tự tạo lại cảnh này' : '▶ Tự tạo từ cảnh này'}</button>
    <button class="small" data-act="copy" data-i="${i}">Copy prompt</button></div></div>`;
}

const filePicker = Object.assign(document.createElement('input'), { type: 'file', accept: 'video/mp4,video/*' });
filePicker.addEventListener('change', () => {
  if (filePicker.files[0]) uploadClip(Number(filePicker.dataset.i), filePicker.files[0]);
  filePicker.value = '';
});

async function uploadClip(i, file, force = false) {
  if (!currentJob) return;
  const sc = currentJob.scenes[i];
  if (sc.clip && i < currentJob.scenes.length - 1 && currentJob.scenes.slice(i + 1).some((s) => s.clip)
      && !confirm(`Thay clip cảnh ${i + 1} sẽ làm các cảnh sau lệch nối. Tiếp tục?`)) return;
  const fd = new FormData();
  fd.append('clip', file);
  if (force) fd.append('force', '1');
  toast(`Đang tải clip cảnh ${i + 1} lên…`, 60000);
  try {
    await api(`/api/jobs/${currentJob.id}/scenes/${i}/clip`, { method: 'POST', body: fd });
    toast(`Đã nhận clip cảnh ${i + 1}`);
    refresh(true);
  } catch (e) {
    // Người dùng tự chọn file: cho phép gắn dù khung đầu lệch (vd. cố ý không nối).
    if (!force && e.message.includes('không khớp khung cuối') && confirm(`${e.message}\n\nVẫn gắn clip này vào cảnh ${i + 1}?`)) return uploadClip(i, file, true);
    toast(e.message);
  }
}

$('#view-job').addEventListener('dragover', (e) => {
  const d = e.target.closest('[data-drop]');
  if (!d) return;
  e.preventDefault();
  d.classList.add('over-drop');
});
$('#view-job').addEventListener('dragleave', (e) => e.target.closest('[data-drop]')?.classList.remove('over-drop'));
$('#view-job').addEventListener('drop', (e) => {
  const d = e.target.closest('[data-drop]');
  if (!d) return;
  e.preventDefault();
  d.classList.remove('over-drop');
  const f = e.dataTransfer.files[0];
  if (f) uploadClip(Number(d.dataset.drop), f);
});
$('#view-job').addEventListener('click', (e) => {
  const d = e.target.closest('.ph[data-drop].drop');
  if (d) { filePicker.dataset.i = d.dataset.drop; filePicker.click(); }
});

// Thanh tiến trình 4 bước: Kịch bản → Tạo cảnh → Ghép → Đăng.
function stepper(job) {
  const hasScript = Boolean(job.script);
  const nClips = job.scenes.filter((s) => s.clip).length;
  const allClips = job.scenes.length > 0 && nClips === job.scenes.length;
  const posted = ['posted', 'posted_draft', 'scheduled'].includes(job.stage);
  const steps = [
    ['Kịch bản', hasScript, job.scenes.length ? `${job.scenes.length} cảnh` : ''],
    ['Tạo cảnh', allClips, job.scenes.length ? `${nClips}/${job.scenes.length}` : ''],
    ['Ghép', Boolean(job.final), job.final ? `${job.final.duration.toFixed(0)}s` : ''],
    ['Đăng', posted, posted ? ({ posted: 'đã đăng', posted_draft: 'nháp', scheduled: 'hẹn giờ' }[job.stage]) : ''],
  ];
  const now = steps.findIndex(([, done]) => !done);
  return `<div class="stepper">${steps.map(([name, done, sub], k) => `
    <div class="step ${done ? 'done' : k === now ? 'now' : ''}"><span class="n">${done ? '✓' : k + 1}</span>
      <span>${name}${sub ? `<small class="muted" style="font-weight:500">${esc(sub)}</small>` : ''}</span></div>`).join('')}</div>`;
}

function logCard(job) {
  return `<div class="card"><details ${job.error ? 'open' : ''}><summary>Nhật ký</summary>
    <div class="log">${esc(job.log.join('\n'))}</div></details></div>`;
}

// ---------- Lịch đăng ----------
const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultWhen() {
  // Mặc định: giờ tròn kế tiếp, ít nhất 1 tiếng nữa.
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

// Link reel chỉ mở được khi bài đã đăng công khai; nháp/hẹn giờ chưa có trang trên Facebook → xem file đã gửi.
function postLinks(p) {
  if (p.state === 'deleted') return '';
  if (!p.id || String(p.id).startsWith('browser-')) { // đăng qua trình duyệt, chưa dò được video_id
    const local = p.jobId && p.file ? `<a href="/files/${encodeURIComponent(p.jobId)}/${encodeURIComponent(p.file)}" target="_blank" rel="noopener">Xem video</a> ` : '';
    return local + `<a href="https://business.facebook.com/latest/content_calendar" target="_blank" rel="noopener">Mở Business Suite</a>`;
  }
  if (p.state === 'published') return `<a href="https://www.facebook.com/reel/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Mở reel</a>`;
  const local = p.jobId && p.file ? `<a href="/files/${encodeURIComponent(p.jobId)}/${encodeURIComponent(p.file)}" target="_blank" rel="noopener">Xem video</a>` : '';
  const bs = p.state === 'scheduled' ? ' <a href="https://business.facebook.com/latest/content_calendar" target="_blank" rel="noopener">Mở Business Suite</a>' : '';
  return local + bs + `<span class="muted" style="font-size:12px;display:block">${p.state === 'scheduled' ? 'Chưa tới giờ đăng — link reel có sau khi đăng.' : 'Nháp chưa có link công khai trên Facebook.'}</span>`;
}

const POST_STATE = { scheduled: 'Hẹn giờ', published: 'Đã đăng', draft: 'Nháp', deleted: 'Đã huỷ' };

async function openPosts(sync = false) {
  currentId = null;
  stopPoll();
  loadList();
  show('posts');
  $('#posts-list').innerHTML = '<div class="card muted">Đang tải…</div>';
  try {
    const posts = sync ? await api('/api/posts/sync', { method: 'POST' }) : await api('/api/posts');
    renderPosts(posts);
  } catch (e) {
    $('#posts-list').innerHTML = `<div class="card error-box">${esc(e.message)}</div>`;
  }
}

function renderPosts(posts) {
  const hide = $('#posts-hide-done').checked;
  const list = posts.filter((p) => !hide || !['published', 'deleted'].includes(p.state))
    .sort((a, b) => {
      const rank = (p) => ({ scheduled: 0, draft: 1, published: 2, deleted: 3 }[p.state] ?? 4);
      return rank(a) - rank(b) || (a.scheduledAt || a.createdAt).localeCompare(b.scheduledAt || b.createdAt) * (a.state === 'scheduled' ? 1 : -1);
    });
  if (!list.length) {
    $('#posts-list').innerHTML = '<div class="card muted">Chưa có bài nào. Ghép video xong → chọn "Hẹn giờ đăng" ở cuối trang video.</div>';
    return;
  }
  $('#posts-list').innerHTML = list.map((p) => {
    const when = p.scheduledAt ? new Date(p.scheduledAt) : null;
    const editable = p.state === 'scheduled' || p.state === 'draft';
    return `<div class="card post" data-post="${esc(p.id)}">
      <div class="when">${when ? when.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}
        <small><br>${when ? when.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }) : 'chưa đặt giờ'}</small></div>
      <div>
        <div><span class="badge ${p.state}">${POST_STATE[p.state] || p.state}</span> <b>${esc(p.pageName || 'Page')}</b></div>
        <div style="margin:4px 0"><a href="#" data-open-job="${esc(p.jobId)}">${esc((p.topic || '').slice(0, 90))}</a></div>
        <div class="muted" style="font-size:13px">${esc((p.caption || '').slice(0, 140))}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">video_id ${esc(p.id)}${p.fbStatus ? ` · Facebook: ${esc(p.fbStatus)}${p.publishStatus ? ' / ' + esc(p.publishStatus) : ''}` : ''}${p.checkedAt ? ` · kiểm lúc ${new Date(p.checkedAt).toLocaleTimeString('vi-VN')}` : ''}</div>
        ${p.error ? `<div class="error-box">${esc(p.error)}</div>` : ''}
      </div>
      <div class="acts">
        ${editable ? `<input type="datetime-local" value="${when ? toLocalInput(when) : defaultWhen()}" data-when>
          <button class="small" data-post-act="reschedule">${p.state === 'draft' ? 'Hẹn giờ' : 'Đổi giờ'}</button>
          <button class="small" data-post-act="soon">Đăng sớm (sau ~11 phút)</button>
          <button class="small danger" data-post-act="cancel">Huỷ / xoá khỏi Facebook</button>` : ''}
        <button class="small" data-post-act="sync">Kiểm tra trạng thái</button>
        ${postLinks(p)}
      </div>
    </div>`;
  }).join('');
}

$('#tab-posts').addEventListener('click', () => openPosts(false));
function openAccounts() {
  currentId = null;
  stopPoll();
  loadList();
  show('accounts');
  loadClaude();
  loadFb();
  loadChromeFlow();
  loadChromeBox('fb');
}
$('#tab-accounts').addEventListener('click', openAccounts);

// Trạng thái Chrome Flow / Chrome Facebook cho pill đầu trang và nút đăng.
let fbc = {};
function setFbc(st) {
  fbc = st || {};
  cfg.fbReady = Boolean(fbc.source && fbc.page);
  const pill = $('#pill-fb');
  if (pill) {
    pill.className = `pill ${cfg.fbReady ? 'ok' : 'bad'}`;
    pill.textContent = cfg.fbReady ? `Facebook: ${fbc.page.name}` : 'Facebook chưa sẵn sàng';
  }
}
function setFlowPill(st) {
  const pill = $('#pill-flow');
  if (!pill) return;
  pill.className = `pill ${st?.source ? 'ok' : 'bad'}`;
  pill.textContent = st?.source ? `Flow: ${st.source.email || st.source.name}` : 'Flow chưa sẵn sàng';
}
async function loadChromeStatus() {
  const [f, b] = await Promise.all([api('/api/flow/status').catch(() => null), api('/api/fbchrome/status').catch(() => null)]);
  setFlowPill(f);
  setFbc(b);
}

// Hộp quản lý "Chrome riêng" (chép profile, hiện/ẩn, kiểm tra đăng nhập) — dùng cho Chrome Flow và Chrome Facebook.
const CHROMES = {
  flow: { box: '#chromeflow-box', api: '/api/flow', name: 'Chrome Flow', site: 'Flow', checkLabel: 'Kiểm tra đăng nhập Flow',
    ok: (r) => `✓ Chrome Flow vào được Flow${r.email ? ` bằng <b>${esc(r.email)}</b>` : ''}. Sẵn sàng tự động.`,
    bad: (r) => `Chưa vào được Flow (đang ở ${esc(r.url)}). Bấm <b>Hiện cửa sổ</b> và đăng nhập Google/Flow trong cửa sổ Chrome Flow, rồi kiểm tra lại.` },
  fb: { box: '#chromefb-box', api: '/api/fbchrome', name: 'Chrome Facebook', site: 'Facebook', checkLabel: 'Kiểm tra đăng nhập Facebook',
    ok: (r) => `✓ Chrome Facebook đã đăng nhập${r.name ? ` (<b>${esc(r.name)}</b>)` : ''}${r.page ? ` và mở được Business Suite của Page <b>${esc(r.page)}</b>` : ''}. Sẵn sàng đăng.`,
    bad: (r) => `${esc(r.reason || 'Chưa đăng nhập Facebook')}. Bấm <b>Hiện cửa sổ</b>, tự đăng nhập Facebook (tài khoản quản trị Page) trong cửa sổ Chrome Facebook, rồi kiểm tra lại.`,
    extra: (st) => !st.source ? '' : `
      <div class="field" style="margin-top:2px">
        <span class="field-label">Page để đăng</span>
        <div class="row" style="margin-top:0">
          <select data-cb="page" class="grow-sel">${st.pages.length || st.page ? '' : '<option value="">— bấm "Lấy danh sách Page" —</option>'}
            ${[...new Set([...(st.page ? [st.page.name] : []), ...st.pages])].map((n) => `<option ${n === st.page?.name ? 'selected' : ''}>${esc(n)}</option>`).join('')}
          </select>
          <button class="small" data-cb="pages">${st.pages.length ? 'Tải lại danh sách' : 'Lấy danh sách Page'}</button>
        </div>
        <small class="muted">Lấy từ Business Suite của tài khoản trong Chrome Facebook — không cần API.</small>
      </div>` },
};
async function loadChromeBox(kind, extra = '') {
  const c = CHROMES[kind];
  const box = $(c.box);
  if (!box) return;
  let st;
  try { st = await api(`${c.api}/status`); } catch (e) { box.textContent = e.message; return; }
  const src = st.source;
  box.innerHTML = `
    <div>Trạng thái: <b style="color:${st.up ? 'var(--ok)' : 'var(--muted)'}">${st.up ? 'đang chạy' : 'chưa mở'}</b>${src ? ` · profile đã chép: <b>${esc(src.name)}</b>${src.email ? ` (${esc(src.email)})` : ''} · ${new Date(src.syncedAt).toLocaleString('vi-VN')}` : ' · chưa chép profile'}</div>
    <div class="row" style="margin-top:0">
      <select data-cb="profile" style="width:auto;max-width:100%">${st.profiles.map((p) => `<option value="${esc(p.dir)}" ${src?.dir === p.dir ? 'selected' : ''}>${esc(p.name)}${p.email ? ` — ${esc(p.email)}` : ''}</option>`).join('')}</select>
      <button class="small primary" data-cb="sync">${src ? 'Chép lại & mở' : 'Chép profile & mở'}</button>
    </div>
    ${src ? `<div class="row" style="margin-top:0">
      <button class="small" data-cb="show">Hiện cửa sổ</button><button class="small" data-cb="hide">Ẩn sang mép</button>
      <button class="small" data-cb="check">${c.checkLabel}</button>${st.up ? '<button class="small danger" data-cb="close">Tắt</button>' : ''}</div>` : ''}
    ${c.extra ? c.extra(st) : ''}
    ${extra}`;
  if (kind === 'fb') setFbc(st); else setFlowPill(st);
}
const loadChromeFlow = (extra) => loadChromeBox('flow', extra);

for (const [kind, c] of Object.entries(CHROMES)) {
  $(c.box)?.addEventListener('change', async (e) => {
    if (e.target.dataset?.cb !== 'page' || !e.target.value) return;
    const sel = e.target;
    sel.disabled = true;
    toast(`Đang chọn Page "${sel.value}" trong Business Suite…`, 30000);
    try {
      const r = await api(`${c.api}/page`, { method: 'POST', body: { name: sel.value } });
      toast(`Sẽ đăng lên "${r.name}"`);
    } catch (err) { toast(err.message, 8000); }
    loadChromeBox(kind);
  });
  $(c.box)?.addEventListener('click', async (e) => {
    const act = e.target.dataset?.cb;
    if (!act || act === 'profile' || act === 'page') return;
    const box = $(c.box);
    const b = e.target;
    const label = b.textContent;
    b.disabled = true;
    try {
      if (act === 'sync') {
        if (!confirm(`Chép profile Chrome đã chọn sang ${c.name} (ghi đè bản cũ) rồi mở cửa sổ ${c.name}?`)) return;
        b.textContent = 'Đang chép…';
        const r = await api(`${c.api}/sync`, { method: 'POST', body: { dir: box.querySelector('[data-cb=profile]').value } });
        return loadChromeBox(kind, `<div class="dialogue" style="margin:0">Đã chép <b>${esc(r.name)}</b> và mở ${c.name}. Bấm <b>${c.checkLabel}</b>; nếu chưa vào được thì đăng nhập trong cửa sổ đó.</div>`);
      }
      if (act === 'show' || act === 'hide') { await api(`${c.api}/show`, { method: 'POST', body: { show: act === 'show' } }); return loadChromeBox(kind); }
      if (act === 'close') { await api(`${c.api}/close`, { method: 'POST' }); return loadChromeBox(kind); }
      if (act === 'pages') {
        b.textContent = 'Đang lấy từ Business Suite…';
        const r = await api(`${c.api}/pages`, { method: 'POST' });
        return loadChromeBox(kind, `<div class="dialogue" style="margin:0">Tìm thấy ${r.pages.length} Page.</div>`);
      }
      if (act === 'check') {
        b.textContent = `Đang mở ${c.site}…`;
        const r = await api(`${c.api}/check`, { method: 'POST' });
        return loadChromeBox(kind, r.ok ? `<div class="dialogue" style="margin:0;color:#047857">${c.ok(r)}</div>` : `<div class="error-box" style="margin:0">${c.bad(r)}</div>`);
      }
    } catch (err) {
      toast(err.message, 8000);
    } finally {
      b.disabled = false;
      if (document.body.contains(b)) b.textContent = label;
    }
  });
}
$('#status-pills').addEventListener('click', (e) => { if (e.target.closest('.pill')) openAccounts(); });
$('#tab-videos').addEventListener('click', () => {
  const first = $('#job-list li[data-id]');
  if (first) openJob(first.dataset.id); else show('new');
});
$('#posts-sync').addEventListener('click', () => openPosts(true));
$('#posts-hide-done').addEventListener('change', async () => renderPosts(await api('/api/posts')));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-goto-posts]')) { e.preventDefault(); openPosts(true); }
  if (e.target.closest('[data-goto-accounts]')) { e.preventDefault(); openAccounts(); }
  const j = e.target.closest('[data-open-job]');
  if (j) { e.preventDefault(); openJob(j.dataset.openJob); }
});

$('#posts-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-post-act]');
  if (!b) return;
  const card = b.closest('[data-post]');
  const id = card.dataset.post;
  const act = b.dataset.postAct;
  try {
    b.disabled = true;
    if (act === 'reschedule' || act === 'soon') {
      const t = act === 'soon' ? new Date(Date.now() + 11.5 * 60 * 1000) : new Date(card.querySelector('[data-when]').value);
      if (Number.isNaN(t.getTime())) throw new Error('Chọn ngày giờ');
      if (!confirm(`${act === 'soon' ? 'Đăng sớm' : 'Hẹn đăng'} lúc ${t.toLocaleString('vi-VN')}? Tới giờ Facebook sẽ TỰ ĐĂNG công khai.`)) return;
      await api(`/api/posts/${id}/reschedule`, { method: 'POST', body: { at: Math.floor(t.getTime() / 1000) } });
      toast('Đã cập nhật giờ đăng');
    } else if (act === 'cancel') {
      if (!confirm('Huỷ bài này và XOÁ video khỏi Facebook? Không hoàn tác được.')) return;
      await api(`/api/posts/${id}/cancel`, { method: 'POST' });
      toast('Đã huỷ');
    } else {
      await api(`/api/posts/${id}/sync`, { method: 'POST' });
    }
    renderPosts(await api('/api/posts'));
  } catch (err) {
    toast(err.message, 7000);
    renderPosts(await api('/api/posts'));
  } finally {
    b.disabled = false;
  }
});

// ---------- Tài khoản Claude ----------
let clLogin = null; // phiên đăng nhập đang chờ dán mã

async function loadClaude() {
  const box = $('#cl-box');
  let accs;
  try { accs = await api('/api/claude/accounts'); } catch (e) { box.textContent = e.message; return; }
  const act = accs.find((a) => a.active) || accs[0];
  const pill = $('#pill-cl');
  if (pill) { pill.className = `pill ${act?.loggedIn ? 'ok' : 'bad'}`; pill.textContent = `Claude: ${act?.email || 'chưa đăng nhập'}`; }
  const label = (a) => `${a.email || '(chưa đăng nhập)'}${a.plan ? ` · ${a.plan}` : ''}${a.builtin ? ' · mặc định' : ''}`;
  box.innerHTML = `
    <span>Đang dùng: <span class="who">${esc(act?.email || 'chưa đăng nhập')}</span>${act?.plan ? ` <span class="badge">${esc(act.plan)}</span>` : ''}</span>
    ${accs.length > 1 ? `<select id="cl-active">${accs.map((a) => `<option value="${esc(a.id)}" ${a.active ? 'selected' : ''} ${a.loggedIn ? '' : 'disabled'}>${esc(label(a))}</option>`).join('')}</select>` : ''}
    ${clLogin ? `
      <div class="manual" style="margin-top:0">
        <b>Thêm tài khoản Claude</b>
        <ol class="howto" style="font-size:13px">
          <li><a href="${esc(clLogin.url)}" target="_blank" rel="noopener">Mở trang đăng nhập Claude</a> — đăng nhập đúng tài khoản muốn thêm (mở cửa sổ ẩn danh nếu trình duyệt đang đăng nhập tài khoản khác).</li>
          <li>Chép mã trang hiện ra, dán vào đây:</li>
        </ol>
        <input id="cl-code" placeholder="Dán mã vào đây" autocomplete="off">
        <div class="row" style="margin-top:6px"><button class="small primary" id="cl-submit">Xác nhận</button><button class="small" id="cl-cancel">Huỷ</button></div>
      </div>` : `
      <div class="row" style="margin-top:0">
        <button class="small" id="cl-add">＋ Thêm tài khoản</button>
        ${act && !act.builtin ? `<button class="small danger" id="cl-logout" data-id="${esc(act.id)}">Đăng xuất</button>` : ''}
      </div>`}`;
}

$('#cl-box').addEventListener('click', async (e) => {
  const id = e.target.id;
  try {
    if (id === 'cl-add') {
      e.target.disabled = true;
      e.target.textContent = 'Đang mở…';
      clLogin = await api('/api/claude/login/start', { method: 'POST' });
      await loadClaude();
      window.open(clLogin.url, '_blank', 'noopener');
    } else if (id === 'cl-submit') {
      e.target.disabled = true;
      e.target.textContent = 'Đang xác nhận…';
      const r = await api('/api/claude/login/code', { method: 'POST', body: { sessionId: clLogin.sessionId, code: $('#cl-code').value } });
      clLogin = null;
      toast(`Đã thêm và chuyển sang ${r.email}${r.plan ? ` (${r.plan})` : ''}`, 6000);
      await loadClaude();
    } else if (id === 'cl-cancel') {
      await api('/api/claude/login/cancel', { method: 'POST', body: { sessionId: clLogin?.sessionId } });
      clLogin = null;
      await loadClaude();
    } else if (id === 'cl-logout') {
      if (!confirm('Đăng xuất tài khoản Claude này khỏi web?')) return;
      await api('/api/claude/logout', { method: 'POST', body: { id: e.target.dataset.id } });
      toast('Đã đăng xuất, chuyển về tài khoản mặc định');
      await loadClaude();
    }
  } catch (err) {
    toast(err.message, 7000);
    if (id === 'cl-add') clLogin = null;
    await loadClaude();
  }
});
$('#cl-box').addEventListener('change', async (e) => {
  if (e.target.id !== 'cl-active') return;
  try {
    await api('/api/claude/active', { method: 'POST', body: { id: e.target.value } });
    toast('Đã đổi tài khoản Claude');
    await loadClaude();
  } catch (err) { toast(err.message); }
});

// ---------- Facebook ----------
async function loadFb() {
  fb = await api('/api/fb/status').catch(() => ({ connected: false }));
  const box = $('#fb-box');
  const sel = fb.pages?.find((p) => p.id === fb.selectedPageId);
  const appForm = (editing) => `
    <div class="manual" style="margin-top:0">
      <b>${editing ? 'Đổi app Facebook' : 'Cài app Facebook (làm 1 lần)'}</b>
      <ol class="howto" style="font-size:13px">
        <li>Vào <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> → <b>Tạo ứng dụng</b> (loại Doanh nghiệp), thêm trường hợp sử dụng <b>Quản lý mọi thứ trên Trang</b> và <b>Đăng nhập bằng Facebook</b>.</li>
        <li>Facebook Login → Cài đặt → <b>URI chuyển hướng OAuth hợp lệ</b>, thêm:
          <div class="row" style="margin-top:4px"><code id="fb-redirect">${esc(fb.app?.redirectUri || '')}</code><button type="button" class="small" id="fb-copy">Copy</button></div></li>
        <li>Cài đặt ứng dụng → Thông tin cơ bản: chép <b>App ID</b> và <b>App Secret</b> vào đây.</li>
      </ol>
      <input id="fb-app-id" placeholder="App ID (dãy số)" value="${esc(fb.app?.appId || '')}" inputmode="numeric" autocomplete="off">
      <input id="fb-app-secret" type="password" placeholder="App Secret (32 ký tự)" autocomplete="new-password" style="margin-top:6px">
      <div class="row" style="margin-top:8px"><button class="small primary" id="fb-app-save">Kiểm tra & lưu</button>${editing ? '<button class="small" id="fb-app-cancel">Huỷ</button>' : ''}</div>
      <small class="muted">App Secret được mã hoá, chỉ lưu trên máy này (data/settings.json).</small>
    </div>`;
  const appLine = () => fb.app?.appId ? `<small class="muted">App: ${esc(fb.app.name || fb.app.appId)} · ${fb.app.source === 'env' ? 'từ .env' : `<a href="#" id="fb-app-edit">đổi app</a>`}</small>` : '';
  if (fbEditingApp || (!fb.oauthReady && !fb.envPage)) {
    box.innerHTML = appForm(fbEditingApp && fb.oauthReady);
  } else if (!fb.connected) {
    box.innerHTML = `<span>${fb.envPage ? 'Đang dùng Page khai trong .env.' : 'Chưa kết nối.'}</span>
      ${fb.oauthReady ? '<button class="btn-fb block" id="fb-login">Đăng nhập Facebook</button>' : ''}${appLine()}`;
  } else {
    const days = fb.expiresAt ? Math.round((new Date(fb.expiresAt) - Date.now()) / 86400000) : null;
    box.innerHTML = `<span>Đã kết nối: <span class="who">${esc(fb.user.name)}</span>${days != null ? ` · còn ${days} ngày` : ''}</span>
      <label style="font-weight:400">Page để đăng
        <select id="fb-page">${fb.pages.length ? '' : '<option value="">(không có Page nào)</option>'}
          ${fb.pages.map((p) => `<option value="${esc(p.id)}" ${p.id === fb.selectedPageId ? 'selected' : ''} ${p.hasToken ? '' : 'disabled'}>${esc(p.name)}${p.canPost ? '' : ' (không có quyền đăng)'}</option>`).join('')}
        </select></label>
      <div class="row" style="margin-top:0"><button class="small" id="fb-login">Đăng nhập lại</button><button class="small danger" id="fb-out">Ngắt</button></div>${appLine()}`;
  }
}

$('#fb-box').addEventListener('click', async (e) => {
  const id = e.target.id;
  if (id === 'fb-copy') { navigator.clipboard.writeText($('#fb-redirect').textContent); toast('Đã copy URI chuyển hướng'); return; }
  if (id === 'fb-app-edit') { e.preventDefault(); fbEditingApp = true; return loadFb(); }
  if (id === 'fb-app-cancel') { fbEditingApp = false; return loadFb(); }
  if (id === 'fb-app-save') {
    e.target.disabled = true;
    e.target.textContent = 'Đang kiểm tra với Facebook…';
    try {
      const r = await api('/api/fb/app', { method: 'POST', body: { appId: $('#fb-app-id').value, appSecret: $('#fb-app-secret').value } });
      fbEditingApp = false;
      toast(`Đã lưu app "${r.name || r.appId}" — giờ bấm Đăng nhập Facebook`, 6000);
      return loadFb();
    } catch (err) {
      // Giữ nguyên những gì đã nhập để sửa lại.
      toast(err.message, 8000);
      e.target.disabled = false;
      e.target.textContent = 'Kiểm tra & lưu';
      return;
    }
  }
  if (e.target.id === 'fb-login') {
    const w = 600, h = 720;
    window.open('/api/fb/start', 'fb-login', `width=${w},height=${h},left=${(screen.width - w) / 2},top=${(screen.height - h) / 2}`);
  }
  if (e.target.id === 'fb-out' && confirm('Ngắt kết nối Facebook? Token đã lưu sẽ bị xoá.')) {
    await api('/api/fb/disconnect', { method: 'POST' });
    await loadFb();
    if (currentJob) renderJob(currentJob);
  }
});
$('#fb-box').addEventListener('change', async (e) => {
  if (e.target.id !== 'fb-page') return;
  try {
    await api('/api/fb/page', { method: 'POST', body: { pageId: e.target.value } });
    await loadFb();
    toast('Đã chọn Page');
    if (currentJob) renderJob(currentJob);
  } catch (err) { toast(err.message); }
});
// Popup đăng nhập báo kết quả về đây (chỉ nhận từ chính origin của web).
window.addEventListener('message', async (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'fb-login') return;
  toast(e.data.ok ? `Đã kết nối ${e.data.user} · ${e.data.pages} Page` : `Đăng nhập Facebook lỗi: ${e.data.error}`, 6000);
  await loadFb();
  if (currentJob) renderJob(currentJob);
});

// ---------- thao tác ----------
$('#view-job').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !currentJob) return;
  const id = currentJob.id;
  const i = Number(b.dataset.i);
  const n = currentJob.scenes.length;
  try {
    switch (b.dataset.act) {
      case 'script':
        if (currentJob.scenes.some((s) => s.clip) && !confirm('Viết lại kịch bản sẽ bỏ hết video các cảnh đã tạo. Tiếp tục?')) return;
        await api(`/api/jobs/${id}/script`, { method: 'POST' });
        break;
      case 'auto-run': {
        const n = currentJob.scenes.slice(i).filter((x, k) => k === 0 || !x.clip).length;
        if (!confirm(`Chrome Flow sẽ TỰ ĐIỀN và TỰ BẤM TẠO ${n} cảnh (từ cảnh ${i + 1}) bằng ${currentJob.flowModel || 'Veo 3.1 - Fast'} — mỗi cảnh trừ credit Flow. Tiếp tục?`)) return;
        await api(`/api/jobs/${id}/auto`, { method: 'POST', body: { from: i } });
        toast('Đã bắt đầu — theo dõi ở nhật ký và từng cảnh', 5000);
        break;
      }
      case 'restore-prompt':
        if (!confirm(`Bỏ bản prompt đã tự viết lại, dùng lại prompt gốc của cảnh ${i + 1}?`)) return;
        await api(`/api/jobs/${id}/scenes/${i}`, { method: 'PATCH', body: { restorePrompt: true } });
        break;
      case 'copy':
        await navigator.clipboard.writeText(currentJob.scenes[i].prompt);
        toast(`Đã copy prompt cảnh ${i + 1} (${currentJob.scenes[i].prompt.length} ký tự)`);
        return;
      case 'pick':
        filePicker.dataset.i = i;
        filePicker.click();
        return;
      case 'unclip':
        if (!confirm(`Bỏ clip cảnh ${i + 1}? Các cảnh sau (nếu có) sẽ bị đánh dấu lệch nối.`)) return;
        await api(`/api/jobs/${id}/scenes/${i}/clip`, { method: 'DELETE' });
        break;
      case 'compress':
        await api(`/api/jobs/${id}/compress`, { method: 'POST', body: { i } });
        break;
      case 'cancel':
        await api(`/api/jobs/${id}/cancel`, { method: 'POST' });
        break;
      case 'stitch':
        await api(`/api/jobs/${id}/stitch`, { method: 'POST', body: { removeWatermark: $('#wm').checked } });
        break;
      case 'facebook': {
        const mode = $('#fb-mode').value;
        const page = fbc.page?.name || 'Page';
        let scheduledAt = null;
        if (mode === 'schedule') {
          const t = new Date($('#fb-when').value);
          if (Number.isNaN(t.getTime())) return toast('Chọn ngày giờ đăng');
          scheduledAt = Math.floor(t.getTime() / 1000);
        }
        const msg = {
          schedule: `Hẹn đăng Reel này lên "${page}" lúc ${new Date(scheduledAt * 1000).toLocaleString('vi-VN')}? Tới giờ Facebook sẽ TỰ ĐĂNG công khai.`,
          publish: `ĐĂNG CÔNG KHAI Reel này lên "${page}" ngay bây giờ?`,
          draft: `Lưu Reel này thành NHÁP trên "${page}"?`,
        }[mode];
        if (!confirm(`${msg}\n\nChrome Facebook sẽ mở Business Suite và tự đăng như người đăng tay.`)) return;
        await api(`/api/jobs/${id}/facebook`, { method: 'POST', body: { mode, scheduledAt } });
        break;
      }
      case 'fb-refresh':
        await api(`/api/jobs/${id}/facebook/refresh`, { method: 'POST' });
        break;
    }
    refresh(true);
  } catch (err) {
    toast(err.message);
  }
});

// Đếm ký tự prompt khi đang gõ.
$('#view-job').addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.field !== 'prompt') return;
  const c = $(`[data-count="${el.dataset.i}"]`);
  if (c) { c.textContent = `${el.value.length}/${LIMIT} ký tự`; c.classList.toggle('over', el.value.length > LIMIT); }
});

// Lưu khi rời ô nhập.
$('#view-job').addEventListener('change', async (e) => {
  const el = e.target;
  if (!currentJob) return;
  if (el.id === 'txt-on' || el.id === 'txt-style') {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { text: el.id === 'txt-on' ? { enabled: el.checked } : { style: el.value } } }).catch((err) => toast(err.message));
    return refresh(true);
  }
  if (el.id === 'job-voice') {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { voice: el.value || null } }).catch((err) => toast(err.message));
    toast(el.value ? `Các cảnh điền từ giờ sẽ dùng giọng ${el.value === 'me' ? '@me (giọng của bạn)' : el.value}` : 'Bỏ giọng cố định');
    return refresh(true);
  }
  if (el.id === 'job-consistency' || el.id === 'job-flow-model') {
    const key = { 'job-consistency': 'consistency', 'job-flow-model': 'flowModel' }[el.id];
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { [key]: el.value } }).catch((err) => toast(err.message));
    return refresh(true);
  }
  const field = el.dataset.field;
  if (!field) return;
  try {
    if (field === 'caption') {
      await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { caption: el.value } });
    } else {
      await api(`/api/jobs/${currentJob.id}/scenes/${el.dataset.i}`, { method: 'PATCH', body: { [field]: el.value } });
    }
    toast('Đã lưu', 1200);
  } catch (err) {
    toast(err.message);
  }
});

// ---------- khởi động ----------
(async () => {
  cfg = await api('/api/config');
  const voiceOpts = (sel) => (cfg.voices || []).map((v) => `<option value="${esc(v.name)}" ${v.name === sel ? 'selected' : ''}>${v.name === 'me' ? '@me — giọng của tôi' : `${esc(v.name)} — ${esc(v.gender)}, ${esc(v.desc)}`}</option>`).join('');
  window.voiceOpts = voiceOpts;
  $('#voice-select').insertAdjacentHTML('beforeend', voiceOpts('me'));
  $('#flow-model-select').innerHTML = (cfg.flowModels || []).map((m) => `<option>${esc(m)}</option>`).join('');
  $('#status-pills').innerHTML = `
    <span class="pill" id="pill-cl">Claude…</span>
    <span class="pill" id="pill-flow">Flow…</span>
    <span class="pill" id="pill-fb">Facebook…</span>`;
  await Promise.all([loadFb(), loadChromeStatus()]);
  loadClaude(); // không chờ: kiểm tra tài khoản Claude mất vài giây
  durHint();
  await loadList();
  // Người dùng đã tự chuyển tab trong lúc trang đang tải → không tự mở video đầu tiên đè lên.
  if (!$('#view-posts').hidden || !$('#view-accounts').hidden || currentId) return;
  const first = $('#job-list li[data-id]');
  if (first) openJob(first.dataset.id);
  else show('new');
})();
