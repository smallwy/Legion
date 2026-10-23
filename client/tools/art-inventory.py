#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""美术资源清点：每张图 → uuid → 谁在引用。

判定「在用」的三条通道：
  1. 场景/预制体按 uuid 引用（Cocos 的 .meta uuid，@xxx 子资源也一并算）
  2. 脚本里的 resources.load 路径字符串（按文件名匹配）
  3. 脚本里直接写的资源路径常量

输出两张表：在用 / 疑似无用。只读，不改任何文件。
"""
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

IMG_EXT = ('.png', '.jpg', '.jpeg', '.webp')


def tracked(pattern='*.png'):
    out = subprocess.check_output(['git', 'ls-files', '-z', pattern])
    return [p for p in out.decode('utf8').split('\0') if p]


def tracked_all():
    paths = []
    for ext in IMG_EXT:
        paths += tracked('*' + ext)
    return sorted(set(paths))


def read_text(path):
    with io.open(path, 'r', encoding='utf8', errors='replace') as f:
        return f.read()


def meta_uuid(png):
    m = png + '.meta'
    if not os.path.exists(m):
        return None
    try:
        d = json.loads(read_text(m))
    except Exception:
        return None
    return d.get('uuid')


LITERAL_RE = re.compile(r"'([^'\\\n]{2,80})'|\"([^\"\\\n]{2,80})\"")


def collect_literals(refs):
    """源码里的字符串常量集合。路径常写成 'grove/pet-' + id 这种拼接，
    所以要按「前缀命中」判断，不能只找完整路径。"""
    lits = set()
    for path, txt in refs.items():
        if not path.endswith(('.ts', '.js')):
            continue
        for m in LITERAL_RE.finditer(txt):
            s = m.group(1) or m.group(2)
            if '/' in s:
                lits.add(s)
    return lits


def path_hit(rel_noext, lits):
    """rel_noext 形如 grove/pet-cat。命中规则：
       - 常量与它完全相同
       - 常量是它的前缀（截到 '-' 或 '/' 为止），且长度够（>= 目录名+4）
       - 它是常量的前缀（'ui/post-overlay' vs 'ui/post-overlay/spriteFrame'）
    """
    d = os.path.dirname(rel_noext)
    floor = len(d) + 4
    short = os.path.basename(rel_noext)
    for lit in lits:
        if lit == rel_noext:
            return lit
        if rel_noext.startswith(lit) and lit[-1] in '-/':
            # 目录型写法（'grove/pet/'）天然比 floor 长不了，单独放行；
            # 字符型（'grove/pet-'）才需要长度下限，否则 'grove/' 会命中一切
            if lit.endswith('/') or len(lit) >= floor:
                return lit + '*'
        if lit.startswith(rel_noext + '/') and len(lit) - len(rel_noext) <= 24:
            return lit
    # 兜底：目录 + 去掉版本后缀的文件名（如 pet-cat 命中 'grove/pet-'）
    stem_dir = os.path.join(d, short.split('-')[0])
    for lit in lits:
        if lit == stem_dir:
            return lit + '*'
    return None


def collect_refs():
    """引用源只认「工程内」的文件：场景、预制体、动画、材质，以及 assets/scripts 下的 .ts。
    绝不扫 tools/ —— 本脚本自己输出的明细里全是 uuid，会自己被自己引用（踩过）。"""
    srcs = {}
    for base, dirs, files in os.walk('assets'):
        dirs[:] = [d for d in dirs if d not in ('library', 'temp', 'node_modules', 'build')]
        for fn in files:
            if not fn.endswith(('.scene', '.prefab', '.ts', '.anim', '.mtl', '.effect', '.plist')):
                continue
            p = os.path.join(base, fn)
            try:
                srcs[p] = read_text(p)
            except Exception:
                pass
    return srcs


def role(p):
    if p.startswith('assets/resources/'):
        return 'A-runtime-resources'
    if p.startswith('assets/'):
        return 'B-runtime-scene'
    if p.startswith('art-source/'):
        return 'C-source'
    if p.startswith('concept/'):
        return 'D-concept'
    if p.startswith('shots/ai'):
        return 'E-candidate'
    if p.startswith('art/'):
        return 'F-art-' + p.split('/')[1] if len(p.split('/')) > 2 else 'F-art'
    if p.startswith('shots/'):
        return 'Z-shots'
    if p.startswith('docs/'):
        return 'G-docs'
    return 'Z-其他'


def main():
    pngs = tracked_all()
    print('已跟踪图片：%d 张' % len(pngs))
    refs = collect_refs()
    lits = collect_literals(refs)

    rows = []
    for png in pngs:
        u = meta_uuid(png)
        base = os.path.basename(png)
        hits = []
        if u:
            # uuid 引用（含子资源 @xxx 写法在主 uuid 命中时一并算）
            for path, txt in refs.items():
                if u in txt:
                    hits.append(path)
                    break
        if not hits:
            rel = png
            for pre in ('assets/resources/',):
                if rel.startswith(pre):
                    rel = rel[len(pre):]
                    break
            rel_noext = os.path.splitext(rel)[0]
            lit = path_hit(rel_noext, lits)
            if lit:
                hits.append('<resources 路径> ' + lit)
        size = os.path.getsize(png)
        rows.append({'path': png, 'uuid': u, 'size': size, 'hits': hits})

    used = [r for r in rows if r['hits']]
    unused = [r for r in rows if not r['hits']]

    def show(title, rs):
        print('\n=== %s（%d 张，%.1f MB）===' % (title, len(rs), sum(r['size'] for r in rs) / 1048576.0))
        bydir = {}
        for r in rs:
            bydir.setdefault(os.path.dirname(r['path']), []).append(r)
        for d in sorted(bydir):
            rs2 = bydir[d]
            print('  %-40s %3d 张 %7.1f MB' % (d, len(rs2), sum(x['size'] for x in rs2) / 1048576.0))

    print('\n=== 按角色分组 ===')
    byrole = {}
    for r in rows:
        byrole.setdefault(role(r['path']), []).append(r)
    for k in sorted(byrole):
        rs = byrole[k]
        u = sum(1 for r in rs if r['hits'])
        print('  %-22s %3d 张 %7.1f MB   在用 %d / 无引用 %d' % (
            k, len(rs), sum(r['size'] for r in rs) / 1048576.0, u, len(rs) - u))

    show('在用', used)
    show('疑似无用', unused)

    print('\n--- 运行时资源（assets/）无引用明细 ---')
    for r in sorted([x for x in unused if role(x['path'])[0] in 'AB'], key=lambda x: -x['size']):
        print('%8.1fKB  %s' % (r['size'] / 1024.0, r['path']))

    print('\n--- 运行时资源命中的依据（抽查用） ---')
    for r in sorted([x for x in used if role(x['path'])[0] in 'AB'], key=lambda x: x['path']):
        print('  %-62s <- %s' % (r['path'], r['hits'][0]))

    with io.open('tools/_art-inventory.json', 'w', encoding='utf8', newline='') as f:
        f.write(json.dumps({'used': used, 'unused': unused}, ensure_ascii=False, indent=1))
    print('\n明细已写入 tools/_art-inventory.json')


if __name__ == '__main__':
    main()
