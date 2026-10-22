# -*- coding: utf-8 -*-
"""清掉 Home.scene 里的热区代代相套。

现象：Badges 节点下挂了 20485 个子节点，其中 21621 个（含子树）名字长这样 ——
  Badge-工作台-hot-hot-hot-hot-hot-hot-hot-hot-hot-hot-hot-hot（12 层）
每个徽标正确只有一个 `Badge-<名>-hot` 热区，但历史上每接管一次就套一层，
再被编辑器写回磁盘，于是累积成 27MB 的 .scene。

**这不只是体积问题。** 每层 -hot 都是一个带 UITransform 的透明节点，
它们几何位置完全重合 —— 用户看到的"界面很多重了"就是这个：
同一个位置叠着十几块点击区。

清理规则（唯一一条，但必须写成"名字对得上"而不是"挂着就算"）：

  **一个 -hot 节点，只有当它的名字正好等于 `<父节点名>-hot` 时才留下。**

  这条比"每个节点下保留第一个 -hot"严一档，差的那一档是真出过错的：
  `Badges` 下面同时有 `Badge-工作台` 和 `Badge-工作台-hot`（并列），
  而 `Badge-工作台` 里面也有一个 `Badge-工作台-hot`。按宽松规则两个都留，
  于是同一个徽标有两块同位置的热区 —— 正是"界面重了"的原样。

  对得上的一律留（并且它内部的 -hot 全剪），对不上的一律剪。

剪完之后按"从 Scene 根能不能走到"重建对象表，孤儿组件一并消失。
"""
import json, io, sys, copy

P = 'assets/scenes/Home.scene'
raw = io.open(P, encoding='utf-8', newline='').read()
d = json.loads(raw)

ROOT = 1  # cc.Scene


def name_of(i):
    o = d[i]
    return o.get('_name', '') if isinstance(o, dict) else ''


kept_hot = set()      # 保留的 -hot 节点 id
removed = 0


def walk(i, parent_is_hot, parent_name):
    """返回 True = 这个节点留下。"""
    global removed
    o = d[i]
    if not isinstance(o, dict):
        return True
    nm = o.get('_name', '')
    is_hot = ('-hot' in nm) or (nm.endswith('-hot'))

    if is_hot:
        # 父节点本身是热区 → 必删（嵌套）
        if parent_is_hot:
            removed += 1
            return False
        # 名字必须正好是"父名 + -hot"，否则就是挂错位置的孤儿热区
        if nm != parent_name + '-hot':
            removed += 1
            return False
        if parent_name in kept_hot:
            removed += 1
            return False
        kept_hot.add(parent_name)
        # 保留的这个，内部 children 全清（它们都是更深的 -hot）
        kids = o.get('_children') or []
        removed += len(kids)
        o['_children'] = []
        return True

    kids = o.get('_children') or []
    keep = []
    for c in kids:
        ci = c['__id__']
        if walk(ci, is_hot, nm):
            keep.append(c)
    o['_children'] = keep
    return True


walk(ROOT, False, '')

# ---- 重建可达集合：从 Scene 根 DFS，凡是走不到的对象一律丢弃 ----
reach = set()


def collect(i):
    if i in reach:
        return
    reach.add(i)
    o = d[i]
    if not isinstance(o, dict):
        return
    for k, v in o.items():
        if k == '__type__':
            continue
        if isinstance(v, dict) and '__id__' in v:
            collect(v['__id__'])
        elif isinstance(v, list):
            for e in v:
                if isinstance(e, dict) and '__id__' in e:
                    collect(e['__id__'])


# SceneAsset（d[0]）会引用 Scene
collect(0)
collect(ROOT)

old_n = len(d)
new_list = [None] * old_n
# 先分配新下标
order = sorted(reach)
remap = {old: new for new, old in enumerate(order)}


def remap_obj(o):
    """把对象里所有 __id__ 换成新下标；指向被删对象的引用原样保留（Cocos 会读成 null）。"""
    if isinstance(o, dict):
        if '__id__' in o and len(o) == 1:
            # 指向被删对象的引用写成 null —— 写 0 会指到 SceneAsset 上，是个真错误
            return {'__id__': remap[o['__id__']]} if o['__id__'] in remap else None
        return {k: remap_obj(v) for k, v in o.items()}
    if isinstance(o, list):
        return [remap_obj(e) for e in o]
    return o


out = [remap_obj(d[i]) for i in order]

io.open(P, 'w', encoding='utf-8', newline='').write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print('objects %d -> %d   (-hot 剪掉 %d)' % (old_n, len(out), removed))
