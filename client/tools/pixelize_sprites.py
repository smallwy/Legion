"""
把 AI 厚涂稿降成「真像素」占位精灵（量化色板 + 硬边 + 1px 深色描边）。

为什么必须这么做（2026-10-20 实测）：
  原图 224~256px、16,000~25,000 种颜色、53~82KB/张，
  而游戏内只显示 40~56px → 引擎 baseScale ≈ 0.19，
  等于把厚涂稿缩到 1/5 再线性采样 = 糊 + 重，不符合美术指引 §1「16-32px 整数倍放大」。

本脚本输出：工作分辨率 24/24/24/28 px、≤14 色、硬 alpha、1px #2D2438 描边。
显示尺寸 = 工作分辨率 × 2（整数倍），由 BattleConfig 的 displaySize 保证。

用法：
    python pixelize_sprites.py
"""

from __future__ import annotations

import os
import shutil
from PIL import Image, ImageEnhance, ImageDraw, ImageFilter

ART_DIR = "D:/Legion/client/assets/resources/art"
ARCHIVE_DIR = "D:/Legion/client/art-source/256px"
PREVIEW_PATH = "D:/Legion/client/docs/pixel-preview.png"

# 目标「工作分辨率」宽度（像素）。高度按原始宽高比推导。
# 显示尺寸 = 这些值 × 2，对应 BattleConfig 的 48/48/48/56。
TARGETS = {
    "pet": 24,
    "enemy-walker": 24,
    "enemy-flyer": 24,
    "enemy-tank": 28,
}

PALETTE_COLORS = 14                      # 每张 ≤14 色（真像素通常 8-24）
OUTLINE = (45, 36, 56, 255)              # #2D2438（美术指引 §2.4 深底 / §3 描边）
ALPHA_CUTOFF = 80                        # 硬 alpha 阈值：去掉抗锯齿软边


def crop_to_content(im: Image.Image) -> Image.Image:
    a = im.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    bbox = a.getbbox()
    return im.crop(bbox) if bbox else im


def downscale_premultiplied(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """先预乘 alpha 再缩放：否则边缘半透明像素会被当成深色，产生黑边。"""
    pre = im.convert("RGBa")             # RGBa = 预乘 alpha
    pre = pre.resize(size, Image.BOX)    # BOX = 面积平均，降采样最干净
    return pre.convert("RGBA")


def hard_alpha(im: Image.Image, cutoff: int) -> Image.Image:
    r, g, b, a = im.split()
    a = a.point(lambda v: 255 if v >= cutoff else 0)
    return Image.merge("RGBA", (r, g, b, a))


def despeckle(a: Image.Image, min_neighbors: int = 2, fill_holes: int = 6) -> Image.Image:
    """去掉孤立像素（细腿被阈值切碎后的浮点），再补掉内部 1px 空洞。"""
    w, h = a.size
    src = a.load()
    tmp = [[0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if src[x, y] == 0:
                continue
            n = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and src[nx, ny] > 0:
                        n += 1
            if n >= min_neighbors:
                tmp[y][x] = 255

    out = [[0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if tmp[y][x] > 0:
                out[y][x] = 255
                continue
            n = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and tmp[ny][nx] > 0:
                        n += 1
            if n >= fill_holes:
                out[y][x] = 255

    res = Image.new("L", (w, h))
    res.putdata([v for row in out for v in row])
    return res


def boost(im: Image.Image) -> Image.Image:
    """降采样会让颜色发灰，先提饱和/对比，量化后才有像素画的高饱和感。"""
    rgb = ImageEnhance.Color(im.convert("RGB")).enhance(1.35)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.12)
    out = rgb.convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out


def quantize(im: Image.Image, n: int) -> Image.Image:
    """量化到 n 色。透明区先填主体均色，防止黑色吃掉一个色板位。"""
    r, g, b, a = im.split()
    opaque = [px for px in im.getdata() if px[3] > 0]
    if not opaque:
        return im
    avg = tuple(sum(c[i] for c in opaque) // len(opaque) for i in range(3))

    flat = Image.new("RGB", im.size, avg)
    flat.paste(im.convert("RGB"), (0, 0), a)
    p = flat.convert("P", palette=Image.ADAPTIVE, colors=n, dither=Image.Dither.NONE)
    out = p.convert("RGBA")
    out.putalpha(a)
    return out


def _subtract_alpha(dilated: Image.Image, a: Image.Image) -> Image.Image:
    d = list(dilated.getdata())
    o = list(a.getdata())
    return Image.frombytes("L", dilated.size, bytes(255 if dv > 0 and ov == 0 else 0 for dv, ov in zip(d, o)))


def add_outline(body: Image.Image, canvas_size: tuple[int, int]) -> Image.Image:
    """1px 深色描边：alpha 膨胀一圈取环带涂色，再把身体盖回去。"""
    w, h = canvas_size
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(body, (1, 1))

    a = canvas.getchannel("A")
    dilated = a.filter(ImageFilter.MaxFilter(3))
    ring = _subtract_alpha(dilated, a)

    canvas.paste(Image.new("RGBA", (w, h), OUTLINE), (0, 0), ring)
    canvas.alpha_composite(body, (1, 1))
    return canvas


def process(name: str, target_w: int) -> dict:
    # 始终从归档的原始 256px 稿读入：脚本可重复运行，不会二次降采样
    src = os.path.join(ARCHIVE_DIR, name + ".png")
    im = Image.open(src).convert("RGBA")
    orig_size, orig_kb = im.size, os.path.getsize(src) / 1024
    orig_colors = len(im.getcolors(maxcolors=1 << 24) or [])

    body = crop_to_content(im)
    inner_w = max(1, target_w - 2)
    inner_h = max(1, round(inner_w * body.height / body.width))

    small = downscale_premultiplied(body, (inner_w, inner_h))
    small = hard_alpha(small, ALPHA_CUTOFF)
    small.putalpha(despeckle(small.getchannel("A")))
    small = boost(small)
    small = quantize(small, PALETTE_COLORS)

    out = add_outline(small, (target_w, inner_h + 2))

    dst = os.path.join(ART_DIR, name + ".png")
    out.save(dst, "PNG", optimize=True)

    return {
        "name": name,
        "orig_size": orig_size,
        "orig_kb": orig_kb,
        "orig_colors": orig_colors,
        "new_size": out.size,
        "new_kb": os.path.getsize(dst) / 1024,
        "new_colors": len(out.getcolors(maxcolors=1 << 24) or []),
    }


def checker(size: tuple[int, int]) -> Image.Image:
    c = Image.new("RGB", size, (232, 230, 226))
    d = ImageDraw.Draw(c)
    step = 10
    for y in range(0, size[1], step):
        for x in range(0, size[0], step):
            if ((x // step) + (y // step)) % 2 == 0:
                d.rectangle([x, y, x + step - 1, y + step - 1], fill=(211, 208, 202))
    return c


def build_preview(rows: list[dict]) -> None:
    """上下对比图：原图 vs 像素版（NEAREST 放大，肉眼可辨颗粒）。"""
    cell_w, cell_h = 260, 260
    pad, header = 16, 46
    cols = len(rows)
    W = pad + cols * (cell_w + pad)
    H = header + 2 * (cell_h + pad) + pad
    sheet = Image.new("RGB", (W, H), (246, 244, 239))
    draw = ImageDraw.Draw(sheet)

    draw.text((pad, 8), "BEFORE - AI thick-paint, 224-256px, 16k-25k colors", fill=(60, 55, 70))
    for i, r in enumerate(rows):
        x = pad + i * (cell_w + pad)
        orig = Image.open(os.path.join(ARCHIVE_DIR, r["name"] + ".png")).convert("RGBA")
        orig.thumbnail((cell_w - 20, cell_h - 20), Image.LANCZOS)
        bg = checker((cell_w, cell_h))
        bg.paste(orig, ((cell_w - orig.width) // 2, (cell_h - orig.height) // 2), orig)
        sheet.paste(bg, (x, header))

    y2 = header + cell_h + pad + 26
    draw.text((pad, y2 - 20),
              "AFTER - pixel art, 24/24/24/28px, <=14 colors, 1px outline, shown x8",
              fill=(60, 55, 70))
    for i, r in enumerate(rows):
        x = pad + i * (cell_w + pad)
        small = Image.open(os.path.join(ART_DIR, r["name"] + ".png")).convert("RGBA")
        factor = max(1, min((cell_w - 40) // small.width, (cell_h - 40) // small.height))
        big = small.resize((small.width * factor, small.height * factor), Image.NEAREST)
        bg = checker((cell_w, cell_h))
        bg.paste(big, ((cell_w - big.width) // 2, (cell_h - big.height) // 2), big)
        sheet.paste(bg, (x, y2))

    os.makedirs(os.path.dirname(PREVIEW_PATH), exist_ok=True)
    sheet.save(PREVIEW_PATH, "PNG", optimize=True)


def main() -> None:
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    for name in TARGETS:
        src = os.path.join(ART_DIR, name + ".png")
        arc = os.path.join(ARCHIVE_DIR, name + ".png")
        if os.path.exists(src) and not os.path.exists(arc):
            shutil.copy2(src, arc)
            print(f"[archive] {name}.png -> art-source/256px/")

    rows = [process(name, w) for name, w in TARGETS.items()]

    print("\n{:<18}{:>12}{:>11}{:>13}{:>11}{:>15}".format(
        "sprite", "before", "KB", "colors", "after", "colors/KB"))
    for r in rows:
        print("{:<18}{:>12}{:>11.1f}{:>13,}{:>11}{:>15}".format(
            r["name"],
            f'{r["orig_size"][0]}x{r["orig_size"][1]}', r["orig_kb"], r["orig_colors"],
            f'{r["new_size"][0]}x{r["new_size"][1]}',
            f'{r["new_colors"]} / {r["new_kb"]:.1f}'))

    tb, ta = sum(r["orig_kb"] for r in rows), sum(r["new_kb"] for r in rows)
    print(f"\n文件体积: {tb:.1f} KB -> {ta:.1f} KB (-{(1 - ta / tb) * 100:.1f}%)")
    print(f"VRAM: {sum(r['orig_size'][0] * r['orig_size'][1] for r in rows) * 4 / 1024:.0f} KB"
          f" -> {sum(r['new_size'][0] * r['new_size'][1] for r in rows) * 4 / 1024:.0f} KB")

    build_preview(rows)
    print(f"\n对比图: {PREVIEW_PATH}")


if __name__ == "__main__":
    main()
