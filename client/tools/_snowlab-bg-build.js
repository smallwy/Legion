/* 把生成出来的 1536×1024 立绘裁成 960×340 的「地表背景条」并压成 JPEG。
   ===========================================================================
   **为什么要裁而不是直接用**：`drawSky` 里是
   `g.drawImage(bg, 0, 0, W, 340)` —— 整张图被拉满 960×340。
   1536×1024（3:2）直接拉成 2.82:1 会把所有东西横向拽胖 1.88 倍，
   蘑菇会变成平底锅。所以必须先按目标比例切一条出来，再缩。

   **裁哪个位置是构图问题，不是数学问题。** 已有的四条都遵循同一套：
   天空占上 55~60%，地平线落在条带 62% 附近，地面从底边溢出去
   （游戏里 340 以下是关卡本体，背景条不需要画完）。
   所以 `JOBS` 里记的是「地平线在源图里的相对高度」，条带位置由它反推 ——
   换图时只量这一个数，不用手算 y。

   **生成图右下角有 `AI生成 WORKBUDDY.CN` 水印**（约在 y 0.94~0.99、
   x 0.92~0.99）。裁切带必须整个躲开它；下面有守卫会算条带下沿，
   万一手调 HORIZON 把它框进来了直接报错，而不是悄悄留个水印在游戏里
   —— 这种"图内嵌了、游戏里也显示了、就是多个水印"的错最难被看见。

   管线：本脚本（裁+缩+JPEG） → `_snowlab-embed-bg.js`（base64 进 html）。
   用法：node client/tools/_snowlab-bg-build.js
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const DIR = path.resolve(__dirname, '..', 'assets', 'snowlab');
const OUT_W = 960, OUT_H = 340;
const RATIO = OUT_W / OUT_H;            // 2.8235

/* 源文件 → [输出名, 地平线相对高度(0~1)]
   spore：蘑菇林站在 y≈0.556 的水线上（下方是发光的水潭，当"地面"用）。
   dune ：改用前景沙丘的顶边 0.490 当参照 —— 拿 0.78 那道前沿反推的话
          条带下沿会顶进水印区；这个值正好让太阳落在条带中线。
   **加一个新场景就在这儿加一行**，源 png 留在 assets 里别删，
   否则以后想重裁一条更宽/更矮的就没有原料了。 */
const JOBS = [
  ['Flat_vector_game_background__w_2026-10-30T10-03-54.png', 'bg-spore.jpg', 0.556],
  ['Flat_vector_game_background__w_2026-10-30T10-04-04.png', 'bg-dune.jpg', 0.490],
];

/* 地平线落在条带的哪个高度 —— 和 bg-surface / bg-forge 对齐，别单独调。 */
const HORIZON_IN_STRIP = 0.62;
/* 水印占的纵向区间（相对源图高度）。只用来做"别框进来"的守卫。 */
const WM_TOP = 0.93;
/* 质量 82：bg-surface 38KB / bg-forge 60KB 都在这个量级。再高就是为内嵌
   base64 白付体积，再低蘑菇伞面的渐层会出色带。 */
const QUALITY = 82;

/* `@napi-rs/canvas` 的 `loadImage` 返回的是 Promise，不是 Image ——
   不 await 直接取 `.width` 是 undefined（出图工具里踩过：症状是
   "图加载了但画出来全白"，不报错）。所以整段包在 async 里。 */
(async () => {
  for (const [src, out, horizon] of JOBS) {
    const p = path.join(DIR, src);
    if (!fs.existsSync(p)) { console.error('缺源文件：' + src); process.exit(1); }
    const img = await loadImage(p);
    const sw = img.width, sh = img.height;

    const bandH = Math.round(sw / RATIO);            // 按目标比例切，整个宽度都用上
    let sy = Math.round(horizon * sh - HORIZON_IN_STRIP * bandH);
    const maxSy = sh - bandH;
    /* 越界就夹回来并**说出来** —— 夹回去之后地平线位置就变了，
       闷声夹的话构图偏了没人知道。 */
    if (sy < 0) { console.log('  ! ' + out + '：算出 sy=' + sy + ' 越界，夹到 0（地平线会偏低）'); sy = 0; }
    if (sy > maxSy) { console.log('  ! ' + out + '：算出 sy=' + sy + ' 越界，夹到 ' + maxSy); sy = maxSy; }
    /* 水印守卫：条带下沿一旦越过水印顶，水印就进游戏了。 */
    if ((sy + bandH) / sh > WM_TOP) {
      console.error('  × ' + out + '：条带下沿 ' + ((sy + bandH) / sh).toFixed(3) +
                    ' 已进入水印区（>' + WM_TOP + '），调 JOBS 里的 horizon 或换构图');
      process.exit(1);
    }

    const cv = createCanvas(OUT_W, OUT_H);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, sy, sw, bandH, 0, 0, OUT_W, OUT_H);

    const buf = await cv.encode('jpeg', QUALITY);
    fs.writeFileSync(path.join(DIR, out), buf);
    console.log('  ✓ ' + out + '  ← ' + src + '  (裁 y ' + sy + '~' + (sy + bandH) +
                ', ' + OUT_W + '×' + OUT_H + '  ' + (buf.length / 1024).toFixed(0) + 'KB' +
                '  base64 后 ≈ ' + (buf.length * 4 / 3 / 1024).toFixed(0) + 'KB)');
  }
  console.log('裁切完成：' + JOBS.length + ' 张');
})().catch(e => { console.error('裁切失败：' + e.message); process.exit(1); });
