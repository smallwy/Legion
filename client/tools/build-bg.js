/* ============================================================================
   把概念图里"补画"的场景道具烘进背景图
   ----------------------------------------------------------------------------
   问题：概念图 home2-shot.js 在 AI 背景之上又用 canvas 补了三样东西
        · noticeBoard(1046, 596)  告示板 —— 「派遣」徽标的落点
        · signFlag(215, 200)      路牌上的小红旗
        · ambient()               草地光斑 / 飘落花瓣 / 爪印串
   而我们的 home-bg@v1.png 里没有这些，于是
        · 「派遣」徽标悬在半空（本该钉在告示板上）
        · 路牌光秃秃的，少了那面红旗
        · 草地干净得像没人住过

   做法：不改运行时，直接把三样东西烘进 v2 背景图。
   这样 game.html 和 Cocos 共用同一张图，两边自动一致，运行时零成本。

   坐标换算（关键，容易错）：
     CSS 里 #bg 是 top:-40px / height:853px 画整张 1536×1024
     → 设计坐标 (x, y) 对应源图像素 (x*1.2, y*1.2 + 48)
     用一个 setTransform 一次性处理，道具函数内部仍按设计坐标写。

   用法：node tools/build-bg.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "shots", "bg", "home-bg@v1.png");
const OUT = path.join(ROOT, "shots", "bg", "home-bg@v2.png");

const K = 1536 / 1280;      // 源图 / 设计 的像素比
const DY = 48;              // 设计 y=0 落在源图的第 48 行

function rr(g, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.lineTo(x + w - rad, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rad);
  g.lineTo(x + w, y + h - rad);
  g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  g.lineTo(x + rad, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rad);
  g.lineTo(x, y + rad);
  g.quadraticCurveTo(x, y, x + rad, y);
  g.closePath();
}
function fillStroke(g, fill, stroke, lw) {
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke && lw) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}

/* ---------- 以下三个函数逐字照抄 concept/home2-shot.js ---------- */

function noticeBoard(g, x, baseY) {
  const bw = 104, bh = 68, legH = 30;
  const ty = baseY - legH - bh;
  g.fillStyle = "rgba(74,44,24,.18)";
  g.beginPath(); g.ellipse(x, baseY + 2, 56, 10, 0, 0, 6.2832); g.fill();
  g.strokeStyle = "#7A5233";
  g.lineWidth = 6.5; g.lineCap = "round";
  for (const dx of [-36, 36]) {
    g.beginPath(); g.moveTo(x + dx, baseY); g.lineTo(x + dx * 0.87, ty + bh - 4); g.stroke();
  }
  rr(g, x - bw / 2 - 5, ty - 5, bw + 10, bh + 10, 7);
  fillStroke(g, "#B07C4C", "rgba(84,52,30,.88)", 3);
  rr(g, x - bw / 2, ty, bw, bh, 4);
  fillStroke(g, "#4E6B52", "rgba(40,58,42,.80)", 2);
  const cards = [[-26, 10, 34, 23], [12, 5, 30, 21], [-8, 40, 40, 19]];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    g.save(); g.globalAlpha = 0.95;
    rr(g, x + c[0], ty + c[1], c[2], c[3], 3);
    fillStroke(g, i === 2 ? "#FFF3D2" : "#FFFCF2", "rgba(84,52,30,.55)", 1.6);
    g.restore();
    g.strokeStyle = "rgba(96,72,48,.42)"; g.lineWidth = 1.3;
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      g.moveTo(x + c[0] + 4, ty + c[1] + 7 + k * 6.5);
      g.lineTo(x + c[0] + c[2] - 5, ty + c[1] + 7 + k * 6.5);
      g.stroke();
    }
  }
  g.beginPath(); g.arc(x + 2, ty - 1, 3.2, 0, 6.2832);
  fillStroke(g, "#E8563C", "rgba(120,40,24,.8)", 1.6);
}

function signFlag(g, x, topY) {
  g.save();
  g.strokeStyle = "rgba(86,54,34,.90)";
  g.lineWidth = 3; g.lineCap = "round";
  g.beginPath(); g.moveTo(x, topY); g.lineTo(x, topY - 40); g.stroke();
  g.beginPath();
  g.moveTo(x, topY - 40);
  g.quadraticCurveTo(x + 32, topY - 36, x + 28, topY - 21);
  g.quadraticCurveTo(x + 16, topY - 11, x, topY - 16);
  g.closePath();
  fillStroke(g, "#FF8E7A", "rgba(150,60,44,.86)", 2.6);
  g.restore();
}

function ambient(g) {
  // 草地光斑
  for (const s of [[700, 476, 130, .22], [986, 528, 108, .17], [372, 546, 96, .19], [1186, 470, 84, .14]]) {
    const gr = g.createRadialGradient(s[0], s[1], 2, s[0], s[1], s[2]);
    gr.addColorStop(0, `rgba(255,242,196,${s[3]})`);
    gr.addColorStop(1, "rgba(255,242,196,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(s[0], s[1], s[2], 0, 6.2832); g.fill();
  }
  // 飘落的花瓣
  const petals = [
    [120, 300, 7, .58, -0.40], [340, 252, 5, .44, 0.30], [724, 178, 6, .52, -0.25],
    [1052, 258, 5, .40, 0.50], [884, 342, 4.5, .34, -0.50], [210, 432, 6, .46, 0.20],
    [604, 524, 5, .40, -0.30], [1242, 392, 5, .36, 0.60], [422, 340, 4, .30, 0.40],
    [676, 420, 5.5, .42, -0.15], [96, 520, 5, .32, 0.35], [1150, 200, 4.5, .28, -0.45],
  ];
  for (const p of petals) {
    g.save();
    g.translate(p[0], p[1]);
    g.rotate(p[4]);
    g.globalAlpha = p[3];
    g.beginPath(); g.ellipse(0, 0, p[2], p[2] * 0.52, 0, 0, 6.2832);
    g.fillStyle = "#FFF6EC"; g.fill();
    g.strokeStyle = "rgba(232,178,156,.55)"; g.lineWidth = 0.9; g.stroke();
    g.restore();
  }
  // 爪印串：从屋门走向路牌
  const trail = [[452, 584, 1.0], [418, 597, .93], [382, 607, .86], [346, 614, .79], [310, 620, .72]];
  for (const t of trail) {
    g.save();
    g.globalAlpha = 0.16 + 0.26 * t[2];
    g.fillStyle = "#C29255";
    g.beginPath(); g.ellipse(t[0], t[1], 5.4 * t[2], 4.3 * t[2], 0, 0, 6.2832); g.fill();
    for (const a of [-0.72, -0.24, 0.24, 0.72]) {
      g.beginPath();
      g.ellipse(t[0] + Math.sin(a) * 5.6 * t[2], t[1] - 3.7 * t[2] - Math.cos(a) * 1.7 * t[2],
                1.8 * t[2], 2.2 * t[2], a * 0.4, 0, 6.2832);
      g.fill();
    }
    g.restore();
  }
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error("✗ 找不到 " + SRC);
    process.exit(1);
  }
  const bg = await loadImage(SRC);
  console.log(`源图 ${bg.width}×${bg.height}`);

  const cv = createCanvas(bg.width, bg.height);
  const g = cv.getContext("2d");
  g.drawImage(bg, 0, 0);

  // 之后所有绘制都用设计坐标写
  g.save();
  g.setTransform(K, 0, 0, K, 0, DY);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";

  ambient(g);
  noticeBoard(g, 1046, 596);
  signFlag(g, 215, 200);

  g.restore();
  fs.writeFileSync(OUT, cv.toBuffer("image/png"));
  console.log("✓ shots/bg/home-bg@v2.png  " + (fs.statSync(OUT).size / 1024).toFixed(0) + " KB");
  console.log("  已补：草地光斑 + 12 片花瓣 + 5 个爪印 + 告示板(1046,596) + 路牌红旗(215,200)");
})();
