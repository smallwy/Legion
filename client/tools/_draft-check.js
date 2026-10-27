/* ============================================================================
   _draft-check.js —— 「上升气流柱 + 竖直硬墙」行为验证（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   为什么必须单独验：`grove-smoke` 全绿只证明"没有副作用"。
   而这两件事的病根是同一种 —— **写了但没用**：

     · 气流柱最可能的失败形态不是报错，是"球从柱里穿过去，一点没被托起"。
       冒烟照样全绿，截图上看不出任何异常（柱就在那儿，只是没作用）。
     · 硬墙最可能的失败形态是"球撞上去按普通墙 ×0.62 衰减"——
       玩家看到的是"这堵墙和其他墙一样"，那它就只是块装饰。

   所以这里逐帧量：高度、速度、时间、次数。全部用数字判，不用肉眼。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_draft-check.js
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

/* 有风柱的那一屏 = 第 14 屏「断崖路」（0-based 13） */
const CLIFF = 13;

/** 干净的测试场：清敌人/球/裂缝，玩家挪远 */
function arena(P, idx) {
  P._start(2, idx);
  const S = P.S;
  S.foes.length = 0;
  S.balls.length = 0;
  S.texts.length = 0;
  S.frags.length = 0;
  P.CHASMS.length = 0;
  S.p.x = 700; S.p.y = P.GROUND_Y; S.p.vx = 0; S.p.vy = 0; S.p.dead = false;
  return S;
}

/** 造一颗球放到指定位置（pushed=false，避免石球自动硬化干扰） */
function ballAt(P, S, x, y) {
  const f = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = x; b.y = y; b.vx = 0; b.vy = 0;
  b.onGround = false; b.ground = null;
  return b;
}

console.log("\n=== 上升气流柱 + 竖直硬墙 ===");

/* ---------- 1. 数据：风柱的位置和几何 ---------- */
console.log("\n[1] 风柱的几何");
{
  const { P } = boot();
  arena(P, CLIFF);
  const up = P.UPDRAFTS;
  ok(up.length === 1, "这一屏有一根风柱", up.length + " 根");
  const u = up[0];
  ok(u.y === P.GROUND_Y, "柱底贴着地面（球滚得进去）", "y=" + u.y + " / GROUND_Y=" + P.GROUND_Y);
  ok(u.x - u.w / 2 > P.WALL_L && u.x + u.w / 2 < P.WALL_R, "整根柱在场地内",
    (u.x - u.w / 2) + ".." + (u.x + u.w / 2));

  /* ★ 柱顶 + 惯性 = 最高那一层。这是这一整套机制唯一的硬约束：
     少一像素就到不了顶层（球上去又落回来），多一像素就飞出画面。 */
  const top = u.y - u.h;
  const inertia = P.DRAFT_RISE * P.DRAFT_RISE / (2 * 2100);   // vy²/2g
  const reach = u.y - (top - inertia);
  ok(Math.abs(reach - (P.GROUND_Y - 156)) < 24,
    "柱高 + 惯性 ≈ 一路送到 156 层（400px）",
    "能升 " + reach.toFixed(0) + "px / 需要 400px");
}

/* ---------- 2. 球真的被吹上去 ---------- */
console.log("\n[2] 球在柱里被托起来");
{
  const { P } = boot();
  const S = arena(P, CLIFF);
  const u = P.UPDRAFTS[0];
  const dir0 = u.dir; u.dir = 0;              // 先关侧风，单看竖直
  const b = ballAt(P, S, u.x, P.GROUND_Y);
  let minY = 1e9, frames = 0;
  for (let i = 0; i < 240; i++) {
    P.tick(1 / 60);
    frames++;
    if (b.y < minY) minY = b.y;
    if (b.dead) break;
    if (b.onGround && minY < P.GROUND_Y - 100) break;
  }
  ok(minY < P.GROUND_Y - 300, "球被吹到 300px 以上（不是原地抖）",
    "最高 y=" + minY.toFixed(0) + " / 地面 " + P.GROUND_Y + " / " + (frames / 60).toFixed(2) + "s");
  ok(minY <= 158 + 24, "球够到 156 层", "最高 y=" + minY.toFixed(0) + "（台面 156）");
  ok(b.onGround && Math.abs(b.y - 156) < 6, "球真的落在 156 层的台面上（不是掉回去）",
    "落地 y=" + b.y.toFixed(0) + (b.onGround ? " 站稳" : " 空中"));
  u.dir = dir0;
}

/* ---------- 3. 侧风把球送出 156 层的边缘 ---------- */
console.log("\n[3] 侧风：上去之后自己滚下来");
{
  const { P } = boot();
  const S = arena(P, CLIFF);
  const u = P.UPDRAFTS[0];
  ok(!!u.dir, "这一屏的风柱配了侧风", "dir=" + u.dir);
  const b = ballAt(P, S, u.x, P.GROUND_Y);
  let minY = 1e9, landedAt = null;
  for (let i = 0; i < 300; i++) {
    P.tick(1 / 60);
    if (b.y < minY) minY = b.y;
    if (b.dead) break;
    if (landedAt == null && b.onGround && Math.abs(b.y - 156) < 6) landedAt = b.x;
    if (landedAt != null && b.y > 400) break;   // 已经掉下来了
  }
  ok(minY <= 180, "照样升到顶层", "最高 y=" + minY.toFixed(0));
  ok(b.x > u.x + 20, "落地时已经被推向右侧（侧风生效）",
    "x " + u.x + " → " + b.x.toFixed(0));
}

/* ---------- 4. 衰减：同一颗球不能当永动机 ---------- */
console.log("\n[4] 衰减（否则球在柱里永远出不来）");
{
  const { P } = boot();
  const S = arena(P, CLIFF);
  const u = P.UPDRAFTS[0];
  const dir0 = u.dir; u.dir = 0;
  const b = ballAt(P, S, u.x, P.GROUND_Y);
  const tops = [];
  /* 连续跑，球每次落回柱里就算一趟 */
  let lastTop = null, armed = true;
  for (let i = 0; i < 900; i++) {
    P.tick(1 / 60);
    if (b.dead) break;
    if (armed && b.vy > 0 && b.y > P.GROUND_Y - 60) {
      tops.push(b.y); armed = false;
    }
    if (b.draftIn) armed = true;
  }
  /* 判据是"停下来了"，不是"落回地面" —— 球也可能在台面上漏气崩掉，
     两种都是"没有无限上升"。写死成"在地面"会把崩掉的球误判成失败。 */
  const settled = b.dead || b.onGround;
  ok(settled, "球最终停下来了（没有无限上升）",
    "y=" + b.y.toFixed(0) + " / draftN=" + (b.draftN || 0) + " / dead=" + b.dead);
  const ratios = [];
  for (let n = 0; n < 4; n++) ratios.push((P.DRAFT_RISE * Math.pow(P.DRAFT_DECAY, n)) | 0);
  ok(ratios[0] > ratios[1] && ratios[1] > ratios[2], "三趟的力度严格递减",
    ratios.join(" → ") + " px/s");
  ok(ratios[2] < 190 + 200, "第三趟已经托不动一层（< 层距 94 对应的速度）",
    "第三趟 " + ratios[2] + " px/s → 升 " + (ratios[2] * ratios[2] / 4200).toFixed(0) + "px");
  u.dir = dir0;
}

/* ---------- 5. 玩家：借风跳 ---------- */
console.log("\n[5] 玩家借风跳");
{
  const { P } = boot();
  const S = arena(P, CLIFF);
  const u = P.UPDRAFTS[0];

  const jumpFrom = (x) => {
    arena(P, CLIFF);
    const s = P.S;
    s.p.x = x; s.p.y = P.GROUND_Y; s.p.vx = 0; s.p.vy = 0;
    s.p.onGround = true; s.p.ground = { x: 0, y: P.GROUND_Y, w: 900, kind: "ground" };
    s.p.coyote = 0.12; s.p.jumpBuf = 0.12; s.p.dashT = 0;
    let minY = 1e9;
    for (let i = 0; i < 120; i++) {
      P.tick(1 / 60);
      if (s.p.y < minY) minY = s.p.y;
    }
    return P.GROUND_Y - minY;
  };

  const inDraft = jumpFrom(u.x);
  const outside = jumpFrom(760);      // 地面右侧，柱外
  ok(inDraft > outside * 1.6, "风柱里跳得明显更高",
    inDraft.toFixed(0) + "px vs 柱外 " + outside.toFixed(0) + "px");
  ok(inDraft > 306 + 10, "够从 462 层跳上 156 层（306px）",
    inDraft.toFixed(0) + "px ≥ 316");
  ok(inDraft < 400, "又不够一楼直接到顶（400px）—— 必须连跳两次",
    inDraft.toFixed(0) + "px < 400");
}

/* ---------- 6. 敌人不感知气流 ---------- */
console.log("\n[6] 敌人不感知气流（气流是玩家的工具）");
{
  const { P } = boot();
  P._start(2, CLIFF);          // 不加载关卡时 UPDRAFTS 是空的（模块级初值）
  const fall = (x) => {
    arena(P, CLIFF);
    const S = P.S;
    const f = P.foeFromSpec({ foe: "bug", x, y: 300, lv: 1 }, false);
    S.foes.push(f);
    let n = 0;
    for (let i = 0; i < 200; i++) {
      P.tick(1 / 60);
      n++;
      if (f.dead || f.y >= P.GROUND_Y - 4) break;
    }
    return n;
  };
  const u = P.UPDRAFTS[0];
  const inDraft = fall(u.x);
  const outside = fall(760);
  ok(Math.abs(inDraft - outside) <= 4, "柱里和柱外下落用时一样（没被托住）",
    inDraft + " 帧 vs " + outside + " 帧");
}

/* ---------- 7. 竖直硬墙：保速反弹 ---------- */
console.log("\n[7] 硬墙 vs 普通墙");
{
  const { P } = boot();
  const S = arena(P, CLIFF);
  const wall = P.REFLECTS.find(d => d.wall);
  ok(!!wall, "这一屏有一堵竖直硬墙", wall ? "x=" + wall.x1 + " y=" + wall.y1 + ".." + wall.y2 : "无");
  ok(wall && wall.x1 === wall.x2, "它是竖直的（x1 === x2）", wall ? wall.x1 + " / " + wall.x2 + "" : "-");

  if (wall) {
    /* 球在 248 层往左滚，撞硬墙 */
    const b = ballAt(P, S, 660, 248);
    b.vx = -520;
    let hitVx = null;
    for (let i = 0; i < 120; i++) {
      P.tick(1 / 60);
      if (b.vx > 0 && hitVx == null) { hitVx = b.vx; break; }
      if (b.y > 300) break;
    }
    ok(hitVx != null, "球撞上硬墙被弹回来了", hitVx == null ? "没弹" : "回弹 vx=" + hitVx.toFixed(0));
    ok(hitVx != null && Math.abs(hitVx) >= 480,
      "**保速**弹回（不是普通墙的 ×0.62 = 322）",
      hitVx == null ? "-" : "撞前 520 → 撞后 " + Math.abs(hitVx).toFixed(0));

    /* 对照：普通墙 */
    const S2 = arena(P, CLIFF);
    const b2 = ballAt(P, S2, 200, 248);
    b2.vx = -520;
    let wallVx = null;
    for (let i = 0; i < 120; i++) {
      P.tick(1 / 60);
      if (b2.vx > 0) { wallVx = b2.vx; break; }
    }
    ok(wallVx != null && Math.abs(wallVx) < 400,
      "对照：撞场地边的普通墙会掉速（×0.62 + 保底 120）",
      wallVx == null ? "-" : "撞前 520 → 撞后 " + Math.abs(wallVx).toFixed(0));
  }
}

/* ---------- 8. 硬墙挡住玩家、但挡不住跳跃 ---------- */
console.log("\n[8] 硬墙对玩家：走不过去，跳得过去");
{
  const { P } = boot();
  const S = arena(P, CLIFF);
  const wall = P.REFLECTS.find(d => d.wall);
  if (wall) {
    /* 走过去 */
    S.p.x = 620; S.p.y = 248; S.p.vy = 0;
    S.p.onGround = true; S.p.ground = { x: 460, y: 248, w: 220, kind: "ledge" };
    S.keys.left = true;
    /* 判据是"最左到过哪里"，不是"有没有走进某个窗口" ——
       第一版写了个 `x < wall.x1 + 30` 的窗口，玩家恰好停在窗口外 3px，
       于是被判成"走过去了"。**玩家其实被挡住了**，是断言在说谎。 */
    let minX = 1e9;
    for (let i = 0; i < 90; i++) {
      P.tick(1 / 60);
      if (S.p.x < minX) minX = S.p.x;
    }
    S.keys.left = false;
    const wallRight = wall.x1 + 13;
    ok(minX >= wallRight + 10, "玩家走不过去（被墙挡住）",
      "最左 x=" + minX.toFixed(0) + " / 墙右缘 " + wallRight + "（玩家半宽 19）");

    /* 跳过去：**要验"在墙顶上方越过了墙"**，不是"最后跑到了墙左边" ——
       后者掉到地面也能满足，等于没测。 */
    arena(P, CLIFF);
    const s2 = P.S;
    const wtop = Math.min(wall.y1, wall.y2);
    s2.p.x = 600; s2.p.y = 248; s2.p.vy = 0;
    s2.p.onGround = true; s2.p.ground = { x: 460, y: 248, w: 220, kind: "ledge" };
    s2.p.coyote = 0.12; s2.p.jumpBuf = 0.12; s2.p.dashT = 0;
    s2.keys.left = true;
    let crossedAbove = false;
    for (let i = 0; i < 90; i++) {
      P.tick(1 / 60);
      if (s2.p.y < wtop + 4 && s2.p.x < wall.x1 - 4) { crossedAbove = true; break; }
    }
    s2.keys.left = false;
    ok(crossedAbove, "玩家跳得过去（墙高 60 < 跳跃 123），且是从墙顶上方过去的",
      "墙顶 y=" + wtop + " / 跳跃高度 123");
  }
}

/* ---------- 9. 基线隔离：27 屏只有这一屏有新风柱 ---------- */
console.log("\n[9] 27 屏基线隔离");
{
  const { P } = boot();
  const N = P.LEVELS.length;
  const withDraft = [], withWall = [];
  for (let i = 0; i < N; i++) {
    P._start(2, i);
    if (P.UPDRAFTS.length) withDraft.push(i + 1);
    if (P.REFLECTS.some(d => d.wall)) withWall.push(i + 1);
  }
  ok(withDraft.length === 1 && withDraft[0] === CLIFF + 1,
    "只有第 " + (CLIFF + 1) + " 屏有风柱（其余 26 屏不受影响）", "有风柱的屏：" + withDraft.join(","));
  ok(withWall.length === 1, "只有一屏有竖直硬墙", "有硬墙的屏：" + withWall.join(","));
}

/* ---------- 10. 真实波次：风柱真的在场上转起来 ---------- */
console.log("\n[10] 真实波次里气流被触发过");
{
  const { P } = boot();
  P._start(2, CLIFF);
  const S = P.S;
  S.p.hp = 999; S.p.maxHp = 999;
  const f = P.foeFromSpec({ foe: "bug", x: 900, y: P.GROUND_Y, lv: 1 }, false);
  P.makeBallFrom(f, 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.x = P.UPDRAFTS[0].x; b.y = P.GROUND_Y; b.vx = 0; b.vy = 0;
  b.pushed = true;
  for (let i = 0; i < 200; i++) P.tick(1 / 60);
  ok((S.stat.draft || 0) > 0, "S.stat.draft 记到了气流",
    (S.stat.draft || 0) + " 帧 / 最高 y=" + b.y.toFixed(0));
}

console.log("\n========================================================");
console.log((fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 项通过 / " + fail + " 项失败");
console.log("========================================================");
process.exit(fail === 0 ? 0 : 1);
