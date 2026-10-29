/* ===========================================================================
   帧率条出图 —— 三档同屏，用来检查文字有没有溢出/豆腐块/压住 HUD
   ---------------------------------------------------------------------------
   帧率条显示 `58 fps · 17.2ms · 峰 21ms` 三段。**第三段是关键**：

     · 平均帧率会把"偶发长帧"抹平 —— 60 帧里夹一帧 300ms，
       平均下来还是 58fps，可玩家看到的就是卡了一下；
     · 所以"卡"要分两种读：帧率低（每帧都慢）vs 峰时长高（平时快、偶尔停）。
       判据不同，改法完全不同。

   `@napi-rs/canvas` **不做逐字形回退**，等宽栈里没有 CJK 就会把"峰"渲成豆腐块
   （浏览器会自己回退，所以这个坑只有离屏出图才看得见）。字体栈里那句
   `"Microsoft YaHei"` 就是为它加的 —— 删之前先跑本工具看一眼。

   跑法：NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
         node client/tools/_perfhud-shot.js
   出图：client/shots/_perfhud-<0..2>-<档名>.png
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "prototype", "snowlab.html");
const OUT = path.join(ROOT, "shots");

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("找不到内联脚本"); process.exit(1); }

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;

/* 和 `_snowlab-shot.js` 一样：整块画布给同一个 ctx，离屏的画到真正的离屏对象上 */
const cv = createCanvas(960, 600);
window.HTMLCanvasElement.prototype.getContext = function () { return cv.getContext("2d"); };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);

const L = window.SNOWLAB, S = L.S;
if (L.setOffscreen) L.setOffscreen((w, h) => createCanvas(w, h));

/* 静态层要一次真实 draw 才会建起来，先跑几帧让画面稳定 */
L.newLevel(7);
for (let i = 0; i < 30; i++) L.step(1 / 60);

const cases = [
  ["好",       58, 17.2, 21],   // 绿：帧率够、峰也短
  ["偶发长帧", 57, 17.5, 320],  // 红：平均很好看，但一秒里停过 320ms
  ["整体慢",   38, 26.3, 41],   // 黄：每帧都超预算
];

cases.forEach(([name, fps, ms, worst], i) => {
  S.perf.on = true;
  S.perf.last = 0; S.perf.acc = 0; S.perf.n = 0;
  S.perf.fps = fps; S.perf.ms = ms;
  S.perf.worst = worst; S.perf.wHold = 0; S.perf.wSum = 0;
  L.draw();
  /* draw 里的 perfTick 会往窗口里再加一帧，压回去，免得三张图互相污染 */
  S.perf.n = 0; S.perf.acc = 0;
  const out = path.join(OUT, "_perfhud-" + i + "-" + name + ".png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("✓ " + path.basename(out));
});
