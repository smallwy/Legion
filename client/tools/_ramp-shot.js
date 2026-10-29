/* ===========================================================================
   斜坡 / 梯子的局部出图（评审用）
   ---------------------------------------------------------------------------
   用户 2026-10-29 截图：「这个斜坡是不是太笔直了点」「梯子没啥用吧 很突兀」。

   这两条都是**形状问题**，整关截图看不出来 —— 斜坡在 960×600 的一屏里
   只有 200×110，笔直不笔直得放大才判得了。所以这个工具只做一件事：
   把镜头钉在**有坡的那一层**，2 倍渲染，再按坡的包围盒裁出来。

   跑法：
     NODE_PATH=<workspace>/node_modules node client/tools/_ramp-shot.js
     PROTO=<另一份 html> PREFIX=<前缀> node ...   # 改前/改后对比
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = process.env.PROTO ? path.resolve(process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");
const PFX = process.env.PREFIX || "ramp";
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600, SC = 2;
/* **先 1 倍画、再整体放大。** 原型在 resize 里会 `ctx.setTransform(dpr,...)`
   把画布变换清掉，所以"先把 ctx 缩放 2 倍再 draw"是无效的（图只会占左上角
   四分之一，第一次就踩了这个）。 */
const real = createCanvas(W, H);
const g = real.getContext("2d");
const big = createCanvas(W * SC, H * SC);
const gb = big.getContext("2d");

const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
/* draw() 里的 ctx 每次重新取 —— 用 setOffscreen 保证静态层不画到主画布 */
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
if (window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));

const L = window.SNOWLAB, S = L.S, DT = 1 / 60;

(async () => {
  try {
    const BG = await require("@napi-rs/canvas").loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"));
    L.setBackdrop(BG);
  } catch (e) { L.setBackdrop(null); console.log("背景未加载：" + e.message); }
  try {
    const art = await require("./_snowlab-art").loadArt();
    L.setArt(art.map);
  } catch (e) { console.log("贴图未加载：" + e.message); }

  /* 挑一关：**坡要够宽、且不是雪坡**（雪坡是另一套画法，
     这次要看的是土/石那种"楔子"形状）。 */
  let pick = null;
  const ONLY = process.env.SEED ? +process.env.SEED : 0;
  for (let sd = ONLY || 1; sd < 400 && !pick; sd++) {
    const Lv = L.genLevel(sd);
    if (!L.validateLevel(Lv)) continue;
    Lv.layers.forEach((l, k) => {
      if (pick) return;
      const r = l.terrain.filter(t => t.kind === "ramp")
        .sort((a, b) => b.w - a.w)[0];
      /* 坡只有两档宽：144（3 列、rise 96~114）和 96（2 列、rise ~44）。
         144 那档才是"一眼看见的坡"，取它。 */
      const wantSnow = process.env.SNOW === "1";
      if (r && r.w >= 144 && (r.base === L.GEN.topY) === wantSnow) pick = { sd, k, ramp: r };
    });
  }
  if (!pick) { console.log("没挑到合适的坡"); return; }
  console.log("种子 " + pick.sd + " 第 " + (pick.k + 1) + " 层坡 " +
    JSON.stringify({ x: Math.round(pick.ramp.x), w: Math.round(pick.ramp.w), rise: Math.round(pick.ramp.rise) }));

  L.reset(pick.sd);
  S.showMeter = false;
  S.showHint = false;
  S.t = 12;
  /* 站坡脚，让镜头吸附到这一层 */
  const r = L.LAYERS[pick.k].terrain.find(t => t.kind === "ramp");
  const lowX = r.rise > 0 ? r.x + 20 : r.x + r.w - 20;
  L.placePlayer(lowX, L.FLOORS[pick.k] - L.PLAYER_H);
  for (let i = 0; i < 90; i++) L.step(DT);
  /* 怪会走过来撞人 —— 出图前清场，只留地形 */
  S.foes.length = 0;
  S.shots.length = 0;
  L.draw();
  gb.imageSmoothingEnabled = true;
  gb.drawImage(real, 0, 0, W * SC, H * SC);

  const full = path.join(OUT, PFX + "-full.png");
  fs.writeFileSync(full, big.toBuffer("image/png"));

  /* 裁：坡的包围盒 + 60px 留白，转成 2 倍图上的像素 */
  const camY = S.cam.y;
  const bx0 = Math.max(0, Math.min(r.x, r.x + r.w) - 70);
  const bx1 = Math.min(W, Math.max(r.x, r.x + r.w) + 70);
  const by0 = Math.max(0, Math.min(r.y, r.y - r.rise) - camY - 70);
  const by1 = Math.min(H, r.base - camY + 60);
  const cw = Math.round((bx1 - bx0) * SC), ch = Math.round((by1 - by0) * SC);
  /* 再放大 1.5 倍方便看细节 */
  const Z = 1.5;
  const cv = createCanvas(Math.round(cw * Z), Math.round(ch * Z));
  const c2 = cv.getContext("2d");
  c2.imageSmoothingEnabled = true;
  c2.drawImage(big, Math.round(bx0 * SC), Math.round(by0 * SC), cw, ch, 0, 0, cw * Z, ch * Z);
  const out = path.join(OUT, PFX + "-crop.png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out + "  " + cv.width + "×" + cv.height);
})();
