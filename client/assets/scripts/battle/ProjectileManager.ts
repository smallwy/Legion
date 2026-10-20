import { FIELD, PLAYER, PROJECTILE } from '../config/BattleConfig';
import { Pool } from '../core/Pool';
import type { BossController } from './BossController';
import type { EnemyManager } from './EnemyManager';
import type { PlayerController } from './PlayerController';

export interface Projectile {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    dmg: number;
    life: number;
    fromPet: boolean;
    /** 是否暴击弹（CR-016）：只用于表现层（飘字变金色 + 更重的火花），不影响伤害计算 */
    crit: boolean;
}

/**
 * 弹道管理（对象池）。宠物子弹只与敌人检测；敌方法术只与玩家检测（计划书 §5.1）。
 * 碰撞用圆形距离判定，不上物理引擎——割草频次下解析圆比 box2d 更快也更可控。
 */
export class ProjectileManager {
    /** 构造后由 Bootstrap 接线（类型引用，避免循环 import） */
    enemies: EnemyManager | null = null;
    /** BOSS 是可选命中目标（CR-014）：为 null 时行为与原来完全一致 */
    boss: BossController | null = null;

    private _items: Projectile[] = [];
    private _pool = new Pool<Projectile>(() => ({
        active: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, dmg: 0, life: 0, fromPet: true, crit: false,
    }));

    constructor(private _player: PlayerController) {}

    get list(): Projectile[] {
        return this._items;
    }

    spawnPetBullet(x: number, y: number, dx: number, dy: number, dmg: number, crit = false): void {
        const p = this._pool.get();
        p.active = true;
        p.x = x;
        p.y = y;
        p.vx = dx * PROJECTILE.petSpeed;
        p.vy = dy * PROJECTILE.petSpeed;
        p.r = PROJECTILE.petRadius;
        p.dmg = dmg;
        p.life = PROJECTILE.petLife;
        p.fromPet = true;
        p.crit = crit;
        this._items.push(p);
    }

    spawnEnemySpell(x: number, y: number, dx: number, dy: number, speed: number, dmg: number): void {
        const p = this._pool.get();
        p.active = true;
        p.x = x;
        p.y = y;
        p.vx = dx * speed;
        p.vy = dy * speed;
        p.r = PROJECTILE.enemyRadius;
        p.dmg = dmg;
        p.life = PROJECTILE.enemyLife;
        p.fromPet = false;
        p.crit = false;
        this._items.push(p);
    }

    update(dt: number): void {
        const hw = FIELD.width / 2 + 40;
        const hh = FIELD.height / 2 + 40;

        for (const p of this._items) {
            if (!p.active) continue;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            if (p.life <= 0 || p.x < -hw || p.x > hw || p.y < -hh || p.y > hh) {
                p.active = false;
                continue;
            }
            if (p.fromPet) {
                // BOSS 优先判定：否则子弹会"穿过"BOSS 打到它身后的杂兵
                if (this.boss && this.boss.alive && this.boss.tryHit(p.x, p.y, p.r)) {
                    this.boss.takeDamage(p.dmg, p.vx, p.vy, p.crit);
                    p.active = false;
                    continue;
                }
                const e = this.enemies ? this.enemies.hitTest(p.x, p.y, p.r) : null;
                if (e && this.enemies) {
                    this.enemies.takeDamage(e, p.dmg, p.vx, p.vy, p.crit);
                    p.active = false;
                }
            } else {
                const dx = this._player.x - p.x;
                const dy = this._player.y - p.y;
                const rr = p.r + PLAYER.radius;
                if (dx * dx + dy * dy <= rr * rr) {
                    // 无敌帧中也吞掉弹体（否则弹体穿过玩家很出戏）
                    this._player.takeDamage(p.dmg);
                    p.active = false;
                }
            }
        }

        for (let i = this._items.length - 1; i >= 0; i--) {
            if (!this._items[i].active) {
                this._pool.put(this._items[i]);
                this._items.splice(i, 1);
            }
        }
    }

    clear(): void {
        for (const p of this._items) {
            this._pool.put(p);
        }
        this._items.length = 0;
    }
}
