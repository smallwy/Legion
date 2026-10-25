/**
 * HomeBiz —— 主界面四个入口的业务（纯函数，不碰引擎）
 * ============================================================================
 *
 * 灶台决定下一趟的火力，工作台把材料变成灶台和派遣要用的东西，
 * 派遣让留在家里的宠物把资源带回来，摸头攒的点数就是图鉴上的心。
 *
 * 不 import `cc`。时间由调用方传入，测试不用真的等。
 */

import { PETS, unlockedPets } from './Roster';
import { STAGE_COUNT } from './Stages';
import type { SaveState } from './SaveData';

/** 5 点一颗心，和主界面规格里「连摸 5 次亲密度 +1」一致 */
export const PATS_PER_HEART = 5;
export const MAX_HEARTS = 5;
/** 一趟采集要这么多秒。最多攒 10 趟，第十趟之后待着也不多给 */
export const DISPATCH_SEC = 60;
export const DISPATCH_CAP = 10;
/**
 * 满一趟派遣（攒满 `DISPATCH_CAP` 趟）给几个图纸碎片。
 *
 * **这是派遣唯一的独占产出**（2026-10-25）。在它之前，派遣的四样产出
 * （果 / 材 / 币 / 干粮）战斗全给，而且快 7 倍（10 果/分 vs 72 果/分），
 * 所以它永远只是"打不动游戏的时候才点"。
 * 碎片只能派宠物去捡 —— 一件改造件要 2 个，就是"想装下一件，先去等一趟"。
 */
export const DISPATCH_SHARD = 2;

/* ---- 能量门禁已移除（2026-10-22） ----
 *
 * 原来：`ENERGY_MAX 100 / COST 20 / REGEN 18s` —— 打 5 趟要等 6 分钟，
 * 而且按离线时间戳结算，关掉游戏也在计时。
 *
 * **这是手游留存模型**（靠内购 / 广告变现，用等待制造回访），
 * 用在买断制上是纯粹的差评来源：8 关需要 8 趟，玩家必然被拦一次，
 * 而且大概率拦在"下一只宠物快解锁了"的地方。
 *
 * 现在：出门不再有次数限制。节奏由**饱食度**承担 —— 它每屏掉
 * `BELLY_PER_CLEAR`（真值在 `grove.html`，**这里不写数字** —— 原来写死 −16
 * 而实际是 20，按 16 算会把喂饭频率少算 27%），
 * 饿了火力下降，喂一顿要花果子，这条链是"经营"，不是"等待"。
 * 少一道时间门，玩家少一个"我花钱买的游戏它凭什么不让我玩"的瞬间。 */

/** 在家时会说的那句。和战斗门口的性格是同一批话 */
export const PET_LINE: Record<string, string> = {
    'sugar-stand': '哼。',
    'nian-gao-dog': '我也想去……',
    'tuan-zi-ham': '路上有吃的吗？',
    'xue-tuan-rab': '……好吧。',
    'dou-nai-ox': '慢慢走也到得了。',
    'xing-xie-fox': '天黑才好办事。',
};

export interface MealDef {
    id: string;
    name: string;
    apples: number;
    logs: number;
    /** 消耗背包里的干粮，不扣果子 */
    ration: number;
    sat: number;
    /** 加在出战那只身上的亲密度点数 */
    bond: number;
}

export const MEALS: ReadonlyArray<MealDef> = [
    { id: 'fruit', name: '野果', apples: 8, logs: 0, ration: 0, sat: 22, bond: 1 },
    { id: 'stew', name: '热汤', apples: 16, logs: 1, ration: 0, sat: 48, bond: 2 },
    { id: 'ration', name: '干粮', apples: 0, logs: 0, ration: 1, sat: 35, bond: 1 },
];

export interface RecipeDef {
    id: string;
    name: string;
    apples: number;
    logs: number;
    coins: number;
    /** 做出来放进背包的哪一格 */
    give: 'ration' | 'basket';
}

export const RECIPES: ReadonlyArray<RecipeDef> = [
    { id: 'ration', name: '干粮', apples: 10, logs: 2, coins: 0, give: 'ration' },
    { id: 'basket', name: '收集篮', apples: 0, logs: 5, coins: 1, give: 'basket' },
];

/* ============================================================================
   ★ 改造件（perk）—— 全游戏唯一的"永久变强"出口
   ----------------------------------------------------------------------------
   **不做这个，后面所有奖励都是空的。** 审计事实：
     · `RECIPES` 只有 `ration`（吃了就没）和 `basket`（一次性）；
     · `MEALS` 三条全是消耗品；
     · 评级 S/A/B 只落盘，不给任何东西（`S.best[i]` 只用于挑一屏显示）。
   → 玩家第 1 小时和第 10 小时能力完全相同。赚到的东西只能换成
     "继续赚的燃料"，赚不到"更强"。这是循环（loop），不是螺旋（spiral）。

   **价格是算出来的，不是拍的。** 实测数据（`tools/_t-econ.js`，27 屏，
   hero=2、每屏独立环境、hp 999 与 ALL9 同口径）：

     单屏收成        平均 47.3 果（达标 14 屏的范围 31~64）
     一趟最多走      5 屏（满饱 100 / 每屏 20）
     一趟果子产出    290 果（47.3 × 5 × 1.225 连锁倍率）
     一趟材料产出    5 个（`logs = stages`，代码事实）
     一趟喂饭成本    40 果（5 份野果 × 8 果）

   定价 180 果 + 4 材料，卡住三件事：
     · 180 × 2 = 360 > 290 → **一趟买不到第二个**（这是"取舍"成立的前提）
     · 180 + 40 喂饭 = 220 < 290 → 买完还够吃饭，不会因为买改造件饿死
     · 4 <= 5 → 走满一趟才够，**"贪到底"成为买改造件的前提**
   改价格前请先重跑 `_t-econ.js`，不要凭印象调。

   **四件全部同价**：让"选哪件"变成纯价值比较，不被价格干扰。
   ============================================================================ */

export interface PerkDef {
    id: string;
    name: string;
    /** 一句话效果。玩家靠这行字决定买哪件，必须写具体数字 */
    desc: string;
    apples: number;
    logs: number;
    /**
     * 图纸碎片 —— **只能派遣拿到**（2026-10-25）。
     *
     * 加这一项是为了给派遣一个真·独占产出。审计事实：派遣效率
     * 10 果/分 vs 战斗 72 果/分 = **1/7**，而且果/材/币/干粮四样战斗全给更多，
     * 所以它在玩家眼里永远是"打不动游戏的时候才点"。
     * 碎片战斗打不出来 —— 想装下一件，只能派宠物去捡。
     *
     * 数值：2 个 / 件，而满一趟派遣（10 分钟）正好给 2 个。
     * 不叠到 180 果 + 4 材那两条上：那两条管"一趟买不到第二个"和"走满才够"，
     * 碎片管的是"你得等一次派遣"。三个约束各管一件事，互不冲突。
     */
    shards: number;
}

/**
 * 四件改造件。`id` 必须和 `grove.html` 的 `PERK_IDS` 逐字相等 ——
 * 两边各写一份是必然的（一个 TS 一个内联脚本），所以冒烟加了对齐断言。
 * 改这里必须同步改那边，否则买到的改造件在战斗里静默无效。
 */
export const PERKS: ReadonlyArray<PerkDef> = [
    /* 收益型：把"烧球换双份"从"持平"变成"明显赚"。
       火坑 = 每只 2，落袋 = 每只 1 + 球钱 1。装 1 只时两者都是 2 分，
       所以火坑在旧规则下**没有溢价**（这是读代码得出的，不是估的）。
       x3 之后装 1 只就有 3 分，火坑第一次成为一个"流派"。 */
    { id: 'hotpit', name: '火坑炽热', desc: '火坑每只 2 分 → 3 分', apples: 180, logs: 4, shards: 2 },
    /* 资源型：直接解"球不够"。对额度关最有用，对无限球关完全无用 ——
       所以它不是"更强的选择"，是"特定屏更强的选择"。
       四件必须**不可比**，否则玩家永远只买一件。 */
    { id: 'wideball', name: '加宽球路', desc: '每屏球额度 +1', apples: 180, logs: 4, shards: 2 },
    /* 续航型：一趟 5 屏 → 6 屏。不提升任何单屏能力，只延长"贪"的长度。
       它的价值随玩家水平上升 —— 打得越好越值，这是唯一的"成长型"改造件。 */
    { id: 'thrift', name: '精打细算', desc: '每屏掉饱 20 → 15（一趟多走一屏）', apples: 180, logs: 4, shards: 2 },
    /* 结算型：清场奖励 3 → 28。对"清场"目标直接有用，
       对"限球""连锁"这类本来就不清场的屏几乎无用。 */
    { id: 'bounty', name: '悬赏清场', desc: '清场奖励 3 分 → 28 分', apples: 180, logs: 4, shards: 2 },
];

export function perkDef(id: string): PerkDef | null {
    return PERKS.find((p) => p.id === id) || null;
}

export function perkOwned(s: SaveState, id: string): boolean {
    return Array.isArray(s.perks) && s.perks.indexOf(id) >= 0;
}

export function buyPerk(prev: SaveState, id: string): ActResult {
    const def = perkDef(id);
    if (!def) return { ok: false, say: '没有这个改造件' };
    if (perkOwned(prev, id)) return { ok: false, say: `已经装过「${def.name}」了` };
    if (prev.apples < def.apples) {
        return { ok: false, say: `果子不够 · 还差 ${def.apples - prev.apples}` };
    }
    if (prev.logs < def.logs) {
        return { ok: false, say: `材料不够 · 还差 ${def.logs - prev.logs}` };
    }
    if ((prev.shards || 0) < def.shards) {
        return { ok: false, say: `图纸碎片不够 · 还差 ${def.shards - (prev.shards || 0)} · 派宠物去采` };
    }
    const next = clone(prev);
    next.apples -= def.apples;
    next.logs -= def.logs;
    next.shards = (prev.shards || 0) - def.shards;
    next.perks = Array.isArray(prev.perks) ? prev.perks.slice() : [];
    next.perks.push(id);
    return { ok: true, next, say: `装上「${def.name}」· ${def.desc}` };
}

/**
 * 每趟带回的量。种类跟这只平时干的活一致。
 *
 * **`ration`（干粮）这一格是"派遣到底有什么用"的答案。**
 * 改造前派遣只给果子 / 材料 / 吧唧 —— 那三样战斗一局就给，而且给得更多。
 * 于是"派一只出去等 30 秒收 30 个果子"在玩家眼里完全不如"再打一局"，
 * 派遣就成了一个占位按钮。
 *
 * 现在把**干粮**接进来：干粮是灶台直接吃的东西（不扣果子），
 * 而饱食度每屏都在掉（见 `BELLY_PER_CLEAR`）、饿了火力下降 —— 于是
 *   派遣 → 干粮 → 肚子 → 战力
 * 是一条**别的系统补不上**的链：干粮在工坊里要花果子+材料做，
 * 让宠物自己去捡，就省下了那笔开销。
 */
const YIELD: Record<string, { apples: number; logs: number; coins: number; ration: number }> = {
    'sugar-stand': { apples: 10, logs: 0, coins: 0, ration: 0 },
    'nian-gao-dog': { apples: 0, logs: 4, coins: 0, ration: 1 },
    'tuan-zi-ham': { apples: 6, logs: 0, coins: 1, ration: 2 },
    'xue-tuan-rab': { apples: 6, logs: 2, coins: 0, ration: 1 },
    'dou-nai-ox': { apples: 0, logs: 6, coins: 0, ration: 1 },
    'xing-xie-fox': { apples: 4, logs: 0, coins: 2, ration: 1 },
};

/** 一只宠物**一趟**能带回什么。派遣面板的"产出预期"和收成结算读同一张表 —— 
 *  写两份的话，面板上写着"干粮 2"，收回来只有 1，玩家只会觉得被骗。 */
export function yieldOf(id: string): { apples: number; logs: number; coins: number; ration: number } {
    return YIELD[id] || { apples: 6, logs: 2, coins: 0, ration: 1 };
}

/** 一趟收益的一行文案（面板里反复用，免得每处各写一套拼接） */
export function yieldText(id: string): string {
    const y = yieldOf(id);
    const bits = [];
    if (y.ration) bits.push(`干粮 ${y.ration}`);
    if (y.apples) bits.push(`果子 ${y.apples}`);
    if (y.logs) bits.push(`材料 ${y.logs}`);
    if (y.coins) bits.push(`吧唧 ${y.coins}`);
    /* 碎片按"满一趟给几个"写，不按"每趟"—— 它走的是除法，不是乘法。
       写成"图纸碎片 0.2 / 趟"会让人以为有小数。 */
    return (bits.join(' · ') || '空手') + ' / 趟';
}

export type ActResult =
    | { ok: true; next: SaveState; say: string }
    | { ok: false; say: string };

export interface DispatchPreview {
    hauls: number;
    /** 离下一趟还差的秒数。已经收满 cap 趟时是 0 */
    left: number;
    apples: number;
    logs: number;
    coins: number;
    /** 干粮。它是这条链真正值钱的东西（见 YIELD 上面那段） */
    ration: number;
    /**
     * 图纸碎片。**派遣独占产出** —— 面板上必须写出来，
     * 否则玩家看不出"为什么这件事非得派人去，不能自己打"。
     * 算法在 `peekDispatch` 里，`collectDispatch` 读同一个值（唯一真值）。
     */
    shards: number;
    /** 还差多少秒到 cap（玩家问"我还能不能先去打一局再来收"） */
    toFull: number;
}

export function heartsOf(pats: number): number {
    const n = Math.max(0, Math.floor(pats));
    return Math.min(MAX_HEARTS, Math.floor(n / PATS_PER_HEART));
}

/**
 * 亲密度的文字表达。
 *
 * **不要用 `♡`（空心心）画那一排。** 这个字形不在中文字体里，靠系统字体兜底 ——
 * 图鉴上那整排方块就是这么来的（`♥♥□□□ 摸 12`）。实心 `♥` 有字形，
 * 但一排全实心又看不出"还差几颗"。所以这里直接给数字：
 * "亲密度 2 / 5" 信息量完全等价，而且不可能缺字形。
 *
 * 主界面出战卡上那排心仍然用图形（`hearts-on` / `hearts-off` 两个 Label
 * 用不同颜色画同一批 `♥`）—— 那里要的是"扫一眼的形状"，不是读数字。
 */
export function heartText(pats: number): string {
    return `亲密度 ${heartsOf(pats)} / ${MAX_HEARTS}`;
}

function clone(s: SaveState): SaveState {
    return {
        ...s,
        pats: { ...s.pats },
        bag: { ...s.bag },
        settings: { ...s.settings },
        dispatch: s.dispatch ? { ...s.dispatch } : null,
        claimed: s.claimed.slice(),
        /* 旧存档没有 perks 字段（本批才加）。深拷贝时兜底成空数组，
           否则 `next.perks.push()` 会在 undefined 上炸。 */
        perks: Array.isArray(s.perks) ? s.perks.slice() : [],
        tripGoals: Array.isArray(s.tripGoals) ? s.tripGoals.slice() : [],
    };
}

function petName(id: string): string {
    const p = PETS.find((x) => x.id === id);
    return p ? p.name : '它';
}

export function recordPat(prev: SaveState, id: string): ActResult {
    const pet = PETS.find((p) => p.id === id);
    if (!pet) return { ok: false, say: '它不在家' };
    const next = clone(prev);
    const before = heartsOf(next.pats[id] || 0);
    next.pats[id] = (next.pats[id] || 0) + 1;
    const after = heartsOf(next.pats[id]);
    const line = PET_LINE[id] || '……';
    if (after > before) {
        return { ok: true, next, say: `${pet.name} · 亲密度 +1 · ${line}` };
    }
    if (after >= MAX_HEARTS) {
        return { ok: true, next, say: `${pet.name} · ${line}` };
    }
    const into = next.pats[id] % PATS_PER_HEART;
    const rest = into === 0 ? PATS_PER_HEART : PATS_PER_HEART - into;
    return { ok: true, next, say: `${pet.name} · ${line}（再摸 ${rest} 次更亲）` };
}

/**
 * 换出战宠 —— 底部那六个槽点下去就是这一句。
 *
 * **这是"解锁了但进战斗只有一只"那条链的最后一环。** 在那之前：
 * 底部槽位点击只弹一句 toast（"待解锁出战位"），`save.active` 永远是开局那只，
 * 于是 `launchBattle` 带出门的永远是同一只 —— 玩家看不出解锁有什么用。
 *
 * 三道门禁都不是形式：
 *   · 没到家的不能选（否则点一下就能带还没解锁的）；
 *   · 正在外面采集的不能选（`dispatch.id` 那只不在家，草地上也确实是空的）；
 *   · 已经选中的再点一次就明说，不要静默 no-op —— 玩家会以为点不动是 bug。
 *
 * 不返回错误码而是 ok:false + 一句话：调用方统一 `toast(r.say)`，
 * 一处文案口径，不会出现"面板说 A、提示说 B"。
 */
export function setActive(prev: SaveState, id: string): ActResult {
    const pet = PETS.find((p) => p.id === id);
    if (!pet) return { ok: false, say: '没有这只' };
    if (prev.cleared < pet.at) {
        return { ok: false, say: `${pet.name} 还差 ${pet.at - prev.cleared} 关才回家` };
    }
    if (prev.dispatch && prev.dispatch.id === id) {
        return { ok: false, say: `${pet.name} 正在外面采集，${DISPATCH_SEC} 秒一趟` };
    }
    if (prev.active === id) return { ok: false, say: `${pet.name} 已经是这趟的伙伴了` };

    const next = clone(prev);
    next.active = id;
    /* 饱食度是**每只自己的**吗？现在不是 —— 存档里只有一个 satiety 字段，
       它跟着"出战那只"走。换人时不去动它，因为饿的是队伍不是某一只；
       真按只算需要给 SaveState 加一张表，那是另一件事（记在待办）。 */
    return { ok: true, next, say: `这趟带 ${pet.name} 出门 · 招式「${pet.tag}」` };
}

export function feed(prev: SaveState, mealId: string): ActResult {
    const meal = MEALS.find((m) => m.id === mealId);
    if (!meal) return { ok: false, say: '没有这道吃的' };
    if (prev.satiety >= 100) return { ok: false, say: '已经吃饱了，留着出门再消耗' };
    if (prev.apples < meal.apples) return { ok: false, say: `果子不够 · 还差 ${meal.apples - prev.apples}` };
    if (prev.logs < meal.logs) return { ok: false, say: `材料不够 · 还差 ${meal.logs - prev.logs}` };
    if (prev.bag.ration < meal.ration) return { ok: false, say: '没有干粮 · 去工作台做一份' };
    const next = clone(prev);
    next.apples -= meal.apples;
    next.logs -= meal.logs;
    next.bag.ration -= meal.ration;
    next.satiety = Math.min(100, next.satiety + meal.sat);
    next.feeds += 1;
    const id = next.active;
    const before = heartsOf(next.pats[id] || 0);
    next.pats[id] = (next.pats[id] || 0) + meal.bond;
    const up = heartsOf(next.pats[id]) - before;
    const heart = up > 0 ? ` · 亲密度 +${up}` : '';
    return {
        ok: true,
        next,
        say: `${petName(id)} 吃了${meal.name} · 饱食 ${Math.round(next.satiety)}${heart}`,
    };
}

export function craft(prev: SaveState, recipeId: string): ActResult {
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return { ok: false, say: '没有这张配方' };
    if (prev.apples < recipe.apples) return { ok: false, say: `果子不够 · 还差 ${recipe.apples - prev.apples}` };
    if (prev.logs < recipe.logs) return { ok: false, say: `材料不够 · 还差 ${recipe.logs - prev.logs}` };
    if (prev.coins < recipe.coins) return { ok: false, say: `吧唧不够 · 还差 ${recipe.coins - prev.coins}` };
    const next = clone(prev);
    next.apples -= recipe.apples;
    next.logs -= recipe.logs;
    next.coins -= recipe.coins;
    next.bag[recipe.give] += 1;
    next.crafts += 1;
    const where = recipe.give === 'ration' ? '拿到灶台就能吃' : '收回派遣时产量多一半';
    return { ok: true, next, say: `做好了${recipe.name} · ${where}` };
}

export function peekDispatch(prev: SaveState, now: number): DispatchPreview {
    const empty = { hauls: 0, left: 0, apples: 0, logs: 0, coins: 0, ration: 0, shards: 0, toFull: 0 };
    const job = prev.dispatch;
    if (!job) return empty;
    const y = YIELD[job.id] || { apples: 6, logs: 2, coins: 0, ration: 1 };
    const elapsed = Math.max(0, now - job.since) / 1000;
    const hauls = Math.min(DISPATCH_CAP, Math.floor(elapsed / DISPATCH_SEC));
    const mul = prev.bag.basket > 0 ? 1.5 : 1;
    const scale = (n: number) => Math.floor(n * hauls * mul);
    const left = hauls >= DISPATCH_CAP ? 0 : Math.max(1, Math.ceil(DISPATCH_SEC - (elapsed % DISPATCH_SEC)));
    const toFull = hauls >= DISPATCH_CAP
        ? 0
        : Math.max(0, Math.ceil(DISPATCH_CAP * DISPATCH_SEC - elapsed));
    return {
        hauls,
        left,
        apples: scale(y.apples),
        logs: scale(y.logs),
        coins: scale(y.coins),
        ration: scale(y.ration),
        /* 碎片**不吃收集篮倍率**：篮子是"多装点东西"，不是"多找到一张图纸"。
           而且吃了倍率就会出现 floor(2×1.5)=3，一件改造件一趟就够，独占价值当场消失。 */
        shards: Math.floor((hauls * DISPATCH_SHARD) / DISPATCH_CAP),
        toFull,
    };
}

export function startDispatch(prev: SaveState, id: string, now: number): ActResult {
    if (prev.dispatch) return { ok: false, say: '已经有一只在外面，先收回来' };
    const pet = PETS.find((p) => p.id === id);
    if (!pet) return { ok: false, say: '没有这只' };
    if (prev.cleared < pet.at) return { ok: false, say: `${pet.name} 还没回家` };
    if (unlockedPets(prev.cleared).length < 2) return { ok: false, say: '家里只有一只，先去苔原带同伴回来' };
    if (id === prev.active) return { ok: false, say: `${pet.name} 这趟要跟你出门` };
    const next = clone(prev);
    next.dispatch = { id, since: now };
    return {
        ok: true,
        next,
        say: `${pet.name} 出门了 · ${DISPATCH_SEC} 秒一趟，最多攒 ${DISPATCH_CAP} 趟`,
    };
}

export function collectDispatch(prev: SaveState, now: number): ActResult {
    if (!prev.dispatch) return { ok: false, say: '没有派出去的宠物' };
    const name = petName(prev.dispatch.id);
    const peek = peekDispatch(prev, now);
    if (peek.hauls < 1) return { ok: false, say: `${name} 还要 ${peek.left} 秒才攒满一趟` };
    const next = clone(prev);
    next.apples += peek.apples;
    next.logs += peek.logs;
    next.coins += peek.coins;
    next.bag.ration += peek.ration;
    next.shards = (next.shards || 0) + peek.shards;
    const usedBasket = next.bag.basket > 0;
    if (usedBasket) next.bag.basket -= 1;
    next.dispatch = null;
    next.dispatches += 1;
    const bits = [];
    if (peek.apples) bits.push(`果子 ${peek.apples}`);
    if (peek.logs) bits.push(`材料 ${peek.logs}`);
    if (peek.coins) bits.push(`吧唧 ${peek.coins}`);
    if (peek.ration) bits.push(`干粮 ${peek.ration}`);
    if (peek.shards) bits.push(`图纸碎片 ${peek.shards}`);
    const basket = usedBasket ? ' · 收集篮用掉了' : '';
    return {
        ok: true,
        next,
        say: `${name} 带回 ${bits.join(' · ') || '空手'}${basket}`,
    };
}

export function toggleMute(prev: SaveState): ActResult {
    const next = clone(prev);
    next.settings = { ...next.settings, mute: !next.settings.mute };
    return { ok: true, next, say: next.settings.mute ? '音效已关（本版还没有声音，开关会记住）' : '音效已开' };
}

export function toggleCrisp(prev: SaveState): ActResult {
    const next = clone(prev);
    next.settings = { ...next.settings, crisp: !next.settings.crisp };
    return { ok: true, next, say: next.settings.crisp ? '画质 · 清晰' : '画质 · 流畅' };
}

/* `settleEnergy` / `spendEnergy` 随能量门禁一起删除（见文件头部那段）。
   调用方现在直接进战斗 —— `launchBattle()` 里不再有 paid.ok 分支。 */

export interface RunPayout {
    apples: number;
    logs: number;
    coins: number;
    /**
     * 本趟目标给的图纸碎片（2026-10-25）。
     * 不传 / 0 = 老调用方行为完全不变（那时候还没有"本趟目标"）。
     */
    shards?: number;
}

/** 战斗收工时带回家的那一份。收工吃倍率后的果子；中途退出只按已经攒下的算 */
export function payoutFromRun(input: {
    kind: string;
    lastLoot: number;
    lastStages: number;
    tripLoot: number;
    tripStages: number;
    food: number;
    /**
     * 评级给的材料（S=3 / A=2 / B=1，**只在首次达成或刷新纪录时累计**）。
     *
     * 为什么走这条路而不是战斗侧直接写存档：这一趟的账只有一个出口，
     * 中途退出也只按已经攒下的算。评级奖励如果自己写一份存档，
     * 就会出现"退出时果子按一套算、材料按另一套算"，两条口径必然漂移
     * （MEMORY 教训 2：同一件事存两份 = 必然漂移）。
     *
     * 缺省 0：老调用方（没有评级概念的那几屏）行为完全不变。
     */
    rankLogs?: number;
    /**
     * 本趟目标达成的碎片。和 `rankLogs` 一样，**必须走这一个出口**：
     * 目标奖励如果自己写一份存档，就会和果子的账分叉
     * （MEMORY 教训 2：同一件事存两份 = 必然漂移）。
     */
    goalShards?: number;
    /** 本趟目标达成的材料。和 goalShards 一起并进 `logs` */
    goalLogs?: number;
}): RunPayout {
    const banked = input.kind === 'esc'
        ? Math.round((input.tripLoot || 0) + (input.food || 0))
        : Math.round(input.lastLoot || 0);
    const stages = input.kind === 'esc' ? (input.tripStages || 0) : (input.lastStages || 0);
    return {
        apples: Math.max(1, banked),
        logs: Math.max(0, stages)
            + Math.max(0, Math.round(input.rankLogs || 0))
            + Math.max(0, Math.round(input.goalLogs || 0)),
        coins: stages >= 2 ? 1 : 0,
        shards: Math.max(0, Math.round(input.goalShards || 0)),
    };
}

export function applyRunReward(prev: SaveState, payout: RunPayout): SaveState {
    const next = clone(prev);
    next.apples += payout.apples;
    next.logs += payout.logs;
    next.coins += payout.coins;
    next.shards = (next.shards || 0) + (payout.shards || 0);
    next.runs += 1;
    const bits = [`果子 +${payout.apples}`];
    if (payout.logs > 0) bits.push(`材料 +${payout.logs}`);
    if (payout.coins > 0) bits.push(`吧唧 +${payout.coins}`);
    if ((payout.shards || 0) > 0) bits.push(`碎片 +${payout.shards}`);
    next.lastReward = `这一趟带回 ${bits.join(' · ')}`;
    return next;
}

/* ============================================================================
   ★ 本趟目标 —— 替换掉原来那 6 条「一次性任务」（2026-10-25）
   ----------------------------------------------------------------------------
   病根（用户说了三次）：「任务是一次性的 完成了 后面再也不用完成了 怎么玩？」

   查代码确认他说的全是事实：
     · 6 条任务 `target` **全部 = 1**；
     · 条件全是"玩着玩着就自动满足"（跑过一次 / 喂过一次 / 做过一份 / 通关 1 关）；
     · `claimed` 是只增不减的数组，领完永久消失；
     · 总奖励 71 果 ≈ **1.5 屏收入**（一屏平均 47.3）。

   → 玩家零决策，它读起来像新手引导的残留，不像一个系统。
   把 target 从 1 改成 3、加个"每日刷新"，只是把"自动完成一次"变成"自动完成 N 次"，
   还是零决策。**所以不是调数值，是换结构。**

   新结构：**每趟出门抽 2 条「本趟条件」，趟结束失效。**
     · 它不是清单，是"这一趟怎么打"的约束；
     · 抽签保证每趟不一样 —— 玩家没法用同一套打法过完 27 屏；
     · 完不成**不惩罚**（红线：不做失败惩罚），只是拿不到奖励；
     · 奖励给碎片 / 材料，**不给果子**（果子实测通胀 6.5×）。

   判定全部用 `S.stat` 里**已经存在**的字段，不新增战斗统计 ——
   加新统计意味着 `updateBalls` 和 `checkGoal` 两条路都要动，风险远超收益。
   ============================================================================ */

export interface TripGoalDef {
    id: string;
    name: string;
    /** 一句话条件。玩家要在**出发前**就读懂，所以必须写具体 */
    desc: string;
    /** 达成的奖励。碎片是最值钱的（只有派遣和这里能拿） */
    shards: number;
    logs: number;
}

export const TRIP_GOALS: ReadonlyArray<TripGoalDef> = [
    {
        id: 'nofire', name: '不碰火坑', desc: '一趟下来一次火坑都没用',
        shards: 2, logs: 0,
    },
    {
        id: 'bigchain', name: '大打卷', desc: '至少一次让一颗球卷进 3 只',
        shards: 0, logs: 2,
    },
    {
        id: 'nohit', name: '一毛不拔', desc: '一趟下来一次都没被打到',
        shards: 2, logs: 0,
    },
    {
        id: 'nolost', name: '一只不丢', desc: '一趟下来没有球滚出屏幕',
        shards: 0, logs: 2,
    },
    {
        id: 'noshell', name: '壳不破', desc: '一趟下来冰壳没被打破过',
        shards: 0, logs: 2,
    },
];

/** 一趟抽几条。2 条是算过的：3 条会互相打架（"不用火坑"+"卷 3 只"在窄屏上直接死锁） */
export const TRIP_PICK = 2;

/** 判定要用的战斗统计。**字段名必须和 `grove.html` 的 `S.stat` 逐字相等** */
export interface TripStat {
    burned: number;
    maxHolds: number;
    hits: number;
    lost?: number;
    burst: number;
    made: number;
}

const TRIP_CHECK: Record<string, (s: TripStat) => boolean> = {
    /* `made > 0` 是必须的：不打球就没有"用没用火坑"可言，
       不判这一条的话，"全程站着不动"也能拿"不碰火坑"。 */
    nofire: (s) => s.made > 0 && s.burned === 0,
    bigchain: (s) => s.maxHolds >= 3,
    /* 同上：一球不打也不会被打到 */
    nohit: (s) => s.made > 0 && s.hits === 0,
    nolost: (s) => s.made > 0 && (s.lost || 0) === 0,
    noshell: (s) => s.made > 0 && s.burst === 0,
};

/**
 * 抽这一趟的目标。不重复，顺序稳定（先按 id 排序再洗，测试可复现）。
 * @param rng 随机源，默认 `Math.random`。测试传固定种子就能断言"抽到哪两条"。
 */
export function rollTripGoals(rng: () => number = Math.random): string[] {
    const pool = TRIP_GOALS.map((g) => g.id);
    for (let i = pool.length - 1; i > 0; i--) {
        const k = Math.floor(rng() * (i + 1));
        const t = pool[i]; pool[i] = pool[k]; pool[k] = t;
    }
    return pool.slice(0, Math.min(TRIP_PICK, pool.length));
}

/** 判定这一趟达成了哪几条。返回达成目标的完整定义（结算卡要拿它写文案） */
export function judgeTripGoals(ids: string[], stat: TripStat): TripGoalDef[] {
    const out: TripGoalDef[] = [];
    if (!Array.isArray(ids)) return out;
    for (const id of ids) {
        const def = TRIP_GOALS.find((g) => g.id === id);
        const fn = TRIP_CHECK[id];
        if (!def || !fn) continue;
        if (fn(stat)) out.push(def);
    }
    return out;
}

/** 这一趟目标的奖励合计。结算时并进 `payoutFromRun`，和果子的账同一个出口 */
export function tripReward(met: ReadonlyArray<TripGoalDef>): { shards: number; logs: number } {
    let shards = 0;
    let logs = 0;
    for (const g of met) { shards += g.shards; logs += g.logs; }
    return { shards, logs };
}

/** 某条目标的定义（面板按 id 取文案） */
export function tripGoal(id: string): TripGoalDef | null {
    return TRIP_GOALS.find((g) => g.id === id) || null;
}

/** 派遣面板上，这只能不能派（跟你出门的那只、还没回家的，都不能） */
export function canDispatch(prev: SaveState, id: string): boolean {
    const pet = PETS.find((p) => p.id === id);
    if (!pet || prev.cleared < pet.at) return false;
    if (unlockedPets(prev.cleared).length < 2) return false;
    if (id === prev.active) return false;
    if (prev.dispatch) return false;
    return true;
}

/* ============================================================================
   ★ 战绩（2026-10-25）
   ----------------------------------------------------------------------------
   病理：`S.best` 从有评级那天起就在落盘，**但没有任何地方消费它**。
   27 屏打完，玩家手上只有一个"进度 27 / 27" —— 那回答不了"我打得多好"，
   因为所有人最终都是 27。

   总星数是这个游戏唯一一个**单调可比**的数：
     S=3 / A=2 / B=1 / 未通=0，满分 27×3 = 81。

   为什么不用"最快用时"当主指标：单屏用时可以靠"不打死怪直接跑"刷（1 秒通关），
   而总星数要求**用时达 par 且 用球达 par**两条同时满足（见 `grove.html` 的 `rate()`），
   刷不出来。用时只适合当单项纪录，不适合当主分数。
   ============================================================================ */

/** 评级 → 星数。键必须和 `grove.html` 的 `S.best` 取值逐字相等 */
export const STAR_OF: Record<string, number> = { S: 3, A: 2, B: 1 };
/** 满分：27 屏 × 3 星 */
export const STAR_MAX = STAGE_COUNT * 3;

/** 总星数。**只认白名单里的三个字母** —— 存档是外部输入，`"SSS"` 不能变成 9 分 */
export function starsOf(s: SaveState): number {
    let n = 0;
    const arr = Array.isArray(s.best) ? s.best : [];
    for (let i = 0; i < STAGE_COUNT; i++) n += STAR_OF[arr[i] as string] || 0;
    return n;
}

/** 四档统计：S / A / B / 还没通。战绩面板用它画一条分布 */
export function rankCount(s: SaveState): { s: number; a: number; b: number; none: number } {
    const arr = Array.isArray(s.best) ? s.best : [];
    const o = { s: 0, a: 0, b: 0, none: 0 };
    for (let i = 0; i < STAGE_COUNT; i++) {
        const v = arr[i];
        if (v === 'S') o.s++;
        else if (v === 'A') o.a++;
        else if (v === 'B') o.b++;
        else o.none++;
    }
    return o;
}

/** 全 S 的屏数。它是"完美主义"那一条线的进度，比总星数更硬 */
export function perfectCount(s: SaveState): number {
    return rankCount(s).s;
}

/** 总星数落在哪一档。面板上给一句人话，不给玩家算百分比 */
export function starsTitle(n: number): string {
    if (n >= STAR_MAX) return '满星 · 全部打成了最好';
    if (n >= STAR_MAX * 0.75) return '已成气候';
    if (n >= STAR_MAX * 0.5) return '走了一半';
    if (n > 0) return '刚起步';
    return '还没有记录';
}
