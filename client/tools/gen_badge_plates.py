# -*- coding: utf-8 -*-
"""生成徽标底板贴图（方牌 + 椭圆名字底板），替换 assets/ui/home/ 下的旧图。

规格（显示尺寸，贴图按 4x 输出）：
  方牌    48×48   圆角 12   描边 3px #684024   渐变 #FFF6E2 → #F2DCB8
  名字板  宽随字   高 24     全圆头           同上渐变

**为什么是贴图而不是 Graphics 程序化**（规格 §4 原来写的是 Graphics，这里改口）：
Cocos 的 Graphics 只能 fillColor 纯色填充，**没有线性渐变 API**。
而"厚度"的第三件套就是竖向渐变 —— 用两层纯色叠会出一条硬边，
比不做还糟。所以 S 件也走贴图。

**落影画在图内、不出界**：出界会撑大 raw 尺寸，而节点 contentSize 是 48，
Simple 模式下整张贴图会被压回 48 —— 落影被吃进牌里，反而变成一圈脏边。
改成"底部内阴影"（往上 6px 渐变到透明），视觉上一样有厚度。

跑法（在 client/ 下）：
  python tools/gen_badge_plates.py
"""
import io
import os

from PIL import Image, ImageChops, ImageDraw

CLIENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(CLIENT, "assets", "ui", "home")

S = 4                      # 4x 输出
LINE = (104, 64, 36)       # #684024
# 渐变跨度按"48px 下还能看出厚度"来定，不是按色卡好看程度。
# 第一版 255,246,226 → 242,220,184 只差 21 个色阶，48px 高度上人眼完全读不到，
# 牌面是一片平的米色。这一版拉开到 40 级，并且把高光提亮。
FACE_TOP = (255, 252, 240)  # #FFFCF0
FACE_BOT = (233, 203, 160)  # #E9CBA0
EDGE = 3 * S               # 描边 3 显示
HI_A = 118                 # 顶部内高光 alpha
SH_A = 46                  # 底部内阴影 alpha


def vgrad(w, h, top, bot):
    g = Image.new("RGB", (1, h))
    for i in range(h):
        t = i / max(1, h - 1)
        g.putpixel((0, i), tuple(int(top[k] + (bot[k] - top[k]) * t) for k in range(3)))
    return g.resize((w, h))


def plate(disp_w, disp_h, radius_disp, out_name, hi_inset=10, hi_h=None):
    """带描边 + 竖向渐变 + 顶部内高光 + 底部内阴影的圆角板。

    out_name 是**显示尺寸**的倍数说明，raw 会乘 S。
    """
    W, H = disp_w * S, disp_h * S
    r = radius_disp * S
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # 外轮廓填描边色
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, W - 1, H - 1], radius=r, fill=255)
    lay.paste(Image.new("RGB", (W, H), LINE), (0, 0), m)

    # 内层填渐变
    # 坑：`lay.paste(face, (0,0), inner)` 会用 inner 当遮罩**整块覆盖**目标，
    # 连 face 里 alpha=0 的部分也一起盖上去 → 牌面被挖空成透明（第一次就这么翻车）。
    # 必须先把 alpha 与 inner 相乘，再 alpha_composite。
    iw, ih = W - EDGE * 2, H - EDGE * 2
    inner = Image.new("L", (W, H), 0)
    ImageDraw.Draw(inner).rounded_rectangle(
        [EDGE, EDGE, W - 1 - EDGE, H - 1 - EDGE], radius=max(1, r - EDGE), fill=255)
    face = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    face.paste(vgrad(iw, ih, FACE_TOP, FACE_BOT).convert("RGBA"), (EDGE, EDGE))
    face.putalpha(ImageChops.multiply(face.getchannel("A"), inner))
    lay.alpha_composite(face)

    # 顶部内高光：贴着上沿的一条横向亮带，**两端渐隐 + 往下渐隐**
    #
    # 上一版画成一个圆角矩形 + 椭圆软边，结果是牌面正上方一块椭圆亮斑，
    # 读作"牌上倒了一摊牛奶"。真实的手绘高光是沿边缘的一条带子，
    # 强度沿长度方向两端收、沿厚度方向往下收。
    hh = hi_h if hi_h is not None else max(8, disp_h // 4)
    hw = disp_w - 2 * (hi_inset + 2)
    gw, gh = 64, 16
    g = Image.new("L", (gw, gh), 0)
    for yy in range(gh):
        ty = (1 - yy / (gh - 1)) ** 1.5          # 往下渐隐
        for xx in range(gw):
            tx = min(1.0, xx / (gw * 0.26), (gw - 1 - xx) / (gw * 0.26))
            g.putpixel((xx, yy), int(255 * ty * max(0.0, tx)))
    g = g.resize((hw * S, hh * S), Image.LANCZOS)

    a_full = Image.new("L", (W, H), 0)
    a_full.paste(g, (EDGE + (hi_inset + 2) * S, EDGE + 3 * S))
    a_full = a_full.point(lambda v: v * HI_A // 255)
    hl = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    hl.putalpha(a_full)
    lay.alpha_composite(hl)

    # 底部内阴影：往上 6 显示，渐变到透明
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sh_h = 6 * S
    for i in range(sh_h):
        # 越靠近底边越深。写成 (1 - i/sh_h) 就是反的 —— 会在牌面下沿上方
        # 留一条最深、靠底边反而变浅的横带，看着像"积了一条水"。
        a = int(SH_A * (i / sh_h) ** 1.5)
        y = H - EDGE - sh_h + i
        sd.rectangle([EDGE, y, W - 1 - EDGE, y], fill=LINE + (a,))
    sh.putalpha(ImageChops.multiply(sh.getchannel("A"), inner))
    lay.alpha_composite(sh)

    lay.save(os.path.join(OUT, out_name))
    bb = lay.getchannel("A").getbbox()
    print("  %-20s %dx%d  alpha bbox=%s" % (out_name, lay.size[0], lay.size[1], bb))
    return lay.size


def main():
    print("生成徽标底板（4x）：")
    plate(48, 48, 12, "badge-ring.png", hi_inset=10)
    plate(40, 24, 12, "badge-cap-2.png", hi_inset=8, hi_h=5)
    plate(52, 24, 12, "badge-cap-3.png", hi_inset=8, hi_h=5)
    # 任务胶囊：名字板同族，但**大一档**（+2 宽 / +2 高 / 字 +1px）。
    # 理由不是"任务更重要所以做大"，是它挂在背景图的路标上 ——
    # 那块木牌本身只有 60×38 的可视面积，视觉上是全场最小的物件；
    # 若与名字板同尺寸（52×24 / 12px），远看只剩一个米色点。
    # 圆角取 13 = 高的一半 → 标准胶囊端头，与名字板同一种形状语言。
    plate(54, 26, 13, "badge-task.png", hi_inset=8, hi_h=6)
    print("完成。注意：meta 里的 width/height/rawWidth/rawHeight 要同步（见 tools/set-meta-size.py）")


if __name__ == "__main__":
    main()
