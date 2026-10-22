# -*- coding: utf-8 -*-
"""改前 / 改后 上下并排对比图。

跑法（在 client/ 下）：
  python tools/_ui-diff.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

CLIENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FB = "C:/Windows/Fonts/msyhbd.ttc"
FR = "C:/Windows/Fonts/msyh.ttc"

BAR = 46
W, H = 1280, 720

before = Image.open(os.path.join(CLIENT, "shots/17-主界面-运行时改后.png")).convert("RGB")
after = Image.open(os.path.join(CLIENT, "shots/_home-rt.png")).convert("RGB")

out = Image.new("RGB", (W, (BAR + H) * 2 + 16), (30, 24, 20))
d = ImageDraw.Draw(out)

f_b = ImageFont.truetype(FB, 22)
f_s = ImageFont.truetype(FR, 17)

titles = [
    ("改前", "圆徽 47×48 · 描边 2.75px ｜ 名字板描边 0.75px · 字号 11 / 行高 11 ｜ 牌面纯色 #FFFCF4",
     (196, 140, 120)),
    ("改后 C", "方牌 48×48 · 描边 3px 一致 ｜ 名字板保留椭圆，52/40×24 · 字号 12 / 行高 16 ｜ 暖奶油渐变 + 顶高光 + 底内阴影",
     (150, 208, 150)),
]

for i, (img, (tag, note, col)) in enumerate(zip([before, after], titles)):
    top = i * (BAR + H + 8)
    d.rectangle([0, top, W, top + BAR], fill=(44, 35, 28))
    d.text((20, top + 11), tag, font=f_b, fill=col)
    d.text((96, top + 14), note, font=f_s, fill=(196, 186, 174))
    out.paste(img, (0, top + BAR))

# 中间分隔线
mid = BAR + H + 2
d.rectangle([0, mid, W, mid + 4], fill=(20, 16, 13))

p = os.path.join(CLIENT, "shots/ui-bench/23-改前改后对比.png")
out.save(p, quality=95)
print("✓", os.path.relpath(p, CLIENT), out.size)
