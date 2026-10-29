/* 六种宠物投掷物的对照图。
 *
 * 为什么单开一个工具：这六种东西是 **8~10px 的小图形**，
 * 混在整屏战斗图里根本看不清形状对不对。而用户要的是
 * 「要符合宠物的特征」—— 特征这东西只在放大后才存在，
 * 缩到 8px 还认不出来的形状，等于没画。
 *
 * 用法：node tools/_shot-six.js
 * 出图：shots/_shot-six.png（六种横排 + 放大对照）
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.join(__dirname, "..");
const SRC = process.env.PROTO || path.join(ROOT, "prototype", "snowlab.html");
const OUT = process.env.OUT || path.join(ROOT, "shots", "_shot-six.png");
const W = 960, H = 600, ZOOM = 2;

const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const real = createCanvas(W * ZOOM, H * ZOOM);
const g = real.getContext("2d");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = () => g;
window.requestAnimationFrame = () => 0;
/* snowlab 初始化时会 setTransform(dpr…) 把预乘变换冲掉，这里包一层补回去 */
const rawST = g.setTransform.bind(g);
g.setTransform = (a, b, c, d, e, f) => rawST(a * ZOOM, b, c, d * ZOOM, e, f);
window.eval(m[1]);

/* 离屏工厂：这个工具把 getContext 全指向同一块 ctx，静态层缓存必须另开一块，否则会画到主画布上。 */
if (window.SNOWLAB && window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));

const L = window.SNOWLAB, S = L.S;

(async () => {
  /* 贴图注入：没有它，主角会静默退回代码图形 */
  const art = {};
  for (const id of ["cat", "dog", "ham", "rab", "ox", "fox"]) {
    try { art["pet-" + id] = await loadImage(path.join(ROOT, "assets/resources/grove/pet", id + ".png")); } catch (e) {}
  }
  L.setArt(art);

  L.reset(7);
  S.foes.forEach(f => { f.dead = true; });
  S.boxes.forEach(b => { b.dead = true; });
  S.plats.length = 0;
  S.deco.length = 0;
  S.frags.length = 0;
  S.texts.length = 0;

  const kinds = ["yoyo", "bone", "nut", "carrot", "knife", "shadow"];
  const names = ["溜溜球 cat", "骨头 dog", "坚果 ham", "萝卜 rab", "飞刀 ox", "影子 fox"];
  S.shots = kinds.map((k, i) => ({
    x: 110 + i * 148, y: S.cam.y + 210,
    vx: 620, vy: 40, grav: 520, kind: k,
    t: 0.16, life: 0.62, r: 8 + (i === 2 ? 2 : 0), dead: false,
  }));

  L.draw();

  /* 再画一条放大条：同六种 ×4 倍，标上名字。
     小尺寸下"能认出来"是硬指标，放大条只是给人看形状对不对。
     **必须先把 setTransform 解包还原** —— 上面为了接 ZOOM 包过一层，
     不还原的话这里传 (1,0,0,1,0,0) 会被再乘一次，整条画到画布外面去。 */
  g.setTransform = rawST;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "rgba(12,18,24,.86)";
  g.fillRect(0, H * ZOOM - 190, W * ZOOM, 190);
  g.fillStyle = "#EAF6FF";
  g.font = "600 20px 'Microsoft YaHei',sans-serif";
  g.fillText("六种投掷物（上：实战尺寸　下：×4 放大看形状）", 24, H * ZOOM - 152);

  const kinds2 = kinds;
  for (let i = 0; i < 6; i++) {
    const cx = 90 + i * 148, cy = H * ZOOM - 100;
    /* 重画：直接构造一颗再走一遍绘制路径（drawShot 未导出，
       用同样方式塞进 S.shots 再整体重绘太贵，这里用一个离屏小画布缩放）*/
    g.save();
    g.translate(cx, cy);
    g.scale(4, 4);
    g.translate(-cx, -cy);
    drawOne(g, kinds2[i], cx, cy);
    g.restore();
    g.fillStyle = "#9FB4C4";
    g.font = "600 15px 'Microsoft YaHei',sans-serif";
    g.textAlign = "center";
    g.fillText(names[i], cx, H * ZOOM - 40);
    g.textAlign = "left";
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, real.toBuffer("image/png"));
  console.log("出图 " + OUT + "  " + real.width + "×" + real.height);
})().catch(e => { console.error(e); process.exit(1); });

/** 把六种形状单独画一遍（放大条用）。坐标一律相对中心。 */
function drawOne(g, kind, cx, cy) {
  g.save();
  g.translate(cx, cy);
  g.lineWidth = 2.4;
  g.strokeStyle = "#2B1D12";
  g.lineJoin = "round";
  const R = 8;
  switch (kind) {
    case "yoyo":
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2);
      g.fillStyle = "#FFC94E"; g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-R * .62, 0); g.lineTo(R * .62, 0);
      g.strokeStyle = "#B4781E"; g.lineWidth = 1.6; g.stroke(); break;
    case "bone":
      g.fillStyle = "#F6EFE0";
      g.fillRect(-R * .55, -R * .30, R * 1.1, R * .60);
      for (const [dx, dy] of [[-.68, -.30], [-.68, .30], [.68, -.30], [.68, .30]]) {
        g.beginPath(); g.arc(dx * R, dy * R, R * .32, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      g.strokeRect(-R * .55, -R * .30, R * 1.1, R * .60); break;
    case "nut":
      g.beginPath(); g.ellipse(0, 0, R * 1.05, R * .86, 0, 0, Math.PI * 2);
      g.fillStyle = "#B07A42"; g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-R * .7, -R * .5); g.quadraticCurveTo(R * .1, 0, -R * .7, R * .5);
      g.strokeStyle = "#7A4E24"; g.lineWidth = 1.5; g.stroke(); break;
    case "carrot":
      g.beginPath(); g.moveTo(R * 1.15, 0); g.lineTo(-R * .55, -R * .72); g.lineTo(-R * .55, R * .72); g.closePath();
      g.fillStyle = "#F2903F"; g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-R * .55, 0); g.lineTo(-R * 1.15, -R * .5); g.lineTo(-R * 1.05, 0); g.lineTo(-R * 1.15, R * .5); g.closePath();
      g.fillStyle = "#79B65A"; g.fill(); g.stroke(); break;
    case "knife":
      g.beginPath(); g.moveTo(R * 1.5, 0); g.lineTo(0, -R * .55); g.lineTo(-R * .75, 0); g.lineTo(0, R * .55); g.closePath();
      g.fillStyle = "#DDE8F2"; g.fill(); g.stroke(); break;
    default:
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2);
      g.fillStyle = "#6B54A8"; g.fill(); g.stroke(); break;
  }
  g.restore();
}
