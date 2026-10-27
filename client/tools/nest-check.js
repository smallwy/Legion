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
    /* ---- 井内断言（2026-10-25：活动区砍到 640）----
       这是这一版最容易被"悄悄改坏"的约束：任何一件东西的 x 落到
       井外（26..160 或 800..934），物理上都拿不到它 —— 球被夹在
       WALL_L..WALL_R 之间，人也是。画面上它还在那儿（背景照画），
       表现就是"这层的营地推不进球"或者"有个敌人永远打不到"。
       所以生成器每一样都要钉在井内，且用 NEST.L/R 判，不用 26/934。 */
    const NL = G.NEST.L, NR = G.NEST.R;
    ok(NR - NL === 640, `第 ${d} 层井宽 640`);
    {
      const out = [];
      for (const p of L.plats) if (p.x < NL || p.x + p.w > NR) out.push("台 " + p.x + "+" + p.w);
      for (const p of L.pits) if (p.x < NL || p.x + p.w > NR) out.push("坑 " + p.x + "+" + p.w);
      for (const r of L.ramps) if (r.x < NL || r.x + r.w > NR) out.push("坡 " + r.x + "+" + r.w);
      if (L.camp.x < NL || L.camp.x + L.camp.w > NR) out.push("营地 " + L.camp.x);
      if (L.spawn.x < NL || L.spawn.x > NR) out.push("出生点 " + L.spawn.x);
      for (const w of L.waves) for (const f of w) {
        if (f.x < NL || f.x > NR) out.push("敌人 " + f.foe + "@" + f.x);
      }
      ok(out.length === 0, `第 ${d} 层全部几何在 640 井内`, out.join(" / "));
    }
    /* 地面段恒等于井（少一段就有"看着是地、其实是空的"的死亡区） */
    ok(L.plats[0].x === NL && L.plats[0].w === 640, `第 ${d} 层地面 = 井宽`);
    ok(L.spawn.x >= NL && L.spawn.x <= NR, `第 ${d} 层出生点在井内`);
    /* ---- 主题名与收成目标（2026-10-25 两个"生成期才崩/才无解"的坑）---- */
    /* ① 主题名必须来自深层配色表。
       上一版兜底分支还写着 `NEST_THEME_LIGHT[...]`，而那个常量已经删了 ——
       冒烟和截图都碰不到兜底分支，只有 nest-check 3609 项跑满时才会走到，
       一走到就是 ReferenceError（玩家卡在某层、控制台报错、画面全黑）。 */
    ok(typeof L.theme === "string" && L.theme.indexOf("nest-") === 0,
       `第 ${d} 层主题名指向地底配色`, String(L.theme));
    /* ② 收成目标必须**严格小于这一层物理上可得的上限**。
       41 层踩过：一行 water 坑被当成"火坑"（cap 翻倍），5 只敌人的层
       算出目标 8，而实际最多收 7 —— 目标超过上限，是死局不是难度。 */
    if (L.goal === "collect") {
      const foes = L.waves.reduce((n, w) => n + w.length, 0);
      const fire = (L.pits || []).some(q => q.kind === "fire");
      const cap = fire ? foes * 2 : Math.round(foes * 1.4);
      ok(L.collect < cap, `第 ${d} 层收成目标低于可得上限`, `${L.collect} vs cap ${cap}`);
    }
    ok(L.waves.length >= 2, `第 ${d} 层至少两波（小怪 + BOSS）`);
    ok(JSON.stringify(L.waves[L.waves.length - 1].map(f => f.foe)) === '["boss"]',
       `第 ${d} 层最后一波是 BOSS`);

    /* ---- 雾巢（2026-10-27）：巢室 / 种类分散 / 菌光囊 ----
     * 这三条都对应"玩起来才会发现、但发现时已经晚了"的事：
     *   ① 巢室丢失 → HUD 上写着 undefined，且池子退回全局（怪物又都一样）
     *   ② 一层只有一种怪 → 用户那句话原样复发
     *   ③ 囊摆到缝口/出生点 → 要么一进场白捡，要么永远够不着
     */
    ok(L.brood && typeof L.brood.name === "string" && L.brood.name.length > 0,
       `第 ${d} 层有巢室名`, String(L.brood && L.brood.id));
    {
      /* BOSS 不算：它每层都在，凑不进"多样性"。
         只数小怪波（除最后一波）。 */
      const kinds = new Set();
      for (let wi = 0; wi < L.waves.length - 1; wi++) {
        for (const f of L.waves[wi]) kinds.add(f.foe);
      }
      /* 2 只是浅层的下限（n1 = 2），轮转必须让它们不是同一种 ——
         否则"第 1 层两只 bug"就是用户看到的全部。
         只有一只小怪的层（席位不够）不参与这条：它连"重复"都谈不上。 */
      const nSmall = L.waves.slice(0, -1).reduce((n, w) => n + w.length, 0);
      ok(kinds.size >= Math.min(2, nSmall), `第 ${d} 层小怪至少 2 种剪影`,
         [...kinds].join("/") + `（共 ${nSmall} 只）`);
    }
    {
      const pods = L.pods || [];
      ok(pods.length >= 2 && pods.length <= 3, `第 ${d} 层菌光囊 2~3 个`, `${pods.length} 个`);
      const bad = [];
      for (const p of pods) {
        if (p.x < NL + 40 || p.x + p.w > NR - 40) bad.push("出井 " + p.x);
        /* 裂缝/出生点只对**地面上的囊**成立：台上的囊在缝的正上方，
           光不会串，玩家也不可能在台上"一进场就捡到"。 */
        if (p.y === 556) {
          for (const c of (L.chasms || [])) {
            const gut = G.NEST_FOG.POD_CHASM;
            if (p.x + p.w > c.x - gut && p.x < c.x + c.w + gut) bad.push("贴缝 " + p.x);
          }
          if (Math.abs(p.x + p.w / 2 - L.spawn.x) < 80) bad.push("压出生点 " + p.x);
        }
        /* 站在台面上时 y 必须是那块台的 y（否则囊浮在半空） */
        const on = L.plats.some(q => p.y === q.y && p.x >= q.x - 2 && p.x + p.w <= q.x + q.w + 2);
        if (!on) bad.push("悬空 " + p.x + "@" + p.y);
      }
      ok(bad.length === 0, `第 ${d} 层菌光囊位置合法`, bad.join(" / "));
      /* 至少一个在地上：全在台上的话每层的囊都在同一个视平线上。 */
      ok(pods.some(p => p.y === 556), `第 ${d} 层至少一个菌光囊在地面`);
    }
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
  /* 现在是**按层号**索引（k=0 对应主线 462 / 深巢 446）。
     深巢第 4 层（116）复用 k=2 的料（见 NEST_LIB.kitOf），所以只验 3 组。 */
  const lib = G.NEST_LIB;
  ok(lib.ledges[0].length > 5, `构件库 k=0（主线 462）有料`, `${lib.ledges[0].length} 条`);
  ok(lib.ledges[1].length > 5, `构件库 k=1（主线 350）有料`, `${lib.ledges[1].length} 条`);
  ok(lib.ledges[2].length > 3, `构件库 k=2（主线 248）有料`, `${lib.ledges[2].length} 条`);
  /* 深巢层表本身：4 层、层距 110、最顶层不钻洞顶（洞顶岩体 y≈90） */
  ok(G.NEST.LAYERS.length === 4, "深巢 4 层台", `${G.NEST.LAYERS.length} 层`);
  ok(G.NEST.LAYERS.every((y, i) => i === 0
      ? G.GROUND_Y - y === G.NEST.LAYER_GAP
      : G.NEST.LAYERS[i - 1] - y === G.NEST.LAYER_GAP),
    "深巢层距恒为 110", G.NEST.LAYERS.join(" / "));
  ok(G.NEST.LAYERS[G.NEST.LAYERS.length - 1] > 95, "最顶层不钻洞顶（> 95）",
    `最顶 ${G.NEST.LAYERS[G.NEST.LAYERS.length - 1]}`);
  /* 跳跃可达：v²/2g = 780²/(2×2100) ≈ 145，层距 110 必须留 ≥ 20 余量 */
  const jumpH = (780 * 780) / (2 * 2100);
  ok(jumpH - G.NEST.LAYER_GAP > 20, "单跳能上一层且余量 > 20",
    `跳高 ${jumpH.toFixed(1)} / 层距 ${G.NEST.LAYER_GAP}`);
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
