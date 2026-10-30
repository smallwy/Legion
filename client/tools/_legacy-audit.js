/* 存量盘点：把 grove（苔原古道 27 屏 + 深巢无尽）的**难度曲线参数**导成表。

   为什么需要这个工具
   ------------------
   2026-10-30 用户问：「最初的那 2 个玩法完全丢弃吗 为什么你设计不考虑之前有没有用」。
   查下来是规划时漏了存量：CR-031 那篇 48 关曲线，grove 的 27 屏手工关早就
   手工做过一遍（层层递进的机制 + 章末 Boss + 星级），而且深巢无尽和我在
   snowlab 重造的「深潜」几乎是同一个东西（连种子公式 `depth*7919` 都同源）。

   决定 snowlab 是下一代之后，27 屏不能就这么扔 —— 它身上最贵的东西不是
   那 27 张绝对坐标的图（迁不过去），而是**每屏用几个怪、几颗球、
   什么目标、卡什么 par**这一串数字。那串数字是手工调出来的。

   本工具只读不写，输出两张表：
     1. 27 屏逐屏参数（人看）
     2. snowlab 48 关逐关参数（对照）
   然后人工比对：哪一段 grove 有约束、snowlab 只有"进门"。

   用法：
     node _legacy-audit.js            # 两张表都打
     node _legacy-audit.js grove      # 只看 27 屏
     node _legacy-audit.js snowlab    # 只看 48 关
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const which = (process.argv[2] || "all").toLowerCase();

function load(file, exportName) {
  const html = fs.readFileSync(path.join(ROOT, "prototype", file), "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.requestAnimationFrame = () => 0;
  w.eval(m[1]);
  const api = w[exportName];
  if (!api) throw new Error(file + " 没有导出 " + exportName);
  return api;
}

const pad = (s, n) => String(s).padEnd(n, " ");
const padL = (s, n) => String(s).padStart(n, " ");
const bar = (n, max, width) => "█".repeat(max > 0 ? Math.max(0, Math.round(n / max * width)) : 0);

/* =========================================================================
   一、grove 27 屏
   ========================================================================= */
function groveTable() {
  const G = load("grove.html", "GROVE");
  const L = G.LEVELS;

  /* 每屏的"约束强度"来自这几件事同时成立：目标类型不是纯清场、
     球有额度、par 里用球数被卡住。把它们拆开数出来。 */
  const rows = L.map((lv, i) => {
    const foes = [].concat(...lv.waves).filter(f => f && f.foe);
    const kinds = {};
    for (const f of foes) kinds[f.foe] = (kinds[f.foe] || 0) + 1;
    const pits = lv.pits || [];
    const pitKinds = {};
    for (const p of pits) pitKinds[p.kind] = (pitKinds[p.kind] || 0) + 1;
    return {
      n: i + 1,
      id: lv.id,
      name: lv.name,
      theme: lv.theme,
      goal: lv.goal,
      limit: lv.ballLimit || 0,
      collect: lv.collect || 0,
      parT: (lv.par && lv.par.time) || 0,
      parM: (lv.par && lv.par.made) || 0,
      plats: (lv.plats || []).length,
      ramps: (lv.ramps || []).length,
      pits: pits.length,
      pitKinds,
      stumps: (lv.stumps || []).length,
      grounds: (lv.grounds || []).length,
      waves: (lv.waves || []).length,
      foes: foes.length,
      kinds,
      boss: foes.some(f => f.foe === "boss") || lv.id.indexOf("boss") >= 0,
      camp: lv.camp ? 1 : 0,
    };
  });

  console.log("\n========== grove 苔原古道 · 27 屏逐屏参数 ==========");
  console.log(
    pad("#", 3) + pad("id", 14) + pad("名字", 8) + pad("主题", 10) +
    pad("目标", 9) + padL("球额", 5) + padL("collect", 8) + padL("par秒", 6) + padL("par球", 6) +
    padL("台", 4) + padL("坡", 4) + padL("坑", 4) + padL("桩", 4) + padL("波", 4) + padL("怪", 4) + pad(" 怪种", 24) + "Boss"
  );
  for (const r of rows) {
    const kn = Object.keys(r.kinds).map(k => k + "×" + r.kinds[k]).join(" ");
    console.log(
      pad(r.n, 3) + pad(r.id, 14) + pad(r.name, 8) + pad(r.theme, 10) +
      pad(r.goal, 9) + padL(r.limit || "-", 5) + padL(r.collect || "-", 8) +
      padL(r.parT, 6) + padL(r.parM, 6) +
      padL(r.plats, 4) + padL(r.ramps, 4) + padL(r.pits, 4) + padL(r.stumps, 4) +
      padL(r.waves, 4) + padL(r.foes, 4) + pad(" " + kn, 24) + (r.boss ? "★" : "")
    );
  }

  /* 目标类型分布 —— 这是 snowlab 最缺的东西 */
  const goalCount = {};
  for (const r of rows) goalCount[r.goal] = (goalCount[r.goal] || 0) + 1;
  console.log("\n目标类型分布：" + Object.entries(goalCount).map(([k, v]) => k + " " + v + " 屏").join(" · "));

  /* 难度阶梯：怪数 / 台面数 随屏号的变化，和 par.time 一起看 */
  const maxFoe = Math.max(...rows.map(r => r.foes));
  console.log("\n怪数曲线（每格 1 只，" + maxFoe + " 只满格）：");
  for (const r of rows) {
    console.log("  " + padL(r.n, 2) + " " + pad(r.name, 8) + padL(r.foes, 3) + " " + bar(r.foes, maxFoe, 40));
  }

  const g = G.GATES, nest = G.NEST;
  console.log("\n深巢无尽配置：" + JSON.stringify(nest));
  console.log("深巢词条 " + (G.NEST_MODS || []).length + " 条：" +
    (G.NEST_MODS || []).map(m => m.depth + "层" + (m.cn || m.id || "")).join(" · "));
  console.log("出征门：" + g.map(x => x.id + "(" + x.name + " open=" + x.open + ")").join(" · "));
  return rows;
}

/* =========================================================================
   二、snowlab 48 关
   ========================================================================= */
function snowTable() {
  const L = load("snowlab.html", "SNOWLAB");
  const S = L.S;
  const STAGES = L.STAGES || null;

  console.log("\n========== snowlab 雪原推球 · 48 关逐关参数 ==========");
  console.log(
    pad("关", 4) + pad("骨架", 8) + padL("层", 4) + padL("箱子", 6) + padL("怪", 5) +
    pad(" 怪种", 24) + padL("洞", 4) + padL("坡", 4) + padL("石", 4) + padL("铁", 4) + padL("冰", 4) + " 目标"
  );

  const skelCn = (L.SKELETONS && Object.fromEntries(Object.entries(L.SKELETONS).map(([k, v]) => [k, v.cn]))) || {};
  const rows = [];
  for (let n = 1; n <= 48; n++) {
    L.startStage(n);
    const lv = S.level || {};
    const boxes = (lv.boxes || []).filter(b => !b.dead);
    const mat = b => b.mat || b.kind || "?";
    const iron = boxes.filter(b => mat(b) === "iron").length;
    const ice = boxes.filter(b => mat(b) === "ice").length;
    const stone = boxes.filter(b => mat(b) === "stone").length;
    const foes = (S.foes || []).filter(f => !f.dead);
    const kinds = {};
    for (const f of foes) kinds[f.breed] = (kinds[f.breed] || 0) + 1;
    const holes = (lv.layers || []).reduce((a, ly) => a + ((ly.holes || []).length), 0);
    const ramps = (lv.plats || []).filter(p => p.kind === "ramp").length;
    rows.push({
      n, skel: lv.skel, floors: lv.nFloors, boxes: boxes.length, foes: foes.length,
      kinds, holes, ramps, stone, iron, ice,
    });
    console.log(
      pad(n, 4) + pad(skelCn[lv.skel] || lv.skel || "-", 8) + padL(lv.nFloors || 0, 4) +
      padL(boxes.length, 6) + padL(foes.length, 5) +
      pad(" " + Object.keys(kinds).map(k => k + "×" + kinds[k]).join(" "), 24) +
      padL(holes, 4) + padL(ramps, 4) + padL(stone, 4) + padL(iron, 4) + padL(ice, 4) + " 进门"
    );
  }

  if (STAGES) console.log("\nSTAGES：" + JSON.stringify(STAGES));

  /* 唯一目标类型 = 进门。这是和 grove 最大的结构差 */
  console.log("\n目标类型：1 种（进门）。grove 有 clear/limit/chain/collect 四种。");

  const maxFoe = Math.max(...rows.map(r => r.foes));
  console.log("\n怪数曲线（每格 1 只，" + maxFoe + " 只满格）：");
  for (const r of rows) {
    console.log("  " + padL(r.n, 2) + " " + pad(r.skel || "-", 6) + padL(r.foes, 3) + " " + bar(r.foes, maxFoe, 40));
  }

  /* 箱子数离散度：同一段内最大/最小 —— 曲线是否真的收窄 */
  const segs = STAGES || [];
  let from = 1;
  console.log("\n每段箱子数离散度（同段内 max/min）：");
  for (const s of segs) {
    const part = rows.filter(r => r.n >= from && r.n <= s.to);
    if (!part.length) { from = s.to + 1; continue; }
    const bs = part.map(r => r.boxes);
    const mn = Math.min(...bs), mx = Math.max(...bs);
    console.log("  关 " + pad(from, 3) + "~" + pad(s.to, 3) + "  箱子 " + mn + "~" + mx + "  倍率 " + (mx / mn).toFixed(2));
    from = s.to + 1;
  }
  return rows;
}

if (which === "all" || which === "grove") groveTable();
if (which === "all" || which === "snowlab") snowTable();
