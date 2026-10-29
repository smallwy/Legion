/* ===========================================================================
   攀爬过程的时间序列图
   ---------------------------------------------------------------------------
   用户 2026-10-29：「这里跳上去 会很不自然的 瞬间移动」。
   改完断言能证明"单帧位移 10.7px"，但**断言证明不了"人看得见"** ——
   也可能过程是有了，只是镜头跟着人走，画面上人始终居中，照样读不出"上升"。

   所以这里出时间序列：同一个动作每 5 帧一帧，**镜头锁死不跟**，
   每格标出脚底的世界坐标。看这串图就能判断"是不是爬上去的"。

   跑法：NODE_PATH=... node client/tools/_climb-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "prototype", "snowlab.html");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);

const real = createCanvas(W, H);
const g = real.getContext("2d");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = function (t) { return t === "2d" ? g : null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);

const L = window.SNOWLAB;
const S = L.S;
const DT = 1 / 60;

(async () => {
  try {
    L.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg")));
  } catch (e) { L.setBackdrop(null); }

  /* ---- 找一个能触发的井口 ---- */
  L.reset(7);
  for (let i = 0; i < 40; i++) L.step(DT);

  let spot = null;
  for (let k = 1; k < L.FLOORS.length && !spot; k++) {
    const upper = L.FLOORS[k - 1];
    for (const h of (L.LAYERS[k - 1].holes || [])) {
      S.boxes.filter(b => !b.dead && b.x + b.w > h.x && b.x < h.x + h.w &&
                          b.y + b.h > upper - 200 && b.y < upper + 4)
        .forEach(b => { b.dead = true; });
      const y = upper + 144 - L.PLAYER_H;
      const x = h.x + h.w / 2 - L.PLAYER_W / 2;
      S.p.x = x; S.p.y = y; S.p.climb = null; S.p.onGround = true;
      if (L.wellClimb(S.p)) { spot = { k, upper, h, x, y }; break; }
    }
  }
  if (!spot) { console.log("没找到可触发的井口"); process.exit(0); }
  console.log("井口：第 " + spot.k + " 层，x=" + Math.round(spot.h.x) + "，上层面 " + spot.upper);

  /* ---- 站位 + 按 W ---- */
  S.p.x = spot.x; S.p.y = spot.y;
  S.p.vx = 0; S.p.vy = 0; S.p.onGround = true; S.p.climb = null;
  S.foes.length = 0;                       // 清场：别让怪挡住画面
  S.keys = {}; S.keys['w'] = true;
  L.step(DT);
  S.keys = {};

  /* 镜头锁在洞口中间的高度 —— 跟拍的话人一直居中，看不出"上升" */
  const camLock = spot.upper - H * 0.42;

  const CROP = { w: 220, h: 300, zoom: 1.5 };
  const cells = 8, step = 5;
  const trim = { x: spot.h.x - (CROP.w - spot.h.w) / 2, y: spot.upper - 170 };

  const cw = Math.round(CROP.w * CROP.zoom);
  const ch = Math.round(CROP.h * CROP.zoom);
  const pad = 8;
  const out = createCanvas(cw * cells + pad * (cells + 1), ch + 46 + pad * 2);
  const og = out.getContext("2d");
  og.fillStyle = "#0B1621";
  og.fillRect(0, 0, out.width, out.height);

  let f = 0;
  for (let c = 0; c < cells; c++) {
    /* 走到第 c 格对应的帧 */
    while (f < c * step) {
      S.cam.y = camLock; L.step(DT); f++;
    }
    S.cam.y = camLock;
    L.draw();

    const ox = pad + c * (cw + pad);
    og.drawImage(real, trim.x, trim.y, CROP.w, CROP.h, ox, 8, cw, ch);
    og.strokeStyle = "rgba(140,190,220,.35)"; og.lineWidth = 1;
    og.strokeRect(ox + .5, 8.5, cw - 1, ch - 1);

    og.fillStyle = "#8FB6CD";
    og.font = '600 15px "Microsoft YaHei",sans-serif';
    og.textAlign = "center";
    og.fillText("帧 " + f, ox + cw / 2, ch + 30);
    og.fillStyle = "#DFF2FF";
    og.fillText("脚 y=" + Math.round(S.p.y + S.p.h), ox + cw / 2, ch + 48);
  }

  fs.writeFileSync(path.join(OUT, "_climb-seq.png"), out.toBuffer("image/png"));
  console.log("出图 shots/_climb-seq.png（" + out.width + "×" + out.height + "）");
})();
