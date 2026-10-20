import { BATTLE, ENEMIES, NEST } from '../config/BattleConfig';
import type { EnemyType } from '../config/BattleConfig';
import type { EnemyManager } from './EnemyManager';
import type { PlayerController } from './PlayerController';

export type NestState = 'dormant' | 'active' | 'cleared';

export interface Nest {
    x: number;
    y: number;
    state: NestState;
    toSpawn: number;   // 本批还没生成的数量
    spawnT: number;    // 生成间隔计时
    settleT: number;   // 最后一只死亡后的清空判定缓冲
    pulse: number;     // 活跃圈脉冲相位
}

const TYPE_ORDER: EnemyType[] = ['walker', 'flyer', 'tank'];

/**
 * 遭遇战（CR-008 怪窝 + CR-014 有限清剿）。
 *
 * 与原 `MonsterNest` 的**关键差别**：清完就**永久 `cleared`，不再冷却重刷**。
 * 原来那句 `respawnDelay: 18` 把"踩一窝"变成了"刷怪场"，一局就退化成
 * 幸存者式活满倒计时；现在一局是「把 4 窝清完 → BOSS 现身 → 打掉它通关」。
 *
 * 敌人不是"从屏幕外涌来追玩家"，而是"你走过去踩一窝"——这条 CR-008 的描述本来
 * 就是对的，之前是生成器把它做成了无限循环。
 */
export class EncounterManager {
    /** 全部窝清空时触发一次（用于召唤 BOSS） */
    onAllCleared: (() => void) | null = null;

    private _nests: Nest[] = [];
    private _lastX = 0;
    private _lastY = 0;
    private _hasLast = false;
    private _notifiedAll = false;

    constructor(
        private _enemies: EnemyManager,
        private _player: PlayerController,
    ) {
        for (let i = 0; i < NEST.count; i++) {
            const p = NEST.positions[i % NEST.positions.length];
            this._nests.push({
                x: p[0],
                y: p[1],
                state: 'dormant',
                toSpawn: 0,
                spawnT: 0,
                settleT: 0,
                pulse: Math.random() * 6,
            });
        }
    }

    get list(): Nest[] {
        return this._nests;
    }

    /** 已清空的窝数（HUD 进度用） */
    get clearedCount(): number {
        let n = 0;
        for (const nest of this._nests) {
            if (nest.state === 'cleared') n++;
        }
        return n;
    }

    get total(): number {
        return this._nests.length;
    }

    get allCleared(): boolean {
        for (const nest of this._nests) {
            if (nest.state !== 'cleared') return false;
        }
        return true;
    }

    /** 最后清空的那一窝坐标（BOSS 登场点）；还没有清过则为 null */
    get lastCleared(): { x: number; y: number } | null {
        return this._hasLast ? { x: this._lastX, y: this._lastY } : null;
    }

    update(dt: number): void {
        for (let i = 0; i < this._nests.length; i++) {
            const n = this._nests[i];
            n.pulse += dt;

            // 清空后不再有任何行为（这是 CR-014 的核心）
            if (n.state === 'cleared') {
                continue;
            }

            const d = Math.hypot(this._player.x - n.x, this._player.y - n.y);

            if (n.state === 'dormant') {
                if (d < NEST.triggerRange) {
                    n.state = 'active';
                    n.toSpawn = NEST.batch;
                    n.spawnT = 0;
                    n.settleT = NEST.settleDelay;
                }
                continue;
            }

            // ---- active：分批生成 → 清空判定 ----
            n.spawnT -= dt;
            if (n.spawnT <= 0 && n.toSpawn > 0 && this._enemies.aliveCount < BATTLE.maxAlive) {
                this.spawnOne(n, i);
                n.toSpawn--;
                n.spawnT = NEST.spawnInterval;
            }

            if (n.toSpawn > 0) {
                continue;
            }

            // 本批已全部生成；等场上这一窝的怪清干净（aliveCountOfNest 已排除 dying）
            if (this._enemies.aliveCountOfNest(i) > 0) {
                n.settleT = NEST.settleDelay;
            } else {
                n.settleT -= dt;
                if (n.settleT <= 0) {
                    n.state = 'cleared';
                    this._lastX = n.x;
                    this._lastY = n.y;
                    this._hasLast = true;
                    this.checkAllCleared();
                }
            }
        }
    }

    reset(): void {
        for (const n of this._nests) {
            n.state = 'dormant';
            n.toSpawn = 0;
            n.spawnT = 0;
            n.settleT = 0;
        }
        this._hasLast = false;
        this._notifiedAll = false;
        this._lastX = 0;
        this._lastY = 0;
    }

    // ---------------- 内部 ----------------

    private checkAllCleared(): void {
        if (this._notifiedAll || !this.allCleared) {
            return;
        }
        this._notifiedAll = true;
        if (this.onAllCleared) {
            this.onAllCleared();
        }
    }

    private spawnOne(n: Nest, nestIndex: number): void {
        const ang = Math.random() * Math.PI * 2;
        const r = 50 + Math.random() * 90;
        const x = n.x + Math.cos(ang) * r;
        const y = n.y + Math.sin(ang) * r;
        this._enemies.spawn(this.pickType(), x, y, n.x, n.y, nestIndex);
    }

    private pickType(): EnemyType {
        const r = Math.random();
        let acc = 0;
        for (const key of TYPE_ORDER) {
            acc += ENEMIES[key].weight;
            if (r <= acc) {
                return key;
            }
        }
        return 'walker';
    }
}
