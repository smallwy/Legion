/* ============================================================================
   home2-shot.js —— 主界面 v2（AI 插画层 + AI 立绘层 + 矢量控件层）
   ----------------------------------------------------------------------------
   为什么推翻 v1（纯矢量家园）：
     v1 违反了自己在 v3.1 定的分工（AI 负责插画层）。纯矢量的天花板就是
     "像贴上去的" —— 这是生产方式的问题，不是参数问题，调不出来。

   三层职责（不可混）：
     L0 背景 = AI 出图，**必须不含任何角色**。建筑、地面、光照全在官方图里。
     L1 角色 = 六张透明底 AI 立绘，按锚点（脚底中心）合成，位置我控、能换、能动。
     L2 控件 = 矢量 UI，吃 AI 的环境光：暖白半透明 / 投影朝右下 / 顶部内侧高光。

   concept3-1 翻车的根因：AI 把六只画进了背景 → 坐标不可控 → 所有贴着角色的
   UI 全部落空。这一版把角色拆成独立层，那条路才成立。

   运行：NODE_PATH=<managed>/node_modules node client/concept/home2-shot.js
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const K = require("./kit2.js");

const { W, H, rr, fs: fillStroke, text, textO, star } = K;

const OUT = path.join(__dirname, "..", "shots");
const AI = path.join(OUT, "ai");
const BG = path.join(OUT, "_ai-bench", "Keep_this_EXACT_children_s_sto_2026-10-21T06-31-25.png");

/* 源图 1536×1024 → 裁 y 48..912（864 高）→ 1280×720。
   裁 48 同时把右下角"AI生成"水印排除（水印在源 y>915）。 */
const SRC = { x: 0, y: 48, w: 1536, h: 864 };

/* ============================================================================
   0. 布局规格 —— 这组数字就是交付给引擎的规格
   ----------------------------------------------------------------------------
   所有坐标都是 AI 背景实测栅格读数（shots/_grid-ref.png），不是目测。
   三段带：上带 HUD 12–58 / 中带场景 58–618 / 下带 Dock 618–710。
   ========================================================================== */

const LAYOUT = {
  hud:  { y: 12,  h: 46 },
  dock: { y: 618, h: 92 },
  safe: 20,

  /* 场景入口：24px 圆形徽标，**贴在物件边缘**，不写字。
     图标自己说话（锅/锤/爪/旗/信），比悬空的木板轻，也不会和建筑打架。

     坐标全部来自 _probe2.js 的颜色分割实测，不是目测：
       大黑锅  重心 (650,360)  暗色连通块 [626,316]-[673,409]
       木门    中心 (475,400)  列峰 x=475 / 行峰 y=449
       工作台  中心 (222,360)  盒 [140,260]-[399,429]
       路牌    中心 (223,224)  盒 [164,183]-[319,329]
     教训：读栅格图换算会偏 40–70px，颜色分割才是客观读数。 */
  badges: [
    { x: 300,  y: 334, kind: "hammer", label: "工作台" },
    { x: 545,  y: 388, kind: "paw",    label: "宠物屋" },
    { x: 702,  y: 342, kind: "pot",    label: "灶台" },
    { x: 1100, y: 480, kind: "mail",   label: "派遣" },
    { x: 284,  y: 202, kind: "flag",   label: "出门" },
  ],

  /* 六只：位置即性格 / 距离即亲密度 / 站在它在乎的东西旁边。
     footY ≤ 600 是硬约束（Dock 618 起，留 18px 净距）。
     尺寸按"角色是主体"定：最靠前的年糕占屏高 20.3%，不是摆件。 */
  pets: [
    { id: "nian-gao-dog",  key: "dog",   cx: 250,  footY: 600, h: 146, why: "路牌旁等出门" },
    { id: "xue-tuan-rab",  key: "rab",   cx: 450,  footY: 596, h: 126, why: "屋门口，不敢走远" },
    { id: "sugar-stand",   key: "sugar", cx: 490,  footY: 156, h: 82,  why: "屋脊，猫必须在最高处" },
    { id: "tuan-zi-ham",   key: "ham",   cx: 716,  footY: 598, h: 136, why: "守着大黑锅" },
    { id: "dou-nai-ox",    key: "ox",    cx: 862,  footY: 592, h: 136, why: "趴在粉垫子上" },
    { id: "xing-xie-fox",  key: "fox",   cx: 1148, footY: 596, h: 112, why: "栅栏最右，最远；刚到家" },
  ],
};

/* ============================================================================
   1. 控件底座
   ----------------------------------------------------------------------------
   主光在左上 → 所有投影朝右下。方向不一致是最刺眼的破绽，眼睛会立刻
   发现"这个东西不在场景里"。
   ========================================================================== */

function uiShadow(g, x, y, w, h, r, dy) {
  g.save();
  g.fillStyle = "rgba(74,44,24,.22)";
  rr(g, x + 2, y + (dy === undefined ? 5 : dy), w, h, r === undefined ? 0 : r);
  g.fill();
  g.restore();
}

/** 玻璃控件：暖白渐变 + 右下投影 + 双层描边 + 顶部内侧高光 + 底部内阴影
    四层叠加是"商业级"和"一张白纸片"的全部差别：
      ① 垂直渐变（顶亮底暗）—— 有厚度
      ② 双层描边（外深 + 内浅）—— 有倒角
      ③ 顶部内侧高光 2px —— 被光打到
      ④ 底部内侧暗线 —— 有重力
    只做①②就已经不像贴纸了，四层齐全才读得出"实体"。 */
function glass(g, x, y, w, h, r, opt) {
  const o = opt || {};
  const rad = r === undefined ? 0 : r;
  const base = o.fill || "rgba(255,251,240,.93)";
  uiShadow(g, x, y, w, h, rad, o.dy);

  // ① 垂直渐变
  const grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, o.fillTop || "rgba(255,254,248,.97)");
  grd.addColorStop(0.55, base);
  grd.addColorStop(1, o.fillBot || "rgba(250,238,218,.95)");
  rr(g, x, y, w, h, rad);
  fillStroke(g, grd, o.stroke || "rgba(122,80,52,.74)", o.lw === undefined ? 2.8 : o.lw);

  g.save();
  rr(g, x, y, w, h, rad);
  g.clip();
  // ③ 顶部高光
  g.fillStyle = "rgba(255,255,255,.62)";
  g.fillRect(x, y, w, 2.4);
  // ② 内浅描边
  rr(g, x + 2.2, y + 2.2, w - 4.4, h - 4.4, Math.max(0, rad - 2.2));
  g.strokeStyle = "rgba(255,255,255,.40)";
  g.lineWidth = 1.3;
  g.stroke();
  // ④ 底部内阴影
  const igr = g.createLinearGradient(0, y + h - 8, 0, y + h);
  igr.addColorStop(0, "rgba(140,92,52,0)");
  igr.addColorStop(1, "rgba(140,92,52,.14)");
  g.fillStyle = igr;
  g.fillRect(x, y + h - 8, w, 8);
  g.restore();
}

function heartPath(g, hx, hy, s) {
  g.beginPath();
  g.moveTo(hx, hy + s * 0.72);
  g.bezierCurveTo(hx - s * 1.30, hy - s * 0.30, hx - s * 0.52, hy - s * 1.24, hx, hy - s * 0.44);
  g.bezierCurveTo(hx + s * 0.52, hy - s * 1.24, hx + s * 1.30, hy - s * 0.30, hx, hy + s * 0.72);
  g.closePath();
}

/* ============================================================================
   2. AI 立绘合成
   ========================================================================== */

function aiPet(g, img, cx, footY, h, alpha) {
  const s = h / img.height;
  const w = img.width * s;
  g.save();
  if (alpha !== undefined) g.globalAlpha = alpha;
  g.fillStyle = "rgba(74,44,24,.18)";
  g.beginPath();
  g.ellipse(cx, footY, Math.max(10, w * 0.34), Math.max(4, h * 0.052), 0, 0, 6.2832);
  g.fill();
  g.drawImage(img, cx - w / 2, footY - h, w, h);
  g.restore();
  return { w, h, left: cx - w / 2, right: cx + w / 2, top: footY - h, cx, footY };
}

/** 头像裁切图（256×256 透明底，头部居中）—— 引擎 HUD 头像槽直接用 */
function petHead(g, img, cx, cy, r) {
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.clip();
  g.fillStyle = "#FFF6E4";
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  const d = r * 2.16;
  g.drawImage(img, cx - d / 2, cy - d / 2, d, d);
  g.restore();
}

/* ============================================================================
   3. 场景入口徽标（24px 圆 + 线描图标）
   ========================================================================== */

function badge(g, x, y, kind, hot) {
  const R = 13;
  uiShadow(g, x - R, y - R, R * 2, R * 2, R, 3);
  g.beginPath(); g.arc(x, y, R, 0, 6.2832);
  fillStroke(g, hot ? "#FFE7C0" : "rgba(255,252,244,.94)", "rgba(110,70,44,.82)", 2.4);
  g.save();
  g.beginPath(); g.arc(x, y, R - 1.2, 0, 6.2832); g.clip();
  g.fillStyle = "rgba(255,255,255,.55)";
  g.fillRect(x - R, y - R, R * 2, 3);
  g.restore();

  const ink = "#8A5232";
  g.save();
  g.strokeStyle = ink; g.fillStyle = ink;
  g.lineWidth = 1.9; g.lineCap = "round"; g.lineJoin = "round";

  if (kind === "pot") {
    // 锅 + 提手
    g.beginPath();
    g.moveTo(x - 6.4, y - 1.6);
    g.quadraticCurveTo(x, y + 7.2, x + 6.4, y - 1.6);
    g.closePath();
    g.fill();
    g.beginPath(); g.moveTo(x - 7.6, y - 2.6); g.lineTo(x + 7.6, y - 2.6); g.stroke();
    g.beginPath(); g.arc(x, y - 5.2, 3.4, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
  } else if (kind === "hammer") {
    g.beginPath(); g.moveTo(x - 5.6, y + 6.4); g.lineTo(x + 3.6, y - 3.2); g.stroke();
    g.save();
    g.translate(x + 4.6, y - 4.4); g.rotate(0.72);
    rr(g, -5.6, -2.6, 11.2, 5.2, 1.6);
    g.fill();
    g.restore();
    g.beginPath(); g.moveTo(x - 8.4, y + 7.6); g.lineTo(x - 6.4, y + 9.2); g.stroke();
  } else if (kind === "paw") {
    g.beginPath(); g.ellipse(x, y + 3.4, 5.0, 4.2, 0, 0, 6.2832); g.fill();
    for (const a of [-0.72, -0.24, 0.24, 0.72]) {
      g.beginPath();
      g.ellipse(x + Math.sin(a) * 5.6, y - 3.4 - Math.cos(a) * 2.6, 1.9, 2.4, a * 0.4, 0, 6.2832);
      g.fill();
    }
  } else if (kind === "flag") {
    g.beginPath(); g.moveTo(x - 5.4, y + 7.6); g.lineTo(x - 5.4, y - 7.2); g.stroke();
    g.beginPath();
    g.moveTo(x - 5.4, y - 7.0);
    g.quadraticCurveTo(x + 3.2, y - 5.0, x + 6.6, y - 1.8);
    g.quadraticCurveTo(x + 3.0, y + 1.6, x - 5.4, y + 0.4);
    g.closePath();
    g.fill();
  } else {
    // mail：信封
    rr(g, x - 7.2, y - 5.0, 14.4, 10.4, 1.8);
    g.stroke();
    g.beginPath(); g.moveTo(x - 7.0, y - 4.4); g.lineTo(x, y + 1.4); g.lineTo(x + 7.0, y - 4.4); g.stroke();
  }
  g.restore();
}

/* ============================================================================
   4. 宠爱反馈：手指 + 飘心 + 反应泡（回答"动作回馈/陪伴感"）
   ----------------------------------------------------------------------------
   静态图要读出"正在发生"，靠三样：未完成的动作 / 衰减的拖影 / 明确的落点。
   手指**直接压在年糕头上**，比压在按钮上更能读成"我在摸它"。
   ========================================================================== */

/** 手指光标：(tx,ty) 是**指尖**位置，手指从指尖向右下延伸，可旋转。
    上一版是竖直画在头顶正中央 —— 和呆毛/耳朵重叠，读成"狗头上插了根棍子"。
    指针必须斜着来（真实鼠标的姿态），并且压在脸颊/身体上，不能压在头顶。 */
function finger(g, tx, ty, sc, rot) {
  const s0 = sc === undefined ? 1 : sc;
  const r0 = rot === undefined ? 0 : rot;
  g.save();
  g.translate(tx, ty);
  g.rotate(r0);
  g.scale(s0, s0);
  // 投影
  g.save();
  g.fillStyle = "rgba(74,44,24,.20)";
  rr(g, -8, 2, 24, 54, 12);
  g.fill();
  g.restore();
  // 食指：从指尖向下
  rr(g, -6.8, -4, 13.6, 36, 6.8);
  fillStroke(g, "#FFF2E6", "rgba(120,78,50,.86)", 2.8);
  // 手掌
  rr(g, -12.5, 26, 25, 27, 11.5);
  fillStroke(g, "#FFE3CE", "rgba(120,78,50,.86)", 2.8);
  // 指甲
  g.beginPath(); g.ellipse(0, 2.5, 4.2, 5.2, 0, 0, 6.2832);
  fillStroke(g, "#FFDAC9", "rgba(160,110,90,.55)", 1.2);
  // 掌心高光
  g.fillStyle = "rgba(255,255,255,.62)";
  g.beginPath(); g.ellipse(-5, 36, 3.4, 5.4, -0.3, 0, 6.2832); g.fill();
  g.restore();
}

function floatHeart(g, x, y, sz, alpha, rot) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.globalAlpha = alpha;
  heartPath(g, 0, 0, sz);
  g.fillStyle = "#FF9EB6";
  g.fill();
  g.strokeStyle = "rgba(150,70,90,.72)";
  g.lineWidth = 1.8;
  g.stroke();
  g.restore();
}

/** 反应泡：宠物被摸时头顶弹一个"!"，是"我收到了"的即时证据 */
function reactBubble(g, x, y, r) {
  uiShadow(g, x - r, y - r, r * 2, r * 2, r, 3);
  g.beginPath(); g.arc(x, y, r, 0, 6.2832);
  fillStroke(g, "#FFFCF4", "rgba(120,78,50,.76)", 2.6);
  g.beginPath();
  g.moveTo(x - 3.6, y + r - 2);
  g.lineTo(x + 1.2, y + r + 8);
  g.lineTo(x + 4.6, y + r - 1);
  g.closePath();
  fillStroke(g, "#FFFCF4", "rgba(120,78,50,.76)", 2.2);
  text(g, "!", x, y + 1, r * 1.30, "#E8563C", true, "center");
}

/** 「新伙伴」光环：地面光斑 + 四芒星粒子。这是"获得感"的视觉语法 */
function newGlow(g, cx, footY, r) {
  g.save();
  const grd = g.createRadialGradient(cx, footY - 4, 2, cx, footY - 4, r);
  grd.addColorStop(0, "rgba(255,232,150,.58)");
  grd.addColorStop(1, "rgba(255,232,150,0)");
  g.fillStyle = grd;
  g.beginPath(); g.ellipse(cx, footY - 4, r, r * 0.30, 0, 0, 6.2832); g.fill();
  for (const p of [[-0.84, -0.56, 5.2], [0.76, -0.70, 4.0], [-0.54, -1.14, 3.2], [0.50, -1.26, 4.6], [0.02, -1.44, 2.8]]) {
    star(g, cx + p[0] * r * 1.5, footY + p[1] * r * 1.9, p[2], "#FFF2B8", "rgba(200,150,50,.48)");
  }
  g.restore();
}

/* ============================================================================
   5. 场景补建：派遣黑板（AI 图里没有，矢量补，和"出门"成对）
   ========================================================================== */

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

/* ============================================================================
   5b. 氛围层 —— 让空草地"有生物住过"
   ----------------------------------------------------------------------------
   上一版被批"太单调"，一半原因不是控件少，是**场景里没有生活痕迹**：
   草地是一片干净的绿，没有任何东西说明这里住着六只动物。
   三层痕迹：光斑（空气有光）/ 花瓣（空气在动）/ 爪印（这里走过路）。
   全部压在角色之前，不抢主体。
   ========================================================================== */

function ambient(g) {
  // 草地光斑
  for (const s of [[700, 476, 130, .22], [986, 528, 108, .17], [372, 546, 96, .19], [1186, 470, 84, .14]]) {
    const gr = g.createRadialGradient(s[0], s[1], 2, s[0], s[1], s[2]);
    gr.addColorStop(0, `rgba(255,242,196,${s[3]})`);
    gr.addColorStop(1, "rgba(255,242,196,0)");
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(s[0], s[1], s[2], s[2] * 0.52, 0, 0, 6.2832); g.fill();
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

  // 爪印串：从屋门走向路牌。这是"陪伴感"最便宜的静态证据
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

/* ============================================================================
   6. 主合成
   ========================================================================== */

async function main() {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  /* ---------- L0：AI 背景 ---------- */
  const bg = await loadImage(BG);
  g.drawImage(bg, SRC.x, SRC.y, SRC.w, SRC.h, 0, 0, W, H);

  /* ---------- 氛围雾（必须在角色之前画） ----------
     顶部雾 0–70：把天空压薄，让 HUD 可读。上一版到 92 会盖住屋脊上的砂糖头顶。
     底部雾 568–720：给 Dock 找落脚处。
     顺序是踩过的坑：雾写在角色之后 = 直接把宠物下半身刷白，读成"腿被雾吃了"。 */
  {
    const top = g.createLinearGradient(0, 0, 0, 70);
    top.addColorStop(0, "rgba(255,246,232,.46)");
    top.addColorStop(1, "rgba(255,246,232,0)");
    g.fillStyle = top;
    g.fillRect(0, 0, W, 70);

    const bot = g.createLinearGradient(0, H - 152, 0, H);
    bot.addColorStop(0, "rgba(255,247,232,0)");
    bot.addColorStop(0.50, "rgba(255,246,228,.50)");
    bot.addColorStop(1, "rgba(255,244,222,.84)");
    g.fillStyle = bot;
    g.fillRect(0, H - 152, W, 152);
  }

  /* ---------- 场景补建 + 氛围层 ---------- */
  noticeBoard(g, 1046, 596);
  signFlag(g, 215, 200);
  ambient(g);

  /* ---------- L1：六只立绘 ---------- */
  const box = {};
  for (const p of LAYOUT.pets) {
    const img = await loadImage(path.join(AI, p.id + "@v1.png"));
    if (p.key === "fox") newGlow(g, p.cx, p.footY, 62);
    box[p.key] = aiPet(g, img, p.cx, p.footY, p.h);
  }

  /* ---------- 宠爱反馈演示：手指压在年糕头上 ----------
     选年糕是因为它的位置最靠前、最靠近屏左，玩家第一眼就会去点它。 */
  {
    const d = box.dog;
    // 被摸的那一圈柔光
    const grd = g.createRadialGradient(d.cx, d.footY - d.h * 0.45, 6, d.cx, d.footY - d.h * 0.45, d.h * 0.72);
    grd.addColorStop(0, "rgba(255,226,170,.34)");
    grd.addColorStop(1, "rgba(255,226,170,0)");
    g.fillStyle = grd;
    g.beginPath(); g.arc(d.cx, d.footY - d.h * 0.45, d.h * 0.72, 0, 6.2832); g.fill();

    reactBubble(g, d.cx + 80, d.top + 30, 16);

    /* 飘心：走年糕**右侧**的空地（x 300–360, y 450–510）往上飘。
       不能从头顶直上 —— 年糕头顶 454 恰好贴着工作台底 429，往上飘会撞进木头里，
       读成"台面上贴了个心"。三颗改成两颗，距离拉近才读得出"同一簇"。 */
    floatHeart(g, d.cx + 56, d.top + 52, 9.6, 0.95, -0.26);
    floatHeart(g, d.cx + 84, d.top + 26, 7.0, 0.62, 0.20);
    floatHeart(g, d.cx + 104, d.top + 2, 4.6, 0.36, -0.10);

    /* 这里**不画手指**。
       试过三种：竖直压头顶（读成"头上插了根棍子"）、斜压脸颊（读成"脖子上挂了个白胶囊"）。
       矢量手指放在 AI 立绘旁边，怎么画都像一块异物 —— 因为它没有和插画同一套光照与笔触。
       静态图只负责证明"有反馈"（反应泡 + 飘心 + 柔光），"正在被摸"这个动作交给
       home-demo.html 里的真动画去演。商业截图本来也很少画指针。 */
  }

  /* ---------- 星屑头上的 NEW 角标 ---------- */
  {
    const f = box.fox;
    const bx = f.cx + 26, by = f.top + 4;
    rr(g, bx - 20, by - 11, 40, 21, 10.5);
    fillStroke(g, "#FFC84A", "rgba(150,96,20,.88)", 2.2);
    text(g, "NEW", bx, by - 0.5, 10.5, "#6B3E10", true, "center");
  }

  /* ---------- 场景入口徽标 ---------- */
  for (const b of LAYOUT.badges) badge(g, b.x, b.y, b.kind, false);

  /* ---------- 上带 HUD ---------- */
  {
    const y = LAYOUT.hud.y, h = LAYOUT.hud.h;

    // 左：Logo
    textO(g, "吧唧军团", 24, y + 21, 24, "#FFFFFF", "rgba(120,66,44,.60)", 5.5, true, "left");
    text(g, "M U N C H   L E G I O N", 26, y + 38, 8.5, "rgba(255,255,255,.95)", true, "left");

    // 中：本趟进度（唯一保留在 HUD 的数值 —— 它不属于任何场景地点）
    {
      const px = 470, pw = 300, ph = h;
      glass(g, px, y, pw, ph, ph / 2, { fill: "rgba(255,250,240,.91)", lw: 2.8 });
      text(g, "苔 原", px + 20, y + 20, 12.5, "#5A3826", true, "left");
      text(g, "3 / 8 关", px + 20, y + 35, 10, "rgba(112,72,46,.74)", false, "left");
      for (let i = 0; i < 8; i++) {
        rr(g, px + 96 + i * 22, y + h / 2 - 7, 15, 15, 4);
        fillStroke(g, i < 3 ? "#8FE0B8" : "rgba(112,72,46,.09)",
                   i < 3 ? "rgba(56,124,88,.82)" : "rgba(112,72,46,.24)", 1.6);
      }
      text(g, "连锁 ×1.45", px + pw - 16, y + h / 2 + 1, 11, "#8C4A18", true, "right");
    }

    // 右上：设置
    {
      const gx = W - 40, gy = y + h / 2;
      uiShadow(g, gx - 18, gy - 18, 36, 36, 18, 4);
      g.beginPath(); g.arc(gx, gy, 18, 0, 6.2832);
      fillStroke(g, "rgba(255,250,240,.92)", "rgba(122,80,52,.76)", 2.8);
      g.beginPath(); g.arc(gx, gy, 6.2, 0, 6.2832);
      fillStroke(g, "#8A6358", null, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 6.2832;
        g.fillStyle = "#8A6358";
        g.beginPath(); g.arc(gx + Math.cos(a) * 12.2, gy + Math.sin(a) * 12.2, 2.6, 0, 6.2832); g.fill();
      }
    }

    // 下一步引导：新玩家第一眼要知道该干什么
    {
      const bx = 820, by = y + 4, bw = 236, bh = 30;
      glass(g, bx, by, bw, bh, 15, { fill: "rgba(255,246,226,.94)", lw: 2.4, dy: 4 });
      // 小爪印
      g.save();
      g.fillStyle = "#E8563C";
      g.beginPath(); g.ellipse(bx + 20, by + 19, 4.6, 3.8, 0, 0, 6.2832); g.fill();
      for (const a of [-0.7, -0.22, 0.22, 0.7]) {
        g.beginPath();
        g.ellipse(bx + 20 + Math.sin(a) * 5.0, by + 12 - Math.cos(a) * 2.2, 1.7, 2.2, a * 0.4, 0, 6.2832);
        g.fill();
      }
      g.restore();
      text(g, "年糕想出门了", bx + 36, by + 19, 11.5, "#7A3A18", true, "left");
      g.strokeStyle = "rgba(122,80,52,.7)"; g.lineWidth = 2; g.lineCap = "round";
      g.beginPath();
      g.moveTo(bx + bw - 40, by + bh / 2);
      g.lineTo(bx + bw - 26, by + bh / 2);
      g.moveTo(bx + bw - 31, by + bh / 2 - 5);
      g.lineTo(bx + bw - 26, by + bh / 2);
      g.lineTo(bx + bw - 31, by + bh / 2 + 5);
      g.stroke();
    }
  }

  /* ---------- 下带 Dock ---------- */
  {
    const y = LAYOUT.dock.y, h = LAYOUT.dock.h, ey = y + 15, eh = 62;

    /* --- 左：三资源 --- */
    const res = [["果子", "248", 0], ["材料", "36", 1], ["吧唧", "12", 2]];
    res.forEach((r, i) => {
      const bx = LAYOUT.safe + i * 88, bw = 82;
      glass(g, bx, ey, bw, eh, 19, { fill: "rgba(255,252,244,.95)", lw: 2.6, dy: 4 });
      const ix = bx + 24, iy = ey + 21;
      if (r[2] === 0) {
        g.beginPath(); g.arc(ix, iy, 9.5, 0, 6.2832);
        fillStroke(g, "#FF8A72", "rgba(140,62,44,.74)", 2);
        g.strokeStyle = "#6B8E4E"; g.lineWidth = 2.2; g.lineCap = "round";
        g.beginPath(); g.moveTo(ix, iy - 9.5); g.quadraticCurveTo(ix + 2, iy - 15, ix + 6, iy - 16); g.stroke();
        g.beginPath(); g.ellipse(ix + 6.5, iy - 12.5, 4, 2.3, -0.5, 0, 6.2832);
        fillStroke(g, "#8FD46C", null, 0);
      } else if (r[2] === 1) {
        rr(g, ix - 10, iy - 6, 20, 14, 4);
        fillStroke(g, "#C08A52", "rgba(110,70,40,.74)", 2);
        g.fillStyle = "rgba(255,255,255,.46)"; g.fillRect(ix - 7, iy - 4, 14, 2.4);
      } else {
        g.beginPath(); g.arc(ix, iy, 9.5, 0, 6.2832);
        fillStroke(g, "#FFC84A", "rgba(150,96,20,.80)", 2.2);
        g.beginPath(); g.arc(ix, iy, 4.2, 0, 6.2832);
        fillStroke(g, "rgba(255,255,255,.74)", "rgba(150,96,20,.46)", 1.4);
      }
      text(g, r[1], bx + bw - 10, ey + 26, 17, "#5A3826", true, "right");
      text(g, r[0], bx + bw - 10, ey + 44, 9.5, "rgba(112,72,46,.66)", false, "right");
    });

    /* --- 出战卡：当前带出门的那一只 ---
       规格 200×62，三行信息（名字+星 / 五心 / 饱食三段）。
       上一版 168 宽塞了 7 个元素，糊成一团 —— 卡片宽度是硬约束，不能加内容。 */
    {
      const bx = 290, bw = 200;
      glass(g, bx, ey, bw, eh, 19, { fill: "rgba(255,246,226,.96)", lw: 2.8, dy: 4 });
      const dogHead = await loadImage(path.join(AI, "head", "nian-gao-dog-head@v1.png"));
      petHead(g, dogHead, bx + 32, ey + 31, 22);
      g.beginPath(); g.arc(bx + 32, ey + 31, 22, 0, 6.2832);
      fillStroke(g, null, "rgba(122,80,52,.60)", 2);

      text(g, "年 糕", bx + 60, ey + 19, 13.5, "#5A3826", true, "left");
      star(g, bx + 108, ey + 14, 5.0, "#FFC84A", "rgba(150,100,20,.62)");

      for (let i = 0; i < 5; i++) {
        heartPath(g, bx + 66 + i * 13, ey + 33, 4.8);
        fillStroke(g, i < 3 ? "#FF9EB6" : "rgba(122,80,52,.10)",
                   i < 3 ? "rgba(150,70,90,.58)" : "rgba(122,80,52,.22)", 1.5);
      }
      for (let i = 0; i < 3; i++) {
        rr(g, bx + 60 + i * 23, ey + 44, 20, 9, 4.5);
        fillStroke(g, "#FFB56A", "rgba(178,110,40,.80)", 1.4);
      }
      text(g, "满饱", bx + 136, ey + 52, 9, "#8C4A18", true, "left");
    }

    /* --- 待命队：5 格。头像裁切图和战斗 HUD 头像槽同源 --- */
    {
      const qx = 506, qw = 40, gap = 6;
      const ids = ["tuan-zi-ham", "xue-tuan-rab", "dou-nai-ox", "sugar-stand", "xing-xie-fox"];
      for (let i = 0; i < 5; i++) {
        const bx = qx + i * (qw + gap), by = ey;
        const isNew = i === 4;
        glass(g, bx, by, qw, eh, 13, {
          fill: isNew ? "rgba(255,244,208,.96)" : "rgba(255,250,240,.90)",
          lw: isNew ? 2.6 : 2.2, dy: 3.5,
          stroke: isNew ? "rgba(200,150,40,.92)" : "rgba(122,80,52,.46)",
        });
        const im = await loadImage(path.join(AI, "head", ids[i] + "-head@v1.png"));
        petHead(g, im, bx + qw / 2, by + 26, 14);
        g.beginPath(); g.arc(bx + qw / 2, by + 26, 14, 0, 6.2832);
        fillStroke(g, null, "rgba(122,80,52,.44)", 1.6);
        text(g, "待", bx + qw / 2, by + eh - 9, 8.5, "rgba(112,72,46,.46)", false, "center");
        if (isNew) {
          rr(g, bx + qw - 16, by + 3, 14, 11, 5.5);
          fillStroke(g, "#FFC84A", "rgba(150,96,20,.88)", 1.6);
          text(g, "新", bx + qw - 9, by + 9, 7.5, "#5A3008", true, "center");
        }
      }
    }

    /* --- 右：出门主按钮 ---
       砍掉了「图鉴 / 背包 / 派遣」三个键：
         · 图鉴和宠物详情归「宠物屋」（场景里有小屋，点它就开）
         · 材料和道具本来就归「工作台」
         · 派遣在场景里有黑板
       Dock 每多一个键，场景入口就被稀释一分 —— 入口不该做两遍。
       主按钮加宽到 500（占屏宽 39%），它是这张界面唯一的行动焦点。 */
    {
      /* 出门主按钮：厚底 + 顶面高光，静态图也能读出"按下去会动" */
      const bx = 760, by = y + 12, bw = 500, bh = 68;
      g.save();
      g.fillStyle = "rgba(74,44,24,.26)";
      rr(g, bx + 2, by + 9, bw, bh, 34); g.fill();
      rr(g, bx, by + 6, bw, bh, 34);
      fillStroke(g, "#E8A33C", "rgba(120,64,20,.90)", 3.2);
      rr(g, bx, by, bw, bh, 34);
      fillStroke(g, "#FFCE6E", "rgba(120,64,20,.90)", 3.2);
      g.save(); rr(g, bx, by, bw, bh, 34); g.clip();
      g.fillStyle = "rgba(255,255,255,.54)"; g.fillRect(bx, by, bw, 3.4); g.restore();

      text(g, "出　门", bx + 72, by + bh / 2 + 1, 27, "#3E2312", true, "center");
      g.strokeStyle = "rgba(120,64,20,.30)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(bx + 152, by + 14); g.lineTo(bx + 152, by + bh - 14); g.stroke();
      text(g, "带年糕 · 苔原 3 / 8", bx + 172, by + 27, 14, "#4A2C18", true, "left");
      text(g, "满饱 3 发 · 再推 1 关可收工", bx + 172, by + 48, 10, "rgba(88,46,20,.82)", false, "left");

      g.beginPath();
      g.moveTo(bx + bw - 40, by + bh / 2 - 9);
      g.lineTo(bx + bw - 25, by + bh / 2);
      g.lineTo(bx + bw - 40, by + bh / 2 + 9);
      g.closePath();
      fillStroke(g, "#FBE0A8", "rgba(120,64,20,.70)", 2.2);
      g.restore();
    }
  }

  fs.writeFileSync(path.join(OUT, "home-layout@v2.png"), cv.toBuffer("image/png"));
  console.log("✓ client/shots/home-layout@v2.png");
}

main().catch((e) => { console.error(e); process.exit(1); });
