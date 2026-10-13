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

async function uploadAndSelect(img, openPicker) {
  const p = { imageName: img.name };
  const bytes = Uint8Array.from(atob(img.b64), (c) => c.charCodeAt(0));
  window.postMessage({ source: 'adsai', type: 'arm-file', name: img.name, mime: img.mime, buffer: bytes.buffer }, '*');
  await openPicker();
  const up = await waitFor(() => byText('button', 'Tải nội dung nghe nhìn'), 'nút "Tải nội dung nghe nhìn lên"');
  press(up);
  // Đợi ảnh tải xong: mục trong danh sách (button[role=option]) có tên file và đã có ảnh thu nhỏ
  // (lúc đang tải chỉ có vòng xoay). Lưới phía sau hộp thoại cũng có ô cùng tên — không được bấm nhầm ô đó.
  // Hộp thoại của nút + có thể kèm chữ khác trong mục (loại, ngày…) → so theo tiêu đề, hoặc "có chứa" tên file.
  const matches = (b) => {
    const title = b.querySelector('.asset-title')?.textContent.trim();
    return title ? title === p.imageName : b.textContent.includes(p.imageName);
  };
  const row = await waitFor(() => [...document.querySelectorAll('button[role="option"]')].find((b) =>
    visible(b) && b.querySelector('img') && matches(b)), 'ảnh vừa tải lên trong danh sách', 60000);
  press(row);
  await waitFor(() => row.getAttribute('aria-selected') === 'true', 'ảnh được chọn', 5000).catch(() => {});
  await sleep(400);
  // Hộp thoại khung hình cần bấm "Thêm vào câu lệnh"; hộp thoại của nút + có thể thêm ngay khi chọn và tự đóng.
  const pickerOpen = () => Boolean(byText('button', 'Tải nội dung nghe nhìn'));
  const next = await waitFor(() => byText('button', 'Thêm vào câu lệnh') || (!pickerOpen() && 'closed'), 'nút "Thêm vào câu lệnh"', 6000)
    .catch(() => {
      const btns = [...document.querySelectorAll('button')].filter(visible).map((b) => (b.getAttribute('aria-label') || b.innerText).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 25);
      throw new Error(`Đã chọn ảnh nhưng không thấy cách thêm vào câu lệnh. Nút đang hiện: ${btns.join(' | ')}`);
    });
  if (next !== 'closed') press(next);
  await sleep(1200);
}

async function setStartFrame(img) {
  await uploadAndSelect(img, async () => {
    const slotLeaf = await waitFor(() => leaf('Bắt đầu'), 'ô khung "Bắt đầu"');
    press(clickable(slotLeaf));
  });
}

async function addIngredient(img) {
  await uploadAndSelect(img, async () => {
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

// Ảnh/khung/giọng còn sót trong ô nhập (Flow giữ lại sau lần tạo trước) → gỡ hết trước khi điền cảnh mới.
// Thành phần nằm phía trên ô prompt: nút aria-label "Thành phần" (ảnh, giọng) hoặc nút có <img> (khung đầu).
// Không đụng nút "Xoá câu lệnh" cùng hàng — bấm nó là xoá cả ô nhập.
function composerChips() {
  const ed = document.querySelector('.ProseMirror[contenteditable="true"]');
  const settings = document.querySelector('button[aria-label="Điều kiện kích hoạt cài đặt"]');
  if (!ed || !settings) return [];
  let box = ed;
  while (box && !box.contains(settings)) box = box.parentElement;
  if (!box) return [];
  const top = ed.getBoundingClientRect().top;
  return [...box.querySelectorAll('button')].filter((b) => visible(b) && b.getBoundingClientRect().bottom <= top + 4
    && b.getAttribute('aria-label') !== 'Xoá câu lệnh'
    && (b.getAttribute('aria-label') === 'Thành phần' || b.querySelector('img')));
}

async function clearComposerMedia() {
  for (let k = 0; k < 8; k++) {
    const chip = composerChips()[0];
    if (!chip) return;
    press(chip);
    await sleep(500);
  }
}

// Giọng đọc cố định: + → tab "Giọng nói" → chọn đúng tên → "Thêm vào câu lệnh".
async function addVoice(name) {
  const plus = await waitFor(() => document.querySelector('button[aria-label="Thêm thành phần vào ô nhập câu lệnh"]'), 'nút + thêm thành phần');
  press(plus);
  const tab = await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find((t) => visible(t) && t.innerText.includes('Giọng nói')), 'mục "Giọng nói"');
  press(tab);
  await sleep(800);
  const findOpt = () => [...document.querySelectorAll('button[role="option"]')].find((b) => visible(b) && b.innerText.replace(/voice_selection/, '').trim().startsWith(name));
  let opt = findOpt();
  // Danh sách dài → cuộn để tìm.
  for (let k = 0; !opt && k < 10; k++) {
    let sc = document.querySelector('button[role="option"]')?.parentElement;
    while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
    if (sc) sc.scrollTop += 400;
    await sleep(300);
    opt = findOpt();
  }
  if (!opt) throw new Error(`Không thấy giọng "${name}" trong Flow`);
  opt.scrollIntoView({ block: 'center' });
  press(opt);
  await sleep(600);
  const add = await waitFor(() => byText('button', 'Thêm vào câu lệnh') || (!byText('[role="tab"]', 'Giọng nói') && 'closed'), 'nút "Thêm vào câu lệnh"', 6000);
  if (add !== 'closed') press(add);
  await sleep(1000);
}

async function fill(p, model) {
  if (!location.pathname.startsWith('/project/')) throw new Error('Hãy mở một dự án Flow (bấm "Dự án mới" hoặc một dự án có sẵn) rồi bấm lại');
  status('Đang chỉnh cài đặt…');
  await applySettings(p.mode, model);
  await clearComposerMedia();
  const imgs = p.images || [];
  if (p.mode === 'frames' && imgs[0]) { status('Đang tải khung đầu lên…'); await setStartFrame(imgs[0]); }
  if (p.mode === 'ingredients') {
    for (const [k, img] of imgs.entries()) {
      status(`Đang thêm ảnh tham chiếu ${k + 1}/${imgs.length}…`);
      await addIngredient(img);
    }
  }
  if (p.voice && p.mode !== 'frames') { status(`Đang gắn giọng ${p.voice}…`); await addVoice(p.voice); }
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
    <button id="fill" class="act" disabled>Điền lại (chỉ khi cần)</button>
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
  // Lỗi và kết quả chính được ghi vào nhật ký job trên web để dễ kiểm tra từ xa.
  if (cls === 'err' || cls === 'ok') chrome.runtime.sendMessage({ type: 'report', level: cls, text }).catch(() => {});
}

chrome.storage.local.get('model').then(({ model }) => { if (model) $('#model').value = model; });
$('#model').addEventListener('change', () => chrome.storage.local.set({ model: $('#model').value }));
$('#tog').addEventListener('click', () => $('.box').classList.toggle('min'));

const MODE_TEXT = { frames: 'Khung hình (khung đầu = khung cuối cảnh trước)', ingredients: 'Thành phần (ảnh nhân vật + bối cảnh)', text: 'Chỉ prompt' };

// ---------- tự tải clip khi Flow tạo xong ----------
// Video được gắn với ĐÚNG lần người dùng bấm nút tạo cho cảnh đã điền:
//  - chỉ bắt đầu theo dõi sau cú bấm thật (isTrusted) vào "Bắt đầu tạo" / Enter trong ô prompt;
//  - ô video mới = ô đã xong (có nút ⋮) chưa từng có lúc bấm, nằm ở đầu lưới;
//  - mỗi ô video chỉ gồm ĐÚNG MỘT ảnh thu nhỏ (trước đây leo quá xa lên khung lưới → bấm nhầm ⋮ của video khác).
const THUMB = 'img[alt="Hình thu nhỏ của video đã tạo"]';

function videoTiles() {
  return [...document.querySelectorAll(THUMB)].map((img) => {
    let t = img;
    while (t.parentElement && t.parentElement.querySelectorAll(THUMB).length === 1) t = t.parentElement;
    const menu = t.querySelector('button[aria-label="Tuỳ chọn khác"]');
    return menu ? { root: t, menu, src: img.getAttribute('src') } : null;
  }).filter(Boolean);
}

let armedScene = null; // cảnh đã điền, chờ người bấm tạo
let gen = null;        // { scene, beforeEls:Set, beforeSrc:Set, t0, skip:Set }

// Ô video tạo thất bại hiện chữ "Không thành công" (vd. "Đã hết thời gian tạo. Hãy thử lại." — Flow hoàn credit).
const FAIL_TEXT = 'Không thành công';
function failNodes() {
  return [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && e.textContent.trim() === FAIL_TEXT && visible(e));
}

function onSubmit() {
  if (!armedScene || gen) return; // bấm tạo lần 2 cho cùng cảnh → vẫn dùng video của lần bấm đầu
  const tiles = videoTiles();
  gen = {
    scene: armedScene, beforeEls: new Set(tiles.map((t) => t.root)), beforeSrc: new Set(tiles.map((t) => t.src)),
    beforeFails: new Set(failNodes()), t0: Date.now(), skip: new Set(), downloading: false,
  };
  status(`Đang tạo cảnh ${armedScene.index + 1}… video xong extension tự tải về web.`);
}

document.addEventListener('click', (e) => {
  if (e.isTrusted && e.target.closest?.('button[aria-label="Bắt đầu tạo"]')) onSubmit();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.isTrusted && e.key === 'Enter' && !e.shiftKey && e.target.closest?.('.ProseMirror')) onSubmit();
}, true);

async function downloadTile(tile) {
  press(tile.menu);
  const dl = await waitFor(() => byText('[role="menuitem"]', 'Tải xuống'), 'mục "Tải xuống"', 5000);
  for (const n of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) dl.dispatchEvent(new MouseEvent(n, { bubbles: true }));
  press(dl);
  const q = await waitFor(() => byText('[role="menuitem"]', '720p'), 'mục "720p"', 5000);
  press(q);
}

async function checkGen() {
  if (!gen || gen.downloading) return;
  if (Date.now() - gen.t0 > 25 * 60 * 1000) {
    status('Quá 25 phút chưa thấy video mới. Nếu đã xong, tự bấm ⋮ → Tải xuống → 720p là clip vẫn về web.', 'err');
    gen = null;
    return;
  }
  // Flow báo tạo thất bại → báo ngay, bỏ theo dõi lần bấm này để lần bấm → tiếp theo được tính là lần tạo mới.
  const failed = failNodes().find((n) => !gen.beforeFails.has(n));
  if (failed) {
    let box = failed;
    for (let k = 0; k < 4 && box.parentElement && box.innerText.length < 40; k++) box = box.parentElement;
    const why = box.innerText.replace(/\s+/g, ' ').replace(/Theo dõi trạng thái.*$/i, '').trim().slice(0, 180);
    status(`Flow tạo cảnh ${gen.scene.index + 1} thất bại: ${why}\nCredit được hoàn. Bấm → để tạo lại (ô nhập trống thì bấm "Điền lại" trước).`, 'err');
    gen = null;
    return;
  }
  const fresh = videoTiles().slice(0, 4).find((t) => !gen.beforeEls.has(t.root) && !gen.beforeSrc.has(t.src) && !gen.skip.has(t.src));
  if (!fresh) return;
  gen.downloading = true;
  gen.current = fresh.src;
  status(`Video cảnh ${gen.scene.index + 1} đã xong — đang tải 720p…`);
  try {
    await sleep(1500);
    await chrome.runtime.sendMessage({ type: 'expectDownload', jobId: gen.scene.jobId, index: gen.scene.index });
    await downloadTile(fresh);
    status(`Đang gửi clip cảnh ${gen.scene.index + 1} về web…`);
  } catch (e) {
    status(`Không tự tải được (${e.message}). Bấm ⋮ → Tải xuống → 720p là clip vẫn về web.`, 'err');
    gen.downloading = false;
    gen.skip.add(fresh.src);
  }
}

// ---------- tự điền khi web gửi cảnh mới ----------
async function doFill(p) {
  busy = true;
  $('#fill').disabled = true;
  try {
    // Lấy kèm ảnh khung đầu / ảnh nhân vật chỉ lúc điền (poll 3 giây/lần thì không cần ảnh).
    const { pending, error } = await chrome.runtime.sendMessage({ type: 'getPending', withImage: true });
    if (error || !pending || pending.jobId !== p.jobId || pending.index !== p.index) throw new Error(error || 'Cảnh không còn chờ');
    await fill(pending, $('#model').value);
    await chrome.runtime.sendMessage({ type: 'armed', jobId: pending.jobId, index: pending.index });
    armedScene = { jobId: pending.jobId, index: pending.index };
    gen = null;
    status(`Đã điền cảnh ${pending.index + 1}. Kiểm tra rồi BẤM NÚT → ĐỂ TẠO.\nVideo xong extension tự tải 720p và gửi về web.`, 'ok');
  } catch (e) {
    status(e.message, 'err');
  } finally {
    busy = false;
    $('#fill').disabled = !current;
  }
}

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
    $('#info').textContent = 'Chưa có cảnh nào. Trên web bấm "Điền cảnh … vào Flow" — tab này sẽ tự điền.';
    $('#fill').disabled = true;
    return;
  }
  $('#info').innerHTML = '';
  const b = Object.assign(document.createElement('b'), { textContent: `Cảnh ${p.index + 1}/${p.total}` });
  const sub = Object.assign(document.createElement('div'), { className: 'muted', textContent: `${MODE_TEXT[p.mode]} · ${p.prompt.length} ký tự` });
  $('#info').append(b, ` · ${p.title}`, sub);
  $('#fill').disabled = false;
  $('#fill').textContent = `Điền lại cảnh ${p.index + 1} (chỉ khi cần)`;

  // Cảnh này đã điền rồi (vd. vừa tải lại trang) → không điền lần nữa, chỉ theo dõi video mới.
  const { armed } = await chrome.runtime.sendMessage({ type: 'getArmed' });
  if (armed && `${armed.jobId}:${armed.index}` === key) {
    armedScene = { jobId: p.jobId, index: p.index };
    status(`Cảnh ${p.index + 1} đã được điền. Bấm → để tạo; video xong sẽ tự tải về web.`, 'ok');
    return;
  }
  if (!location.pathname.startsWith('/project/')) {
    status('Mở một dự án Flow (Dự án mới hoặc dự án có sẵn) — extension sẽ tự điền.', 'muted');
    current = null; // để lần poll sau thử lại khi đã vào dự án
    return;
  }
  doFill(p);
}

$('#fill').addEventListener('click', async () => {
  if (!current || busy) return;
  doFill(current);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'clipResult') return;
  if (msg.ok) {
    status(`✓ Clip cảnh ${msg.scene + 1} đã về web.${msg.next != null ? ` Đang chuẩn bị cảnh ${msg.next + 1}…` : ' Đã đủ cảnh — sang web bấm Ghép video.'}`, 'ok');
    gen = null;
    armedScene = null;
    current = null;
    setTimeout(poll, 1500);
  } else {
    // Web từ chối (trùng / khung đầu không khớp) → bỏ qua ô đó, tiếp tục chờ đúng video.
    status(`Web không nhận clip: ${msg.error}
Đang chờ video đúng của cảnh này…`, 'err');
    if (gen) { gen.skip.add(gen.current); gen.downloading = false; }
  }
});

poll();
setInterval(poll, 3000);
setInterval(checkGen, 2000);
