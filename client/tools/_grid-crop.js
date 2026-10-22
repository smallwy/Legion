/* ============================================================================
   _grid-crop.js —— 带坐标网格的裁剪放大，用来"读"像素坐标
   ----------------------------------------------------------------------------
   为什么需要它：
     普通裁剪图给人看的时候会被等比缩放到窗口宽度，我在缩放后的图上读坐标，
     误差能有 10~20px —— 而"任务两个字要落在木牌上"这种需求，差 10px 就压到描边。
     加一层**原图坐标系**的网格和刻度，读出来的是原图像素坐标，不是缩放后的。

   用法：node tools/_grid-crop.js <图> <x,y,w,h> <倍数> <输出> [步长=20]
   ========================================================================== */
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

(async () => {
    const [, , src, box, sc, out, step] = process.argv;
    if (!src || !box || !out) {
        console.error('用法: node _grid-crop.js <图> <x,y,w,h> <倍数> <输出> [步长]');
        process.exit(1);
    }
    const [x0, y0, w, h] = box.split(',').map(Number);
    const k = Number(sc || 2);
    const ST = Number(step || 20);
    const im = await loadImage(path.resolve(src));

    const cv = createCanvas(Math.round(w * k), Math.round(h * k));
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(im, x0, y0, w, h, 0, 0, w * k, h * k);

    /* 网格：细线在 ST 的 1/2 处，粗线在 ST 整数倍处 */
    const line = (v, vertical, major) => {
        g.beginPath();
        if (vertical) { g.moveTo(v * k + 0.5, 0); g.lineTo(v * k + 0.5, h * k); }
        else { g.moveTo(0, v * k + 0.5); g.lineTo(w * k, v * k + 0.5); }
        g.strokeStyle = major ? 'rgba(0,200,255,0.75)' : 'rgba(0,200,255,0.28)';
        g.lineWidth = major ? 1 : 1;
        g.stroke();
    };
    for (let v = 0; v <= w; v += ST / 2) line(v, true, (v % ST) === 0);
    for (let v = 0; v <= h; v += ST / 2) line(v, false, (v % ST) === 0);

    /* 刻度标签：写的是原图坐标 */
    g.font = 'bold 11px monospace';
    g.textBaseline = 'top';
    for (let v = 0; v <= w; v += ST) {
        const tx = v * k + 2;
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillRect(tx - 1, 0, 26, 13);
        g.fillStyle = '#7ef';
        g.fillText(String(x0 + v), tx, 1);
    }
    for (let v = 0; v <= h; v += ST) {
        const ty = v * k + 1;
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillRect(0, ty, 30, 12);
        g.fillStyle = '#7ef';
        g.fillText(String(y0 + v), 2, ty);
    }

    require('fs').writeFileSync(path.resolve(out), cv.toBuffer('image/png'));
    console.log(`✓ ${out}  ${Math.round(w * k)}×${Math.round(h * k)}  原图区域 x${x0}..${x0 + w} y${y0}..${y0 + h}`);
})();
