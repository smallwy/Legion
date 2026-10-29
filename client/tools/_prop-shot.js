/* ===========================================================================
   道具放大评审图：箱子 / 木桶 / 陶罐 / 门
   ---------------------------------------------------------------------------
   用户 2026-10-29：「箱子 桶 门 都需要重新规划　太不像了」。
   "像不像"只能看，而整关截图里一口箱子只有 48px、还压在暗处 ——
   把每一件单独放到 4 倍，并排摆在一张图里，才判得出"这一笔对不对"。

   四个条件：4× 放大、铺在场景底色上（不是纯白，白底会把描边读没）、
   每件画"完好 / 被砸 / 特殊态"三档、门画"锁着 / 开着"两档。

   跑法：NODE_PATH=<workspace>/node_modules node client/tools/_prop-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "prototype", "snowlab.html");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const K = 4;                       // 放大倍数
const PAD = 26;
const CW = 48, CH = 48;            // 一格
const COLS = 4;

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
const probe = createCanvas(8, 8).getContext("2d");
window.HTMLCanvasElement.prototype.getContext = () => probe;
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;
/* **先清空场上对象。** `drawDoor` 的第一句就是"被箱子盖着就不画"，
   而这一步读的是 S.boxes —— 不清的话门在这张评审图上永远不出现，
   会被误读成"门没画出来"。 */
L.S.boxes.length = 0;
L.S.door = null;

const W = COLS * (CW * K + PAD) + PAD;
const rows = 3;
const H = rows * (CH * K + PAD) + PAD + 30;
const cv = createCanvas(W, H);
const g = cv.getContext("2d");

/* 底色取"室内墙 + 地板"的中点：纯白会把 3px 描边读没，纯黑会吃掉暗面。 */
g.fillStyle = "#8B6B4A";
g.fillRect(0, 0, W, H);
g.fillStyle = "rgba(255,240,214,.06)";
for (let i = 0; i < 40; i++) g.fillRect(0, i * 24, W, 1);

function box(o) {
  return Object.assign({
    x: 0, y: 0, w: CW, h: CH, mat: "wood", hp: 3, dead: false,
    hitT: 0, frost: false, loot: false, barrel: false, jar: false, fell: 0,
  }, o);
}
function door(o) {
  return Object.assign({
    x: 8, y: 8, w: 32, h: 40, open: false, openT: 1, blocked: false,
  }, o);
}

const ITEMS = [
  ["木箱", box({ mat: "wood" })],
  ["木箱·被砸", box({ mat: "wood", hp: 1, hitT: 0.1 })],
  ["木桶", box({ mat: "wood", barrel: true, hp: 2 })],
  ["陶罐", box({ mat: "stone", jar: true, hp: 1, w: 22, h: 30 })],
  ["石箱", box({ mat: "stone", hp: Infinity })],
  ["铁箱", box({ mat: "iron", hp: Infinity })],
  ["冰墙", box({ mat: "ice", hp: Infinity })],
  ["覆霜箱", box({ mat: "wood", frost: true })],
  ["金箱", box({ mat: "wood", loot: true })],
  ["门·锁着", door({ open: false })],
  ["门·开着", door({ open: true, openT: 2 })],
  ["门在箱堆里", null],
];

function drawItem(item, ox, oy) {
  const [name, o] = item;
  g.save();
  /* 影子：**评审图也要有影子**，否则"浮在墙上"和"立在墙上"看不出来 */
  g.fillStyle = "rgba(0,0,0,.18)";
  g.beginPath();
  g.ellipse(ox + (CW * K) / 2, oy + CH * K + 4, CW * K * 0.42, 5 * K * 0.5, 0, 0, Math.PI * 2);
  g.fill();
  g.translate(ox, oy);
  g.scale(K, K);
  if (o === null) {
    /* 门被箱子埋住的样子：画门 + 上面压一口木箱，看"藏"得住不住 */
    L.drawDoor(g, door({ open: false }));
    L.drawBox(g, box({ mat: "wood" }));
  } else if (o.w === 32) {
    L.drawDoor(g, o);
  } else {
    /* 小件（陶罐 22×30）居中对齐，方便比较 */
    const dx = (CW - o.w) / 2, dy = (CH - o.h);
    L.drawBox(g, Object.assign({}, o, { x: o.x + dx, y: o.y + dy }));
  }
  g.restore();
  g.fillStyle = "#FFF4E2";
  g.font = "bold 15px 'Microsoft YaHei'";
  g.textAlign = "center";
  g.fillText(name, ox + (CW * K) / 2, oy - 8);
}

ITEMS.forEach((it, i) => {
  const cx = i % COLS, cy = Math.floor(i / COLS);
  drawItem(it, PAD + cx * (CW * K + PAD), PAD + 10 + cy * (CH * K + PAD));
});

const out = path.join(OUT, "_props.png");
fs.writeFileSync(out, cv.encodeSync("png"));
console.log("出图：" + out + "  " + W + "×" + H + "（" + K + "× 放大）");
