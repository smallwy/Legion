/* ============================================================================
   _ab.js —— 并排 A/B 对比图
   ----------------------------------------------------------------------------
   调画面时唯一有用的工具：同一帧的两个版本摆在一起，用眼睛判。
   靠"读代码想象效果"去调色调，十次有九次是在瞎猜。

   用法：
     node tools/_ab.js <before.png> <after.png> [out.png] [标签A] [标签B]

   尺寸按第一张图的**实际宽高**取，不写死 960×600：
   战斗截图是 960×600、主界面是 1280×720，写死之后总有一边被拉伸 ——
   而"画面被拉宽了"和"我改胖了"在缩略图里看起来一模一样。
   ========================================================================== */
const fs = require("fs");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

(async () => {
  const [a, b, out, la, lb] = process.argv.slice(2);
  const ia = await loadImage(fs.readFileSync(a));
  const ib = await loadImage(fs.readFileSync(b));
  const W = ia.width, H = ia.height;
  const GAP = 10, LBL = 30;
  const c = createCanvas(W * 2 + GAP, H + LBL);
  const g = c.getContext("2d");
  g.fillStyle = "#141414";
  g.fillRect(0, 0, c.width, c.height);

  g.font = "bold 17px 'Microsoft YaHei',sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#8fb8d8";
  g.fillText("BEFORE  " + (la || a.split(/[\\/]/).pop()), W / 2, LBL / 2);
  g.fillStyle = "#d8a88f";
  g.fillText("AFTER  " + (lb || b.split(/[\\/]/).pop()), W + GAP + W / 2, LBL / 2);

  g.drawImage(ia, 0, LBL, W, H);
  g.drawImage(ib, W + GAP, LBL, W, H);
  const f = out || "shots/_ab.png";
  fs.writeFileSync(f, c.toBuffer("image/png"));
  console.log(f);
})();
