# -*- coding: utf-8 -*-
"""生成 v4 评审图：两端去掉装置 + 火焰动画。

三张：
  bg-v4-1-full.png     全屏 改前 / 改后
  bg-v4-2-ends.png     左端 / 右端特写（旧版有树干和圆筒，新版什么都没有）
  fire-seq.png         火焰 8 连拍（由 _fire-seq.js 出帧，这里只负责拼）
"""
from PIL import Image, ImageDraw, ImageFont

FONT = 'C:/Windows/Fonts/msyh.ttc'
def f(sz):
    return ImageFont.truetype(FONT, sz)

W, H = 960, 600
PAD, GAP, HEAD = 26, 16, 44
BG = (28, 24, 26)
INK = (238, 230, 222)
DIM = (176, 168, 160)


def tag(d, xy, text, anchor="la"):
    d.text(xy, text, font=f(15), fill=(255, 226, 150), anchor=anchor)


def box(d, xy, text, anchor="la"):
    """半透明底 + 文字，压在图上看不清的地方也能读。"""
    bbox = d.textbbox(xy, text, font=f(15), anchor=anchor)
    d.rectangle((bbox[0] - 5, bbox[1] - 3, bbox[2] + 5, bbox[3] + 3), fill=(20, 18, 20))
    d.text(xy, text, font=f(15), fill=(255, 226, 150), anchor=anchor)


old = Image.open("shots/olds0.png").convert("RGB")
new = Image.open("shots/_bg-s0.png").convert("RGB")

# ============ 图 1：全屏改前 / 改后 ============
CAP = 28
sheet = Image.new("RGB", (PAD * 2 + W, HEAD + (H + CAP) * 2 + GAP + PAD), BG)
d = ImageDraw.Draw(sheet)
d.text((PAD, 12), "推球战斗 · 第 1 关", font=f(22), fill=INK)
d.text((PAD + 210, 17), "上：改前    下：改后", font=f(16), fill=DIM)
sheet.paste(old, (PAD, HEAD))
d.text((PAD + 2, HEAD + H + 5),
       "改前：左下角一根封口树干、右下角一个圆筒出口、火坑是一堆静态色块",
       font=f(15), fill=(214, 206, 198))
sheet.paste(new, (PAD, HEAD + H + CAP + GAP))
d.text((PAD + 2, HEAD + H * 2 + CAP + GAP + 5),
       "改后：两端无装置、地面铺出画外、火坑有光晕 + 焰舌 + 火星",
       font=f(15), fill=(214, 206, 198))
sheet.save("shots/bg-v4-1-full.png")

# ============ 图 2：两端特写 ============
CROPS = [
    ("左端（球从这里滚出画面）", (0, 420, 250, 600), (0, 420, 250, 600)),
    ("右端（球滚出去 = 落袋结算）", (700, 400, 960, 600), (700, 400, 960, 600)),
]
CW, CH = 300, 260
rows = len(CROPS)
sheet2 = Image.new("RGB", (PAD * 2 + CW * 2 + GAP * 2, HEAD + rows * (CH + 26) + PAD), BG)
d2 = ImageDraw.Draw(sheet2)
d2.text((PAD, 6), "两端的装置全部去掉", font=f(22), fill=INK)
d2.text((PAD + 24, HEAD - 22), "左：改前（有装置）    右：改后（什么都没有）", font=f(15), fill=DIM)
for i, (name, ro, rn) in enumerate(CROPS):
    y = HEAD + i * (CH + 26)
    cell_o = old.crop(ro)
    cell_n = new.crop(rn)
    sheet2.paste(cell_o.resize((CW, CH), Image.LANCZOS), (PAD, y))
    sheet2.paste(cell_n.resize((CW, CH), Image.LANCZOS), (PAD + CW + GAP, y))
    d2.text((PAD, y + CH + 4), name, font=f(15), fill=DIM)
sheet2.save("shots/bg-v4-2-ends.png")

print("ok")
