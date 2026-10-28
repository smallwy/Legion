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
  L.spawnBall(140, L.GROUND_Y - L.ballR(0), 0, 0);
  L.spawnBall(300, L.GROUND_Y - L.ballR(3), 0, 3);
  L.spawnBall(460, L.GROUND_Y - L.ballR(6), 0, 6);
  L.spawnBall(630, L.GROUND_Y - L.ballR(12), 0, 12);
  for (let i = 0; i < 4; i++) L.step(DT);
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
