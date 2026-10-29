/* ===========================================================================
   攀爬探针 —— 爬井那一串有没有"瞬间移动"
   ---------------------------------------------------------------------------
   用户 2026-10-29 截图：「这里跳上去 会很不自然的 瞬间移动」。

   原来 `wellClimb` 是 `p.x = cw.x; p.y = cw.y`，一帧之内横竖同时到位。
   光看代码能看出来"没有过渡"，但看不出**多大的跳变**、以及改完之后
   到底是"平滑上升"还是"换了种方式在顿"。

   所以这里逐帧记 (x, y)，输出：
     · 位移总量（横向 / 纵向）
     · **单帧最大位移** —— 这是"瞬移"的直接度量。
       60fps 下正常移动是 300*dt = 5px/帧；一帧跳 144px 就是闪现。
     · 整段耗时
     · 逐帧轨迹（抽样）

   跑法：NODE_PATH=... node client/tools/_climb-probe.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("找不到内联脚本"); process.exit(1); }

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;
const S = L.S;
const DT = 1 / 60;

/* 找一个真能触发 wellClimb 的位置：洞口 + 下方 2 格以内 + 洞里没箱子 */
function findSpot() {
  const lv = S.level;
  if (!lv) return null;
  for (let k = 1; k < lv.floors.length; k++) {
    const upper = lv.floors[k - 1];
    for (const h of (lv.layers[k - 1].holes || [])) {
      /* 把压在洞里的箱子判死（= 盖板已砸开） */
      const saved = [];
      for (const b of S.boxes) {
        if (b.dead) continue;
        if (b.x + b.w > h.x && b.x < h.x + h.w && b.y + b.h > upper - 200 && b.y < upper + 4) {
          saved.push(b); b.dead = true;
        }
      }
      for (const d of [144, 120, 96, 48]) {
        const y = upper + d - L.PLAYER_H;
        for (const ox of [0, -10, h.w / 2 - L.PLAYER_W / 2]) {
          const x = h.x + ox;
          if (x < L.WALL_L || x + L.PLAYER_W > L.WALL_R) continue;
          S.p.x = x; S.p.y = y; S.p.climb = null; S.p.onGround = true;
          if (L.wellClimb(S.p)) {
            return { k, upper, h, x, y, d, saved };
          }
        }
      }
      for (const b of saved) b.dead = false;
    }
  }
  return null;
}

let ok = 0, worst = 0, report = [];
for (let seed = 1; seed <= 40; seed++) {
  L.newLevel(seed);
  for (let i = 0; i < 30; i++) L.step(DT);
  const spot = findSpot();
  if (!spot) continue;

  /* 站到起点，按一下 W */
  S.p.x = spot.x; S.p.y = spot.y; S.p.climb = null;
  S.p.vx = 0; S.p.vy = 0; S.p.onGround = true;
  S.keys = {};
  S.keys['w'] = true;

  const path0 = [];
  let maxStep = 0;
  let prev = { x: S.p.x, y: S.p.y };
  let frames = 0;
  for (let f = 0; f < 60; f++) {
    if (f === 1) S.keys['w'] = false;
    L.step(DT);
    const dx = S.p.x - prev.x, dy = S.p.y - prev.y;
    const d = Math.hypot(dx, dy);
    if (d > maxStep) maxStep = d;
    path0.push({ x: S.p.x, y: S.p.y, d });
    prev = { x: S.p.x, y: S.p.y };
    frames++;
    if (!S.p.climb && f > 2) break;
  }

  ok++;
  if (maxStep > worst) worst = maxStep;
  report.push({
    seed, k: spot.k, d: spot.d,
    dx: Math.abs(path0[path0.length - 1].x - spot.x),
    dy: Math.abs(path0[path0.length - 1].y - spot.y),
    maxStep, frames, trace: path0,
  });
}

console.log("找到可触发的井口 " + ok + " 处（扫 40 个种子）");
if (!ok) process.exit(0);
console.log("单帧最大位移 最差 " + worst.toFixed(1) + "px（60fps 正常移动是 5px/帧）");
console.log("");
console.log("  seed  层  高度  横移   纵移  单帧峰值  帧数");
for (const r of report.slice(0, 10)) {
  console.log("  " + String(r.seed).padStart(4) + "  " + String(r.k).padStart(2) + "  " +
    String(r.d).padStart(4) + "  " + r.dx.toFixed(0).padStart(4) + "  " +
    r.dy.toFixed(0).padStart(4) + "  " + r.maxStep.toFixed(1).padStart(6) + "  " +
    String(r.frames).padStart(4));
}
/* 抽一例打轨迹，看是不是"一段一段顿" */
const ex = report[0];
console.log("");
console.log("一例轨迹（seed " + ex.seed + "，每 2 帧取样，x/y/本帧位移）：");
console.log("  " + ex.trace.filter((_, i) => i % 2 === 0)
  .map(t => t.x.toFixed(0) + "," + t.y.toFixed(0) + "(" + t.d.toFixed(1) + ")").join("  "));
