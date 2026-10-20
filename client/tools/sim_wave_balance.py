#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
波次 / 饱食度 数值验证（离线，不依赖 Cocos 运行时）

用途：改 BattleConfig 的 WAVE / SATIETY / HERO / ENEMIES 之后跑一遍，
确认"一局多长""要喂几次""肉块够不够"这三个数字还站得住。

    python tools/sim_wave_balance.py

所有输入都从 BattleConfig.ts 手抄（改了配置记得同步这里），
输出是稳态估算，不是实测 —— 它的作用是**证伪**，不是证明。
"""

# ---- 抄自 BattleConfig.ts ----
HERO_COUNT = 3
HERO_DAMAGE = 10
HERO_CYCLE = 0.25 + 0.1 + 0.30          # telegraph + cast + recovery

# type: (hp, weight, speed)
ENEMIES = {
    'walker': (20, 0.60, 70),
    'flyer':  (12, 0.25, 120),
    'tank':   (60, 0.15, 38),
}

WAVE_TOTAL = 20
WAVE_INTERVAL = 3.0
WAVE_BASE = 6
WAVE_PER = 1.1
WAVE_MAX_ALIVE = 32
SPAWN_RADIUS = 600

SAT_MAX = 100.0
SAT_DECAY = 0.5
FEED_AMOUNT = 35.0
FEED_CD = 0.8
FULL_LINE = 70.0
HUNGRY_LINE = 30.0
MUL_FULL, MUL_HUNGRY, MUL_STARVING = 1.0, 1.5, 0.6

MEAT_DROP = 0.12
BOSS_HP = 620

# 有效输出折算：怪从 600px 外生成，要走进索敌范围(340)才挨打，
# 且英雄会空窗等目标。取 0.7 作为"理论 DPS 的可用比例"（保守）。
UPTIME = 0.70


def dps(multiplier=1.0):
    return HERO_COUNT * (HERO_DAMAGE / HERO_CYCLE) * multiplier * UPTIME


def avg_enemy_hp():
    return sum(hp * w for hp, w, _ in ENEMIES.values())


def tier_mul(sat):
    if sat >= FULL_LINE:
        return MUL_FULL
    if sat >= HUNGRY_LINE:
        return MUL_HUNGRY
    return MUL_STARVING


def wave_counts():
    return [round(WAVE_BASE + WAVE_PER * (i - 1)) for i in range(1, WAVE_TOTAL)]


def main():
    avg_hp = avg_enemy_hp()
    counts = wave_counts()

    print('=' * 62)
    print('波次与总量')
    print('=' * 62)
    print(f'  平均怪 HP          {avg_hp:.1f}')
    print(f'  小怪波数           {len(counts)}（第 {WAVE_TOTAL} 波 = BOSS）')
    print(f'  单波数量           第1波 {counts[0]} → 第{len(counts)}波 {counts[-1]}')
    print(f'  小怪总数           {sum(counts)}')
    print(f'  小怪总 HP          {sum(counts) * avg_hp:.0f}')
    print(f'  同屏上限           {WAVE_MAX_ALIVE}'
          f'{"  ⚠️ 单波超过上限，会分两批涌出" if max(counts) > WAVE_MAX_ALIVE else ""}')

    # ---- 净打怪时间（按 4 档饱食度算）----
    print()
    print('=' * 62)
    print('一局时长估算（纯输出 + 波间隔，未计靠近时间）')
    print('=' * 62)
    total_hp = sum(counts) * avg_hp + BOSS_HP
    gaps = (len(counts)) * WAVE_INTERVAL
    for label, mul in (('全程满饱 ×1.0', MUL_FULL),
                       ('全程半饿 ×1.5', MUL_HUNGRY),
                       ('全程全饿 ×0.6', MUL_STARVING)):
        t = total_hp / dps(mul) + gaps
        print(f'  {label:<16} {dps(mul):5.1f} DPS → {t:6.0f}s = {t/60:.1f} 分钟')

    # ---- 靠近时间 ----
    # ⚠️ 这里最容易算错：一波的怪是**并行**靠近的，不是串行。
    #    只有"每波一次靠近"该被计入，乘以单波数量会算出十几分钟的假结论。
    walk_t = len(counts) * (SPAWN_RADIUS - 340) / ENEMIES['walker'][2]
    total_1_2 = total_hp / dps(1.2) + gaps + walk_t
    print(f'  靠近时间（并行）   {walk_t:.0f}s（每波 260px ÷ 70px/s）')
    print(f'  → 真实一局约        {total_1_2/60:.1f} 分钟（按平均 ×1.2 火力）')

    # ---- 饱食度曲线 ----
    print()
    print('=' * 62)
    print('饱食度：什么时候必须喂')
    print('=' * 62)
    t_to_70 = (SAT_MAX - FULL_LINE) / SAT_DECAY
    t_to_30 = (SAT_MAX - HUNGRY_LINE) / SAT_DECAY
    t_to_0 = SAT_MAX / SAT_DECAY
    print(f'  100 → 70（掉出满饱）  {t_to_70:5.0f}s')
    print(f'  100 → 30（掉进全饿）  {t_to_30:5.0f}s')
    print(f'  100 → 0 （彻底空）    {t_to_0:5.0f}s')
    print(f'  半饿区间宽度          {FULL_LINE - HUNGRY_LINE:.0f} 点 = '
          f'{(FULL_LINE - HUNGRY_LINE)/SAT_DECAY:.0f}s 的容错窗口')

    rough_feeds = max(1, round(total_1_2 * SAT_DECAY / FEED_AMOUNT))
    print(f'  一局 {total_1_2:.0f}s 若想保持不空：约需喂 {rough_feeds} 次')
    print(f'  不喂的最晚时点       {t_to_30:.0f}s（此后 ×0.6）')

    # ---- 肉块供给 ----
    print()
    print('=' * 62)
    print('肉块供需')
    print('=' * 62)
    supply = sum(counts) * MEAT_DROP
    print(f'  击杀 {sum(counts)} 只 × {MEAT_DROP:.0%} = {supply:.0f} 块肉')
    print(f'  需要约 {rough_feeds} 块')
    verdict = '供给远大于需求 → 喂食不构成资源决策' if supply > rough_feeds * 3 else '供给与需求接近 → 喂食有取舍'
    print(f'  → {verdict}')

    # ---- 升级节奏 ----
    print()
    print('=' * 62)
    print('升级节奏')
    print('=' * 62)
    exp_total = sum(counts) * 1.3      # 每只平均 1.3 颗（30% 双珠）
    base, growth, maxlv = 12, 1.32, 15
    acc = 0.0
    lv = 1
    need = base
    while acc + need <= exp_total and lv < maxlv:
        acc += need
        lv += 1
        need = round(base * growth ** (lv - 1))
    print(f'  预计总经验          {exp_total:.0f}')
    print(f'  → 一局约升到        Lv {lv}（{lv-1} 次三选一）')
    per_card = total_1_2 / max(1, lv - 1)
    print(f'  平均               {per_card:.0f}s 弹一次卡')
    if per_card < 20:
        print('  ⚠️ 太密，会打断节奏 → 调高 LEVEL.baseExp 或 expGrowth')
    elif per_card > 60:
        print('  ⚠️ 太疏，局内成长存在感弱 → 调低 LEVEL.baseExp')
    else:
        print('  ✓ 落在 20~60s 的健康区间')
    print()


if __name__ == '__main__':
    main()
