/* ============================================================================
   _jumper-shot.js —— 跳虫的离屏验收图（不开浏览器）
   ----------------------------------------------------------------------------
   拍的就是**玩家要读的那三个瞬间**，因为跳虫的全部信息都在这三段里：
     1. 蹲身预告（crouch）—— 橙色三角闪 + 身体压扁，"要来了"
     2. 滞空（pounce）  —— 走固定抛物线，"能躲"
     3. 落到上层        —— 和玩家同层，"该你打了"

   为什么必须出图：这三段任何一段读不出来，跳虫就从"机制"退化成"暗算"，
   而它在代码里是三个字段（crouch / pounce / landT），测试断言只能验
   数值在走，验不了"人看得出"。上一轮词条也是靠图才发现整张卡读不出来。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_jumper-shot.js
   产物落 ../shots/_jumper-*.png（`_` 前缀，不入库）。
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const W = 960, H = 600;
const ROOT = path.resolve(__dirname, "..");
const HTML = path.join(ROOT, "prototype", "grove.html");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const noop = () => {};

try { GlobalFonts.registerFromPath("C:/Windows/Fonts/msyh.ttc", "YaHei"); } catch (e) {}
try { GlobalFonts.registerFromPath("C:/Windows/Fonts/msyhbd.ttc", "YaHeiBold"); } catch (e) {}

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

/* 注入真机贴图。不注入时 `hudSkin()` 会走深色皮肤、文字变浅，
   而卡面仍是无条件奶白底 —— 整张读不出来（_clear-shot.js 已记过）。 */
async function injectArt(P) {
  const dir = path.join(ROOT, "assets/resources/grove");
  const walk = (d) => {
    const out = [];
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) { out.push(...walk(full)); continue; }
      if (f.endsWith(".png")) out.push(full);
    }
    return out;
  };
  let n = 0;
  const keys = new Set();
  for (const full of walk(dir)) {
    try {
      const key = path.relative(dir, full).replace(/\.png$/, "").split(path.sep).join("-");
      P.setArt(key, await loadImage(full));
      keys.add(key);
      n++;
    } catch (e) { console.warn("载入失败 " + full, e.message); }
  }
  if (!keys.has("ui-tip")) throw new Error("ui-tip 没注进去，出图会是错的");
  return n;
}

function shot(canvas, name) {
  const f = path.join(OUT, "_jumper-" + name + ".png");
  fs.writeFileSync(f, canvas.toBuffer("image/png"));
  console.log("  " + f);
}

async function run() {
  const { P, canvas } = boot();
  await injectArt(P);

  P._start(0, 5);                      // 第 6 屏（有跳虫的屏）
  const S = P.S;

  /* 清场，只留我们要拍的东西 —— 画面里堆 10 只虫会看不出谁在蹲 */
  S.foes.length = 0;
  S.balls.length = 0;
  S.shots.length = 0;
  S.drops.length = 0;

  /* 找一个 462 的台面，玩家站上去；虫放它正下方的地面 */
  const led = P.PLATS.filter((p) => p.kind === "ledge" && p.y === 462)
    .sort((a, b) => b.w - a.w)[0];
  const px = led.x + led.w * 0.62;
  S.p.x = px; S.p.y = 462; S.p.vx = 0; S.p.vy = 0;
  S.p.hp = 4; S.p.maxHp = 4;
  S.p.cool = 99;                       // 不让他自己开火，画面干净

  const f = P.foeFromSpec({ foe: "bug", x: px - 150, y: 556, lv: 1 }, false);
  f.jumper = 1;
  f.jumpCd = 0;
  S.foes.push(f);

  /* 一只普通巡逻虫作对照 —— "橙色三角 = 会扑你"这件事必须能对比出来 */
  const g2 = P.foeFromSpec({ foe: "bug", x: px + 170, y: 556, lv: 1 }, false);
  g2.jumper = 0;
  S.foes.push(g2);

  let frames = 0;
  const step = (n) => { for (let i = 0; i < n; i++) { P.tick(1 / 60); frames++; } };

  /* ---- 1. 蹲身预告：进 crouch 后立刻拍 ---- */
  step(4);
  console.log("  蹲身? crouch=" + f.crouch.toFixed(2) + " jumper=" + f.jumper +
              " y=" + f.y.toFixed(0));
  P.render(); shot(canvas, "01-crouch");

  /* ---- 2. 滞空中（vy 还在负值 = 正在上升） ---- */
  let guard = 0;
  while (!(f.vy < -80 && !f.onGround) && guard++ < 120) step(1);
  step(6);
  console.log("  滞空? vy=" + f.vy.toFixed(0) + " y=" + f.y.toFixed(0) +
              " pounce=" + f.pounce.toFixed(2));
  P.render(); shot(canvas, "02-air");

  /* ---- 3. 落到上层：必须和玩家同层，玩家才打得回去 ---- */
  guard = 0;
  while (!f.onGround && guard++ < 200) step(1);
  step(8);
  console.log("  落地? y=" + f.y.toFixed(0) + " 玩家 y=" + S.p.y.toFixed(0) +
              " landT=" + f.landT.toFixed(2));
  P.render(); shot(canvas, "03-landed");

  console.log("");
  console.log("落点 y=" + f.y.toFixed(0) + "，台面 y=" + 462 +
              " → " + (Math.abs(f.y - 462) < 2 ? "落在台面上 ✓" : "没上台面 ✗"));
}

run().catch((e) => { console.error(e); process.exit(1); });
