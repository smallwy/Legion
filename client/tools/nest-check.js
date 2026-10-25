/* ============================================================================
   nest-check.js —— 深巢地形生成器的批量校验（设计文档 §6 第一行）

   要求：depth 1..60 × 10 个种子，C1~C6 **100% 过**。
   为什么必须单独跑这一道：生成器错一次，玩家下潜到第 40 层会遇到一屏
   根本打不过的地形，而主线 ALL9 只跑 27 屏，永远照不到深巢。

   跑法：node tools/nest-check.js          （默认 60 层 × 10 种子）
         node tools/nest-check.js 120 20   （层数 种子数）
   ========================================================================== */

const { boot } = require("./grove-env.js");
const sb = boot();
const G = sb.GROVE;

let pass = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; return; }
  fails.push({ name, detail });
}

const MAX_DEPTH = Number(process.argv[2] || 60);
const SEEDS = Number(process.argv[3] || 10);

console.log("=== 深巢生成器批量校验 ===");
console.log(`层数 1..${MAX_DEPTH} × 每层 ${SEEDS} 个种子`);

/* ---- 1. C1~C6 全过 ---- */
let worst = 0, worstAt = "";
const failHist = {};
for (let d = 1; d <= MAX_DEPTH; d++) {
  for (let s = 0; s < SEEDS; s++) {
    const seed = (d * 7919 + s * 104729) >>> 0;
    const r = G.nestLevel(d, seed);
    if (!r.fails.length) pass++;
    else {
      fails.push({ name: `第 ${d} 层 seed ${seed} 未过校验`, detail: r.fails.join(" / ") });
      for (const f of r.fails) failHist[f] = (failHist[f] || 0) + 1;
    }
    if (r.tries > worst) { worst = r.tries; worstAt = `第 ${d} 层 seed ${seed}`; }
    /* 生成出来的对象必须自洽：地面恒 1 段、营地贴墙、出生点在地面层 */
    const L = r.level;
    ok(L.plats.filter(p => p.kind === "ground").length === 1,
       `第 ${d} 层地面段数 = 1`);
    ok(L.spawn.y === 556 && Math.abs(L.camp.y - 556) < 0.01,
       `第 ${d} 层出生点/营地在 GROUND_Y`);
    ok(L.spawn.x > 26 && L.spawn.x < 934, `第 ${d} 层出生点在墙内`);
    ok(L.waves.length >= 2, `第 ${d} 层至少两波（小怪 + BOSS）`);
    ok(JSON.stringify(L.waves[L.waves.length - 1].map(f => f.foe)) === '["boss"]',
       `第 ${d} 层最后一波是 BOSS`);
  }
}

/* ---- 2. 同层可复现（同一 depth 同一 seed 必须一模一样的几何） ---- */
{
  let same = true, diffN = 0;
  for (let d = 1; d <= 20; d++) {
    const a = JSON.stringify(G.nestLevel(d, d * 31).level);
    const b = JSON.stringify(G.nestLevel(d, d * 31).level);
    if (a !== b) { same = false; diffN++; }
  }
  ok(same, "同一 depth + seed 两次生成完全一致（可复现）", `不一致 ${diffN} 层`);
}

/* ---- 3. 默认种子（不传 seed）也要可复现 —— 玩家重进同一层必须还是那层 ---- */
{
  let same = true;
  for (let d = 1; d <= 20; d++) {
    if (JSON.stringify(G.nestLevel(d).level) !== JSON.stringify(G.nestLevel(d).level)) same = false;
  }
  ok(same, "nestLevel(depth) 默认种子可复现");
}

/* ---- 4. 镜像真的翻过来了（不能"一半的层镜像"结果全场都是原样） ---- */
{
  let rail = 0, lail = 0;
  for (let d = 1; d <= 40; d++) {
    for (let s = 0; s < 5; s++) {
      const L = G.nestLevel(d, d * 13 + s * 7).level;
      if (L.camp.x < 480) lail++; else rail++;
    }
  }
  ok(lail > 0 && rail > 0, "营地左右两侧都会出现（镜像真的在翻）", `左 ${lail} / 右 ${rail}`);
}

/* ---- 5. 深度真的在变（层与层不许长得一样） ---- */
{
  let dup = 0;
  const sigs = [];
  for (let d = 1; d <= 40; d++) {
    const L = G.nestLevel(d).level;
    const sig = JSON.stringify([L.theme, L.plats.map(p => [p.x, p.y, p.w]).sort(), L.pits.length]);
    if (sigs.includes(sig)) dup++;
    sigs.push(sig);
  }
  ok(dup <= 8, "40 层里重复配方 ≤ 8（否则玩家会认出'还是那些台子'）", `重复 ${dup}`);
}

/* ---- 6. 主题不连续重复 ---- */
{
  let adj = 0;
  for (let d = 2; d <= 60; d++) {
    const a = G.nestLevel(d - 1).level.theme, b = G.nestLevel(d).level.theme;
    if (a === b && d <= 20) adj++;
  }
  ok(adj <= 6, "浅层相邻两层不同主题 ≤ 6 次重复", `相邻同主题 ${adj}`);
}

/* ---- 7. 最简版本身必须过校验（兜底不能也不合格） ---- */
{
  let okAll = true;
  for (let d = 1; d <= 60; d++) {
    const r = G.nestCheck(G.nestSimpleLevel(d));
    if (!r.ok) { okAll = false; fails.push({ name: `最简版第 ${d} 层不过`, detail: r.fails.join(" / ") }); }
  }
  ok(okAll, "兜底最简版 1..60 层全部过 C1~C6");
}

/* ---- 8. 构件库不是空的（空库 = 每层都退化成最简版） ---- */
{
  const lib = G.NEST_LIB;
  ok(lib.ledges[462].length > 5, `构件库 462 层有料`, `${lib.ledges[462].length} 条`);
  ok(lib.ledges[350].length > 5, `构件库 350 层有料`, `${lib.ledges[350].length} 条`);
  ok(lib.ledges[248].length > 3, `构件库 248 层有料`, `${lib.ledges[248].length} 条`);
}

console.log("");
for (const f of fails.slice(0, 25)) {
  console.log(`  ✗ ${f.name}${f.detail ? " — " + f.detail : ""}`);
}
if (fails.length > 25) console.log(`  … 另有 ${fails.length - 25} 条`);
if (Object.keys(failHist).length) {
  console.log("\n校验失败分布：");
  for (const k in failHist) console.log(`  ${k}: ${failHist[k]}`);
}
console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
console.log(`重抽次数峰值：${worst}（${worstAt}）`);
process.exit(fails.length ? 1 : 0);
