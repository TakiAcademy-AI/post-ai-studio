// Giọng đọc có sẵn trong Flow (Thành phần → Giọng nói), đo ngày 2026-10-13. Chọn 1 giọng cho cả video để các cảnh
// không mỗi cảnh một giọng (Veo tự tạo giọng mới cho từng clip nếu không có tham chiếu).
export const VOICES = [
  // @me = hình đại diện "Tôi" của tài khoản Flow (giọng thật của chủ tài khoản). Gõ "@me" trong prompt → chọn
  // "Tôi — Hình đại diện" → Flow chèn thẻ nhắc tên (likeness) và thêm 1 thành phần.
  { name: 'me', gender: '@me', desc: 'giọng của tôi (hình đại diện "Tôi" trong Flow)' },
  { name: 'Achird', gender: 'Nam', desc: 'thân thiện, trung' },
  { name: 'Algieba', gender: 'Nam', desc: 'thoải mái, trung-trầm' },
  { name: 'Alnilam', gender: 'Nam', desc: 'chắc chắn, trung-trầm' },
  { name: 'Charon', gender: 'Nam', desc: 'rõ ràng, trầm' },
  { name: 'Iapetus', gender: 'Nam', desc: 'rõ, trung-trầm' },
  { name: 'Algenib', gender: 'Nam', desc: 'khàn, trầm' },
  { name: 'Enceladus', gender: 'Nam', desc: 'hơi thở, trầm' },
  { name: 'Fenrir', gender: 'Nam', desc: 'hào hứng, trẻ' },
  { name: 'Achernar', gender: 'Nữ', desc: 'nhẹ, cao' },
  { name: 'Aoede', gender: 'Nữ', desc: 'tươi, trung' },
  { name: 'Autonoe', gender: 'Nữ', desc: 'sáng, trung' },
  { name: 'Callirrhoe', gender: 'Nữ', desc: 'thoải mái, trung' },
  { name: 'Despina', gender: 'Nữ', desc: 'mượt, trung' },
  { name: 'Erinome', gender: 'Nữ', desc: 'trong, trung' },
  { name: 'Gacrux', gender: 'Nữ', desc: 'trưởng thành, trung' },
];
export const isVoice = (v) => VOICES.some((x) => x.name === v);
