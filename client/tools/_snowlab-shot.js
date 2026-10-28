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

/** 钉住怪：不然 runner 会追过来撞掉一血，图上挂着 "-1" 和受伤闪白，像 bug。 */
function freezeFoes() { S.foes.forEach(f => { f.speed = 0; f.vx = 0; }); }

/* 1) 地表：出生点。要能读出"往右走是死路（石箱堆），脚下这段带霜的地板能挖" */
shot("01-L6", () => {
  for (let i = 0; i < 50; i++) L.step(DT);
});

/* 2) 挖穿地表：洞露出来，往下看得见浅井那一层 ——
      **这一张是这一版全部的说服力所在**：掉下去只掉一层，抬头还看得见上面 */
shot("02-L6-dug", () => {
  freezeFoes();
  S.boxes.filter(b => b.frost && b.y + 48 === L.FLOORS[0]).forEach(b => L.breakBox(b, "ball"));
  L.placePlayer(262, 298);
  for (let i = 0; i < 26; i++) L.step(DT);
});

/* 3) 浅井：右边井口，左边一堆货箱，中间是高台 */
shot("03-L5", () => { freezeFoes(); goto(150, 538); });

/* 4) 箱室：箱子最多的一层 */
shot("04-L4", () => { freezeFoes(); goto(700, 778); });

/* 5) 冰廊：第一块冰，教"子弹打不动" */
shot("05-L3", () => { freezeFoes(); goto(400, 1018); });

/* 6) 深窟：再往下就是门厅，洞在中间偏左 */
shot("06-L2", () => { freezeFoes(); goto(560, 1258); });

/* 7) 门厅：冰墙封着右边，门还看不见 */
shot("07-L1", () => { freezeFoes(); goto(300, 1498); });

/* 8) 破外屏障：792 那两格砸掉，门壳（840）露出来 */
shot("08-L1-broken", () => {
  freezeFoes();
  goto(300, 1498);
  S.boxes.filter(b => b.mat === "ice" && b.x === 792).forEach(b => L.breakBox(b, "ball"));
  for (let i = 0; i < 40; i++) L.step(DT);
});

/* 9) 门露出 */
shot("09-door", () => {
  freezeFoes();
  goto(300, 1498);
  S.boxes.filter(b => b.mat === "ice").forEach(b => L.breakBox(b, "ball"));
  for (let i = 0; i < 30; i++) L.step(DT);
});

/* 10) 球四档：同一屏摆四颗，看档位能不能一眼读出来 */
shot("10-balls", () => {
  freezeFoes();
  S.foes.length = 0;
  S.boxes.forEach(b => { b.dead = true; });
  L.placePlayer(700, L.GROUND_Y - 42);
  for (let i = 0; i < 60; i++) L.step(DT);
  L.spawnBall(160, L.GROUND_Y - 22, 0, 0);
  L.spawnBall(320, L.GROUND_Y - 27, 0, 3);
  L.spawnBall(480, L.GROUND_Y - 33, 0, 6);
  L.spawnBall(650, L.GROUND_Y - 39, 0, 12);
  for (let i = 0; i < 4; i++) L.step(DT);
});

/* 11) 结算 */
shot("11-clear", () => {
  goto(300, 1498);
  S.boxes.filter(b => b.mat === "ice").forEach(b => L.breakBox(b, "ball"));
  S.killed = S.killedTarget;
  L.checkDoor();
  L.placePlayer(S.door.x + 4, L.GROUND_Y - 42);
  for (let i = 0; i < 20; i++) L.step(DT);
});

console.log("\n全部出图完成 → " + OUT);
