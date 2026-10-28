/* 跳动手感探针 —— 只量"手感有没有坏"，不判玩法对错。

   2026-10-28 第三轮，用户报了两件事：
     「现在跳起来 一起往后走　跳起来有问题」
     「没办法站在球上」

   查下来的根因都不是跳跃本身：
     ① `stepBody` 的扒边会把人**整段横移一个身位**（44px），而且不看方向 ——
        往右跑跳、脚一接近某个台面，人可以被挪到左边。这就是"往后走"。
     ② 球不在 `solids()` 里，"站在球上"这件事从来没实现过。

   这里守三条：
     A. 跑动中单跳 / 二段跳，**任何一帧的横移都不超过 12px**
        （跑速 300px/s = 5px/帧，12 是它的 2.4 倍，留了坡道和推挤的余量）
     B. 球落到地上之后**自己不许抖**（旧版撞箱判据带 6px 容差，
        静止的球以 5 帧为周期上下跳 6.2px，人踩上去跟着抖）
     C. 站在球顶能站稳、能起跳，起跳至少上升 100px

   跑法：
     NODE_PATH=<工具链 node_modules> node tools/_snowlab-jump.js
   依赖 jsdom（不在仓库里，装在 WorkBuddy 工具链目录）。
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const PROTO = process.env.PROTO || path.join(__dirname, "..", "prototype", "snowlab.html");
const html = fs.readFileSync(PROTO, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("找不到 <script>"); process.exit(1); }
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const w = dom.window;
w.HTMLCanvasElement.prototype.getContext = () => null;
w.requestAnimationFrame = () => 0;
w.eval(m[1]);
const L = w.SNOWLAB;
const DT = 1 / 60;

let pass = 0, fail = 0;
const ok = (name, good, extra) => {
  console.log((good ? "  ✓ " : "  ✗ ") + name + (extra ? "：" + extra : ""));
  good ? pass++ : fail++;
};

/* ---------------- A. 跑动中跳跃，不许有横向瞬移 ---------------- */
{
  let bad = 0, worst = 0, worstAt = "";
  for (let sd = 1; sd <= 12; sd++) {
    for (const dir of ["d", "a"]) {
      L.reset(sd);
      const p = L.S.p, keys = L.S.keys;
      for (const k in keys) delete keys[k];
      for (let i = 0; i < 10; i++) L.step(DT);
      keys[dir] = true;
      for (let i = 0; i < 40; i++) L.step(DT);
      keys["w"] = true;
      let prevX = p.x;
      for (let i = 0; i < 70; i++) {
        L.step(DT);
        if (i === 1) delete keys["w"];
        if (i === 16) keys["w"] = true;      // 二段跳
        if (i === 17) delete keys["w"];
        const dx = Math.abs(p.x - prevX);
        if (dx > 12) { bad++; if (dx > worst) { worst = dx; worstAt = "seed" + sd + " " + dir + " f" + i; } }
        prevX = p.x;
      }
    }
  }
  ok("A. 跑动跳跃无横向瞬移（单帧 ≤ 12px）", bad === 0,
    bad === 0 ? "0 次" : bad + " 次，最大 " + worst.toFixed(1) + "px @" + worstAt);
}

/* ---------------- B. 球落地后不许自己抖 ----------------
   **只统计"真的静止"的球**：在坡上的球会顺坡滚（`ball.vx += 420*dt`），
   y 当然一直在变，那不是抖。旧版撞箱判据带 6px 容差，静止的球会以
   5 帧为周期上下跳 6.2px —— 玩家踩上去整个人跟着抖，这是要守的东西。 */
{
  let worstAmp = 0, samples = 0;
  for (const sd of [1, 2, 3]) {
    for (const x of [143, 300, 460, 620, 780]) {
      L.reset(sd);
      const keys = L.S.keys;
      for (const k in keys) delete keys[k];
      for (let i = 0; i < 10; i++) L.step(DT);
      const b = L.spawnBall(x, 200, 0, 2);
      for (let i = 0; i < 60; i++) L.step(DT);
      if (Math.abs(b.vx) > 1) continue;             // 在滚，跳过
      const ys = [];
      let moved = false;
      for (let i = 0; i < 40; i++) {
        L.step(DT);
        ys.push(b.y);
        if (Math.abs(b.vx) > 1) { moved = true; break; }
      }
      if (moved || ys.length < 20) continue;
      samples++;
      worstAmp = Math.max(worstAmp, Math.max(...ys) - Math.min(...ys));
    }
  }
  ok("B. 静止的球不抖（振幅 ≤ 1px）", samples > 0 && worstAmp <= 1,
    samples + " 个静止样本，最大振幅 " + worstAmp.toFixed(2) + "px");
}

/* ---------------- C. 站球顶 / 从球上跳 ----------------
   C2 判的是**起跳有没有真的发生**（vy 打到 -600 以下），不是升了多高 ——
   球顶上方可能就贴着天花板，那种地方本来就跳不高，量高度会误判。 */
{
  let stood = 0, total = 0, jumped = 0, stoodN = 0, riseSum = 0;
  for (const x of [120, 300, 400, 480, 560, 640, 800]) {
    L.reset(2);
    /* **清场再量。** 场上的怪会撞玩家（`hurtPlayer` 给 vy = -320），
       量"起跳有没有发生"时被打一下，读到的 -320 会被当成"没跳"。 */
    L.S.foes.length = 0; L.S.nests.length = 0;
    const p = L.S.p, keys = L.S.keys;
    for (const k in keys) delete keys[k];
    L.placePlayer(x, 120); p.onGround = false;
    for (let i = 0; i < 120; i++) L.step(DT);       // 落到该处地面
    const base = p.y + p.h;
    const b = L.spawnBall(x + p.w / 2, base - 40, 0, 2);
    for (let i = 0; i < 60; i++) L.step(DT);        // 球落地
    L.placePlayer(x, b.y - b.r - p.h - 30); p.onGround = false;   // 从球顶上方落下
    for (let i = 0; i < 50; i++) L.step(DT);
    total++;
    const top = b.y - b.r;
    if (!p.onBall || Math.abs((p.y + p.h) - top) > 2) continue;
    stood++; stoodN++;
    keys["w"] = true; L.step(DT); delete keys["w"];
    /* **看接下来几帧里最小的 vy，不是这一帧。** 球顶上方紧贴天花板时，
       起跳那一帧 vy 已经被撞头清成 0 了 —— 那一帧读到的 0 不代表"没跳"，
       起跳本身是发生了（重力一帧只加 35，清 0 前必须有过 -685）。 */
    let minVy = p.vy;
    for (let i = 0; i < 8; i++) { L.step(DT); minVy = Math.min(minVy, p.vy); }
    if (minVy <= -600) jumped++;
    let hi = p.y + p.h;
    for (let i = 0; i < 45; i++) { L.step(DT); hi = Math.min(hi, p.y + p.h); }
    riseSum += top - hi;
  }
  ok("C1. 能站在球顶", stood >= Math.ceil(total * 0.6),
    stood + "/" + total + "（低矮处头顶塞不下时按设计不接）");
  ok("C2. 从球上按 W 真的起跳（不是被搬走）", stoodN > 0 && jumped === stoodN,
    jumped + "/" + stoodN + "，平均上升 " + (stoodN ? Math.round(riseSum / stoodN) : 0) + "px");
}

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
