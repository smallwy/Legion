# -*- coding: utf-8 -*-
"""
_bg-sheet.py —— 战斗背景改版的评审图

一张竖版三段图：概念图 / 改前 / 改后。评审时最有说服力的不是成品单独一张，
而是"目标长什么样、原来是什么样、现在到哪了"放在同一张纸上。

    python client/tools/_bg-sheet.py
    → ../shots/_bg-review.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(os.path.dirname(HERE), 'shots')

W, H = 960, 600
GAP = 26
LBL = 30          # 每条标签占的高度

# PIL 的默认字体没有中文字形，直接用会渲染成一排方框。
FONT = 'C:/Windows/Fonts/msyh.ttc'


def label(im, text, sub=''):
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, 17)
    fs = ImageFont.truetype(FONT, 13)
    d.rectangle([0, 0, im.size[0], LBL], fill=(22, 26, 24))
    d.text((14, 6), text, font=f, fill=(255, 236, 200))
    if sub:
        d.text((im.size[0] - 14 - d.textlength(sub, font=fs), 10), sub, font=fs, fill=(150, 170, 158))
    return im


def load(name):
    p = os.path.join(SHOTS, name)
    return Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS)


rows = [
    ('2D_横版游戏战斗场景的背景概念图_纯场景___没有任何角色_2026-10-22T02-53-45.png',
     '参考概念图（新出）', '目标：五个景深层 + 暖金色雾'),
    ('_old-ss3.png', '改前 · 第 4 关「缓坡」', '天空→一排等距小树→一块纯色草地'),
    ('_bg-s3.png', '改后 · 第 4 关「缓坡」', '草脊 / 两排树 / 薄栈道 + 短支腿'),
]

sheet = Image.new('RGB', (W, (H + LBL) * len(rows) + GAP * (len(rows) - 1)), (12, 16, 14))
y = 0
for name, t, sub in rows:
    sheet.paste(label(load(name), t, sub), (0, y))
    y += H + LBL + GAP

out = os.path.join(SHOTS, '_bg-review.png')
sheet.save(out)
print('  ' + out)
