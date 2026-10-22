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

**为什么要描边（v2 加的，第一版漏了）**：
  第一版只做了「抠底 → 装框」，出图后摆进草地立刻发现读不出来 ——
  AI 的水彩边缘是渐隐的，主体又偏中灰调，铺在饱和的深绿草地上就"化"进去了。
  旧的三档色代码图形虽然有"塑料感"，但它是靠 `COL.outline`（#3A2B44）深描边
  撑起剪影的，34px 下一眼能数清有几只。
  所以这里补两步后处理，**不换图、不重出，只做管线修正**：
    · outline() —— 按 alpha 外扩 gen 一圈墨线，和全场景的 COL.outline 同色；
    · punch()   —— 对比度/饱和度微抬 + 亮度微压，把主体从草地的中明度里拔出来。
  这两步对四只敌人**用同一组数值**（只有描边宽度按体高微调）—— 家族一致性优先。

用法：
  python client/tools/prep_foes.py            # 只出预览接触表
  python client/tools/prep_foes.py --write    # 同时写进 assets/resources/grove
"""
import glob
import io
import os
import sys

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "concept", "foes")
OUT = os.path.join(ROOT, "shots")

S = 4                       # 4x：与 badge-* / UI 同一套超采样口径

# 描边墨色与 GroveRuntime 的 COL.outline 完全一致。
# 换成别的颜色（纯黑、比自己暗的同类色）都会让敌人看起来"不属于这个世界"。
INK = (0x3A, 0x2B, 0x44)

# 后处理强度 —— 四只敌人共用，不许各自调。
# 依据不是审美，是**量出来的明度差**（前景 alpha>200 像素的平均色 vs 背景）：
#   bug   (189,176, 44) lum 165   ← 草地 lum 152，只差 13，色相又都是绿 → 糊
#   crow  (149,128,123) lum 136   ← 比草地暗 16，且 R/G/B 差 26（灰）→ 一块灰斑
#   boar  (189,115, 36) lum 128   ← 暗 24，够了
#   larva (206,209,100) lum 189   ← 亮 37，够了
# 也就是说：不是全局"太暗"，而是 AI 给的水彩整体**彩度偏低**，
# 旧的三档色代码图形 c1 明度 178 + 纯色块，所以 34px 下反而更好读。
# 亮度只微抬（压暗是错的方向，第一版试过，越压越融）；
# 重点走 vivid 的 S 曲线 —— 对明暗结构无损，只把"灰调"拉回"彩调"。
PUNCH = dict(contrast=1.12, color=1.00, bright=1.06)
VIVID = dict(boost=1.45, gamma=0.80)

# key = GroveRuntime 里 FOES 的 id；vw/vh 是**画出来的**尺寸（显示像素）
# src 显式写文件名：ImageGen 的产物是时间戳命名，靠 glob 猜"哪个是 bug"迟早拿错图。
FOES = {
    # `flip`：**立绘必须朝右**。drawFoe 只画朝右的版本，靠 g.scale(f.face, 1)
    # 镜像翻面（与宠物同一套规矩，否则三套造型要写三份代码）。
    # 所以图朝左 = 走起来倒着爬 —— 这正是刺毛虫第一版的 bug。
    #
    # 朝向只能**逐张人工确认**：把贴图放大 3 倍看脸朝哪边（眼睛、嘴、尾角在哪侧）。
    # 不能靠代码判断，也不能假设"同一批提示词出图朝向一致" —— 实测这一批
    # 四张里三张朝右、刺毛虫朝左，模型是按构图提示词自由发挥的。
    "bug":  {"vw": 44, "vh": 28, "flip": True,
             "src": "Q_version_hand_painted_waterco_2026-10-22T08-37-11.png"},
    "crow": {"vw": 42, "vh": 34, "src": "Q_version_hand_painted_waterco_2026-10-22T08-44-08.png"},
    # 野猪是 charge 型（唯一会主动冲锋撞人的小怪），视觉上必须有压迫感。
    # 62×44 与宠物（73 高）太接近，同框会读成"第四只宠物"；
    # 放大到 76×54 —— **碰撞盒仍是 FOES.boar 的 56×40，一点没动**，
    # 多出来的部分只是视觉溢出（和 bug 的 34 碰撞 / 44 视觉同一个道理）。
    "boar": {"vw": 76, "vh": 54, "src": "Q_version_hand_painted_waterco_2026-10-22T08-44-53.png"},
    "larva":{"vw": 30, "vh": 24, "src": "Q_version_hand_painted_waterco_2026-10-22T08-45-20.png"},
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


def fit(im, vw, vh, ow):
    """等比缩放到能装进 vw*S × vh*S 的最大尺寸，居中，四周留透明。
    **不拉伸** —— 拉伸会让描边粗细在横竖方向不一致，一眼看出是硬塞的。

    ow 是描边外扩宽度（4x 像素）。内容要预留 2*ow 的空间，
    否则描边会被画布裁掉一圈 —— 表现为"只有上边有边、下边没有"。"""
    tw, th = vw * S, vh * S
    bb = im.getbbox()
    im = im.crop(bb)
    iw, ih = tw - 2 * ow, th - 2 * ow
    k = min(iw / im.width, ih / im.height)
    nw, nh = max(1, round(im.width * k)), max(1, round(im.height * k))
    im = im.resize((nw, nh), Image.LANCZOS)
    lay = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    lay.alpha_composite(im, ((tw - nw) // 2, (th - nh) // 2))
    return lay


def punch(im, contrast=1.0, color=1.0, bright=1.0):
    """对比度 / 饱和度 / 亮度。**只动 RGB，alpha 原样搬过去** ——
    ImageEnhance 作用在 RGBA 上会把透明区的 RGB 也拉一遍，
    在 1px 边缘上表现为一圈脏色（抠底留下的品红底噪被放大）。"""
    a = im.getchannel("A")
    r = im.convert("RGB")
    r = ImageEnhance.Contrast(r).enhance(contrast)
    r = ImageEnhance.Color(r).enhance(color)
    r = ImageEnhance.Brightness(r).enhance(bright)
    r = r.convert("RGBA")
    r.putalpha(a)
    return r


def vivid(im, boost=1.0, gamma=1.0):
    """逐像素提饱和度（走 HSV 的 S 通道，带 gamma 曲线）。

    为什么不用 ImageEnhance.Color：它是**乘法**，S=0.12 的灰紫乘 1.45 还是 0.17，
    等于没动。而"灰调"恰恰是这批水彩立绘最需要救的地方 ——
    乌鸦 mean (149,128,123)，R/G/B 差不到 26，在饱和的草地上就是一块灰斑。

    gamma < 1 把中间饱和度顶得多、高饱和保住，避免整体过艳变塑料。
    明度（V）一律不碰：明暗结构是画里的东西，动了就假。
    """
    if boost == 1.0 and gamma == 1.0:
        return im
    a = im.getchannel("A")
    h, s, v = im.convert("RGB").convert("HSV").split()
    lut = [min(255, int(round(pow(x / 255.0, gamma) * 255 * boost))) for x in range(256)]
    out = Image.merge("HSV", (h, s.point(lut), v)).convert("RGB").convert("RGBA")
    out.putalpha(a)
    return out


def outline(im, ow, ink=INK):
    """按 alpha 外扩 gen 一圈墨线，画在原图**下面**（原图盖住内侧一半）。

    为什么不用 MaxFilter：它是方形掩膜，半径一大就出直角，虫子的圆肚子
    会变成圆角矩形。用「高斯模糊 + 阈值」等效于圆形膨胀，再补一次微模糊
    把阈值产生的硬边磨掉（描边外缘要有 1px 抗锯齿，否则缩到 28px 会闪）。"""
    a = im.getchannel("A")
    grown = a.filter(ImageFilter.GaussianBlur(ow * 0.62))
    grown = grown.point(lambda v: 255 if v > 110 else 0)
    grown = grown.filter(ImageFilter.GaussianBlur(max(0.8, ow * 0.30)))

    layer = Image.new("RGBA", im.size, (ink[0], ink[1], ink[2], 0))
    layer.putalpha(grown)

    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.alpha_composite(layer)
    out.alpha_composite(im)
    return out


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
        # 翻面必须排在 kill_watermark **之后**：AI 出的图水印在右下角，
        # 那一块是被 kill_watermark 按"右下象限"涂掉的。先翻的话水印跑到左下，
        # 涂抹区打空，紫品红底噪会留在图里。
        if cfg.get("flip"):
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        im = keyout(im, bgs)
        im = despill(im)

        # 描边宽度：**按显示体高定**，不按贴图尺寸。
        # 28 高的虫子和 44 高的野猪用同一根 6px(4x) 线，虫子的相对线宽就粗一倍，
        # 看起来像"描边重、脸小"；所以小虫子要细、大野猪要粗，视觉线宽才齐。
        # 系数 0.065 是量出来的：宠物立绘（pet-cat 292px）自身的画内描边折合显示
        # 约 2.4px，2.4 / 73 ≈ 0.033 —— 但宠物是"整幅画"的描边，敌人要额外
        # 承担"从草地背景里分离"的职责，所以取近 2 倍。第一版取 0.045 实测偏细，
        # 同框时一眼看得出"宠物有墨线、敌人像贴纸"。
        ow = round(max(1.5, min(2.6, cfg["vh"] * 0.065)) * S)
        lay = fit(im, cfg["vw"], cfg["vh"], ow)
        lay = punch(lay, **PUNCH)
        lay = vivid(lay, **VIVID)
        lay = outline(lay, ow)
        bb = lay.getchannel("A").getbbox()
        print("  %-6s ← %-28s  %dx%d  显示 %dx%d  ow=%.1fpx  内容=%s"
              % (key, os.path.basename(cand[-1])[:28], lay.width, lay.height,
                 cfg["vw"], cfg["vh"], ow / S, bb))
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
