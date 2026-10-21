/**
 * SaveData —— 轻量存档（家园 ⇄ 战斗的唯一数据通道）
 * ============================================================================
 *
 * 解决的是「战利品不回流」：改造前 `SettlementPanel` 自己写着
 * `'（资源入池在家园场景接线，M2）'` —— 打完一场，家园顶部的果子 / 材料 / 吧唧
 * 一个都不变。玩家第一次注意到之后，"出门"这个动作就失去意义了。
 *
 * 为什么是 localStorage 而不是新建一套存档系统
 * --------------------------------------------
 * 当前只需要「家园顶部三个数 + 关卡进度 + 出战宠物」这一组标量。
 * 上 Supabase / 云存档是 M2 的事，现在搭一套存档框架属于过度设计。
 * 所以：一个 JSON、一个版本号键、读写各一个函数，其余全是纯函数（可离线单测）。
 *
 * ⚠️ 本文件不 import `cc`。存档要同时被家园、战斗、离线验证器三方读取，
 *    任何一侧多带一个引擎依赖都会让另外两侧跑不起来。存储后端用运行时探测。
 */

/* ==========================================================================
 * 1. 存储后端
 * ========================================================================== */

export interface Store {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
}

/**
 * 显式注入存储后端（由 `config/StorageBind.ts` 在引擎里调用）。
 *
 * 为什么不直接 `import { sys } from 'cc'`：本文件要能被**离线验证器**直接 require
 * （`tools/verify-roster.js`），一旦顶层依赖 cc，那套 61 项离线断言就跑不起来 ——
 * 而那套断言恰恰是这次改动最关键的把关手段。所以依赖反转：引擎侧推进来，不从这里拉。
 */
export function setStore(s: Store | null): void {
    _store = s;
}

let _store: Store | null | undefined;

/**
 * 探测可用的键值存储。
 *
 * 顺序：显式注入的（`sys.localStorage`，原生 / 小游戏平台唯一可靠的那个）→ 全局
 * `localStorage`（浏览器预览）→ 都没有就退化成"本次运行内有效"，不报错。
 * 预览环境和离线测试都不该因为存档不可用而崩。
 */
function store(): Store | null {
    if (_store !== undefined) return _store;
    _store = null;
    try {
        const g = globalThis as unknown as { cc?: { sys?: { localStorage?: Store } }; localStorage?: Store };
        const cand = (g.cc && g.cc.sys && g.cc.sys.localStorage) || g.localStorage;
        if (cand && typeof cand.getItem === 'function') {
            /* 写一次空探针：隐私模式下 localStorage 存在但 setItem 会抛 */
            const probe = '__pawpack_probe__';
            cand.setItem(probe, '1');
            cand.removeItem(probe);
            _store = cand;
        }
    } catch (e) {
        _store = null;
    }
    return _store;
}

/* ==========================================================================
 * 2. 存档结构
 * ========================================================================== */

export interface SaveState {
    /** 已通关数（苔原 1/8）。驱动宠物解锁与出战人数 */
    cleared: number;
    /** 家园资源池 */
    apples: number;
    logs: number;
    coins: number;
    /** 出战宠物 id（主界面出战卡显示的那只） */
    active: string;
    /**
     * 出战宠物的饱食度 0~`SATIETY.max`。
     *
     * **这是"两套口径"的修法**：改造前家园的 3 格 bar 表示一个抽象"饱食"，
     * 战斗里 `SATIETY` 是 100 制 —— 同一个属性两个量纲，玩家不知道是不是一回事。
     * 现在只剩这一个字段：家园读它、战斗从它起手、结算写回它。
     */
    satiety: number;
    /** 累计出门场次（只做统计，不参与任何判定） */
    runs: number;
}

/**
 * 默认存档。资源初值刻意与 `Home.scene` 里三个 `val` Label 的静态值一致 ——
 * 这样"从没存过档"和"存过档"看起来是同一天，不会出现开局数字忽然跳变。
 */
export const DEFAULT_SAVE: SaveState = {
    cleared: 0,
    apples: 248,
    logs: 36,
    coins: 12,
    active: 'sugar-stand',
    satiety: 100,
    runs: 0,
};

/** 版本化键名：结构一变就换键，旧档自然失效，不做迁移（原型期） */
const KEY = 'pawpack.save.v1';

const clampNum = (v: unknown, def: number, lo: number, hi: number): number => {
    const n = typeof v === 'number' && isFinite(v) ? v : def;
    return n < lo ? lo : n > hi ? hi : n;
};

/**
 * 读存档。永远返回一个**结构完整**的对象：
 * 缺字段用默认值补、越界值夹回区间、类型不对就丢弃。
 * 存档是唯一一个"外部输入"，不能假设磁盘上的内容是本程序写的。
 */
export function loadSave(): SaveState {
    const s = store();
    if (!s) return { ...DEFAULT_SAVE };

    let raw: string | null = null;
    try {
        raw = s.getItem(KEY);
    } catch (e) {
        return { ...DEFAULT_SAVE };
    }
    if (!raw) return { ...DEFAULT_SAVE };

    let o: Partial<SaveState> | null = null;
    try {
        o = JSON.parse(raw) as Partial<SaveState>;
    } catch (e) {
        /* 存档损坏就当没存过，不要崩 —— 玩家丢档比丢进度更痛 */
        return { ...DEFAULT_SAVE };
    }
    if (!o || typeof o !== 'object') return { ...DEFAULT_SAVE };

    return {
        cleared: Math.floor(clampNum(o.cleared, DEFAULT_SAVE.cleared, 0, 8)),
        apples: Math.floor(clampNum(o.apples, DEFAULT_SAVE.apples, 0, 9_999_999)),
        logs: Math.floor(clampNum(o.logs, DEFAULT_SAVE.logs, 0, 9_999_999)),
        coins: Math.floor(clampNum(o.coins, DEFAULT_SAVE.coins, 0, 9_999_999)),
        active: typeof o.active === 'string' && o.active ? o.active : DEFAULT_SAVE.active,
        satiety: clampNum(o.satiety, DEFAULT_SAVE.satiety, 0, 100),
        runs: Math.floor(clampNum(o.runs, DEFAULT_SAVE.runs, 0, 999_999)),
    };
}

/** 写存档。失败只警告，不抛 —— 写不进去不该让一局游戏崩在结算那一刻。 */
export function saveSave(v: SaveState): void {
    const s = store();
    if (!s) return;
    try {
        s.setItem(KEY, JSON.stringify(v));
    } catch (e) {
        console.warn('[SaveData] 写存档失败（可能是隐私模式或配额满）', e);
    }
}

/** 清档（调试用） */
export function resetSave(): void {
    const s = store();
    if (!s) return;
    try {
        s.removeItem(KEY);
    } catch (e) {
        /* 忽略 */
    }
}

/* ==========================================================================
 * 3. 战利品换算
 * ========================================================================== */

/**
 * 换算表。
 *
 * **为什么要换算，而不是直接把经验珠数当果子**：
 * 一局满编约 300 杀、约 390 颗经验珠。直接当果子就是「打一场 +390 果子」，
 * 而家园基线是 248 —— 一场就翻倍，资源彻底失去重量，养成曲线一步走完。
 *
 * 取值目标：**一局让三个数都明显动，但不动到改变量级**。
 * 满编通关一局 ≈ 果子 +16 / 材料 +19 / 吧唧 +5（+BOSS 3），
 * 相对基线 248 / 36 / 12 分别 +6% / +53% / +42%。
 * 材料与吧唧动得更明显是刻意的 —— 它们才是"要攒"的东西。
 */
export const LOOT = {
    /** 每 N 颗经验珠换 1 个果子 */
    orbsPerApple: 24,
    /** 每 N 次击杀换 1 个材料 */
    killsPerLog: 16,
    /** 每 N 次击杀换 1 个吧唧 */
    killsPerCoin: 60,
    /** BOSS 额外掉落吧唧（结算"好看"的那一下） */
    bossCoins: 3,

    /* ---- 结局系数 ---- */
    /** 通关 */
    mulVictory: 1.0,
    /** 主动撤离 */
    mulWithdraw: 1.0,
    /**
     * HP 归零。
     *
     * ⚠️ **暂定 1.0 = 与主动撤离等价**，也就是现在"躲伤害没有额外收益"。
     *    建议改成 0.6（"体力不支时东西掉了"，符合直觉且不清零），
     *    但这条动的是红线②（无失败惩罚）的解释边界，**需要你拍板**。
     *    拍板后只改这一个数，见 `docs/战斗场景_接入与合理性规划_PAWPACK.md` 问题 4。
     */
    mulHp0: 1.0,
} as const;

export interface Loot {
    apples: number;
    logs: number;
    coins: number;
}

/** 战斗统计里本模块需要的最小字段集（避免反向 import battle 目录） */
export interface LootInput {
    orbs: number;
    kills: number;
    bossKilled: boolean;
    endReason: string;
}

/** 本局应带回的战利品（结算面板显示的就是这一份，入池的也是这一份 —— 不许两处各算一遍） */
export function lootOf(s: LootInput): Loot {
    let mul = LOOT.mulWithdraw;
    if (s.endReason === 'victory') {
        mul = LOOT.mulVictory;
    } else if (s.endReason === 'hp0') {
        mul = LOOT.mulHp0;
    }

    let apples = Math.floor((s.orbs / LOOT.orbsPerApple) * mul);
    let logs = Math.floor((s.kills / LOOT.killsPerLog) * mul);
    let coins = Math.floor((s.kills / LOOT.killsPerCoin) * mul);

    /* 至少给 1 个果子：0 战利品的结算会让玩家以为"打了没算"，
       那是比"给得少"严重得多的体验问题。主动撤离也算出过门。 */
    if (apples < 1 && (s.kills > 0 || s.orbs > 0)) apples = 1;
    if (s.bossKilled) coins += LOOT.bossCoins;

    return { apples, logs, coins };
}

/* ==========================================================================
 * 4. 结算入池
 * ========================================================================== */

/** 回家后的饱食度下限（= "回家吃一顿"）。 */
export const REST_SATIETY = 100;

/**
 * 把一局的战利品写回存档，返回写后的新存档（调用方用它刷新 UI）。
 *
 * 三件事在这里一次做完，避免调用方漏掉其中一件：
 *  1. 资源入池；
 *  2. 通关则推进关卡进度（`cleared`），驱动宠物解锁与出战人数；
 *  3. 饱食度回写 —— 但**回家必吃一顿**，所以取 `REST_SATIETY` 作为下限。
 *     灶台上线后把这里改成"实际吃了多少"，这个字段立刻开始有变化。
 */
export function settleInto(
    prev: SaveState,
    stats: LootInput,
    endSatiety: number,
): { next: SaveState; loot: Loot } {
    const loot = lootOf(stats);
    const won = stats.endReason === 'victory';

    const next: SaveState = {
        ...prev,
        apples: prev.apples + loot.apples,
        logs: prev.logs + loot.logs,
        coins: prev.coins + loot.coins,
        cleared: won ? Math.min(8, prev.cleared + 1) : prev.cleared,
        satiety: Math.max(REST_SATIETY, Math.min(100, endSatiety)),
        runs: prev.runs + 1,
    };
    saveSave(next);
    return { next, loot };
}
