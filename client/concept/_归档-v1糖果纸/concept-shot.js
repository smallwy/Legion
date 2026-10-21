/* ============================================================================
   PAWPACK · 正式概念图渲染
   ----------------------------------------------------------------------------
   为什么不用 AI 出这三张图：
     AI 出图的中文必然糊成笔画团，而 UI 概念图的全部价值就是"字怎么写、
     按钮多宽、几号字"。一张字看不清的 UI 稿，美术和程序都没法照着做。
     所以：UI 用代码精绘（尺寸可量、字准确、能直接截成 PNG 交付），
     宠物立绘也用同一套矢量 —— 立绘和游戏内是同一份资产，不是两张皮。

   为什么放在 Node 而不是浏览器：
     @napi-rs/canvas 是同一套 Canvas2D API，画完直接落盘，
     不需要 headless 浏览器（本机沙箱里也没有可用的）。

   运行：
     NODE_PATH=<managed>/node_modules node client/concept/concept-shot.js
     ONLY=sheet node ...     只出立绘谱
     ONLY=main  node ...     只出主界面
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

/* 中文字体：显式注册，不赌系统回退。粗体单列一个 family，靠字号+字体两轴控层级 */
try {
  GlobalFonts.registerFromPath("C:/Windows/Fonts/msyh.ttc", "YaHei");
  GlobalFonts.registerFromPath("C:/Windows/Fonts/msyhbd.ttc", "YaHeiB");
} catch (e) {
  console.warn("字体注册失败，回退系统字体：", e.message);
}

const W = 1280, H = 720;
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* ----------------------------------------------------------------------------
   设计 token —— 「糖果纸」
   ----------------------------------------------------------------------------
   参考取舍（详见 docs/UI_概念设计_PAWPACK_v1.0.md §1）：
     蛋仔派对   → 抄「厚底按钮 + 糖果渐变」，不抄满屏红点
     星之卡比   → 抄「粉彩天空 + 白/深描边贴纸感」，不抄 3D 体积
     Ooblets    → 抄「高饱和角色 + 粗描边」，不抄写实质感
     动森       → 抄「奶油纸面板 + 留白」，不抄无描边
     雪人兄弟   → 抄「单屏一关 + 即时反馈」，不抄街机像素
   -------------------------------------------------------------------------- */
const T = {
  ink:      "#3A2B44",   // 主描边（沿用 grove.html 的 COL.outline，两边同一色）
  ink2:     "#5A4668",
  paper:    "#FFF8E7",   // 奶油纸
  paper2:   "#FFEBCF",
  paperSh:  "#E2CFA8",
  amber:    "#FFB454",
  amberDk:  "#D97E2B",
  amberLt:  "#FFD79E",
  mint:     "#8FD9B6",
  mintDk:   "#46997A",
  sky:      "#7FC8F0",
  danger:   "#FF6B5E",
  dangerDk: "#C9483E",
  gold:     "#FFD34E",
  goldDk:   "#D9A21C",
  txtDk:    "#2C2233",
  txtLt:    "#FFF8E7",
  grass:    "#5A9E5C",
  grassDk:  "#3B7246",
  grassLt:  "#7CBE6E",
  dirt:     "#7A5638",
  dirtDk:   "#54391F",
  wood:     "#A97A4A",
  woodLt:   "#C79A66",
};

const F = (size, bold) => `${size}px ${bold ? "YaHeiB" : "YaHei"}, "Microsoft YaHei", sans-serif`;

/* ---------------------------------------------------------------- 基础图元 */

/** 圆角矩形路径。自己写是因为 canvas 的 roundRect 在部分运行时缺失。 */
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

/** 硬投影：偏移一坨实色，不用 shadowBlur。
    模糊阴影是"写实"的信号，卡通要靠**实色错位**压出层次。 */
function shadow(g, x, y, w, h, r, dy, alpha) {
  g.fillStyle = `rgba(58,43,68,${alpha === undefined ? 0.20 : alpha})`;
  rr(g, x, y + (dy === undefined ? 7 : dy), w, h, r);
  g.fill();
}

/** 奶油纸卡片 */
function card(g, x, y, w, h, r, opt) {
  const o = opt || {};
  if (o.shadow !== false) shadow(g, x, y, w, h, r, o.dy, o.sa);
  g.fillStyle = o.fill || T.paper;
  rr(g, x, y, w, h, r);
  g.fill();
  if (o.line !== false) {
    g.strokeStyle = o.lineColor || T.ink;
    g.lineWidth = o.lw || 4;
    rr(g, x, y, w, h, r);
    g.stroke();
  }
}

/** 厚底按钮：底部一条实色"厚度"，顶部一道高光。按下时把面下移、厚度变薄。 */
function btn(g, x, y, w, h, label, opt) {
  const o = opt || {};
  const face = o.face || T.amber;
  const dark = o.dark || T.amberDk;
  const tc = o.text || "#4A2A08";
  const d = o.pressed ? 3 : (o.depth === undefined ? 8 : o.depth);
  const r = o.r === undefined ? h * 0.42 : o.r;

  g.fillStyle = dark;
  rr(g, x, y + d, w, h, r);
  g.fill();

  g.fillStyle = face;
  rr(g, x, y + (o.pressed ? d - 3 : 0), w, h, r);
  g.fill();

  // 顶部高光：一条压扁的亮色带，只覆盖上 34%。别做成整块渐变
  if (o.gloss !== false) {
    const y0 = y + (o.pressed ? d - 3 : 0);
    g.save();
    rr(g, x, y0, w, h, r);
    g.clip();
    g.fillStyle = "rgba(255,255,255,.20)";
    rr(g, x + 10, y0 + 8, w - 20, h * 0.30, h * 0.15);
    g.fill();
    g.restore();
  }

  g.strokeStyle = T.ink;
  g.lineWidth = o.lw || 4;
  rr(g, x, y + (o.pressed ? d - 3 : 0), w, h, r);
  g.stroke();

  const ty = y + (o.pressed ? d - 3 : 0) + h / 2;
  if (o.sub) {
    text(g, label, x + w / 2, ty - 9, o.size || 22, tc, true);
    text(g, o.sub, x + w / 2, ty + 14, 12, o.subColor || "rgba(74,42,8,.66)", false);
  } else {
    text(g, label, x + w / 2, ty, o.size || 22, tc, true);
  }
}

/** 文字。默认居中 */
function text(g, s, x, y, size, color, bold, align) {
  g.font = F(size, bold);
  g.fillStyle = color || T.txtDk;
  g.textAlign = align || "center";
  g.textBaseline = "middle";
  g.fillText(s, x, y);
}

/** 描边字。标题专用 —— 深描边让字从任何背景上都跳出来 */
function textO(g, s, x, y, size, color, oc, lw, bold, align) {
  g.font = F(size, bold);
  g.textAlign = align || "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.miterLimit = 2;
  g.lineWidth = lw || Math.max(4, size * 0.16);
  g.strokeStyle = oc || T.ink;
  g.strokeText(s, x, y);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

/** 椭圆块（带描边） */
function blob(g, cx, cy, rx, ry, fill, lw, rot) {
  g.beginPath();
  g.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot || 0, 0, 6.2832);
  g.fillStyle = fill;
  g.fill();
  if (lw !== 0) {
    g.strokeStyle = T.ink;
    g.lineWidth = lw === undefined ? 4 : lw;
    g.stroke();
  }
}

/* ----------------------------------------------------------------------------
   宠物立绘
   ----------------------------------------------------------------------------
   旧版（grove.html 的 drawPet）在 40px 上是够用的，但它有两个硬伤：
     1. 六只只有"换主色 + 换耳朵"的差别，缩成剪影几乎一样 —— 违背"剪影可辨"铁律
     2. 头身比接近 1:1.6，读起来是"q 版小人"，不是"q 版动物"

   这一版重做三件事：
     1. 头身比 1:1.1（大头短身），眼睛占脸 1/3
     2. 每只给一个**独有的剪影件**：猫=尖耳+卷尾 / 犬=垂耳+短尾 / 鼠=鼓腮无尾 /
        兔=超长立耳 / 牛=弯角+宽鼻 / 狐=宽尖耳+大蓬尾
     3. 四套表情靠眼/嘴/腮红，不换骨架（美术只画一套身体，
        程序用 expr 参数切脸 —— 这是省帧预算的关键约定）
   -------------------------------------------------------------------------- */

const PALS = {
  cat: { c1: "#F3B366", c2: "#FFEBCF", c3: "#DC8443", name: "尖耳猫", tag: "溜溜球" },
  dog: { c1: "#B98C63", c2: "#F2DFC4", c3: "#8A623E", name: "短尾犬", tag: "音波喇叭" },
  ham: { c1: "#E8C88F", c2: "#FFF3DC", c3: "#C9A468", name: "胖仓鼠", tag: "滚地雷" },
  rab: { c1: "#F4EFF6", c2: "#FFFFFF", c3: "#D6C9E0", name: "长耳兔", tag: "三连跳" },
  ox:  { c1: "#93A8C9", c2: "#DCE6F5", c3: "#6E85A8", name: "老实牛", tag: "冲撞" },
  fox: { c1: "#D98B6A", c2: "#F7DFCF", c3: "#A9613F", name: "影狐", tag: "影分身" },
};
const ORDER = ["cat", "dog", "ham", "rab", "ox", "fox"];

/* 体型表。这是六只剪影能分开的真正原因 ——
   只换耳朵/尾巴时，涂黑后全是同一个"雪人"（第一版就这么翻车的）。
   bw/bh 是相对总高的身体宽高比，hd 是头径比例。 */
const BUILD = {
  cat: { bw: 0.48, bh: 0.48, hd: 0.44 },   // 瘦高
  dog: { bw: 0.58, bh: 0.44, hd: 0.46 },   // 中等、方
  ham: { bw: 0.72, bh: 0.52, hd: 0.42 },   // 又宽又矮，最圆
  rab: { bw: 0.46, bh: 0.50, hd: 0.43 },   // 最瘦最高
  ox:  { bw: 0.66, bh: 0.45, hd: 0.47 },   // 最宽 + 头最大
  fox: { bw: 0.48, bh: 0.46, hd: 0.43 },   // 瘦
};

/**
 * 画一只立绘。
 * @param cx    水平中心
 * @param footY 脚底 y（站位基准，和 grove.html 的 p.y 同一个语义）
 * @param h     总高（含耳/角），建议 ≥ 90 才撑得住细节
 * @param expr  "normal" | "hungry" | "half" | "full"
 */
function drawHip(g, id, cx, footY, h, expr, opt) {
  const o = opt || {};
  const P = PALS[id];
  const E = expr || "normal";
  const lw = Math.max(2.2, h * 0.024);          // 描边随尺寸走，缩到 90 也不糊
  const B = BUILD[id] || BUILD.cat;
  const bodyH = h * B.bh;
  const bodyW = h * B.bw;
  const headD = h * B.hd;
  const headR = headD / 2;
  const bodyCY = footY - bodyH / 2;
  const headCY = footY - bodyH - headR * 0.70;
  const face = o.face === undefined ? 1 : o.face;   // 1 朝右，-1 朝左

  g.save();
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  const breathe = o.breathe === undefined ? 1 : o.breathe;
  const sc = o.scale === undefined ? 1 : o.scale;
  if (sc !== 1) {
    g.translate(cx, footY);
    g.scale(face * sc, sc);
    g.translate(-cx, -footY);
  } else if (face === -1) {
    g.translate(cx * 2, 0);
    g.scale(-1, 1);
  }

  /* ---- 1. 尾巴（必须在身体之前画，才在身后） ---- */
  if (id === "cat") {
    // 细长弯钩：从身体右下伸出，末端上卷
    g.beginPath();
    g.moveTo(cx + bodyW * 0.30, bodyCY + bodyH * 0.42);
    g.bezierCurveTo(
      cx + bodyW * 0.94, bodyCY + bodyH * 0.34,
      cx + bodyW * 1.08, bodyCY - bodyH * 0.28,
      cx + bodyW * 0.90, bodyCY - bodyH * 0.62
    );
    g.strokeStyle = T.ink;
    g.lineWidth = lw * 2.3;   // 粗到能读出"一条尾巴"，细线在这个尺寸下像根棍子
    g.lineCap = "round";
    g.stroke();
    g.strokeStyle = P.c3;
    g.lineWidth = lw * 1.45;
    g.stroke();
  } else if (id === "dog") {
    // 短粗上翘尾
    blob(g, cx + bodyW * 0.52, bodyCY - bodyH * 0.06, h * 0.075, h * 0.10, P.c3, lw, 0.5);
  } else if (id === "rab") {
    blob(g, cx + bodyW * 0.50, bodyCY + bodyH * 0.20, h * 0.075, h * 0.075, P.c2, lw);
  } else if (id === "ox") {
    // 甩在身侧的细尾 + 尾端毛球
    g.beginPath();
    g.moveTo(cx + bodyW * 0.44, bodyCY + bodyH * 0.10);
    g.quadraticCurveTo(cx + bodyW * 0.74, bodyCY + bodyH * 0.40, cx + bodyW * 0.66, bodyCY + bodyH * 0.56);
    g.strokeStyle = T.ink; g.lineWidth = lw * 0.9; g.lineCap = "round"; g.stroke();
    blob(g, cx + bodyW * 0.64, bodyCY + bodyH * 0.60, h * 0.055, h * 0.065, P.c3, lw * 0.9);
  } else if (id === "fox") {
    // 大蓬尾：三颗递进的椭圆，最宽处接近身高 1/3 —— 这是狐最独特的剪影
    const bx = cx + bodyW * 0.66, by = bodyCY - bodyH * 0.06;
    blob(g, bx + h * 0.07, by + h * 0.10, h * 0.215, h * 0.130, P.c3, lw, -0.42);
    blob(g, bx + h * 0.01, by - h * 0.06, h * 0.160, h * 0.105, P.c3, lw, -0.60);
    blob(g, bx + h * 0.05, by - h * 0.19, h * 0.080, h * 0.078, P.c2, lw * 0.9);
  }

  /* ---- 2. 身体 ---- */
  g.beginPath();
  g.ellipse(cx, bodyCY, bodyW / 2, bodyH / 2 * breathe, 0, 0, 6.2832);
  g.fillStyle = P.c1;
  g.fill();
  g.strokeStyle = T.ink;
  g.lineWidth = lw;
  g.stroke();

  // 肚皮浅色块：只做一块，不做渐变（渐变 = 写实）
  g.beginPath();
  g.ellipse(cx + face * bodyW * 0.04, bodyCY + bodyH * 0.10,
            bodyW * 0.30, bodyH * 0.30 * breathe, 0, 0, 6.2832);
  g.fillStyle = P.c2;
  g.fill();

  /* ---- 3. 脚 ---- */
  const footR = h * 0.055;
  blob(g, cx - bodyW * 0.22, footY - footR * 0.5, footR, footR * 0.8, P.c1, lw);
  blob(g, cx + bodyW * 0.22, footY - footR * 0.5, footR, footR * 0.8, P.c1, lw);

  /* ---- 4. 耳朵 / 角（在头之后画会盖住头，所以先画） ---- */
  const earY = headCY - headR * 0.55;
  if (id === "cat") {
    triEar(g, cx - headR * 0.62, earY + headR * 0.25, headR * 0.46, headR * 0.62, -0.30, P.c1, P.c2, lw);
    triEar(g, cx + headR * 0.62, earY + headR * 0.25, headR * 0.46, headR * 0.62,  0.30, P.c1, P.c2, lw);
  } else if (id === "dog") {
    // 垂耳：从头顶两侧垂下，盖住脸侧 —— 和猫的尖耳形成最强对比
    blob(g, cx - headR * 0.88, headCY + headR * 0.04, headR * 0.23, headR * 0.50, P.c3, lw, -0.26);
    blob(g, cx + headR * 0.88, headCY + headR * 0.04, headR * 0.23, headR * 0.50, P.c3, lw,  0.26);
  } else if (id === "ham") {
    blob(g, cx - headR * 0.68, earY + headR * 0.10, headR * 0.30, headR * 0.30, P.c1, lw);
    blob(g, cx + headR * 0.68, earY + headR * 0.10, headR * 0.30, headR * 0.30, P.c1, lw);
    blob(g, cx - headR * 0.68, earY + headR * 0.12, headR * 0.15, headR * 0.16, P.c3, 0);
    blob(g, cx + headR * 0.68, earY + headR * 0.12, headR * 0.15, headR * 0.16, P.c3, 0);
  } else if (id === "rab") {
    // 超长立耳：全队最高的剪影件，h 的 0.42
    const earBase = headCY - headR * 0.80;
    for (const sd of [-1, 1]) {
      blob(g, cx + sd * headR * 0.34, earBase - h * 0.155, headR * 0.30, h * 0.205, P.c1, lw, sd * 0.12);
      blob(g, cx + sd * headR * 0.34, earBase - h * 0.150, headR * 0.145, h * 0.140, "#F2C4D8", 0, sd * 0.12);
    }
  } else if (id === "ox") {
    // 弯角：向外上方弯，末端收尖（用两段椭圆近似，不追求真曲线）
    horn(g, cx - headR * 0.78, headCY - headR * 0.42, headR, -1, lw);
    horn(g, cx + headR * 0.78, headCY - headR * 0.42, headR,  1, lw);
    blob(g, cx - headR * 0.96, headCY + headR * 0.10, headR * 0.22, headR * 0.30, P.c3, lw, -0.2);
    blob(g, cx + headR * 0.96, headCY + headR * 0.10, headR * 0.22, headR * 0.30, P.c3, lw,  0.2);
  } else if (id === "fox") {
    triEar(g, cx - headR * 0.74, earY + headR * 0.12, headR * 0.58, headR * 0.82, -0.42, P.c1, P.c3, lw);
    triEar(g, cx + headR * 0.74, earY + headR * 0.12, headR * 0.58, headR * 0.82,  0.42, P.c1, P.c3, lw);
  }

  /* ---- 5. 头 ---- */
  g.beginPath();
  g.ellipse(cx, headCY, headR, headR * 0.94, 0, 0, 6.2832);
  g.fillStyle = P.c1;
  g.fill();
  g.strokeStyle = T.ink;
  g.lineWidth = lw;
  g.stroke();

  // 头顶一块浅色"面罩"，让脸和身体分开（兔/牛才有，其余靠五官）
  if (id === "ox") {
    g.beginPath();
    g.ellipse(cx + face * headR * 0.10, headCY + headR * 0.22, headR * 0.52, headR * 0.42, 0, 0, 6.2832);
    g.fillStyle = P.c2;
    g.fill();
  }

  /* ---- 6. 脸 ---- */
  const eyeDX = headR * 0.40;
  const eyeY = headCY + headR * 0.04;
  const eyeR = headR * 0.175;
  // 眼睛往朝向侧偏一点，整只就有"在看这边"的方向感
  const ex = face * headR * 0.08;

  if (E === "full") {
    // 眯眼 ^ ^ ：两条上凸弧，最省成本也最"满足"
    g.strokeStyle = T.ink;
    g.lineWidth = lw * 0.95;
    g.lineCap = "round";
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(cx + ex + s * eyeDX, eyeY + eyeR * 0.35, eyeR * 0.95, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
    }
  } else if (E === "hungry") {
    // 上眼睑压下来，只留下面一条缝 —— 比"画个瘦子"更能读出"没力气"
    for (const s of [-1, 1]) {
      const cx0 = cx + ex + s * eyeDX;
      g.beginPath();
      g.ellipse(cx0, eyeY + eyeR * 0.30, eyeR * 0.95, eyeR * 0.52, 0, 0, 6.2832);
      g.fillStyle = "#FFFFFF"; g.fill();
      g.strokeStyle = T.ink; g.lineWidth = lw * 0.8; g.stroke();
      g.beginPath();
      g.ellipse(cx0, eyeY + eyeR * 0.42, eyeR * 0.42, eyeR * 0.30, 0, 0, 6.2832);
      g.fillStyle = T.ink; g.fill();
      // 眼皮
      g.fillStyle = P.c1;
      g.beginPath();
      g.ellipse(cx0, eyeY - eyeR * 0.22, eyeR * 1.05, eyeR * 0.62, 0, 0, 6.2832);
      g.fill();
      g.strokeStyle = T.ink; g.lineWidth = lw * 0.7;
      g.beginPath();
      g.moveTo(cx0 - eyeR * 1.0, eyeY - eyeR * 0.18);
      g.quadraticCurveTo(cx0, eyeY - eyeR * 0.62, cx0 + eyeR * 1.0, eyeY - eyeR * 0.18);
      g.stroke();
    }
  } else if (E === "half") {
    // 星星眼：兴奋态的核心 —— 半饿最强，必须一眼看出"它来劲了"
    for (const s of [-1, 1]) {
      star(g, cx + ex + s * eyeDX, eyeY, eyeR * 1.5, eyeR * 0.62, T.gold, T.ink, lw * 0.55);
    }
  } else {
    for (const s of [-1, 1]) {
      const cx0 = cx + ex + s * eyeDX;
      blob(g, cx0, eyeY, eyeR * 0.92, eyeR * 1.06, T.ink, 0);
      g.fillStyle = "#FFFFFF";
      g.beginPath();
      g.arc(cx0 - eyeR * 0.26, eyeY - eyeR * 0.40, eyeR * 0.38, 0, 6.2832);
      g.fill();
      g.beginPath();
      g.arc(cx0 + eyeR * 0.34, eyeY + eyeR * 0.36, eyeR * 0.18, 0, 6.2832);
      g.fill();
    }
  }

  /* ---- 7. 腮红（饱/半饿才有，是"状态"不是"长相"） ---- */
  if (E === "full" || E === "half") {
    g.fillStyle = "rgba(255,120,120,.34)";
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + ex + s * eyeDX * 1.52, eyeY + eyeR * 1.70, eyeR * 0.72, eyeR * 0.44, 0, 0, 6.2832);
      g.fill();
    }
  }

  /* ---- 8. 鼻 + 嘴 ---- */
  const my = eyeY + eyeR * 1.62;
  if (id === "ox") {
    // 宽鼻圈 + 两个鼻孔
    g.beginPath();
    g.ellipse(cx + ex, my + headR * 0.10, headR * 0.27, headR * 0.18, 0, 0, 6.2832);
    g.fillStyle = P.c3; g.fill();
    g.strokeStyle = T.ink; g.lineWidth = lw * 0.8; g.stroke();
    g.fillStyle = T.ink;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + ex + s * headR * 0.12, my + headR * 0.10, headR * 0.045, headR * 0.06, 0, 0, 6.2832);
      g.fill();
    }
  } else {
    // 小三角鼻 + 一竖
    g.fillStyle = T.ink;
    g.beginPath();
    g.moveTo(cx + ex - eyeR * 0.34, my - eyeR * 0.18);
    g.lineTo(cx + ex + eyeR * 0.34, my - eyeR * 0.18);
    g.lineTo(cx + ex, my + eyeR * 0.30);
    g.closePath();
    g.fill();
    g.strokeStyle = T.ink;
    g.lineWidth = lw * 0.6;
    g.beginPath();
    g.moveTo(cx + ex, my + eyeR * 0.28);
    g.lineTo(cx + ex, my + eyeR * 0.52);
    g.stroke();
  }

  if (E === "hungry") {
    // 波浪嘴 + 一滴汗：饿的时候整张脸要垮下来
    g.strokeStyle = T.ink;
    g.lineWidth = lw * 0.75;
    g.lineCap = "round";
    g.beginPath();
    const wm = my + eyeR * 1.05;
    g.moveTo(cx + ex - eyeR * 0.85, wm);
    g.quadraticCurveTo(cx + ex - eyeR * 0.42, wm - eyeR * 0.42, cx + ex, wm);
    g.quadraticCurveTo(cx + ex + eyeR * 0.42, wm + eyeR * 0.42, cx + ex + eyeR * 0.85, wm);
    g.stroke();
    // 汗滴
    const sx = cx + face * headR * 0.86, sy = headCY - headR * 0.30;
    g.beginPath();
    g.moveTo(sx, sy - eyeR * 0.9);
    g.quadraticCurveTo(sx + eyeR * 0.62, sy, sx, sy + eyeR * 0.55);
    g.quadraticCurveTo(sx - eyeR * 0.62, sy, sx, sy - eyeR * 0.9);
    g.fillStyle = "#8FD3F0"; g.fill();
    g.strokeStyle = T.ink; g.lineWidth = lw * 0.6; g.stroke();
  } else if (E === "full") {
    // 满足成一条向上弯的线
    g.strokeStyle = T.ink;
    g.lineWidth = lw * 0.75;
    g.lineCap = "round";
    g.beginPath();
    g.arc(cx + ex, my + eyeR * 0.55, eyeR * 0.90, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
  } else if (E === "half") {
    // 张嘴笑：一个半圆 + 舌头
    const mr = eyeR * 0.95;
    g.beginPath();
    g.arc(cx + ex, my + eyeR * 0.62, mr, 0, Math.PI);
    g.fillStyle = "#7C2E39"; g.fill();
    g.strokeStyle = T.ink; g.lineWidth = lw * 0.7; g.stroke();
    g.beginPath();
    g.ellipse(cx + ex, my + eyeR * 1.08, mr * 0.52, mr * 0.34, 0, 0, 6.2832);
    g.fillStyle = "#FF8E8E"; g.fill();
  } else {
    // 常态：两侧小弧，像 "ω"
    g.strokeStyle = T.ink;
    g.lineWidth = lw * 0.7;
    g.lineCap = "round";
    const wm = my + eyeR * 0.72;
    g.beginPath();
    g.arc(cx + ex - eyeR * 0.36, wm, eyeR * 0.38, 0, Math.PI * 0.95);
    g.stroke();
    g.beginPath();
    g.arc(cx + ex + eyeR * 0.36, wm, eyeR * 0.38, 0, Math.PI * 0.95);
    g.stroke();
  }

  /* ---- 9. 饿的瘪肚纹（只在饿/半饿画） ---- */
  if (E === "hungry") {
    g.strokeStyle = "rgba(58,43,68,.32)";
    g.lineWidth = lw * 0.55;
    for (let i = 0; i < 2; i++) {
      const yy = bodyCY + bodyH * (0.02 + i * 0.16);
      g.beginPath();
      g.moveTo(cx - bodyW * 0.20, yy);
      g.quadraticCurveTo(cx, yy + bodyH * 0.07, cx + bodyW * 0.20, yy);
      g.stroke();
    }
  }

  g.restore();

  /* ---- 10. 半饿金环（画在 restore 之后：不要被镜像/缩放带跑） ---- */
  if (E === "half") {
    const ry = footY - h * 0.04;
    g.save();
    g.globalAlpha = 0.30;
    g.fillStyle = T.gold;
    g.beginPath();
    g.ellipse(cx, ry, h * 0.34, h * 0.075, 0, 0, 6.2832);
    g.fill();
    g.restore();
    g.strokeStyle = T.gold;
    g.lineWidth = Math.max(2.4, h * 0.017);
    g.beginPath();
    g.ellipse(cx, ry, h * 0.34, h * 0.075, 0, 0, 6.2832);
    g.stroke();
  }
}

/** 三角耳：底边在 (x,y)，朝上，tip 高度 hgt，外倾 tilt */
function triEar(g, x, y, w, hgt, tilt, fill, inner, lw) {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.beginPath();
  g.moveTo(-w / 2, 0);
  g.quadraticCurveTo(-w * 0.30, -hgt * 0.92, 0, -hgt);
  g.quadraticCurveTo(w * 0.30, -hgt * 0.92, w / 2, 0);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = T.ink;
  g.lineWidth = lw;
  g.lineJoin = "round";
  g.stroke();
  if (inner) {
    g.beginPath();
    g.moveTo(-w * 0.22, -hgt * 0.10);
    g.quadraticCurveTo(-w * 0.14, -hgt * 0.62, 0, -hgt * 0.72);
    g.quadraticCurveTo(w * 0.14, -hgt * 0.62, w * 0.22, -hgt * 0.10);
    g.closePath();
    g.fillStyle = inner;
    g.fill();
  }
  g.restore();
}

/** 牛角：从根部往外上方弯，两段椭圆近似 */
function horn(g, x, y, headR, dir, lw) {
  // 实心月牙，外缘向内收 —— 粗线画出来的永远像"天线"，不像角
  g.beginPath();
  g.moveTo(x - dir * headR * 0.04, y + headR * 0.10);
  g.quadraticCurveTo(x + dir * headR * 0.34, y - headR * 0.06, x + dir * headR * 0.60, y - headR * 0.56);
  g.quadraticCurveTo(x + dir * headR * 0.34, y + headR * 0.16, x + dir * headR * 0.10, y + headR * 0.26);
  g.closePath();
  g.fillStyle = "#F7F0DE";
  g.fill();
  g.strokeStyle = T.ink;
  g.lineWidth = lw;
  g.lineJoin = "round";
  g.stroke();
}

/** 四角星：兴奋/半饿的眼睛 */
function star(g, cx, cy, r, inner, fill, line, lw) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 6.2832 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : inner;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (line) { g.strokeStyle = line; g.lineWidth = lw; g.lineJoin = "round"; g.stroke(); }
}

/* ============================================================================
   输出
   ========================================================================== */

const ONLY = process.env.ONLY || "";
const save = (cv, name) => {
  const f = path.join(OUT, name);
  fs.writeFileSync(f, cv.toBuffer("image/png"));
  console.log("  ✓ " + name);
};

/* --- 立绘谱：六只大图 + 四表情 + 剪影检验 --- */

/** 把一只立绘压成纯色剪影：读像素、非透明处统一染色。
    这是"剪影可辨"铁律唯一能自动验的办法 —— 肉眼看立绘永远觉得"挺不一样"，
    涂黑一排才知道根本分不开。 */
function silhouette(g, id, cx, footY, h) {
  const bw = Math.ceil(h * 1.9), bh = Math.ceil(h * 1.6);
  const ox = Math.round(cx - bw / 2), oy = Math.round(footY - h * 1.22);
  const tmp = createCanvas(bw, bh);
  const tg = tmp.getContext("2d");
  tg.translate(-ox, -oy);
  drawHip(tg, id, cx, footY, h, "normal");
  const d = tg.getImageData(0, 0, bw, bh);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 10) { px[i] = 58; px[i + 1] = 43; px[i + 2] = 68; px[i + 3] = 255; }
  }
  tg.putImageData(d, 0, 0);
  g.drawImage(tmp, ox, oy);
}

function drawSheet() {
  const SH = 820;
  const cv = createCanvas(W, SH);
  const g = cv.getContext("2d");

  g.fillStyle = "#FBF3DF";
  g.fillRect(0, 0, W, SH);

  // 纸纹：极淡斜线。仍然是无渐变的平涂，只是让米色不至于死板
  g.save();
  g.strokeStyle = "rgba(168,140,96,.09)";
  g.lineWidth = 1;
  for (let i = -SH; i < W; i += 26) {
    g.beginPath(); g.moveTo(i, SH); g.lineTo(i + SH, 0); g.stroke();
  }
  g.restore();

  text(g, "宠物立绘规范", 56, 46, 28, T.ink, true, "left");
  text(g, "头身比 1 : 1.1　·　头径 = 总高 0.44　·　描边 = 总高 0.024　·　四态只换脸、不换骨架",
       58, 76, 13, "rgba(58,43,68,.60)", false, "left");
  text(g, "吧唧军团 · Munch Legion　立绘 v2", W - 56, 46, 13, "rgba(58,43,68,.45)", false, "right");

  /* ---------- 第一段：六只大图 ---------- */
  const HY = 342, HH = 196;
  ORDER.forEach((id, i) => {
    const x = 148 + i * 197;
    const P = PALS[id];
    drawHip(g, id, x, HY, HH, "normal");

    // 主色点 + 名字
    g.beginPath(); g.arc(x - 30, HY + 26, 6.5, 0, 6.2832);
    g.fillStyle = P.c1; g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 2.2; g.stroke();

    text(g, P.name, x + 4, HY + 27, 17, T.ink, true);
    text(g, P.tag, x + 4, HY + 50, 12, "rgba(58,43,68,.55)", false);
  });

  g.strokeStyle = "rgba(58,43,68,.16)";
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(56, 412); g.lineTo(W - 56, 412); g.stroke();

  /* ---------- 第二段：四态（拿猫示范） ---------- */
  text(g, "四套表情", 56, 440, 15, T.ink, true, "left");
  text(g, "状态不画新帧，只换眼/嘴/腮红 —— 美术只交一套身体，程序按 expr 切脸",
       56, 464, 12, "rgba(58,43,68,.55)", false, "left");

  const cols = ["常态", "饿（全饿：收走冲刺）", "半饿（最强：球更黏）", "饱（满饱：糊得慢）"];
  const exprs = ["normal", "hungry", "half", "full"];
  const eX = [660, 828, 996, 1164];
  exprs.forEach((e, i) => {
    drawHip(g, "cat", eX[i], 584, 122, e);
    text(g, cols[i], eX[i], 612, 11, "rgba(58,43,68,.66)", false);
  });

  g.strokeStyle = "rgba(58,43,68,.16)";
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(56, 636); g.lineTo(W - 56, 636); g.stroke();

  /* ---------- 第三段：剪影检验 ---------- */
  text(g, "剪影检验", 56, 664, 15, T.ink, true, "left");
  text(g, "涂黑之后还认得出谁是谁，才算过了「剪影可辨」这条铁律",
       56, 688, 12, "rgba(58,43,68,.55)", false, "left");

  ORDER.forEach((id, i) => {
    silhouette(g, id, 470 + i * 136, 792, 74);
  });

  save(cv, "concept-0-立绘谱.png");
}

/* ============================================================================
   一、主界面 —— 家门口的黄昏
   ----------------------------------------------------------------------------
   构图定死三件事，别在实现时挪：
     1. 小屋占左 1/4（视觉锚点），六只居中偏右，按钮压底 —— 视线从"家"→"谁"→"走"
     2. 前排一只有金环 + 气泡，后排五只在后面：一张图同时讲清"六只 / 性格 / 出发"
     3. 天空是唯一允许用渐变的地方（大气必须有纵深），其余全部平涂
   ========================================================================== */

function cloud(g, x, y, s, alpha) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = "#FDE7D6";
  // 三团高低错开的圆 + 一条很矮的底：矩形一厚，云就变方块
  for (const c of [[-1.02, 0.10, 0.56], [-0.22, -0.40, 0.80], [0.72, -0.06, 0.60]]) {
    g.beginPath(); g.arc(x + c[0] * s, y + c[1] * s, c[2] * s, 0, 6.2832); g.fill();
  }
  rr(g, x - s * 1.46, y + s * 0.16, s * 2.92, s * 0.38, s * 0.19);
  g.fill();
  g.restore();
}

/** 起伏山脊。用正弦叠余弦出两个不规则频率，比随机数稳（每次渲染一样） */
function ridge(g, baseY, amp, color, alpha, seed) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, baseY + 40);
  for (let x = 0; x <= W; x += 16) {
    const t = x / W;
    const hh = amp * (0.55 + 0.45 * Math.sin(t * 7.1 + seed) * Math.cos(t * 3.3 + seed * 1.7));
    g.lineTo(x, baseY - hh);
  }
  g.lineTo(W, baseY + 40);
  g.closePath();
  g.fill();
  g.restore();
}

function drawHut(g, x, baseY) {
  const w = 236, wallH = 134, roofH = 112;

  // 屋内暖光：先铺一层暗底，再打光 —— 只铺黄会像贴了张黄纸
  // 墙
  g.fillStyle = T.wood;
  rr(g, x, baseY - wallH, w, wallH, 8);
  g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 4.5; g.stroke();

  // 木板横纹
  g.strokeStyle = "rgba(58,43,68,.22)";
  g.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const yy = baseY - wallH + (wallH / 4) * i;
    g.beginPath(); g.moveTo(x + 4, yy); g.lineTo(x + w - 4, yy); g.stroke();
  }

  // 屋顶：不对称斜顶（右高左低），比对称三角更像"自己搭的房子"
  g.beginPath();
  g.moveTo(x - 26, baseY - wallH + 8);
  g.lineTo(x + w + 20, baseY - wallH + 8);
  g.lineTo(x + w * 0.70, baseY - wallH - roofH);
  g.lineTo(x + w * 0.20, baseY - wallH - roofH * 0.80);
  g.closePath();
  g.fillStyle = "#6B4B36";
  g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 5; g.lineJoin = "round"; g.stroke();

  // 屋顶压条
  g.fillStyle = "#8A6244";
  g.beginPath();
  g.moveTo(x - 26, baseY - wallH + 8);
  g.lineTo(x + w + 20, baseY - wallH + 8);
  g.lineTo(x + w + 16, baseY - wallH - 4);
  g.lineTo(x - 22, baseY - wallH - 4);
  g.closePath();
  g.fill();

  // 烟囱
  g.fillStyle = "#5C4030";
  rr(g, x + w * 0.62, baseY - wallH - roofH * 0.86, 30, 58, 4);
  g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 4; g.stroke();

  // 烟：三颗上升的圆，越上越大越淡（静止画面也要看得出在飘）
  for (let i = 0; i < 3; i++) {
    g.globalAlpha = 0.34 - i * 0.09;
    g.fillStyle = "#F2E6DC";
    g.beginPath();
    g.arc(x + w * 0.68 + i * 9, baseY - wallH - roofH * 0.86 - 18 - i * 26, 13 + i * 5, 0, 6.2832);
    g.fill();
  }
  g.globalAlpha = 1;

  // 窗：暖黄 + 十字框
  for (const wx of [x + 30, x + w - 88]) {
    g.fillStyle = "#2A1C14";
    rr(g, wx - 5, baseY - wallH + 32, 68, 62, 7); g.fill();
    g.fillStyle = "#FFD98A";
    rr(g, wx, baseY - wallH + 37, 58, 52, 5); g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 3.5;
    rr(g, wx, baseY - wallH + 37, 58, 52, 5); g.stroke();
    g.beginPath();
    g.moveTo(wx + 29, baseY - wallH + 37); g.lineTo(wx + 29, baseY - wallH + 89);
    g.moveTo(wx, baseY - wallH + 63); g.lineTo(wx + 58, baseY - wallH + 63);
    g.stroke();
  }

  // 门：暗底 + 门帘 + 门牌
  const dx = x + w * 0.52, dw = 66;
  g.fillStyle = "#241608";
  rr(g, dx, baseY - 84, dw, 84, 6); g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 4; g.stroke();

  // 门帘（波浪底边）
  g.fillStyle = "#6E4028";
  g.beginPath();
  g.moveTo(dx + 3, baseY - 80);
  g.lineTo(dx + dw - 3, baseY - 80);
  g.lineTo(dx + dw - 3, baseY - 34);
  for (let i = 4; i >= 0; i--) {
    const t = i / 4;
    g.quadraticCurveTo(dx + 3 + (dw - 6) * (t + 0.1), baseY - 26,
                       dx + 3 + (dw - 6) * t, baseY - 34);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 3.5; g.stroke();

  // 门牌
  // 布纹：两条竖线，让门帘不是一块死色
  g.strokeStyle = "rgba(255,220,180,.20)";
  g.lineWidth = 2;
  for (const t of [0.34, 0.66]) {
    g.beginPath();
    g.moveTo(dx + 3 + (dw - 6) * t, baseY - 78);
    g.lineTo(dx + 3 + (dw - 6) * t, baseY - 34);
    g.stroke();
  }

  g.fillStyle = T.paper2;
  rr(g, dx + dw / 2 - 32, baseY - 132, 64, 26, 8); g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 3; g.stroke();
  text(g, "爪 队", dx + dw / 2, baseY - 118, 14, T.ink, true);
}

function drawMain() {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  /* ---------- 天空（全图唯一允许渐变的地方） ---------- */
  const grd = g.createLinearGradient(0, 0, 0, 490);
  grd.addColorStop(0.00, "#3A3560");
  grd.addColorStop(0.28, "#6E5A94");
  grd.addColorStop(0.58, "#B87F9A");
  grd.addColorStop(0.82, "#EFA982");
  grd.addColorStop(1.00, "#FFD7A0");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, 490);

  // 刚出来的星
  for (let i = 0; i < 44; i++) {
    const x = (i * 137.5 + 23) % W;
    const y = (i * 47.3) % 176 + 8;
    g.globalAlpha = 0.22 + ((i * 37) % 55) / 100;
    g.fillStyle = "#FFF6DC";
    g.beginPath(); g.arc(x, y, i % 3 === 0 ? 1.7 : 1.0, 0, 6.2832); g.fill();
  }
  g.globalAlpha = 1;

  // 太阳压在地平线上
  const sx = 1024, sy = 462;
  for (const c of [[132, 0.09], [92, 0.15]]) {
    g.fillStyle = "rgba(255,214,140," + c[1] + ")";
    g.beginPath(); g.arc(sx, sy, c[0], 0, 6.2832); g.fill();
  }
  g.fillStyle = "#FFF4CE";
  g.beginPath(); g.arc(sx, sy, 58, 0, 6.2832); g.fill();
  g.strokeStyle = "#EDA85E"; g.lineWidth = 4;
  g.beginPath(); g.arc(sx, sy, 58, 0, 6.2832); g.stroke();

  cloud(g, 250, 208, 30, 0.30);
  cloud(g, 700, 150, 38, 0.22);
  cloud(g, 1150, 240, 26, 0.26);

  /* ---------- 远山 ---------- */
  ridge(g, 470, 96, "#6F5F97", 0.55, 0.4);
  ridge(g, 480, 58, "#4C4A7A", 0.80, 2.1);

  /* ---------- 中景树 ---------- */
  for (const t of [[60, 470, 46], [180, 468, 34], [360, 470, 40], [1220, 468, 44]]) {
    const tx = t[0], ty = t[1], r = t[2];
    g.fillStyle = "#3C3F63";
    rr(g, tx - 6, ty - r * 0.5, 12, r * 0.55, 3); g.fill();
    for (const c of [[0, -0.9, 0.72], [-0.62, -0.42, 0.56], [0.62, -0.42, 0.56]]) {
      g.beginPath(); g.arc(tx + c[0] * r, ty + c[1] * r, c[2] * r, 0, 6.2832); g.fill();
    }
  }

  /* ---------- 草地：三层压出纵深 ---------- */
  g.fillStyle = T.grass;
  g.fillRect(0, 486, W, H - 486);
  // 远→近逐层压暗。没有渐变、没有 AO，全靠三块纯色分层
  g.fillStyle = "#549457";
  g.fillRect(0, 566, W, H - 566);
  g.fillStyle = "#488350";
  g.fillRect(0, 656, W, H - 656);
  g.fillStyle = T.grassDk;
  g.fillRect(0, 486, W, 9);

  /* ---------- 门口的小路 ---------- */
  // 这是主界面唯一的"叙事线"：六只站的地方 → 通向右边 → 通向外面。
  // 没有它，画面就是"六个立绘摆在绿板上"。
  g.beginPath();
  g.moveTo(268, 506);
  g.bezierCurveTo(520, 514, 880, 556, 1280, 588);
  g.lineTo(1280, 664);
  g.bezierCurveTo(880, 630, 520, 588, 268, 552);
  g.closePath();
  g.fillStyle = "#B99A6E";
  g.fill();
  g.strokeStyle = "rgba(58,43,68,.20)";
  g.lineWidth = 2.5;
  g.stroke();
  // 路面碎石：沿路铺，位置确定性
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const px = 320 + t * 940;
    const py = 528 + t * 92 + Math.sin(i * 2.3) * 22;
    g.fillStyle = "rgba(138,110,74,.42)";
    g.beginPath();
    g.ellipse(px, py, 3 + (i % 3) * 1.6, 2 + (i % 2), i * 0.4, 0, 6.2832);
    g.fill();
  }
  // 亮草线：一条就够，多了变条纹
  g.strokeStyle = "rgba(140,200,120,.30)";
  g.lineWidth = 3;
  g.beginPath();
  for (let x = 0; x <= W; x += 8) {
    const y = 540 + Math.sin(x * 0.012) * 5;
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();

  // 草丛：确定性位置，缩略图下也散得开
  for (let i = 0; i < 16; i++) {
    const x = (i * 191.7 + 40) % W;
    const y = 500 + ((i * 71) % 200);
    const s = 4 + (i % 3) * 1.4;
    g.strokeStyle = "rgba(46,96,58,.34)";
    g.lineWidth = 2.2;
    for (const d of [-1, 0, 1]) {
      g.beginPath();
      g.moveTo(x + d * 3, y);
      g.quadraticCurveTo(x + d * 6, y - s * 0.7, x + d * 5 + 2, y - s);
      g.stroke();
    }
  }

  /* ---------- 前景草丛 ---------- */
  // 贴底边的一排深色草。作用不是装饰，是把视线挡回画面中央
  for (let i = 0; i < 9; i++) {
    const x = i * 152 - 20;
    const hgt = 18 + (i % 3) * 9;
    g.fillStyle = "#2F6238";
    g.beginPath();
    g.moveTo(x - 60, H);
    g.quadraticCurveTo(x - 30, H - hgt * 1.2, x, H - hgt * 0.4);
    g.quadraticCurveTo(x + 30, H - hgt * 1.5, x + 60, H);
    g.closePath();
    g.fill();
  }

  /* ---------- 小屋 ---------- */
  drawHut(g, 78, 508);

  /* ---------- 果子堆 ---------- */
  {
    const bx = 372, by = 512;
    g.fillStyle = "rgba(28,36,26,.26)";
    g.beginPath(); g.ellipse(bx, by, 44, 12, 0, 0, 6.2832); g.fill();
    const pts = [[-26, -10], [-6, -16], [16, -11], [30, -6], [-16, -24], [8, -27]];
    for (const p of pts) {
      g.beginPath(); g.arc(bx + p[0], by + p[1], 9, 0, 6.2832);
      g.fillStyle = "#E4694C"; g.fill();
      g.strokeStyle = "#8E3A2A"; g.lineWidth = 2.2; g.stroke();
      g.fillStyle = "rgba(255,240,210,.85)";
      g.beginPath(); g.arc(bx + p[0] - 3, by + p[1] - 3.4, 2.4, 0, 6.2832); g.fill();
      g.fillStyle = "#6FAE5A";
      g.beginPath(); g.ellipse(bx + p[0] + 4.4, by + p[1] - 7.6, 3.6, 2, -0.6, 0, 6.2832); g.fill();
    }
  }

  /* ---------- 六只 ---------- */
  const back = ["dog", "ham", "rab", "ox", "fox"];
  back.forEach((id, i) => {
    const x = 604 + i * 118, fy = 512;
    g.fillStyle = "rgba(28,36,26,.20)";
    g.beginPath(); g.ellipse(x, fy + 2, 40, 9, 0, 0, 6.2832); g.fill();
    drawHip(g, id, x, fy, 116, "normal");
  });

  // 前排：被选中的那只。金环 + 气泡 + 一点点放大
  {
    const x = 452, fy = 574;
    g.fillStyle = "rgba(28,36,26,.24)";
    g.beginPath(); g.ellipse(x, fy + 3, 58, 13, 0, 0, 6.2832); g.fill();

    // 选中环：双圈金环 + 四颗小星
    g.strokeStyle = T.gold; g.lineWidth = 5;
    g.beginPath(); g.ellipse(x, fy + 2, 62, 15, 0, 0, 6.2832); g.stroke();
    g.strokeStyle = "rgba(255,211,78,.45)"; g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, fy + 2, 72, 19, 0, 0, 6.2832); g.stroke();
    for (const a of [-0.9, 0.2, 1.3, 2.5]) {
      star(g, x + Math.cos(a) * 74, fy + 2 + Math.sin(a) * 19, 7, 3, T.gold, T.ink, 1.6);
    }

    drawHip(g, "cat", x, fy, 158, "normal");

    // 气泡
    const bx = x, by = 356, bw = 168, bh = 44;
    g.fillStyle = "rgba(58,43,68,.22)";
    rr(g, bx - bw / 2, by - bh / 2 + 4, bw, bh, 20); g.fill();
    g.fillStyle = T.paper;
    rr(g, bx - bw / 2, by - bh / 2, bw, bh, 20); g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 3.5; g.stroke();
    // 尾巴
    g.beginPath();
    g.moveTo(bx - 10, by + bh / 2 - 2);
    g.lineTo(bx + 12, by + bh / 2 - 2);
    g.lineTo(bx + 2, by + bh / 2 + 16);
    g.closePath();
    g.fillStyle = T.paper; g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 3.5; g.lineJoin = "round"; g.stroke();
    // 盖掉尾巴和气泡之间的描边线
    g.fillStyle = T.paper;
    g.fillRect(bx - 8, by + bh / 2 - 4, 18, 5);

    text(g, "我先去探路。", bx, by - 1, 17, T.ink, true);
  }

  /* ---------- LOGO ---------- */
  {
    const lx = 62, ly = 62;
    // 标题后的暖色底斑：让字从渐变天上跳出来（不用阴影面板，那会像弹窗）
    g.fillStyle = "rgba(255,246,228,.10)";
    g.beginPath(); g.ellipse(lx + 116, ly, 158, 50, 0, 0, 6.2832); g.fill();

    textO(g, "吧唧军团", lx, ly, 46, "#FFF6E4", T.ink, 10, true, "left");
    text(g, "M U N C H   L E G I O N", lx + 4, ly + 40, 12, "rgba(255,240,214,.80)", true, "left");
  }

  /* ---------- 果子牌 ---------- */
  {
    const x = 1062, y = 42, w = 158, h = 64;
    card(g, x, y, w, h, 18, { fill: "#8A6244", sa: 0.26, dy: 6, lineColor: T.ink, lw: 4 });
    // 内嵌浅色槽，读起来像"木牌上钉了块牌"
    g.fillStyle = T.paper2;
    rr(g, x + 10, y + 10, w - 20, h - 20, 12); g.fill();
    g.strokeStyle = "rgba(58,43,68,.35)"; g.lineWidth = 2; g.stroke();

    // 果子图标
    g.beginPath(); g.arc(x + 40, y + h / 2, 13, 0, 6.2832);
    g.fillStyle = "#E4694C"; g.fill();
    g.strokeStyle = "#8E3A2A"; g.lineWidth = 3; g.stroke();
    g.fillStyle = "rgba(255,240,210,.9)";
    g.beginPath(); g.arc(x + 35, y + h / 2 - 5, 3.6, 0, 6.2832); g.fill();
    g.fillStyle = "#6FAE5A";
    g.beginPath(); g.ellipse(x + 47, y + h / 2 - 12, 6, 3.4, -0.6, 0, 6.2832); g.fill();

    text(g, "×", x + 68, y + h / 2 + 1, 17, "rgba(58,43,68,.50)", true);
    text(g, "128", x + 104, y + h / 2 + 1, 27, T.ink, true);
    text(g, "存着的果子", x + w / 2, y + h + 20, 11, "rgba(255,246,228,.66)", false);
  }

  /* ---------- 底部按钮 ---------- */
  btn(g, 686, 626, 206, 60, "出发", { sub: "带尖耳猫 · 第 4 关", size: 23 });
  btn(g, 912, 634, 128, 52, "食盆", { face: T.paper, dark: T.paperSh, text: T.ink, size: 18, depth: 7 });
  btn(g, 1056, 634, 128, 52, "背包", { face: T.paper, dark: T.paperSh, text: T.ink, size: 18, depth: 7 });

  /* ---------- 角落说明 ---------- */
  text(g, "WASD 移动　·　J 糊球　·　K 撞　·　ESC 换人", 62, 690, 12,
       "rgba(255,246,228,.62)", false, "left");

  save(cv, "concept-1-主界面.png");
}

/* ============================================================================
   二、战斗内 UI
   ----------------------------------------------------------------------------
   现行 HUD 的问题不是"不好看"，是**信息平铺**：头像/名字/血量挤在一个深色块里，
   字号 10-11px，谁都不比谁重要。正式版按三级分层重排：
     一级（必须一直看）  血量、肚子、目标进度  → 有描边、有实体卡片
     二级（扫一眼）      关卡进度、道具槽      → 半透明或小卡
     三级（几乎不看）    操作提示、快捷键      → 无底、低对比
   ========================================================================== */

function plat(g, x, y, w, h) {
  g.fillStyle = "#8B5E3C";
  rr(g, x, y, w, h, 9); g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 4; rr(g, x, y, w, h, 9); g.stroke();
  g.fillStyle = "#AA7550";
  rr(g, x + 5, y + 4, w - 10, h * 0.30, 5); g.fill();
  g.fillStyle = "rgba(58,43,68,.20)";
  rr(g, x + 5, y + h - 8, w - 10, 5, 3); g.fill();
}

/** 心。血量不能是方块条 —— 方块读"能量"，心读"它会死" */
function heart(g, x, y, r, fill) {
  g.beginPath();
  g.moveTo(x, y + r * 0.88);
  g.bezierCurveTo(x - r * 1.55, y - r * 0.36, x - r * 0.64, y - r * 1.20, x, y - r * 0.34);
  g.bezierCurveTo(x + r * 0.64, y - r * 1.20, x + r * 1.55, y - r * 0.36, x, y + r * 0.88);
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 2.6; g.lineJoin = "round"; g.stroke();
}

function bug(g, x, y, s) {
  // 腿
  g.strokeStyle = T.ink; g.lineWidth = s * 0.10; g.lineCap = "round";
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const yy = y - s * 0.52 + i * s * 0.20;
      g.beginPath();
      g.moveTo(x + sd * s * 0.26, yy);
      g.lineTo(x + sd * s * 0.60, yy + s * 0.15);
      g.stroke();
    }
  }
  // 身体
  g.beginPath(); g.ellipse(x, y - s * 0.40, s * 0.46, s * 0.42, 0, 0, 6.2832);
  g.fillStyle = "#88B04B"; g.fill();
  g.strokeStyle = T.ink; g.lineWidth = s * 0.11; g.stroke();
  // 背甲中缝
  g.strokeStyle = "rgba(46,74,30,.45)"; g.lineWidth = s * 0.07;
  g.beginPath(); g.moveTo(x, y - s * 0.78); g.lineTo(x, y - s * 0.06); g.stroke();
  // 触角
  g.strokeStyle = T.ink; g.lineWidth = s * 0.08;
  for (const sd of [-1, 1]) {
    g.beginPath();
    g.moveTo(x + sd * s * 0.16, y - s * 0.72);
    g.quadraticCurveTo(x + sd * s * 0.30, y - s * 0.98, x + sd * s * 0.38, y - s * 1.02);
    g.stroke();
    g.beginPath(); g.arc(x + sd * s * 0.38, y - s * 1.02, s * 0.075, 0, 6.2832);
    g.fillStyle = "#FFD34E"; g.fill();
  }
  // 眼
  for (const sd of [-1, 1]) {
    g.beginPath(); g.arc(x + sd * s * 0.17, y - s * 0.55, s * 0.10, 0, 6.2832);
    g.fillStyle = T.ink; g.fill();
    g.beginPath(); g.arc(x + sd * s * 0.17 - s * 0.03, y - s * 0.58, s * 0.035, 0, 6.2832);
    g.fillStyle = "#FFF"; g.fill();
  }
}

function snowball(g, x, y, r) {
  g.beginPath(); g.arc(x, y, r, 0, 6.2832);
  g.fillStyle = "#FFFDF4"; g.fill();
  g.strokeStyle = T.ink; g.lineWidth = Math.max(3, r * 0.16); g.stroke();
  g.fillStyle = "rgba(198,220,232,.70)";
  for (const p of [[-0.34, -0.30, 0.24], [0.30, 0.18, 0.19], [0.02, 0.46, 0.14]]) {
    g.beginPath(); g.arc(x + p[0] * r, y + p[1] * r, p[2] * r, 0, 6.2832); g.fill();
  }
  // 高光
  g.fillStyle = "rgba(255,255,255,.9)";
  g.beginPath(); g.arc(x - r * 0.30, y - r * 0.40, r * 0.16, 0, 6.2832); g.fill();
}

/** 战斗背景（结算图也要复用它，所以单独抽出来） */
function battleBg(g, dim) {
  const grd = g.createLinearGradient(0, 0, 0, 520);
  // 顶部压到 #86CEEB：原来 #B9E5F7 太接近白云的白色，云整片看不见
  grd.addColorStop(0, "#86CEEB");
  grd.addColorStop(0.55, "#C6EAF9");
  grd.addColorStop(1, "#F4FBFF");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, 520);

  cloud(g, 180, 92, 26, 0.85);
  cloud(g, 760, 64, 32, 0.70);
  cloud(g, 1120, 112, 22, 0.60);

  ridge(g, 470, 78, "#A9D8A2", 0.85, 1.2);
  ridge(g, 492, 46, "#8ACB85", 0.95, 3.4);

  g.fillStyle = "#6DB867";
  g.fillRect(0, 512, W, H - 512);
  g.fillStyle = "#7FC973";
  g.fillRect(0, 512, W, 10);
  g.fillStyle = "#5EA55C";
  g.fillRect(0, 662, W, H - 662);

  if (dim) {
    g.fillStyle = "rgba(28,22,44," + dim + ")";
    g.fillRect(0, 0, W, H);
  }
}

function drawBattle() {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  battleBg(g, 0);

  /* ---------- 地面点缀（画面中段太空，会读成"没做完"） ---------- */
  for (const c of [[92, 516, 1], [352, 520, 0.8], [700, 516, 1.1], [1010, 520, 0.9], [1210, 514, 0.7]]) {
    const x = c[0], y = c[1], k = c[2];
    g.strokeStyle = "rgba(52,110,60,.55)";
    g.lineWidth = 2.4 * k;
    for (const d of [-1.6, -0.6, 0.5, 1.5]) {
      g.beginPath();
      g.moveTo(x + d * 4 * k, y);
      g.quadraticCurveTo(x + d * 7 * k, y - 9 * k, x + d * 6 * k + 3, y - 16 * k);
      g.stroke();
    }
  }
  for (const st of [[540, 524, 13], [880, 528, 9]]) {
    g.beginPath(); g.ellipse(st[0], st[1], st[2], st[2] * 0.72, 0, 0, 6.2832);
    g.fillStyle = "#9BA6AE"; g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 3; g.stroke();
    g.fillStyle = "rgba(255,255,255,.45)";
    g.beginPath(); g.ellipse(st[0] - st[2] * 0.28, st[1] - st[2] * 0.28, st[2] * 0.34, st[2] * 0.22, -0.4, 0, 6.2832); g.fill();
  }

  /* ---------- 平台 ---------- */
  plat(g, 38, 336, 300, 30);
  plat(g, 438, 244, 236, 30);
  plat(g, 806, 344, 344, 30);

  /* ---------- 敌人 ---------- */
  bug(g, 168, 336, 46);
  bug(g, 268, 336, 46);
  bug(g, 540, 244, 42);

  /* ---------- 球 ---------- */
  snowball(g, 470, 494, 27);
  // 球的运动轨迹：虚线，让"滚过去"这件事读得出来
  g.save();
  g.setLineDash([7, 9]);
  g.strokeStyle = "rgba(255,255,255,.85)";
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(496, 496); g.lineTo(742, 496); g.stroke();
  g.restore();

  /* ---------- 角色 ---------- */
  g.fillStyle = "rgba(28,42,28,.20)";
  g.beginPath(); g.ellipse(196, 518, 42, 10, 0, 0, 6.2832); g.fill();
  drawHip(g, "cat", 196, 516, 120, "half");


  /* ================= HUD ================= */

  /* ---- 左上：角色卡（一级） ---- */
  {
    const x = 22, y = 18, w = 286, h = 104;
    card(g, x, y, w, h, 26, { sa: 0.26, dy: 6 });

    // 头像窗
    const acx = x + 56, acy = y + 56, ar = 36;
    g.save();
    g.beginPath(); g.arc(acx, acy, ar, 0, 6.2832); g.clip();
    g.fillStyle = "#FFEBCF"; g.fillRect(acx - ar, acy - ar, ar * 2, ar * 2);
    drawHip(g, "cat", acx, acy + ar * 2.26 * 0.70, ar * 2.26, "normal");
    g.restore();
    g.beginPath(); g.arc(acx, acy, ar, 0, 6.2832);
    g.strokeStyle = T.ink; g.lineWidth = 4; g.stroke();

    text(g, "尖耳猫", x + 104, y + 32, 20, T.ink, true, "left");
    text(g, "溜溜球　·　一球 2 层", x + 104, y + 56, 11, "rgba(58,43,68,.58)", false, "left");

    // 三颗心
    for (let i = 0; i < 3; i++) heart(g, x + 116 + i * 26, y + 82, 10, i < 2 ? "#FF6B5E" : "rgba(58,43,68,.14)");
  }

  /* ---- 顶部中：关卡进度（二级） ---- */
  {
    const x = 458, y = 16, w = 364, h = 48;
    g.fillStyle = "rgba(42,32,58,.66)";
    rr(g, x, y, w, h, 24); g.fill();
    g.strokeStyle = "rgba(255,255,255,.20)"; g.lineWidth = 2;
    rr(g, x, y, w, h, 24); g.stroke();

    text(g, "第 3 关 · 泥沼", x + 96, y + h / 2 + 1, 16, "#FFF6E4", true);

    for (let i = 0; i < 8; i++) {
      const px = x + 200 + i * 19;
      if (i < 3) {
        g.beginPath(); g.arc(px, y + h / 2, 6, 0, 6.2832);
        g.fillStyle = T.gold; g.fill();
      } else if (i === 3) {
        g.beginPath(); g.arc(px, y + h / 2, 8, 0, 6.2832);
        g.fillStyle = "#FFF6E4"; g.fill();
        g.beginPath(); g.arc(px, y + h / 2, 4, 0, 6.2832);
        g.fillStyle = T.amber; g.fill();
      } else {
        g.beginPath(); g.arc(px, y + h / 2, 5, 0, 6.2832);
        g.fillStyle = "rgba(255,246,228,.28)"; g.fill();
      }
    }
  }

  /* ---- 右上：目标卡（一级） ---- */
  {
    const x = 980, y = 18, w = 278, h = 116;
    card(g, x, y, w, h, 26, { sa: 0.26, dy: 6 });

    text(g, "清场", x + 18, y + 26, 14, "rgba(58,43,68,.60)", true, "left");
    text(g, "剩 6 只", x + w - 18, y + 27, 21, T.ink, true, "right");

    // 进度条
    const bx = x + 18, by = y + 46, bw = w - 36, bh = 12;
    g.fillStyle = "rgba(58,43,68,.12)";
    rr(g, bx, by, bw, bh, 6); g.fill();
    g.fillStyle = T.amber;
    rr(g, bx, by, bw * 0.34, bh, 6); g.fill();
    g.strokeStyle = "rgba(58,43,68,.30)"; g.lineWidth = 1.6;
    rr(g, bx, by, bw, bh, 6); g.stroke();

    // 收成
    g.beginPath(); g.arc(x + 27, y + 84, 8, 0, 6.2832);
    g.fillStyle = "#E4694C"; g.fill();
    g.strokeStyle = "#8E3A2A"; g.lineWidth = 2; g.stroke();
    text(g, "收成 12", x + 42, y + 85, 14, T.ink, true, "left");
    text(g, "火坑里的果子 ×2", x + w - 18, y + 85, 10, "rgba(58,43,68,.50)", false, "right");
  }

  /* ---- 中央飘字 ---- */
  {
    // 放右上净区：中央有平台和敌人，飘字压上去两层都读不清
    const bx = 700, by = 176;
    textO(g, "一球 4 只！", bx, by, 44, "#FFE58A", "#5A3210", 9, true);
    textO(g, "连锁 ×2　收成 +8", bx, by + 38, 15, "#FFF6E4", "#3A2B44", 4, true);
  }

  /* ---- 左下：肚子条（一级） ---- */
  {
    const x = 22, y = 636, w = 286, h = 62;
    card(g, x, y, w, h, 31, { sa: 0.26, dy: 6 });

    // 胃图标：一个碗 + 三颗果
    const bx = x + 34, by = y + 36;
    g.beginPath();
    g.moveTo(bx - 20, by - 10);
    g.quadraticCurveTo(bx, by + 24, bx + 20, by - 10);
    g.closePath();
    g.fillStyle = "#C9A97A"; g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 3; g.lineJoin = "round"; g.stroke();
    for (const p of [[-8, -16], [2, -20], [10, -14]]) {
      g.beginPath(); g.arc(bx + p[0], by + p[1], 5, 0, 6.2832);
      g.fillStyle = "#E4694C"; g.fill();
      g.strokeStyle = "#8E3A2A"; g.lineWidth = 1.6; g.stroke();
    }

    text(g, "半饿", x + 70, y + 20, 12, "rgba(58,43,68,.62)", true, "left");
    const px = x + 70, py = y + 34, pw = 150, ph = 14;
    g.fillStyle = "rgba(58,43,68,.12)";
    rr(g, px, py, pw, ph, 7); g.fill();
    g.fillStyle = T.gold;
    rr(g, px, py, pw * 0.46, ph, 7); g.fill();
    g.strokeStyle = "rgba(58,43,68,.32)"; g.lineWidth = 1.6;
    rr(g, px, py, pw, ph, 7); g.stroke();
    text(g, "×1.5", x + w - 20, y + 41, 15, "#C98A18", true, "right");
  }

  /* ---- 右下：道具槽（二级） ---- */
  {
    const items = ["fruit", "shroom", "fire"];
    items.forEach((kind, i) => {
      const x = 1062 + i * 70, y = 636, sz = 60;
      card(g, x, y, sz, sz, 16, { fill: "#FFF3DA", sa: 0.24, dy: 5 });
      const icx = x + sz / 2, icy = y + sz / 2 + 2;
      if (kind === "fruit") {
        g.beginPath(); g.arc(icx, icy + 2, 13, 0, 6.2832);
        g.fillStyle = "#E4694C"; g.fill();
        g.strokeStyle = "#8E3A2A"; g.lineWidth = 2.6; g.stroke();
        g.fillStyle = "rgba(255,240,210,.9)";
        g.beginPath(); g.arc(icx - 4, icy - 3, 3.4, 0, 6.2832); g.fill();
        g.fillStyle = "#6FAE5A";
        g.beginPath(); g.ellipse(icx + 6, icy - 11, 6, 3.2, -0.6, 0, 6.2832); g.fill();
      } else if (kind === "shroom") {
        g.beginPath();
        g.moveTo(icx - 15, icy + 1);
        g.quadraticCurveTo(icx, icy - 22, icx + 15, icy + 1);
        g.closePath();
        g.fillStyle = "#8FD9B6"; g.fill();
        g.strokeStyle = T.ink; g.lineWidth = 2.6; g.lineJoin = "round"; g.stroke();
        g.fillStyle = "#FFF6E4";
        rr(g, icx - 5, icy + 1, 10, 13, 4); g.fill();
        g.strokeStyle = T.ink; g.lineWidth = 2.4; g.stroke();
        g.fillStyle = "rgba(255,255,255,.85)";
        g.beginPath(); g.arc(icx - 5, icy - 6, 2.6, 0, 6.2832); g.fill();
        g.beginPath(); g.arc(icx + 6, icy - 8, 2.2, 0, 6.2832); g.fill();
      } else {
        g.beginPath();
        g.moveTo(icx, icy - 18);
        g.quadraticCurveTo(icx + 13, icy - 2, icx + 6, icy + 10);
        g.quadraticCurveTo(icx + 2, icy + 16, icx - 4, icy + 12);
        g.quadraticCurveTo(icx - 14, icy + 3, icx, icy - 18);
        g.closePath();
        g.fillStyle = "#FF9E4A"; g.fill();
        g.strokeStyle = T.ink; g.lineWidth = 2.6; g.lineJoin = "round"; g.stroke();
        g.beginPath();
        g.moveTo(icx + 1, icy - 2);
        g.quadraticCurveTo(icx + 7, icy + 5, icx + 3, icy + 10);
        g.quadraticCurveTo(icx - 3, icy + 9, icx + 1, icy - 2);
        g.closePath();
        g.fillStyle = "#FFD34E"; g.fill();
      }
      // 快捷键角标
      g.fillStyle = "rgba(58,43,68,.72)";
      rr(g, x + sz - 18, y + 4, 14, 14, 5); g.fill();
      text(g, String(i + 1), x + sz - 11, y + 11, 9, "#FFF6E4", true);
    });
  }

  /* ---- 底部提示（三级） ---- */
  text(g, "J 糊球　·　K 撞　·　Shift 看预瞄线　·　ESC 回门口", 640, 706, 12,
       "rgba(255,255,255,.72)", false);

  save(cv, "concept-2-战斗UI.png");
}

/* ============================================================================
   三、结算
   ----------------------------------------------------------------------------
   结算面板是"要不要再来一趟"的唯一决策点，所以必须给出**两个都能选**的出口：
   继续深入（有倍率、有风险） / 收工回家（落袋、回血）。
   只有一个"下一步"按钮的结算，等于没做选择。
   ========================================================================== */

function drawResult() {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  battleBg(g, 0);
  plat(g, 38, 336, 300, 30);
  plat(g, 806, 344, 344, 30);
  bug(g, 168, 336, 46);
  drawHip(g, "dog", 196, 516, 120, "full");
  snowball(g, 470, 494, 27);

  // 遮罩：0.90 才压得住。0.80 时 HUD 会从卡片周围透出来，和卡里是同一组信息，打架
  g.fillStyle = "rgba(18,14,32,.88)";
  g.fillRect(0, 0, W, H);

  /* ---------- 主卡 ---------- */
  const cx = 300, cy = 74, cw = 680, ch = 572;
  card(g, cx, cy, cw, ch, 34, { fill: T.paper, dy: 9, sa: 0.42, lw: 5 });

  // 顶部页码条
  text(g, "第 3 关　泥沼　·　清场成功", cx + cw / 2, cy + 40, 17, "rgba(58,43,68,.66)", true);

  /* ---------- 过关印章 ---------- */
  {
    g.save();
    g.translate(cx + cw - 108, cy + 70);
    g.rotate(-0.22);
    g.globalAlpha = 0.92;
    g.fillStyle = "#D9463C";
    rr(g, -58, -25, 116, 50, 8); g.fill();
    g.strokeStyle = "#A62E27"; g.lineWidth = 3;
    rr(g, -52, -19, 104, 38, 5); g.stroke();
    text(g, "过 关", 0, 2, 25, "#FFF2E8", true);
    g.restore();
  }

  /* ---------- 评级 ---------- */
  {
    const rx = cx + 128, ry = cy + 200, rr0 = 82;
    // 外圈：三层同心，制造"奖章"感（不用阴影和渐变）
    g.beginPath(); g.arc(rx, ry, rr0, 0, 6.2832);
    g.fillStyle = "#FFE9A8"; g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 5; g.stroke();
    g.beginPath(); g.arc(rx, ry, rr0 - 10, 0, 6.2832);
    g.strokeStyle = "#E0B44A"; g.lineWidth = 3; g.stroke();
    g.beginPath(); g.arc(rx, ry, rr0 - 20, 0, 6.2832);
    g.fillStyle = "#FFF6D8"; g.fill();

    // 两片小月桂
    // 叶子必须沿圆的下半弧排，并按切线朝向 —— 竖着排一排就变成"两根虫"
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const ang = Math.PI * 0.5 + sd * (0.40 + i * 0.24);
        const lx = rx + Math.cos(ang) * (rr0 + 4);
        const ly = ry + Math.sin(ang) * (rr0 + 4);
        g.save();
        g.translate(lx, ly);
        g.rotate(ang + Math.PI / 2);
        g.beginPath(); g.ellipse(0, 0, 12, 5.6, 0, 0, 6.2832);
        g.fillStyle = T.mint; g.fill();
        g.strokeStyle = T.ink; g.lineWidth = 2; g.stroke();
        g.restore();
      }
    }

    textO(g, "S", rx, ry + 4, 84, "#FFC93C", "#7A4A08", 7, true);
    text(g, "用时 47s ≤ 55s", rx, ry + 96, 11, "rgba(58,43,68,.62)", false);
    text(g, "造球 4 ≤ 5", rx, ry + 114, 11, "rgba(58,43,68,.62)", false);
  }

  /* ---------- 数据 ---------- */
  {
    const dx = cx + 268, dy = cy + 132;
    const rows = [
      ["送走", "9 / 9 只"],
      ["用时", "47.2s"],
      ["造球", "4 颗"],
      ["最大一球", "4 只"],
      ["收成", "128 果"],
    ];
    rows.forEach((r, i) => {
      const y = dy + i * 40;
      text(g, r[0], dx, y, 13, "rgba(58,43,68,.55)", false, "left");
      text(g, r[1], dx + 250, y, 18, T.ink, true, "right");
      if (i < rows.length - 1) {
        g.strokeStyle = "rgba(58,43,68,.10)";
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(dx, y + 18); g.lineTo(dx + 250, y + 18); g.stroke();
      }
    });
  }

  /* ---------- 分割 ---------- */
  g.strokeStyle = "rgba(58,43,68,.14)";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx + 48, cy + 396); g.lineTo(cx + cw - 48, cy + 396); g.stroke();

  /* ---------- 这一趟的账 ---------- */
  {
    const bx = cx + 48, by = cy + 424;
    text(g, "这一趟走了 3 关", bx, by, 14, "rgba(58,43,68,.60)", false, "left");
    text(g, "攒下 128 果   ×   1.30   =", bx, by + 30, 16, T.ink, true, "left");
    text(g, "166", bx + 268, by + 30, 26, "#D97E2B", true, "left");

    // 倍率提示：告诉玩家"再贪一关更值"
    g.fillStyle = "rgba(255,180,84,.30)";
    rr(g, bx + 330, by + 8, 236, 34, 17); g.fill();
    g.strokeStyle = "rgba(217,126,43,.55)"; g.lineWidth = 2;
    rr(g, bx + 330, by + 8, 236, 34, 17); g.stroke();
    text(g, "再推一关 → ×1.45", bx + 448, by + 26, 13, "#B0661A", true);
  }

  /* ---------- 按钮 ---------- */
  btn(g, cx + 56, cy + 488, 268, 62, "继续深入", { sub: "倍率变 1.45 · 它又饿了", size: 22 });
  btn(g, cx + 356, cy + 496, 268, 54, "收工回家",
      { face: T.paper, dark: T.paperSh, text: T.ink, size: 20, depth: 7, sub: "+166 果 · 吃饱", subColor: "rgba(58,43,68,.55)" });

  save(cv, "concept-3-结算.png");
}

/* --- 主入口 --- */
const ALL = { sheet: drawSheet, main: drawMain, battle: drawBattle, result: drawResult };
const keys = ONLY ? ONLY.split(",") : Object.keys(ALL);
console.log("渲染概念图 →", OUT);
for (const k of keys) {
  if (!ALL[k]) { console.warn("未知输出：" + k); continue; }
  ALL[k]();
}
console.log("完成");
