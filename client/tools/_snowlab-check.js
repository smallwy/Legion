/* ===========================================================================
   snowlab.html 的 headless 验收
   ---------------------------------------------------------------------------
   沙箱里跑不了浏览器，所以逻辑断言走 jsdom：把内联脚本提取出来丢进 jsdom 执行，
   然后从 window.SNOWLAB 拿测试出口，直接驱动 step() 跑物理。

   **这个脚本守的是"闭环能不能成立"，不是"好不好玩"。**
   手感（震屏够不够、球滚起来爽不爽）只能人看，机器只能守住数值和通路。

   跑法：node client/tools/_snowlab-check.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");

let pass = 0, fail = 0;
const bad = [];
function ck(name, ok, detail) {
  if (ok) { pass++; console.log("  ✓ " + name); }
  else { fail++; bad.push(name); console.log("  ✗ " + name + (detail !== undefined ? "  → " + detail : "")); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.01 : tol); }
function group(t) { console.log("\n" + t); }

/* ---------------------------------------------------------------- 载入 */
const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("✗ 找不到内联脚本"); process.exit(1); }

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
// jsdom 没有 canvas：getContext 会抛 / 返回 null，脚本里已经降级处理
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;

const errs = [];
window.addEventListener("error", e => errs.push(e.message));
try { window.eval(m[1]); } catch (e) { console.log("✗ 脚本执行抛错: " + e.message); process.exit(1); }

const L = window.SNOWLAB;
ck("脚本加载未抛错", errs.length === 0, errs.join("; "));
if (!L) { console.log("✗ 没有 SNOWLAB 出口"); process.exit(1); }

const { NUM, S } = L;
const DT = 1 / 60;

/** 把世界推到稳定（敌人落地、箱子落定） */
function settle(n) { for (let i = 0; i < (n || 40); i++) L.step(DT); }

/** 找一口指定材质的箱子 */
function findBox(mat, pred) {
  return S.boxes.filter(b => !b.dead && b.mat === mat && (!pred || pred(b)))[0];
}

/* =========================================================================
   一、关卡生成不变量（扫 200 个种子）
   ---------------------------------------------------------------------------
   **这一节是这一版最要紧的测试。** 关卡从手写坐标改成程序生成之后，
   "随机"就一定会有生成出死局的那一次 —— 撞在最难复现、也最要命的地方。
   所以不能只验当前这一关，要扫一批种子，每一个都必须满足：
   掉得下去、接得住、凑得够、走得到。
   ========================================================================= */
group("一、关卡生成不变量（200 个种子）");
const NSEED = 200;
let gOK = 0;
const gBad = [];
const nfHist = {};
const coverHist = {};
let rampTotal = 0, boxTotal = 0;
for (let sd = 1; sd <= NSEED; sd++) {
  const g = L.genLevel(sd);
  if (L.validateLevel(g)) gOK++; else gBad.push(sd);
  nfHist[g.nFloors] = (nfHist[g.nFloors] || 0) + 1;
  boxTotal += g.boxes.length;
  g.layers.forEach(l => {
    l.holes.forEach(h => { coverHist[h.cover] = (coverHist[h.cover] || 0) + 1; });
    l.terrain.forEach(t => { if (t.kind === "ramp") rampTotal++; });
  });
}
ck(NSEED + " 个种子全部通过校验", gOK === NSEED, (NSEED - gOK) + " 个没过: " + gBad.slice(0, 8).join(","));
/* 层数收到 3~5（4 层占一半）。**层数一多，每层的箱子就被摊薄** ——
   4~8 层时越深的层越空，正好和"很多木箱"相反。 */
ck("层数 3~5，而且每个档都出现过", Object.keys(nfHist).length >= 3 &&
   Object.keys(nfHist).every(k => +k >= 3 && +k <= 5), JSON.stringify(nfHist));
ck("三种封口方式都出现过（不是每层都同一招）",
   coverHist.frost > 0 && coverHist.ice > 0 && coverHist.none > 0, JSON.stringify(coverHist));
/* 阈值 1.2：平均每关一条半。**不是每层都有坡** ——
   落点带（上一层洞口正下方）不能放平台和坡，不然掉下来会被接在半空；
   剩下的可放位置本来就不多，硬要每层都塞会挤掉高台。 */
ck("斜坡平均每关 " + (rampTotal / NSEED).toFixed(1) + " 条（地形不止平台）",
   rampTotal / NSEED > 1.2, (rampTotal / NSEED).toFixed(2));
ck("箱子平均每关 " + (boxTotal / NSEED).toFixed(1) + " 口", boxTotal / NSEED > 50, (boxTotal / NSEED).toFixed(1));

/* 上面是一条大 bool，只知道"没通过"，不知道踩了哪条。
   这里把四条硬不变量各自单列，红的时候能直接指出是哪一条。 */
let badOverlap = 0, badCatch = 0, badFoe = 0, badFeed = 0;
for (let sd = 1; sd <= NSEED; sd++) {
  const g = L.genLevel(sd);
  const N = g.floors.length;
  for (let k = 0; k + 1 < N; k++) {
    for (const p of g.layers[k].holes) for (const q of g.layers[k + 1].holes) {
      if (p.x < q.x + q.w + 24 && q.x < p.x + p.w + 24) badOverlap++;
    }
  }
  for (let k = 0; k + 1 < N; k++) {
    const next = g.layers[k + 1].segs;
    for (const h of g.layers[k].holes) for (const px of [h.x + 20, h.x + h.w - 20]) {
      if (!next.some(s => px >= s.x && px <= s.x + s.w)) badCatch++;
    }
  }
  const lastY = g.floors[N - 1];
  /* **按 layer 判层，不能按 y 阈值**：怪会站在 2 格箱顶上（y 比地板高 96），
     用 y 判会把它算成"不在门厅"，200 关里有 110 关被误判。 */
  if (g.spawns.filter(s => s.layer === N - 1).length < NUM.killTarget) badFoe++;
  if (g.boxes.filter(b => b.mat === "wood" && !b.frost && b.y >= lastY - 60 && b.y <= lastY).length < 3) badFeed++;
}
ck("★ 相邻两层的洞从不重叠（否则一次掉两层）", badOverlap === 0, badOverlap);
ck("★ 每个洞正下方都接得住", badCatch === 0, badCatch);
ck("★ 每关门厅怪数都 >= killTarget（单向关卡的死局线）", badFoe === 0, badFoe);
ck("★ 每关门厅都有 3 口喂球箱（清光怪之后的活路）", badFeed === 0, badFeed);

/* =========================================================================
   二、当前关卡
   ========================================================================= */
group("二、当前关卡");
/* 挑一个"地表第一层是霜箱封口"的种子 —— 第十九节要测"喷侧面 → 整排塌"，
   那一层换成冰封或敞开的洞，这个动作根本不存在，测了也是假绿。 */
let SEED = 1;
for (let s = 1; s < 300; s++) {
  const g = L.genLevel(s);
  const h0 = g.layers[0].holes;
  if (h0.length === 1 && h0[0].cover === "frost" && h0[0].w >= 96) { SEED = s; break; }
}
L.reset(SEED);
ck("seed " + SEED + "：层数 " + L.FLOORS.length + "（4~8）", L.FLOORS.length >= 4 && L.FLOORS.length <= 8, L.FLOORS.length);
ck("世界高 = 最后一层 + 80", L.WORLD_H === L.GROUND_Y + 80, L.WORLD_H + " / " + L.GROUND_Y);
ck("相邻层高差恒为 240（跳不回去的硬约束）",
   L.FLOORS.every((y, i) => i === 0 || y - L.FLOORS[i - 1] === 240), L.FLOORS.join(","));
ck("弹药 100", S.ammo === 100, S.ammo);
ck("饱食 100（满饱）", S.belly === 100, S.belly);
ck("体力 3", S.hp === NUM.hpStart, S.hp);
ck("击杀目标 = 3", S.killedTarget === NUM.killTarget && NUM.killTarget === 3, S.killedTarget);
ck("门初始锁着且藏在外壳里", S.door.open === false && L.doorBlocked() === true);
ck("场上 " + S.foes.length + " 只怪，每层都有",
   L.FLOORS.every((top, k) => S.foes.some(f => f.y > (k ? L.FLOORS[k - 1] : 0) && f.y <= top)));
ck("箱子 " + S.boxes.length + " 口（每层至少 8 口）", S.boxes.length >= L.FLOORS.length * 8, S.boxes.length);
ck("覆霜箱都是木箱（霜只标路，不标硬度）", S.boxes.filter(b => b.frost).every(b => b.mat === "wood"));
settle(60);

/* =========================================================================
   二、材质 × 破坏通道（这是整套设计的地基）
   ========================================================================= */
group("二、材质 × 破坏通道");

// 木箱：子弹 3 发碎
L.reset(); settle(30);
let wb = findBox("wood");
ck("木箱 HP = 3", wb && NUM.box.wood.hp === 3, wb && wb.hp);
L.shotBox(wb, { x: wb.x + 24, y: wb.y + 24 });
L.shotBox(wb, { x: wb.x + 24, y: wb.y + 24 });
ck("木箱吃 2 发还活着", !wb.dead, "hp=" + wb.hp);
L.shotBox(wb, { x: wb.x + 24, y: wb.y + 24 });
ck("木箱吃第 3 发碎掉", wb.dead === true);

// 石箱：子弹完全无效
L.reset(); settle(30);
let sb = findBox("stone");
const sbHP = sb.hp;
for (let i = 0; i < 20; i++) L.shotBox(sb, { x: sb.x + 24, y: sb.y + 24 });
ck("石箱吃 20 发子弹不碎", sb.dead === false);
ck("石箱 HP 记成 Infinity", sbHP === Infinity, String(sbHP));

// 铁箱：同上
L.reset(); settle(30);
let ib = findBox("iron");
for (let i = 0; i < 20; i++) L.shotBox(ib, { x: ib.x + 24, y: ib.y + 24 });
ck("铁箱吃 20 发子弹不碎", ib.dead === false);

/* =========================================================================
   三、包裹发数三档 6 / 4 / 10
   ========================================================================= */
group("三、包裹发数三档（6 / 4 / 10）");
function coatCountFor(belly) {
  L.reset(); settle(20);
  S.belly = belly;
  const f = L.spawnFoe(400, L.GROUND_Y - 30, "crawler");
  const need = L.snowNeed();
  for (let i = 0; i < need - 1; i++) L.coatFoe(f, 1);
  const aliveBefore = !f.dead;
  L.coatFoe(f, 1);
  return { need, aliveBefore, dead: f.dead, balls: S.balls.length };
}
let r1 = coatCountFor(100);
ck("满饱 need = 6", r1.need === 6, r1.need);
ck("满饱 5 发还不成球", r1.aliveBefore === true);
ck("满饱 6 发成球", r1.dead === true && r1.balls === 1, r1.balls);

let r2 = coatCountFor(50);
ck("半饱 need = 4", r2.need === 4, r2.need);
ck("半饱 3 发还不成球", r2.aliveBefore === true);
ck("半饱 4 发成球", r2.dead === true && r2.balls === 1);

let r3 = coatCountFor(10);
ck("全饿 need = 10", r3.need === 10, r3.need);
ck("全饿 9 发还不成球", r3.aliveBefore === true);
ck("全饿 10 发成球", r3.dead === true && r3.balls === 1);

// 档位边界
L.reset();
S.belly = 70; ck("饱食 70 = 满饱（边界含）", L.bellyTier() === "full", L.bellyTier());
S.belly = 69.9; ck("饱食 69.9 = 半饱", L.bellyTier() === "half", L.bellyTier());
S.belly = 35; ck("饱食 35 = 半饱（边界含）", L.bellyTier() === "half", L.bellyTier());
S.belly = 34.9; ck("饱食 34.9 = 全饿", L.bellyTier() === "hungry", L.bellyTier());

/* =========================================================================
   四、球 × 材质（用户拍板的三档强制力）
   ========================================================================= */
group("四、球 × 材质");

/** 造一颗球水平撞向某口箱，返回撞后状态 */
function swingAt(box, vx, absorbed) {
  L.reset(); settle(20);
  const b = L.spawnBall(box.x - 30, box.y + box.h / 2, vx, absorbed);
  for (let i = 0; i < 40 && !box.dead && !b.dead; i++) L.step(DT);
  return { box, ball: b };
}

/* **每个子测试都清场 + 只造一口箱子。**
   球撞碎箱子之后会带着衰减速度继续滚，场上只要还有第二口，
   量到的就是"撞了两口之后"的速度 —— 第一版在这里假红过
   （82% 的穿透保留量成了 31%，看起来像参数错了，其实是撞了两次）。 */
function soloBox(mat, x) {
  L.reset(); settle(10);
  S.foes.length = 0;
  S.boxes.forEach(b => { b.dead = true; });
  const bx = { x: x == null ? 700 : x, y: L.GROUND_Y - 48, w: 48, h: 48, mat,
               hp: NUM.box[mat].hp, dead: false, hitT: 0, frost: false };
  S.boxes.push(bx);
  return bx;
}

// 木箱：站立推即碎
let wb2 = soloBox("wood");
let b1 = L.spawnBall(wb2.x - 30, wb2.y + 24, 620, 1);
for (let i = 0; i < 20 && !wb2.dead; i++) L.step(DT);
ck("木箱：站立推球即碎", wb2.dead === true);
ck("木箱：碎后球还在（穿透）", b1.dead === false);
ck("木箱：穿透保留 82% 速度", near(Math.abs(b1.vx), 620 * NUM.box.wood.keepSpeed, 20), Math.round(Math.abs(b1.vx)));

// 石箱：站立推（620）够
let st = soloBox("stone");
let b2 = L.spawnBall(st.x - 30, st.y + 24, 620, 1);
for (let i = 0; i < 20 && !st.dead; i++) L.step(DT);
ck("石箱：站立推球（pow 620）能碎", st.dead === true);

// 铁箱：站立推不够，助跑够
let ir = soloBox("iron");
let b3 = L.spawnBall(ir.x - 30, ir.y + 24, 620, 1);
for (let i = 0; i < 20 && !ir.dead; i++) L.step(DT);
ck("铁箱：站立推（pow 620 < 1150）砸不动", ir.dead === false);
ck("铁箱：砸不动会反弹", b3.vx < 0, Math.round(b3.vx));

let ir2 = soloBox("iron");
let b4 = L.spawnBall(ir2.x - 30, ir2.y + 24, 1209, 1);
for (let i = 0; i < 20 && !ir2.dead; i++) L.step(DT);
ck("铁箱：助跑推（pow 1209）能碎", ir2.dead === true);

// 冰墙：小球高速不够，特大球够
let ice = soloBox("ice");
let b5 = L.spawnBall(ice.x - 30, ice.y + 24, 1209, 1);
for (let i = 0; i < 20 && !ice.dead; i++) L.step(DT);
ck("冰墙：小球助跑（pow 1209）砸不动", ice.dead === false);

let ice2 = soloBox("ice");
let b6 = L.spawnBall(ice2.x - 40, ice2.y + 24, 1209, 6);
for (let i = 0; i < 20 && !ice2.dead; i++) L.step(DT);
ck("冰墙：特大球助跑（pow > 1550）能碎", ice2.dead === true);

/* =========================================================================
   五、球档位与动量
   ========================================================================= */
group("五、球档位与动量");
L.reset();
ck("卷 0 只 = 小档", L.ballTier(0) === 0);
ck("卷 2 只 = 中档", L.ballTier(2) === 1);
ck("卷 4 只 = 大档", L.ballTier(4) === 2);
ck("卷 6 只 = 特大档", L.ballTier(6) === 3);
ck("半径随卷人数涨", L.ballR(6) > L.ballR(0), L.ballR(0) + " → " + L.ballR(6));
ck("半径有上限 46", L.ballR(99) === 46, L.ballR(99));

/* =========================================================================
   六、球碾敌 = 唯一击杀通道
   ========================================================================= */
group("六、球碾敌");
L.reset(); settle(20);
/* 清场。不清的话球会一路碾过去连杀几只，`killed === killedBefore + 1` 就假失败。 */
S.foes.length = 0;
/* **门厅的箱子也要清掉。** 箱子随机生成，球滚过去可能先撞箱再撞怪，
   `killed` 就不会在这一帧涨 —— 那是测试被布局干扰，不是机制坏了。 */
S.boxes.forEach(b => { b.dead = true; });
/* **位置要挑门壳左边的空地。** 门壳在 doorX-48 ~ doorX+48，每关不同；
   球生在壳里会被顶出来，测出来就是"球没动、怪没死"。 */
const runX = Math.max(80, Math.min(360, S.door.x - 380));
let tf = L.spawnFoe(runX + 90, L.GROUND_Y - 30, "crawler");
tf.vx = 0; tf.speed = 0;
const killedBefore = S.killed;
let mb = L.spawnBall(runX, L.GROUND_Y - L.ballR(1), 700, 1);
for (let i = 0; i < 60 && S.killed === killedBefore; i++) L.step(DT);
ck("球滚过敌人 = 击杀", S.killed === killedBefore + 1, S.killed);
ck("击杀后球变大（吸收）", mb.absorbed >= 2, mb.absorbed);

/* =========================================================================
   七、子弹不杀生（雪弹只加雪点）
   ========================================================================= */
group("七、子弹不杀生");
L.reset(); settle(20);
S.boxes.forEach(b => { b.dead = true; });
let nf = L.spawnFoe(620, L.GROUND_Y - 30, "crawler");
S.belly = 100;
for (let i = 0; i < 5; i++) L.coatFoe(nf, 1);
ck("敌人吃 5 层雪仍未被杀", nf.dead === false && S.killed === 0, "dead=" + nf.dead + " killed=" + S.killed);
ck("雪弹本身不产生击杀数", S.stat.kills === 0, S.stat.kills);

/* =========================================================================
   八、箱子挡子弹
   ========================================================================= */
group("八、箱子挡子弹");
L.reset(); settle(20);
/* 只留一口木箱。留一片箱群的话，子弹打到的是**前面那口**而不是被测的那口 ——
   第一版就是在这里假绿的（敌人确实没吃到雪，但被测箱子的 HP 一点没掉，
   因为子弹被隔壁箱子吃了）。 */
/* 门厅地面上的木箱（和玩家同一水平线）。**位置每关都不一样，只能动态找。**
   优先级：门左半边的 —— 右边是门壳，站在门壳左边开枪等于隔墙打。 */
const hallY = L.GROUND_Y - 48;
const blocker = S.boxes.filter(b => !b.dead && b.mat === "wood" && b.y === hallY && b.x < S.door.x - 96)[0]
             || S.boxes.filter(b => !b.dead && b.mat === "wood" && b.y === hallY)[0]
             || S.boxes.filter(b => !b.dead && b.mat === "wood")[0];
ck("场上还有木箱可测", !!blocker);
S.boxes.forEach(b => { if (b !== blocker) b.dead = true; });
S.foes.length = 0;                       // 场上的怪会替箱子吃子弹，必须清掉
const behind = L.spawnFoe(blocker.x + blocker.w + 6, blocker.y + blocker.h - 30, "crawler");
behind.vx = 0; behind.speed = 0;
const hitsBefore = behind.hits;
const hpBefore2 = blocker.hp;
S.p.x = blocker.x - 72; S.p.y = blocker.y + blocker.h - S.p.h; S.p.vx = 0; S.p.vy = 0; S.p.face = 1;
S.ammo = 100;
L.shoot();
for (let i = 0; i < 30; i++) L.step(DT);
ck("子弹被箱子吃掉（敌人没吃到雪）", behind.hits === hitsBefore, "hits=" + behind.hits);
ck("箱子掉了 1 点 HP", blocker.hp === hpBefore2 - 1, blocker.hp + " / 原 " + hpBefore2);
ck("箱子还没碎（1 发不够）", blocker.dead === false);

/* =========================================================================
   九、掉弹经济：球砸才回本
   ========================================================================= */
group("九、掉弹经济（球砸才回本）");
function shardRate(how, n) {
  L.reset(); settle(10);
  let got = 0;
  for (let i = 0; i < n; i++) {
    // 直接造一口临时木箱来砸，绕开场景限制
    const bx = { x: 500, y: 400, w: 48, h: 48, mat: "wood", hp: 3, dead: false, hitT: 0 };
    S.boxes.push(bx);
    S.shards = [];
    L.breakBox(bx, how);
    if (S.shards.length > 0) got++;
  }
  return got / n;
}
const rateBall = shardRate("ball", 1500);
const rateShot = shardRate("shot", 1500);
ck("球砸碎掉碎片率 ≈ 40%", rateBall > 0.34 && rateBall < 0.46, (rateBall * 100).toFixed(1) + "%");
ck("子弹砸碎掉碎片率 ≈ 10%", rateShot > 0.06 && rateShot < 0.15, (rateShot * 100).toFixed(1) + "%");
ck("球砸的回本是子弹的 3 倍以上", rateBall > rateShot * 3, (rateBall / rateShot).toFixed(1) + "×");

/* =========================================================================
   十、弹药经济核算
   ========================================================================= */
group("十、弹药经济核算");
L.reset();
const woodCount = S.boxes.filter(b => b.mat === "wood").length;
/* 怪的数量是随机的（4~8 层，每层 1~3 只），所以这里只验**关系**，不验绝对值。 */
const allFoeShots = S.foes.length * NUM.snowShots.full;
const spare = NUM.ammoStart - allFoeShots;
const canBreak = Math.floor(spare / NUM.box.wood.hp);
ck(S.foes.length + " 只怪全冻 = " + allFoeShots + " 发", allFoeShots === S.foes.length * 6, allFoeShots);
ck("剩下 " + spare + " 发只够砸 " + canBreak + " 口木箱（用子弹开路走不完）",
   canBreak < woodCount, canBreak + " vs " + woodCount);
ck("场上有 " + woodCount + " 口木箱，子弹砸不完（缺口 " + (woodCount - canBreak) + " 口）",
   woodCount > canBreak && woodCount - canBreak >= 5, woodCount + " vs " + canBreak);
ck("「全部用子弹开路」走不到头 → 必须用球", woodCount * NUM.box.wood.hp + allFoeShots > NUM.ammoStart,
   woodCount * NUM.box.wood.hp + allFoeShots);

/* =========================================================================
   十一、门：藏在冰封圣箱里 → 砸开才露出 → 杀够才解锁 → 碰门过关
   ========================================================================= */
group("十一、门（藏箱 / 露出 / 解锁 / 过关）");
L.reset(); settle(20);
ck("门初始被冰墙盖着（看不见、也碰不到）", L.doorBlocked() === true);

/* **门壳那一列的 x 是随机的，必须从 S.door 推。** 写死 840 的断言
   在门开在别处时全都是假绿 —— 它数的是"840 有没有冰箱"，不是"门有没有壳"。
   另外**必须按层筛 y**：`x` 是全球共用的，下面某一层的"冰封洞口"完全可能
   和门开在同一列，只按 x 数会把那两格冰墙也算进门壳里（实测数到 4）。 */
const hallFloorY = S.door.y + S.door.h;
const shells = S.boxes.filter(b => b.mat === "ice" && b.x === S.door.x &&
  b.y + b.h <= hallFloorY + 1 && b.y >= hallFloorY - 96 - 1);
ck("门的外壳正好 2 口冰箱", shells.length === 2, shells.length);
ck("外壳盖住门的包围盒", shells.every(b => b.y + b.h > S.door.y && b.y < S.door.y + S.door.h));

shells.forEach(b => L.breakBox(b, "ball"));
for (let i = 0; i < 8; i++) L.step(DT);          // 让 stepDoor 跑起来（砸箱会带顿帧）
ck("砸开外壳 → 门露出来", L.doorBlocked() === false);
ck("露出时给了「找到门了」的飘字", S.texts.some(t => String(t.s).indexOf("找到门") >= 0),
   S.texts.map(t => t.s).join("|"));
ck("露出不等于解锁（击杀不够）", S.door.open === false, S.killed + "/" + S.killedTarget);

L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
for (let i = 0; i < 14; i++) L.step(DT);
ck("锁着时碰门不过关", S.phase === "play", S.phase);

S.killed = S.killedTarget;
L.checkDoor();
ck("击杀达标 → 门自动解锁", S.door.open === true);
L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
for (let i = 0; i < 14 && S.phase === "play"; i++) L.step(DT);
ck("碰门 → phase = clear", S.phase === "clear", S.phase);

/* =========================================================================
   十二、箱子：挡路 / 可站 / 塌落
   ========================================================================= */
group("十二、箱子挡路 / 可站 / 塌落");
L.reset(); settle(20);
/* 从门左边 300px 往右走，撞在门壳左列上。**起点必须动态** ——
   门的位置每关都变，写死 700 的话有时会站在门壳右边，一路畅通走到底。 */
L.placePlayer(Math.max(48, S.door.x - 300), L.GROUND_Y - 42);
S.keys = { d: true };
for (let i = 0; i < 120; i++) L.step(DT);
S.keys = {};
ck("玩家被冰墙挡住（左外屏障 = 门壳左边一列）",
   S.p.x + S.p.w <= S.door.x - 48 + 1, Math.round(S.p.x + S.p.w) + " vs " + (S.door.x - 48));

// 塌落：门壳左边那一列砸掉底下那口，上面那口必须掉下来
L.reset(); settle(30);
/* **必须限定在门厅这一层。** 只按 x 筛的话，别的层"冰封洞口"正好和门同列时
   也会被数进来，199 关里会数出 4 口（箱子铺满之后这个碰撞概率变得很高）。 */
const colB = S.boxes.filter(b => !b.dead && b.x === S.door.x - 48 && b.mat === "ice" &&
  b.y + b.h > L.GROUND_Y - 200).sort((a, b) => b.y - a.y);
ck("门壳左边那列是 2 口叠着", colB.length === 2, colB.length);
const aboveY0 = colB[1].y;
L.breakBox(colB[0], "ball");
for (let i = 0; i < 60; i++) L.step(DT);
ck("砸掉底箱后上面的会下落", colB[1].y > aboveY0 + 10, aboveY0 + " → " + Math.round(colB[1].y));

/* =========================================================================
   十三、贴脸保底（零弹时的唯一出路）
   ========================================================================= */
group("十三、贴脸保底");
L.reset(); settle(20);
/* **必须先把原场的怪清掉**：settle 的那 20 帧里 runner 已经追到墙角撞过玩家，
   invuln 被它占着，新放的怪这一帧就永远轮不到 —— 第一版测试就是这么假绿的。 */
S.foes.length = 0;
S.ammo = 0;
S.invuln = 0;
/* 500 是门厅的空地：168~312 是喂球箱，336~384 是回程塔，540 起是右台。 */
L.placePlayer(500, L.GROUND_Y - 42);
const p = S.p;
const bf = L.spawnFoe(p.x + 6, p.y - 4, "crawler");
bf.vx = 0; bf.speed = 0;
const hpBefore = S.hp;
L.step(DT);
ck("贴脸撞敌：自己掉 1 血", S.hp === hpBefore - 1, S.hp);
ck("贴脸撞敌：敌人吃到雪（零弹也能推进）", bf.hits >= NUM.bodyCoat, bf.hits);
S.ammo = 100;

/* =========================================================================
   十四、边界：连跑不崩
   ========================================================================= */
group("十四、边界：连跑 600 帧不崩");
L.reset();
let threw = null;
try {
  S.keys = { d: true };
  for (let i = 0; i < 300; i++) { if (i % 40 === 0) L.shoot(); L.step(DT); }
  S.keys = { a: true };
  for (let i = 0; i < 300; i++) { if (i % 40 === 0) L.shoot(); L.step(DT); }
  S.keys = {};
} catch (e) { threw = e; }
ck("连跑 600 帧不抛错", threw === null, threw && threw.message);
ck("玩家没掉出世界", S.p.y < L.WORLD_H, Math.round(S.p.y));
ck("弹药不会变负", S.ammo >= 0, S.ammo);
ck("球数不会爆炸", S.balls.length < 20, S.balls.length);

/* =========================================================================
   十五、球砸箱会长大（用户明确要求，也是「清光怪不卡关」的兜底）
   ========================================================================= */
group("十五、球砸箱吸木屑");
L.reset(); settle(20);
S.foes.length = 0;
S.boxes.forEach(b => { if (b.mat !== "wood") b.dead = true; });      // 只留木箱，别让石/铁吃掉球
const growBox = S.boxes.filter(b => !b.dead && b.mat === "wood" && b.frost)[0];
const r0 = L.ballR(0);
const gb = L.spawnBall(growBox.x - 30, growBox.y + 24, 620, 0);
ck("球出生是最小号", Math.abs(gb.r - r0) < 0.01, gb.r + " vs " + r0);
const absorbed0 = gb.absorbed;
for (let i = 0; i < 30 && !growBox.dead; i++) L.step(DT);
ck("球砸碎木箱", growBox.dead === true);
ck("砸碎后球吸收木屑（absorbed 变大）", gb.absorbed > absorbed0, absorbed0 + " → " + gb.absorbed);
ck("砸碎后球半径变大", gb.r > r0, r0 + " → " + gb.r.toFixed(1));
ck("单口箱的增益比吸一只怪大", NUM.ball.absorbBox > NUM.ball.absorbFoe, NUM.ball.absorbBox + " vs " + NUM.ball.absorbFoe);

/* 兜底验证：底层那四口木箱，够不够把小球喂到能破冰墙的档位 */
L.reset(); settle(20);
S.foes.length = 0;
/* 用 x 认这四口，不用 y —— 门厅那摞回程箱塔也在 y>=1400，
   只按 y 过滤会数出 6 口，喂球增益跟着虚高。 */
/* 门厅地面上的木箱，且必须在门壳左边（门壳右边的够不着）。
   位置每关都变，只认"地面高度 + 在门左侧"这两条。 */
const feed = S.boxes.filter(b => !b.dead && b.mat === "wood" && b.y === L.GROUND_Y - 48 && b.x < S.door.x - 48);
ck("门厅有 3 口喂球木箱", feed.length >= 3, feed.length);
const fb = L.spawnBall(feed[0].x - 30, feed[0].y + 24, 620, 0);
for (const bx of feed) {
  for (let i = 0; i < 30 && !bx.dead; i++) { if (fb.dead) break; L.step(DT); }
}
ck("喂完之后球到了大档以上（能破冰墙）", L.ballTier(fb.absorbed) >= 2, "tier=" + L.ballTier(fb.absorbed) + " absorbed=" + fb.absorbed);

/* =========================================================================
   十六、垂直连通：每个有怪的平台，玩家都上得去
   ---------------------------------------------------------------------------
   **这一节守的是「关卡自己把内容藏起来了」。** 三层之后，最容易被忽略的
   错误是某个高台差 20px 跳不上去 —— 台上放着怪，玩家永远打不到，
   而且看起来不像 bug，只像"这关有点难"。

   模型：从平台 Q 起跳，脚最高到 Q.y-123，水平最多移动 205，能落到平台 P。
   从出生点那层开始 BFS。
   ========================================================================= */
group("十六、垂直连通（每个平台都上得去）");
L.reset();
const JUMP_H = 123, JUMP_W = 205, DROP_W = 260;
function gapBetween(q, pl) {
  return Math.max(0, Math.max(q.x - (pl.x + pl.w), pl.x - (q.x + q.w)));
}
function reachFrom(q, pl) {
  const gap = gapBetween(q, pl);
  /* 往下掉：这关本来就是单向挖到底的，掉下去是主通路，不是失败。
     不把"下落"算成一条边的话，BFS 会报"下面九块平台全都到不了" ——
     那个红叉是测试模型错了，不是关卡错了。 */
  if (pl.y > q.y + 4) return gap <= DROP_W;
  if (q.y - pl.y > JUMP_H) return false;
  return gap <= JUMP_W;
}
const plats = S.plats;
const startPlat = plats.find(pl => S.p.x + S.p.w > pl.x && S.p.x < pl.x + pl.w && Math.abs(S.p.y + S.p.h - pl.y) < 4);
ck("玩家出生点站在某块平台上", !!startPlat);
const seen = new Set([startPlat]);
const queue = [startPlat];
while (queue.length) {
  const q = queue.shift();
  for (const pl of plats) {
    if (seen.has(pl)) continue;
    if (reachFrom(q, pl)) { seen.add(pl); queue.push(pl); }
  }
}
const unreachablePlats = plats.filter(pl => !seen.has(pl));
ck("全部 " + plats.length + " 块平台都从出生点可达", unreachablePlats.length === 0,
   unreachablePlats.map(pl => "(" + pl.x + "," + pl.y + ")").join(" "));

/* 每只怪都站在某块平台上（没有悬空的怪） */
/** `withBox` 决定要不要把箱子也算成落脚面。
    **悬空检查要算（怪站在箱顶是合法的），射程检查不算（箱子太窄，塞不下玩家）。** */
function platOf(f, withBox) {
  const all = withBox ? L.S.plats.concat(L.S.boxes.filter(b => !b.dead)) : L.S.plats;
  for (const pl of all) {
    if (f.x + f.w <= pl.x + 1 || f.x >= pl.x + pl.w - 1) continue;
    /* **斜坡要按截面高度比，不能比 pl.y** —— pl.y 是左端高度，
       怪站在坡右半截时，脚底比 pl.y 低几十像素，会误判成悬空。 */
    if (Math.abs((f.y + f.h) - L.surfY(pl, f.x + f.w / 2)) < 6) return pl;
  }
  return null;
}
L.reset(); settle(40);
const floating = S.foes.filter(f => !platOf(f, true));
ck(S.foes.length + " 只怪全部站在平台上（没有悬空卡死的）", floating.length === 0,
   floating.map(f => "(" + Math.round(f.x) + "," + Math.round(f.y) + ")").join(" "));

/* =========================================================================
   十七、可达性：每只怪都喷得到
   ========================================================================= */
group("十七、射程可达性");
let unreachable = [];
let skipped = 0;
const foeN = S.foes.length;
for (let i = 0; i < foeN; i++) {
  L.reset();
  S.foes.forEach(f => { f.speed = 0; f.vx = 0; });
  /* **先砸箱子、再 settle**。反过来的话，那些站在箱顶上的怪会在这一瞬间
     脚下悬空 —— 砸完立刻调 platOf 会返回 null，然后崩在 pl.x 上。
     顺序错了看起来像"某只怪没有平台"，其实是测试自己的时序问题。 */
  S.boxes.forEach(b => { b.dead = true; });
  settle(30);
  const f = S.foes[i];
  S.foes = [f];
  f.speed = 0; f.vx = 0;
  const pl = platOf(f, false);
  if (!pl) { skipped++; continue; }        // 站在箱顶上的怪：箱子 48 宽，塞不下玩家，跳过
  /* **怪贴平台右端、玩家贴左端。**
     早先的做法是"玩家离怪 60px"，有两个坑：
     ① 平台上放不下 60px 时，两个盒子会重叠 → 每帧撞脸 → 玩家 3 帧就没血了，
        `shoot()` 因为 phase 变了直接返回，测出来是"喷不到"，其实是人已经死了；
     ② 斜坡上水平距离就是高度差，站远了子弹从怪头顶飞过去，也是假红。
     现在两端各贴边，距离由平台宽度决定，既不会重叠也不会越过。 */
  /* **玩家直接摆到和怪同一水平线，离它 40px。**
     这一节测的是"这只怪能不能被雪弹碰到"，不是"地形怎么走"——
     地形可达性由十六节那张 BFS 管。
     早先按平台算出玩家 y，在斜坡上会差几十像素：雪弹是水平飞的，
     38° 的坡上差 140px 就是差 111px 高，子弹从怪头顶过去，
     测出来是"喷不到"，但其实玩家走上去就打得着。
     离 40 是"玩家宽 30 + 10"，再近两个盒子会重叠，撞脸掉血之后
     `shoot()` 会因为 phase 变了直接返回。 */
  /* **左边放不下就放右边。** 怪可能就站在平台最左端，`f.x - 40` 会落到平台外，
     夹回平台边界之后玩家正好压在怪身上 —— 撞脸掉血、phase 变成结束、
     `shoot()` 直接返回，测出来是"喷不到"。 */
  let px = f.x - 40, face = 1;
  if (px < pl.x + 2) { px = f.x + f.w + 10; face = -1; }
  L.placePlayer(px, f.y + f.h - S.p.h);
  /* **不 settle 直接喷。** 摆好位置再跑几帧的话，玩家会先掉下去
     （他悬在怪的水平线上，脚下未必有地），子弹就从错的高度出去了。 */
  S.p.face = face;
  S.ammo = 100;
  const h0 = f.hits;
  L.shoot();
  for (let k = 0; k < 24; k++) L.step(DT);
  if (f.hits <= h0) unreachable.push("#" + i + "(" + Math.round(f.x) + "," + Math.round(f.y) + ")");
}
ck(foeN + " 只怪全部喷得到（" + skipped + " 只站在箱顶上跳过）", unreachable.length === 0, unreachable.join(" "));

/* 门砸开后够得着 */
L.reset(); settle(20);
/* 全清：从门左边 200px 走到门，路上任何一口箱子都会让"走到门"这条测不准。 */
S.boxes.forEach(b => { b.dead = true; });
L.placePlayer(Math.max(60, S.door.x - 200), L.GROUND_Y - 42);
S.keys = { d: true };
for (let i = 0; i < 90; i++) L.step(DT);
S.keys = {};
ck("冰墙砸开后玩家能走到门", S.p.x + S.p.w >= S.door.x, Math.round(S.p.x + S.p.w) + " vs " + S.door.x);

/* =========================================================================
   十八、镜头跟随（有纵深才谈得上探索）
   ========================================================================= */
group("十八、镜头跟随");
L.reset(); settle(30);
ck("出发点镜头在最上面（地表）", S.cam.y < 200, Math.round(S.cam.y));
L.placePlayer(200, L.GROUND_Y - 42);
for (let i = 0; i < 90; i++) L.step(DT);
ck("下到底层后镜头跟着下去", S.cam.y > L.WORLD_H - L.H - 2, Math.round(S.cam.y));
ck("镜头不会超出世界底", S.cam.y <= L.WORLD_H - L.H + 0.5, S.cam.y);

/* =========================================================================
   十九、挖穿：站在盖板旁边喷，整排塌下去
   ---------------------------------------------------------------------------
   **这一节守的是"玩家能不能自己往下走"。**
   盖板是横铺在地面缺口里的木箱，玩家站在它上面时，子弹是水平飞的、
   打不到脚下 —— 如果只有"站在上面喷"这一条路，这一关根本下不去。
   真正的解法是站在缺口旁边的地面上往侧面喷：打掉最左边那口，
   中间几口失去"左右夹持"，整排跟着塌。

   这个动作用户没提过，但它不是 bug 而是必须存在的通路 —— 所以要钉住。
   ========================================================================= */
group("十九、挖穿：喷侧面 → 整排塌");
L.reset(); settle(30);
const hole0 = L.LAYERS[0].holes[0];
const y0 = L.FLOORS[0];
/* 地表的盖板就是洞上那两口霜箱。**位置每关都变**，只能按"贴在这一层地面上、
   带霜、并且落在洞口区间里"去找 —— 写死 x 的版本在随机布局下等于没测。 */
const caps = S.boxes.filter(b => !b.dead && b.frost && Math.abs(b.y + 48 - y0) < 1).sort((a, b) => a.x - b.x);
ck("地表盖板 " + caps.length + " 口，铺在洞 " + hole0.x + "~" + (hole0.x + hole0.w) + " 上",
   caps.length >= 2 && caps[0].x >= hole0.x - 1 && caps[caps.length - 1].x + 48 <= hole0.x + hole0.w + 1,
   caps.map(b => b.x).join(","));

/* 站哪边喷：左边有地面就站左边朝右，否则站右边朝左 */
const leftOK = hole0.x - 56 >= 48 && L.groundAt(hole0.x - 56 + 15, y0 - 10) === y0;
const px0 = leftOK ? hole0.x - 56 : hole0.x + hole0.w + 8;
const target = leftOK ? caps[0] : caps[caps.length - 1];
L.placePlayer(px0, y0 - S.p.h);
S.p.face = leftOK ? 1 : -1;
S.ammo = 100;
/* 喷到碎为止（上限 8 发）。**不写死"恰好 3 发"** —— shotCd 和飞行时间
   会让"发几发"和"命中几发"对不齐，写死就成了测时序而不是测机制。 */
let shotsFired = 0;
for (let i = 0; i < 8 && !target.dead; i++) {
  const a0 = S.ammo;
  L.shoot();
  if (S.ammo < a0) shotsFired++;
  for (let k = 0; k < 24; k++) L.step(DT);
}
ck("站在洞口旁边喷，能打碎靠外那口盖板", target.dead === true, "hp=" + target.hp + " 发了 " + shotsFired + " 发");
settle(90);
const capsLeft = S.boxes.filter(b => !b.dead && b.frost && Math.abs(b.y + 48 - y0) < 1);
ck("其余几口失去左右夹持，整排塌下去", capsLeft.length === 0, capsLeft.map(b => b.x).join(","));
const mid0 = hole0.x + hole0.w / 2;
ck("盖板没了之后洞口是空的（脚下没有实心块）",
   L.groundAt(mid0, y0 - 10) > y0 + 40, "groundAt=" + L.groundAt(mid0, y0 - 10));

L.placePlayer(mid0, y0 - 42);
for (let i = 0; i < 120; i++) L.step(DT);
ck("从洞口走下去会掉到下一层",
   S.p.y > y0 + 100 && S.p.y < L.FLOORS[1] + 10, Math.round(S.p.y) + " / 第2层 " + L.FLOORS[1]);
ck("掉到下一层之后镜头也跟下去了", S.cam.y > 150, Math.round(S.cam.y));

/* =========================================================================
   二十、全流程：挖到底 → 破冰墙 → 门露出 → 杀够 → 过关
   ---------------------------------------------------------------------------
   前面每一节都在单点验证。这一节走一遍真的路径，确认没有"单点都对、
   串起来走不通"的地方。**层数是随机的，所有循环都用 FLOORS.length** ——
   写死 6 的话，8 层的关卡会漏掉最后两层，4 层的会越界。
   ========================================================================= */
group("二十、全流程");
L.reset(); settle(30);
const NF = L.FLOORS.length;

for (let k = 0; k < NF - 1; k++) {
  const h = L.LAYERS[k].holes[0];
  const yk = L.FLOORS[k];
  /* 砸掉这一层洞口上方 100px 内的所有箱子：霜箱盖板、冰封、或者什么都不用砸 */
  S.boxes.filter(b => !b.dead && b.x >= h.x - 1 && b.x < h.x + h.w && b.y >= yk - 100 && b.y < yk)
         .forEach(b => L.breakBox(b, "ball"));
  L.placePlayer(h.x + h.w / 2, yk - 42);
  for (let i = 0; i < 150; i++) L.step(DT);
  const next = L.FLOORS[k + 1];
  ck("第 " + (k + 1) + " 层挖穿 → 落在第 " + (k + 2) + " 层（只掉 240，不是一坠到底）",
     S.p.y > next - 200 && S.p.y <= next, Math.round(S.p.y));
}

/* ⑥ 推球破冰墙。门壳右边一列是门本身，左边一列是外屏障。 */
const doorX = S.door.x;
const wallX = doorX - 48;
S.balls.length = 0;
/* 先把门左侧的箱子清掉，给球留出滚动的跑道（喂球箱可能正好在那儿） */
S.boxes.filter(b => !b.dead && b.x >= wallX - 160 && b.x < wallX && b.y >= L.GROUND_Y - 120)
       .forEach(b => L.breakBox(b, "ball"));
for (let i = 0; i < 20; i++) L.step(DT);

/* **冰墙一列两格，一颗球只能破一格。**
   撞碎第一格之后 keepSpeed 把速度砍到 36%，pow 从 2500 掉到 ~900，
   破不了第二格 —— 这是有意的：冰墙要推两次，不是一次性奖励。
   **用引用认箱子，不用 y 认**：砸掉下半格之后上半格会失去支撑掉下来，
   坐标变了，`b.y === 1444` 就不再指向它，断言会假红。 */
const colF = S.boxes.filter(b => b.mat === "ice" && b.x === wallX && !b.dead &&
  b.y + b.h > L.GROUND_Y - 200).sort((a, b) => b.y - a.y);
ck("⑥ 门厅外屏障是 2 格冰", colF.length === 2, colF.length);
const lowerF = colF[0], upperF = colF[1];
/* **球心 y 必须是"地面减去半径"，不是"地面减去固定值"。**
   特大球 r=46，写成 GROUND_Y-30 的话球底比地面还低 16px，
   球在第一帧就被判成"侧面撞地面"、原地反弹，永远走不到冰墙前面。 */
L.spawnBall(wallX - 100, L.GROUND_Y - L.ballR(12), 1209, 12);
for (let i = 0; i < 40 && !lowerF.dead; i++) L.step(DT);
ck("⑥ 推第一颗球破掉冰墙下半", lowerF.dead === true);
ck("⑥ 上半格没被同一颗球带走（速度衰减到 36% 就不够了）", upperF.dead === false);

S.balls.length = 0;
L.spawnBall(wallX - 100, L.GROUND_Y - L.ballR(12), 1209, 12);
for (let i = 0; i < 40 && !upperF.dead; i++) L.step(DT);
ck("⑥ 推第二颗球破掉冰墙上半", upperF.dead === true);

// ⑦ 破门壳 → 门露出
S.boxes.filter(b => b.mat === "ice" && b.x === doorX).forEach(b => L.breakBox(b, "ball"));
for (let i = 0; i < 10; i++) L.step(DT);
ck("⑦ 门露出来", L.doorBlocked() === false);

// ⑧ 杀够 3 只
S.killed = NUM.killTarget;
L.checkDoor();
ck("⑧ 门解锁", S.door.open === true);

// ⑨ 碰门过关
L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
for (let i = 0; i < 20 && S.phase === "play"; i++) L.step(DT);
ck("⑨ 碰门过关", S.phase === "clear", S.phase);

/* =========================================================================
   汇总
   ========================================================================= */
console.log("\n" + "=".repeat(56));
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) { console.log("失败清单：\n  - " + bad.join("\n  - ")); process.exit(1); }
console.log("✓ 闭环成立");
