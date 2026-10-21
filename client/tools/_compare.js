/* ============================================================================
   概念图 vs 游戏截图 —— 并排 / 叠加差异
   ----------------------------------------------------------------------------
   用法：
     node tools/_compare.js <A.png> <B.png> <输出前缀>
   产出：
     <前缀>-上下.png   上下拼接（各 640×360，中间一条分隔线）
     <前缀>-叠加.png   50% 叠加 + 差异热力（结构错位会立刻显形）
     <前缀>-条带.png   三行局部放大：HUD / 出战卡+伙伴位 / 出门按钮

   为什么要有这一步：靠肉眼在两张 1280 宽图上找 4px 的偏移是不可能的，
   并排放大和叠加闪烁才是唯一靠谱的判据。
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const W = 1280, H = 720;

async function main() {
  const [a, b, outPrefix] = process.argv.slice(2);
  if (!a || !b || !outPrefix) {
    console.error("用法: node _compare.js <A.png> <B.png> <输出前缀>");
    process.exit(1);
  }
  const A = await loadImage(path.resolve(a));
  const B = await loadImage(path.resolve(b));

  /* ---------- 1. 上下拼接 ---------- */
  {
    const s = 640 / W;
    const cv = createCanvas(640, 360 * 2 + 8);
    const g = cv.getContext("2d");
    g.fillStyle = "#20160F"; g.fillRect(0, 0, 640, 728);
    g.imageSmoothingQuality = "high";
    g.drawImage(A, 0, 0, 640, 360);
    g.drawImage(B, 0, 368, 640, 360);
    g.fillStyle = "#FFC84A"; g.font = "bold 12px Microsoft YaHei";
    g.fillText("上：概念图 home-layout@v2", 8, 352);
    g.fillText("下：游戏 game.html#shotall", 8, 720);
    fs.writeFileSync(path.resolve(outPrefix + "-上下.png"), cv.toBuffer("image/png"));
  }

  /* ---------- 2. 叠加差异 ---------- */
  {
    const cv = createCanvas(W, H);
    const g = cv.getContext("2d");
    g.drawImage(A, 0, 0, W, H);
    g.globalAlpha = 0.5;
    g.drawImage(B, 0, 0, W, H);
    g.globalAlpha = 1;
    g.drawImage(A, 0, 0, W, H);
    g.globalAlpha = 1;
    // 差异热力：几何错位的地方会亮起来
    const ca = createCanvas(W, H), ga = ca.getContext("2d");
    ga.drawImage(A, 0, 0, W, H);
    const cb = createCanvas(W, H), gb = cb.getContext("2d");
    gb.drawImage(B, 0, 0, W, H);
    const da = ga.getImageData(0, 0, W, H).data;
    const db = gb.getImageData(0, 0, W, H).data;
    const out = g.getImageData(0, 0, W, H);
    const od = out.data;
    let big = 0;
    for (let i = 0; i < od.length; i += 4) {
      const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
      if (d > 40) {
        big++;
        // 用洋红标出来：暖色底上洋红最跳
        od[i] = Math.min(255, od[i] * 0.35 + 255 * 0.65);
        od[i + 1] = od[i + 1] * 0.35;
        od[i + 2] = Math.min(255, od[i + 2] * 0.35 + 255 * 0.45);
      }
    }
    g.putImageData(out, 0, 0);
    fs.writeFileSync(path.resolve(outPrefix + "-叠加.png"), cv.toBuffer("image/png"));
    console.log(`差异像素（通道均差 >40）${((big / (W * H)) * 100).toFixed(1)}%（含立绘本身的位置/表情差，不是全部都要修）`);
  }

  /* ---------- 3. 局部条带放大 ---------- */
  {
    const rows = [
      ["HUD", 0, 0, 1280, 70, 1.5],
      ["Dock 左半", 0, 610, 760, 110, 1.5],
      ["Dock 右半", 740, 610, 540, 110, 1.5],
    ];
    let totalH = 0;
    for (const r of rows) totalH += r[4] * r[4] + 8;
    const wMax = Math.max(...rows.map(r => r[3] * r[5]));
    const cv = createCanvas(Math.round(wMax), Math.round(totalH) + 20);
    const g = cv.getContext("2d");
    g.fillStyle = "#20160F"; g.fillRect(0, 0, cv.width, cv.height);
    let y = 0;
    for (const [name, x, yy, w, h, k] of rows) {
      g.drawImage(A, x, yy, w, h, 0, y, w * k, h * k);
      y += h * k;
      g.drawImage(B, x, yy, w, h, 0, y, w * k, h * k);
      y += h * k + 8;
      g.fillStyle = "#FFC84A"; g.font = "bold 11px Microsoft YaHei";
      g.fillText(name + "（上概念 / 下游戏）", 4, y - h * k + 14);
    }
    fs.writeFileSync(path.resolve(outPrefix + "-条带.png"), cv.toBuffer("image/png"));
  }
  console.log("✓ 已输出", outPrefix + "-上下.png / -叠加.png / -条带.png");
}

main().catch(e => { console.error(e); process.exit(1); });
