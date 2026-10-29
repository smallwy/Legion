/* 难度离散度审计：**跨种子的"关卡难度"分布**，用来回答一个问题 ——
   "第 1 关和第 30 关，难度是不是同一张牌洗出来的？"

   现在（第七轮之前）层数与所有机制都只跟**单关内的 tier** 有关，
   跟"这是玩家第几关"完全无关；`reset()` 拿到的种子是 Math.random，
   所以第 1 关就有 25% 的概率是 5 层 + 铁箱 + 冰墙。

   这个脚本把 N 个种子的结构指标摊开，给出：
     · 层数直方图
     · 每关的"内容量"（箱子格 / 怪 / 坡 / 冰墙 / 铁箱）
     · **最难的 5 关 vs 最易的 5 关**的指标对照 —— 差距越大，
       说明"随机"在冒充"曲线"

   用法：node client/tools/_diff-audit.js [N]
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const PROTO = process.env.PROTO || path.join(ROOT, "prototype/snowlab.html");
const N = parseInt(process.argv[2] || "300", 10);

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

function audit(seed) {
  L.reset(seed);
  const S = L.S;
  const nF = L.FLOORS.length;
  const boxes = S.boxes || [];
  const foes = S.foes || [];
  const plats = S.plats || [];
  const ramps = plats.filter(p => p.kind === "ramp").length;
  const mats = { wood: 0, stone: 0, iron: 0, ice: 0 };
  for (const b of boxes) mats[b.mat] = (mats[b.mat] || 0) + 1;
  const runners = foes.filter(f => f.kind === "runner").length;
  const breeds = {};
  for (const f of foes) breeds[f.breed] = (breeds[f.breed] || 0) + 1;
  /* 洞宽：最窄的那个洞是"要贴着边找"的程度 */
  let minHole = 999, maxHole = 0;
  for (const l of L.LAYERS) for (const h of l.holes) { minHole = Math.min(minHole, h.w); maxHole = Math.max(maxHole, h.w); }
  return {
    seed, nF, boxes: boxes.length, iron: mats.iron, ice: mats.ice,
    foes: foes.length, runners, ramps,
    minHole: minHole === 999 ? 0 : minHole, maxHole,
    breeds: Object.keys(breeds).join("/"),
  };
}

const rows = [];
for (let s = 1; s <= N; s++) rows.push(audit(s));

const avg = (a, k) => (a.reduce((x, r) => x + r[k], 0) / a.length);
const hist = {};
for (const r of rows) hist[r.nF] = (hist[r.nF] || 0) + 1;

/* **"难度分"是个排序用的粗分，不是真难度。**
   它只把"这一关有多少件要处理的东西"加起来，用来排序看离散度：
   层数（每多一层要多找一次洞）+ 怪（每只都是一次操作）+ 铁箱（必绕路）
   + 冰墙（必须有球）+ 坡（操作面）。权重是主观的，但排序结果是稳的。 */
const score = r => (r.nF - 2) * 10 + r.foes * 2 + r.iron * 1.5 + r.ice * 3 + r.ramps * 1.2;
rows.forEach(r => { r.score = +score(r).toFixed(1); });
const sorted = [...rows].sort((a, b) => b.score - a.score);

const cols = ["seed", "nF", "score", "boxes", "foes", "runners", "ramps", "iron", "ice", "minHole", "maxHole", "breeds"];
const line = r => cols.map(c => r[c]).join(",");

console.log("=== 层数分布（" + N + " 个种子）===");
for (const k of Object.keys(hist).sort()) {
  const pct = (hist[k] / N * 100).toFixed(0);
  console.log("  " + k + " 层：" + String(hist[k]).padStart(4) + "  (" + pct + "%)  " + "#".repeat(Math.round(hist[k] / N * 60)));
}

console.log("\n=== 每关内容量（均值 / 最小 / 最大）===");
for (const c of ["boxes", "foes", "ramps", "iron", "ice"]) {
  const a = rows.map(r => r[c]);
  console.log("  " + c.padEnd(7) + " " + avg(rows, c).toFixed(1).padStart(6) + "   " +
    String(Math.min(...a)).padStart(4) + " ~ " + String(Math.max(...a)).padStart(4) +
    "   极差 " + (Math.max(...a) - Math.min(...a)));
}
const ironN = rows.filter(r => r.iron > 0).length, iceN = rows.filter(r => r.ice > 0).length;
const runN = rows.filter(r => r.runners > 0).length;
console.log("  出铁箱的关 " + ironN + "/" + N + "，出冰墙 " + iceN + "/" + N + "，出追人怪 " + runN + "/" + N);

console.log("\n=== 最难的 5 关 ===");
console.log("  " + cols.join(","));
for (const r of sorted.slice(0, 5)) console.log("  " + line(r));
console.log("=== 最易的 5 关 ===");
console.log("  " + cols.join(","));
for (const r of sorted.slice(-5)) console.log("  " + line(r));

const ss = sorted.map(r => r.score);
console.log("\n难度分散度：最高 " + ss[0] + " / 最低 " + ss[ss.length - 1] +
  "，标准差 " + Math.sqrt(ss.reduce((a, s) => a + (s - avg(rows, "score")) ** 2, 0) / ss.length).toFixed(2));

/* CSV 给后续规划用（不改仓库，落在 shots 下） */
const out = path.join(ROOT, "shots", "diff-audit.csv");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, cols.join(",") + "\n" + rows.map(line).join("\n"));
console.log("明细 " + out);
