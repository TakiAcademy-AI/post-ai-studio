import { config } from './config.js';
import { run, tail } from './proc.js';
import { envForActive, activeLabel } from './claude-accounts.js';

// Kịch bản trả về theo đúng format mục 14 của skill, nhưng dạng JSON để web xử lý.
export const PROMPT_LIMIT = 4000;
const PROMPT_TARGET = 3500;

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        hook: { type: 'string' },
        corePromise: { type: 'string' },
        transformation: { type: 'string' },
        climax: { type: 'string' },
        cta: { type: 'string' },
      },
      required: ['hook', 'corePromise', 'transformation', 'climax', 'cta'],
    },
    continuityMap: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'integer' },
          startsFrom: { type: 'string' },
          endsWith: { type: 'string' },
        },
        required: ['scene', 'startsFrom', 'endsWith'],
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scene: { type: 'integer' },
          title: { type: 'string', description: 'Tên ngắn tiếng Việt, ví dụ "Hook"' },
          dialogue: { type: 'string', description: 'Lời thoại tiếng Việt, đọc đúng một lần' },
          onScreenText: { type: 'string', description: 'Tóm tắt chữ trên màn hình (ghép các textOverlays)' },
          textOverlays: {
            type: 'array',
            description: 'Chữ hiển thị do web vẽ lúc hậu kỳ — tiếng Việt CÓ DẤU',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                start: { type: 'number', description: 'giây bắt đầu trong cảnh, 0–8' },
                end: { type: 'number', description: 'giây kết thúc trong cảnh, 0–8' },
                position: { type: 'string', enum: ['top', 'middle', 'bottom'] },
              },
              required: ['text', 'start', 'end', 'position'],
            },
          },
          prompt: { type: 'string', description: 'Prompt Flow hoàn chỉnh tiếng Anh theo template mục 15' },
        },
        required: ['scene', 'title', 'dialogue', 'onScreenText', 'textOverlays', 'prompt'],
      },
    },
    caption: { type: 'string', description: 'Caption tiếng Việt cho bài đăng Facebook Reel' },
  },
  required: ['summary', 'continuityMap', 'scenes', 'caption'],
};

function buildBrief(input, refImagePath = null) {
  const identity = input.consistency === 'identity' && input.hasRefImage;
  const lines = [
    `Video AI: làm video ${input.sceneCount} phân cảnh, mỗi cảnh 8 giây, dọc 9:16.`,
    `Chủ đề / sản phẩm: ${input.topic}`,
  ];
  if (input.audience) lines.push(`Đối tượng xem: ${input.audience}`);
  if (input.playbook) lines.push(`SỔ TAY TỐI ƯU (rút từ số liệu các video đã đăng, người dùng đã duyệt — áp dụng khi viết, nhưng yêu cầu của người dùng ở trên/dưới luôn được ưu tiên hơn):\n${input.playbook}`);
  if (input.cta) lines.push(`CTA mong muốn: ${input.cta}`);
  else lines.push('KHÔNG CÓ CTA (người dùng để trống): bỏ qua mọi yêu cầu CTA của skill. KHÔNG thêm lời kêu gọi hành động nào (comment, inbox, nhắn tin, đăng ký, follow, mua, bấm link, nhận ưu đãi…) vào lời thoại, chữ trên màn hình hay hành động (không chỉ tay xuống khu bình luận). Cảnh cuối khép lại tự nhiên bằng chính nội dung (một câu kết / suy ngẫm). Trường summary.cta ghi "(không có)".');
  if (input.character) lines.push(`Nhân vật / character DNA: ${input.character}`);
  if (input.setting) lines.push(`BỐI CẢNH & GÓC QUAY (người dùng yêu cầu — BẮT BUỘC cho MỌI cảnh, ưu tiên hơn mọi quy tắc khung hình mặc định bên dưới; mô tả lại đúng bối cảnh + khung hình + ánh sáng + góc máy này trong START FRAME/CAMERA của từng cảnh, viết bằng tiếng Anh): ${input.setting}`);
  if (refImagePath) {
    lines.push(
      `Ảnh tham chiếu nhân vật nằm ở: ${refImagePath}`,
      'BẮT BUỘC dùng công cụ Read để xem ảnh này TRƯỚC khi viết. Viết CHARACTER LOCK tiếng Anh thật chi tiết theo đúng ảnh: giới tính, tuổi ước lượng, dáng mặt, kiểu tóc, màu tóc, kính (nếu có), râu, màu da, trang phục, phụ kiện (đồng hồ…). Dùng NGUYÊN VĂN cùng một CHARACTER LOCK cho mọi cảnh.',
    );
  }
  if (input.feedback) lines.push(`LẦN TRƯỚC VIDEO CÙNG CHỦ ĐỀ BỊ CHẤM CHƯA ĐẠT — viết lại khác đi và sửa đúng các điểm này: ${input.feedback}`);
  if (input.mustSay) lines.push(`Thông tin bắt buộc phải nói: ${input.mustSay}`);
  else lines.push('Không có thông tin bắt buộc phải nói: chỉ nói những gì có trong chủ đề, KHÔNG tự thêm giá, thời lượng khoá học, lịch, khuyến mãi, số liệu hay lời hứa không có trong chủ đề.');
  if (input.avoid) lines.push(`Điều cấm / không muốn xuất hiện: ${input.avoid}`);
  if (input.tone) lines.push(`Tông giọng / phong cách: ${input.tone}`);
  if (input.voice === 'me') lines.push(
    'NHÂN VẬT CHÍNH LÀ CHỦ TÀI KHOẢN: mọi cảnh được gắn hình đại diện "Tôi" (@me) của Flow — vừa khóa khuôn mặt vừa khóa giọng. KHÔNG có ảnh nhân vật, KHÔNG có khung đầu từ cảnh trước (Flow chặn ảnh mặt người thật). Hình đại diện mang sẵn áo của video selfie gốc, nên hãy lặp lại ĐÚNG mô tả trang phục DNA (chi tiết: loại áo, cổ, màu, có/không in hình) trong CHARACTER LOCK của mọi cảnh; web tự chèn thêm "OUTFIT LOCK" và tự kiểm tra áo từng cảnh.',
    '- CHARACTER LOCK mọi cảnh ghi nguyên văn: "The presenter is the attached @me avatar (Tôi), the same presenter in every scene." rồi chỉ mô tả TRANG PHỤC/phụ kiện cố định (giống hệt nhau ở mọi cảnh). KHÔNG mô tả khuôn mặt, KHÔNG dùng các từ "likeness", "exact face", "real person", "lookalike", "resemble" — các từ này làm Flow nghi dựng lại người thật và chặn "người nổi tiếng".',
    '- VOICE mọi cảnh ghi nguyên văn: "Use the voice of the attached @me avatar (Tôi) for all dialogue; same speaker in every scene, natural Vietnamese."',
    input.setting
      ? '- KHUNG HÌNH: làm ĐÚNG mục "BỐI CẢNH & GÓC QUAY" người dùng yêu cầu (kể cả khung hình rộng/hẹp). Chỉ tránh punch-in đột ngột vào mặt (web tự viết lại prompt nếu Flow chặn "người nổi tiếng").'
      : '- KHUNG HÌNH: KHÔNG quay cận mặt nhìn thẳng ống kính (không close-up / medium close-up, không punch-in vào mặt) — mặt to rõ làm bộ lọc "người nổi tiếng" của Flow chặn liên tục. Dùng trung cảnh từ eo trở lên (waist-up, người chiếm khoảng nửa chiều cao khung), hơi nghiêng 3/4; cận cảnh chỉ dành cho tay, đồ vật, màn hình.',
    '- Vì không có khung đầu, mỗi chỗ nối là MATCH CUT: START FRAME của cảnh N mô tả lại rõ bối cảnh, ánh sáng, trang phục, tư thế, hướng camera nối tiếp END FRAME cảnh N-1.',
    '- Không nhắc tên người nổi tiếng, không yêu cầu giống người thật nào khác.',
  );
  else if (input.voice) lines.push(`Giọng đọc: mọi cảnh được gắn cùng một giọng tham chiếu "${input.voice}" của Flow. Mục VOICE trong mọi prompt ghi nguyên văn giống nhau: "Use the attached voice reference (${input.voice}) for all dialogue; same speaker, same timbre, natural Vietnamese." — không mô tả thêm chất giọng khác để tránh lệch.`);
  lines.push(
    '',
    'BỐI CẢNH KỸ THUẬT (bắt buộc tuân theo khi viết prompt):',
    '- Mỗi cảnh Veo render đúng 8 giây; viết thoại và timing cho 8 giây.',
    input.voice === 'me'
      ? '- Cảnh 1 được tạo bằng reference-to-video với hình đại diện @me (khuôn mặt + giọng của chủ tài khoản).'
      : input.hasRefImage
      ? '- Cảnh 1 được tạo bằng reference-to-video với ảnh tham chiếu nhân vật (chỉ để khóa danh tính).'
      : '- Cảnh 1 được tạo bằng text-to-video, không có ảnh tham chiếu; CHARACTER LOCK phải mô tả nhân vật thật chi tiết.',
    input.voice === 'me'
      ? '- Mọi cảnh tạo bằng reference-to-video với hình đại diện @me (xem mục NHÂN VẬT CHÍNH LÀ CHỦ TÀI KHOẢN).'
      : identity
      ? '- Từ cảnh 2 trở đi, mỗi cảnh được tạo bằng reference-to-video với HAI ảnh tham chiếu: (1) ảnh nhân vật gốc để khóa khuôn mặt, (2) khung hình cuối của cảnh trước để giữ bối cảnh, trang phục, ánh sáng, tư thế. KHÔNG có khung hình đầu cố định, nên mỗi chỗ nối là một MATCH CUT: START FRAME của cảnh N mô tả lại rõ bối cảnh + tư thế + hướng camera tiếp nối END FRAME của cảnh N-1. Mọi prompt phải ghi rõ "The person must look exactly like the reference photo of the character" và dùng cùng một CHARACTER LOCK y hệt nhau.'
      : '- Từ cảnh 2 trở đi, hệ thống tự lấy KHUNG HÌNH CUỐI của cảnh trước làm khung hình đầu (image-to-video). Vì vậy START FRAME của cảnh N phải mô tả đúng END FRAME của cảnh N-1, và END FRAME phải là một trạng thái nối được.',
    '- CHỮ TRÊN MÀN HÌNH do web tự vẽ ở hậu kỳ (Veo vẽ chữ sai). Đưa toàn bộ chữ hiển thị vào trường "textOverlays": tiếng Việt CÓ DẤU, 2–6 từ mỗi mục, tối đa 3 mục mỗi cảnh, mốc thời gian 0–8 giây khớp lời thoại, position "top" (mặc định) hoặc "middle"/"bottom"; không dùng emoji hay ký hiệu mũi tên. Text không được lặp nguyên văn lời thoại.',
    '- TRONG PROMPT gửi Veo TUYỆT ĐỐI KHÔNG yêu cầu chữ: mục ON-SCREEN TEXT ghi đúng "None — added in post-production." và cuối mỗi prompt thêm câu: "Do NOT render any on-screen text, letters, numbers, captions, subtitles, signs with readable text, logos or watermarks anywhere in the frame." Màn hình điện thoại/laptop trong cảnh chỉ hiện giao diện mờ, không chữ đọc được.',
    '- Mỗi prompt phải tự đứng độc lập, copy-paste được, viết bằng tiếng Anh theo template mục 15; lời thoại trong prompt giữ nguyên tiếng Việt.',
    `- GIỚI HẠN CỨNG: mỗi prompt TỐI ĐA ${PROMPT_TARGET} ký tự (Flow cắt bỏ mọi thứ sau 4000 ký tự). Giữ đủ các mục của template nhưng viết cô đọng: mỗi mục 1–3 câu, không lặp lại cùng một luật ở nhiều mục, gộp NO-LEAD-IN / NO-TAIL / AUDIO-TO-CUT thành câu ngắn. Ưu tiên giữ nguyên: dialogue, START FRAME, END FRAME, SPEECH TIMING LOCK.`,
    '- Trường "dialogue" và "onScreenText" là bản tóm tắt tiếng Việt để người dùng duyệt, phải khớp với nội dung trong prompt.',
    `- Trường "caption": caption Facebook Reel tiếng Việt, ngắn, ${input.cta ? `kết bằng đúng CTA: ${input.cta}` : 'KHÔNG có lời kêu gọi hành động'}, tối đa 3 hashtag, không hứa hẹn quá mức.`,
    '- Trước khi trả kết quả, tự chạy 14 bước CONTINUITY CHECK ở mục 16 và sửa lỗi; không cần in ra checklist.',
  );
  return lines.join('\n');
}

async function callClaude({ systemPromptFile, systemPrompt, schema, input, tools = [] }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--no-session-persistence',
    '--tools', tools.join(','),
    ...(tools.length ? ['--allowedTools', tools.join(',')] : []),
    '--strict-mcp-config',
    ...(systemPromptFile ? ['--system-prompt-file', systemPromptFile] : ['--system-prompt', systemPrompt]),
    '--json-schema', JSON.stringify(schema),
  ];
  if (config.claudeModel) args.push('--model', config.claudeModel);

  const res = await run(config.claudeBin, args, {
    input,
    cwd: config.dataDir,
    env: envForActive(), // tài khoản Claude đang chọn trên web
    timeoutMs: 15 * 60 * 1000,
  });
  let out;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    throw new Error(`Claude không trả JSON (exit ${res.code}): ${tail(res.stderr || res.stdout, 600)}`);
  }
  if (out.is_error || !out.structured_output) {
    const msg = tail(out.result || res.stderr, 600);
    const hint = /limit|rate|quota|hạn mức/i.test(msg) ? ' → Tài khoản này hết hạn mức: đổi tài khoản Claude ở tab "Tài khoản".' : '';
    throw new Error(`Claude (${activeLabel()}) lỗi: ${msg}${hint}`);
  }
  return { data: out.structured_output, costUsd: out.total_cost_usd ?? 0 };
}

export async function generateScript(input, { refImagePath = null } = {}) {
  const { data: script, costUsd } = await callClaude({
    systemPromptFile: config.skillFile,
    schema: SCRIPT_SCHEMA,
    input: buildBrief(input, refImagePath),
    // Có ảnh nhân vật → cho Claude đọc ảnh (chỉ Read) để viết CHARACTER LOCK đúng khuôn mặt thật.
    tools: refImagePath ? ['Read'] : [],
  });
  script.scenes.sort((a, b) => a.scene - b.scene);
  let cost = costUsd;
  const long = script.scenes.filter((s) => s.prompt.length > PROMPT_TARGET + 300);
  if (long.length) {
    const r = await compressPrompts(long.map((s) => ({ scene: s.scene, prompt: s.prompt })));
    cost += r.costUsd;
    for (const c of r.prompts) {
      const s = script.scenes.find((x) => x.scene === c.scene);
      if (s && c.prompt.length < s.prompt.length) s.prompt = c.prompt;
    }
  }
  return { script, costUsd: cost, compressed: long.map((s) => s.scene) };
}

const COMPRESS_SCHEMA = {
  type: 'object',
  properties: {
    prompts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { scene: { type: 'integer' }, prompt: { type: 'string' } },
        required: ['scene', 'prompt'],
      },
    },
  },
  required: ['prompts'],
};

// Rút gọn prompt vượt giới hạn của Flow mà không đổi nội dung.
// Model hay "rút" chưa tới đích → lặp tối đa 3 vòng, mỗi vòng ép mục tiêu chặt hơn.
// Flow chặn "người nổi tiếng" (bộ lọc không cho biết lý do) → tự viết lại prompt của cảnh, mỗi bậc né mạnh hơn.
// Lời thoại giữ nguyên từng chữ; cảnh vẫn gắn @me nên giọng/nhân vật không đổi.
const POLICY_LEVELS = [
  'Level 1: keep the same story beat, but reframe it: presenter waist-up at most (about half the frame height or smaller), 3/4 or side angle, '
    + 'looking at objects/hands more than at the lens, never a face close-up. Replace identity wording with exactly: '
    + '"The presenter is the attached @me avatar (Tôi)." Remove words like likeness, exact face, real person, lookalike, resemble, celebrity, famous.',
  'Level 2: make the presenter clearly smaller and less face-centric: medium-wide or wide shot (presenter about one third of the frame height), '
    + 'mostly profile or over-the-shoulder, much of the shot on hands, props, screens and the environment; the presenter speaks while working. '
    + 'Change the setting details and props a little (still consistent with the story). Same identity sentence as level 1.',
  'Level 3: rewrite as a SHORT, simple prompt (max 1500 characters): one plain paragraph describing the setting, the presenter (attached @me avatar, '
    + 'outfit only) doing one simple action in a medium-wide shot, the camera move, and the dialogue line in quotes to be spoken once in Vietnamese. '
    + 'No section headings, no editing jargon, no mention of faces, no on-screen text.',
];
const REWRITE_SCHEMA = { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] };

export async function rewriteForPolicy({ prompt, dialogue, level, failText = '' }) {
  const r = await callClaude({
    systemPrompt:
      'You rewrite Google Flow / Veo 3 video prompts that were BLOCKED by Flow\'s policy filter ' +
      '("may violate our policy on generating videos of celebrities / famous people"). The presenter is the user\'s OWN Flow avatar ' +
      '(@me, "Tôi"), attached as an ingredient — it is not a celebrity; the filter misfires on face-centric prompts. ' +
      'Rewrite the prompt so it is far less likely to trip the filter while keeping the same scene purpose. ' +
      'HARD RULES: keep the Vietnamese dialogue EXACTLY character-for-character and still spoken once; keep vertical 9:16, 8 seconds; ' +
      'keep "Do NOT render any on-screen text"; never name or describe any real or famous person; never describe facial features; ' +
      'ALWAYS keep the sentence "Use the voice of the attached @me avatar (Tôi) for all dialogue." so the voice stays the same as other scenes. ' +
      `Output at most ${PROMPT_TARGET} characters. ${POLICY_LEVELS[Math.min(level, POLICY_LEVELS.length) - 1]}`,
    schema: REWRITE_SCHEMA,
    input: JSON.stringify({ blocked_prompt: prompt, dialogue_verbatim: dialogue, flow_message: failText.slice(0, 300) }),
  });
  let out = String(r.data.prompt || '').trim();
  if (!out) throw new Error('Claude không trả prompt viết lại');
  if (dialogue && !out.includes(dialogue)) out += `\n\nDIALOGUE — speak EXACTLY ONCE, in Vietnamese: "${dialogue}"`;
  if (!/voice of the attached @me avatar/i.test(out)) out = `Use the voice of the attached @me avatar (Tôi) for all dialogue.\n${out}`;
  let costUsd = r.costUsd || 0;
  if (out.length > PROMPT_TARGET + 150) { // quá dài → rút gọn (vẫn giữ lời thoại), tránh Flow cắt mất phần cuối
    const c = await compressPrompts([{ scene: 1, prompt: out }]);
    costUsd += c.costUsd || 0;
    const shorter = c.prompts[0]?.prompt;
    if (shorter && (!dialogue || shorter.includes(dialogue))) out = shorter;
  }
  return { prompt: out.slice(0, PROMPT_LIMIT - 20), costUsd };
}

// Trang phục cho chế độ @me. Hình đại diện @me chiếm hết 3 suất ảnh tham chiếu của Flow (gắn thêm ảnh nào cũng bị lỗi
// "đã đạt tối đa 3"), nên trang phục chỉ khoá được bằng chữ → mô tả chính xác + danh sách "không được mặc", rồi kiểm tra từng cảnh.
const OUTFIT_SCHEMA = { type: 'object', properties: { outfit: { type: 'string' }, avoid: { type: 'string' } }, required: ['outfit', 'avoid'] };
export async function designOutfit({ topic, character, scenePrompts }) {
  const r = await callClaude({
    systemPrompt:
      'From the character DNA / user request (Vietnamese), write the presenter\'s outfit for a video in precise English. '
      + '"outfit": garment type, exact color, fabric, collar style, buttons/placket, sleeves, fit, accessories — at most 220 characters; '
      + 'if no print/logo is mentioned, say "plain, no print, no logo". '
      + '"avoid": the most likely wrong outfits to forbid, at most 180 characters (e.g. for a polo: "NOT a crew-neck T-shirt, NOT a collarless shirt, '
      + 'NO graphic print or logo"). If the DNA does not specify clothes, derive them from the scene prompts.',
    schema: OUTFIT_SCHEMA,
    input: JSON.stringify({ user_request: topic, character_dna: character || '(xem user_request)', scene_prompts: scenePrompts.slice(0, 3).map((p) => p.slice(0, 1200)) }),
  });
  return { outfit: String(r.data.outfit).trim().slice(0, 260), avoid: String(r.data.avoid).trim().slice(0, 220), costUsd: r.costUsd };
}

const CHECK_SCHEMA = { type: 'object', properties: { match: { type: 'boolean' }, seen: { type: 'string' } }, required: ['match', 'seen'] };
/** Claude xem các khung hình của cảnh, so trang phục với mô tả. frames: đường dẫn ảnh tuyệt đối. */
export async function checkOutfit({ frames, outfit }) {
  const r = await callClaude({
    systemPrompt:
      'You check clothing consistency in video frames. Use the Read tool to open EVERY image path given. Judge ONLY the presenter\'s clothing. '
      + 'match=true if the garment type, collar style, color family and print/no-print agree with the expected outfit; small differences '
      + '(sleeves rolled, top button open, slight shade change) are still a match. Wrong garment type (e.g. crew-neck T-shirt instead of polo), '
      + 'wrong collar, clearly different color, or a print/logo when none is expected = match=false. '
      + '"seen": short English description of what the presenter actually wears (at most 120 characters).',
    schema: CHECK_SCHEMA,
    input: JSON.stringify({ expected_outfit: outfit, image_paths: frames }),
    tools: ['Read'],
  });
  return { match: Boolean(r.data.match), seen: String(r.data.seen || '').slice(0, 160), costUsd: r.costUsd };
}

// ---------- Vòng phản hồi: phân tích hiệu quả các video đã đăng → sổ tay tối ưu ----------
const PERF_SCHEMA = {
  type: 'object',
  properties: {
    playbook: { type: 'string' },
    evidence: { type: 'string' },
    confidence: { type: 'string', enum: ['thấp', 'vừa', 'cao'] },
    topics: { type: 'array', items: { type: 'string' } },
  },
  required: ['playbook', 'evidence', 'confidence', 'topics'],
};
export async function analyzePerformance({ rows, currentPlaybook = '' }) {
  const r = await callClaude({
    systemPrompt:
      'Bạn là chuyên gia tăng trưởng Facebook Reels. Dữ liệu là các video đã đăng: "recipe" (công thức lúc làm video) và "metrics" '
      + '(số liệu Facebook theo mốc giờ sau khi đăng). So sánh video tốt và kém để rút ra quy luật CÓ CĂN CỨ. '
      + 'Ưu tiên chỉ số: thời gian xem trung bình / tỉ lệ xem hết, rồi lượt xem, rồi tương tác (bình luận, chia sẻ > thích). '
      + 'Trả về tiếng Việt: "playbook" = sổ tay ngắn (tối đa 1500 ký tự) gồm các quy tắc cụ thể dùng khi viết kịch bản video tiếp theo '
      + '(hook, độ dài, số cảnh, nhịp nói, CTA, giờ đăng, caption…), mỗi quy tắc ghi kèm căn cứ (số video, chênh lệch); '
      + '"evidence" = bảng so sánh ngắn; "confidence" = độ tin cậy (dưới 10 video có số liệu → "thấp"); '
      + '"topics" = 5 chủ đề nên làm tiếp. KHÔNG khuyên giật tít, hứa hẹn sai sự thật hay spam. '
      + 'Nếu có sổ tay cũ, cập nhật nó theo dữ liệu mới thay vì viết lại từ đầu. '
      + 'Mỗi phần tử là MỘT video riêng (không có bản trùng); "(không có caption)" nghĩa là video đó không có caption, các video như vậy vẫn khác nhau. '
      + 'Video nguồn "khác" không có số cảnh / CTA — chỉ suy luận từ caption, độ dài, giờ đăng.',
    schema: PERF_SCHEMA,
    input: JSON.stringify({ current_playbook: currentPlaybook || '(chưa có)', videos: rows }),
  });
  return { ...r.data, costUsd: r.costUsd };
}

// ---------- Tự nuôi kênh: mỗi video một bộ trang phục + bối cảnh mới (góc quay giữ nguyên) ----------
const LOOK_SCHEMA = { type: 'object', properties: { outfit: { type: 'string' }, setting: { type: 'string' } }, required: ['outfit', 'setting'] };
export async function varyLook({ channel = '', topic = '', outfitHint = '', settingHint = '', camera = '', recent = [] }) {
  const r = await callClaude({
    systemPrompt:
      'Bạn là stylist kiêm set designer cho Reels nói chuyện trước camera. Chọn cho video này MỘT bộ trang phục và MỘT bối cảnh MỚI, '
      + 'hợp định vị kênh và chủ đề, KHÁC rõ các video gần đây (khác màu áo / kiểu áo, khác địa điểm). outfit_style_hint và setting_hint chỉ là gợi ý phong cách, được phép đổi kiểu áo và địa điểm. Trả về tiếng Việt. '
      + '"outfit" (tối đa 200 ký tự) = 1 món áo cụ thể: kiểu áo, MỘT màu trơn, cổ áo, tay áo, chất liệu; KHÔNG in hình, KHÔNG logo, '
      + 'KHÔNG chữ, KHÔNG hoạ tiết, không phụ kiện rườm rà (để AI giữ áo giống hệt nhau qua mọi cảnh); lịch sự, hợp người chia sẻ kiến thức. '
      + '"setting" (tối đa 220 ký tự) = địa điểm + vài đồ vật nền + ánh sáng, nhân vật ngồi được và hợp với góc quay cố định đã cho; '
      + 'KHÔNG mô tả lại góc máy / khung hình (phần đó giữ nguyên). Không chỗ đông người, không biển hiệu, logo, thương hiệu thật.',
    schema: LOOK_SCHEMA,
    input: JSON.stringify({ channel, topic, outfit_style_hint: outfitHint || '(tự chọn)', setting_hint: settingHint || '(tự chọn)', fixed_camera: camera, recent_looks: recent.slice(0, 12) }),
  });
  return { outfit: String(r.data.outfit || '').trim().slice(0, 300), setting: String(r.data.setting || '').trim().slice(0, 400) };
}

// ---------- Tự nuôi kênh: quét Page để định vị lại kênh ----------
const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    channel: { type: 'string' },
    audience: { type: 'string' },
    tone: { type: 'string' },
    avoid: { type: 'string' },
    summary: { type: 'string' },
    topics: { type: 'array', items: { type: 'string' } },
  },
  required: ['channel', 'audience', 'tone', 'avoid', 'summary', 'topics'],
};
/** Đọc các bài Page đã đăng (caption + số liệu) → định vị kênh thật sự đang làm, khán giả, giọng, điều tránh, chủ đề nên làm tiếp. */
export async function profileChannel({ pageName, posts, current = '' }) {
  const r = await callClaude({
    systemPrompt:
      'Bạn là chiến lược gia nội dung Facebook Reels. Dữ liệu là các bài Page ĐÃ ĐĂNG (caption + số liệu, mới nhất trước). '
      + 'Hãy xác định Page này THỰC SỰ làm về chủ đề gì, dựa trên caption và hashtag, ưu tiên các bài nhiều lượt xem / xem lâu '
      + '(đó là thứ khán giả của Page muốn xem). Định vị cũ người dùng nhập có thể SAI so với Page, đừng bám theo nếu bài đăng nói khác. '
      + 'Trả về tiếng Việt: "channel" = định vị kênh 2–4 câu (chủ đề chính, các nhánh chủ đề ăn khách, kiểu câu hook/caption hay dùng, '
      + 'hashtag quen dùng của Page); "audience" = khán giả mục tiêu 1 câu; "tone" = giọng nói 1 câu; '
      + '"avoid" = những gì nên tránh (chủ đề lệch kênh hoặc kiểu bài kém xem), 1–2 câu; '
      + '"summary" = 2–3 câu tóm tắt cho người dùng: Page đang làm gì, nhóm bài nào ăn khách nhất (kèm số liệu); '
      + '"topics" = 8 chủ đề video MỚI đúng định vị, mỗi chủ đề 1 câu cụ thể đủ viết kịch bản 20–30 giây, không trùng bài cũ. '
      + 'Không giật tít sai sự thật, không công kích cá nhân, không nội dung nhạy cảm chính trị/tôn giáo.',
    schema: PROFILE_SCHEMA,
    input: JSON.stringify({ page: pageName, current_positioning: current || '(trống)', posts }),
  });
  return r.data;
}

// ---------- Tự nuôi kênh: nghĩ chủ đề video tiếp theo ----------
const TOPICS_SCHEMA = { type: 'object', properties: { topics: { type: 'array', items: { type: 'string' } } }, required: ['topics'] };
export async function ideateTopics({ channel, playbook = '', recent = [], n = 6 }) {
  const r = await callClaude({
    systemPrompt:
      `Bạn lên ý tưởng Reel cho một kênh Facebook. Viết ${n} chủ đề video MỚI bằng tiếng Việt, mỗi chủ đề 1 câu cụ thể (góc nhìn / tình huống rõ, `
      + 'đủ để viết kịch bản 20–30 giây), đúng định vị kênh, áp dụng sổ tay tối ưu nếu có, KHÔNG trùng hay na ná các video gần đây. '
      + 'Không giật tít sai sự thật, không công kích cá nhân, không nội dung nhạy cảm chính trị/tôn giáo.',
    schema: TOPICS_SCHEMA,
    input: JSON.stringify({ channel, playbook: playbook || '(chưa có)', recent_titles: recent.slice(0, 60) }),
  });
  return (r.data.topics || []).map((t) => String(t).trim()).filter(Boolean).slice(0, n);
}

// ---------- Tự nuôi kênh: tự chấm video trước khi đăng ----------
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    verdict: { type: 'string', enum: ['đăng', 'làm lại'] },
    strengths: { type: 'string' },
    issues: { type: 'string' },
    fixes: { type: 'string' },
    caption: { type: 'string' },
    scriptOk: { type: 'boolean' },
    badScenes: { type: 'array', items: { type: 'integer' } },
    visualFix: { type: 'string' },
  },
  required: ['score', 'verdict', 'strengths', 'issues', 'fixes', 'caption', 'scriptOk', 'badScenes', 'visualFix'],
};
/** Chấm khả năng viral của 1 video đã ghép: khung hình (Read) + lời thoại + caption + sổ tay số liệu. */
export async function reviewVideo({ frames, topic, dialogues, caption, durationSec, playbook = '', channel = '', outfit = '' }) {
  const r = await callClaude({
    systemPrompt:
      'Bạn là biên tập viên Facebook Reels khó tính, chấm video TRƯỚC KHI ĐĂNG (thang 0–100: khả năng giữ chân + tương tác + chia sẻ). '
      + 'Dùng công cụ Read mở TỪNG ảnh trong frame_paths (khung đầu/giữa/cuối của từng cảnh, theo thứ tự). Bạn KHÔNG nghe được âm thanh — '
      + 'đánh giá lời thoại qua văn bản. Tiêu chí: (1) hook trong 2 giây đầu có xung đột / tò mò cụ thể không; (2) một thông điệp rõ, cảm xúc thật, '
      + 'không sáo rỗng; (3) độ dài hợp lý (sổ tay nếu có); (4) có câu kết mời bình luận / chia sẻ tự nhiên; (5) hình: người dẫn nhất quán, '
      + `đúng trang phục (${outfit || 'như cảnh đầu'}), không méo mặt/tay, KHÔNG có chữ/phụ đề lạ do AI vẽ, không giật cảnh; (6) caption hấp dẫn, `
      + 'đúng chính tả. LỖI NẶNG (chữ/phụ đề lạ trong hình, sai trang phục rõ, mặt/tay biến dạng, lời thoại vô nghĩa) → điểm ≤ 50. '
      + '"verdict": "đăng" nếu đáng đăng, ngược lại "làm lại". "issues": các điểm trừ cụ thể. "fixes": hướng dẫn NGẮN cho lần viết kịch bản lại '
      + '(nếu làm lại). "caption": caption đã sửa chính tả / tối ưu nhẹ (giữ ý, ≤ 3 hashtag), hoặc nguyên văn nếu đã tốt. '
      + '"scriptOk": true nếu kịch bản/lời thoại đã tốt, chỉ hình bị lỗi. "badScenes": số thứ tự (bắt đầu từ 1) các cảnh có lỗi HÌNH cần tạo lại '
      + '(rỗng nếu không). "visualFix": 1–2 câu TIẾNG ANH ngắn (≤ 300 ký tự) để thêm vào prompt Veo của các cảnh đó nhằm sửa lỗi hình '
      + '(vd. "No mirrors or reflections, no second person, same bookshelf set and warm light as other scenes."). Phần nhận xét trả lời tiếng Việt.',
    schema: REVIEW_SCHEMA,
    input: JSON.stringify({ channel, topic, duration_sec: durationSec, dialogues, caption, playbook: playbook || '(chưa có)', frame_paths: frames }),
    tools: ['Read'],
  });
  const bad = (r.data.badScenes || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1);
  return { ...r.data, badScenes: [...new Set(bad)], visualFix: String(r.data.visualFix || '').slice(0, 320), score: Math.max(0, Math.min(100, Number(r.data.score) || 0)), costUsd: r.costUsd };
}

export async function compressPrompts(items, maxLen = PROMPT_LIMIT - 100) {
  let pending = items.map((x) => ({ ...x }));
  const result = new Map();
  let costUsd = 0;
  for (const target of maxLen < PROMPT_TARGET ? [maxLen - 150, maxLen - 450, maxLen - 800] : [PROMPT_TARGET, 3000, 2600]) {
    const r = await callClaude({
      systemPrompt:
        'You compress Google Flow / Veo video prompts. Keep every section heading and every concrete instruction, ' +
        'but remove repetition and verbose wording. NEVER change the Vietnamese dialogue (keep it character-for-character), ' +
        'START FRAME, END FRAME, NEXT-SCENE HANDOFF, camera direction, character identity, or timing numbers. ' +
        `HARD LIMIT: each output prompt MUST be at most ${target} characters including spaces and newlines. Count carefully; shorter is fine.`,
      schema: COMPRESS_SCHEMA,
      input: JSON.stringify({ prompts: pending }),
    });
    costUsd += r.costUsd;
    for (const c of r.data.prompts) {
      const orig = pending.find((x) => x.scene === c.scene);
      if (orig && c.prompt.length < orig.prompt.length) {
        orig.prompt = c.prompt;
        result.set(c.scene, c.prompt);
      }
    }
    pending = pending.filter((x) => x.prompt.length > maxLen);
    if (!pending.length) break;
  }
  return { prompts: [...result].map(([scene, prompt]) => ({ scene, prompt })), costUsd };
}
