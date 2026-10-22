# -*- coding: utf-8 -*-
"""在 Badges 下加一个椭圆底板节点 `TaskPlate`，给「任务」用。

为什么底板要写进场景、而不是运行时 `resources.load`：
  · HomeRuntime 全程用 Graphics 画东西，唯一一次动态加载是 launchBattle 里
    按 uuid 拉 Battle 场景。为了一个 54×26 的底板引入 resources 目录 + 异步
    回调 + 加载失败兜底，成本远高于"场景里放一个 Sprite"。
  · 场景里的静态 Sprite 是同步的 —— 反序列化完就在，不存在"第一帧没底板、
    第二帧才出现"的跳变。

运行时 placeTaskBtn 会把这个节点 setParent(btn) 并归零，位置真相只留在按钮一处。

规格（docs/PAWPACK-主界面-交互热点家族规格.md）：
  任务胶囊 54×26，圆角 13（= 高的一半，标准胶囊端头）
  相对名字板（52×24 / 12px）大一档：路标那块的可见面积只有 60×38，
  同尺寸远看会塌成一个米色点。

回写格式：`.scene` = indent=2 美化 JSON + LF + 结尾无换行。

跑法（在 client/ 下）：
  python tools/_scene-add-task-plate.py
"""
import base64
import io
import json
import os
import uuid

SCENE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "assets", "scenes", "Home.scene")

SF_UUID = "7865a7e2-1a7e-4c98-af30-6c6c1a67d970@f9941"   # badge-task.png 的 spriteFrame
W, H = 54, 26
POS = (-419, 90)          # 路标牌正文净区中心（见 placeTaskBtn 的测量注释）


def nid():
    """Cocos 的节点 _id 是 16 字节的 base64url（22 字符，无 padding）。"""
    return base64.urlsafe_b64encode(uuid.uuid4().bytes).decode().rstrip("=")


def main():
    d = json.load(io.open(SCENE, encoding="utf-8"))
    used = {o.get("_id") for o in d if isinstance(o.get("_id"), str)}

    def fresh_id():
        while True:
            s = nid()
            if s not in used:
                used.add(s)
                return s

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

    canvas = next(o for o in d if o.get("_name") == "Canvas" and o.get("__type__") == "cc.Node")
    badges = child(canvas, "Badges")
    bi = d.index(badges)

    if child(badges, "TaskPlate"):
        print("TaskPlate 已存在，跳过（本脚本是幂等的）")
        return

    ni = len(d)
    d.append(None)          # Node
    ui = ni + 1
    d.append(None)          # UITransform
    si = ni + 2
    d.append(None)          # Sprite

    d[ni] = {
        "__type__": "cc.Node",
        "_name": "TaskPlate",
        "_objFlags": 0,
        "__editorExtras__": {},
        "_parent": {"__id__": bi},
        "_children": [],
        "_active": True,
        "_components": [{"__id__": ui}, {"__id__": si}],
        "_prefab": None,
        "_lpos": {"__type__": "cc.Vec3", "x": POS[0], "y": POS[1], "z": 0},
        "_lrot": {"__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1},
        "_lscale": {"__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1},
        "_mobility": 0,
        "_layer": 33554432,
        "_euler": {"__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0},
        "_id": fresh_id(),
    }

    # 锚点 (0.5, 0.5)：运行时被搬到 TaskBtn 下后 setPosition(0,0) 就正好居中，
    # 不需要再按 anchor 折算（Cap-* 用 (0,1) 是因为它们由 alignHud 按左上角排）。
    d[ui] = {
        "__type__": "cc.UITransform",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": {"__id__": ni},
        "_enabled": True,
        "__prefab": None,
        "_contentSize": {"__type__": "cc.Size", "width": W, "height": H},
        "_anchorPoint": {"__type__": "cc.Vec2", "x": 0.5, "y": 0.5},
        "_id": fresh_id(),
    }

    # _sizeMode 0 = CUSTOM：节点 contentSize 说了算，不被贴图 raw 尺寸覆盖。
    # _type 0 = SIMPLE：椭圆不能九宫格拉伸，圆头会被拉变形。
    d[si] = {
        "__type__": "cc.Sprite",
        "_name": "",
        "_objFlags": 0,
        "__editorExtras__": {},
        "node": {"__id__": ni},
        "_enabled": True,
        "__prefab": None,
        "_customMaterial": None,
        "_srcBlendFactor": 2,
        "_dstBlendFactor": 4,
        "_color": {"__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255},
        "_spriteFrame": {"__uuid__": SF_UUID, "__expectedType__": "cc.SpriteFrame"},
        "_type": 0,
        "_fillType": 0,
        "_sizeMode": 0,
        "_fillCenter": {"__type__": "cc.Vec2", "x": 0, "y": 0},
        "_fillStart": 0,
        "_fillRange": 0,
        "_isTrimmedMode": False,
        "_useGrayscale": False,
        "_atlas": None,
        "_id": fresh_id(),
    }

    badges["_children"].append({"__id__": ni})

    out = json.dumps(d, ensure_ascii=False, indent=2)
    io.open(SCENE, "w", encoding="utf-8", newline="").write(out)
    print("TaskPlate 已加入 Badges（对象 #%d/%d/%d），%dx%d @ (%d,%d)"
          % (ni, ui, si, W, H, POS[0], POS[1]))


if __name__ == "__main__":
    main()
