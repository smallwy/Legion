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
    /** 存档 key + 立绘贴图名（`home/pets/<id>`）。**永远不改**，改了存档就断 */
    id: string;
    /** grove 侧的短 id（cat/dog/ham/rab/ox/fox）。头像资源 `grove/head/<short>.png` 用它 */
    short: string;
    /**
     * `Home.scene` 里的**节点名**（中文旧名：砂糖/年糕/…）。
     *
     * **它是匹配键，不是显示名。** 草地上的六只、底部六个锁定槽都是场景里
     * 预置的节点，代码靠 `node.name` 把它们和花名册对上。改成新名字的那一刻
     * 三处 `PETS.find(p => p.name === n.name)` 全部失配 —— 表现为
     * 「主界面一只宠物都没有、六个槽全灰」，比改之前更糟。
     * 所以名字分成三个：id 给存档、node 给场景、name 给玩家。
     */
    node: string;
    /** 玩家看到的名字。必须和 `grove.html` 的 `HEROES[].name` 逐字一致 */
    name: string;
    /**
     * 这只的**招式名**（"溜溜球 / 音波喇叭 …"）。必须和 `grove.html` 的
     * `HEROES[].tag` 逐字一致 —— 战斗 HUD 上写的是它，主界面换人时说的也是它。
     * 两处不一致的话，玩家按主界面说的招式去找，场上根本没有那个东西。
     */
    tag: string;
    /** 通关多少屏之后回家（0 = 开局就在） */
    at: number;
}

/**
 * 解锁表。`at` 必须与 `grove.html` 的 `UNLOCK_AT` 和 `HomeRuntime` 的锁定文案
 * 三方一致。改这里 = 改解锁节奏，主界面与战斗会同时跟着变。
 *
 * **`at` 是按 27 屏重排的。** 原来是 0/1/3/5/7/8 —— 打完第 8 屏六只全齐，
 * 后 19 屏一只都不给。现在按产地分：
 *   苔原 1-9    → 尖耳猫(0) 短尾犬(2) 胖仓鼠(5) 长耳兔(9)
 *   枯木坡 10-18 → 老实牛(14) 影狐(18)
 *   泥沼 19-27  → 全齐，负责练熟
 * 第 9、18 是两屏收尾 BOSS，通关即到家，奖励和成就同一刻。
 *
 * ⚠️ **不要用 `name` 去做任何匹配。** 它只给玩家看，随文案改；匹配一律用
 *    `node`（场景节点）或 `id`（存档/贴图）。上一轮把 name 从"砂糖"改成
 *    "尖耳猫"时，三处 `p.name === n.name` 当场全断，主界面变成"一只都没有"。
 */
export const PETS: ReadonlyArray<PetDef> = [
    { id: 'sugar-stand', short: 'cat', node: '砂糖', name: '尖耳猫', tag: '溜溜球', at: 0 },
    { id: 'nian-gao-dog', short: 'dog', node: '年糕', name: '短尾犬', tag: '音波喇叭', at: 2 },
    { id: 'tuan-zi-ham', short: 'ham', node: '团子', name: '胖仓鼠', tag: '滚坚果', at: 5 },
    { id: 'xue-tuan-rab', short: 'rab', node: '雪团', name: '长耳兔', tag: '萝卜炮', at: 9 },
    { id: 'dou-nai-ox', short: 'ox', node: '豆奶', name: '老实牛', tag: '飞刀', at: 14 },
    { id: 'xing-xie-fox', short: 'fox', node: '星屑', name: '影狐', tag: '影分身', at: 18 },
];

/** 按场景节点名找（草地/锁定槽用）。找不到返回 undefined，调用方必须判空 */
export function petByNode(node: string): PetDef | undefined {
    return PETS.find((p) => p.node === node);
}

/** 按存档 id 找 */
export function petById(id: string): PetDef | undefined {
    return PETS.find((p) => p.id === id);
}

/**
 * `grove.html` 里 `HEROES[]` 的顺序。**必须逐字等于那张表的顺序。**
 *
 * 为什么要有这么一张"重复的表"：战斗侧 `groveBoot(heroIdx)` 收的是**下标**，
 * 而存档里存的是 **id**。两者之间必须有一处换算，而且只能有一处 ——
 * 换个地方各写一遍 `['cat','dog',...]` 就是"同一件事存两份"，迟早漂移。
 *
 * 冒烟里有一条断言拿 `grove.html` 的 HEROES 逐个比这张表（顺序 + 短 id）。
 */
const HERO_ORDER: ReadonlyArray<string> = ['cat', 'dog', 'ham', 'rab', 'ox', 'fox'];

/**
 * 存档 id → 战斗里的英雄下标。找不到 / 表不一致时兜回 0（尖耳猫），
 * 绝不返回 -1 —— 那会让 `groveBoot` 静默按默认值开局，玩家以为是随机。
 */
export function heroIndexOf(id: string): number {
    const p = petById(id);
    if (!p) return 0;
    const i = HERO_ORDER.indexOf(p.short);
    return i < 0 ? 0 : i;
}

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
