/* ===========================================================================
   怪物行为时间序列图 —— 一张图看"几秒之内它在干什么"
   ---------------------------------------------------------------------------
   单帧截图看不出行为问题。用户报的「到这里会一直弹弹弹」在任意一帧里都
   只是一只普通的怪，只有把 4 个时刻并排，才看得出"高度一直在变 = 在原地弹"。

   本工具截 4 个时刻（默认 0 / 2 / 5 / 9 秒），裁同一块区域横向拼起来。
   `PROTO=` 指另一份 html 就是改前 / 改后的对照 —— 这是判断"是不是我改坏了"
   唯一可靠的办法，别凭印象。

   **镜头要手动挪。** 默认镜头跟着玩家停在地表层，可要看的怪往往在下面几层，
   不挪就是四张空白（踩过）。只改 `S.cam.y` 不影响物理和 AI，draw 只读它。

   跑法：NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
         node client/tools/_foe-seq-shot.js [种子] [世界x] [世界y] [输出名]
        PROTO=shots/_old.html OUT=shots/_seq-old.png node client/tools/_foe-seq-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const FILE = process.env.PROTO ? path.resolve(process.env.PROTO) : path.join(ROOT, "prototype", "snowlab.html");
const SEED = Number(process.argv[2] || 12);
const WX = Number(process.argv[3] || 864);      // 想看的世界坐标（那只怪所在处）
const WY = Number(process.argv[4] || 1211);
const OUT = process.env.OUT ? path.resolve(process.env.OUT)
                            : path.join(ROOT, "shots", "_foeseq.png");
const MARKS = [0, 120, 300, 540];               // 帧号 = 0s / 2s / 5s / 9s

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("找不到内联脚本"); process.exit(1); }

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
const cv = createCanvas(960, 600);
window.HTMLCanvasElement.prototype.getContext = function () { return cv.getContext("2d"); };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);

const L = window.SNOWLAB, S = L.S;
if (L.setOffscreen) L.setOffscreen((w, h) => createCanvas(w, h));
L.newLevel(SEED);
for (let i = 0; i < 60; i++) L.step(1 / 60);

const shots = [];
let cur = 0;
for (const mk of MARKS) {
  while (cur < mk) { L.step(1 / 60); cur++; }
  S.cam.y = Math.max(0, WY - 300);     // 把目标放到屏幕正中
  L.draw();
  shots.push({ png: cv.toBuffer("image/png"), t: (mk / 60).toFixed(1) });
}

(async () => {
  const CW = 300, CH = 200;
  const OX = Math.max(0, WX - 150);
  const OY = Math.max(0, 300 - 100);   // 目标被挪到屏幕 y=300，所以裁剪起点固定
  const out = createCanvas(CW * shots.length, CH + 22);
  const g = out.getContext("2d");
  g.fillStyle = "#101820"; g.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < shots.length; i++) {
    const img = await loadImage(shots[i].png);
    g.drawImage(img, OX, OY, CW, CH, i * CW, 22, CW, CH);
    g.fillStyle = "#9BE86E";
    g.font = '600 13px "Microsoft YaHei",sans-serif';
    g.fillText(shots[i].t + "s", i * CW + 8, 16);
    g.strokeStyle = "#2A3A46"; g.strokeRect(i * CW, 22, CW, CH);
  }
  fs.writeFileSync(OUT, out.toBuffer("image/png"));
  console.log("✓ " + path.relative(ROOT, OUT) + "（种子 " + SEED + " @ " + WX + "," + WY + "）");
})();
