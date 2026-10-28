/* ============================================================================
   _cut-foe-sheet.js —— 从三视图概念图里把三只敌人抠成独立贴图
   ----------------------------------------------------------------------------
   输入：art/02-concept/02-foes/enemy-sheet-三只侧视怪物.png（1536×1024）
   输出：assets/snowlab/foe/{moss,fang,grub}.png

   **为什么用这张图，不用 grove/foe 里现成的四张。**
   grove 那四张（boar / bug / crow / larva）是另一个游戏的敌人：野猪、紫鸟、
   两条毛毛虫。体态能对上两只（boar→fang、bug→grub），但**苔泥团没有对应**
   —— 它是「无腿、贴地滑行的圆团」，grove 那边一只都不是。
   而这张概念图里三只**本来就是 snowlab 的 moss / fang / grub**：苔团带白芽、
   四足带獠牙、拱壳带冰棱。用不着凑，用不着改配色。

   抠图两件事：
     ① **从边框泛洪**，不是全图砍白。怪物肚子上的浅色、苔团的白芽都接近白底，
        全图砍白会把它们一起啃掉。泛洪只吃「和边框连通的白」，成不了灾。
     ② **边缘按"离底色多远"给半透明**。只做硬切的话，轮廓外面会留一圈
        250,251,254 的白边 —— 在深色洞窟里那是一圈发光毛边。
   底色不是纯白（实测 250,251,254，带一点冷调），所以判据用**到该颜色的
   欧氏距离**，不用"是否等于 255"。
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "art", "02-concept", "02-foes", "enemy-sheet-三只侧视怪物.png");
const OUT_DIR = path.join(ROOT, "assets", "snowlab", "foe");

/* 三只在原图里从左到右的顺序。名字用 snowlab 的 breed，不用概念图里的位置。 */
const NAMES = ["moss", "fang", "grub"];

/* 泛洪阈值：到底色的距离小于 FLOOD_T 视为背景。
   实测背景 250,251,254；苔团白芽的暗部约 (232,222,186) → 距离 ≈ 70，
   红线在 18 上下就能干净分开。 */
const FLOOD_T = 18;
/* 边缘羽化：距离在这两个值之间时给半透明，避免白毛边。 */
const SOFT_A = 10, SOFT_B = 26;
/* **羽化完还要有一道 alpha 地板。** 只羽化的话，最外圈会留下 alpha 5~45 的
   淡像素 —— 在浅底上看不见，一放到深色洞窟里就是一圈发光的白毛边
   （实测首列均 alpha 5~45，肉眼在 #2A2118 上非常明显）。
   低于 42 的一律清零，剩下的稍微提一点补回被削掉的体积。 */
const ALPHA_FLOOR = 42;

/* 输出尺寸：按**去除留白后的内容高**缩放到 TARGET_H。
   132 = 33（敌人碰撞高）× 4，正好是"3 倍屏 + 一点余量"，
   再大对 30px 的显示尺寸没有增量，只是让 html 变胖。 */
const TARGET_H = 132;

function bgColorOf(d, w, h) {
  /* 四角取平均，别写死 255 —— 这张图是 (250,251,254)。 */
  const pick = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const pts = [pick(1, 1), pick(w - 2, 1), pick(1, h - 2), pick(w - 2, h - 2)];
  return [0, 1, 2].map(k => pts.reduce((a, p) => a + p[k], 0) / pts.length);
}

function dist(r, g, b, bg) {
  const dr = r - bg[0], dg = g - bg[1], db = b - bg[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/* 从边框泛洪，标出"和边框连通的背景" */
function floodFromBorder(d, w, h, bg, x0, x1) {
  const BW = x1 - x0 + 1;
  const mask = new Uint8Array(BW * h);      // 1 = 背景
  const stack = [];
  const idx = (x, y) => (y * BW) + (x - x0);
  const push = (x, y) => {
    if (x < x0 || x > x1 || y < 0 || y >= h) return;
    const m = idx(x, y);
    if (mask[m]) return;
    const i = (y * w + x) * 4;
    if (dist(d[i], d[i + 1], d[i + 2], bg) > FLOOD_T) return;
    mask[m] = 1; stack.push(x, y);
  };
  /* 四条边都当种子：怪物可能贴着上下边（这张图没有，但别假设） */
  for (let x = x0; x <= x1; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(x0, y); push(x1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return { mask, idx };
}

(async () => {
  if (!fs.existsSync(SRC)) { console.error("缺输入：" + SRC); process.exit(1); }
  const im = await loadImage(SRC);
  const W = im.width, H = im.height;
  const full = createCanvas(W, H);
  const fg = full.getContext("2d");
  fg.drawImage(im, 0, 0);
  const img = fg.getImageData(0, 0, W, H);
  const d = img.data;
  const bg = bgColorOf(d, W, H);
  console.log("底色 = " + bg.map(v => v.toFixed(0)).join(",") + "；源图 " + W + "×" + H);

  /* ---- 按列找到三团的分界（不写死 x 坐标，换了概念图也能跑） ---- */
  const colInk = new Uint32Array(W);
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (dist(d[i], d[i + 1], d[i + 2], bg) > FLOOD_T) n++;
    }
    colInk[x] = n;
  }
  const runs = [];
  let cur = null;
  for (let x = 0; x < W; x++) {
    if (colInk[x] > 2) { if (!cur) cur = { a: x, b: x }; else cur.b = x; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  const groups = runs.filter(r => r.b - r.a > 40);
  if (groups.length !== NAMES.length) {
    console.error("期望 " + NAMES.length + " 团，实测 " + groups.length + " 团：" + JSON.stringify(groups));
    process.exit(1);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = [];

  groups.forEach((grp, gi) => {
    const name = NAMES[gi];
    const { mask, idx } = floodFromBorder(d, W, H, bg, grp.a, grp.b);

    /* ---- 抠 + 羽化 + 求 bbox，一次扫完 ---- */
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = grp.a; x <= grp.b; x++) {
        const i = (y * W + x) * 4;
        if (mask[idx(x, y)]) { d[i + 3] = 0; continue; }
        const dd = dist(d[i], d[i + 1], d[i + 2], bg);
        /* 紧贴轮廓的一圈：按离底色多远给 alpha，把白毛边化成半透明 */
        if (dd < SOFT_B) {
          const a = Math.round(255 * Math.max(0, (dd - SOFT_A) / (SOFT_B - SOFT_A)));
          if (a < d[i + 3]) d[i + 3] = a;
        }
        if (d[i + 3] < ALPHA_FLOOR) d[i + 3] = 0;
        else if (d[i + 3] < 255) d[i + 3] = Math.min(255, Math.round(d[i + 3] * 1.18));
        if (d[i + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { console.error(name + "：没抠出东西"); process.exit(1); }

    /* **改的是 ImageData 的副本，必须写回画布再 drawImage。**
       少了这一行，`drawImage(full, ...)` 读的还是没抠过的原图 ——
       导出的图会是一个**白底方块**里坐着怪物，而日志里 bbox 一切正常。 */
    fg.putImageData(img, 0, 0);

    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const scaled = createCanvas(Math.round(cw * TARGET_H / ch), TARGET_H);
    const sg = scaled.getContext("2d");
    sg.imageSmoothingEnabled = true;
    sg.imageSmoothingQuality = "high";
    sg.drawImage(full, x0, y0, cw, ch, 0, 0, scaled.width, scaled.height);

    const out = path.join(OUT_DIR, name + ".png");
    fs.writeFileSync(out, scaled.toBuffer("image/png"));
    report.push({
      name, bbox: [x0, y0, cw, ch],
      aspect: (cw / ch).toFixed(3),
      out: scaled.width + "×" + scaled.height,
      kb: Math.round(fs.statSync(out).size / 1024),
    });
  });

  console.log("\n抠图结果：");
  for (const r of report) {
    console.log("  " + r.name.padEnd(5) + " bbox=" + r.bbox.join(",").padEnd(20) +
      " 宽高比=" + r.aspect + "  输出=" + r.out + "  " + r.kb + "KB");
  }
  console.log("\n落到 " + path.relative(ROOT, OUT_DIR));
})();
