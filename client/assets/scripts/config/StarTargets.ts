/**
 * StarTargets —— 星靶（挑战层）：**每屏 3 个挑战条件的唯一真值**
 * ============================================================================
 *
 * 为什么单独一个文件
 * ------------------
 * 「这一屏挂哪三个靶」「每个靶叫什么、给什么」原本会散成三份：
 * 战斗侧结算卡要画、主界面图鉴要摆、存档要记完成位。散三份必漂移
 * （MEMORY 教训 2），所以这里只放一份，两边都从这里读。
 *
 * 与 grove.html 的关系
 * -------------------
 * `grove.html` 是浏览器原型，**不能 import 这个文件**。所以战斗侧有一份
 * 逐字相同的副本（`STAR_CN` 名字表 + `STAR_OF_STAGE` 配靶表），
 * `grove-smoke.js` 第 39 节断言两边 id / 名字 / 条数完全一致。
 * 改这里必须同步改那份，冒烟会抓。
 *
 * 为什么 81 个靶全部只用 `S.stat` 判定
 * ----------------------------------
 * 不新增战斗统计字段的话，每个靶都是纯函数、可单测、不碰物理。
 * 确实需要两个新统计（弹菇次数 `shroom`、坡面入营 `rampIn`）——
 * 它们只是计数器，不改球的运动，所以 `updateBalls` / `predictBall`
 * 一行都不用动（MEMORY：新空间件才要两处同源）。
 *
 * ⚠️ 本文件不 import `cc`：战斗、主界面、离线冒烟三方都要读它。
 */

import { STAGE_COUNT } from './Stages';

/** 每屏挂几个靶。3 是算过的：2 个没有「集满」这个台阶，4 个必有一个是凑数。 */
export const STAR_PER_STAGE = 3;

/* ============================================================================
   靶目类型表
   ----------------------------------------------------------------------------
   id 与「本趟目标」（HomeBiz.TRIP_GOALS）**共用同一套判定语义**：
     nofire / bigchain / nohit / nolost / noshell 这 5 个 id 在两边都存在，
     名字必须逐字一致（冒烟断言）。差一个字，玩家就会在同一天里看到
    「一毛不拔」和「一次不挨」描述同一件事。
   ============================================================================ */

export interface StarTypeDef {
    id: string;
    /** 结算卡上画的短名（≤4 字，卡片 pill 只有 156px 宽） */
    name: string;
    /** 图鉴里的一句话条件。出发前就要能读懂，所以必须写具体 */
    desc: string;
    /** 首次达成给的材料。靶是「这一屏怎么打」的约束，不是收入来源 */
    logs: number;
}

export const STAR_TYPES: ReadonlyArray<StarTypeDef> = [
    {
        id: 'nofire', name: '不碰火坑',
        desc: '一趟下来一次火坑都没用（烧球净消灭另算收成，这里不让用）',
        logs: 1,
    },
    {
        id: 'nolost', name: '一只不丢',
        desc: '一趟下来没有球滚出屏幕（左边滚出去的最亏，人还得重裹）',
        logs: 1,
    },
    {
        id: 'nohit', name: '一毛不拔',
        desc: '一趟下来一次都没被打到（球可以挨打，人不行）',
        logs: 1,
    },
    {
        id: 'noshell', name: '壳不破',
        desc: '一趟下来没有球崩开（到期、丢气、滚远、撞墙三次都会崩）',
        logs: 1,
    },
    {
        id: 'nodrown', name: '不沉底',
        desc: '一趟下来没有球沉进水塘（砸进去才沉，滚过去不算）',
        logs: 1,
    },
    {
        id: 'bigchain', name: '大打卷',
        desc: '至少一次让一颗球卷进 3 只（卷得越多越好，3 只是门槛）',
        logs: 1,
    },
    {
        id: 'shroom3', name: '三弹菇',
        desc: '一趟里触发的弹菇加起来 3 次（衰减制，第 5 次就弹不动了）',
        logs: 1,
    },
    {
        id: 'ramp', name: '坡道入营',
        desc: '让一颗球从坡面上滚进营地（推上去的不算，要自己滚下来）',
        logs: 1,
    },
];

/** 一屏 3 靶全达成（首次）的额外奖励。碎片是改造件的门槛，最值钱 */
export const STAR_FULL_SHARDS = 2;
export const STAR_FULL_LOGS = 1;

/** 一章 9 屏 27 靶全达成（首次）的大奖励 */
export const STAR_CHAPTER_SHARDS = 4;
export const STAR_CHAPTER_LOGS = 3;

/* ============================================================================
   配靶表：27 屏 × 3 靶
   ----------------------------------------------------------------------------
   **不是随手排的**，每屏的 3 个靶都按地形特征选（没弹菇的屏不挂三弹菇），
   而且**避开这一屏自己的通关条件**（否则靶会被通关白送）：
     · goal=nohit 的屏（14/23）不挂 nohit —— 过关本身就要求一次不挨；
     · goal=intact 的屏（16/24）不挂 noshell —— 过关本身就要求不崩；
     · goal=chain 且 chain≥3 的屏（4/6/11/12/20/21）不挂 bigchain —— 同上；
     · goal=limit 的屏（2/3/7/13/22）不挂「用球 ≤ par」类靶（已不在表内）；
     · goal=nohit 的屏（14/23）不挂 nohit —— 过关本身就要求一次不挨；
       **没有"BOSS 屏不挂 nohit"这条规则**：27 屏每一屏结尾都有 BOSS
       （lv 从 1 递增到 5），而 14/23 两屏的通关条件就是 hits=0 ——
       游戏自己证明了 lv5 面前一次不挨是能做到的，靶没有骗人；
     · shroom3 只挂有弹菇的屏（5/15），ramp 只挂有坡的屏（1/2/3/4/10/22），
       nodrown 只挂有水塘的屏。
   这些规则 `grove-smoke.js` 第 39 节逐条断言，改表先过冒烟。
   ============================================================================ */
export const STAR_OF_STAGE: ReadonlyArray<ReadonlyArray<string>> = [
    ['nofire', 'bigchain', 'ramp'],       // 1  苔原入口
    ['nolost', 'nodrown', 'ramp'],        // 2  雪原
    ['nofire', 'bigchain', 'ramp'],       // 3  崖壁
    ['nolost', 'nofire', 'ramp'],         // 4  长坡
    ['nofire', 'bigchain', 'shroom3'],    // 5  弹菇台
    ['nolost', 'nodrown', 'noshell'],     // 6  深井
    ['nofire', 'nodrown', 'nohit'],       // 7  回弹
    ['nolost', 'bigchain', 'noshell'],    // 8  双生
    ['nofire', 'nolost', 'bigchain'],     // 9  BOSS
    ['nofire', 'bigchain', 'ramp'],       // 10 枯林门
    ['nolost', 'nofire', 'noshell'],      // 11 枯林桩
    ['nolost', 'nodrown', 'noshell'],     // 12 枯林洼
    ['nofire', 'nodrown', 'bigchain'],    // 13 枯林缺口
    ['nofire', 'nolost', 'bigchain'],     // 14 枯林崖
    ['nofire', 'bigchain', 'shroom3'],    // 15 弹菇田
    ['nolost', 'nodrown', 'nohit'],       // 16 枯林渠
    ['nolost', 'bigchain', 'noshell'],    // 17 枯林顶
    ['nofire', 'bigchain', 'nolost'],     // 18 BOSS
    ['nofire', 'nodrown', 'noshell'],     // 19 泽沿
    ['nolost', 'nodrown', 'nohit'],       // 20 泽墩
    ['nofire', 'nodrown', 'nohit'],       // 21 泽气
    ['nolost', 'nodrown', 'ramp'],        // 22 泽坡
    ['nofire', 'nodrown', 'bigchain'],    // 23 泽芦苇
    ['nolost', 'bigchain', 'nohit'],      // 24 泽潭
    ['nofire', 'bigchain', 'nohit'],      // 25 泽桥
    ['nolost', 'nodrown', 'noshell'],     // 26 泽深
    ['nofire', 'nodrown', 'bigchain'],    // 27 BOSS
];

/** 某一屏的 3 个靶 id。越界返回空数组（调用方按「没有靶」处理） */
export function starOfStage(i: number): string[] {
    if (!Number.isInteger(i) || i < 0 || i >= STAR_OF_STAGE.length) return [];
    return STAR_OF_STAGE[i].slice();
}

/** 按 id 取靶目定义。未知 id 返回 null（调用方要跳过，不能崩） */
export function starType(id: string): StarTypeDef | null {
    return STAR_TYPES.find((t) => t.id === id) || null;
}

/** 全部靶目 id（冒烟 / 调试用） */
export const STAR_IDS: ReadonlyArray<string> = STAR_TYPES.map((t) => t.id);

/* ============================================================================
   存档形状：完成位
   ----------------------------------------------------------------------------
   `star[i][k]` = 第 i 屏第 k 个靶是否达成（0/1）。
   **只增不减**：和评级一个口径 —— 拿过一次就永远拿着，重打打差不会抹掉。
   形状是 27×3 的二维数组，不是 81 长度的一维 —— 一维的话「哪一屏满没满」
   要除混取整，读代码的人得心算，除错一位就是「第 3 屏满了看成第 4 屏」。
   ============================================================================ */

/** 把存档里的 `star` 字段整成 27×3 的 0/1。坏档不崩，缺的补 0 */
export function starBitsOf(v: unknown): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < STAGE_COUNT; i++) {
        const row: number[] = [];
        const src = Array.isArray(v) ? v[i] : undefined;
        for (let k = 0; k < STAR_PER_STAGE; k++) {
            row.push(Array.isArray(src) && src[k] === 1 ? 1 : 0);
        }
        out.push(row);
    }
    return out;
}

export interface StarFresh {
    stage: number;
    /** 这一屏**新**达成的靶 id（存档里原本没有的） */
    ids: string[];
}

export interface StarMergeResult {
    bits: number[][];
    /** 新达成的（按屏分组）。奖励只给这些 —— 重复打不给第二次 */
    fresh: StarFresh[];
    /** 这一次刚好集满的屏（3/3） */
    fullStages: number[];
    /** 这一次刚好集满的章（27/27） */
    fullChapters: number[];
    shards: number;
    logs: number;
}

/**
 * 把「这一屏达成了哪几个靶」并进存档完成位。
 *
 * 纯函数：不碰 localStorage、不碰 `cc`，冒烟直接测。
 * 三条口径钉死在这里：
 *   ① 只增不减 —— `prev` 里是 1 的格，任何输入都不会变回 0；
 *   ② 奖励只给**新**达成的 —— 同一个靶打十遍只给一次；
 *   ③ 「集满」按**并后**判定 —— 第 3 个靶是补老的，照样算集满、照样给奖励。
 */
export function mergeStarBits(
    prev: number[][],
    gained: ReadonlyArray<{ stage: number; ids: ReadonlyArray<string> }>,
): StarMergeResult {
    const bits = starBitsOf(prev);
    const fresh: StarFresh[] = [];
    const fullStages: number[] = [];
    const fullChapters: number[] = [];
    let shards = 0;
    let logs = 0;

    for (const g of gained) {
        if (!Number.isInteger(g.stage) || g.stage < 0 || g.stage >= STAGE_COUNT) continue;
        const row = bits[g.stage];
        const want = starOfStage(g.stage);
        const ids: string[] = [];
        for (const id of g.ids || []) {
            const k = want.indexOf(id);
            if (k < 0) continue;                       // 不是这一屏的靶，丢掉
            if (row[k]) continue;                      // 早就有了，不重复给
            row[k] = 1;
            ids.push(id);
            const def = starType(id);
            if (def) logs += def.logs;
        }
        if (!ids.length) continue;
        fresh.push({ stage: g.stage, ids });
        /* 集满判定必须放在**这一屏并完之后**：三个靶可能分三次打，
           最后一次补上的那个才是触发点。 */
        if (row.every((b) => b === 1) && fullStages.indexOf(g.stage) < 0) {
            fullStages.push(g.stage);
            shards += STAR_FULL_SHARDS;
            logs += STAR_FULL_LOGS;
        }
    }

    /* 章集满从完成位**派生**，不另存一份（MEMORY 教训 2） */
    const before = starBitsOf(prev);
    for (let ch = 0; ch < 3; ch++) {
        const from = ch * 9;
        let wasFull = true;
        let nowFull = true;
        for (let i = from; i < from + 9; i++) {
            if (!before[i].every((b) => b === 1)) wasFull = false;
            if (!bits[i].every((b) => b === 1)) nowFull = false;
        }
        if (nowFull && !wasFull) {
            fullChapters.push(ch);
            shards += STAR_CHAPTER_SHARDS;
            logs += STAR_CHAPTER_LOGS;
        }
    }

    return { bits, fresh, fullStages, fullChapters, shards, logs };
}

/** 这一屏集满了没有（图鉴画「满」标记用） */
export function stageStarFull(bits: number[][], i: number): boolean {
    if (i < 0 || i >= bits.length) return false;
    return bits[i].every((b) => b === 1);
}

/** 这一章集满了没有（派生，不另存） */
export function chapterStarFull(bits: number[][], ch: number): boolean {
    const from = ch * 9;
    if (from + 9 > bits.length) return false;
    for (let i = from; i < from + 9; i++) if (!bits[i].every((b) => b === 1)) return false;
    return true;
}
