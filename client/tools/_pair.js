/* ============================================================================
   同一区域，概念图在上、游戏在下，放大并排
   ----------------------------------------------------------------------------
   用法：
     node tools/_pair.js <x,y,w,h> <倍数> <输出.png>
   默认对比 shots/home-layout@v2.png 与 shots/game-shotall.png。
   在两张 1280 宽的图上靠肉眼找 4px 偏移是不可能的，必须放大到同尺度并排。
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.join(__dirname, "..");
const A = path.join(ROOT, "shots", "home-layout@v2.png");
const B = path.join(ROOT, "shots", "game-shotall.png");
const CR = 68;   // 概念图里圆角半径 19~34，直接给足边

(async () => {
  const [box, kStr, out] = process.argv.slice(2);
  if (!box || !out) {
    console.error("用法: node _pair.js <x,y,w,h> <倍数> <输出.png>");
    process.exit(1);
  }
  const [x, y, w, h] = box.split(",").map(Number);
  const k = Number(kStr || 2);
  const a = await loadImage(A), b = await loadImage(B);

  const pad = 18, head = 20;
  const cw = Math.round(w * k) + pad * 2;
  const ch = Math.round(h * k) * 2 + pad * 3 + head * 2;
  const cv = createCanvas(cw, ch), g = cv.getContext("2d");
  g.fillStyle = "#241A12"; g.fillRect(0, 0, cw, ch);
  g.imageSmoothingQuality = "high";

  const draw = (img, oy, label) => {
    g.fillStyle = "#FFC84A";
    g.font = "bold 13px Microsoft YaHei";
    g.fillText(label, pad, oy - 6);
    g.drawImage(img, x, y, w, h, pad, oy, w * k, h * k);
    // 1px 外框，方便看裁切范围
    g.strokeStyle = "rgba(255,200,74,.55)"; g.lineWidth = 1;
    g.strokeRect(pad + .5, oy + .5, w * k - 1, h * k - 1);
  };

  draw(a, pad + head, "概念图");
  draw(b, pad * 2 + head + Math.round(h * k), "游戏 game.html");

  const p = path.resolve(out);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, cv.toBuffer("image/png"));
  console.log("✓", out, cw + "×" + ch);
})();
