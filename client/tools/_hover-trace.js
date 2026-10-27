/* ============================================================================
   _hover-trace.js —— 飞行怪的"上下跳"到底是不是抖动：画成 y-t 曲线看
   ----------------------------------------------------------------------------
   为什么需要它：玩家报的是「上下跳动很奇怪 / 抖动很严重」。静态截图看不出来，
   而"看起来像在抖"在数值上是很具体的东西 —— **两个频率接近的正弦叠在一起**，
   会打出拍频（忽快忽慢、忽大忽小）。

   这场返工的病根就是位置被写了两遍：
     物理层  y = homeY + 18·sin(0.80·bob)      ← 玩法参数，动不得
     绘制层  cy += 2.5·sin(1.00·bob)           ← 给静态贴图补动感的，飞行怪不该吃
   频率比 0.80 → 拍频周期约 9.8 秒。人眼读作"一跳一跳"，不是飞。

   这里把三种曲线画在同一张图上，用眼睛判：
     · 旧（两层叠加）—— 起伏包络明显忽大忽小 = 拍频
     · 新（只有物理层）—— 一条干净的正弦
     · 巢蛾（慢浮沉 + 单侧扑翅上冲）—— 慢波上叠一串单侧的"顶"

   判据不靠感觉：算**二阶差分的 RMS**（≈ 视觉加速度 / 抖动强度），
   以及**包络起伏比**（逐周期峰峰值 max/min，越接近 1 越稳）。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_hover-trace.js
   产物落 ../shots/_hover-trace.png（`_` 前缀，不入库）。
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { boot } = require("./grove-env.js");
const { createCanvas } = require("@napi-rs/canvas");

const W = 960, H = 600;
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const FPS = 60, SECS = 8, N = FPS * SECS;

/** 采样一只怪的 y 序列。`mode` 决定算哪一版：
 *  "old" = 物理 + 旧绘制层位移；"new" = 只有物理。 */
function trace(kind, mode) {
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(1, 0);
  S.foes.length = 0;
  S.balls.length = 0;

  /* 固定在一条干净台面上方，位置不影响曲线形状 */
  const f = P.foeFromSpec({ foe: kind, x: 480, y: 300, lv: 1 }, false);
  f.vx = 0; f.vy = 0; f.stun = 0;
  if (kind === "moth") { f.homeY = 300; }
  S.foes.push(f);

  const ys = [];
  /* 同时统计**朝向翻转次数**。这是"抖动"更直接的指标：
     原来 `f.face = sign(dx)` 是无条件的，乌鸦贴到玩家身边 dx 反复过零，
     face 就逐帧翻——整只鸟左右镜像闪烁。y-t 曲线完全看不出这件事。 */
  let oldFlips = 0, prevOld = 0, newFlips = 0, prevNew = f.face;
  for (let i = 0; i < N; i++) {
    P.tick(1 / FPS);
    const dxo = (S.p && !S.p.dead) ? S.p.x - f.x : 1;
    const of = dxo > 0 ? 1 : dxo < 0 ? -1 : prevOld;
    if (prevOld && of !== prevOld) oldFlips++;
    prevOld = of;
    if (f.face !== prevNew) { newFlips++; prevNew = f.face; }
    /* 绘制层真正用的世界 y = cy + 位移，cy = f.y - f.h/2。
       旧版那行是 `cy + Math.sin(f.bob) * 2.5`，这里按同样算式复原。 */
    const cy = f.y - f.h / 2;
    ys.push(mode === "old" ? cy + Math.sin(f.bob) * 2.5 : cy);
  }
  return { ys, oldFlips, newFlips };
}

/** 二阶差分 RMS：位移曲线上"加速度"的量级 ≈ 视觉抖动强度。
 *  单位是 px/frame²，数值越小越稳。 */
function d2rms(ys) {
  let s = 0, n = 0;
  for (let i = 2; i < ys.length; i++) {
    const d = ys[i] - 2 * ys[i - 1] + ys[i - 2];
    s += d * d; n++;
  }
  return Math.sqrt(s / n);
}

/** 逐秒切段求峰峰值，再看 max/min。接近 1 = 每个周期的摆幅一样大（稳）；
 *  远大于 1 = 忽大忽小（拍频）。 */
function envRatio(ys) {
  const seg = FPS;                 // 1 秒一段
  const amps = [];
  for (let a = 0; a + seg <= ys.length; a += seg) {
    const s = ys.slice(a, a + seg);
    amps.push(Math.max(...s) - Math.min(...s));
  }
  const lo = Math.min(...amps), hi = Math.max(...amps);
  return lo < 0.05 ? Infinity : hi / lo;
}

function draw(series) {
  const PAD_L = 76, PAD_R = 250, PAD_T = 54, PAD_B = 52;
  const PW = W - PAD_L - PAD_R, PH = H - PAD_T - PAD_B;
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  g.fillStyle = "#FBFAF6"; g.fillRect(0, 0, W, H);

  /* y 值的全局范围 —— 三条曲线共用一个刻度，否则看不出谁摆得大 */
  const all = series.flatMap((s) => s.ys);
  const y0 = Math.min(...all), y1 = Math.max(...all);
  const pad = (y1 - y0) * 0.12 + 1;
  const Y = (v) => PAD_T + ((v - (y0 - pad)) / ((y1 + pad) - (y0 - pad))) * PH;
  const X = (i) => PAD_L + (i / (N - 1)) * PW;

  /* 网格 */
  g.strokeStyle = "#E6E3DA"; g.lineWidth = 1;
  for (let s = 0; s <= SECS; s++) {
    const x = X(s * FPS);
    g.beginPath(); g.moveTo(x, PAD_T); g.lineTo(x, PAD_T + PH); g.stroke();
    g.fillStyle = "#8A8578"; g.font = "12px 'Microsoft YaHei', sans-serif"; g.textAlign = "center";
    g.fillText(s + "s", x, PAD_T + PH + 20);
  }
  g.textAlign = "right";
  for (let k = 0; k <= 4; k++) {
    const v = y0 - pad + ((y1 + pad) - (y0 - pad)) * (k / 4);
    const y = Y(v);
    g.beginPath(); g.moveTo(PAD_L, y); g.lineTo(PAD_L + PW, y); g.stroke();
    g.fillStyle = "#8A8578"; g.fillText(Math.round(v), PAD_L - 8, y + 4);
  }

  g.fillStyle = "#3A362E"; g.font = "bold 15px 'Microsoft YaHei', sans-serif"; g.textAlign = "left";
  g.fillText("飞行怪的世界 y 逐帧曲线（纵轴向下 = 屏幕上更低）", PAD_L, 28);

  /* 曲线 */
  for (const s of series) {
    g.strokeStyle = s.color; g.lineWidth = s.width || 2;
    g.globalAlpha = s.alpha == null ? 1 : s.alpha;
    g.beginPath();
    s.ys.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.stroke();
    g.globalAlpha = 1;
  }

  /* 图例 + 量化 */
  let ty = PAD_T + 8;
  const lx = PAD_L + PW + 22;
  g.textAlign = "left";
  for (const s of series) {
    g.fillStyle = s.color;
    g.fillRect(lx, ty - 8, 16, 3.5);
    g.fillStyle = "#3A362E"; g.font = "bold 12.5px 'Microsoft YaHei', sans-serif";
    g.fillText(s.name, lx + 23, ty - 2);
    g.fillStyle = "#6E695C"; g.font = "11.5px 'Microsoft YaHei', sans-serif";
    g.fillText("抖动强度 " + s.d2.toFixed(4), lx + 23, ty + 14);
    g.fillText("包络起伏 " + (s.env === Infinity ? "∞" : s.env.toFixed(2) + "×"),
               lx + 23, ty + 29);
    g.fillText("朝向翻转 " + s.flips + " 次 / " + SECS + "s", lx + 23, ty + 44);
    ty += 76;
  }

  g.fillStyle = "#8A8578"; g.font = "11.5px 'Microsoft YaHei', sans-serif";
  g.fillText("抖动强度 = 二阶差分 RMS（越小越稳）", lx, PAD_T + PH - 8);
  g.fillText("包络起伏 = 逐秒峰峰值 max/min（1.00× 最稳）", lx, PAD_T + PH + 10);

  const f = path.join(OUT, "_hover-trace.png");
  fs.writeFileSync(f, cv.toBuffer("image/png"));
  console.log("  " + f);
}

const tOld = trace("crow", "old");
const tNew = trace("crow", "new");
const tMoth = trace("moth", "new");
const series = [
  { name: "乌鸦 · 修前（物理 + 绘制层）", color: "#C0392B", width: 1.6, alpha: 0.85,
    ys: tOld.ys, flips: tOld.oldFlips },
  { name: "乌鸦 · 修后（只有物理）", color: "#1E8449", width: 2.4,
    ys: tNew.ys, flips: tNew.newFlips },
  { name: "巢蛾 · 修后（慢浮沉 + 单侧扑翅）", color: "#7D3C98", width: 2.0,
    ys: tMoth.ys, flips: tMoth.newFlips },
];

console.log("=== 飞行怪悬停曲线 ===");
for (const s of series) {
  s.d2 = d2rms(s.ys);
  s.env = envRatio(s.ys);
  const lo = Math.min(...s.ys), hi = Math.max(...s.ys);
  console.log("  " + s.name);
  console.log("     y 范围 " + lo.toFixed(1) + " .. " + hi.toFixed(1) +
    "（摆幅 " + (hi - lo).toFixed(1) + "px）");
  console.log("     抖动强度 " + s.d2.toFixed(4) + "   包络起伏 " +
    (s.env === Infinity ? "∞" : s.env.toFixed(2) + "×") +
    "   朝向翻转 " + s.flips + " 次");
}
const before = series[0], after = series[1];
console.log("\n  乌鸦朝向翻转 " + before.flips + " → " + after.flips + " 次 / " + SECS + "s" +
  "（这才是「抖」的量化：face 逐帧翻 = 整只鸟左右镜像闪烁）");
console.log("  乌鸦上下摆幅 " + (Math.max(...before.ys) - Math.min(...before.ys)).toFixed(1) +
  " → " + (Math.max(...after.ys) - Math.min(...after.ys)).toFixed(1) + "px（玩法参数，没动）");
draw(series);
