/* ============================================================================
   _stone-check.js —— 「石球」行为验证（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   为什么必须单独验：改成石球之后 `grove-smoke` **全绿**，但绿只证明
   "没有副作用"，不证明"机制真的发生了"。这个项目最贵的一类 bug
   就是"测试测了空集"——断言写得很像，实际一次都没跑到。

   这里逐帧跑，把四件事量出来：
     1. 球被推出去之后，到底会不会硬化？（实测多少秒、停在离墙多远）
     2. `wallHits >= 3 就地爆球` 这条闸会不会在硬化之前就把球打死？
     3. 玩家能不能真的踩上去（`p.ground.kind === "ball"`）？
     4. 超过 STONE_MAX 时，爆的是最老那颗、而且里面的人被吐回场上？

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_stone-check.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const noop = () => {};

function boot() {
  const code = fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
  const main = createCanvas(W, H);
  main.style = {};
  main.addEventListener = noop;
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
  const mem = {};
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN,
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    },
    document: {
      getElementById: () => main,
      createElement: () => {
        const c = createCanvas(1, 1);
        c.style = {};
        c.addEventListener = noop;
        return c;
      },
    },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return { P: sb.GROVE, canvas: main };
}

let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; console.log("  ✓ " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  [" + extra + "]" : "")); }
};

console.log("\n=== 石球行为验证 ===");

/* ---------- 1a. 自动通路：球在墙边真的停下来（位移不变）就硬化 ---------- */
console.log("\n[1a] 自动硬化（球在墙边真的停住）");
{
  const { P } = boot();
  P._start(0);
  const S = P.S;
  S.foes.length = 0; S.texts.length = 0;
  P.CHASMS.length = 0;
  S.p.x = 100; S.p.y = P.GROUND_Y;

  const f = P.foeFromSpec({ foe: "bug", x: 700, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  const wallR = P.WALL_R || 934;
  b.x = wallR - b.r - 2; b.y = P.GROUND_Y;
  b.vx = 0; b.vy = 0;
  b.pushed = true;
  b.onGround = true;

  let t = 0, hardAt = -1;
  for (let i = 0; i < 120; i++) {
    P.tick(1 / 60);
    t += 1 / 60;
    if (b.stone) { hardAt = t; break; }
  }
  ok(hardAt > 0, "贴墙停住的球会自动硬化", hardAt > 0 ? hardAt.toFixed(2) + "s" : "从未硬化");
  ok(hardAt > 0 && hardAt >= P.STONE_HOLD - 0.05 && hardAt < P.STONE_HOLD + 0.3,
    "硬化时间 ≈ STONE_HOLD(" + P.STONE_HOLD + "s)", hardAt.toFixed(2) + "s");
}

/* ---------- 1b. 主动通路：按 ↓ 压住 ---------- */
console.log("\n[1b] 按 ↓ 主动定住");
{
  const { P } = boot();
  P._start(0);
  const S = P.S;
  S.foes.length = 0; S.texts.length = 0;
  P.CHASMS.length = 0;

  const f = P.foeFromSpec({ foe: "bug", x: 500, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = 480; b.y = P.GROUND_Y;
  b.vx = 0; b.vy = 0;
  b.pushed = true; b.onGround = true;

  const p = S.p;
  p.x = b.x - b.r - p.w / 2 - 1;
  p.y = P.GROUND_Y;
  p.onGround = true; p.face = 1;
  p.runD = 0;

  S.keys.down = true;
  P.tick(1 / 60);
  ok(b.stone, "按住 ↓ 贴着球 → 立刻变石球（不用等 0.5 秒）");
  S.keys.down = false;
}

/* ---------- 2. 石球不漏气、不会自己崩 ---------- */
console.log("\n[2] 石球不漏气");
{
  const { P } = boot();
  P._start(0);
  const S = P.S;
  S.foes.length = 0; S.texts.length = 0;
  const f = P.foeFromSpec({ foe: "bug", x: 500, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = 300; b.y = P.GROUND_Y - b.r;
  b.air = 0.5;
  P.hardenBall(b);
  const air0 = b.air;
  for (let i = 0; i < 60 * 20; i++) P.tick(1 / 60);
  ok(!b.dead, "20 秒后石球还在（不被 air 崩、不被 b.t>45 兜底）");
  ok(Math.abs(b.air - air0) < 1e-6, "石球不漏气", air0.toFixed(2) + " → " + b.air.toFixed(2));
}

/* ---------- 3. 玩家能踩上去 ---------- */
console.log("\n[3] 玩家能踩上去");
{
  const { P } = boot();
  P._start(0);
  const S = P.S;
  S.foes.length = 0; S.texts.length = 0;
  const f = P.foeFromSpec({ foe: "bug", x: 500, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = 480; b.y = P.GROUND_Y - b.r - 0.5;
  P.hardenBall(b);

  const p = S.p;
  p.x = 480;
  p.y = b.y - b.r - 30;       // 从球顶上方落下
  p.vx = 0; p.vy = 0;
  p.onGround = false; p.ground = null;

  let landed = false, standY = -1;
  for (let i = 0; i < 90; i++) {
    P.tick(1 / 60);
    if (p.onGround && p.ground && p.ground.kind === "ball") { landed = true; standY = p.y; break; }
  }
  ok(landed, "玩家落在石球顶面上",
    landed ? "y=" + p.y.toFixed(1) + " 球顶=" + (b.y - b.r).toFixed(1) : "没站住");
  ok(landed && Math.abs(p.y - (b.y - b.r)) < 6, "站的高度就是球顶（没陷进去、没悬空）",
    landed ? "差 " + (p.y - (b.y - b.r)).toFixed(1) + "px" : "");

  /* 站在球上不许把它推走 */
  const bx0 = b.x;
  for (let i = 0; i < 30; i++) P.tick(1 / 60);
  ok(Math.abs(b.x - bx0) < 1 && b.stone, "站在球上不会把它推走", "Δx=" + (b.x - bx0).toFixed(2));
}

/* ---------- 4. 推一下就活过来 ---------- */
console.log("\n[4] 推一下就活过来");
{
  const { P } = boot();
  P._start(0);
  const S = P.S;
  S.foes.length = 0; S.texts.length = 0;
  const f = P.foeFromSpec({ foe: "bug", x: 500, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = 480; b.y = P.GROUND_Y - b.r;
  b.air = 0.42;
  P.hardenBall(b);
  const air0 = b.air;

  const p = S.p;
  p.x = b.x - b.r - p.w / 2 - 1;    // 贴左侧站着
  p.y = P.GROUND_Y;
  p.onGround = true;
  p.face = 1;
  /* 手动模拟一次推球（`S.press` 不驱动推球，推球是"贴近就推"） */
  P.tick(1 / 60);
  ok(!b.stone, "被推之后不再是石球");
  ok(b.vx > 0, "被推之后开始滚动", "vx=" + b.vx.toFixed(0));
  /* 断言不能写"完全不变"：推起来之后它就在漏气了（这正是设计）。
     要验的是**不回气** —— `air` 只许往下走。 */
  ok(b.air <= air0 + 1e-6, "推起来**不回气**（否则石球会变成刷气手段）",
    air0.toFixed(2) + " → " + b.air.toFixed(4));
}

/* ---------- 5. 超上限：爆最老那颗，人不凭空消失 ---------- */
console.log("\n[5] 超过 2 颗上限");
{
  const { P } = boot();
  P._start(0);
  const S = P.S;
  S.foes.length = 0; S.texts.length = 0;
  const made = [];
  for (let i = 0; i < 3; i++) {
    const f = P.foeFromSpec({ foe: "bug", x: 300 + i * 150, y: P.GROUND_Y, lv: 1 }, false);
    P.makeBallFrom(f, 0, 0);
    const b = S.balls[S.balls.length - 1];
    b.x = 300 + i * 150; b.y = P.GROUND_Y - b.r;
    made.push(b);
  }
  const foes0 = S.foes.length;
  for (const b of made) P.hardenBall(b);
  const alive = S.balls.filter(x => x.stone && !x.dead);
  ok(alive.length === P.STONE_MAX, "同时最多 " + P.STONE_MAX + " 颗石球",
    alive.length + " 颗");
  ok(made[0].dead, "爆的是**最老**那颗（不是刚摆好的）", "第 1 颗 dead=" + made[0].dead);
  ok(S.foes.length > foes0, "里面的人被吐回场上（没有凭空消失）",
    foes0 + " → " + S.foes.length);
}

console.log("\n" + (fail === 0 ? "全部通过：" + pass + " 项" : "通过 " + pass + " · 失败 " + fail));
process.exit(fail === 0 ? 0 : 1);
