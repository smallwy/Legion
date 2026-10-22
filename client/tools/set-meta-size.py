# -*- coding: utf-8 -*-
"""按 PNG 实际尺寸重写 .png.meta 里 spriteFrame 的尺寸字段。

为什么要写：Cocos 的 meta 把 rawWidth / width / trim / vertices / uv / nuv
全都固化了。换掉 PNG 内容但不改 meta，离线渲染和首帧会按旧 rect 取图
—— 表现为"图被裁掉一块"或"整张缩到错的格子"。

本脚本只动几何字段，**uuid 与 subMetas 的键保持不变**，所以场景引用不用改。

跑法（在 client/ 下）：
  python tools/set-meta-size.py assets/ui/home/badge-ring.png [...]
"""
import io
import json
import os
import sys

from PIL import Image


def fix(png):
    meta = png + ".meta"
    if not os.path.exists(meta):
        print("  跳过（无 meta）：", png)
        return False
    im = Image.open(png).convert("RGBA")
    raw_w, raw_h = im.size
    bb = im.getchannel("A").getbbox() or (0, 0, raw_w, raw_h)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]

    d = json.load(io.open(meta, encoding="utf-8"))
    sf = (d.get("subMetas") or {}).get("f9941")
    if not sf:
        print("  跳过（无 spriteFrame）：", png)
        return False
    u = sf["userData"]
    u["trimThreshold"] = 1
    u["rotated"] = False
    u["trimX"] = bb[0]
    u["trimY"] = bb[1]
    u["width"] = tw
    u["height"] = th
    u["rawWidth"] = raw_w
    u["rawHeight"] = raw_h
    u["offsetX"] = tw - raw_w
    u["offsetY"] = th - raw_h

    hw, hh = raw_w / 2.0, raw_h / 2.0
    # 顶点顺序固定为：左下、右下、左上、右上（Cocos 的 rawPosition 就这个序）
    # uv 用**图像像素坐标、y 轴朝下**（原 meta 里就是朝下的，不翻转）；
    # nuv 是同一个数除以 raw。
    u["vertices"] = {
        "rawPosition": [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
        "indexes": [0, 1, 2, 2, 1, 3],
        "uv": [bb[0], bb[3], bb[2], bb[3], bb[0], bb[1], bb[2], bb[1]],
        "nuv": [bb[0] / raw_w, bb[3] / raw_h,
                bb[2] / raw_w, bb[3] / raw_h,
                bb[0] / raw_w, bb[1] / raw_h,
                bb[2] / raw_w, bb[1] / raw_h],
        "minPos": [-hw, -hh, 0],
        "maxPos": [hw, hh, 0],
    }

    out = json.dumps(d, ensure_ascii=False, indent=2)
    io.open(meta, "w", encoding="utf-8", newline="").write(out + "\n")
    print("  %-34s raw %dx%d  裁切 %dx%d  trim(%d,%d)"
          % (os.path.basename(png), raw_w, raw_h, tw, th, bb[0], bb[1]))
    return True


def main():
    paths = sys.argv[1:]
    if not paths:
        base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "assets", "ui", "home")
        paths = [os.path.join(base, n) for n in
                 ("badge-ring.png", "badge-cap-2.png", "badge-cap-3.png")]
    n = 0
    for p in paths:
        if fix(p):
            n += 1
    print("已重写 %d 个 meta" % n)


if __name__ == "__main__":
    main()
