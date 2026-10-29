/* 量「同一只怪在同一个地方反复往上跳」—— 用户看到的那个"突兀"就是它。

   单看"一帧上移多少"不够：爬上矮坎本来就是一次 4~20px 的整段抬升（设计如此），
   一次不算问题。**问题在重复** —— 抬上去站不住、掉回来、再抬，
   同一只怪在同一处 1 秒里抬 3 次以上，画面上就是原地抽搐/抽搐式的跳。

   判据：同一只怪、1 秒窗口内、上移 ≥4px 且没起跳（vy >= -1）的事件 ≥3 次，
   且这些事件的 x 跨度 < 6px（同一处）。

   用法：node tools/_relift-probe.js [秒数] [种子...]
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");
const FILE = process.env.PROTO || path.join(ROOT, "prototype/snowlab.html");
const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = () => null;
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB, S = L.S;
const DT = 1 / 60;
const SECS = Number(process.argv[2] || 8);
const seeds = process.argv.slice(3).map(Number);
const SEEDS = seeds.length ? seeds : Array.from({ length: 20 }, (_, i) => i + 1);
const FRAMES = Math.round(SECS * 60);
const LIFT = 4, SPREAD = 6, LIMIT = 3;

let bad = 0, worst = null;
for (const seed of SEEDS) {
  L.newLevel(seed);
  const ev = new Map();   // foe -> [{frame,x}]
  for (const f of S.foes) ev.set(f, []);
  const prev = new Map();
  for (let fr = 0; fr < FRAMES; fr++) {
    for (const f of S.foes) prev.set(f, f.y);
    L.step(DT);
    for (const f of S.foes) {
      const dy = f.y - (prev.get(f) ?? f.y);
      if (fr > 5 && dy <= -LIFT && f.vy >= -1) ev.get(f) && ev.get(f).push({ frame: fr, x: f.x, y: f.y });
    }
  }
  for (const [f, list] of ev) {
    for (let i = 0; i + LIMIT - 1 < list.length; i++) {
      const win = list.slice(i, i + LIMIT);
      if (win[LIMIT - 1].frame - win[0].frame > 60) continue;
      const xs = win.map(e => e.x);
      if (Math.max(...xs) - Math.min(...xs) > SPREAD) continue;
      bad++;
      if (!worst) worst = { seed, breed: f.breed, n: win.length, dt: win[LIMIT - 1].frame - win[0].frame, x: Math.round(win[0].x), y: Math.round(win[0].y) };
      break;
    }
  }
}
console.log(`${path.basename(FILE)} · ${SECS} 秒 × ${SEEDS.length} 关`);
console.log(`判据：同一只怪、1 秒内、同处（x 跨度 <${SPREAD}px）上移 ≥${LIFT}px 且未起跳的事件 ≥${LIMIT} 次`);
console.log(bad ? `✗ ${bad} 处反复上移  最狠 ${JSON.stringify(worst)}` : "✓ 没有一只怪在原地反复往上跳");
process.exit(bad ? 1 : 0);
