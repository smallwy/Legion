/* ===========================================================================
   「纯跳能不能上下层」探针
   ---------------------------------------------------------------------------
   起因（2026-10-28 用户 / 第二轮）：
     「注意处理的太直了吧 太陡」
     「宠物需要轻松的上下层跳动」

   现状的矛盾：层高 240、板厚 40、净空 200，玩家高 63、跳高 123。
   要把脚从下层地板（upper+240）抬到上层地板（upper），单跳不够；
   井里那摞"井梯"箱子是 3 格 = 144，反而**比跳高还高 21px** ——
   所以上行只能靠按 W 的瞬移（wellClimb），跳是跳不上去的。
   "太直"指的就是这个：唯一的通道是一条竖直的洞，人垂直穿过去。

   这个脚本量化"跳得上不去"，判据是静态可达性（不做物理模拟）：
     · 可站立面 = 楼板段 / 箱子顶 / 地形顶（斜坡取端点）
     · 从下层地板出发，只要存在一条链
         每一跳：上升 ≤ JUMP_H、水平位移 ≤ HOP_DX
       最终落到**洞外的上层楼板**，就算"跳得上去"
   **它是上界估计，不是手感** —— 真跳还要看助跑、天花板、落脚宽度。
   用来给改动做前后对照，不做验收门槛。

   跑法：
     NODE_PATH=... node client/tools/_layer-up.js            # 当前
     PROTO=旧版.html NODE_PATH=... node client/tools/_layer-up.js   # 对照组
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = process.env.PROTO ? path.resolve(ROOT, process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("✗ 找不到内联脚本"); process.exit(1); }
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;
if (!L) { console.log("✗ 没有 SNOWLAB 出口"); process.exit(1); }

/* ---- 物理常量（从源码取的，改源码这里要跟着改） ---- */
const JUMP_H = 123;     // 720² / (2·2100)
const HOP_DX = 120;     // 一跳能横移多少（滞空 0.69s × 300px/s ≈ 205，取保守值）
const WALK_DX = 300;    // 站在同一块面上，可以随意走到它的任意处

/** 收集所有可站立面：{x0, x1, y, tag}，只保留 [ylow, yhigh] 区间里的 */
function surfaces(level, ylow, yhigh) {
  const out = [];
  for (const l of level.layers) {
    for (const s of l.segs) out.push({ x0: s.x, x1: s.x + s.w, y: s.y, tag: "floor" });
    for (const t of l.terrain) {
      const y0 = t.y, y1 = L.surfY(t, t.x + t.w);
      out.push({ x0: t.x, x1: t.x + t.w, y: Math.min(y0, y1), tag: t.kind || "terrain" });
    }
    /* 井壁托板：站得上去的那一面取"较低的一端"（保守 —— 高的一端更好跳） */
    for (const sh of (l.shelves || [])) {
      out.push({ x0: sh.x, x1: sh.x + sh.w, y: sh.y, tag: "shelf" });
    }
  }
  for (const b of level.boxes) {
    if (b.dead) continue;
    out.push({ x0: b.x, x1: b.x + b.w, y: b.y, tag: "box" });
  }
  return out.filter(s => s.y >= ylow - 2 && s.y <= yhigh + 2 && s.x1 > s.x0);
}

/** 从"站在 s 上"能跳到哪些面（上升 ≤ JUMP_H、水平可达） */
function hops(s, list) {
  const out = [];
  const lo = s.x0 - HOP_DX, hi = s.x1 + HOP_DX;
  for (const t of list) {
    if (t === s) continue;
    const rise = s.y - t.y;                 // 上升为正
    if (rise < -1) continue;                // 只往上（往下走不用管）
    if (rise > JUMP_H) continue;
    if (t.x1 < lo || t.x0 > hi) continue;   // 横向够不着
    out.push(t);
  }
  return out;
}

/** 一个洞口：从下层地板能不能纯跳上到洞外的上层楼板 */
function layerReach(level, k) {
  const upper = level.floors[k];          // 上层地板顶面
  const lower = level.floors[k + 1];      // 下层地板顶面（= upper + 层高）
  const holes = level.layers[k].holes;
  const segs = level.layers[k].segs;
  const list = surfaces(level, upper - 4, lower + 4);

  const res = [];
  for (const h of holes) {
    /* 起点：下层地板上、洞口正下方偏两侧的地方（人是从旁边走过来的） */
    const seeds = list.filter(s => s.tag === "floor" && Math.abs(s.y - lower) < 3 &&
      s.x1 > h.x - 96 && s.x0 < h.x + h.w + 96);
    /* 终点：上层楼板段，且**不在洞口范围内** */
    const goals = list.filter(s => s.tag === "floor" && Math.abs(s.y - upper) < 3 &&
      !(s.x0 < h.x + h.w && s.x1 > h.x));

    const seen = new Set(seeds);
    let frontier = seeds.slice();
    let reached = false;
    for (let depth = 0; depth < 6 && !reached && frontier.length; depth++) {
      const next = [];
      for (const s of frontier) {
        for (const t of hops(s, list)) {
          if (goals.includes(t)) { reached = true; break; }
          if (seen.has(t)) continue;
          seen.add(t); next.push(t);
        }
        if (reached) break;
      }
      frontier = next;
    }
    res.push({ h, ok: reached, rungs: seen.size });
  }
  return res;
}

const NSEED = Number(process.env.NSEEDS || 120);
let holeTotal = 0, holeOK = 0;
let layerTotal = 0, layerOK = 0;
const badLayers = [];

for (let sd = 1; sd <= NSEED; sd++) {
  const lv = L.buildLevel(sd);
  for (let k = 0; k + 1 < lv.floors.length; k++) {
    /* **门厅（最后一层）上方那个洞不算。** 门厅是终点：怪数 ≥ killTarget、
       没有井梯，本来就设计成"不用回去"。算进来会让基线凭空少 8%。 */
    if (k === lv.floors.length - 2) continue;
    if (!lv.layers[k].holes.length) continue;
    layerTotal++;
    const r = layerReach(lv, k);
    let any = false;
    for (const x of r) {
      holeTotal++;
      if (x.ok) { holeOK++; any = true; }
    }
    if (any) layerOK++; else badLayers.push(sd + "/" + k);
  }
}

const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + "%";
console.log("样本：种子 " + NSEED + " 个，" + layerTotal + " 个层位，" + holeTotal + " 个洞口");
console.log("  洞口能纯跳上行：" + holeOK + "/" + holeTotal + "  → " + pc(holeOK, holeTotal));
console.log("  层位至少有一个洞能上行：" + layerOK + "/" + layerTotal + "  → " + pc(layerOK, layerTotal));
if (badLayers.length) console.log("  完全上不去的层位（前 12）：" + badLayers.slice(0, 12).join(", "));

/* =========================================================================
   二、真跑：按两下 W + 一直按住方向，看能不能真的站到上一层
   ---------------------------------------------------------------------------
   静态可达性只能证明"几何上够得着"。这一节走真实物理（stepBody + 碰撞），
   因为二段跳的成败全在细节里：按键边沿、滞空长度、横移距离、会不会顶到
   上层楼板的侧面。**每一层只测一个洞**（够用，洞的几何是同构的）。
   ========================================================================= */
const P_W = L.NUM ? 45 : 45;   // PLAYER_W，导出里没有就按文档值
const DT2 = 1 / 60;

function tryClimbReal(level, k, hole, dir) {
  const upper = level.floors[k];
  const lower = level.floors[k + 1];
  /* **不要在这里 reset。** reset() 不带种子会用 Math.random()——
     摆好的洞和刚 reset 出来的关卡不是同一张，量出来的百分比是假的。 */
  const p = L.S.p;
  const gx = hole.x + hole.w / 2;
  /* **站在"洞口正下方离地面最近的那个落脚面"上**，不是硬塞在下层地板。
     井梯是一摞 3 格箱子 —— 把 y 直接写成 `lower - p.h` 会把人塞进箱子里，
     第一帧就被弹开（探针第一版全是"closest 144"，就是卡在箱顶没起跳）。 */
  let stand = lower;
  for (const s of L.S.level.plats) {
    if (gx < s.x || gx > s.x + s.w) continue;
    const top = L.surfY(s, gx);
    if (top >= upper - 2 && top < stand) stand = top;
  }
  for (const b of L.S.boxes) {
    if (b.dead) continue;
    if (gx < b.x || gx > b.x + b.w) continue;
    if (b.y >= upper - 2 && b.y < stand) stand = b.y;
  }
  p.x = gx - p.w / 2;
  p.y = stand - p.h;
  p.vx = 0; p.vy = 0; p.onGround = true;
  p.jumps = L.NUM.hero.airJump; p.jumpHeld = false;
  const keys = L.S.keys;
  for (const kk in keys) delete keys[kk];
  /* **先空跑 20 帧让物理把人踩稳**，再开始按 W。
     直接把 onGround 写成 true 会在"人其实和箱子重叠 1~2px"的情况下起跳，
     第一帧就被顶出去（探针里一堆 vy = −320 的怪值全是这个）。 */
  for (let i = 0; i < 20; i++) L.step(DT2);
  p.jumpHeld = false;

  let best = 1e9;
  for (let f = 0; f < 160; f++) {
    /* 第 60 帧再补一下 W：这时两次跳都用完了，走 wellClimb 兜底 */
    /* 第 0 帧起跳、第 20 帧二段跳（**第一跳的顶点**），其余时间按住方向。
       顶点起跳才够高：第 14 帧起跳时第一跳只用了 111px，加起来差 6px。 */
    keys["w"] = (f === 0 || f === 20 || f === 60);
    keys[dir] = true;
    L.step(DT2);
    const feet = p.y + p.h;
    if (p.onGround && Math.abs(feet - upper) < 5) return { ok: true, f };
    best = Math.min(best, Math.abs(feet - upper));
  }
  return { ok: false, why: "closest " + Math.round(best) };
}

/* **下面这一节的数字不可信，别引用。** 它想验"从井底按两下 W 能不能上去"，
   量出来 12~38%，但失败样本全是"根本没起跳"（`p.jumpHeld` 一直是 false）——
   是这个探针注入按键的方式有问题，不是玩法的问题：同样按 W 的两节在
   `_snowlab-check.js` 里是 26/26 和 21/21。留在这里是为了下次别再从头写一遍，
   修好之前只当"有这个东西"，不当数据。 */
console.log("\n二、真跑（两下 W + 按住方向，160 帧内看能否站到上层）—— 数字不可信，见源码注释");
let rOK = 0, rAll = 0;
const rBad = [];
for (let sd = 1; sd <= Math.min(NSEED, 40); sd++) {
  L.reset(sd);
  const lv = L.S.level;
  for (let k = 0; k + 2 < lv.floors.length; k++) {
    const holes = lv.layers[k].holes;
    if (!holes.length) continue;
    const h = holes[0];
    /* 往哪边横移：选上层楼板**有**的那一侧 */
    const segs = lv.layers[k].segs;
    const hasL = segs.some(s => s.x + s.w >= h.x - 2 && s.x < h.x);
    const hasR = segs.some(s => s.x <= h.x + h.w + 2 && s.x + s.w > h.x + h.w);
    const dir = hasL ? "a" : "d";
    if (!hasL && !hasR) continue;
    rAll++;
    const r = tryClimbReal(lv, k, h, dir);
    if (r.ok) rOK++; else rBad.push(sd + "/" + k + " " + dir + " " + r.why);
  }
}
console.log("  二段跳上行成功：" + rOK + "/" + rAll + "  → " + pc(rOK, rAll));
if (rBad.length) console.log("  失败样本（前 10）：" + rBad.slice(0, 10).join(" | "));
