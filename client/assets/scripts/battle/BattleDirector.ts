import { BATTLE } from '../config/BattleConfig';
import type { PlayerController } from './PlayerController';

export type BattlePhase = 'battle' | 'settlement';
export type EndReason = '' | 'withdraw' | 'hp0';

export interface BattleStats {
    kills: number;
    orbs: number;
    timeMs: number;
    endReason: EndReason;
}

/**
 * 战斗主控：阶段（战斗/结算）、计时、统计。
 * 红线②（无失败惩罚）：HP 归零 = "体力不支撤退"，照样结算带走战利品，没有"游戏结束"。
 */
export class BattleDirector {
    phase: BattlePhase = 'battle';
    stats: BattleStats = { kills: 0, orbs: 0, timeMs: 0, endReason: '' };

    /** 结算面板弹出时回调（UI 用） */
    onSettle: ((stats: BattleStats) => void) | null = null;

    private _player: PlayerController;

    constructor(player: PlayerController) {
        this._player = player;
    }

    update(dt: number): void {
        if (this.phase !== 'battle') {
            return;
        }
        this.stats.timeMs += dt * 1000;
        if (this._player.hp <= 0) {
            this.end('hp0');
        } else if (this.stats.timeMs >= BATTLE.durationMs) {
            this.end('withdraw');
        }
    }

    /** 玩家主动撤离（E 键） */
    withdraw(): void {
        if (this.phase === 'battle') {
            this.end('withdraw');
        }
    }

    addKill(): void {
        this.stats.kills++;
    }

    addOrbs(n: number): void {
        this.stats.orbs += n;
    }

    restart(): void {
        this.phase = 'battle';
        this.stats.kills = 0;
        this.stats.orbs = 0;
        this.stats.timeMs = 0;
        this.stats.endReason = '';
    }

    private end(reason: EndReason): void {
        this.phase = 'settlement';
        this.stats.endReason = reason;
        if (this.onSettle) {
            this.onSettle(this.stats);
        }
    }
}
