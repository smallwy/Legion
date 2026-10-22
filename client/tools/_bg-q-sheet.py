# -*- coding: utf-8 -*-
"""生成评审对比图：全屏改前/改后 + 三处特写（火坑 / 出口门 / 左端封口）。"""
from PIL import Image, ImageDraw, ImageFont

FONT = "C:/Windows/Fonts/msyh.ttc"


def f(size, bold=False):
    return ImageFont.truetype(FONT, size)


def label(d, xy, text, size=19, color=(255, 245, 225)):
    d.text(xy, text, font=f(size), fill=color)


def tag(d, xy, text, size=15):
    """小标签：深底 + 白字，保证任何背景上都读得清"""
    ft = f(size)
    bb = d.textbbox((0, 0), text, font=ft)
    w, h = bb[2] - bb[0] + 16, bb[3] - bb[1] + 10
    d.rounded_rectangle([xy[0], xy[1], xy[0] + w, xy[1] + h], 6, fill=(42, 32, 40))
    d.text((xy[0] + 8, xy[1] + 4), text, font=ft, fill=(255, 235, 200))


new0 = Image.open("shots/_bg-s0.png").convert("RGB")
old0 = Image.open("shots/olds0.png").convert("RGB")
new6 = Image.open("shots/_bg-s6.png").convert("RGB")
old6 = Image.open("shots/olds6.png").convert("RGB")

W, H = 960, 600
PAD, GAP, HEAD = 26, 16, 62

# ============ 图 1：全屏改前 / 改后 ============
sheet = Image.new("RGB", (PAD * 2 + W, HEAD + H * 2 + GAP + PAD + 8), (30, 26, 30))
d = ImageDraw.Draw(sheet)
label(d, (PAD, 10), "推球战斗场景 · 第 1 关（苔原入口）", 22)
d.text((PAD, 38), "上：改前    下：改后", font=f(15), fill=(190, 178, 168))
sheet.paste(old0, (PAD, HEAD + 4))
sheet.paste(new0, (PAD, HEAD + H + GAP + 4))
tag(d, (PAD + 12, HEAD + 12), "改前：营地编筐 / 火坑是细条火苗 / 左端无封口")
tag(d, (PAD + 12, HEAD + H + GAP + 12), "改后：出口门 / Q 版火坑 / 左端大树封口")
sheet.save("shots/bg-q-1-full.png")

# ============ 图 2：三处特写 ============
crops = [
    ("火坑", (470, 470, 650, 600), (470, 470, 650, 600)),
    ("右下角（营地 → 出口门）", (826, 396, 960, 600), (826, 396, 960, 600)),
    ("左端（无封口 → 大树）", (0, 380, 200, 600), (0, 380, 200, 600)),
]

CELL_W, CELL_H = 300, 300
ROWS = len(crops)
sheet2 = Image.new("RGB", (PAD * 2 + CELL_W * 2 + GAP * 2, HEAD + ROWS * (CELL_H + 30) + PAD), (30, 26, 30))
d2 = ImageDraw.Draw(sheet2)
label(d2, (PAD, 10), "三处改动特写", 22)
d2.text((PAD, 38), "左：改前    右：改后", font=f(15), fill=(190, 178, 168))

for i, (title, ob, nb) in enumerate(crops):
    y = HEAD + i * (CELL_H + 30)
    src_o = old0.crop(ob)
    src_n = new0.crop(nb)
    # 等比放进 300×300 的格子
    for j, src in enumerate([src_o, src_n]):
        x = PAD + j * (CELL_W + GAP)
        k = min(CELL_W / src.size[0], CELL_H / src.size[1])
        im = src.resize((int(src.size[0] * k), int(src.size[1] * k)), Image.LANCZOS)
        sheet2.paste(im, (x + (CELL_W - im.size[0]) // 2, y + (CELL_H - im.size[1]) // 2))
    d2.text((PAD, y + CELL_H + 2), title, font=f(16), fill=(226, 212, 196))

sheet2.save("shots/bg-q-2-closeups.png")

# ============ 图 3：第 7 关（有水坑）验证三种坑 ============
sheet3 = Image.new("RGB", (PAD * 2 + W, HEAD + H + PAD), (30, 26, 30))
d3 = ImageDraw.Draw(sheet3)
label(d3, (PAD, 10), "第 7 关（有水塘）· 三种坑同一套 Q 版底盘", 22)
sheet3.paste(new6, (PAD, HEAD))
sheet3.save("shots/bg-q-3-stage7.png")

print("已生成 3 张评审图")
