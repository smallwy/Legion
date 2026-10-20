import { Node, Sprite, UITransform } from 'cc';
import { HERO } from '../config/BattleConfig';
import { Formation } from './Formation';
import type { SlotPoint } from './Formation';
import type { BossController } from './BossController';
import type { Enemy, EnemyManager } from './EnemyManager';
import type { PlayerController } from './PlayerController';
import type { ProjectileManager } from './ProjectileManager';
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
    powerMul: number;   // 「半饿最强」挂钩点
    baseScale: number;
    hasSprite: boolean;
}

/**
 * 英雄小队：**列队跟随**主角 + 自动施法三段状态机（CR-009 / CR-014）。
 *
 * 与原 `PetSquad`（环绕）的唯一结构差别：
 *  - 位置由 `Formation` 的槽位给出 —— 它们**跟在你身后**，而不是绕着你转圈；
 *  - 施法状态机、索敌、弹道发射逻辑原样保留，那部分与队形无关。
 *
 * 状态链：idle → telegraph(0.25s 前摇) → cast(0.1s 施法/发射) → recovery(0.3s 后摇) → idle
 * 三段合计 0.65s/轮 = 1.54 次/秒（CR-011 定案口径）。
 */
export class HeroSquad {
    /**
     * BOSS 也是可锁定目标（CR-014）。默认 null，由 `GameBootstrap` 在
     * BossController 构造后接线 —— 与 `ProjectileManager.boss` 同一套做法，
     * 避免 HeroSquad 与 BossController 互相构造依赖。
     *
     * ⚠️ 不接这条线的话：BOSS 不在 `EnemyManager` 里，英雄就永远索不到它，
     * 子弹也不会飞过去 —— BOSS 阶段会变成"打不动的木头"，一局永远通不了关。
     */
    boss: BossController | null = null;

    private _heroes: Hero[] = [];
    private _formation = new Formation();
    private _slot: SlotPoint = { x: 0, y: 0 };

    constructor(
        parent: Node,
        private _player: PlayerController,
        private _enemies: EnemyManager,
        private _projectiles: ProjectileManager,
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
            });
            node.setPosition(this._slot.x, this._slot.y, 2);
        }
    }

    get list(): Hero[] {
        return this._heroes;
    }

    update(dt: number): void {
        const p = this._player;
        this._formation.update(dt, p.x, p.y, p.vx, p.vy);

        for (let i = 0; i < this._heroes.length; i++) {
            const h = this._heroes[i];

            // ---- 槽位弹性跟随（弹簧-阻尼：落到目标点后稳定，不来回震荡）----
            this._formation.slotTarget(i, this._slot);
            h.vx += (this._slot.x - h.x) * HERO.followStiffness * dt;
            h.vy += (this._slot.y - h.y) * HERO.followStiffness * dt;
            const damp = Math.max(0, 1 - HERO.followDamping * dt);
            h.vx *= damp;
            h.vy *= damp;
            h.x += h.vx * dt;
            h.y += h.vy * dt;

            this.updateCast(dt, h);

            // ---- 表现：位置 + 施法缩放脉冲（程序化兜底身体由 EntityRenderer 画）----
            let s = h.baseScale;
            if (h.state === 'telegraph') {
                s *= 1 + 0.18 * (1 - h.stateT / HERO.telegraph);
            } else if (h.state === 'cast') {
                s *= 1.28;
            } else if (h.state === 'recovery') {
                s *= 1 + 0.28 * (h.stateT / HERO.recovery);
            }
            h.node.setPosition(h.x, h.y, 2);
            h.node.setScale(s, s, 1);
        }
    }

    private updateCast(dt: number, h: Hero): void {
        h.stateT -= dt;
        switch (h.state) {
            case 'idle':
                if (h.stateT <= 0) {
                    const t = this.acquire(h.x, h.y);
                    if (t) {
                        h.target = t;
                        h.state = 'telegraph';
                        h.stateT = HERO.telegraph;
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
                    this.fire(h);
                    h.state = 'cast';
                    h.stateT = HERO.cast;
                }
                break;
            case 'cast':
                if (h.stateT <= 0) {
                    h.state = 'recovery';
                    h.stateT = HERO.recovery;
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
    private acquire(x: number, y: number): CastTarget | null {
        const e = this._enemies.getNearest(x, y, HERO.acquireRange);
        const b = this.boss;
        if (!b || !b.alive) {
            return e;
        }
        const bb = b.boss;
        const db = Math.hypot(bb.x - x, bb.y - y);
        if (db > HERO.acquireRange) {
            return e;
        }
        if (!e) {
            return bb;
        }
        const de = Math.hypot(e.x - x, e.y - y);
        return db <= de ? bb : e;
    }

    private fire(h: Hero): void {
        const len = Math.hypot(h.aimX, h.aimY) || 1;
        const dx = h.aimX / len;
        const dy = h.aimY / len;
        this._projectiles.spawnPetBullet(h.x + dx * 14, h.y + dy * 14, dx, dy, HERO.damage * h.powerMul);
    }

    reset(): void {
        this._formation.reset(this._player.x, this._player.y);
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
            h.node.setScale(h.baseScale, h.baseScale, 1);
            h.node.setPosition(h.x, h.y, 2);
        }
    }
}
