# Ads AI Studio

Website chạy trên máy nhà, biến skill **Ads AI** thành dây chuyền:

① Claude viết kịch bản + prompt từng cảnh → ② tạo từng cảnh trong Google Flow → ③ ffmpeg ghép thành 1 Reel → ④ đăng **nháp** lên Page Facebook.

Khâu ② có 2 chế độ (chọn theo từng video):
- **Tự bấm trong Flow** (mặc định): web đưa prompt + ảnh khung đầu, bạn tạo trong Flow rồi kéo mp4 vào web. Không bị reCAPTCHA chặn vì người bấm thật.
- **Tự động qua gflow**: Playwright lái Chrome. Flow hay chấm điểm là bot (`PUBLIC_ERROR_UNUSUAL_ACTIVITY`) và chặn profile vài giờ.

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

## Cấu hình Facebook

Điền vào `.env`:

```
FB_PAGE_ID=<id của Page>
FB_PAGE_TOKEN=<Page access token>
```

Nên dùng **token System User** (Business Settings → System Users) vì không hết hạn và không dính khoá "xác thực tài khoản" như token người thật:
1. Tạo System User trong Business sở hữu app.
2. Gán **Page** cho System User (thiếu bước này thì API trả danh sách rỗng, không báo lỗi).
3. Tạo token với quyền `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
4. Lấy Page token: `GET /me/accounts` bằng token System User → trường `access_token` của Page.

Khởi động lại server sau khi sửa `.env`. Ô "Facebook ✓" góc phải trên sẽ chuyển xanh.

## Quy trình

1. **Video mới** → điền chủ đề, số cảnh, CTA, mô tả nhân vật, ảnh tham chiếu (tuỳ chọn) → *Viết kịch bản* (1–3 phút).
2. Duyệt mạch video, bảng nối cảnh, sửa thoại/prompt từng cảnh. Prompt phải ≤ 4000 ký tự (Flow cắt phần thừa) — có bộ đếm và nút *Rút gọn prompt*.
3. **Chế độ tự bấm trong Flow**: với từng cảnh, theo thứ tự từ cảnh 1 — *Copy prompt*, chọn đúng chế độ Flow ghi ở cảnh (cảnh 1: Text/Ingredients to Video; cảnh 2+: Frames to Video với ảnh *khung đầu* tải từ web), khung 9:16, tạo, tải mp4 về rồi kéo vào ô video của cảnh. Web tự cắt khung cuối làm khung đầu cảnh sau.
   **Chế độ gflow**: *Tạo cả N cảnh* → chạy lần lượt: cảnh 1 dùng ảnh nhân vật làm reference (`r2v`) hoặc chỉ prompt (`t2v`); cảnh 2+ dùng **khung cuối cảnh trước làm khung đầu** (`i2v`). Mỗi cảnh ~1,5–3 phút và **trừ credit Flow**.
4. Cảnh nào hỏng: *Tạo lại chỉ cảnh này* (các cảnh sau bị đánh dấu "lệch nối") hoặc *Tạo lại từ cảnh này trở đi*. Cảnh thừa đầu/cuối: chỉnh *Cắt đầu / Cắt cuối* (giây) thay vì render lại.
5. *Ghép video* → 1080×1920, 30fps, AAC 48kHz, xoá watermark "Veo".
6. Sửa caption → *Đăng nháp lên Page* → vào Meta Business Suite → Nội dung → Bản nháp để duyệt và đăng.

## Ghi chú

- Web chỉ nghe `127.0.0.1`, không có đăng nhập. Đừng mở ra Internet.
- Reel phải dài 3–90 giây → tối đa ~11 cảnh × 8s.
- Mỗi lần chỉ tạo 1 clip (Flow chạy qua 1 Chrome profile), các job khác xếp hàng.
- Dữ liệu từng job: `data/jobs/<id>/` (job.json, clip từng cảnh, khung cuối, video ghép).
- Skill dùng làm system prompt: `skill/SKILL.md` — sửa file này để đổi cách viết kịch bản.
