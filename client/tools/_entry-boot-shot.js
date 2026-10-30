/* ============================================================================
   _entry-boot-shot.js —— 出征页在 Cocos 里的第一帧（离屏出图）

   为什么单独造这个：`grove-dom-harness.js` 要在真浏览器里跑（美术图靠
   `new Image()` 解码），沙箱里没有浏览器。而「点出发之后黑屏」这件事，
   必须回答的是**画布上到底有没有东西** —— 这个用离屏 canvas 就能验，
   而且能直接出图看。

   和 GroveBattle 的唯一差别：组件那一层（DOM 叠加、相机、异步美术）
   换成直接用 `groveAttachCanvas` 交一块 canvas 进去。
   换句话说，这里验的是"运行时本身在出征页画不画得出来"，
   如果这里能出图、真机还是黑，那问题就在挂载层，不在玩法层。

   用法：node tools/_entry-boot-shot.js
         PHASE=gates（默认）| play
   ========================================================================== */

const fs = require("fs");
const path = require("path");
/* `typescript` 只装在 Cocos 编辑器里（Cocos 用它编译项目脚本），
   工作区的 node_modules 里没有。**不能靠 NODE_PATH 拼两条** ——
   Windows 的路径本身带冒号，POSIX 分隔符会把第二条拆坏（实测报"找不到
   @napi-rs/canvas"，而它明明在第一条里）。所以第二条用绝对路径兜底。 */
function req(name, absDir) {
  try { return require(name); } catch (e) {
    if (!absDir) throw e;
    return require(absDir);
  }
}
const ts = req("typescript",
  "C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "assets/scripts/grove/GroveRuntime.ts");
const OUT_DIR = path.join(ROOT, "tools/_grove-build");
const SHOT = path.join(ROOT, "shots/grove-entry-boot.png");

const W = 960, H = 600;

/* ---- 转译：GroveRuntime.ts 里没有 import 'cc'，可以直接跑 ---- */
const src = fs.readFileSync(SRC, "utf8");
const out = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
const errs = (out.diagnostics || []).filter((d) => d.category === 1);
if (errs.length) {
  for (const e of errs) console.error(ts.flattenDiagnosticMessageText(e.messageText, "\n"));
  throw new Error("GroveRuntime.ts 有语法错误");
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, "GroveRuntime.js");
fs.writeFileSync(outFile, out.outputText);

/* ---- 全局桩：document / location / Image / localStorage ---- */
const main = createCanvas(W, H);

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
};

globalThis.document = {
  /* Cocos 页面里没有 unlockTip / toHome 这两个元素 —— 如实返回 null */
  getElementById: () => null,
  createElement: (tag) => (tag === "canvas" ? createCanvas(1, 1) : { style: {} }),
  body: { appendChild() {}, removeChild() {} },
  addEventListener() {},
};

globalThis.location = { search: "", href: "http://localhost/", hash: "" };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
/* 运行时顶层就 `window.addEventListener("keydown", ...)`（原型里是页面），
   所以 window 必须指向 global 本身，不能是空对象 —— 后面还会读
   `window.innerWidth` 之类。 */
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.requestAnimationFrame = () => 0;
globalThis.Image = class { constructor() { this.width = 0; this.height = 0; } set src(_) {} };
globalThis.devicePixelRatio = 1;

const L = require(outFile);
const GROVE = L.GROVE;

console.log("=== ① 挂画布 + 出征页 ===");
L.groveAttachCanvas(main);
console.log("    ctx =", main.getContext("2d") ? "ok" : "null");

const t0 = Date.now();
L.groveBoot(0, undefined, true);
console.log("    groveBoot(0, undefined, true) 用时 " + (Date.now() - t0) + "ms");
console.log("    phase = " + GROVE.S.phase + " · progress = " + GROVE.S.progress +
            " · 门 = " + (GROVE.GATES || []).map((g) => g.id + (g.open ? "+" : "-")).join(","));

console.log("\n=== ② 跑 30 帧（第一帧后美术没到也应当能画代码图形）===");
const t1 = Date.now();
for (let i = 0; i < 30; i++) { L.groveTick(1 / 60); L.groveRender(); }
L.groveRender();
console.log("    30 帧用时 " + (Date.now() - t1) + "ms");

/* ---- 非底色像素统计：回答"画布上到底有没有东西" ---- */
const g = main.getContext("2d");
const img = g.getImageData(0, 0, W, H).data;
const seen = new Map();
for (let i = 0; i < img.length; i += 4) {
  const key = (img[i] >> 4) + "," + (img[i + 1] >> 4) + "," + (img[i + 2] >> 4);
  seen.set(key, (seen.get(key) || 0) + 1);
}
const total = W * H;
const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
const dominant = top[0] ? top[0][1] : 0;
console.log("\n=== ③ 画面内容 ===");
console.log("    颜色种类（4bit 量化）= " + seen.size);
console.log("    主色占比 = " + (100 * dominant / total).toFixed(1) + "%  " +
            top.map(([k, v]) => "(" + k + ")×" + (100 * v / total).toFixed(0) + "%").join(" "));

fs.mkdirSync(path.dirname(SHOT), { recursive: true });
fs.writeFileSync(SHOT, main.toBuffer("image/png"));
console.log("\n已出图：" + path.relative(ROOT, SHOT));

const blank = seen.size < 8 || dominant / total > 0.96;
console.log(blank ? "✗ 几乎是纯色 —— 这就是黑屏" : "✓ 画面有内容");
process.exit(blank ? 1 : 0);
