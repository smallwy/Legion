/* ============================================================================
   _snow-shot.js —— 雪原主题验收图（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   目的单一：把「暖金森林（第 1 关）」和「雪原（第 2 关）」放在同一张图上，
   看两件事：
     1. 雪面有没有被压成灰地（SNOW_DIM 0.90 那条例外到底对不对）；
     2. 木平台/角色/弹丸在白底上还读不读得出来 —— 雪地真正的风险不是"不像雪"，
        是"该看见的东西看不见了"。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_snow-shot.js

   产物落 ../shots/_snow-*.png（`_` 前缀，不入库）。
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const RES = path.join(__dirname, "..", "assets", "resources", "grove");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const noop = () => {};

async function decodeArt() {
  const art = {};
  const pets = ["cat", "dog", "ham", "rab", "ox", "fox"];
  const foes = ["bug", "crow", "boar", "larva"];
  for (const k of pets) {
    const f = path.join(RES, "pet-" + k + ".png");
    if (fs.existsSync(f)) art["pet-" + k] = await loadImage(f);
  }
  for (const k of foes) {
    const f = path.join(RES, "foe-" + k + ".png");
    if (fs.existsSync(f)) art["foe-" + k] = await loadImage(f);
  }
  return art;
}

function boot(art) {
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
  const P = sb.GROVE;
  if (art) for (const k in art) P.setArt(k, art[k]);
  return { P, S: P.S, canvas: main };
}

function shot(canvas, name) {
  const f = path.join(OUT, name + ".png");
  fs.writeFileSync(f, canvas.toBuffer("image/png"));
  console.log("  " + f);
  return f;
}

/** 跑一关到"已经打起来"的状态：刷完开场波、走两步、让落雪滚起来 */
function stage(num, art) {
  const { P, S, canvas } = boot(art);
  P._start(0, num);
  for (let i = 0; i < 40; i++) P.tick(1 / 60);
  S.hudT = 99;
  S.shots.length = 0;
  P.render();
  return { P, S, canvas };
}

async function main() {
  const art = await decodeArt();
  console.log("注入 " + Object.keys(art).length + " 张");

  console.log("第 1 关（暖金森林，tundra）：");
  const a = stage(0, art);
  shot(a.canvas, "_snow-0-tundra");

  console.log("第 2 关（雪原，snow）：");
  const b = stage(1, art);
  shot(b.canvas, "_snow-1-snow");
  console.log("    关卡名 = " + b.P.LEVELS[b.S.stage].name +
              "  snow 标记 = " + !!b.P.THEMES[b.P.LEVELS[b.S.stage].theme].snow);

  console.log("\n完成，输出在 " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
