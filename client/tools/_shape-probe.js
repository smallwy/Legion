/* 关卡**宏观形状**审计：现在每一关的"洞"在水平方向是怎么分布的？

   问题背景：`_diff-audit.js` 证明参数离散度很大，但那只是"多少"。
   玩家玩 100 关会腻，往往不是因为数量不够，而是因为**形状从没变过** ——
   每关都是"随机挖几个洞 + 随机摞箱子"，宏观上看不出这是个什么地方。

   这里量两件事：
     · 相邻两层之间，最近的洞水平差多少（dx）
       dx≈0 → 直井（一路掉到底）；dx≈500 → 之字（每层都要横穿整屏）
     · 洞宽的分布

   如果 dx 是均匀分布，说明生成器**既不做直井也不做之字**，全落在中间态 ——
   那"加骨架模板"就是最有性价比的一步。

   用法：node client/tools/_shape-probe.js [N]
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const PROTO = process.env.PROTO || path.join(ROOT, "prototype/snowlab.html");
const N = parseInt(process.argv[2] || "200", 10);

const html = fs.readFileSync(PROTO, "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const g = createCanvas(960, 600).getContext("2d");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const w = dom.window;
w.devicePixelRatio = 1;
w.HTMLCanvasElement.prototype.getContext = () => g;
w.requestAnimationFrame = () => 0;
w.eval(script);
const L = w.SNOWLAB;
if (L.setOffscreen) L.setOffscreen((cw, ch) => createCanvas(cw, ch));

const dxs = [], widths = [], perLevel = {};
for (let s = 1; s <= N; s++) {
  L.reset(s);
  const LAYERS = L.LAYERS;
  for (let k = 0; k < LAYERS.length; k++) {
    perLevel[LAYERS[k].holes.length] = (perLevel[LAYERS[k].holes.length] || 0) + 1;
    for (const h of LAYERS[k].holes) widths.push(h.w);
  }
  /* 相邻层：取"最近的洞对"的水平差。这是玩家实际走的那条路。 */
  for (let k = 0; k + 1 < LAYERS.length; k++) {
    let best = 9999;
    for (const a of LAYERS[k].holes) {
      for (const b of LAYERS[k + 1].holes) {
        const c1 = a.x + a.w / 2, c2 = b.x + b.w / 2;
        best = Math.min(best, Math.abs(c1 - c2));
      }
    }
    if (best < 9999) dxs.push(best);
  }
}

const buckets = [[0, 48], [48, 120], [120, 240], [240, 360], [360, 9999]];
console.log("=== 相邻层最近洞的水平差（" + dxs.length + " 对，屏幕宽 960）===");
for (const [a, b] of buckets) {
  const n = dxs.filter(d => d >= a && d < b).length;
  const pc = (n / dxs.length * 100);
  const tag = a === 0 ? "≈直井" : (a >= 360 ? "≈之字（横穿整屏）" : "");
  console.log("  " + String(a).padStart(4) + "~" + String(b === 9999 ? "∞" : b).padStart(4) +
    "px  " + String(n).padStart(5) + "  " + pc.toFixed(0).padStart(3) + "%  " + "#".repeat(Math.round(pc)) + " " + tag);
}
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log("  均值 " + avg(dxs).toFixed(1) + "px  中位数 " + dxs.slice().sort((a, b) => a - b)[Math.floor(dxs.length / 2)].toFixed(1));
console.log("\n=== 每层洞数分布 ===");
for (const k of Object.keys(perLevel).sort()) console.log("  " + k + " 个洞：" + perLevel[k] + " 层");
const wc = {};
for (const x of widths) wc[x] = (wc[x] || 0) + 1;
console.log("\n=== 洞宽分布 ===");
for (const k of Object.keys(wc).sort((a, b) => a - b)) console.log("  " + k + "px：" + wc[k]);
