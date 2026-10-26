/* ============================================================================
   _nest-foe-shot.js —— 深巢四只新怪的立绘验收图（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   为什么不复用 `_foe-shot.js`：那个脚本的核心动作是**注入 PNG 再对比注不注图**，
   它验的是"贴图有没有盖住代码图形"。深巢四只新怪**全是代码图形**，没有贴图，
   所以那个对照是空的。这里只做一件事：把它们摆成一排，看清剪影。

   验的三件（对应三处最容易白干的判断）：
     1. **剪影能不能分开** —— 四只并排、缩到 100%，还认不认得出是四种东西。
        盲蛛靠八条折腿、石壳靠正圆、巢蛾靠上下不对称翅、地脉虫靠体节柱。
        任何一只剪影和别的混了，就是重画，不是"再调调"。
     2. **石壳的裂纹转不转** —— 圆各向同性，滚动本身看不出来。
        并排三个不同 `x` 的石壳，裂纹位置必须错开，否则就是"一个不动的圆"。
     3. **巢蛾的三态**（常态 / 被照亮 / 烧焦）和**地脉虫的探头**（缩回 / 半出 / 全出）
        —— 这两只是"有状态才教学得会"的怪，光看常态图看不出问题。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_nest-foe-shot.js
     DEPTH=20 node tools/_nest-foe-shot.js
   产物落 ../shots/_nest-foe-*.png（`_` 前缀，不入库）。
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const DEPTH = Number(process.env.DEPTH || 20);
const noop = () => {};

/* 和 _foe-shot 同一套真实 canvas 桩：深巢要画岩壁/地缝光，桩里没有真 ctx 的话
   `globalCompositeOperation`、渐变这些全是 noop，出来是一片黑 —— 看不出对错。 */
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

/** 进深巢并停在可渲染状态。**必须走 enterNest**（和 nest-play 同一理由：
 *  它是"玩家点门那条路"，直接 loadLevel 会漏掉换表与存档两件事）。 */
function enter(P, depth) {
  P.enterNest(depth);
  P._start(1, 0);
  const S = P.S;
  S.shots.length = 0;
  S.balls.length = 0;
  S.foes.length = 0;
  S.p.hp = 999;
  /* `S.hudT` 是**不存在的字段** —— `_foe-shot.js` 里那行一直在空转。
     关卡开场大字是 `addText(W/2, 150, "深巢 · 第 N 层", ...)` 生成的**浮动文字**，
     住在 `S.texts` 里、活 1.6 秒。清掉数组才是真的关掉它。 */
  S.texts.length = 0;
  return S;
}

/** 摆一排。返回 { x, y } 让调用方知道每只站在哪。
 *
 *  三个坑：
 *   · `foeFromSpec` 的 y 是**底边**不是中心；
 *   · 深巢地面有裂缝（`CHASMS`），敌人站在缝上会半个身子悬空；
 *   · 宠物出生点贴着地面右侧，四只铺满地面时**一定会踩到它头上**
 *     （第一版地脉虫就被短尾犬整个盖住，"看不见"其实是被队友挡了）。
 *     所以优先找一条够宽的台面；台面都不够宽才退回地面，并把宠物挪到最左。 */
function lineUp(P, S, keys, opt) {
  opt = opt || {};
  const L = P.NEST.L, R = P.NEST.R;
  const wOf = (k) => P.FOES[k].vw;
  const totalW = keys.reduce((s, k) => s + wOf(k), 0);
  const needW = totalW + 12 * (keys.length - 1);

  const ledges = (P.PLATS || []).filter(p => p.kind !== "ground");
  const widest = ledges.slice().sort((a, b) => b.w - a.w)[0];

  let baseY, x0, spanW, onLedge = false;
  if (!opt.ground && widest && widest.w >= needW) {
    baseY = widest.y; x0 = widest.x; spanW = widest.w; onLedge = true;
  } else {
    baseY = P.GROUND_Y; x0 = L; spanW = R - L;
    S.p.x = L + 34;                 // 把宠物挪开，别挡敌人
  }

  const gapW = Math.max(10, (spanW - totalW - 40) / Math.max(1, keys.length - 1));
  let x = x0 + Math.max(16, (spanW - totalW - gapW * (keys.length - 1)) / 2);

  const placed = [];
  keys.forEach((k, i) => {
    const f = P.foeFromSpec({ foe: k, x: x + wOf(k) / 2, y: baseY, lv: 1 }, false);
    f.vx = 0; f.vy = 0; f.face = 1; f.stun = 0; f.chargeT = 999;
    f.dir = 0; f.hitT = 0;
    f.coat = 0;
    if (opt.tweak) opt.tweak(f, i);
    S.foes.push(f);
    placed.push({ x: f.x, y: baseY, k });
    x += wOf(k) + gapW;
  });
  return { baseY, placed, onLedge, ledgeW: widest ? widest.w : 0 };
}

function shot(canvas, name) {
  const f = path.join(OUT, name + ".png");
  fs.writeFileSync(f, canvas.toBuffer("image/png"));
  console.log("  " + f);
  return f;
}

const NEW4 = ["spider", "shell", "moth", "vein"];

async function main() {
  console.log("=== 深巢四只新怪 · 立绘验收（第 " + DEPTH + " 层）===");

  /* ---- 图 1：剪影并排（核心那张）---- */
  {
    const { P, canvas } = boot();
    const S = enter(P, DEPTH);
    const r = lineUp(P, S, NEW4);
    for (let i = 0; i < 8; i++) P.tick(1 / 60);   // 让腿/翅到动画相位
    S.foes.forEach(f => { f.vx = 0; f.vy = 0; });
    S.texts.length = 0;
    P.render();
    shot(canvas, "_nest-foe-lineup");
    console.log("    baseY=" + r.baseY + (r.onLedge ? "（台面 " + r.ledgeW + "）" : "（地面）") +
      "  foes=" + S.foes.length +
      "  摆位 " + r.placed.map(p => p.k + "@" + Math.round(p.x)).join(" "));
  }

  /* ---- 图 2：石壳滚动相位（三个不同 x，轮廓与裂纹必须错开）---- */
  {
    const { P, canvas } = boot();
    const S = enter(P, DEPTH);
    lineUp(P, S, ["shell", "shell", "shell"], {
      tweak: (f, i) => { f.x = 300 + i * 137; f.rollV = 600; },
    });
    for (let i = 0; i < 6; i++) P.tick(1 / 60);
    S.texts.length = 0;
    P.render();
    shot(canvas, "_nest-foe-shell-spin");
  }

  /* ---- 图 3：巢蛾三态（常态 / 被照亮 / 烧焦）---- */
  {
    const { P, canvas } = boot();
    const S = enter(P, DEPTH);
    lineUp(P, S, ["moth", "moth", "moth"], {
      tweak: (f, i) => {
        f.litOn = i <= 1;
        f.dazzled = i === 2 ? 1 : 0;
        f.y -= 34;                       // 抬离台面：它是飞的，脚不落地
      },
    });
    for (let i = 0; i < 8; i++) P.tick(1 / 60);
    S.texts.length = 0;
    P.render();
    shot(canvas, "_nest-foe-moth");
  }

  /* ---- 图 4：地脉虫探头（缩回 / 半出 / 全出）---- */
  {
    const { P, canvas } = boot();
    const S = enter(P, DEPTH);
    lineUp(P, S, ["vein", "vein", "vein"], {
      tweak: (f, i) => {
        f.boreUp = i === 0 ? 0 : 1;
        f._veinK = i === 0 ? 0 : i === 1 ? 0.5 : 1;
      },
    });
    /* 只 render 不 tick：tick 会跑 updateFoe 把 boreUp 按 boreT 重写，
       那就测不到"三种高度"了 —— 这一张要的是绘制侧的形变。 */
    S.texts.length = 0;
    P.render();
    shot(canvas, "_nest-foe-vein");
  }

  /* ---- 图 5：真机长相（整层地形 + 真实刷出来的敌人）---- */
  {
    const { P, canvas } = boot();
    const S = enter(P, DEPTH);
    /* 敌人是分波刷的，40 帧（0.67s）内可能一只都还没出来 —— 第一版就是
       "0 只"然后拿去当"场景看起来没问题"。给足 4 秒。 */
    for (let i = 0; i < 240 && S.foes.length === 0; i++) P.tick(1 / 60);
    for (let i = 0; i < 30; i++) P.tick(1 / 60);
    S.texts.length = 0;
    P.render();
    shot(canvas, "_nest-foe-scene");
    console.log("    真实刷怪 " + S.foes.length + " 只：" +
      S.foes.map(f => (f.def && f.def.name ? f.def.name : f.kind)).join(" / "));
  }

  console.log("\n完成，输出在 " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
