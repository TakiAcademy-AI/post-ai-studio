const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let cfg = {};
let currentId = null;
let currentJob = null;
let pollTimer = null;
let bridgeNow = null;
let fb = { connected: false }; // trạng thái đăng nhập Facebook // cảnh đang chờ extension Flow
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
  for (const v of ['new', 'job', 'empty', 'posts']) $(`#view-${v}`).hidden = v !== view;
  $('#tab-posts').classList.toggle('active', view === 'posts');
  $('#tab-videos').classList.toggle('active', view !== 'posts');
}

const STAGE = {
  scripting: 'Đang viết kịch bản', script_failed: 'Lỗi kịch bản', script_ready: 'Chờ tạo cảnh',
  generating: 'Đang tạo cảnh', clips_ready: 'Đủ cảnh — chờ ghép', stitched: 'Đã ghép', posted_draft: 'Đã gửi nháp FB', posted: 'Đã đăng FB', scheduled: 'Đã hẹn giờ FB',
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
    const b = (await api('/api/bridge').catch(() => ({}))).pending || null;
    const bridgeChanged = JSON.stringify(b && [b.jobId, b.index]) !== JSON.stringify(bridgeNow && [bridgeNow.jobId, bridgeNow.index]);
    bridgeNow = b;
    if (bridgeChanged) force = true;
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
  const manual = job.mode !== 'gflow';
  const doneCount = job.scenes.filter((s) => s.clip).length;
  const total = job.scenes.reduce((a, s) => a + (s.duration || 8) - (s.trimStart || 0) - (s.trimEnd || 0), 0);
  const nextIdx = job.scenes.findIndex((s) => !s.clip);
  const fileUrl = (rel) => `/files/${job.id}/${rel}`;

  const head = `
    <div class="card">
      <div class="job-head">
        <div class="grow">
          <h1>${esc(job.input.topic)}</h1>
          <div class="muted">${job.input.sceneCount} cảnh ·
            <select id="job-mode" ${busy ? 'disabled' : ''} style="width:auto;padding:2px 6px">
              <option value="manual" ${manual ? 'selected' : ''}>Tự bấm trong Flow</option>
              <option value="gflow" ${manual ? '' : 'selected'}>Tự động qua gflow</option>
            </select>
            ${manual ? '' : `· model <select id="job-model" ${busy ? 'disabled' : ''} style="width:auto;padding:2px 6px">
              ${cfg.models.map((m) => `<option ${m === job.model ? 'selected' : ''}>${m}</option>`).join('')}
            </select>`}
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

  const genBar = manual ? `
    <div class="card">
      <h2>② Tạo video trong Flow (bán tự động)</h2>
      <ol class="howto">
        <li>Mở <a href="https://flow.google.com/" target="_blank" rel="noopener">Google Flow</a>, đặt khung <b>9:16</b>, chọn model (Veo 3.1 Fast/Lite…).</li>
        <li>Làm <b>lần lượt từ cảnh 1</b>: bấm <b>Copy prompt</b>, chọn đúng chế độ ghi ở từng cảnh, tải ảnh đi kèm vào Flow, bấm tạo.</li>
        <li>Tải mp4 từ Flow về, rồi <b>kéo file vào ô video của cảnh đó</b>. Web tự cắt khung cuối làm khung đầu cho cảnh sau.</li>
      </ol>
      <p class="muted" style="margin:8px 0 0">Có extension <b>Ads AI → Flow</b>: bấm <b>Điền cảnh vào Flow</b> → tab Flow (đang mở một dự án) tự điền → <b>bạn bấm nút tạo →</b>. Video xong extension tự tải 720p về web và tự điền cảnh sau.
      ${bridgeNow ? `<br>⏳ Đang chờ: cảnh ${bridgeNow.index + 1}${bridgeNow.jobId !== job.id ? ' (của video khác)' : ''}` : ''}</p>
    </div>` : `
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
          ${manual ? manualSteps(job, i) : ''}
          <div class="row" ${manual ? 'hidden' : ''}>
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
            : `<div class="ph ${manual ? 'drop' : ''}" data-drop="${i}">${sc.status === 'running'
                ? '<span class="busy"><span class="spin"></span>Flow đang render</span>'
                : manual ? 'Kéo file mp4 từ Flow vào đây<br>hoặc bấm để chọn file' : 'Chưa có video'}</div>`}
          ${manual && sc.clip ? `<button class="small block" style="margin-top:8px" data-act="pick" data-i="${i}" ${busy ? 'disabled' : ''}>Thay clip khác…</button>
             <button class="small block danger" style="margin-top:6px" data-act="unclip" data-i="${i}" ${busy ? 'disabled' : ''}>Bỏ clip cảnh này</button>` : ''}
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
          <div class="row" style="align-items:center">
            <select id="fb-mode" style="width:auto">
              <option value="schedule" selected>Hẹn giờ đăng</option>
              <option value="publish">Đăng ngay (công khai)</option>
              <option value="draft">Lưu nháp (khó tìm lại trên Facebook)</option>
            </select>
            <input type="datetime-local" id="fb-when" style="width:auto" value="${defaultWhen()}">
            <button data-act="facebook" class="primary" ${busy || !job.final || !cfg.fbConfigured ? 'disabled' : ''}>Đăng lên ${esc(fb.pages?.find((p) => p.id === fb.selectedPageId)?.name || 'Page')}</button>
          </div>
          ${!cfg.fbConfigured ? '<div class="muted">Chưa kết nối Facebook — bấm <b>Đăng nhập Facebook</b> ở cột trái rồi chọn Page.</div>' : ''}
          ${job.facebook ? `
            <div class="dialogue" style="margin-top:12px">
              ${{ published: 'Đã đăng công khai', scheduled: `Đã hẹn đăng lúc ${job.facebook.scheduledAt ? new Date(job.facebook.scheduledAt).toLocaleString('vi-VN') : ''}`, draft: 'Đã gửi nháp' }[job.facebook.state || (job.facebook.published ? 'published' : 'draft')]}${job.facebook.pageName ? ` lên <b>${esc(job.facebook.pageName)}</b>` : ''} · video_id <code>${esc(job.facebook.videoId)}</code> · ${new Date(job.facebook.at).toLocaleString('vi-VN')}
              ${job.facebook.file !== job.final?.file ? '<br><b>Lưu ý:</b> bản nháp là video ghép trước đó, không phải bản hiện tại.' : ''}
              ${job.facebook.status?.status?.publishing_phase?.publish_status ? `<br>Facebook: <b>${esc(job.facebook.status.status.video_status)}</b> · ${esc(job.facebook.status.status.publishing_phase.publish_status)}` : ''}
              <div class="row"><button class="small" data-act="fb-refresh">Kiểm tra trạng thái</button>
              <a href="https://www.facebook.com/reel/${encodeURIComponent(job.facebook.videoId)}" target="_blank" rel="noopener">Mở reel</a>
              <a href="#" data-goto-posts>Quản lý ở tab Lịch đăng</a></div>
            </div>` : ''}
        </div>
      </div>
    </div>`;

  $('#view-job').innerHTML = head + summary + genBar + scenes + final + logCard(job);
}

function manualSteps(job, i) {
  const fileUrl = (rel) => `/files/${job.id}/${rel}`;
  let how;
  if (i === 0 && job.refImage) {
    how = `Chế độ <b>Ingredients to Video</b> (Thành phần) · thêm <a href="${fileUrl(job.refImage)}" download="nhan-vat.jpg">ảnh nhân vật</a>`;
  } else if (i === 0) {
    how = 'Chế độ <b>Text to Video</b> (chỉ prompt)';
  } else {
    const prev = job.scenes[i - 1];
    how = prev.lastFrame
      ? `Chế độ <b>Frames to Video</b> · khung đầu: <a href="${fileUrl(prev.lastFrame)}" download="canh-${i + 1}-khung-dau.jpg">tải khung cuối cảnh ${i}</a>`
      : `Chế độ <b>Frames to Video</b> · <span class="over">cần có clip cảnh ${i} trước để lấy khung đầu</span>`;
  }
  return `<div class="manual">
    <div>${how}</div>
    <div class="row">
      <button class="small primary" data-act="bridge" data-i="${i}" ${i > 0 && !job.scenes[i - 1].lastFrame ? 'disabled' : ''}>
        ${bridgeNow?.jobId === job.id && bridgeNow?.index === i ? '⏳ Đã điền — chờ bấm tạo trong Flow' : `Điền cảnh ${i + 1} vào Flow`}</button>
      <button class="small" data-act="copy" data-i="${i}">Copy prompt</button>
      ${job.scenes[i].clip ? '' : `<button class="small" data-act="pick" data-i="${i}">Chọn file mp4…</button>`}</div>
  </div>`;
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
        ${p.state !== 'deleted' ? `<a href="https://www.facebook.com/reel/${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Mở reel</a>` : ''}
      </div>
    </div>`;
  }).join('');
}

$('#tab-posts').addEventListener('click', () => openPosts(false));
$('#tab-videos').addEventListener('click', () => {
  const first = $('#job-list li[data-id]');
  if (first) openJob(first.dataset.id); else show('new');
});
$('#posts-sync').addEventListener('click', () => openPosts(true));
$('#posts-hide-done').addEventListener('change', async () => renderPosts(await api('/api/posts')));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-goto-posts]')) { e.preventDefault(); openPosts(true); }
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

// ---------- Facebook ----------
async function loadFb() {
  fb = await api('/api/fb/status').catch(() => ({ connected: false }));
  const box = $('#fb-box');
  const sel = fb.pages?.find((p) => p.id === fb.selectedPageId);
  if (!fb.oauthReady && !fb.envPage) {
    box.innerHTML = '<span>Chưa cấu hình FB_APP_ID / FB_APP_SECRET trong .env</span>';
  } else if (!fb.connected) {
    box.innerHTML = `<span>${fb.envPage ? 'Đang dùng Page khai trong .env.' : 'Chưa kết nối.'}</span>
      ${fb.oauthReady ? '<button class="btn-fb block" id="fb-login">Đăng nhập Facebook</button>' : ''}`;
  } else {
    const days = fb.expiresAt ? Math.round((new Date(fb.expiresAt) - Date.now()) / 86400000) : null;
    box.innerHTML = `<span>Đã kết nối: <span class="who">${esc(fb.user.name)}</span>${days != null ? ` · còn ${days} ngày` : ''}</span>
      <label style="font-weight:400">Page để đăng
        <select id="fb-page">${fb.pages.length ? '' : '<option value="">(không có Page nào)</option>'}
          ${fb.pages.map((p) => `<option value="${esc(p.id)}" ${p.id === fb.selectedPageId ? 'selected' : ''} ${p.hasToken ? '' : 'disabled'}>${esc(p.name)}${p.canPost ? '' : ' (không có quyền đăng)'}</option>`).join('')}
        </select></label>
      <div class="row" style="margin-top:0"><button class="small" id="fb-login">Đăng nhập lại</button><button class="small danger" id="fb-out">Ngắt</button></div>`;
  }
  const pill = $('#pill-fb');
  if (pill) {
    const ok = Boolean(sel || fb.envPage);
    pill.className = `pill ${ok ? 'ok' : 'bad'}`;
    pill.textContent = ok ? `Facebook: ${sel ? sel.name : 'Page .env'}` : 'Facebook chưa kết nối';
  }
  cfg.fbConfigured = Boolean(sel || fb.envPage);
}

$('#fb-box').addEventListener('click', async (e) => {
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
      case 'gen-from':
        if (!confirm(`Tạo ${n - i} cảnh (từ cảnh ${i + 1}) bằng ${currentJob.model}. Mỗi cảnh trừ credit Flow. Tiếp tục?`)) return;
        await api(`/api/jobs/${id}/generate`, { method: 'POST', body: { from: i } });
        break;
      case 'gen-one':
        if (!confirm(`Tạo cảnh ${i + 1} bằng ${currentJob.model} (trừ credit Flow).${currentJob.scenes[i].clip && i < n - 1 ? ' Các cảnh sau sẽ bị lệch nối.' : ''} Tiếp tục?`)) return;
        await api(`/api/jobs/${id}/generate`, { method: 'POST', body: { only: i } });
        break;
      case 'bridge':
        await api(`/api/jobs/${id}/bridge`, { method: 'POST', body: { i } });
        toast(`Cảnh ${i + 1} đang được điền vào tab Flow (cần mở sẵn một dự án) — bạn chỉ bấm nút tạo →`, 6000);
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
        const page = fb.pages?.find((p) => p.id === fb.selectedPageId)?.name || 'Page';
        let scheduledAt = null;
        if (mode === 'schedule') {
          const t = new Date($('#fb-when').value);
          if (Number.isNaN(t.getTime())) return toast('Chọn ngày giờ đăng');
          scheduledAt = Math.floor(t.getTime() / 1000);
        }
        const msg = {
          schedule: `Hẹn đăng Reel này lên "${page}" lúc ${new Date(scheduledAt * 1000).toLocaleString('vi-VN')}? Tới giờ Facebook sẽ TỰ ĐĂNG công khai.`,
          publish: `ĐĂNG CÔNG KHAI Reel này lên "${page}" ngay bây giờ?`,
          draft: `Lưu Reel này thành NHÁP trên "${page}"? Lưu ý: nháp tạo qua API khó tìm lại trong Business Suite.`,
        }[mode];
        if (!confirm(msg)) return;
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
  if (el.id === 'job-model' || el.id === 'job-mode') {
    const key = el.id === 'job-model' ? 'model' : 'mode';
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
  $('#model-select').innerHTML = cfg.models.map((m) => `<option ${m === cfg.defaultModel ? 'selected' : ''}>${m}</option>`).join('');
  $('#status-pills').innerHTML = `
    <span class="pill ${cfg.gflowFound ? 'ok' : 'bad'}">gflow ${cfg.gflowFound ? '✓' : '✗'}</span>
    <span class="pill" id="pill-fb">Facebook…</span>`;
  await loadFb();
  durHint();
  await loadList();
  const first = $('#job-list li[data-id]');
  if (first) openJob(first.dataset.id);
  else show('new');
})();
