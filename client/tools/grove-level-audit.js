/* ============================================================================
   grove-level-audit.js —— 27 屏关卡的**几何体检表**

   为什么单独写一个：`grove-smoke.js` 第 11 节已经把这几条不变量写成断言了，
   但它一次性跑完全部 800+ 项，19 屏 × 9 条 = 171 条失败混在中间，
   看不出"哪一屏缺什么"。改一屏要跑一次全覆盖，反馈太慢。

   这个脚本只跑"关卡几何"这一类，一屏一行，缺什么直接标出来。
   断言口径与 smoke 第 11 节**逐字一致**（不复刻公式就会漂移成两套标准）。

   用法：
     node client/tools/grove-level-audit.js           # 表格
     node client/tools/grove-level-audit.js 12        # 只看第 12 屏的细节
   ========================================================================== */

const path = require("path");
const { boot } = require("./grove-env.js");

/* ---------- 几何工具（与 smoke 第 11 节同一套） ---------- */
function gapsAt(P, y) {
  const segs = P.PLATS.filter(q => q.kind !== "ground" && Math.abs(q.y - y) < 8)
    .sort((a, b) => a.x - b.x);
  const out = [];
  const push = (l, r) => { if (r > l) out.push({ l, r, w: r - l, x: (l + r) / 2 }); };
  if (!segs.length) { push(P.WALL_L, P.WALL_R); return out; }
  push(P.WALL_L, segs[0].x);
  for (let i = 1; i < segs.length; i++) push(segs[i - 1].x + segs[i - 1].w, segs[i].x);
  push(segs[segs.length - 1].x + segs[segs.length - 1].w, P.WALL_R);
  return out;
}

/* 取**最宽**的那一段，不是第一个交集 —— 口径与 grove-smoke.js 完全一致。
   球走的是最宽那条通道，测试也该按最宽那条判。 */
function shaftOf(P, ya, yb) {
  let best = null;
  for (const a of gapsAt(P, ya)) {
    for (const b of gapsAt(P, yb)) {
      const l = Math.max(a.l, b.l), r = Math.min(a.r, b.r);
      if (r > l && (!best || r - l > best.w)) best = { l, r, w: r - l, x: (l + r) / 2 };
    }
  }
  return best;
}

function seed(S) {
  // 只清这几个 —— 别的字段名不一定存在，写错一个就是整个脚本挂掉
  S.foes.length = 0; S.balls.length = 0; S.shots.length = 0;
  S.drops.length = 0;
}

/* ---------- 单屏体检 ---------- */
function audit(i) {
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, i);
  const R = P.curStage();
  const bad = [];

  // 1) 地面 / 营地
  if (!P.PLATS.some(p => p.kind === "ground")) bad.push("无地面");
  if (!(P.CAMP && P.CAMP.w > 0)) bad.push("无营地");

  // 2) 坑的种类。教学关与缓坡例外——它们本来就只有一种坑。
  const kinds = new Set(P.PITS.map(p => p.kind));
  if (!kinds.has("fire")) bad.push("无火坑");
  if (!kinds.has("mud")) bad.push("无泥坑");

  // 3) 木桩：教学关与缓坡不放
  if (R.id !== "entry" && R.id !== "slope" && S.stumps.length === 0) bad.push("无木桩");

  // 4) 竖井：350 → 462 必须有一段两层都通的缺口，宽 ≥ 55（球径 48 + 余量）
  const shaft = shaftOf(P, 350, 462);
  if (!shaft) bad.push("两层缺口无交集");
  else if (shaft.w < 55) bad.push("竖井窄 w=" + shaft.w.toFixed(0));

  // 5) 桩不能站坑里、不能挡竖井落点
  for (const s of S.stumps) {
    const sl = s.x - s.w / 2, sr = s.x + s.w / 2;
    for (const pit of P.PITS) {
      if (!(sr <= pit.x || sl >= pit.x + pit.w))
        bad.push("桩进坑(" + pit.kind + " " + pit.x + ".." + (pit.x + pit.w) + ")");
    }
    if (shaft) {
      const lo = shaft.l + 24, hi = shaft.r - 24;
      if (!(hi <= sl || lo >= sr))
        bad.push("桩挡井(落点 " + lo.toFixed(0) + ".." + hi.toFixed(0) + ")");
    }
  }

  // 6) 球从 350 丢进竖井，必须真能落到地面（y ≥ 550）
  if (shaft) {
    const f = S.foes[0];
    if (f) P.coatFoe(f, 3);
    const b = S.balls[0];
    if (b) {
      b.x = shaft.x; b.y = 350; b.vx = 0; b.vy = 0; b.onGround = false;
      if (S.p) { S.p.x = P.WALL_R - 40; S.p.vx = 0; }
      let low = b.y;
      for (let k = 0; k < 60 * 4; k++) { P.tick(1 / 60); if (b.dead) break; low = Math.max(low, b.y); }
      if (!(b.dead || low >= 550)) bad.push("球落不到地(最低 y=" + low.toFixed(0) + ")");
    }
  }

  // 7) 营地必须推得到（枚举全图站位 × 左右两个方向）
  {
    const hp0 = S.stumps.map(s => s.hp);
    for (const s of S.stumps) s.hp = 0;
    let hit = null;
    // 地面这一层必须算：没有坡的关里，"走到地上把球往里推"是主路线。
    for (const y of [P.GROUND_Y, 248, 350, 462]) {
      if (hit) break;
      for (let x = P.WALL_L + 20; x <= P.WALL_R - 20 && !hit; x += 6) {
        const onIt = P.PLATS.some(q => Math.abs(q.y - y) < 4 && x > q.x && x < q.x + q.w);
        if (!onIt) continue;
        for (const dir of [-1, 1]) {
          const bb = { x, y, vx: 0, vy: 0, r: 24, onGround: true, holds: 0, packed: [], mud: false, air: 1, dead: false };
          S.balls.push(bb);
          const pr = P.predictBall(bb, dir);
          S.balls.pop();
          if (pr.end === "camp") { hit = { x, y, dir }; break; }
        }
      }
    }
    S.stumps.forEach((s, k) => { s.hp = hp0[k]; });
    if (!hit) bad.push("营地推不到");
  }

  // 8) 出生点落在坑里 —— 算 ⚠ 警告，不判死。
  //    坑只对**球**是危险，人踩的是实地，所以 BOSS 站在泥塘正中不算画错。
  //    但它会变成"球滚过去先掉坑、人还在坑里站着"—— `clear` 关的 BOSS
  //    一旦站进坑里，就等于对球免疫（第 9 / 27 屏实测 240 秒打不掉）。
  //    第 2 屏（雪原，原有）的 BOSS 站水塘，是刻意的"从水里爬出来"，所以只报不拦。
  const warn = [];
  {
    const spawns = [];
    for (let w = 0; w < R.waves.length; w++) {
      for (const sp of R.waves[w]) spawns.push({ w: w + 1, f: sp });
    }
    for (const s of spawns) {
      if (s.f.y !== P.GROUND_Y) continue;            // 只查地面层的
      for (const pit of P.PITS) {
        if (s.f.x > pit.x - 12 && s.f.x < pit.x + pit.w + 12)
          warn.push("第" + s.w + "波" + (s.f.foe === "boss" ? "BOSS" : s.f.foe) + "@" + s.f.x + "站" + pit.kind + "坑");
      }
    }
  }

  return {
    i, id: R.id, name: R.name, theme: R.theme, goal: R.goal,
    pits: P.PITS.map(p => p.kind[0] + p.w).join("/"),
    nStump: S.stumps.length,
    shaft: shaft ? shaft.w.toFixed(0) : "-",
    camp: P.CAMP ? P.CAMP.x + ".." + (P.CAMP.x + P.CAMP.w) : "-",
    bad, warn,
  };
}

/* ---------- 爬升探针 ----------
   这一条是被第 9 屏逼出来的：那一屏 462 台面从 26 一直铺到 420，
   玩家出生在 80（正好在台子底下），起跳就顶到台底；而敌人全在 350/462 上。
   机器人在原地造了 173 颗球，一颗都推不出去 —— **整屏没有一个能上去的位置**。

   原来的 8 屏都靠"坡"或者"台子边上留一块空地"上二层，27 屏里 17 屏没有坡，
   于是这个洞被放大成一片。判据必须是**跑出来的**，不能靠看坐标：
     在地面上逐点摆人 → 按住方向 + 跳 → 看有没有一次真的站上了浮空台。
   -------------------------------------------------------------------------- */
function canClimb(i) {
  const spots = [];
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  const STEP = 8;
  for (let x = 40; x <= 920; x += STEP) {
    for (const dir of [-1, 1]) {
      seed(S);
      P._start(0, i);
      S.foes.length = 0;                     // 只看地形，敌人会把人撞下来
      S.p.x = x; S.p.y = P.GROUND_Y;
      S.p.vx = 0; S.p.vy = 0; S.p.onGround = true;
      S.keys.left = dir < 0; S.keys.right = dir > 0; S.keys.down = false;
      let jumped = false, landed = null;
      for (let k = 0; k < 110; k++) {
        // 每 20 帧补一次跳：起跳要在"已经贴着台沿"的那一刻，不能只在第 0 帧
        if (!jumped && k % 20 === 0 && S.p.onGround) S.press.jump = true;
        P.tick(1 / 60);
        if (!S.p.onGround && S.p.vy < 0) jumped = true;
        if (jumped && S.p.onGround && S.p.ground && S.p.ground.kind !== "ground") {
          landed = S.p.ground;
          break;
        }
      }
      S.keys.left = S.keys.right = false;
      if (landed) spots.push({ x, dir, y: landed.y });
    }
  }
  return spots;
}

const only = process.argv[2] ? parseInt(process.argv[2], 10) - 1 : -1;
const n = boot().GROVE.LEVELS.length;
let total = 0;

/* 明细模式：`node grove-level-audit.js 12` 把第 12 屏的每条边都打出来。
   改坐标时靠这个对账 —— 光看"井窄 40"不知道往哪边让。 */
function detail(i) {
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, i);
  const R = P.curStage();
  console.log("\n=== 第 " + (i + 1) + " 屏 · " + R.name + "（" + R.id + "）· 主题 " + R.theme + " · 目标 " + R.goal + " ===");
  console.log("墙 WALL_L=" + P.WALL_L + " WALL_R=" + P.WALL_R + " GROUND_Y=" + P.GROUND_Y);
  for (const y of [248, 350, 462]) {
    const segs = P.PLATS.filter(q => q.kind !== "ground" && Math.abs(q.y - y) < 8)
      .sort((a, b) => a.x - b.x);
    console.log("  y=" + y + " 台面：" + (segs.length
      ? segs.map(q => q.x + ".." + (q.x + q.w)).join("  ")
      : "（无）"));
    console.log("        缺口：" + gapsAt(P, y).map(g => g.l + ".." + g.r + "(w" + g.w + ")").join("  "));
  }
  const sh = shaftOf(P, 350, 462);
  console.log("  竖井：" + (sh ? sh.l.toFixed(0) + ".." + sh.r.toFixed(0) + " w=" + sh.w.toFixed(0) : "无交集"));
  console.log("  坑：" + P.PITS.map(p => p.kind + " " + p.x + ".." + (p.x + p.w)).join("  "));
  console.log("  桩：" + (S.stumps.length
    ? S.stumps.map(s => "x" + s.x + " w" + s.w + " y" + s.y + " → " + (s.x - s.w / 2) + ".." + (s.x + s.w / 2)).join("  ")
    : "（无）"));
  console.log("  营地：" + (P.CAMP ? P.CAMP.x + ".." + (P.CAMP.x + P.CAMP.w) : "-"));
  console.log("  坡：" + (P.RAMPS.length
    ? P.RAMPS.map(r => r.x + ".." + (r.x + r.w) + " " + r.yL + "→" + r.yR).join("  ")
    : "（无）"));
  console.log("  出生：" + (R.spawn ? R.spawn.x + "," + R.spawn.y : "-"));
  console.log("  波次：" + R.waves.map(w => w.length).join(" / ") + "（共 " + R.waves.reduce((a, w) => a + w.length, 0) + "）");
}

if (only >= 0) { detail(only); process.exit(0); }

console.log("\n#  屏名              主题    目标      坑(宽)              桩  井  问题");
console.log("─".repeat(96));
for (let i = 0; i < n; i++) {
  if (only >= 0 && i !== only) continue;
  const r = audit(i);
  total += r.bad.length;
  console.log(
    String(r.i + 1).padStart(2) + " " +
    r.name.padEnd(10, "　").slice(0, 10) + " " +
    String(r.theme).padEnd(7) + " " +
    String(r.goal).padEnd(8) + " " +
    r.pits.padEnd(19) + " " +
    String(r.nStump).padStart(2) + "  " +
    String(r.shaft).padStart(3) + " " +
    (r.bad.length ? "✗ " + r.bad.join(" · ")
      : r.warn.length ? "✓ ⚠ " + r.warn.join(" · ") : "✓")
  );
}
console.log("─".repeat(96));
console.log(total ? "共 " + total + " 处问题" : "全部通过（" + n + " 屏）");
process.exit(total ? 1 : 0);
