/* 把"改前 / 改后"两张图上下拼起来，加一条分隔和标注。
   用法：node _cmp-shot.js <旧图> <新图> <输出> <上标签> <下标签>
   只用于出评审图，不进游戏。 */
const fs = require("fs");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const [oldP, newP, outP, upLabel, dnLabel] = process.argv.slice(2);
if (!outP) { console.error("参数：<旧图> <新图> <输出> [上标签] [下标签]"); process.exit(1); }

(async () => {
  const [a, b] = await Promise.all([loadImage(oldP), loadImage(newP)]);
  const W = Math.max(a.width, b.width);
  const BAR = 34, GAP = 6;
  const H = BAR + a.height + GAP + BAR + b.height;
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  g.fillStyle = "#12181d";
  g.fillRect(0, 0, W, H);

  const band = (y, label, col) => {
    g.fillStyle = col;
    g.fillRect(0, y, W, BAR);
    g.fillStyle = "#0d1216";
    g.font = '700 18px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(label || "", 16, y + BAR / 2 + 1);
  };

  band(0, upLabel || "改前", "#c9805e");
  g.drawImage(a, (W - a.width) / 2, BAR);

  const y2 = BAR + a.height + GAP;
  band(y2, dnLabel || "改后", "#7fc08a");
  g.drawImage(b, (W - b.width) / 2, y2 + BAR);

  fs.writeFileSync(outP, cv.toBuffer("image/png"));
  console.log("✓ " + outP + "  " + W + "×" + H);
})();
