/* ============================================================================
   _left-jitter.js —— 「走到最左边就抖」到底是什么在抖
   ----------------------------------------------------------------------------
   玩家报的是「这种敌方我不需要可以跳，而且走到最左边还会抖动」。

   第 5 屏（断崖路）左端有一块 26..180 的台面，出生点就在它正下方偏左
   （spawn = 70，台面上的虫在 x=80）。所以这不是人造场景，是**玩家一进门
   就看得见的那一只**。

   抖有三种可能，静态截图分辨不出来，必须逐帧记：
     A. 位置抖    x 每帧变号 → 物理层在原地抽
     B. 朝向抖    face 每帧翻 → 整只左右镜像闪（乌鸦那次就是这个）
     C. 状态抖    crouch/landT 反复进出 → 压扁、脉冲环、抬头标记在闪

   三个指标分别统计，再看 x 的时间序列判断是「高频抽」还是「低频来回蹭」。
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { boot } = require("./grove-env.js");
const { createCanvas } = require("@napi-rs/canvas");

const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const FPS = 60, SECS = 6, N = FPS * SECS;
const STAGE = 4;          // 第 5 屏 = 断崖路

/** 跑一组：把一只虫放在台面左端，玩家在原出生点。 */
function run(opt) {
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(1, STAGE);
  S.foes.length = 0;
  S.balls.length = 0;
  S.p.hp = 999;

  const f = P.foeFromSpec({ foe: "bug", x: opt.x, y: opt.y, lv: 1 }, false);
  f.ph = 1.0;                      // 固定相位 → jumper 标记稳定
  f.jumper = opt.jumper ? 1 : 0;
  f.vx = 0; f.vy = 0; f.stun = 0; f.coat = 0;
  S.foes.push(f);

  const rec = [];
  let xFlips = 0, faceFlips = 0, crouchTicks = 0, wallTicks = 0;
  let prevDxSign = 0, prevFace = f.face;
  for (let i = 0; i < N; i++) {
    P.tick(1 / FPS);
    const dxs = f.vx > 1 ? 1 : f.vx < -1 ? -1 : 0;
    if (prevDxSign && dxs && dxs !== prevDxSign) xFlips++;
    if (dxs) prevDxSign = dxs;
    if (f.face !== prevFace) { faceFlips++; prevFace = f.face; }
    if (f.crouch > 0) crouchTicks++;
    if (f.wallT > 0) wallTicks++;
    rec.push({
      i, x: +f.x.toFixed(1), vx: +f.vx.toFixed(1), face: f.face, dir: f.dir,
      g: f.onGround ? 1 : 0, cr: +f.crouch.toFixed(2), po: +f.pounce.toFixed(2),
      la: +f.landT.toFixed(2), w: +f.wallT.toFixed(2),
    });
  }
  const xs = rec.map(r => r.x);
  return {
    rec, xFlips, faceFlips, crouchTicks, wallTicks,
    xMin: Math.min(...xs), xMax: Math.max(...xs),
  };
}

const cases = [
  { label: "普通刺毛虫 · 台面左端(x=80)", x: 80, y: 462, jumper: false },
  { label: "跳虫     · 台面左端(x=80)", x: 80, y: 462, jumper: true },
  { label: "跳虫     · 贴着左墙(x=45)", x: 45, y: 462, jumper: true },
];

const res = cases.map(c => ({ ...c, r: run(c) }));

console.log("\n=== 6 秒逐帧统计（第 5 屏 · 断崖路）===");
for (const c of res) {
  const r = c.r;
  console.log("\n" + c.label);
  console.log("  x 范围        " + r.xMin.toFixed(1) + " .. " + r.xMax.toFixed(1) +
    "  （跨度 " + (r.xMax - r.xMin).toFixed(1) + "px）");
  console.log("  速度反向      " + r.xFlips + " 次 / 6s" +
    (r.xFlips > 10 ? "   ← 位置在抽" : ""));
  console.log("  朝向翻转      " + r.faceFlips + " 次 / 6s" +
    (r.faceFlips > 10 ? "   ← 整只在镜像闪" : ""));
  console.log("  蹲身帧 / 撞墙帧   " + r.crouchTicks + " / " + r.wallTicks);
}

console.log("\n=== 跳虫在前 90 帧里每次状态变化 ===");
const jr = res[1].r.rec;
let last = "";
for (let i = 0; i < 90; i++) {
  const p = jr[i];
  const st = (p.cr > 0 ? "蹲" : p.po > 0 ? "空中" : p.la > 0 ? "硬直" : p.w > 0 ? "背离" : "走");
  const key = st + "|" + p.face + "|" + (p.vx > 0 ? "→" : p.vx < 0 ? "←" : "·");
  if (key !== last) {
    console.log(`  f${String(i).padStart(3)}  x=${String(p.x).padStart(6)}  vx=${String(p.vx).padStart(6)}  ` +
      `face=${p.face}  ${st}${p.g ? "" : " (空中)"}`);
    last = key;
  }
}

/* ---- 图：x-t 曲线，三条并列 ---- */
const W = 960, HG = 120, PAD = 40;
const cv = createCanvas(W, HG * 3 + 110);
const g = cv.getContext("2d");
const F = "12px 'Microsoft YaHei', sans-serif";
g.fillStyle = "#12161B"; g.fillRect(0, 0, cv.width, cv.height);
g.fillStyle = "#E6E9EE";
g.font = "bold 16px 'Microsoft YaHei', sans-serif";
g.fillText("第 5 屏 · 断崖路：左端台面上的虫，x 随时间（6 秒逐帧）", PAD, 28);
g.font = F;
g.fillStyle = "#96A0AC";
g.fillText("竖轴 = x（上下翻转，越上越靠左）。水平直线 = 站着不动；高频锯齿 = 在抽。", PAD, 48);

const COLORS = ["#5AA9E6", "#E6A23C", "#E05C5C"];
res.forEach((c, ci) => {
  const y0 = 70 + ci * HG;
  const xs = c.r.rec.map(r => r.x);
  const lo = Math.min(...xs) - 6, hi = Math.max(...xs) + 6;
  g.strokeStyle = "#232A33";
  g.beginPath(); g.moveTo(PAD, y0); g.lineTo(W - PAD, y0); g.stroke();
  g.beginPath();
  g.strokeStyle = COLORS[ci];
  g.lineWidth = 1.8;
  for (let i = 0; i < xs.length; i++) {
    const px = PAD + (W - PAD * 2) * (i / (xs.length - 1));
    const py = y0 + (hi - lo === 0 ? 0 : (xs[i] - lo) / (hi - lo) * 46) - 23;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  g.fillStyle = COLORS[ci];
  g.font = "bold 12.5px 'Microsoft YaHei', sans-serif";
  g.fillText(c.label, PAD, y0 - 30);
  g.font = F;
  g.fillStyle = "#96A0AC";
  g.fillText(`x ${lo.toFixed(0)}..${hi.toFixed(0)}   速度反向 ${c.r.xFlips}   朝向翻转 ${c.r.faceFlips}`, PAD, y0 + 44);
});

const fp = path.join(OUT, "_left-jitter.png");
fs.writeFileSync(fp, cv.toBuffer("image/png"));
console.log("\n  图 → " + fp);
