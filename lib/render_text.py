#!/usr/bin/env python3
"""Vẽ chữ trên màn hình thành PNG trong suốt 1080x1920 để ffmpeg overlay lên video.

Veo vẽ chữ tiếng Việt có dấu sai, nên chữ do web vẽ: đủ dấu, đúng font, đúng màu thương hiệu.
Đọc JSON từ stdin: {"font": "...", "items": [{"text", "out", "position": "top|middle|bottom", "style": "brand|dark|light"}]}
"""
import json
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1080, 1920
MAX_W = 900          # bề rộng tối đa của dòng chữ
PAD_X, PAD_Y = 44, 26
RADIUS = 34
LINE_GAP = 10
# Vị trí tâm khung chữ theo chiều dọc — tránh 10% trên (thanh trạng thái) và 22% dưới (nút/caption của Reels).
POS_Y = {"top": 0.17, "middle": 0.5, "bottom": 0.70}

STYLES = {
    # gradient tím → xanh như giao diện Ads AI Studio
    "brand": {"grad": ((124, 92, 255), (59, 155, 246)), "fg": (255, 255, 255), "alpha": 240},
    "dark": {"fill": (20, 26, 51), "fg": (255, 255, 255), "alpha": 205},
    "light": {"fill": (255, 255, 255), "fg": (20, 26, 51), "alpha": 235},
}


# Noto Sans thiếu một số ký hiệu (ra ô vuông) → thay bằng ký tự font có.
SUBST = {"→": "»", "➜": "»", "➡": "»", "←": "«", "✓": "", "✔": "", "✅": "", "★": "•", "⭐": "•"}


def clean(text):
    for k, v in SUBST.items():
        text = text.replace(k, v)
    return " ".join(text.split())


def balanced(draw, text, font):
    """Chia 2 dòng đều nhau thay vì dồn hết lên dòng 1 (tránh một chữ lẻ loi ở dòng 2)."""
    words = text.split()
    best = None
    for k in range(1, len(words)):
        a, b = " ".join(words[:k]), " ".join(words[k:])
        w = max(draw.textlength(a, font=font), draw.textlength(b, font=font))
        if best is None or w < best[0]:
            best = (w, [a, b])
    return best[1] if best else [text]


def wrap(draw, text, font):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= MAX_W - 2 * PAD_X or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) == 2:
        two = balanced(draw, text, font)
        if max(draw.textlength(l, font=font) for l in two) <= MAX_W - 2 * PAD_X:
            return two
    return lines


def render(item, font_path):
    text = clean(unicodedata.normalize("NFC", str(item["text"]).strip()))
    style = STYLES.get(item.get("style") or "brand", STYLES["brand"])
    size = 74 if len(text) <= 24 else 62 if len(text) <= 48 else 54
    font = ImageFont.truetype(font_path, size)

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    lines = wrap(draw, text, font)
    asc, desc = font.getmetrics()
    line_h = asc + desc
    text_w = max(draw.textlength(l, font=font) for l in lines)
    box_w = int(text_w + 2 * PAD_X)
    box_h = int(len(lines) * line_h + (len(lines) - 1) * LINE_GAP + 2 * PAD_Y)
    cx = W // 2
    cy = int(H * POS_Y.get(item.get("position") or "top", POS_Y["top"]))
    x0, y0 = cx - box_w // 2, cy - box_h // 2
    x1, y1 = x0 + box_w, y0 + box_h

    # Bóng mềm dưới khung.
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 12, x1, y1 + 12), RADIUS, fill=(10, 12, 30, 110))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(18)))

    # Khung: gradient hoặc màu đặc.
    box = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    if "grad" in style:
        (r0, g0, b0), (r1, g1, b1) = style["grad"]
        grad = Image.new("RGBA", (box_w, 1))
        for x in range(box_w):
            t = x / max(1, box_w - 1)
            grad.putpixel((x, 0), (int(r0 + (r1 - r0) * t), int(g0 + (g1 - g0) * t), int(b0 + (b1 - b0) * t), style["alpha"]))
        box = grad.resize((box_w, box_h))
    else:
        box = Image.new("RGBA", (box_w, box_h), (*style["fill"], style["alpha"]))
    mask = Image.new("L", (box_w, box_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, box_w - 1, box_h - 1), RADIUS, fill=255)
    img.paste(box, (x0, y0), mask)

    draw = ImageDraw.Draw(img)
    y = y0 + PAD_Y
    for l in lines:
        lw = draw.textlength(l, font=font)
        draw.text((cx - lw / 2, y), l, font=font, fill=(*style["fg"], 255))
        y += line_h + LINE_GAP
    img.save(item["out"])


def main():
    spec = json.load(sys.stdin)
    for item in spec["items"]:
        render(item, spec["font"])
    print(json.dumps({"ok": True, "count": len(spec["items"])}))


if __name__ == "__main__":
    main()
