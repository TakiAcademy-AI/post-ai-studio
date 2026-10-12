const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let cfg = {};
let currentId = null;
let currentJob = null;
let pollTimer = null;
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
  for (const v of ['new', 'job', 'empty']) $(`#view-${v}`).hidden = v !== view;
}

const STAGE = {
  scripting: 'Đang viết kịch bản', script_failed: 'Lỗi kịch bản', script_ready: 'Chờ tạo cảnh',
  generating: 'Đang tạo cảnh', clips_ready: 'Đủ cảnh — chờ ghép', stitched: 'Đã ghép', posted_draft: 'Đã gửi nháp FB',
};

// ---------- danh sách ----------
async function loadList() {
  const jobs = await api('/api/jobs');
  $('#job-list').innerHTML = jobs.map((j) => `
    <li data-id="${j.id}" class="${j.id === currentId ? 'active' : ''}">
      ${esc(j.topic.slice(0, 60))}
      <div class="meta">${j.sceneCount} cảnh · ${esc(STAGE[j.stage] || j.stage)}${j.busy ? ' · ⏳' : ''}</div>
    </li>`).join('') || '<li class="muted">Chưa có video nào</li>';
}

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

const sceneSel = $('#form-new [name=sceneCount]');
const durHint = () => {
  const s = Number(sceneSel.value) * 8;
  $('#dur-hint').textContent = `≈ ${s} giây${s > 90 ? ' — vượt 90s, không đăng Reel được' : ''}`;
};
sceneSel.addEventListener('change', durHint);

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

function sceneMode(i, job) {
  if (i > 0) return 'khung đầu = khung cuối cảnh trước';
  return job.refImage ? 'ảnh nhân vật làm reference' : 'chỉ từ prompt';
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
          <div class="muted">${job.input.sceneCount} cảnh · model
            <select id="job-model" ${busy ? 'disabled' : ''} style="width:auto;padding:2px 6px">
              ${cfg.models.map((m) => `<option ${m === job.model ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
            · ${doneCount}/${job.scenes.length} cảnh có video · ${esc(STAGE[job.stage] || job.stage)}
          </div>
        </div>
        ${busy ? `<div class="busy"><span class="spin"></span>${esc(job.busy)}</div>` : ''}
      </div>
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
      <h2>A. Mạch video</h2>
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
      <h2>② Tạo video trên Flow</h2>
      <p class="muted" style="margin:0 0 8px">Tạo lần lượt từng cảnh, mỗi cảnh ~1,5–3 phút và <b>trừ credit Flow thật</b>. Cảnh 2 trở đi dùng khung cuối của cảnh trước làm khung đầu.</p>
      <div class="row">
        ${nextIdx >= 0
          ? `<button class="primary" data-act="gen-from" data-i="${nextIdx}" ${busy ? 'disabled' : ''}>
               ${nextIdx === 0 ? `Tạo cả ${job.scenes.length} cảnh` : `Tạo tiếp từ cảnh ${nextIdx + 1} (${job.scenes.length - nextIdx} cảnh)`}
             </button>`
          : ''}
        ${busy && job.stage === 'generating' ? `<button class="danger" data-act="cancel">Dừng sau cảnh này</button>` : ''}
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
            <h3>Cảnh ${i + 1} · ${esc(sc.title)}</h3>
            <span class="badge ${st}">${label}</span>
            <span class="muted" style="font-size:12px">${esc(sceneMode(i, job))}${sc.attempts ? ` · đã tạo ${sc.attempts} lần` : ''}</span>
          </div>
          <div class="dialogue">🎙 ${esc(sc.dialogue)}</div>
          <div class="ost">Chữ trên màn hình: ${esc(sc.onScreenText)}</div>
          ${sc.stale ? `<div class="error-box" style="color:var(--warn)">Cảnh trước đã được tạo lại nên khung đầu cảnh này không còn khớp. Nên tạo lại từ cảnh này.</div>` : ''}
          ${sc.error ? `<div class="error-box">${esc(sc.error)}</div>` : ''}
          <details ${sc.clip ? '' : 'open'}><summary>Prompt Flow (sửa được, tự lưu khi rời ô) ·
            <span class="${sc.prompt.length > LIMIT ? 'over' : ''}" data-count="${i}">${sc.prompt.length}/${LIMIT} ký tự</span></summary>
            <textarea class="prompt" rows="14" data-field="prompt" data-i="${i}" ${locked ? 'disabled' : ''}>${esc(sc.prompt)}</textarea>
          </details>
          <div class="row">
            <button class="small" data-act="gen-one" data-i="${i}" ${locked || (i > 0 && !job.scenes[i - 1].lastFrame) ? 'disabled' : ''}>
              ${sc.clip ? 'Tạo lại chỉ cảnh này' : 'Tạo riêng cảnh này'}</button>
            ${sc.prompt.length > LIMIT - 300 ? `<button class="small" data-act="compress" data-i="${i}" ${locked ? 'disabled' : ''}>Rút gọn prompt</button>` : ''}
            ${sc.clip && i < job.scenes.length - 1 ? `<button class="small" data-act="gen-from" data-i="${i}" ${locked ? 'disabled' : ''}>Tạo lại từ cảnh này trở đi</button>` : ''}
          </div>
        </div>
        <div class="player">
          ${sc.clip
            ? `<video src="${fileUrl(sc.clip)}" controls preload="metadata" playsinline></video>
               <div class="trim">
                 <label>Cắt đầu (s)<input type="number" min="0" max="4" step="0.1" value="${sc.trimStart}" data-field="trimStart" data-i="${i}" ${busy ? 'disabled' : ''}></label>
                 <label>Cắt cuối (s)<input type="number" min="0" max="4" step="0.1" value="${sc.trimEnd}" data-field="trimEnd" data-i="${i}" ${busy ? 'disabled' : ''}></label>
               </div>`
            : `<div class="ph">${sc.status === 'running' ? '<span class="busy"><span class="spin"></span>Flow đang render</span>' : 'Chưa có video'}</div>`}
        </div>
      </div>
    </div>`;
  }).join('');

  const allClips = job.scenes.every((s) => s.clip);
  const final = `
    <div class="card">
      <h2>③ Ghép & ④ Đăng nháp Facebook</h2>
      <div class="final">
        <div class="player">
          ${job.final ? `<video src="${fileUrl(job.final.file)}" controls preload="metadata" playsinline></video>
                         <div class="row"><a href="${fileUrl(job.final.file)}" download>Tải MP4</a> · ${job.final.duration.toFixed(1)}s</div>`
                      : `<div class="ph">Chưa ghép</div>`}
        </div>
        <div>
          <p class="muted" style="margin-top:0">Độ dài dự kiến ≈ ${total.toFixed(1)}s (Reel cho phép 3–90s). Ghép sẽ xoá watermark "Veo", cắt đầu/cuối theo từng cảnh, xuất 1080×1920.</p>
          <div class="row">
            <button data-act="stitch" class="${job.final ? '' : 'primary'}" ${busy || !allClips ? 'disabled' : ''}>${job.final ? 'Ghép lại' : 'Ghép video'}</button>
            <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="wm" checked style="width:auto"> Xoá watermark Veo</label>
          </div>
          ${job.scenes.some((s) => s.stale) ? `<div class="error-box" style="color:var(--warn)">Có cảnh bị lệch nối — vẫn ghép được nhưng chỗ nối sẽ giật.</div>` : ''}
          <label style="margin-top:16px">Caption Facebook
            <textarea rows="4" data-field="caption" ${busy ? 'disabled' : ''}>${esc(job.caption)}</textarea>
          </label>
          <div class="row">
            <button data-act="facebook" class="primary" ${busy || !job.final || !cfg.fbConfigured ? 'disabled' : ''}>Đăng nháp lên Page</button>
            ${!cfg.fbConfigured ? '<span class="muted">Chưa cấu hình FB_PAGE_ID / FB_PAGE_TOKEN trong .env</span>' : ''}
          </div>
          ${job.facebook ? `
            <div class="dialogue" style="margin-top:12px">
              Đã gửi nháp · video_id <code>${esc(job.facebook.videoId)}</code> · ${new Date(job.facebook.at).toLocaleString('vi-VN')}
              ${job.facebook.file !== job.final?.file ? '<br><b>Lưu ý:</b> bản nháp là video ghép trước đó, không phải bản hiện tại.' : ''}
              ${job.facebook.status ? `<br>Trạng thái: <code>${esc(JSON.stringify(job.facebook.status.status || job.facebook.status))}</code>` : ''}
              <div class="row"><button class="small" data-act="fb-refresh">Kiểm tra trạng thái</button>
              <a href="https://business.facebook.com/latest/content_calendar" target="_blank" rel="noopener">Mở Meta Business Suite</a></div>
            </div>` : ''}
        </div>
      </div>
    </div>`;

  $('#view-job').innerHTML = head + summary + genBar + scenes + final + logCard(job);
}

function logCard(job) {
  return `<div class="card"><details ${job.error ? 'open' : ''}><summary>Nhật ký</summary>
    <div class="log">${esc(job.log.join('\n'))}</div></details></div>`;
}

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
      case 'gen-from':
        if (!confirm(`Tạo ${n - i} cảnh (từ cảnh ${i + 1}) bằng ${currentJob.model}. Mỗi cảnh trừ credit Flow. Tiếp tục?`)) return;
        await api(`/api/jobs/${id}/generate`, { method: 'POST', body: { from: i } });
        break;
      case 'gen-one':
        if (!confirm(`Tạo cảnh ${i + 1} bằng ${currentJob.model} (trừ credit Flow).${currentJob.scenes[i].clip && i < n - 1 ? ' Các cảnh sau sẽ bị lệch nối.' : ''} Tiếp tục?`)) return;
        await api(`/api/jobs/${id}/generate`, { method: 'POST', body: { only: i } });
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
      case 'facebook':
        if (!confirm('Tải video này lên Page ở dạng NHÁP (chưa công khai)?')) return;
        await api(`/api/jobs/${id}/facebook`, { method: 'POST' });
        break;
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
  if (el.id === 'job-model') {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { model: el.value } }).catch((err) => toast(err.message));
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
  $('#model-select').innerHTML = cfg.models.map((m) => `<option ${m === cfg.defaultModel ? 'selected' : ''}>${m}</option>`).join('');
  $('#status-pills').innerHTML = `
    <span class="pill ${cfg.gflowFound ? 'ok' : 'bad'}">gflow ${cfg.gflowFound ? '✓' : '✗'}</span>
    <span class="pill ${cfg.fbConfigured ? 'ok' : 'bad'}">Facebook ${cfg.fbConfigured ? '✓' : 'chưa cấu hình'}</span>`;
  durHint();
  await loadList();
  const first = $('#job-list li[data-id]');
  if (first) openJob(first.dataset.id);
  else show('new');
})();
