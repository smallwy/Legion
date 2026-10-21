/* ============================================================================
   生成 Cocos 侧的「控件质感」资产（面板 / 圆钮 / 细件 / 雾层）
   ----------------------------------------------------------------------------
   为什么要有这个文件：
     game.html 用的是 CSS，Cocos 用的是贴图。同一块面板如果两边各画一遍，
     迟早会分叉 —— 一边改了圆角另一边不知道。所以把面板质感**按同一套参数**
     出成 PNG，两边共用同一份数字（参数表在下面 PARTS / CIRCLES / BITS 里）。

   为什么不做九宫格：
     本屏所有面板都只有**一个尺寸**（hud-prog 恒 330×46、资源卡恒 82×62……）。
     定尺面板用整图，圆角/描边/投影/内高光全部 1:1 正确。
     九宫格的 border 必须 ≥ 圆角，而 hud-prog 是 r23 的胶囊（h 46），
     border 24 > h/2 —— 硬套九宫格只会把圆角压扁。
     **变尺面板（弹窗、按钮）才上九宫格；定尺的不要为了"规范"而九宫格。**

   为什么带 PAD：
     .glass 的投影是 (2,5)、描边 2.8（外扩 1.4）。贴图必须留出这些像素，
     否则投影被裁掉一半 —— 表现出来就是"面板右下缺一条边"。
     每个部件会把自己的 pad 写进 _cocos-assets.json，
     make-scene.js 按 pad 反推节点位置，不再手抄偏移量。

   用法：node build-ui-parts.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const CLIENT = path.join(__dirname, "..");
const OUT = path.join(CLIENT, "assets", "ui", "home");
const SHOTS = path.join(CLIENT, "shots");
const REPORT = path.join(__dirname, "_cocos-assets.json");

for (const d of [OUT, path.join(OUT, "heads-circle")]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

/* ============================================================================
   下面四个函数**逐字照抄** concept/home2-shot.js 与 concept/kit2.js。
   改这里之前先确认概念图那边是不是也该改 —— 抄一半最贵的错。
   ========================================================================== */
function rr(g, x, y, w, h, r) {
  const R = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.beginPath();
  g.moveTo(x + R, y);
  g.lineTo(x + w - R, y);
  g.arc(x + w - R, y + R, R, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - R);
  g.arc(x + w - R, y + h - R, R, 0, Math.PI / 2);
  g.lineTo(x + R, y + h);
  g.arc(x + R, y + h - R, R, Math.PI / 2, Math.PI);
  g.lineTo(x, y + R);
  g.arc(x + R, y + R, R, Math.PI, Math.PI * 1.5);
  g.closePath();
}

function fillStroke(g, fill, stroke, lw) {
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw === undefined ? 2 : lw; g.stroke(); }
}

function uiShadow(g, x, y, w, h, r, dy, color) {
  g.save();
  g.fillStyle = color || "rgba(74,44,24,.22)";
  rr(g, x + 2, y + (dy === undefined ? 5 : dy), w, h, r === undefined ? 0 : r);
  g.fill();
  g.restore();
}

/** 玻璃控件六层（与 game.src.html 的 .glass 同参数） */
function glass(g, x, y, w, h, r, opt) {
  const o = opt || {};
  const rad = r === undefined ? 0 : r;
  const base = o.fill || "rgba(255,251,240,.93)";
  uiShadow(g, x, y, w, h, rad, o.dy, o.shadow);

  const grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, o.fillTop || "rgba(255,254,248,.97)");
  grd.addColorStop(0.55, base);
  grd.addColorStop(1, o.fillBot || "rgba(250,238,218,.95)");
  rr(g, x, y, w, h, rad);
  if (o.dash) g.setLineDash(o.dash);
  fillStroke(g, grd, o.stroke || "rgba(122,80,52,.74)", o.lw === undefined ? 2.8 : o.lw);
  g.setLineDash([]);

  g.save();
  rr(g, x, y, w, h, rad);
  g.clip();
  g.fillStyle = "rgba(255,255,255,.62)";
  g.fillRect(x, y, w, 2.4);
  rr(g, x + 2.2, y + 2.2, w - 4.4, h - 4.4, Math.max(0, rad - 2.2));
  g.strokeStyle = "rgba(255,255,255,.40)";
  g.lineWidth = 1.3;
  g.stroke();
  const igr = g.createLinearGradient(0, y + h - 8, 0, y + h);
  igr.addColorStop(0, "rgba(140,92,52,0)");
  igr.addColorStop(1, "rgba(140,92,52,.14)");
  g.fillStyle = igr;
  g.fillRect(x, y + h - 8, w, 8);
  g.restore();
}

/* ============================================================================
   出图框架：所有部件都用「设计坐标 (0,0)-(w,h)」书写，
   框架负责 pad / 超采样 / 落盘 / 记录 pad
   ========================================================================== */
const parts = {};

/**
 * @param {string} name   文件名（不带 .png）
 * @param {object} box    { w, h, pad:[l,t,r,b], k }  设计尺寸 + 四边留白 + 超采样
 * @param {function} draw (g) => void，用 (0,0) 为左上角的设计坐标画
 */
function part(name, box, draw) {
  const [l, t, r, b] = box.pad;
  const k = box.k || 3;
  const cw = box.w + l + r, ch = box.h + t + b;
  const c = createCanvas(Math.round(cw * k), Math.round(ch * k));
  const g = c.getContext("2d");
  g.scale(k, k);
  g.translate(l, t);
  g.lineCap = "round";
  g.lineJoin = "round";
  draw(g);
  fs.writeFileSync(path.join(OUT, name + ".png"), c.toBuffer("image/png"));
  parts[name] = { w: box.w, h: box.h, cw, ch, pad: [l, t, r, b], k };
  console.log(`✓ ${name}.png  ${cw}×${ch}@${k}x  pad ${l},${t},${r},${b}`);
  return parts[name];
}

/* 玻璃件通用 pad：描边外扩 1.4、投影右下 +2/+5、再加 1px 抗锯齿余量 */
const GPAD = [3, 3, 4, 7];

/* ============================================================================
   一、面板（定尺整图）
   ========================================================================== */
const PANELS = [
  // 名字             宽   高  圆角  玻璃参数
  ["panel-hud-prog", 330, 46, 23, {}],
  ["panel-hud-tip",  236, 30, 15, {}],
  ["panel-res",       82, 62, 19, {}],
  ["panel-go-card",  200, 62, 19, {}],
  ["panel-slot",      40, 62, 13, {}],
  // 刚到家：金色描边（.slot.is-new）
  ["panel-slot-new",  40, 62, 13, {
    fillTop: "rgba(255,244,208,.96)", fill: "rgba(255,240,196,.96)", fillBot: "rgba(255,240,196,.96)",
    stroke: "rgba(200,150,40,.92)", lw: 2.6, dy: 3.5, shadow: "rgba(150,96,20,.28)",
  }],
  // 未解锁：虚线描边（.slot.locked）
  ["panel-slot-locked", 40, 62, 13, {
    fillTop: "rgba(248,240,226,.86)", fill: "rgba(235,222,200,.86)", fillBot: "rgba(235,222,200,.86)",
    stroke: "rgba(122,80,52,.40)", lw: 2.2, dy: 3.5, dash: [6, 5],
    shadow: "rgba(74,44,24,.10)",
  }],
];

for (const [name, w, h, r, o] of PANELS) {
  part(name, { w, h, pad: GPAD }, (g) => glass(g, 0, 0, w, h, r, o));
}

/* ============================================================================
   二、出门主按钮（定尺整图，含厚底 + 投影 + 分隔线 + 三角箭头）
   ----------------------------------------------------------------------------
   概念图 home2-shot.js 的那段是「三层叠出来的厚底」，不是渐变：
     ① 投影 rr(+2, +9)  rgba(74,44,24,.26)
     ② 侧边 rr(0, +6)   #E8A33C + 描边    ← 这一层就是"按下去会动"的那个厚度
     ③ 顶面 rr(0, 0)    #FFCE6E + 描边
     ④ 顶面内 3.4px 高光 rgba(255,255,255,.54)
   顶面必须是**平涂**：换成渐变立刻读成"轻飘飘一张纸"。
   ========================================================================== */
part("btn-go", { w: 502, h: 77, pad: [3, 3, 4, 4], k: 3 }, (g) => {
  const bw = 500, bh = 68, R = 34;
  g.fillStyle = "rgba(74,44,24,.26)";
  rr(g, 2, 9, bw, bh, R);
  g.fill();
  rr(g, 0, 6, bw, bh, R);
  fillStroke(g, "#E8A33C", "rgba(120,64,20,.90)", 3.2);
  rr(g, 0, 0, bw, bh, R);
  fillStroke(g, "#FFCE6E", "rgba(120,64,20,.90)", 3.2);
  g.save();
  rr(g, 0, 0, bw, bh, R);
  g.clip();
  g.fillStyle = "rgba(255,255,255,.54)";
  g.fillRect(0, 0, bw, 3.4);
  g.restore();

  // 分隔竖线
  g.strokeStyle = "rgba(120,64,20,.30)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(152, 14); g.lineTo(152, bh - 14);
  g.stroke();

  // 三角箭头
  g.beginPath();
  g.moveTo(bw - 40, bh / 2 - 9);
  g.lineTo(bw - 25, bh / 2);
  g.lineTo(bw - 40, bh / 2 + 9);
  g.closePath();
  fillStroke(g, "#FBE0A8", "rgba(120,64,20,.70)", 2.2);
});

/* ============================================================================
   三、圆钮：场景徽标 / 右上设置键
   ========================================================================== */
/* 场景入口圆钮 —— 27 → 40。
   27px 时图标内容只有 14.4px，在 720p 的草地上像颗芝麻，玩家认不出是入口；
   放大到 40 之后内容 22px，同时点击区跟到 52（用透明外扩，不改视觉盒）。
   下面的 badge-cap-2/3 是入口的名称标签，尺寸按「2 字 / 3 字 + 左右各 7px」定死，
   不做九宫格 —— 只有两种宽度，出两张图比配 border 四值省事且不会接反。 */
part("badge-ring", { w: 40, h: 40, pad: [3, 3, 4, 5], k: 4 }, (g) => {
  const R = 20;                                    // CSS: 40px 圆
  uiShadow(g, 0, 0, 40, 40, R, 4);
  g.beginPath(); g.arc(R, R, R, 0, 6.2832);
  fillStroke(g, "rgba(255,252,244,.94)", "rgba(110,70,44,.82)", 2.8);
  g.save();
  g.beginPath(); g.arc(R, R, R - 1.4, 0, 6.2832); g.clip();
  g.fillStyle = "rgba(255,255,255,.55)";
  g.fillRect(0, 0, 40, 3.4);
  g.restore();
});

/* 胶囊标签底：半高圆角 = 胶囊。两种宽度，对应 2 字与 3 字 */
for (const [nm, W] of [["badge-cap-2", 34], ["badge-cap-3", 45]]) {
  part(nm, { w: W, h: 18, pad: [1, 1, 2, 4], k: 4 }, (g) => {
    const H = 18, R = H / 2;
    g.beginPath();
    g.moveTo(R, 0);
    g.lineTo(W - R, 0);
    g.arc(W - R, R, R, -Math.PI / 2, Math.PI / 2);
    g.lineTo(R, H);
    g.arc(R, R, R, Math.PI / 2, -Math.PI / 2);
    g.closePath();
    fillStroke(g, "rgba(255,252,244,.94)", "rgba(110,70,44,.60)", 1.6);
  });
}

part("ico-btn", { w: 36, h: 36, pad: [3, 3, 4, 7], k: 4 }, (g) => {
  const R = 18;
  uiShadow(g, 0, 0, 36, 36, R, 5);
  g.beginPath(); g.arc(R, R, R - 1.4, 0, 6.2832);
  const grd = g.createLinearGradient(0, 0, 0, 36);
  grd.addColorStop(0, "rgba(255,254,248,.97)");
  grd.addColorStop(0.55, "rgba(255,251,240,.93)");
  grd.addColorStop(1, "rgba(250,238,218,.95)");
  fillStroke(g, grd, "rgba(122,80,52,.74)", 2.8);
  g.save();
  g.beginPath(); g.arc(R, R, R - 1.4, 0, 6.2832); g.clip();
  g.fillStyle = "rgba(255,255,255,.62)";
  g.fillRect(0, 0, 36, 2.4);
  g.restore();
});

/* ============================================================================
   四、细件
   ========================================================================== */
part("pip-on", { w: 15, h: 15, pad: [2, 2, 2, 2], k: 4 }, (g) => {
  rr(g, 0.8, 0.8, 13.4, 13.4, 4);
  fillStroke(g, "#8FE0B8", "rgba(56,124,88,.82)", 1.6);
});
part("pip", { w: 15, h: 15, pad: [2, 2, 2, 2], k: 4 }, (g) => {
  rr(g, 0.8, 0.8, 13.4, 13.4, 4);
  fillStroke(g, "rgba(112,72,46,.09)", "rgba(112,72,46,.24)", 1.6);
});

part("star", { w: 10, h: 10, pad: [2, 2, 2, 2], k: 4 }, (g) => {
  g.beginPath();
  const pts = [[5, 0], [6.6, 3.4], [10, 5], [6.6, 6.6], [5, 10], [3.4, 6.6], [0, 5], [3.4, 3.4]];
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  fillStroke(g, "#FFC84A", "rgba(150,100,20,.62)", 0.8);
});

/* 饱食格：**底色必须接近白**，因为它的语义靠运行时染色（绿=满饱 / 金=半饿最强 / 红=全饿）。
   ⚠ Cocos 的 Sprite `_color` 是**乘算** tint，只能变暗不能提亮。
     原来底色是 #FFB56A（橙，蓝通道只有 ~106），染绿之后是橄榄色 —— 绿、金、红三档
     会糊成一片"脏橘"。换成近白底，乘算才是干净的档位色。 */
part("belly-bar", { w: 20, h: 9, pad: [2, 2, 2, 2], k: 4 }, (g) => {
  rr(g, 0.7, 0.7, 18.6, 7.6, 4.5);
  fillStroke(g, "#FBF1E4", "rgba(178,110,40,.80)", 1.4);
});

part("tip-arrow", { w: 15, h: 12, pad: [2, 2, 2, 2], k: 4 }, (g) => {
  g.strokeStyle = "rgba(122,80,52,.72)";
  g.lineWidth = 2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(1, 6); g.lineTo(13, 6);
  g.moveTo(8.5, 1); g.lineTo(13.5, 6); g.lineTo(8.5, 11);
  g.stroke();
});

// 「新」角标（.slot .new：14×11 r5.5，金色 + 深棕描边）
part("slot-new", { w: 14, h: 11, pad: [2, 2, 2, 2], k: 4 }, (g) => {
  rr(g, 0.8, 0.8, 12.4, 9.4, 5.5);
  fillStroke(g, "#FFC84A", "rgba(150,96,20,.88)", 1.6);
});

/* ============================================================================
   五、雾层（CSS 的 .fog-top / .fog-bot 是线性渐变，直接出渐变 PNG）
   ========================================================================== */
part("fog-top", { w: 1280, h: 70, pad: [0, 0, 0, 0], k: 2 }, (g) => {
  const grd = g.createLinearGradient(0, 0, 0, 70);
  grd.addColorStop(0, "rgba(255,246,232,.46)");
  grd.addColorStop(1, "rgba(255,246,232,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 1280, 70);
});

part("fog-bot", { w: 1280, h: 152, pad: [0, 0, 0, 0], k: 2 }, (g) => {
  const grd = g.createLinearGradient(0, 0, 0, 152);
  grd.addColorStop(0, "rgba(255,247,232,0)");
  grd.addColorStop(0.5, "rgba(255,246,228,.50)");
  grd.addColorStop(1, "rgba(255,244,222,.84)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 1280, 152);
});

/* ============================================================================
   六、圆形头像（引擎里没有 border-radius，必须把圆裁进 PNG）
   ----------------------------------------------------------------------------
   概念图 petHead() 的做法：圆 d = r×2.16 的头像图裁进半径 r 的圆。
   也就是**头像比圆大 8%，只露出中间那块** —— 这是为了"脸占满圆"而不是"整颗头缩在圆里"。
   直接裁 1:1 会让脸变小一圈，看起来像证件照。
   ========================================================================== */
(async () => {
  const HEAD_IDS = ["sugar-stand", "nian-gao-dog", "tuan-zi-ham",
                    "xue-tuan-rab", "dou-nai-ox", "xing-xie-fox"];
  const K = 3, D = 160;                       // 资产直径 160，引擎里按 44 / 28 显示
  const heads = {};
  for (const id of HEAD_IDS) {
    const img = await loadImage(path.join(SHOTS, "ai", "head", id + "-head@v1.png"));
    const c = createCanvas(D * K, D * K);
    const g = c.getContext("2d");
    g.scale(K, K);
    g.save();
    g.beginPath();
    g.arc(D / 2, D / 2, D / 2, 0, 6.2832);
    g.clip();
    g.fillStyle = "#FFF6E4";
    g.fillRect(0, 0, D, D);
    const d = D * 1.08;                       // = 圆直径 × 1.08，与 r×2.16 / (2r) 同比例
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (D - d) / 2, (D - d) / 2, d, d);
    g.restore();
    fs.writeFileSync(path.join(OUT, "heads-circle", id + ".png"), c.toBuffer("image/png"));
    heads[id] = { w: D, h: D, zoom: 1.08 };
    console.log(`✓ heads-circle/${id}.png  ${D}×${D}@${K}x`);
  }

  /* ---------- 背景：换成烘过场景道具的 v2 ---------- */
  const bgSrc = path.join(SHOTS, "bg", "home-bg@v2.png");
  const bg = await loadImage(bgSrc);
  fs.copyFileSync(bgSrc, path.join(OUT, "bg.png"));
  console.log(`✓ bg.png  ${bg.width}×${bg.height}（v2，已烘入告示板/红旗/光斑）`);

  /* ---------- 合并进 _cocos-assets.json，别覆盖 build-nine-slice 的产物 ---------- */
  let report = {};
  if (fs.existsSync(REPORT)) {
    try { report = JSON.parse(fs.readFileSync(REPORT, "utf8")); } catch (e) {}
  }
  report.parts = parts;
  report.headsCircle = heads;
  report.bg = { w: bg.width, h: bg.height, src: "home-bg@v2.png" };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`\n✓ _cocos-assets.json（parts ${Object.keys(parts).length} / headsCircle ${Object.keys(heads).length}）`);
})();
