#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 bg.png 里那块"派遣"绿牌整体搬到画面左侧，并缩小到 0.80。

**为什么是图像脚本**：牌子是烤进背景图里的（场景里只有点击热区
`Badge-派遣` 和标题 `Cap-派遣` 两个节点）。挪它 = 挪像素。

流程（顺序不能换）：
  1. BOX 内按颜色认出牌（深绿板面 / 深棕木框和腿），填洞、膨胀；
  2. 只留**最大连通域** —— 牌子右侧是镜头前那朵虚化大花，花瓣的红色
     会满足木框阈值，在左缘留下一圈红边；
  3. **镜像补洞**：花挡掉的是右下角，抠出来是个缺口。牌子左右基本对称，
     按中轴镜像把洞填上（顺带把被花吃掉的右腿也补出来）；
  4. 板面上那三块白纸条擦成板面纯色 —— 运行时要在牌面中央放派遣图标，
     留着纸条会打架；
  5. 原位用"解拉普拉斯低频 + 左下方草地的高频 + 噪声"补回草地；
  6. 缩放 0.80 贴到 (SX, SY)，补两腿的接地阴影。

跑法：
    python client/tools/move-bg-sign-left.py           # 只出预览，不改 bg.png
    python client/tools/move-bg-sign-left.py --write   # 真写回 bg.png

幂等性：不幂等。要重跑先 git checkout -- assets/ui/home/bg.png
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = 'assets/ui/home/bg.png'

# 牌当前所在的 BOX（bg 像素，含 6px 余量）。实测板面 1276..1418 / 598..700，
# 腿到 735，右缘被虚化大花咬掉一块。
BOX = (1264, 570, 1430, 748)

# 目标落点与缩放。0.80 不是随手取的：牌子挪到的位置比原来**更远**
# （bg y 570 → 492，画面的地平线往上），远处的牌子按透视必须更小，
# 否则会读成"一块超大的板子贴在背景上"。
SX, SY = 100, 492
SCALE = 0.80


def build_mask(a, box):
    l, t, r, b = box
    sub = a[t:b, l:r].astype(int)
    R, G, B = sub[:, :, 0], sub[:, :, 1], sub[:, :, 2]
    green = (G > 80) & (G < 140) & (R > 40) & (R < 110) & (B > 60) & (B < 125) & ((G - R) > 12)
    wood = (R > 55) & (R < 130) & (G > 30) & (G < 90) & (B < 70) & ((R - G) > 22)
    return green | wood


def fill_holes(m):
    """白纸条不在颜色阈值里，会被当成洞。从边界灌水，剩下的就是洞。"""
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
    return np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(size))) > 127


def largest_component(m):
    """花瓣红会连成小块禁区。只留最大的那块 = 牌本体。"""
    h, w = m.shape
    lbl = np.zeros((h, w), np.int32)
    best, bestsz, cur = 0, 0, 0
    for y in range(h):
        for x in range(w):
            if m[y, x] and lbl[y, x] == 0:
                cur += 1
                sz = 0
                q = deque([(y, x)])
                lbl[y, x] = cur
                while q:
                    cy, cx = q.popleft()
                    sz += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and lbl[ny, nx] == 0:
                            lbl[ny, nx] = cur
                            q.append((ny, nx))
                if sz > bestsz:
                    bestsz, best = sz, cur
    return lbl == best


def solidify(m):
    """把**板面那些行**变成实心条，并按中轴对称修正被遮挡的一侧。

    为什么光靠颜色掩膜 + 灌水填洞不够：牌子右下角被镜头前那朵虚化花咬掉一块，
    灌水会从缺口渗进来，于是板面里的白纸条被判成"外部"、根本不进 mask ——
    修补完牌子上还留着一个亮矩形和三块纸条的印子。这个坑第一次跑就是这样，
    而且掩膜看起来"完全正确"（mask 图上是一块完整的牌）。
    牌子本身是左右对称的矩形，所以：行内取 min/max 拉通，缺的一侧按对称补齐。
    腿那几行（宽度远小于板面）不动，否则两条腿会被连成一条横杠。
    """
    h, w = m.shape
    out = m.copy()
    wid = m.sum(axis=1)
    wmax = wid.max()
    xs_all = np.where(m.any(0))[0]
    cx = (xs_all.min() + xs_all.max()) / 2.0
    solid_rows = 0
    for y in range(h):
        if wid[y] < 0.45 * wmax:      # 腿行 / 空白行
            continue
        xs = np.where(m[y])[0]
        a, b = int(xs.min()), int(xs.max())
        left, right = cx - a, b - cx
        if right < left * 0.92:       # 右侧被挡，按对称补
            b = int(min(w - 1, round(2 * cx - a)))
        elif left < right * 0.92:
            a = int(max(0, round(2 * cx - b)))
        out[y, a:b + 1] = True
        solid_rows += 1
    return out, solid_rows


def mirror_fill(rgba, m):
    """按中轴镜像填平每行左右边界之间的空洞（花挡掉的右下角 + 右腿）。"""
    h, w = m.shape
    xs_all, ys_all = np.where(m.any(0))[0], np.where(m.any(1))[0]
    x0, x1 = xs_all.min(), xs_all.max()
    y0, y1 = ys_all.min(), ys_all.max()
    cx = (x0 + x1) / 2.0
    n = 0
    for y in range(y0, y1 + 1):
        if m[y].sum() < 2:
            continue
        for x in range(x0, x1 + 1):
            if m[y, x]:
                continue
            mx = int(round(2 * cx - x))
            if x0 <= mx <= x1 and m[y, mx]:
                rgba[y, x, 0:3] = rgba[y, mx, 0:3]
                rgba[y, x, 3] = 255
                n += 1
    return n


def clear_notes(rgba, m):
    """把板面上的白纸条擦成板面纯色。

    纸条是"公告板上的便签"，本来挺可爱 —— 但运行时要在牌面正中放派遣图标
    和文字，留着纸条就是两套内容打架。擦掉之后牌面是空的，图标成了唯一内容。
    只在**绿板面内部**擦（按绿板 bbox 向内收 8px），木框不动。
    """
    R, G, B = rgba[:, :, 0].astype(int), rgba[:, :, 1].astype(int), rgba[:, :, 2].astype(int)
    board = (G > 80) & (G < 150) & (R > 40) & (R < 120) & (B > 60) & (B < 135) & ((G - R) > 10)
    ys, xs = np.where(board)
    by0, by1, bx0, bx1 = ys.min(), ys.max(), xs.min(), xs.max()
    inner = np.zeros_like(board)
    inner[by0 + 8:by1 - 7, bx0 + 8:bx1 - 7] = True
    note = (R > 165) & (G > 165) & (B > 145) & inner
    # 膨胀一圈吃掉纸条的抗锯齿边
    note = dilate(note, 5) & inner
    if note.sum() == 0:
        return by0, by1, bx0, bx1, 0
    base = np.median(rgba[:, :, 0:3][board], axis=0)
    # 板面本来有轻微的上亮下暗，纯平涂会像贴了块色卡 → 给 6% 的竖向渐变
    hh = by1 - by0
    for y in range(by0, by1 + 1):
        k = 1.0 - 0.06 * ((y - by0) / max(1, hh))
        sel = note[y]
        if sel.any():
            rgba[y, sel, 0:3] = np.clip(base * k, 0, 255).astype(np.uint8)
            rgba[y, sel, 3] = 255
    return by0, by1, bx0, bx1, int(note.sum())


def laplace_fill(patch, mask, iters=600, keep=False):
    """在 mask 内解拉普拉斯方程（Jacobi），边界固定为 mask 外的真实像素。

    `keep=True` 时保留 mask 内已有的值当初值（金字塔上层传下来的解）。
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

    单尺度在这个尺寸的洞上收敛不了 —— 600 次 Jacobi 只把影响扩散 √600≈25px，
    洞心还停在初值，结果是一块「边缘清楚、内部死平」的色块（上次擦牌就是
    这个下场：画面里立着一根米色柱子）。粗层只有十几像素宽，几十次迭代就
    收敛；上采样当初值，细层只修边界。
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
        img, mk = imgs[lv], msks[lv]
        up = np.array(Image.fromarray(np.clip(sol, 0, 255).astype(np.uint8))
                      .resize((img.shape[1], img.shape[0]), Image.BILINEAR)).astype(np.float32)
        cur = img.copy()
        cur[mk] = up[mk]
        it = fine_iters[min(len(fine_iters) - 1, lv)]
        sol = laplace_fill(cur, mk, iters=it, keep=True)
    return sol


def main():
    write = '--write' in sys.argv
    im = Image.open(SRC).convert('RGB')
    a = np.array(im)

    # 幂等保护：牌现在的位置还有没有那块深绿？
    probe = a[610:690, 1290:1390].astype(int)
    R, G, B = probe[:, :, 0], probe[:, :, 1], probe[:, :, 2]
    alive = ((G > 80) & (G < 140) & (R > 40) & (R < 110) & (B > 60) & (B < 125) & ((G - R) > 12)).sum()
    if alive < 400:
        print('[sign-left] 这张 bg.png 已经搬过了（原位只剩 %d 个绿像素）。' % alive)
        print('           要重跑先 git checkout -- assets/ui/home/bg.png')
        return

    l, t, r, b = BOX
    bh = b - t

    m = largest_component(dilate(fill_holes(build_mask(a, BOX)), 5))
    m, solid_rows = solidify(m)
    print('[sign-left] mask', int(m.sum()), 'px，实心化 %d 行' % solid_rows)

    rgba = np.dstack([a[t:b, l:r], (m * 255).astype(np.uint8)])
    nfill = mirror_fill(rgba, m)
    print('[sign-left] 镜像补洞', nfill, 'px')

    by0, by1, bx0, bx1, nnote = clear_notes(rgba, m)
    print('[sign-left] 板面 bbox (BOX 内)', bx0, by0, '-', bx1, by1, '擦纸条', nnote, 'px')

    alpha = Image.fromarray(rgba[:, :, 3]).filter(ImageFilter.GaussianBlur(0.7))
    sign = Image.fromarray(rgba[:, :, 0:3]).convert('RGBA')
    sign.putalpha(alpha)

    # ---- 原位修补 ----
    patch = a[t:b, l:r].astype(np.float32)
    fill = m.copy()
    lower = m.copy()
    lower[:int(bh * 0.78), :] = False
    fill = fill | dilate(lower, 25)      # 腿底下那圈投影不在颜色阈值里
    low = laplace_pyramid(patch, fill)
    # 自检：不测"牌内方差"（草地本身就有明暗渐变，方差天然不为 0），测**梯度**。
    # 解出来的低频层应该是平滑面，相邻像素差要小；如果牌子的轮廓还在，
    # 梯度会在木框/白纸条边缘冒出尖峰。宁可在这里报出来，也别等看图才发现。
    gx = np.abs(np.diff(low, axis=1))          # (h, w-1, 3)
    print('[sign-left] 低频层牌内梯度均值 %.2f（>5 说明轮廓没化开，修补会留色斑）'
          % float(gx[fill[:, :-1]].mean()))

    # 高频：从**左下草地**取（bg 60..226 / 570..748）。不能取正上方：
    # 那一片横着一道木栅栏（bg 1150..1360 / 500..570），纹理一取就带上栏杆。
    #
    # 做法是**低频置换**（swap low frequency），不是"按标准差缩放"：
    #   result = low(目标解) + (src - blur(src))
    # 前两版用 `pv/tv` 比值缩放 src，结果牌子的深绿板面把目标方差撑大十几倍，
    # 源纹理被等比放大成一片紫绿伪影 —— 看起来像"牌子被涂糊了"。
    # 低频置换的 adv：明暗完全由 low 决定（跟着周围渐变走），源块只贡献细节，
    # 曝光永远对得上，权重也就不用靠调。
    tex = np.zeros_like(patch)
    sh, sw = b - t, r - l
    src = a[570:570 + sh, 60:60 + sw].astype(np.float32)
    if src.shape[:2] == patch.shape[:2]:
        sm = np.array(Image.fromarray(np.clip(src, 0, 255).astype(np.uint8))
                      .filter(ImageFilter.GaussianBlur(20))).astype(np.float32)
        tex = src - sm
        tex = np.roll(tex, (sh // 2, sw // 3), axis=(0, 1))
    out_patch = low + tex * 0.85
    out_patch += np.random.default_rng(11).normal(0, 1.5, out_patch.shape)

    soft = np.array(Image.fromarray((fill * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12))).astype(np.float32) / 255.0
    soft = np.maximum(soft, fill.astype(np.float32))
    mixed = out_patch * soft[:, :, None] + patch * (1 - soft[:, :, None])
    out = a.copy()
    out[t:b, l:r] = np.clip(mixed, 0, 255).astype(np.uint8)

    # ---- 贴到新位置 ----
    layer = Image.fromarray(out).convert('RGBA')
    tw, th = int(sign.width * SCALE), int(sign.height * SCALE)
    ss = sign.resize((tw, th), Image.LANCZOS)
    layer.alpha_composite(ss, (SX, SY))

    # ---- 接地阴影：两条腿底下各一个软椭圆 ----
    shadow = Image.new('RGBA', ss.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(shadow)
    foot_y = int(th * 0.92)
    for fx in (0.30, 0.72):
        cx = int(tw * fx)
        for i in range(20, 0, -1):
            k = i / 20.0
            d.ellipse([cx - 22 * k, foot_y - 6 * k, cx + 22 * k, foot_y + 6 * k],
                      fill=(34, 24, 14, int(30 * (1 - k) + 5)))
    layer.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(5)), (SX, SY))

    layer.convert('RGBA').save('shots/_bg-signleft.png')
    print('[sign-left] 预览 shots/_bg-signleft.png  落点 (%d,%d) scale %.2f  贴图 %dx%d'
          % (SX, SY, SCALE, tw, th))

    # 设计坐标换算（bg 1536x1024 → 设计 1280x720：x*0.8333, y*0.8333-40）
    f = 1280.0 / 1536.0
    print('[sign-left] 板面 设计坐标 x %.0f..%.0f  y %.0f..%.0f'
          % ((SX + bx0 * SCALE) * f, (SX + bx1 * SCALE) * f,
             (SY + by0 * SCALE) * f - 40, (SY + by1 * SCALE) * f - 40))

    if write:
        layer.convert('RGBA').save(SRC)
        print('[sign-left] 已写回', SRC)


if __name__ == '__main__':
    main()
