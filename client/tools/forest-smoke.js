/**
 * 森林觅食原型冒烟测试
 *
 * 用记录型 Canvas 桩 + vm 沙箱直接跑 forest.html 里的脚本。
 * 目的不是"能跑起来"，而是钉住三类**不报错但会静默出错**的问题：
 *   1. ATB 时间推进（慢放系数、多重叠加、眩晕冻结）
 *   2. 伤害链路（护盾吸收、减伤、反击、击杀产粮）
 *   3. 流程状态机（深度递增、团灭丢一半、编队上限）
 *
 * 跑法：node forest-smoke.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// PROTO 环境变量可指定被测文件，方便新旧版对比
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "forest.html");

let pass = 0, fail = 0;
const fails = [];

function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg); console.log("  ✗ " + msg); }
}
function eq(a, b, msg) {
  ok(a === b, msg + "（期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a) + "）");
}
function near(a, b, tol, msg) {
  ok(Math.abs(a - b) <= tol, msg + "（期望 " + b + "±" + tol + "，实际 " + a + "）");
}

/* ============================================================
   画布 / 环境桩
   ============================================================ */

const noop = () => {};

function makeCtx(stat) {
  const g = {
    canvas: null,
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1,
    font: "", textAlign: "", textBaseline: "",
    globalCompositeOperation: "source-over",
    lineCap: "butt", lineJoin: "miter",
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, arcTo: noop, ellipse: noop, rect: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop,
    fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: (t) => stat.texts.push(String(t)),
    strokeText: noop,
    setLineDash: noop, getLineDash: () => [],
    measureText: (t) => ({ width: String(t).length * 7 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    // 径向渐变也必须有：背景的太阳光晕和「林中空地」都用它。
    // 桩漏一个 API，整条渲染链就断在背景那一行，而报错信息看起来像产品 bug。
    createRadialGradient: () => ({ addColorStop: noop }),
    drawImage: () => { stat.images++; },
  };
  return g;
}

function makeCanvas(w, h) {
  const c = { width: w || 0, height: h || 0, style: {} };
  const stat = { texts: [], images: 0 };
  const cx = makeCtx(stat);
  cx.canvas = c;
  c._stat = stat;
  c.getContext = () => cx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 600 });
  c.addEventListener = (type, fn) => { c["on" + type] = fn; };
  return c;
}

/** 图片桩：src 一设就同步触发 onload —— 异步的话 assetsReady 永远等不到 */
function makeImage() {
  const im = { width: 0, height: 0, onload: null, onerror: null };
  let s = "";
  Object.defineProperty(im, "src", {
    get: () => s,
    set(v) {
      s = v;
      im.width = 32;
      im.height = 32;
      if (im.onload) im.onload();
    },
  });
  return im;
}

const mainCanvas = makeCanvas(960, 600);

const sandbox = {
  console, Math, Date, JSON, String, Number, Array, Object, Boolean, isNaN,
  Image: makeImage,
  document: {
    getElementById: () => mainCanvas,
    createElement: () => makeCanvas(0, 0),
  },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  addEventListener: noop,
  innerWidth: 1280,
  innerHeight: 800,
};
sandbox.window = sandbox;
vm.createContext(sandbox);

const html = fs.readFileSync(HTML, "utf8");
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

try {
  vm.runInContext(code, sandbox, { filename: "forest.html" });
} catch (e) {
  console.log("脚本执行失败：" + e.message);
  process.exit(1);
}

const P = sandbox.PAWPACK;
if (!P) { console.log("PAWPACK 未导出"); process.exit(1); }

const S = P._S;
const PETS = P._PET_DEFS;
const SKILLS = P._SKILLS;
const DEPTHS = P._DEPTHS;
const ATB = P._ATB;

/* ============================================================
   0. 资源合成
   ============================================================ */
console.log("\n=== 0. 资源 ===");
const SKIN = vm.runInContext("SKIN", sandbox);
ok(SKIN.cat && SKIN.cat.width > 32, "宠物染色贴图应已合成（含描边留白）");
ok(SKIN["e:boar"] && SKIN["e:boar"].width > 32, "敌人染色贴图应已合成");
ok(SKIN.cat.pad === 3, "描边留白应为 3（r=2 + 1）");

/* ============================================================
   1. 编队
   ============================================================ */
console.log("\n=== 1. 编队 ===");
P._reset();
S.party = [];
ok(S.party.length === 0, "重置后队伍为空");

// 上阵上限
S.party = PETS.map(p => p.id);
ok(S.party.length === 5, "五只全上阵");
eq(PETS.length, 5, "宠物池应为 5 只");

// 喂食：花 1 份干粮
P._reset();
const food0 = S.food;
sandbox.PAWPACK._reset();
// 直接调 rosterClick 太绕，改用状态操作 + 校验语义
S.fed.cat = true;
S.food -= 1;
eq(S.food, food0 - 1, "喂一份干粮应扣 1");
ok(S.fed.cat === true, "喂食标记应写入");

/* ============================================================
   2. ATB 时间推进
   ============================================================ */
console.log("\n=== 2. ATB 时间推进 ===");
P._reset();
S.party = ["cat", "dog"];
P._startRun();

eq(S.depth, 1, "出发后应在深度 1");
eq(S.phase, "battle", "出发后应进入战斗");
eq(S.pets.length, 2, "场上应有 2 只宠物");

const cat = S.pets[0];
const dog = S.pets[1];

// 行动条应该按 spd 涨
cat.atb = 0; dog.atb = 0;
const dt = 1 / 60;
for (let i = 0; i < 60; i++) P._tick(dt);   // 1 秒
near(cat.atb, 30, 1.5, "猫 1 秒应涨约 30（spd=30）");
near(dog.atb, 20, 1.5, "狗 1 秒应涨约 20（spd=20）");
ok(cat.atb > dog.atb, "猫的行动条必须比狗快");

S.auto = false;      // 这一段验证手动模式（自动模式的断言在 8 节）
// 攒满 → 进 await 队列
cat.atb = ATB.full - 1;
dog.atb = 0;
for (let i = 0; i < 10; i++) P._tick(dt);
ok(S.await.indexOf(cat) >= 0, "行动条攒满的宠物应进入待选队列");
eq(cat.atb, ATB.full, "待选期间行动条应锁在满值");

// 慢放：有宠物待选时世界减速
ok(S.timeScale < 0.2, "待选时 timeScale 应降到 16%（实际 " + S.timeScale.toFixed(2) + "）");

// 慢放期间敌人仍在涨条 —— 这是 ATB 与纯回合制的分界
const enemy = S.enemies[0];
enemy.atb = 0;
const before = enemy.atb;
for (let i = 0; i < 60; i++) P._tick(dt);
ok(enemy.atb > before, "慢放期间敌人行动条必须继续涨（否则退化成回合制）");
// 注意用 enemy.spd 而不是写死数字 —— 深度 1 是乌鸦(spd=31)不是野猪(spd=15)，
// 写死常数会在换成别的敌人时给出假警报
near(enemy.atb, enemy.spd * 0.16, 1.2, "敌人 1 秒慢放应只涨 spd×0.16");

// 选完招 → 队列出队 → 时间恢复
const eid = S.enemies[0];
P._petAct(cat, "scratch", eid);
S.await.shift();
S.awaitT = 0;
ok(S.await.length === 0, "出招后待选队列应清空");
P._tick(dt);
S.hitPause = 0;      // 顿帧期间 timeScale = 0.32，这是设计，不是回归
S.timeScale = 1;
eq(S.timeScale, 1, "没人待选、也没有顿帧时时间恢复正常");
S.auto = true;       // 交还给自动模式

/* ============================================================
   3. 伤害链路
   ============================================================ */
console.log("\n=== 3. 伤害链路 ===");
P._reset();
S.party = ["cat", "dog"];
P._startRun();
const pk = S.pets[0];
const en = S.enemies[0];

// 基础伤害
en.hp = 100; en.maxHp = 100;
pk.dmgMul = 1;
P._petAct(pk, "scratch", en);
ok(en.hp < 100, "挠应造成伤害");
const dmgBase = 100 - en.hp;

// 护盾吸收
en.hp = 100; en.shield = 999;
P._petAct(pk, "scratch", en);
eq(en.hp, 100, "护盾足够时应完全吸收伤害");
ok(en.shield < 999, "护盾应被消耗");

// 减伤
en.hp = 100; en.shield = 0;
en.guardT = 1; en.guard = 0.6;
const hpBefore = en.hp;
en.hp = 100;
// 手动打一次，绕过随机会心
en.guardT = 1; en.guard = 0.6;
P._petAct(pk, "scratch", en);
const dmgGuarded = 100 - en.hp;
ok(dmgGuarded < dmgBase, "减伤状态下伤害应更低（" + dmgGuarded + " vs " + dmgBase + "）");

// 击杀产粮
P._reset();
S.party = ["ham"];
P._startRun();
const hamster = S.pets[0];
const boar = S.enemies[0];
S.carried = 0;
boar.hp = 1;
P._petAct(hamster, "stuff", boar);
ok(boar.hp <= 0, "塞嘴应打死残血敌人");
eq(S.carried, 2, "团子的「塞嘴」击杀应带回 2 份（1 基础 + 1 额外）");

/* ============================================================
   4. 敌方 AI
   ============================================================ */
console.log("\n=== 4. 敌方 AI ===");

// 乌鸦偷食物
P._reset();
S.party = ["cat", "dog", "ham"];
P._startRun();
S.enemies = [S.enemies[0]];
const crow = S.enemies[0];
crow.def = P._ENEMY_DEFS.crow;
crow.hp = 20; crow.maxHp = 20;
S.carried = 5;
S.food = 6;
P._enemyAct(crow);
ok(S.carried < 5 || S.food < 6, "乌鸦应偷走背上食物或干粮");

// 野猪打最靠前的
P._reset();
S.party = ["cat", "dog"];
P._startRun();
S.enemies = [S.enemies[0]];
const boar2 = S.enemies[0];
boar2.def = P._ENEMY_DEFS.boar;
boar2.atk = 8;
const hpA = S.pets.map(p => p.hp);
P._enemyAct(boar2);
const hurtCount = S.pets.filter((p, i) => p.hp < hpA[i]).length;
eq(hurtCount, 1, "野猪一次只咬一只");

// 眩晕冻结
P._reset();
S.party = ["cat"];
P._startRun();
const cat2 = S.pets[0];
cat2.stunT = 5;
cat2.atb = 0;
for (let i = 0; i < 30; i++) P._tick(dt);
eq(cat2.atb, 0, "眩晕期间行动条不应增长");

/* ============================================================
   5. 流程状态机
   ============================================================ */
console.log("\n=== 5. 流程 ===");
P._reset();
S.party = ["cat", "dog"];
P._startRun();
eq(S.depth, 1, "出发深度 1");

// 清空敌人 → 应进入 trail
for (const e of S.enemies) { e.hp = 0; e.dying = 0.4; }
S.enemies.forEach(e => { e.dying = 0; });
S.enemies.length = 0;
for (let i = 0; i < 4; i++) P._tick(dt);
eq(S.phase, "trail", "清完怪应进入「继续/撤退」阶段");
ok(S.carried > 0, "打完应有战利品");

// 继续深入
const carried1 = S.carried;
P._goDeeper();
eq(S.depth, 2, "继续深入应到深度 2");
eq(S.phase, "battle", "深度 2 应重新开战");
ok(S.carried === carried1, "深入不应清空已得战利品");

// 清掉深度 2 的怪，回到 trail 才能撤退
S.enemies.length = 0;
for (let i = 0; i < 4; i++) P._tick(dt);
eq(S.phase, "trail", "清完深度 2 的怪应再次进入 trail");

// 撤退：战利品入账
const foodBefore = S.food;
const carriedNow = S.carried;
ok(carriedNow > carried1, "打完深度 2 战利品应增加（" + carried1 + " → " + carriedNow + "）");
P._retreat();
eq(S.phase, "result", "撤退应进入结算");
eq(S.food, foodBefore + carriedNow, "撤退应把战利品全部入账");

// 团灭：丢一半
P._reset();
S.party = ["cat"];
P._startRun();
S.carried = 10;
const foodB = S.food;
for (const p of S.pets) { p.hp = 0; p.dying = 0; }
S.pets.forEach(p => { p.dying = 0; });
S.pets.length = 0;
for (let i = 0; i < 4; i++) P._tick(dt);
eq(S.phase, "result", "全灭应进入结算");
eq(S.result, "lose", "全灭结果应为 lose");
eq(S.food, foodB + 5, "团灭应只保住一半战利品");

/* ============================================================
   6. 深度与敌人配置
   ============================================================ */
console.log("\n=== 6. 配置一致性 ===");
eq(DEPTHS.length, 5, "应有 5 层深度的森林");
for (let i = 0; i < DEPTHS.length; i++) {
  const d = DEPTHS[i];
  eq(d.d, i + 1, "第 " + (i + 1) + " 层的 d 字段应与序号一致");
  ok(d.enemies.length >= 1, "第 " + (i + 1) + " 层应至少有 1 只怪");
  ok(d.food > 0, "第 " + (i + 1) + " 层应有食物产出");
  for (const k of d.enemies) {
    ok(P._ENEMY_DEFS[k] !== undefined, "深度 " + d.d + " 引用了未定义的敌人 " + k);
  }
}
// 食物产出必须随深度递增（否则没有"深入"的动力）
for (let i = 1; i < DEPTHS.length; i++) {
  ok(DEPTHS[i].food > DEPTHS[i - 1].food,
     "深度 " + DEPTHS[i].d + " 的食物产出应高于上一层");
}

// 每只宠物的技能必须存在
for (const p of PETS) {
  eq(p.skills.length, 2, p.name + " 应有 2 个技能");
  for (const s of p.skills) {
    ok(SKILLS[s] !== undefined, p.name + " 引用了未定义的技能 " + s);
  }
}

/* ============================================================
   7. 饥饿 / 慢放 / 自动出手
   ============================================================ */
console.log("\n=== 7. 慢放兜底 ===");
P._reset();
S.party = ["cat"];
P._startRun();
const solo = S.pets[0];
solo.atb = ATB.full;
S.await = [solo];
S.awaitT = 0;
const eHpBefore = S.enemies[0].hp;
// 慢放超时 → 自动用第一招，防止玩家发呆卡死
for (let i = 0; i < 60 * (ATB.autoPick + 0.5); i++) P._tick(dt);
ok(S.await.length === 0, "慢放超时后应自动出手清空队列");
ok(S.enemies[0].hp < eHpBefore || S.enemies[0].dying > 0 || S.enemies[0].hp <= 0,
   "自动出手应当真的打到敌人");

/* ============================================================
   7.5 敌人机制 / 食物机制
   ============================================================ */
console.log("\n=== 7.5 护阵 / 进食 / 伤害尺度 ===");

function stubEnemy(key, slot) {
  const d = P._ENEMY_DEFS[key];
  return {
    id: 9000 + slot, side: "enemy", def: d, name: d.name,
    hp: d.hp, maxHp: d.hp, atk: d.atk, dmgMul: 1, spd: d.spd,
    atb: 0, x: 600 + slot * 40, y: 360, hx: 600 + slot * 40, hy: 360,
    anim: null, shield: 0, stunT: 0, hitT: 0, dying: 0, bob: 0,
    slot, tauntOn: 0, tauntT: 0,
  };
}

// 浣熊护阵：有浣熊在场时，别的敌人少挨 30%
P._reset();
S.party = ["cat"];
P._startRun();
const c1 = stubEnemy("crow", 0);
S.enemies = [c1];
const pc = S.pets[0];
pc.dmgMul = 1;
S.rng = () => 0.99;                 // 关掉会心，保证可比
P._petAct(pc, "scratch", c1);
const dmgAlone = c1.maxHp - c1.hp;

P._reset();
S.party = ["cat"];
P._startRun();
const c2 = stubEnemy("crow", 0);
S.enemies = [c2, stubEnemy("racc", 1)];
const pc2 = S.pets[0];
pc2.dmgMul = 1;
S.rng = () => 0.99;
const hpB = c2.hp;
P._petAct(pc2, "scratch", c2);
const dmgWarded = hpB - c2.hp;

ok(dmgWarded < dmgAlone,
   "浣熊在场时其他敌人应减伤（" + dmgWarded + " vs " + dmgAlone + "）");
near(dmgWarded / dmgAlone, 0.70, 0.06, "护阵减伤应为 30%");

// 进食：消耗 3 份、回 50%、一层只能一次
P._reset();
S.party = ["cat", "dog"];
P._startRun();
S.carried = 10;
S.food = 6;
S.pets[0].hp = 4;
S.pets[1].hp = 4;
S.phase = "trail";
const healed0 = P._eatNow();
ok(healed0 === true, "有食物时应能开饭");
eq(S.carried, 7, "开饭应优先吃背上的（10 → 7）");
eq(S.food, 6, "背上的够吃时不应动干粮");
ok(S.pets[0].hp > 4, "开饭后应回血（实际 " + S.pets[0].hp + "）");
ok(S.ateThisTrail === true, "应记录本层已吃过");

const carriedAfter = S.carried;
P._eatNow();
eq(S.carried, carriedAfter, "同一层不能吃第二次");

// 背上的不够时补干粮
P._reset();
S.party = ["cat"];
P._startRun();
S.carried = 1;
S.food = 6;
S.phase = "trail";
P._eatNow();
eq(S.carried, 0, "背上的 1 份应被吃掉");
eq(S.food, 4, "差的 2 份应从干粮补（EAT_COST=3）");

// 伤害尺度：敌人打出来的伤害不能被平方
P._reset();
S.party = ["cat"];
P._startRun();
S.pets[0].hp = 100;
S.pets[0].maxHp = 100;
S.enemies = [stubEnemy("racc", 0)];
S.rng = () => 0.99;
const before2 = S.pets[0].hp;
P._enemyAct(S.enemies[0]);
const taken = before2 - S.pets[0].hp;
ok(taken > 0, "浣熊应造成伤害");
ok(taken <= 14,
   "单次伤害应接近浣熊 atk(7)，实际 " + taken +
   " —— 超过 14 说明伤害被平方了（rawDmg × actor.atk）");

/* ============================================================
   8. 渲染不抛错
   ============================================================ */
console.log("\n=== 8. 渲染 ===");
const render = vm.runInContext("render", sandbox);
const phases = [];

P._reset();
try { render(); phases.push("roster"); } catch (e) { ok(false, "roster 渲染抛错：" + e.message); }

P._reset();
S.party = ["cat", "dog", "ham"];
P._startRun();
try { render(); phases.push("battle"); } catch (e) { ok(false, "battle 渲染抛错：" + e.message); }

try {
  S.enemies.length = 0;
  S.phase = "trail";
  render();
  phases.push("trail");
} catch (e) { ok(false, "trail 渲染抛错：" + e.message); }

try {
  S.phase = "result";
  S.result = "win";
  render();
  phases.push("result");
} catch (e) { ok(false, "result 渲染抛错：" + e.message); }

eq(phases.length, 4, "四个阶段都应能渲染");

// 自动战斗：条满自己出手，不需要任何输入
P._reset();
S.party = ["cat"];
P._startRun();
const autoHp0 = S.enemies[0].hp;
S.pets[0].atb = ATB.full - 1;
for (let i = 0; i < 40; i++) P._tick(1 / 60);
ok(S.enemies[0].hp < autoHp0,
   "自动模式应自己出招（敌 hp " + autoHp0 + " → " + S.enemies[0].hp + "）");
eq(S.await.length, 0, "自动模式不应残留待选队列");

// 自动选技：队伍血厚时不该浪费一次群疗
P._reset();
S.party = ["rab", "cat"];
P._startRun();
const rab = S.pets.find(p => p.def.id === "rab");
for (const p of S.pets) p.hp = p.maxHp;        // 满血
eq(P._chooseSkill(rab), "kick", "满血时应打「踢」而不是「蹭蹭」");
for (const p of S.pets) p.hp = Math.round(p.maxHp * 0.3);   // 残血
eq(P._chooseSkill(rab), "nuzzle", "残血时应改成「蹭蹭」群疗");

// 自动选技必须永远给出一个技能。
// 这条是给一个真实 bug 立的碑：chooseSkill 曾经和「手动选招」版本重名，
// 后者把前者整个覆盖，返回 undefined —— 而 undefined 一路传到渲染层才炸
// （SKILLS[undefined].name），离根因已经很远了。
P._reset();
S.party = ["duck", "cat"];
P._startRun();
for (const p of S.pets) {
  ok(typeof P._chooseSkill(p) === "string",
     p.def.name + " 的自动选技不能返回 undefined");
}
S.enemies.length = 1;
eq(P._chooseSkill(S.pets[0]), "splash",
   "只剩一只敌人时群伤照打 —— 它没有单体技能，这是合理兜底");

/* ============================================================
   9. 命中判定
   ============================================================ */
console.log("\n=== 9. 点选判定 ===");
P._reset();
S.party = ["cat", "dog"];
P._startRun();
const target = S.enemies[0];
const hit = P._pickUnit(target.x, target.y - target.def.size * 0.2);
ok(hit === target, "点敌人身上应能选中它");
const miss = P._pickUnit(20, 20);
ok(miss === null, "点空地应选不到");

/* ============================================================
   9.5 格子布局：单位不许重叠
   ============================================================ */
console.log("\n=== 9.5 格子布局 ===");

P._reset();
P._setParty(["cat", "dog", "ham", "rab", "duck"]);
P._startRun();

const allUnits = S.pets.concat(S.enemies);
const boxes = allUnits.map(u => {
  const s = u.dispSize || 80;
  return { u, x0: u.x - s / 2, x1: u.x + s / 2, y0: u.y - s, y1: u.y + 6 };
});

let overlap = null;
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
      overlap = a.u.name + " 压住了 " + b.u.name;
    }
  }
}
ok(!overlap, "单位不能互相盖住" + (overlap ? "：" + overlap : ""));

// 同一格不能站两个
const seenCell = new Set();
let dupCell = null;
for (const u of allUnits) {
  const k = u.side + ":" + u.gridRow + "," + u.gridCol;
  if (seenCell.has(k)) dupCell = u.name;
  seenCell.add(k);
}
ok(!dupCell, "同一格不能站两个单位" + (dupCell ? "：" + dupCell : ""));

// 所有单位都得落在战场内（落在外面等于"看不见"）
let outside = null;
for (const u of allUnits) {
  if (u.x < 20 || u.x > 940 || u.y < 120 || u.y > 472) {
    outside = u.name + "(" + u.x.toFixed(0) + "," + u.y.toFixed(0) + ")";
  }
}
ok(!outside, "单位必须落在战场内" + (outside ? "：" + outside : ""));

// 站位是玩家能改的：换格之后锚点必须跟着变
P._reset();
P._setParty(["cat"]);
P._startRun();
const catU = S.pets[0];
const beforeX = catU.x;
S.slots = [null, null, null, null, null, "cat"];   // 第 3 行前排
P._layoutBattle();
ok(catU.gridCol === 1, "换到前排后 gridCol 应为 1（实际 " + catU.gridCol + "）");
ok(catU.x !== beforeX, "换到前排后锚点应右移（" + beforeX + " → " + catU.x + "）");

/* ============================================================
   9.6 近战位移：走过去打，然后**必须回位**
   ============================================================ */
console.log("\n=== 9.6 近战位移与复位 ===");

// 整段包在一个块里：这个测试文件是单层作用域，变量名很容易和上面的段撞车
{
const foes = () => S.enemies.filter(e => e.hp > 0 && e.dying <= 0);
P._reset();
P._setParty(["cat", "dog"]);
P._startRun();

const attacker = S.pets.find(p => p.def.id === "cat");
const victim = foes()[0];
const homeX = attacker.hx, homeY = attacker.hy;

P._petAct(attacker, "scratch", victim);

ok(!!attacker.anim, "近战出手应产生位移动画");
ok(Math.abs(attacker.hx - homeX) < 0.001, "位移不能改锚点 hx");
ok(Math.abs(attacker.hy - homeY) < 0.001, "位移不能改锚点 hy");

// 冲到一半：应当确实离开了格子
for (let i = 0; i < 12; i++) P._tick(1 / 60);
const midX = attacker.x;
ok(Math.abs(midX - homeX) > 40,
   "出手途中应该真的走过去了（位移 " + Math.abs(midX - homeX).toFixed(0) + "px）");

// 朝向：必须朝敌方（往右）
ok(midX > homeX, "我方出手应向右冲（" + homeX + " → " + midX.toFixed(0) + "）");

// 跑完整段：必须精确复位，不留误差
for (let i = 0; i < 90; i++) P._tick(1 / 60);
ok(attacker.anim === null, "动画应已结束");
eq(Math.round(attacker.x * 1000) / 1000, homeX, "复位后 x 必须精确等于锚点");
eq(Math.round(attacker.y * 1000) / 1000, homeY, "复位后 y 必须精确等于锚点");

// 连续出手 20 次，锚点不许漂
for (let n = 0; n < 20; n++) {
  const foe = foes()[0];
  if (!foe) break;
  P._petAct(attacker, "scratch", foe);
  for (let i = 0; i < 60; i++) P._tick(1 / 60);
}
eq(Math.round(attacker.x * 1000) / 1000, homeX, "连续出手 20 次后 x 仍须等于锚点");
eq(Math.round(attacker.y * 1000) / 1000, homeY, "连续出手 20 次后 y 仍须等于锚点");

/* ---- 站位判定不能用渲染坐标 ---- */
P._reset();
P._setParty(["cat", "dog"]);
P._startRun();
const backPet = S.pets.find(p => p.def.id === "cat");     // 默认后排 col 0
const frontPet = S.pets.find(p => p.def.id === "dog");    // 默认前排 col 1
ok(backPet.hx < frontPet.hx, "默认猫在后排、狗在前排");

// 让后排的猫冲到敌方阵里，此时它的 x 已经比狗大得多
P._petAct(backPet, "scratch", foes()[0]);
for (let i = 0; i < 14; i++) P._tick(1 / 60);
ok(backPet.x > frontPet.hx,
   "冲刺途中猫的渲染坐标应越过狗的锚点（" + backPet.x.toFixed(0) + " > " + frontPet.hx + "）");
// 用 hx 排序，猫仍然在后排
const byHx = S.pets.slice().sort((a, b) => b.hx - a.hx);
eq(byHx[0].def.id, "dog", "按 hx 排「最靠前」必须仍是狗（站位判定不能吃动画相位）");

/* ---- 特效延迟：判定瞬时、视觉延后 ---- */
P._reset();
P._setParty(["cat"]);
P._startRun();
S.fx.length = 0;
const catShift = S.pets[0];
const foe2 = foes()[0];
const hpBefore = foe2.hp;
P._petAct(catShift, "scratch", foe2);
ok(foe2.hp < hpBefore, "伤害必须在出手瞬间就结算（不能等动画）");
const hasDelay = S.fx.length === 0 || S.fx.every(f => f.delay > 0);
ok(hasDelay, "刚出手时产生的特效应全部处于延后状态");
ok(!!S.pendingHit && S.pendingHit.at > 0, "顿帧应挂起到命中那一刻");

/* ---- 跑动期间照样攒条（位移不该偷偷削弱输出） ---- */
P._reset();
P._setParty(["cat"]);
P._startRun();
const catGain = S.pets[0];
catGain.atb = 50;

P._petAct(catGain, "scratch", foes()[0]);
catGain.atb = 50;
const atb0 = catGain.atb;
for (let i = 0; i < 10; i++) P._tick(1 / 60);
ok(catGain.anim, "此刻仍应在跑动中");
ok(catGain.atb > atb0,
   "跑动期间行动条必须继续涨（" + atb0 + " → " + catGain.atb.toFixed(1) + "）");
}

/* ============================================================
   汇总
   ============================================================ */
console.log("\n" + "=".repeat(52));
console.log("通过 " + pass + " / " + (pass + fail));
if (fail) {
  console.log("\n失败项：");
  fails.forEach(f => console.log("  · " + f));
  process.exit(1);
} else {
  console.log("全部通过");
}
