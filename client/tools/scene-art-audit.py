#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""场景贴图审计：列出 Home.scene 里每个 cc.Sprite 用的贴图，以及每个贴图被几个 Sprite 用。
用来回答「这张图真的在场景里吗」「六张头像是不是都绑了」。只读。
"""
import glob
import io
import json
import os

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SCENE = 'assets/scenes/Home.scene'

u2f = {}
for m in glob.glob('assets/**/*.meta', recursive=True):
    try:
        d = json.load(io.open(m, encoding='utf8'))
    except Exception:
        continue
    if 'uuid' in d:
        u2f[d['uuid']] = m[:-5].replace('\\', '/')

scene = json.load(io.open(SCENE, encoding='utf8'))

print('=== 场景内 cc.Sprite -> 贴图 ===')
count = {}
for o in scene:
    if o.get('__type__') != 'cc.Sprite':
        continue
    sf = (o.get('_spriteFrame') or {}).get('__uuid__', '')
    if not sf:
        continue
    base = sf.split('@')[0]
    nid = (o.get('node') or {}).get('__id__')
    nm = scene[nid].get('_name') if isinstance(nid, int) else '?'
    path = u2f.get(base, '<未知 ' + base + '>')
    print('  %-26s %s' % (nm, path))
    count[path] = count.get(path, 0) + 1

print('\n=== 每张贴图被几个 Sprite 引用 ===')
for k in sorted(count):
    print('  %d  %s' % (count[k], k))
