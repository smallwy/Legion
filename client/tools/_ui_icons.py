# -*- coding: utf-8 -*-
"""交互热点图标：块面版（供 _ui-mock.py 合成效果图用）。

为什么不用原图裁片：现有 5 个图标是细线稿（29px / 线宽 2.75px），
放大到 34px 直接糊成一团；而且"细线 + 机械几何"是字库图标的语言，
和手绘场景冲突。这一版全部改成**单色块面 + 左上单侧高光**。

画布 68×68（= 显示 34 的 2 倍），图形占 61%，居中。
"""
from PIL import Image, ImageDraw

INK = (138, 90, 50, 255)
INK_D = (110, 70, 44, 255)
HI = (255, 244, 226, 120)


def _canvas(n=68):
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def bench(n=68):
    """工作台：锤子 —— 横头 + 竖柄，柄尾收窄。"""
    im, d = _canvas(n)
    d.rounded_rectangle([13, 17, 55, 31], radius=4, fill=INK)
    d.rounded_rectangle([28, 29, 40, 57], radius=4, fill=INK)
    d.rounded_rectangle([15, 19, 43, 23], radius=2, fill=HI)
    return im


def codex(n=68):
    """图鉴：摊开的书 —— 中央书脊凹口 + 两侧页边外扩。"""
    im, d = _canvas(n)
    d.polygon([(12, 24), (32, 18), (32, 52), (12, 57)], fill=INK)
    d.polygon([(56, 24), (36, 18), (36, 52), (56, 57)], fill=INK)
    d.rounded_rectangle([31, 16, 37, 54], radius=3, fill=INK_D)
    d.polygon([(14, 26), (30, 21), (30, 24), (14, 29)], fill=HI)
    return im


def stove(n=68):
    """灶台：带盖的锅 —— 宽锅身 + 顶部提环 + 左右锅耳。"""
    im, d = _canvas(n)
    d.rounded_rectangle([13, 27, 55, 33], radius=3, fill=INK)          # 锅沿
    d.rounded_rectangle([16, 31, 52, 53], radius=12, fill=INK)         # 锅身
    d.ellipse([26, 13, 42, 27], fill=INK_D)                           # 提环
    d.ellipse([30, 17, 38, 24], fill=(0, 0, 0, 0))                     # 环孔
    d.rounded_rectangle([18, 33, 50, 37], radius=3, fill=HI)
    return im


def send(n=68):
    """派遣：信封 —— 矩形 + 上部 V 形折口。"""
    im, d = _canvas(n)
    d.rounded_rectangle([12, 20, 56, 50], radius=5, fill=INK)
    d.polygon([(12, 20), (34, 39), (56, 20), (56, 26), (34, 45), (12, 26)], fill=INK_D)
    d.rounded_rectangle([14, 22, 54, 25], radius=2, fill=HI)
    return im


def footprint(n=68):
    """去苔原：脚印 —— 脚掌 + 三趾，朝向一致。"""
    im, d = _canvas(n)
    d.ellipse([21, 27, 47, 55], fill=INK)
    d.ellipse([21, 14, 30, 25], fill=INK)     # 左趾
    d.ellipse([30, 11, 40, 23], fill=INK)     # 中趾
    d.ellipse([38, 15, 47, 26], fill=INK)     # 右趾
    d.ellipse([23, 29, 38, 36], fill=HI)
    return im


ICONS = {
    "工作台": bench,
    "图鉴": codex,
    "灶台": stove,
    "派遣": send,
    "去苔原": footprint,
}


def get(name, display=34):
    return ICONS[name]().resize((display, display), Image.LANCZOS)
