import { ENEMIES, FIELD, WAVE } from '../config/BattleConfig';
import type { EnemyType } from '../config/BattleConfig';
import { clamp } from '../core/MathUtil';
import type { EnemyManager } from './EnemyManager';
import type { PlayerController } from './PlayerController';

const TYPE_ORDER: EnemyType[] = ['walker', 'flyer', 'tank'];

export type WaveState = 'idle' | 'spawning' | 'waitBoss' | 'done';

/**
 * 波次怪潮（CR-015：主干的刷怪驱动，替代 CR-008/CR-014 的「清窝推进」）。
 *
 * 为什么必须换回波次：
 *   清窝把一局压到 57 秒、每窝 5.2 秒。而本作的全部系统（饱食度衰减 0.5/秒、
 *   升级三选一、喂食决策）都需要**连续的压力**才有展开空间 —— 5 秒打完一窝，
 *   减了 2.5 点饱食度，玩家永远感受不到"饿"。波次给出 8 分钟连续节奏，
 *   这些系统才活得下来。
 *
 * 节奏：
 *   idle(间隔 3s) → spawning(从玩家外围环形生成) → 清到剩 ≤2 只 → 下一波
 *   第 19 波清完 → waitBoss（召唤 BOSS，BOSS 算第 20 波）
 *
 * ⚠️ 生成的怪一律 `hunter = true`（见 `EnemyManager.spawn`）：它们从 600px 外
 * 生成，如果还按 CR-008 的"走进 aggroRange 才追"，就永远走不过来。
 */
export class WaveManager {
    /** 新一波开始（HUD 播报用） */
    onWaveStart: ((wave: number) => void) | null = null;
    /** 第 19 波清完 → 该召唤 BOSS 了 */
    onPreBossWave: (() => void) | null = null;

    private _wave = 0;
    private _state: WaveState = 'idle';
    private _timer: number = WAVE.firstDelay;
    private _toSpawn = 0;
    private _spawnT = 0;
    private _angle = 0;        // 环形生成的相位（每只递进，避免全从同一侧涌来）
    private _waveSize: number = 0;     // 本波总数量（算角度步进用）
    private _bossNotified = false;

    constructor(
        private _enemies: EnemyManager,
        private _player: PlayerController,
    ) {}

    get wave(): number {
        return this._wave;
    }

    get total(): number {
        return WAVE.total;
    }

    get state(): WaveState {
        return this._state;
    }

    /** 本波是否已全部生成完毕（HUD 用它区分"涌出中"与"清场中"） */
    get spawning(): boolean {
        return this._state === 'spawning' && this._toSpawn > 0;
    }

    update(dt: number): void {
        switch (this._state) {
            case 'idle':
                this._timer -= dt;
                if (this._timer <= 0) {
                    this.startWave(this._wave + 1);
                }
                break;

            case 'spawning': {
                // 生成（受同屏上限节流，超出则排队，等怪死了再补）
                this._spawnT -= dt;
                if (this._spawnT <= 0) {
                    this._spawnT = 0.07;
                    if (this._toSpawn > 0 && this._enemies.aliveCount < WAVE.maxAlive) {
                        this.spawnOne();
                        this._toSpawn--;
                    }
                }
                // 本波全部生成完，且场上这一波只剩 ≤2 只 → 本波结束
                if (this._toSpawn <= 0 && this._enemies.aliveCountOfGroup(this._wave) <= 2) {
                    this.finishWave();
                }
                break;
            }

            case 'waitBoss':
            case 'done':
                break;

            default:
                break;
        }
    }

    reset(): void {
        this._wave = 0;
        this._state = 'idle';
        this._timer = WAVE.firstDelay;
        this._toSpawn = 0;
        this._spawnT = 0;
        this._angle = 0;
        this._waveSize = 0;
        this._bossNotified = false;
    }

    // ---------------- 内部 ----------------

    private startWave(wave: number): void {
        this._wave = wave;
        this._state = 'spawning';
        this._waveSize = Math.round(WAVE.baseCount + WAVE.countPerWave * (wave - 1));
        this._toSpawn = this._waveSize;
        this._spawnT = 0;
        // 每波换一个起始角，避免"每波都从同一个方向来"的机械感
        this._angle = Math.random() * Math.PI * 2;
        if (this.onWaveStart) {
            this.onWaveStart(wave);
        }
    }

    private finishWave(): void {
        const done = this._wave;
        // 第 19 波清完 → 进入 BOSS（BOSS 即第 20 波）
        if (done >= WAVE.bossWave - 1) {
            if (!this._bossNotified) {
                this._bossNotified = true;
                this._state = 'waitBoss';
                if (this.onPreBossWave) {
                    this.onPreBossWave();
                }
            }
            return;
        }
        this._state = 'idle';
        this._timer = WAVE.interval;
    }

    private spawnOne(): void {
        const p = this._player;
        // 环形均匀铺开 + 角度抖动：一波怪从四周包过来，而不是挤成一坨
        this._angle += (Math.PI * 2) / Math.max(1, this._waveSize);
        const ang = this._angle + (Math.random() - 0.5) * 0.7;
        const r = WAVE.spawnRadius + (Math.random() - 0.5) * 2 * WAVE.spawnJitter;

        const hw = FIELD.width / 2 - 40;
        const hh = FIELD.height / 2 - 40;
        const x = clamp(p.x + Math.cos(ang) * r, -hw, hw);
        const y = clamp(p.y + Math.sin(ang) * r, -hh, hh);

        // 锚点 = 生成点（这一波打完前它们会一路追过来，锚点只对非猎手有意义）
        this._enemies.spawn(this.pickType(), x, y, x, y, this._wave, true);
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
