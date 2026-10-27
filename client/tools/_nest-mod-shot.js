/* ============================================================================
   _nest-mod-shot.js —— 词条 / 巢币 / 看板的离屏验收图（不开浏览器）
   ----------------------------------------------------------------------------
   验的四件事，每件都是"截图之外看不出来"的对立面：
     1. 看板列得对不对（6 条词条、价格、余额），文字有没有压线/出框
     2. 钱不够时的反馈长什么样（"还差 N"必须看得见，不是静默失败）
     3. 局内 HUD 带不带词条（下了三层以后，这是唯一不用切界面能看到的地方）
     4. 结算卡报不报巢币（不然玩家不知道那 30 枚哪来的）

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_nest-mod-shot.js
   产物落 ../shots/_nest-mod-*.png（`_` 前缀，不入库）。
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

function boot(save) {
  const code = fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
  const main = createCanvas(W, H);
  main.style = {};
  main.addEventListener = noop;
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
  const mem = {};
  if (save) mem["pawpack.save.v1"] = JSON.stringify(save);
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

/**
 * 注入真机贴图。
 *
 * **不注入的话这几张图全是假的。** `hudSkin()` 靠 `!!artOf("ui-tip")` 决定
 * 走奶油皮肤还是深色玻璃皮肤，没注入就返回 `cream:false`（浅绿字），
 * 而结算卡用的 `creamCard()` 是**无条件**画奶白底 —— 于是渲出来是
 * "奶白卡 + 浅绿字"，整张卡读不出来。
 *
 * 第一版就是没注入，把「深巢结算卡过曝」当成新 bug 查了半天，
 * 最后拍了一张主线对照卡，发现主线也一模一样 —— 不是深巢的问题，
 * 是出图工具没上贴图。`_clear-shot.js` 早写过这段注释，这次没抄过来。
 */
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
      /* 键沿用 `目录-文件名` 老约定（ui/tip.png -> ui-tip），
         磁盘布局分不分家都不影响绘制侧的 artOf() 键名。 */
      const key = path.relative(dir, full).replace(/\.png$/, "").split(path.sep).join("-");
      P.setArt(key, await loadImage(full));
      keys.add(key);
      n++;
    } catch (e) {
      console.warn("载入失败 " + full, e.message);
    }
  }
  /* 硬断言而不是"看着像就行"：`hudSkin()` 只认 ui-tip 这一张。
     它没进来，下面七张图全是错的，而且看不出错在哪。 */
  if (!keys.has("ui-tip")) throw new Error("ui-tip 没注进去，出图会是错的（见 injectArt 注释）");
  return n;
}

/* 起一个"装了贴图"的实例。所有用例都走这里，别直接调 boot() ——
   漏注入的图不会报错，只会静默画成错的。 */
async function open(save) {
  const b = boot(save);
  await injectArt(b.P);
  return b;
}

function shot(P, canvas, name) {
  P.render();
  const f = path.join(OUT, "_nest-mod-" + name + ".png");
  fs.writeFileSync(f, canvas.toBuffer("image/png"));
  console.log("  " + f);
}

async function run() {
  /* ---- 1. 看板：六条全解锁、巢币充足（深 31 的历史最深） ---- */
  {
    const { P, canvas } = await open({ nestCoins: 240, perkLv: {}, apples: 300, logs: 40, shards: 6 });
    P.writeNestDepth(30);
    P.openGates();
    P.openModBoard();
    P.S.modBoard.hover = 0;
    shot(P, canvas, "01-board");
  }

  /* ---- 2. 看板：钱不够。要的是"还差 N"那句话，不是静默失败 ---- */
  {
    const { P, canvas } = await open({ nestCoins: 12, perkLv: {}, apples: 300, logs: 40, shards: 6 });
    P.writeNestDepth(30);
    P.openGates();
    P.openModBoard();
    P.skipModAt(0);
    for (let i = 0; i < 6; i++) P.tick(1 / 60);
    shot(P, canvas, "02-board-poor");
  }

  /* ---- 3. 看板：已经关掉两条（灰掉的行必须一眼看得出"已关"） ---- */
  {
    const { P, canvas } = await open({ nestCoins: 240, perkLv: {}, apples: 300, logs: 40, shards: 6 });
    P.writeNestDepth(30);
    P.openGates();
    P.S.nestSkip = ["heavy", "thick"];
    P.openModBoard();
    shot(P, canvas, "03-board-skipped");
  }

  /* ---- 4. 局内 HUD：深 26，五条词条全开 ---- */
  {
    const { P, canvas } = await open({ nestCoins: 90, perkLv: {}, apples: 300, logs: 40, shards: 6 });
    P.writeNestDepth(25);
    P.enterNest(26);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 30; i++) P.tick(1 / 60);
    shot(P, canvas, "04-hud");
  }

  /* ---- 5. 开场：新词条生效那一下（深 25 → 重雾） ---- */
  {
    const { P, canvas } = await open({ nestCoins: 90, perkLv: {}, apples: 300, logs: 40, shards: 6 });
    P.writeNestDepth(24);
    P.enterNest(25);
    P.S.hudT = 99;
    P.tick(1 / 60);
    shot(P, canvas, "05-fresh-mod");
  }

  /* ---- 6. 结算卡：巢币 +K 必须出现在"这一趟的账"那一行 ---- */
  {
    const { P, canvas } = await open({ nestCoins: 90, perkLv: {}, apples: 300, logs: 40, shards: 6 });
    P.writeNestDepth(20);
    P.enterNest(21);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 20; i++) P.tick(1 / 60);
    /* 直接摆进结算态：`_bankRun` 那条路已经被 nest-play 跑过几万次了，
       这里要看的是**卡面**，不是判定。 */
    S.phase = "clear";
    S.settleT = 3;
    S.killed = 7;
    S.trip.loot = 46;
    S.trip.stages = 1;
    /* 把开场那道金光走完再拍。`settleT = 0.5` 时卡面还在过曝，
       整张图白成一片 —— 第一版就这么拍出来一张"什么都看不见"的验收图。 */
    for (let i = 0; i < 120; i++) P.tick(1 / 60);
    shot(P, canvas, "06-settle");
  }

  /* ---- 7. 对照：**主线**结算卡。用来区分"深巢卡有问题"和"卡本来就这样" ---- */
  {
    const { P, canvas } = await open({ nestCoins: 90, perkLv: {}, apples: 300, logs: 40, shards: 6 });
    P._start(2, 4);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 20; i++) P.tick(1 / 60);
    S.phase = "clear";
    S.settleT = 3;
    S.killed = 7;
    S.trip.loot = 46;
    for (let i = 0; i < 120; i++) P.tick(1 / 60);
    shot(P, canvas, "07-main-settle");
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
