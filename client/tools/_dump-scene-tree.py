# -*- coding: utf-8 -*-
"""把 Home.scene 的节点树打成文本，方便核对运行时布局前的基线。

用法：python _dump-scene-tree.py [scene路径]
"""
import io
import json
import sys

SCENE = sys.argv[1] if len(sys.argv) > 1 else 'assets/scenes/Home.scene'
d = json.load(io.open(SCENE, encoding='utf-8'))


def comp_of(node, typ):
    for c in node.get('_components') or []:
        cc = d[c['__id__']]
        if cc.get('__type__') == typ:
            return cc
    return None


def walk(i, dep=0):
    n = d[i]
    if n.get('__type__') not in ('cc.Node', 'cc.Scene'):
        return
    ut = comp_of(n, 'cc.UITransform')
    lp = n.get('_lpos') or {}
    sz = ('%dx%d' % (ut['_contentSize']['width'], ut['_contentSize']['height'])) if ut else '-'
    ax = ('a%.2f,%.2f' % (ut['_anchorPoint']['x'], ut['_anchorPoint']['y'])) if ut else ''
    lb = comp_of(n, 'cc.Label')
    txt = ('  label="%s" %dpx' % (lb.get('_string', ''), lb.get('_fontSize', 0))) if lb else ''
    sp = comp_of(n, 'cc.Sprite')
    spr = '  sprite' if sp else ''
    print('%s%s  pos(%.0f,%.0f) %s %s%s%s' % (
        '  ' * dep, n.get('_name', '?'), lp.get('x', 0), lp.get('y', 0), sz, ax, txt, spr))
    for c in n.get('_children') or []:
        walk(c['__id__'], dep + 1)


si = [i for i, x in enumerate(d) if x.get('__type__') == 'cc.Scene'][0]
walk(si)
