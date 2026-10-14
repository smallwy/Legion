import { ORB } from '../config/BattleConfig';
import { Pool } from '../core/Pool';
import type { PlayerController } from './PlayerController';

export interface Orb {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

/** 经验珠：死亡弹出 → 进入磁吸范围加速吸向玩家 → 收集（Day 3 起映射为食物资源） */
export class OrbManager {
    onCollect: ((count: number) => void) | null = null;

    private _items: Orb[] = [];
    private _pool = new Pool<Orb>(() => ({ active: false, x: 0, y: 0, vx: 0, vy: 0 }));

    constructor(private _player: PlayerController) {}

    get list(): Orb[] {
        return this._items;
    }

    spawn(x: number, y: number, count: number): void {
        for (let i = 0; i < count; i++) {
            const o = this._pool.get();
            const ang = Math.random() * Math.PI * 2;
            const sp = 50 + Math.random() * 70;
            o.active = true;
            o.x = x;
            o.y = y;
            o.vx = Math.cos(ang) * sp;
            o.vy = Math.sin(ang) * sp;
            this._items.push(o);
        }
    }

    update(dt: number): void {
        const px = this._player.x;
        const py = this._player.y;
        let collected = 0;

        for (const o of this._items) {
            if (!o.active) continue;
            const dx = px - o.x;
            const dy = py - o.y;
            const d = Math.hypot(dx, dy) || 1;

            if (d < ORB.collectRange) {
                o.active = false;
                collected++;
                continue;
            }

            if (d < ORB.magnetRange) {
                // 磁吸：越近拉力越强
                const pull = 900 * (1 - d / ORB.magnetRange) + 260;
                o.vx += (dx / d) * pull * dt;
                o.vy += (dy / d) * pull * dt;
                const sp = Math.hypot(o.vx, o.vy);
                if (sp > ORB.maxSpeed) {
                    o.vx = (o.vx / sp) * ORB.maxSpeed;
                    o.vy = (o.vy / sp) * ORB.maxSpeed;
                }
            } else {
                const damp = Math.max(0, 1 - 3 * dt);
                o.vx *= damp;
                o.vy *= damp;
            }
            o.x += o.vx * dt;
            o.y += o.vy * dt;
        }

        if (collected > 0 && this.onCollect) {
            this.onCollect(collected);
        }

        for (let i = this._items.length - 1; i >= 0; i--) {
            if (!this._items[i].active) {
                this._pool.put(this._items[i]);
                this._items.splice(i, 1);
            }
        }
    }

    clear(): void {
        for (const o of this._items) {
            this._pool.put(o);
        }
        this._items.length = 0;
    }
}
