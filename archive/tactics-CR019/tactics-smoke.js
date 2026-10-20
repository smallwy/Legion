'use strict';
/**
 * 宠物排班（回合制）离线冒烟测试
 * ------------------------------------------------------------------
 * 跑法：node tactics-smoke.js
 *
 * 为什么要有这个：沙箱里没有 Cocos 编辑器、也没有浏览器，
 * 回合制最危险的错误（一帧内重复结算、概率分布跑偏、状态机卡死）
 * 都不会在"看一眼截图"里暴露，只能用断言钉住。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const HTML = path.join(__dirname, '..', 'prototype', 'tactics.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.log('FAIL: 找不到 <script> 块'); process.exit(1); }
const code = m[1];

/* ---------------- Canvas / DOM 桩 ---------------- */

function makeCtx() {
  const noop = () => {};
  return {
    canvas: null,
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    font: '', textAlign: '', textBaseline: '',
    globalCompositeOperation: 'source-over',
    lineCap: 'butt', lineJoin: 'miter',
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arcTo: noop, arc: noop, ellipse: noop, rect: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop,
    fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    drawImage: noop, fillText: noop, strokeText: noop,
    setLineDash: noop, getLineDash: () => [],
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
}

function makeCanvas(w, h) {
  const c = { width: w || 0, height: h || 0, style: {} };
  const cx = makeCtx();
  cx.canvas = c;
  c.getContext = () => cx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 600 });
  c.addEventListener = () => {};
  return c;
}

const cv = makeCanvas(960, 600);

/** Image 桩：src 一设就同步触发 onload（真实图片是异步的，测试里必须同步） */
function makeImage() {
  const im = { width: 0, height: 0, onload: null, onerror: null };
  let _src = '';
  Object.defineProperty(im, 'src', {
    get: () => _src,
    set(v) {
      _src = v;
      im.width = 32;
      im.height = 32;
      if (im.onload) im.onload();
    },
  });
  return im;
}

const listeners = {};
const sandbox = {
  console,
  Math,
  Date,
  JSON,
  Image: makeImage,
  document: {
    getElementById: (id) => (id === 'cv' ? cv : null),
    createElement: (tag) => (tag === 'canvas' ? makeCanvas(0, 0) : {}),
  },
  addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  removeEventListener: () => {},
  innerWidth: 1280,
  innerHeight: 800,
  requestAnimationFrame: () => 0,   // 不真的跑循环，测试自己推进
  performance: { now: () => Date.now() },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox, { filename: 'tactics.html' });
} catch (e) {
  console.log('FAIL: 脚本执行抛错 →', e.message);
  console.log(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

const P = sandbox.PAWPACK;
if (!P) { console.log('FAIL: window.PAWPACK 未暴露'); process.exit(1); }

const S = P._S;
const ENEMY_DEFS = { walker: { sprite: 'enemy-walker', hp: 2, spd: 62, r: 15, size: 40, steal: 1, bite: 1 },
                     flyer: { sprite: 'enemy-flyer', hp: 1, spd: 96, r: 13, size: 38, steal: 1, bite: 1 },
                     tank: { sprite: 'enemy-tank', hp: 4, spd: 44, r: 18, size: 46, steal: 2, bite: 2 } };

/* ---------------- 断言工具 ---------------- */

let passed = 0, failed = 0;
const fails = [];

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; fails.push(msg); }
}
function eq(a, b, msg) {
  if (a === b) { passed++; }
  else { failed++; fails.push(msg + '（实际 ' + a + '，期望 ' + b + '）'); }
}
function near(a, b, tol, msg) {
  if (Math.abs(a - b) <= tol) { passed++; }
  else { failed++; fails.push(msg + '（实际 ' + a.toFixed(3) + '，期望 ' + b + '±' + tol + '）'); }
}

/* ---------------- 测试环境辅助 ---------------- */

/** 只放一只指定的怪，位置可控 —— 否则 spawnWave 的随机怪会污染判定 */
function soloEnemy(type, x, y) {
  const d = ENEMY_DEFS[type];
  S.enemies.length = 0;
  const e = {
    id: 99, type, def: d,
    x, y, ax: x, ay: y,
    hp: d.hp, maxHp: d.hp,
    intent: { kind: 'steal', target: null, tx: P._NEST.x, ty: P._NEST.y },
    stolen: 0, hitT: 0, dead: false, stuckT: 0,
  };
  S.enemies.push(e);
  return e;
}

/** 跑满一个执行期的模拟（固定步长，跟真实游戏一致） */
function runSim(dur) {
  const step = 1 / 120;
  let t = 0;
  const end = dur === undefined ? P._SIM_DUR : dur;
  while (t < end) { P._simTick(step); t += step; }
}

/** 让所有宠物都听话 */
function obeyAll() { S.rng = () => 0; }
function obeyNone() { S.rng = () => 0.999; }
function realRng() { S.rng = Math.random; }

/* ============================================================
   1. 初始化
   ============================================================ */
console.log('\n=== 1. 初始化 ===');
realRng();
P._reset();

eq(S.round, 1, '初始回合应为 1');
eq(S.food, 12, '初始粮食应为 12');
eq(S.pets.length, 3, '宠物应为 3 只');
ok(S.enemies.length >= 1, '第 1 回合应生成敌人');
ok(S.enemies.every(e => e.intent && (e.intent.kind === 'steal' || e.intent.kind === 'bite')),
   '每只怪在规划阶段就必须有意图（玩家靠它做决策）');
ok(S.orders.length === 3 && S.orders.every(o => o === null), '开局三只都没有指令');

/* ============================================================
   2. 服从率 —— 这套玩法的心脏
   ============================================================ */
console.log('\n=== 2. 服从率分布 ===');

const N = 3000;
let catObey = 0, dogObey = 0, hamObey = 0;
for (let i = 0; i < N; i++) {
  realRng();
  for (const p of S.pets) P._setOrder(p.idx, 'guard', 400, 400, null);
  P._resolveOrders();
  if (S.pets[0].obeyer) catObey++;
  if (S.pets[1].obeyer) dogObey++;
  if (S.pets[2].obeyer) hamObey++;
}

near(catObey / N, 0.70, 0.04, '猫的服从率应约 70%');
near(dogObey / N, 0.95, 0.03, '狗的服从率应约 95%');
near(hamObey / N, 0.80, 0.04, '仓鼠的服从率应约 80%');
ok(catObey < dogObey, '猫必须比狗不听话（这是三个角色的差异来源）');

// 抗命必须换成"另一件有用的事"，不能是摆烂
realRng();
let mutinyKinds = {};
for (let i = 0; i < 400; i++) {
  P._reset();
  for (const p of S.pets) P._setOrder(p.idx, 'rush', P._NEST.x, P._NEST.y, null);
  P._resolveOrders();
  for (const p of S.pets) {
    if (!p.obeyer) mutinyKinds[p.actKind] = (mutinyKinds[p.actKind] || 0) + 1;
  }
}
ok(!mutinyKinds['idle'], '抗命不应产生 idle（抗命 = 它自己拿了个主意，不是站着不动）');
ok(mutinyKinds['rush'] || mutinyKinds['overshoot'] || mutinyKinds['hide'] || mutinyKinds['play'],
   '抗命动作应落在 rush/overshoot/hide/play 里，实际 ' + JSON.stringify(mutinyKinds));

/* ============================================================
   3. 冲 —— 造成伤害
   ============================================================ */
console.log('\n=== 3. 冲 ===');
P._reset();
obeyAll();
const cat = S.pets[0];
const e3 = soloEnemy('walker', cat.x + 90, cat.y);
const hp0 = e3.hp;
P._setOrder(0, 'rush', e3.x, e3.y, e3);
P._resolveOrders();
eq(cat.actKind, 'rush', '服从时动作应为 rush');
runSim();
ok(e3.hp < hp0 || e3.dead, '冲之后目标应掉血或死亡（hp ' + hp0 + ' → ' + e3.hp + '）');

/* ============================================================
   4. 守 —— 蹲防反击
   ============================================================ */
console.log('\n=== 4. 守 ===');
P._reset();
obeyAll();
const e4 = soloEnemy('tank', S.pets[0].x + 25, S.pets[0].y);
P._setOrder(0, 'guard', S.pets[0].x, S.pets[0].y, null);
// 把怪的意图改成咬这只宠物，逼它贴身
S.enemies[0].intent = { kind: 'bite', target: S.pets[0], tx: S.pets[0].x, ty: S.pets[0].y };
const tankHp0 = e4.hp;
P._resolveOrders();
S.enemies[0].intent = { kind: 'bite', target: S.pets[0], tx: S.pets[0].x, ty: S.pets[0].y };
runSim(1.4);
ok(S.pets[0].guardT > 0, '守的宠物应进入蹲防姿态');
ok(e4.hp < tankHp0, '蹲防应反击（怪 hp ' + tankHp0 + ' → ' + e4.hp + '）');
// 冷却 0.5s，1.4s 执行期最多反击 2 次（每次 3 伤）。若冷却失效会掉上百血。
ok(tankHp0 - e4.hp <= 6, '贴身反击次数应受 0.5s 冷却约束（实际掉了 ' + (tankHp0 - e4.hp) + ' 血）');

/* ============================================================
   5. 装死 —— 完全免疫
   ============================================================ */
console.log('\n=== 5. 装死 ===');
P._reset();
obeyAll();
const e5 = soloEnemy('tank', S.pets[0].x + 30, S.pets[0].y);
const petHp0 = S.pets[0].hp;
P._setOrder(0, 'play', 0, 0, null);
P._resolveOrders();
S.enemies[0].intent = { kind: 'bite', target: S.pets[0], tx: S.pets[0].x, ty: S.pets[0].y };
runSim(1.0);
eq(S.pets[0].hp, petHp0, '装死期间不应掉血');
ok(S.pets[0].invuln, '装死应立起免疫标记');

/* ============================================================
   6. 叫 —— 拉仇恨
   ============================================================ */
console.log('\n=== 6. 叫 ===');
P._reset();
obeyAll();
const e6 = soloEnemy('walker', S.pets[0].x + 120, S.pets[0].y);
e6.intent = { kind: 'steal', target: null, tx: P._NEST.x, ty: P._NEST.y };
P._setOrder(0, 'bark', 0, 0, null);
P._resolveOrders();
P._simTick(1 / 120);
eq(e6.intent.kind, 'bite', '叫之后 190px 内的怪应改为咬宠物');
ok(e6.intent.target === S.pets[0], '仇恨目标应是被叫的那只');

/* ============================================================
   7. 护窝 —— 抢粮被挡
   ============================================================ */
console.log('\n=== 7. 护窝 ===');
P._reset();
obeyAll();
// 怪放远一点：护窝的宠物要先跑到窝边才立起 covering，
// 贴脸放的话它第一帧还没到位就被抢了（这是设计，不是 bug）
soloEnemy('walker', P._NEST.x, P._NEST.y - 130);
S.enemies[0].intent = { kind: 'steal', target: null, tx: P._NEST.x, ty: P._NEST.y };
P._setOrder(0, 'cover', 0, 0, null);
P._resolveOrders();
const foodBeforeCover = S.food;
runSim();
eq(S.food, foodBeforeCover, '有宠物护窝时，怪这次抢粮应被撞开（粮食不该掉）');

/* ============================================================
   8. 抢粮 —— 没有护窝就会掉
   ============================================================ */
console.log('\n=== 8. 抢粮 ===');
P._reset();
obeyAll();
soloEnemy('walker', P._NEST.x, P._NEST.y - 60);
S.enemies[0].intent = { kind: 'steal', target: null, tx: P._NEST.x, ty: P._NEST.y };
for (const p of S.pets) P._setOrder(p.idx, 'play', 0, 0, null);
P._resolveOrders();
const foodBeforeSteal = S.food;
runSim();
eq(S.food, foodBeforeSteal - 1, '没人护窝时应掉 1 份粮（实际掉 ' + (foodBeforeSteal - S.food) + '）');

// 关键回归：一只怪只抢一次，不能每帧都扣
P._reset();
obeyAll();
soloEnemy('walker', P._NEST.x, P._NEST.y - 40);
S.enemies[0].intent = { kind: 'steal', target: null, tx: P._NEST.x, ty: P._NEST.y };
for (const p of S.pets) P._setOrder(p.idx, 'play', 0, 0, null);
P._resolveOrders();
const f9 = S.food;
runSim(1.4);
const stolen = f9 - S.food;
ok(stolen <= 1, '一只怪一个回合最多抢 1 份（实际抢了 ' + stolen + ' 份，说明结算重复了）');

/* ============================================================
   9. 叼 —— 拖回窝边
   ============================================================ */
console.log('\n=== 9. 叼 ===');
P._reset();
obeyAll();
const e9 = soloEnemy('flyer', 700, 200);
e9.intent = { kind: 'steal', target: null, tx: P._NEST.x, ty: P._NEST.y };
const picker = S.pets[2];   // 仓鼠，效率 ×2
P._setOrder(2, 'fetch', e9.x, e9.y, e9);
P._resolveOrders();
runSim(1.4);
const distToNest = Math.hypot(e9.x - P._NEST.x, e9.y - P._NEST.y);
ok(distToNest < 200, '被叼住的怪应被拖向窝边（离窝 ' + distToNest.toFixed(0) + 'px）');

/* ============================================================
   10. 回合推进
   ============================================================ */
console.log('\n=== 10. 回合推进 ===');
P._reset();
realRng();
P._endRound();
eq(S.round, 2, '回合应 +1');
ok(S.orders.every(o => o === null), '新回合所有指令应清空');
ok(S.enemies.length >= 1, '新回合应补怪');

/* ============================================================
   11. 胜负
   ============================================================ */
console.log('\n=== 11. 胜负判定 ===');
P._reset();
realRng();
S.food = 0;
P._endRound();
eq(S.phase, 'over', '粮食归零应结束');
eq(S.result, 'lose-food', '结束原因应为 lose-food');

P._reset();
realRng();
S.round = 15;
P._endRound();
eq(S.result, 'win', '撑到第 15 回合应判胜');

P._reset();
realRng();
for (const p of S.pets) { p.down = true; p.hp = 0; }
P._endRound();
eq(S.result, 'lose-team', '全员倒下应判负');

/* ============================================================
   12. 觅食
   ============================================================ */
console.log('\n=== 12. 觅食 ===');
P._reset();
obeyAll();
S.round = 4;
S.phase = 'forage';
S.forage = { spot: 'neighbor', picked: -1 };
// 模拟玩家点「邻居家 + 派猫」
const forager = S.pets[0];
forager.forageT = 2;
forager.forageSpot = 'neighbor';
eq(forager.forageT, 2, '派出去后应离场 2 回合');

S.phase = 'plan';
const foodBeforeForage = S.food;
P._endRound();                      // forageT 2 → 1
eq(forager.forageT, 1, '第一回合后觅食倒计时应为 1');
P._endRound();                      // forageT 1 → 0，结算带回来的粮
eq(forager.forageT, 0, '第二回合后应归队');
ok(S.food > foodBeforeForage, '觅食应带回粮食（' + foodBeforeForage + ' → ' + S.food + '）');

/* ============================================================
   13. 长局稳定性 —— 自动玩家跑满
   ============================================================ */
console.log('\n=== 13. 长局稳定性 ===');
P._reset();
realRng();
let crash = null;
try {
  for (let i = 0; i < 12; i++) {
    P._runTurns(1);
    if (S.phase === 'over') break;
  }
} catch (e) { crash = e; }
ok(!crash, '连打 12 回合不应抛错：' + (crash ? crash.message : ''));
ok(Number.isFinite(S.food) && S.food >= 0, '粮食应始终是有限非负数');
ok(S.enemies.every(e => Number.isFinite(e.x) && Number.isFinite(e.y)),
   '敌人坐标不应出现 NaN（NaN 会让整个渲染静默消失）');
ok(S.pets.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), '宠物坐标不应出现 NaN');

/* ============================================================
   13.5 飘字与抗命反馈
   ============================================================ */
console.log('\n=== 13.5 飘字 / 抗命反馈 ===');
P._reset();
S.fx.length = 0;
vm.runInContext("addFx('text', 100, 100, '测试文字', '#FF0000')", sandbox);
ok(S.fx.length === 1, '飘字应入队');
ok(S.fx[0] && S.fx[0].text === '测试文字',
   '飘字必须带文字（实际 text=' + (S.fx[0] && S.fx[0].text) + '，被当成颜色吞掉了）');
ok(S.fx[0] && S.fx[0].color === '#FF0000', '飘字的第二参应是颜色');

// 抗命必须汇总成横幅，否则玩家不知道"排好的指令为什么没照做"
P._reset();
obeyNone();                     // 全员抗命
for (const pt of S.pets) P._setOrder(pt.idx, 'rush', 500, 300, null);
P._startTurn();
ok(S.mutinyList.length === 3, '全员抗命时应记录 3 条（实际 ' + S.mutinyList.length + '）');
ok(S.banner && S.banner.text.indexOf('不听话') < 0 && S.banner.text.length > 4,
   '抗命横幅应有内容：' + (S.banner ? S.banner.text : 'null'));

/* ============================================================
   14. 渲染不抛错
   ============================================================ */
console.log('\n=== 14. 渲染 ===');
let renderCrash = null;
try {
  const render = vm.runInContext('render', sandbox);
  for (const ph of ['plan', 'act', 'resolve', 'forage', 'over']) {
    S.phase = ph;
    render();
  }
} catch (e) { renderCrash = e; }
ok(!renderCrash, '五种阶段都应能渲染：' + (renderCrash ? renderCrash.message : ''));

/* ---------------- 汇总 ---------------- */

console.log('\n' + '='.repeat(52));
if (failed === 0) {
  console.log('全部通过 ' + passed + ' / ' + passed);
} else {
  console.log('通过 ' + passed + '，失败 ' + failed);
  for (const f of fails) console.log('  ✗ ' + f);
}
console.log('='.repeat(52));
process.exit(failed === 0 ? 0 : 1);
