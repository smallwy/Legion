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
/** 一趟采集要这么多秒。最多连收 3 趟，再待着也不多给 */
export const DISPATCH_SEC = 30;
export const DISPATCH_CAP = 3;

/** 出门能量。和饱食分开：饱食管这一趟的火力，能量管今天还能不能再出门 */
export const ENERGY_MAX = 100;
export const ENERGY_COST = 20;
/** 没满的时候，这么多秒回 1 点。一趟 20 点大约 6 分钟回满 */
export const ENERGY_REGEN_SEC = 18;
/** 灶台喂成功，顺手回一点能量 */
export const ENERGY_FEED = 12;

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

/** 每趟带回的量。种类跟这只平时干的活一致 */
const YIELD: Record<string, { apples: number; logs: number; coins: number }> = {
    'sugar-stand': { apples: 10, logs: 0, coins: 0 },
    'nian-gao-dog': { apples: 0, logs: 4, coins: 0 },
    'tuan-zi-ham': { apples: 6, logs: 0, coins: 1 },
    'xue-tuan-rab': { apples: 6, logs: 2, coins: 0 },
    'dou-nai-ox': { apples: 0, logs: 6, coins: 0 },
    'xing-xie-fox': { apples: 4, logs: 0, coins: 2 },
};

export type ActResult =
    | { ok: true; next: SaveState; say: string }
    | { ok: false; say: string };

export interface DispatchPreview {
    hauls: number;
    /** 离下一趟还差的秒数。已经收满 3 趟时是 0 */
    left: number;
    apples: number;
    logs: number;
    coins: number;
}

export function heartsOf(pats: number): number {
    const n = Math.max(0, Math.floor(pats));
    return Math.min(MAX_HEARTS, Math.floor(n / PATS_PER_HEART));
}

export function heartText(pats: number): string {
    const h = heartsOf(pats);
    return '♥'.repeat(h) + '♡'.repeat(MAX_HEARTS - h);
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
    const energyGain = Math.min(ENERGY_FEED, ENERGY_MAX - next.energy);
    next.energy += energyGain;
    const id = next.active;
    const before = heartsOf(next.pats[id] || 0);
    next.pats[id] = (next.pats[id] || 0) + meal.bond;
    const up = heartsOf(next.pats[id]) - before;
    const heart = up > 0 ? ` · 亲密度 +${up}` : '';
    const energy = energyGain > 0 ? ` · 能量 +${energyGain}` : '';
    return {
        ok: true,
        next,
        say: `${petName(id)} 吃了${meal.name} · 饱食 ${Math.round(next.satiety)}${heart}${energy}`,
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
    const empty = { hauls: 0, left: 0, apples: 0, logs: 0, coins: 0 };
    const job = prev.dispatch;
    if (!job) return empty;
    const y = YIELD[job.id] || { apples: 6, logs: 2, coins: 0 };
    const elapsed = Math.max(0, now - job.since) / 1000;
    const hauls = Math.min(DISPATCH_CAP, Math.floor(elapsed / DISPATCH_SEC));
    const mul = prev.bag.basket > 0 ? 1.5 : 1;
    const scale = (n: number) => Math.floor(n * hauls * mul);
    const left = hauls >= DISPATCH_CAP ? 0 : Math.max(1, Math.ceil(DISPATCH_SEC - (elapsed % DISPATCH_SEC)));
    return {
        hauls,
        left,
        apples: scale(y.apples),
        logs: scale(y.logs),
        coins: scale(y.coins),
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
    return { ok: true, next, say: `${pet.name} 去采东西了 · ${DISPATCH_SEC} 秒后能收回第一趟` };
}

export function collectDispatch(prev: SaveState, now: number): ActResult {
    if (!prev.dispatch) return { ok: false, say: '没有派出去的宠物' };
    const name = petName(prev.dispatch.id);
    const peek = peekDispatch(prev, now);
    if (peek.hauls < 1) return { ok: false, say: `${name} 还要 ${peek.left} 秒` };
    const next = clone(prev);
    next.apples += peek.apples;
    next.logs += peek.logs;
    next.coins += peek.coins;
    const usedBasket = next.bag.basket > 0;
    if (usedBasket) next.bag.basket -= 1;
    next.dispatch = null;
    next.dispatches += 1;
    const basket = usedBasket ? ' · 收集篮用掉了' : '';
    return {
        ok: true,
        next,
        say: `${name} 带回 果子 ${peek.apples} · 材料 ${peek.logs} · 吧唧 ${peek.coins}${basket}`,
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

/** 把离线这段时间的能量补上。没变化时返回原来的对象，调用方用引用比较决定要不要写盘 */
export function settleEnergy(prev: SaveState, now: number): SaveState {
    if (prev.energy >= ENERGY_MAX) return prev;
    const step = ENERGY_REGEN_SEC * 1000;
    const gain = Math.floor(Math.max(0, now - prev.energyAt) / step);
    if (gain <= 0) return prev;
    const next = clone(prev);
    next.energy = Math.min(ENERGY_MAX, prev.energy + gain);
    next.energyAt = next.energy >= ENERGY_MAX ? now : prev.energyAt + gain * step;
    return next;
}

export function spendEnergy(prev: SaveState, now: number): ActResult {
    const settled = settleEnergy(prev, now);
    if (settled.energy < ENERGY_COST) {
        const lack = ENERGY_COST - settled.energy;
        return { ok: false, say: `能量不够 · ${settled.energy}/${ENERGY_MAX} · 还差 ${lack}` };
    }
    const next = clone(settled);
    const wasFull = settled.energy >= ENERGY_MAX;
    next.energy -= ENERGY_COST;
    if (wasFull) next.energyAt = now;
    return { ok: true, next, say: `消耗 ${ENERGY_COST} 能量 · 还剩 ${next.energy}` };
}

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

export interface TaskDef {
    id: string;
    name: string;
    desc: string;
    reward: string;
    ready: (s: SaveState) => boolean;
    grant: (s: SaveState) => void;
}

export const TASKS: ReadonlyArray<TaskDef> = [
    {
        id: 'out', name: '出门一趟', desc: '打完回来一次',
        reward: '果子 +12 · 能量 +10',
        ready: (s) => s.runs >= 1,
        grant: (s) => { s.apples += 12; s.energy = Math.min(ENERGY_MAX, s.energy + 10); },
    },
    {
        id: 'feed', name: '喂一顿', desc: '在灶台喂一次',
        reward: '材料 +4 · 能量 +8',
        ready: (s) => s.feeds >= 1,
        grant: (s) => { s.logs += 4; s.energy = Math.min(ENERGY_MAX, s.energy + 8); },
    },
    {
        id: 'craft', name: '做一份干粮', desc: '在工作台做出干粮或收集篮',
        reward: '果子 +8',
        ready: (s) => s.crafts >= 1,
        grant: (s) => { s.apples += 8; },
    },
    {
        id: 'send', name: '派人去采', desc: '派遣收回一次',
        reward: '吧唧 +2 · 能量 +10',
        ready: (s) => s.dispatches >= 1,
        grant: (s) => { s.coins += 2; s.energy = Math.min(ENERGY_MAX, s.energy + 10); },
    },
    {
        id: 'pal', name: '带同伴回家', desc: '通关 1 关',
        reward: '果子 +20 · 材料 +6',
        ready: (s) => s.cleared >= 1,
        grant: (s) => { s.apples += 20; s.logs += 6; },
    },
    {
        id: 'pat', name: '跟它熟一点', desc: '任意一只摸到 1 颗心',
        reward: '能量 +15',
        ready: (s) => Object.keys(s.pats).some((id) => heartsOf(s.pats[id] || 0) >= 1),
        grant: (s) => { s.energy = Math.min(ENERGY_MAX, s.energy + 15); },
    },
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
