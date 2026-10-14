# Post AI Studio

Website chạy trên máy nhà, biến skill **Video AI** thành dây chuyền:

① Claude viết kịch bản + prompt từng cảnh → ② **Chrome Flow** tự tạo từng cảnh trên Google Flow → ③ ffmpeg tự ghép thành 1 Reel → ④ **Chrome Facebook** đăng lên Page qua Meta Business Suite (hẹn giờ / đăng ngay / nháp).

Cả khâu tạo video lẫn đăng bài đều chạy bằng trình duyệt như người thật bấm (Playwright điều khiển một Chrome riêng), không có mẹo che giấu tự động hoá.

## Tạo video tự động (Chrome Flow)

Làm theo cách của taki-agentic-ai:

1. Tab **Tài khoản → Google Flow**: chọn profile Chrome đã đăng nhập Google Flow → **Chép lại & mở** (chép cookie sang `data/flow-chrome`, Chrome hằng ngày không bị đụng) → **Kiểm tra đăng nhập Flow**. Chưa đăng nhập: **Hiện cửa sổ** rồi tự đăng nhập trong cửa sổ đó.
2. Trang video: chọn **Model Flow** → **▶ Tự tạo cả N cảnh**. Server mở Chrome Flow (cổng DevTools `9334`, đổi bằng `FLOW_CDP_PORT`), luôn mở Flow tiếng Việt (`?hl=vi`), tạo một dự án Flow riêng cho video, điền từng cảnh (code điền ở `flow-page/`), bấm tạo, chờ, tải 720p và gắn vào cảnh. Mỗi cảnh có nút **↻ Tự tạo lại cảnh này**.
3. Flow báo "hết thời gian tạo" hoặc chặn "người nổi tiếng" → tự thử lại 2 lần; lỗi khác / hết credit → dừng và báo lỗi ở cảnh đó. Đủ video mọi cảnh thì web **tự ghép** luôn.

Lưu ý: mỗi cảnh trừ credit Flow; tự động hoá có rủi ro Google chặn tài khoản — dùng tài khoản có hình đại diện "Tôi" của chính bạn nếu dùng giọng @me. Cửa sổ Chrome Flow được đẩy ra mép phải (không thu nhỏ vì trang sẽ ngừng vẽ). Clip mp4 vẫn kéo thả tay vào cảnh được nếu cần thay.

## Đăng Reel qua trình duyệt (Chrome Facebook)

Bài đăng KHÔNG đi qua Graph API — web đăng như người đăng tay qua **Meta Business Suite**:
1. Tab **Tài khoản → Facebook → Chrome Facebook**: chọn profile Chrome → **Chép lại & mở**. Facebook thường không nhận phiên chép sang → **tự đăng nhập một lần** trong cửa sổ Chrome Facebook (tài khoản quản trị Page), rồi **Kiểm tra đăng nhập Facebook**.
2. Trang video → Hẹn giờ / Đăng ngay / Lưu nháp → **Đăng lên <Page>**. Server mở trình soạn thước phim, tải video, điền caption, chọn kiểu đăng (hẹn giờ theo múi giờ Business Suite hiện), bấm nút cuối, rồi **xác nhận** bài nằm trong mục Đã đăng / Đã lên lịch / Bản nháp.
3. Graph API không còn dùng để đăng; chỉ để lấy danh sách Page (đăng nhập ở thẻ Facebook), dò lại video_id sau khi đăng, và tab **Lịch đăng** (làm mới trạng thái; đổi giờ / huỷ bài đã hẹn).

Page dùng là Page đang chọn ở thẻ Facebook. Chrome Facebook dùng cổng `9335` (`FB_CDP_PORT`).

## Chạy

```bash
cd ~/Downloads/post-ai-studio
npm install        # lần đầu
npm start          # mở http://127.0.0.1:3200
```

Yêu cầu trên máy:
- `claude` CLI đã đăng nhập (dùng gói đăng ký, không cần API key).
- Google Chrome (`/usr/bin/google-chrome`) cho Chrome Flow và Chrome Facebook.
- `ffmpeg` / `ffprobe`.

Cấu hình nằm trong `.env` (xem `.env.example`).

## Tài khoản Claude (viết kịch bản)

Cột trái → khung **Claude**:
- Mặc định dùng tài khoản đang đăng nhập trên máy (`~/.claude`, cũng là tài khoản của Claude Code) — web không đăng xuất tài khoản này.
- **＋ Thêm tài khoản** → mở link đăng nhập Claude (nên dùng cửa sổ ẩn danh nếu trình duyệt đang đăng nhập tài khoản khác)
  → chép mã trang hiện ra → dán vào web → **Xác nhận**. Tài khoản mới được dùng ngay.
- Ô chọn để đổi qua lại giữa các tài khoản; **Đăng xuất** gỡ tài khoản đã thêm.
- Mỗi tài khoản thêm từ web lưu ở `data/claude/<id>/` (thư mục cấu hình riêng, `CLAUDE_CONFIG_DIR`).
- Khi Claude báo hết hạn mức, lỗi trên web gợi ý đổi tài khoản.

## Kết nối Facebook (danh sách Page + Lịch đăng)

**Đăng nhập Facebook** (giống Ads OS, dùng chung app Facebook của Ads OS) — để web biết các Page và đọc trạng thái bài:
1. Cần App ID + App Secret của một app Facebook. Máy mới: tab **Tài khoản** → thẻ Facebook → nhập App ID/Secret
   → **Kiểm tra & lưu** (web xác nhận với Facebook, Secret mã hoá trong `data/settings.json`). Hoặc khai
   `FB_APP_ID` / `FB_APP_SECRET` trong `.env` (được ưu tiên). `ENCRYPTION_KEY` để trống thì web tự tạo `data/secret.key`.
2. Cột trái → **Đăng nhập Facebook** → popup Facebook → chọn các Page và cấp quyền → popup tự đóng.
3. Chọn **Page để đăng** trong ô chọn ở cột trái.

Quyền xin: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`.
Token dài hạn ~60 ngày (cột trái hiện số ngày còn lại) — hết hạn thì bấm **Đăng nhập lại**. Token user và token
từng Page lưu mã hoá AES-256-GCM trong `data/facebook.json` (quyền 600); đổi `ENCRYPTION_KEY` là phải đăng nhập lại.

Nếu popup báo "URL bị chặn" / redirect không hợp lệ: vào App Dashboard → Facebook Login → Settings → thêm
`http://localhost:3200/api/fb/callback` vào **Valid OAuth Redirect URIs** (mở web bằng `127.0.0.1` thì thêm cả
`http://127.0.0.1:3200/api/fb/callback`).

Cách dự phòng — dán token tay: khai `FB_PAGE_ID` + `FB_PAGE_TOKEN` (nên là token System User) trong `.env`.
Chỉ dùng khi chưa đăng nhập/chưa chọn Page.

## Quy trình

1. **Video mới** → điền chủ đề, số cảnh, CTA, mô tả nhân vật, ảnh tham chiếu (tuỳ chọn) → *Viết kịch bản* (1–3 phút).
2. Duyệt mạch video, bảng nối cảnh, sửa thoại/prompt từng cảnh. Prompt phải ≤ 4000 ký tự (Flow cắt phần thừa) — có bộ đếm và nút *Rút gọn prompt*.
3. *▶ Tự tạo cả N cảnh* — Chrome Flow làm lần lượt từng cảnh, mỗi cảnh **trừ credit Flow**.
4. Cảnh nào hỏng: *Bỏ clip cảnh này* rồi *↻ Tự tạo lại cảnh này*. Cảnh thừa đầu/cuối: chỉnh *Cắt đầu / Cắt cuối* (giây) thay vì render lại.
5. Đủ cảnh thì web tự ghép (hoặc bấm *Ghép video*) → 1080×1920, 30fps, AAC 48kHz, xoá watermark "Veo".
6. Sửa caption → chọn **Hẹn giờ đăng** (mặc định; > 10 phút và ≤ 29 ngày tới), **Đăng ngay**, hoặc **Lưu nháp** → bấm **Đăng lên <Page>**.
7. Tab **Lịch đăng** (đầu trang): mọi Reel đã gửi lên Facebook, mọi Page. Làm mới trạng thái từ Facebook, đổi giờ, đăng sớm (~11 phút), huỷ (xoá video khỏi Facebook), mở reel.
   Nháp nằm ở Business Suite → Nội dung → **Bản nháp**.
   Đổi giờ/huỷ dùng cập nhật Video node chung của Graph API (tài liệu Reels không mô tả) — nếu Facebook từ chối, sửa trong Business Suite.

## Giữ nhân vật đồng nhất

Flow không cho dùng cùng lúc khung đầu (chế độ Khung hình) và ảnh nhân vật (chế độ Thành phần). Mỗi video chọn một:
- **Giữ đúng mặt nhân vật** (mặc định khi có ảnh nhân vật): cảnh 2+ dùng *Thành phần* với 2 ảnh — ảnh nhân vật gốc +
  khung cuối cảnh trước (giữ bối cảnh, trang phục, tư thế). Chỗ nối là match cut, không liền khung tuyệt đối.
- **Nối cảnh liền khung**: cảnh 2+ dùng *Khung hình* với khung đầu = khung cuối cảnh trước. Nối mượt nhưng mặt trôi dần
  qua từng cảnh (đã thấy rõ ở video 4 cảnh ngày 13/10).

Có ảnh nhân vật mà để trống ô mô tả → Claude tự đọc ảnh để viết CHARACTER LOCK. Prompt được dặn tránh chữ tiếng Việt có
dấu trên màn hình (Veo vẽ sai dấu).

## Giọng đọc đồng nhất

Veo tự tạo giọng mới cho từng clip nên mỗi cảnh một giọng. Chọn **@me — giọng của tôi** (mặc định) để dùng hình đại
diện "Tôi" của tài khoản Flow (giống gõ @me trong prompt), hoặc một giọng trong thư viện Flow (Thành phần → **Giọng nói**:
Achird, Charon, Iapetus, Aoede…). Chọn **Giọng đọc cố định** khi tạo video (hoặc trên trang video) → Chrome Flow gắn
cùng giọng đó vào mọi cảnh; prompt ghi cùng một câu VOICE. Giọng chỉ gắn được ở chế độ Thành phần (Khung hình không có
nút +). Cảnh 2+ ở chế độ "Giữ đúng mặt nhân vật" dùng đủ 3 thành phần: ảnh nhân vật + khung cuối cảnh trước + giọng.

## Chữ trên màn hình (web vẽ)

Veo vẽ chữ tiếng Việt có dấu sai và hay tự thêm chữ lạ, nên:
- Prompt gửi Veo cấm hẳn chữ ("Do NOT render any on-screen text…").
- Kịch bản có `textOverlays` cho từng cảnh: chữ có dấu + giây bắt đầu/kết thúc + vị trí (trên/giữa/dưới).
- Lúc **Ghép video**, web vẽ từng chữ thành PNG (Pillow + font Noto Sans ExtraBold, `lib/render_text.py`) rồi
  `overlay` lên đúng thời điểm, hiện/ẩn dần 0,2s. ffmpeg trên máy không có `drawtext` nên không dùng cách đó.
- Mỗi cảnh trên web có ô **Chữ trên màn hình** để sửa/thêm/xoá; phần Ghép có **Chèn chữ** bật/tắt và 3 kiểu khung
  (gradient tím-xanh, nền tối, nền sáng). Sửa chữ xong phải **Ghép lại**.
- Kịch bản cũ chỉ có `onScreenText` → web tự chuyển (đọc chữ trong ngoặc kép và mốc "(0.5s)").
- Clip đã tạo trước đây vẫn còn chữ do Veo vẽ sẵn trong hình — chỉ video mới mới sạch chữ.

## Ghi chú

- Web chỉ nghe `127.0.0.1`, không có đăng nhập. Đừng mở ra Internet.
- Reel phải dài 3–90 giây → tối đa ~11 cảnh × 8s.
- Mỗi lần chỉ tạo 1 clip (Flow chạy qua 1 Chrome profile), các job khác xếp hàng.
- Dữ liệu từng job: `data/jobs/<id>/` (job.json, clip từng cảnh, khung cuối, video ghép).
- Skill dùng làm system prompt: `skill/SKILL.md` — sửa file này để đổi cách viết kịch bản.
