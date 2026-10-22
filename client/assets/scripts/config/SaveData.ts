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

import { PETS } from './Roster';

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

/** 工作台做出来、灶台和派遣会消耗的东西 */
export interface HomeBag {
    /** 干粮：灶台直接吃，不扣果子 */
    ration: number;
    /** 收集篮：收回派遣时产量 ×1.5，用掉一个 */
    basket: number;
}

/** 正在外面采集的那一只。`since` 是出发的时间戳（毫秒） */
export interface DispatchJob {
    id: string;
    since: number;
}

/** 设置页记住的两项。本版没有音效文件，静音开关先存着，画质会改帧率。 */
export interface HomePrefs {
    mute: boolean;
    /** true = 清晰 60 帧，false = 流畅 30 帧 */
    crisp: boolean;
}

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
    /** 每只被摸 / 被喂累计的亲密度点数。5 点一颗心，最多 5 颗 */
    pats: Record<string, number>;
    bag: HomeBag;
    /** 没有派出时是 null */
    dispatch: DispatchJob | null;
    settings: HomePrefs;
    /** 出门用的能量，0~100。和饱食不是一回事：饱食管火力，能量管能不能出门 */
    energy: number;
    /** 上次把能量结算到「现在」的时间戳。恢复按它算，不按帧 */
    energyAt: number;
    /** 灶台成功喂过几次、工作台做成几次、派遣收回几次。任务读这些数 */
    feeds: number;
    crafts: number;
    dispatches: number;
    /** 已经领过奖的任务 id */
    claimed: string[];
    /** 回到家园时要报的一句。报完就清空 */
    lastReward: string;
}

/**
 * 默认存档。资源初值刻意与 `Home.scene` 里三个 `val` Label 的静态值一致 ——
 * 这样"从没存过档"和"存过档"看起来是同一天，不会出现开局数字忽然跳变。
 */
function blankPats(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const p of PETS) o[p.id] = 0;
    return o;
}

export const DEFAULT_SAVE: SaveState = {
    cleared: 0,
    apples: 248,
    logs: 36,
    coins: 12,
    active: 'sugar-stand',
    satiety: 100,
    runs: 0,
    pats: blankPats(),
    bag: { ration: 0, basket: 0 },
    dispatch: null,
    settings: { mute: false, crisp: true },
    energy: 100,
    energyAt: 0,
    feeds: 0,
    crafts: 0,
    dispatches: 0,
    claimed: [],
    lastReward: '',
};

/** 默认档的深拷贝。浅拷贝会让调用方改到 `DEFAULT_SAVE` 里的 pats / bag。 */
function freshSave(): SaveState {
    return {
        ...DEFAULT_SAVE,
        pats: { ...DEFAULT_SAVE.pats },
        bag: { ...DEFAULT_SAVE.bag },
        settings: { ...DEFAULT_SAVE.settings },
        dispatch: null,
        claimed: [],
        energyAt: Date.now(),
    };
}

function loadPats(raw: unknown): Record<string, number> {
    const src = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const o = blankPats();
    for (const id of Object.keys(o)) o[id] = Math.floor(clampNum(src[id], 0, 0, 99_999));
    return o;
}

function loadBag(raw: unknown): HomeBag {
    const src = raw && typeof raw === 'object' ? raw as Partial<HomeBag> : {};
    return {
        ration: Math.floor(clampNum(src.ration, 0, 0, 999)),
        basket: Math.floor(clampNum(src.basket, 0, 0, 999)),
    };
}

function loadDispatch(raw: unknown): DispatchJob | null {
    if (!raw || typeof raw !== 'object') return null;
    const src = raw as Partial<DispatchJob>;
    if (typeof src.id !== 'string' || !PETS.some((p) => p.id === src.id)) return null;
    if (typeof src.since !== 'number' || !isFinite(src.since)) return null;
    return { id: src.id, since: src.since };
}

function loadPrefs(raw: unknown): HomePrefs {
    const src = raw && typeof raw === 'object' ? raw as Partial<HomePrefs> : {};
    return {
        mute: src.mute === true,
        crisp: src.crisp !== false,
    };
}

/**
 * 版本化键名。新加的亲密度 / 背包 / 派遣 / 设置在读档时补默认值，
 * 不换键 —— 换了会把已经打过的进度清掉。
 */
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
    if (!s) return freshSave();

    let raw: string | null = null;
    try {
        raw = s.getItem(KEY);
    } catch (e) {
        return freshSave();
    }
    if (!raw) return freshSave();

    let o: Partial<SaveState> | null = null;
    try {
        o = JSON.parse(raw) as Partial<SaveState>;
    } catch (e) {
        /* 存档损坏就当没存过，不要崩 —— 玩家丢档比丢进度更痛 */
        return freshSave();
    }
    if (!o || typeof o !== 'object') return freshSave();

    return {
        cleared: Math.floor(clampNum(o.cleared, DEFAULT_SAVE.cleared, 0, 8)),
        apples: Math.floor(clampNum(o.apples, DEFAULT_SAVE.apples, 0, 9_999_999)),
        logs: Math.floor(clampNum(o.logs, DEFAULT_SAVE.logs, 0, 9_999_999)),
        coins: Math.floor(clampNum(o.coins, DEFAULT_SAVE.coins, 0, 9_999_999)),
        active: typeof o.active === 'string' && o.active ? o.active : DEFAULT_SAVE.active,
        satiety: clampNum(o.satiety, DEFAULT_SAVE.satiety, 0, 100),
        runs: Math.floor(clampNum(o.runs, DEFAULT_SAVE.runs, 0, 999_999)),
        pats: loadPats(o.pats),
        bag: loadBag(o.bag),
        dispatch: loadDispatch(o.dispatch),
        settings: loadPrefs(o.settings),
        energy: Math.floor(clampNum(o.energy, DEFAULT_SAVE.energy, 0, 100)),
        energyAt: typeof o.energyAt === 'number' && isFinite(o.energyAt) && o.energyAt > 0 ? o.energyAt : Date.now(),
        feeds: Math.floor(clampNum(o.feeds, 0, 0, 999_999)),
        crafts: Math.floor(clampNum(o.crafts, 0, 0, 999_999)),
        dispatches: Math.floor(clampNum(o.dispatches, 0, 0, 999_999)),
        claimed: Array.isArray(o.claimed) ? o.claimed.filter((id) => typeof id === 'string') : [],
        lastReward: typeof o.lastReward === 'string' ? o.lastReward.slice(0, 80) : '',
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

/** 一顿吃满的饱食度。结算不再用它兜底，灶台把肚子喂到这里为止。 */
export const REST_SATIETY = 100;

/**
 * 把一局的战利品写回存档，返回写后的新存档（调用方用它刷新 UI）。
 *
 * 三件事在这里一次做完，避免调用方漏掉其中一件：
 *  1. 资源入池；
 *  2. 通关则推进关卡进度（`cleared`），驱动宠物解锁与出战人数；
 *  3. 饱食度按战斗结束时的数回写。
 *     回家不再自动吃饱 —— 要吃去灶台。`REST_SATIETY` 留着表示"一顿吃满"。
 */
export function settleInto(
    prev: SaveState,
    stats: LootInput,
    endSatiety: number,
): { next: SaveState; loot: Loot } {
    const loot = lootOf(stats);
    const won = stats.endReason === 'victory';
    const sat = Math.min(100, endSatiety);
    const next: SaveState = {
        ...prev,
        apples: prev.apples + loot.apples,
        logs: prev.logs + loot.logs,
        coins: prev.coins + loot.coins,
        cleared: won ? Math.min(8, prev.cleared + 1) : prev.cleared,
        satiety: sat < 0 ? 0 : sat,
        runs: prev.runs + 1,
    };
    saveSave(next);
    return { next, loot };
}
