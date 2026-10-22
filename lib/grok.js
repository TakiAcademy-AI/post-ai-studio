// Gọi Grok qua Grok CLI chính thức của xAI (`grok -p`, headless) — đăng nhập do người dùng tự làm bằng `grok login`.
// Dùng như một LLM thuần: tắt công cụ / web / subagent, ép đầu ra theo JSON Schema.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, readSettings } from './config.js';
import { run, tail } from './proc.js';

const bin = () => {
  if (process.env.GROK_BIN) return process.env.GROK_BIN;
  const home = path.join(os.homedir(), '.grok', 'bin', 'grok');
  return fs.existsSync(home) ? home : 'grok';
};
const model = () => process.env.GROK_MODEL || '';

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('không phải JSON');
}

/**
 * systemPrompt: luật của vai; input: nội dung (chuỗi); schema: JSON Schema của đầu ra.
 * images: đường dẫn ảnh (khung hình) — Grok được phép đọc đúng các file đó bằng công cụ đọc file.
 */
export async function callGrok(opts) {
  try { return await callGrokOnce(opts); } catch (e) {
    // Grok CLI thỉnh thoảng trả câu trả lời rỗng / cắt ngang → thử lại 1 lần (lỗi đăng nhập thì thôi).
    if (/grok login|Not signed in|Grok CLI chưa/i.test(e.message)) throw e;
    return callGrokOnce(opts);
  }
}
async function callGrokOnce({ systemPrompt, schema, input, images = [], effort = 'medium', timeoutMs = 15 * 60 * 1000 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-ai-grok-'));
  try {
    const promptFile = path.join(dir, 'prompt.txt');
    // Grok chỉ làm việc trong cwd của phiên → chép ảnh vào thư mục tạm.
    const local = images.map((p, i) => { const n = `img-${String(i + 1).padStart(2, '0')}${path.extname(p) || '.jpg'}`; fs.copyFileSync(p, path.join(dir, n)); return n; });
    const imgNote = local.length
      ? `\n\nẢNH CẦN XEM (mở TỪNG file theo đúng thứ tự bằng công cụ đọc file trước khi trả lời):\n${local.map((p) => `- ${p}`).join('\n')}`
      : '';
    fs.writeFileSync(promptFile, `${input}${imgNote}\n\nChỉ trả về đúng 1 object JSON theo schema, không thêm chữ nào khác.`);
    const args = [
      '--prompt-file', promptFile,
      '--output-format', 'json',
      `--system-prompt-override=${systemPrompt}`, // dạng --a=b: nội dung có dòng bắt đầu bằng "-" không bị hiểu nhầm là tham số
      `--json-schema=${JSON.stringify(schema)}`,
      '--disable-web-search', '--no-subagents', '--no-plan',
      '--sandbox', 'read-only',
      '--reasoning-effort', effort,
      '--max-turns', images.length ? String(images.length + 3) : '2',
    ];
    if (images.length) args.push('--tools', 'read_file', '--always-approve');
    else args.push('--tools', '');
    if (model()) args.push('--model', model());
    const res = await run(bin(), args, {
      cwd: dir,
      env: { ...process.env, GROK_DISABLE_AUTOUPDATER: '1', GROK_MEMORY: '0' },
      timeoutMs,
    });
    let out;
    try { out = JSON.parse(res.stdout.trim()); } catch { try { out = JSON.parse(res.stdout.trim().split('\n').filter(Boolean).pop()); } catch { out = null; } }
    if (!out) {
      throw new Error(`Grok không trả JSON (exit ${res.code}): ${tail(res.stderr || res.stdout, 500)}`);
    }
    if (out.type === 'error' || res.code !== 0) {
      const msg = out.message || tail(res.stderr || res.stdout, 500);
      const hint = /auth|login|unauthor|credential|sign in/i.test(msg) ? ' → chạy `grok login` trong terminal để đăng nhập Grok.' : '';
      throw new Error(`Grok lỗi: ${msg}${hint}`);
    }
    let data;
    if (out.structuredOutput && typeof out.structuredOutput === 'object') return { data: out.structuredOutput, costUsd: out.total_cost_usd ?? 0 };
    try { data = parseJson(out.text); } catch {
      throw new Error(`Grok trả lời không đúng JSON (stop=${out.stopReason}, turns=${out.num_turns}, out_tokens=${out.usage?.output_tokens}): ${tail(out.text || '(rỗng)', 300)}`);
    }
    return { data, costUsd: out.total_cost_usd ?? 0 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Đã đăng nhập Grok chưa (gọi thử 1 câu rất ngắn). */
export async function grokStatus() {
  if (!fs.existsSync(bin()) && bin() !== 'grok') return { installed: false, ok: false };
  try {
    const r = await callGrok({ systemPrompt: 'Reply with JSON only.', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, input: 'Return {"ok": true}.', effort: 'low', timeoutMs: 90 * 1000 });
    return { installed: true, ok: r.data.ok === true };
  } catch (e) {
    return { installed: true, ok: false, error: e.message.slice(0, 300) };
  }
}

/** Bộ não mặc định (tab Tài khoản): 'claude' | 'grok'. */
export function defaultBrain() { return readSettings().brain === 'grok' ? 'grok' : 'claude'; }

export const grokConfig = { bin, model, dataDir: () => config.dataDir };
