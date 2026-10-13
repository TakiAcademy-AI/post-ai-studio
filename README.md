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
2. Bấm **Load unpacked** → chọn thư mục `~/Downloads/ads-ai-studio/extension`.
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
cd ~/Downloads/ads-ai-studio
npm install        # lần đầu
npm start          # mở http://127.0.0.1:3200
```

Yêu cầu trên máy:
- `claude` CLI đã đăng nhập (dùng gói đăng ký, không cần API key).
- `gflow-cli` ở `~/Downloads/gflow-cli`, profile Google đã login (`gflow auth status`).
- `ffmpeg` / `ffprobe`.

Cấu hình nằm trong `.env` (xem `.env.example`).

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
6. Sửa caption → chọn **Lưu nháp** (mặc định, duyệt trong Meta Business Suite → Nội dung → Bản nháp) hoặc **Đăng ngay** → bấm **Đăng lên <Page>**.

## Ghi chú

- Web chỉ nghe `127.0.0.1`, không có đăng nhập. Đừng mở ra Internet.
- Reel phải dài 3–90 giây → tối đa ~11 cảnh × 8s.
- Mỗi lần chỉ tạo 1 clip (Flow chạy qua 1 Chrome profile), các job khác xếp hàng.
- Dữ liệu từng job: `data/jobs/<id>/` (job.json, clip từng cảnh, khung cuối, video ghép).
- Skill dùng làm system prompt: `skill/SKILL.md` — sửa file này để đổi cách viết kịch bản.
