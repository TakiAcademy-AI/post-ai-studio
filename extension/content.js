// Bảng "Ads AI" góc phải dưới trang Flow: lấy cảnh đang chờ từ Ads AI Studio, điền sẵn cài đặt + ảnh + prompt.
// KHÔNG bấm nút tạo — người dùng tự bấm. Selector dựa trên nhãn tiếng Việt của Flow (đo ngày 2026-10-12).

const MODELS = ['Veo 3.1 - Fast', 'Veo 3.1 - Lite', 'Veo 3.1 - Quality', 'Omni 1.1 Flash'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Flow (Angular) nghe pointer/mouse event, .click() trần không chọn được ảnh trong danh sách.
function press(el) {
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  for (const [T, n] of [[PointerEvent, 'pointerover'], [PointerEvent, 'pointerdown'], [MouseEvent, 'mousedown'], [PointerEvent, 'pointerup'], [MouseEvent, 'mouseup'], [MouseEvent, 'click']]) {
    el.dispatchEvent(new T(n, o));
  }
}

async function waitFor(fn, what, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`Không thấy ${what} trên trang Flow (giao diện có thể đã đổi)`);
}

const visible = (el) => el && el.offsetParent !== null;
const byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => visible(e) && e.innerText.replace(/\s+/g, ' ').trim().includes(text));
const leaf = (text) => [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && e.textContent.trim() === text && visible(e));
const clickable = (el) => { let c = el; while (c && c.tagName !== 'BUTTON' && !c.getAttribute?.('role')) c = c.parentElement; return c || el; };

// ---------- các bước điền ----------
async function openSettings() {
  const btn = await waitFor(() => document.querySelector('button[aria-label="Điều kiện kích hoạt cài đặt"]'), 'nút cài đặt');
  if (!byText('button[role=radio]', '9:16')) press(btn);
  await waitFor(() => byText('button[role=radio]', '9:16'), 'bảng cài đặt');
  return btn;
}

async function pickRadio(label, required = true) {
  const r = byText('button[role=radio]', label);
  if (!r) { if (required) throw new Error(`Không thấy lựa chọn "${label}"`); return false; }
  if (r.getAttribute('aria-checked') !== 'true') { press(r); await sleep(350); }
  return true;
}

async function pickModel(name) {
  const btn = document.querySelector('button[aria-label="Chọn nhóm mô hình"]');
  if (!btn) return;
  if (btn.innerText.includes(name)) return;
  press(btn);
  const item = await waitFor(() => byText('[role="menuitem"]', name), `model ${name}`, 5000);
  press(item);
  await sleep(500);
}

async function applySettings(mode, model) {
  const btn = await openSettings();
  await pickRadio('Video');
  await pickRadio(mode === 'frames' ? 'Khung hình' : 'Thành phần');
  await pickRadio('9:16');
  await pickModel(model);
  await pickRadio('8 giây', false); // một số model không có ô thời lượng
  await pickRadio('x1', false);
  if (byText('button[role=radio]', '9:16')) press(btn); // đóng bảng
  await sleep(400);
}

async function uploadAndSelect(p, openPicker) {
  const bytes = Uint8Array.from(atob(p.imageB64), (c) => c.charCodeAt(0));
  window.postMessage({ source: 'adsai', type: 'arm-file', name: p.imageName, mime: p.imageMime, buffer: bytes.buffer }, '*');
  await openPicker();
  const up = await waitFor(() => byText('button', 'Tải nội dung nghe nhìn'), 'nút "Tải nội dung nghe nhìn lên"');
  press(up);
  // Đợi ảnh tải xong: mục trong danh sách (button[role=option]) có tên file và đã có ảnh thu nhỏ
  // (lúc đang tải chỉ có vòng xoay). Lưới phía sau hộp thoại cũng có ô cùng tên — không được bấm nhầm ô đó.
  const row = await waitFor(() => [...document.querySelectorAll('button[role="option"]')].find((b) =>
    visible(b) && b.querySelector('img') && b.textContent.trim() === p.imageName), 'ảnh vừa tải lên trong danh sách', 60000);
  press(row);
  await waitFor(() => row.getAttribute('aria-selected') === 'true', 'ảnh được chọn', 5000).catch(() => {});
  await sleep(400);
  const add = await waitFor(() => byText('button', 'Thêm vào câu lệnh'), 'nút "Thêm vào câu lệnh"');
  press(add);
  await sleep(1200);
}

async function setStartFrame(p) {
  await uploadAndSelect(p, async () => {
    const slotLeaf = await waitFor(() => leaf('Bắt đầu'), 'ô khung "Bắt đầu"');
    press(clickable(slotLeaf));
  });
}

async function addIngredient(p) {
  await uploadAndSelect(p, async () => {
    const plus = await waitFor(() => document.querySelector('button[aria-label="Thêm thành phần vào ô nhập câu lệnh"]'), 'nút + thêm thành phần');
    press(plus);
    await sleep(600);
  });
}

async function setPrompt(text) {
  const ed = await waitFor(() => document.querySelector('.ProseMirror[contenteditable="true"]'), 'ô nhập prompt');
  ed.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  document.execCommand('insertText', false, text);
  await sleep(300);
  if (!ed.innerText.includes(text.slice(0, 40))) throw new Error('Không điền được prompt vào ô nhập');
}

async function fill(p, model) {
  if (!location.pathname.startsWith('/project/')) throw new Error('Hãy mở một dự án Flow (bấm "Dự án mới" hoặc một dự án có sẵn) rồi bấm lại');
  status('Đang chỉnh cài đặt…');
  await applySettings(p.mode, model);
  if (p.mode === 'frames') { status('Đang tải khung đầu lên…'); await setStartFrame(p); }
  if (p.mode === 'ingredients') { status('Đang tải ảnh nhân vật lên…'); await addIngredient(p); }
  status('Đang điền prompt…');
  await setPrompt(p.prompt);
}

// ---------- bảng điều khiển ----------
const host = document.createElement('div');
host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
<style>
  .box{width:300px;background:#1f1f1c;color:#ecebe6;border:1px solid #3a3934;border-radius:12px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
  .h{display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:6px}
  .h button{background:none;border:0;color:#9c9a92;cursor:pointer;font-size:16px}
  .muted{color:#9c9a92}
  select,button.act{font:inherit;width:100%;margin-top:8px;padding:7px;border-radius:8px;border:1px solid #3a3934;background:#262622;color:#ecebe6}
  button.act{background:#f0913a;border-color:#f0913a;color:#1a1206;font-weight:700;cursor:pointer}
  button.act:disabled{opacity:.5;cursor:default}
  .st{margin-top:8px;white-space:pre-wrap}
  .err{color:#ef6f61}.ok{color:#5cc27f}
  .min .body{display:none}
</style>
<div class="box">
  <div class="h"><span>Ads AI</span><button id="tog" title="Thu gọn">–</button></div>
  <div class="body">
    <div id="info" class="muted">Đang kết nối Ads AI Studio…</div>
    <select id="model">${MODELS.map((m) => `<option>${m}</option>`).join('')}</select>
    <button id="fill" class="act" disabled>Điền vào Flow</button>
    <div id="st" class="st muted"></div>
  </div>
</div>`;
document.documentElement.appendChild(host);

const $ = (s) => root.querySelector(s);
let current = null;
let busy = false;

function status(text, cls = 'muted') {
  const st = $('#st');
  st.className = `st ${cls}`;
  st.textContent = text;
}

chrome.storage.local.get('model').then(({ model }) => { if (model) $('#model').value = model; });
$('#model').addEventListener('change', () => chrome.storage.local.set({ model: $('#model').value }));
$('#tog').addEventListener('click', () => $('.box').classList.toggle('min'));

const MODE_TEXT = { frames: 'Khung hình (khung đầu = khung cuối cảnh trước)', ingredients: 'Thành phần (ảnh nhân vật)', text: 'Chỉ prompt' };

async function poll() {
  if (busy) return;
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: 'getPending' });
  } catch {
    return; // extension vừa reload
  }
  if (r?.error) {
    $('#info').textContent = 'Không kết nối được Ads AI Studio (http://127.0.0.1:3200). Web có đang chạy không?';
    $('#fill').disabled = true;
    current = null;
    return;
  }
  const p = r?.pending;
  const key = p ? `${p.jobId}:${p.index}` : null;
  if (key === (current && `${current.jobId}:${current.index}`)) return;
  current = p;
  if (!p) {
    $('#info').textContent = 'Chưa có cảnh nào. Trên web bấm "Gửi sang Flow" ở một cảnh.';
    $('#fill').disabled = true;
    return;
  }
  $('#info').innerHTML = '';
  const b = Object.assign(document.createElement('b'), { textContent: `Cảnh ${p.index + 1}/${p.total}` });
  const sub = Object.assign(document.createElement('div'), { className: 'muted', textContent: `${MODE_TEXT[p.mode]} · ${p.prompt.length} ký tự` });
  $('#info').append(b, ` · ${p.title}`, sub);
  $('#fill').disabled = false;
  $('#fill').textContent = `Điền cảnh ${p.index + 1} vào Flow`;
}

$('#fill').addEventListener('click', async () => {
  if (!current || busy) return;
  busy = true;
  $('#fill').disabled = true;
  try {
    const { pending, error } = await chrome.runtime.sendMessage({ type: 'getPending' });
    if (error || !pending) throw new Error(error || 'Cảnh không còn chờ');
    await fill(pending, $('#model').value);
    await chrome.runtime.sendMessage({ type: 'armed', jobId: pending.jobId, index: pending.index });
    status(`Đã điền cảnh ${pending.index + 1}. Kiểm tra lại rồi BẤM NÚT → ĐỂ TẠO.\nVideo xong: ⋮ trên ô video → Tải xuống → 720p. Extension tự gửi về web.`, 'ok');
  } catch (e) {
    status(e.message, 'err');
  } finally {
    busy = false;
    $('#fill').disabled = !current;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'clipResult') return;
  if (msg.ok) {
    status(`✓ Clip cảnh ${msg.scene + 1} đã về web.${msg.next != null ? ` Cảnh ${msg.next + 1} sẵn sàng.` : ' Đã đủ cảnh — sang web bấm Ghép video.'}`, 'ok');
    current = null;
    poll();
  } else {
    status(`Gửi clip về web lỗi: ${msg.error}`, 'err');
  }
});

poll();
setInterval(poll, 3000);
