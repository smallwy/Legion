/* ===========================================================================
   震屏探针 —— 只打印数字，不判 pass/fail
   ---------------------------------------------------------------------------
   用户反馈「现在的震动效果太强烈了 满屏的震动」。这种反馈**不能靠感觉调参**：
   "太强"可能是幅度大（一次抖 14px），也可能是**一直在抖**（3~5px 被反复
   点燃，画面永远停不下来）—— 后者在单帧截图里一张也看不出来，
   只有连续统计才暴露。

   所以这里跑一局"像人一样操作"的游戏（连发 J + 左右移动 + 定期跳），
   逐帧记录 `S.shake`，统计：

     · 抖的时间占比：有多少帧 shake > 0（= 画面有位移）
     · 幅度分层：>0 / ≥2 / ≥5 / ≥8 / ≥12 各占多少
     · 触发频次：从 0 跳到 >0 的次数（= "抖了一下"的次数）
     · 最大幅度

   **判据只在游戏里定：一局里画面应该有"安静期"。**
   如果 shake > 0 的帧占比接近 100%，那就是"满屏震动"，不是打击感。

   跑法：NODE_PATH="$HOME/.workbuddy/.../node_modules" node client/tools/_shake-probe.js [秒数] [种子]
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
const FRAMES = Math.round(SECS / DT);

/* 开局：定种子建关 */
L.newLevel(SEED);
for (let i = 0; i < 60; i++) L.step(DT);          // 让敌人落地、箱子落定

/* 操作脚本：尽量贴近"一个在推进的玩家"，而不是站桩。
   连发 J 是震屏最密的来源（子弹打箱子 3、翻台阶 3），必须覆盖到；
   左右走 + 定期跳，让球和箱子也吃上。 */
const keys = ['a', 'd'];
let dir = 0, phase = 0;
function drive(f) {
  const t = f * DT;
  /* 每 2.2 秒换一次方向；换向时给 0.35 秒静止，避免"贴墙摩擦"这种假动作 */
  const seg = Math.floor(t / 2.2);
  if (seg !== phase) { phase = seg; dir = (seg % 2) ? 1 : -1; }
  S.keys['a'] = false; S.keys['d'] = false;
  const inSeg = t - seg * 2.2;
  if (inSeg > 0.35) S.keys[dir > 0 ? 'd' : 'a'] = true;
  /* 每 1.7 秒跳一次 */
  S.keys['w'] = (Math.floor(t / 1.7) * 1.7 + 0.05 > t && Math.floor(t / 1.7) * 1.7 + 0.16 < t);
  /* 每 0.18 秒一发（连发手速上限），走 dispatch 保证走的是真实按键路径 */
  if (f % Math.round(0.18 / DT) === 0) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j' }));
    window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'j' }));
  }
}

const hist = { gt0: 0, ge2: 0, ge5: 0, ge8: 0, ge12: 0 };
let maxSh = 0, bursts = 0, prev = 0, sum = 0;
const perSec = [];

for (let f = 0; f < FRAMES; f++) {
  drive(f);
  L.step(DT);
  const sh = S.shake;
  sum += sh;
  if (sh > maxSh) maxSh = sh;
  if (sh > 0) hist.gt0++;
  if (sh >= 2) hist.ge2++;
  if (sh >= 5) hist.ge5++;
  if (sh >= 8) hist.ge8++;
  if (sh >= 12) hist.ge12++;
  /* 上升沿 = "抖了一下"。prev 已经衰减到 0 之后的第一次抬升才算新的一次。 */
  if (sh > 0 && prev === 0) bursts++;
  prev = sh;
  if (f % 60 === 59) { perSec.push(bursts); }
}

const pct = n => (n / FRAMES * 100).toFixed(1) + "%";
console.log("种子 " + SEED + " · " + SECS + " 秒 · " + FRAMES + " 帧");
console.log("");
console.log("  画面有位移的帧      " + hist.gt0 + " / " + FRAMES + "  = " + pct(hist.gt0));
console.log("  幅度 ≥2 的帧        " + hist.ge2 + "  = " + pct(hist.ge2));
console.log("  幅度 ≥5 的帧        " + hist.ge5 + "  = " + pct(hist.ge5));
console.log("  幅度 ≥8 的帧        " + hist.ge8 + "  = " + pct(hist.ge8));
console.log("  幅度 ≥12 的帧       " + hist.ge12 + " = " + pct(hist.ge12));
console.log("");
console.log("  峰值幅度            " + maxSh.toFixed(1) + " px（屏宽 960 的 " + (maxSh / 960 * 100).toFixed(2) + "%）");
console.log("  平均幅度（含静默）  " + (sum / FRAMES).toFixed(2) + " px");
console.log("  抖动次数            " + bursts + " 次 / " + SECS + " 秒  = " + (bursts / SECS).toFixed(1) + " 次/秒");
console.log("");
/* 每秒累计抖动次数，看它是不是"一路平推" —— 有起伏才是打击感，平推是嗡 */
console.log("  每秒累计抖动次数（增量）：");
console.log("    " + perSec.map((v, i) => (i ? v - perSec[i - 1] : v)).join(" "));
