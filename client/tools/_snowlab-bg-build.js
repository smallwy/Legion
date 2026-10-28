/* 把生图裁成"地表背景条"并压成 JPEG，再打印 base64 体积。
   用法：node client/tools/_snowlab-bg-build.js <源png> <裁剪y起> <裁剪高> <输出jpg> */
const fs = require('fs'), path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

(async () => {
  const [src, y0s, hs, out] = process.argv.slice(2);
  const img = await loadImage(src);
  const y0 = +y0s, hh = +hs;
  const OUT_W = 960, OUT_H = 340;
  const cv = createCanvas(OUT_W, OUT_H);
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, y0, img.width, hh, 0, 0, OUT_W, OUT_H);
  const buf = cv.toBuffer('image/jpeg', 84);
  fs.writeFileSync(out, buf);
  console.log('源 ' + img.width + '×' + img.height + '  裁 (0,' + y0 + ' ' + img.width + '×' + hh + ')');
  console.log('输出 ' + path.basename(out) + '  ' + OUT_W + '×' + OUT_H + '  ' + (buf.length / 1024).toFixed(0) + 'KB' +
    '  base64 后 ≈ ' + (buf.length * 4 / 3 / 1024).toFixed(0) + 'KB');
})();
