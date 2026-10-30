/* ===========================================================================
   第 3 步：六只 BOSS 的体型与壳数对照
   ---------------------------------------------------------------------------
   第 48 关那只单看没问题，**加了五只之后必须回答另一个问题**：
   「第 8 关遇到的那只，和第 40 关遇到的，是同一只吗？」

   一张图回答两件事：
     ① 六关的画面里，BOSS 站的位置都不挡门、不压箱（出图是唯一能看见的）；
     ② 六只并排抠出来，体型差**在剪影上**读得出（96 / 114 / 132）。

   为什么不能只靠断言：断言只能验数字递进，验不出"96 和 114 差 18px，
   在 960 宽的屏幕上是不是等于没差"。数值递增和视觉递增是两件事。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_boss6-shot.js
   环境变量：ART=1 挂磁盘真立绘
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const ART = !!process.env.ART;
const PROTO = path.join(ROOT, "prototype", "snowlab.html");
const FONT = "Microsoft YaHei, PingFang SC, sans-serif";
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
  if (ART) {
    try { window.SNOWLAB.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
    catch (e) { }
    try { window.SNOWLAB.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { }
  }
  return { L: window.SNOWLAB, S: window.SNOWLAB.S, real, g };
}

/* 锁到门厅层（BOSS 站的那层），清掉飘字和球 —— 否则每格都带着上一关的文字。 */
function aim(L, S, stage) {
  const k = L.FLOORS.length;
  const bottom = L.FLOORS[k - 1];
  S.cam.y = clamp(bottom + 26 - H / 2 + 40, 0, L.WORLD_H - H);
  S.cam.k = k;
  S.showMeter = false; S.showHint = false; S.showHud = false;
  S.texts.length = 0; S.balls.length = 0; S.shots.length = 0;
  S.shake = 0; S.flash = 0;
  S.t = 12;
  L.placePlayer(70, bottom - L.PLAYER_H);
  S.p.vy = 0; S.p.onGround = true;
  void stage;
}

function shoot(inst, stage) {
  const { L, S } = inst;
  L.reset(L.stageSeed(stage), stage);
  const B = S.boss;
  if (!B) throw new Error("第 " + stage + " 关没有 BOSS —— 摆位失败了");
  aim(L, S, stage);
  L.draw();
  /* **卡必须当场缩、特写必须当场抠。** 六关都画完再回头从 `inst.real`
     取，拿到的全是最后一关（上一版四格特写全一样，就是栽在这儿）。 */
  const card = createCanvas(W / 2, H / 2);
  card.getContext("2d").drawImage(inst.real, 0, 0, W / 2, H / 2);

  /* 特写窗口固定 240×200、**BOSS 居中** —— 不能按 B.w 裁，
     否则 96 宽和 132 宽裁出来一样大，"体型差"这张图就白拍了。
     垂直也要居中：第一版按 `B.y + B.h - 40 - CH` 贴底取，BOSS 只露上半身，
     壳的圈数看不全（而圈数正是这张图要验的东西）。 */
  const CW = 240, CH = 200, Z = 1.6;
  const crop = createCanvas(Math.round(CW * Z), Math.round(CH * Z));
  crop.getContext("2d").drawImage(
    inst.real,
    B.x + B.w / 2 - CW / 2, B.y + B.h / 2 - CH / 2 - S.cam.y, CW, CH,
    0, 0, Math.round(CW * Z), Math.round(CH * Z));
  return { card, crop, B };
}

(async () => {
  const inst = await boot();
  const { L } = inst;
  /* `STAGES=` 可以换一组关号 —— 传负数就是深潜的深度（`-5` = 深度 5）。
     深潜的档位走 `diveBossTier`，主线的走 `bossTierOf`，两者不通用：
     深潜封顶在第三档，而主线第 48 关是第六档。 */
  const custom = (process.env.STAGES || '').split(',').map(Number).filter(n => n);
  const stages = custom.length ? custom : L.BOSS_STAGES;
  const tierOf = st => (st < 0 ? L.diveBossTier(st) : L.bossTierOf(st));
  const tag = st => (st < 0 ? "深度 " + (-st) : "第 " + st + " 关");
  const rows = stages.map(st => {
    const r = shoot(inst, st);
    const t = tierOf(st);
    if (!t) throw new Error(tag(st) + " 没有档位");
    console.log(tag(st) + " · " + t.cn + " · 壳 " + t.shell + " · 门槛 " + t.breakPow +
      " · 宽 " + t.w + " · 实摆 x " + Math.round(r.B.x) + " · 巢 " +
      L.S.nests.filter(n => n.left > 0 && n.x + 24 > r.B.x && n.x < r.B.x + r.B.w).length);
    return { st, t, ...r };
  });

  const PAD = 10, SW = W / 2, SH = H / 2, TOP = 84;
  const COLS = Math.min(3, rows.length);
  const cv = createCanvas(PAD * (COLS + 1) + SW * COLS, TOP + (SH + 50) * Math.ceil(rows.length / COLS) + PAD);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
  g.font = "bold 21px " + FONT; g.fillStyle = "#1B2430";
  g.fillText(custom.length && custom[0] < 0
    ? "深潜的 BOSS：每 5 层一只（档位封顶第三档）"
    : "六只 BOSS：位置、体型、壳数（每 8 关一只）", 14, 32);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("判据：不读标题，能不能从剪影认出「这只比上一只硬」。", 14, 56);

  rows.forEach((r, i) => {
    const col = i % COLS, row = (i / COLS) | 0;
    const x = PAD + col * (SW + PAD), y = TOP + row * (SH + 50);
    g.drawImage(r.card, x, y, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, SW - 2, SH - 2);
    g.font = "bold 15px " + FONT; g.fillStyle = "#1B2430";
    g.fillText(tag(r.st) + " · " + r.t.cn, x + 2, y + SH + 20);
    g.font = "12px " + FONT; g.fillStyle = "#6B7B8B";
    g.fillText("壳 " + r.t.shell + " · 门槛 " + r.t.breakPow + " · 宽 " + r.t.w, x + 2, y + SH + 38);
  });
  const outName = custom.length && custom[0] < 0 ? "boss6-dive.png" : "boss6-stage.png";
  fs.writeFileSync(path.join(OUT, outName), cv.toBuffer("image/png"));

  /* ---- 并排特写：体型 ------------------------------------------------------------------
     **窗口固定、BOSS 居中**，所以宽 96 和宽 132 的差别是真实画出来的差别。 */
  {
    const cw = rows[0].crop.width, chh = rows[0].crop.height, GAP = 8;
    const cols2 = Math.min(3, rows.length);
    const strip = createCanvas(GAP + (cw + GAP) * cols2,
      40 + (chh + 30) * Math.ceil(rows.length / cols2) + GAP);
    const sg = strip.getContext("2d");
    sg.fillStyle = "#FFFDF8"; sg.fillRect(0, 0, strip.width, strip.height);
    sg.font = "bold 14px " + FONT; sg.fillStyle = "#1B2430";
    sg.fillText("窗口固定 240×200、BOSS 居中 —— 这六格里的差别就是真实的体型差", GAP, 24);
    rows.forEach((r, i) => {
      const col = i % cols2, row = (i / cols2) | 0;
      const x = GAP + col * (cw + GAP), y = 40 + row * (chh + 30);
      sg.drawImage(r.crop, x, y);
      sg.strokeStyle = "#E2E6EC"; sg.lineWidth = 1;
      sg.strokeRect(x + 0.5, y + 0.5, cw - 1, chh - 1);
      sg.font = "bold 13px " + FONT; sg.fillStyle = "#1B2430";
      sg.fillText(tag(r.st) + " · 壳 " + r.t.shell + " · 宽 " + r.t.w, x + 2, y + chh + 20);
    });
    fs.writeFileSync(path.join(OUT, outName.replace(".png", "-size.png")), strip.toBuffer("image/png"));
  }

  console.log("\n出图 " + path.join(OUT, outName));
})();
