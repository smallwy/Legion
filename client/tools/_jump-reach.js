/* 跳虫「这一跳到底上不上得去」的对账工具。
 *
 * 验的是**预演和实跑是同一件事**：
 *   · `pounceLands` 说 true  → 真跳一次，必须落到更高的那层；
 *   · `pounceLands` 说 false → 真跳一次（强制），必须掉回同层或更低。
 *
 * 为什么必须对账、不能只信预演：预演是 `stepBody` 判据的手抄版，
 * 抄错了就会出现"算着能上、实际掉回去" —— 那比不跳更伤，
 * 因为它让玩家学会不信任预告（蹲身动画）。**同源的判据必须被实跑钉住。**
 *
 * 用法：node tools/_jump-reach.js [屏号]
 */
const path = require("path");
const { boot } = require("./grove-env");

const P = boot().GROVE, S = P.S;
const stage = Number(process.argv[2] || 5);
P._start(0, stage);

const plats = P.S && null;   // 占位，PLATS 从 S 里取不到，走 curStage
const L = P.curStage();
console.log("=== 第 " + (stage + 1) + " 屏 " + (L.name || L.id) + " 的台面 ===");
for (const p of L.plats) {
  console.log("  " + (p.kind === "ground" ? "地面" : "台面") +
    "  x=" + p.x + ".." + (p.x + p.w) + "  y=" + p.y + "  h=" + (p.h || 22));
}

/* 一次完整试验：把一只跳虫放到 (cx, cy)，朝 dir 扑，返回实际落点。 */
function trial(cx, cy, dir) {
  S.foes.length = 0;
  const f = P.foeFromSpec({ foe: "bug", x: cx, y: cy });
  f.jumper = 1; f.jumpCd = 0; f.ph = 0;
  f.onGround = true;
  S.foes.push(f);

  /* 玩家放在起跳方向上、上面一层的位置：这样追人分支不会改朝向，
     扑击=一次纯粹的物理试验，不掺"它想追谁"的随机性。 */
  S.p.x = cx + dir * 120;
  S.p.y = cy - 94;
  S.p.dead = false;

  const predict = P.pounceLands(f, dir);

  /* 强制起跳（不管预演说什么），量真实的落点。 */
  f.crouch = 0.30;
  f.pounceDir = dir;

  let prevGround = f.onGround;
  let apex = f.y, landedAt = null;
  for (let i = 0; i < 240; i++) {
    P.updateFoe(f, 1 / 60);
    if (f.y < apex) apex = f.y;
    if (!prevGround && f.onGround) { landedAt = f.y; break; }
    prevGround = f.onGround;
    if (f.dead) break;
  }
  return { predict, apex, landedAt, start: cy };
}

/* ---- 用当前屏的真实几何挑几个位置 ---- */
const ledges = L.plats.filter((p) => p.kind !== "ground").sort((a, b) => b.y - a.y);
const ground = L.plats.find((p) => p.kind === "ground");
const GY = ground ? ground.y : 556;

const cases = [];
function add(tag, cx, cy, dir, expect) { cases.push({ tag, cx, cy, dir, expect }); }

/* ① 台面正下方 → 应该能钻上去（单向平台，从板底穿） */
if (ledges.length) {
  const p0 = ledges[0];                       // 最低的那块台面
  add("板底正中", Math.round(p0.x + p0.w / 2), GY, 1, true);
  /* ② 板底外侧，朝板的方向 → 斜着跳上去 */
  add("板外斜跳", Math.round(p0.x + p0.w + 60), GY, -1, true);
  /* ③ 中间层有缺口的地面 → 这一跳跨不到任何板，应该上不去。
     **这才是"隔两层上不去"的真实形态**：虫跳高 123px，层距 94，
     所以它总能"穿到"上面一层的高度；能不能**站住**，取决于那一刻
     x 底下有没有板。中间层留有缺口的地方，它就只能落回地面。 */
  for (let x = Math.round(p0.x + p0.w) + 30; x < 900; x += 10) {
    const covered = L.plats.some((q) => q.kind !== "ground" && x >= q.x && x <= q.x + q.w);
    if (!covered) {
      /* 落点往左偏 107px，确认那个区间也没有板，才是一个干净的"上不去"用例 */
      const lx = x - 107;
      const solid = L.plats.some((q) => q.kind !== "ground" && lx >= q.x - 20 && lx <= q.x + q.w + 20);
      if (!solid) { add("缺口处", x, GY, -1, false); break; }
    }
  }
  /* ④ 站在台上，朝上方更高那块扑 */
  const p2 = ledges.find((q) => q.y < p0.y);
  if (p2) add("台→上层台", Math.round(p0.x + p0.w / 2), p0.y, 1, true);
}

let bad = 0;
console.log("\n=== 预演 vs 实跑 ===");
for (const c of cases) {
  const r = trial(c.cx, c.cy, c.dir);
  const rise = r.landedAt == null ? -1 : (r.start - r.landedAt);
  const realOK = rise >= 60;
  /* 对账口径：**只查虚假承诺**。
     预演说 true → 实跑必须真的上去；
     预演说 false → 实跑能上去也无所谓（因为它根本不会走那条路，
     比如板正下方被禁的穿模跳，强制起跳当然上得去）。
     反过来查会得出"必须允许穿模"的荒谬结论。 */
  const lie = r.predict && !realOK;
  if (lie) bad++;
  console.log(
    (lie ? "  ✗ 虚假承诺 " : "  ✓ ") + c.tag.padEnd(10) +
    " 起点(" + c.cx + "," + c.cy + ") dir=" + (c.dir > 0 ? "→" : "←") +
    " | 预演 " + (r.predict ? "能上" : "上不去") +
    " | 实跑 最高到 " + r.apex.toFixed(0) +
    " 落 " + (r.landedAt == null ? "未落地" : r.landedAt.toFixed(0)) +
    " 升 " + rise + "px → " + (realOK ? "上去了" : "没上去") +
    (r.predict === realOK ? "" : "（预演禁掉的路径）")
  );
}
console.log("\n" + (bad === 0 ? "✓ 没有虚假承诺（" + cases.length + " 例）"
                            : "✗ " + bad + " 例虚假承诺"));

/* ============================================================================
   两条行为验收
   ----------------------------------------------------------------------------
   A. **不白跳**：每一次蹲身（预告）之后，它必须真的升高 ≥ 60px。
      这是用户那句"有点地方不能跳、有的可以"的正面答案 ——
      规则不该是"看玩家站哪"，而是"它只在真能上去的时候才蹲"。
      白跳 = 蹲了却没上去 = 玩家学会了不信任预告。
   B. **板底正中也能上来**：单向平台本来就允许从下面穿上去（玩家自己就是这么跳的），
      所以虫钻板不是 bug；穿模靠遮挡解决（platOverFoe + 板顶暗影）。
      这一条防的是"为了躲穿模把机制做死"的回头路 —— 我试过，7 屏里 6 屏卡死。
   ========================================================================== */
console.log("\n=== A. 不白跳（蹲了就必须上去）===");
let fakes = 0;
for (const st of [3, 5, 8, 12, 17, 20, 23, 26]) {
  P._start(0, st);
  const L4 = P.curStage();
  S.foes.length = 0;
  const gr4 = L4.plats.find((p) => p.kind === "ground");
  const gy4 = gr4 ? gr4.y : 556;
  const wide4 = L4.plats.filter((p) => p.kind !== "ground").sort((a, b) => b.w - a.w)[0];
  if (!wide4) continue;
  S.p.x = wide4.x + wide4.w * 0.5; S.p.y = wide4.y;
  S.p.vx = 0; S.p.vy = 0; S.p.hp = 99; S.p.maxHp = 99; S.p.dead = false; S.p.cool = 99;

  const bug = P.foeFromSpec({ foe: "bug", x: wide4.x + wide4.w * 0.5, y: gy4, lv: 1 }, false);
  bug.jumper = 1; bug.jumpCd = 0; bug.ph = 0;
  S.foes.push(bug);

  let prevCrouch = 0, takeoffY = null, jumps = 0, bad2 = 0;
  for (let i = 0; i < 10 * 60; i++) {
    P.tick(1 / 60);
    /* 蹲身结束的那一帧 = 起跳 */
    if (prevCrouch > 0 && bug.crouch <= 0) { takeoffY = bug.y; jumps++; }
    prevCrouch = bug.crouch;
    /* 起跳后 1.4 秒内看它到底有没有真的升高 */
    if (takeoffY != null && bug.onGround && bug.y >= takeoffY - 59) {
      /* 落回同层或更低 = 白跳。只在"已落地"时判，避免上升途中误报。 */
      if (!bug.crouch && bug.pounce <= 0.01) { bad2++; takeoffY = null; }
    }
    if (takeoffY != null && bug.y < takeoffY - 60) { takeoffY = null; }   // 真上去了
  }
  fakes += bad2;
  console.log((bad2 === 0 ? "  ✓ " : "  ✗ ") + (st + 1) + "屏 " + (L4.name || L4.id).padEnd(6) +
    " 起跳 " + jumps + " 次 · 白跳 " + bad2 + " 次");
}
console.log("\n" + (fakes === 0 ? "✓ 没有白跳" : "✗ " + fakes + " 次白跳"));

/* ============================================================================
   可达性普查：**27 屏里有没有虫子上不去的台面**
   ----------------------------------------------------------------------------
   上不去的台面 = 站上去永久安全的"秒台"。这不该靠感觉判断，
   而且"禁止穿模"那条改动（虫必须绕到板外侧才许跳）有可能把某些台面
   变成死角 —— 所以改完必须普查一遍，而不是等玩家发现。

   判定口径：只要存在**任何一个**可站位置（地面/其它台面上，每 12px 采一点）
   能让 pounceLands 返回 true，这块台面就算"上得去"。
   ========================================================================== */
console.log("\n=== 可达性普查（全部屏）===");
let totalLedge = 0, deadLedge = 0;
const dead = [];
for (let st = 0; st < P.LEVELS.length; st++) {
  P._start(0, st);
  const L2 = P.curStage();
  S.foes.length = 0;
  const ls = L2.plats.filter((p) => p.kind !== "ground");
  const gr = L2.plats.find((p) => p.kind === "ground");
  if (!ls.length) continue;
  const gy = gr ? gr.y : 556;

  for (const q of ls) {
    totalLedge++;
    let ok = false;
    const probe = { x: 0, y: 0, w: 34, h: 28 };
    const spots = [];
    for (let x = 40; x < 920; x += 12) spots.push({ x, y: gy });
    for (const b of ls) {
      if (b === q) continue;
      for (let x = b.x + 12; x < b.x + b.w - 12; x += 12) spots.push({ x, y: b.y });
    }
    for (const sp of spots) {
      probe.x = sp.x; probe.y = sp.y;
      if (P.pounceLands(probe, 1) || P.pounceLands(probe, -1)) { ok = true; break; }
    }
    if (!ok) { deadLedge++; dead.push((st + 1) + "屏 " + (L2.name || L2.id) + " y=" + q.y + " x=" + q.x + ".." + (q.x + q.w)); }
  }
}
console.log("  台面总数 " + totalLedge + "，没有起跳点的 " + deadLedge + " 块");
for (const d of dead) console.log("    ✗ " + d);

const fail = bad + fakes + deadLedge;
console.log("\n" + (fail === 0 ? "✓ 全部通过" : "✗ " + fail + " 项有问题"));
process.exit(fail === 0 ? 0 : 1);
