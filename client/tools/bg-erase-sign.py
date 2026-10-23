#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 bg.png 里那块烤死的"派遣"绿牌**擦掉**，换成草地。

**为什么是擦掉而不是再挪一次**（上一版是挪，挪了 75px）：
卡片（`placeDispatchCard` 画的圆角白卡）本来就整块盖住了这块牌 —— 牌在
渲染图里一个像素都看不到。于是"把入口往右挪"其实是挪卡片，而那会儿牌还
钉在原地，卡片一挪牌就露出来，变成"两个派遣牌"。

擦掉之后只剩一个入口（卡片），而且牌原来的位置（设计 995..1097 / 499..598）
正好是宠物最缺的那一段横向空间。

流程：
  1. 在 BOX 内按颜色认出牌（深绿板面 / 深棕木框和腿 / 红图钉），填洞、膨胀；
  2. 补上牌腿底下那圈接地投影（不在颜色阈值里，得单独加一个椭圆）；
  3. **保护**垫子右前角：牌左腿紧贴垫子木框，膨胀后的 mask 会啃掉它两三个像素；
  4. 解拉普拉斯方程求低频（边界取真实草地像素）+ 从上方草地取高频纹理；
  5. 羽化 12px 混合回原图。

跑法：python client/tools/bg-erase-sign.py [源图]
      不带源图就改 `assets/ui/home/bg.png` 本身；
      想从仓库里的历史版本重来：先
        git show <commit>:client/assets/ui/home/bg.png > /tmp/bg.png
      再 `python tools/bg-erase-sign.py /tmp/bg.png`。
幂等性：不幂等。第二次跑会在补好的草地上再抠一次，越跑越糊。
"""
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = 'assets/ui/home/bg.png'

# 牌的可辨识区域（bg 像素，含余量）。木框实测 1185..1325 / 638..732，腿到 768
BOX = (1168, 618, 1352, 796)

# 垫子右前角保护区（bg 像素）。牌左腿在 x≈1205，垫子木框止于 x≈1187，
# 两者只隔 2px —— 膨胀后的 mask 会越过这条缝。硬性圈一块保护。
PROTECT = (0, 715, 1192, 1024)      # (x0, y0, x1, y1)

# 牌腿底下的接地投影（不在颜色阈值里）
SHADOW = (1255, 757, 62, 20)        # (cx, cy, rx, ry)

# 高频纹理的取材处（bg 像素，左上角）。左侧开阔草地，同一高度带、
# 没有建筑边缘。取"原图 - 自身大半径模糊"，只要细节不要明暗。
DONOR = (702, 648)


def build_mask(a, box):
    """BOX 内认出牌：深绿板面 | 深棕木框和腿 | 红图钉。"""
    l, t, r, b = box
    sub = a[t:b, l:r].astype(int)
    R, G, B = sub[:, :, 0], sub[:, :, 1], sub[:, :, 2]
    green = (G > 80) & (G < 150) & (R > 30) & (R < 110) & (B > 50) & (B < 130) & ((G - R) > 12)
    wood = (R > 55) & (R < 130) & (G > 30) & (G < 90) & (B < 70) & ((R - G) > 22)
    red = (R > 150) & (G < 110) & (B < 110) & ((R - G) > 70)
    return green | wood | red


def fill_holes(m):
    """牌面上那三块白纸条不在颜色阈值里，会被当成"洞"。从边界灌水，剩下的就是洞。"""
    h, w = m.shape
    inv = ~m
    outside = np.zeros_like(m)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if inv[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if inv[y, x] and not outside[y, x]:
                outside[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and inv[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                q.append((ny, nx))
    return m | (inv & ~outside)


def dilate(m, size):
    return np.array(Image.fromarray((m * 255).astype(np.uint8))
                    .filter(ImageFilter.MaxFilter(size))) > 127


def laplace_fill(patch, mask, iters=600, keep=False):
    """在 mask 内解拉普拉斯方程（Jacobi 迭代），边界固定为 mask 外的真实像素。

    得到的是**跟着周围草地渐变走的平滑面**。这是原地修复的关键：单纯把别处的
    草地整块贴过来，会连着那块的光斑和暗部一起搬过去 —— 在柔焦草地上，
    错的不是细节，是明暗。

    `keep=True` 时保留 mask 内已有的值当初值（金字塔上层传下来的解），
    不重置成整块均值。
    """
    out = patch.astype(np.float32).copy()
    if not keep:
        out[mask] = patch[~mask].reshape(-1, 3).mean(axis=0) if (~mask).any() else 128.0
    mf = mask.astype(np.float32)[:, :, None]
    for _ in range(iters):
        nb = (np.roll(out, 1, 0) + np.roll(out, -1, 0)
              + np.roll(out, 1, 1) + np.roll(out, -1, 1)) * 0.25
        out = out * (1 - mf) + nb * mf
    return out


def laplace_pyramid(patch, mask, levels=4, coarse_iters=400, fine_iters=(140, 200, 260)):
    """**多尺度**解拉普拉斯方程：先在粗层求到大形，再逐层细化。

    单尺度在 140×140 的洞上根本收敛不了 —— 600 次 Jacobi 只够扩散约
    √600≈25px，洞心还停在初值（整块均值），结果是一块边缘清楚、内部死平的
    "色块"。第一版就是这个下场：擦掉牌以后画面里立着一根米色柱子。
    粗层只有十几像素宽，几十次迭代就收敛；把它上采样当初值，细层只修边界。
    """
    h, w = mask.shape
    imgs, msks = [patch.astype(np.float32)], [mask.astype(bool)]
    for _ in range(levels - 1):
        ph, pw = imgs[-1].shape[:2]
        nh, nw = max(2, ph // 2), max(2, pw // 2)
        imgs.append(np.array(Image.fromarray(np.clip(imgs[-1], 0, 255).astype(np.uint8))
                             .resize((nw, nh), Image.BOX)).astype(np.float32))
        msks.append(np.array(Image.fromarray((msks[-1] * 255).astype(np.uint8))
                             .resize((nw, nh), Image.BILINEAR)) > 60)

    sol = laplace_fill(imgs[-1], msks[-1], iters=coarse_iters)
    for lv in range(len(imgs) - 2, -1, -1):
        img, m = imgs[lv], msks[lv]
        up = np.array(Image.fromarray(np.clip(sol, 0, 255).astype(np.uint8))
                      .resize((img.shape[1], img.shape[0]), Image.BILINEAR)).astype(np.float32)
        cur = img.copy()
        cur[m] = up[m]
        it = fine_iters[min(len(fine_iters) - 1, lv)]
        sol = laplace_fill(cur, m, iters=it, keep=True)
    return sol


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    im = Image.open(src).convert('RGBA')
    a = np.array(im.convert('RGB'))

    l, t, r, b = BOX
    bw, bh = r - l, b - t

    m = build_mask(a, BOX)
    m = fill_holes(m)
    m = dilate(m, 5)          # 吃掉木框外沿的抗锯齿

    # 接地投影：单独一个椭圆并进 mask。
    # ⚠ 必须在**真实的 Image 上**画：第一版写的是
    #   ImageDraw.Draw(Image.fromarray(sh))  —— 画在一张临时图上，
    #   `sh` 全程是零，于是牌的影子原地留成了一个大黑斑。
    sh = Image.new('L', (bw, bh), 0)
    cx, cy, rx, ry = SHADOW
    ImageDraw.Draw(sh).ellipse([cx - l - rx, cy - t - ry, cx - l + rx, cy - t + ry], fill=255)
    m = m | (np.array(sh) > 100)

    # 保护垫子右前角
    x0, y0, x1, y1 = PROTECT
    gy, gx = np.mgrid[t:b, l:r]
    prot = (gy >= y0) & (gx >= x0) & (gy < y1) & (gx < x1)
    m = m & ~prot

    print('[erase] mask pixels', int(m.sum()), '/', bw * bh)

    patch = a[t:b, l:r].astype(np.float32)
    out_ = ~m

    # ---- 低频：可分离的行/列中值模型 ----
    # 为什么不用解拉普拉斯：`laplace` 在 140×140 的洞上要么不收敛（一块死平的
    # 色块），要么把边界上的垫子暗边、花瓣亮边一起插值进来（整块偏色）。
    # 行中值 + 列中值 - 全局中值 是这两个问题的共同解：它只沿两个轴取真实像素的
    # 中位数，既跟得上草地的上下渐变，也不会把任何一块"结构"搬进洞里。
    rows = []
    for y in range(bh):
        sel = out_[y]
        rows.append(np.median(patch[y][sel], axis=0) if sel.any() else np.zeros(3))
    rowmed = np.array(rows)
    cols = []
    for x in range(bw):
        sel = out_[:, x]
        cols.append(np.median(patch[sel, x], axis=0) if sel.any() else np.zeros(3))
    colmed = np.array(cols)
    glob = np.median(patch[out_], axis=0)

    base = rowmed[:, None, :] + colmed[None, :, :] - glob[None, None, :]

    # 细节：两倍频的柔和噪点。**刻意不给草叶细节** —— 这个洞在最终画面里只有
    # 115×120 设计像素、还被六只宠物压在上面，加进来的"纹理"只会变成噪点斑。
    rng = np.random.default_rng(11)
    n1 = rng.normal(0, 1, (bh, bw, 1))
    n1 = np.array(Image.fromarray(((n1[:, :, 0] * 40) + 128).clip(0, 255)
                                  .astype(np.uint8))
                  .filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)[:, :, None]
    n1 = (n1 - n1.mean()) * 3.0
    n2 = np.array(Image.fromarray(((rng.normal(0, 1, (bh, bw)) * 40) + 128).clip(0, 255)
                                  .astype(np.uint8))
                  .filter(ImageFilter.GaussianBlur(5))).astype(np.float32)[:, :, None]
    n2 = (n2 - n2.mean()) * 4.0
    out_patch = base + n1 + n2

    # 羽化 26px：12px 时洞的矩形轮廓还看得出来（牌的板面本来就是矩形）
    soft = np.array(Image.fromarray((m * 255).astype(np.uint8))
                    .filter(ImageFilter.GaussianBlur(26))).astype(np.float32) / 255.0
    soft = np.maximum(soft, m.astype(np.float32))
    mixed = out_patch * soft[:, :, None] + patch * (1 - soft[:, :, None])

    out = a.copy()
    out[t:b, l:r] = np.clip(mixed, 0, 255).astype(np.uint8)

    # 原图是 RGBA（alpha 全 255）。转 RGB 视觉无损但会改文件格式，
    # Cocos 再导入一次可能生成不同 .meta —— 保持原样。
    layer = Image.fromarray(out).convert('RGBA')
    layer.save(SRC)
    print('[erase] saved', SRC, '(from %s)' % src)

    # 对比图
    box = (l - 30, t - 30, r + 30, b + 20)
    before = im.convert('RGB').crop(box)
    after = layer.convert('RGB').crop(box)
    cmp = Image.new('RGB', (before.width, before.height * 2 + 10), 'white')
    cmp.paste(before, (0, 0))
    cmp.paste(after, (0, before.height + 10))
    cmp.save('shots/_sign-erase-cmp.png')


if __name__ == '__main__':
    main()
