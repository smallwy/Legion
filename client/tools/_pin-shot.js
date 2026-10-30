/* ===========================================================================
   第五十二轮：踩实的球（冰墩）
   ---------------------------------------------------------------------------
   一张图回答三个问题：
     ① 它看起来像"那颗球被压扁了"，还是像"地上凭空多了个方块"？
     ② 它和旁边没压实的球、和地上的箱子，能不能一眼分开？
     ③ 玩家站在上面这件事，看不看得出来？

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_pin-shot.js
   环境变量：ART=1 挂磁盘真立绘；STAGE=n 换关（默认 3）
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const STAGE = Number(process.env.STAGE || 3);
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

/** 把镜头锁到最底层（墩一定长在地板上），并把这一层清空成"试验台"。
 *  **清箱子是必须的**：不清的话墩会长在箱堆里，玩家站上去被箱子顶下来，
 *  图上看起来像"踩实会把人弹飞"—— 而这个结论是错的，错的是取景。 */
function aimFloor(inst, clearBoxes) {
  const { L, S } = inst;
  const floor = L.S.plats.filter(p => p.w > 200).sort((a, b) => b.y - a.y)[0];
  const fy = floor.y;
  S.cam.y = clamp(fy - 380, 0, L.WORLD_H - H);
  S.cam.k = 0;
  S.showMeter = false; S.showHint = false; S.showHud = true;
  S.texts.length = 0; S.balls.length = 0; S.shots.length = 0;
  S.pins.length = 0; S.foes.length = 0; S.shake = 0; S.flash = 0;
  S.t = 12;
  if (clearBoxes) {
    /* 只清这一层、且不压着地板的箱子 —— 清光的话画面空得像测试场景，
       图上判断不了"它和箱子分不分得开"。 */
    for (const b of S.boxes) {
      if (b.y >= fy - 190) { b.dead = true; }
    }
  }
  return floor;
}

function put(inst, x, r, dy) {
  const { L, S } = inst;
  const floor = L.S.plats.filter(p => p.w > 200).sort((a, b) => b.y - a.y)[0];
  const b = {
    x, y: floor.y - r - (dy || 0), vx: 0, vy: 0, r,
    absorbed: r < 26 ? 1 : r < 34 ? 3 : 6,
    life: 16, weak: false, onGround: true, chain: 0, hitCd: 0, dead: false,
  };
  void S;
  return b;
}

/** `zoom` 是**给对比格用的近景**：小球只有 34px 高的墩，缩到 480×300
 *  的格子里只剩 17px，读者看不出它是圆柱还是方块。近景不靠"再画大一点"
 *  （那是假的），而是把已经画好的那一帧裁一块放大。 */
function card(inst, zoom, cx, cy) {
  inst.S.texts.length = 0;
  inst.L.draw();
  const c = createCanvas(W, H);
  const g2 = c.getContext("2d");
  g2.imageSmoothingQuality = "high";
  if (!zoom) { g2.drawImage(inst.real, 0, 0); return c; }
  const sw = W / zoom, sh = H / zoom;
  const sx = clamp((cx == null ? W / 2 : cx) - sw / 2, 0, W - sw);
  const sy = clamp((cy == null ? H / 2 : cy) - sh / 2, 0, H - sh);
  g2.drawImage(inst.real, sx, sy, sw, sh, 0, 0, W, H);
  return c;
}

(async () => {
  const inst = await boot();
  const { L, S } = inst;

  L.startStage(STAGE);
  const floor = aimFloor(inst, true);
  const fy = floor.y;

  /* 四个状态，各占一格：
       ① 一颗小球 + 一颗大球并排（未压实）—— 基线，看清楚球长什么样
       ② 小球压实（矮墩）
       ③ 大球压实（高墩）
       ④ 玩家站在大墩上 */
  const shots = [];

  // ① 未压实（玩家站在旁边，顺便验气泡里"能踩"那行有没有出来）
  S.pins.length = 0; S.balls.length = 0;
  S.showHint = true;
  S.balls.push(put(inst, 240, 22, 0));
  S.balls.push(put(inst, 360, 46, 0));
  S.p.x = 285; S.p.y = fy - S.p.h;
  S.t = 1.4;
  shots.push(card(inst));
  S.showHint = false;

  // ② 同一档球，踩实前后（近景 2 倍）
  S.balls.length = 0; S.pins.length = 0;
  S.balls.push(put(inst, 290, 46, 0));           // 左边：还是球
  const s2 = put(inst, 430, 46, 0); S.balls.push(s2); L.pinBall(s2);
  S.p.x = 700; S.p.y = fy - S.p.h;
  shots.push(card(inst, 2, 360, fy - S.cam.y - 70));

  // ③ 大球压实（三种档位并排）
  S.balls.length = 0; S.pins.length = 0;
  for (const [i, r] of [[0, 22], [1, 30], [2, 38], [3, 46]]) {
    const b = put(inst, 210 + i * 96, r, 0);
    S.balls.push(b); L.pinBall(b);
  }
  S.p.x = 760; S.p.y = fy - S.p.h;
  shots.push(card(inst));

  // ④ 站在上面
  S.balls.length = 0; S.pins.length = 0;
  const big = put(inst, 480, 46, 0); S.balls.push(big); L.pinBall(big);
  const k = S.pins[0];
  S.p.x = k.x + k.w / 2 - S.p.w / 2;
  S.p.y = k.y - S.p.h;
  S.p.vy = 0;
  for (let i = 0; i < 6; i++) L.step(1 / 60);
  shots.push(card(inst));

  const LABELS = [
    "① 基线：没踩实的球（右边那颗会出气泡）",
    "② 两颗同档球：左边没踩，右边踩实（近景 2 倍）",
    "③ 踩实：四档球的墩高依次变高",
    "④ 玩家站在墩上（顶面的亮椭圆就是「能站」）",
  ];

  const SW = 480, SH = 300, PADX = 12, PADY = 34, TOP = 96;
  const cv = createCanvas(PADX * 3 + SW * 2, TOP + (SH + PADY) * 2 + 24);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
  g.font = "bold 20px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("踩实（C）：把一颗球变成地形", 14, 34);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("不可反悔 · 从此不能推、不能砸门 · 空中不让踩", 14, 58);
  shots.forEach((s, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x = PADX + col * (SW + PADX), y = TOP + row * (SH + PADY);
    g.drawImage(s, x, y, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, SW - 2, SH - 2);
    g.font = "bold 14px " + FONT; g.fillStyle = "#1B2430";
    g.fillText(LABELS[i], x + 2, y - 9);
  });

  const out = path.join(OUT, "pin-" + STAGE + (ART ? "-art" : "") + ".png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图", out);

  /* 顺便量一下墩和球、墩和地板的色差 —— "看起来像球被压扁"这件事，
     人和脚本的判断标准不一致时以图为准，但一个机械指标能防止我自欺。 */
  console.log("墩数", S.pins.length, "· 墩高", S.pins.map(p => p.h.toFixed(1)).join("/"));
})().catch(e => { console.error(e); process.exit(1); });
