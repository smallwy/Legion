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
    """工作台：锤子 —— 斜置 24°，锤头 + 长柄。

    上一版是"头宽 42 / 柄长 28"的正交 T 字，剪影就是一个字母 T。
    锤子的辨识特征在**比例**：柄长 ≈ 头长的 2.5 倍以上，且整体斜置。
    所以放大画布画完再旋转 —— 直接手算斜 polygon 的坐标只会画出歪方块。
    """
    k = 3
    S = n * k
    big = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    c = S // 2
    sc = S / 68.0

    def R(x0, y0, x1, y1, r, fill):
        ox = oy = c - 34 * sc
        d.rounded_rectangle([ox + x0 * sc, oy + y0 * sc, ox + x1 * sc, oy + y1 * sc],
                            radius=max(1, int(r * sc)), fill=fill)

    R(10, 15, 44, 26, 5, INK)          # 锤头（横向长块）
    R(12, 17, 42, 20, 2, HI)           # 头顶高光
    R(14, 26, 30, 33, 4, INK)          # 锤颈（把头压在一侧，制造"偏心"）
    R(19, 30, 30, 60, 5, INK)          # 长柄
    R(21, 32, 27, 44, 3, HI)           # 柄高光

    big = big.rotate(-24, resample=Image.BICUBIC, center=(c, c))
    return big.crop((c - n // 2, c - n // 2, c + n // 2, c + n // 2))


def codex(n=68):
    """图鉴：摊开的书 —— 中央书脊凹口 + 两侧页边外扩。"""
    im, d = _canvas(n)
    d.polygon([(12, 24), (32, 18), (32, 52), (12, 57)], fill=INK)
    d.polygon([(56, 24), (36, 18), (36, 52), (56, 57)], fill=INK)
    d.rounded_rectangle([31, 16, 37, 54], radius=3, fill=INK_D)
    d.polygon([(14, 26), (30, 21), (30, 24), (14, 29)], fill=HI)
    return im


def stove(n=68):
    """灶台：带盖的锅 —— 宽锅身 + 比锅身更宽的锅沿 + 中央盖钮。

    上一版顶上一个直径 16 的空心"提环"，在 29px 下只剩一个圆点，
    读作"锅盖上插了个把手"。锅的辨识特征是**锅沿比锅身宽**这一圈，
    盖钮只要一个实心小球就够。
    """
    im, d = _canvas(n)
    d.rounded_rectangle([12, 29, 56, 55], radius=14, fill=INK)         # 锅身
    d.rounded_rectangle([9, 24, 59, 33], radius=4, fill=INK_D)         # 锅沿（更宽）
    d.ellipse([30, 12, 38, 22], fill=INK_D)                           # 盖钮
    d.rounded_rectangle([17, 35, 51, 40], radius=3, fill=HI)           # 身高光
    return im


def send(n=68):
    """派遣：信封 —— 矩形 + 上部 V 形折口。"""
    im, d = _canvas(n)
    d.rounded_rectangle([12, 20, 56, 50], radius=5, fill=INK)
    d.polygon([(12, 20), (34, 39), (56, 20), (56, 26), (34, 45), (12, 26)], fill=INK_D)
    d.rounded_rectangle([14, 22, 54, 25], radius=2, fill=HI)
    return im


def footprint(n=68):
    """去苔原：脚印 —— 脚掌 + 三趾，朝右上。

    上一版掌 26×28、趾 9~10px 紧贴掌顶，缩到 29px 后三趾黏成一坨，
    读作"一颗豆子"。脚印的辨识特征是**趾与掌之间的空隙**，
    所以趾要小、要分开、要和掌留 3px 以上的缝。
    """
    im, d = _canvas(n)
    d.ellipse([22, 30, 48, 58], fill=INK)       # 掌
    d.ellipse([20, 15, 28, 25], fill=INK)       # 左趾
    d.ellipse([31, 10, 40, 21], fill=INK)       # 中趾（最高）
    d.ellipse([41, 16, 49, 26], fill=INK)       # 右趾
    d.ellipse([24, 32, 38, 40], fill=HI)
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
