/* ===========================================================================
   顿帧探针 —— 只打印数字，不判 pass/fail
   ---------------------------------------------------------------------------
   用户反馈「总感觉一卡一卡的」。这和震屏是**两件不同的事**：

     · 震屏（S.shake）只改变画面往哪偏，时间照常推进；
     · 顿帧（S.hitStop）是真的让 `step()` 提前 return ——
       这一帧角色、球、粒子、镜头**全都不动**，只有 S.t 推进 1/4。

   所以"卡"只能是后者。要量三件事：

     ① 有多少帧被顿住（`step()` 进去第一句就 return）；
     ② 最长**连续**顿住多少帧 —— 单帧 50ms 是打击感，连续 30 帧是卡死；
     ③ 谁在点火、点火多密。

   ③ 用属性拦截抓调用栈归因（和 `_shake-who.js` 同一个手法）。
   重点是看**两次点火的间隔是否小于第一次的剩余时长** —— 若是，
   `Math.max` 语义会让它永远续命，球碾过箱堆时就是"一直卡着不动"。

   跑法：NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
         node client/tools/_stop-probe.js [秒数] [种子]
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

/* ---- 拦截 S.hitStop：凡"新值 > 旧值"就是一次点火，记时长 + 归因 ---- */
const fires = {};          // 标签 -> { n, 总时长, 各次时长 }
let fireCount = 0, fireSum = 0;
const fireLog = [];        // { t, dur, tag }
let _hs = S.hitStop;
Object.defineProperty(S, 'hitStop', {
  configurable: true,
  get() { return _hs; },
  set(v) {
    if (v > _hs) {
      const st = new Error().stack.split('\n').slice(1);
      let tag = '?';
      for (const line of st) {
        const mm = /at\s+([A-Za-z_$][\w$]*)\s/.exec(line);
        if (!mm) continue;
        if (mm[1] === 'Object.set' || mm[1] === 'set' || mm[1] === 'hitStop') continue;
        tag = mm[1]; break;
      }
      /* **`_hs > 0` 才是"续命"。** 上一帧的顿帧还没走完就又被抬高，
         画面就一直是"停着"的状态。这一条比时长本身更要紧：
         单次 110ms 是"有分量"，连着三次 110ms 就是"卡住了"。 */
      const chained = _hs > 0;
      const dur = v - _hs;          // 这一下"延长"了多少
      fireCount++; fireSum += v;
      (fires[tag] || (fires[tag] = { n: 0, sum: 0, max: 0 })).n++;
      fires[tag].sum += v;
      if (v > fires[tag].max) fires[tag].max = v;
      fireLog.push({ t: S.t, dur: v, tag, chained: chained });
    }
    _hs = v;
  },
});
S.hitStop = 0;

const DT = 1 / 60;
const FRAMES = Math.round(SECS / DT);

L.newLevel(SEED);
for (let i = 0; i < 60; i++) L.step(DT);

/* 操作脚本和震屏探针保持一致，两边的数字才可比 */
let dir = 0, phase = 0;
function drive(f) {
  const t = f * DT;
  const seg = Math.floor(t / 2.2);
  if (seg !== phase) { phase = seg; dir = (seg % 2) ? 1 : -1; }
  S.keys['a'] = false; S.keys['d'] = false;
  const inSeg = t - seg * 2.2;
  if (inSeg > 0.35) S.keys[dir > 0 ? 'd' : 'a'] = true;
  S.keys['w'] = (Math.floor(t / 1.7) * 1.7 + 0.05 > t && Math.floor(t / 1.7) * 1.7 + 0.16 < t);
  if (f % Math.round(0.18 / DT) === 0) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j' }));
    window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'j' }));
  }
}

let frozen = 0, run = 0, runMax = 0, runEnd = 0;
const perSec = new Array(SECS).fill(0);
const tfrozen = [];   // 每个连续段的起点（秒）

for (let f = 0; f < FRAMES; f++) {
  drive(f);
  const h0 = S.hitStop;
  L.step(DT);
  if (h0 > 0) {
    frozen++;
    run++;
    perSec[Math.min(SECS - 1, Math.floor(f * DT))]++;
    if (run === 1) tfrozen.push(f * DT);
    if (run > runMax) { runMax = run; runEnd = f; }
  } else run = 0;
}

const pct = n => (n / FRAMES * 100).toFixed(1) + "%";
console.log("种子 " + SEED + " · " + SECS + " 秒 · " + FRAMES + " 帧");
console.log("");
console.log("  被顿住的帧          " + frozen + " / " + FRAMES + "  = " + pct(frozen));
console.log("  最长连续顿住        " + runMax + " 帧 = " + (runMax / 60).toFixed(2) + " 秒" +
            (runMax ? "（结束于 " + (runEnd / 60).toFixed(2) + " 秒）" : ""));
console.log("  点火次数            " + fireCount + " 次  = " + (fireCount / SECS).toFixed(1) + " 次/秒");
console.log("  理论上限            " + (fireSum / SECS * 100).toFixed(1) + "% 的时间（各次时长求和，未算重叠）");
console.log("");
console.log("  每秒被顿住的帧数：");
console.log("    " + perSec.join(" "));
console.log("");
console.log("  连续顿住段的起点（秒）与长度：");
{
  let i = 0, shown = 0;
  while (i < tfrozen.length && shown < 14) {
    const t0 = tfrozen[i];
    let j = i + 1;
    while (j < tfrozen.length && tfrozen[j] - tfrozen[j - 1] < 0.12) j++;
    const t1 = tfrozen[j] ? tfrozen[j] : SECS;
    if (j - i > 1 || t1 - t0 > 0.25) { console.log("    " + t0.toFixed(2) + "s 起，约 " + (t1 - t0).toFixed(2) + " 秒"); shown++; }
    i = j;
  }
}
console.log("");
console.log("  归因（谁在点火）：");
const rows = Object.entries(fires).sort((a, b) => b[1].n - a[1].n);
for (const [tag, v] of rows.slice(0, 8)) {
  console.log("    " + tag.padEnd(14) + v.n + " 次 · 平均 " + (v.sum / v.n * 1000).toFixed(0) +
              "ms · 最长 " + (v.max * 1000).toFixed(0) + "ms");
}
console.log("");
/* **最关键的一条**：两次点火间隔 vs 前一次的剩余时长。
   间隔 < 剩余时长 → 上一帧的顿帧还没走完就续上了（Math.max 续命）。
   球碾过箱堆时若这比例高，画面就是"一直卡着"。 */
{
  const chained = fireLog.filter(f => f.chained).length;
  const gaps = [];
  for (let i = 1; i < fireLog.length; i++) gaps.push(fireLog[i].t - fireLog[i - 1].t);
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const min = gaps.length ? Math.min.apply(null, gaps) : 0;
  console.log("  两次点火的间隔：平均 " + (avg * 1000).toFixed(0) + "ms · 最短 " + (min * 1000).toFixed(0) + "ms");
  console.log("  其中「上一次还没结束就续上」的           " + chained + " / " + fireLog.length + " 次");
}
