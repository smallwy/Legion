/* ===========================================================================
   震屏归因探针 —— 把每一次"点火"归到具体代码行
   ---------------------------------------------------------------------------
   `_shake-probe.js` 只告诉你"抖了多少"，回答不了"是谁在抖"。
   12 处 `S.shake = Math.max(...)` 散在 7000 行里，靠读代码猜会猜错 ——
   真实的噪声源往往是那个"看起来完全合理"的小震（3 或 5），
   因为它的**触发频率**高，把衰减中的震动一次次续上，画面就永远停不下来。

   做法：在探针里把 `S.shake` 换成访问器，凡是"新值 > 旧值"就记一笔，
   从调用栈里取出**第一个属于本文件的函数名**当标签。

   —— 为什么要在探针里拦，而不是在源码里加 `S.shakeWhy`：
      那会在 12 处各加一行只为测试服务的代码，而且以后每加一处震屏
      都得记得再加；拦截式探针是零侵入的，源码改了它自动跟上。

   跑法：NODE_PATH=... node client/tools/_shake-who.js [秒数] [种子]
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");
const SECS = Number(process.argv[2] || 40);
const SEED = Number(process.argv[3] || 7);

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("找不到内联脚本"); process.exit(1); }

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;
const S = L.S;
const DT = 1 / 60;

/* ---- 拦截 S.shake ------------------------------------------------ */
let shVal = 0;
const fire = {};        // 标签 → { n, peak, 累计注入幅度 }
const decay = { n: 0 };

/* 从调用栈里找第一个 `function xxx` / 箭头所在的函数名。
   snowlab 的函数都是具名 function 声明，栈里会写 `at drawDoor (...)`。 */
function label(stack) {
  const lines = stack.split('\n').slice(1);
  for (const ln of lines) {
    const mm = /at\s+([A-Za-z_$][\w$]*)\s/.exec(ln);
    if (!mm) continue;
    const fn = mm[1];
    if (fn === 'Object.set' || fn === 'set') continue;
    return fn;
  }
  return '?';
}

Object.defineProperty(S, 'shake', {
  configurable: true,
  get() { return shVal; },
  set(v) {
    const prev = shVal;
    shVal = v;
    if (v > prev) {
      const k = label(new Error().stack);
      const rec = fire[k] || (fire[k] = { n: 0, peak: 0, sum: 0 });
      rec.n++;
      rec.sum += (v - prev);
      if (v > rec.peak) rec.peak = v;
    } else if (v < prev) {
      decay.n++;
    }
  },
});

/* ---- 开局 + 操作脚本（同 _shake-probe.js，便于两边数字对照） ---- */
L.newLevel(SEED);
for (let i = 0; i < 60; i++) L.step(DT);

let dir = 0, phase = 0;
function drive(f) {
  const t = f * DT;
  const seg = Math.floor(t / 2.2);
  if (seg !== phase) { phase = seg; dir = (seg % 2) ? 1 : -1; }
  S.keys['a'] = false; S.keys['d'] = false;
  if (t - seg * 2.2 > 0.35) S.keys[dir > 0 ? 'd' : 'a'] = true;
  const jt = Math.floor(t / 1.7) * 1.7;
  S.keys['w'] = (t > jt + 0.05 && t < jt + 0.16);
  if (f % Math.round(0.18 / DT) === 0) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j' }));
    window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'j' }));
  }
}

const FRAMES = Math.round(SECS / DT);
/* 额外统计：有多少帧处于"正在抖"，以及最长一段连续抖动。
   **最长那一段要留曲线** —— 只看"1.57 秒"没意义：
   "一次尖峰 + 单调回落"是余震（好），"尖峰-回落-又抬回"是被人连续续命（坏）。
   两者在单个数字上完全一样。 */
let shakeFrames = 0, run = 0, runMax = 0, runEnd = 0;
const curve = [];
for (let f = 0; f < FRAMES; f++) {
  drive(f);
  L.step(DT);
  curve.push(S.shake);
  if (S.shake > 0) { shakeFrames++; run++; if (run > runMax) { runMax = run; runEnd = f; } }
  else run = 0;
}

/* 把最长那一段的曲线按每 3 帧采样打出来（120 列太密，3 帧一采约 20Hz） */
const seg0 = Math.max(0, runEnd - runMax + 1);
const seg = curve.slice(seg0, runEnd + 1);
console.log("最长一段（" + (runMax / 60).toFixed(2) + " 秒）的幅度曲线，3 帧一采：");
console.log("    " + seg.filter((_, i) => i % 3 === 0).map(v => v.toFixed(1)).join(" "));
console.log("");

const rows = Object.entries(fire).sort((a, b) => b[1].n - a[1].n);
const total = rows.reduce((s, r) => s + r[1].n, 0);
console.log("种子 " + SEED + " · " + SECS + " 秒 · 点火 " + total + " 次");
console.log("画面有位移 " + (shakeFrames / FRAMES * 100).toFixed(1) + "% · 最长一段连续抖动 " +
            (runMax / 60).toFixed(2) + " 秒");
console.log("");
console.log("  点火次数   占比    峰值   累计注入   来源函数");
for (const [k, v] of rows) {
  console.log("  " + String(v.n).padStart(6) + "   " +
    (v.n / total * 100).toFixed(1).padStart(5) + "%  " +
    v.peak.toFixed(0).padStart(4) + "px  " +
    v.sum.toFixed(1).padStart(7) + "px   " + k);
}
