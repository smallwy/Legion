import { Node, Sprite, UITransform } from 'cc';
import { PET } from '../config/BattleConfig';
import { TAU } from '../core/MathUtil';
import type { Enemy, EnemyManager } from './EnemyManager';
import type { PlayerController } from './PlayerController';
import type { ProjectileManager } from './ProjectileManager';
import type { SpriteEntry } from '../view/SpriteAssets';

export type PetCastState = 'idle' | 'telegraph' | 'cast' | 'recovery';

export interface Pet {
    node: Node;
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    dist: number;
    state: PetCastState;
    stateT: number;
    target: Enemy | null;
    aimX: number;
    aimY: number;
    powerMul: number;   // Day 2「半饿最强」挂钩点
    baseScale: number;
    hasSprite: boolean;
}

/**
 * 宠物小队：环绕中心点弹性跟随 + 自动施法三段状态机（CR-009）。
 * 状态链：idle → telegraph(0.25s 前摇) → cast(0.1s 施法/发射) → recovery(0.3s 后摇) → idle
 * 注意：Day 1 排期为 1 只；把 BattleConfig.PET.count 改成 3 即 Day 2 的 3 宠，无需改代码。
 */
export class PetSquad {
    private _pets: Pet[] = [];

    constructor(
        parent: Node,
        private _player: PlayerController,
        private _enemies: EnemyManager,
        private _projectiles: ProjectileManager,
        petSprite: SpriteEntry | null,
    ) {
        for (let i = 0; i < PET.count; i++) {
            const node = new Node('Pet_' + i);
            parent.addChild(node);
            node.addComponent(UITransform);

            let hasSprite = false;
            let baseScale = 1;
            if (petSprite) {
                const sp = node.addComponent(Sprite);
                sp.spriteFrame = petSprite.frame;
                baseScale = PET.displaySize / petSprite.width;
                hasSprite = true;
            }
            node.setScale(baseScale, baseScale, 1);

            this._pets.push({
                node,
                x: this._player.x,
                y: this._player.y,
                vx: 0,
                vy: 0,
                angle: (i / PET.count) * TAU,
                dist: PET.orbitDist,
                state: 'idle',
                stateT: 0,
                target: null,
                aimX: 1,
                aimY: 0,
                powerMul: PET.powerMultiplier,
                baseScale,
                hasSprite,
            });
        }
    }

    get list(): Pet[] {
        return this._pets;
    }

    update(dt: number): void {
        for (const p of this._pets) {
            // ---- 环绕目标点 + 弹性跟随（距离稳定在 orbitDist 附近）----
            p.angle += PET.orbitSpeed * dt;
            const tx = this._player.x + Math.cos(p.angle) * p.dist;
            const ty = this._player.y + Math.sin(p.angle) * p.dist;
            p.vx += (tx - p.x) * PET.springStiffness * dt;
            p.vy += (ty - p.y) * PET.springStiffness * dt;
            const damp = Math.max(0, 1 - PET.springDamping * dt);
            p.vx *= damp;
            p.vy *= damp;
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            this.updateCast(dt, p);

            // ---- 表现：位置 + 施法缩放脉冲（程序化兜底层由 EntityRenderer 画身体）----
            let s = p.baseScale;
            if (p.state === 'telegraph') {
                s *= 1 + 0.18 * (1 - p.stateT / PET.telegraph);
            } else if (p.state === 'cast') {
                s *= 1.28;
            } else if (p.state === 'recovery') {
                s *= 1 + 0.28 * (p.stateT / PET.recovery);
            }
            p.node.setPosition(p.x, p.y, 2);
            p.node.setScale(s, s, 1);
        }
    }

    private updateCast(dt: number, p: Pet): void {
        p.stateT -= dt;
        switch (p.state) {
            case 'idle':
                if (p.stateT <= 0) {
                    const t = this._enemies.getNearest(p.x, p.y, PET.acquireRange);
                    if (t) {
                        p.target = t;
                        p.state = 'telegraph';
                        p.stateT = PET.telegraph;
                    }
                }
                break;
            case 'telegraph':
                // 前摇期间持续瞄准（目标死亡/脱离则保持最后方向）
                if (p.target && p.target.active && p.target.dying <= 0) {
                    p.aimX = p.target.x - p.x;
                    p.aimY = p.target.y - p.y;
                }
                if (p.stateT <= 0) {
                    // 进入施法瞬间即发射（CR-009：施法段 = 发射瞬间）
                    this.fire(p);
                    p.state = 'cast';
                    p.stateT = PET.cast;
                }
                break;
            case 'cast':
                if (p.stateT <= 0) {
                    p.state = 'recovery';
                    p.stateT = PET.recovery;
                }
                break;
            case 'recovery':
                if (p.stateT <= 0) {
                    p.state = 'idle';
                    p.stateT = 0;
                    p.target = null;
                }
                break;
        }
    }

    private fire(p: Pet): void {
        const len = Math.hypot(p.aimX, p.aimY) || 1;
        const dx = p.aimX / len;
        const dy = p.aimY / len;
        this._projectiles.spawnPetBullet(p.x + dx * 14, p.y + dy * 14, dx, dy, PET.damage * p.powerMul);
    }

    reset(): void {
        for (const p of this._pets) {
            p.x = this._player.x;
            p.y = this._player.y;
            p.vx = 0;
            p.vy = 0;
            p.state = 'idle';
            p.stateT = 0;
            p.target = null;
            p.node.setScale(p.baseScale, p.baseScale, 1);
        }
    }
}
