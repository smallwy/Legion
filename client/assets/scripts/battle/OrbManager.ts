import { MEAT, ORB } from '../config/BattleConfig';
import { Pool } from '../core/Pool';
import type { PlayerController } from './PlayerController';

export type OrbKind = 'exp' | 'meat';

export interface Orb {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** exp = 经验珠（升级）；meat = 肉块（喂食资源） */
    kind: OrbKind;
}

/**
 * 掉落物：经验珠 + 肉块（CR-015）。
 *
 * 两种掉落共用同一套磁吸/收集逻辑，只在收集时分流 —— 因为它们在**玩法上是两条线**：
 *  - 经验珠 → 局内升级（变强）
 *  - 肉块   → 喂食（维持"半饿最强"这个状态）
 * 玩家在捡的时候不需要区分，但收集后的去向完全不同。
 */
export class OrbManager {
    /** 一次 update 里收集到的数量（两种分开报，交给调用方分账） */
    onCollect: ((exp: number, meat: number) => void) | null = null;

    private _items: Orb[] = [];
    private _pool = new Pool<Orb>(() => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, kind: 'exp' }));

    constructor(private _player: PlayerController) {}

    get list(): Orb[] {
        return this._items;
    }

    spawn(x: number, y: number, count: number, kind: OrbKind = 'exp'): void {
        for (let i = 0; i < count; i++) {
            const o = this._pool.get();
            const ang = Math.random() * Math.PI * 2;
            // 肉块更沉：初速打六折，不会弹出屏幕外
            const sp = (50 + Math.random() * 70) * (kind === 'meat' ? MEAT.orbSpeed : 1);
            o.active = true;
            o.x = x;
            o.y = y;
            o.vx = Math.cos(ang) * sp;
            o.vy = Math.sin(ang) * sp;
            o.kind = kind;
            this._items.push(o);
        }
    }

    /** 掷一次肉块掉落（击杀时调用，内部管概率） */
    rollMeat(x: number, y: number): void {
        if (Math.random() < MEAT.dropChance) {
            this.spawn(x, y, 1, 'meat');
        }
    }

    update(dt: number): void {
        const px = this._player.x;
        const py = this._player.y;
        let exp = 0;
        let meat = 0;

        for (const o of this._items) {
            if (!o.active) continue;
            const dx = px - o.x;
            const dy = py - o.y;
            const d = Math.hypot(dx, dy) || 1;

            if (d < ORB.collectRange) {
                o.active = false;
                if (o.kind === 'meat') {
                    meat++;
                } else {
                    exp++;
                }
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

        if ((exp > 0 || meat > 0) && this.onCollect) {
            this.onCollect(exp, meat);
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
