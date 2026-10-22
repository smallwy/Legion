# -*- coding: utf-8 -*-
"""把 ImageGen 出的敌人立绘（品红底）处理成 4x 游戏贴图。

流程与 prep_pets.py 同源（采四角背景色 → 涂水印 → 抠底 → 去紫边 → 裁边），
但**不做统一体高** —— 六只宠物要并排站，必须一样高；敌人本来就大小不一
（幼虫 26 / 毛毛虫 44 / 野猪 56），统一体高反而会把虫子和野猪拉成一样大。

**视觉尺寸与碰撞尺寸分离**：
  FOES 里的 `w/h` 是**碰撞盒**（GroveRuntime 的 f.w / f.h），决定球能不能撞上；
  这里的 `vw/vh` 是**画多大**。两者不必相等 ——
  一只横着爬的毛毛虫碰撞是 34×28，但画出来 44×28 才像个虫。
  改视觉尺寸不影响任何玩法断言。

用法：
  python client/tools/prep_foes.py            # 只出预览接触表
  python client/tools/prep_foes.py --write    # 同时写进 assets/resources/grove
"""
import glob
import io
import os
import sys

from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "concept", "foes")
OUT = os.path.join(ROOT, "shots")

S = 4                       # 4x：与 badge-* / UI 同一套超采样口径

# key = GroveRuntime 里 FOES 的 id；vw/vh 是**画出来的**尺寸（显示像素）
# src 显式写文件名：ImageGen 的产物是时间戳命名，靠 glob 猜"哪个是 bug"迟早拿错图。
FOES = {
    "bug":  {"vw": 44, "vh": 28, "src": "Q_version_hand_painted_waterco_2026-10-22T08-37-11.png"},
    "crow": {"vw": 42, "vh": 34, "src": None},
    "boar": {"vw": 62, "vh": 44, "src": None},
    "larva":{"vw": 30, "vh": 24, "src": None},
}


def corners(im):
    w, h = im.size
    n = max(4, int(w * 0.03))
    out = []
    for box in ((0, 0, n, n), (w - n, 0, w, n), (0, h - n, n, h), (w - n, h - n, w, h)):
        out.append(im.crop(box).resize((1, 1), Image.BOX).getpixel((0, 0)))
    return out


def kill_watermark(im, bgs):
    """右下角「AI生成 WORKBUDDY」是浅色字压在品红上，抠底时会整块留下。
    只在 x > 72% / y > 90% 的角落动手，判据是「明显比背景亮」。"""
    w, h = im.size
    px = im.load()
    base = tuple(sum(c[i] for c in bgs) / len(bgs) for i in range(3))
    for y in range(int(h * 0.90), h):
        for x in range(int(w * 0.72), w):
            p = px[x, y]
            if sum(p[:3]) / 3 > sum(base) / 3 + 26:
                px[x, y] = (int(base[0]), int(base[1]), int(base[2]), p[3] if len(p) > 3 else 255)
    return im


def keyout(im, bgs):
    """按「与四角背景色的最小色差」判背景。写死 #FF00FF 会漏 —— AI 每次给的品红都不一样。"""
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            d = min((p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2 for b in bgs)
            if d < 62 ** 2:
                px[x, y] = (0, 0, 0, 0)
            elif d < 96 ** 2:
                # 边缘过渡：把品红分量按距离撤掉，避免一圈紫边
                t = (d - 62 ** 2) / (96 ** 2 - 62 ** 2)
                px[x, y] = (p[0], p[1], p[2], int(255 * t))
    return im


def despill(im):
    """品红底抠完，边缘常留一圈紫红镶边。判据：R 与 B 同时高、G 明显低。
    把多出来的 R/B 往 G 拉回来，不改 alpha。"""
    w, h = im.size
    px = im.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if p[3] < 8:
                continue
            r, g, b = p[0], p[1], p[2]
            if r > g + 18 and b > g + 18:
                m = (r + b) // 2
                px[x, y] = (min(r, g + 10), g, min(b, g + 10), p[3])
    return im


def fit(im, vw, vh):
    """等比缩放到能装进 vw*S × vh*S 的最大尺寸，居中，四周留透明。
    **不拉伸** —— 拉伸会让描边粗细在横竖方向不一致，一眼看出是硬塞的。"""
    tw, th = vw * S, vh * S
    bb = im.getbbox()
    im = im.crop(bb)
    k = min(tw / im.width, th / im.height)
    nw, nh = max(1, round(im.width * k)), max(1, round(im.height * k))
    im = im.resize((nw, nh), Image.LANCZOS)
    lay = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    lay.alpha_composite(im, ((tw - nw) // 2, (th - nh) // 2))
    return lay


def main():
    write = "--write" in sys.argv
    print("处理敌人立绘（4x）：")
    for key, cfg in FOES.items():
        if not cfg["src"]:
            print("  %-6s 跳过（还没出图）" % key)
            continue
        cand = [os.path.join(SRC, cfg["src"])]
        if not os.path.exists(cand[0]):
            print("  %-6s 跳过（找不到 %s）" % (key, cfg["src"]))
            continue
        im = Image.open(cand[-1]).convert("RGBA")
        bgs = corners(im)
        im = kill_watermark(im, bgs)
        im = keyout(im, bgs)
        im = despill(im)
        lay = fit(im, cfg["vw"], cfg["vh"])
        bb = lay.getchannel("A").getbbox()
        print("  %-6s ← %-28s  %dx%d  显示 %dx%d  alpha=%s"
              % (key, os.path.basename(cand[-1])[:28], lay.width, lay.height,
                 cfg["vw"], cfg["vh"], bb))
        if write:
            dst = os.path.join(ROOT, "assets", "resources", "grove", "foe-%s.png" % key)
            lay.save(dst)
            print("         → %s" % os.path.relpath(dst, ROOT))
        else:
            OUTD = os.path.join(OUT, "_foe-preview")
            os.makedirs(OUTD, exist_ok=True)
            lay.save(os.path.join(OUTD, "foe-%s.png" % key))
    if not write:
        print("\n只出预览：shots/_foe-preview/。加 --write 写进 assets。")


if __name__ == "__main__":
    main()
