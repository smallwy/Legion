/* ===========================================================================
   _pet-shot.js —— 主角特写出图（离屏，不开浏览器）
   ---------------------------------------------------------------------------
   为什么单开一个：整屏 960×600 里主角只占 45×63 —— 出图上看不出
   "领巾是不是绿、眼睛是不是黑瞳、尾巴是不是一弯黑棍"，而这些恰恰是
   "这只宠物还认不认得出来"的全部。整屏图只能看布局，看不了角色本身。

   做法：**把画布放大 ZOOM 倍再预乘变换**，然后裁出主角周围那一块。
   不是"渲小图再放大"（那是像素插值，越放越糊），是矢量重绘 —
   坐标全乘 ZOOM，描边宽度也跟着乘，线条是干净的。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_pet-shot.js
     PROTO=<别的 html>  OUT=<输出路径>  ZOOM=6  \
       NODE_PATH=... node tools/_pet-shot.js     # 用来做改前/改后对比

   产物默认落 ../shots/_pet.png（`_` 前缀，按惯例不入库）。
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = process.env.PROTO || path.join(ROOT, "prototype", "snowlab.html");
const OUT = process.env.OUT || path.join(ROOT, "shots", "_pet.png");
const ZOOM = Number(process.env.ZOOM || 6);

const W = 960, H = 600;
const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);

/* 画布按 ZOOM 放大，但脚本里所有坐标还是 960×600 的逻辑坐标。
   **不能只 `g.scale(ZOOM)`** —— snowlab 在初始化时会自己调一次
   `ctx.setTransform(dpr, ...)` 来接 devicePixelRatio，那一下会把预乘的变换
   整个冲掉，结果图里什么都没有（第一版就是这么白了一整张）。
   做法是把 setTransform 包一层，所有进来的矩阵统一再乘 ZOOM。
   这样脚本写 `setTransform(1,...)` 等价于 scale(ZOOM)，`save/restore` 照常。 */
const real = createCanvas(W * ZOOM, H * ZOOM);
const g = real.getContext("2d");
const setT = g.setTransform.bind(g);
g.setTransform = (a, b, c, d, e, f) => setT(a * ZOOM, b * ZOOM, c * ZOOM, d * ZOOM, e * ZOOM, f * ZOOM);
g.setTransform(ZOOM, 0, 0, ZOOM, 0, 0);

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = function (t) { return t === "2d" ? g : null; };
window.requestAnimationFrame = () => 0;

window.eval(m[1]);
const L = window.SNOWLAB;
const S = L.S;
const DT = 1 / 60;

L.reset(1);
S.showMeter = false;
/* 站在地表最左那段实心地板上：相机的 x 不偏移（关卡正好一屏宽），
   所以主角的屏幕坐标 = 世界坐标，裁切框可以直接算。 */
const seg = L.LAYERS[0].segs.filter(s => s.w >= 120).sort((a, b) => b.w - a.w)[0] || L.LAYERS[0].segs[0];
L.placePlayer(seg.x + Math.min(seg.w * 0.35, 300), L.FLOORS[0] - L.ART_K * 42);
/* 让镜头缓动到位、待机呼吸稳定下来 */
for (let i = 0; i < 80; i++) L.step(DT);
S.foes.forEach(f => { f.speed = 0; f.vx = 0; });
S.t = 12;
L.draw();

/* 裁切：以脚底为基准，往上取够头顶 + 呆毛，左右留出尾巴的余量。
   数值按 ART_K=1.5 下的实际包围盒给的，换尺度要一起改。 */
const cx = S.p.x + S.p.w / 2;
const by = S.p.y + S.p.h - S.cam.y;
const CW = 132, CH = 132;
const sx = Math.round(cx - CW / 2), sy = Math.round(by - CH + 12);

const out = createCanvas(CW * ZOOM, CH * ZOOM);
const og = out.getContext("2d");
og.drawImage(real, sx * ZOOM, sy * ZOOM, CW * ZOOM, CH * ZOOM, 0, 0, CW * ZOOM, CH * ZOOM);

if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.toBuffer("image/png"));
console.log("✓ " + OUT + "  " + (CW * ZOOM) + "×" + (CH * ZOOM) + "  (裁 " + CW + "×" + CH + " @ " + sx + "," + sy + ")");
