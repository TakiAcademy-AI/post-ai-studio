// Các bước điền một cảnh vào ô nhập của Google Flow (cài đặt, ảnh/hình đại diện, giọng, prompt). Server tiêm file này
// vào trang Flow trong Chrome Flow (lib/flow-auto.js) rồi tự bấm tạo. Selector dựa trên nhãn tiếng Việt của Flow
// (đo ngày 2026-10-12; luôn mở Flow với ?hl=vi).

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

// Hộp thoại của Flow nhớ lựa chọn lần trước: bấm vào mục ĐANG được chọn là bỏ chọn → chỉ bấm khi chưa chọn.
async function selectOption(opt) {
  if (opt.getAttribute('aria-selected') !== 'true') press(opt);
  await sleep(600);
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
  // Bảng nhớ tab dùng lần trước (vd. "Hình đại diện" — không có nút tải lên) → chuyển sang tab "Tệp tải lên".
  if (!byText('button', 'Tải nội dung nghe nhìn')) {
    const tab = await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find((t) => visible(t) && /Tệp tải lên|Tất cả/.test(t.innerText)), 'tab "Tệp tải lên"', 5000).catch(() => null);
    if (tab) { press(tab); await sleep(700); }
  }
  // Bỏ chọn mục đang được chọn sẵn từ lần trước (để "Thêm vào câu lệnh" chỉ thêm đúng ảnh này).
  for (const o of document.querySelectorAll('button[role="option"][aria-selected="true"]')) if (visible(o)) { press(o); await sleep(250); }
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

// @me = hình đại diện "Tôi" của tài khoản Flow (giọng thật của chủ tài khoản).
// Gõ "@" trong prompt mở ô gợi ý lúc được lúc không, nên thêm qua nút + → tab "Hình đại diện" → "Tôi".
// Kết quả giống gõ @me (thêm 1 thành phần khuôn mặt), chỉ không chèn chữ "Tôi" vào prompt.
async function addAvatar() {
  const plus = await waitFor(() => document.querySelector('button[aria-label="Thêm thành phần vào ô nhập câu lệnh"]'), 'nút + thêm thành phần');
  press(plus);
  const tab = await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find((t) => visible(t) && t.innerText.includes('Hình đại diện')), 'mục "Hình đại diện"');
  press(tab);
  await sleep(800);
  const opt = await waitFor(() => [...document.querySelectorAll('[role="option"]')].find((o) => visible(o) && o.innerText.trim().startsWith('Tôi')),
    'hình đại diện "Tôi" — tài khoản Flow này đã tạo hình đại diện (@me) chưa?', 8000);
  const before = composerChips().length;
  await selectOption(opt);
  const add = await waitFor(() => byText('button', 'Thêm vào câu lệnh') || (!byText('[role="tab"]', 'Hình đại diện') && 'closed'), 'nút "Thêm vào câu lệnh"', 6000);
  if (add !== 'closed') press(add);
  await sleep(1000);
  if (composerChips().length <= before) throw new Error('Chưa gắn được hình đại diện "Tôi" — thử "Điền lại"');
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
  const before = composerChips().length;
  await selectOption(opt);
  const add = await waitFor(() => byText('button', 'Thêm vào câu lệnh') || (!byText('[role="tab"]', 'Giọng nói') && 'closed'), 'nút "Thêm vào câu lệnh"', 6000);
  if (add !== 'closed') press(add);
  await sleep(1000);
  if (composerChips().length <= before) throw new Error(`Chưa gắn được giọng ${name} — thử "Điền lại"`);
}

// Chế độ tạo ẢNH (Nano Banana): dùng cho ảnh bối cảnh / trang phục (không có người) gắn vào mọi cảnh.
async function fillImage(prompt) {
  if (!location.pathname.startsWith('/project/')) throw new Error('Hãy mở một dự án Flow');
  const btn = await openSettings();
  await pickRadio('Hình ảnh');
  await pickRadio('9:16');
  await pickRadio('x1', false);
  if (byText('button[role=radio]', '9:16')) press(btn);
  await sleep(400);
  await clearComposerMedia();
  await setPrompt(prompt);
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
  if (p.voice === 'me' && p.mode !== 'frames') { status('Đang gắn hình đại diện "Tôi" (@me)…'); await addAvatar(); }
  else if (p.voice && p.mode !== 'frames') { status(`Đang gắn giọng ${p.voice}…`); await addVoice(p.voice); }
  status('Đang điền prompt…');
  await setPrompt(p.prompt);
}
