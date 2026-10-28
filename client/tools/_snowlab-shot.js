/* ===========================================================================
   snowlab.html 的离屏出图
   ---------------------------------------------------------------------------
   沙箱里开不了浏览器，但可以把内联脚本里的 draw() 接到 @napi-rs/canvas 上，
   导成 PNG 自己看。

   **这不是给用户的工具，是给改代码的人的自检**：布局错位、贴图缺失、
   白屏、文字压在一起、镜头没跟上、深度暗化过重读不出东西 ——
   这些机器断言看不出来，只有图能看出来。

   **关卡现在是随机生成的，所以这里先挑一个种子再固定下来。**
   挑种子的条件：层数尽量多、有斜坡、三种封口方式都出现一次。
   每次出图都是同一张图，这样"改完前后对比"才有意义。

   跑法：NODE_PATH=<workspace>/node_modules node client/tools/_snowlab-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "prototype", "snowlab.html");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const W = 960, H = 600;

const real = createCanvas(W, H);
const g = real.getContext("2d");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;

window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = function (t) { return t === "2d" ? g : null; };
window.requestAnimationFrame = () => 0;

window.eval(m[1]);
const L = window.SNOWLAB;
const S = L.S;
const DT = 1 / 60;

/* ---------------------------------------------------------------- 背景立绘
   **必须用异步的 loadImage，不能用 `new Image(); im.src = buffer`。**
   后者能读出 width/height、`complete` 也是 true，但 drawImage 画出来
   是全黑的 —— 实测踩过，而且它不会抛错，只是"背景凭空消失"，最难查。
   所以整段出图逻辑都塞进 async 里；读不到就 setBackdrop(null)，
   自动退回程序化天空，图照样出得来。 */
(async () => {
const BG_PATH = path.join(ROOT, "assets", "snowlab", "bg-surface.jpg");
try {
  const BG = await require("@napi-rs/canvas").loadImage(BG_PATH);
  L.setBackdrop(BG);
  console.log("背景立绘：" + BG.width + "×" + BG.height);
} catch (e) {
  L.setBackdrop(null);
  console.log("（背景立绘未加载 → 走程序化天空：" + e.message + "）");
}

/* 贴图（主角六只 + 敌人三只）。**不注入就会静默走代码图形** ——
   图上是一只"看着也还行的小橙猫"，和贴图版差着一大截，但不会报错，
   很容易把"没加载上"当成"就长这样"。所以加载失败要吭声。
   清单在 `_snowlab-art.js`，三个出图工具共用一份 —— 各抄一段的话，
   加了敌人贴图就有三处要改，漏一处就是"这张图上有、那张没有"。 */
try {
  const art = await require("./_snowlab-art").loadArt();
  L.setArt(art.map);
  console.log("贴图：" + art.report);
} catch (e) {
  console.log("（贴图未加载 → 走代码图形：" + e.message + "）");
}

/* ---------------------------------------------------------------- 挑种子
   层数最多、有斜坡、三种封口（霜箱 / 冰 / 敞开）都出现过。 */
let SEED = 1, bestScore = -1;
for (let s = 1; s < 500; s++) {
  const g2 = L.genLevel(s);
  if (!L.validateLevel(g2)) continue;
  let ramps = 0;
  const covers = new Set();
  g2.layers.forEach(l => {
    l.terrain.forEach(t => { if (t.kind === "ramp") ramps++; });
    l.holes.forEach(h => covers.add(h.cover));
  });
  const score = g2.nFloors * 10 + ramps * 4 + covers.size * 6;
  if (score > bestScore) { bestScore = score; SEED = s; }
}

function shot(name, fn) {
  L.reset(SEED);
  /* 两块"给跑原型的人看"的东西在设计图里是噪音：
     ① 右上角的量具面板 —— 正好压住第 1~2 层右侧那段浮台上的箱子，
        看图的人会以为那层是空的；
     ② 「A/D 移动…」操作提示 —— 只在开局 9 秒内出现，会横穿地面层。 */
  S.showMeter = false;
  fn && fn();
  S.t = 12;                 // tipA = clamp(9 - S.t, 0, 1) → 提示淡出
  L.draw();
  const file = path.join(OUT, "snowlab-" + name + ".png");
  fs.writeFileSync(file, real.toBuffer("image/png"));
  console.log("出图 " + file);
}

/** 钉住怪：不然 runner 会追过来撞掉一血，图上挂着 "-1" 和受伤闪白，像 bug。 */
function freezeFoes() { S.foes.forEach(f => { f.speed = 0; f.vx = 0; }); }

/** 站到第 k 层最左边那段实心地板上，跑够帧数让镜头缓动到位 */
function standOn(k, xOff) {
  /* 站最宽那段的中部：站最左端的话，镜头里半屏是黑的（光只跟玩家走），
     看不出这一层到底长什么样。 */
  const segs = L.LAYERS[k].segs.filter(s => s.w >= 80);
  const s = segs.slice().sort((a, b) => b.w - a.w)[0] || L.LAYERS[k].segs[0];
  const x = s.x + (xOff == null ? s.w * 0.28 : xOff);
  L.placePlayer(Math.min(x, s.x + s.w - 34), L.FLOORS[k] - 42);
  for (let i = 0; i < 70; i++) L.step(DT);
}

/* **先把选中的种子装进去，再读层数。** `genLevel()` 会顺手改全局的
   FLOORS / LAYERS，探测结束时留在里面的是"最后一个试过的种子"——
   在 reset 之前读 NF，拿到的层数是别人的，出图循环会少走几层。 */
L.reset(SEED);
const NF = L.FLOORS.length;
console.log("种子 " + SEED + "： " + NF + " 层，洞 " +
  L.LAYERS.map(l => l.holes.map(h => h.cover).join("+") || "—").join(" / "));

/* 1) 地表出生点：能读出"脚下这段带霜的地板可以砸"、"往右走撞到什么" */
shot("01-top", () => {
  for (let i = 0; i < 50; i++) L.step(DT);
});

/* 2) 挖穿地表：洞露出来，往下看得见下一层 ——
      **这一张是这一版全部的说服力所在**：掉下去只掉一层，抬头还看得见上面 */
shot("02-dug", () => {
  freezeFoes();
  const h = L.LAYERS[0].holes[0];
  S.boxes.filter(b => !b.dead && b.x >= h.x - 1 && b.x < h.x + h.w && b.y + 48 === L.FLOORS[0])
    .forEach(b => L.breakBox(b, "ball"));
  L.placePlayer(h.x + h.w / 2, L.FLOORS[0] - 30);
  for (let i = 0; i < 22; i++) L.step(DT);
});

/* 3) 逐层：每层一张，看箱室密度、地形、洞的位置是不是真的每层不一样。
     层数是 3~5 随机，**图名不能写死 f1..f8** —— 那样图比层多，
     多出来的几张是上一关的残留，看图的人会当成"还有第 6 层"。 */
for (let k = 0; k < NF; k++) {
  shot("floor" + (k + 1), () => { freezeFoes(); standOn(k); });
}

/* 3.6) 宠物对战：**三只不同的宠物同时开火，三条抛物线要一起读得出来。**
     这一张是用来看"子弹有没有下落感"的 —— 数字上量得到（断言里有），
     但"像不像被扔出去的东西"只有图能判断。 */
shot("petfight", () => {
  /* **这张图单独挑种子。** 主种子（7）的地表层被两个下行口切成 336 宽的小块，
     摆不下"三只宠物 + 三条弹道"这条横向叙事 —— 硬塞的结果是宠物掉进洞里、
     图上一只都不剩。这张图要看的只有宠物和子弹，换关不影响它要说明的事。 */
  let picked = null;
  for (let sd = 1; sd <= 60 && !picked; sd++) {
    L.reset(sd);
    const gy0 = L.FLOORS[0];
    const seg = S.plats.filter(p => p.kind !== 'ramp' && Math.abs(p.y - gy0) < 1)
      .sort((a, b) => b.w - a.w)[0];
    if (seg && seg.w >= 520) picked = { sd, seg, gy: gy0 };
  }
  if (!picked) {
    const gy0 = L.FLOORS[0];
    const seg = S.plats.filter(p => p.kind !== 'ramp' && Math.abs(p.y - gy0) < 1)
      .sort((a, b) => b.w - a.w)[0] || S.plats[0];
    picked = { sd: SEED, seg, gy: gy0 };
  }
  console.log("  petfight → 种子 " + picked.sd + "，平台 " + picked.seg.x + ".." +
    (picked.seg.x + picked.seg.w));
  /* **箱子全清。** 这一张要看的是"宠物长什么样、子弹怎么飞"；
     箱子会挡住宠物、也会把子弹半路打掉。箱子堆另有 floorN 那几张。 */
  S.boxes.forEach(b => b.dead = true);
  /* **地表层的地面装饰也清掉。** 路牌左右各伸 26px，随机落在两只宠物中间时
     就读成"它俩中间插了块牌子"，正好把"三只宠物 + 三发弹道"这条横向叙事切断。
     装饰密度由 floorN / hall 那几张图来证明，不靠这一张。 */
  S.deco = S.deco.filter(d => d.layer !== 0);
  S.foes.length = 0;
  S.hp = 99; S.invuln = 999;
  const gy = picked.gy;
  const px = picked.seg.x + picked.seg.w - 46;
  L.placePlayer(px, gy - 42);
  for (let i = 0; i < 4; i++) L.step(DT);
  /* 从右往左：尖牙兽（最近）、苔泥团、霜甲虫。投掷物插在它们和玩家之间的空档里。
     **全都朝右（face = 1）= 全都朝着玩家** —— 这张图要同时证明"侧视"：
     看见侧脸、单眼、前突的嘴，才说明朝向是画进剪影里的，不是靠两只眼对称糊出来的。 */
  [['grub', 100], ['moss', 200], ['fang', 300]].forEach(([br, dx]) => {
    const f = L.spawnFoe(px - dx, gy - 30, 'crawler', br);
    f.face = 1; f.fireCd = 99; f.aim = 0.22;    // 蓄力到一半：嘴前有那团光
    f.speed = 0; f.vx = 0;
    f.roamL = f.x; f.roamR = f.x;
  });
  /* **这一张是摆拍，说清楚：三发投掷物是直接放上去的，不是真打出来的。**
     原因很实在：三只的射界是 270~350，屏幕只有 960 宽 ——
     想让三只同时朝同一个人开火，它们必须站得比这更近，
     一张图里就会挤成一团。**数值和形状都是真的**（和 fireFoeBullet
     出来的完全一样，连 vy/自旋都在），只是位置是摆的。
     真弹道由第二十四节的断言来守。 */
  /* **每一发都紧跟在自己的宠物右边**，这样"谁扔的"一眼可读；
     排成"三发挤一团"的话，看图的人得靠猜。 */
  [
    ['tooth', px - 245, gy - 46, 420, 0.55],   // 尖牙兽（px−300）甩的
    ['mud',   px - 145, gy - 54, 330, 0.30],   // 苔泥团（px−200）抛的
    ['shard', px - 50,  gy - 38, 380, 0.20],   // 霜甲虫（px−100）弹的
  ].forEach(([kind, x, y, vx, spin]) => {
    S.ebullets.push({ kind, x, y, vx, vy: 40, t: 0.4, r: 9, face: 1, spin, dead: false });
  });
});

/* 3.45) impact：球撞碎箱子**那一帧**。
   用户第 2 条里"打箱子破碎感、球的击碎感、有物理打击的感觉"全在这张图上：
   木箱碎成板条（会转、有暗边）、两层冲击环、球已经穿过去、周围的箱子被震得发亮。
   **这一张不是摆拍** —— 箱子、球、碎片都是真跑出来的，
   只是把时间停在了"刚碎完第 2 帧"。 */
shot("impact", () => {
  /* **和 petfight 一样要单独挑种子。** 主种子的地表被两个下行口切成小段，
     撞箱那一下会正好落在洞口边上；更糟的是兜底用 `.pop()` 会拿到最底层，
     人放上去就掉下去 —— 第一次出图整张是空的门厅。 */
  let seg = null, gy = 0;
  for (let sd = 1; sd <= 60 && !seg; sd++) {
    L.reset(sd);
    const s2 = S.plats.filter(p => p.kind !== 'ramp' && Math.abs(p.y - L.FLOORS[0]) < 1)
      .sort((a, b) => b.w - a.w)[0];
    if (s2 && s2.w >= 480) { seg = s2; gy = L.FLOORS[0]; }
  }
  if (!seg) return;
  S.boxes.forEach(b => b.dead = true);
  S.foes.length = 0; S.ebullets.length = 0;
  S.hp = 99; S.invuln = 999;
  L.placePlayer(seg.x + 80, gy - S.p.h);
  for (let i = 0; i < 3; i++) L.step(DT);

  const mk = (x, y, mat) => S.boxes.push({
    x, y, w: 48, h: 48, mat, hp: 1, dead: false, hitT: 0, taught: false,
    fell: 0, frost: false, loot: false, barrel: false,
  });
  const bx = seg.x + 330;
  mk(bx, gy - 48, 'wood');
  mk(bx + 48, gy - 48, 'wood');
  mk(bx, gy - 96, 'wood');
  mk(bx + 96, gy - 48, 'stone');
  mk(bx + 96, gy - 96, 'wood');

  /* 一颗特大球从左边滚过去。**球必须够大够快** —— 小球撞木箱只会被弹回来，
     画面上就是"球停在箱子前面"，读不出"击碎"。 */
  /* **球贴着箱子放，让它第一帧就撞上。** 从远处滚过来的话，球会先被
     地形的水平碰撞判成"撞墙"（`b.x = prevX; vx *= -0.35`），
     一帧之内就停在原地 —— 第一次出图就是这样：球停在玩家脸前，箱子完好。
     贴着放反而更像"刚砸进去的那一刻"，也更可控。 */
  const rr0 = L.ballR(9);
  /* **y 必须是"贴地"（球底正好压在地板面上）。** 随手写 `gy − 26` 会让
     球一出生的下半截就埋在地板里，于是第一帧被地板判成"水平撞墙"，
     vx 直接乘 −0.35 反弹 —— 图上是"球停在箱子前面，箱子完好"。 */
  const ball = L.spawnBall(bx - rr0 * 0.55, gy - rr0, 900, 9);
  ball.vy = 0;
  /* **要等一下顿帧走完再截。** 破箱那一帧 21 片碎片全在箱子中心同一个点上，
     而 hitStop 会冻结整个 step —— 直接截就是"一个黄点 + 一只球"，
     看不出碎片，也看不出环（第一次出图就是这样）。
     顿帧约 0.11s（7 帧），之后碎片才真正散开，所以这里数到第 20 帧。 */
  let hit = 0;
  for (let i = 0; i < 60; i++) {
    L.step(DT);
    if (S.rings.length > 0) hit++;
    if (hit >= 20) break;
  }
});

/* 3.5) 黑洞：吐怪的巢。**要能读出"这是个会冒东西的洞"，不是一块黑斑。** */
{
  const nst = S.nests[0];
  if (nst) {
    shot("nest", () => {
      /* 让它吐一只出来，画面里才有"刚爬出来"那一刻。 */
      nst.cd = 0; nst.left = Math.max(nst.left, 2);
      for (let i = 0; i < 40; i++) L.step(DT);
      /* **站到"和黑洞同高度"的地面上**，不能只按 x 减 150 放 ——
         黑洞所在的层未必在那一侧有地面，人一放就掉到楼下去，
         出出来的图是"门厅"，黑洞在画面外（这张图第一次就是这么废的）。 */
      let px = Math.max(48, nst.x - 150);
      for (let x = px; x < nst.x - 50; x += 8) {
        if (Math.abs(L.groundAt(x + 15, nst.y - 4) - nst.y) < 4) { px = x; break; }
      }
      L.placePlayer(px, nst.y - 42);
      for (let i = 0; i < 6; i++) L.step(DT);
      /* **相机是按层吸附的，所以这里必须把层号直接指定过去。**
         黑洞常坐在某摞箱子的顶上（`colTop` 不是地板），人站上去脚离地板
         早就超过 60px，`camGoalFloor` 判不出层号 → 镜头留在上一张图的层，
         黑洞在画面外。出图工具不能依赖"人站的位置刚好在层里"。 */
      S.cam.k = nst.layer;
      /* 镜头是按 7/s 缓动的，**6 帧只挪了一小半**，黑洞还在画面外。
         多跑 40 帧让它到位（0.67s，巢只挪 17px，不影响构图）。 */
      for (let i = 0; i < 40; i++) L.step(DT);
      console.log("  nest: x=" + nst.x + " y=" + nst.y + " layer=" + nst.layer +
        " cam=" + Math.round(S.cam.y) + " k=" + S.cam.k + " px=" + px);
      console.log("  FLOORS=" + JSON.stringify(L.FLOORS) + " WORLD_H=" + L.WORLD_H +
        " feet=" + Math.round(S.p.y + S.p.h) + " onGround=" + S.p.onGround);
    });
  }
}

/* 4) 斜坡特写：坡能不能读成"可以直接走上去" */
let rampInfo = null;
for (let k = 0; k < NF && !rampInfo; k++) {
  const r = L.LAYERS[k].terrain.filter(t => t.kind === "ramp")[0];
  if (r) rampInfo = { k, r };
}
if (rampInfo) {
  shot("ramp", () => {
    freezeFoes();
    const { k, r } = rampInfo;
    const lowX = r.rise > 0 ? r.x + 10 : r.x + r.w - 40;
    L.placePlayer(Math.max(40, lowX), L.FLOORS[k] - 42);
    for (let i = 0; i < 70; i++) L.step(DT);
  });
}

/* 4b) 上行：站在井梯顶端、头顶的洞口敞着 —— 应该浮出「W ↑ 爬上去」。
       **这张图验的是"能上能下"**：只看箱子的话，玩家不会知道按 W 能爬。 */
let climbInfo = null;
for (let k = 1; k < NF - 1 && !climbInfo; k++) {
  const h0 = L.LAYERS[k - 1].holes[0];
  if (!h0) continue;
  const l2 = L.LAYERS[k];
  const a = Math.max(0, Math.ceil(h0.x / 48));
  const b = Math.min(19, Math.floor((h0.x + h0.w) / 48) - 1);
  for (let i = a; i <= b; i++) if ((l2.colHgt[i] || 0) >= 3) { climbInfo = { k, col: i, h0 }; break; }
}
if (climbInfo) {
  shot("climb", () => {
    freezeFoes();
    const { k, col, h0 } = climbInfo;
    S.boxes.filter(b => !b.dead && b.x + b.w > h0.x && b.x < h0.x + h0.w &&
                        b.y + b.h > L.FLOORS[k - 1] - 200 && b.y < L.FLOORS[k - 1] + 4)
      .forEach(b => L.breakBox(b, "ball"));
    L.placePlayer(col * 48 + 9, L.LAYERS[k].floorY - 144 - 42);
    for (let i = 0; i < 40; i++) L.step(DT);
  });
}

/* 5) 门厅：冰墙封着门，门还看不见。**站到门左边 260px** ——
      这一段的意义就是"看见一堵冰墙挡着门"，站太远只能看到一片黑。 */
function standNearDoor() {
  L.placePlayer(Math.max(48, S.door.x - 260), L.GROUND_Y - 42);
  for (let i = 0; i < 70; i++) L.step(DT);
}
shot("hall", () => { freezeFoes(); standNearDoor(); });

/* 6) 门露出 */
shot("door", () => {
  freezeFoes();
  standNearDoor();
  S.boxes.filter(b => b.mat === "ice").forEach(b => L.breakBox(b, "ball"));
  for (let i = 0; i < 30; i++) L.step(DT);
});

/* 7) 球四档：同一屏摆四颗，看档位能不能一眼读出来 */
shot("balls", () => {
  freezeFoes();
  S.foes.length = 0;
  S.boxes.forEach(b => { b.dead = true; });
  L.placePlayer(780, L.GROUND_Y - 42);
  for (let i = 0; i < 50; i++) L.step(DT);
  L.spawnBall(110, L.GROUND_Y - L.ballR(0), 0, 0);
  L.spawnBall(280, L.GROUND_Y - L.ballR(3), 0, 3);
  L.spawnBall(450, L.GROUND_Y - L.ballR(6), 0, 6);
  L.spawnBall(620, L.GROUND_Y - L.ballR(12), 0, 12);
  for (let i = 0; i < 4; i++) L.step(DT);
  /* 站到最大那颗球旁边 —— **这张图也要能看出"怎么推"**：
     球停在脚边时才会浮出「走过去顶它」的提示，站远了什么都不显示。 */
  L.placePlayer(560, L.GROUND_Y - 42);
  for (let i = 0; i < 3; i++) L.step(DT);
});

/* 8) 结算。
   **只破冰墙不够。** 门厅的"喂球箱"是按列撒的，有概率正好落在门的格子上；
   只清 `mat === 'ice'` 的话，门矩形里还压着一口木箱，`doorBlocked()` 为真，
   于是 HUD 显示"门·未找到"、结算面板压根不出现 —— 出图工具自己把图画错了。 */
shot("clear", () => {
  freezeFoes();
  standNearDoor();
  const d = S.door;
  const onDoor = b => !(b.x + b.w <= d.x + 1 || b.x >= d.x + d.w - 1 ||
                        b.y + b.h <= d.y + 1 || b.y >= d.y + d.h - 1);
  S.boxes.filter(b => !b.dead && (b.mat === "ice" || onDoor(b)))
    .forEach(b => L.breakBox(b, "ball"));
  S.killed = S.killedTarget;
  L.checkDoor();
  L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
  for (let i = 0; i < 20; i++) L.step(DT);
});

console.log("\n全部出图完成 → " + OUT);
})().catch(e => { console.error("出图失败：" + e.stack); process.exit(1); });
