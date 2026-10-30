/* ===========================================================================
   窄洞：同一颗洞，大球掉不进去、小球能下去
   ---------------------------------------------------------------------------
   2026-10-31 用户：「结合现在三个玩法 不合适 你帮我调整啊 而且要满足深度」

   这张图要证明一件事：**「球越大越好」这条唯一策略被打破了。**
   左边是大球（裹满，直径 92）—— 它架在洞口两侧的地板上，过不去；
   右边是裸球（直径 44 < 洞宽 72）—— 它落到下一层。

   两张图都是**真实物理跑出来的位置**，不是摆上去的：
   球从洞口上方落下、跑 90 帧，然后取 draw() 的截图。
   摆上去的图只能证明"我们能画出这个画面"，证明不了"物理真的是这样"。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_narrow-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const FONT = "Microsoft YaHei, PingFang SC, sans-serif";
const W = 960, H = 600;
const PROTO = process.env.PROTO ? path.resolve(process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");
const STEP = 4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function boot() {
  const real = createCanvas(W, H);
  const g = real.getContext("2d");
  const html = fs.readFileSync(PROTO, "utf8");
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

/* 同一关、同一颗洞，只换球的 absorbed。返回落地后的截图和实测坐标。 */
function dropShot(inst, abs) {
  const { L, S } = inst;
  L.startStage(6);
  const ly = S.level.layers[0];
  const h = ly.holes.filter(x => x.narrow)[0];
  const cx = h.x + h.w / 2;

  S.balls.length = 0;
  S.shots.length = 0;
  S.texts.length = 0;
  S.shake = 0; S.flash = 0; S.t = 12;
  S.showMeter = false; S.showHint = false; S.showHud = false;

  /* 镜头把洞口放在中偏上，好让"掉到下一层"也在画面里。
     洞口 floorY=340，下一层 580 —— 两处相距 240，必须一起入画，
     否则"掉下去了"这张图和"卡住了"看起来只是球的位置不同。 */
  S.cam.y = clamp(ly.floorY - H * 0.42, 0, L.WORLD_H - H);
  S.cam.k = 0;

  /* 人挪到左边，别挡着洞 */
  L.placePlayer(40, ly.floorY - 63);
  S.p.vy = 0; S.p.onGround = true;

  const r = Math.min(L.NUM.ball.maxR, L.NUM.ball.baseR + abs * L.NUM.ball.perAbsorb);
  const b = L.spawnBall(cx, ly.floorY - 70, 0, 0);
  b.absorbed = abs; b.r = r;
  for (let i = 0; i < 90; i++) L.stepBalls(1 / 60);

  const y = b.y, yb = y + b.r;
  const fell = yb > ly.floorY + 40;
  L.draw();

  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(inst.real, 0, 0);
  /* 标出球心：不然读者只能靠"球在洞口上还是下"去猜 */
  return { card: c, abs, r, cy: y - S.cam.y, floorY: ly.floorY - S.cam.y, fell, holeW: h.w, holeX: cx };
}

(async () => {
  const inst = await boot();
  const { L } = inst;
  const shots = [dropShot(inst, L.NUM.ball.maxAbsorb), dropShot(inst, 0)];
  for (const s of shots) {
    console.log("absorbed " + s.abs + " · r " + s.r.toFixed(1) + " · 直径 " + (s.r * 2).toFixed(1) +
      " · 洞宽 " + s.holeW + " → " + (s.fell ? "掉到下一层" : "卡在洞口") +
      " · 球底 y=" + (s.cy + s.r).toFixed(0) + " 洞口 y=" + s.floorY.toFixed(0));
  }

  const PAD = 14, SW = (W / 2) | 0, SH = (H / 2) | 0, TOP = 96;
  const cv = createCanvas(PAD * 3 + SW * 2, TOP + SH + 92);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);

  g.font = "bold 24px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("窄洞：大球掉不进去，小球能下去", PAD, 40);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("同一个洞（宽 72）→ 球直径大于 72 就架在两侧地板上。两张都是真物理跑 90 帧的结果。", PAD, 64);
  g.fillStyle = "#E05A2B";
  g.fillText("这打破了「球越大越好」—— 球裹太大就送不到下一层，于是「在哪一层裹大」成了选择。", PAD, 84);

  shots.forEach((s, i) => {
    const x = PAD + i * (SW + PAD), y = TOP;
    g.drawImage(s.card, x, y, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, SW - 2, SH - 2);
    /* 两格都画一条同一高度的参考线（洞口所在的那一层地板），
       这样"球在这条线的上面还是下面"不用读文字就能看出来。 */
    const lineY = y + s.floorY * (SH / H);
    g.strokeStyle = "rgba(224,90,43,.75)"; g.lineWidth = 1.5;
    g.setLineDash([7, 5]);
    g.beginPath(); g.moveTo(x, lineY); g.lineTo(x + SW, lineY); g.stroke();
    g.setLineDash([]);

    /* **把洞口框出来。** 第一版只有一条虚线，读者看到的是"球在上面/下面"，
       但看不出洞有多宽 —— 而这张图要证明的正是"洞比球窄"。
       洞宽 72 / 世界宽 960 → 缩略图上约 37px，不框出来根本读不到。 */
    const kx = s.holeX * (SW / W), kw = s.holeW * (SW / W);
    g.fillStyle = "rgba(224,90,43,.16)";
    g.fillRect(x + kx - kw / 2, lineY - 3, kw, 6);
    g.strokeStyle = "#E05A2B"; g.lineWidth = 1.5;
    g.strokeRect(x + kx - kw / 2, lineY - 3, kw, 6);
    g.font = "bold 11px " + FONT; g.fillStyle = "#B4501E";
    g.fillText("洞 72", x + kx - 13, lineY - 9);

    /* 球心打一个点：球在缩略图里只有 24px，贴地还是悬空看着都一样 */
    g.beginPath();
    g.arc(x + s.holeX * (SW / W), y + s.cy * (SH / H), 4, 0, 6.283);
    g.fillStyle = "#1B2430"; g.fill();
    g.strokeStyle = "#FFFDF8"; g.lineWidth = 1.5; g.stroke();

    const tag = s.abs === 0 ? "裸球 r=22" : "裹满 r=46";
    g.font = "bold 15px " + FONT; g.fillStyle = "#1B2430";
    g.fillText(tag + " · 直径 " + (s.r * 2).toFixed(0) + " · 洞 72", x + 6, y + SH + 24);
    /* **不用 ✔ / ✘。** 这台机器的微软雅黑缺这两个字形，实测渲染成空心方框
       —— 图发出去读者看到的是"两个方框"。用颜色 + 纯中文表达结果。 */
    g.font = "bold 17px " + FONT;
    g.fillStyle = s.fell ? "#3E7C5A" : "#B4501E";
    g.fillText(s.fell ? "穿过洞口，落到下一层" : "架在洞口，下不去", x + 6, y + SH + 50);
    g.font = "12px " + FONT; g.fillStyle = "#8A97A5";
    g.fillText(s.fell ? "下一层的球需要它小" : "要送下去，就别在这一层把它裹大", x + 6, y + SH + 68);
  });

  fs.writeFileSync(path.join(OUT, "narrow-hole.png"), cv.toBuffer("image/png"));
  console.log("出图 " + path.join(OUT, "narrow-hole.png"));
})();
