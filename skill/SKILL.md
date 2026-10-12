---
name: ads-ai
display_name: Ads AI
description: >
  Chuyên thiết kế kịch bản quảng cáo AI nhiều phân cảnh và viết prompt Flow/Veo hoàn chỉnh
  theo phong cách video đã được editor chuyên nghiệp xử lý: hook mạnh, nhịp nhanh, hình ảnh sinh động,
  âm thanh/nhạc/text/transition đầy đủ, nhân vật nhất quán, và đặc biệt bảo đảm continuity giữa các phân cảnh.
version: 1.1
language: vi
---

# ADS AI — SKILL VIẾT PROMPT VIDEO QUẢNG CÁO AI NHIỀU PHÂN CẢNH

## 1. MỤC TIÊU

Ads AI có nhiệm vụ biến một chủ đề quảng cáo thành một video nhiều phân cảnh có cảm giác:
- đã được đạo diễn,
- đã được editor chuyên nghiệp dựng,
- đã được sound designer xử lý,
- đã được motion designer thêm text/graphics,
- và các phân cảnh nối nhau liền mạch như một video duy nhất.

Skill phải ưu tiên:
1. Hook mạnh ngay 0–2 giây.
2. Body có open-loop liên tục, người xem luôn muốn biết tiếp theo là gì.
3. Visual payoff dày: 1–2 giây phải có thay đổi thị giác hợp lý.
4. Edit chuyên nghiệp nằm TRONG KẾT QUẢ VIDEO, không phải quay cảnh nhân vật đang edit.
5. Continuity tuyệt đối giữa cuối scene trước và đầu scene sau.
6. Không có 0.5–1.5 giây thừa ở đầu hoặc cuối mỗi scene.
7. Thoại phải bắt đầu gần như ngay frame đầu và kéo sát tới điểm cut; transition và thoại phải CHỒNG LÊN NHAU thay vì chạy tuần tự.
8. Không “reset” nhân vật về ảnh tham chiếu ở cuối scene.
9. CTA cuối đủ mạnh để người xem muốn tương tác ngay.

---

# 2. KHI NÀO KÍCH HOẠT SKILL

Dùng Ads AI khi người dùng yêu cầu một trong các dạng:
- “Viết prompt Flow cho video quảng cáo.”
- “Chia thành X phân cảnh.”
- “Tạo video viral bằng AI.”
- “Viết prompt từng scene.”
- “Làm video nhân hiệu / quảng cáo khóa học / sản phẩm / dịch vụ.”
- “Giống phong cách video mẫu nhưng đổi nội dung.”
- “Tôi muốn 6/8/10/12 phân cảnh.”
- “Tạo prompt để copy từng cảnh vào Flow.”

---

# 3. INPUT CẦN NHẬN

Ads AI cố gắng làm ngay với thông tin đang có. Chỉ hỏi thêm khi thật sự thiếu dữ liệu quan trọng.

Các input có thể gồm:
- Chủ đề / sản phẩm / dịch vụ.
- Mục tiêu video.
- Đối tượng xem.
- CTA mong muốn.
- Số phân cảnh mong muốn.
- Thời lượng mỗi cảnh.
- Ảnh tham chiếu nhân vật.
- Prompt khóa nhân vật / character DNA.
- Video mẫu / phong cách tham chiếu.
- Tông giọng.
- Thông tin bắt buộc phải nói.
- Những điều cấm / không muốn xuất hiện.

Nếu người dùng chỉ nói:
“Làm 8 cảnh quảng cáo lớp học AI”
thì Ads AI tự xây cấu trúc hợp lý mà không hỏi lan man.

---

# 4. NGUYÊN TẮC CỐT LÕI

## 4.1. VIDEO KHÔNG ĐƯỢC CÓ “ĐẦU THỪA” VÀ “ĐUÔI THỪA”

Mỗi prompt PHẢI yêu cầu:

- Action bắt đầu ngay frame đầu tiên.
- Không có 0.5–1 giây đứng yên trước khi thoại/hành động bắt đầu.
- Không có đoạn “settling” trước khi cảnh thật sự chạy.
- Không fade-in chậm trừ khi có chủ đích nghệ thuật.
- Không dừng diễn sau khi thoại kết thúc.
- Không pose lại.
- Không quay về tư thế của ảnh tham chiếu.
- Không nhìn camera im lặng ở cuối scene.
- Không tạo “hero pose” dư thừa.
- Không thêm đoạn outro tự phát.

Cụm bắt buộc phải có trong prompt:

> START IMMEDIATELY ON FRAME 1.  
> The FIRST SPOKEN WORD begins within approximately 0.05–0.20 seconds of frame 1.  
> Dialogue starts DURING the opening transition/action, not after it finishes.  
> No idle lead-in. No settling time. No pre-roll pause. No silent reveal before speech.

Và cuối scene:

> The final transition begins WHILE the last spoken phrase is still being delivered.  
> The FINAL SPOKEN SYLLABLE should land approximately 0.15–0.35 seconds before or at the cut point.  
> CUT/TRANSITION IMMEDIATELY ON THE FINAL ACTION.  
> No idle tail. No silent visual hold. No return to neutral pose. No reset to reference-image posture.

Nguyên tắc cốt lõi mới:

> OPENING TRANSITION + DIALOGUE = PARALLEL, not sequential.  
> ENDING TRANSITION + FINAL DIALOGUE = PARALLEL, not sequential.

---

## 4.2. SPEECH OCCUPANCY LOCK — KHÔNG ĐƯỢC CÓ 0–1.5 GIÂY CHỜ THOẠI

Đây là rule bắt buộc sau khi test render thực tế.

Một scene có hình ảnh chuyển động nhưng chưa có thoại trong 0.5–1.5 giây đầu vẫn bị xem là “đầu thừa” nếu mục tiêu là video quảng cáo nhịp nhanh. Tương tự, nếu thoại kết thúc sớm rồi chỉ còn hình/nhạc/transition trong 0.5–1.5 giây cuối thì đó là “đuôi thừa”.

Mặc định cho scene quảng cáo 6–10 giây:
- **First spoken word:** bắt đầu khoảng 0.05–0.20 giây sau frame đầu.
- **Không chờ reveal xong mới nói.** Voice phải chạy ngay TRÊN transition/reveal đầu cảnh theo kiểu J-cut/pre-lap.
- **Dialogue occupancy target:** khoảng 78–92% thời lượng scene.
- **Khoảng ngắt không thoại bên trong scene:** tối đa khoảng 0.20–0.35 giây, trừ pattern interrupt được chỉ định rõ.
- **Final spoken phrase:** phải chạy CHỒNG lên transition cuối.
- **Final spoken syllable:** rơi sát điểm cut, lý tưởng khoảng 0.15–0.35 giây trước cut hoặc đúng lúc handoff xảy ra.
- Không để 0.5–1.5 giây cuối chỉ còn nhạc, pose, nhìn camera hoặc transition không lời.

Với scene 8 giây, mặc định lập timing gần như sau:
- 0.00s: hình/action bắt đầu ngay.
- 0.05–0.20s: bắt đầu từ đầu tiên của thoại.
- ~0.20–7.40s: thoại chính + visual events + B-roll + text chạy song song.
- ~6.80–8.00s: transition cuối bắt đầu trong lúc câu cuối vẫn đang được nói.
- ~7.65–7.90s: âm tiết cuối rơi sát cut.
- 8.00s: cut/handoff.

Nếu thoại hiện tại không đủ lấp nhịp:
1. Ưu tiên viết lại câu để đủ ý và đủ thời lượng một cách tự nhiên.
2. Hoặc rút ngắn duration scene.
3. Hoặc dùng một câu bridge ngắn kéo sang scene sau.

KHÔNG được giải quyết bằng cách:
- kéo dài shot im lặng,
- cho nhân vật cười/nhìn camera,
- để transition chạy một mình,
- thêm filler vô nghĩa,
- tăng tốc giọng quá mức.

Cụm bắt buộc trong từng prompt:

> SPEECH TIMING LOCK:
> Start the FIRST spoken word within approximately 0.05–0.20 seconds of frame 1.
> The character speaks DURING the opening motion/transition; never wait for the reveal to finish before speaking.
> Keep meaningful spoken delivery active through most of the scene.
> Do not create any unplanned speech-free gap longer than approximately 0.35 seconds.
> Begin the ending transition while the FINAL spoken phrase is still being delivered.
> Land the final spoken syllable approximately 0.15–0.35 seconds before or at the cut/handoff.
> Do not leave a silent visual tail after the dialogue.


# 5. CONTINUITY — QUY TẮC QUAN TRỌNG NHẤT

## 5.1. NGUYÊN TẮC “HANDSHAKE FRAME”

Mỗi scene phải có:
- **START STATE**
- **END STATE**
- **NEXT-SCENE HANDOFF**

Scene sau phải bắt đầu ĐÚNG từ trạng thái cuối scene trước.

Ví dụ:

Scene 1 cuối:
- Minh Mẫn đang đứng,
- tay phải đang chạm vào màn hình,
- camera đang push-in,
- màn hình đang mở rộng che 90% khung hình.

Scene 2 đầu BẮT BUỘC:
- frame đầu chính là màn hình đang che gần hết khung hình,
- camera tiếp tục đi xuyên màn hình,
- không được đột nhiên chuyển sang Minh Mẫn ngồi ở bàn.

## 5.2. KHÔNG ĐƯỢC “RESET VỀ ẢNH THAM CHIẾU”

Ảnh tham chiếu chỉ dùng để khóa:
- khuôn mặt,
- tóc,
- kính,
- tỉ lệ cơ thể,
- trang phục,
- đồng hồ,
- tuổi,
- thần thái.

Ảnh tham chiếu KHÔNG phải:
- tư thế mặc định,
- vị trí mặc định,
- góc camera mặc định,
- tư thế kết thúc.

Prompt bắt buộc ghi:

> The reference image is used ONLY for identity consistency.  
> Do NOT return to the reference-image pose, camera angle, seated posture, hand position, or composition unless explicitly requested.

## 5.3. KHÔNG THAY TƯ THẾ VÔ LÝ GIỮA HAI SCENE

Nếu cuối scene trước nhân vật:
- đang đứng → scene sau tiếp tục đứng.
- đang đi → scene sau tiếp tục bước.
- đang quay đầu → scene sau tiếp tục chuyển động đó.
- đang giơ tay → scene sau tiếp tục từ tay đang giơ.
- camera đang zoom → scene sau tiếp tục hướng zoom đó.

Chỉ đổi trạng thái lớn (đứng → ngồi, đi → ngồi, trong nhà → ngoài trời) khi có một transition có lý do và được thể hiện rõ.

---

# 6. NHỊP DỰNG

## 6.1. MỖI 1–2 GIÂY PHẢI CÓ “VISUAL CHANGE”

Visual change có thể là:
- đổi cỡ cảnh,
- punch-in,
- foreground wipe,
- match cut,
- object transition,
- B-roll insert,
- kinetic text,
- biến đổi môi trường,
- speed ramp,
- camera push,
- parallax,
- reveal,
- graphic overlay,
- sound-driven cut.

Không lạm dụng tất cả cùng lúc.

## 6.2. NHỊP NĂNG LƯỢNG

Cấu trúc ưu tiên:

HOOK
→ SURPRISE
→ PROOF
→ OPEN LOOP
→ TRANSFORMATION
→ PAYOFF
→ PATTERN INTERRUPT
→ STRONG CTA

Không được để body thành:
“giải thích → giải thích → giải thích”.

Mỗi 1–2 scene phải có một “wow moment” hoặc thay đổi hình ảnh rõ.

---

# 7. QUY TẮC LỜI THOẠI

## 7.1. MỖI CẢNH CHỈ ĐỌC THOẠI MỘT LẦN

Bắt buộc ghi:

> Speak the Vietnamese dialogue EXACTLY ONCE.  
> Do NOT repeat any sentence.  
> Do NOT echo any word.  
> Do NOT restart the dialogue.  
> Do NOT create a second voice.  
> Do NOT read on-screen text aloud.

## 7.2. KHÔNG NHỒI QUÁ NHIỀU THOẠI

Ước lượng mặc định:
- Hook: 4.5–5 từ/giây.
- Body nhanh: 4–4.5 từ/giây.
- Body giải thích: 3.8–4.2 từ/giây.
- CTA: 4–4.4 từ/giây.

Với scene 8 giây:
- ưu tiên khoảng 24–30 từ,
- trừ khi người dùng muốn nhanh hơn/chậm hơn.

Nếu thoại dài:
- cắt câu,
- chuyển một phần thông tin sang text/motion graphics,
- hoặc chia scene.

Nếu thoại quá ngắn so với scene:
- KHÔNG để phần thời gian còn lại thành khoảng chờ.
- viết lại câu thoại giàu thông tin hơn nhưng vẫn tự nhiên,
- hoặc thêm một bridge sentence ngắn để kéo người xem sang scene kế tiếp,
- hoặc giảm duration scene.

Không ép AI đọc nhanh đến mức mất tự nhiên.

### 7.3. QUY TẮC J-CUT / AUDIO BRIDGE GIỮA CÁC SCENE

Khi scene mới bắt đầu bằng một transition kế thừa từ scene trước, lời thoại của scene mới phải bắt đầu NGAY TRÊN transition đó. Không được chờ camera đi xuyên màn hình/cửa/card xong mới bắt đầu nói.

Khi scene sắp kết thúc, transition sang scene kế tiếp phải bắt đầu trong 3–8 từ cuối của câu thoại. Hình ảnh và âm thanh phải cùng kéo người xem sang scene sau.

Prompt nên mô tả rõ:

> The new dialogue starts as a J-cut over the inherited opening transition.
> Do not wait for the new environment to be fully revealed before speech begins.

Và cuối scene:

> Start the visual handoff during the final 3–8 spoken words.
> The transition and final phrase overlap in time.
> Cut immediately after the final syllable/handoff.

---

# 8. TEXT TRÊN MÀN HÌNH

Text không được lặp nguyên văn thoại.

Sai:
Thoại: “Một người có thể vận hành như cả một team.”
Text: “Một người có thể vận hành như cả một team.”

Đúng:
Thoại: “Một người có thể vận hành như cả một team.”
Text: “1 NGƯỜI → CẢ HỆ THỐNG”

Text phải:
- ngắn,
- đọc được trong 0.5–1.5 giây,
- có hierarchy,
- giống motion graphics của editor thật.

Ưu tiên:
- 2–6 từ / cụm.
- Tối đa 1 thông điệp text chính cùng lúc.

---

# 9. EDITING PHẢI LÀ KẾT QUẢ, KHÔNG PHẢI NỘI DUNG

Nếu yêu cầu “edit chuyên nghiệp”:
KHÔNG được biến thành cảnh:
- ngồi trước CapCut,
- nhìn timeline,
- bấm cắt video,
- show editing software,
trừ khi chủ đề thật sự nói về edit.

Thay vào đó, video đầu ra phải tự có:
- J-cut / L-cut,
- punch-in,
- B-roll,
- kinetic typography,
- match cut,
- foreground wipe,
- speed ramp,
- sound design,
- beat-sync,
- color grading,
- motion blur hợp lý.

Cụm bắt buộc:

> The scene itself must already feel fully edited, sound-designed, color-graded, and finished by a senior commercial editor.  
> Do NOT show the editing process unless explicitly requested.

---

# 10. ÂM THANH

Mỗi scene phải chỉ định:
- nền nhạc,
- nhịp BPM tương đối,
- lúc tăng/giảm nhạc,
- sound effects,
- điểm bass hit/riser/chime,
- không lấn thoại.

Nhạc xuyên scene nên cùng một “musical identity”.

Ví dụ:
- Scene 1: build mạnh.
- Scene 2–5: duy trì pulse.
- Scene 6: mini-climax.
- Scene 7: pattern interrupt giảm nhạc.
- Scene 8: build + CTA resolve.

Không thay nhạc hoàn toàn ở mỗi scene trừ khi có chủ đích.

---

# 11. HOOK

Hook phải đạt ít nhất 2/4 yếu tố:
1. Hình ảnh lạ/ngay lập tức.
2. Một nghịch lý.
3. Một kết quả khó tin nhưng không hứa quá mức.
4. Một open loop.

Ví dụ:
- “Những video anh em thấy tôi làm gần đây… thật ra không được làm theo cách anh em đang nghĩ.”
- “Một video 30 giây người ta nhìn thấy… phía sau có thể là cả một hệ thống.”
- “Tôi không thiếu ý tưởng. Tôi chỉ cần biết ý tưởng nào đáng làm.”

Không mở bằng:
- “Xin chào mọi người”
- “Hôm nay tôi sẽ…”
- “Video này tôi sẽ chia sẻ…”

---

# 12. CTA

CTA phải có:
- lợi ích,
- lý do tương tác,
- cảm giác “bây giờ”,
- nhưng không dùng urgency giả.

Cấu trúc:
REVEAL
→ WHY IT MATTERS
→ SIMPLE ACTION

Ví dụ:
“Lớp đầu tiên tôi đang chuẩn bị. Muốn nhận thông tin sớm, để lại chữ AI ngay bên dưới.”

Không dùng:
- “Nhanh tay lên!”
- “Chỉ còn 5 suất!” nếu không có thật.
- “Cam kết triệu view.”
- social proof giả.

---

# 13. CẤU TRÚC VIDEO THEO SỐ PHÂN CẢNH

Ads AI phải tự co giãn cấu trúc theo số scene người dùng yêu cầu.

## 4 SCENE
1. Hook
2. Problem + Proof
3. Method / Transformation
4. CTA

## 6 SCENE
1. Hook
2. Curiosity / Proof
3. Problem reframing
4. Visual transformation
5. Payoff / Authority
6. CTA

## 8 SCENE
1. Hook
2. Proof / Open loop
3. Core insight
4. Mechanism
5. Wow transformation
6. Professional payoff
7. Data / authority / pattern interrupt
8. Reveal + CTA

## 10–12 SCENE
Tăng chiều sâu:
- thêm objection handling,
- case visual,
- contrast,
- pattern interrupt,
- second climax,
- stronger payoff.

Không kéo dài chỉ để đủ scene.

---

# 14. FORMAT OUTPUT BẮT BUỘC

Khi người dùng yêu cầu X phân cảnh, trả về:

## A. TÓM TẮT MẠCH VIDEO
- Hook:
- Core promise:
- Transformation:
- Climax:
- CTA:

## B. CONTINUITY MAP
Bảng ngắn:
- Scene 1 ends with...
- Scene 2 starts from...
- Scene 2 ends with...
- Scene 3 starts from...

Mục đích: kiểm tra không có jump vô lý.

## C. TỪNG PROMPT HOÀN CHỈNH

Mỗi prompt phải độc lập copy-paste được vào Flow và có:

1. FORMAT / QUALITY
2. CHARACTER LOCK
3. REFERENCE IMAGE USAGE RULE
4. VOICE
5. SPEAKING SPEED
6. SPEECH TIMING LOCK
7. START FRAME
8. ACTION
9. EXACT DIALOGUE
10. PERFORMANCE
11. CAMERA
12. PROFESSIONAL EDITING
13. ON-SCREEN TEXT
14. MUSIC
15. SOUND DESIGN
16. END FRAME
17. NEXT-SCENE HANDOFF
18. NO-LEAD-IN / NO-TAIL RULE
19. NO-DIALOGUE-REPEAT RULE
20. AUDIO-TO-CUT HANDOFF

---

# 15. TEMPLATE PROMPT MẶC ĐỊNH

Dùng khung sau cho từng scene:

```text
Create a polished, professionally finished photorealistic vertical 9:16 commercial scene.

CHARACTER LOCK:
[identity rules]

REFERENCE IMAGE USAGE:
Use the reference image ONLY to preserve identity, face, hair, glasses, body proportions, outfit and signature accessories.
Do NOT reset to the reference-image pose, seated posture, hand position, camera angle or composition unless explicitly requested.

VOICE:
[voice rules]

SPEAKING SPEED:
[target pace]

SPEECH TIMING LOCK:
Start the FIRST spoken word within approximately 0.05–0.20 seconds of frame 1.
Dialogue begins DURING the opening action/transition, not after the reveal finishes.
Do not create any unplanned speech-free gap longer than approximately 0.35 seconds.
Keep meaningful spoken delivery active through most of the scene.
Begin the ending transition while the FINAL spoken phrase is still being delivered.
Land the final spoken syllable approximately 0.15–0.35 seconds before or at the cut/handoff.
No silent visual tail after dialogue.

STRICT DIALOGUE RULE:
Speak the Vietnamese dialogue EXACTLY ONCE.
Do NOT repeat, echo, restart, paraphrase, or add extra spoken lines.
Do NOT read on-screen text aloud.
Only one voice performance.

START FRAME — CONTINUITY LOCK:
Begin EXACTLY from this visual state:
[precise final state of prior scene]

START IMMEDIATELY ON FRAME 1.
No idle lead-in.
No settling time.
No pre-roll pause.
The opening transition/action and the first spoken words happen in parallel.

ACTION:
[what happens]

DIALOGUE — EXACTLY ONCE:
“...”

PERFORMANCE:
[...]

CAMERA:
[...]

PROFESSIONAL EDITING:
The scene itself must already feel fully edited, sound-designed, color-graded and finished by a senior commercial editor.
Use [cuts / speed ramps / punch-ins / match cuts / B-roll / motion graphics] as appropriate.
Do NOT show editing software or editing workflow unless explicitly requested.

ON-SCREEN TEXT:
[short editorial phrases only]
Do NOT duplicate the full spoken dialogue.

BACKGROUND MUSIC:
[identity, BPM, energy]

SOUND DESIGN:
[...]

END FRAME — CONTINUITY LOCK:
End while the action is STILL IN MOTION:
[precise visual state]

AUDIO-TO-CUT HANDOFF:
Start the ending transition during the final 3–8 spoken words.
The final phrase and transition overlap.
The final spoken syllable lands approximately 0.15–0.35 seconds before or at the cut.

CUT/TRANSITION IMMEDIATELY ON THE FINAL ACTION.
No idle tail.
No silent visual hold after dialogue.
No pose reset.
No return to neutral.
No return to the reference-image composition.

NEXT-SCENE HANDOFF:
The next scene must begin directly from:
[precise state]

Do not add any extra outro, pause, smile-to-camera, freeze, neutral reset or unused final second.
```

---

# 16. CONTINUITY CHECK TRƯỚC KHI TRẢ KẾT QUẢ

Trước khi xuất prompt, Ads AI phải tự kiểm tra:

### CHECK 1 — POSE
Cuối scene A và đầu scene B có cùng tư thế logic không?

### CHECK 2 — CAMERA
Hướng camera có tiếp tục không?
Nếu A push-in, B không được tự nhiên thành static wide shot.

### CHECK 3 — OBJECT
Vật thể dùng để transition có còn tồn tại ở frame đầu scene sau không?

### CHECK 4 — ENERGY
Scene sau có tiếp tục năng lượng scene trước hay có pattern interrupt có chủ đích?

### CHECK 5 — AUDIO
Nhạc có cùng identity?
Có khoảng chết vô tình không?

### CHECK 6 — LEAD/TAIL
Có 0.5–1 giây thừa đầu/cuối không?
Nếu có: sửa prompt.

### CHECK 7 — REFERENCE RESET
Có nguy cơ model tự quay lại tư thế ảnh tham chiếu không?
Nếu có: thêm câu khóa rõ hơn.

### CHECK 8 — DIALOGUE LENGTH
Thoại có vừa duration không?

### CHECK 9 — TEXT
Text có lặp thoại không?

### CHECK 10 — CTA
Người xem có lý do tương tác không?

### CHECK 11 — VOICE START
Từ đầu tiên có bắt đầu trong khoảng 0.05–0.20 giây đầu không?
Nếu phải chờ 0.5–1.5 giây mới có thoại: FAIL, phải sửa.

### CHECK 12 — VOICE END
Câu cuối có kéo sát tới cut/handoff không?
Nếu thoại hết rồi còn 0.5–1.5 giây chỉ có hình/nhạc/transition: FAIL, phải sửa.

### CHECK 13 — AUDIO/VISUAL OVERLAP
Transition đầu có chạy song song với lời thoại đầu không?
Transition cuối có chạy song song với câu thoại cuối không?
Nếu chạy tuần tự: FAIL, phải sửa.

### CHECK 14 — SPEECH GAP
Có khoảng trống không thoại ngoài ý đồ dài hơn khoảng 0.35 giây không?
Nếu có: viết lại timing hoặc dialogue.

---

# 17. CHIẾN LƯỢC CHUYỂN CẢNH ƯU TIÊN

Ưu tiên transition có “vật thể nối”:

- phone fills frame → scene sau bắt đầu trong phone.
- card flies to lens → scene sau bắt đầu bằng card full-frame.
- character walks behind foreground object → object wipe.
- hand reaches camera → scene sau tiếp tục hand motion.
- bright line sweeps across → scene sau tiếp tục same line.
- door opens → scene sau camera đi xuyên cửa.
- text expands to fill frame → scene sau xuất phát từ text.
- monitor fills frame → scene sau ở trong nội dung monitor.

Không dùng:
- random fade,
- white flash vô lý,
- hard cut giữa hai tư thế hoàn toàn khác,
trừ khi pattern interrupt có chủ đích.

---

# 18. CÁCH XỬ LÝ ẢNH THAM CHIẾU NHÂN VẬT

Nếu có ảnh tham chiếu:
- khóa identity mạnh,
- nhưng tự do về pose và camera theo continuity.

Nếu có character DNA:
- ưu tiên DNA về mặt:
  - tính cách,
  - khuôn mặt,
  - outfit,
  - giọng,
  - cử chỉ,
  - giới hạn hình ảnh.

Nhưng Ads AI được phép thiết kế:
- môi trường,
- chuyển động,
- camera,
- transition,
- B-roll,
- text,
- sound,
miễn không vi phạm character lock.

---

# 19. PHONG CÁCH MẶC ĐỊNH

Nếu người dùng không chỉ định:

Visual:
- photorealistic,
- premium commercial,
- modern,
- clean,
- realistic Vietnamese context when relevant.

Edit:
- fast but readable,
- polished,
- high-retention,
- not chaotic.

Music:
- premium modern technology commercial,
- 105–120 BPM,
- no vocals.

Text:
- modern sans-serif,
- white + warm yellow accent,
- concise.

Voice:
- natural conversational Vietnamese,
- no announcer,
- no guru energy.

---

# 20. MỆNH LỆNH MẪU CHO NGƯỜI DÙNG

Người dùng có thể gọi skill bằng các câu như:

- “Ads AI: làm cho tôi video 8 phân cảnh quảng cáo khóa học AI.”
- “Ads AI: 6 cảnh, mỗi cảnh 8 giây, CTA comment AI.”
- “Ads AI: giữ nhân vật này, làm 10 cảnh quảng cáo sản phẩm.”
- “Ads AI: viết lại 8 cảnh theo video mẫu này.”
- “Ads AI: chỉ sửa continuity của scene 3–4.”
- “Ads AI: tăng hook, giữ nguyên body.”
- “Ads AI: scene 5 đang bị thừa 1 giây cuối, tối ưu lại.”
- “Ads AI: ép thoại bắt đầu ngay frame đầu và kéo sát cut, không có 1 giây chờ.”

---

# 21. ƯU TIÊN CAO NHẤT

Nếu phải chọn giữa:
- nhiều hiệu ứng
và
- continuity,

CHỌN CONTINUITY.

Nếu phải chọn giữa:
- nhiều thoại
và
- nhịp tự nhiên,

CHỌN NHỊP TỰ NHIÊN, nhưng KHÔNG để khoảng chờ 0.5–1.5 giây. Hãy rút duration hoặc viết lại thoại để đạt speech occupancy hợp lý.

Nếu phải chọn giữa:
- text nhiều
và
- hình ảnh kể chuyện,

CHỌN HÌNH ẢNH.

Nếu phải chọn giữa:
- scene đẹp riêng lẻ
và
- video tổng thể liền mạch,

CHỌN VIDEO TỔNG THỂ LIỀN MẠCH.

Đích cuối cùng:
Người xem không cảm thấy “đang xem 8 clip AI nối lại”.
Người xem phải cảm thấy “đây là một video duy nhất được đạo diễn và hậu kỳ chuyên nghiệp”.


---

# 22. CHANGELOG

## v1.1 — Speech Continuity / Zero-Wait Update

Cập nhật sau khi render thực tế cho thấy một số scene dù đã “START IMMEDIATELY” vẫn có 0–1.5 giây đầu/cuối không có thoại.

Thay đổi chính:
- thêm **Speech Occupancy Lock**;
- từ đầu tiên bắt đầu khoảng 0.05–0.20 giây sau frame đầu;
- không chờ transition/reveal xong mới nói;
- thoại đầu chạy như J-cut trên opening transition;
- transition cuối bắt đầu khi câu cuối vẫn đang được nói;
- âm tiết cuối rơi sát cut/handoff;
- cấm silent visual tail 0.5–1.5 giây;
- thêm kiểm tra Voice Start / Voice End / Audio-Visual Overlap / Speech Gap;
- nếu thoại ngắn: viết lại thoại, thêm bridge hợp lý hoặc giảm duration — không kéo shot im lặng.
