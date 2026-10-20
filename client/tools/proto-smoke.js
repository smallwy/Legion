/**
 * 可玩原型的离线冒烟测试（沙箱里没有可用浏览器，这是唯一能真跑的路）。
 *
 * 做法：从 index.html 抽出 <script>，在 node 里用记录型 Canvas/DOM 桩跑**真实代码**。
 *
 * 测试分两类，刻意分开，否则会互相污染：
 *  A. 系统隔离测试（无敌模式）—— 验证喂食/升级/档位这些逻辑本身对不对
 *  B. 完整流程测试（无敌 + 自动选卡）—— 验证 20 波能推进、BOSS 能生成并被杀、能结算
 *  C. 难度观察（自动走位、不无敌）—— 只输出数据，不设断言（是否过难要人来判断）
 *
 * 上一版的教训：把 A 和 B 混在一起，玩家站着不动 30 秒就死，phase 变成 settlement，
 * 后面所有系统被 step() 短路，于是"喂食没生效""升级没弹"全是假警报。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const HTML = path.join(__dirname, '..', 'prototype', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');

const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) throw new Error('找不到 <script> 块');
const code = m[1];

// ---------- 记录型 Canvas 2D 桩 ----------
const stat = { drawImage: 0, badDraw: 0, frames: 0, pts: [] };

function makeCtx() {
  const noop = () => {};
  return {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: true,
    setTransform: noop, resetTransform: noop, save: noop, restore: noop,
    translate: noop, scale: noop, rotate: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop,
    // 记录路径点：光束是手算四边形，NaN 或零面积时浏览器**静默不画**、不报错
    moveTo: (x, y) => stat.pts.push([x, y]),
    lineTo: (x, y) => stat.pts.push([x, y]),
    arc: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
    fillText: noop, strokeText: noop,
    measureText: (s) => ({ width: String(s).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    drawImage: (img) => {
      stat.drawImage++;
      if (!img) stat.badDraw++;
    },
  };
}

function makeCanvas() {
  return {
    width: 960, height: 540, style: {},
    getContext: () => makeCtx(),
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
  };
}

// ---------- DOM / window 桩 ----------
const mainCanvas = makeCanvas();
let NOW = 0;

const win = {
  innerWidth: 1280, innerHeight: 800,
  addEventListener: () => {},
  requestAnimationFrame: () => 1,
  performance: { now: () => NOW },
  // ⚠️ 这个 Image 桩是在 node 全局作用域里定义的，它的闭包作用域**不是** vm 沙箱。
  //    所以绝对不能在里面调 setTimeout —— 那会解析到 node 的真实异步 setTimeout，
  //    沙箱里注册的桩不会生效，onload 永远不触发（上一版就栽在这）。
  //    直接同步调用 onload。
  Image: function () {
    let _onload = null;
    const self = {
      width: 32, height: 32, _src: '',
      get src() { return this._src; },
      set src(v) { this._src = v; if (_onload) _onload(); },
    };
    Object.defineProperty(self, 'onload', {
      get: () => _onload,
      set: (fn) => { _onload = fn; },
    });
    Object.defineProperty(self, 'onerror', {
      get: () => null,
      set: () => {},
    });
    return self;
  },
  document: {
    getElementById: () => mainCanvas,
    createElement: () => makeCanvas(),
    addEventListener: () => {},
  },
  console,
  setTimeout: (fn) => { fn(); return 0; },
};
win.window = win;

vm.createContext(win);
vm.runInContext(code, win, { filename: 'prototype/index.html' });

const P = win.PAWPACK;
assert(P, 'window.PAWPACK 未导出');

// ---------- 工具 ----------
let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}

function finite(v) { return typeof v === 'number' && isFinite(v); }

/**
 * 推进 n 帧。走 _frame 而不是 _step —— 因为 _step 只跑逻辑，
 * render 不执行，drawImage 统计就会是 0（上一版就是这么误报的）。
 */
function tick(n, onFrame) {
  for (let i = 0; i < n; i++) {
    NOW += 1000 / 60;
    if (onFrame) onFrame(i);
    P._frame(NOW);
    stat.frames++;
  }
}

/** 无敌：每帧刷满无敌帧，用于隔离测试系统逻辑 */
function godMode() { P.player.invT = 99; }

function heal() { P.player.hp = 6; }

// ============================================================
console.log('\n=== 1. 初始状态 ===');
ok('精灵资源已就绪', () => assert.strictEqual(P._isReady(), true));
ok('3 名英雄已就位', () => assert.strictEqual(P.squad.heroes.length, 3));
ok('玩家满血 6 点', () => assert.strictEqual(P.player.hp, 6));
ok('饱食度满值 100', () => assert.strictEqual(Math.round(P.squad.satiety), 100));
ok('满饱档 = ×1.0', () => assert.strictEqual(P.squad.heroes[0].powerMul, 1.0));
ok('第一波未开始', () => assert.strictEqual(P.wave.idx, 0));
ok('伤害倍率初始 1.0', () => assert.strictEqual(P.upg.stats.damageMul, 1));

// ============================================================
console.log('\n=== 2. 开局 10 秒：波次 / 索敌 / 坐标 ===');
tick(600, godMode);
ok('第一波已生成', () => assert(P.wave.idx >= 1, 'wave.idx=' + P.wave.idx));
ok('场上有敌人', () => assert(P.enemies.length > 0, '敌人 ' + P.enemies.length));
ok('敌人坐标有限', () => {
  for (const e of P.enemies) assert(finite(e.x) && finite(e.y), 'NaN 坐标');
});
ok('敌人不越界', () => {
  for (const e of P.enemies) {
    assert(Math.abs(e.x) <= 1201, 'x=' + e.x);
    assert(Math.abs(e.y) <= 676, 'y=' + e.y);
  }
});
ok('英雄在自动开火', () => {
  assert(P.projectiles.length > 0 || P.G.stats.kills > 0, '既无弹道也无击杀');
});
ok('饱食度开始衰减', () => assert(P.squad.satiety < 100, '仍是 ' + P.squad.satiety));
ok('敌人会靠近玩家（不是原地飘）', () => {
  let near = 0;
  for (const e of P.enemies) if (Math.hypot(e.x - P.player.x, e.y - P.player.y) < 500) near++;
  assert(near > 0, '所有敌人都在 500px 外，hunter 标记可能没生效');
});

// ============================================================
console.log('\n=== 3. 喂食与半饿档位（无敌隔离） ===');
P.resetGame();
godMode();
P.squad.satiety = 40;      // 手工落到半饿区
tick(2, godMode);
ok('40 点 = 半饿档（×1.5，最强）', () => {
  assert.strictEqual(P.squad.heroes[0].powerMul, 1.5, 'powerMul=' + P.squad.heroes[0].powerMul);
});
ok('喂食回复饱食度并扣肉块', () => {
  P.squad.satiety = 40; P.squad.feedCd = 0; P.G.stats.meat = 5;
  const before = P.squad.satiety, meat0 = P.G.stats.meat;
  P._tryFeed();
  assert(P.squad.satiety > before, '饱食度没涨：' + before + ' → ' + P.squad.satiety);
  assert.strictEqual(P.G.stats.meat, meat0 - 1, '肉块没扣');
  assert.strictEqual(P.squad.feeds, 1, '喂食计数没涨');
});
ok('喂食有 0.8s 冷却（连按不烧肉块）', () => {
  P.squad.satiety = 40; P.squad.feedCd = 0; P.G.stats.meat = 5;
  P._tryFeed();
  const meat = P.G.stats.meat;
  P._tryFeed();
  assert.strictEqual(P.G.stats.meat, meat, '冷却期间仍扣了肉块');
});
ok('满饱拒绝喂食', () => {
  P.squad.satiety = 100; P.squad.feedCd = 0;
  const meat = P.G.stats.meat;
  P._tryFeed();
  assert.strictEqual(P.G.stats.meat, meat, '满饱仍消耗肉块');
});
ok('喂食会让主角短暂减速（硬直）', () => {
  P.squad.satiety = 40; P.squad.feedCd = 0; P.G.stats.meat = 5;
  P._tryFeed();
  assert(P.squad.stunT > 0, 'stunT 没设');
  tick(2, godMode);
  assert(P.player.speedMul < 1, 'speedMul 没降：' + P.player.speedMul);
});
ok('掉到 30 以下 = 全饿（×0.6）', () => {
  P.squad.satiety = 20;
  tick(2, godMode);
  assert.strictEqual(P.squad.heroes[0].powerMul, 0.6, 'powerMul=' + P.squad.heroes[0].powerMul);
});

// ============================================================
console.log('\n=== 4. 升级流程 ===');
P.resetGame();
godMode();
ok('拾取经验会触发升级面板并冻结世界', () => {
  // 直接把经验珠放在玩家脚下，走正规拾取路径
  for (let i = 0; i < 60 && !P.upg.choices.length; i++) {
    P._spawnExp(P.player.x, P.player.y);
    tick(1, godMode);
  }
  assert(P.upg.choices.length > 0, '60 颗经验珠都没弹面板');
  assert.strictEqual(P.G.paused, true, '选卡时世界未冻结');
  assert(P.upg.level >= 2, 'Lv=' + P.upg.level);
});
ok('三选一是 3 张不重复的卡', () => {
  const ids = P.upg.choices.map(c => c.id);
  assert.strictEqual(new Set(ids).size, ids.length, '重复：' + ids.join(','));
});
ok('选卡后层数 +1、世界解冻', () => {
  const card = P.upg.choices[0];
  const before = P.upg.stacks[card.id] || 0;
  P._choose(card.id);
  assert.strictEqual(P.upg.stacks[card.id], before + 1);
  assert.strictEqual(P.G.paused, false);
});
ok('「尖牙」真乘到伤害上', () => {
  const before = P.upg.stats.damageMul;
  P.upg.choices = [];
  P._choose('damage');
  assert(P.upg.stats.damageMul > before, before + ' → ' + P.upg.stats.damageMul);
});
ok('满层后不会再出现在候选里', () => {
  P.upg.stacks.grit = 2;          // grit 上限 2
  P.upg.pending = 1;
  for (let i = 0; i < 40; i++) {
    P.upg.choices = [];
    P._choose; // noop
    P.upg.pending = 1;
    // 直接调用开面板的路径：伪造一次升级
    P._spawnExp(P.player.x, P.player.y);
    tick(1, godMode);
    if (P.upg.choices.length) break;
  }
  const hasGrit = P.upg.choices.some(c => c.id === 'grit');
  assert(!hasGrit, 'grit 已满层却仍出现在候选里');
});

// ============================================================
console.log('\n=== 5. 完整流程：20 波 → BOSS → 结算 ===');
P.resetGame();
godMode();
let frames = 0, maxEnemies = 0, maxProj = 0, nanCount = 0;
const MAX = 60 * 60 * 15;    // 15 分钟游戏时间上限

while (P.G.phase === 'battle' && frames < MAX) {
  NOW += 1000 / 60;
  godMode();
  if (P.upg.choices.length) { P._choose(P.upg.choices[0].id); continue; }
  if (P.squad.satiety < 35 && P.G.stats.meat >= 1) P._tryFeed();
  P._frame(NOW);
  frames++;
  maxEnemies = Math.max(maxEnemies, P._aliveEnemies());
  maxProj = Math.max(maxProj, P.projectiles.length);
  if (!finite(P.player.x) || !finite(P.player.y)) nanCount++;
}

console.log('  帧数 ' + frames + '（' + (frames / 60).toFixed(1) + ' 秒）');
console.log('  结局 ' + P.G.phase + (P.G.endReason ? ' / ' + P.G.endReason : ' / 未结束'));
console.log('  波次 ' + P.wave.idx + '/20 · Lv' + P.upg.level + ' · 击杀 ' + P.G.stats.kills);
console.log('  喂食 ' + P.G.stats.feeds + ' 次 · 肉块余 ' + P.G.stats.meat);
console.log('  同屏峰值 敌人 ' + maxEnemies + ' · 弹道 ' + maxProj);
console.log('  升级完成 ' + Object.keys(P.upg.stacks).map(k => k + ':' + P.upg.stacks[k]).join(' '));
// 供下方断言读取（一局时长/衰减受升级抽卡影响，范围会浮动）
const lastRun = {
  seconds: frames / 60,
  satietyEnd: P.squad.satiety,
  feeds: P.G.stats.feeds,
  kills: P.G.stats.kills,
};

ok('一局能打完（进入结算）', () => assert.notStrictEqual(P.G.phase, 'battle', '15 分钟没结算'));
ok('结局是通关（BOSS 被击杀）', () => assert.strictEqual(P.G.endReason, 'victory', '结局=' + P.G.endReason));
ok('20 波全部推进完', () => assert.strictEqual(P.wave.idx, 20, 'wave.idx=' + P.wave.idx));
ok('BOSS 生成过', () => assert(P.G.bossSpawned, '没生成'));
ok('坐标无 NaN', () => assert.strictEqual(nanCount, 0, nanCount + ' 帧出现 NaN'));
ok('等级有成长', () => assert(P.upg.level > 3, 'Lv' + P.upg.level));
ok('饱食度系统在一局里真的产生压力', () => {
  // ⚠️ 原断言是"至少喂过一次"，会偶发失败：一局时长 108~128 秒随机，
  //    如果这局刚好抽到「慢饿」叠层，衰减会被压到 0.53/秒，收在 40 上下 ——
  //    机器人（只在 <35 才喂）就没喂。那是**行为**差异，不是**机制**故障。
  //    真正要钉住的是"机制有没有压力"：原来的 bug 是一局只掉 28 点、永远掉不出满饱区。
  assert(
    lastRun.satietyEnd < 50 || lastRun.feeds > 0,
    '整局饱食度只掉到 ' + lastRun.satietyEnd.toFixed(0) + '，系统又变成摆设了',
  );
});
ok('敌人真的被杀（不是靠超时）', () => assert(P.G.stats.kills > 50, '击杀 ' + P.G.stats.kills));

// ============================================================
console.log('\n=== 6. 难度观察（自动走位、不无敌） ===');
P.resetGame();
// 模拟会走位的玩家：顺时针绕圈，每 1.2 秒换向
let dirIdx = 0;
const DIRS = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
function autoWalk(i) {
  if (i % 72 === 0) dirIdx = (dirIdx + 1) % 4;
  P._keys.clear();
  P._keys.add(DIRS[dirIdx]);
  P._keys.add(DIRS[(dirIdx + 1) % 4]);   // 斜向，绕圈更圆
}
let alive2 = 0;
while (P.G.phase === 'battle' && alive2 < 60 * 60 * 15) {
  NOW += 1000 / 60;
  autoWalk(alive2);
  if (P.upg.choices.length) { P._choose(P.upg.choices[0].id); continue; }
  if (P.squad.satiety < 35 && P.G.stats.meat >= 1) P._tryFeed();
  P._frame(NOW);
  alive2++;
}
P._keys.clear();
console.log('  走位玩家：' + (alive2 / 60).toFixed(1) + ' 秒后 ' +
  (P.G.phase === 'settlement' ? P.G.endReason : '仍在战斗') +
  ' · 波次 ' + P.wave.idx + ' · HP ' + P.player.hp);
console.log('  （这一项不设断言：难度合不合适要人上手判断）');

// ============================================================
console.log('\n=== 7. 结算与重开 ===');
ok('重开会清干净所有状态', () => {
  P.resetGame();
  assert.strictEqual(P.G.phase, 'battle');
  assert.strictEqual(P.player.hp, 6);
  assert.strictEqual(P.enemies.length, 0);
  assert.strictEqual(P.upg.level, 1);
  assert.strictEqual(Math.round(P.squad.satiety), 100);
  assert.strictEqual(P.wave.idx, 0);
  assert.strictEqual(P.upg.choices.length, 0);
  assert.strictEqual(P.G.stats.kills, 0);
});
ok('重开之后能继续出怪', () => {
  tick(300, godMode);
  assert.strictEqual(P.G.phase, 'battle');
  assert(P.enemies.length > 0, '重开后不出怪');
});
ok('主动撤离（E）能进结算', () => {
  P.resetGame();
  P.endBattle('withdraw');
  assert.strictEqual(P.G.phase, 'settlement');
  assert.strictEqual(P.G.endReason, 'withdraw');
});

// ============================================================
console.log('\n=== 8. 技能判定（CR-017）===');

/** 清场 + 把敌人摆到固定位置。返回摆好的敌人数组（引用） */
function stage(list) {
  P.resetGame();
  P.G.phase = 'battle';
  while (P.enemies.length) P.enemies.pop();
  while (P._abilities().length) P._abilities().pop();
  const out = [];
  for (const it of list) {
    P._spawnAt(it.t || 'walker', it.x, it.y);
    out.push(P.enemies[P.enemies.length - 1]);
  }
  return out;
}

ok('三个英雄分别是贯穿 / 落雷 / 冲击', () => {
  P.resetGame();
  // ⚠️ 不能用 deepStrictEqual：vm 沙箱里的 Array 与宿主的不是同一个原型，
  //    值完全相同也会判不等（上一版就误报在这）
  const kinds = P.squad.heroes.map(h => h.kind).join(',');
  assert.strictEqual(kinds, 'beam,bolt,nova', '实际 ' + kinds);
});

ok('贯穿能穿透多个目标', () => {
  // 三个怪排成一列，x 递增 40（都在 320 射程内、横向对齐）
  const es = stage([{ x: 200, y: 0 }, { x: 240, y: 0 }, { x: 280, y: 0 }]);
  const before = es.map(e => e.hp);
  P._castBeam(100, 0, 1, 0, 320, 10, false, 0);
  const hurt = es.filter((e, i) => e.hp < before[i]).length;
  assert.strictEqual(hurt, 3, '只打到 ' + hurt + ' 个');
});

ok('贯穿有穿透上限（maxTargets=4）', () => {
  const es = [];
  for (let i = 0; i < 6; i++) es.push({ x: 200 + i * 35, y: 0 });
  const list = stage(es);
  const before = list.map(e => e.hp);
  P._castBeam(100, 0, 1, 0, 320, 10, false, 0);
  const hurt = list.filter((e, i) => e.hp < before[i]).length;
  assert.strictEqual(hurt, 4, '实际命中 ' + hurt + ' 个（应为 4）');
});

ok('贯穿的群体伤害递减（首个满伤，之后衰减）', () => {
  const list = stage([{ x: 200, y: 0 }, { x: 240, y: 0 }]);
  const before = list.map(e => e.hp);
  P._castBeam(100, 0, 1, 0, 320, 10, false, 0);
  const d1 = before[0] - list[0].hp;
  const d2 = before[1] - list[1].hp;
  assert(d1 > 0 && d2 > 0, '两个都该掉血');
  assert(d2 < d1, '第二个伤害 ' + d2 + ' 应小于第一个 ' + d1);
});

ok('落雷在预警期间不结算（延迟 0.32s）', () => {
  const list = stage([{ x: P.player.x + 700, y: P.player.y }]);
  const e = list[0];
  const hp0 = e.hp;
  P._castBolt(P.player.x, P.player.y, e.x, e.y, 10, false, 0);
  // 刚放下就是预警圈，血不该动
  assert.strictEqual(e.hp, hp0, '预警期间就掉血了，结算提前了');
  const fx = P._abilities().find(f => f.kind === 'bolt');
  assert(fx && !fx.fired, '落雷实例应存在且未引爆');
});

ok('落雷预警结束后真的结算', () => {
  const list = stage([{ x: P.player.x + 700, y: P.player.y }]);
  const e = list[0];
  const hp0 = e.hp;
  P._castBolt(P.player.x, P.player.y, e.x, e.y, 10, false, 0);
  for (let i = 0; i < 24; i++) P._step(1 / 60);   // 推进 0.4s > warn 0.32
  assert(e.hp < hp0, '预警结束后没炸（hp 未变）');
});

ok('冲击波只打半径内，半径外不受影响', () => {
  const list = stage([{ x: 50, y: 0 }, { x: 300, y: 0 }]);
  const [near, far] = list;
  const hpNear = near.hp;
  const hpFar = far.hp;
  P._castNova(0, 0, 8, false, 0);
  assert(near.hp < hpNear, '半径 96 内的怪没掉血');
  assert.strictEqual(far.hp, hpFar, '半径外的怪不该掉血');
});

ok('我方不再产生任何投射物', () => {
  P.resetGame();
  P.G.phase = 'battle';
  for (let i = 0; i < 400; i++) {
    godMode();
    if (P.upg.choices.length) P._choose(P.upg.choices[0].id);
    P._frame(NOW + (i + 1) * 1000 / 60);
  }
  const petBullets = P.projectiles.filter(p => p.fromPet).length;
  assert.strictEqual(petBullets, 0, '还有 ' + petBullets + ' 发我方子弹在飞');
});

ok('技能实例会过期回收（不同屏堆积）', () => {
  P.resetGame();
  P.G.phase = 'battle';
  for (let i = 0; i < 40; i++) P._castNova(0, 0, 8, false, 0);
  const peak = P._abilities().length;
  for (let i = 0; i < 60; i++) P._step(1 / 60);
  assert.strictEqual(P._abilities().length, 0, '过了 1 秒还剩 ' + P._abilities().length + ' 个（峰值 ' + peak + '）');
});

ok('贯穿的四边形几何有效（无 NaN、无零面积）', () => {
  P.resetGame();
  P.G.phase = 'battle';
  stat.pts.length = 0;
  P._castBeam(100, 100, 1, 0, 320, 10, false, 0);
  P._render();
  assert(stat.pts.length > 0, '光束一个点都没画（渲染分支没进）');
  for (const [x, y] of stat.pts) {
    assert(Number.isFinite(x) && Number.isFinite(y), '出现非有限坐标 ' + x + ',' + y);
  }
  // 四边形面积（鞋带公式）：零面积说明退化成一个点，什么都看不见
  const a = Math.abs(
    stat.pts[0][0] * stat.pts[1][1] - stat.pts[1][0] * stat.pts[0][1] +
    stat.pts[1][0] * stat.pts[2][1] - stat.pts[2][0] * stat.pts[1][1] +
    stat.pts[2][0] * stat.pts[3][1] - stat.pts[3][0] * stat.pts[2][1] +
    stat.pts[3][0] * stat.pts[0][1] - stat.pts[0][0] * stat.pts[3][1]
  ) / 2;
  assert(a > 10, '四边形面积只有 ' + a.toFixed(1) + 'px²，基本等于没画');
});

ok('贯穿长度为 0 时也不产出 NaN', () => {
  P.resetGame();
  P.G.phase = 'battle';
  stat.pts.length = 0;
  // 起点与终点重合：归一化会除零，代码里用 ||1 兜底，这条断言把这个兜底钉住
  P._castBeam(100, 100, 1, 0, 0, 10, false, 0);
  P._render();
  for (const [x, y] of stat.pts) {
    assert(Number.isFinite(x) && Number.isFinite(y), '零长度光束产生了 NaN');
  }
});

// ============================================================
console.log('\n=== 9. 渲染负载 ===');
ok('单帧 drawImage 次数合理', () => {
  P.resetGame();
  stat.drawImage = 0;
  stat.frames = 0;
  tick(180, godMode);
  const perFrame = stat.drawImage / 180;
  console.log('      平均每帧 drawImage ' + perFrame.toFixed(1) + ' 次');
  assert(perFrame > 0, '一次都没画，渲染路径可能断了');
  assert(perFrame < 400, '每帧 ' + perFrame.toFixed(0) + ' 次，太高');
});
ok('没有把 undefined 传给 drawImage', () => assert.strictEqual(stat.badDraw, 0));

console.log('\n通过 ' + passed + ' / ' + (passed + failed) + '\n');
process.exit(failed === 0 ? 0 : 1);
