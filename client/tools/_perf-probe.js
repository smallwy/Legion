/* ===========================================================================
   帧耗时探针 —— 分开量"逻辑"和"绘制"，只打印数字
   ---------------------------------------------------------------------------
   用户反馈「总感觉一卡一卡的」。要先回答一个前置问题：
   卡的是**时间推进**（顿帧，`step()` 提前 return），还是**帧率**（画不动）？

   于是这里把两者分开计时：

     · step：纯逻辑（物理 / 碰撞 / 粒子）
     · draw：纯绘制（含全部 canvas 调用）

   注意 **@napi-rs/canvas 是 Skia，性能特征和浏览器 canvas 不同**，
   所以绝对数字不能当真。能当真的是**比例**：哪一边占大头，
   以及"全画"和"只画可见层"之间的差距。

   跑法：NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
         node client/tools/_perf-probe.js [帧数] [种子]
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");
const N = Number(process.argv[2] || 300);
const SEED = Number(process.argv[3] || 7);
const W = 960, H = 600;

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const real = createCanvas(W, H);
const g = real.getContext("2d");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = function (t) { return t === "2d" ? g : null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
/* 离屏工厂：这个工具把 getContext 全指向同一块 ctx，静态层缓存必须另开一块，否则会画到主画布上。 */
if (window.SNOWLAB && window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));

const L = window.SNOWLAB;
const S = L.S;

/* 没有立绘可加载，天空会退回程序化绘制 —— 一致性有保证，量的是同一份代码 */
L.newLevel(SEED);
for (let i = 0; i < 90; i++) { L.step(1 / 60); L.draw(); }

const DT = 1 / 60;
const tStep = [], tDraw = [];
let dir = 0, phase = 0;
function drive(f) {
  const t = f * DT;
  const seg = Math.floor(t / 2.2);
  if (seg !== phase) { phase = seg; dir = (seg % 2) ? 1 : -1; }
  S.keys['a'] = false; S.keys['d'] = false;
  if (t - seg * 2.2 > 0.35) S.keys[dir > 0 ? 'd' : 'a'] = true;
  S.keys['w'] = (Math.floor(t / 1.7) * 1.7 + 0.05 > t && Math.floor(t / 1.7) * 1.7 + 0.16 < t);
  if (f % 11 === 0) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j' }));
    window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'j' }));
  }
}

for (let f = 0; f < N; f++) {
  drive(f);
  let t0 = process.hrtime.bigint();
  L.step(DT);
  tStep.push(Number(process.hrtime.bigint() - t0) / 1e6);
  t0 = process.hrtime.bigint();
  L.draw();
  tDraw.push(Number(process.hrtime.bigint() - t0) / 1e6);
}

const stat = (arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    avg: sum / s.length,
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
    max: s[s.length - 1],
  };
};
const a = stat(tStep), b = stat(tDraw);

console.log("种子 " + SEED + " · " + N + " 帧 · " + W + "x" + H);
console.log("");
console.log("          平均      p50      p95      最大");
const row = (name, o) => console.log("  " + name.padEnd(6) +
  o.avg.toFixed(2).padStart(7) + "ms" + o.p50.toFixed(2).padStart(8) + "ms" +
  o.p95.toFixed(2).padStart(8) + "ms" + o.max.toFixed(2).padStart(8) + "ms");
row("step", a);
row("draw", b);
console.log("");
console.log("  一帧合计中位 " + (a.p50 + b.p50).toFixed(2) + "ms → 理论上限 " +
  Math.round(1000 / (a.p50 + b.p50)) + " fps");
console.log("  其中绘制占 " + (b.avg / (a.avg + b.avg) * 100).toFixed(1) + "%");
console.log("");
/* 逐帧耗时（只打印超过中位 3 倍的帧，以及它们的邻居）——
   卡顿是"尖峰"不是"平均"，平均值会把它稀释掉 */
{
  const med = a.p50 + b.p50;
  const spike = [];
  for (let i = 0; i < N; i++) if (tDraw[i] > Math.max(8, b.p50 * 3)) spike.push(i);
  console.log("");
  console.log("  绘制尖峰（>3 倍中位） " + spike.length + " 帧 / " + N);
  if (spike.length) {
    console.log("    帧号: " + spike.slice(0, 24).join(" "));
    console.log("    耗时: " + spike.slice(0, 24).map(i => tDraw[i].toFixed(0)).join(" "));
  }
  const first = tDraw.slice(0, 20).map(v => v.toFixed(1)).join(" ");
  console.log("    首 20 帧 draw 耗时: " + first);
}

console.log("  场景规模：箱子 " + S.boxes.filter(x => !x.dead).length +
  " · 平台 " + S.plats.length +
  " · 道具 " + S.deco.length +
  " · 碎片 " + S.frags.length +
  " · 敌人 " + S.foes.filter(x => !x.dead).length +
  " · 层 " + (S.layers ? S.layers.length : "?"));
