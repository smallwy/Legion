import { FIELD, PLAYER, PROJECTILE } from '../config/BattleConfig';
import { Pool } from '../core/Pool';
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
}

/**
 * 弹道管理（对象池）。宠物子弹只与敌人检测；敌方法术只与玩家检测（计划书 §5.1）。
 * 碰撞用圆形距离判定，不上物理引擎——割草频次下解析圆比 box2d 更快也更可控。
 */
export class ProjectileManager {
    /** 构造后由 Bootstrap 接线（类型引用，避免循环 import） */
    enemies: EnemyManager | null = null;

    private _items: Projectile[] = [];
    private _pool = new Pool<Projectile>(() => ({
        active: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, dmg: 0, life: 0, fromPet: true,
    }));

    constructor(private _player: PlayerController) {}

    get list(): Projectile[] {
        return this._items;
    }

    spawnPetBullet(x: number, y: number, dx: number, dy: number, dmg: number): void {
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
                const e = this.enemies ? this.enemies.hitTest(p.x, p.y, p.r) : null;
                if (e && this.enemies) {
                    this.enemies.takeDamage(e, p.dmg, p.vx, p.vy);
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
