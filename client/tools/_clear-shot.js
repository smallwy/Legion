/**
 * 结算面板截图 —— 验"用时 / S 线 / 差几秒"这三段的排版。
 *
 * 为什么必须出图：结算卡是**一行一行按固定 y 摆的**（198 / 222 / 280 / 306），
 * 加字最容易压到下一行。文字长度也算不准 —— 中文 15px 估宽度差 10% 就会撞。
 * 只有渲出来才知道。
 *
 * 运行：
 *   NODE_PATH=... node tools/_clear-shot.js
 * 产物：shots/_clear.png（四种状态拼一张）
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");

function boot() {
  const code = fs
    .readFileSync(path.join(ROOT, "prototype/grove.html"), "utf8")
    .match(/<script>([\s\S]*)<\/script>/)[1];
  const main = createCanvas(960, 600);
  main.style = {};
  main.addEventListener = () => {};
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 600 });
  const sb = {
    console,
    Math, Date, JSON, String, Number, Array, Object, Boolean, isNaN, isFinite,
    Set, Map, Infinity, NaN, parseInt, parseFloat, Error, RegExp,
    document: {
      getElementById: () => main,
      createElement: () => {
        const c = createCanvas(1, 1);
        c.style = {};
        c.addEventListener = () => {};
        return c;
      },
    },
    performance: { now: () => Date.now() },
    addEventListener: () => {},
    innerWidth: 1280,
    innerHeight: 800,
    localStorage: {
      _d: {},
      getItem(k) { return k in this._d ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return { P: sb.GROVE, S: sb.GROVE.S, canvas: main };
}

/** 摆一个"刚过关"的状态。参数控制"差几秒"和"有没有旧纪录"。 */
function pose(P, S, opt) {
  const st = P.curStage();
  S.phase = "clear";
  S.clearT = 0;
  S.hoverBtn = -1;
  S.playT = opt.playT;
  S.killed = opt.killed;
  S.total = opt.total;
  S.stat.made = opt.made;
  S.stat.maxHolds = 3;
  S.rankPrev = opt.prev || "";
  S.best[S.stage] = opt.rk;
  S.trip = { loot: 34, stages: 2, multi: 1.3 };
  S.belly = 68;
  S.texts.length = 0;
  return st;
}

/**
 * 注入真机贴图。
 *
 * **不注入的话这张图会骗人**：`hudSkin()` 靠 `!!artOf("ui-tip")` 判断
 * 要不要用奶油皮肤，没注入就返回 cream:false（那套是给深色玻璃底配的
 * 浅绿字），而 `creamCard()` 是无条件画奶白底 —— 于是渲染出来是
 * "奶白卡 + 浅绿字"，几乎读不出来。
 * 真机上不会出现这个组合，但出图会用假象把人引去改本来没坏的代码。
 */
async function injectArt(P) {
  const dir = path.join(ROOT, "assets/resources/grove");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  let n = 0;
  for (const f of files) {
    try {
      const img = await loadImage(path.join(dir, f));
      P.setArt(f.replace(/\.png$/, ""), img);
      n++;
    } catch (e) {
      console.warn("载入失败 " + f, e.message);
    }
  }
  return n;
}

async function main() {
  const cases = [
    { label: "A · 差 2.4s（够得着）", playT: 62.4, killed: 10, total: 10, made: 3, rk: "A", prev: "" },
    { label: "B · 过 S 线（用时在线上）", playT: 51.2, killed: 10, total: 10, made: 3, rk: "S", prev: "A" },
    { label: "C · 差 18s（够不着，不显示差值）", playT: 78.0, killed: 10, total: 10, made: 3, rk: "B", prev: "" },
    { label: "D · 球数不达标（另一条 S 线）", playT: 44.0, killed: 10, total: 10, made: 12, rk: "A", prev: "B" },
  ];

  const shots = [];
  for (const c of cases) {
    const { P, S, canvas } = boot();
    const nArt = await injectArt(P);
    P._start(0, 0);
    for (let i = 0; i < 10; i++) P.tick(1 / 60);
    const st = pose(P, S, c);
    P.render();
    const png = canvas.toBuffer("image/png");
    const crop = { x: 300, y: 30, w: 660, h: 560 };
    shots.push({ label: c.label, png, crop, par: st.par });
    console.log(
      `${c.label}  贴图 ${nArt} 张  par.time=${st.par.time}  playT=${c.playT}` +
      `  差=${(c.playT - st.par.time).toFixed(1)}s  → ${c.rk}`
    );
  }

  const CW = shots[0].crop.w, CH = shots[0].crop.h;
  const pad = 8, labH = 24;
  const cols = 2, rows = 2;
  const out = createCanvas(cols * (CW + pad) + pad, rows * (CH + labH + pad) + pad);
  const g = out.getContext("2d");
  g.fillStyle = "#15171A";
  g.fillRect(0, 0, out.width, out.height);
  g.font = "13px sans-serif";
  g.textBaseline = "top";

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const img = await loadImage(s.png);
    const dx = pad + (i % cols) * (CW + pad);
    const dy = pad + Math.floor(i / cols) * (CH + labH + pad);
    g.drawImage(img, s.crop.x, s.crop.y, CW, CH, dx, dy + labH, CW, CH);
    g.fillStyle = "#E8EBEF";
    g.fillText(s.label, dx + 2, dy + 4);
    g.strokeStyle = "#3A3F47";
    g.strokeRect(dx + 0.5, dy + labH + 0.5, CW - 1, CH - 1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "_clear.png"), out.toBuffer("image/png"));
  console.log("\n→ shots/_clear.png  " + out.width + "x" + out.height);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
