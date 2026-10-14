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
  if (input.cta) lines.push(`CTA mong muốn: ${input.cta}`);
  if (input.character) lines.push(`Nhân vật / character DNA: ${input.character}`);
  if (refImagePath) {
    lines.push(
      `Ảnh tham chiếu nhân vật nằm ở: ${refImagePath}`,
      'BẮT BUỘC dùng công cụ Read để xem ảnh này TRƯỚC khi viết. Viết CHARACTER LOCK tiếng Anh thật chi tiết theo đúng ảnh: giới tính, tuổi ước lượng, dáng mặt, kiểu tóc, màu tóc, kính (nếu có), râu, màu da, trang phục, phụ kiện (đồng hồ…). Dùng NGUYÊN VĂN cùng một CHARACTER LOCK cho mọi cảnh.',
    );
  }
  if (input.mustSay) lines.push(`Thông tin bắt buộc phải nói: ${input.mustSay}`);
  if (input.avoid) lines.push(`Điều cấm / không muốn xuất hiện: ${input.avoid}`);
  if (input.tone) lines.push(`Tông giọng / phong cách: ${input.tone}`);
  if (input.voice === 'me') lines.push(
    'NHÂN VẬT CHÍNH LÀ CHỦ TÀI KHOẢN: mọi cảnh được gắn hình đại diện "Tôi" (@me) của Flow — vừa khóa khuôn mặt vừa khóa giọng. KHÔNG có ảnh nhân vật, KHÔNG có khung đầu từ cảnh trước (Flow chặn ảnh mặt người thật).',
    '- CHARACTER LOCK mọi cảnh ghi nguyên văn: "The presenter is the attached @me avatar (Tôi), the same presenter in every scene." rồi chỉ mô tả TRANG PHỤC/phụ kiện cố định (giống hệt nhau ở mọi cảnh). KHÔNG mô tả khuôn mặt, KHÔNG dùng các từ "likeness", "exact face", "real person", "lookalike", "resemble" — các từ này làm Flow nghi dựng lại người thật và chặn "người nổi tiếng".',
    '- VOICE mọi cảnh ghi nguyên văn: "Use the voice of the attached @me avatar (Tôi) for all dialogue; same speaker in every scene, natural Vietnamese."',
    '- KHUNG HÌNH: KHÔNG quay cận mặt nhìn thẳng ống kính (không close-up / medium close-up, không punch-in vào mặt) — mặt to rõ làm bộ lọc "người nổi tiếng" của Flow chặn liên tục. Dùng trung cảnh từ eo trở lên (waist-up, người chiếm khoảng nửa chiều cao khung), hơi nghiêng 3/4; cận cảnh chỉ dành cho tay, đồ vật, màn hình.',
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
    '- Trường "caption": caption Facebook Reel tiếng Việt, ngắn, có CTA, tối đa 3 hashtag, không hứa hẹn quá mức.',
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

export async function compressPrompts(items) {
  let pending = items.map((x) => ({ ...x }));
  const result = new Map();
  let costUsd = 0;
  for (const target of [PROMPT_TARGET, 3000, 2600]) {
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
    pending = pending.filter((x) => x.prompt.length > PROMPT_LIMIT - 100);
    if (!pending.length) break;
  }
  return { prompts: [...result].map(([scene, prompt]) => ({ scene, prompt })), costUsd };
}
