# -*- coding: utf-8 -*-
"""
把主界面的美术图收缩一份给战斗场景用，输出到 assets/resources/grove/。

为什么是"复制+缩放"而不是直接引用原图：
  1. 主界面（Home.scene）是**场景直连 spriteFrame**，动原图有断引用风险，不碰；
  2. 战斗里我方单位只有 44px 高，640px 的立绘纯属浪费 ——
     立绘缩到高 192（显示尺寸的 4 倍，缩小采样不糊），
     头像缩到 96（显示 44px），体积从 3.5MB 降到 200KB 级；
  3. resources 目录才能用 resources.load 动态加载，ui/ 目录不行。

名字映射（美术文件 → grove 的 heroId）：
  sugar-stand  → cat  尖耳猫
  nian-gao-dog → dog  短尾犬
  tuan-zi-ham  → ham  胖仓鼠
  xue-tuan-rab → rab  长耳兔
  dou-nai-ox   → ox   老实牛
  xing-xie-fox → fox  影狐

用法：<venv>/Scripts/python.exe client/tools/gen_grove_art.py
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'ui')
OUT = os.path.join(ROOT, 'assets', 'resources', 'grove')

HEROES = {
    'cat': 'sugar-stand',
    'dog': 'nian-gao-dog',
    'ham': 'tuan-zi-ham',
    'rab': 'xue-tuan-rab',
    'ox': 'dou-nai-ox',
    'fox': 'xing-xie-fox',
}

PET_H = 192          # 立绘目标高度
HEAD_S = 96          # 圆头像边长
UI_SIZES = {         # 小图标目标边长
    'ui-pip': 38,
    'ui-pip-on': 38,
    'ui-coin': 32,
    'ui-star': 56,
    'ui-arrow': 64,
    'ui-ring': 104,
}

# 面板类：按**高度**收敛，宽度按比例走（九宫格拉伸用，角部要够清晰）
#   存的尺寸 ≈ 显示尺寸的 1.5~2 倍：再大是浪费（canvas 只有 960x600），
#   再小九宫格的圆角会糊。
PANEL_SIZES = {
    'ui-tip':    {'h': 96},    # panel-hud-tip   左上角色卡 / 提示条
    'ui-cream':  {'h': 96},    # panel-cream     右上目标卡
    'ui-prog':   {'h': 72},    # panel-hud-prog  关卡进度条
    'ui-res':    {'h': 420},   # panel-res       结算卡片
    'ui-belly':  {'h': 52},    # belly-bar       肚子条
    'ui-btn':    {'h': 96},    # btn-go          主按钮
}

os.makedirs(OUT, exist_ok=True)


def save(img, name):
    path = os.path.join(OUT, name + '.png')
    img.save(path, 'PNG', optimize=True)
    return os.path.getsize(path)


def fit_h(src, h):
    # 先裁掉透明 padding。面板图四周留了几个像素的空边，
    # 不裁的话九宫格会把这些空边一起拉伸 —— 画出来面板底下多一条半透明的带子。
    bb = src.getbbox()
    if bb:
        src = src.crop(bb)
    w, hh = src.size
    return src.resize((max(1, round(w * h / hh)), h), Image.LANCZOS)


def fit_s(src, s):
    bb = src.getbbox()
    if bb:
        src = src.crop(bb)
    w, h = src.size
    k = s / max(w, h)
    return src.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


total = 0
rows = []

for hid, art in HEROES.items():
    src = os.path.join(SRC, 'home', 'pets', art + '.png')
    im = fit_h(Image.open(src).convert('RGBA'), PET_H)
    n = save(im, 'pet-' + hid)
    total += n
    rows.append(('pet-' + hid, im.size, n))

for hid, art in HEROES.items():
    src = os.path.join(SRC, 'home', 'heads-circle', art + '.png')
    im = fit_s(Image.open(src).convert('RGBA'), HEAD_S)
    n = save(im, 'head-' + hid)
    total += n
    rows.append(('head-' + hid, im.size, n))

for name, src_rel in [
    ('ui-pip', 'home/pip.png'),
    ('ui-pip-on', 'home/pip-on.png'),
    ('ui-coin', 'icons/coin.png'),
    ('ui-star', 'home/star.png'),
    ('ui-arrow', 'home/tip-arrow.png'),
    ('ui-ring', 'home/badge-ring.png'),
]:
    src = os.path.join(SRC, *src_rel.split('/'))
    im = fit_s(Image.open(src).convert('RGBA'), UI_SIZES[name])
    n = save(im, name)
    total += n
    rows.append((name, im.size, n))

for name, src_rel in [
    ('ui-tip', 'home/panel-hud-tip.png'),
    ('ui-cream', 'home/panel-cream.png'),
    ('ui-prog', 'home/panel-hud-prog.png'),
    ('ui-res', 'home/panel-res.png'),
    ('ui-belly', 'home/belly-bar.png'),
    ('ui-btn', 'home/btn-go.png'),
]:
    src = os.path.join(SRC, *src_rel.split('/'))
    im = fit_h(Image.open(src).convert('RGBA'), PANEL_SIZES[name]['h'])
    n = save(im, name)
    total += n
    rows.append((name, im.size, n))

print('输出 %s' % OUT)
for name, size, n in rows:
    print('  %-12s %-9s %6.1f KB' % (name, '%dx%d' % size, n / 1024))
print('  合计 %.1f KB / %d 张' % (total / 1024, len(rows)))
