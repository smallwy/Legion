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
import type { SaveState } from './SaveData';

/** 5 点一颗心，和主界面规格里「连摸 5 次亲密度 +1」一致 */
export const PATS_PER_HEART = 5;
export const MAX_HEARTS = 5;
/** 一趟采集要这么多秒。最多攒 10 趟，第十趟之后待着也不多给 */
export const DISPATCH_SEC = 60;
export const DISPATCH_CAP = 10;

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
    const empty = { hauls: 0, left: 0, apples: 0, logs: 0, coins: 0, ration: 0, toFull: 0 };
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
    const usedBasket = next.bag.basket > 0;
    if (usedBasket) next.bag.basket -= 1;
    next.dispatch = null;
    next.dispatches += 1;
    const bits = [];
    if (peek.apples) bits.push(`果子 ${peek.apples}`);
    if (peek.logs) bits.push(`材料 ${peek.logs}`);
    if (peek.coins) bits.push(`吧唧 ${peek.coins}`);
    if (peek.ration) bits.push(`干粮 ${peek.ration}`);
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
}

/** 战斗收工时带回家的那一份。收工吃倍率后的果子；中途退出只按已经攒下的算 */
export function payoutFromRun(input: {
    kind: string;
    lastLoot: number;
    lastStages: number;
    tripLoot: number;
    tripStages: number;
    food: number;
}): RunPayout {
    const banked = input.kind === 'esc'
        ? Math.round((input.tripLoot || 0) + (input.food || 0))
        : Math.round(input.lastLoot || 0);
    const stages = input.kind === 'esc' ? (input.tripStages || 0) : (input.lastStages || 0);
    return {
        apples: Math.max(1, banked),
        logs: Math.max(0, stages),
        coins: stages >= 2 ? 1 : 0,
    };
}

export function applyRunReward(prev: SaveState, payout: RunPayout): SaveState {
    const next = clone(prev);
    next.apples += payout.apples;
    next.logs += payout.logs;
    next.coins += payout.coins;
    next.runs += 1;
    const bits = [`果子 +${payout.apples}`];
    if (payout.logs > 0) bits.push(`材料 +${payout.logs}`);
    if (payout.coins > 0) bits.push(`吧唧 +${payout.coins}`);
    next.lastReward = `这一趟带回 ${bits.join(' · ')}`;
    return next;
}

/** 奖励的一件：图标 key + 数量。面板按这个画"图标 + 数字"，不解析中文 */
export interface TaskReward {
    kind: 'apple' | 'log' | 'coin';
    n: number;
}

export interface TaskDef {
    id: string;
    name: string;
    desc: string;
    reward: string;
    /** 任务图标（`resources/ui/icons/<icon>.png`）。没有图时面板退回首字圆 */
    icon: string;
    /**
     * 当前进度。**和 `ready` 同源** —— `ready` 由 `mkTask` 用 `cur >= target` 生成，
     * 不允许各写一套。改之前是 `ready: (s) => s.runs >= 1` 一句话，
     * 界面想显示"打了几次"就得再写一遍判定，两处迟早漂移
     * （症状：界面显示 1/1 却点不动，或 0/1 却已经能领）。
     */
    cur: (s: SaveState) => number;
    target: number;
    /** 结构化奖励。`reward` 那个字符串只留给 toast 文案，不参与绘制 */
    rewardList: TaskReward[];
    ready: (s: SaveState) => boolean;
    grant: (s: SaveState) => void;
}

/** 造一条任务：`ready` 从 `cur/target` 推出来，唯一真值 */
function mkTask(t: Omit<TaskDef, 'ready'>): TaskDef {
    return { ...t, ready: (s) => t.cur(s) >= t.target };
}

export const TASKS: ReadonlyArray<TaskDef> = [
    mkTask({
        /* 任务奖励里的"能量 +X"全部换成了实际资源 —— 能量门禁删了之后，
           再发能量就是发一个没人用的数字，等于奖励是空的。
           换的标准：**每件任务给的东西要能立刻花出去**（喂饭/做东西/买东西）。 */
        id: 'out', name: '出门一趟', desc: '打完回来一次',
        reward: '果子 +12 · 材料 +2',
        icon: 'flag',
        cur: (s) => s.runs, target: 1,
        rewardList: [{ kind: 'apple', n: 12 }, { kind: 'log', n: 2 }],
        grant: (s) => { s.apples += 12; s.logs += 2; },
    }),
    mkTask({
        id: 'feed', name: '喂一顿', desc: '在灶台喂一次',
        reward: '材料 +4 · 果子 +6',
        icon: 'stew',
        cur: (s) => s.feeds, target: 1,
        rewardList: [{ kind: 'log', n: 4 }, { kind: 'apple', n: 6 }],
        grant: (s) => { s.logs += 4; s.apples += 6; },
    }),
    mkTask({
        id: 'craft', name: '做一份干粮', desc: '在工作台做出干粮或收集篮',
        reward: '果子 +8',
        icon: 'hammer',
        cur: (s) => s.crafts, target: 1,
        rewardList: [{ kind: 'apple', n: 8 }],
        grant: (s) => { s.apples += 8; },
    }),
    mkTask({
        id: 'send', name: '派人去采', desc: '派遣收回一次',
        reward: '吧唧 +2 · 果子 +10',
        icon: 'basket',
        cur: (s) => s.dispatches, target: 1,
        rewardList: [{ kind: 'coin', n: 2 }, { kind: 'apple', n: 10 }],
        grant: (s) => { s.coins += 2; s.apples += 10; },
    }),
    mkTask({
        id: 'pal', name: '带同伴回家', desc: '通关 1 关',
        reward: '果子 +20 · 材料 +6',
        icon: 'paw',
        cur: (s) => s.cleared, target: 1,
        rewardList: [{ kind: 'apple', n: 20 }, { kind: 'log', n: 6 }],
        grant: (s) => { s.apples += 20; s.logs += 6; },
    }),
    mkTask({
        id: 'pat', name: '跟它熟一点', desc: '任意一只摸到 1 颗心',
        reward: '果子 +15',
        icon: 'paw-red',
        /* 取"最高的那只"而不是"有心的一共几只"：任务说的是**任意一只**，
           用最大值才和 `ready` 的语义完全对上 */
        cur: (s) => {
            let mx = 0;
            for (const id of Object.keys(s.pats)) {
                const h = heartsOf(s.pats[id] || 0);
                if (h > mx) mx = h;
            }
            return mx;
        },
        target: 1,
        rewardList: [{ kind: 'apple', n: 15 }],
        grant: (s) => { s.apples += 15; },
    }),
];

export function taskPhase(prev: SaveState, id: string): 'claimed' | 'ready' | 'open' {
    if (prev.claimed.indexOf(id) >= 0) return 'claimed';
    const task = TASKS.find((t) => t.id === id);
    if (task && task.ready(prev)) return 'ready';
    return 'open';
}

export function claimableCount(prev: SaveState): number {
    let n = 0;
    for (const t of TASKS) if (taskPhase(prev, t.id) === 'ready') n++;
    return n;
}

export function claimTask(prev: SaveState, id: string): ActResult {
    const task = TASKS.find((t) => t.id === id);
    if (!task) return { ok: false, say: '没有这个任务' };
    const phase = taskPhase(prev, id);
    if (phase === 'claimed') return { ok: false, say: `${task.name} · 已经领过了` };
    if (phase === 'open') return { ok: false, say: `${task.name} · ${task.desc}` };
    const next = clone(prev);
    task.grant(next);
    next.claimed.push(id);
    return { ok: true, next, say: `${task.name} · 领到 ${task.reward}` };
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
