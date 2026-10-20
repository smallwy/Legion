import { Node, Sprite, UITransform } from 'cc';
import { ENEMIES, ENEMY_AI, FIELD } from '../config/BattleConfig';
import type { EnemyDef, EnemyType } from '../config/BattleConfig';
import { clamp, TAU } from '../core/MathUtil';
import { Pool } from '../core/Pool';
import type { PlayerController } from './PlayerController';
import type { ProjectileManager } from './ProjectileManager';
import type { SpriteEntry } from '../view/SpriteAssets';

/** 死亡动画时长（缩小消失） */
export const ENEMY_DEATH_TIME = 0.15;

export type EnemyAIState = 'roam' | 'chase' | 'windup' | 'strike' | 'castwindup' | 'cast' | 'recover';

export interface Enemy {
    active: boolean;
    type: EnemyType;
    def: EnemyDef;
    node: Node;
    hasSprite: boolean;
    x: number;
    y: number;
    vx: number;      // 击退速度
    vy: number;
    hp: number;
    anchorX: number; // 所属怪窝中心（活动范围锚点）
    anchorY: number;
    wanderX: number;
    wanderY: number;
    wanderT: number;
    t: number;       // 存活时间（蛇形相位用）
    phase: number;   // 随机相位
    nest: number;    // 生成组编号（CR-015 起 = 波号；原为怪窝序号）
    /**
     * 猎手标记（CR-015）：波次生成的敌人**主动追玩家**，无视 aggroRange。
     *
     * ⚠️ 这条是波次系统能成立的前提。CR-008 的敌人是"守在窝边，你走进 aggroRange
     * 才追"，而波次怪是从 600px 外生成的 —— 没有这个标记，它们会在原地游荡，
     * 永远走不过来，整局变成"玩家满地图找怪"。
     */
    hunter: boolean;
    state: EnemyAIState;
    stateT: number;
    cd: number;
    hitPunch: number; // 受击缩放脉冲 0..1
    dying: number;    // >0 播放死亡动画
    baseScale: number;
}

/**
 * 敌人管理：CR-008 模型——成批生成、独立 AI、可移动、有攻击半径与施法半径。
 * AI 要点：
 *  - 不必然追玩家：只有玩家进入 aggroRange 才进入 chase，否则在窝边游走；
 *  - 近战：进入 attackRange(60) → 前摇 → 判定 → 后摇；
 *  - 飞虫：进入 castRange(140) → 读条前摇（可视圈）→ 发射弹道。
 * 敌人之间不做碰撞检测（计划书 §5.1），只做极软的分离防叠层。
 */
export class EnemyManager {
    onKill: ((e: Enemy) => void) | null = null;
    /**
     * 命中回调（CR-016）：每次**有效**伤害都触发，`killed` 表示这一击是不是最后一击。
     * 表现层靠它出火花/飘字/顿帧 —— 战斗逻辑不要在这里做，它会被每秒调用几十次。
     */
    onHit: ((e: Enemy, dmg: number, dirX: number, dirY: number, crit: boolean, killed: boolean) => void) | null = null;
    /** 构造后由 Bootstrap 接线（类型引用，避免循环 import） */
    projectiles: ProjectileManager | null = null;

    private _enemies: Enemy[] = [];
    private _pools: { [k in EnemyType]: Pool<Enemy> };
    private _sprites: { [k in EnemyType]: SpriteEntry | null };
    private _parent: Node;
    private _player: PlayerController;

    constructor(
        parent: Node,
        player: PlayerController,
        sprites: { walker: SpriteEntry | null; flyer: SpriteEntry | null; tank: SpriteEntry | null },
    ) {
        this._parent = parent;
        this._player = player;
        this._sprites = sprites;
        this._pools = {
            walker: new Pool<Enemy>(() => this.createEnemy('walker')),
            flyer: new Pool<Enemy>(() => this.createEnemy('flyer')),
            tank: new Pool<Enemy>(() => this.createEnemy('tank')),
        };
    }

    get list(): Enemy[] {
        return this._enemies;
    }

    get aliveCount(): number {
        let n = 0;
        for (const e of this._enemies) {
            if (e.active && e.dying <= 0) n++;
        }
        return n;
    }

    /** 某一生成组还活着的数量（CR-015 起 group = 波号，波次推进用它判定本波是否打完） */
    aliveCountOfGroup(group: number): number {
        let n = 0;
        for (const e of this._enemies) {
            if (e.active && e.dying <= 0 && e.nest === group) n++;
        }
        return n;
    }

    /** 索敌：范围内最近活敌（宠物自动开火用） */
    getNearest(x: number, y: number, range: number): Enemy | null {
        let best: Enemy | null = null;
        let bestD2 = range * range;
        for (const e of this._enemies) {
            if (!e.active || e.dying > 0) continue;
            const dx = e.x - x;
            const dy = e.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = e;
            }
        }
        return best;
    }

    /** 弹体命中检测：返回第一个圆重叠的敌人 */
    hitTest(x: number, y: number, r: number): Enemy | null {
        for (const e of this._enemies) {
            if (!e.active || e.dying > 0) continue;
            const rr = r + e.def.radius;
            const dx = e.x - x;
            const dy = e.y - y;
            if (dx * dx + dy * dy <= rr * rr) {
                return e;
            }
        }
        return null;
    }

    /**
     * @param nest   生成组编号（CR-015 起 = 波号）
     * @param hunter true = 猎手（无视 aggroRange 主动追玩家），波次怪一律传 true
     */
    spawn(type: EnemyType, x: number, y: number, anchorX: number, anchorY: number, nest: number, hunter = false): void {
        const e = this._pools[type].get();
        e.active = true;
        e.dying = 0;
        e.hitPunch = 0;
        e.x = x;
        e.y = y;
        e.vx = 0;
        e.vy = 0;
        e.hp = e.def.hp;
        e.anchorX = anchorX;
        e.anchorY = anchorY;
        e.nest = nest;
        e.hunter = hunter;
        e.t = 0;
        e.phase = Math.random() * TAU;
        // 猎手直接进 chase，省掉"先游荡再发现你"的一两秒延迟
        e.state = hunter ? 'chase' : 'roam';
        e.stateT = 0;
        e.cd = 0.5 + Math.random() * 0.8;
        e.wanderT = 0;
        this.retargetWander(e);
        if (e.node.parent !== this._parent) {
            this._parent.addChild(e.node);
        }
        e.node.active = true;
        e.node.setScale(e.baseScale, e.baseScale, 1);
        this._enemies.push(e);
    }

    takeDamage(e: Enemy, dmg: number, dirX: number, dirY: number, crit = false): void {
        if (!e.active || e.dying > 0) {
            return;
        }
        e.hp -= dmg;
        e.hitPunch = 1;
        const len = Math.hypot(dirX, dirY) || 1;
        // 甲虫极硬：只受 20% 击退（计划书：老实牛式"极硬"给敌人的对应感受）
        const kb = e.type === 'tank' ? 20 : 90;
        e.vx += (dirX / len) * kb;
        e.vy += (dirY / len) * kb;
        const killed = e.hp <= 0;
        // 命中回调先于击杀回调：先出火花，再判断是不是"最后一击"，
        // 这样表现层可以给击杀一个更重的反馈（顿帧/爆散）
        if (this.onHit) {
            this.onHit(e, dmg, dirX, dirY, crit, killed);
        }
        if (killed) {
            e.dying = ENEMY_DEATH_TIME;
            if (this.onKill) {
                this.onKill(e);
            }
        }
    }

    update(dt: number): void {
        const px = this._player.x;
        const py = this._player.y;
        const hw = FIELD.width / 2;
        const hh = FIELD.height / 2;

        for (const e of this._enemies) {
            if (!e.active) continue;

            if (e.dying > 0) {
                e.dying -= dt;
                if (e.dying <= 0) {
                    e.active = false;
                    e.node.active = false;
                    continue;
                }
                const k = e.dying / ENEMY_DEATH_TIME;
                e.node.setScale(e.baseScale * k, e.baseScale * k, 1);
                continue;
            }

            // 击退衰减
            if (e.vx !== 0 || e.vy !== 0) {
                const d = Math.max(0, 1 - 10 * dt);
                e.vx *= d;
                e.vy *= d;
                e.x += e.vx * dt;
                e.y += e.vy * dt;
            }

            e.t += dt;
            e.cd -= dt;
            e.wanderT -= dt;
            if (e.hitPunch > 0) {
                e.hitPunch = Math.max(0, e.hitPunch - dt * 5);
            }

            const distP = Math.hypot(px - e.x, py - e.y);
            this.updateAI(e, dt, distP, px, py);

            e.x = clamp(e.x, -hw + e.def.radius, hw - e.def.radius);
            e.y = clamp(e.y, -hh + e.def.radius, hh - e.def.radius);

            let s = e.baseScale;
            if (e.hitPunch > 0) s *= 1 + 0.3 * e.hitPunch;
            if (e.state === 'windup' || e.state === 'castwindup') s *= 1.12;
            e.node.setPosition(e.x, e.y, 0);
            e.node.setScale(s, s, 1);
        }

        this.separate();

        // 回收播放完死亡动画的
        for (let i = this._enemies.length - 1; i >= 0; i--) {
            const e = this._enemies[i];
            if (!e.active) {
                this._enemies.splice(i, 1);
                e.node.removeFromParent();
                this._pools[e.type].put(e);
            }
        }
    }

    clear(): void {
        for (const e of this._enemies) {
            e.active = false;
            e.node.active = false;
            e.node.removeFromParent();
            this._pools[e.type].put(e);
        }
        this._enemies.length = 0;
    }

    // ---------------- 内部 ----------------

    private createEnemy(type: EnemyType): Enemy {
        const def = ENEMIES[type];
        const node = new Node('Enemy_' + type);
        this._parent.addChild(node);
        node.addComponent(UITransform);

        let hasSprite = false;
        let baseScale = 1;
        const entry = this._sprites[type];
        if (entry) {
            const sp = node.addComponent(Sprite);
            sp.spriteFrame = entry.frame;
            baseScale = def.displaySize / entry.width;
            hasSprite = true;
        }
        node.active = false;

        return {
            active: false,
            type,
            def,
            node,
            hasSprite,
            x: 0, y: 0, vx: 0, vy: 0,
            hp: def.hp,
            anchorX: 0, anchorY: 0,
            wanderX: 0, wanderY: 0, wanderT: 0,
            t: 0, phase: 0, nest: 0, hunter: false,
            state: 'roam', stateT: 0, cd: 0, hitPunch: 0, dying: 0,
            baseScale,
        };
    }

    private updateAI(e: Enemy, dt: number, distP: number, px: number, py: number): void {
        const def = e.def;
        e.stateT -= dt;

        switch (e.state) {
            case 'roam': {
                // 猎手不等你走进 aggroRange —— 它就是冲你来的
                if (e.hunter || distP < def.aggroRange) {
                    e.state = 'chase';
                    break;
                }
                this.moveToward(e, e.wanderX, e.wanderY, def.speed * 0.55, dt, false);
                // 软拉回活动范围
                const da = Math.hypot(e.x - e.anchorX, e.y - e.anchorY);
                if (da > ENEMY_AI.roamRadius) {
                    e.wanderT = 0;
                    e.wanderX = e.anchorX;
                    e.wanderY = e.anchorY;
                }
                if (e.wanderT <= 0 || Math.hypot(e.wanderX - e.x, e.wanderY - e.y) < 12) {
                    this.retargetWander(e);
                }
                break;
            }
            case 'chase': {
                // 猎手永不放弃（否则玩家跑远一步就整波脱战，波次压力会漏光）
                if (!e.hunter && distP > def.aggroRange * 1.2) {
                    e.state = 'roam';
                    this.retargetWander(e);
                    break;
                }
                if (def.projectileSpeed > 0) {
                    // 飞虫：逼近到施法距离 75% 后侧向游走（蛇形），不贴身
                    if (distP > def.castRange * 0.75) {
                        this.moveToward(e, px, py, def.speed, dt, true);
                    } else {
                        const ang = Math.atan2(e.y - py, e.x - px) + 0.9 * dt;
                        const r = Math.max(60, distP);
                        e.x = px + Math.cos(ang) * r;
                        e.y = py + Math.sin(ang) * r;
                    }
                    if (distP < def.castRange && e.cd <= 0) {
                        e.state = 'castwindup';
                        e.stateT = def.windup;
                    }
                } else {
                    if (distP > def.attackRange * 0.85) {
                        this.moveToward(e, px, py, def.speed, dt, false);
                    } else if (e.cd <= 0) {
                        e.state = 'windup';
                        e.stateT = def.windup;
                    }
                }
                break;
            }
            case 'windup':
                if (e.stateT <= 0) {
                    // 前摇结束仍在半径内才打到（给走位躲开的窗口）
                    if (Math.hypot(px - e.x, py - e.y) <= def.attackRange * 1.15) {
                        this._player.takeDamage(def.damage);
                    }
                    e.state = 'strike';
                    e.stateT = 0.15;
                }
                break;
            case 'strike':
                if (e.stateT <= 0) {
                    e.state = 'recover';
                    e.stateT = 0.35;
                    e.cd = def.attackCd;
                }
                break;
            case 'castwindup':
                if (e.stateT <= 0) {
                    this.castSpell(e, px, py);
                    e.state = 'cast';
                    e.stateT = 0.1;
                }
                break;
            case 'cast':
                if (e.stateT <= 0) {
                    e.state = 'recover';
                    e.stateT = 0.4;
                    e.cd = def.attackCd;
                }
                break;
            case 'recover':
                if (e.stateT <= 0) {
                    e.state = (e.hunter || distP < def.aggroRange) ? 'chase' : 'roam';
                }
                break;
        }
    }

    private moveToward(e: Enemy, tx: number, ty: number, speed: number, dt: number, weave: boolean): void {
        let dx = tx - e.x;
        let dy = ty - e.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        if (weave) {
            // 飞虫蛇形：朝目标方向叠加正弦偏转
            const w = Math.sin(e.t * 4 + e.phase) * 0.45;
            const nx = dx * Math.cos(w) - dy * Math.sin(w);
            const ny = dx * Math.sin(w) + dy * Math.cos(w);
            dx = nx;
            dy = ny;
        }
        e.x += dx * speed * dt;
        e.y += dy * speed * dt;
    }

    private castSpell(e: Enemy, px: number, py: number): void {
        if (!this.projectiles) return;
        const dx = px - e.x;
        const dy = py - e.y;
        const len = Math.hypot(dx, dy) || 1;
        this.projectiles.spawnEnemySpell(e.x, e.y, dx / len, dy / len, e.def.projectileSpeed, e.def.damage);
    }

    private retargetWander(e: Enemy): void {
        const ang = Math.random() * TAU;
        const r = Math.random() * ENEMY_AI.roamRadius;
        e.wanderX = e.anchorX + Math.cos(ang) * r;
        e.wanderY = e.anchorY + Math.sin(ang) * r;
        e.wanderT = 1.5 + Math.random() * 1.5;
    }

    /** 软分离：防止敌人叠成一坨（非碰撞检测，计划书 §5.1 敌人之间不检测碰撞） */
    private separate(): void {
        const list = this._enemies;
        for (let i = 0; i < list.length; i++) {
            const a = list[i];
            if (!a.active || a.dying > 0) continue;
            for (let j = i + 1; j < list.length; j++) {
                const b = list[j];
                if (!b.active || b.dying > 0) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const min = a.def.radius + b.def.radius;
                const d2 = dx * dx + dy * dy;
                if (d2 >= min * min || d2 === 0) continue;
                const d = Math.sqrt(d2);
                const push = (min - d) * 0.3;
                const nx = dx / d;
                const ny = dy / d;
                a.x -= nx * push;
                a.y -= ny * push;
                b.x += nx * push;
                b.y += ny * push;
            }
        }
    }
}
