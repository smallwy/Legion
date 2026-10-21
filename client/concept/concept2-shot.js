/* ============================================================================
   concept2-shot.js —— v2 概念图渲染（立绘谱 / 家园 / 三关战斗 / 结算）
   ----------------------------------------------------------------------------
   运行：
     NODE_PATH=<managed>/node_modules node client/concept/concept2-shot.js
     ONLY=sheet node ...       只出立绘谱
     ONLY=home  node ...       只出家园
     ONLY=stage node ...       只出三关战斗
     ONLY=result node ...      只出结算
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const K = require("./kit2.js");

const { W, H, T, F, rr, fs: fillStroke, shadow, card, btn, text, textO, blob, star,
        eggBody, triEar, horn, drawPal, rarityTag, PALS, ORDER } = K;

const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const ONLY = process.env.ONLY || "";
const save = (cv, name) => {
  fs.writeFileSync(path.join(OUT, name), cv.toBuffer("image/png"));
  console.log("✓ " + name);
};

/* ============================================================================
   一、立绘谱
   ========================================================================== */

/** 剪影：涂成单色。肉眼看立绘永远觉得"挺不一样"，涂黑一排才知道分不分得开 */
function silhouette(g, id, cx, footY, h) {
  const bw = Math.ceil(h * 2.6), bh = Math.ceil(h * 1.9);
  const ox = Math.round(cx - bw / 2), oy = Math.round(footY - h * 1.35);
  const tmp = createCanvas(bw, bh);
  const tg = tmp.getContext("2d");
  tg.translate(-ox, -oy);
  // 谱上狐镜像过（让巨尾甩向右侧、不被邻格 clip 切掉），剪影也得跟着镜像，
  // 否则同一张图上第 6 格的尾巴方向和主图相反，读成"两只不同的宠物"
  drawPal(tg, id, cx, footY, h, "normal", id === "fox" ? { face: -1 } : undefined);
  const d = tg.getImageData(0, 0, bw, bh);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 10) { px[i] = 74; px[i + 1] = 52; px[i + 2] = 46; px[i + 3] = 255; }
  }
  tg.putImageData(d, 0, 0);
  g.drawImage(tmp, ox, oy);
}

function drawSheet2() {
  const SH = 1060;
  const cv = createCanvas(W, SH);
  const g = cv.getContext("2d");

  // 米白纸底 + 极淡网格（标注规范用）
  g.fillStyle = "#FFFBF2";
  g.fillRect(0, 0, W, SH);
  g.strokeStyle = "rgba(180,150,110,.07)";
  g.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SH); g.stroke();
  }

  /* ---------- 抬头 ---------- */
  text(g, "宠物立绘 · 棉花糖 v2", 56, 48, 30, T.ink, true, "left");
  text(g, "头占身高 54–58%　·　眼睛占脸宽 1/3　·　描边改用每只自己的暖色深调（不再用近黑冷紫）",
       58, 82, 13, "rgba(107,74,66,.62)", false, "left");
  text(g, "吧唧军团 · Munch Legion", W - 56, 48, 13, "rgba(107,74,66,.45)", false, "right");

  /* ---------- 六只大图 ---------- */
  const FY = 404, HH = 258;
  const X0 = 148, GAP = 197;
  ORDER.forEach((id, i) => {
    const P = PALS[id];
    const x = X0 + i * GAP;

    // 站立圆圈底：让六只有统一的"舞台"，也让描边有对比
    g.beginPath();
    g.arc(x, FY - HH * 0.42, HH * 0.54, 0, 6.2832);
    g.fillStyle = i % 2 === 0 ? "rgba(255,225,180,.30)" : "rgba(200,235,215,.30)";
    g.fill();

    // 影子
    g.beginPath();
    g.ellipse(x, FY + 4, HH * 0.26, HH * 0.058, 0, 0, 6.2832);
    g.fillStyle = "rgba(107,74,66,.13)";
    g.fill();

    g.save();
    g.beginPath();
    // 每格半宽 96 是为了不压到邻格。但狐的巨尾要甩到 cx±137，
    // 缝在这里就被裁没了 —— 传说位最核心的特征在谱上消失。
    // 狐是最后一格、右边没有邻居，单独把 clip 向右放宽；同时镜像让尾巴甩向右侧。
    const cw2 = id === "fox" ? 280 : 192;
    const cx2 = id === "fox" ? x - 96 : x - 96;
    g.rect(cx2, 90, cw2, 340);
    g.clip();
    // 狐左移 14：镜像后白尾尖到 x≈1286，会顶出 1280 画布右缘
    drawPal(g, id, x - (id === "fox" ? 14 : 0), FY, HH, "normal",
            id === "fox" ? { face: -1 } : undefined);
    g.restore();

    text(g, P.name, x, FY + 34, 20, T.ink, true);
    text(g, P.sp + "　·　" + P.role, x, FY + 58, 11, "rgba(107,74,66,.60)", false);
    rarityTag(g, x - 24, FY + 78, P);

    // 「想要它的理由」—— 稀有度只回答"有多难得到"，不回答"为什么想要"。
    // 玩家愿意抽/愿意练，靠的是这一行具象的小事，不是四颗星。
    g.font = F(11, false);
    g.fillStyle = "rgba(107,74,66,.72)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("「" + P.get + "」", x, FY + 102);
    text(g, P.rarity, x + 34, FY + 79, 10, P.rar, true, "left");
  });

  /* ---------- 剪影检验 ---------- */
  g.strokeStyle = "rgba(107,74,66,.14)";
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(56, 508); g.lineTo(W - 56, 508); g.stroke();

  text(g, "剪影检验", 56, 532, 16, T.ink, true, "left");
  text(g, "差别必须来自**体型**和**超出常理的那一件**，不能只靠换耳朵",
       56, 554, 11.5, "rgba(107,74,66,.60)", false, "left");

  ORDER.forEach((id, i) => {
    silhouette(g, id, 470 + i * 136, 640, 100);
  });

  /* ---------- 四态 ---------- */
  g.beginPath(); g.moveTo(56, 684); g.lineTo(W - 56, 684);
  g.strokeStyle = "rgba(107,74,66,.14)"; g.lineWidth = 1.5; g.stroke();

  text(g, "四套表情", 56, 706, 16, T.ink, true, "left");
  text(g, "只换眼/嘴/腮红，不换骨架 —— 美术只交一套身体，程序按 expr 切脸",
       56, 728, 11.5, "rgba(107,74,66,.60)", false, "left");

  const EX = ["normal", "hungry", "half", "full"];
  const LB = ["常态", "全饿（收走冲刺）", "半饿（最强）", "满饱"];
  const eX0 = 640, eGap = 158;
  EX.forEach((e, i) => {
    const x = eX0 + i * eGap;
    drawPal(g, "cat", x, 872, 132, e);
    text(g, LB[i], x, 896, 11, "rgba(107,74,66,.66)", false);
  });

  /* ---------- 材质细节 ---------- */
  g.beginPath(); g.moveTo(56, 934); g.lineTo(W - 56, 934);
  g.strokeStyle = "rgba(107,74,66,.14)"; g.lineWidth = 1.5; g.stroke();

  text(g, "材质差异 —— 同质化的真正解法", 56, 956, 16, T.ink, true, "left");

  const traits = [
    ["cat", "毛尖 + 竖瞳", "短毛，轮廓有细毛刺"],
    ["dog", "卷尾 + 露舌", "唯一常态吐舌头的"],
    ["ham", "颊袋 + 横纹", "能塞下一整颗果"],
    ["rab", "一耳微折", "耳朵比身子还长"],
    ["ox", "月牙角 + 斑块", "身上两块不规则斑"],
    ["fox", "巨尾 + 星尘", "整条尾巴比它还大"],
  ];
  traits.forEach((t, i) => {
    const x = 96 + i * 196;
    text(g, PALS[t[0]].name + "　" + t[1], x, 986, 11.5, T.ink, true);
    text(g, t[2], x, 1004, 10.5, "rgba(107,74,66,.58)", false);
  });

  save(cv, "concept2-0-立绘谱.png");
}

/* ============================================================================
   二、家园（主界面）
   ----------------------------------------------------------------------------
   为什么主界面不能只是"六只站在草地上"：
     那是**插画**，不是界面。玩家看完只会说"好看"，然后不知道要干什么。
     家园要让人一眼看懂**循环**：

       出门 → 拿果 → 回来喂 / 玩 / 摸  → 亲密度↑ → 解锁新家具 → 再出门

   所以这一屏必须同时出现四样东西，缺一样就退回插画：
     1. **需求气泡**——每只头上一个图标，告诉你"现在该做什么"
     2. **一个正在被互动的瞬间**——年糕头上的"摸摸"和手指。这是教学，
        比任何新手引导文字都快
     3. **今日互动 4/6**——今天的进度，制造"还差两只"的收尾欲
     4. **亲密度心**——长期成长。短目标 + 长目标必须同时在画面上

   布局定死：小屋在右上（家的锚点），宠物沿地面从左到右**由静到动**地铺开
   （睡 → 吃 → 追 → 跳 → 蹲），最后一只在最右的栅栏上看风景。
   这个顺序本身就是"一天"的节奏。
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

/** 圆润小屋：屋顶用大圆角而不是三角形 —— 尖屋顶是"写实"，圆屋顶才是"可爱" */
/* ============================================================================
   家园的功能建筑 —— 每一栋都是一个"可点击的入口"
   ----------------------------------------------------------------------------
   为什么必须做成**建筑**而不是 UI 图标：这个游戏的卖点是"过日子"，
   入口做成悬浮图标就退回成了菜单页。动森也是建筑即入口。
   每栋建筑头顶挂一个小铜牌（写功能名），统一识别语言。
   ========================================================================== */

/** 功能铜牌：建筑头顶的小牌子。所有入口共用，玩家一眼认出"这个能点" */
function sign(g, x, y, label, tone, sub) {
  const w = label.length * 13 + 30, h = 26;
  g.fillStyle = "rgba(74,44,24,.14)";
  rr(g, x - w / 2, y - h / 2 + 3, w, h, 13); g.fill();
  rr(g, x - w / 2, y - h / 2, w, h, 13);
  fillStroke(g, tone || "#FFE08A", T.ink, 3);
  text(g, label, x, y - (sub ? 2 : 0), 13.5, T.ink, true);
  if (sub) text(g, sub, x, y + 11, 9.5, "rgba(107,74,66,.62)", false);
}

/** 灶台：喂食入口。锅 + 热气 = "吃了会热乎" */
function stove(g, x, baseY, s) {
  const w = 124 * s, h = 86 * s;
  // 石灶体
  rr(g, x, baseY - h, w, h, 12 * s);
  fillStroke(g, "#C9B49A", T.ink, 4);
  // 灶口（拱）
  g.beginPath();
  g.moveTo(x + w * 0.28, baseY - 12 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - 46 * s, x + w * 0.72, baseY - 12 * s);
  g.closePath();
  fillStroke(g, "#8A6A50", T.ink, 3);
  // 火
  g.beginPath();
  g.moveTo(x + w * 0.40, baseY - 14 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - 34 * s, x + w * 0.60, baseY - 14 * s);
  g.closePath();
  fillStroke(g, "#FFB05A", null, 0);
  // 台面
  rr(g, x - 6 * s, baseY - h - 10 * s, w + 12 * s, 16 * s, 8 * s);
  fillStroke(g, "#E2CBAC", T.ink, 4);
  // 锅
  const cxq = x + w / 2, cyq = baseY - h - 12 * s;
  g.beginPath();
  g.ellipse(cxq, cyq, 40 * s, 13 * s, 0, 0, 6.2832);
  fillStroke(g, "#6E5A4E", T.ink, 3.6);
  g.beginPath();
  g.ellipse(cxq, cyq - 2 * s, 34 * s, 10 * s, 0, 0, 6.2832);
  fillStroke(g, "#A8825E", null, 0);
  // 热气：三条上升的短弧
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

/** 工作台：做道具入口。台面 + 锯 + 锤子 + 木屑 */
function workbench(g, x, baseY, s) {
  const w = 132 * s, h = 34 * s;
  // 台腿
  for (const dx of [0.10, 0.86]) {
    rr(g, x + w * dx - 6 * s, baseY - 44 * s, 12 * s, 44 * s, 4 * s);
    fillStroke(g, "#A97244", T.ink, 3.4);
  }
  // 台面
  rr(g, x, baseY - 56 * s, w, h, 7 * s);
  fillStroke(g, "#C98B57", T.ink, 4);
  rr(g, x + 4 * s, baseY - 54 * s, w - 8 * s, 9 * s, 4 * s);
  fillStroke(g, "#E0AC78", null, 0);
  // 锯子（斜放）
  g.save();
  g.translate(x + w * 0.34, baseY - 64 * s);
  g.rotate(-0.24);
  rr(g, -26 * s, -4 * s, 52 * s, 12 * s, 3 * s);
  fillStroke(g, "#B9C2CC", T.ink, 3);
  g.restore();
  // 锤子
  g.save();
  g.translate(x + w * 0.74, baseY - 66 * s);
  g.rotate(0.34);
  rr(g, -3 * s, -14 * s, 6 * s, 30 * s, 3 * s);
  fillStroke(g, "#B07848", T.ink, 2.8);
  rr(g, -13 * s, -22 * s, 26 * s, 12 * s, 3 * s);
  fillStroke(g, "#8E929C", T.ink, 3);
  g.restore();
}

/** 产地路牌：三块木牌指向三个产地，当前选中的亮一阶 */
function signpost(g, x, baseY, items, s) {
  // 牌子朝**左**：这个路牌在画面右侧，右边是小屋。朝右读成"小屋就是断崖"。
  // 朝左才指得出画外的"外面"，也就是玩家要去的方向。
  // 立柱
  rr(g, x - 6 * s, baseY - 132 * s, 12 * s, 132 * s, 4 * s);
  fillStroke(g, "#A97244", T.ink, 3.6);
  items.forEach((it, i) => {
    const y = baseY - 122 * s + i * 40 * s;
    const w = 108 * s, h = 30 * s;
    const on = it.on;
    g.save();
    g.translate(x, y);
    // 牌面朝左
    rr(g, -w, -h / 2, w, h, 6 * s);
    fillStroke(g, on ? "#FFE08A" : "#E4CBA4", T.ink, on ? 3.6 : 3);
    // 箭头尖（左端）
    g.beginPath();
    g.moveTo(-w, -h / 2); g.lineTo(-w - 12 * s, 0); g.lineTo(-w, h / 2);
    g.closePath();
    fillStroke(g, on ? "#FFE08A" : "#E4CBA4", T.ink, on ? 3.6 : 3);
    text(g, it.name, -w / 2 - 4 * s, 0, 12 * s, on ? T.ink : "rgba(107,74,66,.72)", on,
         "center");
    // 锁
    if (it.lock) {
      g.strokeStyle = "rgba(107,74,66,.70)";
      g.lineWidth = 2.4 * s;
      g.beginPath();
      g.arc(-w + 14 * s, -9 * s, 4.5 * s, Math.PI, 0);
      g.stroke();
      rr(g, -w + 9.5 * s, -9 * s, 9 * s, 8 * s, 2 * s);
      fillStroke(g, "#C9B49A", "rgba(107,74,66,.70)", 2 * s);
    }
    g.restore();
  });
}

/** 图鉴相册：挂在屋墙上，六只的小头像 = "收集" */
function album(g, x, y, s) {
  const w = 84 * s, h = 62 * s;
  rr(g, x - w / 2, y - h / 2, w, h, 8 * s);
  fillStroke(g, "#FFF1D6", T.ink, 3.4);
  // 六个小格
  for (let i = 0; i < 6; i++) {
    const gx = x - w / 2 + 10 * s + (i % 3) * 22 * s;
    const gy = y - h / 2 + 10 * s + Math.floor(i / 3) * 22 * s;
    rr(g, gx, gy, 18 * s, 18 * s, 4 * s);
    fillStroke(g, i < 4 ? "#FFD9A0" : "rgba(107,74,66,.10)",
               "rgba(107,74,66,.30)", 1.8 * s);
  }
}

function hut(g, x, baseY, s) {
  const w = 250 * s, wallH = 140 * s, roofH = 96 * s;

  // 墙
  rr(g, x, baseY - wallH, w, wallH, 16 * s);
  fillStroke(g, "#FFE3AC", T.ink, 4.5);
  // 墙的暖色暗部（一条，不做渐变）
  g.save();
  rr(g, x, baseY - wallH, w, wallH, 16 * s);
  g.clip();
  g.fillStyle = "rgba(226,160,90,.22)";
  g.fillRect(x, baseY - wallH * 0.26, w, wallH * 0.26);
  g.restore();

  // 屋顶：半圆拱
  g.beginPath();
  g.moveTo(x - 22 * s, baseY - wallH + 10 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - wallH - roofH * 1.62, x + w + 22 * s, baseY - wallH + 10 * s);
  g.quadraticCurveTo(x + w * 0.5, baseY - wallH - 8 * s, x - 22 * s, baseY - wallH + 10 * s);
  g.closePath();
  fillStroke(g, "#F08C6A", T.ink, 5);
  // 屋顶条纹
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
    g.lineTo(x + i * 34 * s + 26 * s, baseY - wallH - roofH * 1.5);
    g.stroke();
  }
  g.restore();

  // 窗
  for (const wx of [x + 30 * s, x + w - 84 * s]) {
    rr(g, wx - 5 * s, baseY - wallH + 34 * s, 62 * s, 54 * s, 10 * s);
    fillStroke(g, T.cream, T.ink, 3.5);
    rr(g, wx, baseY - wallH + 39 * s, 52 * s, 44 * s, 7 * s);
    fillStroke(g, "#FFD470", null, 0);
    g.strokeStyle = T.ink; g.lineWidth = 3 * s;
    g.beginPath();
    g.moveTo(wx + 26 * s, baseY - wallH + 39 * s); g.lineTo(wx + 26 * s, baseY - wallH + 83 * s);
    g.moveTo(wx, baseY - wallH + 61 * s); g.lineTo(wx + 52 * s, baseY - wallH + 61 * s);
    g.stroke();
    // 窗光
    g.fillStyle = "rgba(255,240,190,.55)";
    rr(g, wx + 3 * s, baseY - wallH + 42 * s, 20 * s, 16 * s, 4 * s);
    g.fill();
  }

  // 门（拱形）+ 门帘
  const dw = 62 * s, dx = x + w * 0.5 - dw / 2;
  g.beginPath();
  g.moveTo(dx, baseY);
  g.lineTo(dx, baseY - 74 * s);
  g.quadraticCurveTo(dx + dw / 2, baseY - 104 * s, dx + dw, baseY - 74 * s);
  g.lineTo(dx + dw, baseY);
  g.closePath();
  fillStroke(g, "#8A4F35", T.ink, 4);
  g.beginPath();
  g.moveTo(dx + 5 * s, baseY);
  g.lineTo(dx + 5 * s, baseY - 70 * s);
  g.quadraticCurveTo(dx + dw / 2, baseY - 96 * s, dx + dw - 5 * s, baseY - 70 * s);
  g.lineTo(dx + dw - 5 * s, baseY);
  g.closePath();
  fillStroke(g, "#C97A4E", null, 0);
  // 门帘波浪
  g.beginPath();
  g.moveTo(dx + 5 * s, baseY - 58 * s);
  g.lineTo(dx + dw - 5 * s, baseY - 58 * s);
  g.lineTo(dx + dw - 5 * s, baseY - 34 * s);
  for (let i = 4; i >= 0; i--) {
    const t = i / 4;
    g.quadraticCurveTo(dx + 5 * s + (dw - 10) * (t + 0.1), baseY - 22 * s,
                       dx + 5 * s + (dw - 10) * t, baseY - 34 * s);
  }
  g.closePath();
  fillStroke(g, "#F5C169", T.ink, 3);

  // 门牌
  rr(g, dx + dw / 2 - 30 * s, baseY - 104 * s, 60 * s, 24 * s, 11 * s);
  fillStroke(g, T.cream, T.ink, 3);
  text(g, "爪 队", dx + dw / 2, baseY - 92 * s, 13 * s, T.ink, true);

  // 炊烟：三颗，越上越大越淡
  for (let i = 0; i < 3; i++) {
    g.globalAlpha = 0.42 - i * 0.11;
    g.fillStyle = "#FFFFFF";
    g.beginPath();
    g.arc(x + w * 0.76 + i * 10 * s, baseY - wallH - roofH * 1.15 - i * 26 * s, (11 + i * 4) * s, 0, 6.2832);
    g.fill();
  }
  g.globalAlpha = 1;
}

function tree(g, x, baseY, r) {
  g.fillStyle = "#B07848";
  rr(g, x - 7, baseY - r * 0.62, 14, r * 0.66, 5);
  g.fill();
  g.strokeStyle = T.ink; g.lineWidth = 3.5; g.stroke();
  for (const c of [[0, -1.02, 0.74], [-0.62, -0.52, 0.58], [0.64, -0.52, 0.58], [0, -0.42, 0.66]]) {
    g.beginPath(); g.arc(x + c[0] * r, baseY - r * 0.62 + c[1] * r, c[2] * r, 0, 6.2832);
    fillStroke(g, "#6FC35C", T.ink, 4);
  }
  // 高光果
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

/** 食盆：碗 + 名字牌 */
function bowl(g, x, y, s, full) {
  g.beginPath();
  g.moveTo(x - 30 * s, y - 16 * s);
  g.quadraticCurveTo(x, y + 26 * s, x + 30 * s, y - 16 * s);
  g.closePath();
  fillStroke(g, "#EFB25E", T.ink, 4);
  // 碗口
  g.beginPath();
  g.ellipse(x, y - 16 * s, 30 * s, 10 * s, 0, 0, 6.2832);
  fillStroke(g, "#FFD79A", T.ink, 3.5);
  if (full) {
    // 满盆果
    for (const p of [[-13, -4], [0, -7], [13, -3], [-6, 4], [7, 4]]) {
      g.beginPath();
      g.arc(x + p[0] * s, y - 16 * s + p[1] * s, 6.5 * s, 0, 6.2832);
      fillStroke(g, "#F2764F", T.ink2, 2);
    }
  }
  // 底
  g.beginPath();
  g.ellipse(x, y + 6 * s, 14 * s, 4 * s, 0, 0, 6.2832);
  g.fillStyle = "rgba(107,74,66,.16)"; g.fill();
}

/** 玩具球 */
function toyBall(g, x, y, r) {
  g.beginPath(); g.arc(x, y, r, 0, 6.2832);
  fillStroke(g, "#7EC8F0", T.ink, 4);
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.clip();
  g.strokeStyle = "#FFFFFF"; g.lineWidth = r * 0.34;
  g.beginPath(); g.arc(x, y - r * 1.1, r * 1.3, 0.4, Math.PI - 0.4); g.stroke();
  g.beginPath(); g.arc(x, y + r * 1.1, r * 1.3, Math.PI + 0.4, -0.4); g.stroke();
  g.restore();
  g.fillStyle = "rgba(255,255,255,.75)";
  g.beginPath(); g.arc(x - r * 0.34, y - r * 0.38, r * 0.20, 0, 6.2832); g.fill();
}

/** 软垫窝 */
function bed(g, x, y, s) {
  g.beginPath();
  g.ellipse(x, y, 62 * s, 20 * s, 0, 0, 6.2832);
  fillStroke(g, "#F2A0B4", T.ink, 4);
  g.beginPath();
  g.ellipse(x, y - 5 * s, 50 * s, 14 * s, 0, 0, 6.2832);
  fillStroke(g, "#FFC6D4", null, 0);
  // 缝线
  g.strokeStyle = "rgba(200,90,120,.45)";
  g.lineWidth = 2;
  g.setLineDash([5, 6]);
  g.beginPath();
  g.ellipse(x, y, 54 * s, 16 * s, 0, 0, 6.2832);
  g.stroke();
  g.setLineDash([]);
}

/** 需求气泡：圆形奶油底 + 图标。这是"养成的指令层" */
function wantBubble(g, x, y, kind, s, alpha) {
  const R = 16 * s;
  g.save();
  if (alpha !== undefined) g.globalAlpha = alpha;

  // 柄
  g.beginPath();
  g.moveTo(x - R * 0.34, y + R * 0.84);
  g.lineTo(x + R * 0.34, y + R * 0.84);
  g.lineTo(x, y + R * 1.52);
  g.closePath();
  fillStroke(g, T.cream, T.ink, 3);

  g.beginPath(); g.arc(x, y, R, 0, 6.2832);
  fillStroke(g, T.cream, T.ink, 3.2);
  g.fillStyle = T.cream;
  g.fillRect(x - R * 0.30, y + R * 0.76, R * 0.60, 6);

  if (kind === "heart") {
    heartShape(g, x, y - R * 0.04, R * 0.46, "#FF7E96", T.ink, 2.2);
  } else if (kind === "food") {
    // 空碗：一条弧 + 三颗碎屑
    g.beginPath();
    g.moveTo(x - R * 0.46, y - R * 0.10);
    g.quadraticCurveTo(x, y + R * 0.44, x + R * 0.46, y - R * 0.10);
    g.closePath();
    fillStroke(g, "#EFB25E", T.ink, 2.2);
    g.fillStyle = "#C98A4A";
    for (const p of [[-0.20, -0.34], [0.02, -0.44], [0.24, -0.32]]) {
      g.beginPath(); g.arc(x + p[0] * R, y + p[1] * R, R * 0.09, 0, 6.2832); g.fill();
    }
  } else if (kind === "sleep") {
    text(g, "Z", x - R * 0.10, y - R * 0.02, 15 * s, "#7A8FB8", true);
    text(g, "z", x + R * 0.34, y + R * 0.26, 11 * s, "#7A8FB8", true);
  } else if (kind === "play") {
    toyBall(g, x, y, R * 0.42);
  } else if (kind === "fish") {
    // 小鱼
    g.beginPath();
    g.ellipse(x - R * 0.04, y, R * 0.44, R * 0.28, 0, 0, 6.2832);
    fillStroke(g, "#8FD8F0", T.ink, 2.2);
    g.beginPath();
    g.moveTo(x - R * 0.46, y);
    g.lineTo(x - R * 0.72, y - R * 0.26);
    g.lineTo(x - R * 0.72, y + R * 0.26);
    g.closePath();
    fillStroke(g, "#8FD8F0", T.ink, 2.2);
    g.fillStyle = T.ink;
    g.beginPath(); g.arc(x + R * 0.16, y - R * 0.06, R * 0.07, 0, 6.2832); g.fill();
  }
  g.restore();
}

function heartShape(g, x, y, r, fill, line, lw) {
  g.beginPath();
  g.moveTo(x, y + r * 0.86);
  g.bezierCurveTo(x - r * 1.66, y - r * 0.40, x - r * 0.66, y - r * 1.30, x, y - r * 0.30);
  g.bezierCurveTo(x + r * 0.66, y - r * 1.30, x + r * 1.66, y - r * 0.40, x, y + r * 0.86);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (line) { g.strokeStyle = line; g.lineWidth = lw; g.lineJoin = "round"; g.stroke(); }
}

/** 手指光标：教会"可以点"。一张图里必须有一个活的交互瞬间 */
function finger(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.rotate(-0.18);
  // 手掌
  g.beginPath();
  rr(g, -9 * s, -2 * s, 18 * s, 26 * s, 8 * s);
  fillStroke(g, "#FFE0BE", T.ink, 2.6);
  // 食指
  g.beginPath();
  rr(g, -5.5 * s, -26 * s, 11 * s, 26 * s, 5.5 * s);
  fillStroke(g, "#FFE0BE", T.ink, 2.6);
  g.restore();
}

/** 树的树冠：五团不等大 + 一层深色底 —— 三个等大圆会读成"花椰菜" */
function tree2(g, x, baseY, r) {
  // 深色底（右下的暗部，只一块）
  g.fillStyle = "rgba(58,120,62,.30)";
  for (const c of [[0.16, -0.94, 0.70], [0.60, -0.46, 0.52]]) {
    g.beginPath(); g.arc(x + c[0] * r, baseY - r * 0.64 + c[1] * r, c[2] * r, 0, 6.2832); g.fill();
  }
  // 主干
  rr(g, x - 8, baseY - r * 0.70, 16, r * 0.74, 6);
  fillStroke(g, "#B07848", T.ink, 3.5);
  // 冠
  const blobs = [[-0.56, -0.52, 0.50], [0.52, -0.56, 0.46], [-0.16, -1.06, 0.52], [0.22, -0.82, 0.44], [0.02, -0.44, 0.58]];
  for (const c of blobs) {
    g.beginPath(); g.arc(x + c[0] * r, baseY - r * 0.64 + c[1] * r, c[2] * r, 0, 6.2832);
    fillStroke(g, "#6FC35C", T.ink, 4);
  }
  // 顶部高光
  g.fillStyle = "rgba(178,232,140,.55)";
  g.beginPath(); g.arc(x - r * 0.30, baseY - r * 1.42, r * 0.26, 0, 6.2832); g.fill();
}

function drawHome() {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  /* ---------- 天空（全图唯一渐变） ---------- */
  const grd = g.createLinearGradient(0, 0, 0, 276);
  grd.addColorStop(0, "#7FCDEF");
  grd.addColorStop(0.60, "#BFE9FA");
  grd.addColorStop(1, "#E9FAFF");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, 276);

  cloud(g, 150, 74, 25, 0.95);
  cloud(g, 512, 46, 20, 0.80);
  cloud(g, 856, 82, 22, 0.88);
  cloud(g, 1210, 176, 15, 0.60);

  // 太阳：不画脸 —— 画了就是第二个"角色"，和六只抢视线
  g.fillStyle = "rgba(255,242,176,.50)";
  g.beginPath(); g.arc(1082, 56, 46, 0, 6.2832); g.fill();
  g.fillStyle = "#FFF1AC";
  g.beginPath(); g.arc(1082, 56, 30, 0, 6.2832); g.fill();
  g.strokeStyle = "rgba(224,176,54,.50)"; g.lineWidth = 3.5;
  g.beginPath(); g.arc(1082, 56, 30, 0, 6.2832); g.stroke();

  /* ---------- 远山 ---------- */
  // 远山：保持矮。试过加到 104/74，结果变成"绿色大馒头"——地平线被抬到 y190，
  // 天空压窄，且和草地同色，读成"草地隆起"。远处的丘陵就该矮。
  hill(g, 258, 58, "#A9E0A0", 0.72, 0.6);
  hill(g, 270, 38, "#8DD088", 0.88, 2.4);

  /* ---------- 草地：三层，靠纯色分层压出纵深 ---------- */
  g.fillStyle = "#8FD46C";
  g.fillRect(0, 264, W, H - 264);
  g.fillStyle = "#7FCA5E";
  g.fillRect(0, 400, W, H - 400);
  g.fillStyle = "#6FBA52";
  g.fillRect(0, 540, W, H - 540);
  g.fillStyle = "#A8E487";
  g.fillRect(0, 264, W, 7);

  /* ---------- 出村的小路：从屋前通向左下，暗示"外面" ---------- */
  g.beginPath();
  g.moveTo(1052, 292);
  g.bezierCurveTo(880, 360, 560, 452, 300, 520);
  g.bezierCurveTo(180, 550, 60, 578, -20, 600);
  g.lineTo(-20, 682);
  g.bezierCurveTo(120, 652, 300, 606, 460, 570);
  g.bezierCurveTo(700, 516, 940, 424, 1080, 358);
  g.closePath();
  g.fillStyle = "rgba(226,203,156,.55)";
  g.fill();
  for (let i = 0; i < 20; i++) {
    const t = i / 20;
    const px = 1052 - t * 1090;
    const py = 330 + t * 260 - Math.sin(t * 3.14) * 30;
    g.fillStyle = "rgba(198,164,112,.26)";
    g.beginPath();
    g.ellipse(px, py, 4.5 + (i % 3) * 2, 2.6 + (i % 2), i * 0.5, 0, 6.2832);
    g.fill();
  }

  /* ---------- 中景树：只放边缘，不占中间 ---------- */
  tree2(g, 54, 312, 42);
  tree2(g, 190, 302, 28);
  tree2(g, 1258, 296, 32);

  /* ---------- 小屋（右上，缩小到 0.86 让出位置给角色） ---------- */
  hut(g, 1012, 366, 0.86);

  /* ---------- 栅栏：右段，围住屋前 ---------- */
  fence(g, 396, 1146, 1276);

  /* ---------- 院子后墙：一圈矮栅栏把"家"围起来 ---------- */
  // 没有围合，六只就是"站在草地上的角色"；有了围合才叫院子
  fence(g, 372, 1186, 1276);

  /* ---------- 花圃（左下）：家园要有"在过日子"的痕迹 ---------- */
  {
    // 从 (26,448) 挪到小屋前：左下要给灶台让位
    const bx = 1042, by = 396, bw = 152, bh = 50;
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

  /* ---------- 零散草丛：填空白但不挡脚 ---------- */
  for (const c of [[560, 470, 1], [900, 452, 0.8], [300, 420, 0.7], [1180, 470, 0.9], [660, 500, 0.6]]) {
    g.strokeStyle = "rgba(58,132,58,.45)";
    g.lineWidth = 2.8 * c[2];
    g.lineCap = "round";
    for (const d of [-1.4, -0.5, 0.5, 1.4]) {
      g.beginPath();
      g.moveTo(c[0] + d * 4, c[1]);
      g.quadraticCurveTo(c[0] + d * 7, c[1] - 10 * c[2], c[0] + d * 6 + 3, c[1] - 17 * c[2]);
      g.stroke();
    }
  }

  /* ------------------------------------------------------------------
     功能建筑层（后排 y 290–380）
     主界面要"统筹所有功能"，不能只有"出门"一个入口。计划书里家园 Hub
     要承载：喂食（饱食度）/ 做道具（材料→规则修改器）/ 选产地 / 图鉴 / 背包。
     这里把前三个做成**场景建筑**（图鉴和背包进底部栏），每栋挂一块小铜牌。
     位置全部压在地平线以上的后排，给前排的六只留出 436 以下的完整空间。
     ------------------------------------------------------------------ */
  stove(g, 44, 372, 0.90);                       // 灶台：喂饭
  workbench(g, 186, 372, 0.86);                  // 工作台：做道具
  signpost(g, 792, 380, [                        // 产地路牌：三个产地
    { name: "苔原", on: true },
    { name: "泥沼" },
    { name: "断崖", lock: true },
  ], 0.86);

  // 入口铜牌：统一识别语言 —— 玩家看到小牌子就知道"这儿能点"
  sign(g, 100, 394, "灶台", "#FFD9A0");
  sign(g, 244, 394, "工作台", "#D6E6B8");

  /* ---------- 家具 ---------- */
  bed(g, 250, 646, 1.10);
  bowl(g, 452, 626, 1.05, true);

  /* ---------- 六只：由静到动，从左到右 ---------- */
  // 远：星屑蹲在小路尽头看蝴蝶（小 + 低饱和，制造纵深）
  {
    // 影子：星屑站得比前排远（脚 486 vs 前排 596+），没有落地影子就"飘"
    g.beginPath(); g.ellipse(934, 490, 33, 8, 0, 0, 6.2832);
    g.fillStyle = "rgba(74,52,46,.13)"; g.fill();
    drawPal(g, "fox", 936, 486, 134, "normal", { alpha: 0.96 });
    g.save();
    g.translate(852, 424);
    g.rotate(-0.3);
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.ellipse(sd * 11, -6, 11, 8, sd * 0.5, 0, 6.2832);
      fillStroke(g, "#FFD1E2", T.ink, 2.4);
    }
    g.beginPath(); g.ellipse(0, 0, 3, 9, 0, 0, 6.2832);
    fillStroke(g, "#8A6358", null, 0);
    g.restore();
  }

  // 屋顶：砂糖（猫上房顶，不需要解释）
  drawPal(g, "cat", 1108, 250, 118, "normal", { face: -1 });

  // 雪团：跳起来。落地烟代替虚线（虚线会读成"扫把"）
  {
    g.beginPath(); g.ellipse(762, 640, 34, 8, 0, 0, 6.2832);
    g.fillStyle = "rgba(74,52,46,.13)"; g.fill();
    drawPal(g, "rab", 762, 604, 164, "normal", { face: 1 });
    for (const c of [[722, 636, 10], [706, 644, 6.5]]) {
      g.fillStyle = "rgba(255,255,255,.80)";
      g.beginPath(); g.arc(c[0], c[1], c[2], 0, 6.2832); g.fill();
    }
  }

  // 豆奶：趴在垫子上打盹。**不盖被子** —— 盖了读成"一坨蓝东西"
  {
    g.beginPath(); g.ellipse(253, 608, 92, 19, 0, 0, 6.2832);
    fillStroke(g, "#F2A0B4", T.ink, 4.5);
    g.beginPath(); g.ellipse(253, 602, 75, 13, 0, 0, 6.2832);
    fillStroke(g, "#FFC6D4", null, 0);
    drawPal(g, "ox", 250, 596, 158, "full");
    text(g, "z", 316, 512, 19, "#7A8FB8", true);
    text(g, "z", 338, 492, 14, "#7A8FB8", true);
  }

  // 团子：脸埋进盆里。盆压在胸口，果子露出来
  {
    drawPal(g, "ham", 446, 626, 146, "half");
    bowl(g, 446, 588, 1.04, true);
  }

  // 年糕：追球。球在嘴前，速度线在身后
  {
    g.beginPath(); g.ellipse(604, 650, 48, 11, 0, 0, 6.2832);
    g.fillStyle = "rgba(74,52,46,.15)"; g.fill();
    drawPal(g, "dog", 598, 646, 172, "half", { face: 1 });
    // 球必须在 drawPal 之后：先画会被年糕身体吃掉一半，只剩个蓝色缺口
    toyBall(g, 694, 620, 15);
    g.strokeStyle = "rgba(255,255,255,.80)";
    g.lineWidth = 4.5;
    g.lineCap = "round";
    for (const y of [566, 596, 626]) {
      g.beginPath();
      g.moveTo(470, y); g.lineTo(426, y);
      g.stroke();
    }
  }

  /* ---------- 需求气泡：头顶，且不压脸 ---------- */
  wantBubble(g, 300, 452, "sleep", 1.06);
  wantBubble(g, 446, 470, "food", 1.04);
  wantBubble(g, 792, 410, "heart", 1.02);
  wantBubble(g, 930, 344, "fish", 0.96);

  /* ---------- 正在互动的瞬间：年糕 + "摸摸" + 手指 ---------- */
  {
    const bx = 684, by = 448;
    g.beginPath();
    rr(g, bx - 50, by - 19, 100, 38, 19);
    fillStroke(g, "#FFE9A8", T.ink, 3.5);
    text(g, "摸摸", bx, by, 16, T.ink, true);
    g.beginPath();
    g.moveTo(bx - 16, by + 18);
    g.lineTo(bx + 8, by + 18);
    g.lineTo(bx - 6, by + 34);
    g.closePath();
    fillStroke(g, "#FFE9A8", T.ink, 3);
    g.fillStyle = "#FFE9A8";
    g.fillRect(bx - 14, by + 14, 20, 6);

    finger(g, 714, 506, 1.02);

    for (const p of [[722, 512, 0.58], [744, 496, 0.44], [698, 500, 0.36]]) {
      heartShape(g, p[0], p[1], p[2] * 17, "#FF7E96", T.ink, 2.2);
    }
  }

  /* ---------- 底部 HUD：一条整横条 ---------- */
  // 分散在草地上会读成"贴纸"，必须收进一条。
  {
    const hx = 0, hy = 648, hh = 72;
    g.fillStyle = "rgba(255,249,236,.96)";
    g.fillRect(hx, hy, W, hh);
    g.fillStyle = "rgba(107,74,66,.22)";
    g.fillRect(hx, hy, W, 3);

    // 果子
    g.beginPath(); g.arc(56, hy + 36, 17, 0, 6.2832);
    fillStroke(g, "#F2764F", T.ink, 3.2);
    g.fillStyle = "rgba(255,242,214,.94)";
    g.beginPath(); g.arc(50, hy + 30, 5, 0, 6.2832); g.fill();
    g.fillStyle = "#6FAE5A";
    g.beginPath(); g.ellipse(65, hy + 20, 7.5, 3.8, -0.6, 0, 6.2832); g.fill();
    text(g, "248", 82, hy + 37, 27, T.ink, true, "left");

    // 分隔线
    g.strokeStyle = "rgba(107,74,66,.16)";
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(178, hy + 14); g.lineTo(178, hy + 58); g.stroke();

    // 今天摸过：六个圆点
    text(g, "今天摸过", 200, hy + 24, 12, "rgba(107,74,66,.66)", true, "left");
    for (let i = 0; i < 6; i++) {
      const px = 212 + i * 26;
      g.beginPath(); g.arc(px, hy + 46, 9, 0, 6.2832);
      if (i < 4) fillStroke(g, "#FF7E96", T.ink, 2.4);
      else fillStroke(g, "rgba(107,74,66,.10)", "rgba(107,74,66,.30)", 2.4);
    }
    text(g, "还差 2 只", 372, hy + 46, 12, "rgba(107,74,66,.58)", true, "left");

    // 亲密度
    g.strokeStyle = "rgba(107,74,66,.16)";
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(470, hy + 14); g.lineTo(470, hy + 58); g.stroke();
    text(g, "亲密度", 488, hy + 24, 12, "rgba(107,74,66,.66)", true, "left");
    for (let i = 0; i < 5; i++) {
      heartShape(g, 500 + i * 25, hy + 46, 9,
                 i < 3 ? "#FF7E96" : "rgba(107,74,66,.12)",
                 i < 3 ? T.ink : "rgba(107,74,66,.32)", 2.2);
    }
    text(g, "3 / 5", 646, hy + 27, 13, "rgba(107,74,66,.70)", true, "left");
text(g, "还差 12 次", 646, hy + 47, 10.5, "rgba(107,74,66,.48)", false, "left");

    /* ---- 图鉴 / 背包：底部原来有一段 250px 的空档，正好放两个次要入口 ---- */
    {
      const ic = [
        ["图鉴", "4 / 6", "#D9C8F0"],
        ["背包", "12", "#CFE4C0"],
      ];
      ic.forEach((it, i) => {
        const bx = 704 + i * 112, by = hy + 12, bw = 100, bh = 46;
        shadow(g, bx, by, bw, bh, 23, 4, 0.16);
        rr(g, bx, by, bw, bh, 23);
        fillStroke(g, it[2], T.ink, 3.4);
        text(g, it[0], bx + 40, by + bh / 2 - 6, 13.5, T.ink, true, "left");
        text(g, it[1], bx + 40, by + bh / 2 + 9, 10.5, "rgba(107,74,66,.60)", false, "left");
        // 小图标：书 / 包
        if (i === 0) {
          rr(g, bx + 14, by + 14, 15, 18, 3);
          fillStroke(g, "#FFFBEE", T.ink, 2.2);
          g.beginPath(); g.moveTo(bx + 21, by + 14); g.lineTo(bx + 21, by + 32);
          g.strokeStyle = T.ink; g.lineWidth = 1.6; g.stroke();
        } else {
          rr(g, bx + 13, by + 18, 18, 14, 4);
          fillStroke(g, "#E2B474", T.ink, 2.2);
          g.beginPath();
          g.arc(bx + 22, by + 18, 4.5, Math.PI, 0);
          g.strokeStyle = T.ink; g.lineWidth = 2; g.stroke();
        }
      });
    }

    // 出发
    btn(g, 968, hy + 6, 262, 58, "出门", { sub: "带 星屑 · 苔原 3/8", size: 24, r: 26, depth: 7 });
  }

  /* ---------- 顶部标题 ---------- */
  textO(g, "吧唧军团", 42, 50, 37, "#FFFFFF", "rgba(72,96,124,.52)", 8, true, "left");
  text(g, "M U N C H   L E G I O N", 46, 80, 10.5, "rgba(255,255,255,.88)", true, "left");

  /* ---------- 右上角：设置 ---------- */
  {
    const gx = 1236, gy = 38;
    g.beginPath(); g.arc(gx, gy, 18, 0, 6.2832);
    fillStroke(g, "rgba(255,251,240,.92)", T.ink, 3);
    g.beginPath(); g.arc(gx, gy, 6.4, 0, 6.2832);
    fillStroke(g, "#8A6358", null, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.2832;
      g.fillStyle = "#8A6358";
      g.beginPath();
      g.arc(gx + Math.cos(a) * 12.4, gy + Math.sin(a) * 12.4, 2.7, 0, 6.2832);
      g.fill();
    }
  }

  /* ---------- 左上：今日目标 ----------
     主界面除了"能点的东西"，还必须回答"今天该做什么"。
     没有这一块，六只再可爱，玩家打开游戏也不知道第一步干嘛。 */
  {
    const x = 24, y = 104, w = 344, h = 118;
    card(g, x, y, w, h, 22, { fill: "rgba(255,251,240,.94)", sa: 0.18, dy: 4, lw: 3.6 });
    text(g, "今天", x + 18, y + 22, 11, "rgba(107,74,66,.62)", true, "left");
    text(g, "喂饱 2 只 · 带一只出门", x + 18, y + 44, 15, T.ink, true, "left");

    // 四条小目标。一行排四条会溢到卡外（v2 第一版就是这样），改 2×2
    const tasks = [["喂一只", 1], ["摸摸六只", 0], ["做件道具", 0], ["出门一趟", 0]];
    tasks.forEach((t, i) => {
      const tx = x + 18 + (i % 2) * 168;
      const ty = y + 70 + Math.floor(i / 2) * 24;
      g.beginPath(); g.arc(tx + 7, ty, 8, 0, 6.2832);
      fillStroke(g, t[1] ? "#8FE3BE" : "rgba(107,74,66,.10)",
                 t[1] ? "#4E8A6E" : "rgba(107,74,66,.26)", 2.2);
      if (t[1]) {
        g.strokeStyle = "#2F6B50"; g.lineWidth = 2.6; g.lineCap = "round";
        g.beginPath();
        g.moveTo(tx + 2.6, ty); g.lineTo(tx + 6, ty + 3.4); g.lineTo(tx + 11.4, ty - 3.4);
        g.stroke();
      }
      text(g, t[0], tx + 20, ty + 1, 10.5,
           t[1] ? "rgba(107,74,66,.46)" : "rgba(107,74,66,.74)", false, "left");
    });
  }

  save(cv, "concept2-1-家园.png");
}

/* ============================================================================
   三、战斗内 UI（三关对照）
   ----------------------------------------------------------------------------
   v1 的战斗图只画了一关，所以看不出"空间设计"。这一版同一天出三关，
   用**同一套 HUD** 去适配三种完全不同的空间结构：

     草甸（第 1 关）  横向  缓坡 + 木桥 + 长球道   → 教"推"
     深井（第 5 关）  纵向  交错圆石台 + 水滴       → 教"落"
     高塔（第 8 关）  阶梯  楼板 + 齿轮 + 高空       → 教"绕"

   HUD 分三级（判定标准：缩到 480px 宽还一眼读得出的才算一级）：
     一级  血量 / 肚子 / 目标进度   → 奶油纸实体卡，有描边有投影
     二级  关卡进度 / 道具槽        → 小一档的实体卡
     三级  操作提示                 → 无底、低对比

   为什么"肚子"是一级：它决定"再推一关还是收工回家"，是全游戏最重要的一次决策。
   ========================================================================== */

function woodPlat(g, x, y, w, h) {
  // 厚板：侧面深、顶面浅、一条顶光。厚度 26 是基准，别改
  const tk = h === undefined ? 26 : h;
  rr(g, x, y, w, tk, 8);
  fillStroke(g, "#B87F4E", T.ink, 4);
  rr(g, x + 4, y + 3, w - 8, tk * 0.34, 5);
  fillStroke(g, "#D9A870", null, 0);
  g.strokeStyle = "rgba(120,74,36,.28)";
  g.lineWidth = 2;
  for (let i = 1; i * 46 < w; i++) {
    g.beginPath();
    g.moveTo(x + i * 46, y + 5);
    g.lineTo(x + i * 46, y + tk - 4);
    g.stroke();
  }
}

function stonePlat(g, x, y, w, h) {
  const tk = h === undefined ? 24 : h;
  rr(g, x, y, w, tk, tk * 0.46);
  fillStroke(g, "#8E93A8", T.ink, 4);
  rr(g, x + 5, y + 3, w - 10, tk * 0.32, tk * 0.3);
  fillStroke(g, "#AEB3C6", null, 0);
  // 苔藓
  g.fillStyle = "rgba(122,196,140,.55)";
  for (let i = 0; i < w / 40; i++) {
    g.beginPath();
    g.ellipse(x + 16 + i * 38, y + 3, 9, 4, 0, 0, 6.2832);
    g.fill();
  }
}

/* ---------------------------------------------------------------------------
   平台拼接规范（v2.1）—— 这一条是"斜的没和横向接好"的根治

   平台不是"摆在一起的板子"，是**一根连续的梁**。三条硬规矩：

     1. **厚度统一 26**。斜坡原本 22、木桥 16、平台 26 —— 三个厚度就有三条
        不同的底面基线，接缝处必然错台。现在全用 PLAT_T。
     2. **端点必须压进平台内部 30px，由平台盖住毛边**，不能点对点对齐。
        点对点对齐时，平台的 8px 圆角会在接缝处露出一个豁口（v2 第一版就是
        这样，读成"平台被斜着砍了一刀"）。
     3. **接缝加"铁箍"**。即使压进去了，坡顶撞平台侧边仍会是一个锐角 V。
        加一块 34×30 的深色铁箍把夹角吃掉 —— 现实木工也这么干，顺带给了
        平台一套"手作感"的美术语言。
   ------------------------------------------------------------------------- */
const PLAT_T = 18;
// 厚度从 26 收到 18。依据：宠物高 120，26 → 比值 4.6:1，读成"厚水泥板"；
// 商业平台跳跃的参考比值是 6–8:1，18 → 6.7:1。
// 平台是"可以踩的地面"，不该比角色更有视觉重量。

/** 缓坡。两端 y 必须分别等于所接平台的**顶面** y */
function slope(g, x1, y1, x2, y2, t) {
  const th = t === undefined ? PLAT_T : t;
  // 端点导数归零 = 滑梯感；没有这个会读成"一块斜插进去的板"
  const midY = (y1 + y2) / 2 - 6;
  const top = () => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.quadraticCurveTo((x1 + x2) / 2, midY, x2, y2);
  };

  // ① 整体：上曲线 + 下曲线（垂直下移 th，不是法线偏移 —— 卡通里厚度永远朝地心）
  top();
  g.quadraticCurveTo((x1 + x2) / 2, midY + th, x1, y1 + th);
  g.closePath();
  fillStroke(g, "#B87F4E", T.ink, 4);   // 侧面 = 与 woodPlat 同一个深色

  // ② 顶面亮带：上曲线 + 上曲线下移 th*0.34
  top();
  g.quadraticCurveTo((x1 + x2) / 2, midY + th * 0.34, x1, y1 + th * 0.34);
  g.closePath();
  g.fillStyle = "#D9A870";
  g.fill();

  // ③ 坡上不画竖向木纹。试过一次：贝塞尔上取点算错方向、木纹会"扎"出坡面，
  //    而且坡只有 190px 长，3 根木纹的信息量抵不上出错风险。
  //    材质连续感靠"统一厚度 26 + 同色侧面 + 同款顶面亮带"就够了。

  // ④ 顶光：比原来的 4px 细淡，否则坡会读成"一块亮板"
  top();
  g.strokeStyle = "rgba(246,224,186,.55)";
  g.lineWidth = 2.6;
  g.lineCap = "round";
  g.stroke();
}

/** 铁箍：接缝处吃掉锐角，同时给平台一套"手作"语言 */
function brace(g, x, y, w, h, rot) {
  const W2 = w === undefined ? 34 : w;
  const H2 = h === undefined ? 30 : h;
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  rr(g, -W2 / 2, -H2 / 2, W2, H2, 8);
  fillStroke(g, "#8A5A34", T.ink, 3.6);
  // 两颗铆钉
  g.fillStyle = "#D9A870";
  for (const dy of [-H2 * 0.26, H2 * 0.26]) {
    g.beginPath(); g.arc(0, dy, 3.2, 0, 6.2832); g.fill();
  }
  g.restore();
}

/** Q 虫：三层壳 + 大眼 + 腮红。可爱化之后才配得上"被滚成球"这个命运 */
function bug(g, x, y, s) {
  const body = "#8FC46A";
  const dark = "#5E9445";
  // 腿
  g.strokeStyle = T.ink;
  g.lineWidth = s * 0.095;
  g.lineCap = "round";
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const yy = y - s * 0.50 + i * s * 0.20;
      g.beginPath();
      g.moveTo(x + sd * s * 0.28, yy);
      g.lineTo(x + sd * s * 0.62, yy + s * 0.16);
      g.stroke();
    }
  }
  // 身体
  g.beginPath();
  g.ellipse(x, y - s * 0.42, s * 0.48, s * 0.44, 0, 0, 6.2832);
  fillStroke(g, body, T.ink, s * 0.10);
  // 背甲分节
  g.strokeStyle = "rgba(52,88,34,.40)";
  g.lineWidth = s * 0.075;
  for (const dx of [-0.16, 0.16]) {
    g.beginPath();
    g.moveTo(x + dx * s, y - s * 0.82);
    g.quadraticCurveTo(x + dx * s * 1.4, y - s * 0.40, x + dx * s, y - s * 0.04);
    g.stroke();
  }
  // 触角
  g.strokeStyle = T.ink;
  g.lineWidth = s * 0.08;
  for (const sd of [-1, 1]) {
    g.beginPath();
    g.moveTo(x + sd * s * 0.15, y - s * 0.80);
    g.quadraticCurveTo(x + sd * s * 0.30, y - s * 1.06, x + sd * s * 0.40, y - s * 1.10);
    g.stroke();
    g.beginPath();
    g.arc(x + sd * s * 0.40, y - s * 1.10, s * 0.085, 0, 6.2832);
    fillStroke(g, "#FFD34E", T.ink, s * 0.05);
  }
  // 眼 + 腮红
  for (const sd of [-1, 1]) {
    g.beginPath();
    g.arc(x + sd * s * 0.18, y - s * 0.56, s * 0.13, 0, 6.2832);
    fillStroke(g, "#3B2B29", null, 0);
    g.fillStyle = "#FFFFFF";
    g.beginPath();
    g.arc(x + sd * s * 0.18 - s * 0.04, y - s * 0.60, s * 0.045, 0, 6.2832);
    g.fill();
    g.fillStyle = "rgba(255,132,146,.42)";
    g.beginPath();
    g.ellipse(x + sd * s * 0.34, y - s * 0.40, s * 0.09, s * 0.055, 0, 0, 6.2832);
    g.fill();
  }
}

function snowball(g, x, y, r) {
  g.beginPath(); g.arc(x, y, r, 0, 6.2832);
  fillStroke(g, "#FFFCF2", T.ink, Math.max(3, r * 0.16));
  g.fillStyle = "rgba(186,214,232,.55)";
  for (const p of [[-0.36, -0.24, 0.24], [0.30, 0.20, 0.19], [0.02, 0.48, 0.14]]) {
    g.beginPath(); g.arc(x + p[0] * r, y + p[1] * r, p[2] * r, 0, 6.2832); g.fill();
  }
  g.fillStyle = "rgba(255,255,255,.95)";
  g.beginPath(); g.arc(x - r * 0.32, y - r * 0.42, r * 0.18, 0, 6.2832); g.fill();
}

/* ---------------------------------------------------------------- HUD */

function hud(g, o) {
  /* ---- 左上：角色卡（一级） ---- */
  {
    const x = 20, y = 16, w = 312, h = 112;
    card(g, x, y, w, h, 28, { fill: T.cream, sa: 0.22, dy: 5, lw: 4 });

    // 头像：圆窗 + 一圈奶油底
    const acx = x + 58, acy = y + 56, ar = 40;
    g.save();
    g.beginPath(); g.arc(acx, acy, ar, 0, 6.2832); g.clip();
    g.fillStyle = "#FFF0D2";
    g.fillRect(acx - ar, acy - ar, ar * 2, ar * 2);
    drawPal(g, o.pet, acx, acy + ar * 1.62, ar * 2.1, "half");
    g.restore();
    g.beginPath(); g.arc(acx, acy, ar, 0, 6.2832);
    fillStroke(g, null, T.ink, 4);

    text(g, PALS[o.pet].name, x + 112, y + 32, 21, T.ink, true, "left");
    text(g, PALS[o.pet].sp + "　" + PALS[o.pet].role, x + 112, y + 55, 11, "rgba(107,74,66,.60)", false, "left");

    // 三心
    for (let i = 0; i < 3; i++) {
      heartShape(g, x + 124 + i * 27, y + 82, 10.5,
                 i < o.hearts ? "#FF7E96" : "rgba(107,74,66,.12)",
                 i < o.hearts ? T.ink : "rgba(107,74,66,.30)", 2.4);
    }
    // 血量数字只给一个小号：数字是给"算"的，心是给"看"的
    text(g, o.hearts + " / 3", x + w - 20, y + 84, 11, "rgba(107,74,66,.52)", false, "right");
  }

  /* ---- 顶部中：关卡进度（二级） ---- */
  {
    const x = 380, y = 18, w = 512, h = 54;
    g.fillStyle = "rgba(58,44,40,.52)";
    rr(g, x, y, w, h, 27); g.fill();
    g.strokeStyle = "rgba(255,255,255,.26)";
    g.lineWidth = 2;
    rr(g, x, y, w, h, 27); g.stroke();

    text(g, "第 " + o.stage + " 关", x + 26, y + h / 2, 15, "#FFF6E4", true, "left");
    text(g, o.stageName, x + 102, y + h / 2, 17, "#FFFFFF", true, "left");

    // 八个小点当成一条小路：走过的实心金，当前大一圈，未走空心
    for (let i = 0; i < 8; i++) {
      const px = x + 244 + i * 32;
      if (i < o.stage - 1) {
        g.beginPath(); g.arc(px, y + h / 2, 6, 0, 6.2832);
        fillStroke(g, T.lemon, null, 0);
      } else if (i === o.stage - 1) {
        g.beginPath(); g.arc(px, y + h / 2, 10, 0, 6.2832);
        fillStroke(g, T.lemon, T.ink2, 2.4);
        g.beginPath(); g.arc(px, y + h / 2, 4.2, 0, 6.2832);
        fillStroke(g, T.tanger, null, 0);
      } else {
        g.beginPath(); g.arc(px, y + h / 2, 5.4, 0, 6.2832);
        g.strokeStyle = "rgba(255,246,228,.40)"; g.lineWidth = 2.4; g.stroke();
      }
    }
  }

  /* ---- 右上：目标木牌（一级） ---- */
  {
    const x = 972, y = 16, w = 288, h = 118;
    card(g, x, y, w, h, 26, { fill: "#FFEBC6", sa: 0.22, dy: 5, lw: 4 });

    text(g, o.goalName, x + 22, y + 28, 14, "rgba(107,74,66,.66)", true, "left");
    text(g, o.goalNum, x + w - 22, y + 30, 26, T.ink, true, "right");

    // 进度条
    const bx = x + 22, by = y + 50, bw = w - 44, bh = 14;
    g.fillStyle = "rgba(107,74,66,.12)";
    rr(g, bx, by, bw, bh, 7); g.fill();
    g.fillStyle = T.tanger;
    rr(g, bx, by, Math.max(4, bw * o.goalK), bh, 7); g.fill();
    g.strokeStyle = "rgba(107,74,66,.28)"; g.lineWidth = 1.8;
    rr(g, bx, by, bw, bh, 7); g.stroke();

    // 收成 + 提示
    g.beginPath(); g.arc(x + 30, y + 88, 9, 0, 6.2832);
    fillStroke(g, "#F2764F", T.ink, 2.2);
    text(g, "收成 " + o.loot, x + 46, y + 89, 14, T.ink, true, "left");
    text(g, o.goalNote, x + w - 22, y + 89, 10.5, "rgba(107,74,66,.50)", false, "right");
  }

  /* ---- 左下：肚子（一级） ---- */
  {
    const x = 20, y = 636, w = 312, h = 68;
    card(g, x, y, w, h, 30, { fill: T.cream, sa: 0.22, dy: 5, lw: 4 });

    // 碗 + 三颗果
    const bx = x + 40, by = y + 40;
    g.beginPath();
    g.moveTo(bx - 21, by - 10);
    g.quadraticCurveTo(bx, by + 24, bx + 21, by - 10);
    g.closePath();
    fillStroke(g, "#EFB25E", T.ink, 3);
    for (const p of [[-9, -17], [1, -21], [11, -15]]) {
      g.beginPath(); g.arc(bx + p[0], by + p[1], 5.4, 0, 6.2832);
      fillStroke(g, "#F2764F", T.ink2, 1.8);
    }

    text(g, o.bellyTxt, x + 78, y + 22, 12, "rgba(107,74,66,.66)", true, "left");
    const px = x + 78, py = y + 34, pw = 156, ph = 15;
    g.fillStyle = "rgba(107,74,66,.12)";
    rr(g, px, py, pw, ph, 7); g.fill();
    g.fillStyle = o.bellyColor;
    rr(g, px, py, Math.max(4, pw * o.bellyK), ph, 7); g.fill();
    g.strokeStyle = "rgba(107,74,66,.28)"; g.lineWidth = 1.8;
    rr(g, px, py, pw, ph, 7); g.stroke();
    text(g, o.bellyMul, x + w - 22, y + 42, 15, o.bellyMulColor, true, "right");
  }

  /* ---- 右下：道具（二级） ---- */
  {
    for (let i = 0; i < 3; i++) {
      const x = 1088 + i * 66, y = 640, sz = 58;
      card(g, x, y, sz, sz, 17, { fill: "#FFF3DA", sa: 0.20, dy: 4, lw: 3.5 });
      const icx = x + sz / 2, icy = y + sz / 2 + 2;
      if (i === 0) {
        g.beginPath(); g.arc(icx, icy + 2, 13, 0, 6.2832);
        fillStroke(g, "#F2764F", T.ink, 2.6);
        g.fillStyle = "rgba(255,242,214,.94)";
        g.beginPath(); g.arc(icx - 4, icy - 3, 3.4, 0, 6.2832); g.fill();
        g.fillStyle = "#6FAE5A";
        g.beginPath(); g.ellipse(icx + 6, icy - 11, 6, 3.2, -0.6, 0, 6.2832); g.fill();
      } else if (i === 1) {
        g.beginPath();
        g.moveTo(icx - 15, icy + 2);
        g.quadraticCurveTo(icx, icy - 21, icx + 15, icy + 2);
        g.closePath();
        fillStroke(g, "#8FD9B6", T.ink, 2.6);
        rr(g, icx - 5, icy + 2, 10, 13, 4);
        fillStroke(g, T.cream, T.ink, 2.4);
      } else {
        g.beginPath();
        g.moveTo(icx, icy - 17);
        g.quadraticCurveTo(icx + 12, icy - 2, icx + 6, icy + 10);
        g.quadraticCurveTo(icx + 2, icy + 16, icx - 4, icy + 12);
        g.quadraticCurveTo(icx - 13, icy + 3, icx, icy - 17);
        g.closePath();
        fillStroke(g, "#FFA95E", T.ink, 2.6);
      }
      // 角标
      g.fillStyle = "rgba(107,74,66,.74)";
      rr(g, x + sz - 17, y + 4, 13, 13, 5); g.fill();
      text(g, String(i + 1), x + sz - 10.5, y + 11, 8.5, "#FFF6E4", true);
    }
  }

  /* ---- 三级：操作提示（无底、低对比） ---- */
  text(g, "J 糊球　·　K 冲刺　·　Shift 预瞄　·　ESC 回门口", 640, 714, 11.5,
       "rgba(255,255,255,.72)", false);
}

/* ---------------------------------------------------------------- 三套空间 */

function bgMeadow(g) {
  // 地平线从 470 下移到 536：原来 452 以下有 268px（占屏 37%）是纯空草地，
  // 游戏区被压成 y300–452 的一条缝，宠物 120 高就占了 79% —— 跳都跳不起来。
  const grd = g.createLinearGradient(0, 0, 0, 536);
  grd.addColorStop(0, "#84CEF0");
  grd.addColorStop(0.55, "#C4EAF9");
  grd.addColorStop(1, "#EEFBFF");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, 536);
  // 云分三层：上层重、中层淡、贴近地平线一层极淡 —— 这是"空气透视"，
  // 没有它，y150–450 是一整片平天空，读成"贴了个蓝底"。
  cloud(g, 176, 80, 27, 0.94);
  cloud(g, 720, 56, 21, 0.80);
  cloud(g, 1130, 108, 23, 0.86);
  cloud(g, 352, 246, 33, 0.62);
  cloud(g, 962, 300, 26, 0.50);
  cloud(g, 1238, 218, 20, 0.44);
  cloud(g, 120, 372, 24, 0.34);

  // 远山：试过用 #A9E0A0 / #8ACF84，和草地 #7ECC61 太接近，读成"草地隆起"而不是远山。
  // 远处的丘陵必须**更淡更灰**（空气透视），同时偏冷才有力地推开距离。
  hill(g, 522, 74, "#B7E4C4", 0.78, 0.5);
  hill(g, 540, 46, "#97D3A2", 0.92, 2.2);

  g.fillStyle = "#7ECC61";
  g.fillRect(0, 536, W, H - 536);
  g.fillStyle = "#8FD96E";
  g.fillRect(0, 536, W, 9);
  g.fillStyle = "#68B24E";
  g.fillRect(0, 646, W, H - 646);

  /* 平台：一条连续的路，不是四块摆在一起的板子。
     v2 第一版的三个毛病，全在"接缝"上：
       · 坡脚 (314,426) 正好压在平台 A 的 8px 圆角外侧 → 读成"平台被斜着砍了一刀"
       · 坡顶 (470,330) 撞平台 B 左端 → 一个锐角 V
       · 所谓"木桥" (666,330,134,16) 是**水平**的，却要连接 y=330 和 y=386 两块台
         → 右端悬空 56px，这是最刺眼的一处
     现在：坡脚/坡顶各压进平台内 30px（先画坡、后画台，由台盖住毛边），
     接缝补铁箍，桥改成真正连接两个高度的缓坡。 */
  slope(g, 284, 510, 452, 414, PLAT_T);          // 上坡：坡脚埋进平台 A
  slope(g, 640, 414, 800, 470, PLAT_T);          // 下坡：坡顶埋进平台 B

  woodPlat(g, 46, 510, 300, PLAT_T);             // A 地面台
  woodPlat(g, 452, 414, 230, PLAT_T);            // B 中台
  woodPlat(g, 800, 470, 420, PLAT_T);            // C 右台

  // 接缝铁箍：只在"坡顶撞平台边"的 T 型接缝处放。
  // 坡脚是"坡从平台顶面升起"，平台本身就把缺口盖住了，不需要箍 ——
  // 四个都放会读成一排糖块。旋转到局部坡度，才像"包住坡的箍"而不是按钮。
  // 铁箍试过 3 个：位置都在坡下方，读成"坡底装了个制动块"，比缺口更碍眼。
  // 真正的问题是**同一高度的两条水平线相接**时，平台 8px 圆角会留一个 8px 小凹口。
  // 解法不是补块，是把端头封平：在接缝那条竖线上画一条木端面。

  // 接缝端面：把平台圆角留下的小凹口封平（一条 4px 木端面 + 一条暗线）
  for (const jx of [314, 452, 666, 800]) {
    const jy = (jx === 314 ? 510 : jx === 800 ? 470 : 414);
    g.fillStyle = "#9E6B3F";
    g.fillRect(jx - 2, jy + 2, 4, PLAT_T - 4);
    g.fillStyle = "rgba(120,74,36,.5)";
    g.fillRect(jx - 0.5, jy + 2, 1, PLAT_T - 4);
  }

  // 抬高的台子必须有柱子。没有支撑的木板会读成"贴纸"
  for (const cx of [860, 1160]) {
    rr(g, cx - 9, 486, 18, 54, 5);
    fillStroke(g, "#A97244", T.ink, 3.5);
  }

  // 草
  for (const c of [[110, 596, 1], [560, 604, 0.9], [960, 598, 1.1], [1220, 592, 0.8]]) {
    g.strokeStyle = "rgba(50,120,54,.50)";
    g.lineWidth = 2.6 * c[2];
    g.lineCap = "round";
    for (const d of [-1.4, -0.5, 0.6, 1.5]) {
      g.beginPath();
      g.moveTo(c[0] + d * 4, c[1]);
      g.quadraticCurveTo(c[0] + d * 7, c[1] - 10, c[0] + d * 6 + 3, c[1] - 17 * c[2]);
      g.stroke();
    }
  }
}

function bgWell(g) {
  // 深井：纵向。上下要有"深"的感觉，所以背景是从井口光往下越来越暗
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "#4C4062");
  grd.addColorStop(0.34, "#3A3050");
  grd.addColorStop(1, "#241E33");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);

  // 井口的光：一个大的椭圆光斑 + 几道光柱
  g.fillStyle = "rgba(255,232,170,.13)";
  g.beginPath(); g.ellipse(640, 10, 330, 120, 0, 0, 6.2832); g.fill();
  for (const c of [[470, 0.06], [700, 0.05], [880, 0.04]]) {
    g.fillStyle = "rgba(255,232,170," + c[1] + ")";
    g.beginPath();
    g.moveTo(c[0] - 40, 0); g.lineTo(c[0] + 40, 0);
    g.lineTo(c[0] + 120, H); g.lineTo(c[0] - 60, H);
    g.closePath();
    g.fill();
  }

  // 两侧石壁
  for (const sd of [-1, 1]) {
    const x0 = sd < 0 ? 0 : W - 74;
    g.fillStyle = "#3A3350";
    g.fillRect(x0, 0, 74, H);
    g.strokeStyle = "rgba(120,110,150,.35)";
    g.lineWidth = 2;
    for (let y = 30; y < H; y += 62) {
      g.beginPath();
      g.moveTo(x0, y); g.lineTo(x0 + 74, y + 16);
      g.stroke();
    }
  }

  // 四层交错圆石台
  stonePlat(g, 130, 250, 300, 26);
  stonePlat(g, 380, 366, 260, 26);
  stonePlat(g, 690, 274, 330, 26);
  stonePlat(g, 236, 508, 420, 26);
  stonePlat(g, 860, 470, 300, 26);

  // 悬着的藤蔓
  g.strokeStyle = "rgba(120,180,130,.55)";
  g.lineWidth = 3.5;
  for (const c of [[120, 60, 130], [1180, 40, 180], [560, 20, 96], [980, 30, 120]]) {
    g.beginPath();
    g.moveTo(c[0], c[1]);
    g.quadraticCurveTo(c[0] + 18, c[1] + c[2] * 0.55, c[0] - 8, c[1] + c[2]);
    g.stroke();
  }

  // 荧光苔：深井里唯一的"温度"
  for (const c of [[190, 244, 5], [420, 360, 4], [740, 268, 6], [300, 502, 5], [900, 464, 4], [1000, 268, 5]]) {
    g.fillStyle = "rgba(150,240,190,.55)";
    g.beginPath(); g.arc(c[0], c[1], c[2], 0, 6.2832); g.fill();
    g.fillStyle = "rgba(150,240,190,.16)";
    g.beginPath(); g.arc(c[0], c[1], c[2] * 2.6, 0, 6.2832); g.fill();
  }

  // 水滴
  for (const c of [[540, 150, 1], [820, 190, 0.8], [340, 300, 0.7]]) {
    g.fillStyle = "rgba(190,230,255,.80)";
    g.beginPath();
    g.moveTo(c[0], c[1] - 10 * c[2]);
    g.quadraticCurveTo(c[0] + 6 * c[2], c[1] + 4 * c[2], c[0], c[1] + 8 * c[2]);
    g.quadraticCurveTo(c[0] - 6 * c[2], c[1] + 4 * c[2], c[0], c[1] - 10 * c[2]);
    g.fill();
  }
}

function bgTower(g) {
  // 高塔：云在脚底，是"很高"的唯一证据
  const grd = g.createLinearGradient(0, 0, 0, 400);
  grd.addColorStop(0, "#5FA8E8");
  grd.addColorStop(0.62, "#9AD2F2");
  grd.addColorStop(1, "#D8F0FC");
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);

  cloud(g, 300, 560, 40, 0.92);
  cloud(g, 900, 610, 46, 0.96);
  cloud(g, 120, 660, 30, 0.86);
  cloud(g, 1150, 520, 26, 0.72);

  // 背景塔身（远处另一座，制造"双塔"）
  for (const c of [[150, 0.20], [1120, 0.26]]) {
    g.fillStyle = "rgba(120,132,168," + c[1] + ")";
    rr(g, c[0] - 56, 120, 112, H - 120, 10);
    g.fill();
  }

  // 五层阶梯木楼板
  woodPlat(g, 40, 508, 300, 28);
  woodPlat(g, 250, 404, 250, 28);
  woodPlat(g, 480, 310, 260, 28);
  woodPlat(g, 740, 386, 240, 28);
  woodPlat(g, 950, 286, 290, 28);

  // 齿轮：塔的"机械"语言，也解释球为什么能一直滚
  const gear = (x, y, r, teeth) => {
    g.save();
    g.translate(x, y);
    g.fillStyle = "#C9A860";
    g.strokeStyle = T.ink;
    g.lineWidth = 3.5;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * 6.2832;
      g.save();
      g.rotate(a);
      rr(g, -r * 0.16, -r * 1.24, r * 0.32, r * 0.38, 3);
      g.fill(); g.stroke();
      g.restore();
    }
    g.beginPath(); g.arc(0, 0, r, 0, 6.2832);
    fillStroke(g, "#DDBE76", T.ink, 3.5);
    g.beginPath(); g.arc(0, 0, r * 0.34, 0, 6.2832);
    fillStroke(g, "#8A6A34", null, 0);
    g.restore();
  };
  // 齿轮必须"咬在楼板边"，悬空摆一个圆盘会被读成装饰
  gear(452, 336, 28, 10);
  gear(748, 412, 21, 8);

  // 绳索
  g.strokeStyle = "rgba(150,110,70,.70)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(420, 130); g.lineTo(420, 326);
  g.moveTo(1010, 130); g.lineTo(1010, 276);
  g.stroke();
}

function stageScene(g, kind) {
  if (kind === "meadow") bgMeadow(g);
  else if (kind === "well") bgWell(g);
  else bgTower(g);
}

const STAGES = {
  meadow: {
    file: "concept2-2-战斗-草甸.png",
    stage: 1, stageName: "苔原入口",
    goalName: "清场", goalNum: "剩 3 只", goalK: 0.55,
    goalNote: "长球道 594px",
    loot: 12, hearts: 3,
    bellyTxt: "满饱", bellyK: 0.92, bellyColor: "#7FD46A", bellyMul: "×1.0", bellyMulColor: "#4A8C46",
    pet: "cat",
    draw(g) {
      // 角色
      g.beginPath(); g.ellipse(132, 516, 40, 9, 0, 0, 6.2832);
      g.fillStyle = "rgba(60,48,40,.16)"; g.fill();
      drawPal(g, "cat", 132, 510, 120, "normal", { face: 1 });

      // 敌人
      bug(g, 212, 510, 46);
      bug(g, 268, 510, 46);
      bug(g, 880, 470, 44);

      // 球 + 轨迹
      g.save();
      g.setLineDash([8, 10]);
      g.strokeStyle = "rgba(255,255,255,.85)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(430, 596);
      g.quadraticCurveTo(520, 584, 700, 596);
      g.stroke();
      g.restore();
      snowball(g, 410, 596, 28);

      // 连锁飘字
      textO(g, "一球 3 只！", 700, 176, 42, "#FFE58A", "#6B3A12", 9, true);
      textO(g, "连锁 ×2　收成 +7", 700, 214, 15, "#FFF6E4", "#4A3024", 4, true);
    },
  },

  well: {
    file: "concept2-3-战斗-深井.png",
    stage: 5, stageName: "深井",
    goalName: "限球", goalNum: "剩 4 发", goalK: 0.4,
    goalNote: "缺口竖直对齐",
    loot: 21, hearts: 2,
    bellyTxt: "半饿", bellyK: 0.46, bellyColor: "#FFD86B", bellyMul: "×1.5", bellyMulColor: "#C98A18",
    pet: "ham",
    draw(g) {
      g.beginPath(); g.ellipse(310, 514, 42, 9, 0, 0, 6.2832);
      g.fillStyle = "rgba(20,16,30,.30)"; g.fill();
      drawPal(g, "ham", 310, 508, 116, "half", { face: 1 });

      bug(g, 480, 366, 42);
      bug(g, 780, 274, 44);

      // 落球：从上层掉到下一层，是深井关的核心动词
      g.save();
      g.setLineDash([7, 10]);
      g.strokeStyle = "rgba(220,240,255,.70)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(640, 300); g.lineTo(640, 490);
      g.stroke();
      g.restore();
      snowball(g, 560, 490, 26);
      // 落点涟漪
      g.strokeStyle = "rgba(190,240,255,.55)";
      g.lineWidth = 2.5;
      for (const r of [18, 30]) {
        g.beginPath(); g.ellipse(560, 508, r, r * 0.30, 0, 0, 6.2832); g.stroke();
      }

      textO(g, "掉了两层！", 700, 168, 38, "#B8F0FF", "#20344A", 8, true);
      textO(g, "从上往下砸中 2 只", 700, 204, 14, "#E4F6FF", "#20344A", 4, true);
    },
  },

  tower: {
    file: "concept2-4-战斗-高塔.png",
    stage: 8, stageName: "双塔",
    goalName: "不碎", goalNum: "保 8 层", goalK: 0.75,
    goalNote: "中间 260px 真空",
    loot: 34, hearts: 1,
    bellyTxt: "全饿 · 冲刺锁", bellyK: 0.14, bellyColor: "#FF8A72", bellyMul: "×0.6", bellyMulColor: "#C9483E",
    pet: "fox",
    draw(g) {
      g.beginPath(); g.ellipse(160, 516, 40, 9, 0, 0, 6.2832);
      g.fillStyle = "rgba(40,60,90,.24)"; g.fill();
      drawPal(g, "fox", 160, 510, 118, "hungry", { face: 1 });

      bug(g, 296, 508, 44);
      bug(g, 620, 310, 44);
      bug(g, 1130, 286, 44);

      // 球在两层之间：靠"绕"过去
      g.save();
      g.setLineDash([8, 11]);
      g.strokeStyle = "rgba(255,255,255,.75)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(420, 496);
      g.quadraticCurveTo(600, 388, 860, 372);
      g.stroke();
      g.restore();
      snowball(g, 400, 496, 26);

      textO(g, "差一点！", 690, 176, 40, "#FFE58A", "#5A3410", 9, true);
      textO(g, "跨塔这一跳要留余量", 690, 212, 14, "#FFF6E4", "#3A3024", 4, true);
    },
  },
};

function drawStage(kind) {
  const S = STAGES[kind];
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  stageScene(g, kind);
  S.draw(g);
  hud(g, {
    stage: S.stage, stageName: S.stageName,
    goalName: S.goalName, goalNum: S.goalNum, goalK: S.goalK, goalNote: S.goalNote,
    loot: S.loot, hearts: S.hearts,
    bellyTxt: S.bellyTxt, bellyK: S.bellyK, bellyColor: S.bellyColor,
    bellyMul: S.bellyMul, bellyMulColor: S.bellyMulColor,
    pet: S.pet,
  });
  save(cv, S.file);
}

/* ============================================================================
   四、结算
   ----------------------------------------------------------------------------
   结算是全游戏最重要的决策屏：它同时问两个问题
     "还要不要往里走？"（贪） 和 "今天是不是就到这儿？"（收）
   所以底部必须给**两个都能选**的出口，且各自带着明确的代价与收益：

     继续深入  +倍率 0.15、肚子 -16、失败重打
     收工回家  落袋、吃饱、今天结束

   只有一个"下一步"按钮的结算，等于把选择拿掉了。
   ========================================================================== */

function drawResult() {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  // 背景：用草甸关，压暗。玩家能认出"我刚刚在这儿"
  bgMeadow(g);
  woodPlat(g, 46, 510, 300, PLAT_T);
  bug(g, 168, 510, 46);
  bug(g, 228, 510, 46);
  drawPal(g, "cat", 128, 510, 120, "normal", { face: 1 });
  snowball(g, 930, 554, 30);
  g.fillStyle = "rgba(36,28,44,.86)";
  g.fillRect(0, 0, W, H);

  const cx = 300, cy = 58, cw = 680, ch = 604;
  card(g, cx, cy, cw, ch, 36, { fill: T.cream, dy: 10, sa: 0.40, lw: 5 });

  /* ---------- 抬头 ---------- */
  text(g, "第 3 关　泥沼　·　清场成功", cx + cw / 2, cy + 44, 18, "rgba(107,74,66,.66)", true);

  /* ---------- 过关印章 ---------- */
  {
    g.save();
    g.translate(cx + cw - 74, cy + 88);
    g.rotate(-0.20);
    g.globalAlpha = 0.94;
    rr(g, -60, -26, 120, 52, 9);
    fillStroke(g, "#E2554A", null, 0);
    g.strokeStyle = "#B03A31"; g.lineWidth = 3;
    rr(g, -54, -20, 108, 40, 6); g.stroke();
    text(g, "过 关", 0, 2, 25, "#FFF4EA", true);
    g.restore();
  }

  /* ---------- 评级奖章 ---------- */
  {
    const rx = cx + 132, ry = cy + 208, rr0 = 82;
    // 月桂叶必须沿圆弧布点 + 按切线旋转，竖排一排就成"两根虫"
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const ang = Math.PI * 0.5 + sd * (0.46 + i * 0.200);
        const lx = rx + Math.cos(ang) * (rr0 + 5);
        const ly = ry + Math.sin(ang) * (rr0 + 5);
        g.save();
        g.translate(lx, ly);
        g.rotate(ang + Math.PI / 2);
        g.beginPath(); g.ellipse(0, 0, 14.0, 6.2, 0, 0, 6.2832);
        fillStroke(g, i % 2 ? "#9FE3C2" : "#7FCBA8", "#4E8A6E", 2.1);
        g.restore();
      }
    }
    g.beginPath(); g.arc(rx, ry, rr0, 0, 6.2832);
    fillStroke(g, "#FFE9A8", T.ink, 5);
    g.beginPath(); g.arc(rx, ry, rr0 - 10, 0, 6.2832);
    g.strokeStyle = "#E0B44A"; g.lineWidth = 3; g.stroke();
    g.beginPath(); g.arc(rx, ry, rr0 - 21, 0, 6.2832);
    fillStroke(g, "#FFF8DE", null, 0);

    textO(g, "S", rx, ry + 4, 82, "#FFC93C", "#7A4A08", 7, true);
    text(g, "用时 47s ≤ 55s", rx, ry + 100, 11.5, "rgba(107,74,66,.64)", false);
    text(g, "造球 4 ≤ 5", rx, ry + 118, 11.5, "rgba(107,74,66,.64)", false);
  }

  /* ---------- 数据 ---------- */
  {
    const dx = cx + 280, dy = cy + 132;
    const rows = [
      ["送走", "9 / 9 只"],
      ["用时", "47.2 s"],
      ["造球", "4 颗"],
      ["最大一球", "4 只"],
      ["收成", "128 果"],
    ];
    rows.forEach((r, i) => {
      const y = dy + i * 42;
      text(g, r[0], dx, y, 13, "rgba(107,74,66,.56)", false, "left");
      text(g, r[1], dx + 296, y, 19, T.ink, true, "right");
      if (i < rows.length - 1) {
        g.strokeStyle = "rgba(107,74,66,.10)";
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(dx, y + 19); g.lineTo(dx + 296, y + 19); g.stroke();
      }
    });
  }

  /* ---------- 分割 ---------- */
  g.strokeStyle = "rgba(107,74,66,.16)";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx + 52, cy + 398); g.lineTo(cx + cw - 52, cy + 398); g.stroke();

  /* ---------- 这一趟的账 ---------- */
  {
    const bx = cx + 52, by = cy + 428;
    text(g, "这一趟走了 3 关", bx, by, 13.5, "rgba(107,74,66,.60)", false, "left");

    text(g, "128 果   ×   1.45   =", bx, by + 30, 16, T.ink, true, "left");
    text(g, "186", bx + 246, by + 30, 27, "#D97E2B", true, "left");

    // 倍率提示：告诉玩家"再贪一关更值"
    g.fillStyle = "rgba(255,180,84,.28)";
    rr(g, bx + 316, by + 14, 260, 34, 17); g.fill();
    g.strokeStyle = "rgba(217,126,43,.50)"; g.lineWidth = 2;
    rr(g, bx + 316, by + 14, 260, 34, 17); g.stroke();
    text(g, "再推一关 → 1.60", bx + 446, by + 31, 13, "#A85E16", true);
  }

  /* ---------- 两个出口 ---------- */
  btn(g, cx + 56, cy + 500, 268, 62, "继续深入", {
    sub: "倍率变 1.60 · 它又饿了", size: 22, r: 28, depth: 8,
  });
  btn(g, cx + 356, cy + 500, 268, 62, "收工回家", {
    face: T.cream2, dark: T.cream3, text: T.ink, size: 21, r: 28, depth: 8,
    sub: "+186 果 · 吃饱", subColor: "rgba(107,74,66,.55)",
  });

  save(cv, "concept2-5-结算.png");
}

/* --- 主入口 --- */
const ALL = { sheet: drawSheet2, home: drawHome,
  meadow: () => drawStage("meadow"),
  well: () => drawStage("well"),
  tower: () => drawStage("tower"), result: drawResult };
const keys = ONLY ? ONLY.split(",") : Object.keys(ALL);
for (const k of keys) {
  if (!ALL[k]) { console.error("未知输出：" + k); continue; }
  ALL[k]();
}
