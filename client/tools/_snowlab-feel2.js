/* ===========================================================================
   手感探针 · 抖动
   ---------------------------------------------------------------------------
   用户 2026-10-28：「现在抖动很明显 怪物只能横向走的原因吧」

   **这个怀疑方向不对，但"有抖动"是真的。** 抖动不来自怪物的移动轴，
   来自三处，逐个量：

   ① **镜头跟着玩家 y 连续跟随**。世界纵向 12 层、屏幕 600、层高 240，
      镜头每帧往 `玩家中心 − 300` 缓动。玩家站着不动时它是稳的，
      可一旦上坡/下坡/起跳，整个画面就跟着上下挪 —— 一跳晃一次。
      这是"抖"的主因。
   ② **怪物巡逻方向用 Math.random**，跑两次数字都不一样，而且
      `runner` 在台边每帧被"折返"和"朝玩家"两条规则打架 → 原地来回。
   ③ 玩家自己的 y 在斜坡/落地边界上的帧间跳变。

   用法：node client/tools/_snowlab-feel2.js [种子数]
   =========================================================================== */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'prototype', 'snowlab.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x/' });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = () => null;
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB, S = L.S, DT = 1 / 60;
const seeds = +(process.argv[2] || 8);

function settle(n) { for (let i = 0; i < n; i++) L.step(DT); }
/* **量镜头和角色本体时必须把怪清掉**：被怪撞一下 vy = −320，人弹起来
   21px，全记在"抖动"头上。第一版没清，三行数字全是假的。 */
function calm() { S.foes.length = 0; S.hp = 999; }

/* ---- ① 站着不动：镜头应该完全不动 ---- */
let idleCam = 0, idleBody = 0;
for (let s = 0; s < seeds; s++) {
  L.reset(2000 + s * 31);
  calm();
  settle(40);
  const y0 = S.p.y, c0 = S.cam.y;
  let camMax = 0, bodyMax = 0;
  for (let i = 0; i < 90; i++) {
    L.step(DT);
    camMax = Math.max(camMax, Math.abs(S.cam.y - c0));
    bodyMax = Math.max(bodyMax, Math.abs(S.p.y - y0));
  }
  idleCam = Math.max(idleCam, camMax);
  idleBody = Math.max(idleBody, bodyMax);
}
console.log('① 站着不动 1.5s  镜头最大位移 ' + idleCam.toFixed(2) + 'px   角色最大位移 ' + idleBody.toFixed(2) + 'px');

/* ---- ② 走平路：镜头应该完全不动 ---- */
let walkCam = 0;
for (let s = 0; s < seeds; s++) {
  L.reset(2000 + s * 31);
  calm();
  /* **箱子要清掉。** 箱堆之间是有一格台阶的（那是设计），玩家走上去时
     镜头会跟着纵向缓动一下 —— 那是"有台阶"，不是"抖"。
     量"走平路会不会晃"必须走在真平地上，否则这一行数字永远是红的，
     红了以后就没人再信这个探针。台阶的手感由 floorN 那几张图看。 */
  S.boxes.forEach(b => b.dead = true);
  settle(40);
  const seg = S.plats.filter(pl => pl.kind !== 'ramp' && pl.w >= 300 && pl.y === L.FLOORS[0])
    .sort((a, b) => b.w - a.w)[0];
  if (!seg) continue;
  L.placePlayer(seg.x + 40, seg.y - S.p.h);
  settle(6);
  const c0 = S.cam.y;
  let camMax = 0;
  for (let i = 0; i < 70; i++) {
    /* 只在段内走：走出段尾就掉下去了，那不是抖，是摔。 */
    S.keys = (S.p.x + S.p.w < seg.x + seg.w - 60) ? { d: true } : {};
    L.step(DT);
    camMax = Math.max(camMax, Math.abs(S.cam.y - c0));
  }
  S.keys = {};
  walkCam = Math.max(walkCam, camMax);
}
console.log('② 走平路 1.2s    镜头最大位移 ' + walkCam.toFixed(2) + 'px  （横向本来就该不动，纵向也不该动）');

/* ---- ③ 跳一次：镜头跟着晃多少 ---- */
let jumpCam = 0, jumpSelf = 0;
for (let s = 0; s < seeds; s++) {
  L.reset(2000 + s * 31);
  calm();
  settle(40);
  const seg = S.plats.filter(pl => pl.kind !== 'ramp' && pl.w >= 300 && pl.y === L.FLOORS[0])[0];
  if (!seg) continue;
  L.placePlayer(seg.x + 40, seg.y - S.p.h);
  settle(6);
  const c0 = S.cam.y, y0 = S.p.y;
  let camMax = 0, bodyMax = 0;
  S.keys = { w: true };
  L.step(DT);
  S.keys = {};
  for (let i = 0; i < 70; i++) {
    L.step(DT);
    camMax = Math.max(camMax, Math.abs(S.cam.y - c0));
    bodyMax = Math.max(bodyMax, Math.abs(S.p.y - y0));
  }
  jumpCam = Math.max(jumpCam, camMax);
  jumpSelf = Math.max(jumpSelf, bodyMax);
}
console.log('③ 原地跳一次     镜头位移 ' + jumpCam.toFixed(2) + 'px   角色跳高 ' + jumpSelf.toFixed(2) + 'px  ← 镜头晃 = 全身都在晃');

/* ---- ④ 怪物：帧间位移的"抖动指数"（符号翻转次数 / 位移方差） ---- */
let worstFlip = 0, worstName = '', foeTrace = null;
for (let s = 0; s < seeds; s++) {
  L.reset(2000 + s * 31);
  settle(20);
  // 把人挪远，别让怪追人
  L.placePlayer(60, L.FLOORS[0] - S.p.h);
  for (const f of S.foes) {
    let prev = f.vx, flips = 0;
    const xs = [];
    for (let i = 0; i < 120; i++) {
      L.step(DT);
      xs.push(f.x);
      /* **待机时的 vx=0 不算换向。** 宠物现在会停下来待一会儿再走，
         0 → 正/负 被记成"换向"的话，一停一起就是两次，
         这个数字就变成"宠物有多勤快"，而不是"它有没有原地抽"。
         只数真正的方向反转：两边都非零、符号相反。 */
      if (f.vx !== 0 && prev !== 0 && Math.sign(f.vx) !== Math.sign(prev)) flips++;
      prev = f.vx;
    }
    if (flips > worstFlip) { worstFlip = flips; worstName = f.kind; foeTrace = xs.slice(0, 40).map(v => v.toFixed(1)); }
  }
}
console.log('④ 怪物巡逻 2s    最多换向 ' + worstFlip + ' 次（' + worstName + '）');
if (foeTrace) console.log('   前 40 帧 x：' + foeTrace.join(' '));

/* ---- ⑤ 可复现性：同一个种子跑两次，怪物轨迹必须一模一样 ---- */
function trace() {
  L.reset(2077);
  settle(10);
  L.placePlayer(60, L.FLOORS[0] - S.p.h);
  const out = [];
  for (let i = 0; i < 60; i++) { L.step(DT); out.push(S.foes.map(f => f.x.toFixed(2)).join(',')); }
  return out.join('|');
}
const t1 = trace(), t2 = trace();
console.log('⑤ 同种子跑两次轨迹' + (t1 === t2 ? '一致' : ' **不一致 → 用了 Math.random，出图和断言不可复现**'));
