import { ABILITY, AOE_FALLOFF } from '../config/BattleConfig';
import type { BossController } from './BossController';
import type { EnemyManager } from './EnemyManager';

/**
 * 技能表现实例（CR-017）。三种形态共用一个数组，`kind` 区分。
 *
 * 为什么用 union 而不是三个数组：
 *  - 渲染时按 `kind` 分支即可，三个数组会让 `EntityRenderer` 的签名变长；
 *  - 同屏实例数极少（3 英雄 × 最短周期 0.62s × 最长存留 0.54s ≈ 最多 6 个），
 *    不需要为"分类遍历"做优化。
 */
export interface BeamFx {
    kind: 'beam';
    x: number;
    y: number;
    ex: number;
    ey: number;
    halfWidth: number;
    t: number;
    life: number;
    crit: boolean;
}

export interface BoltFx {
    kind: 'bolt';
    /** 落点 */
    x: number;
    y: number;
    radius: number;
    t: number;
    life: number;
    /** 预警结束时刻（到点才结算伤害） */
    warn: number;
    fired: boolean;
    /**
     * 待结算伤害。
     * ⚠️ 必须存在实例上，不能存成 AbilitySystem 的单个字段 —— 落雷有 0.32s 预警，
     * 期间玩家可能喂一次食让饱食档位从「满饱」跳到「半饿」，伤害倍率会变；
     * 更常见的是一条英雄连放两发、两发同时在飞，单字段会被后者覆盖。
     */
    dmg: number;
    crit: boolean;
}

export interface NovaFx {
    kind: 'nova';
    x: number;
    y: number;
    radius: number;
    t: number;
    life: number;
    crit: boolean;
}

export type AbilityFx = BeamFx | BoltFx | NovaFx;

/**
 * 英雄技能系统（CR-017）：**判定 + 表现数据**，不含任何渲染。
 *
 * 分工：
 *  - `HeroSquad` 决定"谁、打谁、多少伤害"（读饱食倍率与升级表）；
 *  - 本类决定"这一下打成什么形状、命中谁"；
 *  - `EntityRenderer` 只读 `list` 画出来。
 *
 * 三种技能刻意选择了三种**不同的空间关系**，这样三只英雄的分工不用看数值：
 *  - `beam`（贯穿）—— 一条线，处理纵列；
 *  - `bolt`（落雷）—— 一个点，处理扎堆，且有 0.32s 预警；
 *  - `nova`（冲击）—— 一个环，贴身清场 + 击退。
 *
 * ⚠️ 与 `ProjectileManager` 的关系：敌方施法弹仍在用 Projectile，
 *    我方**不再产生任何投射物**（CR-017 的直接诉求："发子弹感觉不太好"）。
 *    附带好处是再也不会出现"子弹飞到一半目标已死"的空放。
 */
export class AbilitySystem {
    /** 构造后接线（避免与 EnemyManager / BossController 循环 import） */
    enemies: EnemyManager | null = null;
    boss: BossController | null = null;

    private _items: AbilityFx[] = [];

    get list(): readonly AbilityFx[] {
        return this._items;
    }

    // ---------------- 施放 ----------------

    /**
     * 贯穿：瞬发直线，立即结算，返回命中数。
     *
     * `extra` 是升级项「连锁」的层数 —— 每层追加一条**平行**光束（法线方向偏移 24px）。
     * 不做角度扇形：扇形在 320px 距离上会散成三条各打一只的弱光，
     * 平行反而读得出"三刀同切"。
     */
    castBeam(
        x: number, y: number, dx: number, dy: number,
        range: number, dmg: number, crit: boolean, extra: number,
    ): number {
        const a = ABILITY.beam;
        // 法线：光束的横向偏移方向
        const nx = -dy;
        const ny = dx;
        let total = 0;
        for (let i = 0; i <= extra; i++) {
            // 0 层偏移为 0；两层时 ±24px 对称分列
            const off = extra === 0 ? 0 : (i - extra / 2) * 24;
            const sx = x + nx * off;
            const sy = y + ny * off;
            // 射程由调用方传入（吃「嗅探」加成），与索敌半径保持一致
            const ex = sx + dx * range;
            const ey = sy + dy * range;

            total += this.hitSegment(sx, sy, ex, ey, a.halfWidth, dmg, a.maxTargets, crit);
            this._items.push({
                kind: 'beam',
                x: sx, y: sy, ex, ey,
                halfWidth: a.halfWidth,
                t: 0, life: a.fxLife, crit,
            });
        }
        return total;
    }

    /**
     * 落雷：在目标点生成预警圈，`warn` 秒后才结算伤害。
     *
     * 为什么要延迟：这是一个**自动施放**的技能，如果即时结算，玩家看到的永远是
     * "怪莫名其妙掉血 + 一圈光"。给 0.32s 预警，画面会变成"怪脚下亮起来 → 炸"，
     * 因果就成立了。代价是可能打空（怪走了），但 54px 半径下几乎不会。
     */
    castBolt(
        x: number, y: number, tx: number, ty: number,
        dmg: number, crit: boolean, extra: number,
    ): void {
        const a = ABILITY.bolt;
        for (let i = 0; i <= extra; i++) {
            let px = tx;
            let py = ty;
            if (i > 0) {
                // 追加落点：绕主落点随机 55px，避免两个圈完全重叠
                const ang = Math.random() * Math.PI * 2;
                const r = 55;
                px += Math.cos(ang) * r;
                py += Math.sin(ang) * r;
            }
            this._items.push({
                kind: 'bolt',
                x: px, y: py,
                radius: a.radius,
                t: 0,
                // 存留 = 预警 + 爆开后的可见时长
                life: a.warn + a.fxLife,
                warn: a.warn,
                fired: false,
                dmg,
                crit,
            });
        }
    }

    /**
     * 冲击：以英雄为中心的环形爆发，**立即结算**，视觉上的扩散环是余波。
     *
     * 判定时刻刻意先于视觉：如果等环扩散到 96px 才判定，玩家会看到
     * "圈还没碰到怪，怪已经飞了"。环形技能的正确读法是"脚下炸开，波往外推"，
     * 所以判定在炸开的那一瞬，扩散只是余韵。
     */
    castNova(x: number, y: number, dmg: number, crit: boolean, extra: number): number {
        const a = ABILITY.nova;
        let total = 0;
        // 每层追加一圈更大的环（半径 ×1.4，伤害 ×0.6），视觉上是双环叠开
        for (let i = 0; i <= extra; i++) {
            const radius = a.radius * Math.pow(1.4, i);
            const d = i === 0 ? dmg : dmg * 0.6;
            total += this.hitCircle(x, y, radius, d, a.maxTargets, crit, a.knockback);
            this._items.push({
                kind: 'nova',
                x, y, radius,
                t: 0, life: a.fxLife, crit,
            });
        }
        return total;
    }

    // ---------------- 推进 ----------------

    update(dt: number): void {
        const items = this._items;
        for (const fx of items) {
            fx.t += dt;
            // 落雷：到点结算（只结算一次）
            if (fx.kind === 'bolt' && !fx.fired && fx.t >= fx.warn) {
                fx.fired = true;
                this.hitCircle(fx.x, fx.y, fx.radius, fx.dmg, ABILITY.bolt.maxTargets, fx.crit, 0);
            }
        }
        // 原地压缩：这些实例 0.14~0.54s 就死，用 splice 会在数组中间反复搬内存
        let n = 0;
        for (let i = 0; i < items.length; i++) {
            if (items[i].t < items[i].life) {
                items[n++] = items[i];
            }
        }
        items.length = n;
    }

    clear(): void {
        this._items.length = 0;
    }

    // ---------------- 判定 ----------------

    private hitCircle(
        x: number, y: number, r: number,
        dmg: number, maxTargets: number, crit: boolean, knockback: number,
    ): number {
        let hits = 0;
        const b = this.boss;
        // BOSS 命中就占掉"第一个目标"的名额，杂兵从第二档开始吃伤害
        const bossHit = !!(b && b.tryHit(x, y, r));
        if (b && bossHit) {
            b.takeDamage(dmg, 0, 0, crit);
            hits++;
        }
        if (this.enemies) {
            hits += this.enemies.damageInRadius(
                x, y, r, dmg, maxTargets, crit, 0, 0, knockback,
                bossHit ? AOE_FALLOFF : 1,
            );
        }
        return hits;
    }

    private hitSegment(
        x0: number, y0: number, x1: number, y1: number,
        halfWidth: number, dmg: number, maxTargets: number, crit: boolean,
    ): number {
        let hits = 0;
        const b = this.boss;
        const bossHit = !!(b && b.tryHitSegment(x0, y0, x1, y1, halfWidth));
        if (b && bossHit) {
            const dx = x1 - x0;
            const dy = y1 - y0;
            b.takeDamage(dmg, dx, dy, crit);
            hits++;
        }
        if (this.enemies) {
            hits += this.enemies.damageInSegment(
                x0, y0, x1, y1, halfWidth, dmg, maxTargets, crit,
                bossHit ? AOE_FALLOFF : 1,
            );
        }
        return hits;
    }
}
