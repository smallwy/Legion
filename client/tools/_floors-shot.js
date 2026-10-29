/* ===========================================================================
   2026-10-29 第七轮：「层与层之间没有差异化」
   ---------------------------------------------------------------------------
   出图方法：同一关（种子固定）把镜头**逐层锁死**，每层截一张，横向拼起来。
   如果读者要靠读标题才能分辨"这是第几层"，那就等于没有差异化 —— 这正是
   这一轮要修的东西，所以这张图同时也是验收标准：**只看缩略图就要能认出层号**。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_floors-shot.js
   环境变量：SEED=3  PREFIX=f7-floors  PROTO=<原型路径>
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const SEED = Number(process.env.SEED || 3);
const PFX = process.env.PREFIX || "f7-floors";
const PROTO = process.env.PROTO ? path.resolve(process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function boot(protoPath) {
  const real = createCanvas(W, H);
  const g = real.getContext("2d");
  const html = fs.readFileSync(protoPath, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
  window.requestAnimationFrame = () => 0;
  window.eval(m[1]);
  if (window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));
  try { window.SNOWLAB.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
  catch (e) { window.SNOWLAB.setBackdrop(null); }
  try { window.SNOWLAB.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { }
  return { L: window.SNOWLAB, S: window.SNOWLAB.S, real, g };
}

/** 镜头锁在第 k 层：和 camViewOffset() 一致，层高一屏 300。 */
const camOffset = () => (240 - 26) / 2 + H / 2;

/* 镜头对准**房间**，不是楼层：房间 k 占 (FLOORS[k-1]+thick, FLOORS[k])，
   把它的中线放到屏幕中线 —— 这才是玩家站在这一层里看到的东西。 */
function shotLayer(inst, k) {
  const { L, S } = inst;
  const cY = L.FLOORS[k - 1] + 26, fY = L.FLOORS[k];
  const fY2 = fY;
  S.cam.y = clamp((cY + fY2) / 2 - H / 2, 0, L.WORLD_H - H);
  S.cam.k = k;
  S.showMeter = false; S.showHint = false; S.showHud = false;
  S.texts.length = 0; S.balls.length = 0; S.shots.length = 0;
  S.shake = 0;
  S.t = 12;
  /* 人摆在这一层，别挡住正中 —— 出图看的是"房间"，不是人 */
  L.placePlayer(60, fY2 - L.PLAYER_H);
  S.p.vy = 0; S.p.onGround = true;
  L.draw();
  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(inst.real, 0, 0);
  return c;
}

/* ---------------------------------------------------------------- COMPARE
   改前/改后同镜对照：同一个种子、同一批房间，上下两排。
   **这是这一轮唯一的验收依据** —— "差异化"没有数值，只能看图：
   上排如果读起来像"同一间屋子换了块布"，这条就没做完。 */
async function compare() {
  const BEFORE = process.env.BEFORE ? path.resolve(process.env.BEFORE) : null;
  if (!BEFORE) { console.log("COMPARE 需要 BEFORE=<旧版原型>"); return; }
  const rows = [];
  for (const [tag, p] of [["改前", BEFORE], ["改后", PROTO]]) {
    const inst = await boot(p);
    L0 = inst.L;
    inst.L.reset(SEED);
    const shots = [];
    for (let k = 1; k < inst.L.FLOORS.length; k++) shots.push(shotLayer(inst, k));
    rows.push({ tag, shots });
  }
  const NAMES = ["", "木屋", "砖房", "石洞", "地窖"];
  const SW = 480, SH = 300, PADX = 10, PADY = 46, TOP = 92;
  const n = rows[1].shots.length;
  const cv = createCanvas(PADX + n * (SW + PADX), TOP + 2 * (SH + PADY) + 40);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
  rows.forEach((row, r) => {
    const y = TOP + r * (SH + PADY);
    g.font = "bold 16px 'Microsoft YaHei', sans-serif";
    g.fillStyle = r === 0 ? "#C0392B" : "#1E8449";
    g.fillText(row.tag, PADX, y - 8);
    row.shots.forEach((sh, i) => {
      const x = PADX + i * (SW + PADX);
      g.drawImage(sh, x, y, SW, SH);
      g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, SW - 2, SH - 2);
      if (r === 0) {
        g.font = "bold 15px 'Microsoft YaHei', sans-serif";
        g.fillStyle = "#1B2430";
        g.fillText("第 " + (i + 1) + " 间：" + NAMES[i + 1], x + 4, y - 8);
      }
    });
  });
  g.font = "bold 21px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#1B2430";
  g.fillText("层与层之间的差异化（种子 " + SEED + "，" + n + " 间房，镜头逐间锁死）", 14, 34);
  g.font = "14px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#5B6B7B";
  g.fillText("改前：四间的墙、地板、顶面、光色全在同一支米黄里；改后：明度递减 + 色相跳冷 + 楼板换材质 + 天花板剪影 + 光色跟着变。", 14, 58);
  const out = path.join(OUT, PFX + ".png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out);
}

let L0 = null;
(async () => {
  if (process.env.BEFORE) { await compare(); return; }
  const inst = await boot(PROTO);
  const { L } = inst;
  L.reset(SEED);
  const nF = L.FLOORS.length;
  console.log("种子 " + SEED + "：" + nF + " 层 → " + (nF - 1) + " 间房，世界高 " + L.WORLD_H);

  const shots = [];
  for (let k = 1; k < nF; k++) shots.push(shotLayer(inst, k));

  /* 横排：每张缩到 0.5 倍宽（480×300），一层一列 */
  const SW = 480, SH = 300, PADX = 10, TOP = 96;
  const cv = createCanvas(PADX + shots.length * (SW + PADX), TOP + SH + 56);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
  shots.forEach((s, i) => {
    const x = PADX + i * (SW + PADX);
    g.drawImage(s, x, TOP, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(x + 1, TOP + 1, SW - 2, SH - 2);
    g.font = "bold 17px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#1B2430";
    const NAMES = ["", "木屋", "砖房", "石洞", "地窖"];
    const title = "第 " + (i + 1) + " 间：" + NAMES[i + 1] + (i === nF - 2 ? "（门厅）" : "");
    g.fillText(title, x + 6, TOP - 12);
    g.font = "13px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#5B6B7B";
    g.fillText("floor y=" + L.FLOORS[i + 1], x + 6, TOP + SH + 22);
  });
  g.font = "bold 21px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#1B2430";
  g.fillText("层与层之间的差异化：只看缩略图就要能认出是第几层（种子 " + SEED + "）", 14, 36);
  g.font = "14px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#5B6B7B";
  g.fillText("判据不是「颜色变了一点」，而是形状语言换了：木屋竖板 / 砖房错缝 / 石洞圆块 / 地窖拱龛。", 14, 62);

  const out = path.join(OUT, PFX + ".png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out);
  /* 单间原图：拼图缩到 0.5 倍之后纹理全糊了，验收要看 1:1。 */
  if (process.env.SPLIT) {
    shots.forEach((s, i) => {
      const p2 = path.join(OUT, PFX + "-r" + (i + 1) + ".png");
      fs.writeFileSync(p2, s.toBuffer("image/png"));
      console.log("  " + p2);
    });
  }
})();
