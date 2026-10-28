/* 第 14 屏「崖坎」的专项验收。
 *
 * ## 这一屏要证明的东西只有三条
 *
 *  ① **地形是实心的**（`kind: "earth"` 一路填到地下）——
 *     不是"悬空的一根圆木 + 一段斜板"。这是用户连否三版的那句
 *     「长坡不自然 / 右边几个横着的是为了设计而设计」的全部技术要求。
 *  ② **一推到底**：从崖顶推出，球自己三级走完、砸穿岩壳、进营地，
 *     中途玩家一次都不用碰。中途要碰，这屏就从"物理"退化成"操作题"。
 *  ③ **岩壳砸穿之后是真的没了**：后续球直接穿过那一层，
 *     而不是"看起来塌了、物理上还在"。
 *
 * 用法：NODE_PATH 指向 workbuddy 的 node workspace（@napi-rs/canvas 在那儿）
 *   node tools/stage-cliff-check.js
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const noop = () => {};

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log("  ✓ " + name + (extra !== undefined ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + (extra !== undefined ? "  [" + extra + "]" : "")); }
};

function boot() {
  const code = fs.readFileSync(path.join(__dirname, "../prototype/grove.html"), "utf8")
    .match(/<script>([\s\S]*)<\/script>/)[1];
  const main = createCanvas(960, 600);
  main.style = {};
  main.addEventListener = noop;
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 600 });
  const mem = {};
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean, isNaN, isFinite, Set, Map, Infinity, NaN,
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    },
    document: {
      getElementById: () => main,
      createElement: () => { const c = createCanvas(1, 1); c.style = {}; c.addEventListener = noop; return c; },
    },
    performance: { now: () => Date.now() },
    addEventListener: noop, innerWidth: 1280, innerHeight: 800,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, {});
  return sb.GROVE;
}

/** 起一局并清场：这一屏的验收全是"球怎么走"，敌人和玩家会干扰 */
function arena() {
  const P = boot();
  const S = P.S;
  const idx = P.LEVELS.findIndex((l) => l.id === "wither_cliff");
  P._start(2, idx);
  S.foes.length = 0;
  S.shocks.length = 0;
  S.foeShots.length = 0;
  S.p.hp = 999;
  S.p.invT = 1e9;
  return { P, S, idx };
}

/** 自己造一颗球（这一屏不靠敌人，敌人的位置会漂） */
function mkBall(S, x, y, vx) {
  const r = 22;
  const b = {
    x, y, w: r * 2, h: r * 2, r, vx, vy: 0, holds: 1, mud: false, air: 1, frost: 0, frostCd: 0,
    onGround: false, ground: null, tour: 0, t: 0, spin: 0, dead: false, boss: false, bossLv: 1,
    packed: [], hitWall: 0, bounceCd: 0, portalCd: 0,
  };
  S.balls.push(b);
  return b;
}

/* ========================================================================== */
console.log("\n[1] 地形：三级实心崖坎 + 一层岩壳");

{
  const { P } = arena();
  const earth = P.PLATS.filter((p) => p.kind === "earth");
  ok(earth.length === 3, "三块实心土石（崖顶 / 中台 / 崖腔石柱）", earth.length + " 块");
  ok(earth.every((p) => p.y + p.h > P.GROUND_Y + 40),
    "每块都**填到地面以下**（不悬空）",
    earth.map((p) => (p.y + p.h - P.GROUND_Y)).join("/") + "px 过地面");
  const shell = P.PLATS.find((p) => p.mat === "shell");
  /* 三级 = 崖顶 234 / 中台 340 / 下台 446。下台那两级里，
     一级是土台、一级是岩壳 —— 所以"三级"要靠 earth + shell 一起数。 */
  const tiers = [...new Set(earth.map((p) => p.y).concat(shell ? [shell.y] : []))].sort((a, b) => a - b);
  ok(tiers.length === 3 && tiers[0] < tiers[1] && tiers[1] < tiers[2],
    "三级高度递增（右高左低）", tiers.join(" < "));
  ok(!!shell, "有岩壳（mat: shell）", shell ? shell.w + " 宽" : "缺");
  ok(shell && shell.w >= 120, "岩壳够宽 —— 它是**一层**，不是一根",
    shell ? shell.w + "px" : "-");
  ok(shell && shell.y + shell.h < P.GROUND_Y - 60,
    "岩壳下面确实是空的（崖腔的高度够人走进去）",
    shell ? (P.GROUND_Y - (shell.y + shell.h)) + "px" : "-");

  const mid = P.PLATS.filter((p) => p.kind === "earth").find((p) => p.y === 340);
  ok(shell && mid && shell.x + shell.w <= mid.x + 2,
    "岩壳不越过中台的立面（越过就是一堵悬在崖腔上的板）",
    shell && mid ? shell.x + shell.w + " / " + mid.x : "-");
}

/* ========================================================================== */
console.log("\n[2] 一推到底：球自己走完三级、砸穿岩壳、进营地");

function roll(P, S, vx0) {
  S.balls.length = 0;
  P.BROKEN.length = 0;
  S.stat.banked = 0;
  S.food = 0;
  const b = mkBall(S, 700, 230, vx0);
  let hitShell = false;
  for (let k = 0; k < 60 * 10; k++) {
    P.tick(1 / 60);
    if (P.BROKEN.length) hitShell = true;
    if (b.dead) break;
  }
  return { b, hitShell, banked: S.stat.banked, broken: P.BROKEN.length, food: S.food };
}

{
  const { P, S } = arena();
  const r = roll(P, S, -620);
  ok(r.b.dead, "球最后消失了（进营地或被收走）", "dead=" + r.b.dead);
  ok(r.banked === 1, "★ 一推到底：球自己进了营地（中途没干预）", "banked=" + r.banked);
  ok(r.hitShell && r.broken === 1, "★ 路上砸穿了岩壳", "broken=" + r.broken);
  ok(r.food > 0, "进营地有收成", "food=" + r.food);
}

/* ========================================================================== */
console.log("\n[3] 岩壳砸穿之后是真的没了");

{
  const { P, S } = arena();
  const first = roll(P, S, -620);
  const broken0 = P.BROKEN.length;
  ok(broken0 === 1, "第一颗球砸穿了一块", "broken=" + broken0);
  S.stat.banked = 0;
  S.balls.length = 0;
  const b2 = mkBall(S, 700, 230, -620);
  for (let k = 0; k < 60 * 10; k++) { P.tick(1 / 60); if (b2.dead) break; }
  ok(P.BROKEN.length === broken0, "第二颗球没有再造出一块碎片（壳是真的没了）",
    "broken=" + P.BROKEN.length);
  ok(S.stat.banked === 1, "第二颗球照样能进营地（破掉的地形不会堵路）",
    "banked=" + S.stat.banked);
  ok(first.banked === 1, "（第一颗也是）", "banked=" + first.banked);
}

/* ========================================================================== */
console.log("\n[4] 岩壳只认砸，不认滚");

{
  const { P, S } = arena();
  S.balls.length = 0;
  P.BROKEN.length = 0;
  /* 贴着壳顶面滚过去（vy≈0）：不该塌。塌了就是"走过去也算砸"。 */
  const b = mkBall(S, 380, 446 - 22, -260);
  b.onGround = true;
  for (let k = 0; k < 60 * 2; k++) P.tick(1 / 60);
  ok(P.BROKEN.length === 0, "慢速滚过去的球**不会**砸塌岩壳（判据是下坠速度）",
    "broken=" + P.BROKEN.length);
}

/* ========================================================================== */
console.log("\n[5] 人的路：三级都能跳上去，但走不进土块里");

{
  const { P, S } = arena();
  const p = S.p;
  const JUMP = 123;
  /* 上行链 = 地面(556) → 崖腔右壁的固定岩台(446) → 中台(340) → 崖顶(234)。
     **不含岩壳**：它会塌，拿它当楼梯等于"砸开之后就上不去了"。 */
  const steps = P.PLATS.filter((q) => (q.kind === "earth" || q.kind === "ledge") && !q.mat)
    .sort((a, b) => b.y - a.y);
  ok(steps.length >= 3, "有三级可站的实心台阶（不含会塌的岩壳）", steps.length + " 级");
  let prev = { y: P.GROUND_Y, x: 120, w: 60 };
  for (const L of steps) {
    ok(prev.y - L.y <= JUMP + 2, "跳得上一级：" + L.y + "（落差 " + (prev.y - L.y) + "）",
      "块宽 " + L.w);
    prev = L;
  }
  p.x = 420; p.y = P.GROUND_Y; p.hp = 999; p.invT = 1e9;
  for (let k = 0; k < 60 * 3; k++) { S.keys.right = true; P.tick(1 / 60); }
  S.keys.right = false;
  ok(p.x < 470, "人走不进中台的土块里（立面是真墙）", "x=" + Math.round(p.x));
  ok(p.y <= P.GROUND_Y + 1, "人没有卡进地形（还在脚下这层地面）", "y=" + Math.round(p.y));
}

/* ========================================================================== */
console.log("\n[6] 木箱：向右推才撞得到，向左推撞不到");

{
  const { P, S } = arena();
  const box = S.loots[0];
  ok(!!box, "崖顶有一只木箱", box ? box.x + "@" + box.y : "缺");

  S.balls.length = 0;
  S.loots.forEach((q) => { q.hp = 1; });
  P.BROKEN.length = 0;
  const l = mkBall(S, 820, 234 - 22, -620);
  for (let k = 0; k < 60 * 3; k++) { P.tick(1 / 60); if (l.dead) break; }
  ok(S.loots[0].hp === 1, "向左推不碰木箱", "hp=" + S.loots[0].hp);

  S.balls.length = 0;
  S.loots.forEach((q) => { q.hp = 1; });
  P.BROKEN.length = 0;
  const rr = mkBall(S, 820, 234 - 22, 620);
  for (let k = 0; k < 60 * 3; k++) { P.tick(1 / 60); if (rr.dead) break; }
  ok(S.loots[0].hp <= 0, "★ 向右推撞碎了木箱", "hp=" + S.loots[0].hp);
}

/* ========================================================================== */
console.log("\n" + (fail === 0 ? "全部通过" : "有 " + fail + " 项失败") + "：" + pass + " 项");
process.exit(fail ? 1 : 0);
