"""Việt sub kiểu karaoke (theo video chuẩn): mỗi lần 1–3 chữ IN HOA, chữ trắng viền đen, từ đang đọc màu vàng.
Chữ lấy ĐÚNG từ lời thoại kịch bản (không để AI nghe rồi tự viết → không sai chính tả); faster-whisper chỉ dùng để lấy
mốc thời gian từng từ, rồi căn lời thoại vào các mốc đó (difflib).

python3.12 subs.py <video> <dialogue.json> <out.ass> [model]
dialogue.json: ["lời cảnh 1", "lời cảnh 2", ...]  (rỗng → dùng nguyên chữ whisper nghe được)
"""
import difflib
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.expanduser('~/.local/lib/python3.12/site-packages'))
from faster_whisper import WhisperModel  # noqa: E402

video, dlg_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
model_name = sys.argv[4] if len(sys.argv) > 4 else 'medium'

W, H = 1080, 1920
FONT = 'Noto Sans ExtraCondensed ExtraBold'
SIZE = 66
YELLOW = '&H0000E6FF&'  # ASS: &HAABBGGRR → vàng (255,230,0)
WHITE = '&H00FFFFFF&'
MAX_WORDS, MAX_CHARS, GAP = 3, 16, 0.35


def norm(w):
    w = unicodedata.normalize('NFC', w.lower())
    return re.sub(r'[^\w]', '', w)


model = WhisperModel(model_name, device='cpu', compute_type='int8')
segs, _ = model.transcribe(video, language='vi', word_timestamps=True, vad_filter=False)
heard = [w for s in segs for w in (s.words or []) if norm(w.word)]
if not heard:
    raise SystemExit('whisper không nghe được lời nào')

dialogue = json.load(open(dlg_path, encoding='utf-8'))
script = [w for line in dialogue for w in line.replace('"', ' ').replace('“', ' ').replace('”', ' ').split() if norm(w)]

if script:
    a = [norm(w) for w in script]
    b = [norm(w.word) for w in heard]
    times = [None] * len(script)
    for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks():
        for k in range(blk.size):
            hw = heard[blk.b + k]
            times[blk.a + k] = [hw.start, hw.end]
    # từ không khớp (whisper nghe lệch) → chia đều khoảng giữa 2 từ khớp gần nhất
    i = 0
    n = len(script)
    while i < n:
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < n and times[j] is None:
            j += 1
        t0 = times[i - 1][1] if i > 0 else heard[0].start
        t1 = times[j][0] if j < n else heard[-1].end
        if t1 <= t0:
            t1 = t0 + 0.25 * (j - i)
        step = (t1 - t0) / (j - i)
        for k in range(i, j):
            times[k] = [t0 + step * (k - i), t0 + step * (k - i + 1)]
        i = j
    words = [{'text': w, 'start': t[0], 'end': t[1]} for w, t in zip(script, times)]
    matched = sum(1 for blk in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks() for _ in range(blk.size))
else:
    words = [{'text': w.word.strip(), 'start': w.start, 'end': w.end} for w in heard]
    matched = len(words)

# gom cụm 1–3 chữ: ngắt ở dấu câu, khoảng lặng, hoặc quá dài
chunks, cur = [], []
for k, w in enumerate(words):
    cur.append(w)
    text = ' '.join(x['text'] for x in cur)
    nxt = words[k + 1] if k + 1 < len(words) else None
    end_punct = re.search(r'[,.!?…;:]$', w['text'])
    if (len(cur) >= MAX_WORDS or len(text) >= MAX_CHARS or end_punct or not nxt or nxt['start'] - w['end'] > GAP
            or (nxt and len(text) + 1 + len(nxt['text']) > MAX_CHARS + 2)):
        chunks.append(cur)
        cur = []


def ts(t):
    t = max(0.0, t)
    h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
    return f'{h}:{m:02d}:{s:05.2f}'


def clean(w):
    return re.sub(r'[,.!?…;:]+$', '', w).upper()


events = []
for ci, ch in enumerate(chunks):
    nxt_start = chunks[ci + 1][0]['start'] if ci + 1 < len(chunks) else ch[-1]['end'] + 0.4
    for k, w in enumerate(ch):
        start = w['start']
        end = ch[k + 1]['start'] if k + 1 < len(ch) else min(nxt_start, ch[-1]['end'] + 0.6)
        if end - start < 0.06:
            end = start + 0.06
        parts = [(r'{\c' + YELLOW + '}' + clean(x['text']) + r'{\c' + WHITE + '}') if j == k else clean(x['text']) for j, x in enumerate(ch)]
        events.append(f'Dialogue: 0,{ts(start)},{ts(end)},Sub,,0,0,0,,' + ' '.join(parts))

ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,{FONT},{SIZE},{WHITE},{WHITE},&H00000000&,&H80000000&,0,0,0,0,100,100,0,0,1,4,2,2,60,60,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + '\n'.join(events) + '\n'
open(out_path, 'w', encoding='utf-8').write(ass)
print(json.dumps({'words': len(words), 'matched': matched, 'chunks': len(chunks), 'heard': len(heard)}))
