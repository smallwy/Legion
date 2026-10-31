/* 解空间审计：一关里同时存在"必须大球"和"必须小球"的地方吗？
   如果一关只有单一需求，那"球的大小"就不是取舍，只是流程。
   用法：node tools/_conflict-probe.js [起点 终点] */
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

const A = +(process.argv[2] || 1), B = +(process.argv[3] || 48);
const rows = [];
for (let n = A; n <= B; n++) {
  const g = L.genLevel(L.stageSeed(n), n);
  const holes = g.layers.reduce((a, l) => a.concat(l.holes || []), []);
  const narrow = holes.filter(h => h.narrow).length;
  /* **窄口上盖冰墙 = 死点**：大球过不了窄口，小球破不了冰墙（minPow 1550）。 */
  const dead = holes.filter(h => h.narrow && h.cover === 'ice').length;
  const iceCover = holes.filter(h => h.cover === 'ice').length;
  const frostCover = holes.filter(h => h.cover === 'frost' || h.cover === 'wood').length;
  const open = holes.filter(h => !h.cover).length;
  const ice = g.boxes.filter(b => b.mat === 'ice').length;
  const iron = g.boxes.filter(b => b.mat === 'iron').length;
  const husk = g.boxes.filter(b => b.mat === 'husk').length;
  const stone = g.boxes.filter(b => b.mat === 'stone').length;
  // "必须大球"的地方：破冰墙（1550）需要裹 2 只，铁箱 1150 裸球刚好够
  const needBig = iceCover + ice + iron + husk;
  // "必须小球"的地方：窄洞
  const needSmall = narrow;
  rows.push({
    n, les: L.lessonOf(n) || '-', nF: g.nFloors, goal: L.goalOf(n), dead,
    holes: holes.length, narrow, iceCover, frostCover, open,
    ice, iron, husk, stone, needBig, needSmall,
    foes: g.spawns.length, nests: (g.nests || []).length,
    conflict: needBig > 0 && needSmall > 0,
  });
}
const pad = (v, w) => String(v).padStart(w);
console.log(' n  考点    层 目标     口  窄 冰盖 霜盖 敞 冰 铁 壳 石 怪 巢 冲突');
for (const r of rows) {
  console.log([
    pad(r.n, 2), r.les.padEnd(7), pad(r.nF, 2), r.goal.padEnd(8),
    pad(r.holes, 2), pad(r.narrow, 2), pad(r.iceCover, 3), pad(r.frostCover, 3), pad(r.open, 2),
    pad(r.ice, 2), pad(r.iron, 2), pad(r.husk, 2), pad(r.stone, 3),
    pad(r.foes, 2), pad(r.nests, 2), r.conflict ? ' ★' : '', r.dead ? ' 死点×' + r.dead : '',
  ].join(' '));
}
const c = rows.filter(r => r.conflict);
console.log('\n同时有「要小球」和「要大球」的关：' + c.length + ' / ' + rows.length);
console.log(c.map(r => r.n).join(',') || '(无)');
console.log('冰墙盖洞的关：' + rows.filter(r => r.iceCover > 0).length + ' → ' +
  rows.filter(r => r.iceCover > 0).map(r => r.n).join(','));
console.log('有铁箱的关：' + rows.filter(r => r.iron > 0).length + ' → ' +
  rows.filter(r => r.iron > 0).map(r => r.n).join(','));
