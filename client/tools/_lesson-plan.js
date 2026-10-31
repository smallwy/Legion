/* 排一个 48 关的考点表：6 个考点 + 骨架周期 6 + 目标周期 4 会撞周期，
   模运算排班在数学上必然退化成 12 种组合（见文件头注释）。所以改成手写表，
   用贪心 + 约束搜索生成，再钉进原型。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'prototype', 'snowlab.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://x/' });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = () => null;
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB;

const POOL = ['bare', 'narrow', 'swarm', 'maze', 'perch', 'seal'];
const FIRST = 2;
const info = [];
for (let n = 1; n <= 48; n++) {
  const g = L.genLevel(L.stageSeed(n), n);
  info.push({ n, nF: g.nFloors, skel: g.skel, goal: L.goalOf(n) });
}
const okFor = (n, c) => {
  const r = info[n - 1];
  if (c === 'perch') return r.goal === 'collect';
  if (c === 'seal') return r.nF >= 3;
  return true;
};

/* 贪心 + 回溯 */
let best = null;
function solve() {
  const T = new Array(49).fill(null);
  const cnt = Object.fromEntries(POOL.map(k => [k, 0]));
  const trip = new Set();
  const used = new Map(); // (skel|goal) -> Set(考点)

  function dfs(n) {
    if (n > 48) return true;
    const r = info[n - 1];
    if (n < FIRST) { T[n] = null; return dfs(n + 1); }
    const key = r.skel + '|' + r.goal;
    if (!used.has(key)) used.set(key, new Set());
    const seen = used.get(key);
    /* 候选排序：没在这一 (骨架,目标) 对出现过的优先 → 本关计数少的优先 */
    const cands = POOL
      .filter(c => okFor(n, c))
      .filter(c => c !== T[n - 1])
      .sort((a, b) => (seen.has(a) - seen.has(b)) || (cnt[a] - cnt[b]));
    for (const c of cands) {
      const t3 = r.skel + '|' + c + '|' + r.goal;
      if (trip.has(t3)) continue;
      T[n] = c; cnt[c]++; trip.add(t3); const had = seen.has(c); seen.add(c);
      if (dfs(n + 1)) return true;
      T[n] = null; cnt[c]--; trip.delete(t3); if (!had) seen.delete(c);
      if (cands.length > 40) break;   // 保险
    }
    return false;
  }
  return dfs(1) ? T : null;
}
const T = solve();
if (!T) { console.log('无解'); process.exit(1); }

const rows = [];
for (let n = 1; n <= 48; n++) rows.push({ ...info[n - 1], les: T[n] });
const pad = (v, w) => String(v).padStart(w);
console.log('n  层 骨架    目标     考点');
for (const r of rows) console.log(pad(r.n, 2), pad(r.nF, 2), r.skel.padEnd(7), r.goal.padEnd(8), r.les || '-');
const cnts = {};
for (const r of rows) if (r.les) cnts[r.les] = (cnts[r.les] || 0) + 1;
console.log('\n各考点关数：', JSON.stringify(cnts));
console.log('三元组唯一：', new Set(rows.map(r => r.skel + '|' + (r.les || '-') + '|' + r.goal)).size, '/ 48');
let adj = 0;
for (let i = 1; i < 48; i++) if (rows[i].les && rows[i].les === rows[i - 1].les) adj++;
console.log('相邻重复：', adj);
const perchBad = rows.filter(r => r.les === 'perch' && r.goal !== 'collect');
const sealBad = rows.filter(r => r.les === 'seal' && r.nF < 3);
console.log('perch 违规：', perchBad.length, ' seal 违规：', sealBad.length);
console.log('\n表：\nconst LESSON_TABLE = [');
for (let n = 1; n <= 48; n += 8)
  console.log('  ' + rows.slice(n - 1, n + 7).map(r => r.les ? "'" + r.les + "'" : 'null').join(', ') + ',');
console.log('];');
