import { ABILITY, LEVEL, PALETTE, SATIETY } from '../config/BattleConfig';
import type { AbilityKind } from '../config/BattleConfig';

export type UpgradeId =
    | 'damage' | 'rate' | 'speed' | 'range' | 'feed'
    | 'resist' | 'multishot' | 'crit' | 'grit' | 'leech';

export interface UpgradeDef {
    id: UpgradeId;
    name: string;
    desc: string;
    maxStack: number;
    weight: number;
    color: number;
}

/**
 * 升级池（CR-015）：局内成长的**唯一**入口。
 *
 * 设计约束（都是被实机数据逼出来的，别随手改）：
 *  - 10 项全部是**被动数值**，没有一项需要新 UI 或新操作 —— 一局 8 分钟要弹 9~11 次，
 *    每次弹都要玩家学一个新动作的话，节奏会被撕碎；
 *  - 每项都挂在本作**已有**的系统上（伤害/施法/移速/索敌/饱食度/击杀回血），
 *    没有一项是"新开一个系统"；
 *  - `multishot` 上限 2（总弹道 3）：再往上同屏弹道会盖住前摇圈，读不出敌人要打谁。
 */
export const UPGRADES: readonly UpgradeDef[] = [
    { id: 'damage', name: '尖牙', desc: '英雄伤害 +18%', maxStack: 5, weight: 1.2, color: PALETTE.danger },
    { id: 'rate', name: '急食', desc: '出招间隔 -9%', maxStack: 5, weight: 1.1, color: PALETTE.excite },
    { id: 'speed', name: '轻步', desc: '移动速度 +8%', maxStack: 3, weight: 1.0, color: PALETTE.safe },
    { id: 'range', name: '嗅探', desc: '索敌范围 +14%', maxStack: 3, weight: 0.9, color: PALETTE.gold },
    { id: 'feed', name: '狼吞', desc: '喂食回复量 +25%', maxStack: 3, weight: 1.0, color: PALETTE.excite },
    { id: 'resist', name: '慢饿', desc: '饱食度消耗 -16%', maxStack: 3, weight: 1.0, color: PALETTE.safe },
    { id: 'multishot', name: '连锁', desc: '每次施放追加 1 次打击', maxStack: 2, weight: 0.75, color: PALETTE.foxPurple },
    { id: 'crit', name: '暴食', desc: '暴击率 +10%（2 倍伤害）', maxStack: 4, weight: 0.9, color: PALETTE.gold },
    { id: 'grit', name: '皮实', desc: '全饿门槛 -12（更耐饿）', maxStack: 2, weight: 0.8, color: PALETTE.wood },
    { id: 'leech', name: '啃噬', desc: '击杀 9% 概率回 1 点体力', maxStack: 3, weight: 0.85, color: PALETTE.danger },
];

/** 从层数表推导出的运行时数值（每次加层后整表重算，避免浮点累积漂移） */
export interface UpgradeStats {
    damageMul: number;
    castMul: number;      // <1 = 出招更快
    speedMul: number;
    rangeMul: number;
    feedMul: number;
    decayMul: number;     // <1 = 饿得更慢
    multishot: number;    // 额外弹道数
    critChance: number;
    gritBonus: number;    // 全饿门槛下移量
    leech: number;
}

function emptyStats(): UpgradeStats {
    return {
        damageMul: 1, castMul: 1, speedMul: 1, rangeMul: 1,
        feedMul: 1, decayMul: 1, multishot: 0,
        critChance: 0, gritBonus: 0, leech: 0,
    };
}

/**
 * 局内成长：经验 → 升级 → 三选一。
 *
 * 与 `BattleDirector` 的分工：Director 管阶段与统计，这里只管"变强"。
 * 升级期间由 Director 的 `paused` 冻结世界（否则怪会在你选卡时把血打光）。
 */
export class UpgradeSystem {
    /** 待处理的升级次数（一次击杀可能连升两级） */
    pendingLevelUps = 0;
    /** 当前三选一候选（面板打开时非空） */
    choices: UpgradeDef[] = [];

    level: number = 1;
    exp: number = 0;
    expNeed: number = LEVEL.baseExp;

    private _stacks: { [k in UpgradeId]: number } = {
        damage: 0, rate: 0, speed: 0, range: 0, feed: 0,
        resist: 0, multishot: 0, crit: 0, grit: 0, leech: 0,
    };
    private _stats: UpgradeStats = emptyStats();

    get stats(): UpgradeStats {
        return this._stats;
    }

    get picking(): boolean {
        return this.choices.length > 0;
    }

    /** 当前层数（UI 显示"x/上限"用） */
    stackOf(id: UpgradeId): number {
        return this._stacks[id];
    }

    /** 全饿门槛（受「皮实」影响），HunterSquad 按这个判档 */
    get starvingLine(): number {
        return Math.max(8, SATIETY.hungryLine - this._stats.gritBonus);
    }

    /** 返回本次是否触发了升级（触发则外部要弹面板） */
    addExp(n: number): boolean {
        if (this.level >= LEVEL.maxLevel) {
            return false;
        }
        this.exp += n;
        let leveled = false;
        while (this.exp >= this.expNeed && this.level < LEVEL.maxLevel) {
            this.exp -= this.expNeed;
            this.level++;
            this.expNeed = Math.round(LEVEL.baseExp * Math.pow(LEVEL.expGrowth, this.level - 1));
            this.pendingLevelUps++;
            leveled = true;
        }
        if (this.level >= LEVEL.maxLevel) {
            this.exp = 0;
            this.expNeed = 0;
        }
        return leveled;
    }

    /** 掷出 3 个候选（已满层的排除；不足 3 个就少给） */
    rollChoices(): UpgradeDef[] {
        const pool = UPGRADES.filter((u) => this._stacks[u.id] < u.maxStack);
        const out: UpgradeDef[] = [];
        const n = Math.min(3, pool.length);
        for (let i = 0; i < n; i++) {
            const picked = this.pickWeighted(pool);
            if (!picked) break;
            out.push(picked);
            pool.splice(pool.indexOf(picked), 1);
        }
        this.choices = out;
        return out;
    }

    /** 玩家选定一项 → 加层 + 重算 + 消耗一次待处理升级 */
    choose(id: UpgradeId): void {
        const def = UPGRADES.find((u) => u.id === id);
        if (!def || this._stacks[id] >= def.maxStack) {
            return;
        }
        this._stacks[id]++;
        this.recompute();
        this.choices = [];
        this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    }

    reset(): void {
        this.pendingLevelUps = 0;
        this.choices = [];
        this.level = 1;
        this.exp = 0;
        this.expNeed = LEVEL.baseExp;
        this._stacks = {
            damage: 0, rate: 0, speed: 0, range: 0, feed: 0,
            resist: 0, multishot: 0, crit: 0, grit: 0, leech: 0,
        };
        this._stats = emptyStats();
    }

    // ---------------- 内部 ----------------

    private pickWeighted(pool: readonly UpgradeDef[]): UpgradeDef | null {
        let total = 0;
        for (const u of pool) total += u.weight;
        if (total <= 0) return null;
        let r = Math.random() * total;
        for (const u of pool) {
            r -= u.weight;
            if (r <= 0) return u;
        }
        return pool[pool.length - 1] ?? null;
    }

    private recompute(): void {
        const s = emptyStats();
        const n = this._stacks;
        s.damageMul = Math.pow(1.18, n.damage);
        s.castMul = Math.pow(0.91, n.rate);
        s.speedMul = Math.pow(1.08, n.speed);
        s.rangeMul = Math.pow(1.14, n.range);
        s.feedMul = Math.pow(1.25, n.feed);
        s.decayMul = Math.pow(0.84, n.resist);
        s.multishot = n.multishot;
        s.critChance = 0.10 * n.crit;
        s.gritBonus = 12 * n.grit;
        s.leech = 0.09 * n.leech;
        this._stats = s;
    }
}

/** 供 HUD 用：把当前等级换算成"离下一级还差多少"的 0..1 */
export function expProgress(u: UpgradeSystem): number {
    if (u.expNeed <= 0) return 1;
    return Math.max(0, Math.min(1, u.exp / u.expNeed));
}

/**
 * 攻击周期（受「急食」影响）。
 *
 * CR-017：改为**按技能取** —— 三个槽位的基础节奏不同（贯穿 0.72 / 落雷 1.05 / 冲击 0.62），
 * 共用一套周期会把它们重新拉成"同时出手"。
 * 「急食」`castMul` 同时缩放三段，所以升级对三种技能都成立，不必分别配。
 */
export function castCycle(
    stats: UpgradeStats,
    kind: AbilityKind,
): { telegraph: number; cast: number; recovery: number } {
    const k = stats.castMul;
    const a = ABILITY[kind];
    return {
        telegraph: a.telegraph * k,
        cast: a.cast * k,
        recovery: a.recovery * k,
    };
}
