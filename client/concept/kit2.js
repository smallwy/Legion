/* ============================================================================
   kit2.js —— v2 设计语言「棉花糖」+ 超大头身立绘
   ----------------------------------------------------------------------------
   为什么废弃 v1「糖果纸」：

   v1 的三张图被判定"不够可爱 / 太简易"，根因不在细节，在三个系统性错误：

     1. **配色错**。v1 主界面用黄昏紫（#3A3560 → #6E5A94 → #B87F9A）。
        低明度 + 冷紫 = 「情绪」「抒情」，是独立游戏海报的语言。
        可爱风的第一条是**高明度**（L > 80%），第二条是**暖**。所以 v2 用白天的
        粉蓝天空 + 奶油黄草地。

     2. **比例错**。v1 头径只占身高 0.44，头身比约 1:1.1 —— 那是"Q 版小人"。
        真 Q 版动物头要占**一半以上**（hd 0.54~0.60），眼睛要占脸宽的**三分之一**。
        v1 的眼睛只占 1/6，所以六只都像"有五官的团子"，不像"角色"。

     3. **描边错**。v1 统一用近黑的冷紫 #3A2B44 描边。冷色近黑描边压在任何粉彩上
        都会让画面"变硬"，这是绘本感而不是可爱感。v2 每只**用自己主色的深暖调**
        （猫 #8A4E2E、兔 #B06A8C、狐 #A04E2E），描边融进角色里。

   六只"同质化"的根因也是三条：
     1. 体型差异太小（bw 0.46~0.72 挤在一起）→ v2 拉到 0.50~0.90
     2. 没有**材质**差异（全是平涂）→ v2 给毛尖 / 斑块 / 颊袋 / 巨尾 / 卷尾
     3. 没有**想得到的那一只**（六只平均，等于六只都不想要）
        → v2 明确做出稀有度梯度，狐「星屑」是传说位（巨尾 + 白尾尖 + 星尘）
   ========================================================================== */

const { GlobalFonts } = require("@napi-rs/canvas");

try {
  GlobalFonts.registerFromPath("C:/Windows/Fonts/msyh.ttc", "YaHei");
  GlobalFonts.registerFromPath("C:/Windows/Fonts/msyhbd.ttc", "YaHeiB");
} catch (e) {
  console.warn("字体注册失败：", e.message);
}

const W = 1280, H = 720;
const F = (size, bold) => `${size}px ${bold ? "YaHeiB" : "YaHei"}, "Microsoft YaHei", sans-serif`;

/* ---------------------------------------------------------------- 设计 token */
const T = {
  // 描边：暖棕。冷紫近黑会把所有粉彩色压硬
  ink:      "#6B4A42",
  ink2:     "#8A6358",
  ink3:     "rgba(107,74,66,.28)",

  cream:    "#FFFBF0",
  cream2:   "#FFF1D6",
  cream3:   "#F3DCB4",

  pink:     "#FFB7CC",
  pinkDk:   "#EF839F",
  pinkLt:   "#FFE3EC",

  sky:      "#79CFF2",
  sky2:     "#AFE6FA",
  sky3:     "#DBF5FE",
  sky4:     "#F1FDFF",

  grass:    "#88D46C",
  grass2:   "#6EC257",
  grass3:   "#569F47",
  grass4:   "#3E7C38",

  lemon:    "#FFE071",
  lemonDk:  "#DFB036",
  tanger:   "#FFA95E",
  tangerDk: "#DE7A34",
  berry:    "#C89BE9",
  berryDk:  "#9770C3",
  mint:     "#8FE3BE",
  mintDk:   "#55B791",
  coral:    "#FF8A72",
  coralDk:  "#D75F4A",
  water:    "#8FD8F0",
  white:    "#FFFFFF",
};

/* ---------------------------------------------------------------- 色彩工具 */

/** 两个 hex 之间插值 */
function mixHex(a, b, t) {
  const p = (h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) =>
    Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
const ln = (h, t) => mixHex(h, "#FFFFFF", t);
const dn = (h, t) => mixHex(h, "#4A2C18", t);   // 暗部往暖深棕走，不是往黑走

/**
 * 边缘带明暗：给任意闭合路径做"右下背光、左上受光"的体积。
 *
 * 走过的弯路（都留在这，别再踩）：
 *   · 纯平涂 → 读成贴纸，没有体积（v2 第一版）
 *   · 用"偏移的大椭圆"当暗部 → 分界弧线切在脸中间，读成"戴了个面具"/"脸上一道脏痕"
 *   · 加大对比 → 更脏，更明显
 *
 * 正解是**环形带**：裁出"外轮廓 − 内缩同形"之间的那一圈，再用一个方向圆裁掉
 * 其余三面，只留右下（或左上）一条贴边的带子。厚度 = (1 - inset) × 半径，
 * 这样暗部永远只在轮廓内侧、跟着形状走，不会进到脸中心。
 *
 * 三条纪律：
 *   1. **必须硬边**。卡通的三阶是色块，不是渐变（渐变=写实信号）。
 *   2. **暗带厚度 ≤ 0.24 半径**。再厚就吃掉脸的面积。
 *   3. **方向固定"右下暗 / 左上亮"**。全场统一一种光，六只才像一套资产。
 */
function edgeBand(g, pathFn, cx, cy, rx, ry, color, inset, dirX, dirY) {
  g.save();
  g.beginPath();
  pathFn();
  // 内缩的同形（用椭圆近似）：外 − 内 = 一圈环
  g.ellipse(cx, cy, Math.max(1, rx * inset), Math.max(1, ry * inset), 0, 0, 6.2832);
  g.clip("evenodd");
  // 再裁掉环的其余三面，只留 dir 方向那一块
  g.beginPath();
  g.arc(cx + dirX * rx * 1.02, cy + dirY * ry * 1.02,
        Math.max(rx, ry) * 1.95, 0, 6.2832);
  g.clip();
  g.fillStyle = color;
  g.fillRect(cx - rx * 2.4, cy - ry * 2.4, rx * 4.8, ry * 4.8);
  g.restore();
}

/** 体积：右下暗带 + 左上亮带。face 参数 0 表示"这块不要亮带"（脸） */
function form(g, pathFn, cx, cy, rx, ry, base, opt) {
  const o = opt || {};
  const dkT = o.dk === undefined ? 0.26 : o.dk;
  const ltT = o.lt === undefined ? 0.30 : o.lt;
  const inset = o.inset === undefined ? 0.86 : o.inset;
  if (dkT > 0) edgeBand(g, pathFn, cx, cy, rx, ry, dn(base, dkT), inset, 1, 1);
  if (ltT > 0) edgeBand(g, pathFn, cx, cy, rx, ry, ln(base, ltT),
                        o.insetLt === undefined ? 0.945 : o.insetLt, -1, -1);
}

/** 沿左上轮廓的一圈亮边（rim light）。inset 越大，亮边越细 */
function rim(g, pathFn, cx, cy, rx, ry, color, w) {
  const inset = 1 - Math.min(0.30, (w || 5) / Math.max(rx, 1) * 1.9);
  edgeBand(g, pathFn, cx, cy, rx, ry,
           color || "rgba(255,255,255,.42)", inset, -1, -1);
}

/* ---------------------------------------------------------------- 基础图元 */

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

/** 填充 + 描边一次做完，减少漏设 stroke 的失误 */
function fs(g, fill, stroke, lw) {
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.stroke();
  }
}

/** 硬投影：实色错位，永远不用 shadowBlur（模糊阴影 = 写实信号） */
function shadow(g, x, y, w, h, r, dy, alpha) {
  g.fillStyle = `rgba(107,74,66,${alpha === undefined ? 0.16 : alpha})`;
  rr(g, x, y + (dy === undefined ? 6 : dy), w, h, r);
  g.fill();
}

function card(g, x, y, w, h, r, opt) {
  const o = opt || {};
  if (o.shadow !== false) shadow(g, x, y, w, h, r, o.dy, o.sa);
  g.fillStyle = o.fill || T.cream;
  rr(g, x, y, w, h, r);
  g.fill();
  if (o.line !== false) {
    g.strokeStyle = o.lineColor || T.ink;
    g.lineWidth = o.lw || 4;
    rr(g, x, y, w, h, r);
    g.stroke();
  }
}

/** 厚底按钮：底部实色厚度 + 顶部高光。这是蛋仔派对那一套的核心 */
function btn(g, x, y, w, h, label, opt) {
  const o = opt || {};
  const face = o.face || T.lemon;
  const dark = o.dark || T.lemonDk;
  const depth = o.depth === undefined ? 9 : o.depth;
  const r = o.r === undefined ? h * 0.42 : o.r;

  // 厚度
  g.fillStyle = dark;
  rr(g, x, y + depth, w, h, r);
  g.fill();
  g.strokeStyle = T.ink;
  g.lineWidth = 4;
  rr(g, x, y + depth, w, h, r);
  g.stroke();

  // 面
  g.fillStyle = face;
  rr(g, x, y, w, h, r);
  g.fill();
  g.strokeStyle = T.ink;
  g.lineWidth = 4;
  rr(g, x, y, w, h, r);
  g.stroke();

  // 顶部高光（不是渐变，是一块实色月牙）
  g.save();
  g.beginPath();
  rr(g, x, y, w, h, r);
  g.clip();
  g.fillStyle = "rgba(255,255,255,.42)";
  rr(g, x + w * 0.10, y + h * 0.13, w * 0.80, h * 0.26, h * 0.13);
  g.fill();
  g.restore();

  const ty = y + h * 0.5 + (o.sub ? -7 : 0);
  text(g, label, x + w / 2, ty, o.size || 19, o.text || T.ink, true);
  if (o.sub) text(g, o.sub, x + w / 2, y + h * 0.74, o.subSize || 10.5, o.subColor || "rgba(107,74,66,.62)", false);
}

function text(g, s, x, y, size, color, bold, align) {
  g.font = F(size, bold);
  g.fillStyle = color || T.ink;
  g.textAlign = align || "center";
  g.textBaseline = "middle";
  g.fillText(s, x, y);
}

function textO(g, s, x, y, size, color, oc, lw, bold, align) {
  g.font = F(size, bold);
  g.textAlign = align || "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.miterLimit = 2;
  g.strokeStyle = oc || T.ink;
  g.lineWidth = lw || 7;
  g.strokeText(s, x, y);
  g.fillStyle = color || T.white;
  g.fillText(s, x, y);
}

function blob(g, cx, cy, rx, ry, fill, lw, rot, stroke) {
  g.beginPath();
  g.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot || 0, 0, 6.2832);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (lw) { g.strokeStyle = stroke || T.ink; g.lineWidth = lw; g.stroke(); }
}

/** 四角星 */
function star(g, cx, cy, r, inner, fill, line, lw, points) {
  const n = points || 4;
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * 6.2832 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : inner;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (line) { g.strokeStyle = line; g.lineWidth = lw; g.lineJoin = "round"; g.stroke(); }
}

/** 蛋形身体：**下宽上窄**。正椭圆会读成"球"，蛋形才读成"小动物" */
function eggBody(g, cx, cy, w, h) {
  const hw = w / 2, hh = h / 2;
  g.beginPath();
  g.moveTo(cx, cy - hh);
  g.bezierCurveTo(cx + hw * 0.66, cy - hh * 0.96, cx + hw, cy - hh * 0.22, cx + hw, cy + hh * 0.34);
  g.bezierCurveTo(cx + hw, cy + hh * 0.88, cx + hw * 0.60, cy + hh, cx, cy + hh);
  g.bezierCurveTo(cx - hw * 0.60, cy + hh, cx - hw, cy + hh * 0.88, cx - hw, cy + hh * 0.34);
  g.bezierCurveTo(cx - hw, cy - hh * 0.22, cx - hw * 0.66, cy - hh * 0.96, cx, cy - hh);
  g.closePath();
}

/** 圆角三角耳：三条边全用二次曲线，避免出现尖角（尖 = 硬 = 不可爱） */
function triEar(g, x, y, w, hgt, tilt, fill, inner, lw, ink) {
  g.save();
  g.translate(x, y);
  g.rotate(tilt || 0);
  g.beginPath();
  g.moveTo(-w / 2, 0);
  g.quadraticCurveTo(-w * 0.46, -hgt * 0.70, 0, -hgt);
  g.quadraticCurveTo(w * 0.46, -hgt * 0.70, w / 2, 0);
  g.quadraticCurveTo(0, hgt * 0.16, -w / 2, 0);
  g.closePath();
  fs(g, fill, ink || T.ink, lw);
  if (inner) {
    g.beginPath();
    g.moveTo(-w * 0.24, -hgt * 0.08);
    g.quadraticCurveTo(-w * 0.20, -hgt * 0.60, 0, -hgt * 0.74);
    g.quadraticCurveTo(w * 0.20, -hgt * 0.60, w * 0.24, -hgt * 0.08);
    g.closePath();
    g.fillStyle = inner;
    g.fill();
  }
  g.restore();
}

/**
 * 头形。六只**不能共用一个圆** —— 这是"同质化"最容易被忽略的一条：
 * 观众记脸不记配件，脸型一样就等于长得一样。
 * chin 越大下巴越收（狐是倒三角），hrx 越大脸越宽（仓鼠最宽）。
 */
function headPath(g, cx, cy, rx, ry, chin) {
  const cw = rx * (0.60 - chin * 0.34);   // 下巴宽度
  g.beginPath();
  g.moveTo(cx, cy - ry);
  g.bezierCurveTo(cx + rx * 0.56, cy - ry, cx + rx, cy - ry * 0.28, cx + rx, cy + ry * 0.24);
  g.bezierCurveTo(cx + rx, cy + ry * 0.74, cx + cw, cy + ry, cx, cy + ry);
  g.bezierCurveTo(cx - cw, cy + ry, cx - rx, cy + ry * 0.74, cx - rx, cy + ry * 0.24);
  g.bezierCurveTo(cx - rx, cy - ry * 0.28, cx - rx * 0.56, cy - ry, cx, cy - ry);
  g.closePath();
}

/** 月牙牛角：实心，外缘往内收 */
function horn(g, x, y, headR, dir, lw, ink) {
  // 短而粗的月牙。细长曲线不论怎么调都读成"天线"
  g.beginPath();
  g.moveTo(x - dir * headR * 0.18, y + headR * 0.16);
  g.quadraticCurveTo(x + dir * headR * 0.18, y + headR * 0.04, x + dir * headR * 0.32, y - headR * 0.26);
  g.quadraticCurveTo(x + dir * headR * 0.34, y + headR * 0.18, x + dir * headR * 0.04, y + headR * 0.32);
  g.closePath();
  fs(g, "#FFF6E2", ink || T.ink, lw);
  // 角根一圈深色，把它"插进头里"
  g.strokeStyle = "rgba(107,74,66,.30)";
  g.lineWidth = lw * 0.8;
  g.beginPath();
  g.moveTo(x - dir * headR * 0.14, y + headR * 0.22);
  g.quadraticCurveTo(x, y + headR * 0.30, x + dir * headR * 0.08, y + headR * 0.36);
  g.stroke();
}

/* ---------------------------------------------------------------- 六只 */

const PALS = {
  cat: {
    name: "砂糖", sp: "尖耳猫", role: "溜溜球",
    body: "#FFC98A", belly: "#FFF4E0", dark: "#E28E4A", ink: "#8B5030",
    ear: "#FFC98A", earIn: "#FFB0BE",
    rarity: "普通", rar: "#9DB0BA", rarTxt: "COMMON", stars: 1,
    bw: 0.56, bh: 0.40, hd: 0.56,
    hrx: 1.00, hry: 0.94, chin: 0.18,
    say: "我先上去看看。", trait: "毛尖 + 竖瞳", get: "最先学会的那只",
  },
  dog: {
    name: "年糕", sp: "短尾犬", role: "音波喇叭",
    body: "#FFE0A4", belly: "#FFFAEC", dark: "#E2B160", ink: "#8B6535",
    ear: "#E8BE79", earIn: "#D9A55E",
    rarity: "普通", rar: "#9DB0BA", rarTxt: "COMMON", stars: 1,
    bw: 0.68, bh: 0.38, hd: 0.55,
    hrx: 1.04, hry: 0.90, chin: 0.36,
    say: "等我回来！", trait: "卷尾 + 露舌", get: "永远在门口等的那只",
  },
  ham: {
    name: "团子", sp: "胖仓鼠", role: "滚地雷",
    body: "#FFD57C", belly: "#FFF8E4", dark: "#DEAC46", ink: "#8E6630",
    ear: "#FFD57C", earIn: "#F2A0A8",
    rarity: "少见", rar: "#7FC9A8", rarTxt: "UNCOMMON", stars: 2,
    bw: 0.90, bh: 0.46, hd: 0.52,
    hrx: 1.14, hry: 0.86, chin: 0.00,
    say: "路上有吃的吗？", trait: "颊袋 + 无尾", get: "能塞下一整颗果",
  },
  rab: {
    name: "雪团", sp: "长耳兔", role: "三连跳",
    body: "#FFF4F8", belly: "#FFFFFF", dark: "#E8D0DE", ink: "#B06A8C",
    ear: "#FFF4F8", earIn: "#FFB6D2",
    rarity: "少见", rar: "#7FC9A8", rarTxt: "UNCOMMON", stars: 2,
    bw: 0.50, bh: 0.46, hd: 0.54,
    hrx: 0.93, hry: 1.02, chin: 0.20,
    say: "我跳得高，我去。", trait: "一耳微折 + 大后脚", get: "耳朵比身子长",
  },
  ox: {
    name: "豆奶", sp: "老实牛", role: "冲撞",
    body: "#CBDCF2", belly: "#F2F8FF", dark: "#8FA9CE", ink: "#5E7398",
    ear: "#CBDCF2", earIn: "#A9BEDC",
    rarity: "稀有", rar: "#7FB4EC", rarTxt: "RARE", stars: 3,
    bw: 0.82, bh: 0.40, hd: 0.58,
    hrx: 1.06, hry: 0.90, chin: 0.30,
    say: "慢慢走也到得了。", trait: "月牙角 + 斑块", get: "尾巴一直在赶苍蝇",
  },
  fox: {
    name: "星屑", sp: "影狐", role: "影分身",
    body: "#FFA97C", belly: "#FFF2E2", dark: "#E0764A", ink: "#A04E2E",
    ear: "#FFA97C", earIn: "#FFD8B8",
    rarity: "传说", rar: "#E0A030", rarTxt: "LEGENDARY", stars: 4,
    bw: 0.54, bh: 0.38, hd: 0.56,
    hrx: 1.00, hry: 0.92, chin: 0.56,
    say: "天黑才好办事。", trait: "巨尾 + 星尘", get: "整条尾巴比它还大",
  },
};
const ORDER = ["cat", "dog", "ham", "rab", "ox", "fox"];

/* ---------------------------------------------------------------- 大眼睛 */

/**
 * 可爱度的第一杠杆。三件事必须同时存在，少一件就"死鱼眼"：
 *   1. 竖椭圆（rw 0.86 / rh 1.14）—— 横椭圆像青蛙，正圆像纽扣
 *   2. 左上大高光 + 右下小高光 —— 双高光才有"湿润"
 *   3. 下缘一圈淡蓝反光 —— 这一条最容易被忽略，但它是"水汪汪"真正的来源
 */
function bigEye(g, cx, cy, R, ink, o) {
  const oo = o || {};
  const rw = R * 0.88, rh = R * 1.16;
  g.beginPath();
  g.ellipse(cx, cy, rw, rh, 0, 0, 6.2832);
  g.fillStyle = oo.fill || "#3B2B29";
  g.fill();

  // 竖瞳
  if (oo.slit) {
    blob(g, cx, cy + rh * 0.04, rw * 0.30, rh * 0.76, "#140C0C", 0);
  }

  // 下缘淡蓝反光
  g.fillStyle = "rgba(198,240,255,.50)";
  g.beginPath();
  g.ellipse(cx, cy + rh * 0.64, rw * 0.48, rh * 0.17, 0, 0, 6.2832);
  g.fill();

  // 主高光
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.ellipse(cx - rw * 0.30, cy - rh * 0.40, rw * 0.40, rh * 0.30, -0.35, 0, 6.2832);
  g.fill();
  // 副高光
  g.beginPath();
  g.arc(cx + rw * 0.38, cy + rh * 0.34, rw * 0.20, 0, 6.2832);
  g.fill();
}

/* ---------------------------------------------------------------- 立绘 */

/**
 * @param h     身体+头的总高（不含耳/角，耳角可以超出）
 * @param expr  normal | hungry | half | full
 */
function drawPal(g, id, cx, footY, h, expr, opt) {
  const o = opt || {};
  const P = PALS[id];
  const E = expr || "normal";
  const lw = Math.max(2.4, h * 0.026);
  const bodyW = h * P.bw;
  const bodyH = h * P.bh;
  const headR = h * P.hd * 0.5;
  const bodyCY = footY - bodyH / 2;
  const headCY = footY - bodyH - headR * 0.74;
  const face = o.face === undefined ? 1 : o.face;
  const INK = P.ink;

  g.save();
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  if (face === -1) { g.translate(cx * 2, 0); g.scale(-1, 1); }

  /* ---- 1. 身后件 ---- */
  if (id === "cat") {
    // 长尾：从身后甩出，末端上卷，两道环纹
    const tx = cx - bodyW * 0.28, ty = bodyCY + bodyH * 0.42;
    g.beginPath();
    g.moveTo(tx, ty);
    g.bezierCurveTo(tx - bodyW * 0.40, ty + bodyH * 0.06,
                    tx - bodyW * 0.48, bodyCY - bodyH * 0.56,
                    tx - bodyW * 0.18, bodyCY - bodyH * 0.86);
    g.strokeStyle = INK; g.lineWidth = lw * 2.9; g.lineCap = "round"; g.stroke();
    g.strokeStyle = P.body; g.lineWidth = lw * 1.9; g.stroke();
    // 环纹
    g.strokeStyle = "rgba(180,110,60,.55)"; g.lineWidth = lw * 1.9;
    for (const t of [0.36, 0.60]) {
      const px = tx - bodyW * (0.16 + t * 0.30);
      const py = bodyCY + bodyH * (0.28 - t * 1.02);
      g.beginPath();
      g.moveTo(px - lw * 1.2, py - lw * 0.4); g.lineTo(px + lw * 1.2, py + lw * 0.4);
      g.stroke();
    }
  } else if (id === "dog") {
    // 卷尾：一个实心螺旋，柴犬标志。用一个圆环 + 内圈留白近似
    const tx = cx - bodyW * 0.56, ty = bodyCY - bodyH * 0.22;
    g.beginPath();
    g.arc(tx, ty, h * 0.082, 0, 6.2832);
    fs(g, P.body, INK, lw);
    g.beginPath();
    g.arc(tx, ty, h * 0.034, 0, 6.2832);
    fs(g, "rgba(226,177,96,.85)", INK, lw * 0.55);
  } else if (id === "rab") {
    blob(g, cx - bodyW * 0.46, bodyCY + bodyH * 0.24, h * 0.075, h * 0.075, P.belly, lw, 0, INK);
  } else if (id === "ox") {
    // 细尾 + 尾端毛球（它一直在赶苍蝇）
    const tx = cx - bodyW * 0.44, ty = bodyCY + bodyH * 0.06;
    g.beginPath();
    g.moveTo(tx, ty);
    g.quadraticCurveTo(tx - bodyW * 0.26, ty + bodyH * 0.40, tx - bodyW * 0.16, ty + bodyH * 0.56);
    g.strokeStyle = INK; g.lineWidth = lw * 1.1; g.lineCap = "round"; g.stroke();
    blob(g, tx - bodyW * 0.16, ty + bodyH * 0.62, h * 0.058, h * 0.068, P.dark, lw * 0.9, 0, INK);
  } else if (id === "fox") {
    // 巨尾：三段递进，最宽 0.30h。这是全队体积最大的单件，也是"传说"的唯一理由
    const bx = cx - bodyW * 0.62, by = bodyCY - bodyH * 0.04;
    // 纺锤形：根细 → 中段最粗 → 尾尖收窄转白。
    // 三段竖直往上堆会读成"背了个麻袋"，必须沿一条斜线向外上方甩
    blob(g, bx + h * 0.03, by + h * 0.16, h * 0.075, h * 0.068, P.dark, lw * 0.9, 0.30, INK);
    blob(g, bx - h * 0.02, by + h * 0.04, h * 0.125, h * 0.108, P.body, lw, 0.42, INK);
    blob(g, bx - h * 0.085, by - h * 0.095, h * 0.142, h * 0.118, P.body, lw, 0.56, INK);
    blob(g, bx - h * 0.150, by - h * 0.220, h * 0.100, h * 0.088, P.body, lw, 0.70, INK);
    blob(g, bx - h * 0.198, by - h * 0.308, h * 0.062, h * 0.056, "#FFF8EE", lw * 0.8, 0, INK);
    // 星尘：沿尾巴往上撒
    star(g, bx + h * 0.040, by + h * 0.185, h * 0.024, h * 0.009, "#FFF3B0", null, 0, 4);
    star(g, bx - h * 0.080, by - h * 0.030, h * 0.031, h * 0.011, "#FFF3B0", null, 0, 4);
    star(g, bx - h * 0.180, by - h * 0.180, h * 0.036, h * 0.013, "#FFFFFF", null, 0, 4);
    star(g, bx - h * 0.232, by - h * 0.272, h * 0.022, h * 0.008, "#FFFFFF", null, 0, 4);
  }

  /* ---- 2. 后脚（先画，被身体压住一半） ---- */
  const footR = h * 0.062;
  const footDX = bodyW * 0.26;
  blob(g, cx - footDX, footY - footR * 0.55, footR, footR * 0.78, P.dark, lw * 0.9, 0, INK);
  blob(g, cx + footDX, footY - footR * 0.55, footR, footR * 0.78, P.dark, lw * 0.9, 0, INK);

  /* ---- 3. 身体 ---- */
  const bodyPath = () => eggBody(g, cx, bodyCY, bodyW, bodyH);
  eggBody(g, cx, bodyCY, bodyW, bodyH);
  fs(g, P.body, INK, lw);
  // 三阶明暗：右下背光、左上受光。**硬边色块，不是渐变**
  form(g, bodyPath, cx, bodyCY, bodyW / 2, bodyH / 2, P.body,
       { dk: 0.22, dkx: 0.62, dky: 0.90, lt: 0.22 });
  rim(g, bodyPath, cx, bodyCY, bodyW / 2, bodyH / 2, "rgba(255,255,255,.34)", lw * 0.9);

  // 肚皮
  g.beginPath();
  g.ellipse(cx + face * bodyW * 0.03, bodyCY + bodyH * 0.12,
            bodyW * 0.31, bodyH * 0.32, 0, 0, 6.2832);
  g.fillStyle = P.belly;
  g.fill();

  /* ---- 4. 材质：这一层是"六只不一样"的关键 ---- */
  if (id === "ox") {
    // 两块不规则斑：牛唯一的"毛色"语言
    g.save();
    eggBody(g, cx, bodyCY, bodyW, bodyH);
    g.clip();
    blob(g, cx - bodyW * 0.30, bodyCY - bodyH * 0.28, bodyW * 0.16, bodyH * 0.19, P.dark, 0, 0.4);
    blob(g, cx + bodyW * 0.36, bodyCY - bodyH * 0.16, bodyW * 0.13, bodyH * 0.16, P.dark, 0, -0.2);
    g.restore();
    g.beginPath();
    g.ellipse(cx - bodyW * 0.30, bodyCY - bodyH * 0.28, bodyW * 0.16, bodyH * 0.19, 0.4, 0, 6.2832);
    g.fillStyle = P.dark; g.fill();
    g.beginPath();
    g.ellipse(cx + bodyW * 0.36, bodyCY - bodyH * 0.16, bodyW * 0.13, bodyH * 0.16, -0.2, 0, 6.2832);
    g.fill();
  } else if (id === "ham") {
    // 三道浅色横纹：仓鼠背上的"饼干条"
    g.save();
    eggBody(g, cx, bodyCY, bodyW, bodyH);
    g.clip();
    // 只画**背部**两条短纹，不横贯到肚子 —— 横贯会被读成"穿了条内裤"
    g.fillStyle = "rgba(255,250,236,.72)";
    for (let i = 0; i < 2; i++) {
      rr(g, cx - bodyW * 0.30, bodyCY - bodyH * (0.24 - i * 0.17), bodyW * 0.60, bodyH * 0.052, bodyH * 0.03);
      g.fill();
    }
    g.restore();
  }

  /* ---- 5. 耳朵 / 角（先于头） ---- */
  const earY = headCY - headR * 0.52;
  if (id === "cat") {
    triEar(g, cx - headR * 0.60, earY + headR * 0.34, headR * 0.52, headR * 0.66, -0.26, P.ear, P.earIn, lw, INK);
    triEar(g, cx + headR * 0.60, earY + headR * 0.34, headR * 0.52, headR * 0.66,  0.26, P.ear, P.earIn, lw, INK);
  } else if (id === "dog") {
    // 垂耳：大而软，垂到脸中间。和猫的尖耳形成最强剪影对比
    blob(g, cx - headR * 0.92, headCY + headR * 0.06, headR * 0.28, headR * 0.56, P.ear, lw, -0.26, INK);
    blob(g, cx + headR * 0.92, headCY + headR * 0.06, headR * 0.28, headR * 0.56, P.ear, lw,  0.26, INK);
  } else if (id === "ham") {
    // 小圆耳，几乎被头吃掉一半
    for (const sd of [-1, 1]) {
      blob(g, cx + sd * headR * 0.66, earY + headR * 0.20, headR * 0.31, headR * 0.30, P.ear, lw, 0, INK);
      blob(g, cx + sd * headR * 0.66, earY + headR * 0.22, headR * 0.16, headR * 0.16, P.earIn, 0);
    }
  } else if (id === "rab") {
    // 一只直、一只折 —— 不对称才是活的。对称的耳朵像兔耳发箍
    const base = headCY - headR * 0.76;
    // 左耳：直
    blob(g, cx - headR * 0.34, base - h * 0.215, headR * 0.27, h * 0.255, P.ear, lw, -0.10, INK);
    blob(g, cx - headR * 0.34, base - h * 0.205, headR * 0.135, h * 0.185, P.earIn, 0, -0.10);
    // 右耳：尖端往右折
    // 右耳：根直立，**顶端整段向前折倒**。方向要突变，不然读成直耳
    blob(g, cx + headR * 0.36, base - h * 0.150, headR * 0.26, h * 0.175, P.ear, lw, 0.10, INK);
    blob(g, cx + headR * 0.36, base - h * 0.148, headR * 0.130, h * 0.125, P.earIn, 0, 0.10);
    blob(g, cx + headR * 0.50, base - h * 0.298, h * 0.100, headR * 0.140, P.ear, lw, 0.55, INK);
    blob(g, cx + headR * 0.52, base - h * 0.298, h * 0.055, headR * 0.078, P.earIn, 0, 0.55);
  } else if (id === "ox") {
    horn(g, cx - headR * 0.84, headCY - headR * 0.32, headR, -1, lw, INK);
    horn(g, cx + headR * 0.84, headCY - headR * 0.32, headR,  1, lw, INK);
    // 小耳在角下
    for (const sd of [-1, 1]) {
      blob(g, cx + sd * headR * 0.94, headCY + headR * 0.14, headR * 0.25, headR * 0.17, P.ear, lw * 0.9, sd * 0.3, INK);
    }
  } else if (id === "fox") {
    triEar(g, cx - headR * 0.72, earY + headR * 0.16, headR * 0.62, headR * 0.88, -0.38, P.ear, P.earIn, lw, INK);
    triEar(g, cx + headR * 0.72, earY + headR * 0.16, headR * 0.62, headR * 0.88,  0.38, P.ear, P.earIn, lw, INK);
  }

  /* ---- 6. 头（每只一个脸型，不共用圆） ---- */
  const HRX = headR * P.hrx, HRY = headR * P.hry;
  const headPathFn = () => headPath(g, cx, headCY, HRX, HRY, P.chin);
  headPath(g, cx, headCY, HRX, HRY, P.chin);
  fs(g, P.body, INK, lw);
  // 头是三阶里最重要的一块：脸占了整只的一半，脸平 = 整只平
  // 头**不能**做完整球体打光：脸是视觉中心，暗部进到脸中间就"脏"，
  // 分界弧线还会读成"戴了个面具"。只让暗部贴住右下**边缘带**，脸保持明亮。
  form(g, headPathFn, cx, headCY, HRX, HRY, P.body,
       { dk: 0.24, dkx: 0.86, dky: 1.04, lt: 0 });
  // 体积感改由"额头月牙高光 + 下沿 AO"承担
  g.save();
  headPathFn();
  g.clip();
  g.fillStyle = "rgba(255,255,255,.26)";
  g.beginPath();
  g.ellipse(cx - HRX * 0.30, headCY - HRY * 0.66, HRX * 0.30, HRY * 0.15, -0.20, 0, 6.2832);
  g.fill();
  g.restore();
  rim(g, headPathFn, cx, headCY, HRX, HRY, "rgba(255,255,255,.38)", lw * 0.9);

  // 头压在身体上的接触阴影（AO）。这一条比 rim 更能读成"头和身子是两个球"：
  // 没有它，头就是"贴在身体上的一张脸"。
  g.save();
  g.fillStyle = "rgba(74,44,24,.17)";
  g.beginPath();
  g.ellipse(cx + face * headR * 0.04, headCY + HRY * 1.02,
            HRX * 0.92, HRY * 0.20, 0, 0, 6.2832);
  g.fill();
  g.restore();

  // 狐狸的眼罩：眼部一圈更深的面色（这是"影狐"的名字来源）
  if (id === "fox") {
    g.save();
    headPath(g, cx, headCY, HRX, HRY, P.chin);
    g.clip();
    g.fillStyle = "rgba(224,118,74,.55)";
    g.beginPath();
    g.ellipse(cx, headCY + headR * 0.02, headR * 0.96, headR * 0.42, 0, 0, 6.2832);
    g.fill();
    g.restore();
  }

  // 牛的白面罩
  if (id === "ox") {
    g.beginPath();
    // 额头一块深斑：头占画面一半，斑必须画在**头上**才看得见
    g.save();
    headPath(g, cx, headCY, HRX, HRY, P.chin);
    g.clip();
    g.fillStyle = "#7E96BE";
    g.beginPath();
    g.ellipse(cx - face * headR * 0.44, headCY - headR * 0.50, headR * 0.36, headR * 0.30, -0.5, 0, 6.2832);
    g.fill();
    g.restore();

    // 只做"鼻梁白"，不做整块下半脸 —— 整块会读成戴口罩
    g.ellipse(cx + face * headR * 0.04, headCY + headR * 0.44, headR * 0.29, headR * 0.21, 0, 0, 6.2832);
    g.fillStyle = P.belly;
    g.fill();
  }

  /* ---- 7. 颊袋（仓鼠唯一撑出轮廓的件） ---- */
  if (id === "ham") {
    for (const sd of [-1, 1]) {
      blob(g, cx + sd * headR * 0.86, headCY + headR * 0.48, headR * 0.42, headR * 0.31, P.body, lw, 0, INK);
    }
  }

  /* ---- 8. 脸 ---- */
  const eyeDX = headR * 0.42;
  const eyeY = headCY + headR * 0.02;
  const eyeR = headR * 0.29;      // v1 是 0.175 —— 差了近一倍，这是"可爱"最大的一个数
  const ex = face * headR * 0.07;

  if (E === "full") {
    // 眯成 ^ ^
    g.strokeStyle = INK; g.lineWidth = lw * 1.15; g.lineCap = "round";
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(cx + ex + s * eyeDX, eyeY + eyeR * 0.42, eyeR * 0.92, Math.PI * 1.14, Math.PI * 1.86);
      g.stroke();
    }
  } else if (E === "hungry") {
    for (const s of [-1, 1]) {
      const x0 = cx + ex + s * eyeDX;
      g.beginPath();
      g.ellipse(x0, eyeY + eyeR * 0.34, eyeR * 0.90, eyeR * 0.46, 0, 0, 6.2832);
      fs(g, "#FFFFFF", INK, lw * 0.8);
      blob(g, x0, eyeY + eyeR * 0.46, eyeR * 0.40, eyeR * 0.28, "#3B2B29", 0);
      // 垂下眼皮
      g.beginPath();
      g.ellipse(x0, eyeY - eyeR * 0.26, eyeR * 1.02, eyeR * 0.58, 0, 0, 6.2832);
      fs(g, P.body, null, 0);
      g.strokeStyle = INK; g.lineWidth = lw * 0.8;
      g.beginPath();
      g.moveTo(x0 - eyeR * 0.96, eyeY - eyeR * 0.20);
      g.quadraticCurveTo(x0, eyeY - eyeR * 0.66, x0 + eyeR * 0.96, eyeY - eyeR * 0.20);
      g.stroke();
    }
  } else if (E === "half") {
    // 星星眼：半饿最强，必须一眼看出"来劲了"
    for (const s of [-1, 1]) {
      star(g, cx + ex + s * eyeDX, eyeY, eyeR * 1.45, eyeR * 0.60, T.lemon, INK, lw * 0.7, 4);
    }
  } else if (id === "ox") {
    // 牛：**半眯的大眼**，不是闭眼弧。纯弧线在它的大脸上等于没有眼睛，
    // 加上大粉鼻就成了猪。必须留住下半个眼球和高光，才读得出"它在看你"
    for (const s of [-1, 1]) {
      const x0 = cx + ex + s * eyeDX;
      bigEye(g, x0, eyeY, eyeR, INK, {});
      g.fillStyle = P.body;
      g.beginPath();
      g.ellipse(x0, eyeY - eyeR * 0.92, eyeR * 1.04, eyeR * 0.66, 0, 0, 6.2832);
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = lw * 0.95;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(x0 - eyeR * 0.94, eyeY - eyeR * 0.26);
      g.quadraticCurveTo(x0, eyeY - eyeR * 0.58, x0 + eyeR * 0.94, eyeY - eyeR * 0.26);
      g.stroke();
    }
  } else if (id === "fox") {
    // 狐：**必须有大眼球**。原来画的是两道闭眼弧线，结果六只里只有它没有眼白 ——
    // 传说位反而最不吸引人，和"极致想得到"直接矛盾。弧线笑眼只留给满饱态。
    // 狐的"笑里有话"改由外眼角一道上挑细线承担。
    for (const s of [-1, 1]) {
      bigEye(g, cx + ex + s * eyeDX, eyeY, eyeR, INK, { slit: true });
    }
    // 试过在每只外眼角加一道上挑细线来做"狐媚"，结果只露出一条、还被读成
    // 单边眉毛（另一条超出头部轮廓被裁）。不要它 —— 狐的辨识度靠尖下巴 + 巨尾，
    // 眼睛就保持和其他五只同一套大眼球。
  } else {
    const k = id === "rab" ? 1.10 : 1;
    for (const s of [-1, 1]) {
      bigEye(g, cx + ex + s * eyeDX, eyeY, eyeR * k, INK, { slit: id === "cat" });
    }
  }

  /* ---- 9. 腮红：**长相，不是状态**。v1 只在饱/半饿画，这是错的 ---- */
  {
    const bk = E === "hungry" ? 0.16 : E === "half" ? 0.52 : 0.40;
    g.fillStyle = `rgba(255,132,146,${bk})`;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + ex + s * eyeDX * 1.34, eyeY + eyeR * 1.46, eyeR * 0.70, eyeR * 0.40, 0, 0, 6.2832);
      g.fill();
    }
  }

  /* ---- 10. 鼻 + 嘴 ---- */
  const my = eyeY + eyeR * 1.44;
  if (id === "ox") {
    g.beginPath();
    g.ellipse(cx + ex, my + headR * 0.10, headR * 0.195, headR * 0.125, 0, 0, 6.2832);
    fs(g, "#EFA9A2", INK, lw * 0.8);
    g.fillStyle = INK;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + ex + s * headR * 0.10, my + headR * 0.10, headR * 0.038, headR * 0.050, 0, 0, 6.2832);
      g.fill();
    }
  } else if (id === "dog") {
    // 犬：圆鼻头 + 舌头。舌头是"憨"的全部来源
    blob(g, cx + ex, my, eyeR * 0.30, eyeR * 0.24, INK, 0);
    g.beginPath();
    g.ellipse(cx + ex, my + eyeR * 0.86, eyeR * 0.38, eyeR * 0.50, 0, 0, 6.2832);
    fs(g, "#FF8E96", INK, lw * 0.65);
  } else {
    // 小倒三角鼻
    g.beginPath();
    g.moveTo(cx + ex - eyeR * 0.21, my - eyeR * 0.12);
    g.lineTo(cx + ex + eyeR * 0.21, my - eyeR * 0.12);
    g.quadraticCurveTo(cx + ex, my + eyeR * 0.28, cx + ex - eyeR * 0.21, my - eyeR * 0.12);
    g.closePath();
    fs(g, INK, null, 0);
  }

  // 嘴
  g.strokeStyle = INK;
  g.lineWidth = lw * 0.85;
  g.lineCap = "round";
  if (E === "hungry") {
    const wm = my + eyeR * 0.92;
    g.beginPath();
    g.moveTo(cx + ex - eyeR * 0.78, wm);
    g.quadraticCurveTo(cx + ex - eyeR * 0.39, wm - eyeR * 0.40, cx + ex, wm);
    g.quadraticCurveTo(cx + ex + eyeR * 0.39, wm + eyeR * 0.40, cx + ex + eyeR * 0.78, wm);
    g.stroke();
    // 汗滴
    const sx = cx + face * headR * 0.90, sy = headCY - headR * 0.36;
    g.beginPath();
    g.moveTo(sx, sy - eyeR * 0.80);
    g.quadraticCurveTo(sx + eyeR * 0.58, sy, sx, sy + eyeR * 0.50);
    g.quadraticCurveTo(sx - eyeR * 0.58, sy, sx, sy - eyeR * 0.80);
    fs(g, "#A5E0F5", INK, lw * 0.6);
  } else if (E === "full") {
    g.beginPath();
    g.arc(cx + ex, my + eyeR * 0.42, eyeR * 0.76, Math.PI * 1.14, Math.PI * 1.86);
    g.stroke();
  } else if (E === "half") {
    const mr = eyeR * 0.86;
    g.beginPath();
    g.arc(cx + ex, my + eyeR * 0.46, mr, 0, Math.PI);
    fs(g, "#8C3A44", INK, lw * 0.75);
    g.beginPath();
    g.ellipse(cx + ex, my + eyeR * 0.92, mr * 0.50, mr * 0.32, 0, 0, 6.2832);
    g.fillStyle = "#FF98A0"; g.fill();
  } else {
    // 常态 ω
    const wm = my + eyeR * 0.62;
    if (id === "fox") {
      // 一侧嘴角上翘，另一侧平 —— 单边翘才是"笑里有话"，双边翘是憨笑
      g.beginPath();
      g.moveTo(cx + ex - eyeR * 0.44, wm + eyeR * 0.06);
      g.quadraticCurveTo(cx + ex, wm + eyeR * 0.18, cx + ex + eyeR * 0.46, wm - eyeR * 0.20);
      g.stroke();
    } else if (id === "dog") {
      g.beginPath();
      g.moveTo(cx + ex - eyeR * 0.50, wm);
      g.quadraticCurveTo(cx + ex, wm + eyeR * 0.34, cx + ex + eyeR * 0.50, wm);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(cx + ex - eyeR * 0.26, wm, eyeR * 0.27, 0, Math.PI * 0.92);
      g.stroke();
      g.beginPath();
      g.arc(cx + ex + eyeR * 0.26, wm, eyeR * 0.27, 0, Math.PI * 0.92);
      g.stroke();
    }
  }

  // 仓鼠门牙
  if (id === "ham" && E === "normal") {
    for (const s of [-1, 1]) {
      g.beginPath();
      rr(g, cx + ex + s * eyeR * 0.14 - eyeR * 0.11, my + eyeR * 0.30, eyeR * 0.22, eyeR * 0.40, eyeR * 0.06);
      fs(g, "#FFFFFF", INK, lw * 0.55);
    }
  }

  /* ---- 11. 猫的毛尖：沿头顶和脸颊伸出的小三角，唯一"短毛"材质 ---- */
  if (id === "cat") {
    // 头顶一撮呆毛。试过腮毛 —— 不论怎么调位置都像"脸上贴了两片叶子"，
    // 而呆毛只占一条弧，信息量小、辨识度高，是猫最省钱的标志
    const hx = cx - headR * 0.06, hy = headCY - HRY * 0.94;
    g.beginPath();
    g.moveTo(hx - headR * 0.10, hy + headR * 0.05);
    g.quadraticCurveTo(hx - headR * 0.16, hy - headR * 0.42, hx + headR * 0.16, hy - headR * 0.58);
    g.quadraticCurveTo(hx + headR * 0.04, hy - headR * 0.30, hx + headR * 0.10, hy + headR * 0.05);
    g.closePath();
    fs(g, P.body, INK, lw * 0.75);
  }

  /* ---- 12. 饿的瘪肚纹 ---- */
  if (E === "hungry") {
    g.strokeStyle = "rgba(107,74,66,.30)";
    g.lineWidth = lw * 0.6;
    for (let i = 0; i < 2; i++) {
      const yy = bodyCY + bodyH * (0.04 + i * 0.15);
      g.beginPath();
      g.moveTo(cx - bodyW * 0.17, yy);
      g.quadraticCurveTo(cx, yy + bodyH * 0.07, cx + bodyW * 0.17, yy);
      g.stroke();
    }
  }

  g.restore();

  /* ---- 13. 半饿金环（restore 之后，避免被镜像带走） ---- */
  if (E === "half") {
    const ry = footY - h * 0.03;
    g.save();
    g.globalAlpha = 0.26;
    blob(g, cx, ry, h * 0.36, h * 0.075, T.lemon, 0);
    g.restore();
    g.strokeStyle = T.gold || T.lemonDk;
    g.lineWidth = Math.max(2.4, h * 0.016);
    g.beginPath();
    g.ellipse(cx, ry, h * 0.36, h * 0.075, 0, 0, 6.2832);
    g.stroke();
  }
}

/** 稀有度小条：四颗星 + 文字。这是"想得到"的量化表达 */
function rarityTag(g, x, y, P, size) {
  const s = size || 11;
  const total = 4;
  for (let i = 0; i < total; i++) {
    star(g, x + i * (s * 1.25), y, s * 0.46, s * 0.18,
         i < P.stars ? P.rar : "rgba(107,74,66,.16)", null, 0, 4);
  }
}

module.exports = {
  W, H, T, F, rr, fs, shadow, card, btn, text, textO, blob, star,
  eggBody, triEar, horn, bigEye, drawPal, rarityTag, PALS, ORDER,
};
