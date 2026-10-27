/* ============================================================================
   _slam-check.js —— 「层间开口 + 下坠碾怪」行为验证（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   为什么必须单独验：这一套改动里，`grove-smoke` 全绿只能证明"没有副作用"，
   不能证明"球真的掉进去了""人真的被压死了"。这个项目最贵的一类 bug
   就是"测试测了空集"—— 断言写得很像，实际一次都没跑到。

   这里逐帧跑，把五件事量出来：
     1. `holes` 声明之后，台面真的被切开了（不是只写在数据里）
     2. 球真的会掉进洞，而且落点是**弹道算出来的**（不是固定值）
     3. 掉下来的球真的压死人（killed / food 都涨）
     4. 平地滚动的球不会误触发碾压（否则整局都在"碾"）
     5. `SLAM_CAP` 真的挡得住"一球压平井底"

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_slam-check.js
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

/* 带洞的那一屏 = 第 15 屏「弹菇田」（0-based 14） */
const SHROOM = 14;

/** 干净的测试场：清掉敌人/球/裂缝，玩家挪远，避免被"推球/送走"干扰 */
function arena(P, idx) {
  P._start(2, idx);
  const S = P.S;
  S.foes.length = 0;
  S.balls.length = 0;
  S.texts.length = 0;
  S.frags.length = 0;
  P.CHASMS.length = 0;          // 否则球滚进营地会被正常送走，测不到碾
  S.p.x = 60; S.p.y = P.GROUND_Y; S.p.dead = false;
  return S;
}

console.log("\n=== 层间开口 + 下坠碾怪 ===");

/* ---------- 1. 洞真的把台面切开了 ---------- */
console.log("\n[1] 切割：声明式 holes 真的改到了 PLATS");
{
  const { P } = boot();
  arena(P, SHROOM);
  const holes = P.HOLES;
  ok(holes.length >= 1, "这一屏有洞", holes.length + " 个");
  const h = holes[0];
  const l = h.x - h.w / 2, r = h.x + h.w / 2;
  /* 洞口范围内**不能有任何浮空台**（地面除外） */
  const blocked = P.PLATS.filter(p => p.kind !== "ground" &&
    p.y === h.y && !(p.x + p.w <= l || p.x >= r));
  ok(blocked.length === 0, "洞口那一段没有台面横跨", blocked.length + " 块挡着");
  /* 洞的两侧都要有台面（否则不是"开洞"，是"台面本来就这么短"） */
  const left = P.PLATS.find(p => p.kind !== "ground" && p.y === h.y && Math.abs(p.x + p.w - l) < 1);
  const right = P.PLATS.find(p => p.kind !== "ground" && p.y === h.y && Math.abs(p.x - r) < 1);
  ok(!!left, "洞口左侧接着一段台面", left ? (left.x | 0) + ".." + ((left.x + left.w) | 0) : "无");
  ok(!!right, "洞口右侧接着一段台面", right ? (right.x | 0) + ".." + ((right.x + right.w) | 0) : "无");
  ok(left && left.w >= P.HOLE_MIN_SEG && right && right.w >= P.HOLE_MIN_SEG,
    "两侧碎段都够长（≥ HOLE_MIN_SEG " + P.HOLE_MIN_SEG + "）",
    (left | 0) && (left.w | 0) + " / " + (right | 0) && (right.w | 0));
  /* 地面绝不能切 */
  const g = P.PLATS.filter(p => p.kind === "ground");
  ok(g.length === 1 && g[0].w === P.WALL_R - P.WALL_L, "地面没被切开",
    g.length + " 块 / 宽 " + (g[0] ? g[0].w : "-"));
}

/* ---------- 2. 所有关卡的洞都满足几何下限 ---------- */
console.log("\n[2] 全部关卡的洞：宽度够球穿过、不凿地面");
{
  const { P } = boot();
  let worst = 1e9, bad = [];
  const LEVELS = P.LEVELS || [];
  for (let i = 0; i < LEVELS.length; i++) {
    P._start(2, i);
    for (const h of P.HOLES) {
      if (h.w < worst) worst = h.w;
      if (h.w < 84) bad.push(P.ACTIVE[i].name + " 宽 " + h.w);
      if (h.y === P.GROUND_Y) bad.push(P.ACTIVE[i].name + " 凿在地面上");
    }
    /* 撞到地面被切的情况：地面必须还是完整一块 */
    const g = P.PLATS.filter(p => p.kind === "ground");
    if (g.length !== 1) bad.push(P.ACTIVE[i].name + " 地面被切成 " + g.length + " 块");
  }
  ok(bad.length === 0, "27 屏全部合规（洞宽 ≥ 84、不凿地面）", bad.join(" / ") || "最窄 " + worst);
}

/* ---------- 3. 球真的掉进洞，落点是弹道算出来的 ---------- */
console.log("\n[3] 球从洞里落下去");
{
  const { P } = boot();
  const S = arena(P, SHROOM);
  const h = P.HOLES[0];
  const f = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  /* 球悬在洞的正上方、水平速度 0 —— 应该笔直掉到下一层台面 */
  b.x = h.x; b.y = h.y - 20; b.vx = 0; b.vy = 0;
  b.pushed = true; b.onGround = false;
  let landedY = null, frames = 0;
  for (let i = 0; i < 180; i++) {
    P.tick(1 / 60); frames++;
    if (b.onGround && b.y > h.y + 40) { landedY = b.y; break; }
  }
  ok(landedY !== null, "球掉下去了（没有卡在洞口）", landedY !== null ? "落在 y=" + (landedY | 0) : frames + " 帧仍在空中");
  /* 挡住它的必须是 462 层，不是洞口那层自己 */
  ok(landedY !== null && landedY > h.y + 60, "落点在下一层（y 增加了 60 以上）",
    landedY !== null ? "+" + ((landedY - h.y) | 0) + "px" : "-");
}

/* ---------- 4. 落点由推出去的力决定（这才是"可以瞄准"） ---------- */
console.log("\n[4] 落点是弹道算出来的，不是固定值");
{
  const run = (vx) => {
    const { P } = boot();
    const S = arena(P, SHROOM);
    const h = P.HOLES[0];
    const f = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
    P.makeBallFrom(f, 0, 0);
    const b = S.balls[S.balls.length - 1];
    b.x = h.x; b.y = h.y - 20; b.vx = vx; b.vy = 0;
    b.pushed = true; b.onGround = false;
    for (let i = 0; i < 180; i++) {
      P.tick(1 / 60);
      if (b.onGround && b.y > h.y + 40) return b.x;
      if (b.dead) return -1;
    }
    return -2;
  };
  const x0 = run(0), xL = run(-180), xR = run(180);
  ok(x0 > 0 && xL > 0 && xR > 0, "三种推法都能落地", x0.toFixed(0) + " / " + xL.toFixed(0) + " / " + xR.toFixed(0));
  ok(Math.abs(xR - xL) > 80, "左推和右推的落点差得很远（玩家能瞄准）",
    "差 " + Math.abs(xR - xL).toFixed(0) + "px");
  ok(xL < x0 && x0 < xR, "落点顺序跟推的方向一致", xL.toFixed(0) + " < " + x0.toFixed(0) + " < " + xR.toFixed(0));
}

/* ---------- 5. 掉下来的球真的压死人 ---------- */
console.log("\n[5] 碾压");
{
  const { P } = boot();
  const S = arena(P, SHROOM);
  const h = P.HOLES[0];
  const k0 = S.killed, food0 = S.food;
  /* 井底兵站：站在洞的正下方 */
  const victim = P.foeFromSpec({ foe: "bug", x: h.x, y: h.y + 112, lv: 1 }, false);
  S.foes.push(victim);
  const f = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = h.x; b.y = h.y - 20; b.vx = 0; b.vy = 0;
  b.pushed = true; b.onGround = false;
  const holds0 = b.holds;          // makeBallFrom 一造出来就装了 1 只，不是 0
  let maxVy = 0, maxLand = 0, trace = [];
  for (let i = 0; i < 120; i++) {
    P.tick(1 / 60);
    if (b.vy > maxVy) maxVy = b.vy;
    if ((b.landVy || 0) > maxLand) maxLand = b.landVy;
    if (i < 40 && i % 2 === 0) {
      trace.push("f" + i + " y=" + b.y.toFixed(0) + " vy=" + b.vy.toFixed(0) +
                 " lv=" + (b.landVy || 0).toFixed(0) + " coat=" + victim.coat +
                 " dead=" + (victim.dead ? 1 : 0) + " holds=" + b.holds);
    }
    if (victim.dead) break;
  }
  if (process.env.TRACE) console.log("    " + trace.join("\n    "));
  ok(victim.dead && b.holds === holds0, "井底那只被砸死了（不是被裹成球）", "最大下坠 " + maxVy.toFixed(0) + "px/s（门槛 " + P.SLAM_VY + "）");
  ok(S.killed === k0 + 1, "killed 涨了 1", S.killed + " vs " + k0);
  ok(S.food === food0 + 1, "收成涨了 1（碾压记账跟掉出屏幕一致）", S.food + " vs " + food0);
  ok(b.holds === holds0, "球没有因为碾压装人（砸是砸、卷是卷）", "holds " + holds0 + " → " + b.holds);
}

/* ---------- 6. 平地滚动的球不许碾 ---------- */
console.log("\n[6] 平地不误触发");
{
  const { P } = boot();
  const S = arena(P, SHROOM);
  const k6 = S.killed;
  const victim = P.foeFromSpec({ foe: "bug", x: 700, y: P.GROUND_Y, lv: 1 }, false);
  S.foes.push(victim);
  const f = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = 600; b.y = P.GROUND_Y; b.vx = 520; b.vy = 0;
  b.pushed = true; b.onGround = true;
  let maxVy = 0;
  for (let i = 0; i < 60; i++) {
    P.tick(1 / 60);
    if (b.vy > maxVy) maxVy = b.vy;
    if (b.x > 780) break;
  }
  ok(S.killed === k6, "地面滚过去的球没有碾它（killed 没动）", "vy " + maxVy.toFixed(0) + " < " + P.SLAM_VY + " / killed " + S.killed);
  ok(victim.coat > 0, "它是被糊了一层（走的是原来的撞击路径）", "coat=" + victim.coat);
}

/* ---------- 7. 已经糊过的不碾 ---------- */
console.log("\n[7] 糊到两层的怪不许被碾（玩家的投入要保住）");
{
  const { P } = boot();
  const S = arena(P, SHROOM);
  const h = P.HOLES[0];
  const k7 = S.killed;
  const victim = P.foeFromSpec({ foe: "bug", x: h.x, y: h.y + 112, lv: 1 }, false);
  victim.coat = 2;
  S.foes.push(victim);
  const f = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = h.x; b.y = h.y - 20; b.vx = 0; b.vy = 0;
  b.pushed = true; b.onGround = false;
  for (let i = 0; i < 120; i++) { P.tick(1 / 60); if (b.onGround) break; }
  ok(S.killed === k7, "糊到两层的怪没被碾死（killed 没动）", "killed " + S.killed + " / coat=" + victim.coat);
}

/* ---------- 8. SLAM_CAP 挡得住"一球压平井底" ---------- */
console.log("\n[8] 一次最多碾 SLAM_CAP 只");
{
  const { P } = boot();
  const S = arena(P, SHROOM);
  const h = P.HOLES[0];
  const k8 = S.killed;
  const vs = [];
  for (let i = 0; i < 6; i++) {
    const v = P.foeFromSpec({ foe: "bug", x: h.x - 30 + i * 12, y: h.y + 112, lv: 1 }, false);
    S.foes.push(v); vs.push(v);
  }
  const f = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = h.x; b.y = h.y - 20; b.vx = 0; b.vy = 0;
  b.pushed = true; b.onGround = false;
  for (let i = 0; i < 150; i++) { P.tick(1 / 60); if (b.onGround) break; }
  const dead = S.killed - k8;
  ok(dead > 0, "碾压真的发生了", dead + " 只");
  ok(dead <= P.SLAM_CAP, "没有超过上限 " + P.SLAM_CAP, dead + " 只");
}

/* ---------- 9. 碾压半径随下坠速度增长 ---------- */
console.log("\n[9] 砸得越深，压得越宽");
{
  const { P } = boot();
  const reach = (vy) => P.SLAM_REACH + Math.max(0, vy - P.SLAM_VY) * P.SLAM_GROW;
  const a = reach(628), b2 = reach(930), c = reach(1137);
  ok(a < b2 && b2 < c, "三档落差对应三档范围（462 / 350 / 248 → 地面）",
    [a, b2, c].map(v => v.toFixed(0)).join(" < "));
  ok(reach(P.SLAM_VY) === P.SLAM_REACH, "刚好到门槛时 = 基础半径", P.SLAM_REACH + "px");
}


/* ---------- 10. 真实波次：不摆怪，让球自己从洞里掉下去 ---------- */
console.log("\n[10] 真实波次里的碾压（不手工摆靶子）");
{
  const { P } = boot();
  P._start(2, SHROOM);
  const S = P.S;
  /* 先让波次刷出来（第 15 屏 P1 有四只站在 462 层） */
  S.p.x = 60; S.p.y = P.GROUND_Y;
  for (let i = 0; i < 90; i++) P.tick(1 / 60);
  const standing = S.foes.filter(f => !f.dead && Math.abs(f.y - 462) < 8);
  ok(standing.length > 0, "P1 的怪已经站在 462 层", standing.length + " 只");

  const h = P.HOLES[0];
  const k0 = S.killed;
  const f0 = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f0, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = h.x; b.y = h.y - 20; b.vx = 0; b.vy = 0;
  b.pushed = true; b.onGround = false;
  for (let i = 0; i < 120; i++) { P.tick(1 / 60); if (b.onGround) break; }
  const slammed = (S.stat.slam || 0);
  ok(slammed > 0, "球从洞里掉下去，在真实波次里碾到了人", "碾 " + slammed + " 只 / killed " + (S.killed - k0));
}

console.log("\n========================================================");
if (fail === 0) console.log("全部通过：" + pass + " 项");
else console.log("红的 " + fail + " 项 / 共 " + (pass + fail) + " 项");
console.log("========================================================\n");
process.exit(fail === 0 ? 0 : 1);
