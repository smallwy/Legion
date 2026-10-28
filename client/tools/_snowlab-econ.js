/* ===========================================================================
   snowlab 的"球经济"体检
   ---------------------------------------------------------------------------
   要回答的问题：**怪少会不会导致没球可推？**

   球这条链是读代码读出来的（不是猜）：
       破箱 → 掉"雪之碎片" → 饱食度 +20 → 吐雪（一关的弹药）
       → 裹住敌人 → 敌人变球 → 球撞硬箱
   也就是 **球的数量上限 = 敌人数量**（一颗球对应一只怪），而球是消耗品：
   life 只有 4.6s、撞一次墙掉速、破箱之后自己也会碎。

   所以"怪少"不是观感问题，是**弹药补给**问题。这个脚本把它算出来：

     A. 每关几颗球（= 敌人数），逐层分布
     B. 每关几口硬箱（冰 / 铁），那才是非球不可的地方
     C. 一颗球要吞几只怪才够砸冰墙（tier 算术）

   跑法：node client/tools/_snowlab-econ.js [种子数]
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");
const N = parseInt(process.argv[2] || "40", 10);

const html = fs.readFileSync(FILE, "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const A = window.SNOWLAB;

const rows = [];
for (let i = 0; i < N; i++) {
  const seed = 1000 + i * 7;
  A.reset(seed);
  const L = A.S.level;
  const nF = L.floors.length;
  const per = new Array(nF).fill(0);
  for (const sp of L.spawns) {
    /* 怪站在哪一层：sp.y 是脚底，找最接近的地板行 */
    let k = 0;
    for (let j = 0; j < nF; j++) if (sp.y >= L.floors[j] - 220) k = j;
    per[k]++;
  }
  const cnt = { wood: 0, stone: 0, iron: 0, ice: 0 };
  for (const b of A.S.boxes) cnt[b.mat] = (cnt[b.mat] || 0) + 1;
  rows.push({ seed, nF, per, foes: L.spawns.length, cnt, boxes: A.S.boxes.length });
}

console.log("种子   层  各层怪(第1层..第N层)   怪总数  箱子  木    石   铁  冰");
for (const r of rows) {
  console.log(
    String(r.seed).padEnd(6) + String(r.nF).padEnd(3) +
    r.per.join(",").padEnd(22) + String(r.foes).padEnd(7) +
    String(r.boxes).padEnd(5) + String(r.cnt.wood).padEnd(5) +
    String(r.cnt.stone).padEnd(5) + String(r.cnt.iron).padEnd(4) +
    String(r.cnt.ice).padEnd(4)
  );
}

const avg = f => rows.reduce((a, r) => a + f(r), 0) / rows.length;
const rng = f => Math.min(...rows.map(f)) + "~" + Math.max(...rows.map(f));

console.log("\n平均：怪 " + avg(r => r.foes).toFixed(1) + "（" + rng(r => r.foes) + "）" +
  "  箱子 " + avg(r => r.boxes).toFixed(0) +
  "  木 " + avg(r => r.cnt.wood).toFixed(0) +
  "  石 " + avg(r => r.cnt.stone).toFixed(1) +
  "  铁 " + avg(r => r.cnt.iron).toFixed(1) +
  "  冰 " + avg(r => r.cnt.ice).toFixed(1));

console.log("\n球档位：0→" + A.ballTier(0) + "  1→" + A.ballTier(1) + "  2→" + A.ballTier(2) +
  "  3→" + A.ballTier(3) + "  4→" + A.ballTier(4) + "  6→" + A.ballTier(6));
console.log("冰墙要 tier>=2：裹 1 只怪 → absorbed=1（小）；球再撞死 1 只 → absorbed=3（中）");
