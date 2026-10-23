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

PET_H = 292          # 立绘目标**图高**（不是体高）。
                     # 新立绘按 640 高、体高 420 出图（见 tools/prep_pets.py），
                     # 体高只占图高的 65.6%，所以图高要放到 292 才能让
                     # 画出来的身体还是原来那么大（292 × 0.656 ≈ 192）。
                     # 上一版这里写 192，是拿旧素材的口径（bbox 撑满图）套新图，
                     # 结果六只集体缩水三分之一。
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
    """name 用 `父目录/文件名` 的形式：资源已按用途分成 pet/head/foe/ui 四类。
    这里的落盘路径必须和 GroveBattle.ts 的 ART_MANIFEST 一字不差，
    改完跑 `node tools/check-resources.js` 对一遍。"""
    path = os.path.join(OUT, *name.split('/')) + '.png'
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
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


def pet_scale(src, h):
    """立绘**不裁 bbox**，整图等比缩。

    预处理（tools/prep_pets.py）产出的六张已经是"统一图高、统一体高、脚底贴底"，
    裁掉 bbox 等于把"留白"这个对齐基准扔掉 —— 又回到"兔子比仓鼠小一圈"。
    头像走 fit_s 没关系：那六张是满圆的，bbox 本来就是全图。
    """
    k = h / src.height
    return src.resize((max(1, round(src.width * k)), h), Image.LANCZOS)


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
    im = pet_scale(Image.open(src).convert('RGBA'), PET_H)
    n = save(im, 'pet/' + hid)
    total += n
    rows.append(('pet-' + hid, im.size, n))

for hid, art in HEROES.items():
    src = os.path.join(SRC, 'home', 'heads-circle', art + '.png')
    im = fit_s(Image.open(src).convert('RGBA'), HEAD_S)
    n = save(im, 'head/' + hid)
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
    n = save(im, 'ui/' + name[3:])   # 'ui-pip' -> 'ui/pip'
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
    n = save(im, 'ui/' + name[3:])   # 'ui-pip' -> 'ui/pip'
    total += n
    rows.append((name, im.size, n))

print('输出 %s' % OUT)
for name, size, n in rows:
    print('  %-12s %-9s %6.1f KB' % (name, '%dx%d' % size, n / 1024))
print('  合计 %.1f KB / %d 张' % (total / 1024, len(rows)))
