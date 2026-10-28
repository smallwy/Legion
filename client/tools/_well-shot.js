/* 井梯净空自检：把玩家放到井梯顶、洞口里，各截一张。

   为什么单做这一个工具：角色从 42 高提到 63 之后，**井梯顶是全场最紧的位置**
   （碰撞框头顶到上层楼板只剩 7px）。断言能量出这个 7，但量不出
   "看起来憋不憋"——那只能看图。

   跑法：NODE_PATH=<workspace>/node_modules node client/tools/_well-shot.js
*/
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
const W = 960, H = 600;

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
const settle = n => { for (let i = 0; i < n; i++) L.step(DT); };
/* **必须手动调 draw()。** requestAnimationFrame 在上面被设成 noop 了，
   不主动画的话导出的是一张全白 —— 而且它不报错，只是"图凭空消失"。
   这一步和 _snowlab-shot.js 保持一致。 */
const save = name => {
  L.draw();
  fs.writeFileSync(path.join(OUT, name), real.toBuffer("image/png"));
  console.log("  → " + name);
};

/* 找一个有井梯的层位（洞口正下方摞到 3 格的那一列） */
let found = null;
for (let sd = 1; sd <= 12 && !found; sd++) {
  L.reset(sd);
  const N = L.FLOORS.length;
  for (let k = 1; k < N - 1 && !found; k++) {
    const h0 = L.LAYERS[k - 1].holes[0];
    if (!h0) continue;
    const l2 = L.LAYERS[k];
    const a = Math.max(0, Math.ceil(h0.x / 48));
    const b = Math.min(19, Math.floor((h0.x + h0.w) / 48) - 1);
    for (let i = a; i <= b; i++) {
      if ((l2.colHgt[i] || 0) >= 3) { found = { sd, k, col: i, hole: h0 }; break; }
    }
  }
}
if (!found) { console.log("没有找到井梯"); process.exit(1); }

const { sd, k, col, hole } = found;
console.log("种子 " + sd + "：第 " + k + " 层井梯，列 " + col + "，洞 " + hole.x + ".." + (hole.x + hole.w));

L.reset(sd);
S.boxes.forEach(b => { b.dead = false; });
/* 先把上一层洞口上的盖板砸掉，不然一撞头就回来了 */
S.boxes.filter(bx => !bx.dead && bx.x + bx.w > hole.x && bx.x < hole.x + hole.w &&
  bx.y + bx.h > L.FLOORS[k - 1] - 200 && bx.y < L.FLOORS[k - 1] + 4)
  .forEach(bx => L.breakBox(bx, "ball"));
S.foes.length = 0;
settle(20);

/* ① 站在井梯顶（最紧的位置） */
L.placePlayer(col * 48 + 1.5, L.FLOORS[k] - 144 - S.p.h);
settle(12);
const top = S.p.y + S.p.h;
console.log("① 井梯顶：脚 " + top.toFixed(1) + "，碰撞头顶 " + (top - S.p.h).toFixed(1) +
            "，形象头顶 " + (top - S.p.h * 1.29).toFixed(1) + "，上层楼板底 " +
            (L.FLOORS[k - 1] - L.GEN.thick).toFixed(1));
save("_well-top.png");

/* ② 按 W 爬上去的一瞬间 */
S.keys = {}; S.keys["w"] = true; L.step(DT); S.keys = {};
for (let i = 0; i < 40; i++) L.step(DT);
console.log("② 爬完：脚 " + (S.p.y + S.p.h).toFixed(1) + "（上层地板 " + L.FLOORS[k - 1] + "）");
save("_well-climb.png");

/* ③ 洞口正中间往下掉的过程（看两侧楼板会不会夹住人） */
L.placePlayer(hole.x + hole.w / 2 - S.p.w / 2, L.FLOORS[k - 1] - S.p.h - 6);
settle(6);
save("_well-hole.png");
console.log("③ 洞中：x " + S.p.x.toFixed(1) + "，宽 " + S.p.w + "，洞宽 " + hole.w);
