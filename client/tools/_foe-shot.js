/* ============================================================================
   _foe-shot.js —— 敌人立绘验收图（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   为什么单独一个脚本：`_bg-shot.js` 走的是"空场"路线 —— 它把 foes 清空了才
   渲染，专门给调背景用。可敌人立绘恰恰要看清 foes，所以不能复用。

   这里做三件事：
     1. 把 assets/resources/grove/*.png 注入 ART（和 GroveBattle 的
        ART_MANIFEST 同一个动作，只是那边走 resources.load、这边走 loadImage）；
     2. **同屏对比**：四只敌人并排摆在一起 + 三只宠物站在旁边，
        一眼看出"细节密度差几倍" —— 这是诊断文档里的验收标准；
     3. **新旧对比**：同一个位置渲染两遍（注图 / 不注图），拼成上下两张。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_foe-shot.js
     PROTO=../prototype/grove.html node tools/_foe-shot.js

   产物落 ../shots/_foe-*.png（`_` 前缀，不入库）。
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

const KEYS = ["bug", "crow", "boar", "larva", "cat", "dog", "ham", "rab", "ox", "fox"];

async function decodeArt() {
  const art = {};
  for (const k of KEYS) {
    const isFoe = ["bug", "crow", "boar", "larva"].includes(k);
    const f = path.join(RES, isFoe ? "foe" : "pet", k + ".png");   /* 资源已按用途分目录 */
    if (!fs.existsSync(f)) { console.warn("  缺图：" + f); continue; }
    art[(isFoe ? "foe-" : "pet-") + k] = await loadImage(f);
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

/** 把四只敌人摆成一排，站在指定的平台上 —— 唯一变量就是画法本身。
 *
 *  摆位的两个约束（看图才发现的）：
 *   · 地面上 x≈100~160 是花坛、x≈490~535 是篝火，摆在那儿敌人会被挡掉半个身子，
 *     看起来像"画错了"其实是站在装饰后面；
 *   · 敌人要脚踩台面：foeFromSpec 的 y 是**底边**，不是中心。
 *  所以默认走中层那条长台（y=462, x 26..620）—— 干净、无遮挡、又在画面中段。 */
function lineUp(P, S, useGround, coats) {
  const plats = P.PLATS || [];
  const wide = useGround
    ? plats.find((p) => p.kind === "ground")
    : plats.filter((p) => p.kind === "ledge").sort((a, b) => b.w - a.w)[0];
  const baseY = wide ? wide.y : 462;
  const x0 = wide ? wide.x : 26;
  const spanW = wide ? wide.w : 594;

  S.foes.length = 0;
  /* 在可用跨度里等距摆四只：宽度按 vw 累计，算完再居中，
     这样野猪宽、幼虫窄也不会挤成一坨。 */
  const row = ["bug", "crow", "boar", "larva"];
  const wOf = (k) => P.FOES[k].vw;
  const totalW = row.reduce((s, k) => s + wOf(k), 0);
  const gapW = Math.max(6, (spanW - totalW - 40) / (row.length - 1));
  let x = x0 + 20;
  row.forEach((k, i) => {
    const f = P.foeFromSpec({ foe: k, x: x + wOf(k) / 2, y: baseY, lv: 1 }, false);
    f.vx = 0; f.vy = 0; f.face = 1; f.stun = 0; f.chargeT = 999;
    f.dir = 0; f.hitT = 0;
    f.coat = coats ? coats[i] : 0;
    S.foes.push(f);
    x += wOf(k) + gapW;
  });
  S.balls.length = 0;
  return baseY;
}

function shot(canvas, name) {
  const f = path.join(OUT, name + ".png");
  fs.writeFileSync(f, canvas.toBuffer("image/png"));
  console.log("  " + f);
  return f;
}

async function main() {
  const art = await decodeArt();
  console.log("注入 " + Object.keys(art).length + " 张：", Object.keys(art).join(" "));

  /* new / old 两张：同一个关卡、同一个摆位，唯一差别是有没有注入贴图。
     old 走的是三档色代码图形 —— 那就是"断层"那一侧，两张一叠就是证据。 */
  for (const label of ["new", "old"]) {
    const { P, S, canvas } = boot(label === "new" ? art : null);
    P._start(0, 0);
    for (let i = 0; i < 30; i++) P.tick(1 / 60);
    const baseY = lineUp(P, S, process.env.GROUND === "1");
    S.hudT = 99;
    S.shots.length = 0;
    P.render();
    shot(canvas, "_foe-" + label);
    console.log("    baseY=" + baseY + "  foes=" + S.foes.length);
  }

  /* 第三张：真实战斗里敌人站地面（偶尔会被花坛/篝火挡住，那就是真机长相）。
     单独出，因为"摆得漂亮"和"真的在玩"是两件事。 */
  {
    const { P, S, canvas } = boot(art);
    P._start(0, 0);
    for (let i = 0; i < 30; i++) P.tick(1 / 60);
    lineUp(P, S, true);
    S.hudT = 99;
    S.shots.length = 0;
    P.render();
    shot(canvas, "_foe-ground");
  }

  /* 第四张：包裹层（coat 0→3）。这是这个游戏**唯一的血条**，
     也是敌人立绘最容易被盖住的地方 —— 虫子的触角、乌鸦的翅膀尖都可能
     被发光环压掉。有没有贴图，这张图才看得出来"贴图配不配得上血条"。 */
  {
    const { P, S, canvas } = boot(art);
    P._start(0, 0);
    for (let i = 0; i < 30; i++) P.tick(1 / 60);
    lineUp(P, S, false, [1, 2, 3, 3]);
    S.hudT = 99;
    S.shots.length = 0;
    P.render();
    shot(canvas, "_foe-coat");
  }

  console.log("\n完成，输出在 " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
