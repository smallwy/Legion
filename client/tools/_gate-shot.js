/* ===========================================================================
   深巢无尽：过门三选一（2026-10-31 第 5 刀）
   ---------------------------------------------------------------------------
   用户 2026-10-31：「深巢无尽和雪原玩法一样？哪有什么好玩的啊」。

   这张图要证明的不是"多了一个弹窗"，而是**门口多了一个决定**：
     左：补给关（深度 1~4 每次过门）—— 饱食换血 / 换弹，还是吃回去；
     中：词条关（深度 5 / 10 / 15 / 20）—— 四条词条全部成对，
         代价和收益一起带走，选过的不再出现；
     右：选完之后 —— 芯片亮着，深度 +1，资源是我们自己换来的。

   为什么必须出图：三张牌这个尺寸（240×296 × 3）在 960 宽的画布上
   刚好放得下，但"刚好"两个字的余量只有 42px。压缩一行就变成
   "牌边缘贴在一起"，而那在代码里没有任何断言能抓到。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_gate-shot.js
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

function grab(inst) {
  L_draw(inst);
  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(inst.real, 0, 0);
  return c;
}
function L_draw(inst) {
  inst.S.texts.length = 0;
  inst.L.draw();
}

(async () => {
  const inst = await boot();
  const { L, S } = inst;

  /* ---------- ① 补给关：深度 3（不是 1 —— 深度 1 的饱食是满的，
     三张牌在"饱食满"的状态下看不出取舍，玩家只会随便点一张） ---------- */
  L.startDive(20261031);
  S.dive.depth = 3;
  S.hp = 2; S.belly = 46; S.ammo = 5;
  L.openGate();
  const a = grab(inst);
  const aCards = S.gateCards.map(c => c.cn + "／" + c.gain + "／" + c.cost);

  /* ---------- ② 词条关：深度 5 ---------- */
  S.dive.picks = [];
  S.dive.depth = 5;
  L.openGate();
  const b = grab(inst);
  const bCards = S.gateCards.map(c => c.cn + "／" + c.gain + "／" + c.cost);

  /* ---------- ③ 选完之后：真的选一条，看芯片和深度 ----------
     **必须走 pickGate，不能手改 picks** —— 手改的话"牌上的字"和
     "选完之后的状态"可能是两套逻辑，图上看不出来，玩起来对不上。 */
  const pickIdx = S.gateCards.length - 1;
  const picked = S.gateCards[pickIdx].cn;
  L.pickGate(pickIdx);
  for (let i = 0; i < 40; i++) L.step(1 / 60);
  const c = grab(inst);
  /* 显示中文名，不是 id —— `diveMods()` 返回的是 id（cold），
     而卡片上印的是「急冻」。图里混着 id 的话，看图和玩起来对不上。 */
  const modsCN = L.diveMods().map(id => (L.DIVE_MODS.find(m => m.id === id) || {}).cn || id);
  const mods = modsCN.join("/") || "（无）";

  /* ---------- 拼图 ---------- */
  const COLS = 3, PAD = 16, TOP = 150;
  const SW = (W - 16) | 0;
  const SH = (SW * H / W) | 0;
  const SCALE = 0.62;
  const TW = (SW * SCALE) | 0, TH = (SH * SCALE) | 0;
  const CW = PAD + COLS * (TW + PAD);
  const CH = TOP + TH + 138;
  const cv = createCanvas(CW, CH);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, CW, CH);

  g.font = "bold 24px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("深巢无尽：过门从「自动下一层」变成「三选一」", PAD, 38);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("主线进门就完事，因为它没有可带走的东西；深潜把血/饱食/弹药带过门，" +
    "那就必须在门口花掉它 —— 这才是「经营」和「解谜」的区别。", PAD, 64);
  g.fillStyle = "#E05A2B";
  g.fillText("每 5 层换成词条牌：四条词条全部成对（代价 + 收益），选过的不再出现。", PAD, 86);
  g.fillStyle = "#8A6A3A";
  g.fillText("深度 1 不给词条 —— 先让玩家把资源攒起来，第一层不该考他构筑。", PAD, 108);

  const shots = [
    { cv: a, cn: "补给关 · 深度 3", sub: "饱食 46 / 血 2 / 弹 5 → 换一样", col: "#2F7F8F", cards: aCards },
    { cv: b, cn: "词条关 · 深度 5", sub: "四条里发三张，选一条带一路", col: "#B4472F", cards: bCards },
    { cv: c, cn: "选完「" + picked + "」之后", sub: "深度 " + S.dive.depth + " · 词条 " + mods, col: "#5C7A2F", cards: [] },
  ];
  shots.forEach((s, i) => {
    const cx = PAD + i * (TW + PAD), cy = TOP;
    g.drawImage(s.cv, cx, cy, TW, TH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(cx + 1, cy + 1, TW - 2, TH - 2);
    g.fillStyle = s.col;
    g.fillRect(cx, cy - 22, 132, 20);
    g.font = "bold 12px " + FONT; g.fillStyle = "#FFFFFF";
    g.fillText(s.cn, cx + 10, cy - 7);
    g.font = "bold 12px " + FONT; g.fillStyle = "#4A5866";
    g.fillText(s.sub, cx + 140, cy - 7);
    /* 卡片上的字用文字复述一遍 —— 缩到 62% 之后 13px 的中文已经读不出来了，
       而"牌上写了什么"恰恰是这张图要给人看的东西。 */
    g.font = "12px " + FONT; g.fillStyle = "#6B7A88";
    s.cards.forEach((t, j) => g.fillText((j + 1) + ". " + t, cx + 2, cy + TH + 20 + j * 18));
  });

  const FY = TOP + TH + 96;
  g.font = "bold 13px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("为什么这三张牌能让两个模式分开：", PAD, FY);
  g.font = "13px " + FONT; g.fillStyle = "#4A5866";
  const lines = [
    "· 主线：48 关是设计好的，你的任务是看懂它然后解 —— 死了满血续，重来不亏。",
    "· 无尽：关卡是随机发的，你的任务是在资源约束下活下去 —— 一命到底，每层都要花掉一点。",
    "· 所以无尽的核心不是「更难」，是「这一层我换什么」。没有这个决定，它就只是主线的困难版。",
  ];
  lines.forEach((t, i) => g.fillText(t, PAD, FY + 22 + i * 20));

  const out = path.join(OUT, "dive-gate.png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out);
  console.log("补给牌 " + aCards.join(" | "));
  console.log("词条牌 " + bCards.join(" | "));
  console.log("选完后 深度 " + S.dive.depth + " 词条 " + mods + " 血 " + S.hp + " 饱食 " + Math.round(S.belly));
})().catch(e => { console.error(e); process.exit(1); });
