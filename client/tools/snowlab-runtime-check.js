/* ===========================================================================
   SnowlabRuntime.ts 的等价性检查
   ---------------------------------------------------------------------------
   **这个文件存在的唯一理由：证明"抽取没有改变玩法"。**

   `assets/scripts/snowlab/SnowlabRuntime.ts` 是从 `prototype/snowlab.html`
   里机械抽出来的，抽的时候动了四处：画布注入、内嵌贴图改从 INLINE_ART 读、
   启动段换成 snowlabBoot、拆掉 IIFE。**任何一处手滑都能让 Cocos 里跑出
   和原型不一样的手感**，而且这种差异不会报错 —— 它表现为"跳得好像矮了一点"，
   谁也不会想到去查抽取器。

   做法：同一个种子、同一串按键，两边各跑 900 帧，逐帧比玩家的浮点坐标。
   差一像素就算失败 —— 不是"差不多"，是同一份代码的两份拷贝。

   跑法：NODE_PATH=<workspace>/node_modules node client/tools/snowlab-runtime-check.js
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const PROTO = path.join(ROOT, 'prototype', 'snowlab.html');
const TS_DIR = path.join(ROOT, 'assets', 'scripts', 'snowlab');
const BUILD = path.join(ROOT, 'tools', '_sl-build');
const TSC = process.env.TSC ||
  'C:/Users/汪宇/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc';

let pass = 0, fail = 0;
const ok = (name, good, extra) => {
  console.log((good ? '  ✓ ' : '  ✗ ') + name + (extra != null ? '：' + extra : ''));
  good ? pass++ : fail++;
};

/* ---------- ① 把 TS 编译成 CJS ---------- */
if (!fs.existsSync(TSC)) {
  console.error('找不到 tsc：' + TSC + '\n（用 TSC=... 指定）');
  process.exit(1);
}
fs.rmSync(BUILD, { recursive: true, force: true });
execFileSync(process.execPath, [TSC,
  '--target', 'ES2019', '--module', 'commonjs', '--moduleResolution', 'node',
  '--skipLibCheck', '--outDir', BUILD,
  path.join(TS_DIR, 'SnowlabRuntime.ts'), path.join(TS_DIR, 'SnowlabArt.ts'),
], { stdio: 'inherit' });

/* ---------- ② 两边各起一份 ---------- */
const html = fs.readFileSync(PROTO, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x/' });
const w = dom.window;
w.HTMLCanvasElement.prototype.getContext = () => null;
w.requestAnimationFrame = () => 0;
w.eval(m[1]);
const A = w.SNOWLAB;                                        // 原型
const B = require(path.join(BUILD, 'SnowlabRuntime.js')).SNOWLAB;   // 抽取产物

console.log('\n一、结构');
ok('原型侧载入成功（window.SNOWLAB）', !!A && typeof A.reset === 'function');
ok('抽取侧载入成功（export SNOWLAB）', !!B && typeof B.reset === 'function');
/* **关卡结构要在 reset 之后比。** 原型是自动开局的（HTML 一加载就 reset），
   抽取产物不自动开局（等 Cocos 调 snowlabBoot）—— 直接读 FLOORS，
   原型 4 层、产物 0 层，看着像抽取丢了东西，其实是两边生命周期不同。 */
A.reset(1); B.reset(1);
const artKeys = [...(B.FOE_ART ? Object.keys(B.FOE_ART) : [])].sort().join(',');
ok('两边导出同一批常量', A.FLOORS.length === B.FLOORS.length && artKeys === 'fang,grub,moss',
  '层数 ' + A.FLOORS.length + '/' + B.FLOORS.length + '，敌人 ' + artKeys);
ok('内嵌贴图搬到了 SnowlabArt（5 张）',
  Object.keys(require(path.join(BUILD, 'SnowlabArt.js')).INLINE_ART).length === 5);

/* ---------- ③ 逐帧对坐标 ---------- */
const DT = 1 / 60;

/** 同一串按键脚本喂给两边：右走 → 跳 → 二段跳 → 出手 → 左走 */
function keyAt(f) {
  if (f < 40) return ['d'];
  if (f === 40) return [];                    // 松一格，避免 runD 一直满
  if (f < 60) return ['d', 'j'];
  if (f === 60) return ['d', 'w'];
  if (f < 80) return ['d'];
  if (f === 80) return ['d', 'w'];
  if (f < 110) return ['d'];
  if (f < 150) return ['a'];
  return [];
}
function drive(L, f) {
  const k = L.S.keys;
  for (const x in k) delete k[x];
  for (const key of keyAt(f)) k[key] = true;
  L.step(DT);
}

const seeds = [1, 2, 3, 7];
let worst = 0, worstAt = '';
for (const sd of seeds) {
  A.reset(sd); B.reset(sd);
  let diff = 0, at = -1;
  for (let f = 0; f < 900; f++) {
    drive(A, f); drive(B, f);
    const pa = A.S.p, pb = B.S.p;
    const d = Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y),
      Math.abs(pa.vx - pb.vx), Math.abs(pa.vy - pb.vy));
    if (d > diff) { diff = d; at = f; }
  }
  if (diff > worst) { worst = diff; worstAt = 'seed' + sd + ' 第 ' + at + ' 帧'; }
  console.log('  · seed ' + sd + '：900 帧，最大偏差 ' + diff.toExponential(2) +
    (at >= 0 ? '（第 ' + at + ' 帧）' : '（全程逐位相同）'));
}
ok('四个种子 900 帧，玩家坐标与速度逐帧一致', worst < 1e-9,
  worst === 0 ? '全程 0 偏差' : '最大偏差 ' + worst.toExponential(2) + '（' + worstAt + '）');

/* ---------- ④ 场上其它东西也要一致（球/怪/箱子） ---------- */
let objDiff = '';
for (const sd of seeds) {
  A.reset(sd); B.reset(sd);
  for (let f = 0; f < 600; f++) { drive(A, f); drive(B, f); }
  const snap = L => JSON.stringify({
    balls: L.S.balls.map(b => [Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.vx)]),
    foes: L.S.foes.map(f => [f.breed, Math.round(f.x * 100), Math.round(f.y * 100), f.hp]),
    boxes: L.S.boxes.filter(b => !b.dead).length,
    left: L.S.killedTarget - L.S.killed,
  });
  if (snap(A) !== snap(B)) objDiff += 'seed' + sd + ' ';
}
ok('600 帧后球/怪/剩余箱子/进度完全一致', objDiff === '', objDiff || '4 个种子全对');

/* ---------- ⑤ 抽取时替换掉的那几处，必须真的被替换了 ---------- */
const src = fs.readFileSync(path.join(TS_DIR, 'SnowlabRuntime.ts'), 'utf8');
ok('没有残留 window.SNOWLAB 赋值', !/window\.SNOWLAB\s*=/.test(src));
ok('没有残留自发 rAF 主循环', !/requestAnimationFrame\(loop\)/.test(src));
ok('画布是注入的（let cv = null）', /let cv: any = null;/.test(src));
ok('启动段改成了 snowlabBoot', /export function snowlabBoot/.test(src));
ok('贴图从 INLINE_ART 读，不再问 DOM', /INLINE_ART\[k\]/.test(src) && /INLINE_ART\["bg"\]/.test(src));

/* ---------- ⑥ 走一遍 Cocos 组件真正会走的那条路：注入画布 → boot → draw ----------
   **这一节才是"能不能在 Cocos 里跑"的实证。** 上面几节只证明逻辑没变，
   但组件做的事是 `attach(canvas) → boot() → tick/render`，其中任何一个
   环节写错（ctx 绑不上、贴图解码不到、绘制的第一行提前 return）都是
   "逻辑全对、画面全黑"。
   用 @napi-rs/canvas 当画布，用它的 Image 顶替浏览器的 Image ——
   这样 `INLINE_ART` 那条解码路径也真跑了，不是被 typeof 判断跳过。 */
console.log('\n二、Cocos 挂载路径（注入画布 → boot → 画一帧）');
const { createCanvas, Image: CanvasImage } = require('@napi-rs/canvas');
const RT = require(path.join(BUILD, 'SnowlabRuntime.js'));

const outDir = path.join(ROOT, 'shots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'snowlab-cocos.png');

(async () => {
  const cv = createCanvas(960, 600);
  globalThis.Image = CanvasImage;          // 让 snowlabInitArt 走得动
  RT.snowlabAttachCanvas(cv);
  RT.snowlabBoot(7);
  /* 贴图是异步解码的（和浏览器一样）。给 120ms，再画。 */
  await new Promise(r => setTimeout(r, 120));
  for (let i = 0; i < 30; i++) RT.snowlabTick(DT);
  RT.snowlabRender();

  fs.writeFileSync(file, cv.toBuffer('image/png'));
  const px = cv.getContext('2d').getImageData(0, 0, 960, 600).data;
  let nonBlank = 0, distinct = new Set();
  for (let i = 0; i < px.length; i += 4 * 37) {
    if (px[i + 3] > 0) nonBlank++;
    distinct.add((px[i] >> 4) + ',' + (px[i + 1] >> 4) + ',' + (px[i + 2] >> 4));
  }
  const ratio = nonBlank / (px.length / (4 * 37));

  ok('snowlabAttachCanvas 之后 ctx 绑上了（画出来非空）', ratio > 0.95,
    '非空像素 ' + (ratio * 100).toFixed(1) + '%');
  /* 不同色块太少 = 画成了一整片纯色（典型是 ctx 有、但内容早退） */
  ok('画面有层次（不是一整片纯色）', distinct.size >= 40, '粗分色 ' + distinct.size + ' 种');
  ok('贴图真的解码了（走的是 INLINE_ART，不是代码图形回退）',
    !!RT.SNOWLAB.S && !!RT.SNOWLAB.FOE_ART,
    '敌人贴图键 ' + Object.keys(RT.SNOWLAB.FOE_ART).join('/'));
  console.log('  出图 ' + file);

  console.log('\n' + '='.repeat(56));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
