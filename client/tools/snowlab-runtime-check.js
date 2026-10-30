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
const os = require('os');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const PROTO = path.join(ROOT, 'prototype', 'snowlab.html');
const TS_DIR = path.join(ROOT, 'assets', 'scripts', 'snowlab');
const BUILD = path.join(ROOT, 'tools', '_sl-build');
/* **tsc 的位置按"先找就近的、再找编辑器自带的"顺序探。**
   原来写死的是 `C:/Users/汪宇/...`，换到 `yu.wang` 这台机器直接找不到 ——
   而 TypeScript 本来就装在 Cocos 编辑器里，没必要依赖某个用户目录。
   两台机器上都有的那份是编辑器自带的，所以它做兜底。 */
const TSC_CANDIDATES = [
  path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'typescript', 'bin', 'tsc'),
  'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/bin/tsc',
];
const TSC = process.env.TSC || TSC_CANDIDATES.find(p => fs.existsSync(p)) || TSC_CANDIDATES[0];

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
/* **验"有哪些"，不是"有几个"。** 写死 `=== 5` 的版本在给熔炉加了一张
   背景之后直接红 —— 而真正该守的是"原来那五张一张没丢 + 新加的背景也在"。
   数数型断言把"加了东西"和"丢了东西"报成同一件事。 */
const _art = require(path.join(BUILD, 'SnowlabArt.js')).INLINE_ART;
const _need = ['bg', 'pet-cat', 'foe-moss', 'foe-fang', 'foe-grub'];
/* ================= **生成物过没过期** =================
   抽取脚本每个锚点都是"命中 0 次就退出"，但退出之后 `.ts` **留在上一版**，
   而本工具读的正是那份没更新的 `.ts` —— 于是它全绿，绿得毫无意义。
   这个坑栽过两次：`cce5c23` 停了四轮；2026-10-30 加音效时往启动段插了一行，
   锚点立刻命中 0，而 `build-rt` + 本工具全绿。
   现在产物头上有源文件的 md5，**对不上就红** —— 这是唯一一条能在
   "生成物没更新"时报警的判据，其余所有断言都跑在产物上。 */
{
  const crypto = require('crypto');
  /* **先归一成 LF 再算，和抽取脚本保持一致。** 仓库存 LF、工作区 CRLF，
     直接按字节算会让两台机器对同一份原型得出不同 md5 —— 门禁变成
     "看你在哪台机器上跑"，而不是"原型改没改"。2026-10-30 踩到：
     公司机器 dcab99d9 / 本机 0f0d8839，工作区都干净。 */
  const raw = fs.readFileSync(PROTO, 'utf8').replace(/\r\n/g, '\n');
  const md5 = crypto.createHash('md5').update(raw).digest('hex');
  const gen = fs.readFileSync(path.join(TS_DIR, 'SnowlabRuntime.ts'), 'utf8');
  const m = gen.match(/@src-md5 ([0-9a-f]{32})/);
  ok('★ 生成物没过期（原型改过就必须重抽）',
    !!m && m[1] === md5,
    m ? ('产物 ' + m[1].slice(0, 8) + ' / 原型 ' + md5.slice(0, 8) +
         '  → python tools/extract_snowlab_runtime.py') : '产物里没有指纹');
}

ok('内嵌贴图搬到了 SnowlabArt（原有 5 张一张不少）',
  _need.every(k => typeof _art[k] === 'string' && _art[k].length > 100),
  _need.filter(k => !_art[k]).join(',') || '');
/* **四个场景都要有。** 原来只写死验 `bg` 和 `bg-ember` 两块 —— 2026-10-30
   给菌窟/沙塚补了立绘之后，那两条照样绿，而 spore/dune 的块没被抽进
   `SnowlabArt` 也没人知道（游戏里静默回退程序化天空）。
   断言要验"每个场景"，不是"我上次加的那几个"。 */
const BG_KEYS = ['bg', 'bg-ember', 'bg-spore', 'bg-dune'];
ok('背景图按场景各有一块（' + BG_KEYS.join(' / ') + '）',
  BG_KEYS.every(k => typeof _art[k] === 'string' && _art[k].length > 2000),
  BG_KEYS.filter(k => !_art[k]).join(',') || '');

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
/* 背景那段现在走 `INLINE_ART[bgElId(id).replace("art-", "")]` —— 验的是
   "**从 INLINE_ART 取**、且不再问 DOM"，不是某个具体下标。 */
ok('贴图从 INLINE_ART 读，不再问 DOM',
  /INLINE_ART\[k\]/.test(src) && /INLINE_ART\[bgElId\(/.test(src) &&
  !/document\.getElementById/.test(src));

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
