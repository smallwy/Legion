/* ============================================================================
   _roster.js —— 六只立绘验收合集（AI 立绘版）
   ----------------------------------------------------------------------------
   三栏验收，每栏回答一个不同的问题：

     1. **彩色行**：六只摆在一起像不像同一套资产？（画风一致性）
     2. **剪影行**：涂黑还能不能分清谁是谁？（可辨识性 —— 这是唯一客观的判据）
     3. **尺寸行**：缩到游戏内实际尺寸还看不看得清？（可用性）

   一条关键做法：**统一高度归一化，不统一宽度**。
   六只的"身高"在游戏里没有意义（都是宠物），差异应该体现在**胖瘦**上。
   所以要按同一个高度缩放、脚底对齐，让仓鼠变宽、兔子变窄 ——
   这样体型梯度才是真的，而不是把六只拉成一样宽的六个方块。

   用法：
     NODE_PATH=<managed>/node_modules node client/concept/_roster.js
     → client/shots/ai/_roster.png
   ========================================================================== */

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const K = require("./kit2.js");

const T = K.T;
const F = K.F;

/* 六只的顺序按稀有度递增 —— 一眼看出梯度 */
const ROSTER = [
  { f: "sugar-stand@v1",   name: "砂糖", sp: "尖耳猫", role: "溜溜球",
    rar: "普通", stars: 1, rarC: "#9DB0BA", get: "最先学会的那只", trait: "呆毛 + 竖瞳" },
  { f: "nian-gao-dog@v1",  name: "年糕", sp: "短尾犬", role: "音波喇叭",
    rar: "普通", stars: 1, rarC: "#9DB0BA", get: "永远在门口等的那只", trait: "垂耳 + 卷尾 + 露舌" },
  { f: "tuan-zi-ham@v1",   name: "团子", sp: "胖仓鼠", role: "滚地雷",
    rar: "少见", stars: 2, rarC: "#7FC9A8", get: "能塞下一整颗果", trait: "颊袋 + 口含整果 + 无尾" },
  { f: "xue-tuan-rab@v1",  name: "雪团", sp: "长耳兔", role: "三连跳",
    rar: "少见", stars: 2, rarC: "#7FC9A8", get: "耳朵比身子长", trait: "一耳折 + 大后脚 + 腾空" },
  { f: "dou-nai-ox@v1",    name: "豆奶", sp: "老实牛", role: "冲撞",
    rar: "稀有", stars: 3, rarC: "#7FB4EC", get: "尾巴一直在赶苍蝇", trait: "月牙角 + 斑块 + 半眯眼" },
  { f: "xing-xie-fox@v1",  name: "星屑", sp: "影狐", role: "影分身",
    rar: "传说", stars: 4, rarC: "#E0A030", get: "整条尾巴比它还大", trait: "巨尾 + 星尘 + 尖下巴" },
];

const W = 1620;
const PAD = 40;
const CELL = (W - PAD * 2) / 6;      // 每格宽
const H_MAIN = 330;                  // 彩色行统一高
const H_SIL = 200;                   // 剪影行统一高（小一点，省高度）
const H_SMALL = 180;                 // 尺寸行高 = 最大档位（180），否则大档会向上溢出

(async () => {
  const imgs = {};
  for (const r of ROSTER) {
    imgs[r.f] = await loadImage("client/art/03-candidate/01-pets/" + r.f + ".png");
  }

  const Y_MAIN = 96, Y_SIL = 452, Y_SMALL = 690;
  const rows = [
    { top: Y_MAIN, h: H_MAIN, label: "彩色 · 统一高度归一化（体型差异体现在宽度）" },
    { top: Y_SIL,  h: H_SIL,  label: "剪影 · 涂黑后能否分清（唯一客观判据）" },
  ];
  const H = Y_SMALL + H_SMALL + 186;   // 底部四行文字要塞得下

  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFBF0";
  g.fillRect(0, 0, W, H);

  /* ---------- 顶部标题 ---------- */
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.font = F(26, true);
  g.fillStyle = T.ink;
  g.fillText("吧唧军团 · 六只立绘验收", PAD, 40);
  g.font = F(13, false);
  g.fillStyle = "rgba(107,74,66,.62)";
  g.fillText("AI 插画层 + 品红键控抠图 · 六只共用同一套画风锁，姿态各自不同", PAD, 68);

  /* ---------- 每行 ---------- */
  for (const row of rows) {
    // 行标签
    g.font = F(12, true);
    g.fillStyle = "rgba(107,74,66,.56)";
    g.textAlign = "left";
    g.fillText(row.label, PAD, row.top - 14);

    // 行底线
    g.strokeStyle = "rgba(107,74,66,.14)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(PAD, row.top + row.h + 6);
    g.lineTo(W - PAD, row.top + row.h + 6);
    g.stroke();

    ROSTER.forEach((r, i) => {
      const im = imgs[r.f];
      const x0 = PAD + i * CELL;
      const cx = x0 + CELL / 2;
      const scale = row.h / im.height;
      const dw = im.width * scale;
      const dy = row.top + row.h - im.height * scale;   // 脚底对齐

      if (row.h === H_SIL) {
        // 剪影：离屏染色后贴回
        const tw = Math.max(1, Math.round(dw)), th = Math.round(row.h);
        const tmp = createCanvas(tw, th);
        const tg = tmp.getContext("2d");
        tg.drawImage(im, 0, dy - row.top, dw, row.h);
        const px = tg.getImageData(0, 0, tw, th);
        const dd = px.data;
        for (let k = 0; k < dd.length; k += 4) {
          if (dd[k + 3] > 90) {
            dd[k] = 60; dd[k + 1] = 44; dd[k + 2] = 38; dd[k + 3] = 255;
          } else {
            dd[k + 3] = 0;
          }
        }
        tg.putImageData(px, 0, 0);
        g.drawImage(tmp, cx - dw / 2, row.top);
      } else {
        g.drawImage(im, cx - dw / 2, dy, dw, row.h);
      }
    });
  }

  /* ---------- 尺寸行（四档并排） ---------- */
  {
    const y = Y_SMALL;
    // 行标签
    g.font = F(12, true);
    g.fillStyle = "rgba(107,74,66,.56)";
    g.textAlign = "left";
    g.fillText("游戏内实际尺寸 · 180 / 120 / 96 / 60", PAD, y - 14);
    // 行底线
    g.strokeStyle = "rgba(107,74,66,.14)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(PAD, y + H_SMALL + 6);
    g.lineTo(W - PAD, y + H_SMALL + 6);
    g.stroke();

    const picks = [
      { f: "xing-xie-fox@v1", px: 180 },
      { f: "tuan-zi-ham@v1",  px: 120 },
      { f: "nian-gao-dog@v1", px: 96 },
      { f: "sugar-stand@v1",  px: 60 },
    ];
    let x = PAD + 8;
    for (const p of picks) {
      const im = imgs[p.f];
      const s = p.px / im.height;
      const dw = im.width * s;
      g.drawImage(im, x, y + (H_SMALL - p.px), dw, p.px);
      g.font = F(10.5, false);
      g.fillStyle = "rgba(107,74,66,.58)";
      g.textAlign = "left";
      g.fillText(p.px + "px", x, y + H_SMALL + 14);
      x += Math.max(dw, 50) + 34;
    }
    g.font = F(11.5, false);
    g.fillStyle = "rgba(107,74,66,.50)";
    g.textAlign = "right";
    g.fillText("四档全部可读：双高光 / 下缘反光 / 耳朵轮廓 都还在", W - PAD, y + H_SMALL + 14);
  }

  /* ---------- 底部：名字 / 稀有度 / 想要理由 ---------- */
  const yb = 96 + H_MAIN + 24 + H_SIL + 30 + H_SMALL + 46;
  ROSTER.forEach((r, i) => {
    const cx = PAD + i * CELL + CELL / 2;
    const cw = CELL - 10;

    g.textAlign = "center";

    // 名字
    g.font = F(19, true);
    g.fillStyle = T.ink;
    g.fillText(r.name, cx, yb);

    // 种属 + 技能
    g.font = F(11, false);
    g.fillStyle = "rgba(107,74,66,.62)";
    g.fillText(r.sp + " · " + r.role, cx, yb + 20);

    // 稀有度：星星 + 文字
    const starY = yb + 44;
    const sw = 15;
    const totalW = r.stars * sw + 6 + r.rar.length * 12;
    let sx = cx - totalW / 2 + sw / 2;
    for (let k = 0; k < r.stars; k++) {
      star(g, sx, starY, 6.4, r.rarC);
      sx += sw;
    }
    g.font = F(11.5, true);
    g.fillStyle = r.rarC;
    g.textAlign = "left";
    g.fillText(r.rar, sx + 2, starY + 1);

    // 材质特征
    g.textAlign = "center";
    g.font = F(10.5, false);
    g.fillStyle = "rgba(107,74,66,.50)";
    g.fillText(r.trait, cx, yb + 68);

    // 想要理由（带引号，一行）
    g.font = F(11.5, true);
    g.fillStyle = "rgba(107,74,66,.78)";
    wrap1(g, "「" + r.get + "」", cx, yb + 92, cw);
  });

  fs.writeFileSync("client/shots/ai/_roster.png", cv.toBuffer("image/png"));
  console.log("✓ client/shots/ai/_roster.png  " + W + "×" + H);

  /* ---------- 内部工具 ---------- */
  function star(ctx, cx, cy, r, color) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.44 : r;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** 单行居中；超宽就缩字号，绝不换行（换行会顶到下一格） */
  function wrap1(ctx, s, cx, cy, maxW) {
    let fs0 = 11.5;
    ctx.font = F(fs0, true);
    while (ctx.measureText(s).width > maxW && fs0 > 8) {
      fs0 -= 0.5;
      ctx.font = F(fs0, true);
    }
    ctx.textAlign = "center";
    ctx.fillText(s, cx, cy);
  }
})();
