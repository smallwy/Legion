import { Node, Sprite, UITransform } from 'cc';
import { ABILITY, HERO, HERO_ABILITIES, SATIETY } from '../config/BattleConfig';
import type { AbilityKind } from '../config/BattleConfig';
import { Formation } from './Formation';
import type { SlotPoint } from './Formation';
import { castCycle } from './UpgradeSystem';
import type { UpgradeStats, UpgradeSystem } from './UpgradeSystem';
import type { AbilitySystem } from './AbilitySystem';
import type { BossController } from './BossController';
import type { EnemyManager } from './EnemyManager';
import type { PlayerController } from './PlayerController';
import type { SpriteEntry } from '../view/SpriteAssets';

export type HeroCastState = 'idle' | 'telegraph' | 'cast' | 'recovery';

/**
 * 可被锁定的目标（杂兵与 BOSS 的公共子集）。
 * `Enemy` 与 `Boss` 都满足这个结构，所以索敌逻辑不必分两条代码路径。
 */
export interface CastTarget {
    x: number;
    y: number;
    active: boolean;
    dying: number;
}

export interface Hero {
    node: Node;
    x: number;
    y: number;
    vx: number;
    vy: number;
    state: HeroCastState;
    stateT: number;
    target: CastTarget | null;
    aimX: number;
    aimY: number;
    powerMul: number;   // 「半饿最强」倍率（每帧由饱食度档位写入）
    baseScale: number;
    hasSprite: boolean;
    /** 槽位序号（0=左后 1=右后 2=正后），决定它用哪个技能 */
    slot: number;
    /** 该槽位的技能形态（CR-017） */
    kind: AbilityKind;
}

/** 饱食度档位（HUD 与渲染都要读，所以导出） */
export type SatietyTier = 'full' | 'hungry' | 'starving';

/**
 * 英雄小队：**列队跟随** + 自动施法三段状态机 + **饱食度/喂食**（CR-009/014/015/017）。
 *
 * CR-015 的唯一新增：宠物不再是"永远满血的炮台"，而是**有状态、会饿、要你喂的活物**。
 *  - 饱食度全队**共享一条**（3 条独立条 = 管理焦虑，正是计划书 §9 引用那条"27 只猫"差评的死因）；
 *  - 衰减 0.7/秒 → 143 秒从满到空，一局要喂 2~3 次；
 *  - 档位倍率：满饱 ×1.0 / **半饿 ×1.5（最强）** / 全饿 ×0.6；
 *  - 喂食有双重代价：消耗肉块（打怪才有）+ 0.4 秒主角减速（怪群里喂要付学费）。
 *
 * CR-017 的改动：**每个槽位一种技能**（贯穿 / 落雷 / 冲击），不再全体发同一种子弹。
 * 三个技能的周期刻意不同（0.72 / 1.05 / 0.62），施法自然错落。
 *
 * 施法链：idle → telegraph → cast → recovery → idle，周期受升级「急食」缩放。
 */
export class HeroSquad {
    /**
     * BOSS 也是可锁定目标。由 `GameBootstrap` 在 BossController 构造后接线，
     * 避免 HeroSquad 与 BossController 互相构造依赖。
     * ⚠️ 不接这条线：BOSS 不在 EnemyManager 里，英雄永远索不到它，一局通不了关。
     */
    boss: BossController | null = null;
    /** 升级系统（构造后接线）。不接则按基础值跑，不会崩。 */
    upgrades: UpgradeSystem | null = null;
    /** 技能系统（构造后接线）。不接则英雄只走状态机、不产生任何伤害。 */
    abilities: AbilitySystem | null = null;

    /** 全队共享饱食度 0~100 */
    satiety: number = SATIETY.start;
    /** 喂食冷却 */
    feedCd: number = 0;
    /** 喂食硬直剩余时间（>0 时主角减速） */
    stunT: number = 0;
    /** 喂食后的短时兴奋（渲染用，不影响数值） */
    exciteT: number = 0;
    /** 本局喂了几次（结算展示） */
    feeds: number = 0;

    private _heroes: Hero[] = [];
    private _formation = new Formation();
    private _slot: SlotPoint = { x: 0, y: 0 };

    constructor(
        parent: Node,
        private _player: PlayerController,
        private _enemies: EnemyManager,
        heroSprite: SpriteEntry | null,
    ) {
        // 先让队形锚在主角初始位（否则开局槽位会算到 (0,0) 原点）
        this._formation.reset(this._player.x, this._player.y);

        for (let i = 0; i < HERO.count; i++) {
            const node = new Node('Hero_' + i);
            parent.addChild(node);
            node.addComponent(UITransform);

            let hasSprite = false;
            let baseScale = 1;
            if (heroSprite) {
                const sp = node.addComponent(Sprite);
                sp.spriteFrame = heroSprite.frame;
                baseScale = HERO.displaySize / heroSprite.width;
                hasSprite = true;
            }
            node.setScale(baseScale, baseScale, 1);

            // 初始直接落在槽位上，否则开局会从主角身上"弹"出去
            this._formation.slotTarget(i, this._slot);

            this._heroes.push({
                node,
                x: this._slot.x,
                y: this._slot.y,
                vx: 0,
                vy: 0,
                state: 'idle',
                stateT: 0,
                target: null,
                aimX: 1,
                aimY: 0,
                powerMul: HERO.powerMultiplier,
                baseScale,
                hasSprite,
                slot: i,
                kind: HERO_ABILITIES[i % HERO_ABILITIES.length],
            });
            node.setPosition(this._slot.x, this._slot.y, 2);
        }
    }

    get list(): Hero[] {
        return this._heroes;
    }

    /** 当前档位（HUD 上色用） */
    get tier(): SatietyTier {
        const starving = this.upgrades ? this.upgrades.starvingLine : SATIETY.hungryLine;
        if (this.satiety >= SATIETY.fullLine) return 'full';
        if (this.satiety >= starving) return 'hungry';
        return 'starving';
    }

    /** 当前档位对应的火力倍率 */
    get powerMul(): number {
        switch (this.tier) {
            case 'full': return SATIETY.mulFull;
            case 'hungry': return SATIETY.mulHungry;
            default: return SATIETY.mulStarving;
        }
    }

    /** 能不能喂（HUD 提示用） */
    canFeed(meat: number): boolean {
        return this.feedCd <= 0 && this.satiety < SATIETY.max && meat >= SATIETY.feedMeatCost;
    }

    /**
     * 喂食（F 键）。
     * @returns 是否真的喂了（false 表示冷却中/满了/没肉块 —— 外部据此决定要不要扣肉块）
     */
    feed(meat: number): boolean {
        if (!this.canFeed(meat)) {
            return false;
        }
        const mul = this.upgrades ? this.upgrades.stats.feedMul : 1;
        this.satiety = Math.min(SATIETY.max, this.satiety + SATIETY.feedAmount * mul);
        this.feedCd = SATIETY.feedCd;
        this.stunT = SATIETY.feedStun;
        this.exciteT = 1.2;
        this.feeds++;
        return true;
    }

    update(dt: number): void {
        const up = this.upgrades;
        const stats = up ? up.stats : null;

        // ---- 饱食度（全队共享）----
        const decay = SATIETY.decayPerSec * (stats ? stats.decayMul : 1);
        this.satiety = Math.max(0, this.satiety - decay * dt);
        if (this.feedCd > 0) this.feedCd -= dt;
        if (this.stunT > 0) this.stunT -= dt;
        if (this.exciteT > 0) this.exciteT -= dt;

        // ---- 移速倍率：升级 + 喂食硬直相乘（唯一写入点）----
        const speedMul = (stats ? stats.speedMul : 1) * (this.stunT > 0 ? SATIETY.feedStunSpeedMul : 1);
        this._player.speedMul = speedMul;

        const mul = this.powerMul;

        const p = this._player;
        this._formation.update(dt, p.x, p.y, p.vx, p.vy);

        for (let i = 0; i < this._heroes.length; i++) {
            const h = this._heroes[i];
            h.powerMul = mul;   // 「半饿最强」在这里真正生效

            // 周期按技能取（CR-017）：三个槽位的基础节奏不同，
            // 这是"施法自然错落、不会三发同时出膛"的来源。
            const cycle = this._cycleOf(h, stats);

            // ---- 槽位弹性跟随（弹簧-阻尼：落到目标点后稳定，不来回震荡）----
            this._formation.slotTarget(i, this._slot);
            h.vx += (this._slot.x - h.x) * HERO.followStiffness * dt;
            h.vy += (this._slot.y - h.y) * HERO.followStiffness * dt;
            const damp = Math.max(0, 1 - HERO.followDamping * dt);
            h.vx *= damp;
            h.vy *= damp;
            h.x += h.vx * dt;
            h.y += h.vy * dt;

            this.updateCast(dt, h, cycle, stats);

            // ---- 表现：位置 + 施法缩放脉冲（程序化兜底身体由 EntityRenderer 画）----
            let s = h.baseScale;
            if (h.state === 'telegraph') {
                s *= 1 + 0.18 * (1 - h.stateT / cycle.telegraph);
            } else if (h.state === 'cast') {
                s *= 1.28;
            } else if (h.state === 'recovery') {
                s *= 1 + 0.28 * (h.stateT / cycle.recovery);
            }
            // 喂食兴奋：短暂放大，让"我刚喂过"这件事看得见
            if (this.exciteT > 0) {
                s *= 1 + 0.12 * (this.exciteT / 1.2);
            }
            h.node.setPosition(h.x, h.y, 2);
            h.node.setScale(s, s, 1);
        }
    }

    private updateCast(
        dt: number,
        h: Hero,
        cycle: { telegraph: number; cast: number; recovery: number },
        stats: UpgradeStats | null,
    ): void {
        h.stateT -= dt;
        switch (h.state) {
            case 'idle':
                if (h.stateT <= 0) {
                    const t = this.acquire(h.x, h.y, this._rangeOf(h, stats));
                    if (t) {
                        h.target = t;
                        h.state = 'telegraph';
                        h.stateT = cycle.telegraph;
                    }
                }
                break;
            case 'telegraph':
                // 前摇期间持续瞄准（目标死亡/脱离则保持最后方向）
                if (h.target && h.target.active && h.target.dying <= 0) {
                    h.aimX = h.target.x - h.x;
                    h.aimY = h.target.y - h.y;
                }
                if (h.stateT <= 0) {
                    // 进入施法瞬间即发射（CR-009：施法段 = 发射瞬间）
                    this.fire(h, stats);
                    h.state = 'cast';
                    h.stateT = cycle.cast;
                }
                break;
            case 'cast':
                if (h.stateT <= 0) {
                    h.state = 'recovery';
                    h.stateT = cycle.recovery;
                }
                break;
            case 'recovery':
                if (h.stateT <= 0) {
                    h.state = 'idle';
                    h.stateT = 0;
                    h.target = null;
                }
                break;
            default:
                break;
        }
    }

    /**
     * 索敌：在「最近的杂兵」与「BOSS」之间取更近的那个。
     * BOSS 阶段场上已无杂兵，这条是英雄对 BOSS 开火的唯一通道（见 `boss` 字段注释）。
     */
    private acquire(x: number, y: number, range: number): CastTarget | null {
        const e = this._enemies.getNearest(x, y, range);
        const b = this.boss;
        if (!b || !b.alive) {
            return e;
        }
        const bb = b.boss;
        const db = Math.hypot(bb.x - x, bb.y - y);
        if (db > range) {
            return e;
        }
        if (!e) {
            return bb;
        }
        const de = Math.hypot(e.x - x, e.y - y);
        return db <= de ? bb : e;
    }

    /**
     * 施法周期按技能取（受「急食」缩放）。
     * 没接升级系统时退化为原始配置，保证"不接线也能跑"。
     */
    private _cycleOf(h: Hero, stats: UpgradeStats | null): { telegraph: number; cast: number; recovery: number } {
        if (stats) {
            return castCycle(stats, h.kind);
        }
        const a = ABILITY[h.kind];
        return { telegraph: a.telegraph, cast: a.cast, recovery: a.recovery };
    }

    /**
     * 索敌半径按技能取。
     *
     * ⚠️ **两种技能都必须收窄**，否则会出现"抬手了但什么都没打到"：
     *  - `nova` 有效半径 96，而 `acquireRange` 是 340 —— 沿用 340 会让正后那只英雄
     *    对着 300px 外的怪放一圈空气（玩家读到的是 bug）。收窄后它只在贴身时出手，
     *    这正好是"守卫"该有的行为：你被围住时才需要它。
     *  - `beam` 射程 320，比 340 差 20px —— 目标落在 325 处时会抬手打空，留 10px 余量。
     */
    private _rangeOf(h: Hero, stats: UpgradeStats | null): number {
        const base = HERO.acquireRange * (stats ? stats.rangeMul : 1);
        if (h.kind === 'nova') {
            return Math.min(base, ABILITY.nova.radius + 40);
        }
        if (h.kind === 'beam') {
            // 光束长度也吃「嗅探」加成，否则升级范围之后打空窗口会变大
            const reach = ABILITY.beam.range * (stats ? stats.rangeMul : 1) - 10;
            return Math.min(base, reach);
        }
        return base;
    }

    /**
     * 出手：按槽位分派到三种技能（CR-017）。
     *
     * 伤害口径不变：`技能基础 × 饱食倍率 × 升级伤害`，暴击再 ×2。
     * 「连锁」层数作为 `extra` 传给技能，由技能自己解释（平行光束 / 多落点 / 双环）。
     */
    private fire(h: Hero, stats: UpgradeStats | null): void {
        const ab = this.abilities;
        if (!ab) {
            return;
        }
        const len = Math.hypot(h.aimX, h.aimY) || 1;
        const dx = h.aimX / len;
        const dy = h.aimY / len;

        const crit = stats !== null && Math.random() < stats.critChance;
        let dmg = ABILITY[h.kind].damage * h.powerMul * (stats ? stats.damageMul : 1);
        if (crit) {
            dmg *= 2;
        }
        const extra = stats ? stats.multishot : 0;

        switch (h.kind) {
            case 'beam':
                ab.castBeam(h.x, h.y, dx, dy, ABILITY.beam.range * (stats ? stats.rangeMul : 1), dmg, crit, extra);
                break;
            case 'bolt': {
                // 落点取**施法瞬间**的目标位置，不是抬手时缓存的坐标：
                // 0.3s 抬手期间怪会走，用旧坐标会明显砸在怪身后。
                const t = h.target;
                const tx = t ? t.x : h.x + dx * 200;
                const ty = t ? t.y : h.y + dy * 200;
                ab.castBolt(h.x, h.y, tx, ty, dmg, crit, extra);
                break;
            }
            default:
                ab.castNova(h.x, h.y, dmg, crit, extra);
                break;
        }
    }

    reset(): void {
        this._formation.reset(this._player.x, this._player.y);
        this.satiety = SATIETY.start;
        this.feedCd = 0;
        this.stunT = 0;
        this.exciteT = 0;
        this.feeds = 0;
        this._player.speedMul = 1;
        for (let i = 0; i < this._heroes.length; i++) {
            const h = this._heroes[i];
            this._formation.slotTarget(i, this._slot);
            h.x = this._slot.x;
            h.y = this._slot.y;
            h.vx = 0;
            h.vy = 0;
            h.state = 'idle';
            h.stateT = 0;
            h.target = null;
            h.powerMul = HERO.powerMultiplier;
            h.node.setScale(h.baseScale, h.baseScale, 1);
            h.node.setPosition(h.x, h.y, 2);
        }
    }
}
