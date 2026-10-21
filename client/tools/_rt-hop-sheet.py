"""
把一次跳跃的连续帧拼成条带图，用来判断"动作像不像"，而不是"位置有没有变"。

上一版只拼了 4 个稀疏时刻，四张图里宠物姿势全一样 —— 那种图只能证明位移，
证明不了步态。这个版本每 33ms 一帧，能直接看到：蹲下蓄力 → 蹬出拉长 → 落回。
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..")
SHOTS = os.path.join(ROOT, "shots")

# (帧号, 时间ms, x, sy) —— 与 _rt-frames.js 输出一致
F = [
    (0, 0, 160.0, 1.000), (1, 33, 164.2, 0.941), (2, 66, 168.3, 0.982),
    (3, 99, 172.5, 1.019), (4, 132, 176.7, 1.039), (5, 165, 180.9, 1.049),
    (6, 198, 185.0, 1.053), (7, 231, 189.2, 1.051), (8, 264, 193.4, 1.046),
    (9, 297, 197.6, 1.035), (10, 330, 201.7, 1.000), (11, 363, 205.7, 0.947),
]

CROP = (120, 428, 270, 578)   # 固定裁切，不跟随宠物
SCALE = 2.4
COLS = 4

def main():
    tiles = []
    for idx, t, x, sy in F:
        p = os.path.join(SHOTS, f"rt-hop{idx}.png")
        im = Image.open(p).convert("RGB").crop(CROP)
        im = im.resize((int(im.width * SCALE), int(im.height * SCALE)), Image.LANCZOS)
        tiles.append((im, t, x, sy))

    tw, th = tiles[0][0].width, tiles[0][0].height
    pad, label_h = 8, 30
    rows = (len(tiles) + COLS - 1) // COLS
    W = COLS * (tw + pad) + pad
    H = rows * (th + label_h + pad) + pad

    out = Image.new("RGB", (W, H), (26, 22, 20))
    d = ImageDraw.Draw(out)

    for i, (im, t, x, sy) in enumerate(tiles):
        cx = pad + (i % COLS) * (tw + pad)
        cy = pad + (i // COLS) * (th + label_h + pad)
        out.paste(im, (cx, cy + label_h))
        # 方框标出这一格
        d.rectangle([cx - 1, cy + label_h - 1, cx + tw, cy + label_h + th], outline=(70, 58, 50))
        d.text((cx + 2, cy + 8), f"{t:>3}ms  sy{sy*100:>3.0f}%  x{x:.0f}", fill=(255, 214, 160))

    dst = os.path.join(SHOTS, "rt-hop.png")
    out.save(dst)
    print("saved", dst, out.size)

if __name__ == "__main__":
    main()
