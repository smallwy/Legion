/* ============================================================================
   _bet-shot.js —— 「加注」的视觉验收图（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   验的只有一件事：**玩家在场上能不能看出这颗球已经变值钱了。**

   这条容易白干，因为加注的全部改动都在数值里（收成曲线），
   而"数值改了不等于玩家知道"。所以这里把 holds=1/2/3/4/5 五颗球并排摆开，
   缩到 100% 看：
     · 3 只起有没有那圈呼吸金环（和"剩余的气"那圈 r+6 要分得开）
     · 装载数 `x4 +3` 在那个直径上会不会糊成一团
     · 4/5 只的球半径变大之后，字还压不压得住球面

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_bet-shot.js
   产物落 ../shots/_bet-*.png（`_` 前缀，不入库）。
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
  const mem = {};
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN,
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    },
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
  return { P: sb.GROVE, canvas: main };
}

function shot(canvas, name) {
  const p = path.join(OUT, name + ".png");
  fs.writeFileSync(p, canvas.toBuffer("image/png"));
  console.log("  " + p);
  return p;
}

/** 造一颗装着 n 只的球。半径必须按**真实的**算式重算 ——
 *  直接 new 一个 { holds: n } 会得到 r=22 的假球，看着比真机小一半，
 *  "字装不装得下"这个判断当场作废。 */
function ballWith(P, S, n, x, y) {
  const foes = S.foes.filter(f => !f.dead);
  P.makeBallFrom(foes[0], 0, 0);
  const b = S.balls[S.balls.length - 1];
  b.holds = n;
  b.packed = new Array(n).fill(foes[0].def);
  b.r = 20 + Math.min(16, n * 2.8);
  b.w = b.r * 2; b.h = b.r * 2;
  b.x = x; b.y = y;
  b.vx = 0; b.vy = 0;
  b.air = 1;
  b.spin = 0.6;
  return b;
}

console.log("\n=== 「加注」视觉验收 ===");

/* ---- 图 1：五颗球并排（核心那张）---- */
{
  const { P, canvas } = boot();
  P._start(0);
  const S = P.S;
  S.shots.length = 0;
  S.balls.length = 0;
  S.texts.length = 0;
  S.p.hp = 999;
  S.p.dead = false;

  const gy = P.GROUND_Y;
  const ns = [1, 2, 3, 4, 5];
  let x = 190;
  for (const n of ns) {
    const b = ballWith(P, S, n, x, gy - 40);
    b.y = gy - b.r - 1;
    x += 128;
  }
  /* 把剩下的人清掉，别挡球 */
  S.foes.length = 0;
  S.balls = S.balls.filter(b => !b.dead);

  for (let i = 0; i < 4; i++) P.tick(1 / 60);
  S.balls.forEach(b => { b.vx = 0; b.vy = 0; });
  P.render();
  shot(canvas, "_bet-lineup");
  console.log("  球数=" + S.balls.length +
    "  半径=" + S.balls.map(b => Math.round(b.r)).join("/") +
    "  加注=" + S.balls.map(b => P.holdBonus(b.holds)).join("/"));
}

/* ---- 图 2：深色场景（深巢）里金球立不立得住 ----
 *  主线是绿草地 + 黄绿球，金色和背景的对比还算好；深巢是暗紫岩洞，
 *  金黄在暗底上会**炸得很亮**，也可能反而糊成一片。这两个场景都要看，
 *  因为同一套颜色在两套主题下的读数差得远。 */
{
  const { P, canvas } = boot();
  P.enterNest(12);
  P._start(1, 0);
  const S = P.S;
  S.shots.length = 0; S.balls.length = 0; S.texts.length = 0;
  S.p.hp = 999;
  const gy = P.GROUND_Y;
  const b3 = ballWith(P, S, 2, 300, gy - 60);
  b3.y = gy - b3.r - 1;
  const b4 = ballWith(P, S, 4, 500, gy - 60);
  b4.y = gy - b4.r - 1;
  S.foes.length = 0;
  S.balls = S.balls.filter(b => !b.dead);
  S.balls.forEach(b => { b.vx = 0; b.vy = 0; });
  P.render();
  shot(canvas, "_bet-nest");
  console.log("  深巢对照：x2（绿）vs x4（金）");
}

/* ---- 图 3：石球 —— 从"能滚的球"变成"能踩的砖" ----
 *  验三件：① 颜色读不读得出"石头"（不是灰版球）；
 *          ② 气圈有没有去掉（留着就是骗人，它不漏气了）；
 *          ③ 玩家站上去的画面成不成立（脚踩在球顶、不是陷进去）。 */
{
  const { P, canvas } = boot();
  P._start(0);
  const S = P.S;
  S.shots.length = 0; S.balls.length = 0; S.texts.length = 0;
  P.CHASMS.length = 0;
  const gy = P.GROUND_Y;

  const b1 = ballWith(P, S, 2, 300, gy);
  b1.y = gy; b1.vx = 0; b1.pushed = true;
  const b2 = ballWith(P, S, 1, 620, gy);
  b2.y = gy; b2.vx = 0; b2.pushed = true;
  S.foes.length = 0;
  S.balls = S.balls.filter(b => !b.dead);

  P.hardenBall(b1);          // 左边：石球（里面装着 2 只）
  /* 右边那颗留成普通球做对照 —— 一眼看出"灰的"和"绿的"不是同一件事 */

  /* 玩家站在石球上 */
  const p = S.p;
  p.x = process.env.NOPLAYER ? 900 : b1.x;
  p.y = b1.y - b1.r;
  p.vx = 0; p.vy = 0;
  p.onGround = true;
  p.ground = { x: b1.x - b1.r * 0.62, y: b1.y - b1.r, w: b1.r * 1.24, kind: "ball", ball: b1 };
  p.hp = 999;

  for (let i = 0; i < 3; i++) P.tick(1 / 60);
  P.render();
  shot(canvas, "_stone-scene");
  console.log("  左：石球 holds=" + b1.holds + " stone=" + !!b1.stone +
    " air=" + b1.air.toFixed(2) + "   右：普通球 stone=" + !!b2.stone);
}

console.log("");
