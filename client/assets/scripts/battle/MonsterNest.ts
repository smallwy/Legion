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
    coolT: number;     // cleared 后的刷新冷却
    pulse: number;     // 活跃圈脉冲相位
}

const TYPE_ORDER: EnemyType[] = ['walker', 'flyer', 'tank'];

/**
 * 怪窝（CR-008）：玩家进入触发圈才激活，成批刷怪；清空后冷却重新可刷。
 * 注意敌人不是"从屏幕外涌来追玩家"，而是"你走过去踩一窝"。
 */
export class MonsterNestManager {
    private _nests: Nest[] = [];

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
                coolT: 0,
                pulse: Math.random() * 6,
            });
        }
    }

    get list(): Nest[] {
        return this._nests;
    }

    update(dt: number): void {
        for (let i = 0; i < this._nests.length; i++) {
            const n = this._nests[i];
            n.pulse += dt;
            const d = Math.hypot(this._player.x - n.x, this._player.y - n.y);

            if (n.state === 'dormant') {
                if (d < NEST.triggerRange) {
                    n.state = 'active';
                    n.toSpawn = NEST.batch;
                    n.spawnT = 0;
                }
            } else if (n.state === 'active') {
                n.spawnT -= dt;
                if (n.spawnT <= 0 && n.toSpawn > 0 && this._enemies.aliveCount < BATTLE.maxAlive) {
                    this.spawnOne(n, i);
                    n.toSpawn--;
                    n.spawnT = NEST.spawnInterval;
                }
                if (n.toSpawn === 0 && this._enemies.aliveCountOfNest(i) === 0) {
                    n.state = 'cleared';
                    n.coolT = NEST.respawnDelay;
                }
            } else {
                n.coolT -= dt;
                if (n.coolT <= 0) {
                    n.state = 'dormant';
                }
            }
        }
    }

    reset(): void {
        for (const n of this._nests) {
            n.state = 'dormant';
            n.toSpawn = 0;
            n.spawnT = 0;
            n.coolT = 0;
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
