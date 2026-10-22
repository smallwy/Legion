/* ============================================================================
   _bg-shot.js —— 只拍背景的验收图（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   为什么单独一个脚本：调背景时要一次看四关的同一帧（第 1/2/4 关各一张，
   其中第 4 关是"斜坡"关，也是用户说"太堵"的那一关）。
   用 grove-shot.js 跑全套要 20 多张，调一次背景等 10 秒，改不动。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_bg-shot.js
     NODE_PATH=... node tools/_bg-shot.js 3          # 只拍第 4 关（索引 3）

   产物落 ../shots/_bg-s<索引>.png（`_` 前缀，不入库）。
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

const args = process.argv.slice(2);
const stages = args.length ? args.map((a) => parseInt(a, 10)) : [0, 1, 3];

for (const st of stages) {
  const { P, S, canvas } = boot();
  P._start(0, st);
  /* 走 40 帧：HUD 的淡入、宠物的呼吸、浮尘都动起来了。
     但它们会挡住背景 —— 调背景时干脆把角色/敌人/HUD 全清掉，
     只看"空场"长什么样。 */
  for (let i = 0; i < 40; i++) P.tick(1 / 60);
  S.foes.length = 0;
  S.balls.length = 0;
  S.shots.length = 0;
  S.hudT = 99;
  P.render();
  const f = path.join(OUT, (process.env.PREFIX || "_bg-") + "s" + st + ".png");
  fs.writeFileSync(f, canvas.toBuffer("image/png"));
  console.log("  " + f);
}
