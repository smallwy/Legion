/**
 * 家园四个入口的业务断言。不启动引擎。
 * 运行：node --experimental-strip-types --import ./client/tools/ts-esm-hook.mjs \
 *          client/tools/home-biz-check.mts
 *
 * 为什么带 `--import`：工程里的 TS 用无扩展名 import（Cocos tsconfig 的要求），
 * node 的 ESM 解析器不认，`ts-esm-hook.mjs` 负责补扩展名（只补解析，不改源码）。
 *
 * ⚠️ 这个文件曾经在 2026-10-25 悄悄坏掉：任务系统从「6 条一次性清单」换成
 *    「主线 + 每日」时删掉了 `claimTask`，而这里还在 import 它 —— 一跑就
 *    ERR_MODULE_NOT_FOUND。**测试文件和被测代码同一天改**，否则门禁等于没有。
 */
import { DEFAULT_SAVE, loadSave, saveSave, resetSave, LEVEL_COUNT } from '../assets/scripts/config/SaveData.ts';
import {
    feed, craft, recordPat, startDispatch, collectDispatch, peekDispatch,
    heartsOf, DISPATCH_SEC, DISPATCH_CAP, DISPATCH_SHARD,
    payoutFromRun, applyRunReward, tripGoal,
    setActive, buyPerk, perkOwned,
    rollTripGoals, judgeTripGoals, tripReward, TRIP_PICK,
    settleStory, storyNow,
    rollDailyIfNeeded, dailyRows, claimDaily, dailyDoneCount, claimChest, chestReady, todayKey, DAILY_N,
    rankBoard, myRank, RANK_SIZE, starsOf, rankCount,
} from '../assets/scripts/config/HomeBiz.ts';
import {
    STAR_TYPES, STAR_OF_STAGE, STAR_IDS, STAR_PER_STAGE,
    STAR_FULL_SHARDS, STAR_FULL_LOGS, STAR_CHAPTER_SHARDS, STAR_CHAPTER_LOGS,
    starBitsOf, mergeStarBits, stageStarFull, chapterStarFull, starOfStage, starType,
} from '../assets/scripts/config/StarTargets.ts';

let pass = 0;
const fails: string[] = [];
function ok(cond: boolean, name: string, detail?: string) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else {
        fails.push(name + (detail ? ' — ' + detail : ''));
        console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
    }
}

const mem: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (k in mem ? mem[k] : null),
    setItem: (k: string, v: string) => { mem[k] = v; },
    removeItem: (k: string) => { delete mem[k]; },
    clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
    key: () => null,
    length: 0,
};

function base() {
    const s = loadSave();
    s.satiety = 40;
    s.cleared = 3;
    s.active = 'sugar-stand';
    return s;
}

console.log('家园业务\n');

const hungry = base();
hungry.apples = 3;
const noFruit = feed(hungry, 'fruit');
ok(noFruit.ok === false, '果子不够时喂不了野果', noFruit.say);
hungry.apples = 8;
const ate = feed(hungry, 'fruit');
ok(ate.ok && ate.next.satiety === 62, '野果 +22 饱食', ate.ok ? String(ate.next.satiety) : ate.say);
ok(ate.ok && ate.next.apples === 0, '野果扣 8 果子');
ok(ate.ok && ate.next.pats['sugar-stand'] === 1, '喂给出战那只 1 点亲密度');
ok(heartsOf(4) === 0 && heartsOf(5) === 1, '5 点一颗心');

const full = base();
full.satiety = 100;
full.apples = 100;
ok(feed(full, 'stew').ok === false, '吃饱了就不再喂');

const poor = base();
poor.apples = 100;
poor.logs = 0;
ok(craft(poor, 'ration').ok === false, '材料不够做不出干粮');
poor.logs = 2;
const made = craft(poor, 'ration');
ok(made.ok && made.next.bag.ration === 1, '干粮进背包');
ok(made.ok && made.next.apples === 90 && made.next.logs === 0, '做干粮扣 10 果子和 2 材料');
const ateR = made.ok ? feed(made.next, 'ration') : made;
ok(ateR.ok && ateR.next.bag.ration === 0 && ateR.next.satiety === 75, '干粮本身能吃，饱食 +35');

const solo = base();
solo.cleared = 0;
ok(startDispatch(solo, 'nian-gao-dog', 0).ok === false, '没回家的不能派');
ok(startDispatch(solo, 'sugar-stand', 0).ok === false, '家里只有一只时不能派');

const home = base();
home.cleared = 3;
const sent = startDispatch(home, 'nian-gao-dog', 1_000);
ok(sent.ok && sent.next.dispatch && sent.next.dispatch.id === 'nian-gao-dog', '年糕可以派出去');
ok(startDispatch(home, 'sugar-stand', 1_000).ok === false, '跟你出门的那只不派');
const early = sent.ok ? collectDispatch(sent.next, 1_000 + 5_000) : sent;
ok(early.ok === false, '时间没到收不回');
const back = sent.ok ? collectDispatch(sent.next, 1_000 + DISPATCH_SEC * 1000) : sent;
ok(back.ok && back.next.logs === home.logs + 4, '年糕一趟带回 4 材料', back.ok ? String(back.next.logs) : back.say);
ok(back.ok && back.next.dispatch === null, '收回后草地上不再缺这一只的记录');
/* 碎片是派遣的**独占产出**（改造件的门槛）。按趟线性累积 ——
   不满 10 趟也给（公式 floor(hauls×2/10)），否则"挂 5 分钟"完全没反馈。 */
const halfHaul = sent.ok ? collectDispatch(sent.next, 1_000 + DISPATCH_SEC * 5 * 1000) : sent;
ok(halfHaul.ok && halfHaul.next.shards === 1, '挂 5 趟给 1 个碎片（按趟线性累积）',
    halfHaul.ok ? String(halfHaul.next.shards) : halfHaul.say);
const fullHaul = sent.ok ? collectDispatch(sent.next, 1_000 + DISPATCH_CAP * DISPATCH_SEC * 1000) : sent;
ok(fullHaul.ok && fullHaul.next.shards === DISPATCH_SHARD, '满 10 趟派遣给 2 碎片 = 一件改造件的门槛',
    fullHaul.ok ? String(fullHaul.next.shards) : fullHaul.say);

const basketHome = base();
basketHome.cleared = 8;
basketHome.logs = 20;
basketHome.coins = 5;
const basket = craft(basketHome, 'basket');
ok(basket.ok && basket.next.bag.basket === 1, '收集篮做出来了');
/* 吧唧只有胖仓鼠（at 5）和影狐（at 18）挣。cleared=8 时影狐还没回家 ——
   这条测试在「8 关时代」用的是影狐，关卡加到 27 屏之后它就 silently 失败了。 */
const ham = basket.ok ? startDispatch(basket.next, 'tuan-zi-ham', 0) : basket;
const hauled = ham.ok ? collectDispatch(ham.next, DISPATCH_SEC * 2 * 1000) : ham;
ok(hauled.ok && hauled.next.coins === basketHome.coins - 1 + Math.floor(1 * 2 * 1.5),
    '收集篮让两趟吧唧按 1.5 倍算，并且用掉篮子',
    hauled.ok ? `coins ${hauled.next.coins} basket ${hauled.next.bag.basket}` : hauled.say);
ok(hauled.ok && hauled.next.bag.basket === 0, '篮子用掉一个');

const pat = recordPat(base(), 'sugar-stand');
ok(pat.ok && pat.next.pats['sugar-stand'] === 1, '摸一下记 1 次');
let p = base();
for (let i = 0; i < 5; i++) {
    const r = recordPat(p, 'sugar-stand');
    if (r.ok) p = r.next;
}
ok(heartsOf(p.pats['sugar-stand']) === 1, '摸满 5 次升一颗心');
ok(pat.ok && pat.say.indexOf('哼') >= 0, '摸头时说的是这只在家的那句');

/* ---- 换出战宠 ---- */
const sa = base();
ok(setActive(sa, 'sugar-stand').ok === false, '已经是出战那只会明说，不静默无反应');
ok(setActive(sa, 'xing-xie-fox').ok === false, '还没回家的不能选');
const sw = setActive(sa, 'nian-gao-dog');
ok(sw.ok && sw.next.active === 'nian-gao-dog', '换成短尾犬，下一趟带它出门', sw.ok ? sw.say : '失败');

/* ---- 改造件：全游戏唯一的永久变强 ---- */
/* 一趟的果子产出上限 290（`_t-econ.js` 实测）。所以"这一趟只能买一件"
   不是靠代码限制，是靠 180×2=360>290 —— 这里用 290 起手复现那条约束。 */
const pk = base();
pk.apples = 290; pk.logs = 5; pk.shards = 4;
const bought = buyPerk(pk, 'hotpit');
ok(bought.ok && perkOwned(bought.next, 'hotpit')
   && bought.next.apples === 110 && bought.next.logs === 1 && bought.next.shards === 2,
    '装一件扣 180 果 4 材 2 碎片', bought.ok ? bought.say : '失败');
ok(buyPerk(bought.next, 'wideball').ok === false, '装完第一件，这一趟就买不起第二件（一趟买不起两个）');
ok(buyPerk(bought.next, 'hotpit').ok === false, '同一件不能装两次');
const noShard = base();
noShard.apples = 180; noShard.logs = 4; noShard.shards = 0;
ok(buyPerk(noShard, 'hotpit').ok === false, '碎片不够只能派宠物去捡');

resetSave();
saveSave(DEFAULT_SAVE);
const round = loadSave();
ok(round.bag.ration === 0 && round.settings.crisp === true && round.dispatch === null, '新字段缺省时读得回来');
ok(round.pats['sugar-stand'] === 0 && round.pats['xing-xie-fox'] === 0, '六只的亲密度都有格子');
ok(Array.isArray(round.best) && round.best.length === LEVEL_COUNT
   && round.best.every((v) => v === ''),
    '评级数组：新档是 27 个空位', String(round.best && round.best.length));
ok(round.star.length === LEVEL_COUNT && round.star.every((r) => r.length === STAR_PER_STAGE && r.every((b) => b === 0)),
    '星靶完成位：新档 27×3 全 0');

/* 脏档：评级是外部输入（推球侧会写、浏览器里能手改），
   一个 "SSS" 或数字不该变成图鉴上的一行怪字。
   期望：S 留下、Z/3/null 丢掉、A 留下、空串保留、B 留下、小写 s 丢掉；
   第 9 格往后数组里没有值，一律当没打过（长度恒为 LEVEL_COUNT）。 */
resetSave();
saveSave({ ...DEFAULT_SAVE, best: ['S', 'Z', 3, null, 'A', '', 'B', 's'] as unknown as string[] });
const dirty = loadSave();
ok(dirty.best.length === LEVEL_COUNT
   && dirty.best.slice(0, 8).join(',') === 'S,,,,A,,B,'
   && dirty.best.slice(8).every((v) => v === ''),
    '评级白名单：只认 S/A/B，其余当没打过', dirty.best.slice(0, 8).join('|'));
resetSave();

const peek0 = peekDispatch(sent.ok ? sent.next : home, 1_000);
ok(peek0.hauls === 0 && peek0.left === DISPATCH_SEC, '刚派出时还要等满一趟');

const now = 1_700_000_000_000;

/* ---- 能量门禁已删（2026-10-22）----
 *
 * 原来这一组测的是"能量不够出不了门 / 18 秒回 1 点 / 满的时候从当前时刻开始计时"。
 * 那是手游的等待模型，买断制里只会换差评，所以整套删掉了。
 * 保留一条**架构断言**：HomeBiz 不许再导出 settleEnergy / spendEnergy ——
 * 有人哪天想加回来，得先看到这条红灯，而不是悄悄加一个"每日体力"。
 * 断言写在静态检查里（tools/verify-*.js 的 import 清单），这里不重复。 */

const fed = (() => {
    const h = base();
    h.satiety = 40;
    h.apples = 30;
    return feed(h, 'fruit');
})();
ok(fed.ok && fed.next.feeds === 1 && fed.next.satiety === 62, '喂一顿：饱食 +22，并记一次',
    fed.ok ? `${fed.next.satiety}` : fed.say);

const donePay = payoutFromRun({ kind: 'done', lastLoot: 30, lastStages: 2, tripLoot: 0, tripStages: 0, food: 9 });
ok(donePay.apples === 30 && donePay.logs === 2 && donePay.coins === 1, '收工按这一趟的收成和关数给');
const escPay = payoutFromRun({ kind: 'esc', lastLoot: 99, lastStages: 5, tripLoot: 4, tripStages: 1, food: 3 });
ok(escPay.apples === 7 && escPay.logs === 1 && escPay.coins === 0, '中途退出只算已经拿到的');
const emptyPay = payoutFromRun({ kind: 'esc', lastLoot: 0, lastStages: 0, tripLoot: 0, tripStages: 0, food: 0 });
ok(emptyPay.apples === 1, '空手回去也带回 1 个果子');
const src = base();
const banked = applyRunReward(src, donePay);
ok(banked.runs === src.runs + 1 && banked.apples === src.apples + 30 && banked.lastReward.indexOf('果子 +30') >= 0,
    '奖励记在存档上，回家再报');

/* ============================================================================
   本趟目标（每趟抽 2 条约束）
   ============================================================================ */

const g1 = rollTripGoals(() => 0);
const g2 = rollTripGoals(() => 0.99);
ok(g1.length === TRIP_PICK && g2.length === TRIP_PICK, '每趟抽 2 条');
ok(rollTripGoals(() => 0).join(',') === rollTripGoals(() => 0).join(','), '同一个种子抽到同一组（测试可复现）');
const met = judgeTripGoals(['nofire', 'bigchain'],
    { burned: 0, maxHolds: 3, hits: 0, lost: 0, burst: 0, made: 4 });
ok(met.length === 2, '不碰火坑 + 大打卷都达成');
ok(judgeTripGoals(['nofire'], { burned: 2, maxHolds: 0, hits: 0, lost: 0, burst: 0, made: 4 }).length === 0,
    '烧过球就不是「不碰火坑」');
ok(judgeTripGoals(['nofire'], { burned: 0, maxHolds: 0, hits: 0, lost: 0, burst: 0, made: 0 }).length === 0,
    '一球不打不算「不碰火坑」（否则站着不动也能拿）');
const rw = tripReward(met);
ok(rw.shards === 2 && rw.logs === 2, '本趟目标奖励：2 碎片 + 2 材料', `shards ${rw.shards} logs ${rw.logs}`);
ok(tripGoal('nofire') !== null && tripGoal('zzz') === null, '按 id 取目标，未知 id 返回 null');

/* ============================================================================
   主线（串行指路）+ 每日（回访理由）
   ============================================================================ */

const st0 = base();
const s0 = settleStory(st0);
ok(s0.next.storyIdx === 0 && s0.gained.length === 0 && storyNow(st0)!.id === 'out',
    '新档手上只有第一条主线「出门一趟」');

const st1 = base();
st1.runs = 1;
const s1 = settleStory(st1);
ok(s1.gained.length === 1 && s1.gained[0].id === 'out' && s1.next.storyIdx === 1
   && s1.next.apples === st1.apples + 12 && s1.next.logs === st1.logs + 2,
    '打完一趟结算第一条，奖励直接进存档（不走 payoutFromRun）', s1.gained.map((g) => g.id).join(','));

/* 存档跳得快的玩家要一次连过多条 —— 只结算一条的话他得回主界面 N 次 */
const st2 = base();
st2.runs = 1; st2.feeds = 1; st2.crafts = 1; st2.dispatches = 1;
st2.cleared = 9;
st2.pats['sugar-stand'] = 5;                 // 一颗心
st2.best = new Array<string>(LEVEL_COUNT).fill(''); st2.best[0] = 'S';
st2.perks = ['hotpit'];
const s2 = settleStory(st2);
ok(s2.gained.length === 9 && s2.next.storyIdx === 9,
    '一口气满足 9 条：一次全结算', s2.gained.map((g) => g.id).join(','));
/* 账要能口算：果 12+6+15+8+10+30+20=101 / 材 2+4+4+6=16 / 币 2 / 碎片 1+2+1+2=6 */
ok(s2.next.apples === st2.apples + 101 && s2.next.logs === st2.logs + 16
   && s2.next.coins === st2.coins + 2 && s2.next.shards === 6,
    '主线连跳 9 条的总账：101 果 / 16 材 / 2 币 / 6 碎片',
    `apples ${s2.next.apples - st2.apples} logs ${s2.next.logs - st2.logs} coins ${s2.next.coins - st2.coins} shards ${s2.next.shards}`);
ok(storyNow(s2.next)!.id === 'ch1' || storyNow(s2.next)!.id === 'perk1' || storyNow(s2.next)!.id === 'all',
    '第 10 条「走完 27 屏」还没满足，主线没走完');

const d0 = rollDailyIfNeeded(base(), now);
ok(d0.changed === true && d0.next.dailyPick.length === DAILY_N, '第一次打开抽 5 条每日');
ok(rollDailyIfNeeded(d0.next, now).changed === false, '同一天不重抽');
const d2 = rollDailyIfNeeded(d0.next, now + 86_400_000);
ok(d2.changed === true && d2.next.dailyClaimed.length === 0 && d2.next.dailyChests.length === 0,
    '跨天重抽，并且清空已领和已开');

const dd = base();
dd.dailyAt = todayKey(now);
dd.dailyPick = ['d_run'];
dd.dailyClaimed = [];
dd.dailyBase = { runs: 0 };
dd.runs = 2;
const rows = dailyRows(dd);
ok(rows.length === 1 && rows[0].cur === 2 && rows[0].done === true && rows[0].claimed === false,
    '每日进度 = 当前值 − 基线快照（不动任何累计计数器）', JSON.stringify(rows[0]));
const claimedD = claimDaily(dd, 'd_run');
ok(claimedD.ok && claimedD.next.apples === dd.apples + 20 && claimedD.next.dailyClaimed.join(',') === 'd_run',
    '领每日奖', claimedD.ok ? claimedD.say : '失败');
ok(claimDaily(claimedD.next, 'd_run').ok === false, '同一条今天不能领第二次');
dd.runs = 1;
ok(claimDaily(dd, 'd_run').ok === false, '还差 1 趟，不給领');
ok(claimDaily(dd, 'zzz').ok === false, '今天没有这条');

const chs = base();
chs.dailyAt = todayKey(now);
chs.dailyPick = ['d_run', 'd_feed', 'd_craft', 'd_one', 'd_touch'];
chs.dailyClaimed = [];
chs.dailyBase = { runs: 0, feeds: 0, crafts: 0, pats: 0 };
chs.runs = 2; chs.feeds = 3; chs.crafts = 2;
ok(dailyDoneCount(chs) === 4, '出门 2 趟让「2 趟」和「1 趟」两条同时完成', String(dailyDoneCount(chs)));
ok(chestReady(chs) === 1, '够 3 条，3 条那个宝箱能开');
const opened = claimChest(chs, 3);
ok(opened.ok && opened.next.apples === chs.apples + 30 && opened.next.dailyChests.join(',') === '3',
    '开 3 条宝箱', opened.ok ? opened.say : '失败');
ok(claimChest(opened.next, 3).ok === false, '同一个宝箱今天只开一次');
ok(claimChest(chs, 5).ok === false, '不够 5 条开不了大宝箱');

/* ============================================================================
   本机排行榜（街机厅 TOP 10）
   ============================================================================ */

const rk = base();
rk.cleared = LEVEL_COUNT;
rk.best = new Array<string>(LEVEL_COUNT).fill('S');
rk.runs = 5;
const board = rankBoard(rk);
ok(board.length === RANK_SIZE, '榜上永远 10 个位置', String(board.length));
ok(board[0].me === true && myRank(rk) === 1, '全通 + 全 S + 只花 5 趟 → 排第一（影子记录最省也要 30 趟）',
    `第 1 名 ${board[0].name}`);
const weak = base();
weak.cleared = 1; weak.runs = 40;
ok(myRank(weak) > 1, '只过 1 屏排不进第一');
ok(starsOf(rk) === LEVEL_COUNT * 3 && rankCount(rk).s === LEVEL_COUNT && rankCount(rk).none === 0,
    '总星数：全 S = 81', String(starsOf(rk)));

/* ============================================================================
   星靶（每屏 3 个挑战条件）
   ----------------------------------------------------------------------------
   这里只测**存档侧的纯函数**（`StarTargets.ts`）。判定器、配靶规则、
   结算卡画没画在 `grove-smoke.js` 第 39 节（两边数据逐字一致 + 埋点断言）。
   ============================================================================ */

ok(STAR_OF_STAGE.length === LEVEL_COUNT, '配靶表 27 屏一行不少', String(STAR_OF_STAGE.length));
let cellTotal = 0;
let shapeOk = true;
for (const row of STAR_OF_STAGE) {
    if (row.length !== STAR_PER_STAGE) shapeOk = false;
    if (new Set(row).size !== row.length) shapeOk = false;
    for (const id of row) {
        if (STAR_IDS.indexOf(id) < 0) shapeOk = false;
        cellTotal++;
    }
}
ok(shapeOk && cellTotal === LEVEL_COUNT * STAR_PER_STAGE,
    '81 个靶：每屏 3 个、屏内不重复、id 都认得', `${shapeOk} / ${cellTotal}`);

/* 5 个 id 和「本趟目标」共用一套语义。名字必须逐字一致 ——
   差一个字，玩家同一天里会看到两个名字描述同一件事。 */
for (const id of ['nofire', 'bigchain', 'nohit', 'nolost', 'noshell']) {
    const st = starType(id);
    const tg = tripGoal(id);
    ok(!!st && !!tg && st!.name === tg!.name, `靶「${id}」和本趟目标同名`,
        st && tg ? `${st.name} / ${tg.name}` : '缺定义');
}

ok(starType('nofire')!.name === '不碰火坑' && starType('zzz') === null, '按 id 取靶目，未知 id 返回 null');
ok(starOfStage(0).join(',') === STAR_OF_STAGE[0].join(','), 'starOfStage 取到这一屏的 3 个');
ok(starOfStage(-1).length === 0 && starOfStage(27).length === 0 && starOfStage(0.5).length === 0,
    '越界 / 非整数的屏号返回空（调用方按「没有靶」处理）');

/* ---- 坏档整形：存档是外部输入 ---- */
const zero = starBitsOf(null);
ok(zero.length === LEVEL_COUNT && zero.every((r) => r.length === STAR_PER_STAGE && r.every((b) => b === 0)),
    '空档整成 27×3 全 0');
const dirtyStar = starBitsOf([[1], [1, 1, 1], 'x', null, [2, 0, 0]]);
ok(dirtyStar[0].join('') === '100' && dirtyStar[1].join('') === '111'
   && dirtyStar[2].join('') === '000' && dirtyStar[3].join('') === '000' && dirtyStar[4].join('') === '000',
    '坏档：短行补 0、非数组当 0、非 1 的值当 0', dirtyStar.slice(0, 5).map((r) => r.join('')).join(' '));

/* ---- 口径①：只增不减 ---- */
const pre = starBitsOf(null);
pre[0][0] = 1;                       // nofire 早就有了
pre[0][1] = 1;                       // bigchain 也早就有了
const re = mergeStarBits(pre, [{ stage: 0, ids: ['nofire', 'bigchain', 'ramp'] }]);
ok(re.fresh.length === 1 && re.fresh[0].ids.join(',') === 'ramp',
    '早就有的两个靶不再算新达成，只报新补的那个', JSON.stringify(re.fresh));
ok(re.bits[0].join('') === '111' && re.logs === 1 + STAR_FULL_LOGS && re.shards === STAR_FULL_SHARDS,
    '补上最后一个也算集满，照样给集满奖', `logs ${re.logs} shards ${re.shards}`);

/* ---- 口径②：同一个靶打十遍只给一次 ---- */
const again = mergeStarBits(re.bits, [{ stage: 0, ids: ['nofire', 'bigchain', 'ramp'] }]);
ok(again.fresh.length === 0 && again.shards === 0 && again.logs === 0
   && again.fullStages.length === 0 && again.fullChapters.length === 0,
    '满屏重打：一分不给', `shards ${again.shards} logs ${again.logs}`);
ok(again.bits[0].join('') === '111', '重打不会把完成位抹掉');

/* ---- 口径③：集满按并后判定（含章集满派生） ---- */
function chapterStars(ch: number): { stage: number; ids: string[] }[] {
    const out: { stage: number; ids: string[] }[] = [];
    for (let i = ch * 9; i < ch * 9 + 9; i++) out.push({ stage: i, ids: starOfStage(i) });
    return out;
}
const ch1 = mergeStarBits(starBitsOf(null), chapterStars(0));
ok(ch1.fullStages.length === 9 && ch1.fullChapters.join(',') === '0',
    '第一章 9 屏全并满：9 次集满 + 1 次章集满',
    `fullStages ${ch1.fullStages.length} chapters ${ch1.fullChapters}`);
/* 账要能口算出来：9 屏各 3 靶×1 材 + 9 次集满×1 材 + 章集满 3 材 = 39 材；
   碎片 9×2 + 章 4 = 22。 */
ok(ch1.shards === 9 * STAR_FULL_SHARDS + STAR_CHAPTER_SHARDS
   && ch1.logs === 9 * (STAR_PER_STAGE + STAR_FULL_LOGS) + STAR_CHAPTER_LOGS,
    '章集满的账：22 碎片 / 39 材料', `shards ${ch1.shards} logs ${ch1.logs}`);
const ch1Again = mergeStarBits(ch1.bits, chapterStars(0));
ok(ch1Again.fullChapters.length === 0 && ch1Again.shards === 0,
    '章已经满过，重打不再发第二次');
const ch3 = mergeStarBits(ch1.bits, chapterStars(2));
ok(ch3.fullChapters.join(',') === '2', '第三章单独并满照样触发（和第一章互不干扰）', ch3.fullChapters.join(','));

/* ---- 脏输入：不是这一屏的靶、越界的屏号，都丢掉不崩 ---- */
const notMine = mergeStarBits(starBitsOf(null), [{ stage: 0, ids: ['nolost', 'nofire'] }]);
ok(notMine.fresh.length === 1 && notMine.fresh[0].ids.join(',') === 'nofire' && notMine.fullStages.length === 0,
    '不属于这一屏的靶 id 直接丢掉', JSON.stringify(notMine.fresh));
const oob = mergeStarBits(starBitsOf(null), [
    { stage: -1, ids: ['nofire'] },
    { stage: LEVEL_COUNT, ids: ['nofire'] },
    { stage: 1.5, ids: ['nofire'] },
]);
ok(oob.fresh.length === 0 && oob.shards === 0 && oob.logs === 0, '越界屏号不崩也不给奖');
const emptyIds = mergeStarBits(starBitsOf(null), [{ stage: 0, ids: [] }]);
ok(emptyIds.fresh.length === 0, '空 ids 不产生 fresh');

ok(stageStarFull(ch1.bits, 0) === true && stageStarFull(ch1.bits, 9) === false
   && stageStarFull(ch1.bits, -1) === false, 'stageStarFull：满 / 没满 / 越界');
ok(chapterStarFull(ch1.bits, 0) === true && chapterStarFull(ch1.bits, 1) === false
   && chapterStarFull(ch1.bits, 3) === false, 'chapterStarFull：满 / 没满 / 不存在的章');

/* ---- 货币出口：星靶奖励走 payoutFromRun，不自己写存档 ---- */
const starPay = payoutFromRun({
    kind: 'done', lastLoot: 30, lastStages: 2, tripLoot: 0, tripStages: 0, food: 9,
    starShards: STAR_FULL_SHARDS, starLogs: 4,
});
ok(starPay.logs === 2 + 4 && starPay.shards === STAR_FULL_SHARDS,
    '星靶材料并进 logs、碎片并进 shards（和果子同一个出口）', `logs ${starPay.logs} shards ${starPay.shards}`);
const mixPay = payoutFromRun({
    kind: 'esc', lastLoot: 0, lastStages: 0, tripLoot: 12, tripStages: 3, food: 0,
    rankLogs: 3, goalShards: 2, goalLogs: 2, starShards: 4, starLogs: 1,
});
ok(mixPay.logs === 3 + 3 + 2 + 1 && mixPay.shards === 2 + 4,
    '评级 / 本趟目标 / 星靶三份分开记账、同一个出口相加', `logs ${mixPay.logs} shards ${mixPay.shards}`);
const starBank = applyRunReward(base(), starPay);
ok(starBank.shards === (base().shards || 0) + STAR_FULL_SHARDS
   && starBank.lastReward.indexOf(`碎片 +${STAR_FULL_SHARDS}`) >= 0
   && starBank.lastReward.indexOf('材料 +6') >= 0,
    '星靶奖励落档，回家那句报得出来', starBank.lastReward);

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
    for (const f of fails) console.log('  · ' + f);
    process.exit(1);
}
console.log('全部通过。');
