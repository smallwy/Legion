#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 bg.png 里那块"派遣"绿牌整体右移，给宠物腾出横向位置。

**为什么是个图像脚本而不是改坐标**：那块牌是烤进背景图里的（场景里只有它的
点击热区 `Badge-派遣` 和标题 `Cap-派遣` 两个节点）。挪它 = 挪像素。

流程（顺序不能换）：
  1. 在 BOX 内按颜色认出牌（深绿板面 / 深棕木框和腿 / 红图钉），填洞、膨胀；
  2. **先从原图抠出牌**（后面修复会覆盖原位，抠晚了拿到的是补过的草地）；
  3. 原位用正上方同宽的草地竖直翻转填回去（做色差补偿 + 8px 模糊 + 噪声）；
  4. 把抠出的牌贴到 BOX + (DX, 0)，并在两条腿下面补回接地阴影。

跑法：python client/tools/move-bg-sign.py
幂等性：不幂等（第二次跑会在已修复的图上再抠一次）。改参数前先 git checkout bg.png。
"""
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

SRC = 'assets/ui/home/bg.png'

# 牌的可辨识区域（bg 像素，含 3px 余量）。木框实测 1185..1325 / 625..767
BOX = (1178, 615, 1336, 782)
# 右移量（bg 像素）。90px ≈ 设计坐标 75。
# 上限卡在右侧那朵虚化大花上：再往右，牌的两条腿会被花完全吃掉，牌看着像浮空。
DX = 90
DY = -40


def build_mask(a, box):
    """BOX 内认出牌：深绿板面 | 深棕木框和腿 | 红图钉。"""
    l, t, r, b = box
    sub = a[t:b, l:r].astype(int)
    R, G, B = sub[:, :, 0], sub[:, :, 1], sub[:, :, 2]
    green = (G > 80) & (G < 140) & (R > 40) & (R < 110) & (B > 60) & (B < 125) & ((G - R) > 12)
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
    return np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(size))) > 127


def laplace_fill(patch, mask, iters=500):
    """在 mask 内解拉普拉斯方程（Jacobi 迭代），边界固定为 mask 外的真实像素。

    得到的是**跟着周围草地渐变走的平滑面**。这是原地修复的关键：单纯把别处的草地
    整块贴过来，会连着那块的光斑和暗部一起搬过去，在柔焦草地上反而更显眼。
    """
    out = patch.astype(np.float32).copy()
    out[mask] = patch[~mask].reshape(-1, 3).mean(axis=0) if (~mask).any() else 128.0
    mf = mask.astype(np.float32)[:, :, None]
    for _ in range(iters):
        nb = (np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) * 0.25
        out = out * (1 - mf) + nb * mf
    return out


def main():
    im = Image.open(SRC).convert('RGB')
    a = np.array(im)

    # 幂等保护：牌原来的位置（取左半 1190..1265 / 650..720）还有没有那块深绿？
    # 没有就说明这张图已经搬过了，再跑会在补过的草地上再抠一次，越跑越糊。
    probe = a[650:720, 1190:1265].astype(int)   # 取原牌的**左半**：右半和新位置重叠，会误判成还没搬
    R, G, B = probe[:, :, 0], probe[:, :, 1], probe[:, :, 2]
    alive = ((G > 80) & (G < 140) & (R > 40) & (R < 110) & (B > 60) & (B < 125) & ((G - R) > 12)).sum()
    if alive < 500:
        print('[sign] 这张 bg.png 已经搬过牌了（原位只剩 %d 个绿像素）。' % alive)
        print('       要重跑先 git checkout -- assets/ui/home/bg.png')
        return

    Image.fromarray(a).save('shots/_bg-before.png')     # 对比图用，跑完可以删

    l, t, r, b = BOX
    bw, bh = r - l, b - t

    m = build_mask(a, BOX)
    m = fill_holes(m)
    m = dilate(m, 5)          # 半径 2：吃掉木框外沿的抗锯齿

    # 抠图用**紧**的 mask；修图用膨胀后的 —— 牌腿底下那圈投影不在颜色阈值里，
    # 只把下半段横向扩开（整条底带一起重画会在草地上留一道横痕，试过）。
    cut = m.copy()
    fill = m.copy()
    lower = m.copy()
    lower[:int(bh * 0.78), :] = False
    fill = fill | dilate(lower, 25)

    print('[sign] cut/fill pixels', int(cut.sum()), int(fill.sum()), '/', bw * bh)

    # ---- 1. 先抠牌（alpha 羽化 0.8px） ----
    alpha = Image.fromarray((cut * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    sign = Image.fromarray(a[t:b, l:r]).convert('RGBA')
    sign.putalpha(alpha)
    sign.save('shots/_sign-cut.png')

    # ---- 2. 原位修复 ----
    patch = a[t:b, l:r].astype(np.float32)
    # 低频：解拉普拉斯方程（边界取真实草地像素）。这样得到的是跟着草地渐变走的
    # 平滑面，而不是"一块均匀色" —— 上一版直接用上方草地整块贴，左上留了个亮斑、
    # 底部留了一道灰带，就是因为源块自带的光斑和暗部被原样搬了过去。
    low = laplace_fill(patch, fill, iters=500)
    # 高频：从上方草地取纹理（左移 24px 避开右上角那截栅栏），只取细节不取明暗
    sy = max(0, t - bh)
    src = a[sy:t, l - 24:r - 24].astype(np.float32)
    if src.shape[:2] != patch.shape[:2]:
        src = a[sy:t, l:r].astype(np.float32)
    sm = np.array(Image.fromarray(src.astype(np.uint8)).filter(ImageFilter.GaussianBlur(22))).astype(np.float32)
    tex = src - sm
    tex = np.roll(tex, (bh // 2, 0), axis=(0, 1))       # 挪半块，避免和上方草地纹理完全接上
    out_patch = low + tex * 0.5
    out_patch += np.random.default_rng(7).normal(0, 1.6, out_patch.shape)

    soft = np.array(Image.fromarray((fill * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12))).astype(np.float32) / 255.0
    soft = np.maximum(soft, fill.astype(np.float32))
    mixed = out_patch * soft[:, :, None] + patch * (1 - soft[:, :, None])
    out = a.copy()
    out[t:b, l:r] = np.clip(mixed, 0, 255).astype(np.uint8)

    # ---- 3. 贴到新位置 ----
    layer = Image.fromarray(out).convert('RGBA')
    layer.alpha_composite(sign, (l + DX, t + DY))

    # ---- 4. 补接地阴影：两条腿底下各一个软椭圆 ----
    shadow = Image.new('RGBA', sign.size, (0, 0, 0, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(shadow)
    # 抠图坐标系里腿底约 y=152，两条腿 x≈32 / 140（值随 BOX 走，这里按比例取）
    foot_y = int(bh * 0.91)
    for fx in (0.19, 0.80):
        cx = int(bw * fx)
        for i in range(9, 0, -1):
            k = i / 9.0
            d.ellipse([cx - 20 * k, foot_y - 5 * k, cx + 20 * k, foot_y + 5 * k],
                      fill=(38, 26, 16, int(26 * (1 - k) + 6)))
    blur = shadow.filter(ImageFilter.GaussianBlur(4))
    layer.alpha_composite(blur, (l + DX, t + DY))

    # ---- 5. 前景回贴：那朵虚化大花在镜头前，应该压在牌**上面** ----
    # 不处理的话牌会"穿过"花瓣 —— 两张图立刻读成不是一个空间。
    # 从原图取同一位置的花瓣像素盖回来（那块在原图里是干净的：原牌右缘 1325，
    # 而这块从 1335 起）。用花瓣颜色而非矩形取 mask，否则会连牌的主体一起切掉。
    fx0 = r - 1
    fx1 = a.shape[1]                     # 一直取到画面右缘：矩形右边界落在牌上会留一条白竖边
    fy0 = 630
    fy1 = min(a.shape[0], 860)
    if fx1 > fx0 and fy1 > fy0:
        sub = a[fy0:fy1, fx0:fx1].astype(np.int32)
        mx = sub.max(2)
        mn = sub.min(2)
        petal = (mx > 200) & (sub[:, :, 1] > 180) & (sub[:, :, 2] > 165) & ((mx - mn) < 70)
        petal = dilate(petal, 15)
        am = Image.fromarray((petal * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12))
        fg = Image.fromarray(sub.astype(np.uint8)).convert('RGBA')
        fg.putalpha(am)
        layer.alpha_composite(fg, (fx0, fy0))
        print('[sign] petal fetch-back', int(petal.sum()), 'px')

    # 原图是 RGBA（alpha 全 255）。转成 RGB 视觉无损，但会改文件格式，
    # Cocos 侧再走一次导入可能生成不同的 .meta —— 保持原样最省事。
    layer.convert('RGBA').save(SRC)
    print('[sign] saved', SRC, 'moved dx=%d dy=%d' % (DX, DY))

    # 对比图
    before = Image.open('shots/_bg-before.png')
    l2 = (l - 40, t - 30, r + DX + 40, b + 30)
    cmp = Image.new('RGB', (l2[2] - l2[0], (l2[3] - l2[1]) * 2 + 10), 'white')
    cmp.paste(before.crop(l2), (0, 0))
    cmp.paste(layer.convert('RGB').crop(l2), (0, l2[3] - l2[1] + 10))
    cmp.save('shots/_sign-move-cmp.png')


if __name__ == '__main__':
    main()
