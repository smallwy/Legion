/**
 * 家园四个入口的业务断言。不启动引擎。
 * 运行：node --experimental-strip-types client/tools/home-biz-check.mts
 */
import { DEFAULT_SAVE, loadSave, saveSave, resetSave } from '../assets/scripts/config/SaveData.ts';
import {
    feed, craft, recordPat, startDispatch, collectDispatch, peekDispatch,
    heartsOf, DISPATCH_SEC,
    settleEnergy, spendEnergy, claimTask, payoutFromRun, applyRunReward, ENERGY_COST,
} from '../assets/scripts/config/HomeBiz.ts';

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
ok(ate.ok && heartsOf(4) === 0 && heartsOf(5) === 1, '5 点一颗心');

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

const basketHome = base();
basketHome.cleared = 8;
basketHome.logs = 20;
basketHome.coins = 5;
const basket = craft(basketHome, 'basket');
ok(basket.ok && basket.next.bag.basket === 1, '收集篮做出来了');
const fox = basket.ok ? startDispatch(basket.next, 'xing-xie-fox', 0) : basket;
const hauled = fox.ok ? collectDispatch(fox.next, DISPATCH_SEC * 2 * 1000) : fox;
ok(hauled.ok && hauled.next.coins === basketHome.coins - 1 + Math.floor(2 * 2 * 1.5),
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

resetSave();
saveSave(DEFAULT_SAVE);
const round = loadSave();
ok(round.bag.ration === 0 && round.settings.crisp === true && round.dispatch === null, '新字段缺省时读得回来');
ok(round.pats['sugar-stand'] === 0 && round.pats['xing-xie-fox'] === 0, '六只的亲密度都有格子');

const peek0 = peekDispatch(sent.ok ? sent.next : home, 1_000);
ok(peek0.hauls === 0 && peek0.left === DISPATCH_SEC, '刚派出时还要等满一趟');

const now = 1_700_000_000_000;
const low = base();
low.energy = 10;
ok(spendEnergy(low, now).ok === false, '能量不够出不了门');
const rich = base();
rich.energy = 100;
rich.energyAt = now - 999_999;
const spent = spendEnergy(rich, now);
ok(spent.ok && spent.next.energy === 100 - ENERGY_COST && spent.next.energyAt === now,
    '出门扣 20，满的时候从现在开始回', spent.ok ? String(spent.next.energy) : spent.say);
const held = spent.ok ? settleEnergy(spent.next, now + 17_000) : spent.next;
ok(spent.ok && held === spent.next, '不到 18 秒不回能量');
const later = spent.ok ? settleEnergy(spent.next, now + 18_000) : spent.next;
ok(later.energy === 100 - ENERGY_COST + 1, '18 秒回 1 点', String(later.energy));
const fullE = base();
ok(settleEnergy(fullE, now) === fullE, '满能量时不另写一份');

const hungryE = base();
hungryE.satiety = 40;
hungryE.apples = 8;
hungryE.energy = 50;
const fed = feed(hungryE, 'fruit');
ok(fed.ok && fed.next.energy === 62 && fed.next.feeds === 1, '喂一顿回 12 能量，并记一次');

const noRun = base();
ok(claimTask(noRun, 'out').ok === false, '还没出门领不了');
noRun.runs = 1;
noRun.energy = 40;
const apples0 = noRun.apples;
const got = claimTask(noRun, 'out');
ok(got.ok && got.next.apples === apples0 + 12 && got.next.energy === 50 && got.next.claimed.indexOf('out') >= 0,
    '出门任务领果子和能量');
ok(got.ok && claimTask(got.next, 'out').ok === false, '同一件不能领第二次');

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

console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
    for (const f of fails) console.log('  · ' + f);
    process.exit(1);
}
console.log('全部通过。');
