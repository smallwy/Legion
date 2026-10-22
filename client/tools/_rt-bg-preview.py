# -*- coding: utf-8 -*-
"""
_rt-bg-preview.py —— 战斗背景分层方案的合成预览

不是为了好看，是为了把「空间感」这件事量化到能验收：
  L0 天光远景 / L1 中景树干 / L2 地面 / L3 前景遮挡 / L4 角色
每一层单独可见，评审时能指着说「这层太抢」或「那层太轻」。

同时输出一张「现状 vs 方案」对照：现状按 BackgroundRenderer.ts 的
四个图元（草地矩形 / 220 根草线 / 40 个花点 / 边框）逐参数复刻，
不是另画一张"我觉得现在长这样"的示意图。

用法：
    python tools/_rt-bg-preview.py
产物：
    shots/bg-layered-960x540.png    分层方案合成图
    shots/bg-compare.png            上：现状 / 下：方案
"""
from PIL import Image, ImageDraw, ImageChops, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets', 'bg', 'raw')
OUT = os.path.join(ROOT, 'shots')
W, H = 960, 540                      # 相机视野 = 设计分辨率
GROUND_Y = 378                       # 草沿在屏内的 y（角色站在这条线上）

P = {
    'sky': '2D_横版游戏战斗背景的__最远层___暖秋黄昏天空_淡金__2026-10-22T02-43-12.png',
    'tree': '2D_横版游戏背景的__中景层___一排粗细不一的老树干_树_2026-10-22T02-43-37.png',
    'fg': '2D_横版游戏前景遮挡层_foreground_framin_2026-10-22T02-43-58.png',
    'ground': '2D_横版游戏的__地面横条___地面层__正面平视_无透视_2026-10-22T02-44-20.png',
}


def load(key):
    return Image.open(os.path.join(RAW, P[key])).convert('RGBA')


def crop_1610(im):
    """裁掉底部水印并裁成 16:9。水印固定在右下角，裁高度最稳。"""
    w, h = im.size
    return im.crop((0, 0, w, min(h, int(w * 9 / 16))))


def white_alpha(im, hi=246, lo=203):
    """白底 → alpha 渐变键。

    不用「全局阈值抠白」：那会在边缘留一圈 1~2px 的白边（白底残留），
    叠在深色背景上就是一圈发光的轮廓 —— 也就是"贴纸感"的来源之一。
    这里用最暗通道做软键，白底得 0、画面内容得 255，中间线性过渡，
    半透明的雾会变成真正的半透明雾，而不是一片白。
    """
    r, g, b, _ = im.split()
    m = ImageChops.darker(ImageChops.darker(r, g), b)
    span = hi - lo
    a = m.point(lambda v: 255 if v <= lo else (0 if v >= hi else int((hi - v) * 255 / span)))
    out = im.copy()
    out.putalpha(a)
    return out


def flatten(im, color, scale=0.92):
    """把一层压成纯色剪影 —— 前景层用。

    前景只该提供"遮挡"这一个信息，带任何明暗细节都会和角色抢注意力。
    同时因为是纯色，白边问题从根上不存在。
    """
    a = im.getchannel('A').point(lambda v: int(v * scale))
    out = Image.new('RGBA', im.size, color + (255,))
    out.putalpha(a)
    return out


def tint_rgb(im, color, k):
    """只改 RGB，不动 alpha。

    ⚠ 千万别用 alpha_composite 给透明层上色：那会给**全透明区域**也涂上
    颜色（alpha 变成 k*255），整片变成一层薄雾 —— 我第一次的合成图里
    天空和地面之间那条白带就是这么来的。
    """
    rgb = Image.blend(im.convert('RGB'), Image.new('RGB', im.size, color), k)
    out = rgb.convert('RGBA')
    out.putalpha(im.getchannel('A'))
    return out


def build_layers():
    # ---- L0 天光远景：不透明，视差 0.10 ----
    sky = crop_1610(load('sky')).resize((W, H), Image.LANCZOS)
    # 压一点整体的亮度 + 加一层米色，让角色能从背景里跳出来
    sky = Image.blend(sky.convert('RGB'), Image.new('RGB', sky.size, (242, 226, 198)), 0.16).convert('RGBA')

    # ---- L1 中景树干：白底键控，视差 0.35 ----
    tree = white_alpha(crop_1610(load('tree')))
    th = int(H * 1.20)
    tw = int(tree.size[0] * th / tree.size[1])
    tree = tree.resize((tw, th), Image.LANCZOS)
    tree = tint_rgb(tree, (238, 222, 198), 0.05)     # 只加一点雾 = 空气透视

    # ---- L2 地面：只要草皮 + 上部土层 ----
    gr = load('ground')
    gw, gh = gr.size
    # 生成的地面横条顶部有约 70px 白边（出图工具的留白），
    # 直接从 y=0 裁会在草地上方压出一条白带 —— 必须按"第一行非白"定位草沿。
    edge = 0
    gpx = gr.convert('RGB').load()
    for y in range(gh):
        n = 0
        for x in range(0, gw, 8):
            if min(gpx[x, y]) < 225:
                n += 1
        if n > 3:
            edge = y
            break
    # 草是一撮一撮的，草叶之间是透明白 —— 所以地面层也要走白键，
    # 否则草叶缝隙会留一串白点，读起来像贴纸的裁切边。
    band = white_alpha(gr.crop((0, max(0, edge - 6), gw, int(gh * 0.46))), hi=246, lo=204)
    bh = H - GROUND_Y + 18
    band = band.resize((W, bh), Image.LANCZOS)

    # ---- L3 前景遮挡：压成纯色，视差 1.15 ----
    fg = white_alpha(crop_1610(load('fg')), hi=244, lo=200)
    fg = fg.resize((W, H), Image.LANCZOS)
    fg = flatten(fg, (34, 44, 28))

    return sky, tree, band, fg


def chars():
    """角色层（L4）。比例按 960 宽的画面标定：砂糖 = 屏高 24%。"""
    out = []
    pet = Image.open(os.path.join(ROOT, 'assets/ui/home/pets/sugar-stand.png')).convert('RGBA')
    ph = 132
    out.append((pet.resize((int(pet.size[0] * ph / pet.size[1]), ph), Image.LANCZOS), 176))
    for name, x in (('enemy-walker.png', 486), ('enemy-flyer.png', 664)):
        e = Image.open(os.path.join(ROOT, 'assets/resources/art', name)).convert('RGBA')
        e = e.resize((e.size[0] * 2, e.size[1] * 2), Image.NEAREST)
        out.append((e, x))
    return out


def compose(sky, tree, band, fg, stage=5):
    """按层累加合成。stage 用来做「分层拆解图」——
    评审时最有说服力的不是成品，而是"每一层单独长什么样"。

    1 = L0 天光    2 = +L1 中景树    3 = +L2 地面
    4 = +L4 角色  5 = +L3 前景遮挡（成品）
    """
    canvas = Image.new('RGBA', (W, H), (28, 22, 16, 255))
    canvas.alpha_composite(sky)
    if stage >= 2:
        # L1：底部要压到地面线**以下**，让草皮把它切掉 —— 树"长在远处的地后方"
        canvas.alpha_composite(tree, (-int(tree.size[0] * 0.05), GROUND_Y + 30 - tree.size[1]))
    if stage >= 3:
        canvas.alpha_composite(band, (0, GROUND_Y))
        # 地面往下压暗：不加这一段，土层会像博物馆剖面图一直亮到画面底边，
        # 眼睛找不到"这里到此为止"的分界。压暗后画面四周自然收口。
        grad = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(grad)
        for i in range(96):
            y = H - 96 + i
            gd.line([(0, y), (W, y)], fill=(26, 20, 14, int(150 * (i / 95) ** 1.4)))
        canvas.alpha_composite(grad)
    if stage >= 4:
        # L4 角色（站在草沿上）
        for im, x in chars():
            canvas.alpha_composite(im, (x, GROUND_Y + 7 - im.size[1]))
    if stage >= 5:
        # L3 前景压在最上面 —— 这就是"分层"最直观的证据：有东西挡在角色前面
        canvas.alpha_composite(fg)
    return canvas


def explode(sky, tree, band, fg):
    """五段拆解：看见"加一层之前 / 之后"的差别。"""
    stages = [
        (1, 'L0 天光远景（不透明 · 视差 0.10）'),
        (2, 'L1 中景树干（视差 0.35 · 加 5% 雾）'),
        (3, 'L2 地面（草沿压在 y=378 · 底部压暗收口）'),
        (4, 'L4 角色（砂糖 132px = 屏高 24%）'),
        (5, 'L3 前景遮挡（纯色剪影 · 视差 1.15）'),
    ]
    k = 0.55
    tw, th = int(W * k), int(H * k)
    sheet = Image.new('RGBA', (tw * 5 + 12 * 4, th), (18, 14, 10, 255))
    for i, (st, caption) in enumerate(stages):
        panel = compose(sky, tree, band, fg, st).resize((tw, th), Image.LANCZOS)
        label(panel, '+%d' % i if i else 'L0', size=15)
        sheet.paste(panel, (i * (tw + 12), 0))
    return sheet, [c for _, c in stages]


def draw_current():
    """逐参数复刻 BackgroundRenderer.render()，作为"现状"对照。

    四个图元：FIELD 尺寸草地矩形 / 220 根草线 / 40 个花点 / 4px 边框。
    伪随机种子也是源码里的 20261014，所以草线的位置分布和实际运行一致。
    """
    im = Image.new('RGBA', (W, H), (0x3F, 0xA3, 0x4D, 255))   # PALETTE.grass
    d = ImageDraw.Draw(im)

    seed = 20261014
    def rnd():
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        return seed / 0x7FFFFFFF

    for _ in range(220):
        x = (rnd() - 0.5) * W
        y = (rnd() - 0.5) * H
        d.line([(x + W / 2, y + H / 2), (x + 3 + W / 2, y - 8 + H / 2)],
               fill=(0x2E, 0x7A, 0x3C, 255), width=2)
    for _ in range(40):
        x = (rnd() - 0.5) * W
        y = (rnd() - 0.5) * H
        d.rectangle([x + W / 2, y + H / 2, x + 3 + W / 2, y + 3 + H / 2],
                    fill=(0xF4, 0xE4, 0xC1, 255))
    d.rectangle([0, 0, W - 1, H - 1], outline=(0x2D, 0x24, 0x38, 255), width=4)

    for im_c, x in chars():
        im.alpha_composite(im_c, (x, GROUND_Y + 7 - im_c.size[1]))
    return im


FONT_PATH = 'C:/Windows/Fonts/msyh.ttc'


def font(size):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except OSError:
        return ImageFont.load_default()


def label(im, text, size=17):
    """PIL 的默认字体没有中文字形，直接用会渲染成一排方框。"""
    d = ImageDraw.Draw(im)
    f = font(size)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.rectangle([10, 10, 10 + (r - l) + 20, 10 + (b - t) + 16], fill=(30, 22, 16, 205))
    d.text((20, 16), text, font=f, fill=(255, 246, 232, 255))
    return im


if __name__ == '__main__':
    sky, tree, band, fg = build_layers()
    new = compose(sky, tree, band, fg)
    new.save(os.path.join(OUT, 'bg-layered-960x540.png'))

    old = draw_current()
    cmp_im = Image.new('RGBA', (W, H * 2 + 8), (20, 16, 12, 255))
    cmp_im.paste(label(old, '现状：1 层平地 / 4 个图元 / 零视差'), (0, 0))
    cmp_im.paste(label(new, '方案：L0-L3 分层 + 空气透视 + 前景遮挡'), (0, H + 8))
    cmp_im.save(os.path.join(OUT, 'bg-compare.png'))

    sheet, caps = explode(sky, tree, band, fg)
    sheet.save(os.path.join(OUT, 'bg-layers.png'))
    print('分层拆解：')
    for i, c in enumerate(caps):
        print('  %d. %s' % (i + 1, c))

    for n in ('bg-layered-960x540.png', 'bg-compare.png'):
        p = os.path.join(OUT, n)
        print('%s  %dx%d  %dKB' % (n, *Image.open(p).size, os.path.getsize(p) // 1024))
