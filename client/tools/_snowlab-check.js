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
   一、初始状态
   ========================================================================= */
group("一、初始状态");
L.reset();
ck("弹药 100", S.ammo === 100, S.ammo);
ck("饱食 100（满饱）", S.belly === 100, S.belly);
ck("体力 3", S.hp === NUM.hpStart, S.hp);
ck("场上 8 只怪", S.foes.length === 8, S.foes.length);
ck("击杀目标 = 8", S.killedTarget === NUM.killTarget && NUM.killTarget === 8, S.killedTarget);
ck("箱子 14 口（8 散 + 箱墙 6）", S.boxes.length === 14, S.boxes.length);
ck("门初始锁着", S.door && S.door.open === false);
ck("四种材质都在场上", ["wood", "stone", "iron"].every(t => S.boxes.some(b => b.mat === t)), "缺少材质");
settle(60);

/* =========================================================================
   二、材质 × 破坏通道（这是整套设计的地基）
   ========================================================================= */
group("二、材质 × 破坏通道");

// 木箱：子弹 3 发碎
L.reset(); settle(30);
let wb = findBox("wood", b => b.x === 96);
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

// 木箱：任何速度都碎
L.reset(); settle(20);
let wb2 = findBox("wood", b => b.x === 96);
let wb2Y = wb2.y;
let b1 = L.spawnBall(wb2.x - 30, wb2.y + 24, 620, 1);
for (let i = 0; i < 20 && !wb2.dead; i++) L.step(DT);
ck("木箱：站立推球即碎", wb2.dead === true);
ck("木箱：碎后球还在（穿透）", b1.dead === false);
ck("木箱：穿透保留 82% 速度", near(Math.abs(b1.vx), 620 * NUM.box.wood.keepSpeed, 20), Math.round(Math.abs(b1.vx)));

// 石箱：站立推（620）够，但球会掉速
L.reset(); settle(20);
let st = findBox("stone");
let b2 = L.spawnBall(st.x - 30, st.y + 24, 620, 1);
for (let i = 0; i < 20 && !st.dead; i++) L.step(DT);
ck("石箱：站立推球（pow 620）能碎", st.dead === true);

// 铁箱：站立推不够，助跑够
L.reset(); settle(20);
let ir = findBox("iron");
let b3 = L.spawnBall(ir.x - 30, ir.y + 24, 620, 1);
for (let i = 0; i < 20 && !ir.dead; i++) L.step(DT);
ck("铁箱：站立推（pow 620 < 1150）砸不动", ir.dead === false);
ck("铁箱：砸不动会反弹", b3.vx < 0, Math.round(b3.vx));

L.reset(); settle(20);
let ir2 = findBox("iron");
let b4 = L.spawnBall(ir2.x - 30, ir2.y + 24, 1209, 1);
for (let i = 0; i < 20 && !ir2.dead; i++) L.step(DT);
ck("铁箱：助跑推（pow 1209）能碎", ir2.dead === true);

// 冰墙：小球高速不够，特大球够
L.reset(); settle(20);
S.boxes.push({ x: 600, y: 400, w: 48, h: 48, mat: "ice", hp: Infinity, dead: false, hitT: 0 });
let ice = S.boxes[S.boxes.length - 1];
let b5 = L.spawnBall(ice.x - 30, ice.y + 24, 1209, 1);
for (let i = 0; i < 20 && !ice.dead; i++) L.step(DT);
ck("冰墙：小球助跑（pow 1209）砸不动", ice.dead === false);

L.reset(); settle(20);
S.boxes.push({ x: 600, y: 400, w: 48, h: 48, mat: "ice", hp: Infinity, dead: false, hitT: 0 });
let ice2 = S.boxes[S.boxes.length - 1];
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
ck("半径有上限 42", L.ballR(99) === 42, L.ballR(99));

/* =========================================================================
   六、球碾敌 = 唯一击杀通道
   ========================================================================= */
group("六、球碾敌");
L.reset(); settle(20);
/* 清场。不清的话球会一路碾过去连杀几只，`killed === killedBefore + 1` 就假失败。 */
S.foes.length = 0;
let tf = L.spawnFoe(500, L.GROUND_Y - 30, "crawler");
tf.vx = 0; tf.speed = 0;
const killedBefore = S.killed;
let mb = L.spawnBall(400, L.GROUND_Y - 22, 700, 1);
for (let i = 0; i < 60 && S.killed === killedBefore; i++) L.step(DT);
ck("球滚过敌人 = 击杀", S.killed === killedBefore + 1, S.killed);
ck("击杀后球变大（吸收）", mb.absorbed >= 2, mb.absorbed);

/* =========================================================================
   七、子弹不杀生（雪弹只加雪点）
   ========================================================================= */
group("七、子弹不杀生");
L.reset(); settle(20);
let nf = L.spawnFoe(400, L.GROUND_Y - 30, "crawler");
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
const blocker = findBox("wood", b => b.x === 96);
S.boxes.forEach(b => { if (b !== blocker) b.dead = true; });
S.foes.length = 0;                       // 场上的怪会替箱子吃子弹，必须清掉
const behind = L.spawnFoe(blocker.x + blocker.w + 6, L.GROUND_Y - 30, "crawler");
behind.vx = 0; behind.speed = 0;
const hitsBefore = behind.hits;
const hpBefore2 = blocker.hp;
S.p.x = blocker.x - 72; S.p.y = L.GROUND_Y - 42; S.p.vx = 0; S.p.vy = 0; S.p.face = 1;
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
   十、弹药经济：全用子弹开路走不到头
   ========================================================================= */
group("十、弹药经济核算");
L.reset();
const allFoeShots = S.foes.length * NUM.snowShots.full;      // 8 只 × 6 发
const allBoxShots = S.boxes.filter(b => b.mat === "wood").length * NUM.box.wood.hp;
const totalNeed = allFoeShots + allBoxShots;
ck("8 只怪 × 6 发 = 48 发", allFoeShots === 48, allFoeShots);
ck("木箱数 × 3 发 = " + allBoxShots + " 发", allBoxShots > 0);
ck("「全用子弹开路」总需求 < 100（不然一开始就死局）", totalNeed < 100, totalNeed);
ck("「全用子弹开路」只剩不到 20 发（逼玩家用球）", 100 - totalNeed < 20, 100 - totalNeed);

/* =========================================================================
   十一、门：锁定 → 解锁 → 碰门过关
   ========================================================================= */
group("十一、门");
L.reset(); settle(20);
ck("门初始是锁的", S.door.open === false);
ck("初始 killTarget 未达成", S.killed < S.killedTarget, S.killed + "/" + S.killedTarget);

// 杀满全部
const totalFoes = S.foes.length;
for (const f of S.foes.slice()) {
  const b = L.spawnBall(f.x - 30, f.y + 15, 800, 1);
  for (let i = 0; i < 30 && !f.dead; i++) L.step(DT);
}
ck("杀满 " + totalFoes + " 只", S.killed === totalFoes, S.killed);
ck("杀满之后门自动解锁", S.door.open === true);
ck("解锁后 phase 仍是 play", S.phase === "play", S.phase);

/* 走到门上。**跑多帧而不是一帧**：杀怪最后一下可能正带着 hitStop（顿帧），
   顿帧期间 step 整个 return —— 只跑一帧会读到一个"什么都没发生"的假失败。 */
L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
for (let i = 0; i < 12 && S.phase === "play"; i++) L.step(DT);
ck("碰门 → phase = clear", S.phase === "clear", S.phase);

// 没杀够时碰门不应过关
L.reset(); settle(20);
L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
for (let i = 0; i < 12; i++) L.step(DT);
ck("没杀够时碰门不算过关", S.phase === "play", S.phase);

/* =========================================================================
   十二、箱子挡路 / 可站
   ========================================================================= */
group("十二、箱子挡路 / 可站");
L.reset(); settle(20);
// 箱墙在 x=792..888。玩家从左边往右跑，应该被挡住
L.placePlayer(700, L.GROUND_Y - 42);
S.keys = { d: true };
for (let i = 0; i < 120; i++) L.step(DT);
S.keys = {};
ck("玩家被箱墙挡住（x < 792）", S.p.x < 792, Math.round(S.p.x));
ck("玩家没穿过箱墙", S.p.x + S.p.w <= 792 + 1, Math.round(S.p.x + S.p.w));

// 砸掉最下面一格之后，上面的要塌下来
L.reset(); settle(30);
/* 选 840 这一列：右边是场地边界，左边是 792 那一列（已经先砸掉它才准），
   所以不会有"一只角搭在隔壁箱子上"的物理假支撑干扰。 */
const bottomBox = S.boxes.filter(b => !b.dead && b.x === 840).sort((a, b) => b.y - a.y)[0];
const aboveBox = S.boxes.filter(b => !b.dead && b.x === 840 && b.y < bottomBox.y).sort((a, b) => b.y - a.y)[0];
const aboveY0 = aboveBox.y;
L.breakBox(bottomBox, "ball");
for (let i = 0; i < 60; i++) L.step(DT);
ck("砸掉底箱后上面的箱子会下落", aboveBox.y > aboveY0 + 10, aboveY0 + " → " + Math.round(aboveBox.y));

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
L.placePlayer(200, L.GROUND_Y - 42);
const p = S.p;
const bf = L.spawnFoe(p.x + 6, p.y - 4, "crawler");
bf.vx = 0; bf.speed = 0;
const hpBefore = S.hp;
L.step(DT);
ck("贴脸撞敌：自己掉 1 血", S.hp === hpBefore - 1, S.hp);
ck("贴脸撞敌：敌人吃到雪（零弹也能推进）", bf.hits >= NUM.bodyCoat, bf.hits);
S.ammo = 100;

/* =========================================================================
   十四、整局跑通（不卡死）
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
ck("玩家没掉出画面", S.p.y < L.H, Math.round(S.p.y));
ck("弹药不会变负", S.ammo >= 0, S.ammo);
ck("球数不会爆炸", S.balls.length < 20, S.balls.length);

/* =========================================================================
   十五、可达性：每只怪都喷得到吗
   ---------------------------------------------------------------------------
   **这一节守的是"关卡没设计成打不着"，不是"打起来累不累"。**
   射程只有 149px（这就是「喷的代价」），怪分散在四层平台 —— 如果某只怪
   站在玩家够不到的地方，玩家就只能贴脸换血，那这条关卡就是坏的。
   ========================================================================= */
group("十五、可达性（每只怪都喷得到）");
let unreachable = [];
for (let i = 0; i < 8; i++) {
  L.reset();
  /* **settle 之前就把速度清零**。settle 的 30 帧里怪会按巡逻逻辑随机走动，
     每次跑到的位置都不一样，于是这条断言时绿时红 —— 一个会抖的断言
     比没有断言更糟，它教人忽略红灯。 */
  S.foes.forEach(f => { f.speed = 0; f.vx = 0; });
  settle(30);
  /* **先把箱子全砸掉**再测：这一节守的是"射程够不够"，不是"箱子挡不挡枪"。
     混在一起测的话，一个挡枪的箱子会被报成"这只怪打不着"，
     逼着我去改关卡布局，而真正的原因只是测试站位不对。 */
  S.boxes.forEach(b => { b.dead = true; });
  /* **只留被测的那一只。** 留着别的怪的话，它们可能正好站在玩家落点上
     （第 4 只旁边就压着第 3 只），玩家被撞飞 21px 再喷，子弹从头顶飞过去，
     报出来的却是"这只怪打不着"。 */
  const f = S.foes[i];
  S.foes = [f];
  f.speed = 0; f.vx = 0;
  /* 站位 y 必须是「脚底和怪同一平面」：`f.y + f.h - p.h`。
     直接写 f.y 的话玩家的脚已经陷进平台里 10px，垂直分离判定认不出来，
     人会一路穿下去掉到地面，然后在离怪三米远的地方喷空气。 */
  L.placePlayer(Math.max(26, f.x - 70), f.y + f.h - S.p.h);
  for (let k = 0; k < 8; k++) L.step(DT);   // 落地
  S.p.face = 1;
  S.ammo = 100;
  const h0 = f.hits;
  L.shoot();
  for (let k = 0; k < 24; k++) L.step(DT);
  if (f.hits <= h0) unreachable.push("#" + i + "(" + Math.round(f.x) + "," + Math.round(f.y) + ")");
}
ck("8 只怪全部在射程内", unreachable.length === 0, unreachable.join(" "));

// 门在箱墙砸开后要够得着
L.reset(); settle(20);
S.boxes.filter(b => b.x >= 780).forEach(b => { b.dead = true; });
L.placePlayer(700, L.GROUND_Y - 42);
S.keys = { d: true };
for (let i = 0; i < 90; i++) L.step(DT);
S.keys = {};
ck("箱墙砸开后玩家能走到门", S.p.x + S.p.w >= S.door.x, Math.round(S.p.x + S.p.w) + " vs " + S.door.x);

/* =========================================================================
   汇总
   ========================================================================= */
console.log("\n" + "=".repeat(56));
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
if (fail) { console.log("失败清单：\n  - " + bad.join("\n  - ")); process.exit(1); }
console.log("✓ 闭环成立");
