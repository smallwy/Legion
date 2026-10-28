/* ===========================================================================
   snowlab.html 的离屏出图
   ---------------------------------------------------------------------------
   沙箱里开不了浏览器，但可以把内联脚本里的 draw() 接到 @napi-rs/canvas 上，
   导成 PNG 自己看。

   **这不是给用户的工具，是给改代码的人的自检**：布局错位、贴图缺失、
   白屏、文字压在一起、镜头没跟上、深度暗化过重读不出东西 ——
   这些机器断言看不出来，只有图能看出来。

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

function shot(name, fn) {
  L.reset();
  fn && fn();
  L.draw();
  const file = path.join(OUT, "snowlab-" + name + ".png");
  fs.writeFileSync(file, real.toBuffer("image/png"));
  console.log("出图 " + file);
}

/** 把玩家送到指定位置，跑够帧数让镜头缓动到位 */
function goto(x, y, n) {
  L.placePlayer(x, y);
  for (let i = 0; i < (n || 90); i++) L.step(DT);
}

/* 1) L3 地表：整层。这一张要能读出"右边有一摞挡住去路的箱子，
      脚下这段地面是木箱铺的（带霜）" */
shot("01-L3", () => {
  for (let i = 0; i < 50; i++) L.step(DT);
});

/* 2) L3 喷雪：雪弹 + 裹雪进度 */
shot("02-L3-shoot", () => {
  for (let i = 0; i < 40; i++) L.step(DT);
  const f = S.foes[1];
  f.speed = 0; f.vx = 0;
  L.placePlayer(f.x - 96, f.y + f.h - 42);
  S.ammo = 100;
  S.p.face = 1;
  for (let k = 0; k < 3; k++) { L.shoot(); for (let i = 0; i < 11; i++) L.step(DT); }
  L.shoot();
  for (let i = 0; i < 4; i++) L.step(DT);
});

/* 3) 挖穿 L3 地板：三口覆霜箱砸掉之后，洞露出来，往下看得见中层 */
shot("03-L3-dug", () => {
  for (let i = 0; i < 40; i++) L.step(DT);
  S.boxes.filter(b => b.frost && b.y < 520).forEach(b => L.breakBox(b, "ball"));
  L.placePlayer(240, 438);
  for (let i = 0; i < 60; i++) L.step(DT);
});

/* 4) L2 中层：主战场。这一张要看得出"四处高台错落 + 箱室"，不是一条走廊 */
shot("04-L2", () => {
  /* 把怪钉住再出图：不然 runner 会追过来撞掉玩家一血，
     图上会挂着 "-1" 和受伤闪白，看起来像 bug。 */
  S.foes.forEach(f => { f.speed = 0; f.vx = 0; });
  goto(372, 848);
});

/* 5) L2 中层的箱室近景 */
shot("05-L2-boxes", () => {
  S.foes.forEach(f => { f.speed = 0; f.vx = 0; });
  goto(680, 952);
});

/* 6) L1 底层：黑暗洞窟 + 冰墙封着右边 */
shot("06-L1", () => {
  goto(300, 1458);
});

/* 7) 破冰墙：砸开外层，门的外壳（840 那两口）露出来 */
shot("07-L1-broken", () => {
  goto(300, 1458);
  S.boxes.filter(b => b.mat === "ice" && b.x === 792).forEach(b => L.breakBox(b, "ball"));
  for (let i = 0; i < 40; i++) L.step(DT);
});

/* 8) 门露出：外壳也砸掉，门出现在洞窟最深处 */
shot("08-door-revealed", () => {
  goto(300, 1458);
  S.boxes.filter(b => b.mat === "ice").forEach(b => L.breakBox(b, "ball"));
  for (let i = 0; i < 30; i++) L.step(DT);
});

/* 9) 球四档：同一屏摆四颗，看档位能不能一眼读出来 */
shot("09-balls", () => {
  for (let i = 0; i < 40; i++) L.step(DT);
  S.foes.length = 0;
  S.boxes.forEach(b => { b.dead = true; });
  L.spawnBall(180, L.GROUND_Y - 22, 120, 0);
  L.spawnBall(320, L.GROUND_Y - 27, 90, 3);
  L.spawnBall(470, L.GROUND_Y - 33, 60, 6);
  L.spawnBall(640, L.GROUND_Y - 39, 30, 12);
  for (let i = 0; i < 6; i++) L.step(DT);
  for (let i = 0; i < 90; i++) L.step(DT);   // 顺手让镜头落到 L1
});

/* 10) 结算面板 */
shot("10-clear", () => {
  goto(300, 1458);
  S.boxes.filter(b => b.mat === "ice").forEach(b => L.breakBox(b, "ball"));
  S.killed = S.killedTarget;
  L.checkDoor();
  L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
  for (let i = 0; i < 20; i++) L.step(DT);
});

console.log("\n全部出图完成 → " + OUT);
