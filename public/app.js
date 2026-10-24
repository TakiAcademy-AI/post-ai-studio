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
  for (const v of ['new', 'job', 'empty', 'posts', 'accounts', 'perf', 'auto', 'boss', 'scout']) $(`#view-${v}`).hidden = v !== view;
  $('#tab-scout').classList.toggle('active', view === 'scout');
  $('#tab-boss').classList.toggle('active', view === 'boss');
  $('#tab-posts').classList.toggle('active', view === 'posts');
  $('#tab-accounts').classList.toggle('active', view === 'accounts');
  $('#tab-perf').classList.toggle('active', view === 'perf');
  $('#tab-auto').classList.toggle('active', view === 'auto');
  $('#tab-videos').classList.toggle('active', !['posts', 'accounts', 'perf', 'auto', 'boss', 'scout'].includes(view));
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

  const reviewBox = job.review ? `
    <div class="card"><h2>Tự chấm khả năng viral: <span class="${job.review.score >= 70 ? '' : 'over'}">${job.review.score}/100</span> · ${esc(job.review.verdict)}</h2>
      <div style="font-size:13.5px"><b>Điểm mạnh:</b> ${esc(job.review.strengths)}<br><b>Điểm trừ:</b> ${esc(job.review.issues)}${job.review.verdict !== 'đăng' ? `<br><b>Cách sửa:</b> ${esc(job.review.fixes)}` : ''}</div></div>` : '';

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
      ${job.voice === 'me' ? `<div class="look">
        ${job.look?.preview ? `<a href="${fileUrl(job.look.preview)}?t=${encodeURIComponent(job.look.at || '')}" target="_blank" rel="noopener"><img src="${fileUrl(job.look.preview)}?t=${encodeURIComponent(job.look.at || '')}" alt="Ảnh nhân vật"></a>` : '<div class="look-ph">Ảnh nhân vật</div>'}
        <div>
          <b>Ảnh nhân vật + @me · model Omni 1.1 Flash</b>
          <p class="muted" style="margin:4px 0 6px;font-size:13px">Flow vẽ chính bạn (@me) mặc đúng trang phục DNA, rồi mọi cảnh gắn ảnh đó (chọn trong thư viện dự án, không tải lên) cùng @me — áo đồng nhất ngay từ đầu. ${job.look ? (job.look.project !== job.flowProject ? '<span class="over">Dự án Flow đã đổi — sẽ tạo lại.</span>' : '') : 'Tự tạo khi bấm Tự tạo cảnh.'}</p>
          ${job.outfit ? `<div style="font-size:12.5px"><b>Trang phục:</b> ${esc(job.outfit.text)} <span class="muted">· tránh: ${esc(job.outfit.avoid)}</span></div>` : ''}
          <button class="small" data-act="look" style="margin-top:6px" ${busy ? 'disabled' : ''}>${job.look ? '↻ Tạo lại ảnh nhân vật' : 'Tạo ảnh nhân vật ngay'}</button>
        </div>
      </div>` : ''}
      <div class="auto-box">
        <div class="row" style="margin:0">
          ${job.voice === 'me' ? '<span style="font-weight:600;font-size:14px">Model Flow: Omni 1.1 Flash <small class="muted" style="display:inline;font-weight:500">(bắt buộc với @me)</small></span>' : `<label style="display:flex;gap:8px;align-items:center;font-weight:600">Model Flow:
            <select id="job-flow-model" style="width:auto;margin:0" ${busy ? 'disabled' : ''}>
              ${(cfg.flowModels || []).map((m) => `<option ${m === (job.flowModel || 'Veo 3.1 - Fast') ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select></label>`}
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
                         <div class="row"><a href="${fileUrl(job.final.file)}" download>Tải MP4</a> · ${job.final.duration.toFixed(1)}s${job.final.subs ? ' · có Việt sub' : ''}</div>
                         <div class="thumb-box"><div class="muted" style="font-size:12.5px;margin:8px 0 4px">Ảnh bìa (tự tải lên khi đăng)</div>
                           ${job.thumbnail?.file ? `<img src="${fileUrl(job.thumbnail.file)}?t=${encodeURIComponent(job.thumbnail.at || '')}" alt="Ảnh bìa" style="width:140px;border-radius:10px;display:block">` : '<div class="muted" style="font-size:12.5px">Chưa có</div>'}
                           <div class="row" style="flex-wrap:nowrap;gap:6px"><input id="thumb-text" value="${esc(job.thumbnail?.text || job.thumbnailText || '')}" placeholder="Chữ trên ảnh bìa (3–7 từ)" style="flex:1"><button class="small" data-act="thumb">Tạo lại ảnh bìa</button></div></div>`
                      : `<div class="ph">Chưa ghép</div>`}
        </div>
        <div>
          <p class="muted" style="margin-top:0">Độ dài dự kiến ≈ ${total.toFixed(1)}s (Reel cho phép 3–90s). Ghép sẽ xoá watermark "Veo", cắt đầu/cuối theo từng cảnh, thêm Việt sub karaoke (nếu bật, +~1 phút), chèn chữ (nếu bật), xuất 1080×1920.</p>
          <div class="row">
            <button data-act="stitch" class="${job.final ? '' : 'primary'}" ${busy || !allClips ? 'disabled' : ''}>${job.final ? 'Ghép lại' : 'Ghép video'}</button>
            <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="wm" checked style="width:auto"> Xoá watermark Veo</label>
            <label style="font-weight:400;display:flex;gap:6px;align-items:center" title="Phụ đề karaoke theo video chuẩn: 1–3 chữ in hoa, từ đang đọc màu vàng; chữ lấy đúng lời thoại kịch bản"><input type="checkbox" id="subs-on" ${job.subs?.enabled === false || job.input?.subs === false ? '' : 'checked'} style="width:auto"> Việt sub</label>
            <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="txt-on" ${job.text?.enabled === true ? 'checked' : ''} style="width:auto"> Chèn chữ</label>
            <select id="txt-style" style="width:auto" ${job.text?.enabled === true ? '' : 'disabled'}>
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

  $('#view-job').innerHTML = head + reviewBox + summary + genBar + scenes + final + logCard(job);
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
    <div class="ov-head"><span>Chữ trên màn hình <small class="muted" style="display:inline">· chỉ chèn khi bật "Chèn chữ" lúc ghép</small></span>
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
  return `<div class="manual"><div>Tự động: ${job.voice === 'me' ? `Thành phần: ${job.look ? 'ảnh nhân vật + ' : ''}<b>@me</b> (Omni)${job.scenes[i].outfitSeen ? ` · áo: ${job.scenes[i].outfitOk ? '✓' : '<span class="over">✗</span>'} ${esc(job.scenes[i].outfitSeen)}` : ''}` : job.refImage && (job.consistency || 'identity') === 'identity' ? 'Thành phần (ảnh nhân vật' + (i ? ' + khung cuối cảnh trước' : '') + ')' : i ? 'Khung hình (khung cuối cảnh trước)' : 'chỉ prompt'}${job.voice && job.voice !== 'me' ? ` · giọng <b>${esc(job.voice)}</b>` : ''}</div>
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
    .sort((a, b) => (b.scheduledAt || b.createdAt).localeCompare(a.scheduledAt || a.createdAt)); // mới nhất (giờ đăng / giờ tạo) lên trên
  if (!list.length) {
    $('#posts-list').innerHTML = '<div class="card muted">Chưa có bài nào. Ghép video xong → chọn "Hẹn giờ đăng" ở cuối trang video.</div>';
    return;
  }
  $('#posts-list').innerHTML = list.map((p) => {
    const when = p.scheduledAt ? new Date(p.scheduledAt) : null;
    const editable = p.state === 'scheduled' || p.state === 'draft';
    return `<div class="card post" data-post="${esc(p.id)}">
      <div class="when">${(when || new Date(p.createdAt)).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
        <small><br>${(when || new Date(p.createdAt)).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}${when ? '' : '<br>tạo lúc (chưa hẹn giờ)'}</small></div>
      <div>
        <div><span class="badge ${p.state}">${p.state === 'scheduled' && when && when < new Date() ? 'Đã tới giờ đăng' : POST_STATE[p.state] || p.state}</span> <b>${esc(p.pageName || 'Page')}</b></div>
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
  loadBrain();
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
      case 'look':
        if (currentJob.look && !confirm('Tạo lại ảnh nhân vật? Các cảnh đã tạo theo ảnh cũ có thể lệch áo — nên tạo lại các cảnh sau đó.')) return;
        await api(`/api/jobs/${id}/look`, { method: 'POST' });
        break;
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
      case 'thumb':
        b.disabled = true;
        await api(`/api/jobs/${id}/thumbnail`, { method: 'POST', body: { text: $('#thumb-text').value } });
        toast('Đã tạo lại ảnh bìa');
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
  if (el.id === 'subs-on') {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { subs: { enabled: el.checked } } }).catch((err) => toast(err.message));
    if (currentJob.scenes.every((x) => x.clip)) toast('Đã đổi Việt sub — bấm "Ghép video" để áp dụng', 4000);
    return refresh(true);
  }
  if (el.id === 'txt-on' || el.id === 'txt-style') {
    await api(`/api/jobs/${currentJob.id}`, { method: 'PATCH', body: { text: el.id === 'txt-on' ? { enabled: el.checked } : { style: el.value } } }).catch((err) => toast(err.message));
    if (currentJob.scenes.every((x) => x.clip)) toast('Đã đổi phần chữ — bấm "Ghép video" để áp dụng', 4000);
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

// ---------- Hiệu quả & sổ tay tối ưu ----------
let perfTimer = null;
async function openPerf() {
  currentId = null;
  stopPoll();
  show('perf');
  await loadPerf();
}
$('#tab-perf').addEventListener('click', openPerf);

const fmtN = (n) => (n == null ? '–' : Number(n).toLocaleString('vi-VN'));
async function loadPerf() {
  clearTimeout(perfTimer);
  const [ins, pb] = await Promise.all([api('/api/insights').catch((e) => ({ rows: [], lastError: e.message })), api('/api/playbook').catch(() => ({}))]);
  const pages = Object.values(ins.pages || {});
  $('#perf-status').innerHTML = (ins.running ? '<span class="busy"><span class="spin"></span>Đang đọc số liệu từ Business Suite…</span> ' : '')
    + (pages.length ? pages.map((p) => `${esc(p.name)}: cập nhật ${p.collectedAt ? new Date(p.collectedAt).toLocaleString('vi-VN') : 'chưa'}`).join(' · ') : 'Chưa có số liệu — bấm "Cập nhật số liệu".')
    + (ins.lastError ? ` <span class="over">· Lỗi lần trước: ${esc(ins.lastError)}</span>` : '');
  $('#perf-collect').disabled = Boolean(ins.running);
  if (ins.running) perfTimer = setTimeout(loadPerf, 5000);

  const rows = (ins.rows || []).filter((r) => r.ageH >= 24 && r.durationSec).sort((a, b) => (b.derived.watchPct ?? -1) - (a.derived.watchPct ?? -1));
  const young = (ins.rows || []).filter((r) => r.ageH < 24).length;
  $('#perf-table').innerHTML = rows.length ? `
    <thead><tr><th>#</th><th>Reel</th><th>Đăng</th><th>Dài</th><th>Lượt xem</th><th>Tiếp cận</th><th>Xem TB</th><th>% xem</th><th>Giữ 3s</th><th>Tương tác</th><th>Chia sẻ</th><th>Bình luận</th><th>Theo dõi</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td class="t">${r.source === 'Post AI' ? '<span class="badge done">Post AI</span> ' : ''}${esc(r.title.slice(0, 90))}</td>
      <td>${new Date(r.postedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
      <td>${r.durationSec ?? '–'}s</td><td>${fmtN(r.metrics.views)}</td><td>${fmtN(r.metrics.reach)}</td>
      <td>${r.metrics.avgWatchSec ?? '–'}s</td><td><b>${r.derived.watchPct ?? '–'}%</b></td><td>${r.derived.hold3sPct ?? '–'}%</td>
      <td>${fmtN(r.metrics.engagements)} <small class="muted" style="display:inline">(${r.derived.engRatePct ?? '–'}%)</small></td>
      <td>${fmtN(r.metrics.shares)}</td><td>${fmtN(r.metrics.comments)}</td><td>${fmtN(r.metrics.follows)}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="muted">Chưa có Reel nào đủ 24 giờ.</td></tr></tbody>';

  const d = pb.draft;
  $('#pb-card').innerHTML = `
    <h2>Sổ tay tối ưu ${pb.text ? `<span class="badge ${pb.enabled ? 'done' : ''}">${pb.enabled ? 'đang dùng khi viết kịch bản' : 'đang tắt'}</span>` : ''}</h2>
    <p class="muted" style="margin:0 0 10px;font-size:13px">Claude đọc công thức + số liệu ${rows.length} Reel (≥ 24 giờ) và đề xuất quy tắc. Dưới ~20–30 video, quy luật còn nhiều may rủi — xem như gợi ý. ${young ? `(${young} Reel dưới 24 giờ chưa tính.)` : ''}</p>
    ${d ? `<div class="manual" style="border-color:rgba(109,93,252,.35)">
      <b>Bản đề xuất mới</b> · dựa trên ${d.basedOn} Reel · độ tin cậy <b>${esc(d.confidence)}</b> · ${new Date(d.at).toLocaleString('vi-VN')}
      <textarea id="pb-draft" rows="10" style="margin-top:8px">${esc(d.text)}</textarea>
      <details><summary>Căn cứ so sánh</summary><div style="white-space:pre-wrap;font-size:13px">${esc(d.evidence)}</div></details>
      ${d.topics?.length ? `<div style="font-size:13px;margin-top:6px"><b>Chủ đề nên làm tiếp:</b> ${d.topics.map((t) => `<a href="#" class="pb-topic" data-t="${esc(t)}">${esc(t)}</a>`).join(' · ')}</div>` : ''}
      <div class="row"><button class="primary small" id="pb-approve">Duyệt & dùng sổ tay này</button><button class="small" id="pb-discard">Bỏ bản đề xuất</button></div>
    </div>` : ''}
    ${pb.text ? `<label style="margin-top:10px">Sổ tay đang áp dụng (sửa được)
      <textarea id="pb-text" rows="8">${esc(pb.text)}</textarea></label>
      ${pb.topics?.length ? `<div style="font-size:13px;margin-top:6px"><b>Chủ đề gợi ý:</b> ${pb.topics.map((t) => `<a href="#" class="pb-topic" data-t="${esc(t)}">${esc(t)}</a>`).join(' · ')}</div>` : ''}
      <div class="row"><button class="small" id="pb-save">Lưu sửa đổi</button>
        <label style="font-weight:400;display:flex;gap:6px;align-items:center"><input type="checkbox" id="pb-enabled" ${pb.enabled ? 'checked' : ''} style="width:auto"> Dùng sổ tay khi viết kịch bản mới</label></div>` : ''}
    <div class="row"><button class="${pb.text ? '' : 'primary'}" id="pb-analyze" ${rows.length ? '' : 'disabled'}>${pb.text ? 'Phân tích lại & đề xuất cập nhật' : 'Phân tích & đề xuất sổ tay'}</button></div>`;
}

$('#perf-collect').addEventListener('click', async (e) => {
  e.target.disabled = true;
  api('/api/insights/collect', { method: 'POST' }).then(() => toast('Đã cập nhật số liệu')).catch((err) => toast(err.message, 8000)).finally(loadPerf);
  setTimeout(loadPerf, 800);
});
$('#pb-card').addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.classList.contains('pb-topic')) { e.preventDefault(); show('new'); $('#form-new [name=topic]').value = t.dataset.t; $('#form-new [name=topic]').focus(); return; }
    if (t.id === 'pb-analyze') { t.disabled = true; t.textContent = 'Claude đang phân tích…'; await api('/api/playbook/analyze', { method: 'POST' }); return loadPerf(); }
    if (t.id === 'pb-approve') { await api('/api/playbook/approve', { method: 'POST', body: { text: $('#pb-draft').value } }); toast('Đã duyệt — sổ tay sẽ dùng khi viết kịch bản mới'); return loadPerf(); }
    if (t.id === 'pb-discard') { await api('/api/playbook/discard', { method: 'POST' }); return loadPerf(); }
    if (t.id === 'pb-save') { await api('/api/playbook/approve', { method: 'POST', body: { text: $('#pb-text').value } }); toast('Đã lưu sổ tay'); return loadPerf(); }
  } catch (err) { toast(err.message, 8000); loadPerf(); }
});
$('#pb-card').addEventListener('change', async (e) => {
  if (e.target.id === 'pb-enabled') { await api('/api/playbook/enabled', { method: 'POST', body: { on: e.target.checked } }).catch((err) => toast(err.message)); loadPerf(); }
});

// ---------- Tự nuôi kênh (nhiều kênh) ----------
let apTimer = null;
let apData = null;
let apCid = (() => { try { return localStorage.getItem('apCid'); } catch { return null; } })();
async function openAuto() {
  currentId = null;
  stopPoll();
  show('auto');
  await loadAuto(true);
}
$('#tab-auto').addEventListener('click', openAuto);

const VN_MS = 7 * 3600 * 1000;
const vnTime = (iso) => { const d = new Date(Date.parse(iso) + VN_MS); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const apCh = () => apData?.channels.find((c) => c.id === apCid);
const chUrl = (p = '') => `/api/autopilot/channels/${apCid}${p}`;
function renderSlots(slots) {
  $('#ap-slots').innerHTML = slots.map((t, i) => `<span class="slot"><input type="time" value="${esc(t)}" data-slot="${i}"><button class="small" data-slot-del="${i}" title="Xoá">✕</button></span>`).join('');
}
async function loadAuto(fill = false) {
  clearTimeout(apTimer);
  const d = await api('/api/autopilot').catch((e) => { toast(e.message); return null; });
  if (!d) return;
  apData = d;
  if (!apCh()) { apCid = d.channels[0]?.id || null; fill = true; }
  const st = d.status;
  const running = st.running ? d.channels.find((c) => c.id === st.current?.cid) : null;
  $('#ap-status').innerHTML = [
    running ? `<span class="busy"><span class="spin"></span>Đang làm video cho <b>${esc(running.name)}</b> · ${vnTime(st.current.slot)} — ${esc(st.current.step || '')}</span>` : '<span class="muted">Dây chuyền đang rảnh</span>',
    !(d.ready.flow && d.ready.fb) ? '<span class="over">Thiếu: ' + [!d.ready.flow && 'Chrome Flow', !d.ready.fb && 'Chrome Facebook'].filter(Boolean).join(', ') + ' (tab Tài khoản)</span>' : '',
  ].filter(Boolean).join(' · ');
  const next = (c) => { const p = new Map(c.plan.map((x) => [x.slot, x])); const s = c.upcoming.find((x) => !p.has(x)); return s ? vnTime(s) : '—'; };
  $('#ap-chans').innerHTML = d.channels.map((c) => `<button class="ap-chan ${c.id === apCid ? 'on' : ''}" data-ch="${c.id}">
      <span class="dot ${c.enabled ? 'ok' : ''}"></span><b>${esc(c.name)}</b>
      <small>${esc(c.page?.name || 'chưa chọn Page')} · ${c.slots.length} video/ngày · ${c.postMode === 'draft' ? 'đăng nháp' : 'hẹn giờ'} · tới: ${next(c)}</small></button>`).join('')
    + '<button class="ap-chan add" id="ap-add">＋ Thêm kênh</button>';
  const ch = apCh();
  if (!ch) { $('#ap-plan').innerHTML = '<div class="muted">Chưa có kênh — bấm "＋ Thêm kênh".</div>'; return; }
  $('#ap-enabled').checked = ch.enabled;
  if (fill) {
    try { localStorage.setItem('apCid', apCid); } catch {}
    $('#ap-name').value = ch.name;
    const names = [...new Set([...(ch.page?.name ? [ch.page.name] : []), ...(d.pagesList || [])])];
    $('#ap-page').innerHTML = (ch.page ? '' : '<option value="">— chọn Page —</option>') + names.map((n) => `<option ${n === ch.page?.name ? 'selected' : ''}>${esc(n)}</option>`).join('');
    renderSlots(ch.slots);
    $('#ap-approval').checked = ch.requireApproval;
    for (const r of document.querySelectorAll('input[name=ap-postmode]')) r.checked = r.value === (ch.postMode || 'schedule');
    $('#ap-review').checked = ch.autoReview && !ch.requireApproval;
    $('#ap-minscore').value = ch.minScore; $('#ap-maxredo').value = ch.maxRedo; $('#ap-fallback').value = ch.fallbackScore;
    $('#ap-channel').value = ch.channel || '';
    const t = ch.template;
    $('#ap-scenes').value = t.sceneCount;
    $('#ap-voice').innerHTML = '<option value="">Không cố định</option>' + (window.voiceOpts ? window.voiceOpts(t.voice) : '');
    $('#ap-model').innerHTML = (cfg.flowModels || []).map((m) => `<option ${m === t.flowModel ? 'selected' : ''}>${esc(m)}</option>`).join('');
    for (const k of ['character', 'setting', 'camera', 'audience', 'tone', 'cta', 'avoid']) $(`#ap-${k}`).value = t[k] || '';
    $('#ap-varylook').checked = ch.varyLook !== false;
    $('#ap-subtitles').checked = ch.subtitles !== false;
    $('#ap-brain').value = ['claude', 'grok'].includes(ch.brain) ? ch.brain : 'auto';
    loadBenchmarks(ch).catch(() => {});
    $('#ap-scoutclone').checked = ch.scoutAutoClone !== false;
    $('#ap-scoutperday').value = ch.scoutClonePerDay ?? 2;
    $('#ap-bossreview').checked = Boolean(ch.bossReview);
    $('#ap-topics').value = ch.topics.join('\n');
  }
  loadChannelScout(ch).catch(() => {});
  const pf = ch.profile;
  $('#ap-profile').innerHTML = ch.profiling ? '⏳ Đang quét Page để định vị lại kênh (~1–3 phút)…'
    : !ch.page?.id ? 'Chọn Page rồi Lưu — web sẽ quét Page để tự định vị kênh.'
    : !pf || pf.pageId !== ch.page.id ? 'Chưa quét Page này — web sẽ tự quét trước khi làm video đầu tiên.'
    : pf.error ? `⚠ Quét lỗi (${new Date(pf.at).toLocaleString('vi-VN')}): ${esc(pf.error)}`
    : `✓ Đã quét ${pf.posts} bài của Page lúc ${new Date(pf.at).toLocaleString('vi-VN')}: ${esc(pf.summary || '')}`;
  $('#ap-profile-btn').disabled = Boolean(ch.profiling) || !ch.page?.id;
  if (ch.profiling) setTimeout(() => { if (apCh()?.id === ch.id) loadAuto(true).catch(() => {}); }, 15000);
  const planBySlot = new Map(ch.plan.map((p) => [p.slot, p]));
  const rows = [...new Set([...ch.upcoming, ...ch.plan.slice(0, 15).map((p) => p.slot)])].sort().reverse().slice(0, 18);
  const ST = { 'đang làm': 'running', 'chờ duyệt': 'stale', 'nháp': 'scheduled', 'đã hẹn': 'done', 'lỗi': 'error', 'bỏ qua': 'draft', 'không đạt': 'error' };
  $('#ap-plan').innerHTML = rows.length ? rows.map((slot) => {
    const p = planBySlot.get(slot);
    const future = Date.parse(slot) > Date.now();
    return `<div class="ap-row">
      <div class="when">${vnTime(slot)}</div>
      <div class="grow">${p ? `<span class="badge ${ST[p.status] || ''}">${esc(p.status)}${p.step ? ` · ${esc(p.step)}` : ''}</span> ${esc(p.topic || '')}
        ${p.score != null ? ` · <b>${p.score}/100</b>` : ''}${p.attempts?.length > 1 ? ` <small class="muted" style="display:inline">(${p.attempts.map((a) => a.score).join(' → ')})</small>` : ''}
        ${p.jobId ? ` · <a href="#" data-open-job="${esc(p.jobId)}">xem video</a>` : ''}${p.look ? `<div class="muted" style="font-size:12px">👔 ${esc(p.look.outfit)} · 🏠 ${esc(p.look.setting)}</div>` : ''}${p.boss ? `<div class="boss-verdict">🧠 Boss: <b>${esc(p.boss.verdict)}</b> (${p.boss.score}/100) — ${esc(p.boss.reason)}${p.boss.fixes ? ` <span class="muted">Sửa: ${esc(p.boss.fixes)}</span>` : ''}</div>` : ''}${p.error ? `<div class="over" style="font-size:12px">${esc(p.error)}</div>` : ''}`
        : `<span class="muted">${future ? 'chưa làm' : 'đã qua'}</span>`}</div>
      <div class="acts">${p?.status === 'chờ duyệt' && p.boss ? `<button class="small primary" data-ap-boss="${slot}" data-verdict="${esc(p.boss.verdict)}">Làm theo boss: ${esc(p.boss.verdict)}</button>` : ''}${p?.status === 'chờ duyệt' ? `<button class="small${p.boss ? '' : ' primary'}" data-ap-approve="${slot}">Duyệt & ${ch.postMode === 'draft' ? 'lưu nháp' : 'hẹn đăng'}</button>` : ''}${p?.status === 'nháp' ? `<a class="small" href="https://business.facebook.com/latest/posts/draft_posts?asset_id=${encodeURIComponent(ch.page?.id || '')}" target="_blank" rel="noopener">Mở Bản nháp trên Business Suite</a><button class="small primary" data-ap-approve="${slot}" data-draft="1">Hẹn đăng ${future ? 'theo khung giờ' : 'sớm nhất'}</button>` : ''}${future && p && ['chờ duyệt', 'nháp', 'bỏ qua', 'lỗi', 'không đạt'].includes(p.status) ? `<button class="small" data-ap-redo="${slot}">↻ Làm lại (chủ đề mới)</button>${p.topic ? `<button class="small" data-ap-redo="${slot}" data-same="1">↻ Làm lại cùng chủ đề</button>` : ''}` : ''}${future && (!p || ['lỗi', 'chờ duyệt'].includes(p.status)) ? `<button class="small" data-ap-skip="${slot}">Bỏ qua</button>` : ''}</div>
    </div>`;
  }).join('') : '<div class="muted">Chưa có khung giờ nào.</div>';
  $('#ap-log').textContent = (ch.log || []).map((l) => `[${vnTime(l.at)}] ${l.msg}`).join('\n');
  if (!$('#view-auto').hidden) apTimer = setTimeout(() => loadAuto(false), st.running ? 6000 : 30000);
}

function apForm() {
  return {
    name: $('#ap-name').value,
    pageName: $('#ap-page').value || undefined,
    slots: [...$('#ap-slots').querySelectorAll('input[type=time]')].map((i) => i.value).filter(Boolean),
    requireApproval: $('#ap-approval').checked,
    postMode: document.querySelector('input[name=ap-postmode]:checked')?.value || 'schedule',
    autoReview: $('#ap-review').checked, minScore: $('#ap-minscore').value, maxRedo: $('#ap-maxredo').value, fallbackScore: $('#ap-fallback').value,
    channel: $('#ap-channel').value,
    template: { sceneCount: $('#ap-scenes').value, voice: $('#ap-voice').value, flowModel: $('#ap-model').value,
      ...Object.fromEntries(['character', 'setting', 'camera', 'audience', 'tone', 'cta', 'avoid'].map((k) => [k, $(`#ap-${k}`).value])) },
    varyLook: $('#ap-varylook').checked,
    subtitles: $('#ap-subtitles').checked,
    brain: $('#ap-brain').value,
    benchmarkId: $('#ap-benchmark').value || null,
    scoutAutoClone: $('#ap-scoutclone').checked,
    scoutClonePerDay: Number($('#ap-scoutperday').value),
    bossReview: $('#ap-bossreview').checked,
  };
}
$('#view-auto').addEventListener('click', async (e) => {
  const t = e.target.closest('button, a') || e.target;
  try {
    if (t.dataset.ch) { apCid = t.dataset.ch; return loadAuto(true); }
    if (t.id === 'ap-add') { const name = prompt('Tên kênh mới (VD: tên Page)'); if (!name) return; const c = await api('/api/autopilot/channels', { method: 'POST', body: { name } }); apCid = c.id; toast('Đã thêm kênh — chọn Page, chỉnh cài đặt rồi Lưu và Bật'); return loadAuto(true); }
    if (t.id === 'ap-del') { if (!confirm(`Xoá kênh "${apCh()?.name}"? (video đã làm vẫn giữ trong danh sách Video, bài đã hẹn trên Facebook không bị huỷ)`)) return; await api(chUrl(), { method: 'DELETE' }); apCid = null; return loadAuto(true); }
    if (t.dataset.openJob) { e.preventDefault(); return openJob(t.dataset.openJob); }
    if (t.id === 'ap-slot-add') { const s = [...$('#ap-slots').querySelectorAll('input')].map((i) => i.value); s.push('17:00'); return renderSlots(s); }
    if (t.dataset.slotDel != null) { const s = [...$('#ap-slots').querySelectorAll('input')].map((i) => i.value); s.splice(Number(t.dataset.slotDel), 1); return renderSlots(s); }
    if (t.id === 'ap-save') { t.disabled = true; t.textContent = 'Đang lưu…'; await api(chUrl(), { method: 'POST', body: apForm() }); toast('Đã lưu cài đặt kênh'); t.disabled = false; t.textContent = 'Lưu cài đặt'; return loadAuto(true); }
    if (t.id === 'ap-topics-save') { await api(chUrl(), { method: 'POST', body: { topics: $('#ap-topics').value.split('\n') } }); toast('Đã lưu chủ đề'); return loadAuto(true); }
    if (t.id === 'ap-profile-btn') {
      if (!confirm('Quét lại Page này? Claude sẽ viết lại Định vị kênh, Khán giả, Giọng, Tránh và THAY hàng đợi chủ đề (các ô khác giữ nguyên).')) return;
      t.disabled = true; t.textContent = 'Đang quét Page…';
      try { await api(chUrl('/profile'), { method: 'POST' }); toast('Đã định vị lại kênh'); } finally { t.textContent = '🔍 Quét lại kênh'; }
      return loadAuto(true);
    }
    if (t.id === 'ap-ideate') { t.disabled = true; t.textContent = 'Claude đang nghĩ…'; await api(chUrl('/ideate'), { method: 'POST' }); return loadAuto(true); }
    if (t.id === 'ap-run') { if (!confirm('Làm ngay 1 video cho khung giờ sớm nhất đang trống (trong các kênh đang bật; tốn credit Flow)?')) return; await api(chUrl(), { method: 'POST', body: apForm() }); await api('/api/autopilot/run', { method: 'POST' }); toast('Đã bắt đầu'); return setTimeout(() => loadAuto(false), 1500); }
    if (t.dataset.apBoss) {
      const v = t.dataset.verdict; const slot = t.dataset.apBoss;
      t.disabled = true;
      if (v === 'làm lại') { await api(chUrl('/redo'), { method: 'POST', body: { slot, sameTopic: true } }); toast('Đang làm lại cùng chủ đề'); }
      else { await api(chUrl('/approve'), { method: 'POST', body: { slot, mode: v === 'nháp' ? 'draft' : 'schedule' } }); toast(v === 'nháp' ? 'Đã lưu nháp' : 'Đã hẹn đăng'); }
      return loadAuto(false);
    }
    if (t.dataset.apApprove) {
      if (t.dataset.draft && !confirm('Hẹn giờ đăng video này từ web? Web tải video lên và hẹn giờ mới; bản nháp cũ trong Business Suite vẫn còn — xoá tay để khỏi trùng.')) return;
      t.disabled = true; await api(chUrl('/approve'), { method: 'POST', body: { slot: t.dataset.apApprove } }); toast('Đã hẹn đăng'); return loadAuto(false);
    }
    if (t.dataset.apRedo) {
      const same = Boolean(t.dataset.same);
      if (!confirm(`Làm lại video cho khung ${vnTime(t.dataset.apRedo)}${same ? ' với cùng chủ đề' : ' với chủ đề kế tiếp'}? (tốn credit Flow + lượt Claude; video cũ vẫn giữ trong danh sách Video)`)) return;
      await api(chUrl('/redo'), { method: 'POST', body: { slot: t.dataset.apRedo, sameTopic: same } });
      toast(apCh()?.enabled ? 'Đang làm lại…' : 'Đã xoá khỏi lịch — bật kênh để web làm lại', 5000);
      return loadAuto(true);
    }
    if (t.dataset.apSkip) { await api(chUrl('/skip'), { method: 'POST', body: { slot: t.dataset.apSkip } }); return loadAuto(false); }
  } catch (err) { toast(err.message, 8000); loadAuto(false); }
});
$('#view-auto').addEventListener('change', (e) => {
  if (e.target.id === 'ap-approval' && e.target.checked) $('#ap-review').checked = false;
  if (e.target.id === 'ap-review' && e.target.checked) $('#ap-approval').checked = false;
});
$('#ap-enabled').addEventListener('change', async (e) => {
  const on = e.target.checked;
  const f = apForm();
  if (on && !f.pageName) { e.target.checked = false; return toast('Chọn Page để đăng cho kênh này trước'); }
  if (on && !confirm(`Bật kênh "${f.name}"? Mỗi ngày web sẽ tự làm và ${f.postMode === 'draft' ? 'LƯU NHÁP' : 'HẸN GIỜ ĐĂNG'} ${f.slots.length} video lên "${f.pageName}" (tốn credit Flow + lượt Claude).`)) { e.target.checked = false; return; }
  await api(chUrl(), { method: 'POST', body: { ...f, enabled: on } }).catch((err) => toast(err.message));
  loadAuto(true);
});

// ---------- Boss (Grok) ----------
const ACTION_LABEL = {
  set_field: (p) => `Đổi "${{ channel: 'Định vị kênh', audience: 'Khán giả', tone: 'Giọng', avoid: 'Tránh', character: 'DNA trang phục', setting: 'Bối cảnh', camera: 'Góc quay', cta: 'CTA' }[p.field] || p.field}" → ${p.value}`,
  add_topics: (p) => `Thêm ${p.list.length} chủ đề: ${p.list.join(' · ')}`,
  replace_topics: (p) => `Thay hàng đợi bằng ${p.list.length} chủ đề: ${p.list.join(' · ')}`,
  set_slots: (p) => `Khung giờ đăng: ${p.list.join(', ')}`,
  set_enabled: (p) => (/^(true|1|bật|on|yes)$/i.test(p.value) ? 'Bật kênh' : 'Tắt kênh'),
  set_post_mode: (p) => (p.value === 'draft' ? 'Chuyển sang đăng nháp' : 'Chuyển sang hẹn giờ đăng'),
  set_scene_count: (p) => `Số cảnh mỗi video: ${p.value}`,
  redo_slot: (p) => `Làm lại khung ${p.slot ? vnTime(p.slot) : '?'} (${p.value === 'same' ? 'cùng chủ đề' : 'chủ đề mới'})`,
  skip_slot: (p) => `Bỏ qua khung ${p.slot ? vnTime(p.slot) : '?'}`,
  approve_slot: (p) => `Duyệt khung ${p.slot ? vnTime(p.slot) : '?'} → ${p.value === 'draft' ? 'lưu nháp' : 'hẹn đăng'}`,
  rescan_channel: () => 'Quét lại Page để định vị kênh',
};
let bossTimer = null;
let bossChannels = [];
function propHtml(p) {
  const ch = bossChannels.find((c) => c.id === p.cid);
  const what = (ACTION_LABEL[p.action] || (() => p.action))(p);
  const st = { 'mới': '', 'đang làm': 'running', 'đã áp dụng': 'done', 'bỏ qua': 'draft', 'lỗi': 'error' }[p.status] ?? '';
  return `<div class="boss-prop"><div class="what"><span class="badge">${esc(ch?.name || p.cid)}</span> ${esc(what)}</div>
    <div class="why">${esc(p.reason)}${p.error ? ` <span class="over">${esc(p.error)}</span>` : ''}</div>
    <div class="acts">${p.status === 'mới' || p.status === 'lỗi' ? `<button class="small primary" data-boss-apply="${p.id}">Áp dụng</button><button class="small" data-boss-dismiss="${p.id}">Bỏ</button>` : `<span class="badge ${st}">${esc(p.status)}</span>`}</div></div>`;
}
async function loadBoss() {
  clearTimeout(bossTimer);
  const [d, ap] = await Promise.all([api('/api/boss'), api('/api/autopilot')]);
  bossChannels = ap.channels;
  const g = d.grok;
  $('#boss-grok').innerHTML = !g ? '<span class="muted">Chưa kiểm tra kết nối Grok — bấm "Kiểm tra Grok".</span>'
    : g.ok ? '<span class="badge done">Grok sẵn sàng</span>'
    : !g.installed ? '<span class="badge error">Chưa cài Grok CLI</span>'
    : `<span class="badge error">Grok chưa dùng được</span> <span class="muted">${esc(g.error || '')}</span>`;
  $('#boss-daily').checked = d.daily; $('#boss-daily-at').value = d.dailyAt;
  $('#boss-report').disabled = d.reporting; $('#boss-report').textContent = d.reporting ? 'Boss đang xem…' : 'Báo cáo ngay';
  $('#boss-reports').innerHTML = (d.lastError ? `<div class="over" style="font-size:13px;margin-top:8px">Lần báo cáo gần nhất lỗi: ${esc(d.lastError)}</div>` : '')
    + (d.reports.length ? d.reports.map((r) => `<div class="boss-rep"><div class="muted" style="font-size:12px">${vnTime(r.at)}${r.costUsd ? ` · $${r.costUsd.toFixed(3)}` : ''}</div>
      <div class="txt">${esc(r.text)}</div>${r.proposals.map(propHtml).join('')}</div>`).join('') : '<div class="muted" style="margin-top:10px">Chưa có báo cáo.</div>');
  const box = $('#boss-chat');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = d.chat.length ? d.chat.map((m) => `<div class="boss-msg ${m.role}">${esc(m.text)}${(m.proposals || []).map(propHtml).join('')}</div>`).join('')
    + (d.chatting ? '<div class="boss-msg boss muted">Boss đang trả lời…</div>' : '') : '<div class="muted">Hỏi boss về các kênh, hoặc ra lệnh bằng lời.</div>';
  if (atBottom) box.scrollTop = box.scrollHeight;
  $('#boss-send').disabled = d.chatting;
  if (!$('#view-boss').hidden) bossTimer = setTimeout(() => loadBoss().catch(() => {}), d.reporting || d.chatting ? 4000 : 30000);
}
$('#tab-boss').addEventListener('click', async () => {
  currentId = null; stopPoll(); show('boss');
  await loadBoss();
  if (!(await api('/api/boss')).grok) api('/api/boss/grok-check', { method: 'POST' }).then(loadBoss).catch(() => {});
});
$('#boss-check').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Đang thử Grok…';
  try { await api('/api/boss/grok-check', { method: 'POST' }); } finally { e.target.disabled = false; e.target.textContent = 'Kiểm tra Grok'; }
  loadBoss();
});
$('#boss-report').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Boss đang xem…';
  api('/api/boss/report', { method: 'POST' }).then(() => toast('Boss đã báo cáo')).catch((err) => toast(err.message)).finally(loadBoss);
  setTimeout(loadBoss, 1500);
});
for (const id of ['#boss-daily', '#boss-daily-at']) $(id).addEventListener('change', () => api('/api/boss/settings', { method: 'POST', body: { daily: $('#boss-daily').checked, dailyAt: $('#boss-daily-at').value } }).then(() => toast('Đã lưu')));
$('#boss-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const message = $('#boss-msg').value.trim();
  if (!message) return;
  $('#boss-msg').value = '';
  api('/api/boss/chat', { method: 'POST', body: { message } }).catch((err) => toast(err.message)).finally(loadBoss);
  setTimeout(loadBoss, 800);
});
$('#boss-msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#boss-form').requestSubmit(); } });
$('#view-boss').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  try {
    if (t.dataset.bossApply) { t.disabled = true; t.textContent = 'Đang làm…'; await api(`/api/boss/proposals/${t.dataset.bossApply}/apply`, { method: 'POST' }); toast('Đã áp dụng'); }
    if (t.dataset.bossDismiss) await api(`/api/boss/proposals/${t.dataset.bossDismiss}/dismiss`, { method: 'POST' });
  } catch (err) { toast(err.message); }
  loadBoss();
});

// ---------- Trinh sát ----------
const PLAT = { tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', instagram: 'Instagram' };
const fmtNum = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.0', '')}Tr` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace('.0', '')}N` : String(n));
let scTimer = null;
let scFilled = false;
async function loadScout() {
  clearTimeout(scTimer);
  const cid = $('#sc-filter-ch').value;
  const d = await api(`/api/scout${cid ? `?cid=${encodeURIComponent(cid)}` : ''}`);
  const opts = d.channels.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  if (!scFilled) {
    $('#sc-filter-ch').innerHTML = `<option value="">Mọi kênh</option>${opts}`;
    $('#sc-cid').innerHTML = opts;
    const s = d.settings;
    $('#sc-times').value = s.scanTimes.join(', '); $('#sc-hot').value = s.hotMultiple; $('#sc-boom').value = s.boomMultiple;
    $('#sc-days').value = s.boomDays; $('#sc-autodecode').checked = s.autoDecode; $('#sc-maxdecode').value = s.maxDecodePerScan;
    scFilled = true;
  }
  $('#sc-boom-x').textContent = d.settings.boomMultiple;
  $('#sc-status').innerHTML = d.busy ? `<span class="badge running">Đang ${esc(d.busy)}${d.queued ? ` · còn ${d.queued} việc` : ''}</span>`
    : `<span class="muted">${d.lastScan ? `Quét gần nhất: ${vnTime(d.lastScan)}` : 'Chưa quét lần nào'} · tự quét lúc ${esc(d.settings.scanTimes.join(', ') || '(tắt)')}</span>`;
  $('#sc-top-formats').innerHTML = d.topFormats.length ? `Khuôn đang thắng: ${d.topFormats.map(([f, n]) => `<b>${esc(f)}</b> (${n})`).join(' · ')}` : '';
  const list = $('#sc-boom-only').checked ? d.boom : d.hot;
  $('#sc-signals').innerHTML = list.length ? list.map((v) => {
    const x = v.decode;
    const chName = d.channels.find((c) => c.id === v.source.cid)?.name || '';
    return `<div class="sc-sig"><div class="top"><span class="mult">×${v.multiple}</span><b>${fmtNum(v.views)}</b> lượt xem
      <span class="badge">${esc(PLAT[v.source.platform] || v.source.platform)} · ${esc(v.source.name)}</span>
      <span class="muted">trung vị ${fmtNum(v.source.median)} · ${v.postedAt ? `đăng ${vnTime(v.postedAt)}` : `thấy ${vnTime(v.firstSeenAt)}`}${v.isNew ? ' · mới' : ''} · cho ${esc(chName)}</span></div>
      <div>${esc(v.title || '(không có tiêu đề)')} <a href="${esc(v.url)}" target="_blank" rel="noopener">mở ↗</a></div>
      ${x ? `<div class="dec"><b>Hook:</b> ${esc(x.hookText)} <span class="muted">(${esc(x.hookType)})</span><br><b>Khuôn:</b> ${esc(x.format)} · <b>Nhịp:</b> ${esc(x.structure.join(' → '))}<br>
        <b>Vì sao nổ:</b> ${esc(x.whyItWorks)}<br><b>Clone cho kênh:</b> ${esc(x.cloneTitle)} — ${esc(x.cloneIdea)}${x.cautions ? `<br><span class="muted">Lưu ý: ${esc(x.cautions)}</span>` : ''}</div>`
        : v.decodeError ? `<div class="over" style="font-size:12px">Decode lỗi: ${esc(v.decodeError)}</div>` : ''}
      <div class="acts">${x ? `<button class="small primary" data-sc-clone="${esc(v.sourceId)}|${esc(v.key)}">${(v.clonedTo || []).length ? '✓ Đã clone · clone thêm' : 'Clone vào hàng đợi'} ${esc(chName)}</button>` : ''}
        <button class="small" data-sc-decode="${esc(v.sourceId)}|${esc(v.key)}">${x ? 'Decode lại' : 'Decode'}</button></div></div>`;
  }).join('') : `<div class="muted" style="margin-top:10px">${d.sources.length ? 'Chưa có video vượt ngưỡng.' : 'Thêm nguồn quan sát ở bên phải để bắt đầu.'}</div>`;
  $('#sc-sources').innerHTML = d.sources.length ? d.sources.map((s) => `<div class="sc-src"><b>${esc(s.name)}</b> <span class="badge">${esc(PLAT[s.platform])}</span> ${s.owner === 'mine' ? '<span class="badge done">kênh của tôi</span>' : ''}
      <span class="muted">→ ${esc(s.channelName)}</span>${s.enabled ? '' : ' <span class="badge draft">tắt</span>'}
      <div class="muted">${s.scanning ? '⏳ đang quét…' : s.lastScanAt ? `Quét ${vnTime(s.lastScanAt)} · ${s.lastCount ?? s.videoCount} video · trung vị ${fmtNum(s.median)}${s.followers ? ` · ${fmtNum(s.followers)} theo dõi` : ''}` : 'chưa quét'}</div>
      ${s.lastError ? `<div class="over" style="font-size:12px">${esc(s.lastError)}</div>` : ''}
      <div class="acts"><button class="small" data-sc-scan="${s.id}">Quét</button><button class="small" data-sc-toggle="${s.id}" data-on="${s.enabled ? 0 : 1}">${s.enabled ? 'Tắt' : 'Bật'}</button>
        <a class="small" href="${esc(s.url)}" target="_blank" rel="noopener">Mở</a><button class="small" data-sc-del="${s.id}">Xoá</button></div></div>`).join('')
    : '<div class="muted">Chưa có nguồn.</div>';
  if (!$('#view-scout').hidden) scTimer = setTimeout(() => loadScout().catch(() => {}), d.busy || d.queued ? 5000 : 30000);
}
$('#tab-scout').addEventListener('click', async () => { currentId = null; stopPoll(); show('scout'); await loadScout(); });
$('#sc-filter-ch').addEventListener('change', loadScout);
$('#sc-boom-only').addEventListener('change', loadScout);
$('#sc-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/scout/sources', { method: 'POST', body: { url: $('#sc-url').value, cid: $('#sc-cid').value, owner: $('#sc-owner').value, name: $('#sc-name').value } });
    $('#sc-url').value = ''; $('#sc-name').value = '';
    toast('Đã thêm nguồn — đang quét');
  } catch (err) { toast(err.message); }
  loadScout();
});
$('#sc-scan-all').addEventListener('click', async () => { await api('/api/scout/scan', { method: 'POST', body: {} }); toast('Đã xếp quét mọi nguồn'); loadScout(); });
$('#sc-save').addEventListener('click', async () => {
  await api('/api/scout/settings', { method: 'POST', body: { scanTimes: $('#sc-times').value.split(',').map((x) => x.trim()).filter(Boolean),
    hotMultiple: Number($('#sc-hot').value), boomMultiple: Number($('#sc-boom').value), boomDays: Number($('#sc-days').value),
    autoDecode: $('#sc-autodecode').checked, maxDecodePerScan: Number($('#sc-maxdecode').value) } });
  scFilled = false; toast('Đã lưu cài đặt'); loadScout();
});
$('#view-scout').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t || t.form) return;
  try {
    if (t.dataset.scScan) { await api('/api/scout/scan', { method: 'POST', body: { ids: [t.dataset.scScan] } }); toast('Đã xếp quét'); }
    if (t.dataset.scToggle) await api(`/api/scout/sources/${t.dataset.scToggle}`, { method: 'POST', body: { enabled: t.dataset.on === '1' } });
    if (t.dataset.scDel) { if (!confirm('Xoá nguồn này và số liệu đã quét?')) return; await api(`/api/scout/sources/${t.dataset.scDel}`, { method: 'DELETE' }); }
    if (t.dataset.scDecode) { const [sourceId, key] = t.dataset.scDecode.split('|'); await api('/api/scout/decode', { method: 'POST', body: { sourceId, key } }); toast('Đang decode…'); }
    if (t.dataset.scClone) { const [sourceId, key] = t.dataset.scClone.split('|'); const r = await api('/api/scout/clone', { method: 'POST', body: { sourceId, key } }); toast('Đã đưa lên đầu hàng đợi chủ đề'); console.log(r.topic); }
  } catch (err) { toast(err.message); }
  loadScout();
});

// ---------- Trinh sát trong Tự nuôi kênh (theo kênh đang chọn) ----------
async function loadChannelScout(ch) {
  const d = await api(`/api/scout?cid=${encodeURIComponent(ch.id)}`);
  if (apCh()?.id !== ch.id) return;
  $('#apsc-scan').disabled = !d.sources.length;
  $('#apsc-sources').innerHTML = d.sources.length ? d.sources.map((s) => `<div class="sc-src"><b>${esc(s.name)}</b> <span class="badge">${esc(PLAT[s.platform])}</span>${s.owner === 'mine' ? ' <span class="badge done">kênh của tôi</span>' : ''}
      <span class="muted">${s.scanning ? '⏳ đang quét…' : s.lastScanAt ? `· quét ${vnTime(s.lastScanAt)} · ${s.lastCount ?? s.videoCount} video · trung vị ${fmtNum(s.median)}` : '· chưa quét'}</span>
      ${s.lastError ? `<div class="over" style="font-size:12px">${esc(s.lastError)}</div>` : ''}
      <span class="acts" style="display:inline-flex;margin:0 0 0 6px"><a class="small" href="${esc(s.url)}" target="_blank" rel="noopener">Mở</a><button class="small" data-apsc-del="${s.id}">Xoá</button></span></div>`).join('')
    : '<div class="muted" style="font-size:13px">Chưa có nguồn nào cho kênh này.</div>';
  const sig = d.boom.slice(0, 5);
  $('#apsc-signals').innerHTML = sig.length ? `<div style="margin-top:8px;font-weight:600;font-size:13px">Video đang bùng nổ ${d.busy ? `<span class="badge running">${esc(d.busy)}</span>` : ''}</div>` + sig.map((v) => `<div class="sc-sig">
      <div class="top"><span class="mult">×${v.multiple}</span><b>${fmtNum(v.views)}</b> <span class="muted">${esc(v.source.name)}</span> <a href="${esc(v.url)}" target="_blank" rel="noopener">mở ↗</a></div>
      <div>${v.decode ? `<b>Clone:</b> ${esc(v.decode.cloneTitle)} <span class="muted">(khuôn: ${esc(v.decode.format)})</span>` : esc((v.title || '').slice(0, 160))}</div>
      <div class="acts">${(v.clonedTo || []).includes(ch.id) ? '<span class="badge done">đã vào hàng đợi</span>' : v.decode ? `<button class="small primary" data-apsc-clone="${esc(v.sourceId)}|${esc(v.key)}">Đưa vào hàng đợi</button>` : `<button class="small" data-apsc-decode="${esc(v.sourceId)}|${esc(v.key)}">Decode</button>`}</div></div>`).join('') : '';
}
$('#apsc-add').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    await api('/api/scout/sources', { method: 'POST', body: { url: $('#apsc-url').value, cid: apCid, owner: $('#apsc-owner').value } });
    $('#apsc-url').value = ''; toast('Đã thêm nguồn — đang quét (1–2 phút)');
  } catch (err) { toast(err.message); }
  loadChannelScout(apCh());
});
$('#apsc-scan').addEventListener('click', async (e) => {
  e.preventDefault();
  const d = await api(`/api/scout?cid=${encodeURIComponent(apCid)}`);
  await api('/api/scout/scan', { method: 'POST', body: { ids: d.sources.map((s) => s.id) } });
  toast('Đã xếp quét nguồn của kênh'); loadChannelScout(apCh());
});
$('#view-auto').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t || !(t.dataset.apscDel || t.dataset.apscClone || t.dataset.apscDecode)) return;
  e.stopPropagation();
  try {
    if (t.dataset.apscDel) { if (!confirm('Xoá nguồn này?')) return; await api(`/api/scout/sources/${t.dataset.apscDel}`, { method: 'DELETE' }); }
    if (t.dataset.apscDecode) { const [sourceId, key] = t.dataset.apscDecode.split('|'); await api('/api/scout/decode', { method: 'POST', body: { sourceId, key } }); toast('Đang decode…'); }
    if (t.dataset.apscClone) { const [sourceId, key] = t.dataset.apscClone.split('|'); await api('/api/scout/clone', { method: 'POST', body: { sourceId, key, cid: apCid } }); toast('Đã đưa lên đầu hàng đợi'); return loadAuto(true); }
  } catch (err) { toast(err.message); }
  loadChannelScout(apCh());
}, true);

// ---------- Video chuẩn ----------
let bmTimer = null;
async function loadBenchmarks(ch, keep = false) {
  clearTimeout(bmTimer);
  const d = await api('/api/benchmarks');
  if (apCh()?.id !== ch.id) return;
  const sel = $('#ap-benchmark');
  const cur = keep ? sel.value : (ch.benchmarkId || '');
  sel.innerHTML = '<option value="">— không dùng —</option>' + d.items.map((b) => `<option value="${esc(b.id)}" ${b.id === cur ? 'selected' : ''}>${esc((b.transcript?.[0]?.text || b.url).slice(0, 60))}${b.status !== 'xong' ? ` (${esc(b.status)})` : ''}</option>`).join('');
  sel.value = cur;
  renderBenchmark(d.items.find((b) => b.id === sel.value), d.items.filter((b) => b.status !== 'xong'));
  if (d.working) bmTimer = setTimeout(() => { if (apCh()) loadBenchmarks(apCh(), true).catch(() => {}); }, 6000);
}
function renderBenchmark(b, pending) {
  const busy = pending.map((p) => `<div class="muted" style="font-size:12.5px;margin-top:6px">${p.status === 'lỗi' ? `⚠ ${esc(p.url)}: ${esc(p.error || '')} <button class="small" data-bm-retry="${p.id}">Thử lại</button> <button class="small" data-bm-del="${p.id}">Xoá</button>` : `⏳ ${esc(p.url)} — ${esc(p.step || p.status)}`}</div>`).join('');
  if (!b?.analysis) { $('#bm-detail').innerHTML = busy; return; }
  const a = b.analysis;
  $('#bm-detail').innerHTML = `<div class="dec"><b>${Math.round(b.duration)}s</b>${b.stats ? ` · ${esc(b.stats.likes)} thích · ${esc(b.stats.comments)} bình luận · ${esc(b.stats.shares)} chia sẻ` : ''} · <a href="${esc(b.url)}" target="_blank" rel="noopener">mở ↗</a><br>
    <b>Vì sao viral:</b> ${esc(a.whyViral)}<br><b>Hook:</b> ${esc(a.hookPattern)}<br><b>Nhịp:</b> ${esc(a.pacing)}<br><b>Thủ pháp:</b> ${esc(a.devices.join(' · '))}<br>
    <b>Quy tắc:</b> ${a.rules.map((r) => `• ${esc(r)}`).join(' ')}<br><b>Hình ảnh:</b> ${esc(a.visualStyle)}${a.subtitleStyle ? `<br><b>Phụ đề:</b> ${esc(a.subtitleStyle)}` : ''}
    <details><summary>Lời thoại video chuẩn</summary>${b.transcript.map((s) => `<div>[${s.start.toFixed(1)}s] ${esc(s.text)}</div>`).join('')}</details></div>
    <div class="row" style="gap:6px"><button class="small" data-bm-camera="${esc(a.cameraSuggestion)}">Dùng góc quay của video chuẩn</button>
    <button class="small" data-bm-scenes="${a.suggestedSceneCount}">Dùng ${a.suggestedSceneCount} cảnh (≈ độ dài chuẩn)</button><button class="small" data-bm-del="${b.id}">Xoá video chuẩn</button></div>${busy}`;
}
$('#ap-benchmark').addEventListener('change', () => { if (apCh()) loadBenchmarks(apCh(), true); });
$('#bm-add').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await api('/api/benchmarks', { method: 'POST', body: { url: $('#bm-url').value } }); $('#bm-url').value = ''; toast('Đang ghi + chép lời + phân tích video chuẩn (~2–4 phút)'); } catch (err) { toast(err.message); }
  if (apCh()) loadBenchmarks(apCh(), true);
});
$('#view-auto').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t || !(t.dataset.bmCamera || t.dataset.bmScenes || t.dataset.bmDel || t.dataset.bmRetry)) return;
  e.stopPropagation(); e.preventDefault();
  try {
    if (t.dataset.bmCamera) { $('#ap-camera').value = t.dataset.bmCamera; toast('Đã điền ô Góc quay — bấm Lưu để áp dụng'); }
    if (t.dataset.bmScenes) { $('#ap-scenes').value = t.dataset.bmScenes; toast('Đã đổi số cảnh — bấm Lưu để áp dụng'); }
    if (t.dataset.bmRetry) await api(`/api/benchmarks/${t.dataset.bmRetry}/retry`, { method: 'POST' });
    if (t.dataset.bmDel) { if (!confirm('Xoá video chuẩn này? Các kênh đang dùng sẽ thôi bám theo nó.')) return; await api(`/api/benchmarks/${t.dataset.bmDel}`, { method: 'DELETE' }); }
  } catch (err) { toast(err.message); }
  if (apCh()) loadBenchmarks(apCh(), true);
}, true);

// ---------- Bộ não AI (tab Tài khoản) ----------
async function loadBrain(check = false) {
  if (check) { $('#brain-status').innerHTML = '<span class="muted">Đang thử Grok…</span>'; await api('/api/boss/grok-check', { method: 'POST' }).catch(() => {}); }
  const d = await api('/api/brain');
  for (const r of document.querySelectorAll('input[name=brain]')) r.checked = r.value === d.brain;
  const g = d.grok;
  const gs = !g ? '<span class="muted">chưa kiểm tra</span>' : g.ok ? '<span class="badge done">sẵn sàng</span>' : `<span class="badge error">chưa dùng được</span> <span class="muted">${esc(g.error || '')}</span>`;
  $('#brain-status').innerHTML = `Đang dùng: <b>${d.brain === 'grok' ? 'Grok' : 'Claude'}</b> · Grok: ${gs} <button class="small" id="brain-check">Kiểm tra Grok</button>`;
  $('#brain-check').onclick = () => loadBrain(true);
}
for (const r of document.querySelectorAll('input[name=brain]')) r.addEventListener('change', async () => {
  try { await api('/api/brain', { method: 'POST', body: { brain: r.value } }); toast(`Bộ não: ${r.value === 'grok' ? 'Grok' : 'Claude'}`); } catch (err) { toast(err.message); }
  loadBrain(r.value === 'grok');
});
