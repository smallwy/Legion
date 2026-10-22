# -*- coding: utf-8 -*-
"""在 bg.png 里量出路标木牌（三块板）的精确像素框。

为什么要脚本量而不是肉眼看截图：
  截图给人看的时候会被等比缩放，我从缩放后的图上读坐标，误差能有 10~20px；
  而"任务"两个字要落在木牌上，差 10px 就是压到牌子的描边上。
  这里直接读像素，输出的是**图内像素坐标**，1px 就是 1px。

用法：python _measure-planks.py [bg.png]
"""
import io
import sys

from PIL import Image

BG = sys.argv[1] if len(sys.argv) > 1 else 'assets/ui/home/bg.png'
im = Image.open(BG).convert('RGB')
W, H = im.size
px = im.load()

# 木牌配色：暖橙棕，R 明显高、B 明显低；天空是粉白（三通道都高）
def is_wood(c):
    r, g, b = c
    return r > 130 and (r - b) > 55 and (g - b) > 25 and not (r > 235 and g > 215)


X0, X1 = 140, 340
rows = []
for y in range(150, 360):
    run = 0
    best = 0
    for x in range(X0, X1):
        if is_wood(px[x, y]):
            run += 1
            best = max(best, run)
        else:
            run = 0
    rows.append((y, best))

# 连续 >=40 宽的段视为"一条板"
segs = []
cur = None
for y, best in rows:
    if best >= 40:
        if cur is None:
            cur = [y, y, best]
        else:
            cur[1] = y
            cur[2] = max(cur[2], best)
    else:
        if cur:
            segs.append(cur)
            cur = None
if cur:
    segs.append(cur)

print('BG =', BG, im.size)
print('木牌横带（图内 y 范围 / 最大连续宽）：')
for a, b, w in segs:
    if b - a < 8:
        continue
    # 该带中间那一行的左右边界
    ym = (a + b) // 2
    xs = [x for x in range(X0, X1) if is_wood(px[x, ym])]
    print('  y %3d..%-3d  h=%-3d  x %3d..%-3d  w=%3d  中线 y=%d'
          % (a, b, b - a + 1, min(xs), max(xs), max(xs) - min(xs) + 1, ym))
