/* ============================================================================
   生成 Cocos 用的九宫格母版 + 导出宠物/头像 PNG
   ----------------------------------------------------------------------------
   母版必须满足三条，否则 Sliced 一拉就崩：
     ① 四边对称，圆角完全落在 border 之内（border 24 > 圆角 22）
     ② 顶部内高光 / 底部内阴影只出现在 border 区内 —— 落进中间会被横向拉伸
     ③ 尺寸 ≥ border×2 + 一个可见的拉伸区（96 = 24+48+24）

   用法：node build-nine-slice.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const CLIENT = path.join(__dirname, "..");
const SHOTS = path.join(CLIENT, "shots");
const OUT = path.join(CLIENT, "assets", "ui", "home");

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function rr(g, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.lineTo(x + w - rad, y);
  g.arcTo(x + w, y, x + w, y + rad, rad);
  g.lineTo(x + w, y + h - rad);
  g.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  g.lineTo(x + rad, y + h);
  g.arcTo(x, y + h, x, y + h - rad, rad);
  g.lineTo(x, y + rad);
  g.arcTo(x, y, x + rad, y, rad);
  g.closePath();
}

/* ---------- 奶油底面板：96×96，border 24 ----------
   ⚠ 本屏所有面板都是定尺，用的是 build-ui-parts.js 出的整图。
   这个九宫格母版只在**将来出现变尺面板**（弹窗、自适应宽度的条）时才用，
   留着是为了别让下一个人重新推导一遍边界值。
   参数与 game.src.html 的 .glass 对齐：圆角 19、描边 2.8、渐变 alpha .97/.93/.95。
   原来的圆角 22 / 描边 3 / 不透明渐变已经和网页对不上了。 */
function panelCream() {
  const S = 96, R = 19, LW = 2.8;
  const c = createCanvas(S, S), g = c.getContext("2d");
  const i = LW / 2;

  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, "rgba(255,254,248,.97)");
  grad.addColorStop(0.55, "rgba(255,251,240,.93)");
  grad.addColorStop(1, "rgba(250,238,218,.95)");
  rr(g, i, i, S - LW, S - LW, R);
  g.fillStyle = grad;
  g.fill();

  // 顶部内高光 2.4px：必须落在 top border(24) 之内，否则会被横向拉伸成一条带
  g.save();
  rr(g, i, i, S - LW, S - LW, R);
  g.clip();
  g.fillStyle = "rgba(255,255,255,.62)";
  g.fillRect(0, 0, S, 2.4);
  // 内浅描边 1.3
  rr(g, i + 2.2, i + 2.2, S - LW - 4.4, S - LW - 4.4, Math.max(0, R - 2.2));
  g.strokeStyle = "rgba(255,255,255,.40)";
  g.lineWidth = 1.3;
  g.stroke();
  // 底部内阴影 8px
  const sh = g.createLinearGradient(0, S - 8, 0, S);
  sh.addColorStop(0, "rgba(140,92,52,0)");
  sh.addColorStop(1, "rgba(140,92,52,.14)");
  g.fillStyle = sh;
  g.fillRect(0, S - 8, S, 8);
  g.restore();

  rr(g, i, i, S - LW, S - LW, R);
  g.strokeStyle = "rgba(122,80,52,.74)";
  g.lineWidth = LW;
  g.stroke();

  return { canvas: c, border: 24, note: "奶油底面板 · 圆角19 · 描边2.8 · 半透明渐变（与 .glass 同参）" };
}

/* ---------- 金色主按钮：128×128，border 34 ---------- */
function btnGold() {
  const S = 128, R = 30, LW = 3.4;
  const c = createCanvas(S, S), g = c.getContext("2d");
  const i = LW / 2;

  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, "#FFE3A8");
  grad.addColorStop(0.46, "#FFCE72");
  grad.addColorStop(1, "#F2B23F");
  rr(g, i, i, S - LW, S - LW, R);
  g.fillStyle = grad;
  g.fill();

  g.save();
  rr(g, i, i, S - LW, S - LW, R);
  g.clip();
  const hl = g.createLinearGradient(0, 0, 0, 12);
  hl.addColorStop(0, "rgba(255,255,255,.82)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = hl;
  g.fillRect(0, 0, S, 12);
  const sh = g.createLinearGradient(0, S - 16, 0, S);
  sh.addColorStop(0, "rgba(150,88,20,0)");
  sh.addColorStop(1, "rgba(150,88,20,.26)");
  g.fillStyle = sh;
  g.fillRect(0, S - 16, S, 16);
  g.restore();

  rr(g, i, i, S - LW, S - LW, R);
  g.strokeStyle = "rgba(146,88,22,.86)";
  g.lineWidth = LW;
  g.stroke();

  return { canvas: c, border: 34, note: "金色主按钮 · 圆角30 · 描边3.4" };
}

(async () => {
  ensureDir(OUT);
  ensureDir(path.join(OUT, "pets"));
  ensureDir(path.join(OUT, "heads"));

  const report = { panels: {}, pets: {}, heads: {} };

  // ---------- 九宫格母版 ----------
  // btn-gold 已停用：出门主按钮是**平涂 + 6px 厚底**（#go），不是金色渐变。
  // 渐变版留着只会让人拿错 —— 已由 build-ui-parts.js 的 btn-go 取代。
  for (const [name, fn] of [["panel-cream", panelCream]]) {
    const r = fn();
    const p = path.join(OUT, name + ".png");
    fs.writeFileSync(p, r.canvas.toBuffer("image/png"));
    report.panels[name] = { w: r.canvas.width, h: r.canvas.height, border: r.border, note: r.note };
    console.log(`✓ ${name}.png  ${r.canvas.width}×${r.canvas.height}  border ${r.border}`);
  }

  // ---------- 六只立绘：高 640，PNG ----------
  const PETS = ["sugar-stand", "nian-gao-dog", "tuan-zi-ham", "xue-tuan-rab", "dou-nai-ox", "xing-xie-fox"];
  for (const id of PETS) {
    const img = await loadImage(path.join(SHOTS, "ai", id + "@v1.png"));
    const h = 640, w = Math.round(img.width * h / img.height);
    const c = createCanvas(w, h), g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, w, h);
    fs.writeFileSync(path.join(OUT, "pets", id + ".png"), c.toBuffer("image/png"));
    report.pets[id] = { w, h };
    console.log(`✓ pets/${id}.png  ${w}×${h}`);
  }

  // ---------- 六张头像：160×160 ----------
  for (const id of PETS) {
    const img = await loadImage(path.join(SHOTS, "ai", "head", id + "-head@v1.png"));
    const S = 160;
    const c = createCanvas(S, S), g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, S, S);
    fs.writeFileSync(path.join(OUT, "heads", id + ".png"), c.toBuffer("image/png"));
    report.heads[id] = { w: S, h: S };
    console.log(`✓ heads/${id}.png  ${S}×${S}`);
  }

  // ---------- 背景：原尺寸 ----------
  // ⚠ 必须是 v2（烘过告示板/红旗/光斑）。用 v1 的话 Cocos 里「派遣」徽标会悬空 ——
  //   因为黑板本身是烘在背景图里的，不在场景节点里。
  const BG_SRC = path.join(SHOTS, "bg", "home-bg@v2.png");
  const bg = await loadImage(BG_SRC);
  fs.copyFileSync(BG_SRC, path.join(OUT, "bg.png"));
  report.bg = { w: bg.width, h: bg.height, src: "home-bg@v2.png" };
  console.log(`✓ bg.png  ${bg.width}×${bg.height}  ← home-bg@v2.png`);

  /* ---------- 合并而不是覆盖 ----------
     build-ui-parts.js 会往同一个文件里写 parts / headsCircle。
     这里直接 writeFileSync 会把它那一半抹掉，make-scene 就跑不动，
     而且报错是「未知部件：panel-res」—— 完全看不出是清单被覆盖了。 */
  const REPORT = path.join(__dirname, "_cocos-assets.json");
  let merged = {};
  if (fs.existsSync(REPORT)) {
    try { merged = JSON.parse(fs.readFileSync(REPORT, "utf8")); } catch (e) {}
  }
  const out = Object.assign({}, merged, report);
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
  console.log("\n✓ _cocos-assets.json（merged，保留 " +
    Object.keys(merged).filter((k) => !(k in report)).join(",") + "）");
})();
