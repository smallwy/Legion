/* ============================================================================
   concept4-motion.js —— 宠物行为动效分解图
   ----------------------------------------------------------------------------
   回答用户的第 3 条：「这些动物在场的话，有自己的特色，比如能自己动，
   具有一定的动效，摸的时候也有动作反应」。

   核心判断：**性格差异不是长得不一样，是对同一个输入做不同反应。**
   同一根手指摸下去，猫歪头、狗顶上来、仓鼠倒向手、兔子弹起来、牛继续睡、
   狐炸开一圈星尘 —— 这才是"有性格"。所以这张图的主体不是立绘，是**反应**。

   三条必须讲清楚的技术事实：

     1. **动画分三层，优先级不同**。呼吸层常驻不许打断（打断就不像活的）；
        自主行为层随机触发；响应层被玩家触发时**覆盖**自主行为。三层同时跑才自然。
     2. **静态图只能"暗示"动**，靠三样东西：残影（说明在移动）、轨迹弧线
        （说明方向）、挤压拉伸（说明有重量）。这三样在引擎里也是真实实现的，
        不是画上去的装饰。
     3. **每只的呼吸相位必须错开**。六只同步呼吸 = 六个机器。规格里给了错开值。

   用法：
     NODE_PATH=<managed>/node_modules node client/concept/concept4-motion.js
   ========================================================================== */

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const K = require("./kit2.js");

const T = K.T;
const F = K.F;
const rr = K.rr;

/* ============================================================================
   六只的行为定义
   ----------------------------------------------------------------------------
   touch = 被摸时的反应（响应层，最高优先级）
   self  = 自己闲着时会做的事（自主行为层）
   两者都只写**引擎能做的变换**：位移 / 旋转 / 挤压拉伸 / 透明度 / 残影。
   不写"改表情"这类需要换图的东西 —— 换图意味着六只各要六张脸，成本乘以六。
   ========================================================================== */
const ACTS = [
  {
    f: "sugar-stand@v1", name: "砂糖", sp: "尖耳猫", color: "#FFC98A", ink: "#8B5030",
    trait: "别扭，先装不在乎",
    touch: {
      rot: 0.13, dy: 3, sx: 1.03, sy: 0.97,
      fx: ["tilt", "que"],
      txt: "先愣 100ms，再歪头贴向手",
    },
    self: {
      rot: -0.05, dy: 0, sx: 0.94, sy: 1.05,
      fx: ["spin"],
      txt: "追着自己的尾巴原地转一圈",
    },
  },
  {
    f: "nian-gao-dog@v1", name: "年糕", sp: "短尾犬", color: "#FFE0A4", ink: "#8B6535",
    trait: "你不摸它它就凑过来",
    touch: {
      rot: 0, dy: -7, sx: 0.97, sy: 1.05,
      fx: ["wag", "wagfast"],
      txt: "头往上顶，尾巴转速 ×3",
    },
    self: {
      rot: 0, dy: 0, sx: 1, sy: 1, ghost: true,
      fx: ["chase", "ball"],
      txt: "追着球跑过院子（有位移）",
    },
  },
  {
    f: "tuan-zi-ham@v1", name: "团子", sp: "胖仓鼠", color: "#FFD57C", ink: "#8E6630",
    trait: "被摸就整只倒过去",
    touch: {
      rot: 0.20, dy: 2, sx: 1.06, sy: 0.94,
      fx: ["puff", "lean"],
      txt: "颊袋抖一下，整个人倒向手",
    },
    self: {
      rot: 0, dy: 0, sx: 1, sy: 1,
      fx: ["cheek", "swallow"],
      txt: "往嘴里塞东西，颊袋鼓起来",
    },
  },
  {
    f: "xue-tuan-rab@v1", name: "雪团", sp: "长耳兔", color: "#FFF4F8", ink: "#B06A8C",
    trait: "一点就炸的那种活泼",
    touch: {
      rot: -0.06, dy: -30, sx: 0.93, sy: 1.08,
      fx: ["hop", "earsnap"],
      txt: "耳朵先弹，整只跳起来转半圈",
    },
    self: {
      rot: 0, dy: 0, sx: 1, sy: 1, ghost: true,
      fx: ["tripjump"],
      txt: "三连跳横穿院子（有位移）",
    },
  },
  {
    f: "dou-nai-ox@v1", name: "豆奶", sp: "老实牛", color: "#CBDCF2", ink: "#5E7398",
    trait: "懒得理你，但尾巴诚实",
    touch: {
      rot: 0.02, dy: 1, sx: 1.01, sy: 0.99,
      fx: ["zzz", "tailswish"],
      txt: "睁一只眼看你，然后继续睡",
    },
    self: {
      rot: 0.03, dy: 2, sx: 1.02, sy: 0.98,
      fx: ["yawn", "tailswish"],
      txt: "打个哈欠，往垫子里陷下去",
    },
  },
  {
    f: "xing-xie-fox@v1", name: "星屑", sp: "影狐", color: "#FFA97C", ink: "#A04E2E",
    trait: "每次反应都不一样",
    touch: {
      rot: -0.08, dy: -4, sx: 1.02, sy: 0.98,
      fx: ["burst"],
      txt: "眯眼笑，星尘炸开一圈，分身一起蹭",
    },
    self: {
      rot: 0, dy: 0, sx: 1, sy: 1, ghost: true,
      fx: ["blink", "sparkle"],
      txt: "原地消失，出现在院子另一边",
    },
  },
];

const W = 1660;
const PAD = 40;
const CELLW = (W - PAD * 2) / 6;
const H_ART = 268;          // 每格宠物区的净高
const ROW1 = 112;           // 被摸的瞬间
const ROW2 = ROW1 + H_ART + 168;
const H = ROW2 + H_ART + 372;

(async () => {
  const imgs = {};
  for (const a of ACTS) imgs[a.f] = await loadImage("client/shots/ai/" + a.f + ".png");

  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFBF0";
  g.fillRect(0, 0, W, H);

  /* ---------------- 标题 ---------------- */
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.font = F(26, true);
  g.fillStyle = T.ink;
  g.fillText("宠物行为 · 动效分解", PAD, 42);
  g.font = F(13, false);
  g.fillStyle = "rgba(107,74,66,.62)";
  g.fillText("性格差异不靠长相，靠「同一个输入，不同的反应」。以下每一帧都是引擎里真实能做的变换。", PAD, 70);

  /* ---------------- 两排 ---------------- */
  drawRow(ROW1, "touch", "①  被摸的瞬间 · 同一根手指，六种反应", "响应层 · 玩家触发，覆盖自主行为");
  drawRow(ROW2, "self", "②  它自己闲着时会做什么 · 每只三个专属动作", "自主行为层 · 6–14s 随机触发，带位移");

  /* ---------------- 底部：三层动画栈 + 参数表 ---------------- */
  drawStack(ROW2 + H_ART + 132);

  fs.writeFileSync("client/shots/concept4-动效分解.png", cv.toBuffer("image/png"));
  console.log("✓ client/shots/concept4-动效分解.png  " + W + "×" + H);

  /* ==========================================================================
     绘制：一排
     ========================================================================== */
  function drawRow(y0, key, title, sub) {
    g.textAlign = "left";
    g.font = F(16, true);
    g.fillStyle = T.ink;
    g.fillText(title, PAD, y0 - 26);
    g.font = F(11.5, false);
    g.fillStyle = "rgba(107,74,66,.50)";
    g.fillText(sub, PAD + 430, y0 - 25);

    ACTS.forEach((a, i) => {
      const x0 = PAD + i * CELLW;
      const cx = x0 + CELLW / 2;
      const d = a[key];

      // 格子底：极浅的角色主色，用来暗示"这一格是谁的"
      g.save();
      rr(g, x0 + 6, y0, CELLW - 12, H_ART, 18);
      g.fillStyle = a.color + "22";
      g.fill();
      g.strokeStyle = a.color + "55";
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();

      /* ---- 立绘：用变换表达动作 ---- */
      const im = imgs[a.f];
      const bodyH = 196;
      const s = bodyH / im.height;
      const dw = im.width * s;
      const baseX = cx - dw / 2;
      const baseY = y0 + H_ART - 30;            // 脚底基线

      // 全部画在格子内。残影原本会甩到隔壁格、压到上一排的文字上 ——
      // 那读成"三只重叠的宠物"，不是"在移动"。
      g.save();
      rr(g, x0 + 6, y0, CELLW - 12, H_ART, 18);
      g.clip();

      // 残影：向左拖尾（立绘本身略右偏，向左拉开才不会撞格）。透明度三档递增
      if (d.ghost) {
        for (let k = 3; k >= 1; k--) {
          g.save();
          g.globalAlpha = 0.07 + k * 0.04;
          g.translate(baseX + dw / 2 - k * 19, baseY);
          g.rotate((d.rot || 0) - k * 0.028);
          g.scale(d.sx || 1, d.sy || 1);
          g.drawImage(im, -dw / 2, -bodyH + (d.dy || 0), dw, bodyH);
          g.restore();
        }
      }

      // 主图：绕脚底中点旋转（绕中心转会读成"飘"）
      g.save();
      g.translate(baseX + dw / 2, baseY);
      g.rotate(d.rot || 0);
      g.scale(d.sx || 1, d.sy || 1);
      g.drawImage(im, -dw / 2, -bodyH + (d.dy || 0), dw, bodyH);
      g.restore();

      g.restore();   // 解除格子 clip

      // 落地阴影：脚底基线以下，跟着挤压变宽变淡
      shadowFor(g, cx, baseY + 4, dw * 0.30 * (d.sx || 1),
                d.dy && d.dy < 0 ? Math.max(0.30, 1 + d.dy / 90) : 1);

      // 手指光标：贴着头顶。离得远就读成"格子上挂了个手指"，不是"在摸它"
      if (key === "touch") {
        fingerAt(g, cx + dw * 0.30, baseY - bodyH + (d.dy || 0) + 34, 0.92);
      }

      /* ---- 特效 ---- */
      const fxY = baseY - bodyH * 0.56;
      for (const fx of d.fx) drawFx(g, fx, cx, fxY, bodyH, a);

      /* ---- 文字 ---- */
      g.textAlign = "center";
      g.font = F(15, true);
      g.fillStyle = T.ink;
      g.fillText(a.name, cx, y0 + H_ART + 26);

      g.font = F(11, false);
      g.fillStyle = "rgba(107,74,66,.56)";
      g.fillText(a.trait, cx, y0 + H_ART + 46);

      g.font = F(11.5, true);
      g.fillStyle = "rgba(107,74,66,.80)";
      wrapText(g, d.txt, cx, y0 + H_ART + 70, CELLW - 22, 15);
    });
  }

  /** 把立绘按行为参数变换后画出来。baseX/baseY 只给"主图"用，残影走中心定位 */
  function transformDraw(ctx, im, d, dw, dh, extraRot, baseY, baseX) {
    const cx = baseX === undefined ? 0 : baseX + dw / 2;
    const cy = baseY === undefined ? 0 : baseY + dh;
    ctx.save();
    if (baseX !== undefined) {
      // 绕脚底中点旋转 —— 绕中心转会读成"飘"，绕脚底才读成"站着的身体在倾"
      ctx.translate(cx, cy);
      ctx.rotate((d.rot || 0) + (extraRot || 0));
      ctx.scale(d.sx || 1, d.sy || 1);
      ctx.drawImage(im, -dw / 2, -dh + (d.dy || 0), dw, dh);
    } else {
      ctx.drawImage(im, -dw / 2, -dh, dw, dh);
    }
    ctx.restore();
  }

  function shadowFor(ctx, cx, cy, rx, k) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(6, rx), Math.max(2.5, rx * 0.26 * k), 0, 0, 6.2832);
    ctx.fillStyle = "rgba(74,44,24," + (0.10 + 0.14 * k) + ")";
    ctx.fill();
  }

  /* ==========================================================================
     特效图元 —— 每一种都对应引擎里的一个真实做法
     ========================================================================== */
  function drawFx(ctx, kind, cx, cy, h, a) {
    const ink = a.ink;
    switch (kind) {
      // 歪头：一条沿倾斜方向的短弧 + 一个问号（"它没想到你会摸"）
      case "tilt": {
        ctx.strokeStyle = ink + "88";
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx - h * 0.30, cy - h * 0.30, h * 0.20, Math.PI * 1.05, Math.PI * 1.55);
        ctx.stroke();
        break;
      }
      case "que": {
        textQ(ctx, "?", cx - h * 0.34, cy - h * 0.42, h * 0.20, ink);
        break;
      }
      // 摇尾：三道递增的弧线（右侧），说明尾巴在加速摆
      case "wag":
      case "wagfast": {
        const n = kind === "wagfast" ? 4 : 2;
        const sp = kind === "wagfast" ? 1.5 : 1;
        ctx.strokeStyle = ink + "77";
        ctx.lineWidth = 2.6;
        ctx.lineCap = "round";
        for (let i = 0; i < n; i++) {
          const r = h * (0.20 + i * 0.075) * sp;
          ctx.beginPath();
          ctx.arc(cx + h * 0.36, cy + h * 0.18, r, -0.85, 0.85);
          ctx.stroke();
        }
        break;
      }
      // 追尾转圈：一个带箭头的整圆
      case "spin": {
        ctx.strokeStyle = ink + "66";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(cx, cy + h * 0.42, h * 0.42, h * 0.13, 0, 0, Math.PI * 1.72);
        ctx.stroke();
        arrowHead(ctx, cx + h * 0.42, cy + h * 0.42, 0.6, ink + "66");
        break;
      }
      // 颊袋抖：脸颊两侧各三道短横线
      case "puff": {
        ctx.strokeStyle = ink + "88";
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        for (const sd of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const yy = cy - h * 0.06 + i * h * 0.075;
            ctx.beginPath();
            ctx.moveTo(cx + sd * (h * 0.28 + i * 3), yy);
            ctx.lineTo(cx + sd * (h * 0.38 + i * 3), yy);
            ctx.stroke();
          }
        }
        break;
      }
      // 倒向手：一条从头顶指向手指方向的长弧
      case "lean": {
        ctx.strokeStyle = ink + "55";
        ctx.lineWidth = 2.6;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(cx + h * 0.10, cy - h * 0.30);
        ctx.quadraticCurveTo(cx + h * 0.26, cy - h * 0.10, cx + h * 0.40, cy + h * 0.02);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      // 跳起：向上箭头 + 两道起跳风线
      case "hop":
      case "tripjump": {
        ctx.strokeStyle = ink + "66";
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        const n = kind === "tripjump" ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const dy = h * 0.32 + i * 14;
          ctx.beginPath();
          ctx.moveTo(cx - h * 0.24 + i * 8, cy + dy);
          ctx.lineTo(cx - h * 0.14 + i * 8, cy + dy + h * 0.10);
          ctx.stroke();
        }
        arrowUp(ctx, cx + h * 0.26, cy - h * 0.10, h * 0.11, ink + "77");
        break;
      }
      // 耳朵弹：头顶两道向外弹的弧
      case "earsnap": {
        ctx.strokeStyle = ink + "88";
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        for (const sd of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + sd * h * 0.10, cy - h * 0.46, h * 0.14, sd > 0 ? -0.3 : Math.PI * 0.85,
                  sd > 0 ? 0.9 : Math.PI * 1.95);
          ctx.stroke();
        }
        break;
      }
      // Zzz：三颗递减
      case "zzz": {
        ctx.textAlign = "left";
        for (let i = 0; i < 3; i++) {
          ctx.font = F(11 + i * 3, true);
          ctx.fillStyle = "rgba(94,115,152," + (0.75 - i * 0.18) + ")";
          ctx.fillText("z", cx + h * 0.26 + i * 9, cy - h * 0.30 - i * 13);
        }
        break;
      }
      // 打哈欠：张嘴方向一道大弧 + 一颗 Z
      case "yawn": {
        ctx.strokeStyle = ink + "66";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(cx, cy + h * 0.10, h * 0.13, -0.2, Math.PI + 0.2);
        ctx.stroke();
        ctx.font = F(16, true);
        ctx.fillStyle = "rgba(94,115,152,.62)";
        ctx.textAlign = "left";
        ctx.fillText("z", cx + h * 0.28, cy - h * 0.34);
        break;
      }
      // 甩尾（牛）：尾巴侧一条来回的弧 + 双向箭头
      case "tailswish": {
        ctx.strokeStyle = ink + "77";
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        for (const sd of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + h * 0.34, cy + h * 0.22);
          ctx.quadraticCurveTo(cx + h * 0.44, cy + h * 0.22 + sd * h * 0.10,
                               cx + h * 0.52, cy + h * 0.20 + sd * h * 0.16);
          ctx.stroke();
        }
        break;
      }
      // 追球：一条抛物虚线 + 一颗球
      case "chase": {
        ctx.strokeStyle = ink + "55";
        ctx.lineWidth = 2.2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(cx - h * 0.30, cy + h * 0.46);
        ctx.quadraticCurveTo(cx, cy + h * 0.02, cx + h * 0.34, cy + h * 0.30);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "ball": {
        ctx.beginPath();
        ctx.arc(cx + h * 0.38, cy + h * 0.34, h * 0.055, 0, 6.2832);
        ctx.fillStyle = "#79CFF2";
        ctx.fill();
        ctx.strokeStyle = "rgba(50,110,150,.72)";
        ctx.lineWidth = 1.8;
        ctx.stroke();
        break;
      }
      // 塞东西 / 咽下去
      case "cheek": {
        ctx.beginPath();
        ctx.arc(cx, cy + h * 0.12, h * 0.075, 0, 6.2832);
        ctx.fillStyle = "#D9636B";
        ctx.fill();
        ctx.strokeStyle = "rgba(120,60,60,.6)";
        ctx.lineWidth = 1.8;
        ctx.stroke();
        break;
      }
      case "swallow": {
        arrowUp(ctx, cx, cy - h * 0.06, h * 0.08, ink + "66");
        break;
      }
      // 星尘爆发：一圈四角星
      case "burst": {
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * 6.2832 + 0.3;
          const r = h * (0.36 + (i % 3) * 0.075);
          sparkle(ctx, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.82,
                  h * (0.030 + (i % 2) * 0.014), "#F5C542");
        }
        break;
      }
      case "sparkle": {
        for (let i = 0; i < 5; i++) {
          const ang = -0.5 + i * 0.62;
          sparkle(ctx, cx + Math.cos(ang) * h * 0.42, cy + Math.sin(ang) * h * 0.30,
                  h * 0.028, "#F5C542");
        }
        break;
      }
      // 分身：右侧一个半透明的自己（用轮廓剪影近似）
      case "clone": {
        ctx.save();
        ctx.globalAlpha = 0.20;
        ctx.beginPath();
        ctx.ellipse(cx + h * 0.34, cy + h * 0.10, h * 0.20, h * 0.28, 0, 0, 6.2832);
        ctx.fillStyle = a.ink;
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = a.ink + "66";
        ctx.lineWidth = 1.8;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.ellipse(cx + h * 0.34, cy + h * 0.10, h * 0.20, h * 0.28, 0, 0, 6.2832);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      // 消失再出现：两个淡圈 + 中间虚线
      case "blink": {
        ctx.strokeStyle = a.ink + "55";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(cx - h * 0.34, cy);
        ctx.lineTo(cx + h * 0.34, cy);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const sd of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + sd * h * 0.38, cy, h * 0.06, h * 0.16, 0, 0, 6.2832);
          ctx.stroke();
        }
        break;
      }
      default: break;
    }
  }

  /* ==========================================================================
     底部：三层动画栈
     ========================================================================== */
  function drawStack(y0) {
    g.textAlign = "left";
    g.font = F(16, true);
    g.fillStyle = T.ink;
    g.fillText("三层动画栈 · 必须分开跑，否则会打架", PAD, y0 - 8);

    const layers = [
      { name: "L1 呼吸层", always: "常驻 · 永不打断", p: "scaleY 0.985↔1.015 + 头部上下 1.5px", t: "2800ms 循环，六只相位错开 300ms", c: "#8FE3BE" },
      { name: "L2 自主行为层", always: "随机触发", p: "位移 / 旋转 / 挤压拉伸 / 残影", t: "间隔 6000–14000ms 随机（泊松分布）", c: "#79CFF2" },
      { name: "L3 响应层", always: "玩家触发 · 最高优先级", p: "覆盖 L2，但不打断 L1", t: "预判 90ms → 反应 320ms → 回落 280ms", c: "#FFB7CC" },
    ];

    const bw = (W - PAD * 2 - 24) / 3;
    layers.forEach((l, i) => {
      const x = PAD + i * (bw + 12);
      rr(g, x, y0 + 14, bw, 118, 16);
      g.fillStyle = "#FFFFFF";
      g.fill();
      g.strokeStyle = l.c;
      g.lineWidth = 2.4;
      g.stroke();

      // 色条
      rr(g, x, y0 + 14, 7, 118, 3);
      g.fillStyle = l.c;
      g.fill();

      g.font = F(14.5, true);
      g.fillStyle = T.ink;
      g.fillText(l.name, x + 20, y0 + 38);
      g.font = F(10.5, true);
      g.fillStyle = "rgba(107,74,66,.52)";
      g.fillText(l.always, x + 20, y0 + 58);
      g.font = F(11.5, false);
      g.fillStyle = "rgba(107,74,66,.80)";
      g.fillText(l.p, x + 20, y0 + 82);
      g.fillStyle = "rgba(107,74,66,.58)";
      g.font = F(11, false);
      g.fillText(l.t, x + 20, y0 + 104);
    });

    // 一条总纪律
    g.font = F(12, true);
    g.fillStyle = "rgba(107,74,66,.66)";
    g.fillText("⚠  六只同步呼吸 = 六个机器。相位必须错开，否则一眼看出是同一个动画复用的。", PAD, y0 + 158);
    g.font = F(11.5, false);
    g.fillStyle = "rgba(107,74,66,.50)";
    g.fillText("静态图用残影 / 轨迹弧线 / 挤压拉伸来暗示动；这三样在引擎里也是真实实现的变换，不是画上去的装饰。", PAD, y0 + 180);
  }

  /* ==========================================================================
     小图元
     ========================================================================== */
  function fingerAt(ctx, x, y, sc) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.fillStyle = "rgba(74,44,24,.16)";
    ctx.beginPath();
    ctx.ellipse(4, 6, 13, 19, -0.16, 0, 6.2832);
    ctx.fill();
    rr(g, -10, 2, 20, 23, 9);
    g.fillStyle = "#FFE3CE";
    g.fill();
    g.strokeStyle = "rgba(120,78,50,.68)";
    g.lineWidth = 2.4;
    g.stroke();
    rr(g, -6, -23, 12, 28, 6);
    g.fillStyle = "#FFF0E2";
    g.fill();
    g.stroke();
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.beginPath();
    ctx.ellipse(-1.5, -19, 3, 4.2, 0.2, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }

  function sparkle(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + r * 0.22, y - r * 0.22, x + r, y);
    ctx.quadraticCurveTo(x + r * 0.22, y + r * 0.22, x, y + r);
    ctx.quadraticCurveTo(x - r * 0.22, y + r * 0.22, x - r, y);
    ctx.quadraticCurveTo(x - r * 0.22, y - r * 0.22, x, y - r);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function arrowHead(ctx, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(-s * 6, -s * 4);
    ctx.lineTo(0, 0);
    ctx.lineTo(-s * 6, s * 4);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  function arrowUp(ctx, x, y, s, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y + s * 1.6);
    ctx.lineTo(x, y - s * 1.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.5);
    ctx.lineTo(x, y - s * 1.8);
    ctx.lineTo(x + s, y - s * 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function textQ(ctx, s, x, y, size, color) {
    ctx.save();
    ctx.font = F(size, true);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  /** 按宽度折行，最多三行 */
  function wrapText(ctx, s, cx, y, maxW, lh) {
    const chars = s.split("");
    let line = "", n = 0;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, y + n * lh);
        line = chars[i];
        n++;
        if (n >= 3) return;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, cx, y + n * lh);
  }
})();
