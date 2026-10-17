// "Công thức" của một video lúc đăng — các biến để vòng phản hồi so sánh video tốt / kém sau này.
// Chỉ đọc từ job (kịch bản, thiết lập, bản ghép, caption), không gọi gì ra ngoài.
const hashtags = (s) => (String(s || '').match(/#[\p{L}\p{N}_]+/gu) || []).length;

export function buildRecipe(job, { mode = null, scheduledAt = null } = {}) {
  const sum = job.script?.summary || {};
  const when = scheduledAt ? new Date(Number(scheduledAt) * 1000) : new Date();
  const vn = new Date(when.getTime() + 7 * 3600 * 1000); // giờ Việt Nam
  const dialogue = (job.scenes || []).map((s) => s.dialogue || '').join(' ');
  return {
    topic: job.input?.topic || '',
    audience: job.input?.audience || '',
    character: job.input?.character || '',
    tone: job.input?.tone || '',
    hook: sum.hook || '',
    hookLine: job.scenes?.[0]?.dialogue || '',
    corePromise: sum.corePromise || '',
    cta: job.input?.cta || '',
    hasCta: Boolean(job.input?.cta),
    sceneCount: job.scenes?.length || 0,
    durationSec: Math.round(job.final?.duration || 0),
    words: dialogue.split(/\s+/).filter(Boolean).length,
    voice: job.voice || null,
    flowModel: job.flowModel || null,
    textOverlay: job.text?.enabled === true,
    captionChars: (job.caption || '').length,
    hashtags: hashtags(job.caption),
    postMode: mode,
    postHourVN: vn.getUTCHours(),
    postWeekdayVN: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][vn.getUTCDay()],
  };
}
