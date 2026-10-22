/* ============================================================================
   _chain-shot.js —— 「一球 N 连」连续帧分镜（离屏，不开浏览器）

   为什么需要它：
     `_chain-test.js` 只量了数字（能卷几只），但"能不能剪成 GIF"取决于**画面**：
     球到底是越滚越大、还是被吞进一片人里看不出来；卷到第几只时球已经大得压住台面。

   本游戏的真实机制是**雪球**，不是连锁爆开：
     球滚过糊满的人 → 卷进球里 → 球变大 → 继续滚。
     球径 r = 20 + min(16, holds×2.8)，**6 只封顶**（36px）。
     所以"一排几只"是有最优解的，不是越多越好看 —— 超过 6 只视觉不再增长。

   产物：shots/_chain-frames.png（横向 8 格，每格标帧号/球径/已卷数）
   用法：NODE_PATH=<workspace>/node_modules node tools/_chain-shot.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = path.join(__dirname, "..", "prototype", "grove.html");
const RES = path.join(__dirname, "..", "assets", "resources", "grove");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const noop = () => {};

const KEYS = ["bug", "crow", "boar", "larva", "cat", "dog", "ham"];

async function decodeArt() {
  const art = {};
  for (const k of KEYS) {
    const isFoe = ["bug", "crow", "boar", "larva"].includes(k);
    const f = path.join(RES, (isFoe ? "foe-" : "pet-") + k + ".png");
    if (!fs.existsSync(f)) continue;
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
    isNaN, isFinite, Set, Map, Infinity, NaN, parseInt, parseFloat,
    document: {
      getElementById: () => main,
      createElement: () => {
        const c = createCanvas(1, 1);
        c.style = {}; c.addEventListener = noop;
        return c;
      },
    },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  const P = sb.GROVE;
  if (art) for (const k of Object.keys(art)) P.setArt(k, art[k]);
  return { P, S: P.S, canvas: main };
}

/** 摆一排 + 造球，返回关键帧的截图（PNG buffer）+ 每帧的读数 */
function capture(n, gap, x0, y, shots) {
  const { P, S, canvas } = boot(capture.art);
  P._start(0, 0);
  S.foes.length = 0;
  S.balls.length = 0;
  S.shots.length = 0;
  S.hudTip = 0;

  const foes = [];
  for (let i = 0; i < n; i++) {
    const f = P.foeFromSpec({ foe: "bug", x: x0 + i * gap, y, lv: 1 }, false);
    f.vx = 0; f.vy = 0; f.face = 1; f.stun = 999;
    f.dir = 0; f.chargeT = 999; f.hitT = 0;
    f.coat = 2;
    S.foes.push(f);
    foes.push(f);
  }
  foes[0].coat = 3;
  P.makeBallFrom(foes[0], 660, 0);
  const ball = S.balls[0];
  ball.vy = 0;

  const frames = [];
  for (let i = 0; i <= 60; i++) {
    if (shots.includes(i)) {
      P.render();
      frames.push({
        i,
        holds: ball.dead ? "-" : ball.holds,
        r: ball.dead ? "-" : +ball.r.toFixed(1),
        png: canvas.toBuffer("image/png"),
        // 球的屏幕位置，用来对齐裁切窗口
        bx: ball.dead ? 480 : ball.x,
      });
    }
    if (ball.dead) break;
    P.updateBalls(1 / 60);
  }
  return frames;
}
capture.art = null;

/* 每格裁 260 宽 —— 球在 60 帧内从 110 滚到 620，宽 260 的窗口勉强能包住
   "球 + 最近两只敌人"。再宽就变成整屏缩略，看不清球有没有变大。 */
/* 每格裁 440×210 —— 320 宽在 7 格拼图里会被 Read 缩到看不清球有没有变大，
   而"球有没有变大"正是这张图唯一要证明的东西。宁少几帧、不要小格子。 */
const CELL_W = 440, CELL_H = 210;
const CROP_TOP = 352;   // 台面 y462，向上留 110 抬到敌人头顶

async function main() {
  const art = await decodeArt();
  capture.art = art;
  console.log("注入 " + Object.keys(art).length + " 张贴图");

  const N = 5, GAP = 110, X0 = 135, Y = 462;
  // 4 个关键帧：起手 1 只 / 卷到 3 只 / 卷到 5 只 / 卷满 6 只。
  // 帧号取自 _chain-test 实测的卷人时刻（4/13/21/30/40），取中间值保证都在"已卷、未卷下一只"。
  const frames = capture(N, GAP, X0, Y, [0, 17, 34, 44]);
  console.log("截到 " + frames.length + " 帧");

  const pad = 10, labelH = 24;
  const cols = 2, rows = Math.ceil(frames.length / cols);
  const out = createCanvas(cols * (CELL_W + pad) + pad, rows * (CELL_H + labelH + pad) + pad);
  const g = out.getContext("2d");
  g.fillStyle = "#181A1E";
  g.fillRect(0, 0, out.width, out.height);
  g.font = "15px sans-serif";
  g.textBaseline = "top";

  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i];
    const img = await loadImage(fr.png);
    // 以球为中心裁一窗，保证球始终在格子中间
    const cx = Math.max(CELL_W / 2, Math.min(W - CELL_W / 2, fr.bx));
    const sx = Math.round(cx - CELL_W / 2);
    const dx = pad + (i % cols) * (CELL_W + pad);
    const dy = pad + Math.floor(i / cols) * (CELL_H + labelH + pad);
    g.drawImage(img, sx, CROP_TOP, CELL_W, CELL_H, dx, dy, CELL_W, CELL_H);
    g.strokeStyle = "#3A3F47";
    g.strokeRect(dx + 0.5, dy + 0.5, CELL_W - 1, CELL_H - 1);
    g.fillStyle = "#E8EBEF";
    g.fillText(
      "第" + fr.i + "帧  " + (fr.holds === "-" ? "已落地" : "卷 " + fr.holds + " 只  球径 r=" + fr.r + "px"),
      dx + 2, dy + CELL_H + 4
    );
  }

  const dst = path.join(OUT, "_chain-frames.png");
  fs.writeFileSync(dst, out.toBuffer("image/png"));
  console.log("→ " + dst);
  console.log("\n读数：" + frames.map((f) => "f" + f.i + (f.holds === "-" ? "落地" : ":" + f.holds)).join("  "));
}

main().catch((e) => { console.error(e); process.exit(1); });
