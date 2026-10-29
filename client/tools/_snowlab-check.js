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
/* **判据回到"200/200 首掷全过"（2026-10-29）。**
   之前放宽到 98%，理由是"约束互相打架时重掷一次就好" —— 但那等于承认
   生成器有 1~2% 的种子要靠碰运气，而这些种子恰恰也最容易是死局。
   这一轮把三个根因都修在生成侧，首掷是干净的 200/200：
     · **出生点那一列从源头就不摞箱子**（原来是生成完再删，删完只剩 7 口
       却还在按 9 口算门槛）；
     · **箱子门槛和"这层几何上摞得下几口"取小**（`l.colCap`：锁死的盖板列
       只算已有箱数，再往上加就造球坑的格子也不算）；
     · **洞口落位加了兜底**（三条间距约束合起来可能无解，那一层就没有出口）。
   现在把它焊死在 100% —— 哪天又掉下来，说明新加的东西又在和这三条打架。 */
ck(NSEED + " 个种子首掷通过校验（100%）", gOK === NSEED,
   gOK + "/" + NSEED + "，没过: " + gBad.slice(0, 8).join(","));
{
  let playable = 0;
  for (let sd = 1; sd <= NSEED; sd++) {
    if (L.validateLevel(L.buildLevel(sd))) playable++;
  }
  ck("重掷之后 " + NSEED + " 个种子全部可玩", playable === NSEED, playable + "/" + NSEED);
}
/* 层数收到 3~5（4 层占一半）。**层数一多，每层的箱子就被摊薄** ——
   4~8 层时越深的层越空，正好和"很多木箱"相反。 */
ck("层数 3~5，而且每个档都出现过", Object.keys(nfHist).length >= 3 &&
   Object.keys(nfHist).every(k => +k >= 3 && +k <= 5), JSON.stringify(nfHist));
ck("三种封口方式都出现过（不是每层都同一招）",
   coverHist.frost > 0 && coverHist.ice > 0 && coverHist.none > 0, JSON.stringify(coverHist));
/* 阈值 1.2：平均每关一条半。**不是每层都有坡** ——
   落点带（上一层洞口正下方）不能放平台和坡，不然掉下来会被接在半空；
   剩下的可放位置本来就不多，硬要每层都塞会挤掉高台。 */
/* 阈值 1.1。**从 1.2 降下来的原因是"井梯"占掉了地形的位置** ——
   地形避让落点带的范围从 ±24 扩到 ±48（整列），可放平台的段变短，
   坡自然少一点。这是"能跳回上一层"的代价，不是退化。 */
ck("斜坡平均每关 " + (rampTotal / NSEED).toFixed(1) + " 条（地形不止平台）",
   rampTotal / NSEED > 1.1, (rampTotal / NSEED).toFixed(2));
ck("箱子平均每关 " + (boxTotal / NSEED).toFixed(1) + " 口", boxTotal / NSEED > 50, (boxTotal / NSEED).toFixed(1));

/* **"门槛和几何取小"这条不能被用来偷懒。**
   `validateLevel` 第 9 条现在按 `min(门槛, l.colCap)` 判 —— 上面那几个
   "地表只剩两三列能摞"的种子就是靠它过的。可这条一旦写松，
   生成器只要把 `colCap` 报小就能让自己永远合格。
   所以反过来钉一条下限：**任何一层都至少要有 4 口箱子**。
   实测最差的地表层（种子 154）正好 6 口，离下限还有余量。 */
{
  let minCnt = 999, minAt = "";
  for (let sd = 1; sd <= NSEED; sd++) {
    const g = L.genLevel(sd);
    for (let k = 0; k < g.layers.length; k++) {
      const F = g.floors[k];
      const c = g.boxes.filter(b => b.y < F - 1 && b.y + b.h > F - 200).length;
      if (c < minCnt) { minCnt = c; minAt = "seed " + sd + " 层" + k; }
    }
  }
  ck("最空的一层也有 " + minCnt + " 口箱子（≥4）", minCnt >= 4, minAt);
}
/* 每层都必须有出口。`layers[k].holes` 为空 = 玩家掉下来就困在里面，
   这是硬死局，不是难度。原来每个口试 26 次、撞线就放弃，实测 1/200 会空；
   现在落位有兜底（逐条放宽间距，最后硬开在屏幕中间）。 */
{
  let noExit = 0;
  for (let sd = 1; sd <= NSEED; sd++) {
    const g = L.genLevel(sd);
    for (let k = 0; k + 1 < g.floors.length; k++) if (!g.layers[k].holes.length) noExit++;
  }
  ck("200 个种子每层都有出口", noExit === 0, noExit + " 层没出口");
}

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
/* **"+ 残高" 不是随手写的：楼板 40 → 26（2026-10-28 薄板改动）之后，
   世界高 = 最后一层 + 板厚 26 + 40 的余量。** 原来写死 80，
   板一薄这条就红了 —— 它测的是"世界比最后一层高多少"，不是那个数字本身。
   （板厚后面还可能再动，所以这里只断言"比最后一层高 50~90"这个区间。） */
ck("世界高 = 最后一层 + 板厚 + 40 的余量",
   L.WORLD_H - L.GROUND_Y >= 50 && L.WORLD_H - L.GROUND_Y <= 90,
   (L.WORLD_H - L.GROUND_Y) + " / 最后一层 " + L.GROUND_Y);
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
  const f = L.spawnFoe(400, L.GROUND_Y - L.FOE_H, "crawler");
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
/* **砸不动 ≠ 是一堵墙**（2026-10-29）。
   用户：「球进入了死胡同 比如上坡 完全推不上去了」——
   球没有跳跃，被推进一个四周高一格的坑里就永远出不来。
   现在的规则是"球能翻过它砸不动的一格台阶"（见 ballHitBox 的翻越分支），
   所以这一格铁箱的结局不是弹回来，而是"球跳上去、落在箱顶"。 */
ck("铁箱：一格高 → 球翻上去（不再原地弹）",
  b3.y + b3.r <= ir.y + 4 && b3.x > ir.x - 10,
  Math.round(b3.y + b3.r) + " vs 箱顶 " + ir.y);
/* **一次只翻一格。** 翻越分支的台阶判据是 ≤56px，所以两格高的墙不会
   被"一发跳上去"：球最多抬 48（一格）+ 一点滞空余量。
   这条守的是"箱山对球仍然是地形"—— 一次能翻两格的话，3 格箱山对球就等于平地，
   箱子就彻底退化成装饰了。 */
let ir3 = soloBox("iron");
S.boxes.push({ x: ir3.x, y: ir3.y - 48, w: 48, h: 48, mat: "iron",
               hp: Infinity, dead: false, hitT: 0, frost: false, fell: 0 });
/* 按"连续上升的一段"量抬升 —— 量的是单跳，不是整条路径最后爬了多高
   （那个必然是两格）。`b.onGround` 不能用来切段：它在一帧内就被摩擦分段
   消费掉了，外面永远读到 false。 */
const bots = [];
let b5b = L.spawnBall(ir3.x - 30, L.GROUND_Y - NUM.ball.baseR, 620, 1);
for (let i = 0; i < 60 && !ir3.dead; i++) { L.step(DT); bots.push(b5b.y + b5b.r); }
let hopRise = 0;
for (let i = 1; i < bots.length; i++) {
  if (!(bots[i] < bots[i - 1] - 0.5)) continue;
  let j = i, minB = bots[i];
  while (j + 1 < bots.length && bots[j + 1] < bots[j] + 0.5) { j++; minB = Math.min(minB, bots[j]); }
  hopRise = Math.max(hopRise, bots[i - 1] - minB);
  i = j;
}
ck("铁箱：两格高 → 一次只翻一格（单跳抬升 ≤ 60）", bots.length > 10 && hopRise <= 60, Math.round(hopRise));

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
let tf = L.spawnFoe(runX + 90, L.GROUND_Y - L.FOE_H, "crawler");
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
let nf = L.spawnFoe(620, L.GROUND_Y - L.FOE_H, "crawler");
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
const behind = L.spawnFoe(blocker.x + blocker.w + 6, blocker.y + blocker.h - L.FOE_H, "crawler");
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

/* **"藏"的载体从冰墙换成了普通木箱**（2026-10-29 用户：「门不需要那么大啊
   　需要隐藏到箱子里」）。门只有 32×40，整扇躲在门所在那一格的木箱后面；
   深层（tier ≥ 0.55）还多压一层，要连拆两口。

   门那一列的 x 是随机的，必须从 S.door 推 —— 写死坐标的断言在门开在别处时
   全是假绿。**按层筛 y** 也不能省：`x` 是全关共用的，下面某一层的
   "冰封洞口"完全可能和门开在同一列。 */
const hallFloorY = S.door.y + S.door.h;
const doorColX = Math.floor(S.door.x / 48) * 48;
const shells = S.boxes.filter(b => !b.dead && b.x === doorColX &&
  b.y + b.h <= hallFloorY + 1 && b.y >= hallFloorY - 96 - 1);
ck("门那一列压着 1~2 口木箱（藏身用）", shells.length >= 1 && shells.length <= 2, shells.length);
ck("其中一口把门整个盖住", shells.some(b => b.y <= S.door.y + 1 && b.y + b.h >= S.door.y + S.door.h - 1));

shells.forEach(b => L.breakBox(b, "ball"));
for (let i = 0; i < 8; i++) L.step(DT);          // 让 stepDoor 跑起来（砸箱会带顿帧）
ck("砸开外壳 → 门露出来", L.doorBlocked() === false);
ck("露出时给了「找到门了」的飘字", S.texts.some(t => String(t.s).indexOf("找到门") >= 0),
   S.texts.map(t => t.s).join("|"));
ck("露出不等于解锁（击杀不够）", S.door.open === false, S.killed + "/" + S.killedTarget);

L.placePlayer(S.door.x + 4, L.GROUND_Y - S.p.h);
for (let i = 0; i < 14; i++) L.step(DT);
ck("锁着时碰门不过关", S.phase === "play", S.phase);

S.killed = S.killedTarget;
L.checkDoor();
ck("击杀达标 → 门自动解锁", S.door.open === true);
L.placePlayer(S.door.x + 4, L.GROUND_Y - S.p.h);
for (let i = 0; i < 14 && S.phase === "play"; i++) L.step(DT);
ck("碰门 → phase = clear", S.phase === "clear", S.phase);

/* =========================================================================
   十二、门：藏 / 挡 / 露
   ---------------------------------------------------------------------------
   **门现在是"藏在木箱里"的**（2026-10-29 用户：「门不需要那么大啊
   　需要隐藏到箱子里」）。原来这一节验的是"门壳两边各垫两格冰墙当门框"，
   门一改，那一节的四个前提全没了，所以整段换成新的五条：
     ① 门"小"：宽高都不超过一格；
     ② 砸开之前门是看不见的（doorBlocked 为真）；
     ③ 往门那一列走会被箱子挡住（挡路的是箱子，不是冰）；
     ④ 砸掉那一列之后门露出来；
     ⑤ 露出来的门坐在地板上，不悬空。
   ========================================================================= */
L.reset(); settle(20);
const dDoor = S.door;
ck("门是一格之内的小门（w ≤ 48, h ≤ 48）", dDoor.w <= 48 && dDoor.h <= 48, dDoor.w + "×" + dDoor.h);
ck("没砸开之前门是藏着的（doorBlocked 为真）", L.doorBlocked() === true);
const dColX = Math.floor(dDoor.x / 48) * 48;
const buryN = S.boxes.filter(b => !b.dead && b.x === dColX &&
  b.y + b.h > L.GROUND_Y - 200 && b.y < L.GROUND_Y).length;
ck("门那一列压着至少 1 口箱子（藏身用）", buryN >= 1, buryN);

/* ③ 从门左边 300px 往右走：被门那一列的箱子挡住。**起点动态** ——
   门的位置每关都变，写死坐标有时会站在门右边一路走到底。 */
L.placePlayer(Math.max(48, dDoor.x - 300), L.GROUND_Y - S.p.h);
S.keys = { d: true };
for (let i = 0; i < 120; i++) L.step(DT);
S.keys = {};
ck("往门那一列走会被箱子挡住", S.p.x + S.p.w <= dColX + 2,
   Math.round(S.p.x + S.p.w) + " vs " + dColX);

/* ④⑤ 砸掉门那一列的箱子 → 门露出来，而且**必须落在地板上**：
   门壳没了之后如果 y 还是按旧高度算的，门就浮在半空，玩家走过去
   `aabb` 判不到，等于门不存在。 */
S.boxes.filter(b => !b.dead && b.x === dColX).forEach(b => L.breakBox(b, "ball"));
for (let i = 0; i < 40; i++) L.step(DT);
ck("砸掉之后门露出来（doorBlocked 为假）", L.doorBlocked() === false);
ck("门底下是门厅地板（不悬空）",
   Math.abs((S.door.y + S.door.h) - L.GROUND_Y) <= 4,
   Math.round(S.door.y + S.door.h) + " vs " + L.GROUND_Y);

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
/* **门厅的空地要现扫，不能写死 x。** 箱子分布和门的位置都随种子变，
   写死 500 的结果是"怪被顶到箱顶上、aabb 永远不成立"，断言假红。 */
let freeX = 500;
{
  const fy = L.GROUND_Y;
  for (let x = 60; x < 880; x += 12) {
    const blocked = S.boxes.some(b => !b.dead && b.x < x + 40 && b.x + b.w > x - 6 &&
      b.y + b.h > fy - 50 && b.y < fy + 6);
    if (!blocked) { freeX = x; break; }
  }
}
L.placePlayer(freeX, L.GROUND_Y - S.p.h);
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
   十五、球撞箱不变大 —— 体积只来自「吞掉敌人」
   ---------------------------------------------------------------------------
   **这一节守的是「裹住敌人」这个核心操作不能被绕过。**
   旧设计里砸碎一口箱 absorbed += 2.0：一关一百多口箱子，砸三口就从小球
   变特大球，冰墙形同虚设，玩家再也不会去裹怪。用户 2026-10-28 直接否掉：
   「球撞击箱子应该不会变大吧」—— 常识上也说不通，雪球凭什么吃木屑。
   ========================================================================= */
group("十五、球撞箱不变大（体积只来自吞敌）");
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
ck("砸碎后球体积不变", gb.absorbed === absorbed0 && Math.abs(gb.r - r0) < 0.01,
   "absorbed " + absorbed0 + " → " + gb.absorbed + "，r " + r0 + " → " + gb.r.toFixed(1));
ck("absorbBox 明确是 0（不是碰巧没走到那行）", NUM.ball.absorbBox === 0, NUM.ball.absorbBox);
ck("穿透仍然保留（砸完继续滚，爽感不靠变大）", Math.abs(gb.vx) > 100, Math.round(gb.vx));

/* **体积唯一的来源是吞敌，所以关卡必须提供足够的敌人。**
   破冰墙要 tier 2（大档）＝ absorbed ≥ 4；一只 2.0，也就是两只。 */
L.reset(); settle(20);
const N = L.FLOORS.length;
const hallFoes = S.level.spawns.filter(s => s.layer === N - 1).length;
ck("门厅怪数够喂出一颗大档球（" + hallFoes + " × " + NUM.ball.absorbFoe + " ≥ 4）",
   hallFoes * NUM.ball.absorbFoe >= 4, hallFoes + " 只");
ck("撞死怪也算吞（不然「清光怪」就又卡死了）", NUM.ball.absorbFoe >= 2, NUM.ball.absorbFoe);

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
/* **必须扫一批固定种子，而且判据要按"帧"算，不能只看某一瞬间。**
   `L.reset()` 不带参数时种子是随机的 —— 这条断言红了之后重跑一次就绿，
   是最难查的那种"偶发"。

   **2026-10-28 改判据：** 宠物会跳、会从两格箱顶走到一格箱顶，于是
   "脚下没有面"会合法地出现**一帧**（stepBody 的顺序是「先垂直落地、
   再水平位移」，离开台面的那一帧还带着上一帧的 onGround）。
   旧判据只取 settle(30) 之后的那一帧，正好抓到这类过渡，误报。
   现在按帧累计：**连续 9 帧既没有落脚面、vy 又是 0**，才算吊在半空。
   顺带把观测窗口从 30 帧拉到 90 帧 —— 跳一次就要 30 帧，30 帧根本看不出规律。 */
{
  const stuck = [];
  for (let sd = 1; sd <= 24; sd++) {
    L.reset(sd);
    const run = new Map();
    for (let i = 0; i < 90; i++) {
      L.step(DT);
      for (const f of L.S.foes) {
        const ok = !!platOf(f, true) || Math.abs(f.vy) > 1;
        const n = ok ? 0 : (run.get(f) || 0) + 1;
        run.set(f, n);
        if (n === 9) stuck.push(sd + ":(" + Math.round(f.x) + "," + Math.round(f.y) + ")");
      }
    }
  }
  ck("24 个种子 × 90 帧：没有怪吊在半空（连续 9 帧无落脚面且静止）",
     stuck.length === 0, stuck.slice(0, 6).join(" "));
}

/* =========================================================================
   十七、可达性：每只怪都喷得到
   ========================================================================= */
group("十七、射程可达性");
let unreachable = [];
let skipped = 0;
/* **数量必须 reset 之后再取。** 上面十六节跑完 90 帧，黑洞已经吐过怪，
   那一刻的 S.foes 比"开局阵容"多 —— 拿它当循环上界，后面 reset 出来
   的数组就短一截，崩在 `S.foes[i]` 是 undefined（报的是"读不到 speed"）。 */
L.reset();
const foeN = S.foes.length;
for (let i = 0; i < foeN; i++) {
  L.reset();
  /* **settle 之前先把玩家打成无敌。** 这一节只测射程，可是玩家被摆在场中央，
     30 帧里怪会撞上来：撞一次掉 1 血 + 给怪 2 点雪，三次之后怪就攒够雪
     变成球、从 S.foes 里消失 —— 于是 `S.foes[i]` 是 undefined，
     报错是"读不到 speed"，看起来跟射程毫无关系。 */
  S.invuln = 999; S.hp = 99;
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
L.placePlayer(Math.max(60, S.door.x - 200), L.GROUND_Y - S.p.h);
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
L.placePlayer(200, L.GROUND_Y - S.p.h);
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
/* **主动找一个"地表洞口被霜箱封住"的种子。**
   直接 `L.reset()` 拿的是随机种子，而地表封口现在只有 46% 是霜箱 ——
   这条断言于是"跑十次红一次"，红的时候连 target 都是 undefined。
   测试要测机制，不能靠运气撞到一关合适的。

   **必须用 `reset()` 探，不能用 `genLevel()`。** 两者不等价：
   `genLevel(1)` 只是"第一次尝试"，校验不过时 `buildLevel` 会换种子重掷
   （最多 80 次），所以 `reset(1)` 拿到的可能是完全另一关。
   2026-10-28 加井口缘之后就是这样：genLevel(1) 有霜盖板，reset(1) 两个洞
   都是敞口 —— 测试挑了个不存在的关卡，红在"盖板 0 口"上。 */
{
  let pick = 0;
  for (let sd = 1; sd <= 60 && !pick; sd++) {
    L.reset(sd);
    if (L.LAYERS[0].holes.some(h => h.cover === 'frost')) pick = sd;
  }
  if (!pick) pick = 1;
  L.reset(pick); settle(30);
}
/* **要取"有霜盖板的那个洞"，不是最左边那个。** 一层的口现在可以有两个，
   而封口只给"生成时第一个" —— 排序之后它不一定还是 holes[0]。
   取错了就是"盖板 0 口"，然后 target 变 undefined、脚本直接崩。 */
const hole0 = L.LAYERS[0].holes.filter(h => h.cover === 'frost')[0] || L.LAYERS[0].holes[0];
const y0 = L.FLOORS[0];
/* 地表的盖板就是洞上那两口霜箱。**位置每关都变**，只能按"贴在这一层地面上、
   带霜、并且落在洞口区间里"去找 —— 写死 x 的版本在随机布局下等于没测。 */
/* **盖板要收在"这个洞"的范围内。** 地表层现在可能有 2 个洞，
   不收的话会把另一个洞（或者别处贴着地面的霜箱）也算进来，
   "整排该塌几口"就对不上了。 */
const caps = S.boxes.filter(b => !b.dead && b.frost && Math.abs(b.y + 48 - y0) < 1 &&
  b.x >= hole0.x - 1 && b.x + b.w <= hole0.x + hole0.w + 1).sort((a, b) => a.x - b.x);
ck("地表盖板 " + caps.length + " 口，铺在洞 " + hole0.x + "~" + (hole0.x + hole0.w) + " 上",
   caps.length >= 2 && caps[0].x >= hole0.x - 1 && caps[caps.length - 1].x + 48 <= hole0.x + hole0.w + 1,
   caps.map(b => b.x).join(","));

/* 站哪边喷：**从洞口边往外扫，找第一处"地面正好是本层地板"的落脚点。**
   写死 `hole0.x - 56` 有两个坑：楼板断成两三段之后，洞口左边的列常常
   正好摞着箱子（地面 = y0−48），人会被塞进箱子里，子弹从箱子内部出发，
   八发全打在箱子上，盖板一发没吃到。 */
let px0 = null, leftOK = true;
for (let x = hole0.x - S.p.w - 4; x >= 48; x -= 6) {
  if (L.groundAt(x + S.p.w / 2, y0 - 10) === y0) { px0 = x; break; }
}
if (px0 === null) {
  leftOK = false;
  for (let x = hole0.x + hole0.w + 4; x + S.p.w <= 912; x += 6) {
    if (L.groundAt(x + S.p.w / 2, y0 - 10) === y0) { px0 = x; break; }
  }
}
if (px0 === null) px0 = hole0.x - 56;
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
const capsLeft = S.boxes.filter(b => !b.dead && b.frost && Math.abs(b.y + 48 - y0) < 1 &&
  b.x >= hole0.x - 1 && b.x + b.w <= hole0.x + hole0.w + 1);
ck("其余几口失去左右夹持，整排塌下去", capsLeft.length === 0, capsLeft.map(b => b.x).join(","));
const mid0 = hole0.x + hole0.w / 2;
/* **判据从"洞口下面是空的"改成"洞口不再有霜箱"。**
   旧判据 `groundAt(mid0) > y0 + 40` 是单向玻璃的时候写的：那时盖板砸掉，
   洞里什么都没有，玩家一步跨过去就落到下一层。现在洞口下方按设计垫着
   **井梯**（不上垫，玩家就再也上不回来），而且砸盖板时上面压着的木箱会
   塌下来填进去 —— "洞下面是空的"根本不是现在的设计意图。
   要守的是"封口被打开了"这件事本身。 */
/* **只看"堵在洞口顶部"的那一层。** 塌下去的霜箱还在洞里（掉到下一层去了），
   它们仍然是 frost、x 也还在洞口范围内 —— 不收 y 就会把"塌下去"判成"没砸开"。 */
ck("盖板没了之后洞口顶部不再有霜箱",
   !S.boxes.some(b => !b.dead && b.frost && b.y > y0 - 70 && b.y < y0 + 4 &&
     b.x < mid0 + 20 && b.x + b.w > mid0 - 20),
   S.boxes.filter(b => !b.dead && b.frost).map(b => "(" + b.x + "," + Math.round(b.y) + ")").join(","));

/* 人站到洞里去，会先落在塌下来 / 井梯垫着的箱子上。这是**故意的**：
   上行通道和落点共用同一摞箱子，掉下去要砸两口才能到底 ——
   "我挖穿了怎么还在半空"的解法是继续砸，而不是让洞口空着。 */
L.placePlayer(mid0, y0 - S.p.h);
for (let i = 0; i < 120; i++) L.step(DT);
ck("从洞口站进去会掉离上层地板", S.p.y + S.p.h > y0 + 4,
   "脚 " + Math.round(S.p.y + S.p.h) + " / 上层地板 " + y0);

/* 把垫脚那口砸开，就真的落到下一层地板上了。
   **按"脚下"找箱子，不按 x 猜** —— 井梯可能叠 1 格也可能 3 格，
   只认 `b.y ≈ 玩家脚底` 才不会砸错口。 */
for (let t = 0; t < 4 && Math.abs(S.p.y + S.p.h - L.FLOORS[1]) >= 4; t++) {
  const foot = S.p.y + S.p.h;
  for (const b of S.boxes) {
    if (b.dead) continue;
    if (b.y >= foot - 8 && b.y <= foot + 10 &&
        b.x + b.w > S.p.x + 2 && b.x < S.p.x + S.p.w - 2) L.breakBox(b, "ball");
  }
  for (let i = 0; i < 60; i++) L.step(DT);
}
ck("把井梯垫的箱子砸开，落到下一层地板", Math.abs(S.p.y + S.p.h - L.FLOORS[1]) < 4,
   Math.round(S.p.y + S.p.h) + " vs " + L.FLOORS[1]);
ck("掉到下一层之后镜头也跟下去了", S.cam.y > 50, Math.round(S.cam.y));

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
  L.placePlayer(h.x + h.w / 2, yk - S.p.h);
  for (let i = 0; i < 150; i++) L.step(DT);
  const next = L.FLOORS[k + 1];
  ck("第 " + (k + 1) + " 层挖穿 → 落在第 " + (k + 2) + " 层（只掉 240，不是一坠到底）",
     S.p.y > next - 200 && S.p.y <= next, Math.round(S.p.y));
}

/* ⑥ 推球破冰墙 —— **门壳没有了，这一段改成自己搭一堵。**
   2026-10-29 之前门厅的门是"两边各垫两格冰墙"当门框，所以这里直接拿
   门左边那一列当靶。门改成"藏进木箱"之后，门厅里已经没有固定的冰墙了
   （冰墙只剩"封洞口"这一种用途，位置随机）。

   这一条验的本来也不是"门厅长什么样"，而是**一颗球只破一格冰**
   （keepSpeed 把速度砍到 36%，pow 从 2500 掉到 ~900）。所以靶子自己搭：
   平地上摞两格冰，推特大球，看它只带走下半格。 */
const wallX = 528;
S.balls.length = 0;
S.boxes.filter(b => !b.dead && b.x + b.w > wallX - 200 && b.x < wallX + 96 &&
  b.y >= L.GROUND_Y - 200 && b.y < L.GROUND_Y)
  .forEach(b => { b.dead = true; });
for (let j = 0; j < 2; j++) {
  S.boxes.push({ x: wallX, y: L.GROUND_Y - 48 * (j + 1), w: 48, h: 48, mat: "ice",
                 hp: Infinity, dead: false, hitT: 0, frost: false, fell: 0 });
}
for (let i = 0; i < 10; i++) L.step(DT);

/* **冰墙一列两格，一颗球只能破一格。**
   撞碎第一格之后 keepSpeed 把速度砍到 36%，pow 从 2500 掉到 ~900，
   破不了第二格 —— 这是有意的：冰墙要推两次，不是一次性奖励。
   **用引用认箱子，不用 y 认**：砸掉下半格之后上半格会失去支撑掉下来，
   坐标变了，`b.y === 1444` 就不再指向它，断言会假红。 */
const colF = S.boxes.filter(b => b.mat === "ice" && b.x === wallX && !b.dead &&
  b.y + b.h > L.GROUND_Y - 200).sort((a, b) => b.y - a.y);
ck("⑥ 一列 2 格冰（自建靶）", colF.length === 2, colF.length);
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

// ⑦ 砸掉压在门上的箱子 → 门露出（门现在藏在本列的木箱里）
S.boxes.filter(b => !b.dead && Math.floor(S.door.x / 48) * 48 === b.x)
       .forEach(b => L.breakBox(b, "ball"));
for (let i = 0; i < 10; i++) L.step(DT);
ck("⑦ 门露出来", L.doorBlocked() === false);

// ⑧ 杀够 3 只
S.killed = NUM.killTarget;
L.checkDoor();
ck("⑧ 门解锁", S.door.open === true);

// ⑨ 碰门过关
L.placePlayer(S.door.x + 4, L.GROUND_Y - S.p.h);
for (let i = 0; i < 20 && S.phase === "play"; i++) L.step(DT);
ck("⑨ 碰门过关", S.phase === "clear", S.phase);

/* =========================================================================
   二十一、能跳回上一层（用户 2026-10-28 明确要求）
   ---------------------------------------------------------------------------
   **这一节是这次改动的全部意义。** 之前关卡是"单向下行"：站在 3 格箱顶
   只能到 267，而上一层地板在 240 —— 数字上够，但上一层的地板在洞口处是
   **镂空**的，玩家跳上去正好落回洞里，等于永远上不去。

   现在的做法有两半，缺一半就不成立：
     ① 生成：每个洞口正下方有一列摞到 3 格（井梯），旁边各垫 1 格当台阶；
     ② 物理：跳到"脚够到台面、横向差一口气"时自动扒边（mantle）。
   只做 ①——实测 81 次里成功 7 次，那不是难度，是动作没做出来；
   只做 ②——从地面跳不了 240，井梯给不了起跳高度。

   **按层真实跑一遍**，不做结构近似：把玩家放上井梯、按 W、看有没有站到
   上一层地板上。
   ========================================================================= */
group("二十一、能跳回上一层（逐层真跑）");
{
  let tot = 0, ok = 0, miss = [];
  for (let sd = 1; sd <= 12; sd++) {
    L.reset(sd);
    const N2 = L.FLOORS.length;
    for (let k = 1; k < N2 - 1; k++) {          // 门厅不做井梯，见生成器注释
      const holes = L.LAYERS[k - 1].holes;
      if (!holes.length) continue;
      const h0 = holes[0];
      const l2 = L.LAYERS[k];
      const a = Math.max(0, Math.ceil(h0.x / 48));
      const b = Math.min(19, Math.floor((h0.x + h0.w) / 48) - 1);
      let col = -1;
      for (let i = a; i <= b; i++) if ((l2.colHgt[i] || 0) >= 3) { col = i; break; }
      if (col < 0) { miss.push("s" + sd + "k" + k + " 无梯"); continue; }
      tot++;
      /* 先把上一层洞口上的盖板砸掉（不然一撞头就回来了，那是设计） */
      S.boxes.filter(bx => !bx.dead && bx.x + bx.w > h0.x && bx.x < h0.x + h0.w &&
                           bx.y + bx.h > L.FLOORS[k - 1] - 200 && bx.y < L.FLOORS[k - 1] + 4)
        .forEach(bx => L.breakBox(bx, "ball"));
      S.foes.length = 0;
      S.keys = {};
      L.placePlayer(col * 48 + 9, l2.floorY - 144 - S.p.h);
      for (let i = 0; i < 8; i++) L.step(DT);        // 落稳
      /* **只按一帧。** 按住 W 六十帧的话，玩家爬上去之后会接着在原地
         一直跳，跳到最高点又落回洞里 —— 看起来像"爬梯失败"，其实是
         测试自己按着不放。 */
      S.keys["w"] = true;
      L.step(DT);
      S.keys = {};
      for (let i = 0; i < 50; i++) L.step(DT);
      if (S.p.y + S.p.h <= L.FLOORS[k - 1] + 2) ok++;
      else miss.push("s" + sd + "k" + k + " 停在 " + Math.round(S.p.y + S.p.h));
    }
  }
  ck("每一层的井梯都真能跳回上一层（" + ok + "/" + tot + "）",
     tot > 0 && ok === tot, miss.slice(0, 4).join("; "));
}

/* =========================================================================
   二十一之二、**不按 W 也能跳上去**（用户 2026-10-28：「上下层玩家直接可以跳」）
   ---------------------------------------------------------------------------
   上面那一节验的是"按 W 爬上去"，而用户要的是**跳**上去 —— 这两件事在
   手感上不是一回事：一个是瞬移，一个是自己跳的。所以这一节**绕开 W 那条
   分支**，直接给一个起跳速度，只靠"跳 + 扒边"看能不能站到上一层地板上。

   上一版为什么做不到（26 个层位里只成功 1 个）：
     洞口两侧都是 3 格箱山，玩家在井梯顶起跳，脚能越过上层地板 27px，
     可是井口左右**没有一块空台面**，横向一碰就被顶回来。
   现在的做法是生成侧留"井口缘"（洞口左边那一列不放箱子），于是井口边上
   有一块 48 宽的台面可以扒、可以落。**这不是把跳高改大** —— 试过把起跳
   速度从 720 提到 860（跳高 123→176），只从 1 个变 4 个：加高解决不了
   "没地方站"。

   转向的时机按玩家的实际做法来：**先跳起来，脚越过上一层地板之后再按方向**
   （起跳同时就按方向会顶到楼板底面 —— 那是真实的，所以没有替玩家作弊）。
   ========================================================================= */
group("二十一之二、不按 W 也能跳到上一层（纯跳 + 扒边）");
{
  let tot = 0, ok = 0, rimmed = 0, rimOK = 0, miss = [];
  for (let sd = 1; sd <= 12; sd++) {
    L.reset(sd);
    const N3 = L.FLOORS.length;
    for (let k = 1; k < N3 - 1; k++) {
      const upper = L.FLOORS[k - 1];
      const h0 = L.LAYERS[k - 1].holes[0];
      if (!h0) continue;
      const l2 = L.LAYERS[k];
      const a = Math.max(0, Math.ceil(h0.x / 48));
      const b = Math.min(19, Math.floor((h0.x + h0.w) / 48) - 1);
      let col = -1;
      for (let i = a; i <= b; i++) if ((l2.colHgt[i] || 0) >= 3) { col = i; break; }
      if (col < 0) continue;
      /* 井口缘在不在？（洞口左边那一列是不是空的） */
      const rim = Math.ceil(h0.x / 48) - 1;
      const hasRim = rim >= 0 && L.LAYERS[k - 1].colHgt[rim] === 0;
      tot++; if (hasRim) rimmed++;
      /* 盖板砸掉（不砸的话一撞头就回来了，那是设计） */
      S.boxes.filter(bx => !bx.dead && bx.x + bx.w > h0.x && bx.x < h0.x + h0.w &&
        bx.y + bx.h > upper - 200 && bx.y < upper + 4).forEach(bx => L.breakBox(bx, "ball"));
      S.foes.length = 0;
      S.keys = {};
      L.placePlayer(col * 48 + 9, l2.floorY - 144 - S.p.h);
      for (let i = 0; i < 8; i++) L.step(DT);
      /* **直接给起跳速度，不走 W 分支** —— 走 W 会被 wellClimb 接走，
         量到的就又是瞬移了。

         **井梯从 3 格降到 2 格（2026-10-28 第二轮）之后，这里必须给两段跳。**
         2 格箱顶离上层地板 144，单跳 123 差 21px，永远够不着；二段跳
         96 + 246 是过的。改的只是"这一节用几段跳"，验的东西没变：
         **不按 W、纯靠跳 + 扒边，能不能站到上一层地板上。** */
      S.p.vy = -720; S.p.onGround = false;
      for (let i = 0; i < 80; i++) {
        if (i === 18 && S.p.jumps > 0) { S.p.vy = -720; S.p.jumps -= 1; }
        /* 脚还在上层地板下面时不按方向（会顶楼板），越过去之后再往井口缘那侧走 */
        S.keys = (S.p.y + S.p.h <= upper - 2) ? { a: true } : {};
        L.step(DT);
      }
      S.keys = {};
      if (S.p.y + S.p.h <= upper + 2) { ok++; if (hasRim) rimOK++; }
      else miss.push("s" + sd + "k" + k + (hasRim ? "" : "(无井口缘)"));
    }
  }
  ck("有井口缘的层位，纯跳全部能上去（" + rimOK + "/" + rimmed + "）",
     rimmed > 0 && rimOK === rimmed, miss.slice(0, 5).join("; "));
  /* **剩下那几个是"薄层"，故意没留井口缘。** 地表层常年是"2 个洞吃 4 列 +
     地形吃 3 列"，再抠一列箱子就掉到 6 口（门槛 12）—— 那 9 个种子的首掷
     通过率直接掉到 95%（门槛 98%）。薄层走按 W 的井梯，那条路上一节已经验过。
     这一条守的是"井口缘不许悄悄消失"（比如 boxCols 判据被改坏）。 */
  ck("井口缘覆盖率 " + rimmed + "/" + tot + "（≥ 75%）", tot > 0 && rimmed >= tot * 0.75,
     "纯跳 " + ok + "/" + tot + "：" + miss.slice(0, 5).join("; "));
}

/* =========================================================================
   二十二、弹药经济：门厅那几只怪到底够不够破冰墙（用户 2026-10-28 提问）
   ---------------------------------------------------------------------------
   用户的直觉是"怪少了会不会没球可推"。这条链不能靠感觉答，要算：

       裹住敌人  → 那只敌人变成球，本金 absorbed = 1（tier 0）
       球撞死另一只敌人 → absorbed += 2
       冰墙要 tier ≥ 1，也就是 absorbed ≥ 2

   ⇒ **一颗能破冰的球要吃 2 只怪**（1 裹 + 1 撞），门厅固定 3 只 → 余 1 只。
   要求 tier 2（absorbed ≥ 4）就变成"一颗球吃 3 只"，门厅刚好够、容错为零：
   玩家先用雪弹打死一只，或者一只怪掉进洞里，就直接死局，而且门上没有任何补救。
   所以 2026-10-28 把冰墙的 minTier 从 2 降到 1。

   这一节**真造一次球**（不走 spawnBall 那条测试捷径），把链条验到底。
   ========================================================================= */
group("二十二、弹药经济（真造球，不 spawnBall）");
{
  L.reset(201);
  const nF2 = L.FLOORS.length;
  const hallY = L.FLOORS[nF2 - 1];
  /* 只留门厅的怪 —— 玩家"一路不杀直接挖到底"就是这个局面，是最坏情况 */
  S.foes = S.foes.filter(f => f.y > hallY - 220);
  ck("门厅自带怪 ≥ 3 只（最坏情况也够造球）", S.foes.length >= 3, S.foes.length);

  const f0 = S.foes[0], f1 = S.foes[1];
  /* **只留这两只。** 球从 f1 往右飞 210px，路上撞到第三只怪也会 +2 ——
     那量到的是"撞了两只"，不是"一只 = +2"。门厅怪的位置随关卡走，
     这条断言因此会随任何生成器改动随机变红（2026-10-29 就红了一次）。 */
  S.foes = [f0, f1];
  /* **黑洞也关掉。** 它会按配额吐新怪，新怪正好出现在球的飞行路径上 ——
     那 30 帧里球"撞到第三只"，absorbed 从 3 变 5。
     这一节要的是"一颗球碾过一只怪 = +2"，场上只能有这两只。 */
  S.nests.length = 0;
  /* 先别让怪乱走，把它们钉在原地，免得"够不够"被位移搅乱 */
  f0.x = 120; f0.y = hallY - 30; f0.vx = 0;
  f1.x = 300; f1.y = hallY - 30; f1.vx = 0;
  /* **把这条弹道上的箱子清掉。** 球从 266 飞到 300，门厅的喂球箱如果正好
     摞在这一段上，球撞在箱子上就停了（实测卡在 x=283.9、vx 从 700 掉到 260），
     f1 一点都不掉血 —— 看起来像"球碾不死怪"。门厅箱子位置随门位置走
     （2026-10-29 门改成全宽随机），所以这一段必须自己清场。 */
  S.boxes.forEach(b => {
    if (b.x < 460 && b.x + b.w > 60 && b.y > hallY - 220 && b.y < hallY + 10) b.dead = true;
  });
  S.balls.length = 0;
  L.hitFoeN(f0, 24);
  const ball = S.balls[0];
  ck("裹住一只怪 → 造出一颗球", !!ball);
  ck("新球本金 = 1，只有 tier 0（不够破冰）",
     ball && ball.absorbed === 1 && L.ballTier(ball.absorbed) === 0 &&
     L.ballTier(ball.absorbed) < L.NUM.box.ice.minTier,
     ball && ("absorbed=" + ball.absorbed + " tier=" + L.ballTier(ball.absorbed)));

  /* 让这颗球去撞死第二只怪 */
  ball.x = f1.x - ball.r - 3; ball.y = f1.y + 12; ball.vx = 700; ball.vy = 0;
  for (let i = 0; i < 30 && !f1.dead; i++) L.step(DT);
  ck("球碾过第二只怪 → 体积 +2", f1.dead && ball.absorbed === 3, ball.absorbed);
  ck("吞掉 1 只之后够档了（tier ≥ 冰墙门槛）",
     L.ballTier(ball.absorbed) >= L.NUM.box.ice.minTier,
     "tier " + L.ballTier(ball.absorbed) + " vs 门槛 " + L.NUM.box.ice.minTier);

  /* 满速助跑时动量够不够（pow = |vx| × r/baseR） */
  const maxVx = L.NUM.push.base * (1 + L.NUM.push.runGain);
  const powFull = maxVx * (ball.r / L.NUM.ball.baseR);
  ck("满速推这颗球，动量过冰墙门槛", powFull >= L.NUM.box.ice.minPow,
     Math.round(powFull) + " vs " + L.NUM.box.ice.minPow);
  /* 破一格之后速度只剩 keepSpeed，第二格必须重新助跑 —— 这是有意的设计 */
  const powAfter = powFull * L.NUM.box.ice.keepSpeed;
  ck("破一格之后掉速，第二格要重新助跑（不是一球通吃）",
     powAfter < L.NUM.box.ice.minPow, Math.round(powAfter) + " vs " + L.NUM.box.ice.minPow);
}

/* =========================================================================
   二十三、手感回归：贴墙起跳不穿箱 / 走坡不弹 / 球不会中途消失
   ---------------------------------------------------------------------------
   **这一节守的是三次"改好了又坏回去"的坑**，全部来自用户 2026-10-28 的反馈
   「玩家上移动会掉入箱子，移动也会出现抖动」：

   ① 扒边会把人横向瞬移 ~26px 挪到台面上。冰墙上面摞着箱子时，那 26px
      正好把人推进上一格箱体内部 —— 实测 48 次里 46 次，最深 30px
      （30px 就是身体宽度，完全埋进去）。根因：**瞬移只验了出发点没验落点。**
   ② 下坡时坡面一帧掉 4px、人只靠重力掉 0.6px，于是人一路腾空、落地、再腾空。
      60 帧里 onGround 翻转 4 次 —— 肉眼就是"一路抖"。
   ③ 球的初始生活是 4.6 秒：刚裹住怪、还没绕到球后面，它就"散了"。
      玩家学到的不是"该怎么推"，而是"这个玩法会自己消失"。
   ========================================================================= */
group("二十三、手感回归（贴墙跳 / 走坡 / 球的生命）");
{
  /* ① 贴墙起跳：每关取几处箱墙，站定、按住 W + 方向键往箱子里挤 40 帧，
     全程身体任何一帧穿进箱体都不许超过 6px（贴脚那一瞬的重叠不算）。 */
  function boxPen(p) {
    let w = -999;
    for (const b of S.boxes) {
      if (b.dead) continue;
      const ox = Math.min(p.x + p.w, b.x + b.w) - Math.max(p.x, b.x);
      const oy = Math.min(p.y + p.h, b.y + b.h) - Math.max(p.y, b.y);
      if (ox <= 0 || oy <= 0) continue;
      w = Math.max(w, Math.min(ox, oy));
    }
    return w;
  }
  let cases = 0, worst = 0;
  for (let sd = 0; sd < 6; sd++) {
    L.reset(1000 + sd * 37);
    settle(30);
    const p = S.p;
    let tried = 0;
    for (const b of S.boxes) {
      if (tried >= 5) break;
      if (b.dead) continue;
      const floor = L.groundAt(b.x + b.w / 2, b.y + b.h + 4);
      if (Math.abs(floor - (b.y + b.h)) > 3) continue;   // 只要站在地上的箱子
      const sx = b.x - p.w - 2;
      if (sx < 50) continue;
      const probe = { x: sx, y: b.y + b.h - p.h, w: p.w, h: p.h };
      if (boxPen(probe) > 0) continue;
      tried++; cases++;
      L.placePlayer(sx, b.y + b.h - p.h);
      S.hp = 999; S.invuln = 999;
      for (let f = 0; f < 40; f++) {
        S.keys = { w: true, d: true };
        L.step(DT);
        S.invuln = 999;
        worst = Math.max(worst, boxPen(p));
      }
      S.keys = {};
    }
  }
  ck("贴墙起跳不会插进箱体（" + cases + " 处，最深 " + worst.toFixed(1) + "px ≤ 6）",
     cases > 20 && worst <= 6, worst.toFixed(1));

  /* ② 走坡：从坡的高端往下走 60 帧，落地状态不许反复翻转。
     留 1 次容差（走到坡脚、落到地板那一下本来就该算一次落地）。 */
  let flipWorst = 0, slopeCases = 0;
  for (let sd = 0; sd < 6; sd++) {
    L.reset(1000 + sd * 37);
    settle(30);
    const p = S.p;
    const rp = S.plats.filter(pl => pl.kind === 'ramp' && pl.rise > 0)[0] ||
               S.plats.filter(pl => pl.kind === 'ramp' && pl.rise < 0)[0];
    if (!rp) continue;
    slopeCases++;
    const backRight = rp.rise > 0;                   // 高端在右 → 从右往左走 = 下坡
    const sx = backRight ? rp.x + rp.w - 6 - p.w : rp.x + 6;
    L.placePlayer(sx, L.surfY(rp, sx + p.w / 2) - p.h);
    S.hp = 999; S.invuln = 999;
    let flips = 0, last = S.p.onGround;
    for (let f = 0; f < 60; f++) {
      S.keys = backRight ? { a: true } : { d: true };
      L.step(DT);
      S.invuln = 999;
      if (p.onGround !== last) flips++;
      last = p.onGround;
    }
    S.keys = {};
    flipWorst = Math.max(flipWorst, flips);
  }
  ck("走下坡不会一路弹（" + slopeCases + " 条坡，最多翻转 " + flipWorst + " 次 ≤ 1）",
     slopeCases > 0 && flipWorst <= 1, flipWorst);

  /* ③ 球的生命：够玩家绕到球后面、还要够他试错一次。 */
  ck("球的生命 ≥ 12s（不是 4.6s：" + L.NUM.ball.life + "s）", L.NUM.ball.life >= 12, L.NUM.ball.life);
  /* 找一个**空地**：出生点右边可能就是一摞箱子，人在那儿走不动，
     球自然推不到 —— 第一版就踩了这个空，白看了两轮"没推上"。 */
  L.reset(1000); settle(30);
  /* **先清场。** 这一条测的是"推一下 life 回满"，不是"能不能绕过箱子"。
     角色从 30 宽提到 45 之后，原来那段空地上挤不下 —— 玩家被右侧的箱子
     顶住，12 帧里一步没挪（实测 vx 在 0 和 -260 之间抖），于是断言量到的是
     "球自然衰减了 0.2 秒"，看着像推球坏了，其实是路被堵了。
     清场之后这条路只连着地形，量的就是推球本身。 */
  S.boxes.forEach(b => { b.dead = true; });
  S.foes.forEach(f => { f.dead = true; });
  const seg = S.plats.filter(pl => pl.kind !== 'ramp' && pl.w >= 260 && pl.y === L.FLOORS[0])[0];
  const px0 = (seg ? seg.x : 60) + 40;
  L.placePlayer(px0, L.FLOORS[0] - S.p.h);
  const bb = L.spawnBall(px0 + S.p.w + 10, L.FLOORS[0] - L.ballR(1), 0, 1);
  for (let i = 0; i < 120; i++) L.step(DT);            // 放 2 秒
  const decayed = bb.life;
  S.keys = { d: true };
  for (let i = 0; i < 20; i++) L.step(DT);             // 走过去顶一下
  S.keys = {};
  /* **不要比"是否等于满值"**：推完之后还在继续 step，life 每帧都在掉。
     比"推之前涨了一截"就行 —— 第一版写成 `|life − 满值| < 0.01`，
     于是自家断言被自己多跑的那三帧打败了。 */
  ck("推一下球的生命回满（" + decayed.toFixed(1) + "s → " + bb.life.toFixed(1) + "s）",
     bb.life > decayed + 1,
     decayed.toFixed(1) + " / " + bb.life.toFixed(1));
}

/* =========================================================================
   二十四、敌方三种：会跳、会待机、会打人、侧视
   ========================================================================= */
group("二十四、敌方三种（跳跃 / 待机 / 远程 / 侧视）");
{
  /* 24.1 三种剪影都出现 —— 用户说的"太少了"里，一半是数量，一半是同质。
     **2026-10-28 起敌方不再是兔/狗/刺猬**：用户指出"敌方为什么用我方的宠物"，
     所以 breed 换成了 moss/fang/grub 三只怪物。这条断言盯的就是这件事。 */
  const pets = new Set();
  for (let sd = 1; sd <= 12; sd++) { L.reset(sd); S.foes.forEach(f => pets.add(f.breed)); }
  ck("三种敌方都上场了（" + Array.from(pets).sort().join(" / ") + "）",
     pets.size >= 3, "只出现 " + pets.size + " 种");

  /* 24.2 数量：一关至少 10 只（6 层 × 2 + 门厅 3） */
  let few = [];
  for (let sd = 1; sd <= 12; sd++) {
    L.reset(sd);
    if (S.foes.length < 8) few.push(sd + ":" + S.foes.length);
  }
  ck("每层至少 2 只、一关至少 8 只（" + (few.length ? few.join(" ") : "12 个种子全部达标") + "）",
     few.length === 0, few.join(" "));

  /* 24.3 会跳 —— **判据是"向上弹起"（vy < -150）。**
     不能拿"y 变小"当判据：怪从箱顶掉下来再被箱子接住也会让 y 变小。

     **2026-10-28 晚改过判据。** 原来是"10 个种子里 ≥7 个看得到敌人起跳"，
     但那一版三只怪共用一套"遇坎就跳"，所以多足甲虫也在箱堆上蹦。
     现在按体态分（见 NUM.breed 的注释）：只有四足兽会跳，多足甲虫和无腿
     苔藓团蹲着爬。**再拿"全体都在跳"当判据就变成了鼓励错误设计** ——
     甲虫跳得越欢，断言越绿。

     所以拆成三条，分别守住"该跳的会跳"和"不该跳的绝不跳"：
       ① 静态：gait 和 jump 必须自洽（这是设计意图本身）
       ② 动态：四足兽真的起跳
       ③ 动态：多足 / 无腿的**一次都不能离地**  */
  const CFG = L.NUM.breed;
  ck("四足兽 gait=run 且 jump>0（" + CFG.fang.gait + " / " + CFG.fang.jump + "）",
     CFG.fang.gait === 'run' && CFG.fang.jump > 0, JSON.stringify(CFG.fang));
  ck("多足甲虫 gait=crawl 且 jump=0（" + CFG.grub.gait + " / " + CFG.grub.jump + "）",
     CFG.grub.gait === 'crawl' && CFG.grub.jump === 0, JSON.stringify(CFG.grub));
  ck("无腿苔藓团 gait=slide 且 jump=0（" + CFG.moss.gait + " / " + CFG.moss.jump + "）",
     CFG.moss.gait === 'slide' && CFG.moss.jump === 0, JSON.stringify(CFG.moss));

  {
    let jumped = { moss: 0, fang: 0, grub: 0 }, frames = 0;
    for (let sd = 1; sd <= 14; sd++) {
      L.reset(sd);
      S.invuln = 999; S.hp = 99;       // 别让撞脸把怪变成球，凭空少一只
      for (let i = 0; i < 240; i++) {
        L.step(DT);
        for (const f of S.foes) if (f.vy < -150) jumped[f.breed] = (jumped[f.breed] || 0) + 1;
        frames++;
      }
    }
    ck("四足兽在 14 个种子 × 240 帧里真的起跳过（" + jumped.fang + " 帧，共 " + frames + " 帧）",
       jumped.fang > 0, jumped.fang);
    ck("多足甲虫从头到尾没离过地（" + jumped.grub + " 帧）", jumped.grub === 0, jumped.grub);
    ck("无腿苔藓团从头到尾没离过地（" + jumped.moss + " 帧）", jumped.moss === 0, jumped.moss);
  }

  /* 24.4 会待机 —— 站住的时候 vx 必须是 0（否则"待机"只是画面上不动） */
  {
    L.reset(4);
    S.foes.length = 0; S.hp = 99; S.invuln = 999;
    const seg = S.plats.filter(p => p.kind !== 'ramp' && p.w >= 300).pop();
    L.placePlayer(seg.x + 20, seg.y - S.p.h);
    settle(4);
    const f = L.spawnFoe(seg.x + 140, seg.y - L.FOE_H, 'crawler', 'moss');
    f.vx = 0; f.speed = 80;
    let idled = 0;
    for (let i = 0; i < 240; i++) {
      L.step(DT);
      if (f.idleT > 0 && Math.abs(f.vx) < 1) idled++;
    }
    ck("敌人会站着待机（240 帧里 " + idled + " 帧）", idled > 20, idled + " 帧");
  }

  /* 24.5 会打人 + 弹道是抛物线 */
  const foeShot = (br) => {
    L.reset(4);
    S.foes.length = 0; S.ebullets.length = 0; S.hp = 99; S.invuln = 999;
    /* **箱子全清。** 这一节测弹道本身；半路上随机有一摞箱子会把子弹打掉，
       量出来是"飞出 27px"，看起来像弹道参数写错了。箱子挡子弹另有断言。 */
    S.boxes.forEach(b => b.dead = true);
    const seg = S.plats.filter(p => p.kind !== 'ramp' && p.w >= 420 && Math.abs(p.y - L.FLOORS[0]) < 1)[0]
             || S.plats.filter(p => p.kind !== 'ramp' && p.w >= 420)[0];
    L.placePlayer(seg.x + 30, seg.y - S.p.h);
    settle(6);
    const f = L.spawnFoe(S.p.x + 220, seg.y - 30, 'crawler', br);
    f.face = -1; f.vx = 0; f.speed = 0; f.fireCd = 0;
    f.roamL = f.x; f.roamR = f.x;
    /* **必须咬住"第一颗"的引用。** 早先每帧都取 S.ebullets[0] —— 第一颗消失
       之后数组头换成第二颗，minY / maxY 就成了两根不同弹道拼起来的数字，
       量出来"落差 44px"跟任何一颗都对不上。 */
    let first = null, minY = Infinity, maxY = -Infinity, x0 = 0, x1 = 0;
    for (let i = 0; i < 200; i++) {
      L.step(DT);
      if (!first && S.ebullets.length) { first = S.ebullets[0]; x0 = first.x; }
      if (first && !first.dead) { minY = Math.min(minY, first.y); maxY = Math.max(maxY, first.y); x1 = first.x; }
    }
    return { f, first, minY, maxY, y0: first ? undefined : 0, x0, x1 };
  };
  {
    const r = foeShot('moss');
    ck("苔泥团会朝玩家丢东西（fireCd 归零后 200 帧内命中射界就开火）", !!r.first,
       "aim=" + (r.f.aim || 0).toFixed(2));
    if (r.first) {
      /* 抛物线两条：初始上扬（vy < 0），飞行中下垂 ≥ 20px；水平行程 ≥ 150px。
         **下垂阈值从 25 降到 20（2026-10-29）。** 这里下坠多少由"飞了多久"
         决定，而这颗子弹从敌人口中（玩家 x+220）飞 0.73 秒就打中玩家了 ——
         g=210 / vy0=-60 在 0.73 秒里只落下 23px。这不是弧线消失，
         是它还没来得及弯就被挡住了；玩家自己的子弹（飞 0.62 秒、g=520）
         那条另有一节，量到 52px。 */
      const drop = r.maxY - r.minY;
      const reach = Math.abs(r.x1 - r.x0);
      ck("投掷物是抛物线不是直线（下垂 " + drop.toFixed(0) + "px / 水平 " + reach.toFixed(0) + "px）",
         r.first.vx !== 0 && drop > 20 && reach > 150,
         "下垂 " + drop.toFixed(0) + " 行程 " + reach.toFixed(0));
    } else {
      ck("投掷物是抛物线不是直线", false, "根本没打出来");
    }
  }
  /* 三种敌人的投掷物互不相同（用户要求"子弹要符合特点"）。
     **直接查配置，不查运行时的 S.ebullets** —— 那个数组在结束时已经被清空了。 */
  {
    const set = new Set(['moss', 'fang', 'grub'].map(p => L.NUM.breed[p].bullet));
    ck("三种敌人各有自己的投掷物（" + Array.from(set).join(" / ") + "）", set.size === 3,
       Array.from(set).join(","));
  }

  /* 24.6 打得到人：把玩家摆在弹道上，跑 3 秒，血必须掉 */
  {
    L.reset(4);
    S.foes.length = 0; S.ebullets.length = 0;
    S.hp = 5; S.invuln = 0;
    S.boxes.forEach(b => b.dead = true);
    const seg = S.plats.filter(p => p.kind !== 'ramp' && p.w >= 420 && Math.abs(p.y - L.FLOORS[0]) < 1)[0]
             || S.plats.filter(p => p.kind !== 'ramp' && p.w >= 420)[0];
    L.placePlayer(seg.x + 30, seg.y - S.p.h);
    settle(4);
    const f = L.spawnFoe(S.p.x + 200, seg.y - 30, 'crawler', 'fang');
    f.face = -1; f.vx = 0; f.speed = 0; f.fireCd = 0;
    f.roamL = f.x; f.roamR = f.x;
    const hp0 = S.hp;
    for (let i = 0; i < 240; i++) { S.keys = {}; L.step(DT); if (S.hp < hp0) break; }
    ck("敌人的投掷物能打到玩家（" + hp0 + " → " + S.hp + "）", S.hp < hp0, "一发都没中");
  }
}

/* =========================================================================
   二十五、箱子不再铺满地形（堆 + 平地 + 桶）
   ========================================================================= */
group("二十五、箱子是一堆一堆的，不是地形");
{
  let layers = 0, withGap = 0, withBarrel = 0, over = 0;
  for (let sd = 1; sd <= 40; sd++) {
    const g = L.genLevel(sd);
    let hasBarrel = false;
    g.layers.forEach(l => {
      layers++;
      const H = l.colHgt || [];
      let zero = 0;
      for (const h of H) if (h === 0) zero++;
      /* **判据是"留出了几列平地"，不是"箱子少于多少"。**
         用户的抱怨是"密密麻麻"，那是"一眼看过去没有空隙"，
         而不是"总数多"。20 列里留出 6 列平地，就是一堆一堆的。 */
      if (zero >= 6) withGap++;
      let sum = 0; for (const h of H) sum += h;
      if (sum > 32) over++;
    });
    if (g.boxes.some(b => b.barrel)) withBarrel++;
  }
  ck("至少 85% 的层留出了 6 列以上平地（" + withGap + "/" + layers + "）",
     withGap >= layers * 0.85, "有 " + (layers - withGap) + " 层没留够");
  ck("没有哪一层又被铺成连续地形（高总和 ≤ 32 格）", over === 0, over + " 层超标");
  ck("木桶出现在绝大多数关里（" + withBarrel + "/40）", withBarrel >= 34, withBarrel + "/40");
}

/* =========================================================================
   二十六、左右走不晃
   ========================================================================= */
group("二十六、左右走不晃（镜头不跟横移 / 平地不掉）");
{
  /* **箱子先清空。** 这一节测的是"移动本身有没有抖"，
     箱子台阶带来的上下是设计（现在堆间有平地），不该混进来。 */
  let seg = null;
  for (let sd = 1; sd <= 8 && !seg; sd++) {
    L.reset(sd);
    S.boxes.forEach(b => b.dead = true);
    S.foes.length = 0; S.hp = 99; S.invuln = 999;
    const F0 = L.FLOORS[0];
    settle(6);
    /* **把第一层的地形整片拆掉。** 这条测的是"平路上脚不抖"，
       而要找到一条 300 宽、中间没有平台和雪包的干净长段，
       在地形密度提上来之后（2026-10-29）第一层经常没有 ——
       测试就会假红成"找不到一段平地"。要测平路，先把坡搬走。 */
    /* **ramp 一律删** —— 坡的 `y` 是坡底（= F0），按高度筛漏掉它，
       而孤坡的顶点正好把脚底抬高 38~50。平台按 (F0-200, F0) 删。 */
    S.plats = S.plats.filter(p => p.kind !== 'ramp' && !(p.y < F0 && p.y > F0 - 200));
    /* **必须选玩家脚下那一层。** 之前直接取全场最长的一段 —— 那多半在
       别的层上，玩家被放上去之后一步就掉下去，镜头跟着换层，
       量出来是"走了 45 帧，镜头动了 151px"，看着像镜头在跟横移。 */
    seg = S.plats.filter(p => p.kind !== 'ramp' && p.w >= 300 && Math.abs(p.y - F0) < 1)
      .sort((a, b) => b.w - a.w)[0] || null;
    if (seg) break;
  }
  if (!seg) {
    ck("找得到一段 ≥360 宽的平地", false, "没找到");
  } else {
    L.placePlayer(seg.x + 16, seg.y - S.p.h);
    settle(10);
    const cam0 = S.cam.y, feet0 = S.p.y + S.p.h;
    let camMax = 0, feetMax = 0, back = 0, lastX = S.p.x;
    for (let i = 0; i < 45; i++) {
      S.keys = (S.p.x + S.p.w < seg.x + seg.w - 40) ? { d: true } : {};
      L.step(DT);
      camMax = Math.max(camMax, Math.abs(S.cam.y - cam0));
      feetMax = Math.max(feetMax, Math.abs((S.p.y + S.p.h) - feet0));
      if (S.p.x < lastX - 0.01) back++;
      lastX = S.p.x;
    }
    S.keys = {};
    ck("走一段平路：镜头一动不动（最大位移 " + camMax.toFixed(2) + "px）", camMax < 0.6,
       camMax.toFixed(2) + "px");
    ck("走一段平路：脚底不上下（最大位移 " + feetMax.toFixed(2) + "px）", feetMax < 0.6,
       feetMax.toFixed(2) + "px");
    ck("走的时候没有回弹（" + back + " 帧倒退）", back === 0, back + " 帧");
  }
}

/* =========================================================================
   二十七、场景装饰
   ========================================================================= */
group("二十七、场景装饰（三件新的 + 不压洞口 / 不浮空）");
{
  const CEIL = ['lamp', 'chandelier', 'lantern', 'beam', 'rope', 'vine', 'web', 'flag'];
  const lvWith = { chandelier: 0, lantern: 0, ladder: 0 };
  let total = 0, layers = 0, emptyLayer = 0;
  let ceilOnSurface = 0, onHole = 0, floatY = 0;
  for (let sd = 1; sd <= 24; sd++) {
    const g = L.genLevel(sd);
    const has = { chandelier: false, lantern: false, ladder: false };
    for (const d of g.deco) {
      total++;
      if (has[d.kind] != null) has[d.kind] = true;
      const isCeil = CEIL.indexOf(d.kind) >= 0;
      /* 地表层的顶是天空。**挂件掉到地表就是"半空飘着一盏灯"** ——
         曾经出图时右上角确实飘过一面旗，被当成 UI 残留。 */
      if (isCeil && d.layer === 0) ceilOnSurface++;
      const l = g.layers[d.layer];
      /* 洞口是唯一的上下通道。**两类件的避让对象不同**：
         挂件会堵住从上层下来的路 → 只查上面那层的洞口；
         落地件摆在洞上就是浮在空中 → 只查本层洞口。
         （把两边合成一条判据就会互相误伤，生成侧踩过这个坑。） */
      const near = (hs) => hs.some(h => d.x > h.x - 30 && d.x < h.x + h.w + 30);
      if (isCeil) {
        if (d.layer > 0 && near(g.layers[d.layer - 1].holes)) onHole++;
      } else if (near(l.holes)) onHole++;
      /* 地面件必须踩在本列落脚面上（可能是箱山顶），不能浮空。 */
      if (!isCeil) {
        const gi = Math.max(0, Math.min(19, Math.floor(d.x / 48)));
        const gy = (l.colTop && l.colTop[gi] != null) ? l.colTop[gi] : l.floorY;
        if (Math.abs(d.y - (gy + 1)) > 0.51) floatY++;
      }
    }
    for (let k = 0; k < g.layers.length; k++) {
      layers++;
      if (g.deco.filter(d => d.layer === k).length < 3) emptyLayer++;
    }
    for (const kk in has) if (has[kk]) lvWith[kk]++;
  }
  ck("三种新装饰都上场了（枝形吊灯 / 挂灯笼 / 断梯）",
     lvWith.chandelier > 0 && lvWith.lantern > 0 && lvWith.ladder > 0, JSON.stringify(lvWith));
  ck("枝形吊灯覆盖过半的关（" + lvWith.chandelier + "/24）", lvWith.chandelier >= 12,
     lvWith.chandelier + "/24");
  ck("挂灯笼覆盖过半的关（" + lvWith.lantern + "/24）", lvWith.lantern >= 12,
     lvWith.lantern + "/24");
  ck("断梯覆盖过半的关（" + lvWith.ladder + "/24）", lvWith.ladder >= 12,
     lvWith.ladder + "/24");
  ck("每一层至少 3 件装饰（" + (layers - emptyLayer) + "/" + layers + " 层达标，" +
     total + " 件）", emptyLayer === 0, emptyLayer + " 层太秃");
  ck("天花板件不会掉到地表层（地表上面是天空）", ceilOnSurface === 0, ceilOnSurface + " 件");
  ck("没有装饰压住上下通道", onHole === 0, onHole + " 件压洞口");
  ck("地面件都踩在落脚面上，没有浮空", floatY === 0, floatY + " 件浮空");
}

/* =========================================================================
   二十八、打击感 + 落地容器是实体
   ========================================================================= */
group("二十八、打击感（碎片形状 / 冲停 / 冲击环）+ 容器是实体");
{
  /* 28.1 球砸木箱：碎片够多、有板条、有环、有顿帧 */
  {
    L.reset(3);
    S.balls.length = 0; S.frags.length = 0; S.rings.length = 0; S.hitStop = 0; S.shake = 0;
    const box = S.boxes.filter(b => !b.dead && b.mat === 'wood')[0];
    if (!box) { ck("球砸木箱有碎片与冲击环", false, "这一关没有木箱"); }
    else {
      /* **先把球飞过来的路上清空。** 目标木箱左边如果还摞着别的箱子，
         球会撞在隔壁：每帧掉 8 片 dot 碎片、目标箱子一动不动，
         测出来是"102 片、长条 0"。生成器一改布局，第一个木箱就从
         "堆边上"变成"箱山中间" —— 这条断言因此红过一次（2026-10-29）。
         清场之后测的才是"砸木箱是什么样"，而不是"球能不能挤过箱缝"。 */
      S.boxes.forEach(b => {
        if (b === box || b.dead) return;
        if (b.x < box.x && b.x + b.w > box.x - 140) b.dead = true;
      });
      const ball = L.spawnBall(box.x - 30, box.y + box.h / 2, 700, 3);
      ball.r = L.NUM.ball.maxR;
      for (let i = 0; i < 30 && !box.dead; i++) L.step(DT);
      const planks = S.frags.filter(f => f.shape === 'plank').length;
      ck("球砸木箱：碎成板条（" + S.frags.length + " 片，其中长条 " + planks + "）",
         S.frags.length >= 15 && planks >= 5, S.frags.length + " 片 / " + planks + " 长条");
      ck("球砸木箱有两层冲击环", S.rings.length >= 2, S.rings.length + " 个环");
      /* 顿帧：球破箱的 hitStop 必须比雪弹大 —— 那是"重"和"轻"的区别 */
      ck("球砸有顿帧（" + (S.hitStop || 0).toFixed(3) + "s）", (S.hitStop || 0) > 0.05,
         String(S.hitStop));
      /* **震屏判据 2026-10-29 改过，别照抄旧数字。**
         原判据是 `>= 8`（峰值上限当时是 14）。用户反馈「满屏的震动」之后
         峰值压到 6.5，8 永远不可能达到 —— 但直接改成 `>= 5` 只是"让红的变绿"，
         真正该守的是两条线：
           · 下限：球砸箱必须"看得见"（≥5px，960 宽的屏上约 0.5%）；
           · 上限：**任何一次震屏都不许超过 8px**。上限比下限重要 ——
             以后谁把 14 加回来，下限照样过，只有上限能拦住。 */
      ck("球砸有震屏（" + S.shake.toFixed(1) + "px，≥5）", S.shake >= 5, S.shake.toFixed(2));
      ck("震屏不超过 8px（" + S.shake.toFixed(1) + "px）", S.shake <= 8, S.shake.toFixed(2));
    }
  }

  /* 28.2 石箱不产板条 —— 材质不同，碎法不同 */
  {
    L.reset(3);
    S.balls.length = 0; S.frags.length = 0;
    const box = S.boxes.filter(b => !b.dead && b.mat !== 'wood')[0];
    if (!box) { ck("石箱碎成棱角块而不是板条", false, "这一关没有石箱"); }
    else {
      /* **先把目标周围清空。** 球砸碎石箱之后按 keepSpeed 继续飞，
         撞上旁边的木箱就会补进来一堆 `plank` —— 那量到的是"隔壁木箱"，
         不是"石箱碎法"。实测 150 片里有 12 片板条，全是这么来的。 */
      S.boxes.forEach(b => {
        if (b === box) return;
        if (Math.abs(b.x - box.x) < 140 && Math.abs(b.y - box.y) < 140) b.dead = true;
      });
      const ball = L.spawnBall(box.x - 30, box.y + box.h / 2, 700, 3);
      ball.r = L.NUM.ball.maxR;
      for (let i = 0; i < 30 && !box.dead; i++) L.step(DT);
      /* **按形状名数，不按宽高比。** 理由见 addFrag 里的 shape 字段：
         `w > h*1.6` 会把随机撞出来的一块瘦长棱角也算成板条。 */
      const planks = S.frags.filter(f => f.shape === 'plank').length;
      ck("石箱碎成棱角块而不是板条（" + S.frags.length + " 片，长条 " + planks + "）",
         S.frags.length >= 10 && planks === 0, planks + " 长条");
    }
  }

  /* 28.3 落地的容器必须是实体（用户：「又不形成阻挡啥的 就是个图贴上去」） */
  {
    let props = 0, levels = 0, lidx = 0;
    for (let sd = 1; sd <= 20; sd++) {
      L.reset(sd); levels++;
      const n = S.boxes.filter(b => b.prop && !b.dead).length;
      props += n;
      if (n > 0) lidx++;
    }
    ck("每关都有罐子/小箱这类实体小道具（" + (props / levels).toFixed(1) + " 个/关）",
       props / levels >= 2, props + " 个 / " + levels + " 关");
    ck("道具真的进了碰撞（solids 里能查到）", (() => {
      L.reset(1);
      const p = S.boxes.filter(b => b.prop && !b.dead)[0];
      if (!p) return false;
      return L.groundAt(p.x + p.w / 2, p.y + p.h / 2) === p.y + p.h ||
             L.groundAt(p.x + p.w / 2, p.y - 4) === p.y;
    })(), "solids 里找不到");
    ck("道具一发就碎（hp = 1）", (() => {
      L.reset(1);
      return S.boxes.filter(b => b.prop).every(b => b.hp === 1);
    })(), "有道具 hp > 1");
  }

  /* 28.4 敌人不再是"我方宠物"的外观，也不再是正面双眼 */
  {
    L.reset(2);
    const bad = S.foes.filter(f => ['bunny', 'doggy', 'hoggy'].indexOf(f.breed) >= 0);
    ck("敌人不再用兔/狗/刺猬的形象", bad.length === 0, bad.length + " 只");
    const cfg = L.NUM.breed;
    ck("三种敌人的投掷物都在 ebullet.spd 里有速度",
       ['moss', 'fang', 'grub'].every(b => cfg[b] && L.NUM.ebullet.spd[cfg[b].bullet] > 0),
       JSON.stringify(Object.keys(cfg || {})));
  }

  /* 28.5 **"看着能撞的，就真能撞"**（用户 2026-10-28 的原话：
     「又不形成阻挡啥的 就是个图贴上去」）。
     木桶 / 陶罐 / 小木箱曾经是纯装饰 —— 画得和能推的箱子一模一样，
     却穿得过去。现在整类搬进了 boxes。这条断言守着"别再搬回来"：
     装饰池里只要出现这四个名字，就说明又有一件"假实体"混进去了。 */
  {
    const FAKE_SOLID = ['barrel', 'jar', 'crate', 'shelf'];
    let seen = 0, kinds = {};
    for (let sd = 1; sd <= 6; sd++) {
      L.reset(sd);
      for (const d of S.deco) {
        kinds[d.kind] = 1;
        if (FAKE_SOLID.indexOf(d.kind) >= 0) seen++;
      }
    }
    ck("装饰层里没有'看着像容器'的假实体（" + seen + " 件）", seen === 0,
       Object.keys(kinds).filter(k => FAKE_SOLID.indexOf(k) >= 0).join(","));
  }
}

/* =========================================================================
   二十九、怪物不会原地抽搐
   ---------------------------------------------------------------------------
   **这一条是"看图看不出来、但玩起来一下就烦"的典型。**
   runner 的朝向每帧由"玩家在哪边"重算，人一旦走到它身上，左右判定就翻；
   换向锁把它掐成"每 0.3 秒翻一次"，148×0.3 = 44px 的来回 —— 画面上是
   一只绕着玩家抽搐的怪。2026-10-28 探针量到 2 秒换向 6 次就是这么来的。
   判据只看"真正的方向反转"（两边都非零、符号相反），待机时的 vx=0 不算，
   否则这个数字量的是"宠物有多勤快"，不是"它有没有在原地抽"。
   阈值 3：巡逻换向每 1.4~2.6 秒一次，2 秒里最多 2 次是正常节奏，3 是上限。
   ========================================================================= */
group("二十九、怪物不会原地抽搐（帧间换向次数）");
{
  const DT = 1 / 60;
  let worst = 0, worstName = "", worstSeed = 0;
  for (let s = 0; s < 12; s++) {
    const seed = 2000 + s * 31;
    L.reset(seed);
    for (let i = 0; i < 20; i++) L.step(DT);          // 先让场景落定
    L.placePlayer(60, L.FLOORS[0] - S.p.h);           // 把人挪远，别让怪追人
    for (const f of S.foes) {
      let prev = f.vx, flips = 0;
      for (let i = 0; i < 120; i++) {                 // 2 秒
        L.step(DT);
        if (f.vx !== 0 && prev !== 0 && Math.sign(f.vx) !== Math.sign(prev)) flips++;
        prev = f.vx;
      }
      if (flips > worst) { worst = flips; worstName = f.kind; worstSeed = seed; }
    }
  }
  ck("12 个种子里，怪物 2 秒最多换向 3 次（实测 " + worst + " 次，" + worstName +
     " @seed " + worstSeed + "）", worst <= 3, worst + " 次");
}

/* =========================================================================
   三十、形象和碰撞是同一个尺度
   ---------------------------------------------------------------------------
   **这是"看着能过、其实过不去"的源头，所以单独守一条。**
   绘制函数里的坐标是按 30×42 的手画比例铺的，放大靠 `ART_K` 在脚底中心
   套一个缩放；碰撞框则是 `PLAYER_W/H`。两边**必须同比例** ——
   只放大形象，玩家会觉得自己被空气墙挡住；只放大碰撞框，会看到自己
   半个身子埋进箱子里。2026-10-28 就是先只改了形象，探针立刻量到
   "站在箱沿上莫名掉下去"。

   判据用乘法（30 × ART_K = PLAYER_W），不是相等 —— 以后想整体再放大
   一档，只要两边一起改，这条照样绿。
   ========================================================================= */
group("三十、形象与碰撞同尺度");
{
  /* 30 / 34 是绘制函数里写死的基准宽度（`drawPlayer` 的椭圆半径、
     `drawFoe` 的横向跨度都是按这两个数铺的），改绘制的基准才动这里。 */
  ck("玩家：形象宽 30 × ART_K = 碰撞宽 " + S.p.w,
     Math.abs(30 * L.ART_K - S.p.w) < 0.51, (30 * L.ART_K).toFixed(1) + " vs " + S.p.w);
  ck("敌人：形象宽 34 × FOE_K = 碰撞宽 " + L.FOE_W,
     Math.abs(34 * L.FOE_K - L.FOE_W) < 0.51, (34 * L.FOE_K).toFixed(1) + " vs " + L.FOE_W);

  /* ---- 尺寸层次：**敌人不许越级到箱子那一档** ----------------------------
     2026-10-28 晚：第一版让敌人跟玩家共用 ART_K，34×30 变成 51×45，
     出图上霜甲虫和木箱（48）几乎等宽、尖牙兽比两个箱子还长 ——
     读起来不是"小兵"而是"和箱子同级的障碍物"。用户的原话：
     「敌方体态都超过了箱子 是不是不太好」。

     判据用 0.85 而不是 1.0：**"小于"不够，要"明显小于"。**
     0.95 那种擦边的尺寸在屏幕上根本读不出差别，得留一格的余量，
     眼睛才认得出"这个能踩""那个是墙"。 */
  const BOX = 48;
  ck("敌人明显小于箱子（" + L.FOE_W + " / " + BOX + " = " +
     (L.FOE_W / BOX).toFixed(2) + "，要 ≤ 0.85）", L.FOE_W / BOX <= 0.85, L.FOE_W / BOX);
  ck("敌人高度也小于箱子（" + L.FOE_H + " / " + BOX + " = " +
     (L.FOE_H / BOX).toFixed(2) + "）", L.FOE_H / BOX <= 0.85, L.FOE_H / BOX);
  /* 玩家比箱子**窄**、比箱子**高** —— 才读得出"人站在箱子里"，而不是
     "另一个方块"。宽度这一条尤其关键：玩家一旦宽过箱子，站在箱堆上就分不清
     哪一格是他、哪一格是箱子。 */
  ck("玩家比箱子窄（" + S.p.w + " / " + BOX + " = " + (S.p.w / BOX).toFixed(2) + "）",
     S.p.w / BOX < 1, S.p.w / BOX);
  ck("玩家比箱子高（" + S.p.h + " / " + BOX + " = " + (S.p.h / BOX).toFixed(2) + "）",
     S.p.h / BOX > 1.15, S.p.h / BOX);

  ck("玩家高度足够立绘承载细节（≥ 56px）", S.p.h >= 56, S.p.h);
  ck("角色占屏高 10%~16%（现在 " + (S.p.h / 600 * 100).toFixed(1) + "%）",
     S.p.h / 600 >= 0.10 && S.p.h / 600 <= 0.16, (S.p.h / 600).toFixed(3));
  /* 净空：站在井梯顶（3 格 = 144）时，碰撞框头顶到上一层楼板底面还剩多少。
     **这里按碰撞框算，不按形象算。** 形象高 81.6（含耳朵和呆毛），比碰撞框
     63 高出 18 —— 但井梯一定在洞口正下方，头顶顶到的是那个洞，不是楼板。
     所以真正要守的是"碰撞框别撞头"，形象穿进洞口是正常且必要的
     （不穿的话就变成"人比洞还宽"了）。 */
  const room = L.GEN.floorH - L.GEN.thick - 144 - S.p.h;
  ck("站在井梯顶还剩 " + Math.round(room) + "px 头顶空间（≥ 5）", room >= 5, room.toFixed(1));
}

/* =========================================================================
   三十六、内嵌角色贴图：不许过期、不许比箱子大
   =========================================================================
   贴图改成"内嵌 base64"之后，**改了 png 忘了重新生成**是最容易发生、也
   最不吭声的事故：浏览器里只是继续显示上一版，没有任何提示。
   所以这里比字节，不比"大概对不对"。

   顺带守一条**只能算不能看**的规矩：敌人形象宽度 ≤ 0.85 × 箱子。
   用户原话「敌方体态都超过了箱子　是不是不太好」—— 图上"看着差不多"
   和实际超没超，差 6px 眼睛根本分不出来。贴图宽高比在这里直接从 PNG
   文件头读（IHDR 第 16~23 字节），不需要解码，jsdom 里也跑得动。 */
group("三十六、内嵌角色贴图");
{
  const crypto = require("crypto");
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  const FILES = {
    "pet-cat": path.join(ROOT, "assets", "resources", "grove", "pet", "cat.png"),
    "foe-moss": path.join(ROOT, "assets", "snowlab", "foe", "moss.png"),
    "foe-fang": path.join(ROOT, "assets", "snowlab", "foe", "fang.png"),
    "foe-grub": path.join(ROOT, "assets", "snowlab", "foe", "grub.png"),
  };
  const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

  for (const key in FILES) {
    const re = new RegExp('<script id="art-' + key + '" type="text/plain">data:[^;]+;base64,([A-Za-z0-9+/=]+)</script>');
    const mm = html.match(re);
    ck("内嵌 art-" + key + " 存在", !!mm);
    if (!mm) continue;
    const disk = fs.readFileSync(FILES[key]);
    ck("内嵌 art-" + key + " 与磁盘 png 完全一致（" + Math.round(disk.length / 1024) + "KB）",
      sha(Buffer.from(mm[1], "base64")) === sha(disk),
      "改完图要重跑 node tools/_inline-art.js");
  }

  /* 形象宽度：h × (图宽 / 图高)，h 来自 FOE_ART（世界像素） */
  /* 形象宽度 = h × (图宽 / 图高)，h 取自 FOE_ART（世界像素）。
     `BOX` 在上面那一节的块作用域里，这一段自己取一次。 */
  const BOX = 48;
  for (const b of ["moss", "fang", "grub"]) {
    const A = L.FOE_ART[b];
    ck("FOE_ART." + b + " 有配图", !!A && !!A.key);
    if (!A) continue;
    const f = FILES[A.key];
    if (!f) { ck("FOE_ART." + b + " 指向的图在内嵌表里", false, A.key); continue; }
    const z = pngSize(fs.readFileSync(f));
    const drawW = A.h * (z.w / z.h);
    ck("敌人「" + b + "」形象宽 " + drawW.toFixed(1) + " ≤ 0.85 箱（" + (BOX * 0.85).toFixed(1) + "）",
      drawW <= BOX * 0.85, drawW.toFixed(2));
    /* 形象高不许离碰撞框太远：多出来的部分靠的是耳朵/叶子/冰棱，
       超过 1.5 倍就说明"图里有一半是空白"，画上去会飘。 */
    ck("敌人「" + b + "」形象高 " + A.h + " ≤ 1.5 × 碰撞高（" + (L.FOE_H * 1.5).toFixed(1) + "）",
      A.h <= L.FOE_H * 1.5, (A.h / L.FOE_H).toFixed(2));
  }
}

/* =========================================================================
   三十七、出手有反馈：后坐力
   =========================================================================
   §6② 那条「出手没有动作反馈」的验收。后坐力是纯视觉的，但它有数值出口
   （`recoilOffset`），所以能守：
     · 朝哪边打，就往反方向退；
     · 幅度够大（< 3px 在 600px 的画面上等于没有）；
     · 计时结束要**收回 0** —— 收不回去就是"人一直往后仰"。
   ========================================================================= */
group("三十七、出手有反馈（后坐力）");
{
  L.reset(1);
  const S = L.S;
  S.p.shotCd = 0; S.p.shotAnim = 0; S.p.face = 1;
  const idle = L.recoilOffset();
  ck("没出手时没有偏移", idle.dx === 0 && idle.dy === 0, JSON.stringify(idle));

  L.shoot();
  ck("出手会起计时（shotAnim > 0）", S.p.shotAnim > 0, S.p.shotAnim);
  const R = L.recoilOffset();
  ck("朝右出手时身体往左退 ≥ 3px（" + R.dx.toFixed(1) + "）", R.dx <= -3, R.dx.toFixed(2));
  ck("同时往下压一点（" + R.dy.toFixed(2) + "px）", R.dy >= 0.8, R.dy.toFixed(2));

  S.p.face = -1;
  const Rl = L.recoilOffset();
  ck("朝左出手时方向翻过来（" + Rl.dx.toFixed(1) + "）", Rl.dx >= 3, Rl.dx.toFixed(2));

  S.p.shotAnim = 0;
  const done = L.recoilOffset();
  ck("计时归零后偏移收回 0", done.dx === 0 && done.dy === 0, JSON.stringify(done));
}

/* =========================================================================
   三十八、投掷物：射得远、会掉、六只长得不一样
   =========================================================================
   §3 的验收（用户 2026-10-29）：「射程需要远点 并且要有特色 符合宠物的
   特征 丢出去是下落的 类似横向丢出去的石头」。

   三个判据缺一不可：
     · 射程 —— 太短就退回"贴脸喷"，这条要能防住回退；
     · 下坠 —— 只加射程不加下坠，弹道是激光不是石头；
     · 六种不同 —— 全六只共用一个 kind 就等于没做特色。
   **射程在无遮挡下量**：箱堆本身就是地形，场上有箱子时弹道会被挡，
   那量出来的是"地形"不是"射程"。
   ========================================================================= */
group("三十八、投掷物：射程 / 下坠 / 六种不同");
{
  const P = L.NUM.shot.pets;
  const ids = ["cat", "dog", "ham", "rab", "ox", "fox"];
  ck("六只都有投掷物参数", ids.every(id => P && P[id]), Object.keys(P || {}).join(","));
  const kinds = ids.map(id => (P && P[id] ? P[id].kind : "?"));
  ck("六种 kind 互不相同", new Set(kinds).size === 6, kinds.join(","));
  ck("六只都带重力（会掉下来）", ids.every(id => P && P[id] && P[id].grav > 0),
    ids.map(id => P && P[id] ? P[id].grav : "-").join(","));

  L.reset(1);
  const S = L.S;
  /* 清场：只量弹道本身 */
  S.foes.forEach(f => { f.dead = true; });
  S.boxes.forEach(b => { b.dead = true; });
  S.plats.length = 0;
  const seg = L.LAYERS[0].segs.filter(s => s.w >= 120).sort((a, b) => b.w - a.w)[0];
  L.placePlayer(seg.x + 60, L.FLOORS[0] - S.p.h);
  for (let i = 0; i < 20; i++) L.step(1 / 60);
  S.p.face = 1; S.ammo = 99; S.shots.length = 0;

  const x0 = S.p.x + S.p.w / 2 + 16, y0 = S.p.y + S.p.h * 0.42;
  L.shoot();
  let top = 0, last = null;
  for (let i = 0; i < 90 && S.shots.length; i++) {
    L.step(1 / 60);
    const s = S.shots[0];
    if (s) { last = { dx: s.x - x0, dy: s.y - y0 }; top = Math.min(top, s.y - y0); }
  }
  ck("射程 ≥ 300px（" + (last ? last.dx.toFixed(0) : "-") + "）",
    !!last && last.dx >= 300, last ? last.dx.toFixed(1) : "-");
  ck("落点明显低于出手点（下坠 " + (last ? last.dy.toFixed(0) : "-") + "px）",
    !!last && last.dy > 25, last ? last.dy.toFixed(1) : "-");
  ck("弹道先微微上扬（顶点 +" + (-top).toFixed(1) + "px）", -top > 2, (-top).toFixed(2));
}

/* =========================================================================
   三十九、打击感：冲击有方向
   =========================================================================
   用户 2026-10-29：「震屏视觉效果不好 打击感 和 破碎感需要加强」。

   原来震屏是每帧独立随机 —— 帧间毫无关系，读作"画面在抖"而不是"被撞了"。
   现在三样东西共用一个冲击向量（震屏偏移 / 碎片扇形 / 冲击环）。
   断言守的就是"这个向量真的被用上了"：光调参数看不出方向对不对。
   ========================================================================= */
group("三十九、打击感：冲击有方向");
{
  L.reset(1);
  const S = L.S;
  const box = S.boxes.find(b => !b.dead && b.mat === "wood");
  ck("场上有一口木箱可以做靶", !!box, S.boxes.length + " 口");
  if (box) {
    S.shake = 0; S.shakeDX = 0; S.shakeDY = 0; S.frags.length = 0;
    L.breakBox(box, "ball", 3.0, 1, 0);
    ck("向右撞 → 震屏方向向右", S.shakeDX === 1 && S.shakeDY === 0,
      S.shakeDX + "," + S.shakeDY);
    /* 方向偏置只在"重击"档生效（`dirK = min(1, sh/6.5) * 0.55`），
       所以这里只要证明"这一下有分量"即可。pow=3.0 → 约 5.7px。
       **门槛从 8 改到 4，不是因为做不到 8，而是 8 已经超出新上限。** */
    ck("震屏幅度 ≥ 4（" + S.shake.toFixed(1) + "）", S.shake >= 4, S.shake.toFixed(1));
    /* ---- 同源连击递减（2026-10-29 新增）----------------------------
       用户说"满屏的震动"，探针归因后发现 2/3 的震动量来自碎箱，
       而球碾过箱堆时能连着点 4~5 次，画面**连续抖 2.2 秒不停**。
       机制是：0.35 秒内同一来源再点火，强度 ×0.6。

       **测法为什么要把 shake 手动清 0**：`kickShake` 用的是 max 语义，
       递减后的小值不会把已经很高的 shake 抬高 —— 也就看不出递减。
       清 0 等于"假设前一下已经衰减干净"，此时再点火，
       读到的才是这一下**真正能抬到多高**。 */
    S.shake = 0; S.kick = {};
    const mkBox = () => ({ x: 240, y: 320, w: 48, h: 48, mat: "wood", hp: 1, barrel: false, loot: false });
    const seq = [];
    for (let i = 0; i < 5; i++) {
      L.breakBox(mkBox(), "ball", 3.0, 1, 0);
      seq.push(S.shake);
      S.shake = 0;
    }
    ck("连碎 5 口：震幅逐次递减（" + seq.map(v => v.toFixed(1)).join(" → ") + "）",
      seq[0] >= 5 && seq[4] < seq[0] * 0.45 && seq[4] < 1.2,
      seq.map(v => v.toFixed(2)).join(","));

    /* 窗口外再点火要恢复满力 —— 否则"打过一口之后这辈子都是小震" */
    const tSave = S.t;
    S.shake = 0;
    S.t += 1.0;
    L.breakBox(mkBox(), "ball", 3.0, 1, 0);
    ck("隔 1 秒再碎：恢复满力（" + S.shake.toFixed(1) + "px）",
      Math.abs(S.shake - seq[0]) < 0.2, S.shake.toFixed(2) + " vs " + seq[0].toFixed(2));
    S.t = tSave;

    const right = S.frags.filter(f => f.vx > 0).length;
    ck("碎片多数朝撞击方向飞（" + right + "/" + S.frags.length + "）",
      S.frags.length > 10 && right >= S.frags.length * 0.7,
      (right / Math.max(1, S.frags.length)).toFixed(2));

    const s0 = S.shake;
    for (let i = 0; i < 12; i++) L.step(1 / 60);
    ck("0.2 秒后震屏已收掉大半（" + S.shake.toFixed(1) + " < " + (s0 * 0.5).toFixed(1) + "）",
      S.shake > 0 && S.shake < s0 * 0.5, S.shake.toFixed(2));
    for (let i = 0; i < 90; i++) L.step(1 / 60);
    ck("最终归零（不拖尾巴）", S.shake === 0, S.shake);
  }
}

/* =========================================================================
   四十、关卡：难度有序递进 + 空间连通 + 门不固定
   ---------------------------------------------------------------------------
   用户 2026-10-29：「关卡的复杂度需要有序递进 尤其是空间设计要合理
   不要有死胡同路 下关的门不要定死固定位置」。

   这三条都是**结构**上的事，不是手感 —— 手感只能靠出图看，
   结构可以一条条数。而"结构"最怕的是"这一版恰好对"：
   加个地形、改个概率，死胡同就悄悄回来了，没人会发现。
   所以这一节守的不是"现在好不好玩"，是"这些性质还在不在"。
   ========================================================================= */
group("四十、关卡：难度递进 / 没有死胡同 / 门不固定");
{
  const NSEED2 = 200;
  let tierBad = 0, foeBad = 0, holeBad = 0, budgetBad = 0, missBad = 0;
  let corrBad = 0, corrHBad = 0, corrHiBad = 0, corrCols = 0;
  const bandHole = [[0, 0], [0, 0]];      // 浅层 / 深层的洞宽 [总宽, 个数]
  const bandBox = [[0, 0], [0, 0]];       // 浅层 / 深层的箱子预算 [总预算, 层数]
  const doorBand = [0, 0, 0];             // 左(<400) / 中(400~600) / 右(>600)
  let doorMin = 999, doorMax = -1;

  for (let sd = 1; sd <= NSEED2; sd++) {
    const g = L.genLevel(sd);
    const N = g.layers.length;

    /* 1. tier 必须从 0 均匀走到 1，而且**严格递增**。
       "有序"就落在这一个数上 —— 它不递增，后面所有参数都没法谈递进。 */
    if (Math.abs(g.layers[0].tier) > 1e-9) tierBad++;
    if (Math.abs(g.layers[N - 1].tier - 1) > 1e-9) tierBad++;
    for (let k = 1; k < N; k++) if (!(g.layers[k].tier > g.layers[k - 1].tier)) tierBad++;

    /* 2. 怪数逐层不降（门厅除外 —— 门厅固定 3，是 killTarget 的死局线）。 */
    const foeCnt = g.layers.map((_, k) => g.spawns.filter(s => s.layer === k).length);
    for (let k = 0; k + 2 < N; k++) if (foeCnt[k + 1] < foeCnt[k]) foeBad++;

    /* 3. 洞宽与箱子预算按深度分组比。 */
    g.layers.forEach((l, k) => {
      const shallow = l.tier < 0.34, deep = l.tier >= 0.67;
      if (shallow || deep) {
        const idx = shallow ? 0 : 1;
        for (const h of l.holes) { bandHole[idx][0] += h.w; bandHole[idx][1]++; }
        if (l.boxBudget != null) { bandBox[idx][0] += l.boxBudget; bandBox[idx][1]++; }
      }
      if (l.holes.some(h => h.w > 144)) holeBad++;
    });

    /* 4. 每层每一列都走得到。 */
    for (let k = 0; k < N; k++) if (L.unreachableCols(g, k).length) missBad++;

    /* 5. **主通道的结构**（它同时是画面上"路标"的落点）。
       三条，一条都不能少：
         · 每层至少有一条走廊 —— 少于一条，那一层就是"整层箱山"，没有回主路的路；
         · 走廊列**基本恒 0 格**。唯一允许的例外是 1 格：
           `fillPits` 的最后一步会往走廊里垫一格，用来救"2-0-2 且两边都是
           洞口盖板"那种填不掉的球坑（见那里的注释）—— 一口能砸的木箱，
           比"球滚进去出不来"划算；
         · 走廊相邻列 ≤2 格 —— 高差 3 = 144 > 跳高 123，走廊自己会变成沟底。
       `l.corridor` 是生成侧导出的，画 `drawTrail` 和这几条断言用的是同一份数据。 */
    g.layers.forEach(l => {
      const cs = l.corridor || [];
      const idx = [];
      for (let i = 0; i < cs.length; i++) if (cs[i]) idx.push(i);
      corrCols += idx.length;
      if (!idx.length) { corrBad++; return; }
      if (idx.some(i => (l.colHgt[i] || 0) > 1)) corrHBad++;
      for (const i of idx) {
        if (i > 0 && l.colHgt[i - 1] > 2) corrHiBad++;
        if (i + 1 < cs.length && l.colHgt[i + 1] > 2) corrHiBad++;
      }
    });

    const dx = g.door ? g.door.x : -1;
    doorMin = Math.min(doorMin, dx); doorMax = Math.max(doorMax, dx);
    doorBand[dx < 400 ? 0 : dx < 600 ? 1 : 2]++;
  }

  ck("每一层的 tier 都严格递增，首层 0、末层 1", tierBad === 0, tierBad + " 关不合规");
  ck("怪物数量逐层不降（门厅除外）", foeBad === 0, foeBad + " 处倒挂");
  const avgHole = bandHole.map(b => b[1] ? b[0] / b[1] : 0);
  ck("洞越深越窄（浅层均 " + avgHole[0].toFixed(0) + " / 深层均 " + avgHole[1].toFixed(0) + "）",
     avgHole[0] > avgHole[1] + 8, avgHole.map(v => v.toFixed(0)).join(" vs "));
  ck("单洞最宽 144（更宽就跳不过去，会切出孤段）", holeBad === 0, holeBad + " 层有超宽洞");
  const avgBox = bandBox.map(b => b[1] ? b[0] / b[1] : 0);
  ck("箱子预算越深越多（浅层 " + avgBox[0].toFixed(1) + " / 深层 " + avgBox[1].toFixed(1) + " 格）",
     avgBox[1] > avgBox[0], avgBox.map(v => v.toFixed(1)).join(" vs "));
  ck("200 个种子里每层每列都走得到（没有孤段）", missBad === 0, missBad + " 层有走不到的列");
  /* 主通道：**这是用户「主通道没有视觉提示」落地之后的形状。**
     几何上是硬的（0 格 + 邻列 ≤2），画面上是一对粉笔箭头（drawTrail）。
     断言守结构，图守观感 —— 两边都不许单独退化。 */
  ck("每层都有主通道（共 " + corrCols + " 列）", corrBad === 0, corrBad + " 层没有通道");
  ck("主通道列高度 ≤1（0 是常态，1 是填坑兜底）", corrHBad === 0, corrHBad + " 层有高过 1 格的通道列");
  ck("主通道相邻列 ≤2 格（从路上爬得上任何箱山）", corrHiBad === 0, corrHiBad + " 处高差 3");

  /* 门：**三段都得出现过，而且最左能到 <400、最右能到 >600。**
     原来写死 12~17 列 = 576~816，doorMin 永远是 576 —— 这条断言就是
     为了让"以后再钉回右半边"立刻红。 */
  ck("下关的门三段都出现过（左 " + doorBand[0] + " / 中 " + doorBand[1] + " / 右 " + doorBand[2] + "）",
     doorBand.every(n => n > NSEED2 * 0.1), JSON.stringify(doorBand));
  ck("门的最左位置 < 400、最右 > 600（实际 " + doorMin + "~" + doorMax + "）",
     doorMin < 400 && doorMax > 600, doorMin + "~" + doorMax);
  ck("门不钉在 12~17 列（576~816）那一段", doorMin < 480, "最左 " + doorMin);
}

/* =========================================================================
   汇总
   ========================================================================= */
console.log("\n" + "=".repeat(56));
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) { console.log("失败清单：\n  - " + bad.join("\n  - ")); process.exit(1); }
console.log("✓ 闭环成立");
