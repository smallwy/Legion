/* 区域裁剪放大 —— 用于把概念图和游戏截图摆在同一尺度上逐块比对
   用法：
     node tools/_crop.js <图> <x,y,w,h> <倍数> <输出>
   例：node tools/_crop.js shots/home-layout@v2.png 440,0,420,70 3 shots/_c-hud.png
   注意 NODE_PATH 要指向 workbuddy 的 node workspace（@napi-rs/canvas 装在那儿）。 */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

(async () => {
  const [, , src, box, sc, out] = process.argv;
  if (!src || !box || !out) {
    console.error("用法: node _crop.js <图> <x,y,w,h> <倍数> <输出>");
    process.exit(1);
  }
  const img = await loadImage(path.resolve(src));
  const [x, y, w, h] = box.split(",").map(Number);
  const k = Number(sc || 1);
  const cv = createCanvas(Math.round(w * k), Math.round(h * k));
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, x, y, w, h, 0, 0, w * k, h * k);
  const p = path.resolve(out);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, cv.toBuffer("image/png"));
  console.log("✓", path.relative(process.cwd(), p), `${cv.width}×${cv.height}`);
})();
