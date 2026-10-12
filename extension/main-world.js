// Chạy trong "main world" của trang Flow. Flow tạo <input type=file> rồi gọi .click() để mở hộp chọn file;
// khi extension đã chuẩn bị sẵn một file, ta gán file đó vào input thay vì mở hộp thoại.
(() => {
  let pendingFile = null;

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'adsai' || e.data.type !== 'arm-file') return;
    pendingFile = new File([e.data.buffer], e.data.name, { type: e.data.mime });
  });

  const origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file' && pendingFile) {
      const dt = new DataTransfer();
      dt.items.add(pendingFile);
      this.files = dt.files;
      pendingFile = null;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      window.postMessage({ source: 'adsai', type: 'file-used' }, '*');
      return;
    }
    return origClick.call(this);
  };
})();
