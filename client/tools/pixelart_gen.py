#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
程序化像素画生成器（不依赖降采样）

方法论修正：
  旧方案 = 256px 厚涂稿 -> 降采样到 24px -> 量化 16 色
          问题：色块是被"压"出来的，剪影细节在降采样中丢失，放大必糊
  新方案 = 在 32px 网格上按解剖结构摆放几何图元 -> 分区上色 -> 明暗 + 描边
          剪影由设计决定，色数是主动选的，不是被动压的

运行：python client/tools/pixelart_gen.py
输出：client/assets/resources/art/*.png  +  client/docs/pixel-preview.png
"""
from __future__ import annotations

import os
from PIL import Image

# ---------------------------------------------------------------- 路径
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "assets", "resources", "art")
OLD_DIR = os.path.join(ROOT, "art-source", "24px-autotrace")  # 旧的自动降采样版，归档对比用
DOC_DIR = os.path.join(ROOT, "docs")

GRID = 32  # 统一工作分辨率 32px，游戏内 x2 = 64px 显示（整数倍）

# ---------------------------------------------------------------- 几何图元
# 所有判定函数接收像素中心坐标 (x+0.5, y+0.5)


def ellipse(cx: float, cy: float, rx: float, ry: float):
    def f(x: float, y: float) -> bool:
        return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0
    return f


def circle(cx: float, cy: float, r: float):
    return ellipse(cx, cy, r, r)


def rect(x0: float, y0: float, x1: float, y1: float):
    def f(x: float, y: float) -> bool:
        return x0 <= x < x1 and y0 <= y < y1
    return f


def seg(x0: float, y0: float, x1: float, y1: float, th: float = 1.0):
    """带粗细的线段（点到线段距离场）"""
    r = th / 2.0
    dx, dy = x1 - x0, y1 - y0
    l2 = dx * dx + dy * dy

    def f(x: float, y: float) -> bool:
        if l2 == 0:
            t = 0.0
        else:
            t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / l2))
        ex, ey = x0 + t * dx - x, y0 + t * dy - y
        return ex * ex + ey * ey <= r * r
    return f


def tri(p1, p2, p3):
    def f(x: float, y: float) -> bool:
        def s(a, b):
            return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
        d1, d2, d3 = s(p1, p2), s(p2, p3), s(p3, p1)
        has_neg = d1 < 0 or d2 < 0 or d3 < 0
        has_pos = d1 > 0 or d2 > 0 or d3 > 0
        return not (has_neg and has_pos)
    return f


def build_mask(w: int, h: int, *fns):
    """把若干图元栅格化成像素集合"""
    out = set()
    for y in range(h):
        for x in range(w):
            px, py = x + 0.5, y + 0.5
            for fn in fns:
                if fn(px, py):
                    out.add((x, y))
                    break
    return out


def dilate(mask: set, w: int, h: int) -> set:
    """4 邻域外扩 1px（画描边用）"""
    out = set()
    for (x, y) in mask:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in mask:
                out.add((nx, ny))
    return out


# ---------------------------------------------------------------- 上色
def auto_shade(body: set):
    """
    按"列内垂直位置"自动分三阶明暗（顶光模型）：
      顶部 30% -> hi，底部 28% -> lo，中间 -> mid
    这样圆润物体的受光关系天然成立，无需逐只手调。
    """
    top, bot = {}, {}
    for (x, y) in body:
        if x not in top or y < top[x]:
            top[x] = y
        if x not in bot or y > bot[x]:
            bot[x] = y

    out = {}
    for (x, y) in body:
        span = max(1, bot[x] - top[x])
        t = (y - top[x]) / span
        if t < 0.30:
            out[(x, y)] = "hi"
        elif t > 0.72:
            out[(x, y)] = "lo"
        else:
            out[(x, y)] = "mid"
    return out


def render(spec: dict, w: int, h: int) -> Image.Image:
    """
    spec = {
        "palette": {key: (r,g,b,a)},
        "back":    [(图元fn, key)],  # body 之下：腿 / 翅膀 / 触角
        "body":    [图元fn...],      # 参与自动明暗的主体
        "front":   [(图元fn, key)],  # body 之上：鼻子 / 腮红 / 眼睛
        "line":    [(图元fn, key)],  # 最上细节：瞳孔高光 / 分节线
    }

    ⚠️ 层序 bug 记录（v1 踩过）：把眼睛放在"body 之前"的 flat 层，
       body 绘制时会把眼睛整片覆盖，脸上只剩白高光点。
       正确顺序：outline -> back -> body -> front -> line
    """
    pal = spec["palette"]
    back = [(build_mask(w, h, fn), key) for fn, key in spec.get("back", [])]
    body = build_mask(w, h, *spec.get("body", []))
    front = [(build_mask(w, h, fn), key) for fn, key in spec.get("front", [])]
    line = [(build_mask(w, h, fn), key) for fn, key in spec.get("line", [])]

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # 1) 描边：所有实体的并集外扩 1px，画在最底层，内部随后被实体覆盖
    solid = set(body)
    for m, _ in back + front + line:
        solid |= m
    for (x, y) in dilate(solid, w, h):
        img.putpixel((x, y), pal["outline"])

    # 2) 背层
    for m, key in back:
        for (x, y) in m:
            img.putpixel((x, y), pal[key])

    # 3) body —— 自动三阶明暗
    for (x, y), key in auto_shade(body).items():
        img.putpixel((x, y), pal[key])

    # 4) 前层（眼睛在这里，不会被盖掉）
    for m, key in front:
        for (x, y) in m:
            img.putpixel((x, y), pal[key])

    # 5) 最上细节
    for m, key in line:
        for (x, y) in m:
            img.putpixel((x, y), pal[key])

    return img


# ---------------------------------------------------------------- 配色
# 每只 8-10 色，全部 <= 24 色硬指标；色调对齐美术指引锁定色系（暖粉 / 橄榄绿 / 朱红 / 钢蓝）
INK = (26, 22, 30, 255)       # 统一描边墨色，让四只怪像一个系列
WHITE = (255, 255, 255, 255)

# ---------------------------------------------------------------- 宠物：圆滚猪
PET_PAL = {
    "outline": INK,
    "mid": (232, 158, 168, 255),
    "hi": (252, 205, 210, 255),
    "lo": (190, 112, 126, 255),
    "snout": (232, 112, 132, 255),
    "nostril": (118, 42, 56, 255),
    "blush": (250, 186, 194, 255),
    "leg": (186, 118, 130, 255),
    "eye": (34, 28, 34, 255),
    "pop": WHITE,
}

PET = {
    "size": (32, 32),
    "palette": PET_PAL,
    "body": [
        ellipse(16, 18.5, 11.5, 8.8),   # 躯干（头身一体的圆滚型）
        ellipse(9.0, 9.6, 3.0, 3.9),    # 左耳
        ellipse(23.0, 9.6, 3.0, 3.9),   # 右耳
    ],
    "back": [
        (rect(9, 25, 13, 30), "leg"),   # 前腿
        (rect(19, 25, 23, 30), "leg"),  # 后腿
    ],
    "front": [
        (ellipse(16, 21.0, 4.8, 3.4), "snout"),      # 鼻吻（高饱和玫粉，与躯干拉开）
        (ellipse(7.6, 19.5, 2.3, 1.6), "blush"),     # 左腮红
        (ellipse(24.4, 19.5, 2.3, 1.6), "blush"),    # 右腮红
        (rect(11, 14, 14, 17), "eye"),  # 左眼 3x3
        (rect(19, 14, 22, 17), "eye"),  # 右眼 3x3
    ],
    "line": [
        (rect(15, 20, 16, 22), "nostril"),   # 左鼻孔 1x2
        (rect(18, 20, 19, 22), "nostril"),   # 右鼻孔 1x2
        (rect(11, 14, 12, 15), "pop"),       # 左眼高光
        (rect(19, 14, 20, 15), "pop"),       # 右眼高光
    ],
}

# ---------------------------------------------------------------- 步行虫（橄榄绿）
WALKER_PAL = {
    "outline": INK,
    "mid": (107, 142, 35, 255),
    "hi": (158, 194, 74, 255),
    "lo": (74, 100, 22, 255),
    "leg": (58, 78, 16, 255),
    "eye": (238, 222, 130, 255),   # 亮琥珀眼白：深色甲壳上才看得见
    "pupil": (32, 38, 18, 255),
    "pop": WHITE,
    "seam": (74, 100, 22, 255),
}

WALKER = {
    "size": (32, 28),
    "palette": WALKER_PAL,
    "body": [
        ellipse(13.5, 13.5, 10.5, 8.0),  # 甲壳
        circle(23.5, 12.5, 5.2),         # 头
    ],
    "back": [
        (seg(9, 17, 4.5, 23.5, 2.0), "leg"),
        (seg(14, 19, 13, 26, 2.0), "leg"),
        (seg(19, 17, 24, 23.5, 2.0), "leg"),
        (seg(25.5, 8.5, 30.5, 2.5, 1.8), "leg"),   # 前触角（伸到头外，剪影可读）
    ],
    "front": [
        (rect(25, 10, 28, 13), "eye"),   # 眼 3x3 亮琥珀
    ],
    "line": [
        (rect(26, 11, 27, 13), "pupil"),  # 竖瞳
        (rect(25, 10, 26, 11), "pop"),    # 高光
        (seg(5, 13.0, 17, 13.0, 1.0), "seam"),   # 背甲分节线
    ],
}

# ---------------------------------------------------------------- 飞虫（朱红）
FLYER_PAL = {
    "outline": INK,
    "mid": (192, 57, 43, 255),
    "hi": (232, 112, 95, 255),
    "lo": (138, 35, 24, 255),
    "wing": (255, 238, 214, 255),
    "wingedge": (214, 176, 132, 255),
    "leg": (74, 15, 9, 255),
    "eye": (40, 20, 26, 255),
    "pop": WHITE,
}

FLYER = {
    "size": (32, 30),
    "palette": FLYER_PAL,
    "body": [
        ellipse(16, 18.0, 6.8, 8.8),   # 腹（加宽，别像蚂蚁）
        circle(16, 9.0, 5.2),          # 头
    ],
    "back": [
        (ellipse(8.2, 11.5, 6.4, 4.6), "wing"),    # 左翅
        (ellipse(23.8, 11.5, 6.4, 4.6), "wing"),   # 右翅
        (seg(13, 24, 10, 28, 1.6), "leg"),
        (seg(19, 24, 22, 28, 1.6), "leg"),
        (seg(16, 26, 16, 29, 1.6), "leg"),
        (seg(13.5, 4.5, 10.5, 1.0, 1.5), "leg"),   # 触角
        (seg(18.5, 4.5, 21.5, 1.0, 1.5), "leg"),
    ],
    "front": [
        (ellipse(12.6, 8.0, 2.5, 2.9), "eye"),     # 左复眼
        (ellipse(19.4, 8.0, 2.5, 2.9), "eye"),     # 右复眼
    ],
    "line": [
        (rect(11, 6, 12, 7), "pop"),
        (rect(20, 6, 21, 7), "pop"),
        (seg(6.5, 10.5, 9.5, 10.5, 1.0), "wingedge"),   # 翅脉（左）
        (seg(23.0, 12.5, 26.0, 12.5, 1.0), "wingedge"), # 翅脉（右，错位避免对称呆板）
    ],
}

# ---------------------------------------------------------------- 甲虫（钢蓝，厚血）
TANK_PAL = {
    "outline": INK,
    "mid": (52, 73, 94, 255),
    "hi": (93, 120, 145, 255),
    "lo": (30, 44, 58, 255),
    "leg": (22, 32, 42, 255),
    "horn": (86, 110, 134, 255),
    "eye": (242, 208, 112, 255),   # 琥珀眼，钢蓝甲壳上才跳得出来
    "pupil": (28, 20, 12, 255),
    "pop": WHITE,
    "seam": (24, 34, 44, 255),
}

TANK = {
    "size": (32, 32),
    "palette": TANK_PAL,
    "body": [
        ellipse(16, 21.0, 13.0, 9.8),   # 甲壳
        ellipse(16, 9.5, 6.2, 5.0),     # 头
    ],
    "back": [
        (seg(8.5, 22, 3.5, 29, 2.6), "leg"),
        (seg(14, 25.5, 12.5, 31, 2.6), "leg"),
        (seg(20, 25.5, 23.5, 31, 2.6), "leg"),
        (seg(24, 22, 29, 28.5, 2.6), "leg"),
        (tri((13.2, 9.2), (18.8, 9.2), (16.0, 0.2)), "horn"),   # 独角：锥形，够粗才看得出是角
    ],
    "front": [
        (rect(11, 8, 14, 11), "eye"),
        (rect(19, 8, 22, 11), "eye"),
    ],
    "line": [
        (rect(12, 9, 13, 11), "pupil"),
        (rect(20, 9, 21, 11), "pupil"),
        (rect(11, 8, 12, 9), "pop"),
        (rect(19, 8, 20, 9), "pop"),
        (seg(16, 13, 16, 30, 1.0), "seam"),   # 鞘翅中缝
    ],
}

SPRITES = {"pet": PET, "enemy-walker": WALKER, "enemy-flyer": FLYER, "enemy-tank": TANK}
LABELS = {"pet": "PET  pet", "enemy-walker": "WALKER  green", "enemy-flyer": "FLYER  red", "enemy-tank": "TANK  steel"}


# ---------------------------------------------------------------- 主流程
def main():
    os.makedirs(ART_DIR, exist_ok=True)
    os.makedirs(DOC_DIR, exist_ok=True)

    # 先把上一版自动降采样的产物归档（归档≠删除）
    if not os.path.isdir(OLD_DIR) and os.path.isdir(ART_DIR):
        os.makedirs(OLD_DIR, exist_ok=True)
        for name in SPRITES:
            p = os.path.join(ART_DIR, name + ".png")
            if os.path.exists(p):
                Image.open(p).save(os.path.join(OLD_DIR, name + ".png"))

    results = {}
    print(f"{'sprite':16} {'size':>9} {'colors':>7} {'bytes':>8}")
    for name, spec in SPRITES.items():
        w, h = spec["size"]
        img = render(spec, w, h)
        out = os.path.join(ART_DIR, name + ".png")
        img.save(out, optimize=True)
        cols = len(img.convert("RGBA").getcolors(maxcolors=100000) or [])
        results[name] = img
        print(f"{name:16} {f'{w}x{h}':>9} {cols:>7} {os.path.getsize(out):>8}")

    # ---- 对比预览：旧自动降采样（x8） vs 新程序化（x8）
    scale = 8
    cell_w, cell_h = GRID * scale, GRID * scale
    pad, header, gap = 18, 26, 34
    cols_n = len(SPRITES)
    canvas_w = pad + cols_n * (cell_w + pad)
    canvas_h = pad + 2 * (header + cell_h + gap) + pad
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (250, 249, 246, 255))

    from PIL import ImageDraw
    dr = ImageDraw.Draw(canvas)
    rows = [
        ("BEFORE  24px auto-downsampled from 256px", OLD_DIR),
        ("AFTER   32px drawn on grid (shape primitives, no sampling)", None),
    ]
    for r_i, (title, d) in enumerate(rows):
        y0 = pad + r_i * (header + cell_h + gap)
        dr.text((pad, y0), title, fill=(40, 40, 48, 255))
        for c_i, name in enumerate(SPRITES):
            x0 = pad + c_i * (cell_w + pad)
            y1 = y0 + header
            if d:
                src = os.path.join(d, name + ".png")
                im = Image.open(src).convert("RGBA") if os.path.exists(src) else Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
            else:
                im = results[name]
            www, hhh = im.size
            big = im.resize((www * scale, hhh * scale), Image.NEAREST)
            # 棋盘格底，便于看透明边界
            bg = Image.new("RGBA", (cell_w, cell_h), (238, 236, 232, 255))
            bd = ImageDraw.Draw(bg)
            for cy in range(0, cell_h, 16):
                for cx in range(0, cell_w, 16):
                    if (cx // 16 + cy // 16) % 2 == 0:
                        bd.rectangle([cx, cy, cx + 15, cy + 15], fill=(228, 226, 222, 255))
            ox = x0 + (cell_w - www * scale) // 2
            oy = y1 + (cell_h - hhh * scale) // 2
            canvas.paste(bg, (x0, y1))
            canvas.alpha_composite(big, (ox, oy))
            dr.text((x0 + 2, y1 + cell_h + 4), LABELS[name], fill=(90, 90, 100, 255))

    canvas.convert("RGB").save(os.path.join(DOC_DIR, "pixel-preview.png"))
    print(f"\npreview -> docs/pixel-preview.png  ({canvas_w}x{canvas_h})")

    # ---- in-game 实际尺寸预览：按 displaySize=64 渲染，验证战场里是否可读
    #      放大看好看 != 实际尺寸看得清，这一张才是验收用的
    igs = 2                     # 32px 贴图 x2 = 64px 显示
    cell = 116
    ig_w = pad + cols_n * cell + pad
    ig_h = 48 + cell + pad
    ig = Image.new("RGB", (ig_w, ig_h), (26, 36, 44))   # 深色战场底，最考验剪影
    igd = ImageDraw.Draw(ig)
    igd.text((pad, 16), "IN-GAME  texture 32px x2 = 64px  |  dark battlefield bg", fill=(206, 212, 218))
    for i, name in enumerate(SPRITES):
        im = results[name]
        w2, h2 = im.size[0] * igs, im.size[1] * igs
        big = im.resize((w2, h2), Image.NEAREST)
        x = pad + i * cell + (cell - w2) // 2
        y = 48 + (cell - h2) // 2
        ig.paste(big, (x, y), big)
        igd.text((pad + i * cell + cell // 2 - 16, 48 + cell - 10), name.split("-")[-1], fill=(140, 150, 160))
    ig.save(os.path.join(DOC_DIR, "pixel-preview-ingame.png"))
    print(f"ingame  -> docs/pixel-preview-ingame.png  ({ig_w}x{ig_h})")


if __name__ == "__main__":
    main()
