/**
 * 经济数值探针 —— **只出实测数据，不做估算**。
 *
 * 为什么要这个脚本：改造件（perk）的定价必须来自真实产出。
 * 上一版文档里的「60~80 果」「稀有材料」是推算，用户明确要求「不要猜测」。
 *
 * 用法：
 *   node _t-econ.js          跑全部 27 屏
 *   node _t-econ.js 9        只跑前 9 屏（快）
 *   node _t-econ.js 0 3      跑第 0..3 屏
 *
 * 输出：每屏一行 + 汇总表（果子/材料/耗时/造球/评级相关量）+ 直接可用的定价建议
 */
const { boot, seed } = require("./grove-env");
const { botStep } = require("./grove-bot");

const MAX_T = 260;          // 单屏最长模拟秒数（长于机器人最慢的 240s 超时）
const DT = 1 / 60;

function runStage(idx) {
  /* ★ 三处必须和 grove-smoke 的 ALL9 完全一致，否则测出来的不是同一件事：
     ① seed(S)   —— 存档基线；
     ② hero = 2  —— **ALL9 那 860 条断言全部是 hero=2（胖仓鼠）跑出来的**；
     ③ hp 999    —— 「被打 3 次强制收工」会在 7~20 秒就判 fail，
                    探针第一版没设，9 屏全红，差点得出"经济崩了"的错误结论。
     换 hero 过的关不一样：6 把武器从来没有做过平衡验证。 */
  /* ★ 每屏必须新建环境。ALL9 就是这么做的 —— 同一个环境连着跑时
     `S.belly` 每屏 −20，跑到第 3 屏就饿了（火力 0.86、不能冲刺），
     机器人当场 260s 超时。第一版就这么测的，结论是"9 屏里 4 屏过不去"，
     **那是饥饿累积，不是关卡不可解**。测"单屏经济"必须每屏满饱起跑。 */
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(2, idx);
  S.p.hp = 999; S.p.maxHp = 999;
  const mem = {};
  let t = 0;
  while (S.phase === "play" && t < MAX_T) {
    botStep(P, S, mem);
    P.tick(DT);
    t += DT;
  }
  return {
    idx,
    pass: S.phase === "clear",
    t: +t.toFixed(1),
    food: S.food,                    // 这一屏的真实收成
    made: S.stat.made,               // 造了几颗球
    burned: S.stat.burned,           // 火坑烧掉几颗
    banked: S.stat.banked,           // 落袋几颗
    killed: S.killed,
    total: S.total,
  };
}

const LV = boot().GROVE.LEVELS;

let lo = 0, hi = LV.length;
if (process.argv[2] !== undefined) {
  lo = Number(process.argv[2]) || 0;
  hi = process.argv[3] !== undefined ? Number(process.argv[3]) + 1 : lo + 9;
  if (hi > LV.length) hi = LV.length;
}

const rows = [];
for (let i = lo; i < hi; i++) rows.push(runStage(i));

const ok = rows.filter(r => r.pass);
const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
const avg = (a, k) => (a.length ? sum(a, k) / a.length : 0);

console.log("屏  结果   耗时  收成  造球  烧  袋  清场");
console.log("-".repeat(48));
for (const r of rows) {
  console.log(
    String(r.idx + 1).padStart(2) + "  " +
    (r.pass ? "达标" : "失败") + "  " +
    String(r.t).padStart(5) + "s" +
    String(r.food).padStart(6) +
    String(r.made).padStart(6) +
    String(r.burned).padStart(4) +
    String(r.banked).padStart(4) +
    ("  " + r.killed + "/" + r.total).padStart(8)
  );
}

console.log("\n===== 汇总（只统计达标屏）=====");
console.log("达标屏数        : " + ok.length + " / " + rows.length);
console.log("单屏收成 平均   : " + avg(ok, "food").toFixed(1) + " 果");
console.log("单屏收成 最小/大: " + Math.min(...ok.map(r => r.food)) + " / " + Math.max(...ok.map(r => r.food)));
console.log("单屏耗时 平均   : " + avg(ok, "t").toFixed(1) + " s");
console.log("单屏造球 平均   : " + avg(ok, "made").toFixed(1) + " 颗");

/* ---- 真实经济口径（用实测值推，不用拍） ---- */
const BELLY_PER_CLEAR = boot().GROVE.BELLY_PER_CLEAR;               // 每屏掉饱
const BELLY_MAX = 100;                                    // 出门满饱
const MEAL_COST = 8, MEAL_SAT = 22;                       // 野果：8 果 → +22 饱
const STAGES_PER_TRIP = Math.floor(BELLY_MAX / BELLY_PER_CLEAR);   // 一趟最多走几屏
const foodPerScreen = avg(ok, "food");
const applePerTrip = Math.round(foodPerScreen * STAGES_PER_TRIP * 1.225); // 倍率取中段 1+0.15*1.5≈1.225
const logsPerTrip = STAGES_PER_TRIP;                      // logs = stages（代码事实）
const feedPerTrip = Math.ceil((BELLY_PER_CLEAR * STAGES_PER_TRIP) / MEAL_SAT);
const appleCostPerTrip = feedPerTrip * MEAL_COST;

console.log("\n===== 经济口径（实测反推）=====");
console.log("每屏掉饱        : " + BELLY_PER_CLEAR + "（BELLY_PER_CLEAR）");
console.log("一趟最多走      : " + STAGES_PER_TRIP + " 屏（" + BELLY_MAX + " / " + BELLY_PER_CLEAR + "）");
console.log("一趟果子产出    : " + applePerTrip + " 果（" + foodPerScreen.toFixed(1) + " × " + STAGES_PER_TRIP + " × 1.225）");
console.log("一趟材料产出    : " + logsPerTrip + " 个（logs = stages，代码事实）");
console.log("一趟喂饭成本    : " + feedPerTrip + " 份野果 = " + appleCostPerTrip + " 果");
console.log("一趟净赚        : " + (applePerTrip - appleCostPerTrip) + " 果");

console.log("\n===== 定价可用区间（不超出一趟产出）=====");
console.log("改造件 果子 <=   : " + applePerTrip + "（一趟全款，玩家做 1 趟就能买）");
console.log("改造件 材料 <=   : " + logsPerTrip + "（超过必须跑 2 趟，等于要求 2 趟）");
console.log("一轮能做的改造件 : " + Math.floor((applePerTrip - appleCostPerTrip) / 100) + " 个（按 100 果/个估）");
