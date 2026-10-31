/* 行为验证：封关（seal）那堵冰墙，中球砸不开、大球砸得开吗？
   —— 结构断言只能证明"冰墙在那儿"，证明不了"它真的挡人"。
   这条走真物理（ballHitBox），是这一整组里唯一不能靠读字段通过的判据。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const FILE = process.env.PROTO || path.join(ROOT, 'prototype', 'snowlab.html');
const html = fs.readFileSync(FILE, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x/' });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = () => null;
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;

const FULL = 1209;                       // 助跑推球的满速
let pass = 0, fail = 0;
const ck = (name, ok, msg) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + (msg || '')); }
};

/* 打一堵冰墙：返回撞完墙还在不在 */
function hitIce(stage, absorbed) {
  L.startStage(stage);
  const S = L.S;
  const ice = S.boxes.find(b => b.mat === 'ice');
  if (!ice) return { noIce: true };
  const r = L.ballR(absorbed);
  const b = {
    x: ice.x - r - 2, y: ice.y + ice.h - r, r, vx: FULL, vy: 0,
    absorbed, weak: false, chain: 0, onGround: true, dead: false,
    fuseT: 0, pushT: 0, life: L.NUM.ball.life,
  };
  L.ballHitBox(b, ice, 1);
  /* **破没破看 `ice.dead`，不是 `broken`。** breakBox 只在对象上打 `dead`
     标记，数组本身不动（下一帧统一清理）—— 第一版按 `boxes.includes`
     判，结果"大球也砸不开"，而 vx 已经乘过 keepSpeed 了。 */
  return { left: !ice.dead, pow: FULL * (r / L.NUM.ball.baseR), vx: b.vx };
}

const stages = [];
for (let n = 1; n <= 48; n++) if (L.lessonOf(n) === 'seal') stages.push(n);
console.log('封关关：' + stages.join(', '));

for (const n of stages) {
  const mid = hitIce(n, 2);
  const big = hitIce(n, 4);
  if (mid.noIce) { ck('第 ' + n + ' 关有冰墙', false, '一颗都没有'); continue; }
  ck('第 ' + n + ' 关中球撞不开（pow ' + mid.pow.toFixed(0) + '）', mid.left === true,
     mid.left === undefined ? '无冰墙' : (mid.left ? '' : '墙被打穿了'));
  ck('第 ' + n + ' 关大球撞得开（pow ' + big.pow.toFixed(0) + '）', big.left === false,
     big.left ? '墙还在' : '');
}

/* 反向：**"封死"不能是常态。**
   冰墙本来就是洞口盖板（27 关有），但"门厅入口**整层**封死"是另一回事 ——
   那是封关考点的招牌。普通关里必须大多数还留着敞口，否则
   "这一关是封关"和"这一关是普通关"在玩家眼里没有区别。 */
let openish = 0, total = 0;
for (let n = 1; n <= 48; n++) {
  if (L.lessonOf(n) === 'seal') continue;
  total++;
  const g = L.genLevel(L.stageSeed(n), n);
  const k = g.nFloors - 2;
  const hs = (g.layers[k] || { holes: [] }).holes;
  if (!hs.length || hs.some(h => h.cover !== 'ice')) openish++;
}
ck('普通关的门厅入口一个都不许整层封死（封死是封关考点的招牌）',
   openish === total, openish + "/" + total + " 关有敞口");

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
