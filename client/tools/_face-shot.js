/* ============================================================================
   _face-shot.js —— 把"朝向逐帧翻转"直接拍成连续帧条带
   ----------------------------------------------------------------------------
   为什么还要一张图：`_hover-trace.js` 的 y-t 曲线证明了**位置没问题**
   （红绿两条几乎重合），但玩家说的"抖"是真的。抖的不是位置，是**朝向**：
   `f.face = sign(dx)` 无条件赋值，乌鸦贴到玩家身边时 dx 反复过零，
   整只鸟每帧左右镜像翻转一次，8 秒 83 次 ≈ 每秒 10 次。

   y-t 曲线看不出这件事，静态截图也看不出。唯一能看出来的证据是
   **把连续 8 帧并排放在一起**：翻转的那一行，乌鸦的喙和呆毛一会儿朝左
   一会儿朝右；修好的那一行 8 帧朝向完全一致。

   两行怎么来的：
     行 A（修前）每帧 tick 之后**手动覆盖** `f.face = sign(p.x - f.x)`
                —— 这就是旧写法，用来复原病态；
     行 B（修后）什么都不做，跑的是当前代码里的死区版本。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_face-shot.js
   产物落 ../shots/_face-strip.png（`_` 前缀，不入库）。
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = path.join(__dirname, "..", "prototype", "grove.html");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const noop = () => {};

const FRAMES = 8;      // 每行取几帧
const STEP = 6;        // 帧间隔（6 帧 = 0.1 秒，一眼看出朝向有没有来回跳）
const CELL = 96;       // 每格边长

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
        c.style = {}; c.addEventListener = noop; return c;
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

/** 正确做法：每帧 render 完立刻把乌鸦周围那一小块拷出来。 */
function capture(oldWay) {
  const { P, canvas } = boot();
  P._start(2, 4);
  const S = P.S;
  S.texts.length = 0;
  S.balls.length = 0;
  S.foes.length = 0;
  /* **必须把乌鸦放在玩家身上（dx ≈ 0.4），病态才复现得出来。**
     第一版放在相距 80 的位置，两行都是 0 次翻转 —— 因为 80 在死区外，
     旧写法 `sign(dx)` 也稳定为 +1，等于什么都没验证。
     真实病态是：乌鸦贴到玩家脸上之后，`|dx| < 40` 速度降到 13.8px/s
     （一帧 0.23px），它在 0 两侧来回微穿越，`sign` 跟着翻，
     于是形成每秒约 10 次的高频极限环 —— 这才是"抖得很严重"。 */
  S.p.dead = false;
  const px = S.p.x, py = S.p.y;
  const f = P.foeFromSpec({ foe: "crow", x: px - 0.4, y: py - 70, lv: 1 }, false);
  f.vx = 0; f.vy = 0; f.stun = 0;
  f.bob = 0.7; f.ph = 1.1;
  S.foes.push(f);

  const tiles = [];
  const faces = [];
  /* 翻转次数**必须逐帧数**。第一版数的是 8 个采样点之间有没有变脸，
     可采样间隔是 6 帧、翻转频率约 10Hz（每 0.1 秒一次）—— 正好被混叠掉，
     结果明明是抖的，两行都显示"0 次"。**采样率低于信号频率时，
     统计出来的永远是 0。** 这里改成在内层循环里每帧比一次。 */
  let flipsIn = 0, prevFace = f.face;
  for (let i = 0; i < FRAMES; i++) {
    for (let k = 0; k < STEP; k++) {
      P.tick(1 / 60);
      if (oldWay) {
        const dx = S.p.x - f.x;
        f.face = dx > 0 ? 1 : dx < 0 ? -1 : f.face;
      }
      if (f.face !== prevFace) { flipsIn++; prevFace = f.face; }
    }
    P.render();
    faces.push(f.face);
    const t = createCanvas(CELL, CELL);
    const tg = t.getContext("2d");
    tg.drawImage(canvas,
      Math.round(f.x - CELL / 2), Math.round(f.y - f.h / 2 - CELL / 2), CELL, CELL,
      0, 0, CELL, CELL);
    tiles.push(t);
  }
  return { tiles, faces, flipsIn };
}



const PAD = 26, GAP = 6;
const cvW = PAD * 2 + FRAMES * CELL + (FRAMES - 1) * GAP;
const cvH = PAD * 2 + 2 * CELL + GAP + 76;
const out = createCanvas(cvW, cvH);
const og = out.getContext("2d");
og.fillStyle = "#FBFAF6"; og.fillRect(0, 0, cvW, cvH);
const F = "'Microsoft YaHei', sans-serif";

og.fillStyle = "#3A362E"; og.font = "bold 15px " + F; og.textAlign = "left";
og.fillText("乌鸦贴到玩家身上时（dx ≈ 0.4）：连续 8 帧，每格间隔 0.1 秒", PAD, 22);

const rows = [
  { label: "修前  f.face = sign(dx)（无条件）", color: "#C0392B", oldWay: true },
  { label: "修后  |dx| > 26 才转身（死区）", color: "#1E8449", oldWay: false },
];

let y = 40;
for (const row of rows) {
  const { tiles, faces, flipsIn: nf } = capture(row.oldWay);
  og.fillStyle = row.color; og.font = "bold 13px " + F;
  og.fillText(row.label, PAD, y + 12);
  og.fillStyle = nf > 0 ? "#C0392B" : "#1E8449";
  og.font = "bold 13px " + F;
  og.fillText("— " + (FRAMES * STEP / 60).toFixed(1) + " 秒内翻转 " + nf + " 次", PAD + og.measureText(row.label).width + 8, y + 12);
  y += 20;

  tiles.forEach((t, i) => {
    og.drawImage(t, PAD + i * (CELL + GAP), y, CELL, CELL);
    /* 朝向标在格子角上：↔ 就是翻转发生的位置 */
    const flipped = i > 0 && faces[i] !== faces[i - 1];
    og.fillStyle = flipped ? "#C0392B" : "#8A8578";
    og.font = "bold 12px " + F;
    og.fillText(faces[i] > 0 ? "→" : "←", PAD + i * (CELL + GAP) + 6, y + CELL - 6);
  });
  y += CELL + GAP + 22;
}

og.fillStyle = "#6E695C"; og.font = "12px " + F;
og.fillText("← → 是这一帧乌鸦的朝向。红色箭头 = 相对上一帧翻了面。", PAD, cvH - 14);

const fp = path.join(OUT, "_face-strip.png");
fs.writeFileSync(fp, out.toBuffer("image/png"));
console.log("  " + fp);
