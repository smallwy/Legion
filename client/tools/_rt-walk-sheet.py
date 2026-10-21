"""
把四帧里宠物所在的区域裁出来放大并排，用来确认「砂糖真的走了」。

裁剪区固定（不是自动跟随宠物），这样四张图里宠物的水平位移是直接可比的 ——
自动跟随裁切会让每张图宠物都在正中，看起来像没动。
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
SHOTS = os.path.join(ROOT, "shots")

FRAMES = [("t00", "t = 0.0s", 160.0), ("t04", "t = 4.0s", 121.0),
          ("t09", "t = 9.0s", 263.9), ("t15", "t = 15.0s", 150.5)]

# 砂糖在设计坐标 120~392、脚底 y=548 一带活动，固定裁这块
CROP = (60, 380, 470, 600)
SCALE = 1.35

def main():
    tiles = []
    for name, label, x in FRAMES:
        p = os.path.join(SHOTS, f"rt-{name}.png")
        im = Image.open(p).convert("RGB")
        c = im.crop(CROP)
        c = c.resize((int(c.width * SCALE), int(c.height * SCALE)), Image.LANCZOS)
        tiles.append((c, label, x))

    w = tiles[0][0].width
    h = tiles[0][0].height
    pad = 10
    label_h = 34
    total_h = len(tiles) * (h + label_h + pad) + pad
    out = Image.new("RGB", (w + pad * 2, total_h), (28, 24, 22))
    d = ImageDraw.Draw(out)

    y = pad
    for im, label, x in tiles:
        out.paste(im, (pad, y + label_h))
        d.text((pad + 8, y + 8), f"{label}    sugar x = {x:.1f}  (design coords)", fill=(255, 226, 180))
        y += label_h + h + pad

    dst = os.path.join(SHOTS, "rt-walk.png")
    out.save(dst)
    print("saved", dst, out.size)

if __name__ == "__main__":
    main()
