/* ============================================================================
   grove.html 冒烟测试
   ----------------------------------------------------------------------------
   不靠"看起来能跑"判断，用断言把每一条规则钉住：

     1. 开局与选人
     2. 三层包裹 -> 变球（游戏里唯一的"死亡"路径）
     3. 推球 / 撞飞造球
     4. 球撞敌人 +1 层、变大
     5. 三种地形：火坑(×2 断连锁) / 泥坑(强化) / 营地(落袋)
     6. 木桩：只有球能撞碎，碎后掉果
     7. 漏气：球停太久会崩，里面的人复活
     8. 玩家：火坑烫 / 碰敌人受伤
     9. 整局跑通：机器人按规则打，必须能在时限内清场
    10. 八关几何：竖井能下到地面 / 木桩不站坑里不挡落点 / **营地推得到**
    11. 目标系统：限球额度 / 连锁计数 / 落袋按只数
    12. 漏气速率：停着约 11 秒、卷人回气
    13. 预瞄线：画出来的路径必须和实际推出去的结果一致

   运行：
     node grove-smoke.js            ← 秒级，不跑机器人（109 项）
     ALL9=1 node grove-smoke.js     ← 加跑八关巡回 + 7 条设计断言，共 171 项（约 3 分钟）
     TRACE=1 ...                    ← 机器人跑动时每 5 秒打一行状态

   机器人逻辑在 grove-bot.js（和 grove-diag.js 共用一份），
   沙箱 boot 在 grove-env.js。
   ========================================================================== */

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");

let pass = 0, fail = 0;
const fails = [];

function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  \u2713 " + label); }
  else {
    fail++;
    fails.push(label + (extra ? "  [" + extra + "]" : ""));
    console.log("  \u2717 " + label + (extra ? "  [" + extra + "]" : ""));
  }
}
function eq(a, b, label) {
  ok(a === b, label + " (" + JSON.stringify(a) + " === " + JSON.stringify(b) + ")");
}
function near(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, label + " (" + a.toFixed(2) + " ~ " + b + "±" + tol + ")");
}

/* ---------- Canvas 桩 ---------- */
const noop = () => {};

function mkCtx() {
  const c = {
    canvas: null,
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1,
    font: "", textAlign: "", textBaseline: "", lineCap: "",
    globalCompositeOperation: "",
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, ellipse: noop, bezierCurveTo: noop, quadraticCurveTo: noop,
    fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop,
    setLineDash: noop, drawImage: noop,
    measureText: (t) => ({ width: String(t).length * 7 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  return c;
}

function mkCanvas(w, h) {
  const c = { width: w || 960, height: h || 600, style: {} };
  c.getContext = () => mkCtx();
  c.addEventListener = noop;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  return c;
}

/** 固定种子的伪随机：同一个种子跑出同一局，失败可复现 */
function seed(S, n) {
  let x = (n === undefined ? 20261020 : n) >>> 0;
  S.rng = () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function boot() {
  const html = fs.readFileSync(HTML, "utf8");
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const main = mkCanvas(960, 600);
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN, undefined,
    document: {
      getElementById: () => main,
      createElement: () => mkCanvas(1, 1),
    },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return sb;
}

/* 机器人下楼时保持的方向：走一步踩空后不要立刻掉头 */
let fallDir = 0;

/* 机器人逻辑在 grove-bot.js，诊断脚本共用同一份 —— 两份实现一定会漂移 */
const { botStep: botDecide } = require("./grove-bot");
let botMem = {};
function botStep(P, S) { botDecide(P, S, botMem); }

/* ---------- 每段测试都重开一局，避免状态串味 ---------- */
console.log("\n=== 1. 开局与选人 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  eq(S.phase, "select", "刚打开应在选人界面");
  const want = P.curStage().spawns.length;
  eq(S.foes.length, want, want + " 只敌人全部在场（和关卡配置一致）");
  eq(S.p, null, "还没选人，没有玩家");
  eq(P.HEROES.length, 6, "6 只可选角色");

  P._start(0);
  eq(S.phase, "play", "选完人进入战斗");
  ok(S.p !== null, "玩家对象已创建");
  eq(S.p.hero, 0, "带的是 0 号角色");
  eq(S.p.hp, 4, "满血 4 点");
  eq(S.balls.length, 0, "开局没有球");
}

console.log("\n=== 2. 三层包裹 -> 变球 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);
  const f = S.foes[0];

  P.coatFoe(f, 1);
  eq(f.coat, 1, "喷一下：1 层");
  eq(S.balls.length, 0, "1 层还不成球");

  P.coatFoe(f, 1);
  eq(f.coat, 2, "喷两下：2 层");
  eq(S.balls.length, 0, "2 层还不成球");

  P.coatFoe(f, 1);
  eq(f.coat, 3, "喷三下：3 层");
  eq(S.balls.length, 1, "3 层 -> 变成一颗球");
  ok(f.dead, "原敌人已从场上移除");
  eq(S.balls[0].holds, 1, "球里装着 1 只");

  // 已经满层的不该再加
  P.coatFoe(f, 1);
  eq(S.balls.length, 1, "对已变球的敌人再喷不会造出第二颗");
}

console.log("\n=== 3. 走位推球 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);
  const f = S.foes.find(x => x.kind === "walk");
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = 400; b.y = 462; b.vx = 0;

  // 玩家站到球左边
  S.p.x = b.x - 40;
  S.p.y = b.y;
  S.p.vx = 0;
  P._press("right", true);
  P.tick(1 / 60);

  ok(b.vx > 100, "贴上去就把球推走了", "vx=" + b.vx.toFixed(0));
  ok(b.vx > 0, "玩家在左边 -> 球往右滚");
  P._press("right", false);
}

console.log("\n=== 4. 球撞敌人：+1 层、变大、连锁 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);

  // 挪到上层平台测（x 330~630, y 462）。
  // 地面虽然宽，但被木桩和坑切成几段 —— 球在地面滚不了多远，
  // 那是**关卡设计**，不是 bug。这里要验的是球本身的规则。
  const PLAT_Y = 462;

  const a = S.foes[0];
  P.coatFoe(a, 3);
  const ball = S.balls[0];
  ball.x = 350; ball.y = PLAT_Y; ball.onGround = true; ball.ground = null;
  ball.vx = 900;

  const g1 = S.foes.find(f => !f.dead);
  const g2 = S.foes.filter(f => !f.dead)[1];
  g1.x = 450; g1.y = PLAT_Y; g1.coat = 2;
  g2.x = 500; g2.y = PLAT_Y; g2.coat = 2;

  const holds0 = ball.holds;
  for (let i = 0; i < 30; i++) P.tick(1 / 60);

  ok(holds0 === 1, "起手球里只有 1 只");
  ok(ball.holds >= 2, "裹满两层的被撞到会被**卷进球里**", "holds=" + ball.holds);
  ok(g1.dead, "被卷进去的那只从场上消失");
  ok(S.balls.length === 1, "不额外多出球（人是卷进去，不是原地变球）", "balls=" + S.balls.length);
  ok(ball.r > 22, "球变大了", "r=" + ball.r.toFixed(1));
}

function GROUND_Y_OF(P) { return P.PLATS[0].y; }

console.log("\n=== 5a. 火坑：烧掉、收成 ×2、断连锁 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);
  const fire = P.PITS.find(p => p.kind === "fire");

  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = fire.x + fire.w / 2;
  b.y = fire.y;
  b.onGround = true;
  b.packed = [f.def, f.def, f.def];
  b.holds = 3;
  b.vx = 0;

  P.tick(1 / 60);

  ok(b.dead, "球被烧掉了");
  eq(S.food, 6, "3 只 ×2 = 6 份收成");
  eq(S.killed, 3, "算清掉 3 只");
  eq(S.balls.length, 0, "场上不再有球（连锁断了）");
}

console.log("\n=== 5b. 泥坑：球裹泥、变重（撞人 +2 层）===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);
  const mud = P.PITS.find(p => p.kind === "mud");

  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = mud.x + mud.w / 2;
  b.y = mud.y;
  b.onGround = true;
  b.vx = 400;

  P.tick(1 / 60);
  ok(b.mud === true, "球进了泥坑，变成泥球");
  ok(b.vx < 400, "泥坑让球变慢", "vx=" + b.vx.toFixed(0));

  // 泥球撞一下 = +2 层
  const victim = S.foes.find(x => !x.dead);
  victim.x = b.x + 30;
  victim.y = mud.y;
  victim.coat = 0;
  b.vx = 700;
  for (let i = 0; i < 10; i++) P.tick(1 / 60);
  ok(victim.coat >= 2, "泥球撞人一次 +2 层，不是 +1", "coat=" + victim.coat);
}

console.log("\n=== 5c. 营地：落袋为安 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);
  const camp = P.CAMP;

  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = camp.x + camp.w / 2;
  b.y = camp.y;
  b.onGround = true;
  b.holds = 2;
  b.vx = 0;

  P.tick(1 / 60);
  ok(b.dead, "球滚进营地被收走");
  eq(S.food, 3, "2 只 + 额外 1 = 3 份");
  eq(S.balls.length, 0, "场上不再有球");
}

console.log("\n=== 6. 木桩：只有球撞得碎，碎了掉果 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0, 1);   // 第 1 关不放木桩（出生点太近会挡弹），木桩测试挪到第 2 关
  const st = S.stumps[0];
  const top = st.y - st.h;

  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = st.x - st.w / 2 - 30;
  b.y = st.y;
  b.onGround = true;
  b.vx = 900;

  const hp0 = st.hp;
  for (let i = 0; i < 20; i++) P.tick(1 / 60);
  ok(st.hp < hp0, "球撞木桩，木桩掉耐久", hp0 + " -> " + st.hp);

  // 再撞一次撞碎。球第一次撞完会反弹 / 可能已经出清，必须塞回场上再撞，
  // 不然改的只是那个对象，tick 里根本看不到它（hp 停在 1）。
  b.x = st.x - st.w / 2 - 30;
  b.vx = 1200;
  b.dead = false;
  if (S.balls.indexOf(b) < 0) S.balls.push(b);
  for (let i = 0; i < 30; i++) P.tick(1 / 60);
  eq(st.hp, 0, "木桩被撞碎");
  ok(S.drops.length >= 2, "碎掉的木桩掉野果", "drops=" + S.drops.length);
}

console.log("\n=== 7. 崩开：球停太久，里面的人复活 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);

  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = 480; b.y = 462; b.vx = 0; b.onGround = true;
  b.holds = 2;

  // 数"活着的"，不是数数组长度 —— 刚变球的那只还躺在数组里没被清理，
  // 数长度会得出"崩开前后一样多"的假结论
  const aliveCount = () => S.foes.filter(f => !f.dead).length;
  const n0 = aliveCount();
  // 静止漏气 0.11/s -> 约 9 秒流光。取 11 秒留一点余量
  for (let i = 0; i < 60 * 11; i++) P.tick(1 / 60);

  ok(S.balls.length === 0, "11 秒后球漏光崩开了");
  ok(aliveCount() > n0, "里面的家伙爬出来了", n0 + " -> " + aliveCount());
  ok(S.foes.some(x => x.coat >= 1 && !x.dead), "爬出来的不是满状态（身上还挂着 1 层）");
}

console.log("\n=== 8. 玩家：火坑烫 / 碰敌人受伤 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0);
  const fire = P.PITS.find(p => p.kind === "fire");

  S.p.x = fire.x + fire.w / 2;
  S.p.y = fire.y;
  S.p.invT = 0;
  const hp0 = S.p.hp;
  P.tick(1 / 60);
  eq(S.p.hp, hp0 - 1, "站在火坑上会掉 1 点血");
  ok(S.p.vy < 0, "被烫得弹起来");

  // 无敌期内不再掉
  S.p.hp = S.p.maxHp;
  S.p.invT = 0.5;
  P.tick(1 / 60);
  eq(S.p.hp, 4, "无敌期内不会被连烫");

  // 碰敌人
  const sb2 = boot();
  const P2 = sb2.GROVE, S2 = P2.S;
  P2._start(0);
  const foe = S2.foes.find(f => f.kind === "walk");
  foe.x = S2.p.x + 10;
  foe.y = S2.p.y;
  S2.p.invT = 0;
  P2.tick(1 / 60);
  eq(S2.p.hp, S2.p.maxHp - 1, "碰到敌人掉 1 点血");
}

console.log("\n=== 9. 撞飞：裹两层的一撞即成球 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);
  // 站到中间空地上，别贴着木桩 —— 球一出门就撞桩子弹回来，
  // 看起来像"撞飞没生效"
  S.p.x = 400;
  S.p.y = 462;
  const f = S.foes.find(x => x.kind === "walk");
  f.x = S.p.x + 22;
  f.y = 462;
  f.coat = 2;

  S.p.face = 1;
  S.p.dashCd = 0;
  P._press("dash", true);
  const balls0 = S.balls.length;
  for (let i = 0; i < 12; i++) P.tick(1 / 60);

  ok(S.balls.length > balls0, "冲刺撞上去直接造出一颗球");
  if (S.balls.length > balls0) {
    const b = S.balls[S.balls.length - 1];
    ok(b.vx > 200, "球带着速度飞出去，不是停在原地", "vx=" + b.vx.toFixed(0));
  }
}

console.log("\n=== 10a. 机制闭环：无限血下必须能清场 ===");
{
  // 给无限血不是"作弊"，是把**难度**和**机制**分开测：
  // 血量够的话都清不掉，那就是机制不闭合（球推不走、敌人清不完、
  // 场面永远收敛不了），跟玩家手不手残无关。
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(2);
  S.p.hp = 999; S.p.maxHp = 999;

  const r = runBot(P, S, 60 * 180);
  console.log("  " + r);
  if (S.log.length) console.log("  " + S.log.filter(l => l.startsWith("upd")).slice(-10).join("\n  "));

  ok(S.phase === "clear", "无限血下能把整片空地清空", "phase=" + S.phase + " alive=" + S.foes.length);
  ok(S.food >= 8, "收成要上双位数（说明球真的被结算了，不是全崩开）", "food=" + S.food);
  ok(S.t < 150, "清场用时不超过 150 秒", "t=" + S.t.toFixed(1));
}

console.log("\n=== 10b. 正常血量：难度参考（不作强断言） ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(2);
  const r = runBot(P, S, 60 * 180);
  console.log("  " + r);
  // 机器人是**下限**，不是标准：它连躲弹幕都不会，只验证"开局不会被瞬间抹掉"。
  // 人玩肯定活得久得多，所以这条线压得很低。
  ok(S.t > 4, "3 血能撑过 4 秒（低于这个数说明开局就被秒）", "t=" + S.t.toFixed(1));
}

function runBot(P, S, maxFrames) {
  botMem = {};                       // 每关一份记忆，别把上一关的 fallDir 带过来
  let frames = 0;
  while (frames < maxFrames) {
    if (S.phase !== "play") break;
    botStep(P, S);
    P.tick(1 / 60);
    frames++;
    if (process.env.TRACE && frames % 300 === 0) {
      console.log("    t=" + (frames / 60).toFixed(0) +
        " p=(" + S.p.x.toFixed(0) + "," + S.p.y.toFixed(0) + ") hp=" + S.p.hp +
        " | " + S.foes.map(f => f.def.name + "@" + f.x.toFixed(0) + "," + f.y.toFixed(0) + "c" + f.coat).join("  ") +
        " | balls=" + S.balls.map(b => b.x.toFixed(0) + "," + b.y.toFixed(0) + " v" + b.vx.toFixed(0) + " a" + b.air.toFixed(2)).join("  "));
    }
  }
  return "用时 " + (frames / 60).toFixed(1) + "s · 阶段 " + S.phase +
         " · 清掉 " + S.killed + "/" + S.total +
         " · 场上 " + S.foes.length + " 只 · 球 " + S.balls.length +
         " · 收成 " + S.food + " · 球[造" + S.stat.made + " 烧" + S.stat.burned + " 袋" + S.stat.banked + " 崩" + S.stat.burst + "]";
}

/* ---------- 几何工具：某一层的缺口 ---------- */
function gapsAt(P, y) {
  const segs = P.PLATS.filter(q => q.kind !== "ground" && Math.abs(q.y - y) < 8)
    .sort((a, b) => a.x - b.x);
  const out = [];
  for (let i = 1; i < segs.length; i++) {
    const l = segs[i - 1].x + segs[i - 1].w, r = segs[i].x;
    if (r > l) out.push({ l, r, w: r - l, x: (l + r) / 2 });
  }
  return out;
}

/** 两层缺口能同时通过的那一段 = 竖井 */
function shaftOf(P, ya, yb) {
  for (const a of gapsAt(P, ya)) {
    for (const b of gapsAt(P, yb)) {
      const l = Math.max(a.l, b.l), r = Math.min(a.r, b.r);
      if (r > l) return { l, r, w: r - l, x: (l + r) / 2 };
    }
  }
  return null;
}

console.log("\n=== 11. 八关几何：每关都得能下到地面、推得到营地 ===");
{
  // 这一项是被真机跑出来的：早期的缺口左右错开，
  // 于是上层缺口永远被下层平台接住，玩家和球都回不到地面。
  // 机器人在 350/462 之间来回弹了 180 秒，地面那只野猪一次都没碰到。
  const nLev = boot().GROVE.LEVELS.length;
  ok(nLev >= 6, "关卡线至少六关", nLev + " 关");
  for (let i = 0; i < nLev; i++) {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, i);
    const R = P.curStage();

    ok(P.PLATS.some(p => p.kind === "ground"), R.name + "：有地面");
    ok(P.PITS.some(p => p.kind === "fire"), R.name + "：有火坑");
    ok(P.PITS.some(p => p.kind === "mud"), R.name + "：有泥坑");
    ok(P.CAMP && P.CAMP.w > 0, R.name + "：有营地");
    if (R.id !== "entry") ok(S.stumps.length > 0, R.name + "：有木桩");

    const shaft = shaftOf(P, 350, 462);
    ok(shaft && shaft.w >= 55, R.name + "：竖井够宽（球能穿过）",
      shaft ? "w=" + shaft.w.toFixed(0) : "两层缺口没有交集");

    // 木桩不能站进坑里，也不能站在竖井的落点上。
    // 这两条都是截图看出来的：双坑的木桩原来立在火坑右半截，
    // 断崖的桩会伸进竖井落点，球有一半概率直接砸在桩顶上。
    // 冒烟测试当时全绿 —— 因为没有任何一条断言在管"东西是不是叠在一起"。
    for (const s of S.stumps) {
      const sl = s.x - s.w / 2, sr = s.x + s.w / 2;
      for (const pit of P.PITS) {
        ok(sr <= pit.x || sl >= pit.x + pit.w, R.name + "：木桩没站在坑里",
          "桩 " + sl.toFixed(0) + ".." + sr.toFixed(0) + " vs " + pit.kind + " " +
          pit.x + ".." + (pit.x + pit.w));
      }
      if (shaft) {
        const lo = shaft.l + 24, hi = shaft.r - 24;   // 球心落下时的 x 范围
        ok(hi <= sl || lo >= sr, R.name + "：木桩没挡住竖井落点",
          "落点 " + lo.toFixed(0) + ".." + hi.toFixed(0) +
          " vs 桩 " + sl.toFixed(0) + ".." + sr.toFixed(0));
      }
    }

    if (shaft) {
      const f = S.foes[0];
      P.coatFoe(f, 3);
      const b = S.balls[0];
      b.x = shaft.x; b.y = 350; b.vx = 0; b.vy = 0; b.onGround = false;
      // 记最低点而不是看最后落在哪：有斜坡那关球会掉到地面又被坡送回来，
      // 只看最终 y 会误判成"掉不下去"。
      let low = b.y;
      for (let k = 0; k < 60 * 4; k++) { P.tick(1 / 60); if (b.dead) break; low = Math.max(low, b.y); }
      ok(b.dead || low >= 550, R.name + "：球真的能掉到地面", "最低 y=" + low.toFixed(0));
    }

    // 营地必须**推得到**，否则这屏的「落袋」目标是个死关。
    // 双坑原来只有一条竖井，正对火坑，全图没有任何位置能把球送进营地 ——
    // 诊断脚本把整张图枚举了一遍才看出来（球全烧了，一个都没进袋）。
    //
    // 扫的时候把木桩血量清零：撞碎木桩是玩家能做的事，不算"封死"。
    // 不清零的话断崖、高台都会误报 —— 它们的营地本来就挡在木桩后面。
    {
      const hp0 = S.stumps.map(s => s.hp);
      for (const s of S.stumps) s.hp = 0;
      let hit = null;
      const layers = [248, 350, 462];
      for (const y of layers) {
        if (hit) break;
        for (let x = P.WALL_L + 20; x <= P.WALL_R - 20 && !hit; x += 6) {
          const onIt = P.PLATS.some(q => Math.abs(q.y - y) < 4 && x > q.x && x < q.x + q.w);
          if (!onIt) continue;
          for (const dir of [-1, 1]) {
            // 直接塞一颗临时球进场上给 predictBall 用 —— 别用 coatFoe 造，
            // 敌人裹满一次之后就不让再裹了，第二轮起根本造不出球，
            // 于是这条断言会对每关全报"推不到营地"（假失败）。
            const bb = {
              x, y, vx: 0, vy: 0, r: 24, onGround: true,
              holds: 0, packed: [], mud: false, air: 1, dead: false,
            };
            S.balls.push(bb);
            const pr = P.predictBall(bb, dir);
            S.balls.pop();
            if (pr.end === "camp") { hit = { x, y, dir }; break; }
          }
        }
      }
      S.stumps.forEach((s, i) => { s.hp = hp0[i]; });
      ok(hit, R.name + "：存在能把球送进营地的推法（不然落袋关无解）",
        hit ? "x=" + hit.x + " y=" + hit.y + " 往" + (hit.dir > 0 ? "右" : "左") : "全图没有任何位置能推到营地");
    }
  }
}

console.log("\n=== 12. 目标：限球 / 连锁 / 落袋 ===");
{
  // 限球：额度用完之后，喷到 2 层就封顶，不许再成球
  // 注意：额度数字不写死在这里 —— 每关的 ballLimit 是拿机器人跑 ALL9 调出来的调参值，
  // 写死的话每次调难度都要回来改测试。这里临时把额度压到 2，只验证"额度机制"本身。
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  const li = P.LEVELS.findIndex(l => l.goal === "limit");
  ok(li >= 0, "关卡线里有限球关");
  P._start(0, li);
  const st = P.curStage();
  eq(st.goal, "limit", "选中的是限球关");
  ok(st.ballLimit > 0, "限球关配了额度", "ballLimit=" + st.ballLimit);

  st.ballLimit = 2;                       // 临时收紧，便于验证
  eq(P.ballBudget(), 2, "开局额度 = 关卡配置");

  const fs2 = S.foes.slice();
  for (let i = 0; i < 2; i++) {
    P.coatFoe(fs2[i], 3);
    S.balls.length = 0;      // 清空场上球，绕过"同屏最多 2 颗"的限制，只测额度
  }
  eq(S.stat.made, 2, "刚好造出 2 颗");
  eq(P.ballBudget(), 0, "额度用完");

  const f5 = fs2[2];
  P.coatFoe(f5, 3);
  eq(f5.coat, 2, "额度用完后再糊，最多停在 2 层");
  eq(S.stat.made, 2, "没有多造出第 3 颗");
  ok(!f5.dead, "那只敌人还在场上（还能被路过的球卷走）");
}
{
  // 连锁：球卷进两只，maxHolds 记 2；没清场不算达标
  //
  // 位置不写死：每关的球道切法不一样（462 层可能被切成三段），
  // 写死坐标的话换个关卡顺序就全错。这里挑**这一屏最宽的那段 462 球道**，
  // 把两只已经裹到 2 层的敌人摆上去，球从左边滚过去。
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  const ci = P.LEVELS.findIndex(s => s.goal === "chain");
  ok(ci >= 0, "关卡线里至少有一关是连锁关");
  P._start(0, ci);
  eq(P.curStage().goal, "chain", "选中的是连锁关");

  const segs = P.PLATS.filter(q => Math.abs(q.y - 462) < 6).sort((a, b) => b.w - a.w);
  const seg = segs[0];
  ok(seg && seg.w > 220, "这一屏有一条够长的 462 球道", seg ? "w=" + seg.w : "没有");

  const a = S.foes[0];
  P.coatFoe(a, 3);
  const b = S.balls[0];
  b.x = seg.x + 40; b.y = 462; b.onGround = true; b.vx = 700;

  const targets = S.foes.filter(f => !f.dead).slice(0, 2);
  targets[0].x = seg.x + 100; targets[0].y = 462; targets[0].coat = 2;
  targets[1].x = seg.x + 160; targets[1].y = 462; targets[1].coat = 2;
  for (let k = 0; k < 40; k++) P.tick(1 / 60);

  ok(S.stat.maxHolds >= 2, "maxHolds 记到了 2 只", "max=" + S.stat.maxHolds);
  eq(P.checkGoal(), false, "没人清完，连锁也不算达标");
}
{
  // 落袋：按"只数"统计，不是按"球数"
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  const bi = P.LEVELS.findIndex(s => s.goal === "bank");
  ok(bi >= 0, "关卡线里至少有一关是落袋关");
  P._start(0, bi);
  eq(P.curStage().goal, "bank", "选中的是落袋关");

  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.packed = [f.def, f.def, f.def];
  b.holds = 3;
  b.x = P.CAMP.x + 20; b.y = P.PLATS[0].y; b.onGround = true; b.vx = 0;
  P.tick(1 / 60);

  eq(S.stat.bankHolds, 3, "一颗装 3 只的球落袋 = 3 只（不是 1 只）");
}

console.log("\n=== 13. 漏气：球不会无限期停在场上 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 0);

  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  eq(b.air, 1, "新球满气");
  b.vx = 0; b.vy = 0; b.onGround = true;

  // 挪到不会被敌人/地形干扰的位置（462 层中间）
  b.x = 350; b.y = 462;
  for (let i = 0; i < 60 * 7; i++) P.tick(1 / 60);
  ok(S.balls.indexOf(b) >= 0, "停 7 秒还在（玩家来得及走过去推）", "air=" + b.air.toFixed(2));

  for (let i = 0; i < 60 * 4; i++) P.tick(1 / 60);
  ok(S.balls.indexOf(b) < 0, "停满约 11 秒就漏光崩开");
}
{
  // 卷人回气：连锁是被奖励的，不然"卷"永远不如"另造一颗"
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 0);

  const a = S.foes[0];
  P.coatFoe(a, 3);
  const b = S.balls[0];
  b.air = 0.4;
  const victim = S.foes.find(f => !f.dead);
  victim.coat = 2;
  P.coatFoe(victim, 1, b);
  ok(b.air > 0.4, "卷进一只球回一口气", "0.40 -> " + b.air.toFixed(2));
}

console.log("\n=== 14. 预瞄线：画出来的必须和实际一致 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 2);

  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  // 第 3 关地面：泥 300..400 / 火 440..560 / 营地 848
  b.x = 620; b.y = 556; b.vx = 0; b.vy = 0; b.onGround = true;

  const R = P.predictBall(b, 1);
  const L = P.predictBall(b, -1);
  ok(R.pts.length > 2, "向右有预测路径", "pts=" + R.pts.length);
  eq(R.end, "camp", "向右推：预测会进营地");
  eq(L.end, "fire", "向左推：预测会进火坑");

  // 木桩挡路也要预测得出来（第 4 关的木桩在 300）
  P._start(0, 3);
  P.coatFoe(S.foes[0], 3);
  const b2 = S.balls[0];
  b2.x = 380; b2.y = 556; b2.vx = 0; b2.vy = 0; b2.onGround = true;
  eq(P.predictBall(b2, -1).end, "stump", "向左推：预测会撞木桩");

  // 真的推一次，看和预测是否一致 —— 这一条是整条预瞄线存在的理由
  P._start(0, 2);
  P.coatFoe(S.foes[0], 3);
  const b3 = S.balls[0];
  b3.x = 620; b3.y = 556; b3.vx = 0; b3.vy = 0; b3.onGround = true;
  const burned0 = S.stat.burned;
  b3.vx = -620; b3.vy = -40;
  for (let i = 0; i < 60 * 5; i++) P.tick(1 / 60);
  ok(S.stat.burned === burned0 + 1, "实际推出去，确实烧掉了（预测没骗人）",
    "burned " + burned0 + " -> " + S.stat.burned);
}



console.log("\n=== 15. 球不减速 / 四种场景件 / 撞击掉落 ===");
{
  // ① 地面无摩擦。用户明确要求"雪球不做减速"，所以这条是行为契约：
  //    除了撞墙 ×0.62，速度不该自己掉。
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 0);
  for (const ff of S.foes) ff.x = 4000;      // 挪走敌人，只测球自己的速度
  const f = S.foes[0];
  f.x = 170; P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = 120; b.y = 462; b.vx = 500; b.vy = 0; b.onGround = true;
  const v0 = 500;
  for (let i = 0; i < 30; i++) P.tick(1 / 60);
  ok(Math.abs(b.vx) >= v0 * 0.97, "地面滚动不减速（只靠撞墙衰减）",
    v0 + " -> " + Math.abs(b.vx).toFixed(0) + " 跑 0.5 秒");
}
{
  // ② 水塘：球沉底、人回场上、零收成
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 1);                            // 泥沼
  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  // 从水塘正上方砸下去 —— 水塘只认"砸进去"的球，滚过去的不沉。
  // 坐标现查关卡数据，不写死：改一关布局就会把这段测试弄假。
  const wt = P.PITS.find(q => q.kind === "water");
  b.x = wt.x + wt.w / 2; b.y = 300; b.vx = 0; b.vy = 0; b.onGround = false;
  for (let i = 0; i < 90; i++) P.tick(1 / 60);
  ok(S.balls.indexOf(b) < 0, "水塘：球沉下去了");
  eq(S.stat.drowned, 1, "水塘：记了一次沉底");
  ok(S.foes.length >= 1, "水塘：人被冲回场上（不是凭空消失）", S.foes.length + " 只");
  eq(S.killed, 0, "水塘：不给收成、也不算清场");
}
{
  // ②b 滚过水面不该沉 —— 否则水塘放在场地两端就变成必死区
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 1);
  for (const ff of S.foes) ff.x = 4000;
  const f = S.foes[0]; f.x = 300; P.coatFoe(f, 3);
  const b = S.balls[0];
  const wt = P.PITS.find(q => q.kind === "water");
  // 速度和时间都要收着点：滚过头会掉进右边的火坑，那就和"沉不沉"没关系了
  b.x = wt.x - 34; b.y = 556; b.vx = 250; b.vy = 0; b.onGround = true;
  for (let i = 0; i < 50; i++) P.tick(1 / 60);
  ok(S.balls.indexOf(b) >= 0, "球从水面上滚过去不会沉（只有砸进去才沉）", "x=" + b.x.toFixed(0));
}
{
  // ③ 斜坡：能把球从地面抬到 462 层
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 3);                            // 缓坡
  ok(P.RAMPS.length > 0, "缓坡这关配了斜坡");
  for (const ff of S.foes) ff.x = 4000;
  const f = S.foes[0]; f.x = 170;
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = P.RAMPS[0].x + 14; b.y = 556; b.vx = 640; b.vy = 0; b.onGround = true;
  let hi = b.y;
  for (let i = 0; i < 90; i++) { P.tick(1 / 60); hi = Math.min(hi, b.y); }
  ok(hi <= 470, "斜坡把球抬到了 462 层", "最高 y=" + hi.toFixed(0));
  // 预测要从坡底重新起算 —— 上面那颗球已经爬到顶了，从顶上再预测当然不会再往上
  b.x = P.RAMPS[0].x + 14; b.y = 556; b.vx = 0; b.vy = 0; b.onGround = true;
  const pr = P.predictBall(b, 1);
  ok(pr.pts.some(q => q.y < 470), "预瞄线也画到了上层（不是画到坡底就断）",
    "最低点 y=" + Math.min.apply(null, pr.pts.map(q => q.y)).toFixed(0));
}
{
  // ④ 弹簧菇：球滚过去被弹起
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 4);                            // 弹跳林
  ok(P.BOUNCERS.length > 0, "弹跳林这关配了弹簧菇");
  for (const ff of S.foes) ff.x = 4000;
  const f = S.foes[0]; f.x = 170;
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = P.BOUNCERS[0].x - 40; b.y = 556; b.vx = 420; b.vy = 0; b.onGround = true;
  let hi = b.y;
  for (let i = 0; i < 60; i++) { P.tick(1 / 60); hi = Math.min(hi, b.y); }
  ok(hi < 500, "弹簧菇把球弹起来了", "最高 y=" + hi.toFixed(0));
}
{
  // ⑤ 传送洞：球从 A 进、B 出，水平速度不变
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 5);                            // 深井
  ok(P.PORTALS.length === 2, "深井这关有两个洞");
  for (const ff of S.foes) ff.x = 4000;
  const f = S.foes[0]; f.x = 170;
  P.coatFoe(f, 3);
  const b = S.balls[0];
  const A = P.PORTALS[0], B = P.PORTALS[1];
  b.x = A.x - 30; b.y = A.y; b.vx = 520; b.vy = 0; b.onGround = true;   // 洞开在 462 球道层
  let jumped = false;
  for (let i = 0; i < 40; i++) {
    P.tick(1 / 60);
    if (Math.abs(b.x - B.x) < 60) { jumped = true; break; }
  }
  ok(jumped, "球从 A 洞穿到了 B 洞", "x=" + b.x.toFixed(0) + " 目标 " + B.x);
  ok(b.vx > 0, "穿过去之后方向不变（所以能一球串两边）", "vx=" + b.vx.toFixed(0));
}
{
  // ⑥ 撞击掉落：卷进一个人就爆一件，且能被玩家捡到
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 0);
  const f = S.foes[0];
  P.coatFoe(f, 3);
  const b = S.balls[0];
  const d0 = S.drops.length;
  const victim = S.foes.find(x => !x.dead);
  victim.coat = 2;
  P.coatFoe(victim, 1, b);
  ok(S.drops.length > d0, "卷进一个人就爆一件掉落", (S.drops.length - d0) + " 件");
  ok(!!S.drops[0] && !!S.drops[0].kind, "掉落物有类型（不是只会掉果子）", S.drops[0] && S.drops[0].kind);

  // 捡：把掉落物挪到玩家脚下
  const p = S.p;
  const food0 = S.food;
  S.drops[0].x = p.x; S.drops[0].y = p.y - 20; S.drops[0].kind = "gem";
  S.drops[0].taken = false;
  P.tick(1 / 60);
  ok(S.drops[0].taken, "玩家碰到就捡走了");
  ok(S.food >= food0 + 5, "晶核给 +5 收成", food0 + " -> " + S.food);
}
{
  // ⑦ 掉落是确定性的（固定种子下序列可复现）—— 否则没法做平衡
  const roll = (n) => {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    for (let i = 0; i < n; i++) P.S.drops.length = 0;
    const f = S.foes[0];
    P.coatFoe(f, 3);
    const b = S.balls[0];
    const out = [];
    for (const v of S.foes.slice()) {
      if (v.dead || v.coat >= 3) continue;
      v.coat = 2;
      P.coatFoe(v, 1, b);
      out.push(S.drops[out.length] ? S.drops[out.length].kind : "-");
      if (out.length >= 4) break;
    }
    return out.join(",");
  };
  eq(roll(3), roll(3), "同一个种子下，掉落序列完全一样");
}

/* ---------- 八关巡回（ALL9=1 时跑，约 2 分钟） ----------
   不只看"机器人过不过"，还按设计意图下断言：

     · 清场关：机器人必须清得掉 —— 这是"机制闭合"的证明，跟手速无关。
     · 限球关：额度必须 < 敌人数（说明不靠"卷"一定清不完），
                 同时又 >= ceil(敌人数/3)（一颗球实测最多卷 3 个，所以还得有解）。
                 机器人过不去是**预期的**，它不会提前规划。
     · 连锁关：机器人单球最多装几只，必须够到目标 ——
                 够不到说明目标从几何上就不存在。
     · 落袋关 / 收成关：机器人真的送到了 / 真的攒够了，才说明地形和经济通着。
   --------------------------------------------------------------------------- */
if (process.env.ALL9) {
  const N = boot().GROVE.LEVELS.length;
  const runs = [];
  console.log("\n=== 八关巡回：机器人怎么打 ===");
  console.log("  关                 目标  结果   用时   造 崩 烧 袋 沉 装 落袋  收成  清场");

  for (let i = 0; i < N; i++) {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(2, i);
    S.p.hp = 999; S.p.maxHp = 999;
    runBot(P, S, 60 * 240);
    const st = P.curStage();
    const row = {
      i, stage: st, name: (i + 1) + ". " + st.name, foes: S.total,
      killed: S.killed, phase: S.phase, t: S.t, made: S.stat.made,
      burst: S.stat.burst, burned: S.stat.burned, banked: S.stat.banked,
      drowned: S.stat.drowned, maxHolds: S.stat.maxHolds,
      bankHolds: S.stat.bankHolds, food: S.food,
    };
    runs.push(row);
    console.log("  " + row.name.padEnd(17) +
      P.GOALS[st.goal].name.padEnd(5) +
      (S.phase === "clear" ? "达标" : S.phase === "fail" ? "失败" : "超时").padEnd(5) +
      S.t.toFixed(0).padStart(4) + "s " +
      String(S.stat.made).padStart(3) + String(S.stat.burst).padStart(3) +
      String(S.stat.burned).padStart(3) + String(S.stat.banked).padStart(3) +
      String(S.stat.drowned).padStart(3) + String(S.stat.maxHolds).padStart(3) +
      String(S.stat.bankHolds).padStart(4) + String(S.food).padStart(6) +
      "  " + S.killed + "/" + S.total);
  }

  for (const r of runs) {
    const st = r.stage, nm = r.name;
    if (st.goal === "clear") {
      ok(r.phase === "clear", nm + "：机制闭合，机器人能清场",
        "清 " + r.killed + "/" + r.foes + " · " + r.t.toFixed(0) + "s");
    } else if (st.goal === "limit") {
      ok(st.ballLimit < r.foes, nm + "：额度比敌人数少（不靠卷一定清不完）",
        "额度 " + st.ballLimit + " vs 敌人 " + r.foes);
      ok(st.ballLimit >= Math.ceil(r.foes / 3), nm + "：理论上还有解（一颗球实测最多卷 3 个）",
        "额度 " + st.ballLimit + " vs 下限 " + Math.ceil(r.foes / 3));
    } else if (st.goal === "chain") {
      ok(r.maxHolds >= st.chain, nm + "：单球能装够目标只数（不然目标不存在）",
        "最大 " + r.maxHolds + " vs 目标 " + st.chain);
    } else if (st.goal === "bank") {
      ok(r.bankHolds >= st.bank, nm + "：营地真的能送到（地形通着）",
        "落袋 " + r.bankHolds + " vs 目标 " + st.bank);
    } else if (st.goal === "collect") {
      ok(r.food >= st.collect, nm + "：收成目标够得着（经济通着）",
        "收成 " + r.food + " vs 目标 " + st.collect);
    }
  }

  // ---- 打法签名：两关签名一样，说明机器人打起来是同一套操作。
  // 这只是**信息**，不是断言：机器人被"球停在哪"主导，它不策划"先铺场再统一推"。
  // "最优解到底重复没有"只有真人试玩能回答（CR-024 §8 第 5 项）。
  console.log("\n  打法签名（造/烧/袋/单球最多/用时档）：");
  const sig = (r) => [r.made, r.burned, r.banked, r.maxHolds, Math.round(r.t / 10)].join("/");
  const seen = {};
  for (const r of runs) (seen[sig(r)] = seen[sig(r)] || []).push(r.name);
  for (const g of Object.values(seen)) {
    console.log("    " + g.join("  =  ") + (g.length > 1 ? "   ← 打法重复" : ""));
  }
}


/* ---------- 16. 推关：打完一关是下一关，不是回列表 ---------- */
console.log("\n=== 16. 推关流程 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 0);
  eq(S.stage, 0, "从第 1 关开始");

  S.killed = S.total; S.phase = "clear";
  P.nextLevel();
  eq(S.stage, 1, "通关后直接进下一关");
  eq(S.phase, "play", "进关就是能玩的状态");
  eq(S.playT, 0, "新关计时从 0 开始");

  // 失败不往前推 —— 推关的"关"是有意义的，不能靠失败混过去
  P._start(0, 3);
  S.phase = "fail";
  P.nextLevel();
  eq(S.stage, 3, "失败重打本关，不往前推");
  eq(S.phase, "play", "重打直接进战斗");

  // 最后一关通关回选人
  P._start(0, P.LEVELS.length - 1);
  S.phase = "clear";
  P.nextLevel();
  eq(S.phase, "select", "最后一关通关后回选人界面");
}

/* ---------- 17. 八关布局：每关都得是"另一个地方" ---------- */
console.log("\n=== 17. 八关布局互不相同 ===");
{
  const sb = boot();
  const P = sb.GROVE;
  const sigs = new Set();
  ok(P.LEVELS.length >= 8, "关卡线至少八关", P.LEVELS.length + " 关");

  for (let i = 0; i < P.LEVELS.length; i++) {
    P._start(0, i);
    const st = P.curStage();
    // 指纹 = 平台布局 + 坑位 + 敌人数。三样全一样才算"同一块地"
    const sig = P.PLATS.map(q => q.y + ":" + q.x + ":" + q.w).join("|") +
                "#" + P.PITS.map(q => q.kind + q.x + q.w).join("|") +
                "#" + st.spawns.length;
    ok(!sigs.has(sig), "第 " + (i + 1) + " 关（" + st.name + "）的场地和前面都不一样");
    sigs.add(sig);

    // 每关都得有自己的主题色，不然切关像没切
    ok(!!P.THEMES[st.theme], "第 " + (i + 1) + " 关配了主题配色", st.theme);
  }
}

/* ---------- 18. 六把武器：形状不同，而且都打得到人 ---------- */
console.log("\n=== 18. 六把武器 ===");
{
  const sb0 = boot();
  const P0 = sb0.GROVE;
  const kinds = [];
  for (let h = 0; h < P0.HEROES.length; h++) {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(h, 0);
    S.shots.length = 0;
    P.HEROES[h].fire(S.p);
    ok(S.shots.length > 0, P.HEROES[h].name + "：按下去真的有东西飞出来");
    kinds.push(S.shots.map(x => x.kind).sort().join(","));
  }
  eq(new Set(kinds).size, kinds.length, "六把武器的弹道类型两两不同（不是换皮）");

  // 贴脸命中：技能再花，打不到人就是没做
  for (let h = 0; h < P0.HEROES.length; h++) {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(h, 0);
    // 抛物弹（萝卜炮）本来就不打贴脸：它要飞出去再落下来。
    // 所以这一个用中距离，别的用贴脸 —— 测的是"打得到"，不是"所有武器同一种射程"。
    // 萝卜炮要单独给场地：它是一颗抛物线，最高点 457，会被 462 层平台接住。
    // 所以测的是"炸得到那一层的人"—— 把敌人放到 462 层上，这才是它的实战位置。
    const gap = h === 3 ? 220 : 46;
    const f = S.foes[0];
    f.x = S.p.x + gap; f.y = h === 3 ? 462 : S.p.y; f.coat = 0; f.dead = false;
    // 定住它：测的是"弹道打不打得到"，不是"追不追得上巡逻的虫子"
    f.def = Object.assign({}, f.def, { spd: 0 });
    P.HEROES[h].fire(S.p);
    for (let k = 0; k < 110; k++) P.tick(1 / 60);
    ok(f.coat > 0 || f.dead, P.HEROES[h].name + " 的「" + P.HEROES[h].tag + "」打得到 " + gap + "px 外的敌人",
      "coat=" + f.coat);
  }
}

console.log("\n" + "=".repeat(56));
if (fail) {
  console.log("通过 " + pass + " · 失败 " + fail);
  for (const f of fails) console.log("  - " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过：" + pass + " 项");
}
console.log("=".repeat(56));
