/* ============================================================================
   把概念图里的矢量图标切成真资产（PNG，透明底）
   ----------------------------------------------------------------------------
   为什么必须做：概念图里的徽标图标是 canvas 程序画的（kit2 的 badge()），
   而网页版和 Cocos 里只能用 emoji 代替 —— emoji 在不同系统里长相完全不同，
   这就是"概念图和游戏看起来不是一套东西"的最直接原因之一。

   统一规格（照抄概念图的视觉参数）：
     画布 128×128，**墨迹最大边 88（= 68.75%）**，线宽 12，线色 #8A5232，圆头圆角
     线宽是怎么定出来的：概念图徽标半径 13、线宽 1.9，线宽占内容直径的 1.9/28 = 13.6%。
     我们的内容直径 88 → 88×.136 ≈ 12，取 12（圆头会让它看起来比实测粗一点）。
     之前定 8 是"看着精致"，结果缩到 27px 显示时细成发丝，和概念图的敦实感完全不同 ——
     **线宽要按比例算，不能按大图好看来定。**

   ---------- 归一化（normalize）：这条是后补的，补的原因很具体 ----------
   上面那句"内容 88"原来只是**设计框**，不是**墨迹**。实测各图标的墨迹占画布：
     lock 43% / hammer 50% / mail 50% / book 53% / flag 56% / gear 56% /
     paw 61% / pot 73% / coin 77% / log 77% / apple 78%
   同一个 21px 框里，锤子只有 10px、金币 16px —— 一套图标三种大小，27px 下锤子细成一根针。
   所以现在统一：画完先量墨迹包围盒，再按 **最大边缩到 88** 重画一遍，墨迹中心对齐画布中心。

   ⚠ 缩放时线宽必须同步除以 k，否则线宽被 transform 一起放大 —— 锤子 k=1.47 时
     12 会变成 17.6，描边糊成一坨。这是本文件第二次踩"lineWidth 被 scale 缩放"，
     所以这次把 k 收进闭包，让 ctx() / colored() 自己除，不再靠调用方自觉。

   用法：node build-icons.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const CLIENT = path.join(__dirname, "..");
const OUT = path.join(CLIENT, "assets", "ui", "icons");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const S = 128, C = S / 2;
const INK = "#8A5232";
const INK_HOT = "#E8563C";   // 强调色变体（HUD 引导爪印用）
const LW = 12;
const TARGET = 88;           // 墨迹最大边（88/128 = 68.75%）

let CUR_INK = INK;           // 由 ctx() 读取，方便出同形状换色的变体
let K = 1;                   // 归一化倍率，由 normalize() 临时设置
let ORG = { x: C, y: C };    // 归一化前的墨迹中心（画布坐标）

/** 归一化前奏：把画布坐标 → 「墨迹中心落到画布中心、整体放大 K 倍」
    = translate(C,C) ∘ scale(K) ∘ translate(-ORG)
      → q ↦ (q − ORG)·K + C
    ⚠ 这里只做**一次** translate(C,C)。ctx() 里的图形是用绝对画布坐标（C±n）写的，
      所以它不需要额外的居中平移；多给一次会把图形整体推出画布，
      表现为"量到的墨迹只有边缘几个像素"（占比 3.9% 这种假数字）。 */
function applyFit(g) {
  g.translate(C, C);
  g.scale(K, K);
  g.translate(-ORG.x, -ORG.y);
}

function ctx(ink) {
  const c = createCanvas(S, S), g = c.getContext("2d");
  const k = ink || CUR_INK;
  g.strokeStyle = k;
  g.fillStyle = k;
  g.lineWidth = LW / K;      // 渲染后 = LW，不随归一化变粗
  g.lineCap = "round";
  g.lineJoin = "round";
  applyFit(g);
  return { c, g };
}

/** 墨迹包围盒（alpha > 28 视为有墨） */
function inkBox(canvas) {
  const g = canvas.getContext("2d");
  const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let j = 0; j < canvas.height; j++) {
    for (let i = 0; i < canvas.width; i++) {
      if (d[(j * canvas.width + i) * 4 + 3] > 28) {
        if (i < x0) x0 = i; if (i > x1) x1 = i;
        if (j < y0) y0 = j; if (j > y1) y1 = j;
      }
    }
  }
  if (x1 < 0) return { w: 0, h: 0, cx: C, cy: C };
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: x0 + (x1 - x0 + 1) / 2, cy: y0 + (y1 - y0 + 1) / 2 };
}

/** 归一化：把墨迹最大边缩到 TARGET 并居中；`noScale` 时只居中不缩放
    ------------------------------------------------------------------
    为什么分两支：
      · **线描徽标**（锤/爪/锅/信/旗/齿/书/锁）原本墨迹只占 43~56%，
        大小差 1.8 倍 —— 必须归一化，否则 27px 下锤子细成一根针。
      · **彩色资源图标**（果/木/章）本来就按设计尺寸统一到 ~77%，
        再缩一圈会让 Dock 的资源图标明显小于概念图（果子直径从 17 掉到 15）。
    两支各自内部统一即可；跨支不必同尺寸 —— 它们本来是两个子风格。 */
function normalize(draw, noScale) {
  K = 1; ORG = { x: C, y: C };
  const base = inkBox(draw());
  if (!base.w) throw new Error("图标是空的，检查绘制函数");

  /* ORG 只取基准绘制（K=1）的墨迹中心，之后所有渲染都绕这一点缩放 ——
     这样无论 K 变成多少，墨迹中心都恰好落在画布中心，不需要每轮重算。

     要迭代**两轮**，只算一轮会系统性偏小：归一化时线宽被补偿成 LW/K，
     墨迹 = 几何×K + LW，而 88 是几何×K 的目标，实测会落在 66~70%。

     ⚠ K 必须写成**累计**（K *= 修正系数）。写成 K = TARGET/max(bb) 的话，
       每轮都把上一轮已经放大的部分重新缩回去 —— 实测锤子在 1.375 与 1.02
       之间来回摆，最后只剩 51%，比不做归一化还小。 */
  ORG = { x: base.cx, y: base.cy };
  K = noScale ? 1 : TARGET / Math.max(base.w, base.h);

  let out = draw();
  if (!noScale) {
    for (let i = 0; i < 2; i++) {
      const bb = inkBox(out);
      K *= TARGET / Math.max(bb.w, bb.h);
      out = draw();
    }
  }

  const fin = inkBox(out);
  K = 1; ORG = { x: C, y: C };
  return { canvas: out, fill: +(Math.max(fin.w, fin.h) / S * 100).toFixed(2) };
}

/* ---------- 锤子：斜柄 + 斜方块头 ---------- */
function hammer() {
  const { c, g } = ctx();
  g.beginPath();
  g.moveTo(C - 18, C + 26);
  g.lineTo(C + 12, C - 10);
  g.stroke();
  g.save();
  g.translate(C + 18, C - 15);
  g.rotate(0.72);
  g.beginPath();
  g.roundRect(-19, -9, 38, 18, 6);
  g.fill();
  g.restore();
  return c;
}

/* ---------- 爪印：一个大掌 + 三个小趾 + 两条小腕点 ---------- */
function paw(ink) {
  const { c, g } = ctx(ink);
  g.beginPath();
  g.ellipse(C, C + 16, 19, 15, 0, 0, 6.2832);
  g.fill();
  for (const a of [-0.62, 0, 0.62]) {
    g.beginPath();
    g.arc(C + Math.sin(a) * 24, C - 10 - Math.cos(a) * 7, 7.4, 0, 6.2832);
    g.fill();
  }
  g.beginPath();
  g.arc(C - 32, C + 4, 6.2, 0, 6.2832);
  g.fill();
  g.beginPath();
  g.arc(C + 32, C + 4, 6.2, 0, 6.2832);
  g.fill();
  return c;
}

/* ---------- 锅：半球 + 横梁 + 提手弧 ---------- */
function pot() {
  const { c, g } = ctx();
  // 锅身：宽扁梯形（上宽下窄），这是"锅"和"帽子"的分水岭
  g.beginPath();
  g.moveTo(C - 26, C - 6);
  g.lineTo(C + 26, C - 6);
  g.lineTo(C + 18, C + 20);
  g.lineTo(C - 18, C + 20);
  g.closePath();
  g.fill();
  // 双耳：锅必须有耳，否则就是个碗
  g.beginPath();
  g.arc(C - 33, C - 2, 8, Math.PI * 0.35, Math.PI * 1.65);
  g.stroke();
  g.beginPath();
  g.arc(C + 33, C - 2, 8, Math.PI * 1.35, Math.PI * 2.65);
  g.stroke();
  // 两条蒸汽
  g.beginPath();
  g.moveTo(C - 9, C - 18); g.quadraticCurveTo(C - 15, C - 27, C - 8, C - 34);
  g.stroke();
  g.beginPath();
  g.moveTo(C + 7, C - 16); g.quadraticCurveTo(C + 13, C - 25, C + 6, C - 31);
  g.stroke();
  return c;
}

/* ---------- 信封：方框 + 折角 ---------- */
function mail() {
  const { c, g } = ctx();
  g.beginPath();
  g.roundRect(C - 26, C - 18, 52, 36, 5);
  g.stroke();
  g.beginPath();
  g.moveTo(C - 26, C - 16);
  g.lineTo(C, C + 4);
  g.lineTo(C + 26, C - 16);
  g.stroke();
  return c;
}

/* ---------- 旗子：斜杆 + 三角旗 ---------- */
function flag() {
  const { c, g } = ctx();
  g.beginPath();
  g.moveTo(C - 10, C + 30);
  g.lineTo(C - 10, C - 30);
  g.stroke();
  g.beginPath();
  g.moveTo(C - 10, C - 30);
  g.quadraticCurveTo(C + 30, C - 26, C + 26, C - 10);
  g.quadraticCurveTo(C + 14, C, C - 10, C - 6);
  g.closePath();
  g.fill();
  return c;
}

/* ---------- 齿轮 ---------- */
function gear() {
  const { c, g } = ctx();
  const teeth = 8, rOut = 30, rIn = 22;
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (Math.PI * i) / teeth - Math.PI / 2;
    const r = i % 2 === 0 ? rOut : rIn;
    const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.closePath();
  g.stroke();
  g.beginPath();
  g.arc(C, C, 11, 0, 6.2832);
  g.stroke();
  return c;
}

/* ---------- 书本（图鉴） ---------- */
function book() {
  const { c, g } = ctx();
  g.beginPath();
  g.roundRect(C - 28, C - 24, 56, 48, 5);
  g.stroke();
  g.beginPath();
  g.moveTo(C, C - 24);
  g.lineTo(C, C + 24);
  g.stroke();
  g.beginPath();
  g.moveTo(C - 20, C - 10); g.lineTo(C - 8, C - 10);
  g.moveTo(C - 20, C + 2);  g.lineTo(C - 8, C + 2);
  g.moveTo(C + 8, C - 10);  g.lineTo(C + 20, C - 10);
  g.stroke();
  return c;
}

/* ============================================================================
   资源图标：**彩色填充**子风格
   ----------------------------------------------------------------------------
   概念图里有两套图标，刻意不同、不能混：
     · 场景入口徽标（锤/爪/锅/信/旗）—— 棕色单色**线描**，印在奶油圆钮上
     · Dock 资源计数（果/木/章）—— 彩色**填充**，印在奶油卡片上
   两套的绘制规则一样（画布 128、内容 88、圆头圆角），只有"是否填色"不同。
   混用才是问题：资源做线描会又淡又小，徽标做彩色会抢场景的眼睛。
   ========================================================================== */

/** 彩色图标的画布：以画布中心为原点、按设计尺寸 1:1 书写，再整体放大。
    ⚠ 线宽一律写设计尺寸（如 2），不要再乘 scale ——
    lineWidth 会被当前 transform 一起缩放，乘一次就变成平方，
    描边直接糊死整个图形（果子会变成一颗褐色圆饼）。
    归一化对这类图标是"等比放大"：线宽按设计尺寸写，比例自动保持不变。 */
function colored(ds) {
  const c = createCanvas(S, S), g = c.getContext("2d");
  applyFit(g);
  g.translate(C, C);         // 进入设计空间：原点 = 画布中心
  g.scale(ds, ds);
  g.lineCap = "round";
  g.lineJoin = "round";
  return { c, g, s: ds };
}

/* ---------- 果子：红果 + 绿蒂叶（设计尺寸 20 宽 × 24.5 高） ---------- */
function apple() {
  const { c, g } = colored(88 / 24.5);
  g.beginPath(); g.arc(0, 3.25, 9.5, 0, 6.2832);
  g.fillStyle = "#FF8A72"; g.fill();
  g.strokeStyle = "rgba(140,62,44,.74)"; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.moveTo(0, -6.25);
  g.quadraticCurveTo(2, -11.75, 6, -12.75);
  g.strokeStyle = "#6B8E4E"; g.lineWidth = 2.2; g.stroke();
  g.beginPath(); g.ellipse(6.5, -9.25, 4, 2.3, -0.5, 0, 6.2832);
  g.fillStyle = "#8FD46C"; g.fill();
  return c;
}

/* ---------- 木材：填充木块 + 顶部高光（设计尺寸 20×14） ---------- */
function log() {
  const { c, g } = colored(88 / 20);
  g.beginPath(); g.roundRect(-10, -7, 20, 14, 4);
  g.fillStyle = "#C08A52"; g.fill();
  g.strokeStyle = "rgba(110,70,40,.74)"; g.lineWidth = 2; g.stroke();
  g.fillStyle = "rgba(255,255,255,.46)";
  g.fillRect(-7, -5, 14, 2.4);
  return c;
}

/* ---------- 吧唧：金币 + 内圈（设计尺寸 19×19） ---------- */
function coin() {
  const { c, g } = colored(88 / 19);
  g.beginPath(); g.arc(0, 0, 9.5, 0, 6.2832);
  g.fillStyle = "#FFC84A"; g.fill();
  g.strokeStyle = "rgba(150,96,20,.80)"; g.lineWidth = 2.2; g.stroke();
  g.beginPath(); g.arc(0, 0, 4.2, 0, 6.2832);
  g.fillStyle = "rgba(255,255,255,.74)"; g.fill();
  g.strokeStyle = "rgba(150,96,20,.46)"; g.lineWidth = 1.4; g.stroke();
  return c;
}

/* ---------- 锁：锁梁 + 锁体 + 抠出的钥匙孔 ---------- */
function lock() {
  const { c, g } = ctx();
  g.beginPath();
  g.arc(C, C - 10, 13, Math.PI, 0);
  g.stroke();
  g.beginPath();
  g.roundRect(C - 20, C - 10, 40, 36, 7);
  g.fill();
  // 钥匙孔用 destination-out 抠成透明洞，透出下面的底色
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.arc(C, C + 2, 5.4, 0, 6.2832);
  g.fill();
  g.beginPath();
  g.moveTo(C - 2.6, C + 2);
  g.lineTo(C + 2.6, C + 2);
  g.lineTo(C + 2.6, C + 14);
  g.lineTo(C - 2.6, C + 14);
  g.closePath();
  g.fill();
  g.restore();
  return c;
}

/* 图标清单。第三项 true = 彩色资源图标（已按设计尺寸统一，只居中不再缩放）。
   同一形状允许出多色变体 —— 变体必须共用同一个绘制函数，
   换个函数画第二遍就等于两个图标家族了。 */
const ICONS = [
  ["hammer", hammer], ["paw", paw], ["pot", pot], ["mail", mail], ["flag", flag],
  ["gear", gear], ["book", book],
  ["apple", apple, 1], ["log", log, 1], ["coin", coin, 1],
  ["lock", lock],
  ["paw-red", () => paw(INK_HOT)],
];

for (const [name, fn, noScale] of ICONS) {
  const { canvas, fill } = normalize(fn, !!noScale);
  fs.writeFileSync(path.join(OUT, name + ".png"), canvas.toBuffer("image/png"));
  console.log(`✓ icons/${name}.png  墨迹占画布 ${fill}%${noScale ? "（彩色支，只居中）" : ""}`);
}

/* ---------- 验收图：一行排开 ----------
   只放大到 128 是不够的 —— 必须按**实际显示尺寸**（徽标里 20px）再出一行，
   因为"这套图标乱不乱"是在 20px 下判断的，不是 128px。 */
(async () => {
  const { createCanvas: cc, loadImage } = require("@napi-rs/canvas");
  const names = ICONS.map(x => x[0]);
  const S2 = 96, pad = 14;
  const W = names.length * (S2 + pad) + pad;
  const H = S2 * 2 + pad * 3 + 26;
  const board = cc(W, H), bg = board.getContext("2d");
  bg.fillStyle = "#FFF6E4";
  bg.fillRect(0, 0, W, H);
  const row = async (y, size, label) => {
    for (let i = 0; i < names.length; i++) {
      const im = await loadImage(path.join(OUT, names[i] + ".png"));
      const x = pad + i * (S2 + pad);
      bg.beginPath();
      bg.arc(x + S2 / 2, y + S2 / 2, size / 2 + 4, 0, 6.2832);
      bg.fillStyle = "rgba(255,252,244,.94)";
      bg.fill();
      bg.strokeStyle = "rgba(110,70,44,.82)";
      bg.lineWidth = 2.4;
      bg.stroke();
      bg.drawImage(im, x + (S2 - size) / 2, y + (S2 - size) / 2, size, size);
    }
    bg.fillStyle = "#5A3826";
    bg.font = "bold 12px Microsoft YaHei";
    bg.textAlign = "left";
    bg.fillText(label, pad, y + S2 + 16);
  };
  await row(pad, 96, "96px（源）");
  await row(pad * 2 + S2, 20, "20px（徽标实际显示）");
  bg.fillStyle = "#8A6358";
  bg.font = "bold 11px Microsoft YaHei";
  bg.textAlign = "center";
  for (let i = 0; i < names.length; i++) {
    bg.fillText(names[i], pad + i * (S2 + pad) + S2 / 2, H - 8);
  }
  fs.writeFileSync(path.join(CLIENT, "shots", "_icons.png"), board.toBuffer("image/png"));
  console.log("\n✓ shots/_icons.png");
})();
