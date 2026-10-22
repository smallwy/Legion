# -*- coding: utf-8 -*-
"""把 5 个场景徽标从「圆徽 47×48 + 0.75px 描边名字板」改成「48 方牌 + 3px 椭圆名字板」。

只动几何与字号，不动 uuid 引用（贴图已由 gen_badge_plates.py 按同名替换）。

规格（docs/PAWPACK-主界面-交互热点家族规格.md）：
  牌      48×48，圆角 12
  名字板  高 24，宽 = 文字宽 + 14（最小 40）→ 2 字 40 / 3 字 50
  图标    30×30（牌面的 62.5%）
  字号    12 / 行高 16（原来是 11 / 11，行高 1.0 会让中文笔画顶边）

回写格式：`.scene` 是 **indent=2 美化 JSON + LF + 结尾无换行**。
用 separators 压缩过写过一次，git diff 从"改十几行"变成"整个文件重写"。

跑法（在 client/ 下）：
  python tools/_scene-patch-badges.py
"""
import io
import json
import os

SCENE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "assets", "scenes", "Home.scene")

BADGE = 48          # 牌边长
ICON = 30           # 图标边长（62.5%）
CAP_H = 24          # 名字板高
CAP_PAD = 16        # 名字板宽度 = 文字宽 + 16（左右各：3px 描边 + 5px 空隙）
CAP_MIN = 40        # 2 字兜底宽
FS = 12             # 名字字号
LH = 16             # 名字行高


def main():
    d = json.load(io.open(SCENE, encoding="utf-8"))
    si = [i for i, x in enumerate(d) if x.get("__type__") == "cc.Scene"][0]

    def comp(node, t):
        for c in node.get("_components") or []:
            cc = d[c["__id__"]]
            if cc.get("__type__") == t:
                return cc
        return None

    def child(node, name):
        for c in node.get("_children") or []:
            n = d[c["__id__"]]
            if n.get("_name") == name:
                return n
        return None

    changed = []

    def set_size(ut, w, h):
        """**只改 width/height，不要整个替换 dict。**
        contentSize 是 cc.Size，带 `__type__: "cc.Size"`；换成裸 dict 后
        Cocos 反序列化会拿到一个无名对象，运行时 contentSize 是 undefined。
        这个坑第一次就踩了，diff 里看得很清楚（少了一行 __type__）。
        """
        cs = ut.get("_contentSize")
        if not isinstance(cs, dict):
            cs = {"__type__": "cc.Size", "width": 0, "height": 0}
            ut["_contentSize"] = cs
        cs["width"] = w
        cs["height"] = h

    def walk(i):
        n = d[i]
        if n.get("__type__") not in ("cc.Node", "cc.Scene"):
            return
        nm = n.get("_name", "")

        if nm.startswith("Badge-") and "-hot" not in nm:
            key = nm[6:]
            ut = comp(n, "cc.UITransform")
            if ut:
                set_size(ut, BADGE, BADGE)
                changed.append("%s size %dx%d" % (nm, BADGE, BADGE))
            ico = child(n, "ico")
            iut = ico and comp(ico, "cc.UITransform")
            if iut:
                set_size(iut, ICON, ICON)

        if nm.startswith("Cap-"):
            txt = child(n, "txt")
            lbl = txt and comp(txt, "cc.Label")
            s = (lbl or {}).get("_string", "")
            # 按字宽估：12px 中文约为 1 字宽 = fontSize。多留 2px 给标点/西文
            cw = max(CAP_MIN, len(s) * FS + CAP_PAD)
            ut = comp(n, "cc.UITransform")
            if ut:
                set_size(ut, cw, CAP_H)
                changed.append("%s size %dx%d（%d 字）" % (nm, cw, CAP_H, len(s)))
            if lbl:
                lbl["_fontSize"] = FS
                lbl["_lineHeight"] = LH
                if "_actualFontSize" in lbl:
                    lbl["_actualFontSize"] = FS
            tut = txt and comp(txt, "cc.UITransform")
            if tut:
                set_size(tut, len(s) * FS, LH)

        for c in n.get("_children") or []:
            walk(c["__id__"])

    walk(si)

    out = json.dumps(d, ensure_ascii=False, indent=2)
    io.open(SCENE, "w", encoding="utf-8", newline="").write(out)
    print("\n".join(changed))
    print("共 %d 处" % len(changed))


if __name__ == "__main__":
    main()
