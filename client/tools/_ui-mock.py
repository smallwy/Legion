# -*- coding: utf-8 -*-
"""把「交互热点家族规格」画回主界面截图，产出可直接看的效果图。

规格里的数字（56×56 方牌 / 3px 描边 / 12px 缎带 / 出门按钮厚度）在文字里都是抽象的，
只有贴回 1280×720 才判断得了。

两个实现坑（都踩过）：
  1. PIL 的 rounded_rectangle(outline=..., width=n) 在圆角处会画成直角拐角，
     缎带上会出现"凸起的小耳朵"。**描边必须用「大矩形填深色 + 内缩小矩形填亮色」**。
  2. 牌面纯色 = 纸片。厚度来自三件套：竖向渐变 + 深描边 + 落影，缺一件就塌。

跑法（在 client/ 下）：
  python tools/_ui-mock.py shots/_home-rt.png shots/ui-bench/22-主界面-设计感改后.png
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont, ImageFilter

CLIENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ---------- 规格色 ----------
PAL = {
    "cream": {  # 白陶：和 Dock 的卡片同一档白，工整、UI 感强
        "top": (255, 250, 238), "bot": (238, 216, 186), "line": (110, 70, 44),
    },
    "wood": {   # 暖木：融进场景，读作"路标同族的木牌"
        "top": (231, 198, 152), "bot": (203, 158, 108), "line": (122, 78, 42),
    },
    "warm": {   # 暖奶油：白陶的骨架 + 木牌的暖调（推荐）
        "top": (255, 246, 226), "bot": (242, 220, 184), "line": (104, 64, 36),
    },
}
THEME = "cream"

FACE_TOP = PAL["cream"]["top"]
FACE_BOT = PAL["cream"]["bot"]
LINE = PAL["cream"]["line"]
INK = (138, 90, 50)
TXT = (74, 44, 20)

FONT = "C:/Windows/Fonts/msyh.ttc"
FONT_B = "C:/Windows/Fonts/msyhbd.ttc"


def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def vgrad(w, h, top, bot):
    g = Image.new("RGB", (1, h))
    for i in range(h):
        t = i / max(1, h - 1)
        g.putpixel((0, i), tuple(int(top[k] + (bot[k] - top[k]) * t) for k in range(3)))
    return g.resize((w, h))


def ring_frame(size, radius, edge, top, bot):
    """带描边的圆角板：外层填描边色，内层填渐变。完美描边，无拐角。"""
    lay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    lay.paste(Image.new("RGB", (size, size), LINE), (0, 0), m)

    iw = size - edge * 2
    inner = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    im_ = Image.new("L", (size, size), 0)
    ImageDraw.Draw(im_).rounded_rectangle(
        [edge, edge, size - 1 - edge, size - 1 - edge],
        radius=max(1, radius - edge), fill=255)
    inner.paste(vgrad(iw, iw, top, bot), (edge, edge), im_.crop((edge, edge, edge + iw, edge + iw)))
    lay.alpha_composite(inner)
    return lay


def plate(dst, cx, cy, size=56, radius=14, edge=3):
    """S 件招牌：落影 → 描边板身 → 顶部内高光。"""
    pad = 40
    ox = oy = pad // 2

    sh = Image.new("RGBA", (size + pad, size + pad), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [ox, oy + 3, ox + size - 1, oy + size + 2], radius=radius, fill=(88, 54, 28, 78))
    dst.alpha_composite(sh.filter(ImageFilter.GaussianBlur(3)), (cx - ox, cy - oy))

    dst.alpha_composite(ring_frame(size, radius, edge, FACE_TOP, FACE_BOT), (cx - size // 2, cy - size // 2))

    # 顶部内高光：一条两端收窄的亮带，只在上 42%
    hw = size - edge * 2 - 8
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(hl).rounded_rectangle(
        [edge + 5, edge + 4, size - edge - 6, edge + 4 + (size // 3)],
        radius=max(2, radius - 6), fill=(255, 255, 255, 92))
    hm = Image.new("L", (size, size), 0)
    ImageDraw.Draw(hm).ellipse(
        [-size, -size * 0.9, size * 2, size * 0.62], fill=255)
    hl.putalpha(Image.composite(hl.getchannel("A"), Image.new("L", (size, size), 0), hm))
    dst.alpha_composite(hl, (cx - size // 2, cy - size // 2))


def ribbon(dst, cx, top, tw, h=26, radius=7, edge=3, min_w=0):
    """名字底板。

    **形态回到原设计的椭圆胶囊**（radius = h/2 全圆头），不用小圆角方条。
    上一版做成 radius 6 的方条，理由是"与 12 圆角的方牌同族"，
    但实测读起来像优惠券/价签，而且和场景里路标的圆头木牌不是一套语言。
    形状保持原样，**只修那两处真正断层的参数**：描边 0.75 → 3px、字号 11 → 12。

    宽度仍然随文字走（原来是 37/48），因为胶囊一旦拉到牌宽就变成
    第二条方形牌，反而更像"两块板叠着"。min_w 兜底防止 2 字胶囊过窄。"""
    w = int(round(max(tw + 14, min_w)))
    radius = min(radius, h // 2)
    pad = 24
    ox = oy = pad // 2
    lay = Image.new("RGBA", (w + pad, h + pad), (0, 0, 0, 0))
    ImageDraw.Draw(lay).rounded_rectangle(
        [ox, oy + 2, ox + w - 1, oy + h + 1], radius=radius, fill=(88, 54, 28, 62))
    lay.alpha_composite(ring_frame(w, radius, edge, FACE_TOP, FACE_BOT), (ox, oy))
    dst.alpha_composite(lay.filter(ImageFilter.GaussianBlur(0.4)), (cx - w // 2 - ox, top - oy))
    return w


def go_button(dst, x0, y0, w, h, radius=38):
    pad = 44
    ox = oy = pad // 2

    sh = Image.new("RGBA", (w + pad, h + pad), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [ox, oy + 4, ox + w - 1, oy + h + 3], radius=radius, fill=(116, 66, 26, 84))
    dst.alpha_composite(sh.filter(ImageFilter.GaussianBlur(6)), (x0 - ox, y0 - oy))

    body = Image.new("RGBA", (w + pad, h + pad), (0, 0, 0, 0))
    m = Image.new("L", (w + pad, h + pad), 0)
    ImageDraw.Draw(m).rounded_rectangle([ox, oy, ox + w - 1, oy + h - 1], radius=radius, fill=255)
    body.paste(vgrad(w, h, (255, 202, 96), (240, 156, 58)), (ox, oy), m.crop((ox, oy, ox + w, oy + h)))

    # 底部内阴影：厚度的唯一来源
    inner = Image.new("RGBA", (w + pad, h + pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(inner)
    d.rounded_rectangle([ox + 4, oy + 4, ox + w - 5, oy + h - 5], radius=radius - 4,
                        fill=(142, 82, 24, 96))
    d.rounded_rectangle([ox + 12, oy + 12, ox + w - 13, oy + h - 13], radius=radius - 12,
                        fill=(0, 0, 0, 0))
    mm = Image.new("L", (w + pad, h + pad), 0)
    ImageDraw.Draw(mm).rectangle([0, 0, w + pad, oy + int(h * 0.58)], fill=255, width=0)
    ImageDraw.Draw(mm).rectangle([0, 0, w + pad, oy + int(h * 0.58)], fill=0)
    # 上半遮掉 → 只剩底部
    mm2 = Image.new("L", (w + pad, h + pad), 0)
    ImageDraw.Draw(mm2).rectangle([0, oy + int(h * 0.55), w + pad, h + pad], fill=255)
    inner.putalpha(Image.composite(inner.getchannel("A"), Image.new("L", (w + pad, h + pad), 0), mm2))
    body.alpha_composite(inner)

    # 顶部内高光
    hi = Image.new("RGBA", (w + pad, h + pad), (0, 0, 0, 0))
    ImageDraw.Draw(hi).rounded_rectangle([ox + 8, oy + 8, ox + w - 9, oy + h - 9],
                                         radius=radius - 8, fill=(255, 255, 255, 74))
    m3 = Image.new("L", (w + pad, h + pad), 0)
    ImageDraw.Draw(m3).rectangle([0, oy + int(h * 0.62), w + pad, h + pad], fill=255)
    hi.putalpha(Image.composite(hi.getchannel("A"), Image.new("L", (w + pad, h + pad), 0), m3))
    body.alpha_composite(hi)

    # 外描边（内缩 4 的那圈）
    edge = Image.new("RGBA", (w + pad, h + pad), (0, 0, 0, 0))
    de = ImageDraw.Draw(edge)
    de.rounded_rectangle([ox, oy, ox + w - 1, oy + h - 1], radius=radius, fill=(138, 84, 38, 255))
    de.rounded_rectangle([ox + 4, oy + 4, ox + w - 5, oy + h - 5], radius=radius - 4, fill=(0, 0, 0, 0))
    body.alpha_composite(edge)

    dst.alpha_composite(body, (x0 - ox, y0 - oy))


def main():
    global FACE_TOP, FACE_BOT, LINE, THEME
    src = sys.argv[1] if len(sys.argv) > 1 else "shots/_home-rt.png"
    out = sys.argv[2] if len(sys.argv) > 2 else "shots/ui-bench/32-定稿-C暖奶油-椭圆名字-模拟.png"
    THEME = sys.argv[3] if len(sys.argv) > 3 else "cream"
    size = int(sys.argv[4]) if len(sys.argv) > 4 else 56
    p = PAL[THEME]
    FACE_TOP, FACE_BOT, LINE = p["top"], p["bot"], p["line"]

    im = Image.open(os.path.join(CLIENT, src)).convert("RGBA")

    # 5 个徽标的屏幕中心（由场景 pos + anchor(0,1) + 47×48 反算）
    badges = [("工作台", 273, 396), ("图鉴", 500, 353), ("灶台", 628, 331),
              ("派遣", 1048, 499), ("去苔原", 285, 203)]
    # 图标换成块面版：旧图标是 29px 细线稿，放大到 34 直接糊
    import _ui_icons
    ic_sz = int(round(size * 0.6))
    icons = {name: _ui_icons.get(name, ic_sz) for name, _, _ in badges}

    half = size // 2
    for name, cx, cy in badges:
        plate(im, cx, cy, size=size, radius=int(round(size * 0.25)))
        ic = icons[name]
        im.alpha_composite(ic, (cx - ic.size[0] // 2, cy - ic.size[1] // 2))

    d = ImageDraw.Draw(im)
    for name, cx, cy in badges:
        f = font(12)
        tw = d.textlength(name, font=f)
        # h=24 / radius=12 = 全圆头胶囊；min_w=40 让 2 字标签不至于缩成一个点
        ribbon(im, cx, cy + half - 2, tw, h=24, radius=12, min_w=40)
        d = ImageDraw.Draw(im)
        d.text((cx - tw / 2, cy + half - 2 + 12 - 3), name, font=f,
               fill=(74, 44, 20) if THEME == "cream" else (66, 38, 16))

    go_button(im, 800, 626, 460, 76)
    d = ImageDraw.Draw(im)
    d.text((872, 647), "出 门", font=font(32, True), fill=(92, 54, 24))
    d.text((1012, 657), "能量 100", font=font(15), fill=(146, 88, 34))
    ax, ay = 1232, 664
    d.polygon([(ax - 7, ay - 10), (ax + 8, ay), (ax - 7, ay + 10)], fill=(132, 78, 30))

    # 任务：先在字框内做横向木纹插值填充，再写 15px（与代码里的字号一致）
    bx0, bx1, by0, by1 = 188, 258, 250, 288
    px = im.load()
    for y in range(by0, by1):
        l = px[bx0 - 5, y]
        r = px[bx1 + 5, y]
        for x in range(bx0, bx1):
            t = (x - bx0) / max(1, bx1 - bx0 - 1)
            px[x, y] = tuple(int(l[k] + (r[k] - l[k]) * t) for k in range(3)) + (255,)
    d = ImageDraw.Draw(im)
    f15 = font(15)
    tw = d.textlength("任务", font=f15)
    d.text((221 - tw / 2, 268 - 15 / 2), "任务", font=f15, fill=(74, 42, 18))

    os.makedirs(os.path.dirname(os.path.join(CLIENT, out)), exist_ok=True)
    im.convert("RGB").save(os.path.join(CLIENT, out), quality=96)
    print("✓", out)


if __name__ == "__main__":
    main()
