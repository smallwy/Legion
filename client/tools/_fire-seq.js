/* ============================================================================
   _fire-seq.js —— 拍火焰的连续帧，用来验"它到底有没有在动"
   ----------------------------------------------------------------------------
   静帧截图根本证明不了动画：一张好看的静帧和一个好看的循环动画，
   在单帧上完全一样。所以这个脚本按固定间隔连拍，再由 _fire-sheet.py
   拼成序列图 —— 只要相邻帧之间**轮廓和亮度都变了**，才是真的在烧。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_fire-seq.js [关卡索引]
   产物：shots/_fire-f0.png ... _fire-f7.png（`_` 前缀，不入库）
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const noop = () => {};

function boot() {
  const code = fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
  const main = createCanvas(W, H);
  main.style = {};
  main.addEventListener = noop;
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN,
    document: {
      getElementById: () => main,
      createElement: () => {
        const c = createCanvas(1, 1);
        c.style = {};
        c.addEventListener = noop;
        return c;
      },
    },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return { P: sb.GROVE, S: sb.GROVE.S, canvas: main };
}

const stage = parseInt(process.argv[2] || "0", 10);
const { P, S, canvas } = boot();
P._start(0, stage);
for (let i = 0; i < 40; i++) P.tick(1 / 60);
S.foes.length = 0;
S.balls.length = 0;
S.shots.length = 0;
S.hudT = 99;

/* 每 0.09 秒一帧 —— 火焰的主频在 7~24 Hz 之间，
   0.09s 刚好跨过一到两个周期，相邻两帧一定有肉眼可见的差别。 */
const STEP = 9;                     // 帧数
for (let f = 0; f < 8; f++) {
  for (let i = 0; i < STEP; i++) P.tick(1 / 60);
  P.render();
  const p = path.join(OUT, "_fire-f" + f + ".png");
  fs.writeFileSync(p, canvas.toBuffer("image/png"));
  console.log("  " + p + "  t=" + S.t.toFixed(2));
}
