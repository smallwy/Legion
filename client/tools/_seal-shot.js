/* ===========================================================================
   封关（seal）：第一个"必须让球变大"的考点
   ---------------------------------------------------------------------------
   排班表证明"这一关是封关"，这张图证明**它真的挡人**。

   两格是同一关、同一层、同一个镜头，唯一差别是冰墙破没破：
     左：门厅入口被冰墙封死 —— 中球撞上去 1517，门槛 1550，弹回来；
     右：大球撞上去 1824，墙碎，洞口露出来。
   **镜头必须放在"封口层"（nF-2），不是地表层** —— 封口在倒数第二层，
   开局镜头上根本看不到，这也是它容易被写错成"没生效"的原因。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_seal-shot.js
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

/** 进第 n 关，镜头压到"封口层"（nF-2），跑 30 帧落定后 draw。 */
function shotSealLayer(inst, n, breakIt) {
  const { L, S } = inst;
  L.startStage(n);
  S.texts.length = 0;
  S.showMeter = false; S.showHint = false; S.showHud = false;
  for (let i = 0; i < 30; i++) L.step(1 / 60);

  const nF = S.level.floors.length;
  const k = nF - 2;
  /* **先把冰墙的包围盒记下来，再拆。** 拆完就找不到了，而高亮框要用它 ——
     两格框在同一个位置，"这里封着"和"这里通了"才是同一处地方的对比。 */
  let gate = null;
  for (const b of S.boxes) {
    if (b.mat !== 'ice' || b.y <= S.level.floors[k] - 110 || b.y >= S.level.floors[k]) continue;
    if (!gate) gate = { x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h };
    else {
      gate.x0 = Math.min(gate.x0, b.x); gate.x1 = Math.max(gate.x1, b.x + b.w);
      gate.y0 = Math.min(gate.y0, b.y); gate.y1 = Math.max(gate.y1, b.y + b.h);
    }
  }
  if (breakIt) {
    /* 把封口层的冰墙打掉 —— 这一步**借用真实的 breakBox**，不是从数组里删，
       否则"墙碎之后洞口长什么样"和真正玩的时候不一样。 */
    for (const b of S.boxes.slice()) {
      /* **整层都要删。** 冰墙是 2 格高（HGT=2），只删上面那格的话
         下面还留着一截浅蓝 —— 出图上"砸开了"和"没砸开"看起来一样。 */
      if (b.mat === 'ice' && b.y > S.level.floors[k] - 110 && b.y < S.level.floors[k]) {
        L.breakBox(b, 'ball', 9999, 0, 1);
      }
    }
    /* 多跑一会儿让碎片散干净 —— 只跑 10 帧的话，绿框里还堆着浅蓝的碎块，
       和旁边的冰墙混在一起，"通了"这件事看不出来。 */
    for (let i = 0; i < 60; i++) L.step(1 / 60);
    S.frags.length = 0;
    S.texts.length = 0;
  }

  S.cam.y = clamp(S.level.floors[k] - H * 0.62, 0, Math.max(0, L.WORLD_H - H));
  S.cam.k = 0;
  S.texts.length = 0;
  L.draw();
  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(inst.real, 0, 0);
  return { card: c, camX: S.cam.x || 0, camY: S.cam.y || 0, floorY: S.level.floors[k], k, nF, gate };
}

(async () => {
  const inst = await boot();
  const { L } = inst;
  /* 挑一关 5 层以上的封关关：层数少的话镜头会贴到地图顶，对比看不出来。 */
  let pick = null;
  for (let n = 1; n <= 48; n++) {
    if (L.lessonOf(n) !== 'seal') continue;
    const g = L.genLevel(L.stageSeed(n), n);
    if (g.nFloors >= 5) { pick = { n, nF: g.nFloors }; break; }
  }
  if (!pick) { console.error('没有 5 层以上的封关关'); process.exit(1); }

  const a = shotSealLayer(inst, pick.n, false);
  const b = shotSealLayer(inst, pick.n, true);

  const COLS = 2, PAD = 18, TOP = 128;
  const SW = (W - PAD * (COLS + 1)) / COLS | 0;
  const SH = (SW * H / W) | 0;
  const CW = W;
  const CH = TOP + SH + 150;
  const cv = createCanvas(CW, CH);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, CW, CH);

  g.font = "bold 24px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("封关：中球真的过不去，大球才砸得开", PAD, 38);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("第 " + pick.n + " 关 · 第 " + (pick.nF - 1) + " 层（门厅入口，共 " + pick.nF +
    " 层）· 同一个镜头，只差冰墙破没破。", PAD, 64);
  g.fillStyle = "#E05A2B";
  g.fillText("封口层不是地表层 —— 开局镜头看不到它，这也是它容易被写成「没生效」的原因。", PAD, 86);

  const labels = [
    { cn: "球还没喂大", sub: "冰墙封着 · 中球 pow 1517 < 门槛 1550", col: "#B4472F" },
    { cn: "喂大之后", sub: "墙碎 · 大球 pow 1824 > 门槛 1550", col: "#2F8F8A" },
  ];
  [a, b].forEach((s, i) => {
    const cx = PAD + i * (SW + PAD), cy = TOP;
    g.drawImage(s.card, cx, cy, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(cx + 1, cy + 1, SW - 2, SH - 2);
    g.fillStyle = labels[i].col;
    g.fillRect(cx, cy - 22, 120, 20);
    g.font = "bold 12px " + FONT; g.fillStyle = "#FFFFFF";
    g.fillText(labels[i].cn, cx + 12, cy - 7);
    g.font = "bold 12px " + FONT; g.fillStyle = "#4A5866";
    g.fillText(labels[i].sub, cx + 128, cy - 7);

    /* 封口位置的框。**两格画在同一个世界坐标上** —— 框住的是"这处地方"，
       不是"这堵墙"，这样左右对比的时候眼睛不用重新定位。 */
    if (s.gate) {
      const sx = v => cx + (v - s.camX) * (SW / W);
      const sy = v => cy + (v - s.camY) * (SH / H);
      g.strokeStyle = i === 0 ? "#D9342B" : "#2F8F8A";
      g.lineWidth = 3;
      g.setLineDash([7, 5]);
      g.strokeRect(sx(s.gate.x0) - 6, sy(s.gate.y0) - 6,
        (s.gate.x1 - s.gate.x0) * (SW / W) + 12, (s.gate.y1 - s.gate.y0) * (SH / H) + 12);
      g.setLineDash([]);
      /* 标签压在深色场景上会糊在一起，垫一块同色实底。 */
      const tag = i === 0 ? "封死" : "通了";
      g.font = "bold 15px " + FONT;
      const tw = g.measureText(tag).width + 14;
      g.fillStyle = i === 0 ? "#D9342B" : "#2F8F8A";
      g.fillRect(sx(s.gate.x0) - 6, sy(s.gate.y0) - 34, tw, 22);
      g.fillStyle = "#FFFFFF";
      g.fillText(tag, sx(s.gate.x0) + 1, sy(s.gate.y0) - 18);
    }
  });

  /* 底部：这三行是这一关为什么成立的算术，不是形容词 */
  const y0 = TOP + SH + 22;
  g.font = "bold 14px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("为什么「必须喂球」不是形容词，是算术：", PAD, y0);
  g.font = "13px " + FONT; g.fillStyle = "#4A5866";
  const rows = [
    "冰墙门槛 1550 = 速度 1209 × 体径比(r/22)。裸球 r22 → 1209，中球 r27.6 → 1517，都差一口气。",
    "大球要 absorbed ≥ 4 = 裹 2 只怪（每只 +2）。所以这一关真正要学的是「先别开枪」。",
    "封口层固定 4~5 只怪（生成时 +1），够攒一颗大球再留两只容错 —— 材料是算过的。",
  ];
  rows.forEach((t, i) => g.fillText(t, PAD, y0 + 26 + i * 22));

  const out = path.join(OUT, "seal-gate.png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out);
  console.log("样本：第 " + pick.n + " 关 / " + pick.nF + " 层 / 封口层 floorY=" + a.floorY);

})();
