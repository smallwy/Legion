# -*- coding: utf-8 -*-
"""列出 Badges 下徽标/名字底板用到的贴图与尺寸，供换图时核对。"""
import glob
import io
import json
import os

d = json.load(io.open('assets/scenes/Home.scene', encoding='utf-8'))

m = {}
for f in glob.glob('assets/**/*.png.meta', recursive=True):
    try:
        j = json.load(io.open(f, encoding='utf-8'))
        sf = (j.get('subMetas') or {}).get('f9941')
        if sf and sf.get('uuid'):
            m[sf['uuid']] = os.path.basename(f[:-5])
    except Exception:
        pass

si = [i for i, x in enumerate(d) if x.get('__type__') == 'cc.Scene'][0]


def walk(i, dep=0):
    n = d[i]
    if n.get('__type__') not in ('cc.Node', 'cc.Scene'):
        return
    nm = n.get('_name', '')
    sp = ut = None
    for c in n.get('_components') or []:
        cc = d[c['__id__']]
        if cc.get('__type__') == 'cc.Sprite':
            sp = cc
        if cc.get('__type__') == 'cc.UITransform':
            ut = cc
    show = nm.startswith('Badge-') or nm.startswith('Cap-') or nm in ('ico', 'txt')
    if show:
        size = '%dx%d' % (ut['_contentSize']['width'], ut['_contentSize']['height']) if ut else '-'
        if sp:
            u = (sp.get('_spriteFrame') or {}).get('__uuid__')
            print('%-18s %-16s size=%-8s uuid=%s' % ('  ' * dep + nm, m.get(u, '?'), size, u))
        else:
            print('%-18s %-16s size=%-8s (no sprite)' % ('  ' * dep + nm, '-', size))
    for c in n.get('_children') or []:
        walk(c['__id__'], dep + 1)


walk(si)
