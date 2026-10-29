/* 关卡**宏观形状**审计。

   第一版（2026-10-29 早）只量了一个数：相邻两层最近洞的水平差（dx）。
   它证明了"生成器既不做直井也不做之字，90% 挤在横移两三列"——
   那是**旧版**的问题诊断。

   现在有了骨架（shaft/zigzag/twin/wall/hub/helix），验收判据必须换。
   **不能再按 dx 的固定桶判**，原因是一条硬数学约束：

     x 落在 48 的网格上、洞宽 144、层间必须留 24
     → 两层洞的中心差最小就是 144 + 24 = 168，向上取到 48 的倍数 = **192**。

   也就是说 **0~120px 那两档在物理上永远为空**，直井的 dx 就恒等于 192，
   和随机关的平均 236 落在同一个桶里。按桶判，直井是不可见的。

   骨架的可辨识度在另外三个量上：
     · dx 均值   —— 这一关每层往下"走多远"
     · dx 标准差 —— **关内**有没有节奏（直井恒 0，之字恒 0 但值大，螺旋 312）
     · 洞 x 的绝对范围 —— 直井随机、靠壁两端、中枢居中

   所以这里按**骨架分组**统计这三个量，看六组能不能分开。
   判断标准不是"随机不重复"，而是 **六组的 (dx 均值, x 范围) 互不重叠**：
   重叠就等于又回到同一个中间态。

   用法：
     node client/tools/_shape-probe.js            主线 stage 1~48
     node client/tools/_shape-probe.js 200         主线跑 200 关（stage 循环 1~48）
     node client/tools/_shape-probe.js raw 200     旧行为（stage=null，骨架也随机）
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const PROTO = process.env.PROTO || path.join(ROOT, "prototype/snowlab.html");

const arg = process.argv[2] || "";
const RAW = arg === "raw";
const N = parseInt(RAW ? (process.argv[3] || "200") : (arg || "48"), 10);

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

const SKEL_CN = { shaft: "直井", zigzag: "之字", twin: "双井", wall: "靠壁", hub: "中枢", helix: "螺旋" };
const groups = new Map();       // skel -> 统计
const allDx = [];

/* 一关的 dx 序列：相邻两层之间**最近那对洞**的中心差。
   骨架是"这一层想开在哪"，实际落点会被同层间隔 / 层间 24 / 段宽 96 推来推去，
   所以量的必须是落点，不是锚点 —— 否则量的是我的意图，不是玩家的地图。 */
function dxSeries(layers) {
  const out = [];
  for (let k = 0; k + 1 < layers.length; k++) {
    let best = Infinity;
    for (const a of layers[k].holes) {
      for (const b of layers[k + 1].holes) {
        best = Math.min(best, Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)));
      }
    }
    /* 门厅那层没有洞，`best` 留 Infinity，跳过 —— 它不产生 dx。 */
    if (isFinite(best)) out.push(best);
  }
  return out;
}

for (let i = 0; i < N; i++) {
  const stage = RAW ? null : (i % 48) + 1;
  L.reset(1000 + i * 37, stage);
  const lv = L.S.level;
  const layers = L.LAYERS;
  const skel = lv.skel || "?";
  if (!groups.has(skel)) groups.set(skel, { dxn: 0, dxSum: 0, dxSq: 0, xMin: 1e9, xMax: -1e9, floors: [], h2: 0, h1: 0, n: 0, sig: new Map() });
  const gp = groups.get(skel);
  gp.n++;
  gp.floors.push(lv.nFloors);

  /* 每关的**洞 x 集合**（去重排序）—— 这是骨架最硬的指纹：
     它不是统计量，是"这一关的洞只出现在这几个位置"。 */
  const xset = [...new Set(layers.flatMap(l => l.holes.map(h => h.x)))].sort((a, b) => a - b);
  const sigKey = xset.join("/");
  gp.sig.set(sigKey, (gp.sig.get(sigKey) || 0) + 1);
  for (const l of layers) {
    for (const h of l.holes) {
      gp.xMin = Math.min(gp.xMin, h.x);
      gp.xMax = Math.max(gp.xMax, h.x);
    }
    if (l.holes.length === 2) gp.h2++;
    if (l.holes.length === 1) gp.h1++;
  }
  for (const d of dxSeries(layers)) {
    gp.dxn++; gp.dxSum += d; gp.dxSq += d * d;
    allDx.push(d);
  }
}

const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

console.log("=== " + (RAW ? "旧行为（stage=null，骨架也随机）" : "主线 stage 1~48 循环") + "，共 " + N + " 关 ===");
console.log("骨架  关数  层数分布         洞x 范围     dx 均值  dx 标准差  每层洞数");
console.log("─".repeat(84));
const rows = [];
for (const [k, gp] of groups) {
  const m = gp.dxSum / Math.max(1, gp.dxn);
  const v = Math.sqrt(Math.max(0, gp.dxSq / Math.max(1, gp.dxn) - m * m));
  const fl = [...new Set(gp.floors)].sort((a, b) => a - b).join("/");
  const hn = (gp.h1 + gp.h2) ? (1 + gp.h2 / (gp.h1 + gp.h2)).toFixed(2) : "-";
  rows.push({ k, m, v, xMin: gp.xMin, xMax: gp.xMax, n: gp.n, fl, hn, sig: gp.sig });
  console.log(((SKEL_CN[k] || k) + "      ").slice(0, 6) +
    String(gp.n).padStart(4) + "  " + fl.padEnd(16) + " " +
    (gp.xMin + "~" + gp.xMax).padEnd(12) + " " +
    m.toFixed(0).padStart(6) + "   " + v.toFixed(1).padStart(6) + "     " + hn);
}

/* ---------------- 判据：六组能不能分开 ---------------- */
console.log("\n=== 骨架辨识度 ===");
const bands = [
  { name: "贴列（每层几乎同一列）", lo: 0, hi: 230 },
  { name: "中距（三步一轮）", lo: 230, hi: 450 },
  { name: "远距（每层横穿整屏）", lo: 450, hi: 9999 },
];
console.log("  ① dx 均值分三档：");
for (const b of bands) {
  const inBand = rows.filter(r => r.m >= b.lo && r.m < b.hi);
  console.log("     " + b.name.padEnd(22) + " " +
    (inBand.map(r => (SKEL_CN[r.k] || r.k) + "(" + r.m.toFixed(0) + ")").join("　") || "（空）"));
}
/* ② 每关的洞 x 集合：最硬的指纹。同一种骨架的集合在这里是少数几种固定形态。 */
console.log("\n  ② 每关的洞 x 集合（出现次数最多的三种）：");
for (const r of rows) {
  const top = [...r.sig].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, c]) => k + "×" + c).join("  ");
  console.log("     " + (SKEL_CN[r.k] || r.k) + "  " + top);
}
console.log("\n  ③ 关内 dx 标准差（这条量的是「有没有节奏」，不是「多难」）：");
for (const r of rows) {
  console.log("     " + (SKEL_CN[r.k] || r.k) + "  σ=" + r.v.toFixed(1).padStart(5) +
    (r.v < 1 ? "  关内恒定 —— 一眼读得出走向" : "  关内会变 —— 靠每层洞数/位置认"));
}

console.log("\n=== 全体 dx 分布（" + allDx.length + " 对）===");
for (const [a, b] of [[0, 192], [192, 260], [260, 450], [450, 9999]]) {
  const n = allDx.filter(d => d >= a && d < b).length;
  const pc = n / Math.max(1, allDx.length) * 100;
  console.log("  " + String(a).padStart(4) + "~" + String(b === 9999 ? "∞" : b).padStart(4) +
    "  " + String(n).padStart(4) + "  " + pc.toFixed(0).padStart(3) + "%  " + "#".repeat(Math.round(pc)));
}
console.log("  均值 " + mean(allDx).toFixed(1) + "  中位数 " + med(allDx).toFixed(1));
