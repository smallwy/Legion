/* ===========================================================================
   探针：球能不能被推上斜坡
   ---------------------------------------------------------------------------
   用户 2026-10-29：「主要是球进入了死胡同　比如上坡　完全推不上去了」。

   这句话不像是"数值不够"（推球力度 620，坡上反向加速度 420，理论爬得动），
   更像"球从坡面穿下去了"。斜坡的碰撞只有一条"从上方来"的判据
   （`prevBottom <= top + 16`），而球上坡时**没有任何东西把它抬起来** ——
   它靠的是"这一帧水平走了 dx，坡面高了 dx×坡度，只要这个落差不超过 16
   就算接住"。dx 一大（助跑推 1209 px/s，60fps 一帧 20px，落差 15.9px；
   30fps 一帧 40px，落差 31.7px）就接不住，球直接穿过坡面掉到坡体内部，
   之后再也不会被坡面接住 —— 这就是"完全推不上去"。

   本脚本只量数字，不判 pass/fail：打印每一帧的「球底 / 坡面 / 差」，
   并统计三种结局（爬上去了 / 停在坡上 / 穿下去了）。

   跑法：NODE_PATH=... node client/tools/_ball-slope.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;
const { S, NUM } = L;

/** 找到一关里"能从平地走上去"的坡：低端接本层地板。 */
function pickRamp(seed) {
  L.reset(seed);
  for (const pl of S.plats) {
    if (pl.kind !== 'ramp') continue;
    const a = L.surfY(pl, pl.x + 2), b = L.surfY(pl, pl.x + pl.w - 2);
    const low = Math.min(a, b), high = Math.max(a, b);
    if (high - low < 30) continue;         // 太平的坡没意义
    return { pl, low, high, lowAtLeft: a < b };
  }
  return null;
}

function run(seed, vx0, dt, label) {
  const got = pickRamp(seed);
  if (!got) return null;
  const { pl, lowAtLeft, low, high } = got;
  /* 把坡旁边的箱子清掉，只留地形本身 —— 这一枪只量"坡面接不接球" */
  S.boxes.forEach(b => { if (b.x + 60 > pl.x - 200 && b.x < pl.x + pl.w + 260) b.dead = true; });
  /* 从低端内侧起步，朝高端推 */
  const startX = lowAtLeft ? pl.x + 6 : pl.x + pl.w - 6;
  const dir = lowAtLeft ? 1 : -1;
  const b = L.spawnBall(startX, L.surfY(pl, startX) - NUM.ball.baseR, dir * vx0, 1);
  const trace = [];
  let worst = 0, ended = '?';
  for (let i = 0; i < 120; i++) {
    L.step(dt);
    const top = L.surfY(pl, b.x);
    const under = b.y + b.r - top;          // >0 = 球底在坡面以下（陷进去了）
    trace.push({ x: +b.x.toFixed(1), bot: +(b.y + b.r).toFixed(1), top: +top.toFixed(1), under: +under.toFixed(1) });
    if (b.x + b.r > pl.x && b.x - b.r < pl.x + pl.w) worst = Math.max(worst, under);
    if (b.x + b.r > pl.x && b.x - b.r < pl.x + pl.w && Math.abs(b.vx) < 6) {
      /* 停住了：停在坡底/坡面/坡顶？ */
      const rel = (b.x - pl.x) / pl.w;
      ended = rel < 0.12 ? '停在坡底' : rel > 0.88 ? '爬上去了' : '停在坡中段';
      break;
    }
  }
  if (ended === '?') ended = '没停（跑出坡段）';
  console.log(`\n[${label}] 种子 ${seed} · 坡 x=${pl.x} w=${pl.w} rise=${pl.rise} · 初速 ${vx0} · dt=${dt.toFixed(4)}`);
  console.log('  终局：' + ended + ' · 最深处球底低于坡面 ' + worst.toFixed(1) + 'px');
  /* 只打印有代表性的几帧：进入坡段后每 4 帧一次 */
  const inside = trace.filter(t => t.under !== 0 || t.x > pl.x);
  const show = trace.filter((t, i) => i % 6 === 0);
  console.log('  帧采样：' + show.map(t => `${t.x}/${t.under}`).join('  '));
  return { ended, worst };
}

console.log('==== 现状测量：球被推上斜坡 ====');
for (const [vx, dt] of [[620, 1 / 60], [1209, 1 / 60], [620, 1 / 30], [1209, 1 / 30]]) {
  for (const seed of [1, 2, 3]) {
    run(seed, vx, dt, 'push');
  }
}
