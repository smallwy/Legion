# -*- coding: utf-8 -*-
"""
PAWPACK 原型期占位精灵预处理（Day 1）
输入：D:/Legion/assets/placeholder/sprite-pet-v2.png, sprite-monster-v2.png
输出：D:/Legion/client/assets/resources/art/*.png（透明背景，供 Cocos resources.load 使用）

处理：
1. pet.png      —— 洪水填充去掉白色背景 → alpha 0，按内容裁剪
2. enemy-walker.png —— 怪物原图（绿色）去米白背景 → alpha 0
3. enemy-flyer.png  —— 怪物色相旋转变红（飞虫 #C0392B 方向）
4. enemy-tank.png   —— 怪物去饱和偏灰蓝（甲虫 #34495E 方向）

仅原型期内部试玩用途；正式发布前必须替换为买/外包成品（见计划书 §6.3 / 美术指引 §11）。
"""
import colorsys
import os
from PIL import Image, ImageDraw

SRC_DIR = "D:/Legion/assets/placeholder"
OUT_DIR = "D:/Legion/client/assets/resources/art"
SENTINEL = (255, 0, 255)  # 临时哨兵色（洪水填充目标），随后抠掉


def key_out_background(im: Image.Image, thresh: int = 45) -> Image.Image:
    """把四角连通到边框的近背景色区域抠成透明。洪水填充只吃与边框连通的部分，
    生物体内部的浅色高光不受影响。"""
    im = im.convert("RGB")
    w, h = im.size
    draw = ImageDraw.Draw(im)
    for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        try:
            ImageDraw.floodfill(im, xy, SENTINEL, thresh=thresh)
        except Exception:
            pass
    im = im.convert("RGBA")
    px = im.load()
    n_keyed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r > 240 and g < 20 and b > 240:  # 哨兵色
                px[x, y] = (0, 0, 0, 0)
                n_keyed += 1
    print(f"    keyed {n_keyed} background px")
    return im


def autocrop(im: Image.Image, pad: int = 2) -> Image.Image:
    bbox = im.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("autocrop failed: image fully transparent (background flood ate the sprite?)")
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(im.width, x1 + pad); y1 = min(im.height, y1 + pad)
    return im.crop((x0, y0, x1, y1))


def hue_rotate(im: Image.Image, dh: float, sat_mul: float = 1.0, val_mul: float = 1.0) -> Image.Image:
    """对不透明像素做 HSV 色相旋转；保持明暗结构，只改色相。"""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            hh = (hh + dh) % 1.0
            ss = min(1.0, ss * sat_mul)
            vv = min(1.0, vv * val_mul)
            nr, ng, nb = colorsys.hsv_to_rgb(hh, ss, vv)
            px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return im


def report(name, im):
    a = im.getchannel("A")
    opaque = sum(1 for v in a.getdata() if v > 0)
    print(f"  {name}: {im.size} mode={im.mode} opaque_px={opaque} ({100.0*opaque/(im.width*im.height):.1f}%)")


os.makedirs(OUT_DIR, exist_ok=True)

print("[1/4] pet.png —— 贪吃鼠占位（粉色小猪，去白底）")
pet = key_out_background(Image.open(os.path.join(SRC_DIR, "sprite-pet-v2.png")))
pet = autocrop(pet)
pet.save(os.path.join(OUT_DIR, "pet.png"))
report("pet.png", pet)

print("[2/4] enemy-walker.png —— 步行虫占位（原绿色，去米白底）")
walker = key_out_background(Image.open(os.path.join(SRC_DIR, "sprite-monster-v2.png")))
walker = autocrop(walker)
walker.save(os.path.join(OUT_DIR, "enemy-walker.png"))
report("enemy-walker.png", walker)

print("[3/4] enemy-flyer.png —— 飞虫占位（色相转红）")
flyer = hue_rotate(walker.copy(), dh=-0.33, sat_mul=1.15, val_mul=0.82)
flyer.save(os.path.join(OUT_DIR, "enemy-flyer.png"))
report("enemy-flyer.png", flyer)

print("[4/4] enemy-tank.png —— 甲虫占位（色相转灰蓝）")
tank = hue_rotate(walker.copy(), dh=0.28, sat_mul=0.55, val_mul=0.85)
tank.save(os.path.join(OUT_DIR, "enemy-tank.png"))
report("enemy-tank.png", tank)

print("DONE ->", OUT_DIR)
