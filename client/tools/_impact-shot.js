/* 撞击瞬间的定格图。
 *
 * 为什么单独出这张：震屏在静态图里"看不见"（画面抖没抖，一张图说不出来），
 * 碎片方向却能一眼看出来 —— 全向撒开是一团，扇形喷出去是"被撞了"。
 * 而这恰恰是改动的全部内容，所以必须有一张能看清碎片的图。
 *
 * 用法：
 *   node tools/_impact-shot.js
 *   PROTO=../某版本.html OUT=... node tools/_impact-shot.js     # 对照组
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.join(__dirname, "..");
const SRC = process.env.PROTO || path.join(ROOT, "prototype", "snowlab.html");
const OUT = process.env.OUT || path.join(ROOT, "shots", "_impact.png");
const W = 960, H = 600, ZOOM = 2;

const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const real = createCanvas(W * ZOOM, H * ZOOM);
const g = real.getContext("2d");
const rawST = g.setTransform.bind(g);
g.setTransform = (a, b, c, d, e, f) => rawST(a * ZOOM, b, c, d * ZOOM, e, f);

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = () => g;
window.requestAnimationFrame = () => 0;
window.eval(m[1]);

/* 离屏工厂：这个工具把 getContext 全指向同一块 ctx，静态层缓存必须另开一块，否则会画到主画布上。 */
if (window.SNOWLAB && window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));

const L = window.SNOWLAB, S = L.S;

(async () => {
  const art = {};
  for (const id of ["cat", "dog", "ham", "rab", "ox", "fox"]) {
    try { art["pet-" + id] = await loadImage(path.join(ROOT, "assets/resources/grove/pet", id + ".png")); } catch (e) {}
  }
  try { art["pet-cat"] && (art["pet-cat"] = art["pet-cat"]); } catch (e) {}
  L.setArt(art);
  try {
    const bg = await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"));
    L.setBackdrop(bg);
  } catch (e) { console.log("背景立绘未加载：" + e.message); }

  L.reset(7);
  /* 找一个木箱，把玩家摆在它左边，球从左边撞过去 */
  /* 挑**屏幕上看得见的那一层**的箱子 —— 第一版用 `b.y > 300` 挑，
     结果挑到了 y=1252 的深层箱子，碎片全在镜头外面，出图上看什么都没有，
     差点被误判成"碎片没生成"。 */
  const box = S.boxes.find(b => !b.dead && b.mat === "wood" && b.y > 180 && b.y < 340 && b.x > 330 && b.x < 620);
  if (!box) { console.error("没找到可视层中段的木箱"); process.exit(1); }
  S.foes.forEach(f => { f.dead = true; });
  S.frags.length = 0; S.rings.length = 0;
  L.placePlayer(box.x - 70, L.FLOORS[0] - S.p.h);
  S.p.face = 1;

  /* 直接触发一次"球撞箱"，拿撞击那一帧的碎片 */
  S.shake = 0; S.shakeDX = 0; S.shakeDY = 0;
  L.breakBox(box, "ball", 3.0, 1, 0);
  /* 推进 3 帧：碎片刚散开、还没飞远，这个时刻最能看出方向 */
  for (let i = 0; i < 6; i++) {
    S.frags.forEach(f => {
      f.t += 1 / 60;
      f.x += f.vx / 60; f.y += f.vy / 60;
      f.vy += 900 / 60; f.vx *= 0.94;
      f.rot += f.vr / 60;
    });
    S.rings.forEach(r => { r.t += 1 / 60; });
  }
  S.shake = 13.8;                 // 保留震屏偏移，让定格也带一点位移
  L.draw();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, real.toBuffer("image/png"));
  console.log("出图 " + OUT + "  碎片 " + S.frags.length + " 片");
})().catch(e => { console.error(e); process.exit(1); });
