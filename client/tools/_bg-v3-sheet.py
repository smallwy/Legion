# -*- coding: utf-8 -*-
"""推球战斗场景 v3 评审图：
   1. 改前 / 改后 全屏（第 1 关）
   2. 右端出口 + 左端开口 特写对比
   3. 第 4 关（暖橙主题）验证换色不崩
"""
from PIL import Image, ImageDraw, ImageFont

FONT = 'C:/Windows/Fonts/msyh.ttc'


def f(sz):
    return ImageFont.truetype(FONT, sz)


def tag(d, xy, text, size=17):
    d.text(xy, text, font=f(size), fill=(255, 244, 228),
           stroke_width=3, stroke_fill=(20, 16, 18))


old0 = Image.open('shots/olds0.png').convert('RGB')
new0 = Image.open('shots/_bg-s0.png').convert('RGB')
new3 = Image.open('shots/_bg-s3.png').convert('RGB')
W, H = new0.size

PAD, GAP, HEAD = 24, 14, 40

# ---------- 图 1：全屏对比 ----------
sh = Image.new('RGB', (PAD * 2 + W, HEAD * 2 + H * 2 + GAP + PAD), (28, 24, 28))
d = ImageDraw.Draw(sh)
d.text((PAD, 10), '推球战斗场景 v3 · 第 1 关 苔原入口', font=f(22), fill=(255, 240, 220))
d.text((PAD, HEAD + 8), '改前', font=f(18), fill=(180, 168, 160))
sh.paste(old0, (PAD, HEAD + 34))
y2 = HEAD + 34 + H + GAP
d.text((PAD, y2), '改后', font=f(18), fill=(255, 214, 130))
sh.paste(new0, (PAD, y2 + 26))
sh.save('shots/bg-v3-1-full.png')

# ---------- 图 2：两端的特写 ----------
CW, CH = 380, 380


def crop(im, box):
    return im.crop(box).resize((CW, CH), Image.LANCZOS)


pairs = [
    ('右端出口：正对镜头的拱门 → 朝左的空心圆木', (800, 400, 960, 600)),
    ('左端：通高的实心墙 → 树干下留出的开口', (0, 380, 160, 580)),
]
sh2 = Image.new('RGB', (PAD * 2 + CW * 2 + GAP * 3, HEAD + sum(CH + 62 for _ in pairs) + PAD),
                (28, 24, 28))
d2 = ImageDraw.Draw(sh2)
d2.text((PAD, 10), '两端的改动（左：改前　右：改后）', font=f(22), fill=(255, 240, 220))
yy = HEAD + 4
for title, box in pairs:
    d2.text((PAD, yy), title, font=f(17), fill=(200, 190, 180))
    sh2.paste(crop(old0, box), (PAD, yy + 26))
    sh2.paste(crop(new0, box), (PAD + CW + GAP, yy + 26))
    yy += CH + 62
sh2.save('shots/bg-v3-2-ends.png')

# ---------- 图 3：换色验证 ----------
sh3 = Image.new('RGB', (PAD * 2 + W, HEAD + H + PAD), (28, 24, 28))
d3 = ImageDraw.Draw(sh3)
d3.text((PAD, 10), '第 4 关 缓坡 · 暖橙主题（同一套画法换色）', font=f(22), fill=(255, 240, 220))
sh3.paste(new3, (PAD, HEAD + 4))
sh3.save('shots/bg-v3-3-stage4.png')

print('ok')
