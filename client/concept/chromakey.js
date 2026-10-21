/* ============================================================================
   chromakey.js —— 品红底立绘 → 透明底 RGBA PNG
   ----------------------------------------------------------------------------
   为什么需要这一步：ImageGen 的 background:"transparent" 参数**不可靠** ——
   实测第一次输出时把它把"透明"画成了灰白棋盘格底纹，直接进引擎就是一块布。

   商业化流程是**纯色底拍摄 + key 掉**，所以改用品红 #FF00FF 出图（角色是
   奶油橘，不与品红撞色），再程序键控。

   三个必须处理的细节：
     1. **despill（去溢色）**：AI 生成的边缘会混进品红，alpha 键出来一圈粉边
     2. **水印清除**：右下角有生成器水印，位于角色脚底之下，直接置透明
     3. **自动裁边**：让包围盒精确到角色轮廓，引擎里才好按脚底对齐

   用法：
     NODE_PATH=<managed>/node_modules node client/concept/chromakey.js <in.png> <out.png>
   ========================================================================== */

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

const IN = process.argv[2];
const OUT = process.argv[3];
if (!IN || !OUT) { console.error("用法: node chromakey.js <in.png> <out.png>"); process.exit(1); }

/** 品红程度：R 高、G 低、B 高 → 分数高。奶油色 G 高 → 分数为负 */
function magentaScore(r, g, b) {
  return Math.min(r, b) - g;
}

/**
 * 采样实际背景色。
 *
 * **为什么不能写死阈值**：prompt 里要的是 #FF00FF，但 AI 不保证真的输出纯品红。
 * 实测六只里有四只被渲染成 rgb(215,50,142) 的**暗品红**（score = min(r,b)-g = 92），
 * 而固定阈值 LO=24 / HI=150 会把 92 当成"半透明过渡带"，映射出 alpha≈0.54 ——
 * 整张背景留下一层淡紫，包围盒撑满全图（1024×1536），进引擎就是一块布。
 *
 * 所以阈值必须由**实测背景色**反推：取四边一圈像素的中位数作基准。
 */
function sampleBg(d, W, H) {
  const rs = [], gs = [], bs = [];
  const push = (x, y) => { const i = ((y * W) + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); };
  const step = Math.max(1, Math.floor(Math.min(W, H) / 200));
  for (let x = 0; x < W; x += step) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y += step) { push(0, y); push(W - 1, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

(async () => {
  const img = await loadImage(IN);
  const W = img.width, H = img.height;
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  g.drawImage(img, 0, 0);

  const data = g.getImageData(0, 0, W, H);
  const d = data.data;

  /* ---- 1. 水印区域先刷成品红（水印是白灰色，按键不掉的） ---- */
  // 生成器水印固定在右下角，约 120×64；刷成纯品红后统一按键
  // 水印实测在右下角约 214×120（1024×1536 下），原来刷 150×80 只盖住下半截，
  // 上半截留在图里 → 变成孤立噪点 → 撑爆包围盒
  const wmW = Math.min(240, W), wmH = Math.min(140, H);
  for (let y = H - wmH; y < H; y++) {
    for (let x = W - wmW; x < W; x++) {
      const i = (y * W + x) * 4;
      d[i] = 255; d[i + 1] = 0; d[i + 2] = 255; d[i + 3] = 255;
    }
  }

  /* ---- 2. 键控 + despill ---- */
  // 阈值按实测背景色反推。系数 0.50 / 0.78 的依据：
  //   · 背景 score0=92 → LO=46 / HI=72。粉彩角色的粉色内耳 score≈28，安全留在 LO 以下；
  //     而背景及暗角（score 70–92）全部越过 HI，键干净。
  //   · 纯品红 score0=255 → LO=128 / HI=199，同样成立。
  // 若背景偏亮偏灰（score0 < 60）说明 prompt 没生效或底色被洗掉，直接报错，不猜。
  const [bgR, bgG, bgB] = sampleBg(d, W, H);
  const score0 = magentaScore(bgR, bgG, bgB);
  if (score0 < 60) {
    console.error("✗ 采样到的背景色 rgb(" + bgR + "," + bgG + "," + bgB + ") score=" + score0 +
                  "，不够品红。检查出图底色，别硬键。");
    process.exit(1);
  }
  const LO = score0 * 0.50, HI = score0 * 0.78;
  console.log("  实测背景 rgb(" + bgR + "," + bgG + "," + bgB + ") score=" + score0.toFixed(0) +
              " → 阈值 LO=" + LO.toFixed(0) + " HI=" + HI.toFixed(0));
  let keyed = 0, kept = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const ms = magentaScore(r, gg, b);

    if (ms >= HI) {
      d[i + 3] = 0;
      keyed++;
    } else if (ms <= LO) {
      kept++;
    } else {
      // 过渡带：按分数线性映射 alpha —— 这样边缘才有真正的抗锯齿，
      // 而不是一刀切的硬边（硬边缩放后会出现锯齿状的"狗牙"）
      const t = (ms - LO) / (HI - LO);
      d[i + 3] = Math.round(255 * (1 - t));
      // despill：把残留的品红往中性拉，否则边缘一圈粉
      const neutral = gg;
      const spill = Math.max(0, Math.min(r, b) - neutral) * 0.85;
      d[i] = Math.max(0, Math.min(255, r - spill));
      d[i + 2] = Math.max(0, Math.min(255, b - spill));
      kept++;
    }
  }
  g.putImageData(data, 0, 0);

  /* ---- 3. 去孤立噪点 ----
     键控后全图会散布零星 1–2 个 alpha 残点（品红底的高光/压缩噪点）。
     它们肉眼看不见，但会把包围盒从 700×1400 撑成 1024×1536。
     判定：3×3 邻域里 alpha>8 的邻居少于 2 个 → 视为噪点清掉。 */
  {
    const px0 = g.getImageData(0, 0, W, H).data;
    const clear = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (px0[(y * W + x) * 4 + 3] <= 8) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (!(dx === 0 && dy === 0) && px0[((y + dy) * W + (x + dx)) * 4 + 3] > 8) n++;
        if (n < 2) clear.push(y * W + x);
      }
    }
    if (clear.length) {
      const im2 = g.getImageData(0, 0, W, H);
      for (const idx of clear) im2.data[idx * 4 + 3] = 0;
      g.putImageData(im2, 0, 0);
      console.log("  清除孤立噪点 " + clear.length + " px");
    }
  }

  /* ---- 4. 统计法裁边 ----
     不能"逐像素找极值"—— 一个噪点就能毁掉包围盒。
     改成逐行/逐列统计内容像素数，超过阈值才算进边界。 */
  const px = g.getImageData(0, 0, W, H).data;
  const rowN = new Array(H).fill(0), colN = new Array(W).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] > 8) { rowN[y]++; colN[x]++; }
    }
  }
  const thrR = Math.max(3, Math.round(W * 0.002));
  const thrC = Math.max(3, Math.round(H * 0.002));
  let y0 = 0, y1 = H - 1, x0 = 0, x1 = W - 1;
  while (y0 < H && rowN[y0] < thrR) y0++;
  while (y1 > y0 && rowN[y1] < thrR) y1--;
  while (x0 < W && colN[x0] < thrC) x0++;
  while (x1 > x0 && colN[x1] < thrC) x1--;
  if (y1 <= y0 || x1 <= x0) { console.error("✗ 全部被键掉了，检查是否真的是品红底"); process.exit(1); }

  const PAD = 6;   // 留一点透明边，避免贴图采样时边缘被裁
  x0 = Math.max(0, x0 - PAD); y0 = Math.max(0, y0 - PAD);
  x1 = Math.min(W - 1, x1 + PAD); y1 = Math.min(H - 1, y1 + PAD);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

  const out = createCanvas(cw, ch);
  out.getContext("2d").drawImage(cv, x0, y0, cw, ch, 0, 0, cw, ch);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out.toBuffer("image/png"));

  console.log("✓ " + path.basename(OUT));
  console.log("  原图 " + W + "×" + H + "  →  裁边 " + cw + "×" + ch);
  console.log("  包围盒 x " + x0 + ".." + x1 + "  y " + y0 + ".." + y1);
  console.log("  键掉 " + keyed + " px / 保留 " + kept + " px");
  console.log("");
  console.log("  引擎导入锚点（脚底中心）：");
  console.log("    水平 anchorX = " + (cw / 2) + " / " + cw + " = 0.500");
  console.log("    垂直 anchorY = 1.000（脚底贴包围盒底边）");
  console.log("  建议 Pivot: Cocos(0.5, 0)  Unity(0.5, 0)  Godot(0.5, 1)  UE(0.5, 1)");
})();
