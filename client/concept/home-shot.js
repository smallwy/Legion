/* ============================================================================
   home-shot.js —— 主界面（家园）正式布局基准图 @v1
   ----------------------------------------------------------------------------
   和 concept2-shot.js 的 drawHome() 的区别：
     1. 六只换成 AI 立绘（透明底 PNG），不再用矢量 drawPal
     2. 功能盘更新：+ 派遣黑板，- 今日目标（与"不做手游日常"冲突）
     3. 去掉底部功能栏（Steam 横屏不该有手游底栏），全部走"建筑即入口 + 顶部资源条"
     4. 全部坐标是 1280×720 的正式规格，不是美术稿

   运行：
     NODE_PATH=<managed>/node_modules node client/concept/home-shot.js
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const K = require("./kit2.js");

const { W, H, T, rr, fs: fillStroke, text, star } = K;

const OUT = path.join(__dirname, "..", "shots");
const AI = path.join(OUT, "ai");

/* ============================================================================
   0. 布局规格（这组数字就是交付给引擎的规格，改这里等于改规格）
   ========================================================================== */

const LAYOUT = {
  hud: { y: 20, h: 64 },
  horizon: 430,

  /* 五个建筑：全部压在后排（baseY ≤ 505），把 footY ≥ 560 的前排完整让给宠物。
     这是 v2.1 立的规矩 —— 前后排不分，建筑和宠物必然打架。 */
  stove:       { x: 90,   baseY: 505, s: 0.92, label: "灶台",   sub: "喂饭" },
  workbench:   { x: 250,  baseY: 498, s: 0.88, label: "工作台", sub: "做道具" },
  hut:         { x: 460,  baseY: 486, s: 0.88 },
  signpost:    { x: 830,  baseY: 505, s: 1.02, label: "出门",   sub: "选产地" },
  noticeBoard: { x: 1000, baseY: 500, s: 0.85, label: "派遣",   sub: "五只看家" },

  /* 六只：位置即性格，距离即亲密度。
     前排（大）→ 中排 → 高处/栅栏（小）= 三层纵深，不是六个并排的摆件 */
  pets: [
    { id: "tuan-zi-ham",  cx: 150, footY: 620, h: 126, why: "灶台前守锅" },
    { id: "dou-nai-ox",   cx: 332, footY: 596, h: 118, why: "工作台前阴凉" },
    { id: "xue-tuan-rab", cx: 520, footY: 604, h: 106, why: "屋门口草堆" },
    { id: "sugar-stand",  cx: 600, footY: 300, h: 88,  why: "屋顶俯视" },
    { id: "nian-gao-dog", cx: 900, footY: 610, h: 128, why: "路牌旁等出门" },
    { id: "xing-xie-fox", cx: 1178, footY: 402, h: 78, why: "栅栏最右，最远" },
  ],
};

/* ============================================================================
   1. 场景零件（沿用 concept2 已验收的画法）
   ========================================================================== */

function cloud(g, x, y, s, alpha) {
  g.save();
  g.globalAlpha = alpha === undefined ? 1 : alpha;
  g.fillStyle = "#FFFFFF";
  for (const c of [[-1.04, 0.12, 0.52], [-0.26, -0.40, 0.76], [0.66, -0.02, 0.58]]) {
    g.beginPath(); g.arc(x + c[0] * s, y + c[1] * s, c[2] * s, 0, 6.2832); g.fill();
  }
  rr(g, x - s * 1.50, y + s * 0.16, s * 3.0, s * 0.40, s * 0.20);
  g.fill();
  g.restore();
}

function hill(g, baseY, amp, color, alpha, seed) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, baseY + 60);
  for (let x = 0; x <= W; x += 14) {
    const t = x / W;
    const hh = amp * (0.58 + 0.42 * Math.sin(t * 6.2 + seed) * Math.cos(t * 2.7 + seed * 1.6));
    g.lineTo(x, baseY - hh);
  }
  g.lineTo(W, baseY + 60);
  g.closePath();
  g.fill();
  g.restore();
}

function sign(g, x, y, label, tone, sub) {
  const w = label.length * 13 + 30, h = 26;
  g.fillStyle = "rgba(74,44,24,.14)";
  rr(g, x - w / 2, y - h / 2 + 3, w, h, 13); g.fill();
  rr(g, x - w / 2, y - h / 2, w, h, 13);
  fillStroke(g, tone || "#FFE08A", T.ink, 3);
  text(g, label, x, y - (sub ? 2 : 0), 13.5, T.ink, true);
  if (sub) text(g, sub, x, y + 11, 9.5, "rgba(107,74,66,.62)", false);
}

function stove(g, x, baseY, s) {
  const w = 124 * s, h = 86 * s;
  rr(g, x, baseY - h, w, h, 12 * s);
  fillStroke(g, "#C9B49A", T.ink, 4);
  g.beginPath();
  g.moveTo(x + w * 0.28, baseY - 12 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - 46 * s, x + w * 0.72, baseY - 12 * s);
  g.closePath();
  fillStroke(g, "#8A6A50", T.ink, 3);
  g.beginPath();
  g.moveTo(x + w * 0.40, baseY - 14 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - 34 * s, x + w * 0.60, baseY - 14 * s);
  g.closePath();
  fillStroke(g, "#FFB05A", null, 0);
  rr(g, x - 6 * s, baseY - h - 10 * s, w + 12 * s, 16 * s, 8 * s);
  fillStroke(g, "#E2CBAC", T.ink, 4);
  const cxq = x + w / 2, cyq = baseY - h - 12 * s;
  g.beginPath();
  g.ellipse(cxq, cyq, 40 * s, 13 * s, 0, 0, 6.2832);
  fillStroke(g, "#6E5A4E", T.ink, 3.6);
  g.beginPath();
  g.ellipse(cxq, cyq - 2 * s, 34 * s, 10 * s, 0, 0, 6.2832);
  fillStroke(g, "#A8825E", null, 0);
  g.strokeStyle = "rgba(255,255,255,.78)";
  g.lineWidth = 3.4 * s;
  g.lineCap = "round";
  for (const d of [-1, 0, 1]) {
    g.beginPath();
    g.moveTo(cxq + d * 16 * s, cyq - 16 * s);
    g.quadraticCurveTo(cxq + d * 16 * s - 7 * s, cyq - 30 * s,
                       cxq + d * 16 * s + 2 * s, cyq - 44 * s);
    g.stroke();
  }
}

function workbench(g, x, baseY, s) {
  const w = 132 * s, h = 34 * s;
  for (const dx of [0.10, 0.86]) {
    rr(g, x + w * dx - 6 * s, baseY - 44 * s, 12 * s, 44 * s, 4 * s);
    fillStroke(g, "#A97244", T.ink, 3.4);
  }
  rr(g, x, baseY - 56 * s, w, h, 7 * s);
  fillStroke(g, "#C98B57", T.ink, 4);
  rr(g, x + 4 * s, baseY - 54 * s, w - 8 * s, 9 * s, 4 * s);
  fillStroke(g, "#E0AC78", null, 0);
  g.save();
  g.translate(x + w * 0.34, baseY - 64 * s);
  g.rotate(-0.24);
  rr(g, -26 * s, -4 * s, 52 * s, 12 * s, 3 * s);
  fillStroke(g, "#B9C2CC", T.ink, 3);
  g.restore();
  g.save();
  g.translate(x + w * 0.74, baseY - 66 * s);
  g.rotate(0.34);
  rr(g, -3 * s, -14 * s, 6 * s, 30 * s, 3 * s);
  fillStroke(g, "#B07848", T.ink, 2.8);
  rr(g, -13 * s, -22 * s, 26 * s, 12 * s, 3 * s);
  fillStroke(g, "#8E929C", T.ink, 3);
  g.restore();
}

function signpost(g, x, baseY, items, s) {
  rr(g, x - 6 * s, baseY - 132 * s, 12 * s, 132 * s, 4 * s);
  fillStroke(g, "#A97244", T.ink, 3.6);
  items.forEach((it, i) => {
    const y = baseY - 122 * s + i * 40 * s;
    const w = 108 * s, h = 30 * s;
    const on = it.on;
    g.save();
    g.translate(x, y);
    rr(g, -w / 2, -h / 2, w, h, 6 * s);
    fillStroke(g, on ? "#FFE08A" : "#E4CBA4", T.ink, on ? 3.6 : 3);
    text(g, it.name, 0, 0, 12 * s, on ? T.ink : "rgba(107,74,66,.72)", on, "center");
    if (it.lock) {
      g.strokeStyle = "rgba(107,74,66,.70)";
      g.lineWidth = 2.4 * s;
      g.beginPath();
      g.arc(-w * 0.30, -9 * s, 4.5 * s, Math.PI, 0);
      g.stroke();
      rr(g, -w * 0.30 - 4.5 * s, -9 * s, 9 * s, 8 * s, 2 * s);
      fillStroke(g, "#C9B49A", "rgba(107,74,66,.70)", 2 * s);
    }
    g.restore();
  });
}

function hut(g, x, baseY, s) {
  const w = 250 * s, wallH = 140 * s, roofH = 96 * s;
  rr(g, x, baseY - wallH, w, wallH, 16 * s);
  fillStroke(g, "#FFE3AC", T.ink, 4.5);
  g.save();
  rr(g, x, baseY - wallH, w, wallH, 16 * s);
  g.clip();
  g.fillStyle = "rgba(226,160,90,.22)";
  g.fillRect(x, baseY - wallH * 0.26, w, wallH * 0.26);
  g.restore();

  g.beginPath();
  g.moveTo(x - 22 * s, baseY - wallH + 10 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - wallH - roofH * 1.62, x + w + 22 * s, baseY - wallH + 10 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - wallH - 8 * s, x - 22 * s, baseY - wallH + 10 * s);
  g.closePath();
  fillStroke(g, "#F08C6A", T.ink, 5);
  g.save();
  g.beginPath();
  g.moveTo(x - 22 * s, baseY - wallH + 10 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - wallH - roofH * 1.62, x + w + 22 * s, baseY - wallH + 10 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - wallH - 8 * s, x - 22 * s, baseY - wallH + 10 * s);
  g.closePath();
  g.clip();
  g.strokeStyle = "rgba(200,90,60,.30)";
  g.lineWidth = 4 * s;
  for (let i = -2; i < 9; i++) {
    g.beginPath();
    g.moveTo(x + i * 34 * s, baseY - wallH + 14 * s);
    g.lineTo(x + i * 34 * s - 26 * s, baseY - wallH - roofH * 1.7);
    g.stroke();
  }
  g.restore();

  // 门
  const dw = 74 * s, dh = 104 * s, dx = x + w * 0.5 - dw / 2;
  g.beginPath();
  g.moveTo(dx, baseY);
  g.lineTo(dx, baseY - dh + 18 * s);
  g.quadraticCurveTo(dx + dw / 2, baseY - dh - 22 * s, dx + dw, baseY - dh + 18 * s);
  g.lineTo(dx + dw, baseY);
  g.closePath();
  fillStroke(g, "#8A5A3C", T.ink, 4);
  // 窗（左右各一）
  for (const wx of [x + w * 0.14, x + w * 0.72]) {
    rr(g, wx, baseY - wallH * 0.74, 52 * s, 44 * s, 7 * s);
    fillStroke(g, "#FFD98A", T.ink, 3.4);
    g.strokeStyle = "rgba(107,74,66,.55)";
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(wx + 26 * s, baseY - wallH * 0.74);
    g.lineTo(wx + 26 * s, baseY - wallH * 0.74 + 44 * s);
    g.stroke();
  }
  // 门把手
  g.beginPath();
  g.arc(dx + dw * 0.80, baseY - dh * 0.46, 4.2 * s, 0, 6.2832);
  fillStroke(g, "#F5C542", T.ink, 2.4);
  // 台阶
  rr(g, dx - 16 * s, baseY - 8 * s, dw + 32 * s, 14 * s, 7 * s);
  fillStroke(g, "#D9C0A0", T.ink, 3.2);
}

function tree2(g, x, baseY, r) {
  g.fillStyle = "#B07848";
  rr(g, x - 7, baseY - r * 0.62, 14, r * 0.66, 5);
  g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 3.5; g.stroke();
  for (const c of [[0, -1.02, 0.74], [-0.62, -0.52, 0.58], [0.64, -0.52, 0.58], [0, -0.42, 0.66]]) {
    g.beginPath(); g.arc(x + c[0] * r, baseY - r * 0.62 + c[1] * r, c[2] * r, 0, 6.2832);
    fillStroke(g, "#6FC35C", T.ink, 4);
  }
  g.fillStyle = "rgba(255,255,255,.34)";
  g.beginPath(); g.arc(x - r * 0.30, baseY - r * 1.42, r * 0.20, 0, 6.2832); g.fill();
}

function fence(g, y, x0, x1) {
  const step = 46;
  for (let x = x0; x <= x1; x += step) {
    rr(g, x - 7, y - 44, 14, 52, 6);
    fillStroke(g, "#F7DCA8", T.ink, 3.5);
    g.beginPath();
    g.moveTo(x - 7, y - 44);
    g.quadraticCurveTo(x, y - 58, x + 7, y - 44);
    g.closePath();
    fillStroke(g, "#F7DCA8", T.ink, 3.5);
  }
  for (const yy of [y - 38, y - 16]) {
    rr(g, x0 - 8, yy, x1 - x0 + 16, 9, 5);
    fillStroke(g, "#EFCE96", T.ink, 3);
  }
}

function bowl(g, x, y, s, full) {
  g.beginPath();
  g.moveTo(x - 30 * s, y - 16 * s);
  g.quadraticCurveTo(x, y + 26 * s, x + 30 * s, y - 16 * s);
  g.closePath();
  fillStroke(g, "#EFB25E", T.ink, 4);
  g.beginPath();
  g.ellipse(x, y - 16 * s, 30 * s, 10 * s, 0, 0, 6.2832);
  fillStroke(g, "#FFD79A", T.ink, 3.5);
  if (full) {
    for (const p of [[-13, -4], [0, -7], [13, -3], [-6, 4], [7, 4]]) {
      g.beginPath();
      g.arc(x + p[0] * s, y - 16 * s + p[1] * s, 6.5 * s, 0, 6.2832);
      fillStroke(g, "#F2764F", T.ink2, 2);
    }
  }
}

function bed(g, x, y, s) {
  g.beginPath();
  g.ellipse(x, y, 62 * s, 20 * s, 0, 0, 6.2832);
  fillStroke(g, "#F2A0B4", T.ink, 4);
  g.beginPath();
  g.ellipse(x, y - 5 * s, 50 * s, 14 * s, 0, 0, 6.2832);
  fillStroke(g, "#FFC6D4", null, 0);
  g.strokeStyle = "rgba(200,90,120,.45)";
  g.lineWidth = 2;
  g.setLineDash([5, 6]);
  g.beginPath();
  g.ellipse(x, y, 54 * s, 16 * s, 0, 0, 6.2832);
  g.stroke();
  g.setLineDash([]);
}

/** 派遣黑板：v2 没有的新入口。五只钉在上面 = "谁在家、谁在外面" */
function noticeBoard(g, x, baseY, s) {
  const w = 150 * s, h = 104 * s;
  // 两条腿
  for (const dx of [0.16, 0.84]) {
    rr(g, x + w * dx - 5 * s, baseY - 52 * s, 10 * s, 52 * s, 3 * s);
    fillStroke(g, "#A97244", T.ink, 3.2);
  }
  // 板面
  rr(g, x, baseY - h - 46 * s, w, h, 8 * s);
  fillStroke(g, "#4E6B4A", T.ink, 4);
  // 木框
  g.strokeStyle = "#C98B57";
  g.lineWidth = 5 * s;
  rr(g, x + 3 * s, baseY - h - 43 * s, w - 6 * s, h - 6 * s, 6 * s);
  g.stroke();
  // 钉着的五张小卡：2 张已派（空）+ 3 张在家
  const cols = 5;
  for (let i = 0; i < cols; i++) {
    const cw = 20 * s, chh = 24 * s;
    const cx = x + w / 2 + (i - (cols - 1) / 2) * (cw + 5 * s) - cw / 2;
    const cy = baseY - h - 34 * s;
    rr(g, cx, cy, cw, chh, 3 * s);
    fillStroke(g, i < 2 ? "#FFF1D6" : "#FFE08A", "rgba(255,255,255,.8)", 1.6 * s);
    if (i < 2) {
      // 已派：划一道
      g.strokeStyle = "rgba(107,74,66,.55)";
      g.lineWidth = 2 * s;
      g.beginPath();
      g.moveTo(cx + 4 * s, cy + chh - 5 * s);
      g.lineTo(cx + cw - 4 * s, cy + 5 * s);
      g.stroke();
    }
  }
  // 粉笔槽
  rr(g, x + 8 * s, baseY - h - 26 * s, w - 16 * s, 7 * s, 3 * s);
  fillStroke(g, "#8A6A50", null, 0);
}

/** 玩具球 */
function toyBall(g, x, y, r) {
  g.beginPath(); g.arc(x, y, r, 0, 6.2832);
  fillStroke(g, "#7EC8F0", T.ink, 3.4);
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.clip();
  g.strokeStyle = "#FFFFFF"; g.lineWidth = r * 0.34;
  g.beginPath(); g.arc(x, y - r * 1.1, r * 1.3, 0.4, Math.PI - 0.4); g.stroke();
  g.beginPath(); g.arc(x, y + r * 1.1, r * 1.3, Math.PI + 0.4, -0.4); g.stroke();
  g.restore();
  g.fillStyle = "rgba(255,255,255,.75)";
  g.beginPath(); g.arc(x - r * 0.34, y - r * 0.38, r * 0.20, 0, 6.2832); g.fill();
}

/* ============================================================================
   2. AI 立绘合成
   ========================================================================== */

function aiPet(g, img, cx, footY, h) {
  const s = h / img.height;
  const w = img.width * s;
  // 落地影：没有影子，远处的小只读成"贴纸浮空"
  g.save();
  g.fillStyle = "rgba(74,44,24,.17)";
  g.beginPath();
  g.ellipse(cx, footY, Math.max(10, w * 0.32), Math.max(4, h * 0.05), 0, 0, 6.2832);
  g.fill();
  g.restore();
  g.drawImage(img, cx - w / 2, footY - h, w, h);
}


/** 需求气泡：信息长在角色身上，不占 HUD。
    两个信号正好对应双循环 —— 碗 = 该喂饭，爪印 = 该出门 */
function wantBubble(g, x, y, kind, s) {
  const R = 17 * s, CREAM = "#FFF6E4";
  g.beginPath();
  g.moveTo(x - R * 0.34, y + R * 0.84);
  g.lineTo(x + R * 0.34, y + R * 0.84);
  g.lineTo(x, y + R * 1.54);
  g.closePath();
  fillStroke(g, CREAM, T.ink, 3);
  g.beginPath(); g.arc(x, y, R, 0, 6.2832);
  fillStroke(g, CREAM, T.ink, 3.2);
  g.fillStyle = CREAM;
  g.fillRect(x - R * 0.30, y + R * 0.74, R * 0.60, 7);

  if (kind === "food") {
    g.beginPath();
    g.moveTo(x - R * 0.46, y - R * 0.10);
    g.quadraticCurveTo(x, y + R * 0.46, x + R * 0.46, y - R * 0.10);
    g.closePath();
    fillStroke(g, "#EFB25E", T.ink, 2.2);
    g.beginPath();
    g.ellipse(x, y - R * 0.10, R * 0.46, R * 0.16, 0, 0, 6.2832);
    fillStroke(g, "#FFD79A", T.ink, 1.8);
  } else if (kind === "paw") {
    // 肉垫：一个大掌 + 三个小趾
    g.beginPath(); g.ellipse(x, y + R * 0.16, R * 0.30, R * 0.24, 0, 0, 6.2832);
    fillStroke(g, "#F2764F", T.ink, 2);
    for (const a of [-0.62, 0, 0.62]) {
      g.beginPath();
      g.arc(x + Math.sin(a) * R * 0.40, y - R * 0.20 - Math.cos(a) * R * 0.12, R * 0.13, 0, 6.2832);
      fillStroke(g, "#F2764F", T.ink, 1.8);
    }
  }
}

/* ============================================================================
   3. HUD（顶部资源条）
   ========================================================================== */

function pill(g, x, y, w, h, fill) {
  g.fillStyle = "rgba(74,44,24,.13)";
  rr(g, x, y + 4, w, h, h / 2); g.fill();
  rr(g, x, y, w, h, h / 2);
  fillStroke(g, fill || "#FFF6E4", T.ink, 3.2);
}

function iconApple(g, x, y, r) {
  g.beginPath(); g.arc(x, y + r * 0.16, r, 0, 6.2832);
  fillStroke(g, "#F2764F", T.ink, 2.6);
  g.strokeStyle = "#6E4A2C"; g.lineWidth = 2.4; g.lineCap = "round";
  g.beginPath(); g.moveTo(x, y - r * 0.78); g.lineTo(x + r * 0.1, y - r * 1.34); g.stroke();
  g.beginPath();
  g.ellipse(x + r * 0.46, y - r * 1.18, r * 0.36, r * 0.20, -0.6, 0, 6.2832);
  fillStroke(g, "#6FC35C", null, 0);
  g.fillStyle = "rgba(255,255,255,.5)";
  g.beginPath(); g.arc(x - r * 0.34, y - r * 0.1, r * 0.26, 0, 6.2832); g.fill();
}

function iconLog(g, x, y, r) {
  for (let i = 0; i < 2; i++) {
    g.save();
    g.translate(x + (i - 0.5) * r * 0.9, y + r * 0.5 - i * r * 0.34);
    g.rotate(i ? 0.12 : -0.08);
    rr(g, -r * 1.0, -r * 0.34, r * 2.0, r * 0.68, r * 0.3);
    fillStroke(g, "#C98B57", T.ink, 2.6);
    g.beginPath();
    g.ellipse(-r * 0.98, 0, r * 0.22, r * 0.34, 0, 0, 6.2832);
    fillStroke(g, "#E8C49A", T.ink, 2.2);
    g.restore();
  }
}

function iconBadge(g, x, y, r) {
  star(g, x, y, r, r * 0.44, "#F5C542", T.ink, 2.8, 5);
}

function iconBook(g, x, y, r) {
  rr(g, x - r * 0.86, y - r, r * 1.72, r * 2, r * 0.24);
  fillStroke(g, "#D9C8F0", T.ink, 2.8);
  g.strokeStyle = "rgba(107,74,66,.4)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, y - r * 0.86); g.lineTo(x, y + r * 0.86); g.stroke();
}

function iconBag(g, x, y, r) {
  rr(g, x - r * 0.92, y - r * 0.5, r * 1.84, r * 1.5, r * 0.4);
  fillStroke(g, "#C8A26E", T.ink, 2.8);
  g.strokeStyle = T.ink; g.lineWidth = 2.4;
  g.beginPath();
  g.arc(x, y - r * 0.5, r * 0.5, Math.PI, 0);
  g.stroke();
}

function iconGear(g, x, y, r) {
  g.save();
  g.translate(x, y);
  g.fillStyle = "#E4D6C2";
  g.strokeStyle = T.ink; g.lineWidth = 2.6;
  for (let i = 0; i < 8; i++) {
    g.save();
    g.rotate((i / 8) * 6.2832);
    rr(g, -r * 0.18, -r * 1.06, r * 0.36, r * 0.48, r * 0.1);
    g.fill(); g.stroke();
    g.restore();
  }
  g.beginPath(); g.arc(0, 0, r * 0.72, 0, 6.2832);
  g.fill(); g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.30, 0, 6.2832);
  g.fillStyle = "#FFF6E4"; g.fill(); g.stroke();
  g.restore();
}

function drawHUD(g) {
  const { y, h } = LAYOUT.hud;
  const ph = 52, py = y + (h - ph) / 2;

  // 左：食物 / 材料
  pill(g, 64, py, 136, ph);
  iconApple(g, 96, py + ph / 2, 15);
  text(g, "38", 132, py + ph / 2, 20, T.ink, true, "left");

  pill(g, 212, py, 136, ph);
  iconLog(g, 244, py + ph / 2, 15);
  text(g, "12", 282, py + ph / 2, 20, T.ink, true, "left");

  // 右：吧唧 / 图鉴 / 背包 / 设置
  pill(g, 888, py, 78, ph);
  iconBadge(g, 918, py + ph / 2, 15);
  text(g, "7", 946, py + ph / 2, 20, T.ink, true, "left");

  pill(g, 978, py, 86, ph);
  iconBook(g, 1006, py + ph / 2, 15);
  text(g, "4/6", 1030, py + ph / 2, 15, T.ink, true, "left");

  pill(g, 1076, py, 64, ph);
  iconBag(g, 1108, py + ph / 2, 16);

  pill(g, 1152, py, 64, ph);
  iconGear(g, 1184, py + ph / 2, 15);
}

/* ============================================================================
   4. 主绘制
   ========================================================================== */

function meadow(g) {
  const HZ = LAYOUT.horizon;
  // 远草 → 近草（两段，不用渐变）
  g.fillStyle = "#8FD86B";
  g.fillRect(0, HZ - 18, W, 120);
  g.fillStyle = "#7ECC61";
  g.fillRect(0, HZ + 96, W, H - HZ - 96);

  // 草皮波浪边：远草压近草，读成"第二层地面"
  g.beginPath();
  g.moveTo(0, HZ + 96);
  for (let x = 0; x <= W; x += 24) {
    g.quadraticCurveTo(x + 12, HZ + 96 + 9, x + 24, HZ + 96);
  }
  g.lineTo(W, HZ + 130);
  g.lineTo(0, HZ + 130);
  g.closePath();
  g.fillStyle = "#7ECC61";
  g.fill();

  // 小路（从门口斜向右下，给"出门"一条视觉引线）
  g.beginPath();
  g.moveTo(700, HZ + 50);
  g.bezierCurveTo(800, HZ + 110, 920, HZ + 210, 960, H);
  g.lineTo(1130, H);
  g.bezierCurveTo(1080, HZ + 200, 940, HZ + 80, 830, HZ + 40);
  g.closePath();
  g.fillStyle = "rgba(226,203,156,.52)";
  g.fill();

  // 草丛（避开六只的站位）
  for (const c of [[446, 646, 1], [762, 664, .8], [1078, 604, .9], [500, 512, .6], [1214, 516, .7]]) {
    g.strokeStyle = "rgba(58,132,58,.42)";
    g.lineWidth = 2.8 * c[2];
    g.lineCap = "round";
    for (const d of [-1.4, -0.5, 0.5, 1.4]) {
      g.beginPath();
      g.moveTo(c[0] + d * 4, c[1]);
      g.quadraticCurveTo(c[0] + d * 7, c[1] - 10 * c[2], c[0] + d * 6 + 3, c[1] - 17 * c[2]);
      g.stroke();
    }
  }

  // 前景压深：底部一条淡暗带，把视线推回画面中段（不做渐变）
  g.fillStyle = "rgba(74,44,24,.055)";
  g.fillRect(0, 652, W, H - 652);
}

function flowerBed(g, bx, by, bw, bh) {
  rr(g, bx, by, bw, bh, 14);
  fillStroke(g, "#9A6B44", T.ink, 3.5);
  rr(g, bx + 6, by + 8, bw - 12, bh - 18, 9);
  fillStroke(g, "#7A5136", null, 0);
  const flowers = [
    [bx + 26, by + 8, "#FF8FA8"], [bx + 58, by + 2, "#FFD86B"],
    [bx + 92, by + 9, "#C89BE9"], [bx + 124, by + 3, "#FF8FA8"],
    [bx + 150, by + 10, "#8FD8F0"],
  ];
  for (const f of flowers) {
    g.strokeStyle = "#4E9146"; g.lineWidth = 3; g.lineCap = "round";
    g.beginPath(); g.moveTo(f[0], f[1] + 6); g.lineTo(f[0], f[1] - 12); g.stroke();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * 6.2832 - Math.PI / 2;
      g.beginPath();
      g.arc(f[0] + Math.cos(a) * 5.4, f[1] - 12 + Math.sin(a) * 5.4, 4.2, 0, 6.2832);
      fillStroke(g, f[2], T.ink, 1.6);
    }
    g.beginPath(); g.arc(f[0], f[1] - 12, 3.4, 0, 6.2832);
    fillStroke(g, "#FFE58A", null, 0);
  }
}

async function main() {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  /* ---------- 天空（唯一允许渐变的地方） ---------- */
  const sky = g.createLinearGradient(0, 0, 0, LAYOUT.horizon + 40);
  sky.addColorStop(0, "#8FD3F4");
  sky.addColorStop(0.55, "#BFE8F8");
  sky.addColorStop(1, "#EAF7DC");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, LAYOUT.horizon + 40);

  cloud(g, 210, 148, 40, 0.94);
  cloud(g, 604, 106, 30, 0.60);
  cloud(g, 1006, 150, 46, 0.46);
  cloud(g, 866, 92, 24, 0.34);
  cloud(g, 470, 176, 22, 0.30);

  hill(g, 386, 58, "#B7E4C4", 1, 1.0);
  hill(g, 408, 42, "#97D3A2", 1, 2.2);

  /* ---------- 草地 ---------- */
  meadow(g);

  /* ---------- 树（只放边缘） ---------- */
  tree2(g, 58, 486, 40);
  tree2(g, 1246, 474, 34);

  /* ---------- 栅栏：右段围住院子 ---------- */
  fence(g, 440, 700, 1216);

  /* ---------- 小屋 ---------- */
  hut(g, LAYOUT.hut.x, LAYOUT.hut.baseY, LAYOUT.hut.s);

  /* ---------- 花圃（栅栏前，不挡任何入口） ---------- */
  flowerBed(g, 686, 468, 84, 44);

  /* ---------- 灶台 / 工作台 / 派遣板 ---------- */
  stove(g, LAYOUT.stove.x, LAYOUT.stove.baseY, LAYOUT.stove.s);
  workbench(g, LAYOUT.workbench.x, LAYOUT.workbench.baseY, LAYOUT.workbench.s);
  noticeBoard(g, LAYOUT.noticeBoard.x, LAYOUT.noticeBoard.baseY, LAYOUT.noticeBoard.s);

  /* ---------- 路牌（出门主入口）。牌子居中钉在柱子上，不做箭头 ——
       路牌在画面右侧，箭头朝左会直接指向小屋，读成"小屋是产地" ---------- */
  signpost(g, LAYOUT.signpost.x, LAYOUT.signpost.baseY, [
    { name: "苔藓林", on: true },
    { name: "枯木坡" },
    { name: "泥沼", lock: true },
  ], LAYOUT.signpost.s);

  /* ---------- 地面家具 ---------- */
  bowl(g, 216, 662, 1.05, false);
  bed(g, 404, 678, 1.0);
  toyBall(g, 476, 692, 14);

  /* ---------- 六只：按 footY 排序，远的先画 ---------- */
  const pets = [...LAYOUT.pets].sort((a, b) => a.footY - b.footY);
  for (const p of pets) {
    const file = path.join(AI, p.id + "@v1.png");
    if (!fs.existsSync(file)) { console.error("✗ 缺立绘 " + file); continue; }
    const img = await loadImage(file);
    aiPet(g, img, p.cx, p.footY, p.h);
  }

  /* ---------- 建筑铜牌（点的提示，画在最上层） ---------- */
  const B = LAYOUT;
  sign(g, B.stove.x + 62 * B.stove.s, B.stove.baseY - 128 * B.stove.s,
       B.stove.label, "#FFD9A0", B.stove.sub);
  sign(g, B.workbench.x + 66 * B.workbench.s, B.workbench.baseY - 96 * B.workbench.s,
       B.workbench.label, "#D6E6B8", B.workbench.sub);
  sign(g, B.signpost.x - 54 * B.signpost.s, B.signpost.baseY - 162 * B.signpost.s,
       B.signpost.label, "#FFC0B8", B.signpost.sub);
  sign(g, B.noticeBoard.x + 75 * B.noticeBoard.s, B.noticeBoard.baseY - 168 * B.noticeBoard.s,
       B.noticeBoard.label, "#C8D8F0", B.noticeBoard.sub);

  /* ---------- 需求气泡：压在 HUD 之前，保证不被场景挡住 ---------- */
  /* ---------- HUD ---------- */
  drawHUD(g);

  fs.writeFileSync(path.join(OUT, "home-layout@v1.png"), cv.toBuffer("image/png"));
  console.log("✓ home-layout@v1.png  " + W + "×" + H);
}

main().catch(e => { console.error(e); process.exit(1); });
