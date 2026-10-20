import { FX } from '../config/BattleConfig';
import type { PlayerController } from './PlayerController';

export type BattlePhase = 'battle' | 'boss' | 'settlement';
export type EndReason = '' | 'withdraw' | 'hp0' | 'victory';

export interface BattleStats {
    kills: number;
    orbs: number;
    meat: number;
    timeMs: number;
    wave: number;
    waveTotal: number;
    level: number;
    feeds: number;
    bossKilled: boolean;
    endReason: EndReason;
}

/**
 * 战斗主控：阶段流转 + 统计。
 *
 * CR-015 阶段模型（甲方案：割草 + 宠物状态）：
 *
 *   battle（第 1~19 波怪潮）──第 19 波清完──▶ boss（第 20 波）──击杀──▶ victory 结算
 *        │                                        │
 *        └──────── HP 归零 / 主动撤离 ────────────┘
 *
 * 红线②（无失败惩罚）：HP 归零 = "体力不支撤退"，照样结算带走战利品，没有"游戏结束"。
 *
 * `paused`：三选一升级面板打开时置 true，冻结世界（否则怪会在你选卡时把血打光）。
 */
export class BattleDirector {
    phase: BattlePhase = 'battle';
    /** 升级三选一期间暂停世界 */
    paused = false;

    stats: BattleStats = {
        kills: 0,
        orbs: 0,
        meat: 0,
        timeMs: 0,
        wave: 0,
        waveTotal: 0,
        level: 1,
        feeds: 0,
        bossKilled: false,
        endReason: '',
    };

    /** 结算面板弹出时回调（UI 用） */
    onSettle: ((stats: BattleStats) => void) | null = null;
    /** 进入 BOSS 阶段时触发一次（Bootstrap 在这里召唤 BOSS） */
    onBossPhase: (() => void) | null = null;

    private _player: PlayerController;
    /** 顿帧剩余秒数（用**真实** dt 递减，不受自身缩放影响） */
    private _stop = 0;

    constructor(player: PlayerController) {
        this._player = player;
    }

    /**
     * 触发顿帧（CR-016）。取 max 而不是累加：连杀 5 只不该冻 5 次，
     * 否则割草时画面会变成"一顿一顿"。多次触发只延长时间，不叠加。
     */
    hitStop(sec: number): void {
        if (sec > this._stop) {
            this._stop = sec;
        }
    }

    /**
     * 本帧**逻辑时间倍率**。顿帧期间压到 0.06 而不清零 ——
     * 清零会让画面彻底静止，看起来像掉帧卡死；留一点位移才像"时间变慢"。
     */
    get timeScale(): number {
        return this._stop > 0 ? FX.hitStop.timeScale : 1;
    }

    /**
     * 用真实 dt 递减顿帧计时。
     * ★ 必须在 `update(dt * timeScale)` **之前**、且传入未缩放的 dt 调用，
     *   否则缩放后的 dt 会让 0.045 秒的顿帧变成 0.75 秒。
     */
    tickHitStop(realDt: number): void {
        if (this._stop > 0) {
            this._stop -= realDt;
            if (this._stop < 0) {
                this._stop = 0;
            }
        }
    }

    update(dt: number): void {
        if (this.phase === 'settlement' || this.paused) {
            return;
        }
        this.stats.timeMs += dt * 1000;
        if (this._player.hp <= 0) {
            this.end('hp0');
        }
    }

    /** 每帧同步波次进度（HUD 用） */
    syncProgress(wave: number, waveTotal: number): void {
        this.stats.wave = wave;
        this.stats.waveTotal = waveTotal;
    }

    /** 每帧同步成长状态（HUD 用） */
    syncMeta(level: number, feeds: number): void {
        this.stats.level = level;
        this.stats.feeds = feeds;
    }

    /** 第 19 波清完：WaveManager 调用 → 进入 BOSS 阶段 */
    notifyPreBossWave(): void {
        if (this.phase !== 'battle') {
            return;
        }
        this.phase = 'boss';
        // BOSS 即第 20 波，HUD 直接显示满波
        this.stats.wave = this.stats.waveTotal;
        if (this.onBossPhase) {
            this.onBossPhase();
        }
    }

    /** BOSS 死亡动画播完后调用（不立刻结算，先让击败有 0.8s 表演） */
    notifyBossDefeated(): void {
        if (this.phase === 'settlement') {
            return;
        }
        this.stats.bossKilled = true;
        this.end('victory');
    }

    /** 玩家主动撤离（E 键 / ESC），任何非结算阶段都能用 */
    withdraw(): void {
        if (this.phase !== 'settlement') {
            this.end('withdraw');
        }
    }

    addKill(): void {
        this.stats.kills++;
    }

    addOrbs(n: number): void {
        this.stats.orbs += n;
    }

    addMeat(n: number): void {
        this.stats.meat += n;
    }

    /** 喂食成功时扣肉块（返回 false 表示不够，不该走到这） */
    spendMeat(n: number): boolean {
        if (this.stats.meat < n) {
            return false;
        }
        this.stats.meat -= n;
        return true;
    }

    restart(): void {
        this.phase = 'battle';
        this.paused = false;
        this._stop = 0;
        this.stats.kills = 0;
        this.stats.orbs = 0;
        this.stats.meat = 0;
        this.stats.timeMs = 0;
        this.stats.wave = 0;
        this.stats.waveTotal = 0;
        this.stats.level = 1;
        this.stats.feeds = 0;
        this.stats.bossKilled = false;
        this.stats.endReason = '';
    }

    private end(reason: EndReason): void {
        if (this.phase === 'settlement') {
            return;
        }
        this.phase = 'settlement';
        this.paused = false;
        this.stats.endReason = reason;
        if (this.onSettle) {
            this.onSettle(this.stats);
        }
    }
}
