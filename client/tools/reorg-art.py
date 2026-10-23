#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""美术资源整理：删除被取代的旧图、把素材源/概念图/评审图归类到 client/art/、拆开 resources/grove。

设计原则
--------
1. **默认只出计划**，加 `--write` 才动文件。整理是破坏性操作，先看清单再执行。
2. 已跟踪的文件一律走 `git mv`，历史跟着走（`git log --follow` 还能查到）。
3. `.png` 和 `.meta` 成对处理。移到 `assets/` 之外时 meta 直接删 —— 那里没有 asset-db，
   留着只会让人以为还有东西依赖它。
4. 目标目录带数字前缀：用户要求在资源管理器里能「从上往下点开」。

用法
----
    python tools/reorg-art.py            # 只打印计划
    python tools/reorg-art.py --write    # 真的执行
"""
import io
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

WRITE = '--write' in sys.argv

# ---------------------------------------------------------------- 删除清单
# 判定依据写在这里，删之前每一条都能对得上。
DELETE = [
    # v1 方形头像：0 处场景引用，被 heads-circle 圆头像取代；
    # gen_grove_art.py 读的是 heads-circle，不读这里。
    ('assets/ui/home/heads/dou-nai-ox.png',   'v1 方头像，被 heads-circle 取代'),
    ('assets/ui/home/heads/nian-gao-dog.png', 'v1 方头像，被 heads-circle 取代'),
    ('assets/ui/home/heads/sugar-stand.png',  'v1 方头像，被 heads-circle 取代'),
    ('assets/ui/home/heads/tuan-zi-ham.png',  'v1 方头像，被 heads-circle 取代'),
    ('assets/ui/home/heads/xing-xie-fox.png', 'v1 方头像，被 heads-circle 取代'),
    ('assets/ui/home/heads/xue-tuan-rab.png', 'v1 方头像，被 heads-circle 取代'),
    # 行走序列帧裁切：玩法已改成代码步态（PET_WALK 用梯形速度 + 步频锁位移），
    # 这 6 张是从 sheet 裁出来的中间产物，sheet 本身留着。
    ('shots/walk-sheet/01.png', '行走帧裁切，可由 sheet 重跑 _walk-sheet-cut.py 生成'),
    ('shots/walk-sheet/02.png', '行走帧裁切，可由 sheet 重跑生成'),
    ('shots/walk-sheet/03.png', '行走帧裁切，可由 sheet 重跑生成'),
    ('shots/walk-sheet/04.png', '行走帧裁切，可由 sheet 重跑生成'),
    ('shots/walk-sheet/05.png', '行走帧裁切，可由 sheet 重跑生成'),
    ('shots/walk-sheet/06.png', '行走帧裁切，可由 sheet 重跑生成'),
    # 背景 v1：被 v2 与最终 assets/ui/home/bg.png 取代
    ('shots/bg/home-bg@v1.png', 'home-bg v1，被 v2 与最终 bg.png 取代'),
    # AI 选型基准：定风格时的一次性对比，正式素材已定
    ('shots/_ai-bench/2D_game_character_sprite__chib_2026-10-21T05-09-07.png', '选型基准'),
    ('shots/_ai-bench/2D_mobile_game_home_screen_bac_2026-10-21T05-09-40.png', '选型基准'),
    ('shots/_ai-bench/Keep_the_exact_same_character__2026-10-21T05-17-36.png', '选型基准'),
    ('shots/_ai-bench/Keep_this_EXACT_children_s_sto_2026-10-21T06-31-25.png', '选型基准'),
    ('shots/_ai-bench/Keep_this_exact_same_character_2026-10-21T05-18-55.png', '选型基准'),
    ('shots/_ai-bench/_size-test.png', '选型基准（尺寸试验）'),
    # 明确写着「被否」的两张初版
    ('shots/ai/_raw/_废弃/01-年糕-初版-与砂糖同姿态被否.png', 'README 记明被否'),
    ('shots/ai/_raw/_废弃/02-星屑-初版-侧身导致头小眼小被否.png', 'README 记明被否'),
]

# 整个目录清空（中间帧，可由 DOOR_GIF=1 重跑）
DELETE_DIRS = [
    ('shots/_door_frames', '门动画的中间帧，gif 成品已保留在 shots/grove-门口.gif'),
]

# ---------------------------------------------------------------- resources/grove 拆分
GROVE_SPLIT = {
    'pet': ['cat', 'dog', 'fox', 'ham', 'ox', 'rab'],
    'head': ['cat', 'dog', 'fox', 'ham', 'ox', 'rab'],
    'foe': ['bug', 'crow', 'boar', 'larva'],
    'ui': ['pip', 'pip-on', 'coin', 'tip', 'cream', 'prog', 'res', 'belly', 'btn', 'ring', 'star', 'arrow'],
}

# ---------------------------------------------------------------- 素材源归类
# 原路径 -> client/art 下的目标目录
# 刻意不动 client/concept/ 的脚本与它输出的 concept2-*.png：
# 那是「脚本 + 产物同目录、自带 README」的自解释工作区，
# 搬走脚本会让它内部 ../shots 的相对路径断掉。
SOURCE_MAP = [
    ('assets/bg/raw', 'art/01-source/03-bg'),
    ('art-source/256px', 'art/01-source/01-pets'),
    ('art-source/24px-autotrace', 'art/01-source/01-pets/24px-autotrace'),
    ('art-source/style-chunky.png', 'art/01-source/05-style'),
    ('art-source/style-compare.png', 'art/01-source/05-style'),
    ('art-source/style-pixel.png', 'art/01-source/05-style'),
    ('art-source/style-q-vector.png', 'art/01-source/05-style'),
    ('concept/pets', 'art/02-concept/01-pets'),
    ('concept/foes', 'art/02-concept/02-foes'),
    ('shots/ai/head', 'art/03-candidate/02-heads'),
    ('shots/ai/_raw/_废弃', 'art/05-archive/v1-被否立绘'),
    ('shots/ai/_raw', 'art/03-candidate/01-pets/raw'),
    ('shots/ai', 'art/03-candidate/01-pets'),
    ('shots/bg', 'art/05-archive/v1-背景'),
    ('shots/walk-sheet', 'art/05-archive/v1-行走序列'),
    ('shots/_归档-v1糖果纸', 'art/05-archive/v1-糖果纸'),
    ('shots/ui-bench', 'art/04-review/03-ui/质感基准'),
]

# ---------------------------------------------------------------- shots 根目录按前缀归类
# 顺序即优先级，第一条命中的生效。开头的编号文件（01-…21-）走正则单独判断。
SHOT_RULES = [
    ('grove-', 'art/04-review/01-battle'),
    ('foe-', 'art/04-review/01-battle'),
    ('snow-', 'art/04-review/01-battle'),
    ('fire-', 'art/04-review/01-battle'),
    ('clear-', 'art/04-review/01-battle'),
    ('chain-', 'art/04-review/01-battle'),
    ('concept', 'art/02-concept/04-battle'),
    ('bg-', 'art/04-review/04-bg'),
    ('ui-', 'art/04-review/03-ui'),
    ('badge-', 'art/04-review/03-ui'),
    ('quality-', 'art/04-review/05-quality'),
    ('dispatch-', 'art/04-review/06-dispatch'),
    ('pets-', 'art/04-review/02-home'),
    ('home-', 'art/04-review/02-home'),
    ('rt-', 'art/04-review/02-home'),
    ('live-', 'art/04-review/02-home'),
    ('dyn-', 'art/04-review/02-home'),
    ('task-', 'art/04-review/02-home'),
    ('game-', 'art/04-review/02-home'),
    ('sign-', 'art/04-review/02-home'),
    ('cocos-', 'art/04-review/02-home'),
    ('walk-', 'art/05-archive/v1-行走序列'),
    ('_cmp', 'art/04-review/05-quality'),
    ('_c-', 'art/05-archive/裁剪中间产物'),
]

log = []
errors = []


def run(args):
    if not WRITE:
        return 0
    p = subprocess.run(args, capture_output=True)
    if p.returncode != 0:
        errors.append('%s -> %s' % (' '.join(args), p.stderr.decode('utf8', 'replace')[:200]))
    return p.returncode


def tracked(path):
    p = subprocess.run(['git', 'ls-files', '--error-unmatch', path], capture_output=True)
    return p.returncode == 0


_made = set()


def ensure_dir(d):
    if d in _made or os.path.isdir(d):
        return
    _made.add(d)
    if WRITE:
        os.makedirs(d)
    log.append('  mkdir  %s' % d)


def move_asset(src, dst):
    """移动单个文件，自动处理 .meta 与空目录清理。"""
    if not os.path.exists(src):
        return
    ensure_dir(os.path.dirname(dst))
    inside_assets = dst.startswith('assets/')
    side = src + '.meta'
    if os.path.exists(dst):
        errors.append('目标已存在，跳过：%s' % dst)
        return
    if tracked(src):
        run(['git', 'mv', src, dst])
    elif WRITE:
        shutil.move(src, dst)
    log.append('  mv  %s -> %s' % (src, dst))
    if os.path.exists(side):
        if inside_assets:
            if tracked(side):
                run(['git', 'mv', side, dst + '.meta'])
            elif WRITE:
                shutil.move(side, dst + '.meta')
            log.append('  mv  %s -> %s' % (side, dst + '.meta'))
        else:
            if tracked(side):
                run(['git', 'rm', '-q', '-f', side])
            elif WRITE:
                os.remove(side)
            log.append('  rm  %s（assets 外的 meta 无意义）' % side)
    # 源目录空了就删（连同它的 .meta）；但 shots/ 本身要留着 ——
    # 工具现在还是往这里写新图，目录没了 writeFileSync 会直接抛错。
    sd = os.path.dirname(src)
    if sd in ('', '.', 'shots', 'art', 'assets'):
        return
    if os.path.isdir(sd) and not os.listdir(sd):
        if tracked(sd + '.meta'):
            run(['git', 'rm', '-q', '-f', sd + '.meta'])
        if WRITE:
            os.rmdir(sd)
        log.append('  rmdir  %s' % sd)


def delete_file(src, why):
    if not os.path.exists(src):
        return
    if tracked(src):
        run(['git', 'rm', '-q', '-f', src])
    elif WRITE:
        os.remove(src)
    log.append('  del %s   [%s]' % (src, why))
    side = src + '.meta'
    if os.path.exists(side):
        if tracked(side):
            run(['git', 'rm', '-q', '-f', side])
        elif WRITE:
            os.remove(side)


def main():
    print('=== 一、删除被取代 / 可重生的图 ===')
    for p, why in DELETE:
        delete_file(p, why)
    for d, why in DELETE_DIRS:
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.endswith('.png'):
                delete_file(os.path.join(d, fn), why)
        if os.path.isdir(d) and not os.listdir(d):
            if WRITE:
                os.rmdir(d)
            log.append('  rmdir  %s' % d)

    print('=== 二、resources/grove 按用途拆目录 ===')
    base = 'assets/resources/grove'
    for sub, names in GROVE_SPLIT.items():
        for n in names:
            src = os.path.join(base, '%s-%s.png' % (sub, n))
            dst = os.path.join(base, sub, '%s.png' % n)
            move_asset(src, dst)

    print('=== 三、素材源 / 概念图 / 候选图归类 ===')
    for src, dst in SOURCE_MAP:
        if os.path.isdir(src):
            for fn in sorted(os.listdir(src)):
                full = os.path.join(src, fn)
                if os.path.isfile(full):
                    move_asset(full, os.path.join(dst, fn))
            if os.path.isdir(src) and not os.listdir(src):
                if WRITE:
                    os.rmdir(src)
                log.append('  rmdir  %s' % src)
        elif os.path.exists(src):
            move_asset(src, os.path.join(dst, os.path.basename(src)))

    print('=== 四、shots 根目录按前缀归类 ===')
    if os.path.isdir('shots'):
        for fn in sorted(os.listdir('shots')):
            full = os.path.join('shots', fn)
            if not os.path.isfile(full):
                continue
            if not fn.lower().endswith(('.png', '.gif', '.jpg')):
                continue
            target = None
            # 两/三位数字开头的是「按轮次编号」的早期截图（01-…21-）
            if len(fn) > 2 and fn[:2].isdigit() and fn[2] == '-':
                target = 'art/04-review/00-早期截图'
            if target is None:
                for pre, d in SHOT_RULES:
                    if fn.startswith(pre):
                        target = d
                        break
            if target is None:
                target = 'art/04-review/09-其他'
            move_asset(full, os.path.join(target, fn))

    print('\n'.join(log) if log else '（无事可做）')
    if errors:
        print('\n!! 错误 %d 条：' % len(errors))
        for e in errors:
            print('   ' + e)
    print('\n%s' % ('已执行。' if WRITE else '以上是计划，加 --write 才会真的动文件。'))
    if errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
