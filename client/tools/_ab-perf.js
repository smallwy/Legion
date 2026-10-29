/* ===========================================================================
   绘制优化 A/B 探针 —— 同一次运行里对比"开缓存 / 关缓存"
   ---------------------------------------------------------------------------
   为什么不用 `_perf-probe.js` 的绝对数字：
   这台机器上后台进程会抢 CPU，同一个版本两次跑能差一倍（step 都跟着变），
   绝对毫秒数说明不了任何事。

   **同进程交替跑 A/B，噪音被抵消**，只看比值。
   两边跑同一个种子、同样的帧数、同样的输入脚本。

   跑法：NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
         node client/tools/_ab-perf.js [帧数] [种子]
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");
const N = Number(process.argv[2] || 180);
const SEED = Number(process.argv[3] || 7);
const W = 960, H = 600;

/* `OLD=` 指另一份 html（比如 `git show HEAD:...` 导出的），
   用来量"优化前 vs 优化后"的整体差距。不传就只做同文件的 A/B。 */
const OLD = process.env.OLD ? path.resolve(process.env.OLD) : null;
const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const oldHtml = OLD ? fs.readFileSync(OLD, "utf8") : null;
const oldM = oldHtml ? oldHtml.match(/<script>([\s\S]*?)<\/script>/) : null;

/* 一个独立实例：自己的 jsdom、自己的画布、自己的离屏策略 */
function make(useCache, useOld) {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  const src = useOld ? oldHtml : html;
  const mm = useOld ? oldM : m;
  const dom = new JSDOM(src, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = () => g;
  window.requestAnimationFrame = () => 0;
  window.eval(mm[1]);
  const L = window.SNOWLAB;
  if (L.setOffscreen) L.setOffscreen(useCache ? ((w, h) => createCanvas(w, h)) : (() => null));
  L.newLevel(SEED);
  return { L, S: L.S, g };
}

/* 输入脚本两边必须一字不差，否则比的是"谁走得远"而不是"谁画得快" */
function drive(S, f) {
  const DT = 1 / 60, t = f * DT;
  const seg = Math.floor(t / 2.2);
  S.keys['a'] = false; S.keys['d'] = false;
  if (t - seg * 2.2 > 0.35) S.keys[(seg % 2) ? 'd' : 'a'] = true;
  S.keys['w'] = (Math.floor(t / 1.7) * 1.7 + 0.05 > t && Math.floor(t / 1.7) * 1.7 + 0.16 < t);
}

function bench(useCache, warm, useOld) {
  const { L, S } = make(useCache, useOld);
  const DT = 1 / 60;
  for (let i = 0; i < warm; i++) { drive(S, i); L.step(DT); L.draw(); }
  const stepT = [], drawT = [];
  for (let f = 0; f < N; f++) {
    drive(S, f);
    let t0 = process.hrtime.bigint();
    L.step(DT);
    stepT.push(Number(process.hrtime.bigint() - t0) / 1e6);
    t0 = process.hrtime.bigint();
    L.draw();
    drawT.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  return { stepMed: med(stepT), drawMed: med(drawT), drawAvg: avg(drawT) };
}

/* 交替跑三轮：A B A B A B，取各自中位，抵消"越跑越慢"这类漂移 */
const A = [], B = [], O = [];
for (let r = 0; r < 3; r++) {
  A.push(bench(false, 90, false));
  B.push(bench(true, 90, false));
  if (OLD) O.push(bench(false, 90, true));
}
const pick = (arr, k) => arr.map(o => o[k]).sort((a, b) => a - b)[1];

const aD = pick(A, 'drawMed'), bD = pick(B, 'drawMed');
const aA = pick(A, 'drawAvg'), bA = pick(B, 'drawAvg');
const aS = pick(A, 'stepMed'), bS = pick(B, 'stepMed');

console.log("种子 " + SEED + " · 每轮 " + N + " 帧 · 三轮交替取中位");
console.log("");
console.log("                    逐帧画      缓存        比值");
const row = (name, a, b) => console.log("  " + name.padEnd(14) +
  a.toFixed(2).padStart(7) + "ms" + b.toFixed(2).padStart(10) + "ms" +
  ("  " + (b / a).toFixed(2) + "×").padStart(12));
row("draw 中位", aD, bD);
row("draw 平均", aA, bA);
row("step 中位", aS, bS);
console.log("");
console.log("  （step 两边应当相近 —— 它不受绘制优化影响。若差得多，说明这次测量被环境干扰了。）");
console.log("  一帧合计：逐帧画 " + (aD + aS).toFixed(2) + "ms → 缓存 " + (bD + bS).toFixed(2) + "ms");
if (OLD) {
  const oD = pick(O, 'drawMed'), oS = pick(O, 'stepMed');
  console.log("");
  console.log("  与「优化前那份 html」对比（同样是逐帧画）：");
  console.log("    draw 中位  " + oD.toFixed(2) + "ms → " + bD.toFixed(2) + "ms   " +
              (bD / oD).toFixed(2) + "×   （省 " + ((1 - bD / oD) * 100).toFixed(0) + "%）");
  console.log("    一帧合计   " + (oD + oS).toFixed(2) + "ms → " + (bD + bS).toFixed(2) + "ms");
}
