// Service worker: nói chuyện với Ads AI Studio (localhost) và theo dõi file tải về.
// Fetch từ đây không dính CORS vì localhost nằm trong host_permissions.
const API = 'http://127.0.0.1:3200';

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// Chỉ nhận file tải về SAU khi cảnh đã được điền, để không vơ nhầm file khác trong ~/Downloads.
async function getArmed() {
  return (await chrome.storage.session.get('armed')).armed || null;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === 'getPending') {
      const { pending } = await api('/api/bridge');
      if (msg.withImage && pending?.imageUrl) {
        const blob = await (await fetch(API + pending.imageUrl)).blob();
        pending.imageB64 = await toBase64(blob);
        pending.imageMime = blob.type || 'image/jpeg';
      }
      return { pending };
    }
    if (msg.type === 'armed') {
      await chrome.storage.session.set({ armed: { jobId: msg.jobId, index: msg.index, at: Date.now() } });
      return { ok: true };
    }
    if (msg.type === 'report') {
      await api('/api/bridge/event', { method: 'POST', body: JSON.stringify({ level: msg.level, text: String(msg.text).slice(0, 500) }) });
      return { ok: true };
    }
    if (msg.type === 'getArmed') {
      return { armed: await getArmed() };
    }
    if (msg.type === 'clear') {
      await chrome.storage.session.remove('armed');
      await api('/api/bridge', { method: 'DELETE' });
      return { ok: true };
    }
    return { error: 'unknown message' };
  })()
    .then(reply)
    .catch((e) => reply({ error: e.message }));
  return true;
});

async function notifyFlowTabs(payload) {
  const tabs = await chrome.tabs.query({ url: 'https://flow.google.com/*' });
  for (const t of tabs) chrome.tabs.sendMessage(t.id, payload).catch(() => {});
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== 'complete') return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item || !/\.(mp4|mov|webm)$/i.test(item.filename)) return;
  const armed = await getArmed();
  if (!armed || new Date(item.startTime).getTime() < armed.at) return;
  try {
    const r = await api('/api/bridge/clip', { method: 'POST', body: JSON.stringify({ path: item.filename }) });
    await chrome.storage.session.remove('armed');
    notifyFlowTabs({ type: 'clipResult', ok: true, scene: r.scene, next: r.next });
  } catch (e) {
    notifyFlowTabs({ type: 'clipResult', ok: false, error: e.message });
  }
});
