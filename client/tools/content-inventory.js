/* ============================================================================
   content-inventory.js —— 内容量盘点：屏数 / 目标分布 / par 合计
   ----------------------------------------------------------------------------
   为什么要有这个（2026-10-27）：
     CR-031 里「8 关 × 1 目标 / 30 分钟内容」这个数是从代码里数出来的 ——
     但 10-24 已经扩到 27 屏，10-25 回写计划书 §7.3 时**还在用 8 关的数**。
     于是定价、销量预期、内容杠杆全都建在一个过期数字上。

     这不是疏忽，是**数内容量这件事没有出口**：只能靠人去翻代码，
     翻一次记在文档里，下次再翻又是一次。文档会过期，脚本不会。

   输出（全部从 grove.html 的 <script> 里数，不读文档）：
     · 屏数、每屏目标类型分布、定义了但没用的目标
     · par 时间合计（熟手目标值，不是实际游玩时长）
     · 星靶格数（StarTargets.ts，27 × 3）
     · 深巢层数上限与词条条数

   用法：node tools/content-inventory.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const code = fs
  .readFileSync(path.join(ROOT, "prototype/grove.html"), "utf8")
  .match(/<script>([\s\S]*)<\/script>/)[1];

/** 从 `const NAME = {` / `[` 起找到配对的右括号，返回这一段源码 */
function block(startMarker) {
  const i = code.indexOf(startMarker);
  if (i < 0) throw new Error("找不到锚点：" + startMarker);
  const openCh = startMarker.trim().slice(-1);
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0;
  for (let k = code.indexOf(openCh, i); k < code.length; k++) {
    if (code[k] === openCh) depth++;
    else if (code[k] === closeCh) {
      depth--;
      if (!depth) return code.slice(i, k + 1);
    }
  }
  throw new Error("括号没闭合：" + startMarker);
}

const goalsDef = block("const GOALS = {");
const defIds = [...goalsDef.matchAll(/^\s{2}([a-z]+):\s*\{/gm)].map((m) => m[1]);

const levels = block("const LEVELS = [");
const gl = [...levels.matchAll(/goal:\s*"([a-z]+)"/g)].map((m) => m[1]);
const cnt = {};
gl.forEach((g) => (cnt[g] = (cnt[g] || 0) + 1));
const used = new Set(gl);

const par = [...levels.matchAll(/par:\s*\{[^}]*time:\s*([0-9.]+)/g)].map((m) => +m[1]);
const parTotal = par.reduce((a, b) => a + b, 0);

const starSrc = fs.readFileSync(path.join(ROOT, "assets/scripts/config/StarTargets.ts"), "utf8");
const starPerStage = /PER_STAGE\s*=\s*(\d+)/.exec(starSrc);
const perStage = starPerStage ? +starPerStage[1] : null;

const modsDef = block("const NEST_MODS = [");
const modCount = (modsDef.match(/id:\s*"/g) || []).length;

const pct = (n, d) => ((n / d) * 100).toFixed(1) + "%";

console.log("内容量盘点（全部从代码数，不读文档）");
console.log("");
console.log("  主线屏数        " + gl.length);
console.log("  par 合计        " + parTotal + " 秒 ≈ " + (parTotal / 60).toFixed(1) + " 分钟（熟手目标值）");
console.log("  平均每屏 par    " + (parTotal / gl.length).toFixed(1) + " 秒");
console.log("  目标实例        " + gl.length + " 个主目标 + " + (perStage ? perStage * gl.length : "?") + " 个星靶");
console.log("  目标类型分布    " + Object.keys(cnt).map((k) => k + ":" + cnt[k]).join("  "));
console.log("  定义了没用      " + (defIds.filter((x) => !used.has(x)).join(", ") || "（无，7 种全用上）"));
console.log("  深巢            程序化生成、无上限 · " + modCount + " 条词条（每 5 层一条）");
console.log("");
console.log("  注：par 是「熟手达标线」，不是首通时长。首通按 ×1.4~1.8 估。");
