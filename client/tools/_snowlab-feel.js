/* ===========================================================================
   snowlab 手感探针（不是断言，是"量数字"）
   ---------------------------------------------------------------------------
   要量三件事，全部真跑 step()：

   ① **跳跃贴着箱墙时会不会被塞进箱子里。**
      用户原话「玩家上移动 会掉入箱子」。判据：身体 AABB 与任意一口活箱的
      重叠深度 > 6px 就算"穿进箱体"—— 站在箱顶时脚底只贴一瞬，不算。

   ② **走路抖不抖。** 每帧记录 onGround 与 y，统计：
      - 落地状态翻转次数（onGround false→true 的次数，走平地上应该接近 0）
      - y 的逐帧跳变里"向上瞬移"的次数（>=3px 的向上修正 = 被顶回去）
      这两项在平地上应该几乎为 0；在斜坡上如果很大，说明下坡时人在弹。

   ③ **球的生命周期。** 裹成球之后，玩家还剩几秒能把球推到目标。
      用户问「成球之后怎么推」，如果 4.6 秒根本来不及，那问题就不在提示。

   跑法：node client/tools/_snowlab-feel.js [种子数]
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");
const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("✗ 找不到内联脚本"); process.exit(1); }

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;
const S = L.S, DT = 1 / 60;
const NSEED = +(process.argv[2] || 12);

function settle(n) { for (let i = 0; i < (n || 40); i++) L.step(DT); }

/** 玩家与任何一口活箱的重叠深度（负值 = 没碰到） */
function boxPenetration(p) {
  let worst = -999, which = null;
  for (const b of S.boxes) {
    if (b.dead) continue;
    const ox = Math.min(p.x + p.w, b.x + b.w) - Math.max(p.x, b.x);
    const oy = Math.min(p.y + p.h, b.y + b.h) - Math.max(p.y, b.y);
    if (ox <= 0 || oy <= 0) continue;
    const d = Math.min(ox, oy);
    if (d > worst) { worst = d; which = b; }
  }
  return { d: worst, box: which };
}

/* =========================================================================
   ① 跳跃贴箱墙
   -------------------------------------------------------------------------
   找每一层"紧贴着一摞箱子"的落脚点：站在箱子左边、身体右缘离箱 2px，
   然后按住 W 起跳、同时按住方向键往箱子里挤 40 帧。
   正常结果：被墙挡住，人留在原高度附近；坏结果：被吸到箱顶或被塞进箱体。
   ========================================================================= */
console.log("① 跳跃贴箱墙（每关取 6 处箱墙）");
let jumpCases = 0, jumpBad = 0, jumpWorst = 0, jumpUp = 0;
for (let s = 0; s < NSEED; s++) {
  L.reset(1000 + s * 37);
  settle(30);
  const p = S.p;
  let tried = 0;
  for (const b of S.boxes) {
    if (tried >= 6) break;
    if (b.dead) continue;
    if (b.y + b.h < 0) continue;
    // 只挑"箱子本身站在地面上、左边有空"的
    const floor = L.groundAt(b.x + b.w / 2, b.y + b.h + 4);
    if (Math.abs(floor - (b.y + b.h)) > 3) continue;
    const standX = b.x - p.w - 2;
    if (standX < 50) continue;
    // 站的位置必须是空的
    const probe = { x: standX, y: b.y + b.h - p.h, w: p.w, h: p.h };
    if (boxPenetration(probe).d > 0) continue;
    tried++;
    jumpCases++;
    L.placePlayer(standX, b.y + b.h - p.h);
    S.hp = 999; S.invuln = 999;
    let worst = 0, maxUp = 0, y0 = p.y;
    for (let f = 0; f < 40; f++) {
      S.keys = { w: true, d: true };
      L.step(DT);
      S.invuln = 999;
      const pen = boxPenetration(p);
      if (pen.d > worst) worst = pen.d;
      if (f > 2 && y0 - p.y > maxUp) maxUp = y0 - p.y;
    }
    S.keys = {};
    if (worst > jumpWorst) jumpWorst = worst;
    if (maxUp > 40) jumpUp++;
    if (worst > 6) {
      jumpBad++;
      if (jumpBad <= 4) console.log("   种子 " + (1000 + s * 37) + " 箱@x=" + b.x.toFixed(0) + " 穿入 " + worst.toFixed(1) + "px  人最终 y=" + p.y.toFixed(0) + " 箱顶=" + b.y.toFixed(0));
    }
  }
}
console.log("   样本 " + jumpCases + "，穿入>6px 的 " + jumpBad + " 次，最深 " + jumpWorst.toFixed(1) + "px，" +
  "被\"吸上箱顶\"(上升>40px) " + jumpUp + " 次");

/* =========================================================================
   ② 抖动
   ========================================================================= */
console.log("\n② 抖动（平地 / 斜坡 / 箱顶 各走 60 帧）");
function walkProbe(label, x0, y0, dir, frames) {
  L.placePlayer(x0, y0);
  S.hp = 999; S.invuln = 999;
  let flips = 0, lastG = S.p.onGround, upJerk = 0, dySum = 0, n = 0;
  let prevY = S.p.y;
  for (let f = 0; f < frames; f++) {
    S.keys = dir > 0 ? { d: true } : { a: true };
    L.step(DT);
    S.invuln = 999;
    const p = S.p;
    if (p.onGround && !lastG) flips++;
    lastG = p.onGround;
    const dy = p.y - prevY;
    if (dy < -3) upJerk++;
    dySum += Math.abs(dy); n++;
    prevY = p.y;
  }
  S.keys = {};
  console.log("   " + label.padEnd(16) + " 落地翻转 " + String(flips).padStart(3) +
    "  向上瞬移 " + String(upJerk).padStart(3) + "  平均|dy| " + (dySum / n).toFixed(2) + "px");
}

for (let s = 0; s < Math.min(4, NSEED); s++) {
  L.reset(1000 + s * 37);
  settle(30);
  const p = S.p;
  // 平地：第一层地板段上走
  const seg = S.plats.filter(pl => pl.kind !== 'ramp' && pl.w >= 200 && pl.y === L.FLOORS[0])[0];
  if (seg) walkProbe("平地#" + s, seg.x + 40, seg.y - p.h, 1, 60);
  // 斜坡：本层任意一条坡，从低端往高端走
  const rp = S.plats.filter(pl => pl.kind === 'ramp' && pl.rise > 0)[0] ||
             S.plats.filter(pl => pl.kind === 'ramp' && pl.rise < 0)[0];
  if (rp) {
    /* **起点必须站在坡面上**，不能拿"坡的最高点"当所有起点的 y ——
       那样人会先自由落体一段再走上坡，把"落地翻转"记到自己头上。
       第一版就是这么错量的，白读了一次数据。 */
    const lowLeft = rp.rise > 0;
    const sx = lowLeft ? rp.x + 6 : rp.x + rp.w - 6 - p.w;
    walkProbe("上坡#" + s, sx, L.surfY(rp, sx + p.w / 2) - p.h, lowLeft ? 1 : -1, 60);
    const sx2 = lowLeft ? rp.x + rp.w - 6 - p.w : rp.x + 6;
    walkProbe("下坡#" + s, sx2, L.surfY(rp, sx2 + p.w / 2) - p.h, lowLeft ? -1 : 1, 60);
  }
}

/* =========================================================================
   ③ 球：裹成球之后还剩多少操作时间
   ========================================================================= */
console.log("\n③ 球的生命与推力");
L.reset(1000); settle(30);
const b0 = L.spawnBall(S.p.x + 120, L.FLOORS[0] - 22, 0, 1);
let t = 0;
while (!b0.dead && t < 20) { L.step(DT); t += DT; }
console.log("   静止球存活 " + t.toFixed(2) + "s  (NUM.ball.life = " + L.NUM.ball.life + "s)");
console.log("   推一次给的速度 pow = " + L.NUM.push.base + " × (1 + " + L.NUM.push.runGain + " × runUp)");
console.log("   球摩擦 " + L.NUM.ball.fric + "px/s² → 从满速滚到 60（碾敌下限）需要 " +
  (L.NUM.push.base / L.NUM.ball.fric).toFixed(2) + "s，滚出距离 ≈ " +
  Math.round(Math.pow(L.NUM.push.base, 2) / (2 * L.NUM.ball.fric)) + "px");

console.log("\n（探针到此为止）");
