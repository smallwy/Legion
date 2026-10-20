# -*- coding: utf-8 -*-
"""
同一只猪，三种画风，在实际游戏显示尺寸下对照。

为什么用猪：`assets/resources/art/pet.png` 现在就是这只粉猪（32x32、正面视角），
所以像素一栏用的是**工程里真实在跑的那张资产**，不是我另外画的"像素示意"——
否则对比会被我自己的手活拉低，看不出真实差距。

  1) PIXEL   32 网格，2~3 格眼睛，无高光      → 现用风格，可代码产出
  2) CHUNKY  48 网格，2 格粗描边 + 眼睛高光    → 中间路线（Cat Quest 那种）
  3) Q-VECTOR 抗锯齿矢量 + 渐变 + 双高光       → Q 版卡通在引擎里最省成本的形态

三个共用同一套形状定义（SHAPES），只有"栅格化方式"不同 —— 这样差异纯粹来自画风，
不是来自造型。输出 art-source/style-compare.png。
"""
import os
from PIL import Image, ImageDraw, ImageFont

ZOOM = 5
DISP = 64
BG = (34, 32, 38, 255)
GRASS = (86, 122, 74, 255)
TITLE_C = (236, 230, 218, 255)
SUB_C = (152, 148, 140, 255)
PAD = 18

# ---- 设计基准：0..32 归一化坐标（正面视角，从现有 pet.png 反推的比例）----
EAR_L = [(4.6, 10.6), (7.0, 2.4), (13.2, 6.6)]
EAR_R = [(27.4, 10.6), (24.0, 2.4), (18.8, 6.6)]
HEAD = (16.0, 16.4, 13.6, 11.4)      # cx, cy, rx, ry
BODY = (16.0, 26.6, 11.4, 6.4)
NOSE = (16.0, 21.4, 5.0, 3.6)
EYES = [(10.6, 14.6), (21.4, 14.6)]  # 眼睛中心
LEGS = [(8.6, 29.4), (23.4, 29.4)]


def _in_ellipse(x, y, e):
    cx, cy, rx, ry = e
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0


def _in_poly(x, y, pts):
    """射线法，用于耳朵三角。"""
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin:
                inside = not inside
    return inside


def _region(x, y):
    """返回该点属于哪个部位：'ear' / 'head' / 'body' / 'leg' / None（归一化坐标）"""
    for e in (EAR_L, EAR_R):
        if _in_poly(x, y, e):
            return 'ear'
    for lx, ly in LEGS:
        if abs(x - lx) <= 2.0 and 28.6 <= y <= 32.0:
            return 'leg'
    if _in_ellipse(x, y, BODY):
        return 'body'
    if _in_ellipse(x, y, HEAD):
        return 'head'
    return None


# ============ 1) 像素版：读工程里真实的 pet.png ============
def load_pixel():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = os.path.join(root, 'assets', 'resources', 'art', 'pet.png')
    return Image.open(p).convert('RGBA')


# ============ 2) Chunky 版：同一形状，48 网格，粗描边 + 眼睛高光 ============
def chunky_pig(n=48, line_w=2, pal=None):
    pal = pal or {
        'line':  (0x3a, 0x1a, 0x28, 255),
        'dark':  (0xc0, 0x5c, 0x78, 255),
        'mid':   (0xf0, 0x9c, 0xb2, 255),
        'light': (0xfc, 0xcc, 0xd8, 255),
        'nose':  (0xe6, 0x74, 0x96, 255),
        'hole':  (0xa8, 0x44, 0x60, 255),
        'eye':   (0x3a, 0x1a, 0x28, 255),
        'white': (0xff, 0xff, 0xff, 255),
    }
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    px = img.load()
    u = n / 32.0
    cx, cy = n / 2.0, n / 2.0

    # 实心区域
    solid = {}
    for y in range(n):
        for x in range(n):
            r = _region((x + 0.5) / u, (y + 0.5) / u)
            if r:
                solid[(x, y)] = r

    def near_edge(x, y, d):
        for dx in range(-d, d + 1):
            for dy in range(-d, d + 1):
                if (x + dx, y + dy) not in solid:
                    return True
        return False

    for (x, y), reg in solid.items():
        if near_edge(x, y, line_w):
            px[x, y] = pal['line']
            continue
        # 内部明暗：光源左上；身体与耳朵各压一档（分层用色块，不用渐变）
        nx = (x + 0.5) / n
        ny = (y + 0.5) / n
        rel = (-nx * 0.55) - (ny - 0.35) * 0.45
        if reg == 'body' or reg == 'leg':
            px[x, y] = pal['mid']
        elif reg == 'ear':
            px[x, y] = pal['mid'] if rel > -0.05 else pal['dark']
        else:
            if rel > 0.34:
                px[x, y] = pal['light']
            elif rel > -0.10:
                px[x, y] = pal['mid']
            else:
                px[x, y] = pal['dark']

    # 鼻子
    nsx, nsy, nrx, nry = NOSE
    for y in range(n):
        for x in range(n):
            if _in_ellipse((x + 0.5) / u, (y + 0.5) / u, NOSE) and (x, y) in solid:
                px[x, y] = pal['nose']
    # 鼻孔：两个竖条
    hole_w = max(1, int(round(1.2 * u)))
    hole_h = max(2, int(round(1.6 * u)))
    for hx in (nsx - 1.7, nsx + 1.7):
        x0 = int(round(hx * u - hole_w / 2))
        y0 = int(round(nsy * u - hole_h / 2))
        for dy in range(hole_h):
            for dx in range(hole_w):
                if (x0 + dx, y0 + dy) in solid:
                    px[x0 + dx, y0 + dy] = pal['hole']

    # 眼睛：方块 + 1 格高光（chunky 的可爱度几乎全来自这一格）
    e = max(3, int(round(2.6 * u)))
    for ex_c, ey_c in EYES:
        ex0 = int(round(ex_c * u - e / 2))
        ey0 = int(round(ey_c * u - e / 2))
        for dy in range(e):
            for dx in range(e):
                if (ex0 + dx, ey0 + dy) in solid:
                    px[ex0 + dx, ey0 + dy] = pal['eye']
        # 左上白高光 1~2 格
        hs = 2 if e >= 5 else 1
        for dy in range(hs):
            for dx in range(hs):
                if (ex0 + dx, ey0 + dy) in solid:
                    px[ex0 + dx, ey0 + dy] = pal['white']

    # 腮红
    for sx in (-1, 1):
        bx, by = cx + sx * 8.0 * u, 18.4 * u
        for y in range(int(by - 1.4 * u), int(by + 1.4 * u)):
            for x in range(int(bx - 1.8 * u), int(bx + 1.8 * u)):
                if 0 <= x < n and 0 <= y < n and (x, y) in solid:
                    if ((x - bx) / (1.8 * u)) ** 2 + ((y - by) / (1.4 * u)) ** 2 <= 1:
                        px[x, y] = (0xf4, 0xa8, 0xa8, 255)
    return img


# ============ 3) Q 版矢量：超采样，平滑边 + 渐变高光 ============
def vector_pig(out=64, s=640):
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = s / 32.0

    OUT = (58, 26, 40, 255)
    DARK = (196, 92, 118, 255)
    FUR = (240, 156, 178, 255)
    FUR_L = (252, 204, 216, 255)
    NOSE = (230, 116, 150, 255)
    HOLE = (168, 68, 96, 255)
    EYE = (58, 26, 40, 255)
    WHITE = (255, 255, 255, 255)
    BLUSH = (244, 140, 150, 255)

    def P(pts):
        return [(x * u, y * u) for x, y in pts]

    # 耳朵（先画，压在头下）
    for pts in (EAR_L, EAR_R):
        d.polygon(P(pts), fill=FUR, outline=OUT)
    # 耳内
    for pts, k in ((EAR_L, 0.55), (EAR_R, 0.55)):
        mx = sum(p[0] for p in pts) / 3.0
        my = sum(p[1] for p in pts) / 3.0
        inner = [(mx + (x - mx) * k, my + (y - my) * k + 0.6) for x, y in pts]
        d.polygon(P(inner), fill=NOSE)

    # 腿
    for lx, ly in LEGS:
        d.rounded_rectangle([(lx - 2.1) * u, (ly - 0.6) * u, (lx + 2.1) * u, 31.9 * u],
                            radius=1.6 * u, fill=FUR, outline=OUT, width=int(1.1 * u))
    # 身体
    cx, cy, rx, ry = BODY
    d.ellipse([(cx - rx) * u, (cy - ry) * u, (cx + rx) * u, (cy + ry) * u],
              fill=FUR, outline=OUT, width=int(1.3 * u))
    # 肚皮
    d.ellipse([(cx - 6.4) * u, (cy - 2.6) * u, (cx + 6.4) * u, (cy + 5.4) * u], fill=FUR_L)

    # 头
    cx, cy, rx, ry = HEAD
    d.ellipse([(cx - rx) * u, (cy - ry) * u, (cx + rx) * u, (cy + ry) * u],
              fill=FUR, outline=OUT, width=int(1.4 * u))
    # 头顶柔光：一块低透明度椭圆（矢量风的"渐变"用半透明叠色实现，不做模糊）
    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [(cx - 9.0) * u, (cy - 10.4) * u, (cx + 2.0) * u, (cy - 2.0) * u],
        fill=(255, 240, 246, 92))
    img.alpha_composite(glow)

    # 鼻子
    nx_, ny_, nrx, nry = NOSE
    d.ellipse([(nx_ - nrx) * u, (ny_ - nry) * u, (nx_ + nrx) * u, (ny_ + nry) * u],
              fill=NOSE, outline=OUT, width=int(1.0 * u))
    for hx in (nx_ - 1.7, nx_ + 1.7):
        d.ellipse([(hx - 0.62) * u, (ny_ - 0.95) * u, (hx + 0.62) * u, (ny_ + 0.95) * u], fill=HOLE)

    # 眼睛：椭圆 + 双高光（Q 版价格就是这里：每只眼 3 个图元 + 你要画得准）
    for ex_c, ey_c in EYES:
        d.ellipse([(ex_c - 1.85) * u, (ey_c - 2.5) * u, (ex_c + 1.85) * u, (ey_c + 2.5) * u], fill=EYE)
        d.ellipse([(ex_c - 1.35) * u, (ey_c - 1.7) * u, (ex_c - 0.15) * u, (ey_c - 0.1) * u], fill=WHITE)
        d.ellipse([(ex_c + 0.45) * u, (ey_c + 0.6) * u, (ex_c + 1.3) * u, (ey_c + 1.6) * u], fill=WHITE)

    # 腮红
    for sx in (-1, 1):
        bx = cx + sx * 8.4
        d.ellipse([(bx - 2.1) * u, 17.4 * u, (bx + 2.1) * u, 20.0 * u], fill=BLUSH)

    return img.resize((out, out), Image.LANCZOS)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, 'art-source')
    os.makedirs(out_dir, exist_ok=True)

    pix = load_pixel()
    variants = [
        ('PIXEL', '32 grid / 10 colors / 3x3 eyes', pix),
        ('CHUNKY', '48 grid / 2px outline / eye highlight', chunky_pig()),
        ('Q-VECTOR', 'smooth AA / soft glow / double highlight', vector_pig()),
    ]

    for t, _, im in variants:
        p = os.path.join(out_dir, 'style-' + t.lower().replace(' ', '-') + '.png')
        im.save(p)
        data = list(im.convert('RGBA').getdata())
        colors = len(set(q for q in data if q[3] > 0))
        semi = sum(1 for q in data if 0 < q[3] < 255)
        print('  %-18s %s colors=%-4d semi-alpha=%d' % (t, im.size, colors, semi))

    z = DISP * ZOOM
    col_w = z + PAD * 2
    H = 66 + z + 110
    sheet = Image.new('RGBA', (col_w * 3, H), BG)
    d = ImageDraw.Draw(sheet)
    try:
        f_big = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 21)
        f_sm = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 12)
    except OSError:
        f_big = f_sm = ImageFont.load_default()

    for i, (title, sub, im) in enumerate(variants):
        x0 = i * col_w
        d.text((x0 + PAD, 12), title, font=f_big, fill=TITLE_C)
        d.text((x0 + PAD, 38), sub, font=f_sm, fill=SUB_C)
        big = im.resize((z, z), Image.NEAREST)
        sheet.paste(big, (x0 + PAD, 60), big)
        # 1x 实际尺寸
        gy = 66 + z + 10
        d.rectangle([x0 + PAD, gy, x0 + PAD + col_w - PAD * 2, gy + 84], fill=GRASS)
        sheet.paste(im, (x0 + PAD + (col_w - PAD * 2 - DISP) // 2, gy + 10), im)
        d.text((x0 + PAD + 10, gy + 66), '1x = 64px on screen', font=f_sm, fill=(236, 240, 226, 255))

    path = os.path.join(out_dir, 'style-compare.png')
    sheet.save(path)
    print('written', path, sheet.size)


if __name__ == '__main__':
    main()
