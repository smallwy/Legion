import type { PlayerController } from './PlayerController';

export type BattlePhase = 'battle' | 'boss' | 'settlement';
export type EndReason = '' | 'withdraw' | 'hp0' | 'victory';

export interface BattleStats {
    kills: number;
    orbs: number;
    timeMs: number;
    nestsCleared: number;
    nestTotal: number;
    bossKilled: boolean;
    endReason: EndReason;
}

/**
 * 战斗主控：阶段流转 + 统计。
 *
 * CR-014 阶段模型（原「存活 3 分钟自动撤离」已废弃）：
 *
 *   battle（清怪窝）──全部清空──▶ boss（BOSS 战）──击杀──▶ victory 结算
 *        │                            │
 *        └──── HP 归零 / 主动撤离 ────┘
 *
 * 红线②（无失败惩罚）：HP 归零 = "体力不支撤退"，照样结算带走战利品，没有"游戏结束"。
 *
 * ⚠️ `BATTLE.durationMs` 现在**只用于 HUD 显示参考时长**，不再是结束条件。
 * 之前它是硬倒计时，配合无限重刷的怪窝，整局就退化成了幸存者式刷怪场。
 */
export class BattleDirector {
    phase: BattlePhase = 'battle';
    stats: BattleStats = {
        kills: 0,
        orbs: 0,
        timeMs: 0,
        nestsCleared: 0,
        nestTotal: 0,
        bossKilled: false,
        endReason: '',
    };

    /** 结算面板弹出时回调（UI 用） */
    onSettle: ((stats: BattleStats) => void) | null = null;
    /** 进入 BOSS 阶段时触发一次（Bootstrap 在这里召唤 BOSS） */
    onBossPhase: (() => void) | null = null;

    private _player: PlayerController;

    constructor(player: PlayerController) {
        this._player = player;
    }

    update(dt: number): void {
        if (this.phase === 'settlement') {
            return;
        }
        this.stats.timeMs += dt * 1000;
        if (this._player.hp <= 0) {
            this.end('hp0');
        }
    }

    /** Bootstrap 每帧同步清窝进度（HUD 与结算面板都要用） */
    syncProgress(cleared: number, total: number): void {
        this.stats.nestsCleared = cleared;
        this.stats.nestTotal = total;
    }

    /** EncounterManager 判定全部清空后调用 → 进入 BOSS 阶段 */
    notifyAllCleared(): void {
        if (this.phase !== 'battle') {
            return;
        }
        this.phase = 'boss';
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

    restart(): void {
        this.phase = 'battle';
        this.stats.kills = 0;
        this.stats.orbs = 0;
        this.stats.timeMs = 0;
        this.stats.nestsCleared = 0;
        this.stats.nestTotal = 0;
        this.stats.bossKilled = false;
        this.stats.endReason = '';
    }

    private end(reason: EndReason): void {
        if (this.phase === 'settlement') {
            return;
        }
        this.phase = 'settlement';
        this.stats.endReason = reason;
        if (this.onSettle) {
            this.onSettle(this.stats);
        }
    }
}
