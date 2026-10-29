/* ===========================================================================
   刷怪拥挤探针 —— 量"两只怪生成在同一个台面上互相顶住"有多少处

   ---------------------------------------------------------------------------
   用户 2026-10-29 的截图：两只绿色 moss 并排挤在一个箱顶上，谁也走不动。
   生成器里其实有间距控制（96 / 56 两档），但**它只看 x 差，不看脚下是什么**：
   两块相邻的箱顶只要 x 差 ≥ 56 就算"分开"，可两只能走的单位落在同一个
   台面上，朝对方走过去就顶死了。

   判据（"挤"）：
     · 脚底同高（|ya - yb| < 3）—— 同一个台面；
     · x 间距 < 98（两只身宽 37×2 + 24 余量）。
   另外单独统计"同一层内 x 间距 < 56 但脚底不同高"（跨面近贴）。

   用法：
     NODE_PATH=... node tools/_spawn-probe.js [种子...]
     不传种子就跑 1~20。
   ========================================================================= */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = process.env.PROTO
  ? path.resolve(ROOT, process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");

const html = fs.readFileSync(FILE, "utf8");
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(src);

const L = window.SNOWLAB;
const S = L.S;
const FOE_W = 37;

const seeds = process.argv.slice(2).map(Number).filter(n => n > 0);
const list = seeds.length ? seeds : Array.from({ length: 20 }, (_, i) => i + 1);

let totalFoes = 0, totalCrowd = 0, badLevels = 0;
const rows = [];

for (const sd of list) {
  L.newLevel(sd);
  /* **用 `S.level.spawns` 而不是 `S.foes`**：spawns 带着 layer 字段，
     S.foes 没有。两者顺序一一对应（`S.foes = L.spawns.map(...)`）。 */
  const sp = (S.level && S.level.spawns) || [];
  const pairs = [];
  for (let i = 0; i < sp.length; i++) {
    for (let j = i + 1; j < sp.length; j++) {
      const a = sp[i], b = sp[j];
      if (a.layer !== b.layer) continue;
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dy >= 3) { if (dx < 56) pairs.push({ a, b, dx, dy, kind: "跨面近贴" }); continue; }
      if (dx >= 98) continue;
      /* **同高还要看中间有没有东西挡着。**
         两只脚底同高、x 差 96，但如果中间隔着一摞箱子（它俩各自在不同的
         小台面上），它们根本走不到一起 —— 那不是对峙。
         只按"x 差"数会把这种正常排布也算成问题。 */
      const foot = a.y + 33;
      const lo = Math.min(a.x, b.x) + 37, hi = Math.max(a.x, b.x);
      const wall = S.boxes.some(bx => !bx.dead &&
        bx.x + bx.w > lo && bx.x < hi &&
        bx.y < foot - 4 && bx.y + bx.h > foot - 33);
      if (!wall) pairs.push({ a, b, dx, dy, kind: "同面挤" });
    }
  }
  totalFoes += sp.length;
  totalCrowd += pairs.filter(p => p.kind === "同面挤").length;
  if (pairs.length) {
    badLevels++;
    rows.push({ sd, n: sp.length, pairs });
  }
}

console.log("═══ 刷怪拥挤 ═══  种子 " + list.length + " 个 · 共 " + totalFoes + " 只怪");
console.log("同面挤（脚底同高 + 间距 < 98）：" + totalCrowd + " 对");
console.log("有问题的关：" + badLevels + " / " + list.length);
for (const r of rows) {
  console.log("\n种子 " + r.sd + "（" + r.n + " 只）");
  for (const p of r.pairs) {
    console.log("  第" + (p.a.layer + 1) + "层  " + p.kind +
      "  x " + Math.round(p.a.x) + " / " + Math.round(p.b.x) +
      "  dx " + Math.round(p.dx) + "  dy " + Math.round(p.dy));
  }
}
