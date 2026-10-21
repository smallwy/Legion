/* ============================================================================
   concept3-shot.js —— v3「混合生产」概念图
   ----------------------------------------------------------------------------
   为什么要新起一个脚本：

   v2 全部用矢量精绘。矢量能做到"尺寸精确、可切九宫格、可换文字、多分辨率"，
   但它的质感天花板就是**精致的扁平插画** —— 没有景深、没有环境光污染、
   没有材质。用户的原话是"像贴上去的"，这句话说的是生产方式，不是参数。

   v3 的解法是**分工**：
     · 背景插画层  → AI 出图（景深 / 光照 / 氛围，矢量做不了）
     · UI 控件层   → 矢量精绘（按钮面板必须能切图、能换字、能多分辨率，AI 做不了）
     · 合成规则    → UI 必须"吃环境光"，否则一样是贴上去的

   运行：
     NODE_PATH=<managed>/node_modules node client/concept/concept3-shot.js
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const K = require("./kit2.js");

const { T, F, rr, fs: fillStroke, shadow, card, btn, text, textO } = K;

const OUT = path.join(__dirname, "..", "shots");
const BG = path.join(OUT, "_ai-bench");
const W = 1280, H = 720;

const save = (cv, name) => {
  fs.writeFileSync(path.join(OUT, name), cv.toBuffer("image/png"));
  console.log("✓ " + name);
};

/* ============================================================================
   一、UI 吃环境光的四条规则
   ----------------------------------------------------------------------------
   这是"矢量 UI + AI 插画"能不能融合的**唯一关键**。把 v2 的纯色控件直接
   贴到 AI 插画上，会比原来更"贴"—— 因为插画层次丰富、控件层次为零，
   对比之下控件就是一张纸片。

   四条：
     1. **透**：控件底色 alpha ≤ 0.95，让插画的暖色透上来。别用 #FFF 纯白。
     2. **投影方向统一**：主光在左上，所有投影朝右下，与插画里宠物的影子一致。
        方向不一致是最刺眼的破绽 —— 玩家的眼睛会立刻发现"这个东西不在场景里"。
     3. **顶部内侧高光**：控件上沿画一条 2px 暖白，读成"被光打到的厚度"。
     4. **半透明玻璃质感**：底部 HUD 用渐变代替实心条，像雾一样过渡，
        不要一条硬边压在草地上（那是最典型的"贴"）。
   ========================================================================== */

/** 控件投影：永远朝右下，和插画主光一致 */
function uiShadow(g, x, y, w, h, r, dy) {
  g.save();
  g.fillStyle = "rgba(74,44,24,.24)";
  g.beginPath();
  if (r !== undefined && r > 0) {
    // 用 roundRect 的路径手写，避免依赖 rr 的副作用
    const D = dy === undefined ? 6 : dy;
    g.roundRect ? g.roundRect(x + 2, y + D, w, h, r) : g.rect(x + 2, y + D, w, h);
  } else {
    g.rect(x + 2, y + (dy === undefined ? 6 : dy), w, h);
  }
  g.fill();
  g.restore();
}

/** 玻璃控件：半透明暖白 + 向右下的投影 + 顶部内侧高光 */
function glass(g, x, y, w, h, r, opt) {
  const o = opt || {};
  const fill = o.fill || "rgba(255,251,240,.90)";
  const lw = o.lw === undefined ? 3.2 : o.lw;
  uiShadow(g, x, y, w, h, r, o.dy);
  rr(g, x, y, w, h, r);
  fillStroke(g, fill, o.stroke || "rgba(120,78,50,.72)", lw);
  // 顶部内侧高光：被光打到的那条厚度
  g.save();
  rr(g, x, y, w, h, r);
  g.clip();
  g.fillStyle = "rgba(255,255,255,.55)";
  g.fillRect(x, y, w, 2.4);
  g.restore();
}

/* ============================================================================
   一b、动感图元
   ----------------------------------------------------------------------------
   静态图要读出"正在发生"，靠三样东西，缺一样就变回贴纸：
     1. **一个未完成的动作**（手指正压在宠物身上）
     2. **一个衰减的拖影**（飘心由大变小、由实变透 —— 说明它在往上走）
     3. **一个需求信号**（气泡给出"现在该做什么"）
   ========================================================================== */

/** 需求气泡：白泡 + 朝下小尖角 + 内容图标（heart / food / play） */
function wantBubble(g, x, y, kind, sc) {
  const s0 = sc === undefined ? 1 : sc;
  const R = 22 * s0;
  uiShadow(g, x - R, y - R, R * 2, R * 2, R, 3);
  g.beginPath(); g.arc(x, y, R, 0, 6.2832);
  fillStroke(g, "rgba(255,252,246,.96)", "rgba(120,78,50,.68)", 2.8);
  // 尖角：从泡底往指向对象的反方向
  g.beginPath();
  g.moveTo(x - 5.5 * s0, y + R - 2.5 * s0);
  g.lineTo(x + 1.5 * s0, y + R + 9 * s0);
  g.lineTo(x + 6.5 * s0, y + R - 1.5 * s0);
  g.closePath();
  fillStroke(g, "rgba(255,252,246,.96)", "rgba(120,78,50,.68)", 2.6);

  if (kind === "heart") {
    const hx = x, hy = y + 1 * s0, sz = 8.2 * s0;
    g.beginPath();
    g.moveTo(hx, hy + sz * 0.78);
    g.bezierCurveTo(hx - sz * 1.42, hy - sz * 0.28, hx - sz * 0.58, hy - sz * 1.34, hx, hy - sz * 0.44);
    g.bezierCurveTo(hx + sz * 0.58, hy - sz * 1.34, hx + sz * 1.42, hy - sz * 0.28, hx, hy + sz * 0.78);
    g.closePath();
    fillStroke(g, "#FF8FA8", "rgba(150,60,84,.62)", 2);
  } else if (kind === "food") {
    g.beginPath(); g.arc(x, y + 2 * s0, 8.4 * s0, 0, 6.2832);
    fillStroke(g, "#FFB35E", "rgba(150,90,40,.62)", 2);
    g.strokeStyle = "#6B8E4E"; g.lineWidth = 2.6 * s0; g.lineCap = "round";
    g.beginPath(); g.moveTo(x, y - 6 * s0); g.quadraticCurveTo(x + 2 * s0, y - 12 * s0, x + 6 * s0, y - 13 * s0);
    g.stroke();
  } else {
    // play：一颗小球
    g.beginPath(); g.arc(x, y + 1 * s0, 8.2 * s0, 0, 6.2832);
    fillStroke(g, "#79CFF2", "rgba(50,110,150,.62)", 2);
    g.beginPath(); g.arc(x - 3 * s0, y - 2 * s0, 2.6 * s0, 0, 6.2832);
    fillStroke(g, "rgba(255,255,255,.85)", null, 0);
  }
}

/** 飘心：size 与 alpha 成对衰减 —— 这就是"正在往上飘"的唯一证据 */
function floatHeart(g, x, y, sz, alpha, rot) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.globalAlpha = alpha;
  g.beginPath();
  g.moveTo(0, sz * 0.72);
  g.bezierCurveTo(-sz * 1.30, -sz * 0.30, -sz * 0.52, -sz * 1.24, 0, -sz * 0.44);
  g.bezierCurveTo(sz * 0.52, -sz * 1.24, sz * 1.30, -sz * 0.30, 0, sz * 0.72);
  g.closePath();
  g.fillStyle = "#FF9EB6";
  g.fill();
  g.strokeStyle = "rgba(150,70,90,.70)";
  g.lineWidth = 1.8;
  g.stroke();
  g.restore();
}

/** 手指光标：圆润食指。UI 元素，必须和角色轮廓留 40px 净距 */
function finger(g, x, y, sc) {
  const s0 = sc === undefined ? 1 : sc;
  g.save();
  g.translate(x, y);
  g.scale(s0, s0);
  // 投影
  g.fillStyle = "rgba(74,44,24,.20)";
  g.beginPath(); g.ellipse(4, 6, 15, 22, -0.16, 0, 6.2832); g.fill();
  // 掌心
  rr(g, -11, 2, 22, 26, 10);
  fillStroke(g, "#FFE3CE", "rgba(120,78,50,.72)", 2.8);
  // 食指
  rr(g, -6.5, -26, 13, 32, 6.5);
  fillStroke(g, "#FFF0E2", "rgba(120,78,50,.72)", 2.8);
  // 指尖高光
  g.fillStyle = "rgba(255,255,255,.75)";
  g.beginPath(); g.ellipse(-1.5, -22, 3.4, 4.6, 0.2, 0, 6.2832); g.fill();
  g.restore();
}

/* ============================================================================
   二、主界面合成
   ----------------------------------------------------------------------------
   背景裁切：1536×1024（3:2）→ 裁成 16:9 → 1280×720
   源区域 y = 48..912，这样正好把右下角的生成水印切掉（水印在 y > 915）
   ========================================================================== */
async function drawHome3() {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  const bgPath = path.join(BG, "2D_mobile_game_home_screen_bac_2026-10-21T05-09-40.png");
  const bg = await loadImage(bgPath);
  // 源 1536×1024，取 y 48..912（864 高）→ 16:9
  g.drawImage(bg, 0, 48, 1536, 864, 0, 0, W, H);

  /* ---------- 底部 HUD：渐变雾，不是实心条 ----------
     实心条压在草地上 = 贴。雾状渐变 = 场景自带的空气。 */
  {
    // 第一版用 148px 高、.94 实心的雾，结果把整个前景花层压成一片米色 ——
    // 景深白做了。雾的职责是让控件"有落脚处"，不是盖住画面。
    // 收到 116px、顶部完全透明、底部只到 .80。
    const grd = g.createLinearGradient(0, H - 116, 0, H);
    grd.addColorStop(0, "rgba(255,247,232,0)");
    grd.addColorStop(0.55, "rgba(255,246,228,.42)");
    grd.addColorStop(1, "rgba(255,244,222,.80)");
    g.fillStyle = grd;
    g.fillRect(0, H - 116, W, 116);
  }

  /* ---------- 顶部：标题 ---------- */
  textO(g, "吧唧军团", 40, 52, 40, "#FFFFFF", "rgba(96,58,40,.58)", 9, true, "left");
  text(g, "M U N C H   L E G I O N", 44, 84, 10.5, "rgba(255,255,255,.92)", true, "left");

  /* ---------- 顶部：今日目标横条 ----------
     第一版是左上角 340×112 的方卡，正好压在小屋屋顶上 —— 卡片边缘和屋顶的
     红白条纹交错，读成"贴错了位置"。
     改成横贯信息条，走天空区域。商业化手游顶部本来就是一条信息带，
     而且横条薄，不会和场景体积打架。 */
  {
    const x = 396, y = 20, w = 604, h = 56;
    glass(g, x, y, w, h, 28, { fill: "rgba(255,250,240,.90)", lw: 3.4 });
    text(g, "今天", x + 22, y + 20, 10.5, "rgba(120,78,50,.60)", true, "left");
    text(g, "喂饱 2 只 · 带一只出门", x + 22, y + 39, 14, T.ink, true, "left");

    // 四条小目标：横排圆点 + 极短标签，靠右对齐
    const tasks = [["喂", 1], ["摸", 0], ["做", 0], ["闯", 0]];
    tasks.forEach((t, i) => {
      const tx = x + 286 + i * 42, ty = y + h / 2;
      g.beginPath(); g.arc(tx, ty, 9, 0, 6.2832);
      fillStroke(g, t[1] ? "#8FE3BE" : "rgba(120,78,50,.10)",
                 t[1] ? "#4E8A6E" : "rgba(120,78,50,.24)", 2.2);
      if (t[1]) {
        g.strokeStyle = "#2F6B50"; g.lineWidth = 2.6; g.lineCap = "round";
        g.beginPath();
        g.moveTo(tx - 4, ty); g.lineTo(tx - 0.6, ty + 3.4); g.lineTo(tx + 4.8, ty - 3.4);
        g.stroke();
      } else {
        text(g, t[0], tx, ty + 0.5, 9, "rgba(120,78,50,.56)", true);
      }
    });
    text(g, "1 / 4", x + w - 26, y + h / 2, 13, T.ink, true, "right");
  }

  /* ---------- 右上：设置齿轮 ---------- */
  {
    const gx = 1238, gy = 40;
    uiShadow(g, gx - 18, gy - 18, 36, 36, 18, 4);
    g.beginPath(); g.arc(gx, gy, 18, 0, 6.2832);
    fillStroke(g, "rgba(255,250,240,.90)", "rgba(120,78,50,.72)", 3);
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

  /* ---------- 互动层：本版**故意留空** ----------
     第一版在这里放了「兔子头上的需求气泡 + 三颗飘心 + 压在兔子身上的手指」，
     按兔子实测轮廓（x 20–115, y 185–275）算的 40px 净距。
     结果 AI 背景里那只"兔子"根本没在这个位置 —— 气泡落在空草地上，
     手指悬在路牌旁边，读成一个白色胶囊，**比原来的贴纸感更糟**。

     结论：**角色锚定的 UI 元素，前提是角色坐标可控**。
     AI 出整张场景 = 坐标随机 = 所有"贴着角色的 UI"都会落空。
     正确做法是角色层单独出（透明底）、由我按栅格排版，见 docs/混合生产管线.md。
     这一版只验证"矢量 HUD 能不能吃 AI 背景的环境光"，所以互动层留空。
  */

  /* ---------- 底部左：资源 ---------- */
  const hy = H - 92;
  {
    glass(g, 20, hy, 168, 62, 26, { fill: "rgba(255,252,244,.92)" });
    // 苹果
    g.beginPath(); g.arc(54, hy + 31, 15, 0, 6.2832);
    fillStroke(g, "#FF8A72", "rgba(120,78,50,.70)", 2.6);
    g.strokeStyle = "#6B8E4E"; g.lineWidth = 3; g.lineCap = "round";
    g.beginPath(); g.moveTo(54, hy + 17); g.quadraticCurveTo(57, hy + 9, 63, hy + 8); g.stroke();
    g.beginPath(); g.ellipse(64, hy + 12, 6, 3.4, -0.5, 0, 6.2832);
    fillStroke(g, "#8FD46C", null, 0);
    text(g, "248", 80, hy + 24, 22, T.ink, true, "left");
    text(g, "果子", 80, hy + 43, 10, "rgba(120,78,50,.58)", false, "left");
  }

  /* ---------- 底部中：今日互动 / 亲密度 ---------- */
  {
    glass(g, 200, hy, 196, 62, 26, { fill: "rgba(255,252,244,.92)" });
    text(g, "今天摸过", 218, hy + 22, 10.5, "rgba(120,78,50,.58)", false, "left");
    text(g, "4 / 6", 218, hy + 42, 17, T.ink, true, "left");
    // 六个小点，四个亮
    for (let i = 0; i < 6; i++) {
      g.beginPath(); g.arc(286 + i * 15, hy + 40, 5, 0, 6.2832);
      fillStroke(g, i < 4 ? "#FF9EB6" : "rgba(120,78,50,.12)",
                 i < 4 ? "rgba(150,70,90,.60)" : "rgba(120,78,50,.22)", 1.8);
    }
    glass(g, 408, hy, 196, 62, 26, { fill: "rgba(255,252,244,.92)" });
    text(g, "亲密度", 426, hy + 22, 10.5, "rgba(120,78,50,.58)", false, "left");
    text(g, "3 / 5", 426, hy + 42, 17, T.ink, true, "left");
    // 五颗心
    for (let i = 0; i < 5; i++) {
      const hx = 494 + i * 20, hyy = hy + 40, s = 7;
      g.beginPath();
      g.moveTo(hx, hyy + s * 0.72);
      g.bezierCurveTo(hx - s * 1.30, hyy - s * 0.30, hx - s * 0.52, hyy - s * 1.24, hx, hyy - s * 0.44);
      g.bezierCurveTo(hx + s * 0.52, hyy - s * 1.24, hx + s * 1.30, hyy - s * 0.30, hx, hyy + s * 0.72);
      g.closePath();
      fillStroke(g, i < 3 ? "#FF9EB6" : "rgba(120,78,50,.10)",
                 i < 3 ? "rgba(150,70,90,.62)" : "rgba(120,78,50,.24)", 1.9);
    }
    text(g, "还差 12 次", 426, hy + 54, 9, "rgba(120,78,50,.44)", false, "left");
  }

  /* ---------- 底部右：图鉴 / 背包 / 出门 ---------- */
  {
    const ic = [["图鉴", "4 / 6", "rgba(217,200,240,.94)"],
                ["背包", "12", "rgba(207,228,192,.94)"]];
    ic.forEach((it, i) => {
      const bx = 626 + i * 108, by = hy + 8, bw = 98, bh = 46;
      glass(g, bx, by, bw, bh, 23, { fill: it[2], lw: 3 });
      if (i === 0) {
        rr(g, bx + 13, by + 13, 15, 19, 3);
        fillStroke(g, "#FFFBEE", "rgba(120,78,50,.70)", 2.2);
        g.beginPath(); g.moveTo(bx + 20.5, by + 13); g.lineTo(bx + 20.5, by + 32);
        g.strokeStyle = "rgba(120,78,50,.70)"; g.lineWidth = 1.6; g.stroke();
      } else {
        rr(g, bx + 12, by + 17, 18, 14, 4);
        fillStroke(g, "#E2B474", "rgba(120,78,50,.70)", 2.2);
        g.beginPath(); g.arc(bx + 21, by + 17, 4.5, Math.PI, 0);
        g.strokeStyle = "rgba(120,78,50,.70)"; g.lineWidth = 2; g.stroke();
      }
      text(g, it[0], bx + 38, by + bh / 2 - 6, 13, T.ink, true, "left");
      text(g, it[1], bx + 38, by + bh / 2 + 9, 10.5, "rgba(120,78,50,.60)", false, "left");
    });

    // 出门：主按钮。厚底 + 顶面高光 = 静态图也能读出"按下去会动"
    btn(g, 858, hy + 2, 402, 58, "出　门", {
      sub: "带 星屑 · 苔原 3 / 8", size: 25, r: 28, depth: 8,
    });
  }

  /* ---------- 动感元素：一行飘字 ----------
     静态图表达"正在发生"的三件套：飘字 + 半透明衰减 + 轻微的错位拖影 */
  {
    text(g, "+1", 92, hy - 18, 17, "rgba(255,140,110,.92)", true, "left");
    text(g, "+1", 96, hy - 30, 11, "rgba(255,140,110,.40)", true, "left");
  }

  save(cv, "concept3-1-家园-AI混合.png");
}

(async () => {
  await drawHome3();
})().catch((e) => { console.error(e); process.exit(1); });
