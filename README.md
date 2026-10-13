# Ads AI Studio

Website chạy trên máy nhà, biến skill **Ads AI** thành dây chuyền:

① Claude viết kịch bản + prompt từng cảnh → ② tạo từng cảnh trong Google Flow → ③ ffmpeg ghép thành 1 Reel → ④ đăng **nháp** lên Page Facebook.

Khâu ② có 2 chế độ (chọn theo từng video):
- **Tự bấm trong Flow** (mặc định): web đưa prompt + ảnh khung đầu, bạn tạo trong Flow rồi kéo mp4 vào web. Không bị reCAPTCHA chặn vì người bấm thật.
- **Tự động qua gflow**: Playwright lái Chrome. Flow hay chấm điểm là bot (`PUBLIC_ERROR_UNUSUAL_ACTIVITY`) và chặn profile vài giờ.

## Extension "Ads AI → Flow" (khuyên dùng)

Điền sẵn từng cảnh vào Flow trong Chrome thật của bạn; **bạn tự bấm nút tạo** nên không dính reCAPTCHA như gflow.

Cài một lần:
1. Mở `chrome://extensions`, bật **Developer mode** (góc phải trên).
2. Bấm **Load unpacked** → chọn thư mục `~/Downloads/post-ai-studio/extension`.
3. Mở/tải lại tab `flow.google.com` → góc phải dưới có bảng **Ads AI**.

Quy trình (mỗi cảnh bạn chỉ bấm 1 nút — nút tạo):
1. Web: bấm **Điền cảnh 1 vào Flow**. Để sẵn một tab Flow đang mở dự án; chọn model ở bảng Ads AI (lưu cho lần sau).
2. Extension **tự điền**: Video · Khung hình/Thành phần · 9:16 · 8 giây · x1, tải ảnh khung đầu/ảnh nhân vật lên, điền prompt.
3. **Bạn bấm nút → để tạo** (nút duy nhất phải bấm tay — cú bấm này reCAPTCHA chấm điểm, để người thật bấm thì an toàn cho tài khoản).
4. Video xong extension **tự Tải xuống → 720p**, gửi về web; web gắn vào cảnh, cắt khung cuối, và đẩy cảnh kế tiếp sang Flow — extension tự điền tiếp. Lặp lại bước 3.

Nếu tự tải không chạy (bảng báo lỗi), tự bấm ⋮ → Tải xuống → 720p là clip vẫn về web. Đừng tạo video khác trong cùng dự án lúc đang chờ — extension lấy video mới nhất xuất hiện ở đầu lưới. Chrome phải để chế độ tải về không hỏi vị trí lưu.

Giới hạn: extension dựa vào nhãn tiếng Việt của giao diện Flow (đo ngày 2026-10-12) — Flow đổi giao diện thì bảng sẽ báo "Không thấy …"; lúc đó vẫn dùng cách kéo thả mp4. Web chỉ nhận file mp4 nằm trong `~/Downloads`.

## Chạy

```bash
cd ~/Downloads/post-ai-studio
npm install        # lần đầu
npm start          # mở http://127.0.0.1:3200
```

Yêu cầu trên máy:
- `claude` CLI đã đăng nhập (dùng gói đăng ký, không cần API key).
- `gflow-cli` ở `~/Downloads/gflow-cli`, profile Google đã login (`gflow auth status`).
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

## Kết nối Facebook

Cách chính — **Đăng nhập Facebook** (giống Ads OS, dùng chung app Facebook của Ads OS):
1. `.env` cần `FB_APP_ID`, `FB_APP_SECRET`, `ENCRYPTION_KEY` (đã điền sẵn).
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
3. **Chế độ tự bấm trong Flow**: với từng cảnh, theo thứ tự từ cảnh 1 — *Copy prompt*, chọn đúng chế độ Flow ghi ở cảnh (cảnh 1: Text/Ingredients to Video; cảnh 2+: Frames to Video với ảnh *khung đầu* tải từ web), khung 9:16, tạo, tải mp4 về rồi kéo vào ô video của cảnh. Web tự cắt khung cuối làm khung đầu cảnh sau.
   **Chế độ gflow**: *Tạo cả N cảnh* → chạy lần lượt: cảnh 1 dùng ảnh nhân vật làm reference (`r2v`) hoặc chỉ prompt (`t2v`); cảnh 2+ dùng **khung cuối cảnh trước làm khung đầu** (`i2v`). Mỗi cảnh ~1,5–3 phút và **trừ credit Flow**.
4. Cảnh nào hỏng: *Tạo lại chỉ cảnh này* (các cảnh sau bị đánh dấu "lệch nối") hoặc *Tạo lại từ cảnh này trở đi*. Cảnh thừa đầu/cuối: chỉnh *Cắt đầu / Cắt cuối* (giây) thay vì render lại.
5. *Ghép video* → 1080×1920, 30fps, AAC 48kHz, xoá watermark "Veo".
6. Sửa caption → chọn **Hẹn giờ đăng** (mặc định; > 10 phút và ≤ 29 ngày tới), **Đăng ngay**, hoặc **Lưu nháp** → bấm **Đăng lên <Page>**.
7. Tab **Lịch đăng** (đầu trang): mọi Reel đã gửi lên Facebook, mọi Page. Làm mới trạng thái từ Facebook, đổi giờ, đăng sớm (~11 phút), huỷ (xoá video khỏi Facebook), mở reel.
   Lưu ý: nháp tạo qua API không hiện trong danh sách Reel của Page và khó tìm trong Business Suite → nên dùng hẹn giờ.
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
Achird, Charon, Iapetus, Aoede…). Chọn **Giọng đọc cố định** khi tạo video (hoặc trên trang video) → extension gắn
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
