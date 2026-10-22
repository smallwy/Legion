# -*- coding: utf-8 -*-
"""
把 ImageGen 出的六张立绘（品红底）处理成游戏可用素材。

流程：采背景色 → 涂掉水印 → 抠底 → 去紫边 → 裁透明边 → 统一体高 → 输出 640 高。

**为什么不能写死 #FF00FF 去抠**
  六张图要求的是同一个品红底，实际出的是六种不同的玫红/浅粉（有的还带矩形接缝）。
  写死阈值的结果是：dog 和 fox 抠干净了，另外四张整块品红留在图上。
  改成**每张图自己采四角背景色**，再按最小色差判背景。

**为什么统一的是"体高"而不是 bbox 高**
  旧六张立绘全是 640 高，但宽 279~559 —— 按高度缩放后宽度差一倍，
  并排看就是"三个画师画的"。而按 bbox 高度统一也不行：
  bbox 含耳朵，长耳兔的 bbox 比仓鼠高 30%，统一 bbox 会把兔的身体缩得极小。
  所以每只给一个 EAR_K（耳朵占全高的比例），按 bbox_h * (1 - EAR_K) = 体高
  反算缩放比 —— 统一的是"脚到头顶"，耳朵允许超出。

用法：python client/tools/prep_pets.py            # 只出预览接触表
      python client/tools/prep_pets.py --write    # 同时写进 assets
"""
import os
import sys
import glob
import statistics
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'concept', 'pets')
OUT_UI = os.path.join(ROOT, 'assets', 'ui', 'home')

PET_H = 640          # 输出图高，和旧素材一致（.meta 里的 spriteFrame rect 口径不变）
BODY_H = 420         # **统一体高**（脚底到头顶，不含耳朵）。
                     # 游戏里按图高缩放，所以"图里的体高一致"= 画出来一样大。
                     # 640 高的图放 420 的体高，剩下的是耳朵和留白；
                     # 定 420 是因为长耳兔（耳占 34%）的 bbox 刚好到 636，再高就出框。
TOL = 58             # 与背景色的色差容忍（三通道差的最大值）

# heroId -> (生成文件前缀, 美术文件名, 耳朵占 bbox 高之比, 头像裁切参数)
#   头像参数 = (中心x / bbox宽, 中心y / bbox高, 裁切边长 / bbox宽)
#   头像是**从立绘裁的**，不另外生成 —— 同源才不会有"头像和立绘不是同一只"的问题。
#   六只的耳朵长短、身体宽窄都不一样，所以裁切框只能一只一套：
#   长耳兔要更大的框（不然耳朵被切），胖仓鼠要往里收（不然右边全是身体）。
PETS = {
    'cat': ('Cute_chibi_orange_tabby_CAT',        'sugar-stand',  0.20, (0.37, 0.30, 0.76)),
    'dog': ('Cute_chibi_cream_colored_PUPPY',     'nian-gao-dog', 0.10, (0.36, 0.27, 0.80)),
    'ham': ('Cute_chibi_very_round_chubby_g',     'tuan-zi-ham',  0.09, (0.33, 0.28, 0.70)),
    'rab': ('Cute_chibi_pale_pink_white_RAB',     'xue-tuan-rab', 0.34, (0.37, 0.40, 1.02)),
    'ox':  ('Cute_chibi_chubby_slate_blue_C',     'dou-nai-ox',   0.14, (0.37, 0.27, 0.78)),
    'fox': ('Cute_chibi_orange_red_FOX_game',     'xing-xie-fox', 0.22, (0.37, 0.27, 0.78)),
}
HEAD_S = 480         # 头像边长，和旧素材一致（480×480 RGBA）


def find_shot(prefix):
    hits = sorted(glob.glob(os.path.join(SRC, prefix + '*.png')))
    if not hits:
        raise SystemExit('找不到生成图：%s*' % prefix)
    return hits[-1]


def corner_colors(im):
    """四角各取 15x15 的中位色。背景常常是渐变，一个色代表不了，
    所以后面按"离最近的那个角色"判背景。"""
    w, h = im.size
    s = 15
    boxes = [(0, 0), (w - s, 0), (0, h - s), (w - s, h - s)]
    cols = []
    for bx, by in boxes:
        patch = im.crop((bx, by, bx + s, by + s)).convert('RGB')
        px = list(patch.get_flattened_data())
        cols.append(tuple(statistics.median(c[i] for c in px) for i in range(3)))
    return cols


def kill_watermark(im, bgs):
    """右下角的"AI生成"白字压在背景上，抠底时会整块留下 —— 先把这块涂回背景色。

    只在 x > 70%、y > 92% 的角落动手，判据是"比背景明显亮"。
    六张图的脚底都在 80~86% 高度，尾巴最远到 88%，够不到这里。
    """
    w, h = im.size
    px = im.load()
    base = tuple(sum(c[i] for c in bgs) / len(bgs) for i in range(3))   # 逐通道平均
    bl = sum(base)
    x0, y0 = int(w * 0.70), int(h * 0.92)
    for y in range(y0, h):
        for x in range(x0, w):
            r, g, b = px[x, y][:3]
            if (r + g + b) - bl > 55:
                px[x, y] = (int(base[0]), int(base[1]), int(base[2]))
    return im


def outer_only(mask):
    """mask: L 模式，255 = 背景候选。只留下**与画面四边连通**的部分。

    为什么必须有这一步：橙色虎斑猫的橘色和玫红背景只差 50 出头，
    纯阈值抠图会把猫身上的条纹一起挖掉（第一版跑出来猫身上全是透明白斑）。
    加一圈 1px 的"全白"边再 flood fill，只有从外面能走到的背景才算背景 ——
    角色内部那些"碰巧像背景"的像素被围住了，自然保住。
    """
    w, h = mask.size
    canvas = Image.new('L', (w + 2, h + 2), 255)
    canvas.paste(mask, (1, 1))
    ImageDraw.floodfill(canvas, (0, 0), 128, thresh=0)
    inner = canvas.crop((1, 1, w + 1, h + 1))
    return inner.point(lambda v: 255 if v == 128 else 0)


def keyout(im, bgs):
    """按"离最近的背景角色够近"判背景。

    用 ImageChops.difference 做，避开逐像素 Python 循环（1024² 会很慢）。
    四个角各算一次，取并集 —— 背景是渐变时，四角覆盖了渐变的两端。
    """
    rgb = im.convert('RGB')
    bgmask = None
    for c in bgs:
        flat = Image.new('RGB', im.size, tuple(int(v) for v in c))
        diff = ImageChops.difference(rgb, flat)
        r, g, b = diff.split()
        mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
        m = mx.point(lambda v: 255 if v < TOL else 0)
        bgmask = m if bgmask is None else ImageChops.lighter(bgmask, m)

    bgmask = outer_only(bgmask)
    keep = ImageChops.invert(bgmask)
    # 腐蚀 1px：抠完边缘是一圈背景色和描边混出来的紫边，
    # 收到描边内侧就干净了。六张的描边都在 4px 以上，收 1px 看不出细。
    keep = keep.filter(ImageFilter.MinFilter(3))

    im = im.convert('RGBA')
    if im.getchannel('A').getextrema() != (255, 255):
        keep = ImageChops.multiply(keep, im.getchannel('A'))
    im.putalpha(keep)
    return im


def prep(hero, prefix, ear_k):
    im = Image.open(find_shot(prefix)).convert('RGBA')
    bgs = corner_colors(im)
    im = kill_watermark(im, bgs)
    im = keyout(im, bgs)

    bb = im.getbbox()
    if not bb:
        raise SystemExit('%s 抠完是空的，TOL 要调' % hero)
    im = im.crop(bb)

    # 体高（不含耳）统一到 BODY_H。缩的是"体高"，所以耳朵越长，图越高 ——
    # 这正是要的：兔子的耳朵该比仓鼠长，但它们的身体必须一样大。
    bh = im.height * (1 - ear_k)
    k = BODY_H / bh
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    if im.height > PET_H:
        raise SystemExit('%s 的耳朵超框了（%d > %d），EAR_K 估小了' % (hero, im.height, PET_H))

    # 脚底贴底、水平居中补到统一图高。
    # 脚底贴底很关键：游戏按"脚在 p.y"定位，补在上面还是下面决定了角色站在哪。
    out = Image.new('RGBA', (im.width, PET_H), (0, 0, 0, 0))
    out.alpha_composite(im, (0, PET_H - im.height))
    return out


def head_of(im, params):
    """从立绘裁一张圆头像。

    裁切框经常超出画布（脸朝左时头贴着左边缘），PIL 的 crop 越界会补黑边 ——
    所以先四周垫一圈透明，再按偏移后的坐标裁。
    """
    cxk, cyk, sidek = params
    bb = im.getbbox()
    bw, bh = bb[2] - bb[0], bb[3] - bb[1]
    cx = bb[0] + bw * cxk
    cy = bb[1] + bh * cyk
    side = bw * sidek
    box = (round(cx - side / 2), round(cy - side / 2),
           round(cx + side / 2), round(cy + side / 2))

    pad = int(side * 0.7)
    canvas = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(im, (pad, pad))
    crop = canvas.crop((box[0] + pad, box[1] + pad, box[2] + pad, box[3] + pad))
    crop = crop.resize((HEAD_S, HEAD_S), Image.LANCZOS)

    # 圆底：旧头像是"浅奶油圆 + 角色头"，不是纯透明。
    # 游戏里这张 PNG 是直接画上去的，没有额外的圆遮罩 —— 圆必须是图自带的，
    # 否则 HUD 上会显示成一张方形图里浮着颗头。
    base = Image.new('RGBA', (HEAD_S, HEAD_S), (0, 0, 0, 0))
    ImageDraw.Draw(base).ellipse((0, 0, HEAD_S - 1, HEAD_S - 1), fill=(250, 244, 230, 255))

    # 角色要收进圆内。裁切框是方的、圆是内切的，不缩的话耳朵/角/尾巴
    # 会从圆的四角长出去 —— 那读作"贴图没裁干净"，不是"头像"。
    # 0.90 是量出来的：留 5% 环边，耳朵尖刚好压在圆里。
    k = 0.90
    inner = crop.resize((round(HEAD_S * k), round(HEAD_S * k)), Image.LANCZOS)
    base.alpha_composite(inner, ((HEAD_S - inner.width) // 2, (HEAD_S - inner.height) // 2))

    # **alpha 要相乘，不能覆盖。** 覆盖会把圆内所有像素变成不透明 ——
    # 角色背后的透明区 RGB 是 (0,0,0)，头像就成"圆里一圈黑"了。
    mask = Image.new('L', (HEAD_S, HEAD_S), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, HEAD_S - 2, HEAD_S - 2), fill=255)
    base.putalpha(ImageChops.multiply(base.getchannel('A'), mask))
    return base


def contact_sheet(items, path):
    """缩略图测试：全部缩到 200 高并排，画在棋盘格上。

    棋盘格不是为了好看 —— 纯色底会把"没抠干净"藏起来（品红残边压在品红底上
    根本看不出来）。透明区必须一眼可见。
    """
    h = 200
    gap = 24
    rs = [im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)
          for _, im in items]
    W = sum(r.width for r in rs) + gap * (len(rs) + 1)
    H = h + gap * 2

    cell = 14
    bg = Image.new('RGBA', (W, H), (246, 246, 246, 255))
    d = ImageDraw.Draw(bg)
    for y in range(0, H, cell):
        for x in range(0, W, cell):
            if ((x // cell) + (y // cell)) % 2 == 0:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(214, 214, 214, 255))

    x = gap
    for r in rs:
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        layer.paste(r, (x, gap))
        bg = Image.alpha_composite(bg, layer)
        x += r.width + gap
    bg.convert('RGB').save(path)
    return bg.size


if __name__ == '__main__':
    write = '--write' in sys.argv
    items = []
    heads = []
    for hero, (prefix, art, ear_k, head_k) in PETS.items():
        im = prep(hero, prefix, ear_k)
        items.append((hero, im))
        hd = head_of(im, head_k)
        heads.append((hero, hd))
        print('  %-4s %-14s %sx%s  头像 %sx%s' % (hero, art, im.width, im.height, hd.width, hd.height))
        if write:
            dst = os.path.join(OUT_UI, 'pets', art + '.png')
            im.save(dst, 'PNG', optimize=True)
            dst2 = os.path.join(OUT_UI, 'heads-circle', art + '.png')
            hd.save(dst2, 'PNG', optimize=True)
            print('       -> %s / %s' % (os.path.relpath(dst, ROOT), os.path.relpath(dst2, ROOT)))

    size = contact_sheet(items, os.path.join(ROOT, 'shots', '_pets.png'))
    print('接触表 %dx%d -> shots/_pets.png' % size)
    contact_sheet(heads, os.path.join(ROOT, 'shots', '_heads.png'))
    print('头像表 -> shots/_heads.png')
