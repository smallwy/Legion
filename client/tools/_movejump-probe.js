/* 量「玩家按左右键」和「敌人突然弹一下」之间有没有因果。

   用户 2026-10-29：「现在按左右 就跳了一个敌方 感觉很奇怪 是设定如此
   还是有 bug 很突兀」。

   **"跳"有三种，必须分开数**（前两种是设计，第三种是 bug）：
     ① 真跳 —— 离地 + vy < 0，敌人主动跳向玩家，正常
     ② 坠落 —— 走出台面边缘往下掉，vy 从 0 逐渐加速，正常
     ③ **凭空上移 / 瞬间位移** —— 没起跳（vy >= 0）y 却变小，
        或单帧位移大到跳帧。这是 stepBody 的台阶助步 / 水平挤出在搬人，
        读作"敌人抖了一下 / 跳了一个"。

   做法是 A/B：同一颗种子跑两遍，一遍不按键、一遍按住 D。
   如果"③"只在按键那遍出现，那它就是玩家推挤引起的，不是设定。

   用法：
     node tools/_movejump-probe.js [秒数] [种子...]
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = process.env.PROTO || path.join(ROOT, "prototype", "snowlab.html");
const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("找不到脚本块");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;
const S = L.S;

const DT = 1 / 60;
const SECS = Number(process.argv[2] || 6);
const seeds = process.argv.slice(3).map(Number);
if (!seeds.length) seeds = null;
const SEEDS = seeds && seeds.length ? seeds : Array.from({ length: 20 }, (_, i) => i + 1);
const FRAMES = Math.round(SECS * 60);

/* 判定阈值。静止的敌人在浮点下也有 ±0.2px 的噪声，所以门槛放到 4px；
   真跳一帧只上升 3~8px（初速 ~430 / 60），所以上移 4px 以上且 vy>=0
   就基本只能是被搬的。 */
const LIFT = 4.0;

function run(seed, hold) {
  L.newLevel(seed);
  const acc = new Map();
  for (const f of S.foes) acc.set(f, { breed: f.breed, lift: 0, worst: 0, at: null, jump: 0, drop: 0 });
  let prevOnGround = new Map();
  for (const f of S.foes) prevOnGround.set(f, f.onGround);

  for (let fr = 0; fr < FRAMES; fr++) {
    if (hold) S.keys[hold] = true;
    const before = new Map();
    for (const f of S.foes) before.set(f, { x: f.x, y: f.y, vy: f.vy, og: f.onGround });
    L.step(DT);
    if (hold) S.keys[hold] = false;

    for (const f of S.foes) {
      const b = before.get(f);
      if (!b) continue;
      const a = acc.get(f);
      if (!a) continue;
      const dy = f.y - b.y, dx = f.x - b.x;

      /* 起跳：这一帧开始时站在地上、之后 vy 明显为负 */
      if (b.og && f.vy < -80) a.jump++;
      /* 正常坠落：y 增、vy 也增（重力在起作用），不算 */
      if (dy > 0 && f.vy > b.vy + 1) { /* 正常下落 */ }
      else if (dy > 10 && Math.abs(f.vy) < 1) a.drop++;

      /* ③ 凭空上移 */
      if (dy < -LIFT && f.vy >= -1) {
        a.lift++;
        if (-dy > a.worst) {
          a.worst = -dy;
          a.at = { x: Math.round(f.x), y: Math.round(b.y), dx: +dx.toFixed(1), frame: fr };
        }
      }
    }
  }
  return [...acc.values()];
}

let sum = { idle: 0, held: 0 };
const interesting = [];

for (const seed of SEEDS) {
  const a = run(seed, null);
  const b = run(seed, "d");
  const ia = a.reduce((s, x) => s + x.lift, 0);
  const ib = b.reduce((s, x) => s + x.lift, 0);
  sum.idle += ia; sum.held += ib;
  const worstB = b.slice().sort((p, q) => q.worst - p.worst)[0];
  if (ib > 0 || ia > 0) {
    interesting.push({ seed, ia, ib, worstB, jumps: b.reduce((s, x) => s + x.jump, 0) });
  }
}

console.log(`文件 ${path.basename(FILE)} · ${SECS} 秒 × ${SEEDS.length} 关`);
console.log(`判据：单帧上移 > ${LIFT}px 且 vy >= -1（没在起跳）\n`);
console.log("按种子（静置 lift / 按住 D lift / 按住 D 时真跳次数 / 最狠一次）");
for (const r of interesting.slice(0, 24)) {
  const w = r.worstB && r.worstB.worst > 0 ? r.worstB : null;
  console.log(
    "  种子" + String(r.seed).padStart(3) +
    "  静置 " + String(r.ia).padStart(3) +
    "  按D " + String(r.ib).padStart(3) +
    "  真跳 " + String(r.jumps).padStart(2) +
    (w ? "  " + w.breed + " 一帧上移 " + w.worst.toFixed(1) + "px @(" + w.at.x + "," + w.at.y + ") dx=" + w.at.dx : "")
  );
}
if (!interesting.length) console.log("  （没有）");

console.log("\n合计：静置 " + sum.idle + " 次 · 按住 D " + sum.held + " 次");
const delta = sum.held - sum.idle;
console.log(delta > 0
  ? "→ 按键之后凭空上移多了 " + delta + " 次：**和玩家移动有关**"
  : "→ 按键没有显著增加凭空上移：不是推挤引起的，得往别处查");
