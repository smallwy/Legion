import { Node, Sprite, UITransform } from 'cc';
import { BOSS, FIELD } from '../config/BattleConfig';
import { clamp } from '../core/MathUtil';
import type { PlayerController } from './PlayerController';
import type { SpriteEntry } from '../view/SpriteAssets';

export type BossState = 'dormant' | 'chase' | 'aoeWindup' | 'aoeStrike' | 'recover' | 'dead';

export interface Boss {
    active: boolean;
    node: Node;
    x: number;
    y: number;
    vx: number;
    vy: number;
    hp: number;
    maxHp: number;
    state: BossState;
    stateT: number;
    cd: number;
    touchCd: number;
    hitPunch: number;
    dying: number;
    baseScale: number;
    hasSprite: boolean;
    t: number;
}

/**
 * 最终 BOSS（CR-014 新增）：全部怪窝清空后在最后一窝登场。
 *
 * 设计要点（都属于"零美术成本换表现"）：
 *  - **AOE 读条 1.2s**：这是玩家唯一需要反应的东西，也是本作"走位躲技能"的核心；
 *  - **读条时 BOSS 站定不动**：停住本身就是信号，比任何动画都清楚；
 *  - **不做像素破坏性缩放**：BOSS 恒定为 4 倍贴图。受击反馈交给 EntityRenderer 的白闪，
 *    危险反馈交给 AOE 红圈。1.06 这类缩放会让 128px 的像素块在两档之间跳，观感是"抖"。
 */
export class BossController {
    onDefeated: (() => void) | null = null;

    private _boss: Boss;

    constructor(parent: Node, private _player: PlayerController, sprite: SpriteEntry | null) {
        const node = new Node('Boss');
        parent.addChild(node);
        node.addComponent(UITransform);

        let hasSprite = false;
        let baseScale = 1;
        if (sprite) {
            const sp = node.addComponent(Sprite);
            sp.spriteFrame = sprite.frame;
            // BOSS 用甲虫贴图放大：32px × 4 = 128（整数倍，像素不糊）
            baseScale = BOSS.displaySize / sprite.width;
            hasSprite = true;
        }
        node.active = false;

        this._boss = {
            active: false,
            node,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            hp: BOSS.hp,
            maxHp: BOSS.hp,
            state: 'dormant',
            stateT: 0,
            cd: 0,
            touchCd: 0,
            hitPunch: 0,
            dying: 0,
            baseScale,
            hasSprite,
            t: 0,
        };
    }

    get boss(): Boss {
        return this._boss;
    }

    /** 是否在场且未死亡（HUD 血条 / 绘制判据） */
    get alive(): boolean {
        return this._boss.active && this._boss.dying <= 0;
    }

    get hp(): number {
        return this._boss.hp;
    }

    get maxHp(): number {
        return this._boss.maxHp;
    }

    spawn(x: number, y: number): void {
        const b = this._boss;
        b.active = true;
        b.dying = 0;
        b.hitPunch = 0;
        b.hp = BOSS.hp;
        b.vx = 0;
        b.vy = 0;
        b.t = 0;
        b.x = x;
        b.y = y;
        b.state = 'dormant';
        b.stateT = BOSS.triggerDelay;
        // 登场不立刻 AOE：给玩家看清"它刷出来了"的时间
        b.cd = BOSS.aoeCd * 0.5;
        b.touchCd = 0;

        b.node.active = true;
        b.node.setPosition(x, y, 0);
        b.node.setScale(b.baseScale, b.baseScale, 1);
    }

    /** 宠物子弹命中检测 */
    tryHit(x: number, y: number, r: number): boolean {
        const b = this._boss;
        if (!b.active || b.dying > 0) {
            return false;
        }
        const rr = r + BOSS.radius;
        const dx = b.x - x;
        const dy = b.y - y;
        return dx * dx + dy * dy <= rr * rr;
    }

    takeDamage(dmg: number, dirX: number, dirY: number): void {
        const b = this._boss;
        if (!b.active || b.dying > 0) {
            return;
        }
        b.hp -= dmg;
        b.hitPunch = 1;
        // BOSS 很重：击退只有一点点（观感上"打不太动"），但保留微小位移给打击感
        const len = Math.hypot(dirX, dirY) || 1;
        b.vx += (dirX / len) * 12;
        b.vy += (dirY / len) * 12;
        if (b.hp <= 0) {
            b.hp = 0;
            b.dying = BOSS.deathTime;
            b.state = 'dead';
        }
    }

    update(dt: number): void {
        const b = this._boss;
        if (!b.active) {
            return;
        }

        // ---- 死亡：缩小消失，播完才通知（让击败有 0.8s 表演，不立刻弹结算）----
        if (b.dying > 0) {
            b.dying -= dt;
            const k = Math.max(0, b.dying / BOSS.deathTime);
            b.node.setScale(b.baseScale * k, b.baseScale * k, 1);
            if (b.dying <= 0) {
                b.active = false;
                b.node.active = false;
                if (this.onDefeated) {
                    this.onDefeated();
                }
            }
            return;
        }

        b.t += dt;
        b.cd -= dt;
        b.touchCd -= dt;
        if (b.hitPunch > 0) {
            b.hitPunch = Math.max(0, b.hitPunch - dt * 4);
        }

        // 击退衰减
        if (b.vx !== 0 || b.vy !== 0) {
            const damp = Math.max(0, 1 - 12 * dt);
            b.vx *= damp;
            b.vy *= damp;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
        }

        const px = this._player.x;
        const py = this._player.y;
        const dist = Math.hypot(px - b.x, py - b.y);

        // 贴身推挤：任何非死亡状态都可能触发
        if (b.touchCd <= 0 && dist < BOSS.touchRange) {
            this._player.takeDamage(BOSS.touchDamage);
            b.touchCd = BOSS.touchCd;
        }

        switch (b.state) {
            case 'dormant':
                b.stateT -= dt;
                if (b.stateT <= 0) {
                    b.state = 'chase';
                }
                break;

            case 'chase': {
                if (dist > BOSS.touchRange * 0.9) {
                    const len = dist || 1;
                    b.x += ((px - b.x) / len) * BOSS.speed * dt;
                    b.y += ((py - b.y) / len) * BOSS.speed * dt;
                }
                if (b.cd <= 0 && dist < BOSS.aoeRadius * 1.2) {
                    b.state = 'aoeWindup';
                    b.stateT = BOSS.aoeWindup;
                }
                break;
            }

            case 'aoeWindup':
                // 读条站定不动：这本身就是"要放技能"的可读信号
                b.stateT -= dt;
                if (b.stateT <= 0) {
                    // 只判定"读条结束时在不在圈内"——中间跑出去就算躲掉
                    if (Math.hypot(this._player.x - b.x, this._player.y - b.y) <= BOSS.aoeRadius) {
                        this._player.takeDamage(BOSS.aoeDamage);
                    }
                    b.state = 'aoeStrike';
                    b.stateT = 0.18;
                }
                break;

            case 'aoeStrike':
                b.stateT -= dt;
                if (b.stateT <= 0) {
                    b.state = 'recover';
                    b.stateT = 0.5;
                    b.cd = BOSS.aoeCd;
                }
                break;

            case 'recover':
                b.stateT -= dt;
                if (b.stateT <= 0) {
                    b.state = 'chase';
                }
                break;

            default:
                break;
        }

        b.x = clamp(b.x, -FIELD.width / 2 + BOSS.radius, FIELD.width / 2 - BOSS.radius);
        b.y = clamp(b.y, -FIELD.height / 2 + BOSS.radius, FIELD.height / 2 - BOSS.radius);

        // 恒定缩放：不做受击/读条脉冲（128px 下非整数缩放会让像素块跳档）
        b.node.setPosition(b.x, b.y, 0);
        b.node.setScale(b.baseScale, b.baseScale, 1);
    }

    hide(): void {
        const b = this._boss;
        b.active = false;
        b.dying = 0;
        b.hp = b.maxHp;
        b.state = 'dormant';
        b.stateT = 0;
        b.x = 0;
        b.y = 0;
        b.node.active = false;
        b.node.setScale(b.baseScale, b.baseScale, 1);
    }
}
