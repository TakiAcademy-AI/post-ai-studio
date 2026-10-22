# Post AI Studio

Website chạy trên máy nhà, biến skill **Video AI** thành dây chuyền:

① Claude viết kịch bản + prompt từng cảnh → ② **Chrome Flow** tự tạo từng cảnh trên Google Flow → ③ ffmpeg tự ghép thành 1 Reel → ④ **Chrome Facebook** đăng lên Page qua Meta Business Suite (hẹn giờ / đăng ngay / nháp).

Cả khâu tạo video lẫn đăng bài đều chạy bằng trình duyệt như người thật bấm (Playwright điều khiển một Chrome riêng), không có mẹo che giấu tự động hoá.

## Tạo video tự động (Chrome Flow)

Làm theo cách của taki-agentic-ai:

1. Tab **Tài khoản → Google Flow**: chọn profile Chrome đã đăng nhập Google Flow → **Chép lại & mở** (chép cookie sang `data/flow-chrome`, Chrome hằng ngày không bị đụng) → **Kiểm tra đăng nhập Flow**. Chưa đăng nhập: **Hiện cửa sổ** rồi tự đăng nhập trong cửa sổ đó.
2. Trang video: chọn **Model Flow** → **▶ Tự tạo cả N cảnh**. Server mở Chrome Flow (cổng DevTools `9334`, đổi bằng `FLOW_CDP_PORT`), luôn mở Flow tiếng Việt (`?hl=vi`), tạo một dự án Flow riêng cho video, điền từng cảnh (code điền ở `flow-page/`), bấm tạo, chờ, tải 720p và gắn vào cảnh. Mỗi cảnh có nút **↻ Tự tạo lại cảnh này**.
3. Flow báo "hết thời gian tạo" → tự thử lại 2 lần. Flow chặn "người nổi tiếng" (được hoàn credit) → tự xử lý theo thang: thử lại nguyên prompt → Claude **tự viết lại prompt** 3 bậc (reframe + bỏ từ nhạy cảm → người nhỏ trong khung, góc nghiêng → bản tối giản), luôn giữ nguyên lời thoại và giọng @me → thử thêm 1 lần; cảnh nào bị viết lại có nút **Dùng lại prompt gốc**. Lỗi khác / hết credit → dừng và báo lỗi ở cảnh đó. Đủ video mọi cảnh thì web **tự ghép** luôn (mặc định không chèn chữ — bật "Chèn chữ" ở phần ghép nếu muốn, rồi Ghép lại).

Lưu ý: mỗi cảnh trừ credit Flow; tự động hoá có rủi ro Google chặn tài khoản — dùng tài khoản có hình đại diện "Tôi" của chính bạn nếu dùng giọng @me. Cửa sổ Chrome Flow được đẩy ra mép phải (không thu nhỏ vì trang sẽ ngừng vẽ). Clip mp4 vẫn kéo thả tay vào cảnh được nếu cần thay.

## Đăng Reel qua trình duyệt (Chrome Facebook)

Bài đăng KHÔNG đi qua Graph API — web đăng như người đăng tay qua **Meta Business Suite**:
1. Tab **Tài khoản → Facebook → Chrome Facebook**: chọn profile Chrome → **Chép lại & mở**. Facebook thường không nhận phiên chép sang → **tự đăng nhập một lần** trong cửa sổ Chrome Facebook (tài khoản quản trị Page), rồi **Kiểm tra đăng nhập Facebook**.
2. Trang video → Hẹn giờ / Đăng ngay / Lưu nháp → **Đăng lên <Page>**. Server mở trình soạn thước phim, tải video, điền caption, chọn kiểu đăng (hẹn giờ theo múi giờ Business Suite hiện), bấm nút cuối, rồi **xác nhận** bài nằm trong mục Đã đăng / Đã lên lịch / Bản nháp.
3. Graph API (thẻ **Facebook API — tuỳ chọn**) không dùng để đăng; nếu kết nối thì web dò lại video_id sau khi đăng và tab **Lịch đăng** làm mới trạng thái / đổi giờ / huỷ được.

**Page để đăng** chọn ngay trong thẻ Chrome Facebook ("Lấy danh sách Page" đọc từ bảng chuyển tài sản của Business Suite, chọn Page → web đọc mã Page) — không cần kết nối API. Chrome Facebook dùng cổng `9335` (`FB_CDP_PORT`).

## Vòng phản hồi: Hiệu quả & sổ tay tối ưu

1. **Công thức**: mỗi lần đăng, web lưu "công thức" của video vào bài trong Lịch đăng (chủ đề, hook, câu mở đầu, số cảnh, độ dài, số từ,
   có CTA, giọng, model, chèn chữ, độ dài caption, số hashtag, giờ/thứ đăng — `lib/recipe.js`).
2. **Số liệu**: Chrome Facebook đọc bảng "Bài viết đã đăng" của Business Suite (90 ngày, mọi Reel của Page — cả bài không do web đăng):
   tiếp cận, lượt xem, người xem, theo dõi, tương tác, thích, bình luận, chia sẻ, lưu, thời gian xem, **xem trung bình**, lượt xem ≥3s.
   Tự cập nhật mỗi 6 giờ (lần đầu 3 phút sau khi bật server) hoặc bấm **Cập nhật số liệu** ở tab **Hiệu quả**. Lưu `data/insights.json`
   (mỗi bài nhiều mốc). Chỉ số so sánh: % thời lượng được xem, giữ 3s, tỉ lệ tương tác, chia sẻ/1000 tiếp cận.
3. **Sổ tay**: **Phân tích & đề xuất sổ tay** → Claude so Reel tốt / kém (chỉ bài ≥ 24 giờ) → bản đề xuất + căn cứ + 5 chủ đề nên làm.
   Bạn sửa / **Duyệt** thì sổ tay mới được đưa vào brief khi viết kịch bản mới (tắt được). Yêu cầu nhập trong form luôn được ưu tiên hơn sổ tay.
   Bấm một chủ đề gợi ý để mở form Video mới điền sẵn.

Không tự đăng hay tự tạo video theo sổ tay — vẫn do bạn bấm. Mốc code trước khi có tính năng này: tag `backup-truoc-feedback-loop`.

## Tự nuôi kênh — nhiều kênh (mỗi kênh N video/ngày)

**Nhiều kênh**: mỗi kênh = 1 Page với cài đặt riêng (tên, Page để đăng, khung giờ, định vị kênh, khuôn video / DNA / bối cảnh,
hàng đợi chủ đề, chấm điểm hay duyệt, lịch, nhật ký). Bấm **＋ Thêm kênh** → đặt tên → chọn Page (danh sách lấy từ Business Suite; web đọc mã
Page khi Lưu, không đổi Page mặc định của web) → chỉnh → **Lưu** → **Bật kênh này**. Các kênh dùng chung 1 dây chuyền (Chrome Flow + Chrome
Facebook): mỗi lúc 1 video, luôn làm khung giờ sớm nhất trong các kênh đang bật. Chủ đề Claude nghĩ tránh trùng bài cũ **của đúng Page đó**.
Số liệu của các Page trong kênh cũng được thu tự động (tab Hiệu quả). Dữ liệu cũ (1 kênh) tự chuyển thành kênh thứ nhất.
Mốc code trước tính năng này: tag `backup-truoc-nhieu-kenh`.

### Cách một kênh chạy

Tab **Tự nuôi kênh**: khung giờ đăng (mặc định 11:30 · 14:30 · 20:30 giờ VN), định vị kênh, khuôn video (số cảnh, giọng, DNA, đối tượng,
tông giọng, CTA, điều cấm, model) và hàng đợi chủ đề (hết thì Claude tự nghĩ theo định vị kênh + sổ tay đã duyệt, tránh trùng bài cũ).
Khi **Bật**, cứ 5 phút web xem khung giờ nào trong ~20 giờ tới chưa có video → làm trọn: kịch bản → Chrome Flow tạo cảnh (kiểm tra áo) →
ghép → Chrome Facebook **hẹn giờ đăng** đúng khung giờ (còn thời gian xem / huỷ trong Lịch đăng hoặc Business Suite). Mỗi lúc 1 video;
lỗi thì ghi lại và sang khung kế tiếp. Bật **Cần tôi duyệt** thì video làm xong dừng ở "chờ duyệt", bấm **Duyệt & hẹn đăng** mới đăng.

**Quét kênh để định vị:** khi kênh được bật hoặc vừa chọn Page, web sẽ đọc các bài Page đã đăng trong Business Suite trước khi làm video đầu tiên. Từ caption và số liệu, Claude viết lại các ô **Định vị kênh**, **Khán giả**, **Giọng** và **Tránh**, đồng thời thay toàn bộ hàng đợi chủ đề bằng chủ đề đúng kênh. Khi đọc, web bỏ qua bài do chính web làm và bài cập nhật ảnh. Bấm **🔍 Quét lại kênh** để quét lại bất cứ lúc nào. Nhân vật/DNA, bối cảnh, CTA và số cảnh giữ nguyên.

**Mỗi video đổi trang phục & bối cảnh** (bật sẵn cho mọi kênh): trước khi viết kịch bản, Claude chọn 1 bộ áo trơn mới và 1 bối cảnh mới hợp chủ đề, khác 12 video gần nhất. Mọi cảnh trong cùng 1 video vẫn dùng chung bộ áo và bối cảnh đó. Ô **Góc quay** thì giữ nguyên cho mọi video. Khi bật chế độ này, ô Nhân vật/DNA và ô Bối cảnh chỉ là gợi ý phong cách. Bộ đã dùng hiện dưới mỗi dòng kế hoạch (👔 · 🏠).

**Cách đăng** (mỗi kênh chọn riêng):
- **Hẹn giờ đăng trực tiếp** (mặc định): video được hẹn giờ đăng đúng khung giờ trên Business Suite.
- **Đăng nháp để tôi duyệt lại**: video lưu vào Business Suite → Nội dung → **Bản nháp** của Page, dòng kế hoạch hiện "nháp". Anh xem rồi tự đăng / hẹn giờ ngay trong Business Suite, hoặc bấm **Hẹn đăng** trên web. Lưu ý: nút này tải video lên lại thành bài hẹn giờ mới, còn bản nháp cũ vẫn nằm đó, cần xoá tay để không bị trùng.
**Tự chấm & tự đăng** (mặc định bật, thay cho duyệt tay): video ghép xong → Claude xem khung đầu/giữa/cuối từng cảnh + lời thoại + caption,
chấm 0–100 theo sổ tay số liệu (hook 2 giây đầu, xung đột cụ thể, độ dài, câu kết, lỗi hình: chữ lạ / sai áo / méo mặt / người thừa).
≥ ngưỡng (mặc định 70) → sửa chính tả caption rồi tự hẹn đăng. Chưa đạt → kịch bản ổn thì chỉ tạo lại các cảnh lỗi hình (kèm câu VISUAL FIX),
kịch bản yếu thì viết lại cùng chủ đề theo nhận xét; tối đa 2 lần. Hết lượt: bản tốt nhất ≥ 55 thì vẫn đăng, thấp hơn thì không đăng ("không đạt").
Điểm và nhận xét hiện ở lịch khung giờ và đầu trang video. Claude không nghe âm thanh — lời thoại chấm qua kịch bản.
Cần sẵn: Chrome Flow, Chrome Facebook (đã đăng nhập) và Page để đăng. Mỗi video tốn credit Flow + lượt Claude.
Mốc code trước tính năng này: tag `backup-truoc-tu-nuoi-kenh`.

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

## Trang phục đồng nhất (giọng @me) — ảnh nhân vật + Omni 1.1 Flash

Hình đại diện "Tôi" mang theo áo của video selfie gốc (đo được 65% lần kiểm tra ra áo henley đen cổ tròn của video gốc).
Với **Veo 3.1**, @me chiếm hết 3 suất ảnh tham chiếu nên không gắn thêm ảnh trang phục được. Với **Omni 1.1 Flash** thì gắn được
**ảnh + @me** cùng lúc (cách người dùng vẫn làm tay). Nên với giọng @me, web:
1. Claude chuyển trang phục DNA thành mô tả chính xác + danh sách "không được mặc".
2. Flow (chế độ Hình ảnh, Nano Banana + @me) tạo **ảnh nhân vật**: chính chủ mặc đúng trang phục, trong bối cảnh video. Ảnh nằm trong thư viện
   dự án Flow → mọi cảnh **chọn thẳng ảnh đó theo tên** + @me (không tải gì lên), model **Omni 1.1 Flash** (bắt buộc với @me).
3. Vẫn kiểm tra áo từng cảnh (Claude xem 2 khung hình), sai thì tạo lại tối đa 1 lần.
Thử 2026-10-19: ảnh nhân vật + 2 cảnh đều đúng áo polo đen ngay lần đầu, cùng phòng, ~5 phút. Trang video có ô **Ảnh nhân vật** + nút tạo lại.

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


## Boss 🧠 (bộ não Grok)

Agent giám sát chạy bằng **Grok CLI** chính thức của xAI. Cài bằng `curl -fsSL https://x.ai/cli/install.sh | bash`, sau đó tự đăng nhập bằng `grok login` (cần gói SuperGrok hoặc X Premium+, hoặc đặt `XAI_API_KEY`). Boss **chỉ đề xuất**: mỗi việc đều chờ anh bấm **Áp dụng**.

- **Báo cáo giám sát** (tab Boss): mặc định tự báo cáo mỗi ngày lúc 07:30, hoặc bấm "Báo cáo ngay". Boss đọc cài đặt, kế hoạch, nhật ký và số liệu Page của mọi kênh, rồi nhận định và đưa ra đề xuất: đổi định vị / khán giả / giọng / DNA / bối cảnh, thêm hoặc thay chủ đề, đổi khung giờ, bật/tắt kênh, đổi cách đăng, số cảnh, làm lại hoặc bỏ qua một khung, duyệt video, quét lại kênh.
- **Chat ra lệnh**: anh nói bằng lời, boss trả lời và chuyển lệnh thành đề xuất để anh bấm Áp dụng.
- **Boss duyệt video** (bật trong cài đặt kênh): video làm xong được boss xem khung hình, lời thoại và kết quả kiểm tra áo/chữ, rồi đề xuất *đăng / nháp / làm lại*. Video dừng ở trạng thái "chờ duyệt"; anh bấm **Làm theo boss** hoặc tự chọn.
- **Bộ não viết chủ đề + kịch bản** (cài đặt kênh): chọn Claude hoặc Grok. Chọn Grok thì Grok nghĩ chủ đề, viết kịch bản, chọn trang phục/bối cảnh và định vị kênh. Phần kiểm tra áo/chữ và rút gọn prompt vẫn do Claude làm.

## Trinh sát 🔭 (tham khảo Scout của taki-agentic-ai)

- **Nguồn quan sát:** dán link kênh TikTok, Facebook, YouTube hoặc Instagram (đối thủ, kênh tham khảo, hoặc kênh của mình) và chọn kênh tự nuôi mà nguồn đó phục vụ.
- **Quét:** Chrome Facebook mở trang công khai ở chế độ **chỉ đọc** (không thích, không theo dõi, không bình luận), lấy khoảng 30 video gần nhất kèm lượt xem.
  - Từ đó tính **trung vị kênh**; video ghim không tính vào trung vị.
  - Video đạt từ ×3 trung vị trở lên là **nổi**. Video đạt từ ×5 trung vị và mới trong 7 ngày là **bùng nổ**. Các ngưỡng này chỉnh được.
  - TikTok lấy ngày đăng từ ID video. Facebook và YouTube lấy ngày lần đầu thấy video.
- **Lịch:** tự quét lúc 06:59 mỗi ngày (giờ quét chỉnh được). Sau mỗi lần quét, tự decode tối đa 3 video bùng nổ.
- **Decode:** mở trang video, chụp màn hình, rồi Claude (hoặc Grok, nếu kênh chọn bộ não Grok) phân tích các mục sau:
  - hook, kiểu hook, khuôn nội dung, nhịp, vì sao nổ, cảm xúc, insight khán giả;
  - **góc clone riêng** đúng định vị kênh đích;
  - lưu ý rủi ro.
- **Clone vào hàng đợi:** đưa chủ đề theo khuôn đó lên đầu hàng đợi của kênh, ghi rõ "clone khuôn, không chép lời / tên / hình ảnh".
- **Boss** nhìn thấy các tín hiệu bùng nổ trong báo cáo và có thể đề xuất `clone_signal`.
- **Trinh sát ngay trong Tự nuôi kênh:** phần cài đặt mỗi kênh có mục "Trinh sát cho kênh này". Ở đó anh thêm hoặc xoá nguồn, quét nguồn của kênh và xem các video đang bùng nổ. Tuỳ chọn **tự đưa video bùng nổ lên đầu hàng đợi chủ đề** bật sẵn, tối đa 2 chủ đề mỗi ngày. Web chỉ đưa những video đã decode, chưa clone cho kênh đó, và lấy video có hệ số × trung vị cao nhất trước. Mỗi lần web tự clone đều được ghi vào nhật ký kênh.

## Video chuẩn ⭐

Lấy một video viral thật của anh làm **tiêu chuẩn** cho Tự nuôi kênh. Mục này nằm trong phần cài đặt kênh, ngay trên ô Định vị kênh.

- **Thêm video chuẩn:** dán link Reel. Web làm lần lượt các bước sau:
  - Chrome Facebook mở trang ở chế độ chỉ đọc và **ghi lại đúng video kèm tiếng** (bằng captureStream).
  - **faster-whisper** chép lời kèm mốc thời gian. Dùng `/usr/bin/python3.12` và model `medium`; đổi bằng biến môi trường `WHISPER_PYTHON` / `WHISPER_MODEL`.
  - ffmpeg cắt khung hình.
  - Claude rút ra tiêu chuẩn: vì sao viral, hook, cấu trúc theo giây, nhịp, thủ pháp, giọng, hình ảnh, phụ đề, 5–8 quy tắc viết, điều cần tránh, mẫu chủ đề.
- **Kênh chọn video chuẩn** thì:
  - Bước nghĩ chủ đề, viết kịch bản và Boss duyệt video đều bám theo **hình thức** của video chuẩn.
  - Chủ đề vẫn đi theo định vị kênh. Phần nào trong chuẩn nhắc tới giới tính hay ngách cụ thể chỉ được coi là ví dụ.
- **Nút tiện:** "Dùng góc quay của video chuẩn" và "Dùng N cảnh (≈ độ dài chuẩn)". Hai nút này điền sẵn ô tương ứng; bấm Lưu thì mới áp dụng.
