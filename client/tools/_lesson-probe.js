const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const FILE = process.env.PROTO || path.join(ROOT, 'prototype', 'snowlab.html');
const html = fs.readFileSync(FILE, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x/' });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;

const rows = [];
for (let n = 1; n <= 48; n++) {
  const g = L.genLevel(L.stageSeed(n), n);
  const les = L.lessonOf(n);
  const holes = g.layers.reduce((a, l) => a + l.holes.length, 0);
  // 空列占比：每层 20 列里完全没有箱子的列有多少（tower 应该显著更高）
  let empty = 0, cols = 0, maxPile = 0;
  for (const ly of g.layers) {
    const cnt = new Array(20).fill(0);
    for (const b of g.boxes) {
      if (b.y < ly.floorY - 1 && b.y + b.h > ly.floorY - 200) {
        const i = Math.max(0, Math.min(19, Math.floor((b.x + 24) / 48)));
        cnt[i]++;
      }
    }
    empty += cnt.filter(c => c === 0).length;
    cols += 20;
    maxPile = Math.max(maxPile, Math.max(...cnt));
  }
  const peak = +(empty / Math.max(1, cols)).toFixed(2);
  rows.push({
    n, les, nF: g.nFloors, skel: g.skel, goal: L.goalOf(n),
    boxes: g.boxes.length, bpf: +(g.boxes.length / g.nFloors).toFixed(2),
    foes: g.spawns.length, hpf: +(holes / Math.max(1, g.nFloors - 1)).toFixed(2),
    run: g.spawns.filter(s => s.kind === 'runner').length, peak, perch: !!g.perch, hi: g.boxes.filter(b=>b.loot).length,
  });
}
console.log('n  les      nF skel    goal     box  bpf foes hol/f run 金箱');
for (const r of rows) console.log([String(r.n).padStart(2), (r.les||'-').padEnd(8), r.nF, r.skel.padEnd(7), r.goal.padEnd(7), String(r.boxes).padStart(3), String(r.bpf).padStart(4), String(r.foes).padStart(4), String(r.hpf).padStart(5), String(r.run).padStart(3), String(r.peak).padStart(4), String(r.hi).padStart(4), r.perch?' Y':''].join(' '));
const avg = (a, f) => a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : 0;
console.log('\nles      n   bpf  foes hol/f  run peak    hi');
const show = (label, a) => console.log(label.padEnd(9), String(a.length).padStart(2), avg(a,r=>r.bpf).toFixed(2).padStart(5), avg(a,r=>r.foes).toFixed(2).padStart(5), avg(a,r=>r.hpf).toFixed(2).padStart(5), avg(a,r=>r.run).toFixed(2).padStart(5), avg(a,r=>r.peak).toFixed(2).padStart(5), avg(a,r=>r.hi).toFixed(2).padStart(5));
for (const k of ['tower','narrow','swarm','maze','perch']) show(k, rows.filter(r => r.les === k));
show('(教学)', rows.filter(r => !r.les));
show('全部', rows);
console.log('\n三元组唯一：', new Set(rows.map(r => r.skel+'|'+(r.les||'-')+'|'+r.goal)).size, '/ 48');
