/**
 * Roster —— 队伍花名册：家园与战斗之间的**唯一真值**
 * ============================================================================
 *
 * 为什么需要这个文件
 * ------------------
 * 改造前两边各写一份：
 *   · 主界面 `CLEARED = 0` → 家里只有 1 只砂糖；
 *   · 战斗 `HERO.count = 3` → 场上 3 个跟班。
 * 玩家带 1 只出门、场上却站 3 只 —— 这不是数值问题，是"我养的宠物和场上打的
 * 不是同一批"的断层，最伤代入。
 *
 * 修法不是"把 3 改成 1"，而是**让 3 这个数字不再存在于任何一处**：
 * 队伍人数 = 已解锁宠物数（本文件从存档算），战斗侧按这个数实例化。
 * 于是随解锁从 1 长到 3，养成有正反馈，两边永远一致。
 *
 * ⚠️ 本文件不 import `cc`：存档、家园、战斗三方都要读它，
 *    任何一侧多带一个引擎依赖都会让另外两侧在离线测试里跑不起来。
 */

import type { AbilityKind } from './BattleConfig';

/* ==========================================================================
 * 1. 宠物
 * ========================================================================== */

export interface PetDef {
    /** 与 Home.scene 里 `home/pets/<id>` 贴图名一致 */
    id: string;
    name: string;
    /** 通关多少关之后回家（0 = 开局就在） */
    at: number;
}

/**
 * 解锁表。`at` 必须与 `Home.scene` 的初始状态（CLEARED = 0 时只建砂糖节点）
 * 和 `HomeRuntime` 的锁定文案（"再通过 N 关就会回家"）三方一致。
 *
 * 改这里 = 改解锁节奏，主界面与战斗会同时跟着变。
 */
export const PETS: ReadonlyArray<PetDef> = [
    { id: 'sugar-stand', name: '砂糖', at: 0 },
    { id: 'nian-gao-dog', name: '年糕', at: 1 },
    { id: 'tuan-zi-ham', name: '团子', at: 3 },
    { id: 'xue-tuan-rab', name: '雪团', at: 5 },
    { id: 'dou-nai-ox', name: '豆奶', at: 7 },
    { id: 'xing-xie-fox', name: '星屑', at: 8 },
];

/** 已解锁的宠物（按解锁顺序） */
export function unlockedPets(cleared: number): PetDef[] {
    return PETS.filter((p) => cleared >= p.at);
}

/** 还没回家的宠物（主界面锁定槽用） */
export function lockedPets(cleared: number): PetDef[] {
    return PETS.filter((p) => cleared < p.at);
}

/** 某只宠物还差几关（0 = 已解锁） */
export function petGap(cleared: number, id: string): number {
    const p = PETS.find((x) => x.id === id);
    if (!p) return 0;
    return Math.max(0, p.at - cleared);
}

/* ==========================================================================
 * 2. 队伍角色（槽位 + 技能）
 * ========================================================================== */

/**
 * 出战上限。**这是"最多几个跟班"，不是"实际几个"** —— 实际人数见 `squadSize()`。
 *
 * 定 3 而不是 6 的理由：`HERO_SLOTS` 的三个位置（左后/右后/正后）刚好覆盖
 * 三种几何关系，对应三种技能（直线贯穿 / 定点落雷 / 近身环爆）。
 * 加到第 4 个人就只能挤在已有位置上，玩家读不出"他是谁、他打什么"。
 * 家里 6 只、场上 3 只不矛盾 —— 待命的那 3 只留在 Dock 里。
 */
export const MAX_SQUAD = 3;

export interface HeroRole {
    /** 队形槽位 `[沿前进方向, 向右偏移]`，负值 = 主角身后 */
    slot: readonly [number, number];
    /** 该槽位的技能形态（CR-017） */
    kind: AbilityKind;
}

/**
 * 满编 3 人的角色表。**顺序即"先解锁谁"** ——
 * 先给贯穿（直线、好懂、单体最扎实），再给落雷（清扎堆），
 * 最后给冲击（贴身环爆，是"被围住时的救命手段"，放到最后才不显得鸡肋）。
 */
const ROLES: ReadonlyArray<HeroRole> = [
    { slot: [-28, -24], kind: 'beam' },
    { slot: [-28, 24], kind: 'bolt' },
    { slot: [-52, 0], kind: 'nova' },
];

/**
 * 单人时的槽位。用 `[-28, -24]`（左后）会读成"它站偏了" ——
 * 那个偏移本来是为了和右后的人对称，只有一只时没有对称对象。
 * 孤军就该站正后方。
 */
const SOLO_SLOT: readonly [number, number] = [-40, 0];

/**
 * 按实际出战人数取角色表。
 * @param n 出战人数（由 `squadSize()` 得来，0 也会被兜成 1 —— 场上不能没人打）
 */
export function rolesFor(n: number): HeroRole[] {
    const c = Math.max(1, Math.min(MAX_SQUAD, Math.floor(n) || 1));
    if (c === 1) {
        return [{ slot: SOLO_SLOT, kind: ROLES[0].kind }];
    }
    return ROLES.slice(0, c).map((r) => ({ slot: r.slot, kind: r.kind }));
}

/** 出战人数 = min(已解锁数, 上限)。开局 1 只，通关 1 / 3 关后变 2 / 3 只。 */
export function squadSize(cleared: number): number {
    return Math.max(1, Math.min(MAX_SQUAD, unlockedPets(cleared).length));
}

/* ==========================================================================
 * 3. 敌人配平
 * ========================================================================== */

/**
 * 队伍规模系数 = 出战人数 / 满编数。
 *
 * **为什么必须乘到敌人身上**：满编 3 人的单体 DPS ≈ 44.8（12/0.72 + 16/1.05 + 8/0.62），
 * 只有 1 只贯穿时 ≈ 16.7 —— 只有 37%。不配平的话，刚开局那只砂糖要去打
 * 为 3 人标定的 20 波，第 5 波就打不动了。
 *
 * 乘的东西（数量 **和** 血量）不能只乘一个：
 *  · 只减数量 → 甲虫（60HP）相对更耐打，1 只宠物要打 5 发，节奏比满编慢一倍；
 *  · 只减血量 → 同屏怪数不变，1 只宠物会被 6 个方向同时逼近，走位失效。
 *
 * 目标不是"让 1 只宠物也打得过 3 只的量"，而是**让每一局的时长量级保持一致**。
 * 1/3、2/3、3/3 与 16.7 / 44.8 的 DPS 占比（37% / 62% / 100%）基本同阶。
 *
 * ⚠️ 这是**离线推算**的首次配平，不是实测值。首局真跑之后按 `BattleStats.timeMs`
 *    复核，见 `docs/战斗场景_接入与合理性规划_PAWPACK.md` 问题 5。
 */
export function powerScale(n: number): number {
    return Math.max(1, Math.min(MAX_SQUAD, Math.floor(n) || 1)) / MAX_SQUAD;
}
