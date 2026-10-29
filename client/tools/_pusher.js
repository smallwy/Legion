/* ===========================================================================
   探针：玩家把球推上土丘（上坡）会发生什么
   ---------------------------------------------------------------------------
   用户 2026-10-29：「主要是球进入了死胡同　比如上坡　完全推不上去了」。

   上一版探针（_ball-slope.js）只给球一个初速，结论是"坡面接得住"。
   可实际情形是**玩家在球后面跟着推**：人站在坡上、球在坡上、两边都在动。
   这一版把玩家也放进来，按 D 一路推上去，逐帧记录人和球的 y ——
   看是"球卡在坡脚"，还是"人上不去"，还是"球被推过头从另一边滚走"。

   跑法：NODE_PATH=... node client/tools/_pusher.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "prototype", "snowlab.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;
const { S, NUM } = L;
const DT = 1 / 60;

/** 找一座"单边坡"（平台旁边那条），低端接地、高端接台面 */
function findRamp(seed) {
  L.reset(seed);
  const out = [];
  for (const pl of S.plats) {
    if (pl.kind !== 'ramp') continue;
    const a = L.surfY(pl, pl.x + 2), b = L.surfY(pl, pl.x + pl.w - 2);
    out.push({ pl, a, b, rise: Math.abs(a - b), upRight: a > b });
  }
  out.sort((x, y) => y.rise - x.rise);
  return out[0];
}

function trial(seed, opts) {
  const g = findRamp(seed);
  if (!g) return null;
  const { pl, upRight } = g;
  /* 清掉坡附近的箱子，只量地形本身 */
  S.boxes.forEach(b => { if (b.x + 60 > pl.x - 260 && b.x < pl.x + pl.w + 320) b.dead = true; });
  /* 低端在左（上坡朝右）：把人放坡脚左侧，球夹在人和坡之间 */
  const footX = upRight ? pl.x - 30 : pl.x + pl.w + 30;
  const dir = upRight ? 1 : -1;
  L.placePlayer(footX, L.groundAt(footX) - 63);
  /* 球放在坡外一点点：放进坡里的话它一开始就"在坡体内部"，
     量到的是探针自己的问题，不是游戏的问题。 */
  const bx0 = footX + dir * 42;
  const by0 = Math.min(L.surfY(pl, bx0), L.groundAt(bx0)) - NUM.ball.baseR;
  const ball = L.spawnBall(bx0, by0, 0, 1);
  S.p.face = dir;
  S.keys = {};
  S.keys[dir > 0 ? 'd' : 'a'] = true;

  const log = [];
  let maxBallX = ball.x;
  for (let i = 0; i < (opts.frames || 240); i++) {
    L.step(DT);
    if (ball.dead) break;
    maxBallX = dir > 0 ? Math.max(maxBallX, ball.x) : Math.min(maxBallX, ball.x);
    if (i % 10 === 0) log.push({
      f: i, px: Math.round(S.p.x), py: Math.round(S.p.y + S.p.h),
      bx: Math.round(ball.x), by: Math.round(ball.y + ball.r), bv: Math.round(ball.vx),
    });
  }
  const adv = (maxBallX - bx0) * dir;
  console.log(`\n种子 ${seed} · 坡 x=${pl.x} w=${pl.w} rise=${pl.rise} · 上坡朝${upRight ? '右' : '左'}`);
  console.log('  球前进 ' + adv + 'px（坡长 ' + pl.w + '）' + (adv >= pl.w - 12 ? '  ✓ 推上去了' : '  ✗ 没上去'));
  console.log('  ' + log.map(t => `${t.f}:人${t.px}/${t.py} 球${t.bx}/${t.by}(v${t.bv})`).join('\n  '));
  return adv;
}

console.log('==== 玩家按 D 把球推上坡 ====');
let ok = 0, n = 0;
for (const seed of [1, 2, 3, 5, 7, 12]) {
  const a = trial(seed, { frames: 240 });
  if (a != null) { n++; if (a >= 100) ok++; }
}
console.log(`\n合计 ${ok}/${n} 座坡把球推上去了`);
