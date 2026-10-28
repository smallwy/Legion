/* ===========================================================================
   snowlab.html 的离屏出图
   ---------------------------------------------------------------------------
   沙箱里开不了浏览器，但可以把内联脚本里的 draw() 接到 @napi-rs/canvas 上，
   导成 PNG 自己看。

   **这不是给用户的工具，是给改代码的人的自检**：布局错位、贴图缺失、
   白屏、文字压在一起，这些机器断言看不出来，只有图能看出来。

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

// 1) 开局：看整体布局
shot("01-start", () => {
  for (let i = 0; i < 40; i++) L.step(DT);
});

// 2) 喷雾中：看雪弹、裹雪进度
shot("02-shooting", () => {
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

// 3) 球在场：看球的四档外观
shot("03-balls", () => {
  for (let i = 0; i < 40; i++) L.step(DT);
  S.foes.length = 0;
  L.spawnBall(180, L.GROUND_Y - 22, 120, 1);
  L.spawnBall(320, L.GROUND_Y - 27, 90, 3);
  L.spawnBall(470, L.GROUND_Y - 33, 60, 5);
  L.spawnBall(640, L.GROUND_Y - 39, 30, 7);
  for (let i = 0; i < 6; i++) L.step(DT);
});

// 4) 门解锁：看开锁特效
shot("04-door-open", () => {
  for (let i = 0; i < 40; i++) L.step(DT);
  S.killed = S.killedTarget;
  L.checkDoor();
  for (let i = 0; i < 20; i++) L.step(DT);
});

// 5) 箱墙被打穿一半
shot("05-wall-broken", () => {
  for (let i = 0; i < 40; i++) L.step(DT);
  S.boxes.filter(b => b.x >= 780).forEach((b, i) => { if (i < 3) b.dead = true; });
  for (let i = 0; i < 30; i++) L.step(DT);
});

// 6) 结算面板
shot("06-clear", () => {
  for (let i = 0; i < 40; i++) L.step(DT);
  S.killed = S.killedTarget;
  L.checkDoor();
  L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
  for (let i = 0; i < 20; i++) L.step(DT);
});

console.log("\n全部出图完成 → " + OUT);
