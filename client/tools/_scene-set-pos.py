# -*- coding: utf-8 -*-
"""按名字改场景里节点的 `_lpos`（位置）。

为什么不用 Cocos 编辑器改：
  编辑器一轮开/关几十秒，而且它会把**运行时节点**一起写回场景
  （Home.scene 曾经被写进 21621 个 `-hot` 热区就是这个原因）。
  这里直接改序列化数据，改完跑 tools/verify-scene.js 校验。

格式要注意：
  仓库里这份 .scene 是 **indent=2 的美化 JSON、LF、结尾无换行**（Cocos 自己写出来的样子）。
  回写必须照抄这个格式：`json.dumps(..., ensure_ascii=False, indent=2)` + `newline=''`。
  曾经用压缩格式（separators=(",", ":")）写过一次，结果 git diff 从"改了两行"
  变成"整个文件重写" —— 审的人根本看不出真正改了什么。

用法：
  python tools/_scene-set-pos.py <节点名> <x> <y> [--scene 路径]
  例：python tools/_scene-set-pos.py Badge-工作台 -390 -12
"""
import io
import json
import sys

args = [a for a in sys.argv[1:] if not a.startswith('--')]
scene = 'assets/scenes/Home.scene'
for i, a in enumerate(sys.argv):
    if a == '--scene':
        scene = sys.argv[i + 1]
if len(args) < 3:
    print(__doc__)
    sys.exit(1)
name, x, y = args[0], float(args[1]), float(args[2])

raw = io.open(scene, encoding='utf-8').read()
d = json.loads(raw)


def comp(node, typ):
    for c in node.get('_components') or []:
        cc = d[c['__id__']]
        if cc.get('__type__') == typ:
            return cc
    return None


hits = []
for obj in d:
    if obj.get('__type__') in ('cc.Node', 'cc.Scene') and obj.get('_name') == name:
        lp = obj.setdefault('_lpos', {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0})
        old = (lp.get('x', 0), lp.get('y', 0))
        lp['x'], lp['y'] = x, y
        hits.append((obj, old))

if not hits:
    print('找不到节点：%s' % name)
    sys.exit(1)

out = json.dumps(d, ensure_ascii=False, indent=2)
io.open(scene, 'w', encoding='utf-8', newline='').write(out)
for _, old in hits:
    print('✓ %s  (%.0f, %.0f) → (%.0f, %.0f)' % (name, old[0], old[1], x, y))
print('  写回 %s（%d 字节，%d 处）' % (scene, len(out), len(hits)))
