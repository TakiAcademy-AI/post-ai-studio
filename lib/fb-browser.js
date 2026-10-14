// Đăng Reel lên Page qua giao diện Meta Business Suite trong "Chrome Facebook" (Playwright/CDP) — như người đăng tay,
// không qua Graph API. Không có mẹo che giấu tự động hoá; đăng nhập Facebook do người dùng tự làm trong cửa sổ đó.
import * as FB from './fb-chrome.js';
import { readSettings, writeSettings } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Business Suite theo ngôn ngữ tài khoản Facebook; nhãn dò cả tiếng Việt lẫn tiếng Anh.
const BS = 'https://business.facebook.com/latest';

/** Đã đăng nhập Facebook chưa, và (nếu có pageId) Business Suite có mở được Page đó không. */
export async function checkLogin(pageId) {
  await FB.ensure();
  const b = await FB.connect();
  try {
    const ctx = b.contexts()[0];
    const uid = (await ctx.cookies('https://www.facebook.com')).find((c) => c.name === 'c_user')?.value;
    if (!uid) return { ok: false, reason: 'Chrome Facebook chưa đăng nhập Facebook' };
    if (!pageId) return { ok: true, uid };
    const page = await ctx.newPage();
    try {
      await page.goto(`${BS}/home?asset_id=${pageId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(6000);
      const url = page.url();
      if (/loginpage|login\.php|checkpoint/.test(url)) return { ok: false, uid, reason: `Business Suite đòi đăng nhập lại (${url.split('?')[0]})` };
      return { ok: true, uid, url };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await b.close().catch(() => {});
  }
}

// ---------- Page để đăng (lấy từ bảng chuyển tài sản của Business Suite, không cần Graph API) ----------
export function browserPage() { return readSettings().fbBrowserPage || null; } // { id, name }

async function openSwitcher(page) {
  await page.goto(`${BS}/home`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (/loginpage|login\.php|checkpoint/.test(page.url())) throw new Error('Chrome Facebook chưa đăng nhập Facebook');
  const btn = page.locator('[aria-haspopup="listbox"]').locator('visible=true').first();
  await btn.waitFor({ timeout: 40000 });
  await btn.click();
  await page.locator('input[type="radio"]').first().waitFor({ timeout: 15000 });
  await sleep(800);
}

const radioRows = (page) => page.evaluate(() => [...document.querySelectorAll('input[type="radio"]')].map((r) => {
  let row = r;
  for (let k = 0; k < 8 && row.parentElement && !/Trang Facebook|Facebook Page/.test(row.innerText); k++) row = row.parentElement;
  const lines = row.innerText.split('\n').map((x) => x.trim()).filter(Boolean);
  return /Trang Facebook|Facebook Page/.test(row.innerText) ? { name: lines[0], checked: r.checked } : null;
}).filter(Boolean));

/** Danh sách Page tài khoản trong Chrome Facebook quản lý (tên), kèm Page đang mở. */
export async function listPages() {
  await FB.ensure();
  const b = await FB.connect();
  const page = await b.contexts()[0].newPage();
  try {
    await openSwitcher(page);
    const seen = new Map();
    for (let k = 0, stable = 0; k < 40 && stable < 3; k++) {
      const before = seen.size;
      for (const r of await radioRows(page)) if (!seen.has(r.name)) seen.set(r.name, r);
      stable = seen.size === before ? stable + 1 : 0;
      // cuộn khung danh sách (phần tử cuộn được gần nút chọn cuối cùng)
      // Danh sách chỉ hiện 20 Page đầu; nút "Xem thêm" ở cuối nạp tiếp.
      await page.locator('input[type="radio"]').last().scrollIntoViewIfNeeded().catch(() => {});
      const more = page.getByRole('button', { name: /^(Xem thêm|See more|Show more)$/ }).locator('visible=true');
      let clicked = false;
      for (let i = 0; i < await more.count() && !clicked; i++) {
        const bb = await more.nth(i).boundingBox();
        const lastBb = await page.locator('input[type="radio"]').last().boundingBox().catch(() => null);
        if (bb && lastBb && bb.y > lastBb.y && bb.y - lastBb.y < 200) { await more.nth(i).click(); clicked = true; }
      }
      if (!clicked && stable >= 1) stable = 3;
      await sleep(700);
    }
    const current = page.url().match(/asset_id=(\d+)/)?.[1] || null;
    return { pages: [...seen.values()].map((x) => x.name), current: { id: current, name: [...seen.values()].find((x) => x.checked)?.name || null } };
  } finally {
    await page.close().catch(() => {});
    await b.close().catch(() => {});
  }
}

/** Chọn Page theo tên trong bảng chuyển tài sản → đọc asset_id trên URL → lưu làm Page để đăng. */
export async function selectPage(name) {
  await FB.ensure();
  const b = await FB.connect();
  const page = await b.contexts()[0].newPage();
  try {
    await openSwitcher(page);
    const before = page.url().match(/asset_id=(\d+)/)?.[1] || null;
    const search = page.locator('input[type="text"], input[type="search"]').locator('visible=true').first();
    await search.fill(name);
    await sleep(1500);
    const ok = await page.evaluate((want) => {
      for (const r of document.querySelectorAll('input[type="radio"]')) {
        let row = r;
        for (let k = 0; k < 8 && row.parentElement && !/Trang Facebook|Facebook Page/.test(row.innerText); k++) row = row.parentElement;
        if (row.innerText.split('\n').map((x) => x.trim()).filter(Boolean)[0] === want) { (row.querySelector('[role="radio"], [role="button"]') || r).click(); return true; }
      }
      return false;
    }, name);
    if (!ok) throw new Error(`Không thấy Page "${name}" trong Business Suite của tài khoản này`);
    let id = null;
    for (let k = 0; k < 30; k++) {
      await sleep(500);
      id = page.url().match(/asset_id=(\d+)/)?.[1] || null;
      if (id && (id !== before || k > 6)) break;
    }
    if (!id) throw new Error('Chọn Page xong nhưng không đọc được mã Page (asset_id)');
    const sel = { id, name };
    writeSettings({ fbBrowserPage: sel });
    return sel;
  } finally {
    await page.close().catch(() => {});
    await b.close().catch(() => {});
  }
}

// Nhãn nút theo tiếng Việt (tài khoản đang dùng) kèm tiếng Anh dự phòng.
const L = {
  addVideo: /^(Thêm video|Add video)$/,
  next: /^(Tiếp|Next)$/,
  now: /^(Chia sẻ ngay|Share now)$/,
  schedule: /^(Lên lịch|Schedule)$/,
  draft: /^(Lưu làm bản nháp|Save as draft)$/,
  final: /^(Chia sẻ|Share|Lên lịch|Schedule|Lưu|Save|Lưu bản nháp|Lưu làm bản nháp|Save draft|Save as draft)$/,
};

async function bodyText(page) { return page.evaluate(() => document.body.innerText).catch(() => ''); }

/** Nút đang hiện có tên khớp re, lấy cái thấp nhất trên màn hình (thanh nút dưới cùng của trình soạn). */
async function lowestButton(page, re) {
  const all = page.getByRole('button', { name: re }).locator('visible=true');
  let best = null, bestY = -1;
  for (let i = 0; i < await all.count(); i++) {
    const bb = await all.nth(i).boundingBox();
    if (bb && bb.y > bestY) { best = all.nth(i); bestY = bb.y; }
  }
  return best;
}

async function waitEnabled(loc, what, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (loc && (await loc.getAttribute('aria-disabled').catch(() => 'true')) !== 'true') return;
    await sleep(1000);
  }
  throw new Error(`Chờ quá lâu: ${what}`);
}

/** Ngày giờ theo múi giờ Business Suite đang hiện (vd. Asia/Jakarta). */
function partsIn(tz, unixSec) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(unixSec * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.day}/${p.month}/${p.year}`, hh: p.hour, mm: p.minute };
}

/**
 * Đăng Reel qua Meta Business Suite. mode: 'publish' | 'schedule' | 'draft'. scheduledAt: unix giây (mode schedule).
 * Trả { ok, url } khi trình soạn đóng / báo xong.
 */
export async function postReel({ pageId, file, caption = '', mode = 'draft', scheduledAt = null, log = () => {} }) {
  await FB.ensure();
  const b = await FB.connect();
  const page = await b.contexts()[0].newPage();
  try {
    log('Mở trình soạn thước phim của Business Suite…');
    await page.goto(`${BS}/reels_composer/?asset_id=${pageId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const add = page.getByRole('button', { name: L.addVideo }).locator('visible=true').first();
    await add.waitFor({ timeout: 45000 }).catch(() => {});
    if (/loginpage|login\.php|checkpoint/.test(page.url())) throw new Error('Chrome Facebook chưa đăng nhập — tab Tài khoản → Chrome Facebook → Hiện cửa sổ và đăng nhập');
    if (!(await add.isVisible().catch(() => false))) throw new Error('Không mở được trình soạn thước phim (Page có đúng quyền quản trị với tài khoản trong Chrome Facebook không?)');

    log('Tải video lên…');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 20000 }), add.click()]);
    await chooser.setFiles(file);
    const t0 = Date.now();
    while (!/\b100%/.test(await bodyText(page))) {
      if (Date.now() - t0 > 10 * 60 * 1000) throw new Error('Tải video lên Business Suite quá 10 phút');
      await sleep(2000);
    }

    if (caption.trim()) {
      log('Điền mô tả…');
      const box = page.locator('[contenteditable="true"][role="textbox"]').locator('visible=true').first();
      await box.click();
      const lines = caption.replace(/\r/g, '').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) await page.keyboard.insertText(lines[i]);
        if (i < lines.length - 1) await page.keyboard.press('Shift+Enter');
      }
      await page.keyboard.press('Escape').catch(() => {}); // đóng gợi ý hashtag nếu có
    }

    for (const step of ['Chỉnh sửa', 'Chia sẻ']) {
      const next = await lowestButton(page, L.next);
      if (!next) throw new Error(`Không thấy nút "Tiếp" để sang bước ${step}`);
      await waitEnabled(next, `nút "Tiếp" (Facebook còn xử lý video)`);
      await next.click();
      await sleep(3000);
    }

    log({ publish: 'Chọn "Chia sẻ ngay"…', schedule: 'Chọn "Lên lịch"…', draft: 'Chọn "Lưu làm bản nháp"…' }[mode]);
    const opt = page.getByRole('button', { name: { publish: L.now, schedule: L.schedule, draft: L.draft }[mode] }).locator('visible=true').first();
    await opt.click({ timeout: 20000 });
    await sleep(1200);

    if (mode === 'schedule') {
      const text = await bodyText(page);
      const tz = text.match(/\b(?:Asia|Europe|America|Africa|Australia|Pacific|Etc)\/[A-Za-z_+-]+/)?.[0] || 'Asia/Ho_Chi_Minh';
      const p = partsIn(tz, Number(scheduledAt));
      log(`Hẹn ${p.date} ${p.hh}:${p.mm} (${tz})…`);
      const date = page.locator('input[placeholder="dd/mm/yyyy"]').locator('visible=true').first();
      await date.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type(p.date);
      await page.keyboard.press('Enter');
      await sleep(500);
      for (const [label, v] of [['giờ', p.hh], ['phút', p.mm]]) {
        const inp = page.locator(`input[aria-label="${label}"], input[aria-label="${label === 'giờ' ? 'hours' : 'minutes'}"]`).locator('visible=true').first();
        await inp.click();
        await page.keyboard.type(v);
      }
      await page.keyboard.press('Tab');
      await sleep(800);
      const got = await page.evaluate(() => [...document.querySelectorAll('input[aria-label="giờ"],input[aria-label="phút"],input[aria-label="hours"],input[aria-label="minutes"]')]
        .filter((e) => e.offsetParent).map((e) => Number(e.getAttribute('aria-valuenow'))));
      if (got[0] !== Number(p.hh) || got[1] !== Number(p.mm)) throw new Error(`Không đặt được giờ hẹn (đọc lại ${got.join(':')}, cần ${p.hh}:${p.mm})`);
    }

    const final = await lowestButton(page, L.final);
    if (!final) throw new Error('Không thấy nút đăng cuối cùng');
    await waitEnabled(final, 'nút đăng (Facebook còn kiểm tra video)');
    const label = (await final.innerText()).trim();
    log(`Bấm "${label}"…`);
    await final.click();

    // Business Suite không luôn đóng trình soạn sau khi bấm → canh lỗi 20 giây, rồi xác nhận bằng danh sách bài của Page.
    const t1 = Date.now();
    while (Date.now() - t1 < 20000) {
      await sleep(2000);
      if (!page.url().includes('reels_composer')) break;
      const err = (await bodyText(page)).match(/(Đã xảy ra lỗi[^\n]{0,160}|Không thể (đăng|lên lịch|lưu)[^\n]{0,160}|Something went wrong[^\n]{0,160})/i)?.[0];
      if (err) throw new Error(`Business Suite báo: ${err}`);
    }
    const list = { publish: 'published_posts', schedule: 'scheduled_posts', draft: 'draft_posts' }[mode];
    const tab = { publish: 'Đã đăng', schedule: 'Đã lên lịch', draft: 'Bản nháp' }[mode];
    const head = caption.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!head) return { ok: true, verified: false };
    log(`Kiểm tra bài trong mục "${tab}"…`);
    const check = await b.contexts()[0].newPage();
    try {
      for (let k = 0; k < 8; k++) {
        await check.goto(`${BS}/posts/${list}?asset_id=${pageId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await check.waitForTimeout(7000);
        if ((await bodyText(check)).replace(/\s+/g, ' ').includes(head)) return { ok: true, verified: true, url: check.url() };
        await sleep(15000);
      }
    } finally {
      await check.close().catch(() => {});
    }
    throw new Error(`Đã bấm "${label}" nhưng sau ~3 phút chưa thấy bài trong mục "${tab}" của Business Suite — mở Business Suite kiểm tra`);
  } finally {
    await page.close().catch(() => {});
    await b.close().catch(() => {});
  }
}
