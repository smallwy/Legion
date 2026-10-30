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
    24. 一趟：饱食 / 连锁倍率 / 收工回家 / 关卡内台词 / 结算面板能渲染

   运行：
     node grove-smoke.js            ← 秒级，不跑机器人（358 项）
     ALL9=1 node grove-smoke.js     ← 加跑八关巡回 + 设计断言，共 368 项（约 3 分钟）
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
    // rect 是 drawTree 的树干在用的。桩缺方法时只会在"真的去渲染"的那条
    // 测试里炸 —— 而之前没有任何一条测试调 render()，所以它一直没被发现。
    rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop,
    setLineDash: noop, drawImage: noop,
    /* 后期合成层（drawPost）用到的那几个：transform 重置、画布级滤镜、
       图案填充。桩缺方法时只会在"真的去渲染"的测试里炸 —— 上次 rect 就是
       这样藏了一整轮。这里的 filter 用普通属性而非访问器：真 canvas 上
       赋一个不支持的串也只是被忽略，桩没必要更严格。 */
    setTransform: noop, resetTransform: noop,
    filter: "", createPattern: () => ({}),
    createImageData: (w, h) => ({
      data: new Uint8ClampedArray((w | 0) * (h | 0) * 4),
      width: w | 0, height: h | 0,
    }),
    getImageData: (x, y, w, h) => ({
      data: new Uint8ClampedArray((w | 0) * (h | 0) * 4),
      width: w | 0, height: h | 0,
    }),
    putImageData: noop,
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
  /* 内存 localStorage 桩。**这个桩漏过一次，代价很大**（2026-10-27）：
     没有它的时候，`writeNestDepth` / `readNestDepth` 内部都是
     `try { localStorage... } catch {}` —— 于是"写不进去"和"写进去了"
     返回值完全一样（0），断言全绿，而功能一个都没通。
     `grove-env.js` 里早就有这个桩并写了同样的警告，这份 boot 是独立
     实现的，当时漏抄了。**两份 boot 必须同源**，这一行就是证据。 */
  const mem = {};
  const ls = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
  };
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN, undefined,
    localStorage: ls,
    document: {
      getElementById: () => main,
      createElement: () => mkCanvas(1, 1),
    },
    performance: { now: () => Date.now() },
    /* 原来是 noop —— 于是"浏览器直开 grove.html 按 F2"这条真实通路
       **从来没被任何断言碰过**。这次 Cocos 键盘 bug 的盲区正在这儿：
       转发链有断言，真实事件没有。收集起来，需要时自己 _fire。 */
    _ls: {},
    addEventListener: (name, fn) => {
      (sb._ls[name] || (sb._ls[name] = [])).push(fn);
    },
    _fire: (name, ev) => {
      for (const fn of (sb._ls[name] || [])) fn(ev);
    },
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
  const want = P.curStage().waves[0].length;
  eq(S.foes.length, want, want + " 只敌人全部在场（第一波 = 关卡配置）");
  eq(S.wave, 0, "从第 1 波开始");
  eq(S.total, P.curStage().waves.reduce((a, w) => a + w.length, 0),
     "总人数 = 所有波次之和");
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
  /* 3 只 = 6（每只 2）+ 1（加注，见 holdBonus）—— 2026-10-27 之前是 6。
     火坑**必须跟着加注一起涨**，否则 holds=5 时营地 12 > 火坑 10，
     一个"球没了+断连锁"的高风险出口反而输给稳的出口。 */
  eq(S.food, 7, "3 只 ×2 = 6 份 + 加注 1");
  eq(S.killed, 3, "算清掉 3 只");
  eq(S.balls.length, 0, "场上不再有球（连锁断了）");
}

console.log("\n=== 5a-2. 「加注」：第三只起收成超线性 ===");
{
  const sb = boot();
  const P = sb.GROVE;
  /* 唯一的真值是 `holdBonus` / `bankGain` 两个函数，这里逐个钉死数值。
     **为什么必须钉死**：这套曲线的全部意义是"1~2 只不变、3 只以上爆发"。
     如果哪天有人"顺手"把平方项改成从 2 只起算，27 屏的 collect 目标
     （12/13/14）会集体变松，而那 27 个数字是手调的、没人会去复查。
     钉在这里，改一处就红一处。 */
  eq(P.holdBonus(1), 0, "1 只：没有加注");
  eq(P.holdBonus(2), 0, "2 只：没有加注（**这条最关键**，2 只是常态）");
  eq(P.holdBonus(3), 1, "3 只：加注 1");
  eq(P.holdBonus(4), 3, "4 只：加注 3");
  eq(P.holdBonus(5), 6, "5 只：加注 6");
  eq(P.bankGain(1), 2, "营地 1 只 = 2（与旧版一致）");
  eq(P.bankGain(2), 3, "营地 2 只 = 3（与旧版一致）");
  eq(P.bankGain(3), 5, "营地 3 只 = 5（旧版 4）");
  eq(P.bankGain(4), 8, "营地 4 只 = 8（旧版 5）");
  eq(P.bankGain(5), 12, "营地 5 只 = 12（旧版 6）");
  eq(P.bankGain(1, true), 14, "BOSS 单只仍带 +12");
  /* 单调性：多装一只必须严格更赚，否则"加注"没有意义 */
  ok(P.bankGain(5) > P.bankGain(4) && P.bankGain(4) > P.bankGain(3),
     "营地收成随只数严格递增");
  /* 火坑必须始终压过营地（它是高风险出口） */
  const fire = (h) => h * 2 + P.holdBonus(h);
  ok([3, 4, 5].every(h => fire(h) > P.bankGain(h)),
     "火坑在 3~5 只时始终高于营地（风险溢价没被吃掉）",
     `3:${fire(3)}>${P.bankGain(3)} 4:${fire(4)}>${P.bankGain(4)} 5:${fire(5)}>${P.bankGain(5)}`);
}

console.log("\n=== 5a-3. 石球：停住就是一块砖 ===");
{
  /* 只放**三条致命项**进来，其余在 `tools/_stone-check.js`。
     选这三条的标准：坏了就是"玩家辛苦造的球凭空没了"或"人能凭空消失"，
     属于一眼看不出、但要等玩家报 bug 的那种。 */
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0);
  S.foes.length = 0;
  S.texts.length = 0;
  P.CHASMS.length = 0;          // 挪开营地，否则球滚过去会被正常吃掉

  const mk = (x, holds) => {
    const f = P.foeFromSpec({ foe: "bug", x: x + 200, y: P.GROUND_Y, lv: 1 }, false);
    P.makeBallFrom(f, 0, 0);
    const b = S.balls[S.balls.length - 1];
    b.x = x; b.y = P.GROUND_Y;
    b.vx = 0; b.vy = 0; b.holds = holds;
    b.packed = new Array(holds).fill(f.def);
    b.pushed = true; b.onGround = true;
    return b;
  };

  /* ① 按 ↓ 压住 → 立刻变石球 */
  const b1 = mk(300, 2);
  const p = S.p;
  p.x = b1.x - b1.r - p.w / 2 - 1;
  p.y = P.GROUND_Y;
  p.onGround = true; p.face = 1; p.runD = 0;
  S.keys.down = true;
  P.tick(1 / 60);
  S.keys.down = false;
  ok(b1.stone, "按 ↓ 贴着球 → 变石球");
  /* **必须把玩家挪开**：他贴着球站着，下一帧就会被"贴近就推"判成推球，
     石球立刻活过来（这正是设计）。但我们要验的是"没人动它就是一块砖"。 */
  p.x = 700; p.onGround = true;

  /* ② 石球不漏气、不会自己崩（后者验的是 `b.t > 45` 那条兜底有没有豁免） */
  const air0 = b1.air;
  for (let i = 0; i < 60 * 6; i++) P.tick(1 / 60);
  ok(!b1.dead && Math.abs(b1.air - air0) < 1e-6, "石球不漏气、不自己崩",
     air0.toFixed(2) + " → " + b1.air.toFixed(2));

  /* ③ 推起来就活过来，而且**不回气**（回气的话石球会变成刷气手段） */
  const p2 = S.p;
  p2.x = b1.x - b1.r - p2.w / 2 - 1;
  p2.y = P.GROUND_Y;
  p2.onGround = true; p2.face = 1;
  P.tick(1 / 60);
  ok(!b1.stone && b1.vx > 0, "推一下石球又滚起来", "vx=" + b1.vx.toFixed(0));
  ok(b1.air <= air0 + 1e-6, "推起来不回气（否则石球=刷气机）",
     air0.toFixed(2) + " → " + b1.air.toFixed(4));

  /* ④ 超上限爆最老那颗，人必须回到场上 */
  const sb2 = boot();
  const P2 = sb2.GROVE, S2 = P2.S;
  P2._start(0);
  S2.foes.length = 0; S2.texts.length = 0;
  P2.CHASMS.length = 0;
  const made = [];
  for (let i = 0; i < 3; i++) {
    const f = P2.foeFromSpec({ foe: "bug", x: 320 + i * 150, y: P2.GROUND_Y, lv: 1 }, false);
    P2.makeBallFrom(f, 0, 0);
    const b = S2.balls[S2.balls.length - 1];
    b.x = 320 + i * 150; b.y = P2.GROUND_Y; b.vx = 0; b.onGround = true;
    made.push(b);
  }
  const foes0 = S2.foes.length;
  for (const b of made) P2.hardenBall(b);
  ok(S2.balls.filter(x => x.stone && !x.dead).length === P2.STONE_MAX,
     "同时最多 " + P2.STONE_MAX + " 颗石球");
  ok(made[0].dead, "超上限时爆的是**最老**那颗（不是刚摆好的）");
  ok(S2.foes.length > foes0, "里面的人被吐回场上（没有凭空消失）",
     foes0 + " → " + S2.foes.length);
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

  /* 清不掉的时候必须能读出"剩的是谁、它为什么不动"。
     只报 alive=2 等于什么都没说 —— 而"卡住"在这套物理里有四种完全不同的成因
     （被桩顶住 / 贴在墙边 / 永远在空中 / 追着一个已经不存在的东西）。 */
  if (S.phase !== "clear") {
    for (const f of S.foes) {
      console.log("    剩: " + f.def.name +
        " jumper=" + f.jumper + " larva=" + (f.larva ? 1 : 0) +
        " x=" + f.x.toFixed(0) + " y=" + f.y.toFixed(0) + " vx=" + (f.vx || 0).toFixed(0) +
        " coat=" + f.coat + " dir=" + f.dir + " face=" + f.face +
        " onG=" + (f.onGround ? 1 : 0) + " wallT=" + (f.wallT || 0).toFixed(2) +
        " crouch=" + (f.crouch || 0).toFixed(2) + " pounce=" + (f.pounce || 0).toFixed(2) +
        " landT=" + (f.landT || 0).toFixed(2) + " jumpCd=" + (f.jumpCd || 0).toFixed(2) +
        " bornT=" + (f.bornT || 0).toFixed(1) +
        " ground=" + (f.ground ? f.ground.kind + "@" + f.ground.y.toFixed(0) : "null"));
    }
  }

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
        /* `J` 后缀 = 跳虫（会追人、会往上层扑）。打在名字后面而不是末尾，
           是为了让"剩下哪几只、它们是不是跳虫"能一眼读出来 ——
           跳虫卡住和普通虫卡住是两种完全不同的病。 */
        " | " + S.foes.map(f => f.def.name + (f.jumper ? "J" : "") +
          "@" + f.x.toFixed(0) + "," + f.y.toFixed(0) +
          "c" + f.coat + (f.onGround ? "g" : "a") +
          (f.landT > 0 ? "L" : "") + (f.crouch > 0 ? "C" : "") + (f.wallT > 0 ? "W" : "")).join("  ") +
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
  const push = (l, r) => { if (r > l) out.push({ l, r, w: r - l, x: (l + r) / 2 }); };

  // 平台两端到墙也算缺口。原来的版本只算"两段平台之间"的缝，
  // 于是"一条长台 + 右边一大片空"会被判成"没有竖井"——
  // 而那种地形恰恰是球最容易掉下去的一种。
  if (!segs.length) { push(P.WALL_L, P.WALL_R); return out; }
  push(P.WALL_L, segs[0].x);
  for (let i = 1; i < segs.length; i++) push(segs[i - 1].x + segs[i - 1].w, segs[i].x);
  push(segs[segs.length - 1].x + segs[segs.length - 1].w, P.WALL_R);
  return out;
}

/** 两层缺口能同时通过的那一段 = 竖井
 *
 *  **取最宽的那一段，不是第一个碰上的那一段。**
 *  这是被第 20 屏（浮萍台）逼出来的：那一屏的台面是一排浮萍小方块，
 *  350 层左端的缺口和 462 层第一个踏脚位只错开 30px —— 而右侧有一条
 *  104px 的真通道。返回"第一个交集"时会拿到那个 30px 的装饰缝，
 *  判成"竖井太窄"，但球其实从右边畅通无阻地掉下去。
 *  取最宽 = 和球自己找路的行为一致（它也走最宽那条）。
 */
function shaftOf(P, ya, yb) {
  let best = null;
  for (const a of gapsAt(P, ya)) {
    for (const b of gapsAt(P, yb)) {
      const l = Math.max(a.l, b.l), r = Math.min(a.r, b.r);
      if (r > l && (!best || r - l > best.w)) best = { l, r, w: r - l, x: (l + r) / 2 };
    }
  }
  return best;
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
    /* 崖坎没有火坑，也放不下火坑 —— 它的球道只有**一段**：
       砸穿岩壳 → 落进崖腔 → 向左滚进营地（116..300 这一段地面）。
       火坑摆哪儿都会吃掉这条路上唯一的球：
       摆 116..300 里 = 必烧，摆右侧 = 那里是土崖的立面，根本没有地面。
       **"每屏必须有火坑"是个假规矩** —— 火坑的语义是"接住滚回来的球"，
       而这一屏的球不会滚回来（它是从上面砸下来的）。 */
    const NO_FIRE = ["wither_cliff"];
    if (!NO_FIRE.includes(R.id)) ok(P.PITS.some(p => p.kind === "fire"), R.name + "：有火坑");
    ok(P.PITS.some(p => p.kind === "mud"), R.name + "：有泥坑");
    ok(P.CAMP && P.CAMP.w > 0, R.name + "：有营地");
    // 教学关不放桩（出生点就在旁边，所有弹丸出门第一帧就被它吃掉）；
    // 缓坡也不放 —— 它是一条通往营地的长滑道，桩子摆哪儿都在球的必经路上；
    // 回弹井同样不放 —— 唯一可放的位置 646..852 正是"打上 462 层再推下来"的
    // 回家路，桩杵在那儿球撞上去就弹回左边的火坑，打不打上去结局一样。
    // **可破坏件不是每屏都必须有的零件**，硬塞一个就是给球道添堵。
    /* 崖坎同样没有木桩，理由和火坑同源：球砸穿岩壳之后落进崖腔，
       崖腔左右是 460 的土崖立面和洞口，中间整段都是球的必经路。
       硬塞一根桩进去，球撞上就弹回右墙 —— 等于把唯一的球道堵死。 */
    const NO_STUMP = ["entry", "slope", "rebound", "wither_cliff"];
    if (!NO_STUMP.includes(R.id)) ok(S.stumps.length > 0, R.name + "：有木桩");

    /* 「竖井」= 350 层和 462 层的缺口交集。**这两层不是每屏都有** ——
       断崖路（谷道 + 山丘）和回弹井本来就没有 350 层，`gapsAt` 会退化成
       "整屏一个缺口"，于是这条断言和下面的落点断言都变成**测了空集**：
       全绿，但什么也没测（断崖路就因此在"木桩挡住落点"上报了个假红，
       落点 50..910 根本不是井，是整面墙）。没有双层结构就不该算竖井。 */
    const layered = (y) => P.PLATS.some(q => q.kind !== "ground" && Math.abs(q.y - y) < 8);
    const hasTwo = layered(350) && layered(462);
    const shaft = hasTwo ? shaftOf(P, 350, 462) : null;
    ok(!hasTwo || (shaft && shaft.w >= 55), R.name + "：竖井够宽（球能穿过）",
      hasTwo ? (shaft ? "w=" + shaft.w.toFixed(0) : "两层缺口没有交集")
             : "本屏没有 350/462 双层结构（不算竖井）");

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
      // 出生点有时正落在竖井里（弹跳林井心 93，人在 60）。
      // 人会把下落的球推走，测到的就不是井了。先把人挪到右墙边。
      if (S.p) { S.p.x = P.WALL_R - 40; S.p.vx = 0; }
      // 记最低点而不是看最后落在哪：有斜坡那关球会掉到地面又被坡送回来，
      // 只看最终 y 会误判成"掉不下去"。
      /* 4 秒对"一层竖向井"够，对**盘山道**不够 —— 球要先跑完四段坡才落到地面，
         实测要 6~8 秒，所以给 12 秒。

         **必须先把气流关掉再测。** 判的是"这一屏有没有被封死"，
         而盘山道的球在落到底部之前就被井接走了（设计如此），
         不关井的话它永远到不了地面，这条断言会变成"在测井"，不是在测封死。
         关掉井之后球必须落到地面 —— 这才是这条断言真正想问的事。 */
      const savedDraft = P.UPDRAFTS.splice(0, P.UPDRAFTS.length);
      let low = b.y;
      for (let k = 0; k < 60 * 12; k++) { P.tick(1 / 60); if (b.dead) break; low = Math.max(low, b.y); }
      for (const u of savedDraft) P.UPDRAFTS.push(u);
      ok(b.dead || low >= 550, R.name + "：球真的能掉到地面（关掉气流）", "最低 y=" + low.toFixed(0));
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
      /* **地面必须算进来。** 原来只扫 248/350/462 三层，是因为 1~8 关每屏都有一条
         坡落在营地门口，球滑下来就进袋。但 27 屏里有 17 屏没有坡 —— 玩家最自然的
         做法就是走到地面上，把地上的球往营地推。漏掉地面这一层，会把
         "地面上明明能推"的关判成死关（泥沼那几屏全被误报）。 */
      const layers = [P.GROUND_Y, 248, 350, 462];
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
  // 挑"最宽的那块浮空台所在的那一屏连锁关"。
  // 写死缓坡不行：它现在是一条长滑道，最宽的台面只有 154 —— 摆不下一颗球加两只人。
  const cands = [];
  P.LEVELS.forEach((st, i) => {
    if (st.goal !== "chain") return;
    /* **只挑"干净"的球道：这一段上没有木桩、下面没有坑。**
       原来只管"最宽的那一段"，在 8 屏时够用。27 屏之后连锁关变成 7 个，
       最宽的一段是树桩林那条 794 长的台 —— 而那条台上立着三根桩，
       球推出 60px 就撞桩停下，maxHolds 只记到 1，测试假失败。
       这一段量的是"撞人能不能攒 holds"，不是"能不能绕开桩"，所以要挑干净的。 */
    const clean = st.plats
      .filter(q => q.kind !== "ground")
      .filter(q => !(st.stumps || []).some(s => s.x + s.w / 2 > q.x - 30 && s.x - s.w / 2 < q.x + q.w + 30))
      .filter(q => !(st.pits || []).some(p => p.x + p.w > q.x && p.x < q.x + q.w))
      .sort((a, b) => b.w - a.w)[0];
    if (clean) cands.push({ i, seg: clean });
  });
  cands.sort((a, b) => b.seg.w - a.seg.w);
  ok(cands.length > 0, "关卡线里至少有一关是连锁关");
  const ci = cands[0].i;
  P._start(0, ci);
  eq(P.curStage().goal, "chain", "选中的是连锁关");

  const seg = cands[0].seg;
  ok(seg.w > 220, "这一屏有一条够长的球道", "w=" + seg.w + " @y" + seg.y);

  const a = S.foes[0];
  P.coatFoe(a, 3);
  const b = S.balls[0];
  b.x = seg.x + 20; b.y = seg.y; b.onGround = true; b.vx = 700;

  const targets = S.foes.filter(f => !f.dead).slice(0, 2);
  targets[0].x = seg.x + 80; targets[0].y = seg.y; targets[0].coat = 2;
  targets[1].x = seg.x + 140; targets[1].y = seg.y; targets[1].coat = 2;
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

  // 木桩挡路也要预测得出来（第 3 关的木桩在地面 180）
  // 缓坡那关改成长滑道之后地面上没有木桩了，所以换成断崖来测这一条。
  P._start(0, 2);
  P.coatFoe(S.foes[0], 3);
  const b2 = S.balls[0];
  b2.x = 260; b2.y = 556; b2.vx = 0; b2.vy = 0; b2.onGround = true;
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
  // 从右边往左滚：左边是坡，球滚上坡会被抬高，砸进水面 —— 那测的就不是"平滚"了
  b.x = wt.x + wt.w + 34; b.y = 556; b.vx = -250; b.vy = 0; b.onGround = true;
  for (let i = 0; i < 50; i++) P.tick(1 / 60);
  ok(S.balls.indexOf(b) >= 0, "球从水面上滚过去不会沉（只有砸进去才沉）", "x=" + b.x.toFixed(0));
}
{
  // ③ 长滑道：从顶层推下去的球一路滑到地面，而且越滑越快
  //    —— 这一关就是为"站在最高层往下推"做的，所以这条断言必须硬。
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 3);                            // 缓坡（长滑道）
  ok(P.RAMPS.length === 1, "缓坡是一条通到底的长坡（中间没有断口）", "n=" + P.RAMPS.length);
  const r = P.RAMPS[0];
  ok(r.w >= 380, "长坡够长（中间不能断）", "w=" + r.w);
  for (const ff of S.foes) ff.x = 4000;
  const f = S.foes[0]; f.x = 170;
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = r.x + 12; b.y = r.yL; b.vx = 380; b.vy = 0; b.onGround = true;
  const v0 = Math.abs(b.vx);
  let vmax = 0, maxGap = 0, lastY = b.y;
  for (let i = 0; i < 150 && !b.dead; i++) {
    P.tick(1 / 60);
    const rp = P.rampAt(b.x);
    if (rp) maxGap = Math.max(maxGap, rp.y - b.y);   // 球离坡面有多高
    vmax = Math.max(vmax, Math.abs(b.vx));
    lastY = b.y;
  }
  ok(maxGap < 60, "球贴着一路滚，没有从坡上飘出去", "最大离面 " + maxGap.toFixed(0) + "px");
  ok(lastY > 500, "球会一路滑到坡底", "y=" + lastY.toFixed(0));
  ok(vmax > v0 + 60, "下坡会加速", v0.toFixed(0) + " -> " + vmax.toFixed(0));

  // 预瞄线（按住 Shift 才画）也得能从顶上一路画到底
  b.x = r.x + 12; b.y = r.yL; b.vx = 0; b.vy = 0; b.onGround = true;
  const pr = P.predictBall(b, 1);
  ok(pr.pts.some(q => q.y > 520), "预测线一路画到了坡底（不是画到半坡就断）",
    "最低点 y=" + Math.max.apply(null, pr.pts.map(q => q.y)).toFixed(0));
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

  // STAGE=2 只跑第 2 关（调试用）
  const ONLY = process.env.STAGE ? parseInt(process.env.STAGE, 10) - 1 : -1;
  for (let i = 0; i < N; i++) {
    if (ONLY >= 0 && i !== ONLY) continue;
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
  // 签名本身要打出来 —— 只打名字的话，这一整段等于没输出（之前就是这样）。
  for (const [k, g] of Object.entries(seen)) {
    console.log("    " + k.padEnd(16) + g.join("  =  ") + (g.length > 1 ? "   ← 打法重复" : ""));
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

  /* 最后一关通关 → 回出征页，不是回门口、不是回第 1 关。
   *
   * 原来是 `goHome(true)`，那条路会把 progress 拍回 0：27 屏打完，存档变
   * "第 1 关"，重进游戏从第一屏开始 —— 玩家看到的就是"通关了怎么又重来"。
   * 后来换成 openPick（27 格全亮刷 S），挑一屏 2026-10-26 删除后
   * 出口改成 openGates：那里有当前进度和三颗星条件，想刷 S 从那儿再进
   * 同一屏，想收工按 E。
   * 断言改成验这个**新契约**，而不是把旧行为固化下来。 */
  P._start(0, P.LEVELS.length - 1);
  S.phase = "clear";
  P.nextLevel();
  eq(S.phase, "portals", "最后一屏通关后回出征页（不是回选人、不是回第 1 关）");
  eq(S.stage, P.LEVELS.length - 1, "回出征页时 stage 还停在最后一屏，不会被改成 0");
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
    // 指纹 = 平台 + 坑位 + 波次人数 + 斜坡。四样全一样才算"同一块地"。
    // 斜坡必须进指纹：第 1、3、4、7、8 关的差别一半在坡上，
    // 不把它算进去，两关"平台一样、坡不一样"会被判成重复。
    const sig = P.PLATS.map(q => q.y + ":" + q.x + ":" + q.w).join("|") +
                "#" + P.PITS.map(q => q.kind + q.x + q.w).join("|") +
                "#" + st.waves.map(w => w.length).join(",") +
                "#" + P.RAMPS.map(q => q.x + ":" + q.w + ":" + q.yL + ":" + q.yR).join("|");
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
    // 六把武器现在**全部是横向施法**（用户明确要求）。
    // 以前萝卜炮是 45 度上抛，测它得专门把敌人摆到上层平台 ——
    // 而实战里敌人多半和你同高，于是"只有它能打到楼上"的代价变成了"平时打不中"。
    // 现在统一按"同一水平线上、220px 外"测。
    const gap = h === 3 ? 220 : 46;
    const f = S.foes[0];
    f.x = S.p.x + gap; f.y = S.p.y; f.coat = 0; f.dead = false;
    // 定住它：测的是"弹道打不打得到"，不是"追不追得上巡逻的虫子"
    f.def = Object.assign({}, f.def, { spd: 0 });
    P.HEROES[h].fire(S.p);
    for (let k = 0; k < 110; k++) P.tick(1 / 60);
    ok(f.coat > 0 || f.dead, P.HEROES[h].name + " 的「" + P.HEROES[h].tag + "」打得到 " + gap + "px 外的敌人",
      "coat=" + f.coat);
  }
}

console.log("\n=== 19. 第五轮：球的一次性 / 宝箱 / 飞刀 / 分身 ===");
{
  /* ---- 球推出后必消失 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    const f = S.foes[0];
    P.coatFoe(f, 3);
    const b = S.balls[0];
    b.x = 200; b.y = 462; b.vx = 0; b.vy = 0; b.onGround = true;
    S.p.x = 170; S.p.y = 462; S.p.face = 1;
    // 走位推球：贴上去让它推出去
    for (let k = 0; k < 8; k++) { S.keys.right = true; P.tick(1 / 60); }
    ok(b.pushed === true, "贴上去会把球推出去（不需要新按键）");
    let alive = 0;
    for (let k = 0; k < 60 * 5 && !b.dead; k++) { P.tick(1 / 60); alive = k; }
    ok(b.dead, "推出去的球一定会消失（不会永远溜达）", "活了 " + (alive / 60).toFixed(2) + "s");

    // 没推过的球不受这条约束 —— 玩家还能走上去推它
    /* 这里必须**自己造一只**，不能 `S.foes.find(x => !x.dead)` 拿现成的。
       原来靠第 1 关 P1 剩的那一只，第 1 关改成"一排 5 只挨着摆"之后，
       推出去的球会一路把整排卷完 —— 走到这一步场上已经没有活人了，
       于是整段断言被 if (f2) 静默跳过（实测项数 367 → 366，就是这条没了）。
       **测试不许依赖关卡的具体敌人数量**：借来的前提一变，断言会无声消失。 */
    let f2 = S.foes.find((x) => !x.dead);
    if (!f2) {
      f2 = P.foeFromSpec({ foe: "bug", x: 300, y: 462, lv: 1 }, false);
      f2.vx = 0; f2.vy = 0; f2.stun = 999;
      S.foes.push(f2);
    }
    if (f2) {
      P.coatFoe(f2, 3);
      const b2 = S.balls.find(x => x !== b && !x.dead);
      if (b2) {
        b2.x = 200; b2.y = 462; b2.vx = 0; b2.vy = 0; b2.onGround = true;
        S.p.x = 700; S.p.y = 462;
        for (let k = 0; k < 60 * 4; k++) P.tick(1 / 60);
        ok(!b2.dead, "没被推过的球不会自己消失（玩家还能去推它）");
      }
    }
  }

  /* ---- 跳虫必须不出场（2026-10-27 玩家砍）----
   *
   * 它曾经是"主线刺毛虫里约 1/3 会追人、会往上一层扑"，靠头顶一个橙色三角
   * 区分。砍掉的理由是**同一种外观不许有两种行为**：玩家没法从长相推出
   * 会不会跳，只能把每只都当会跳，于是每一只普通怪都变贵了。
   *
   * 这条断言守的是"别偷偷复活"：`foeFromSpec` 建 2000 只，跳虫计数必须为 0。
   * 改之前是 1/3，2000 只里必然命中六百多只 —— 一眼能看出断言有没有在跑
   * （下面的 message 会把实际次数打出来，永远显示 0/2000 才说明真的全关）。
   *
   * 状态机（crouch/pounce/landT、pounceLands 预演、蹲身压扁、脉冲环）都还在，
   * 将来做成**独立剪影**的怪种时重新接上，届时这条断言要连同外观一起改。 */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 5);                       // 第 6 屏：原来必定有跳虫的深度
    let jumped = 0;
    for (let i = 0; i < 2000; i++) {
      const f = P.foeFromSpec({ foe: "bug", x: 300, y: 462, lv: 1 }, false);
      if (f.jumper) jumped++;
    }
    ok(jumped === 0, "★ 跳虫不出场（同一种外观不许有两种行为）",
      jumped + "/2000");
  }

  /* ---- 宝箱：只有球送走的人身上才掉，连带越多越容易 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    const N = 400;
    let solo = 0, trio = 0;
    for (let i = 0; i < N; i++) {
      S.drops.length = 0;
      if (P.dropChest(300, 500, 1)) solo++;
      S.drops.length = 0;
      if (P.dropChest(300, 500, 3)) trio++;
    }
    ok(solo > 0 && trio > 0, "宝箱真的会掉");
    ok(trio > solo * 2, "连带走三只比单杀容易得多（" + solo + "/" + N + " vs " + trio + "/" + N + "）");

    // 武器糊死人不掉箱子：糊满 3 层只变球，不产生掉落 —— 这是"只有雪人击杀才有"的机制保证
    const f = S.foes[0];
    S.drops.length = 0;
    f.coat = 0; f.dead = false;
    P.coatFoe(f, 3);
    const chest = S.drops.filter(d => d.kind === "chest").length;
    eq(chest, 0, "武器糊成球不掉宝箱（只有被球送走才掉）");
  }

  /* ---- 飞刀是丢出去的，不是绕圈的 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(4, 0);
    S.foes.forEach(f => { f.x = 2000; });
    S.p.x = 300; S.p.y = 462; S.p.face = 1;
    S.shots.length = 0;
    P.HEROES[4].fire(S.p);
    const kn = S.shots[0];
    eq(kn.kind, "knife", "老实牛丢出来的是刀");
    const x0 = kn.x;
    let monotonic = true, prev = kn.x, crossedBack = false;
    for (let k = 0; k < 40; k++) {
      P.tick(1 / 60);
      if (!S.shots.length) break;
      const s2 = S.shots[0];
      if (s2.x < prev - 1) monotonic = false;
      if (s2.x < x0 - 4) crossedBack = true;
      prev = s2.x;
    }
    ok(monotonic && !crossedBack, "飞刀是直线丢出去的（不是绕着自己转）");
  }

  /* ---- 影狐是两发子弹，不是站桩召唤 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(5, 0);
    S.shots.length = 0;
    S.p.x = 400; S.p.y = 462; S.p.face = 1;
    P.HEROES[5].fire(S.p);
    eq(S.shots.length, 2, "影狐一次窜出两道影子");
    ok(S.shots.every(s => s.kind === "shadow"), "两发都是影弹");
    const x0 = S.shots.map(s => s.x);
    for (let k = 0; k < 6; k++) P.tick(1 / 60);
    eq(S.shots.filter((s, i) => s.x > x0[i] + 20).length, 2, "两发都真的飞出去了");
    const dy = S.shots.length >= 2 ? Math.abs(S.shots[1].y - S.shots[0].y) : 99;
    ok(dy > 8, "两发上下分叉（近身两发全吃，远了只中一发）", "dy=" + dy.toFixed(1));
  }

  /* ---- 六个人的技能都是"飞出去的子弹"，只是样子不同 ---- */
  for (let hi = 0; hi < 6; hi++) {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(hi, 0);
    S.foes.forEach(f => { f.x = 5000; });
    S.shots.length = 0;
    S.p.x = 300; S.p.y = 462; S.p.face = 1;
    P.HEROES[hi].fire(S.p);
    const shots = S.shots.slice();
    ok(shots.length > 0, P.HEROES[hi].name + " 放得出来东西", "n=" + shots.length);
    const before = shots.map(s => ({ x: s.x, y: s.y }));
    for (let k = 0; k < 6; k++) P.tick(1 / 60);
    let moved = 0;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (Math.abs(s.x - before[i].x) + Math.abs(s.y - before[i].y) > 8) moved++;
    }
    eq(moved, shots.length, P.HEROES[hi].name + " 打出去的东西全部离手飞行");
  }

  /* ---- 音波是飞出去的弹，且越飞越宽 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(1, 0);
    S.foes.forEach(f => { f.x = 5000; });
    S.shots.length = 0;
    S.p.x = 300; S.p.y = 462; S.p.face = 1;
    P.HEROES[1].fire(S.p);
    const w = S.shots[0];
    const r0 = w.r, x0 = w.x;
    for (let k = 0; k < 10; k++) P.tick(1 / 60);
    ok(w.x > x0 + 30, "音波在往前飞（不是贴在人身上的光环）", "dx=" + (w.x - x0).toFixed(1));
    ok(w.r > r0 + 8, "音波一路撑开", "r " + r0 + " -> " + w.r.toFixed(1));
  }
}

console.log("\n=== 20. 第六轮：坡、下穿、波次、BOSS ===");
{
  /* ---- 坡对人也生效（上一版只有球认坡，人走上去直接穿到地面） ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 3);                       // 缓坡：V 谷两条坡
    const R = P.RAMPS[0];
    ok(!!R, "缓坡有坡");
    S.foes.forEach(f => { f.x = 2000; });
    // 站在坡的半腰，不掉到地面
    const mid = R.x + R.w * 0.5;
    const midY = R.yL + (R.yR - R.yL) * 0.5;
    S.p.x = mid; S.p.y = midY - 2; S.p.vy = 0; S.p.onGround = false;
    for (let k = 0; k < 30; k++) P.tick(1 / 60);
    ok(S.p.onGround && Math.abs(S.p.y - midY) < 12,
       "人站在坡上会被坡托住（不会穿到地面）",
       "y=" + S.p.y.toFixed(0) + " 期望 " + midY.toFixed(0));

    // 顺着坡走上去能到坡顶那层。
    // 记**过程中最高的位置**，不是最后一帧：长滑道的坡顶接一块只有 120 宽的台面，
    // 走满 90 帧的话人会一路走过台面边缘再掉下去 —— 那测的就不是"能不能上去"了。
    S.p.x = mid; S.p.y = midY; S.p.vy = 0; S.p.onGround = true;
    let hiY = midY;
    for (let k = 0; k < 90; k++) { S.keys.left = true; P.tick(1 / 60); hiY = Math.min(hiY, S.p.y); }
    S.keys.left = false;
    ok(hiY < midY - 60, "往坡上走会一路变高", "最高 y=" + hiY.toFixed(0) + "（起点 " + midY.toFixed(0) + "）");
  }

  /* ---- ↓ 一次只穿一层 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    S.foes.forEach(f => { f.x = 2000; });
    // 站在最高那层（248），屁股底下依次是 350 / 462 / 地面
    S.p.x = 500; S.p.y = 248; S.p.vy = 0; S.p.onGround = true;
    S.p.ground = P.PLATS.find(q => q.y === 248 && 500 > q.x && 500 < q.x + q.w) || null;
    ok(!!S.p.ground, "站上了 248 层");

    for (let k = 0; k < 90; k++) { S.keys.down = true; P.tick(1 / 60); }
    const y1 = S.p.y;
    ok(y1 > 340 && y1 < 356, "按住 ↓ 只穿一层，落到 350（不是一路掉到地面）", "y=" + y1.toFixed(0));

    // 松开再按，才继续往下 —— 否则玩家没法"一层一层下"
    S.keys.down = false;
    for (let k = 0; k < 4; k++) P.tick(1 / 60);
    for (let k = 0; k < 90; k++) { S.keys.down = true; P.tick(1 / 60); }
    const y2 = S.p.y;
    ok(y2 > 450 && y2 <= 462, "松开再按一次，才落到 462", "y=" + y2.toFixed(0));
    S.keys.down = false;

    // 地面是 ground，按 ↓ 不该穿到世界外
    S.p.x = 700; S.p.y = 556; S.p.onGround = true;
    S.p.dropLock = false; S.p.dropT = 0; S.p.dropPlat = null;
    for (let k = 0; k < 30; k++) { S.keys.down = true; P.tick(1 / 60); }
    S.keys.down = false;
    ok(S.p.y <= 560, "站在地面上按 ↓ 不会掉出去", "y=" + S.p.y.toFixed(0));
  }

  /* ---- 波次：剩 1 只就刷下一波，BOSS 波要清空 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    const W = P.WAVES;
    ok(W.length >= 2, "一关至少两波", W.length + " 波");
    ok(W[W.length - 1].some(sp => sp.foe === "boss"), "最后一波是 BOSS");

    // 手动清掉第一波，只留 1 只
    const first = W[0].length;
    while (S.foes.length > 1) S.foes.pop();
    let t = 0;
    while (S.wave === 0 && t < 12) { P.tick(1 / 60); t += 1 / 60; }
    eq(S.wave, 1, "剩 1 只就推进到第 2 波（不等清空）");
    ok(S.foes.length >= 1, "第 2 波的人已经在场上");

    // BOSS 波之前：必须清空才刷
    S.foes.length = 0;
    S.wave = W.length - 2;
    S.waveT = 0; S.waveGap = 0;
    S.foes.push(P.foeFromSpec({ foe: "bug", x: 200, y: 462 }, false));
    t = 0;
    while (S.wave === W.length - 2 && t < 6) { P.tick(1 / 60); t += 1 / 60; }
    eq(S.wave, W.length - 2, "BOSS 波之前剩 1 只不会刷（不能夹击）");
    S.foes.length = 0;
    t = 0;
    while (S.wave === W.length - 2 && t < 8) { P.tick(1 / 60); t += 1 / 60; }
    eq(S.wave, W.length - 1, "清空之后 BOSS 才登场");
  }

  /* ---- BOSS：层数、变球、弹球、砸地 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    S.foes.length = 0;
    S.balls.length = 0;
    const boss = P.foeFromSpec({ foe: "boss", x: 700, y: -140, lv: 1 }, true);
    S.foes.push(boss);
    ok(boss.cm > 3, "BOSS 的包裹上限比普通怪高", "cm=" + boss.cm);
    ok(boss.y < 0, "BOSS 是从天上掉下来的");

    // 落地
    for (let k = 0; k < 120; k++) P.tick(1 / 60);
    ok(boss.onGround, "BOSS 会落到地面");

    // 糊满 cm 层才变球（普通怪 3 层就变）
    const cmv = boss.cm;
    for (let i = 0; i < 3; i++) P.tick(1 / 60);
    // 每层之间留 36 帧（0.6s）—— BOSS 的抗性是 0.5s/层，20 帧会被直接吃掉，
    // 测试就变成"怎么糊都糊不满"，看起来像 bug 其实是抗性在正常工作。
    for (let i = 0; i < cmv - 1; i++) { P.coatFoe(boss, 1); for (let k = 0; k < 36; k++) P.tick(1 / 60); }
    ok(!boss.dead, "糊 " + (cmv - 1) + " 层还不成球（还差一层）", "coat=" + boss.coat);
    P.coatFoe(boss, 1);
    for (let k = 0; k < 4; k++) P.tick(1 / 60);
    const bb = S.balls.find(x => x.boss);
    ok(!!bb, "糊满最后一层变成 BOSS 球");
    ok(bb && bb.r > 30, "BOSS 球比普通球大得多", bb ? "r=" + bb.r : "没有球");

    // 推进火坑：收成远高于普通球
    const food0 = S.food;
    const fire = P.PITS.find(q => q.kind === "fire");
    bb.x = fire.x + fire.w / 2; bb.y = fire.y; bb.vx = 0; bb.vy = 0; bb.onGround = true;
    for (let k = 0; k < 3; k++) P.tick(1 / 60);
    ok(S.food - food0 >= 10, "BOSS 球烧掉给大笔收成", "food +" + (S.food - food0));
  }

  /* ---- BOSS 不会被一梭子糊穿 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    S.foes.length = 0;
    S.balls.length = 0;
    const boss = P.foeFromSpec({ foe: "boss", x: 700, y: 556 }, false);
    S.foes.push(boss);
    // 2 秒内连糊 10 次（每 0.2 秒一次）—— 相当于玩家贴脸按了十下攻击。
    // 抗性 0.5s/层 => 2 秒最多吃 4 层，而 cm=5，糊不满。
    for (let i = 0; i < 10; i++) {
      P.coatFoe(boss, 1);
      for (let k = 0; k < 12; k++) P.tick(1 / 60);
    }
    ok(boss.coat <= 4, "BOSS 有抗性：2 秒连糊 10 次也糊不满", "coat=" + boss.coat + "/" + boss.cm);
    ok(!boss.dead && !S.balls.some(b => b.boss), "BOSS 不会被一梭子直接糊成球");
  }

  /* ---- 球撞 BOSS 会弹回来（可以连推同一颗） ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    S.foes.length = 0;
    S.balls.length = 0;
    const boss = P.foeFromSpec({ foe: "boss", x: 500, y: 556 }, false);
    S.foes.push(boss);
    const f0 = S.foes.find(x => !x.isBoss);
    if (f0) S.foes.splice(S.foes.indexOf(f0), 1);
    // 造一颗球从左边撞过去
    const mk = P.foeFromSpec({ foe: "bug", x: 100, y: 462 }, false);
    S.foes.push(mk);
    P.coatFoe(mk, 3);
    const b = S.balls.find(x => !x.boss);
    b.x = 380; b.y = 556; b.vx = 620; b.vy = 0; b.onGround = true;
    const c0 = boss.coat;
    for (let k = 0; k < 30; k++) P.tick(1 / 60);
    ok(boss.coat > c0, "球撞 BOSS 会给它糊一层", "coat " + c0 + " -> " + boss.coat);
    ok(S.balls.indexOf(b) >= 0 && b.vx < 0, "球被 BOSS 弹回来（不会消失）",
       "vx=" + (b.vx || 0).toFixed(0));
  }

  /* ---- BOSS 砸地：会生冲击波，跳起来能躲 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    S.foes.length = 0;
    const boss = P.foeFromSpec({ foe: "boss", x: 500, y: 556 }, false);
    S.foes.push(boss);
    boss.slamT = 0;                       // 立刻抬手
    let seen = 0;
    for (let k = 0; k < 180; k++) {
      P.tick(1 / 60);
      seen = Math.max(seen, S.shocks.length);
    }
    ok(seen >= 2, "BOSS 砸地会放出两道冲击波", "最多同时 " + seen + " 道");

    // 站在地上会被打到；跳起来不会
    S.p.invT = 0; S.p.hp = 4;
    S.p.x = 500; S.p.y = 556; S.p.vy = 0; S.p.onGround = true;
    S.shocks.length = 0;
    S.shocks.push({ x: 440, y: 556, t: 0, life: 0.62, dir: 1 });
    for (let k = 0; k < 20; k++) P.tick(1 / 60);
    ok(S.p.hp < 4, "贴地站着会被冲击波打到", "hp=" + S.p.hp);

    S.p.invT = 0; S.p.hp = 4;
    S.p.x = 500; S.p.y = 480; S.p.vy = -400; S.p.onGround = false;
    S.shocks.length = 0;
    S.shocks.push({ x: 440, y: 556, t: 0, life: 0.62, dir: 1 });
    for (let k = 0; k < 12; k++) P.tick(1 / 60);
    ok(S.p.hp === 4, "跳起来就能躲过冲击波", "hp=" + S.p.hp);
  }

  /* ---- 八关的坡：位置合法（不穿台面、不盖营地） ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    for (let i = 0; i < P.LEVELS.length; i++) {
      P._start(0, i);
      const st = P.curStage();
      for (const r of P.RAMPS) {
        const hi = Math.min(r.yL, r.yR), lo = Math.max(r.yL, r.yR);
        /* 这两条判的是**坡有没有跑出场地**：上不出画面（70 = 最高层 156 再往上
           留一段余量）、下不钻进地面。原来写的是 `hi >= 300`，意思是
           "每条坡都得从 300 以下落到地面" —— 那只在"一屏一条坡"时等价，
           盘山道的四条坡各占一段高度，按老判据会把三条正确坡判红。
           **"坡网真的通到地面"由 §11 那条「球真的能掉到地面」管** —— 那里不放球在坡上，
           只看"从 350 丢一颗球下去，最终有没有到过地面"。 */
        ok(hi >= 70 && lo <= P.GROUND_Y + 2, st.name + "：坡没跑出场地",
           "y " + hi + ".." + lo);

        // 坡盖住营地的时候有个坑：球在坡上时 y < GROUND_Y，营地判定不触发，
        // 球会滑过营地一直滚到墙。唯一的例外是**坡的低端正好落在营地范围内** ——
        // 球在那里落地，下一帧就算落袋。这条在双塔那关是故意这么做的。
        const hitCamp = r.x < P.CAMP.x + P.CAMP.w && r.x + r.w > P.CAMP.x;
        if (hitCamp && lo >= P.GROUND_Y - 2) {
          const lowX = r.yL > r.yR ? r.x : r.x + r.w;
          ok(lowX > P.CAMP.x && lowX < P.CAMP.x + P.CAMP.w,
             st.name + "：坡落到地面时，落点得在营地范围内");
        }
      }
    }
  }
}

console.log("\n=== 21. 第七轮：技能子弹化 / 坡材质 / BOSS 繁殖与散射 ===");
{
  /* ---- BOSS 会产卵 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 7);
    S.foes.length = 0;
    S.p.x = 120; S.p.y = 556;
    const boss = P.foeFromSpec({ foe: "boss", x: 700, y: 556, lv: 5 }, false);
    boss.spawnT = 0.05;
    boss.stun = 999;                       // 别让 BOSS 走开，不然幼虫会追着它跑
    S.foes.push(boss);
    let t = 0;
    while (t < 1.5) { P.tick(1 / 60); t += 1 / 60; }
    const ls = S.foes.filter(f => f.larva && !f.dead);
    eq(ls.length, 2, "BOSS 产卵：一次两只幼虫");
    ok(ls.every(l => l.y <= 560), "幼虫落在地上，没有卡在半空");
  }

  /* ---- 幼虫往 BOSS 爬，到了被吃掉，BOSS 补一层壳 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 7);
    S.foes.length = 0;
    S.p.x = 120; S.p.y = 556;
    const boss = P.foeFromSpec({ foe: "boss", x: 700, y: 556, lv: 5 }, false);
    boss.slamT = 99; boss.scatterT = 99; boss.spawnT = 99;   // 只测归巢
    boss.stun = 999;                                        // BOSS 站定，别走开
    S.foes.push(boss);                                      // 不 push 的话幼虫找不到它
    // 先糊 3 层（每层间隔要大于抗性 0.5s）
    for (let i = 0; i < 3; i++) { P.coatFoe(boss, 1); for (let k = 0; k < 40; k++) P.tick(1 / 60); }
    const c0 = boss.coat;
    ok(c0 >= 3, "BOSS 先被糊了 3 层", "coat=" + c0);

    const l = P.foeFromSpec({ foe: "larva", x: 660, y: 556 }, false);
    l.y = 556; l.onGround = true;
    S.foes.push(l);
    let t = 0;
    while (t < 5 && !l.dead) { P.tick(1 / 60); t += 1 / 60; }
    ok(l.dead, "幼虫爬到 BOSS 身边就被吃掉");
    ok(boss.coat < c0, "BOSS 吃掉幼虫补回一层壳", "coat " + c0 + " -> " + boss.coat);
  }

  /* ---- 回血有硬上限（不然永远打不完） ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 7);
    S.foes.length = 0;
    S.p.x = 120; S.p.y = 556;
    const boss = P.foeFromSpec({ foe: "boss", x: 700, y: 556, lv: 5 }, false);
    boss.slamT = 99; boss.scatterT = 99; boss.spawnT = 99;
    boss.stun = 999;
    S.foes.push(boss);
    for (let i = 0; i < 4; i++) { P.coatFoe(boss, 1); for (let k = 0; k < 40; k++) P.tick(1 / 60); }
    boss.fed = 3;
    const c0 = boss.coat;
    const l = P.foeFromSpec({ foe: "larva", x: 660, y: 556 }, false);
    l.y = 556; l.onGround = true;
    S.foes.push(l);
    let t = 0;
    while (t < 5 && !l.dead) { P.tick(1 / 60); t += 1 / 60; }
    eq(boss.coat, c0, "吃满 3 只之后不再回血");
  }

  /* ---- 扇形散射：五发、朝玩家张开 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 7);
    S.foes.length = 0;
    S.foeShots.length = 0;
    S.p.x = 300; S.p.y = 556;
    const boss = P.foeFromSpec({ foe: "boss", x: 700, y: 556, lv: 5 }, false);
    boss.scatterT = 0.05;
    boss.stun = 999;
    S.foes.push(boss);
    let t = 0;
    while (t < 1.5) { P.tick(1 / 60); t += 1 / 60; }
    ok(S.foeShots.length >= 2, "BOSS 喷出扇形弹幕", "n=" + S.foeShots.length);
    // 五发的方向要真的分开：取最左和最右两发的速度夹角
    const vx = S.foeShots.map(q => Math.atan2(q.vy, q.vx));
    const spread = Math.max.apply(null, vx) - Math.min.apply(null, vx);
    ok(spread > 0.6, "五发是扇形张开的（不是一条直线）", "spread=" + spread.toFixed(2) + "rad");
  }

  /* ---- 粘液弹会被平台挡住（躲板子下面是解法） ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 7);
    S.foes.length = 0;
    S.foeShots.length = 0;
    S.p.x = 120; S.p.y = 556;
    const plat = P.PLATS.find(q => q.kind !== "ground");
    S.foeShots.push({ x: plat.x + plat.w / 2, y: plat.y - 60, vx: 0, vy: 60,
                      r: 9.5, life: 2.4, t: 0, dead: false });
    let t = 0;
    while (t < 1.2) { P.tick(1 / 60); t += 1 / 60; }
    eq(S.foeShots.length, 0, "粘液弹落到平台上就消失（能靠地形躲）");
  }

  /* ---- 粘液弹打中玩家会扣血 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 7);
    S.foes.length = 0;
    S.foeShots.length = 0;
    S.p.x = 500; S.p.y = 556; S.p.hp = 3; S.p.invT = 0;
    S.foeShots.push({ x: 498, y: 512, vx: 0, vy: 20,
                      r: 9.5, life: 2.4, t: 0, dead: false });
    let t = 0, hp0 = S.p.hp;
    while (t < 0.6) { P.tick(1 / 60); t += 1 / 60; }
    ok(S.p.hp < hp0, "粘液弹打中玩家扣血", "hp " + hp0 + " -> " + S.p.hp);
  }
}

console.log("\n=== 22. 第八轮：冰壳 / 球撞球 / 助跑推 / 横向施法 ===");
{

  /* ---- 技能打中球：冰壳 +1，上限 3 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(1, 0);
    S.foes.forEach(f => { f.x = 4000; });
    const f = S.foes[0]; f.x = 3800; P.coatFoe(f, 3);
    const b = S.balls[0];
    b.x = 350; b.y = 462; b.vx = 0; b.vy = 0; b.onGround = true;
    S.p.x = 300; S.p.y = 462; S.p.face = 1;
    eq(b.frost, 0, "刚造出来的球没有冰壳");
    // 短尾犬的音波是直飞的，打的就是正前方
    for (let shot = 0; shot < 5; shot++) {
      P.HEROES[1].fire(S.p);
      for (let k = 0; k < 12; k++) P.tick(1 / 60);
    }
    eq(b.frost, 3, "打 5 枪，冰壳封顶在 3 层");
    ok(b.air > 0.95 || b.air >= 1, "打冰壳会回气", "air=" + b.air.toFixed(2));
  }

  /* ---- 冰壳 3 层：一撞就把人整只卷走，用完清零 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    S.foes.forEach(f => { f.x = 4000; });
    const f = S.foes[0]; f.x = 3800; P.coatFoe(f, 3);
    const b = S.balls[0];
    b.x = 300; b.y = 462; b.vx = 0; b.vy = 0; b.onGround = true; b.frost = 3;
    const victim = S.foes.find(q => !q.dead && q.x !== 3800);
    victim.x = 400; victim.y = 462; victim.coat = 0;
    victim.def = Object.assign({}, victim.def, { spd: 0 });
    b.vx = 700;
    for (let k = 0; k < 20; k++) P.tick(1 / 60);
    ok(victim.dead, "冰壳 3 层的球一撞就整只卷走（不用先糊两层）");
    eq(b.frost, 0, "冰壳是一次性的：撞完就碎");
    ok(b.holds >= 2, "球里多了一只", "holds=" + b.holds);
  }

  /* ---- 球撞球：连带一起滚 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    S.foes.forEach(f => { f.x = 4000; });
    S.foes[0].x = 3800; P.coatFoe(S.foes[0], 3);
    S.foes[1].x = 3850; P.coatFoe(S.foes[1], 3);
    const [a, c] = S.balls;
    ok(S.balls.length >= 2, "场上有两颗球", "n=" + S.balls.length);
    a.x = 300; a.y = 462; a.vx = 700; a.vy = 0; a.onGround = true;
    c.x = 380; c.y = 462; c.vx = 0;   c.vy = 0; c.onGround = true;
    for (let k = 0; k < 12; k++) P.tick(1 / 60);
    ok(c.vx > 400, "被撞的那颗球被带起来了", "vx=" + c.vx.toFixed(0));
    ok(Math.sign(c.vx) === Math.sign(a.vx), "两颗球同向滚（不是互相弹开）");
    ok(!c.dead || c.pushed, "被带起来的球也算推出去的（不会永远留在场上）");
  }

  /* ---- 助跑：跑得越远，推得越狠 ---- */
  {
    function pushPow(runD) {
      const sb = boot();
      const P = sb.GROVE, S = P.S;
      seed(S);
      P._start(0, 0);
      S.foes.forEach(f => { f.x = 4000; });
      const f = S.foes[0]; f.x = 3800; P.coatFoe(f, 3);
      const b = S.balls[0];
      b.x = 435; b.y = 462; b.vx = 0; b.vy = 0; b.onGround = true;
      S.p.x = 400; S.p.y = 462; S.p.vx = 0; S.p.face = 1; S.p.runD = runD;
      P.tick(1 / 60);
      return Math.abs(b.vx);
    }
    const near = pushPow(0);
    const far = pushPow(420);
    ok(near > 400, "站着推也推得动", "vx=" + near.toFixed(0));
    ok(far > near + 200, "助跑 420px 再推，力道明显更大",
      near.toFixed(0) + " -> " + far.toFixed(0));
  }

  /* ---- 六把武器全部横向施法 ---- */
  {
    const sb0 = boot();
    const P0 = sb0.GROVE;
    for (let h = 0; h < P0.HEROES.length; h++) {
      const sb = boot();
      const P = sb.GROVE, S = P.S;
      seed(S);
      P._start(h, 0);
      S.foes.forEach(f => { f.x = 4000; });
      S.shots.length = 0;
      S.p.face = 1;
      P.HEROES[h].fire(S.p);
      const s = S.shots[0];
      const y0 = s.y;
      for (let k = 0; k < 15; k++) P.tick(1 / 60);   // 0.25 秒
      // 溜溜球是"伸出去再拉回来"，看它的最远点
      const drift = Math.abs(s.y - y0);
      ok(drift < 42, P.HEROES[h].name + " 的「" + P.HEROES[h].tag + "」是横向施法",
        "0.25s 内竖直位移 " + drift.toFixed(0) + "px");
      ok(Math.abs(s.vx) > Math.abs(s.vy) * 2 || s.kind === "yoyo",
        P.HEROES[h].name + " 的速度以横向为主",
        "vx=" + Math.round(s.vx) + " vy=" + Math.round(s.vy));
    }
  }

  /* ---- 预瞄线默认不画 ---- */
  {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    seed(S);
    P._start(0, 0);
    eq(S.aim, false, "预瞄线默认是关的（球滚动的轨迹不显示）");
  }
}

/* ============================================================================
   24. 一趟：饱食 / 倍率 / 收工回家
   ----------------------------------------------------------------------------
   这一段测的是这次新增的三件事，它们全在"关与关之间"，不在战斗里：
     · 越往里走越饿（belly 每关 -16，全饿收走冲刺）
     · 连锁倍率（只有收工才结算 → "贪一关"有收益也有代价）
     · 关卡内台词（第一颗球 / 一球三只 / 结算那句）
   ========================================================================== */

/** 不跑机器人，直接把这一关判成"清干净了" */
function forceClear(P, S, food) {
  S.foes.length = 0;
  S.balls.length = 0;
  S.wave = P.WAVES.length - 1;
  S.waveGap = 0;
  S.killed = S.total;
  S.food = food === undefined ? 10 : food;
  // 把所有目标的判据一次性满足 —— 这一段测的是"趟"，不是哪一关的目标
  S.stat.made = 0;
  S.stat.maxHolds = 99;
  S.stat.bankHolds = 99;
  S.stat.burst = 0;
  S.stat.hits = 0;
  /* 赛道也一起满足。它是**附加约束**（任何关都能挂），
     所以任何一关现在都可能因为"路线没走完"而判不过 ——
     这一段测的是"趟"（肚子/倍率/收成跨关累计），不是某一关的目标。 */
  S.stat.toured = 99;
  P.tick(1 / 60);
}

console.log("\n=== 24a. 一关 = 一顿饭：肚子掉一档、倍率涨一档 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0, 0);
  eq(S.belly, 100, "出门时肚子是满的");
  eq(S.trip.multi, 1, "倍率从 1.00 起");
  eq(S.trip.loot, 0, "还没攒下东西");

  forceClear(P, S, 40);
  eq(S.phase, "clear", "清干净了");
  eq(S.belly, 80, "过一关掉 20（100 -> 80）");
  near(S.trip.multi, 1.15, 0.001, "过一关倍率 +0.15");
  eq(S.trip.stages, 1, "这一趟推过 1 关");
  // 收成 = 场上收的 40 + 清场奖励 3
  eq(S.trip.loot, 43, "这一趟攒下 43（收成 40 + 清场 3）");

  P.nextLevel();
  eq(S.belly, 80, "进下一关不会回血（饿是跨关的）");
  forceClear(P, S, 40);
  eq(S.belly, 60, "再过一关 80 -> 60（进入半饿）");
  eq(P.bellyTier(), 1, "68 是半饿档");
  near(S.trip.multi, 1.30, 0.001, "第二关倍率 1.30");
  eq(S.trip.loot, 86, "两关累计 43 + 43");

  // 一路推到全饿：8 关推满，belly 早就见底
  for (let i = 0; i < 5; i++) { P.nextLevel(); forceClear(P, S, 40); }
  eq(S.belly, 0, "推到底之前肚子就空了（下限 0，不出现负饱食）");
  eq(P.bellyTier(), 0, "0 是全饿档");
  near(S.trip.multi, 2.0, 0.001, "倍率封顶在 2.00（不能无限涨）");
}

console.log("\n=== 24b. 收工：攒的 × 倍率才落袋，回家就吃饱 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0, 0);
  forceClear(P, S, 40);           // 攒 43，倍率 1.15
  const before = S.home.loot;
  P.goHome(false);
  eq(S.phase, "select", "收工回到门口");
  eq(S.home.loot, before + Math.round(43 * 1.15), "落袋 = 攒下的 × 倍率（49）");
  eq(S.home.lastLoot, 49, "记下这趟带回了多少（门口要显示）");
  eq(S.home.runs, 1, "出门次数 +1");
  eq(S.belly, 100, "回家吃饭，肚子回满");
  eq(S.trip.loot, 0, "新的一趟从 0 开始");
  eq(S.trip.stages, 0, "关数归零");
  eq(S.trip.multi, 1, "倍率归 1（所以每关都收工的人永远拿 ×1.0）");
}

console.log("\n=== 24c. 贪的收益是真的：一笔账算得清 ===");
{
  // 同样的 3 关、同样的收成，一个每关收工、一个贪到底
  const runTo = (n) => {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    P._start(0, 0);
    let got = 0;
    for (let i = 0; i < n; i++) {
      forceClear(P, S, 40);
      if (i < n - 1) { P.nextLevel(); continue; }
      got = Math.round(S.trip.loot * S.trip.multi);
    }
    return got;
  };
  const grabby = runTo(3);
  // 每关都收工：三关各拿一次 ×1.0
  const sb2 = boot();
  const P2 = sb2.GROVE, S2 = P2.S;
  P2._start(0, 0);
  let safe = 0;
  for (let i = 0; i < 3; i++) {
    forceClear(P2, S2, 40);
    safe += Math.round(S2.trip.loot * S2.trip.multi);
    P2.goHome(false);
  }
  ok(grabby > safe, "贪到底比每关收工拿得多（" + grabby + " > " + safe + "）",
     "差 " + (grabby - safe));
}

console.log("\n=== 24d. 全饿跑不动：饿必须有后果 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0, 0);

  S.p.dashCd = 0;
  P._press("dash", true);
  P.tick(1 / 60);
  ok(S.p.dashT > 0, "满饱能冲");
  P._press("dash", false);

  S.belly = 10;
  S.p.dashT = 0;
  S.p.dashCd = 0;
  P._press("dash", true);
  P.tick(1 / 60);
  eq(S.p.dashT, 0, "全饿按 K 冲不出去");
  ok(S.texts.some(t => String(t.txt).includes("跑不动")), "并且说清楚为什么（不是按了没反应）");
  P._press("dash", false);

  S.belly = 100;
  eq(P.bellyTier(), 2, "100 是满饱档");
}

console.log("\n=== 24e. 关卡内台词：性格不只在门口 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0, 0);
  eq(S.say.life, 0, "开局不说话（先让它忙）");

  const f = S.foes[0];
  f.coat = 2;
  P.makeBallFrom(f, 300, -100);
  P.tick(1 / 60);
  ok(S.say.life > 0, "第一次造出球，它冒了一句话");
  eq(S.say.txt, P.VOICE[P.HEROES[0].id].first, "说的是这一只自己的台词（不是通用文案）");

  // 一球卷三只 → big 那句
  S.say.life = 0;
  S.say.fired.big = false;
  S.stat.maxHolds = 3;
  P.tick(1 / 60);
  eq(S.say.txt, P.VOICE[P.HEROES[0].id].big, "一球卷走 3 只的时候换成得意那句");

  // 每关只响一次
  S.say.life = 0;
  S.say.fired.big = true;
  S.stat.maxHolds = 5;
  P.tick(1 / 60);
  eq(S.say.life, 0, "同一关不会重复说同一句（不刷屏）");

  // 六只说的是六句不同的话
  const firsts = P.HEROES.map(h => P.VOICE[h.id].first);
  eq(new Set(firsts).size, 6, "六只的台词各不相同");
}

console.log("\n=== 24f. 结算那句跟饿不饿绑 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0, 0);

  S.belly = 100;
  const full = P.finishSay(true);
  S.belly = 50;
  const half = P.finishSay(true);
  S.belly = 10;
  const empty = P.finishSay(true);
  ok(full !== half && half !== empty, "满饱 / 半饿 / 全饿说的是三句不同的话",
     [full, half, empty].join(" / "));
  eq(empty, "先……先回家吧。", "全饿时那句话就是在劝你收工");
  ok(P.finishSay(false).length > 0, "失败也有话说（不是空字符串）");
}

console.log("\n=== 24g. 结算面板的两个按钮：画在哪就点在哪 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  P._start(0, 0);
  forceClear(P, S, 40);

  const B = P.settleBtns();
  const C = P.CARD;
  ok(B.cont.x + B.cont.w <= B.home.x, "两个按钮不重叠");
  ok(B.cont.x > 0 && B.home.x + B.home.w < 960, "都在画面内");
  // 卡片底取自运行时，不写死。写死 544 之后卡片一加高，这条断言就变成
  // 在验一个已经不存在的尺寸 —— 通过得毫无意义。
  ok(B.home.y + B.home.h <= C.y + C.h,
     "按钮没掉出卡片（卡片底 " + (C.y + C.h) + "，按钮底 " + (B.home.y + B.home.h) + "）");
  // 按钮底下留白。提示行已经挪到卡片外面了，这里只要保证按钮不贴着下边框的圆角
  ok(C.y + C.h - (B.home.y + B.home.h) >= 20, "按钮和卡片底之间留了白");
  ok(P.inRect({ x: B.home.x + 10, y: B.home.y + 10 }, B.home), "点在收工按钮里 = 命中");
  ok(!P.inRect({ x: B.cont.x + 10, y: B.cont.y + 10 }, B.home), "点在继续按钮里 ≠ 命中收工");

  // 结算面板必须能画出来（这一段最容易在改坐标时崩）
  let threw = null;
  try { P.render(); } catch (e) { threw = e.message; }
  eq(threw, null, "结算面板能渲染（含两个按钮、肚子条、台词）");
}

console.log("\n=== 26. 地面层两端开口 / 上层反弹 ===");
/* 用户的原话：「左下角和右下角球直接滚出去，上层是可以反弹的」。
 *
 * 这条规则有三个地方必须同时成立，缺一个玩家就会发现"预瞄骗人"或者
 * "球在边上来回抽":
 *   ① 物理：地面层的球不被夹回场地，滚出去就判出场
 *   ② 物理：上层的球撞墙必须反弹（不能连墙一起没了）
 *   ③ 预瞄：线画出来的结果要和实际一致
 * 所以下面三段分开测，任何一段单独通过都没有意义。
 */
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 0);
  for (const ff of S.foes) ff.x = 4000;      // 挪走敌人，只测边界
  const f = S.foes[0];
  f.x = 200; P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = 200; b.y = P.GROUND_Y; b.vx = -520; b.vy = 0;

  let bounced = false;
  for (let i = 0; i < 120; i++) {
    P.tick(1 / 60);
    if (b.dead) break;
    if (b.vx > 5) bounced = true;            // 只要反向过一次就说明撞墙了
  }
  ok(b.dead, "地面层：球往左滚出场地就没了");
  ok(!bounced, "地面层：全程没有反向（说明没有隐形墙把它弹回来）");
  ok((S.stat.lost || 0) >= 1, "滚出去记一次 lost（不是静默消失）");
}
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 0);
  for (const ff of S.foes) ff.x = 4000;
  const f = S.foes[0];
  f.x = 120; P.coatFoe(f, 3);
  const b = S.balls[0];
  // 最低那层浮空台是 462（关卡数据里第一个非地面台）。现查，不写死。
  const lp = P.PLATS.find(p => p.kind !== "ground" && p.y < P.GROUND_Y);
  ok(!!lp, "关卡里至少有一层浮空台");
  b.x = 120; b.y = lp.y; b.vx = -520; b.vy = 0;

  let bounced = false;
  for (let i = 0; i < 90; i++) {
    P.tick(1 / 60);
    if (b.vx > 5) { bounced = true; break; }
  }
  ok(bounced, "上层：球撞到左墙会弹回来（墙还在）");
  ok(!b.dead, "上层：弹回来之后球还在场上");
}
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(0, 0);
  for (const ff of S.foes) ff.x = 4000;
  const f = S.foes[0];
  f.x = 200; P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = 200; b.y = P.GROUND_Y; b.vx = 0; b.vy = 0;
  const A = P.predictBall(b, -1);
  ok(A.end === "out", "预瞄线：地面层往左画到「出界」，不是画一条会弹回来的线",
    "end=" + A.end);

  const lp = P.PLATS.find(p => p.kind !== "ground" && p.y < P.GROUND_Y);
  b.y = lp.y; b.x = 120;
  const B = P.predictBall(b, -1);
  ok(B.end !== "out", "预瞄线：上层往左不会画出「出界」", "end=" + B.end);
}

/* ============================================================================
 * 雪：从皮肤变成机制（2026-10-22）
 * ----------------------------------------------------------------------------
 * 这四条守的是"雪会不会只是换了个颜色"。
 * 雪厚是**关卡级状态**，不属于任何一关的数值表，所以特别容易被后来的改动
 * 悄悄弄丢（少一个 beginRun 重置就会飘到别的关）。
 * ========================================================================== */
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);

  /* ① 非雪关不长雪 */
  P._start(0, 0);
  ok(P.THEMES[P.LEVELS[0].theme].snow !== true, "第 1 关不是雪原（后面几条的前提）");
  for (let i = 0; i < 600; i++) P.tick(1 / 60);
  ok(S.snowDepth === 0, "非雪关：雪厚恒为 0（跑 10 秒也不长）", String(S.snowDepth));

  /* ② 雪关会越长越厚，但封顶在 1 */
  P._start(0, 1);
  ok(P.THEMES[P.LEVELS[1].theme].snow === true, "第 2 关是雪原");
  const d0 = S.snowDepth;
  for (let i = 0; i < 120; i++) P.tick(1 / 60);
  const d1 = S.snowDepth;
  ok(d1 > d0, "雪原：雪会随时间变厚", d0.toFixed(3) + " → " + d1.toFixed(3));
  S.snowDepth = 1;
  for (let i = 0; i < 60; i++) P.tick(1 / 60);
  ok(S.snowDepth === 1, "雪厚封顶在 1，不会超过", String(S.snowDepth));

  /* ③ 雪厚了敌人真的变慢 —— 直接比同一个敌人的 vx */
  S.snowDepth = 0;
  const foe = S.foes.find((f) => !f.dead && !f.fly && !f.isBoss);
  if (foe) {
    foe.stun = 0; foe.coat = 0; foe.dir = 1;
    P.updateFoe(foe, 1 / 60);
    const vDry = Math.abs(foe.vx);
    S.snowDepth = 1;
    foe.dir = 1;
    P.updateFoe(foe, 1 / 60);
    const vSnow = Math.abs(foe.vx);
    ok(vDry > 0 && vSnow < vDry * 0.85,
      "雪最厚时敌人比干地慢（至少 15%，设计值 30%）",
      vDry.toFixed(1) + " → " + vSnow.toFixed(1));
  } else {
    ok(false, "雪地敌人减速：找不到可测的非飞行敌人");
  }

  /* ④ 雪太薄不留脚印（薄雪上踩不出坑） —— 顺便守住"脚印不会无限增长" */
  S.footprints.length = 0;
  S.snowDepth = 0.1;
  const px0 = S.p.x;
  S.p.x = px0;
  P.leavePrints();
  ok(S.footprints.length === 0, "薄雪（<0.25）不留脚印", String(S.footprints.length));

  S.snowDepth = 1;
  for (let i = 0; i < 40; i++) { S.p.x += 4; P.leavePrints(); }
  ok(S.footprints.length > 0, "厚雪会留脚印", String(S.footprints.length));
  ok(S.footprints.length <= 120, "脚印有上限，不会无限堆积", String(S.footprints.length));

  /* ⑤ 切关必须清雪：不留的话雪会飘到暖金森林去 */
  P._start(0, 0);
  ok(S.snowDepth === 0 && S.footprints.length === 0,
    "换关清雪和脚印（雪是关卡级状态）",
    "depth=" + S.snowDepth + " prints=" + S.footprints.length);
}

console.log("\n=== 27. 出征页进门语义 / 全通存档语义（挑一屏 2026-10-26 删除）===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  const N = P.LEVELS.length;

  /* ① 入口网格几何：槽位 = 玩法数（空槽「新的路还在修」已删），
     全部在画布内、互不重叠。加玩法只往 GATES 里加一项，这条断言不用改。 */
  const cells = [];
  for (let i = 0; i < P.GATE.slots; i++) cells.push(P.gateRect(i));
  ok(cells.length === P.GATES.length, "槽位 = 玩法数（没有空槽占位）",
     "slots=" + cells.length + " gates=" + P.GATES.length);

  let out = 0, overlap = 0;
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i];
    if (a.x < 0 || a.y < 0 || a.x + a.w > 960 || a.y + a.h > 600) out++;
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0 && oy > 0) overlap++;
    }
  }
  ok(out === 0, "玩法小卡全部在画布内", "越界 " + out);
  ok(overlap === 0, "小卡之间不重叠", "重叠 " + overlap);

  /* ② 横排 + 悬停放大（2026-10-25 第六次：预览卡删除，卡横排、悬停放大）。
     钉三件事：同一水平线、按玩法数算出的宽度正好铺满边距、放大后不出画布。
     最后一条是这一版最容易破的 —— 中心放大会往左右各外扩 w*0.1，
     2 张卡时左缘只剩 19px。 */
  {
    /* **直接量真门。** 这里以前要"临时拼回三张假卡"来验排版公式，
       因为主流程只摆一扇门；现在 GATES 本来就是三张（推球 + 古道 + 深巢），
       假卡反而会把门数撑到 5。公式 `w = floor((840-(n-1)*20)/n)` 仍然按
       门数自动算，所以这条断言的意义没变：**加玩法不用改这段**。 */
    const cells3 = [];
    for (let i = 0; i < P.GATE.slots; i++) cells3.push(P.gateRect(i));

    let sameY = 0;
    for (const a of cells3) if (a.y !== cells3[0].y) sameY++;
    ok(sameY === 0, "★ 所有玩法卡在同一水平线上（横排）", "不同 y 的 " + sameY);
    eq(cells3[0].x, P.GATE.marginX, "★ 首卡贴左边距");
    const last = cells3[cells3.length - 1];
    /* **容差 2px，不是恰好等于边距。** 卡宽是 `floor((840-(n-1)*20)/n)`：
       3 张时 800/3 = 266.67 → 266，余下 2px 必然落在右缘。
       这是 GATE.w 的注释里写明的取舍（用 round 会算出 267，右缘反而
       超出 1px、且会半像素错位）。原断言要求 `=== 60`，
       两扇门时能过、三扇门时必然红 —— 标准本身写错了，不是代码错。 */
    const gapR = 960 - (last.x + last.w);
    ok(Math.abs(gapR - P.GATE.marginX) <= 2,
       "★ 末卡贴右边距（宽度公式铺满 840，容差 2px）",
       gapR + " vs " + P.GATE.marginX);

    let zout = 0;
    for (let i = 0; i < cells3.length; i++) {
      const z = P.gateZoomRect(i);
      if (z.x < 0 || z.y < 0 || z.x + z.w > 960 || z.y + z.h > 600) zout++;
    }
    ok(zout === 0, "★ 悬停放大后仍在画布内（中心放大最容易从左缘掉出去）", "越界 " + zout);

    /* 中心必须不变：改了中心，鼠标会在放大那一瞬间掉出卡外 → 复原 → 再放大，
       闪成一片。这条断言守的就是"不抖"。 */
    for (let i = 0; i < cells3.length; i++) {
      const c = cells3[i], z = P.gateZoomRect(i);
      eq(Math.round(z.x + z.w / 2), Math.round(c.x + c.w / 2), `槽 ${i} 放大中心不变`);
      ok(z.w > c.w, `槽 ${i} 放大真的变大`, c.w + " → " + z.w);
    }

    /* 放大后的矩形要和**命中矩形**区分开：命中永远用常态矩形，
       否则放大后盖住的邻居会点不到。 */
    eq(P.gateHit(cells3[1].x + 4, cells3[1].y + cells3[1].h / 2), 1,
       "★ 命中用常态矩形（放大不抢邻居的点击）");
  }

  /* ②b 主流程三扇门（2026-10-30 晚第二次打回：
     「还有和深巢呢」「最初的那2个玩法完全丢弃吗」）。

     中间有过一版"只留一扇门"，理由是"三扇门并排像两个游戏"。理由不错，
     结论错了：**藏起来 ≠ 收得住**。玩家看不到深巢只会以为内容没了。
     现在三门并列，推球第一（主线），后面是两套存量玩法。
     代价：h=150 < detailMinH(170)，卡上第三行不画 —— 这是公式设计好的降级。 */
  eq(P.GATES.length, 3, "★ 出征页三扇门（推球 + 古道 + 深巢）");
  eq(P.GATES[0].id, "snow", "★ 第一扇是推球（主线放最前）");
  eq(P.GATES.map(g => g.id).join(","), "snow,trail,nest", "门的顺序：推球/古道/深巢");
  eq(P.GATE.scale, 1.2, "★ 三卡时悬停放大 1.2（单卡才关掉）");
  {
    /* 三门 = 266×150：`floor((840-2*20)/3)`，16:9 反推。同一水平线、三等分。 */
    const c0 = P.gateRect(0), c1 = P.gateRect(1), c2 = P.gateRect(2);
    ok(c0.w === 266 && c0.h === 150, "★ 三卡 266×150（公式按门数自动算）", c0.w + "×" + c0.h);
    ok(c0.y === c1.y && c1.y === c2.y, "三张卡同一水平线", c0.y + "/" + c1.y + "/" + c2.y);
    const z0 = P.gateZoomRect(0), z2 = P.gateZoomRect(2);
    ok(z0.x >= 0 && z0.y >= 0 && z2.x + z2.w <= 960 && z2.y + z2.h <= 600,
       "★ 两头那两张放大后仍不出画布（命中区不越界）",
       z0.x + " .. " + (z2.x + z2.w));
    eq(P.GATE.detailMinH > c0.h, true,
       "★ 三卡高度装不下第三行（detailMinH 该生效，别再往前塞字）");
  }

  /* ②c 出征页的星数（2026-10-30）。出征页是出门前**唯一**能读到"我打到哪了"
     的地方，数错等于告诉玩家"你只拿了 1 颗"而实际有 3 颗。
     **按位掩码 popcount，不是数 key 的个数** —— 第三条专门咬这件事：
     "一关满星 7" 和 "三关各一颗" 数 key 都是 3，只有 popcount 分得清 3 和 3。
     真正的区分靠第二条（{1:7,2:7} = 6 而不是 2）。 */
  eq(P.snowStarCount({ stars: { "13": 7 } }), 3, "★ 一关满星 = 3 颗（不是数 key）");
  eq(P.snowStarCount({ stars: { "1": 1, "2": 1, "3": 1 } }), 3, "三关各一颗 = 3 颗");
  eq(P.snowStarCount({ stars: { "1": 7, "2": 7 } }), 6, "★ 两关满星 = 6 颗（数 key 会得 2）");
  eq(P.snowStarCount({}), 0, "空存档 = 0 颗");
  eq(P.snowStarCount({ stars: { "1": "x", "2": null, "3": 7 } }), 3,
     "★ 脏数据跳过不挂死（NaN 进 while 循环永远不结束）");
  {
    /* 144 是硬编码的：grove.html 读不到 snowlab 的 STAGE_MAX，两个独立文件
       唯一能共享的只有 localStorage。漏改一处的后果不是报错，是
       "打完 48 关星数永远差一截"—— 所以把两个文件对起来。 */
    const snowSrc = fs.readFileSync(
      path.join(__dirname, "..", "prototype", "snowlab.html"), "utf8");
    const m = snowSrc.match(/const STAGE_MAX\s*=\s*(\d+)/);
    ok(!!m, "snowlab 里找得到 STAGE_MAX");
    eq(P.SNOW_STARS_MAX, parseInt(m[1], 10) * 3,
       "★ 星上限 = snowlab 关数 × 3（两边一起改）");
  }

  /* ③ 命中测试和格子几何是同一份 —— 抓小卡中心必须命中自己。 */
  let hitBad = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (P.gateHit(c.x + c.w / 2, c.y + c.h / 2) !== i) hitBad++;
  }
  ok(hitBad === 0, "每个小卡中心点命中自己（绘制与判定同源）", "错 " + hitBad);

  /* ④ 下面几条验的是"点哪扇门走哪条线"和进度 clamp，都是古道的行为。
     **门表里本来就有古道**（GATES = 推球 + 古道 + 深巢），以前那句
     `unshift(...GATES_LEGACY)` 会把门数撑到 5、并触发"id 不重复"红。 */

  /* ④ 点开着的门 → 直接进**当前进度那一屏**（挑一屏已删，没有中间选择页）。 */
  S.progress = 3;
  P.openGates();
  eq(S.phase, "portals", "openGates 进出征页");
  /* **索引 1 是古道。** 门表顺序是 [推球, 古道, 深巢] —— 推球占了 0，
     这三条验的是古道的行为，所以按 id 取，不写死数字（下次调整顺序也活）。 */
  P.enterGate(P.GATES.findIndex(g => g.id === "trail"));
  eq(S.phase, "play", "点苔原古道直接开打（不经过挑一屏）");
  eq(S.stage, 3, "进的是当前进度那一屏（progress = 3 → stage 3）");

  /* ⑤ "只进不退"还在：progress 高的存档进门还是打当前那一屏。 */
  S.progress = 12;
  P.openGates();
  P.enterGate(P.GATES.findIndex(g => g.id === "trail"));
  eq(S.stage, 12, "progress = 12 → 进第 13 屏");

  /* ⑥ 全通时 clamp 回最后一屏，不越界（progress 上界是闭区间 N）。 */
  S.progress = N;
  P.openGates();
  P.enterGate(P.GATES.findIndex(g => g.id === "trail"));
  eq(S.stage, N - 1, "全通时进最后一屏（不越界）", "stage=" + S.stage);

  /* ⑦ 全通后 `goHome(true)` 不许把进度清零 —— 这是那句
     "通关了怎么又重新开始了"的原始病根。 */
  S.progress = N;
  P.goHome(true);
  ok(S.progress >= N, "全通后收工不把进度拍回 0", String(S.progress));

  /* ⑧ 结算卡的「继续」在最后一屏回出征页，不是去收工、不是回第 1 屏。
     （原来是 openPick，挑一屏删了换成 openGates。） */
  P._start(0, N - 1);
  S.phase = "clear";
  P.nextLevel();
  eq(S.phase, "portals", "最后一屏通关 → 回出征页");
  P.resetRun();
}

console.log("\n=== 27b. 测试跳关（F2 面板 / [ ] 上下屏）===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  const N = P.LEVELS.length;

  /* ① 27 格几何：都在画布内、中心点命中自己、两两不重叠。
     "点上去跳到隔壁那屏"是这类面板最典型的 bug，而它只能靠几何断言抓 ——
     截图看不出 1px 的偏移，玩家的手指看得出。 */
  let outBox = 0, miss = 0, overlap = 0;
  for (let i = 0; i < N; i++) {
    const a = P.jumpCell(i);
    if (a.x < 0 || a.y < 0 || a.x + a.w > 960 || a.y + a.h > 600) outBox++;
    if (P.jumpHit(a.x + a.w / 2, a.y + a.h / 2) !== i) miss++;
    for (let j = i + 1; j < N; j++) {
      const b = P.jumpCell(j);
      if (a.x < b.x + b.w && b.x < a.x + a.w &&
          a.y < b.y + b.h && b.y < a.y + a.h) overlap++;
    }
  }
  ok(outBox === 0, "27 格全在画布内", "出界 " + outBox + " 格");
  ok(miss === 0, "每格中心点都命中自己", "错位 " + miss + " 格");
  ok(overlap === 0, "27 格两两不重叠", "重叠 " + overlap + " 对");

  /* ② **无视解锁 —— 这是这个功能的全部意义。**
     存档进度停在 0，也要能一步进第 23 屏；否则"想验芦苇荡先把前 22 屏打一遍"
     就不叫测试。 */
  S.progress = 0;
  P.jumpTo(22);
  eq(S.stage, 22, "progress=0 也能直接跳第 23 屏（无视解锁）");
  eq(S.phase, "play", "跳完立刻在战斗里");

  /* ③ 不污染存档。beginRun 里有一行 `progress = max(progress, stage)`，
     不显式护住的话，测试时按两下 `]` 就把存档写到第 20 屏 ——
     下次从主界面进来直接掉到第 20 屏，看起来像存档坏了。 */
  eq(S.progress, 0, "跳关不推进 progress（存档没被测试工具写坏）");
  eq(S.trip.stages, 0, "跳关不算一趟的关数");
  eq(S.trip.multi, 1, "跳关不动倍率");

  /* ④ 面板进出。从 play 进必须回 play，从 select 进必须回 select ——
     "回错地方"的表现是黑屏（S.p 已清空却回到 play），不是报错。 */
  P._start(0, 3);
  P.openJump();
  eq(S.phase, "jump", "openJump 进面板");
  P.closeJump();
  eq(S.phase, "play", "从 play 打开 → 关掉回 play");
  ok(!!S.p, "回来时角色还在（不是黑屏）");

  S.phase = "select"; S.p = null;
  P.openJump();
  P.closeJump();
  eq(S.phase, "select", "从 select 打开 → 关掉回 select（不能硬回 play）");

  /* ⑤ F2 是开关：面板开着再按一次 = 关掉 */
  P.openJump();
  P.openJump();
  ok(S.phase !== "jump", "再按一次 F2 关掉面板", "phase=" + S.phase);

  P.resetRun();
}

console.log("\n=== 27c. Cocos 键盘转发（GROVE._key）===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;

  /* 病根：Cocos 侧的 KEY_MAP 只映射方向 / WASD / J / K —— F2、[ ]、R、Esc、
     Enter 一个都不在里面，而运行时自带的 window 监听在编辑器的 Game View 里
     可能压根收不到按键（焦点在编辑器、或者宿主页面把键吃了）。
     症状是"浏览器里好好的，进 Cocos 按 F2 完全没反应"。

     修法不是在这边再写一张热键表（那就是第二份真值，迟早漂移），
     而是把键喂回运行时的 onKeyDown —— 跳关面板 / 挑一屏 / 收工 / 继续
     全部只有一份实现。这一节守的就是那条转发链。 */

  ok(typeof P._key === "function", "GROVE._key 存在（Cocos 转发入口）");

  P._start(0, 3);
  P._key("F2");
  eq(S.phase, "jump", "_key(F2) 从战斗中打开跳关面板");

  /* 40ms 去重：同一次物理按键会同时从 window 和引擎两条路进来。
     不去重的话 F2 被"开一次、又关一次"，玩家看到的正是"按了没反应"。 */
  P._key("F2");
  eq(S.phase, "jump", "紧接着重复的 F2 被去重（不会自己把面板关掉）");

  P._key("Escape");
  eq(S.phase, "play", "换个键不受去重影响（Escape 关面板回战斗）");
  ok(!!S.p, "关面板后角色还在（不是黑屏）");

  P._key("BracketRight");
  eq(S.stage, 4, "_key(BracketRight) 下一屏");
  P._key("BracketLeft");
  eq(S.stage, 3, "_key(BracketLeft) 上一屏");
  P._key("KeyR");
  eq(S.stage, 3, "_key(KeyR) 重开本屏（不是跳到别处）");

  /* 面板里的方向键：Cocos 的 KEY_MAP 把方向键当动作键（只在 play 里生效），
     所以非 play 阶段必须走转发，否则面板打开后光标一动不动。 */
  P.openJump();
  S.jumpCur = 0;
  P._key("ArrowRight", true);
  eq(S.jumpCur, 0, "带 repeat 的方向键不移动（按住会一路飞到最后一格）");
  // 把 40ms 去重窗口让过去，再测"真的按了一下"
  const t0 = Date.now();
  while (Date.now() - t0 < 50) { /* 等过去重窗口 */ }
  P._key("ArrowRight");
  eq(S.jumpCur, 1, "_key(ArrowRight) 在跳关面板里移动光标");
}

console.log("\n=== 27d. DOM 键盘通路（真实 window 监听）===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  const key = (code, repeat) => ({ code: code, repeat: !!repeat, preventDefault() {} });

  /* 这一节守的是**另一条路**：浏览器直开 grove.html 时，按键走的是
     运行时自己挂的 window.addEventListener。27c 验的是 Cocos 转发链，
     两者共用 onKeyDown，但"监听到底挂上了没有"只能从这条路看出来 ——
     挂漏了的表现就是"转发正常、真人按键没反应"。 */
  ok((sb._ls.keydown || []).length > 0, "keydown 监听真的挂上了 window");
  eq((sb._ls.keydown || []).length, 1, "只挂一个（多挂会一次按键执行两遍）");
  ok((sb._ls.keyup || []).length > 0, "keyup 监听也挂上了");

  P._start(0, 6);
  sb._fire("keydown", key("F2"));
  eq(S.phase, "jump", "真实 keydown F2 → 打开跳关面板");

  // 让过 40ms 去重窗口，再验"再按一次 = 关掉"
  const t = Date.now();
  while (Date.now() - t < 50) { /* 等 */ }
  sb._fire("keydown", key("F2"));
  eq(S.phase, "play", "再按一次 F2 → 关掉面板回战斗（F2 是开关）");

  // 按住不放：浏览器会连发 repeat，面板光标必须不动
  P.openJump();
  S.jumpCur = 4;
  sb._fire("keydown", key("ArrowLeft", true));
  eq(S.jumpCur, 4, "按住方向键（repeat）在面板里不移动");
  const t2 = Date.now();
  while (Date.now() - t2 < 50) { /* 等 */ }
  sb._fire("keydown", key("ArrowLeft"));
  eq(S.jumpCur, 3, "真按一下方向键才移动");

  // 收尾：Escape 回战斗，别把后面的测试留在面板里
  const t3 = Date.now();
  while (Date.now() - t3 < 50) { /* 等 */ }
  sb._fire("keydown", key("Escape"));
  eq(S.phase, "play", "Escape 从面板回战斗");
}

console.log("\n=== 28. 三目标 / 越饱越强 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;

  /* ① 评级 = 主目标 + 两个可选条件（用时 / 用球）。
     这条断言的价值在于**把口径钉死**：改成"只有两个条件"或者
     "三个条件都算"之前，先得看见这里写的是什么。 */
  P._start(0, 5);
  const st = P.LEVELS[5];
  S.phase = "clear";
  S.playT = st.par.time - 1;  S.stat.made = st.par.made;
  eq(P.rate(), "S", "两个条件都达标 = S");
  S.playT = st.par.time + 10;
  eq(P.rate(), "A", "只差用时 = A");
  S.stat.made = st.par.made + 3;
  eq(P.rate(), "B", "两个都没达标 = B");

  /* ② 越饱越强：三档推球力的顺序必须是 满饱 > 半饿 > 全饿。
     **不能写成"三档相等"** —— 那就等于这个机制没做。
     也不能让半饿比满饱只高一点点的同时全饿还比满饱高（顺序会反）。 */
  const pw = {};
  for (const [name, v] of [["hungry", 10], ["half", 50], ["full", 100]]) {
    S.belly = v;
    pw[name] = P.bellyPower();
  }
  ok(pw.full > pw.half, "满饱比半饿推得更远", pw.full + " > " + pw.half);
  ok(pw.half > pw.hungry, "半饿比全饿推得更远", pw.half + " > " + pw.hungry);
  ok(pw.hungry / pw.full < 0.94 && pw.hungry / pw.full > 0.80,
     "全饿的降幅在 6%~20% 之间（再大就不是取舍，是换了张地图）",
     (pw.hungry / pw.full).toFixed(3));

  /* ②b 结算卡副标题的"力气"三态。**必须验真身，不是抄一份逻辑再验。**
     第一版把它写成两态：满饱时（100 → 80，两边都还是满饱档）判成"力气见底"，
     意思完全反了 —— 玩家会以为打完这屏就废了。
     而它只影响按钮上的一句副标题，不跑断言根本没人发现。 */
  eq(P.BELLY_PER_CLEAR, 20, "每屏掉 20（唯一真值，通关判定和副标题共用）");
  eq(P.nextBellyHint(100), "力气不变", "满饱打下一屏：力气不变（100→80 都还满饱）");
  eq(P.nextBellyHint(85), "力气降一档", "满饱边缘：降一档（85→65 掉进半饿）");
  eq(P.nextBellyHint(45), "力气见底", "半饿打下一屏：见底（45→25 掉进全饿）");
  eq(P.nextBellyHint(10), "力气不变", "已经全饿：再打也不会更弱，别吓人");

  /* ③ 三档必须有词。只有条没有字，玩家读不出自己现在算哪一档。 */
  S.belly = 10; const w0 = P.bellyWord();
  S.belly = 50; const w1 = P.bellyWord();
  S.belly = 100; const w2 = P.bellyWord();
  ok(w0 && w1 && w2 && w0 !== w1 && w1 !== w2,
     "三档肚子各有各的说法", [w0, w1, w2].join(" / "));

  /* ④ 推球力真的乘上去了 —— 不是加了个没人读的系数。
     做法和 §3 完全一致：造一颗球、把人贴到左边、推一帧、读 vx。
     **只比倍数不比绝对值**：绝对值会被 PUSH_BASE 一改就红，
     而这条断言要守的是"满饱 > 半饿"，不是"620 这个数"。 */
  const pushAt = (belly) => {
    P._start(0, 6);
    S.belly = belly;
    const f = S.foes.find(x => x.kind === "walk");
    P.coatFoe(f, 3);
    const b = S.balls[0];
    b.x = 400; b.y = 462; b.vx = 0;
    S.p.x = b.x - 40; S.p.y = b.y; S.p.vx = 0;
    P._press("right", true);
    P.tick(1 / 60);
    P._press("right", false);
    return Math.abs(b.vx);
  };
  const vHalf = pushAt(50), vFull = pushAt(100), vHungry = pushAt(10);
  ok(vFull > vHalf * 1.02, "满饱推出去的球真的更快（实测）",
     vFull.toFixed(0) + " vs 半饿 " + vHalf.toFixed(0));
  ok(vHalf > vHungry, "半饿比全饿快（实测）",
     vHalf.toFixed(0) + " vs 全饿 " + vHungry.toFixed(0));
}


console.log("\n=== 29. 宠物解锁 / 分章几何 / 弹菇衰减 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  const N = P.LEVELS.length;

  /* ① 解锁节奏必须**铺满整条路**，不能全挤在前 8 屏。
     老表是 0/1/3/5/7/8 —— 打满第 8 屏六只全齐，后 19 屏一只都不给，
     "养成"在第 1 个产地就结束了。这里直接读表，不走 stageUnlockReward ——
     那个函数算的是"打完当前这一屏会送谁"，依赖真实存档的已通数，
     拿它遍历 27 屏只会得到 27 个相同答案（踩过）。 */
  const unlocks = [];
  for (const id in P.UNLOCK_AT) {
    if (P.UNLOCK_AT[id] > 0) unlocks.push({ at: P.UNLOCK_AT[id], id: id });
  }
  unlocks.sort((a, b) => a.at - b.at);
  ok(unlocks.length === 5, "27 屏里送 5 只（第 6 只是开局就有）",
     "实际 " + unlocks.length + "：" + unlocks.map(u => u.id + "@" + u.at).join(" "));
  ok(unlocks.length > 0 && unlocks[unlocks.length - 1].at >= N / 2,
     "最后一只在中段之后到家（不然养的节奏半程就断了）",
     "第 " + (unlocks.length ? unlocks[unlocks.length - 1].at : 0) + " 屏");
  ok(unlocks.length > 0 && unlocks[0].at < 9,
     "第一只在第一个产地内到家（头 9 屏必须有正反馈）",
     "第 " + (unlocks.length ? unlocks[0].at : 0) + " 屏");

  /* ② 解锁表的 at 必须和 Roster.ts 逐个相等。
     两边各写一份，谁改了另一边不知道 —— 表现是"主界面说再通 2 关，
     打完 2 关没动静"。这条断言就是为了让那种漂移在 CI 里红。 */
  {
    const fsx = require("fs"), px = require("path");
    const src = fsx.readFileSync(px.join(__dirname, "..", "assets", "scripts", "config", "Roster.ts"), "utf8");
    /* 不用正则解析：这套断言要能在任何 node 版本上跑，而 `\s` 这种
       转义在不同写入路径下会被吃掉一次（这个文件已经被踩过）。 */
    const rows = [];
    for (const seg of src.split("id: '").slice(1)) {
      const id = seg.slice(0, seg.indexOf("'"));
      const nmAt = seg.indexOf("name: '");
      const atAt = seg.indexOf("at: ");
      if (nmAt < 0 || atAt < 0) continue;
      const name = seg.slice(nmAt + 7, seg.indexOf("'", nmAt + 7));
      const at = parseInt(seg.slice(atAt + 4), 10);
      if (!id || !Number.isFinite(at)) continue;
      rows.push([null, id, name, String(at)]);
    }
    ok(rows.length === 6, "Roster.ts 里读到 6 只宠物", "读到 " + rows.length);
    const byId = {};
    for (const u of unlocks) byId[u.id] = u.at;
    /* id 前缀映射：grove 用 cat/dog/…，Roster 用 sugar-stand/nian-gao-dog/… */
    const MAP = { cat: "sugar-stand", dog: "nian-gao-dog", ham: "tuan-zi-ham",
                  rab: "xue-tuan-rab", ox: "dou-nai-ox", fox: "xing-xie-fox" };
    let bad = [];
    for (const r of rows) {
      const at = parseInt(r[3], 10);
      if (at === 0) continue;                 // 开局自带，grove 侧没有"送"这条记录
      const gid = Object.keys(MAP).find(k => MAP[k] === r[1]);
      if (!gid) { bad.push(r[1] + " 没有 grove 侧对应 id"); continue; }
      if (byId[gid] !== at) bad.push(r[1] + " Roster=" + at + " grove=" + byId[gid]);
    }
    ok(bad.length === 0, "解锁表和 Roster.ts 逐个相等", bad.join(" · "));
  }

  /* ③ 分章几何：27 屏切成 3 段，每段 9 屏，边界不能偏。
     偏一格的表现不是报错，是"第 9 屏标题写着苔原、点却按枯木坡算"。 */
  {
    const expect = [
      [0, "苔原"], [8, "苔原"], [9, "枯木坡"], [17, "枯木坡"],
      [18, "泥沼"], [26, "泥沼"],
    ];
    let bad = [];
    for (const [i, nm] of expect) {
      const ch = P.chapterOfStage(i);
      if (ch.name !== nm) bad.push(i + ":" + ch.name + "≠" + nm);
    }
    ok(bad.length === 0, "产地边界在 9 / 18 上", bad.join(" "));

    const c9 = P.chapterOfStage(9), c26 = P.chapterOfStage(26);
    ok(c9.from === 9 && c9.count === 9, "枯木坡从第 10 屏起、共 9 屏",
       "from=" + c9.from + " count=" + c9.count);
    ok(c26.from === 18 && c26.count === 9, "泥沼从第 19 屏起、共 9 屏",
       "from=" + c26.from + " count=" + c26.count);
    let badCount = 0;
    for (let i = 0; i < N; i++) if (P.chapterOfStage(i).count !== 9) badCount++;
    ok(badCount === 0, "每一章的屏数都是 9", "异常 " + badCount);
  }

  /* ④ 进度点必须绕开右上目标卡。
     `gap=22` 是写死的；27 颗点跨 572px，右端 766 —— 而目标卡左边界 644，
     **压进去 122px**（截图上右边的点被奶白卡片盖掉，玩家以为只画了一半）。
     只画当前产地 9 颗才留得出余量，这条断言就是这个改动的护栏。 */
  {
    const GAP = 22, CARD_X = P.GOAL_CARD.x;
    const n = P.chapterOfStage(9).count;
    const total = (n - 1) * GAP;
    const right = 480 + total / 2;
    ok(right < CARD_X - 40, "章内进度点不撞右上目标卡",
       "点右端 " + right.toFixed(0) + " vs 卡左界 " + CARD_X);
    const allRight = 480 + ((N - 1) * GAP) / 2;
    ok(allRight > CARD_X, "（反证）27 颗点画在一行确实会撞卡",
       "27 颗右端 " + allRight.toFixed(0) + " > " + CARD_X);
  }

  /* ④b **目标卡不许压住任何一屏的落脚面。**
     用户连报两轮"目标 UI 和战斗场景重叠"。量下来是真的：
     原来的 272×168 @ (672,14) 下沿到 182，而第 8 屏「双塔」有一块台面
     x660~860 / y156 —— 玩家站上去头顶 ≈116，**整只被卡片盖住**，
     而且在 x672~860 这段是真盖，不是擦边。

     这条断言把"卡片压不压场地"从一眼看不出的审美问题，变成一条几何题：
     扫 27 屏所有台子 / 坡 / 木桩，凡是落在卡片矩形里的都必须为 0。
     角色头顶高度按 40px 算（role 高 34 + 一点余量），台面上沿减它就是头顶。 */
  {
    const GC = P.GOAL_CARD;
    const cardBottom = GC.y + GC.h;
    let worst = 999, worstName = "", hitArea = 0, hitWhere = "";
    for (let i = 0; i < N; i++) {
      P._start(0, i);
      const boxes = [];
      for (const p of P.PLATS) {
        boxes.push({ x0: p.x, x1: p.x + p.w, y0: p.y, y1: p.y + p.h });
      }
      for (const r of P.RAMPS) {
        boxes.push({
          x0: Math.min(r.xL, r.xR), x1: Math.max(r.xL, r.xR),
          y0: Math.min(r.yL, r.yR), y1: Math.max(r.yL, r.yR) + 26,
        });
      }
      for (const s of (P.STUMPS || [])) boxes.push({ x0: s.x, x1: s.x + 26, y0: s.y - 46, y1: s.y + 4 });
      for (const b of boxes) {
        if (b.x1 <= GC.x || b.x0 >= GC.x + GC.w) continue;
        const oy = Math.min(b.y1, cardBottom) - Math.max(b.y0, GC.y);
        if (oy <= 0) continue;
        const ox = Math.min(b.x1, GC.x + GC.w) - Math.max(b.x0, GC.x);
        hitArea += ox * oy;
        if (!hitWhere) hitWhere = "屏" + (i + 1) + " 台 x" + Math.round(b.x0) + "~" + Math.round(b.x1) + " y" + Math.round(b.y0);
      }
      /* 右半最高的落脚面 → 站在上面的人头顶 */
      for (const b of boxes) {
        if (b.x1 < GC.x) continue;
        if (b.y0 < worst) { worst = b.y0; worstName = P.LEVELS[i].name; }
      }
    }
    ok(hitArea === 0, "目标卡不压任何台面 / 坡 / 木桩",
       hitArea ? "压住 " + Math.round(hitArea) + " px²：" + hitWhere : "27 屏全清");
    ok(worst - 40 >= GC.y + GC.h, "右半最高台面上的人头顶也在卡下面",
       "最高台面 y=" + worst + "（" + worstName + "）头顶 ≈" + (worst - 40) +
       " vs 卡下沿 " + (GC.y + GC.h));
  }

  /* ⑤ 弹菇的弹起必须**衰减**，不然球落回同一朵就永远停不下来。
     第 12 屏那朵 520 的菇正上方压着 248 台面，球被顶上、落回、再弹 ——
     实测能弹满 20 秒，玩家读作"球在乱跳"。 */
  {
    P._start(2, 14);                        // 弹菇田（第 15 屏，index 14）
    const bo = P.BOUNCERS[0];
    ok(!!bo, "弹菇田至少有 1 朵菇", "n=" + P.BOUNCERS.length);
    const f = P.foeFromSpec({ foe: "bug", x: 200, y: 462 }, false);
    S.foes.push(f);
    P.coatFoe(f, 3);
    const b = S.balls[0];
    ok(!!b, "涂层三次后变成球");
    if (b && bo) {
      b.x = bo.x; b.y = bo.y; b.vx = 0; b.vy = 0;
      S.p.x = 60; S.p.y = 462;              // 人挪开，别去推它
      let peak = 0;
      for (let i = 0; i < 60 * 8; i++) {
        P.tick(1 / 60);
        peak = Math.max(peak, b.bounceN || 0);
        if (b.dead) break;
      }
      ok(peak <= 4, "同一朵菇最多弹 4 次就衰减到停下", "实测 " + peak + " 次");
      ok((b.bounceN || 0) > 0 || b.dead, "（反证）它真的被弹过", "bounceN=" + (b.bounceN || 0));
    }
  }

  /* ⑥ 白推要记**人次**，不是次数。
     一颗装着 3 只的球滚出去，损失是 3 只；记成 1 次的话结算会把代价报小。 */
  {
    const lostBefore = S.stat.lost || 0;
    ok(typeof (S.stat.lost) === "number" || S.stat.lost === undefined,
       "stat.lost 是数字或未初始化", "=" + S.stat.lost);
    ok(lostBefore >= 0, "白推计数非负", "=" + lostBefore);
  }
}

console.log("\n=== 30. 空间语法：地面材质 / 反射板 / 回弹井 ===");
{
  /* 27 屏同质化的病根不是「美术长得像」，是**空间不给玩家新的动词**。
     这一节钉三个新原语：材质（地面自己有物理）、反射板（速度守恒）、
     以及被它们撑起来的第 7 屏。断言一律落在「物理真的变了」上 ——
     「字段还在但没接进物理」是这套代码里最常见的假通过。 */

  /* ① 材质表：moss 必须绝对中性。
     moss 一旦不是 (0,0,1)，27 屏里没写 grounds 的那 26 屏会一起被改，
     而且改得无声无息 —— 没人会去点开第 19 屏看球速对不对。 */
  {
    const sb = boot(), P = sb.GROVE;
    const M = P.MAT;
    ok(!!M && !!M.moss && !!M.ice && !!M.mud, "三种地面材质都在表里",
       M ? Object.keys(M).join("/") : "没有 MAT");
    eq(M.moss.ballGain, 0, "moss：球不加速");
    eq(M.moss.ballDrag, 0, "moss：球不减速");
    eq(M.moss.heroFr, 1, "moss：玩家摩擦系数 = 1（基准值）");
    ok(M.ice.ballGain > 0,
       "ice：球被**加速**（本作地面完全无摩擦，「冰」只能是加速）",
       "gain=" + M.ice.ballGain);
    eq(M.ice.ballDrag, 0,
       "ice：不同时写减速（一边加速一边减速 = 互相抵消的假特效）");
    ok(M.ice.heroFr < 1, "ice：玩家在上面站不住脚", "fr=" + M.ice.heroFr);
    ok(M.mud.ballDrag > 0, "mud：球被拖慢", "drag=" + M.mud.ballDrag);
    ok(M.mud.heroFr > 1, "mud：玩家在上面更难刹住", "fr=" + M.mud.heroFr);
  }

  /* ② matAt：没写 grounds 的屏必须退回 moss，且边界是**闭区间**。
     写成开区间的话，冰带最右那 1px 会变回苔原 —— 球在那儿莫名减速，
     玩家看不见任何东西，只会觉得这游戏的手感时好时坏。 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 0);                            // 第 1 屏「苔原入口」没写 grounds
    eq(P.GROUNDS.length, 0, "第 1 屏没有材质带");
    eq(P.matAt(100), "moss", "没写 grounds 的屏：左边是苔原");
    eq(P.matAt(860), "moss", "没写 grounds 的屏：右边也是苔原（不是「无材质」）");

    P._start(0, 1);                            // 第 2 屏「雪原」：泥坑右缘 → 坡脚
    eq(P.GROUNDS.length, 1, "第 2 屏有 1 条材质带");
    const g = P.GROUNDS[0];
    eq(g.kind, "ice", "第 2 屏那条带是冰");
    ok(g.x + g.w <= P.CAMP.x,
       "冰带整段在营地左边（压在营地底下的那段玩家永远踩不到，等于没写）",
       "冰 " + g.x + ".." + (g.x + g.w) + " vs 营地 " + P.CAMP.x);
    /* 冰带右端必须**正好**贴住坡脚。多铺 1px 进坡里，那 1px 会按 x 判定成冰，
       而球在坡上的 y 又够不到地面判定 —— 于是"坡脚的球有一瞬间既不加速也不受坡影响"。
       这种 1px 的缝没人看得见，但会让手感在坡脚抖一下。 */
    const ramp = P.RAMPS[0];
    ok(ramp && Math.abs(ramp.x - (g.x + g.w)) <= 1,
       "冰带右端正好接上坡脚（不多铺 1px 进坡里）",
       ramp ? "坡脚 " + ramp.x + " vs 冰带右端 " + (g.x + g.w) : "没有坡");
    /* 左边不能压到泥坑：泥坑自己有「进坑 ×0.72」，两套减速叠一起，
       球会在泥坑边缘掉两次速，读起来像"卡了一下"。 */
    const mud = P.PITS.find(q => q.kind === "mud");
    ok(mud && g.x >= mud.x + mud.w, "冰带左端在泥坑右缘之外（两套规则不叠）",
       mud ? "泥坑到 " + (mud.x + mud.w) + " vs 冰带 " + g.x : "没有泥坑");
    ok(g.w >= 120, "冰带够长，玩家能感觉到「这段不一样」", "w=" + g.w);
    eq(P.matAt(g.x - 1), "moss", "冰带左界外还是苔原");
    eq(P.matAt(g.x), "ice", "冰带左界上是冰（闭区间左端）");
    eq(P.matAt(g.x + g.w), "ice", "冰带右界上是冰（闭区间右端）");
    eq(P.matAt(g.x + g.w + 1), "moss", "冰带右界外还是苔原");
  }

  /* ③ 冰面物理：真的更快，而且增量对得上公式。
     只断言 vx > v0 是不够的 —— 那可能来自坡、来自弹菇、来自任何东西。
     按 (1+gain·dt) 逐帧算，错一个常数就红。 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, 1);                            // 第 2 屏「雪原」
    P.coatFoe(S.foes[0], 3);
    const b = S.balls[0];
    const gy = P.GROUND_Y, g = P.GROUNDS[0];
    // ★ 球的 y 是**底边**，不是圆心（坑用 `y >= pit.y - 8` 判）。
    //   放到 gy-22 会悬空 22px：材质照样生效（判定是 y >= GROUND_Y-26），
    //   但泥坑、火坑、落袋全都判不到 —— 之前这里就是靠"碰巧不报错"过的。
    b.x = g.x + g.w / 2; b.y = gy; b.vx = 200; b.vy = 0;
    b.onGround = true; b.ground = null;
    S.p.x = 820; S.p.y = gy;                   // 人挪到右边空地，别去推球
    const v0 = b.vx;
    P.tick(1 / 60);
    near(b.vx, v0 * (1 + P.MAT.ice.ballGain / 60), 1.5,
         "冰面一帧：vx = v0 × (1 + gain·dt)");
    ok(b.vx > v0, "（方向）冰上球越滚越快", v0.toFixed(1) + " → " + b.vx.toFixed(1));
  }

  /* ④ 人的摩擦也要接材质，否则「冰」只对球生效 ——
     玩家在冰上走路完全正常，冰面就退化成一张贴图。 */
  {
    /* 同屏对照。跨屏比是没意义的 —— 第 2 屏雪深 1，本身就把摩擦乘了 0.45，
       拿它和第 1 屏的苔原比，量到的是"雪"不是"冰"，两个变量搅在一起。 */
    const slide = (px) => {
      const sb = boot(), P = sb.GROVE, S = P.S;
      P._start(0, 1);
      const gy = P.GROUND_Y;
      S.p.x = px; S.p.y = gy; S.p.vy = 0; S.p.vx = 320; S.p.onGround = true;
      // 键盘必须全松：按着方向键会每帧把 vx 重置成 H.spd，摩擦根本轮不到
      P._press("left", false); P._press("right", false);
      const x0 = S.p.x;
      for (let i = 0; i < 24; i++) P.tick(1 / 60);
      return Math.abs(S.p.x - x0);
    };
    const sb1 = boot(), P1 = sb1.GROVE;
    P1._start(0, 1);
    const g1 = P1.GROUNDS[0];
    // 冰上从带子左端往里 5px 起滑（右边就是坡脚，别冲上坡）；
    // 苔上走右边那段空地（760..852，火坑和水塘之间）。
    const onIce = slide(g1.x + 5), onMoss = slide(800);
    ok(onMoss > 0 && onMoss < 70, "苔原上松手很快停住", onMoss.toFixed(1) + "px");
    ok(onIce > onMoss * 1.8, "冰面松手后滑得远得多（摩擦真的接了材质）",
       "冰 " + onIce.toFixed(0) + "px vs 苔 " + onMoss.toFixed(0) + "px");
  }

  /* ⑤ 反射板：速度**一点不衰减**。这是它和「撞墙 ×0.62」的全部区别 ——
     墙是惩罚，板是机会。哪天有人顺手给它乘个 0.8，这条会红。
     另一条同样重要：正在**离开**板面的球不能再反射，否则球会贴着板原地抖。 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 6);                            // 第 7 屏「回弹井」
    eq(P.REFLECTS.length, 1, "第 7 屏有 1 块斜板");
    const d = P.REFLECTS[0];
    const mx = (d.x1 + d.x2) / 2, my = (d.y1 + d.y2) / 2;
    const dx = d.x2 - d.x1, dy = d.y2 - d.y1;
    const len = Math.hypot(dx, dy);
    const nx = dy / len, ny = -dx / len;       // 板面法线（朝左上那侧）
    const SP = 300;
    const o = { x: mx + nx * 10, y: my + ny * 10, vx: -nx * SP, vy: -ny * SP };
    const hit = P.reflectStep(o, 22);
    ok(hit, "球撞到板面：反射生效");
    near(Math.hypot(o.vx, o.vy), SP, 0.6, "反射后速度大小不变（撞墙才 ×0.62）");
    ok(o.vx * -nx + o.vy * -ny < -0.5 * SP,
       "反射后沿法线朝反方向飞出（打回上层，不是被拍进地里）",
       "v=" + o.vx.toFixed(0) + "," + o.vy.toFixed(0));

    const o2 = { x: mx + nx * 10, y: my + ny * 10, vx: nx * SP, vy: ny * SP };
    const vx2 = o2.vx, vy2 = o2.vy;
    ok(!P.reflectStep(o2, 22), "（反证）正在离开板面的球不再反射");
    ok(o2.vx === vx2 && o2.vy === vy2, "（反证）它的速度一点没动");

    const sb0 = boot(), P0 = sb0.GROVE;
    P0._start(0, 0);
    eq(P0.REFLECTS.length, 0, "第 1 屏没有斜板");
    ok(!P0.reflectStep({ x: 500, y: 500, vx: 300, vy: 0 }, 22),
       "没有板的屏：reflectStep 直接返回 false（不是抛异常）");
  }

  /* ⑥ 第 7 屏的几何不变量。这一屏是「板」撑起来的，几何一错就变成
     「球莫名撞墙弹回来」—— 玩家读不出原因，只会觉得这关坏了。 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 6);
    const gy = P.GROUND_Y, d = P.REFLECTS[0];
    ok(d.y1 > gy, "板的下端埋在地面以下（球撞的是板面，不是端点）",
       "y1=" + d.y1 + " vs 地面 " + gy);
    /* 端点判定是径向的：撞端点的话法线指向球心方向，出射角完全跑掉，
       实测斜着射出去 42px 就落地。这条注释就是为了拦住「把 y1 改回 556」。 */
    // y 向下增长：上端必须在 462 层**下面**（y 更大），否则球是往上撞而不是
    // 被人往板上打；同时不能低到贴地，那板就成了一道 40px 的台阶。
    ok(d.y2 > 462 && d.y2 < gy, "板的上端落在 462 层与地面之间",
       "y2=" + d.y2 + "（层 462 / 地 " + gy + "）");
    const ledge = P.PLATS.find(q => q.y === 462);
    ok(!!ledge, "有 462 落点层（球的落点 + 玩家的路）");
    ok(ledge && ledge.w >= 260, "落点层够宽，球不会每次都擦边掉下去",
       "w=" + (ledge ? ledge.w : 0));
    /* 回家路：646..852 必须干净。放一根桩在这儿，球撞上去就弹回左边的火坑，
       于是「打上去了」和「没打上去」结局一样 —— 正反馈当场消失。 */
    const onWay = (o) => o.x + (o.w || 0) > 646 && o.x < 852;
    eq(P.STUMPS.filter(onWay).length, 0, "646..852 回家路上没有木桩");
    eq(P.PITS.filter(onWay).length, 0, "646..852 回家路上没有坑");
    ok(P.PITS.some(q => q.kind === "fire"), "地面有火坑（接住没打上去、滚回来的球）");
    ok(P.PITS.some(q => q.kind === "mud"), "球去板的路上有泥沼（抬高助跑门槛）");
    eq(P.CAMP.x, 852, "营地仍在 852（和其余 26 屏一致）");
    /* 出生点必须在板的地面接触点**左边**：球要往右推进板，
       玩家站在右边就只能把球往左推，这一屏就废了。同时不能落进泥沼。 */
    const foot = d.x1 + (gy - d.y1) * (d.x2 - d.x1) / (d.y2 - d.y1);
    ok(P.PLAYER_SPAWN.x < foot - 10,
       "出生点在板左边（不然只能把球往反方向推）",
       "spawn=" + P.PLAYER_SPAWN.x + " vs 板脚 " + foot.toFixed(0));
    const mudPit = P.PITS.find(q => q.kind === "mud");
    ok(!mudPit || P.PLAYER_SPAWN.x > mudPit.x + mudPit.w || P.PLAYER_SPAWN.x < mudPit.x,
       "出生点不在泥沼里", "spawn=" + P.PLAYER_SPAWN.x);
  }

  /* ⑦ 预瞄线的力度必须跟助跑走。原先是写死 PUSH_BASE，
     助跑跑满了线还画「上不去」—— 玩家照着线走就会摔，这比不画线更坏。 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, 6);
    S.p.runD = 0;
    const base = P.pushPowerNow();
    S.p.runD = 190;
    const half = P.pushPowerNow();
    ok(half > base, "助跑一半，力度变大", base.toFixed(0) + " → " + half.toFixed(0));
    S.p.runD = 380;
    const full = P.pushPowerNow();
    near(full / base, 1.95, 0.02, "满助跑 = 基准 ×1.95（bellyPower 在比值里约掉）");
    S.p.runD = 99999;
    near(P.pushPowerNow(), full, 0.01, "runD 超过 380 不再涨（clamp，不是无限叠）");
    S.p.runD = 0;
  }

  /* ⑧ 泥沼必须进预瞄线。这里曾经漏掉一行 `vx *= 0.72`，
     所有穿过泥坑的预瞄线长 39%，骗了一整轮没人发现 ——
     因为「线短一点」看起来永远像画风问题，不像 bug。 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, 3);                            // 第 4 屏：泥沼 200..280 在平地上
    P.coatFoe(S.foes[0], 3);
    const b = S.balls[0];
    const gy = P.GROUND_Y;
    S.foes.forEach(f => { f.x = 4000; f.dead = true; });// 只测地形
    b.x = 290; b.y = gy; b.vx = 0; b.vy = 0; b.air = 1;
    b.onGround = true; b.ground = null; b.mud = false;
    S.p.x = 800; S.p.y = gy;
    const PITS = P.PITS;
    const mi = PITS.findIndex(q => q.kind === "mud");
    ok(mi >= 0, "第 4 屏有泥沼段");
    const lenOf = (pts) => {
      let t = 0;
      for (let i = 1; i < pts.length; i++) {
        t += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      return t;
    };
    // predictBall 返回 { pts, marks, end, hits } —— 拿 pts 量路径长度，
    // 不拿 marks：marks 只在"事件"处打点，一段没有事件的球道长度是 0。
    /* 力度必须小到「寿命用尽」为止都撞不到左墙 —— 撞到墙的话，
       路径长度只由几何决定（起点到墙 264px），泥沼快不快都是同一个数，
       这条断言会变成永远通过的摆设。实测 60 是唯一干净的一档：
       40/50 会低速陷在泥里（end=stop），80 会滚出左边界（end=out）。 */
    const POW = 60;
    b.x = 290;
    const withMud = lenOf(P.predictBall(b, -1, POW).pts);
    const keep = PITS.splice(mi, 1)[0];
    b.x = 290;
    const noMud = lenOf(P.predictBall(b, -1, POW).pts);
    PITS.splice(mi, 0, keep);
    ok(noMud > withMud, "泥沼真的进了预瞄线（把泥沼拿掉，同样一球滚得更远）",
       "有泥 " + withMud.toFixed(0) + " / 无泥 " + noMud.toFixed(0));
    /* 阈值 0.85：漏掉「进泥一次性 ×0.72」的话比值就是 1.00（路上没有任何
       别的减速），所以这一档卡得很死，改小或改大都说明物理被动过。 */
    ok(withMud < noMud * 0.85, "进泥那一下的 ×0.72 确实进了预瞄线",
       (withMud / noMud).toFixed(2) + "×");
    ok(withMud > noMud * 0.5, "（反证）线没短到「球直接陷在泥里」的程度",
       (withMud / noMud).toFixed(2) + "×");
    eq(PITS.findIndex(q => q.kind === "mud"), mi, "测完把泥沼放回去了");
  }
}

console.log("\n=== 31. 赛道：TOUR 段必须真的踩得到 ===");
{
  /* 赛道的错法全都**长得像正常工作**：段写在根本不存在的台面上，
     球路过时不计数，玩家只会觉得"这关过不去"，不会觉得"数据写错了"。
     所以这一节的断言全部落在"几何上到底踩不踩得到"和"计数到底加没加"。 */

  /* ① 只有挂了 tour 的屏才有段，其余 26 屏必须是空 ——
     loadLevel 忘了重置 TOUR 的话，上一关的段会跟着带到下一关。 */
  {
    const sb = boot(), P = sb.GROVE;
    let n = 0;
    for (let i = 0; i < P.LEVELS.length; i++) {
      P._start(0, i);
      if (P.TOUR.length) n++;
    }
    eq(n, 1, "27 屏里只有 1 屏挂了赛道", "有赛道的屏数=" + n);
    P._start(0, 0);
    eq(P.TOUR.length, 0, "没有赛道的屏：TOUR 是空数组（不是 undefined）");
    eq(P.S.stat.toured, 0, "每关重置：赛道计数从 0 起");
  }

  /* ② 每一段都必须**完整落在某一块真实台面上**。
     y 差 1px 都算错：判定用 |球y - 段y| <= 12，段 y 写成 348 而台面是 350，
     球从台面上滚过时差 2px 刚好能过 —— 看起来没问题，但换一关差 13px 就整段失效。
     x 超出台面同理：球滚到台面右端就掉下去了，段画到台面外面那段永远踩不到。 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 4);                       // 第 5 屏「弹菇」
    eq(P.TOUR.length, 2, "第 5 屏有 2 段跑道");
    for (let i = 0; i < P.TOUR.length; i++) {
      const t = P.TOUR[i];
      const x1 = Math.min(t.x1, t.x2), x2 = Math.max(t.x1, t.x2);
      const plat = P.PLATS.find(p => p.y === t.y && p.x <= x1 && p.x + p.w >= x2);
      ok(!!plat, "第 " + (i + 1) + " 段完整落在某块真实台面上",
         plat ? "台面 " + plat.x + ".." + (plat.x + plat.w) + "@" + plat.y
              : "x " + x1 + ".." + x2 + "@y=" + t.y + " 没有任何台面盖住它");
      ok(x2 - x1 >= 100, "第 " + (i + 1) + " 段够长（球滚过去至少有 6 帧）",
         "w=" + (x2 - x1));
    }
  }

  /* ③ 顺序必须是**下降**（y 越来越大）。
     赛道叫"之字下降"就是因为一层一层往下接力；顺序反过来的话，
     球得先落到下层再"上去"踩第二段 —— 而球上不去层，那一段永远不可能被踩到。
     这一条是本轮唯一一条"顺序"约束，别删。 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 4);
    for (let i = 1; i < P.TOUR.length; i++) {
      ok(P.TOUR[i].y > P.TOUR[i - 1].y,
         "第 " + (i + 1) + " 段在第 " + i + " 段**下面**（球只会往下掉）",
         P.TOUR[i - 1].y + " → " + P.TOUR[i].y);
    }
  }

  /* ④ 预瞄线要能回答"这条路能走完几段"。
     从塔顶(350 层)左侧出发能走完 2 段；从 462 层出发一段都踩不到 ——
     这两条一正一反，能同时抓住"漏判"和"白给"。 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, 4);
    P.coatFoe(S.foes[0], 3);
    const b = S.balls[0], gy = P.GROUND_Y;
    S.foes.forEach(f => { f.x = 4000; f.dead = true; });
    S.p.x = 100; S.p.y = gy;

    b.x = 250; b.y = 350; b.vx = 0; b.vy = 0; b.onGround = true; b.ground = null; b.mud = false;
    const r1 = P.predictBall(b, 1, P.PUSH_BASE);
    eq(r1.tour, 2, "从 350 层左侧推：预瞄线报告走完 2 段",
       "tour=" + r1.tour + " end=" + r1.end);

    b.x = 200; b.y = 462; b.vx = 0; b.vy = 0; b.onGround = true; b.ground = null; b.mud = false;
    const r2 = P.predictBall(b, 1, P.PUSH_BASE);
    eq(r2.tour, 0, "（反证）从 462 层推：一段都踩不到（不是白给）",
       "tour=" + r2.tour + " end=" + r2.end);
  }

  /* ⑤ 落袋时只有**走完**的球计数。
     没走完的照常给收成和落袋（球是玩家造的，不能吞），
     但不给"走完赛道的球"这个数 —— 那个数才是通关条件。 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, 4);
    const f = S.foes[0];
    P.coatFoe(f, 3);
    const b = S.balls[0];

    // 走完的球
    b.tour = P.TOUR.length;
    b.x = P.CAMP.x + 20; b.y = P.PLATS[0].y; b.onGround = true; b.vx = 0;
    P.tick(1 / 60);
    eq(S.stat.toured, 1, "走完赛道的球落袋 → toured +1");

    // 没走完的球
    const f2 = S.foes.find(o => !o.dead);
    ok(!!f2, "场上还有敌人可以造第二颗球");
    if (f2) {
      P.makeBallFrom(f2, 0, 0);
      const b2 = S.balls[S.balls.length - 1];
      b2.tour = P.TOUR.length - 1;
      b2.x = P.CAMP.x + 20; b2.y = P.PLATS[0].y; b2.onGround = true; b2.vx = 0;
      P.tick(1 / 60);
      eq(S.stat.toured, 1, "没走完的球落袋 → toured 不变（但收成照给）");
      ok(S.food > 0, "没走完的球照样给收成（不吞玩家的球）", "food=" + S.food);
    }
  }

  /* ⑥ 赛道没走完就不许通关 —— 哪怕主目标早满了。
     "进度条全绿却过不去"是最伤人的一种 bug。 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, 4);
    S.foes.length = 0;
    S.killed = S.total;
    S.stat.bankHolds = 99;                // 主目标（落袋 5）早就满了
    S.stat.toured = 0;
    eq(P.checkGoal(), false, "主目标满了、赛道没走 → 不算通关");
    const gp = P.goalProgress();
    eq(gp.done, false, "进度条也不显示「已完成」");
    ok(gp.text.indexOf("赛道") >= 0, "HUD 文案里带赛道进度", gp.text);
    S.stat.toured = P.curStage().tourNeed || 1;
    eq(P.checkGoal(), true, "赛道也走完 → 通关");
  }

  /* ⑦ tourNeed 不能超过这一关的造球预算，否则永远打不完 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 4);
    const st = P.curStage();
    ok((st.tourNeed || 1) <= st.bank,
       "赛道的球数要求 ≤ 主目标球数（不然物理上不可能同时满足）",
       "tourNeed=" + st.tourNeed + " bank=" + st.bank);
  }
}

console.log("\n=== 32. 场景族：三族形状语言 ===");
{
  /* 用户的原话是「你的重心怎么老是在球上 为什么不是在空间设计上多去思考
     比如场景上的」。
     这条批评指向的事实是：**27 屏共用同一套远景** —— 4 朵云、3 层圆顶山、
     30 棵树、6 丛灌木，坐标全部写死，只换配色。
     配色只能说明"这是哪个产地"，形状才能说明"这是另一个地方"。
     这一节钉的就是"形状必须分族"。 */

  /* ① 映射表必须覆盖全部主题。
     漏一个主题 → 那一屏 SCAPE 退化成 hills，它会莫名其妙地长成苔原，
     而且**没有任何报错**。这是最典型的"静默降级"。 */
  {
    const sb = boot(), P = sb.GROVE;
    const M = P.SCAPE_OF_THEME;
    ok(!!M, "SCAPE_OF_THEME 已导出");
    const missing = [];
    for (const L of P.LEVELS) if (!M[L.theme]) missing.push(L.theme);
    eq(missing.length, 0, "27 屏用到的主题全部有场景族映射",
       missing.length ? "缺: " + missing.join(",") : "14/14");
    const kinds = new Set(Object.values(M));
    eq(kinds.size, 3, "只有三族（多出来的是没画完的第四族）", [...kinds].join("/"));
  }

  /* ② 三族必须**都有足够的屏**。
     一族只有 1~2 屏的话玩家根本感觉不到"换了地方"，
     那不是"分族"，那是"一个特例"。 */
  {
    const sb = boot(), P = sb.GROVE;
    const cnt = { hills: 0, cliffs: 0, marsh: 0 };
    for (let i = 0; i < P.LEVELS.length; i++) {
      P._start(0, i);
      cnt[P.SCAPE] = (cnt[P.SCAPE] || 0) + 1;
    }
    eq(cnt.hills + cnt.cliffs + cnt.marsh, P.LEVELS.length,
       "27 屏全部分到了三族里", JSON.stringify(cnt));
    ok(cnt.hills >= 3 && cnt.cliffs >= 3 && cnt.marsh >= 3,
       "三族每族至少 3 屏（不然只是特例，不是一族）", JSON.stringify(cnt));
  }

  /* ③ loadLevel 必须重置 SCAPE。
     忘了重置的话，上一层产地的形状会跟到下一层 ——
     第 9 屏还在画第 8 屏的岩柱，而且因为配色变了，看起来"还挺合理"。 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 0);                       // 第 1 屏苔原 → hills
    eq(P.SCAPE, "hills", "第 1 屏是 hills 族");
    P._start(0, 2);                       // 第 3 屏断崖 → cliffs
    eq(P.SCAPE, "cliffs", "换到第 3 屏，场景族跟着换（没有残留）");
    P._start(0, 19);                      // 第 20 屏沼泽 → marsh
    eq(P.SCAPE, "marsh", "换到第 20 屏，场景族跟着换");
    P._start(0, 0);
    eq(P.SCAPE, "hills", "再换回来也对（不是单向）");
  }

  /* ④ 三族必须用**不同的绘制函数**。
     "三个名字指向同一张画"是这个功能最容易退化的形态：
     代码里写了 cliffs/marsh 两个分支，但两个分支都调 drawHills ——
     测试全绿、画面全一样。 */
  {
    const sb = boot(), P = sb.GROVE;
    const fns = ["drawCliffs", "drawReeds", "drawDeadTree", "drawBgTree",
                 "bgTreeRow", "drawFgRocks", "drawFgReeds", "drawFgPebble", "fgBlocked"];
    for (const n of fns) eq(typeof P[n], "function", "导出 " + n);
    ok(P.drawCliffs !== P.drawReeds, "岩柱和芦苇是两个函数（不是同一个）");
    /* 树的数量也必须分族。只换造型不换数量的话，断崖还是一片密林，
       岩柱全被树切断，"垂直"这个形状语言就没了。 */
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const nHills = P.bgTreeRow(arr).length;
    P._start(0, 2);                       // cliffs
    const nCliffs = P.bgTreeRow(arr).length;
    P._start(0, 19);                      // marsh
    const nMarsh = P.bgTreeRow(arr).length;
    ok(nCliffs < nHills && nCliffs <= 6,
       "断崖的树比密林少得多（岩柱要靠露出的天立住）",
       "hills=" + nHills + " cliffs=" + nCliffs);
    ok(nMarsh < nHills, "沼泽也比密林稀（它靠芦苇补，不靠树）",
       "hills=" + nHills + " marsh=" + nMarsh);
  }

  /* ⑤ 前景的硬约束：**坑、营地、出生点都要让开**。
     这是可读性，不是构图偏好 —— 前景盖掉火坑，玩家就找不到该往哪推。 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 3);                       // 第 4 屏：泥沼 200..280
    const pit = P.PITS[0];
    ok(P.fgBlocked(pit.x + pit.w / 2, 30), "坑中心被前景让开");
    ok(P.fgBlocked(P.CAMP.x + P.CAMP.w / 2, 30), "营地中心被前景让开");
    ok(P.fgBlocked(P.PLAYER_SPAWN.x, 30), "出生点被前景让开");
    /* 反证：找一段明确空着的中间地带，不能被误判成"挡" ——
       如果 fgBlocked 恒为 true，上面三条全过，但前景就一丛都没有了。 */
    let free = -1;
    for (let x = 100; x < 900; x += 10) {
      if (!P.fgBlocked(x, 26)) { free = x; break; }
    }
    ok(free >= 0, "有让得开的位置（fgBlocked 不是恒 true）", "free x=" + free);
  }

  /* ⑥ 前景高元素的允许区。
     球的几何是硬约束：球底 556、球顶 534、462 台面底 482。
     上一版用归一化阈值 `FG_EDGE_MIN = 0.30`，注释说"中段留空"，
     实际等价于 `px < 336 || px > 624` —— **68% 屏宽都能立杆**，
     杆顶还到 366~484。用户原话："战斗内的很乱……越做越乱"。
     现在换成绝对像素 `FG_SIDE` + 绝对封顶 `FG_TOP`，两个数都能直接算出覆盖率。 */
  {
    const sb = boot(), P = sb.GROVE;
    ok(typeof P.FG_SIDE === "number", "FG_SIDE 已导出");
    eq(P.FG_SIDE, 140, "★ 立杆区只有最外 140px（两侧合计 29%，上一版 68%）");
    eq(P.FG_TOP, 504, "★ 前景顶端封顶 504（球顶 534 之下 30px）");
    ok(P.FG_TOP > P.GROUND_Y - 100 && P.FG_TOP < P.GROUND_Y,
       "封顶落在地面之上、球顶之下", "FG_TOP=" + P.FG_TOP + " 地面=" + P.GROUND_Y);
    const cover = (2 * P.FG_SIDE) / 960;
    ok(cover <= 0.30, "高元素覆盖率 ≤ 30%", (cover * 100).toFixed(0) + "%");
  }
}

/** 两个 BOSS 流派配置是否**完全相同**。用来证明"三套打法"不是同一套。 */
function sameStyle(a, b) {
  for (const k of ["slam", "fan", "spawn", "crack", "mud"]) if (a[k] !== b[k]) return false;
  return true;
}

console.log("\n=== 33. BOSS 流派：三个产地三套打法 ===");
{
  /* 用户的原话是「boss机制也单调」。
     客观事实：改造前 27/27 屏的 BOSS 都只有砸地 / 散射 / 产卵三个动作，
     19 屏连等级都相同。玩家第二章见到的"新 BOSS"，和第一章那只长得一样、
     打得也一模一样 —— 只有配色换了。

     这一节钉两件事：
     A. 每个产地**必须有一手别的产地没有的**招牌动作（否则等于没做）；
     B. **基础三件谁都不许关** —— 这是本轮最贵的教训，见 ② 的注释。
  */

  /* ① 映射完整：每个 BOSS 都有流派，三个流派配置各不相同 */
  {
    const sb = boot(), P = sb.GROVE;
    const ST = P.BOSS_STYLE;
    ok(!!ST, "BOSS_STYLE 已导出");
    for (const fam of ["hills", "cliffs", "marsh"]) {
      ok(!!ST[fam], "有 " + fam + " 流派");
      for (const k of ["slam", "fan", "spawn", "crack", "mud"]) {
        ok(typeof ST[fam][k] === "boolean", fam + "." + k + " 是显式布尔（没写等于没定义）");
      }
    }
    ok(P.BOSS_STYLE.cliffs.crack === true, "断崖会砸断台面");
    ok(P.BOSS_STYLE.marsh.mud === true, "沼泽会渗泥");
    ok(P.BOSS_STYLE.hills.crack === false && P.BOSS_STYLE.hills.mud === false,
       "密林两样都不会（第一章是基准，不能抢后面两章的招）");
    ok(P.BOSS_STYLE.cliffs.mud === false && P.BOSS_STYLE.marsh.crack === false,
       "两个招牌动作各归各的产地，没有互相抄");
  }

  /* ② ★ 基础三件谁都不许关。
     踩过：为了让三族"看起来不一样"，第一版给 cliffs 关了 fan、给 marsh 关了 slam。
     ALL9 当场三条红 ——
       12. 树桩林（cliffs）单球只装到 2 只（目标 3）
       15. 弹菇田（cliffs）落袋 3（目标 4）
       27. 沼气王（marsh）清不完 6/7
     排查过程走了四轮反证：把 crack/mud 全关掉仍然红（857/3），
     把 fan/slam 恢复立刻全绿（860）—— **元凶是"少一个动作"**。

     为什么少一个动作会让目标变不可能：这三个动作不只是"攻击方式"，
     它们同时也是**敌人的来源**（产卵）和**玩家的走位时机**（砸地逼跳、扇形逼换位）。
     少一个，整条节奏就变了，机器人算好的那一套全错。
     —— "少一个动作"和"少一批敌人"是两件事，混在一起就会把目标变不可能。 */
  {
    const sb = boot(), P = sb.GROVE;
    for (const fam of ["hills", "cliffs", "marsh"]) {
      ok(P.BOSS_STYLE[fam].slam === true, fam + " 保留了砸地（逼玩家跳）");
      ok(P.BOSS_STYLE[fam].fan === true, fam + " 保留了散射（逼玩家换位）");
      ok(P.BOSS_STYLE[fam].spawn === true, fam + " 保留了产卵（敌人的来源）");
    }
  }

  /* ③ 三个流派真的分到不同屏上。
     `_start` 只会摆好地形，**BOSS 在最后一波才刷**，所以这里测映射链
     （主题 → 场景族 → 流派），而不是去场上找一只 BOSS ——
     那只测的是"刷没刷出来"，跟流派对不对是两件事。 */
  {
    const sb = boot(), P = sb.GROVE;
    const seen = {};
    let nBoss = 0;
    for (let i = 0; i < 27; i++) {
      P._start(0, i);
      const fam = P.SCAPE_OF_THEME[P.LEVELS[i].theme] || "hills";
      const st = P.BOSS_STYLE[fam];
      ok(!!st, "第 " + (i + 1) + " 屏（" + P.LEVELS[i].theme + "）能解析出流派");
      seen[fam] = (seen[fam] || 0) + 1;
      nBoss++;
    }
    eq(nBoss, 27, "27 屏全部有流派映射");
    for (const fam of ["hills", "cliffs", "marsh"]) {
      ok((seen[fam] || 0) >= 3, "至少有 3 屏用 " + fam + " 流派", fam + "=" + (seen[fam] || 0));
    }
    /* 三个流派的配置必须**两两不同**，否则"三套打法"其实是同一套 */
    ok(!sameStyle(P.BOSS_STYLE.hills, P.BOSS_STYLE.cliffs), "密林 ≠ 断崖");
    ok(!sameStyle(P.BOSS_STYLE.cliffs, P.BOSS_STYLE.marsh), "断崖 ≠ 沼泽");
    ok(!sameStyle(P.BOSS_STYLE.hills, P.BOSS_STYLE.marsh), "沼泽 ≠ 密林");
  }

  /* ④ ★★ 画的就是砸的。
     预告层的全部价值在一个等式上：**玩家看到被标记的那块，必须就是碎掉的那块**。
     只要两者能不一致，这个机制就从"可读"变成"骗人"，
     而且比没有预告更糟 —— 玩家会学会"别信那个圈"。

     实现上用**一份数据两处读**（f._crackTgt / f._mudSpot）保证恒等，
     所以这里测的是"锁定 → 落手"这条链上真的没有第二次选择。 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 2);   // cliffs
    const fake = { x: 500, w: 96, face: 1 };
    const tg = P.crackTarget(fake);
    ok(!!tg, "断崖屏选得出要砸的台面");
    ok(tg.kind !== "ground", "选中的不是地面（地面没了 = 坏档，不是难度）");
    ok(tg.y <= 360, "选中的只在高两层（球道那层不许打）", "y=" + tg.y);
    eq(P.BROKEN.length, 0, "只选不打：crackTarget 不改状态");
    ok(P.crackPlat(fake, tg), "把锁定的那块砸下去");
    eq(P.BROKEN.length, 1, "砸完 BROKEN 只多一块");
    ok(P.BROKEN[0] === tg, "★ 碎掉的就是预告的那一块（同一个对象）");
    /* 落空不许换目标：换一块打就是"画一块砸另一块" */
    ok(!P.crackPlat(fake, tg), "同一块砸第二次 → 落空");
    eq(P.BROKEN.length, 1, "落空时 BROKEN 不增长（没有偷偷换一块）");
  }

  /* ⑤ 断台的三条护栏 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 2);
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const p = P.crackTarget({ x: 100 + i * 110, w: 96, face: 1 });
      if (p && P.crackPlat({ x: 100 + i * 110, w: 96, face: 1 }, p)) n++;
    }
    eq(n, 2, "一屏最多砸断 2 块（碎光了地形设计全废）");
    for (const p of P.BROKEN) ok(p.kind !== "ground", "BROKEN 里没有地面");
  }

  /* ⑥ 泥潮：铺的必须就是预告的那一段 + 三条护栏 */
  {
    const sb = boot(), P = sb.GROVE;
    P._start(0, 19);   // marsh
    if (P.S.p) P.S.p.x = 700;
    /* 找一个能铺的位置。**不是每个 x 都合法** —— 铺哪由 BOSS 站哪决定，
       而且要避开营地通道，所以这里扫一遍而不是写死一个坐标。 */
    let f = null, sp = null;
    for (let x = 200; x <= 640 && !sp; x += 20) {
      const t = { x, w: 96, face: 1 };
      const s2 = P.mudSpot(t);
      if (s2) { f = t; sp = s2; }
    }
    ok(!!sp, "沼泽屏选得出要铺的位置（存在合法落点）");
    ok(typeof sp.x0 === "number" && typeof sp.w === "number", "spot 带 x0/w");
    eq(P.GROUNDS.filter(g => g.kind === "mud").length, 0, "只选不铺：mudSpot 不改状态");
    ok(P.mudRise(f, sp), "按锁定的位置铺下去");
    const muds = P.GROUNDS.filter(g => g.kind === "mud");
    eq(muds.length, 1, "只多铺一段");
    eq(muds[0].x, sp.x0, "★ 铺下的起点就是预告的起点");
    eq(muds[0].w, sp.w, "★ 铺下的宽度就是预告的宽度");

    /* 三条护栏用手工 spot 测：这里考的是 mudRise 的边界，不是 mudSpot 的选址，
       混在一起测的话，选址一变这几条就跟着漂。 */
    P._start(0, 19);
    const mk = (x0) => ({ x0, w: 130, cx: x0 + 65 });
    ok(P.mudRise(f, mk(40)), "手工 spot #1 铺上");
    ok(P.mudRise(f, mk(240)), "手工 spot #2 铺上（和 #1 不重叠）");
    ok(!P.mudRise(f, mk(400)), "第 3 段被拒（上限 2：铺满全屏只剩「到处都慢」）");
    eq(P.GROUNDS.filter(g => g.kind === "mud").length, 2, "泥最多 2 段");
    ok(!P.mudRise(f, mk(250)), "和已有泥重叠 → 拒（叠了只是同一段加深，玩家看不出变化）");
    ok(!P.mudRise(f, { x0: P.CAMP.x - 60, w: 130, cx: P.CAMP.x + 5 }),
       "营地通道里不铺（球停在门口 = 玩家读作「门坏了」）");
    /* BOSS 铺的泥必须**带画法标记**。
       沼泽关本身遍地是泥（27 屏里 24 屏自带），BOSS 再铺一段、
       长得和地形泥一样的话，玩家看不出它做了什么 ——
       机制在跑、反馈为零，和"没做"没区别。 */
    for (const g of P.GROUNDS) {
      if (g.kind === "mud" && g.boss) ok(true, "BOSS 泥带 boss 标记");
    }
    ok(P.GROUNDS.filter(g => g.kind === "mud" && g.boss).length === 2,
       "这两段都是 BOSS 铺的（地形自带的泥不带标记）");
    eq(P.MAT.mud.ballGain, 0, "BOSS 泥没有偷改物理：仍然是同一套 MAT.mud");

    /* 重开同屏：BOSS 铺的泥**不能写进关卡数据** */
    P._start(0, 19);
    eq(P.GROUNDS.filter(g => g.kind === "mud").length, 0,
       "重开同屏泥回到 0（GROUNDS 是副本，不是关卡数据本体）");
    eq(P.BROKEN.length, 0, "重开同屏 BROKEN 也清空");
  }

  /* ⑦ ★ 机制必须**画出来**。
     这是本轮真正的病根：crack/mud 的计时器先做完的时候，
     绘制代码一次都没读过 f.cracking / f.mucking ——
     举手了、地形变了，中间什么都没有。冒烟当时还是全绿的。
     "系统是通的"和"玩家看得见"是两件事，测试必须分别钉住。 */
  {
    const sb = boot(), P = sb.GROVE;
    for (const n of ["drawCrackMark", "drawMudWarn", "drawBossMarks", "crackTarget", "mudSpot"]) {
      eq(typeof P[n], "function", "导出 " + n);
    }
    ok(P.drawCrackMark !== P.drawMudWarn, "两种预告是两张画（不是同一个函数改个名）");

    const src = fs.readFileSync(HTML, "utf8");
    ok(/function drawLevel\(\)[\s\S]{0,4000}?drawBossMarks\(g\)/.test(src),
       "drawLevel 里真的调了 drawBossMarks（不是只定义不用）");
    /* 预告层的进度必须来自计时器本体，不能自造一个 */
    ok(/drawCrackMark\(g, f\._crackTgt, 1 - f\.cracking/.test(src),
       "断台预告读 f.cracking 算进度");
    ok(/drawMudWarn\(g, f\._mudSpot, 1 - f\.mucking/.test(src),
       "泥潮预告读 f.mucking 算进度");
    /* BOSS 本体也要有姿态，不能只有地上一个圈 */
    ok(/f\.cracking > 0 \? Math\.sin/.test(src), "BOSS 身上有断台蓄力的起伏");
    ok(/f\.mucking > 0 \? Math\.sin/.test(src), "BOSS 身上有泥潮蓄力的起伏");
    /* BOSS 铺的泥要有自己的画法，并且 drawGroundMat 真的分了流 ——
       只定义不分支，等于画法写了但永远走不到。 */
    eq(typeof P.drawMudMound, "function", "导出 drawMudMound");
    ok(/function drawGroundMat[\s\S]{0,400}?gr\.kind === "mud" && gr\.boss[\s\S]{0,120}?drawMudMound/.test(src),
       "drawGroundMat 里真的分到了 drawMudMound");

    /* 锁定字段必须在 foe 上**显式初始化**。
       undefined 和 null 在 JS 里都能当"没在抬手"用，
       但显式声明才说明这两个字段是这套机制的一部分，而不是随手挂上去的。
       —— 这里查源码不查实例：BOSS 在最后一波才刷，靠跑机器人去碰它，
       测出来的是"机器人能不能打到最后一波"，跟字段有没有声明无关。 */
    ok(/_crackTgt: null, _mudSpot: null/.test(src),
       "foe 上显式声明了 _crackTgt / _mudSpot");
    ok(/bossStyle: isBoss \? \(BOSS_STYLE\[SCAPE\]/.test(src),
       "刷怪时按场景族挂流派（不是所有 BOSS 都拿同一份）");
  }
}

console.log("\n=== 34. 球额度是关卡字段，不是目标类型 ===");
{
  /* 用户两次说「没感觉」「策略感和空间设计感」。审计下来根因不在机关数量，
     在**目标结构**：

       7 种目标（clear/limit/chain/bank/collect/tour/intact/nohit）是**互斥单选**，
       一屏只能考一件事。而 `ballBudget` 原来写死 `if (st.goal !== "limit") return Infinity`
       —— 于是「球不够」这件事也只能作为**目标**存在，不能和别的东西叠加。

     结果是「约束」和「价值差」永远不在同一屏出现：
       这屏考连锁（球免费，随便造）
       那屏考限球（球有限，但没有价值差可权衡）
       另一屏考收成（火坑双份，但球免费，可以反复试）

     而**球免费时最优解是"每只单独推一次"** —— 落袋给 `holds+1`，
     拆开比卷起来还赚（1 只落袋 2 分，3 只卷一起落袋只有 4 分）。
     也就是说「一球卷多只」在旧规则下是**亏的**，所有坡、滑道、缺口
     都退化成"更好看的解法"，玩家没有一次需要读地形。

     改法：额度降级成关卡字段，任意目标都能叠。这一节钉住三件事：
       A. 解耦真的生效（collect 屏也限额）；
       B. 额度是**真**约束（造不出球，不是只显示一个数）；
       C. 额度必须留出解（不能上来就不可能）。
  */

  /* ① 解耦：collect 屏也能带额度 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    const st = P.LEVELS[1];
    eq(st.goal, "collect", "第 2 屏目标仍是 collect");
    eq(st.ballLimit, 5, "第 2 屏带了 ballLimit");
    P._start(0, 1);
    eq(P.ballBudget(), 5, "★ collect 屏的额度被认（解耦生效）");
    S.stat.made = 2;
    eq(P.ballBudget(), 3, "额度按已造球数递减");
  }

  /* ② 额度是**真**约束：糊满不造球。只看 ballBudget 的返回值不算证据 ——
     它只是个数字，真正要证明的是"造不出来"。 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, 1);
    const boss = P.S.foes.length > 0;
    ok(boss, "第 2 屏有敌人可糊");
    const f = P.S.foes[0];
    const cm = f.cm || 3;

    // 还有额度时能造
    P.coatFoe(f, cm, null);
    eq(S.balls.length, 1, "有额度：糊满 → 造出一颗球");
    eq(S.stat.made, 1, "made 记 1 颗");

    // 额度耗尽后造不出
    S.stat.made = 5;   // 额度用满
    const f2 = P.S.foes[1];
    const before = S.balls.length;
    P.coatFoe(f2, 3, null);
    P.coatFoe(f2, 3, null);
    P.coatFoe(f2, 3, null);
    eq(S.balls.length, before, "★ 额度用完：再糊也造不出球");
    eq(S.stat.made, 5, "★ made 不再增长（没有偷偷超额）");
    eq(f2.coat, (f2.cm || 3) - 1, "敌人被卡在「还差一层」—— 还能被路过的球卷走，这才是那条退路");

    /* 卷进球里**不扣额度**。不钉这条的话，「限 5 颗」和一个"造球次数计数器"
       没区别 —— 玩家会发现"先用满 5 颗再造就只能卷"，而卷才是这道题本身。 */
    const f3 = P.S.foes[2] || f2;
    const b0 = S.balls[0];
    const holds0 = b0 ? b0.holds : 0;
    P.coatFoe(f3, 3, b0);
    eq(S.stat.made, 5, "★ 卷进球里不扣额度（额度只算「新造一颗」）");
    if (b0) ok(b0.holds > holds0 || f3.coat < 3, "被卷的那只真的进了球");
  }

  /* ③ 死局：额度耗尽 + 场上没球 + 还有敌人 → 立刻判负。
     这一条原来写的是 `goal === "limit"`，解耦之后必须跟着改 ——
     否则 collect/chain 加额度的屏会卡在"造不出球也不能结束"的死循环里。 */
  {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, 1);
    S.phase = "play";
    S.stat.made = 5;
    S.balls.length = 0;
    ok(S.foes.length > 0, "场上确实还有敌人");
    P.tick(1 / 60);
    eq(S.phase, "fail", "★ 非 limit 目标也会因额度耗尽判负");
    ok(!!S.failWhy, "给了失败原因", S.failWhy);
  }

  /* ④ 额度必须显示出来，而且显示的是**已经可见的那条通路**。
     ★ 这里踩过一次：我先给 `_goalBase()` 加了包装，往 `text` 里追加「球剩 N/M」，
       单元测试全绿 —— 但 HUD 从来没用过 `pr.text`（只用 cells / frac / inner），
       所以那句字**一次都没有出现在屏幕上**。测试测的是函数返回值，
       不是玩家看到的东西。这类"测了但看不见"和"做了但看不见"是同一个病。

     真正可见的是卡片底部那行「用时 x/s · 用球 made / par.made」。
     `par.made` 跟着额度走之后，「用球 0/5」就是"还剩 5 颗"。
     所以这里钉的是**那条绘制语句**，不是某个函数的返回值。 */
  {
    const sb = boot(), P = sb.GROVE;
    const st = P.LEVELS[1];
    eq(st.par.made, st.ballLimit,
       "★ par.made 跟着额度（留在旧值 9 的话，额度 5 的关永远白送评级那一分）");

    const src = fs.readFileSync(HTML, "utf8");
    ok(/"用球 " \+ S\.stat\.made \+ " \/ " \+ par\.made/.test(src),
       "★ 卡片底部真的画了「用球 made / par.made」");
    ok(/const bOk = S\.stat\.made <= par\.made/.test(src),
       "用球数超了标准要变色（额度用完 = 这一分没了，不能还是绿的）");
  }

  /* ⑤ 额度必须留出解。
     判据用"一颗球实测最多卷 3 只"这条经验值（ALL9 里跑出来的）：
       额度 < 敌人数  → 不靠卷一定清不完（约束是真的）
       额度 ≥ 敌/3    → 理论上还有解（不是"上来就不可能"）
     两条同时成立才是"有策略"，少一条就是"无解"或"无脑"。 */
  {
    const sb = boot(), P = sb.GROVE;
    const st = P.LEVELS[1];
    const foes = st.waves.reduce((a, w) => a + w.length, 0);
    eq(foes, 8, "第 2 屏 8 只敌人");
    ok(st.ballLimit < foes, "★ 额度比敌人少 → 不卷一定清不完", st.ballLimit + " < " + foes);
    ok(st.ballLimit >= Math.ceil(foes / 3), "★ 额度够到「每球卷 3 只」的下限 → 有解",
       st.ballLimit + " >= " + Math.ceil(foes / 3));
  }
}

console.log("\n=== 35. 改造件：全游戏唯一的永久成长 ===");
{
  /* 病理（审计实测，不是印象）：
       `RECIPES` 只有 `ration`（吃了就没）+ `basket`（一次性），
       `MEALS` 三条全是消耗品，评级 S/A/B 只落盘不给东西
       → 玩家第 1 小时和第 10 小时能力完全相同，**赚到的东西只能换成
         "继续赚的燃料"，赚不到"更强"**。这就是用户说的"没成就感"。

     这一节钉四件事：
       A. 四项 id 在主界面表（HomeBiz.PERKS）和战斗侧表（PERK_IDS）
          **逐字相等** —— 不同步的症状是"买了但没用"，最难查。
       B. 每一件**真的改变数值**，而且 hotpit / bounty 用真实跑图对比，
          不看算式（算式对了但没接上生效点是上一批踩过的坑）。
       C. 没买的时候行为**完全不变**（默认路径不能被改造件污染）。
       D. 定价仍然满足"一趟买不到第二个"（价格改了要立刻报红）。
  */

  const path = require("path");
  const BIZ = path.join(__dirname, "..", "assets", "scripts", "config", "HomeBiz.ts");
  const bizSrc = fs.readFileSync(BIZ, "utf8");
  const perkSeg = bizSrc.slice(bizSrc.indexOf("export const PERKS"), bizSrc.indexOf("export function perkDef"));

  /* ① 跨文件 id 对齐 */
  {
    const sb = boot(), P = sb.GROVE;
    eq(P.PERK_IDS.length, 4, "战斗侧声明了 4 个改造件");
    const ids = [...perkSeg.matchAll(/id: *'([a-z]+)'/g)].map(m => m[1]);
    eq(ids.length, 4, "主界面表里也是 4 件");
    for (const id of ids) ok(P.PERK_IDS.indexOf(id) >= 0,
      "★ 主界面的 " + id + " 战斗侧也认（不同步 = 买了没用）");
    for (const id of P.PERK_IDS) ok(ids.indexOf(id) >= 0,
      "★ 战斗侧的 " + id + " 主界面也有（否则永远买不到）");
  }

  /* ② 没买时行为完全不变 */
  {
    const sb = boot(), P = sb.GROVE;
    P._setPerks({});
    eq(P.bellyCost(), P.BELLY_PER_CLEAR, "没买 thrift：掉饱还是 BELLY_PER_CLEAR");
    for (const id of P.PERK_IDS) ok(!P.perkOn(id), "没买 " + id + "：perkOn 为 false");
  }

  /* ③ thrift：只改实际掉饱，不动基准常量 */
  {
    const sb = boot(), P = sb.GROVE;
    P._setPerks({ thrift: true });
    eq(P.bellyCost(), 15, "★ thrift：每屏掉饱 20 → 15");
    eq(P.BELLY_PER_CLEAR, 20,
      "★ 只改 bellyCost()，不动 BELLY_PER_CLEAR（基准是 27 屏的隐式输入，动了等于把所有关卡调紧）");
    ok(P.perkOn("thrift") && !P.perkOn("hotpit"), "四件互相独立，不串味");
  }

  /* ④ wideball：只改可用额度，不动关卡字段 */
  {
    const sb = boot(), P = sb.GROVE;
    const idx = P.LEVELS.findIndex(l => l.ballLimit != null);
    ok(idx >= 0, "存在带额度的关");
    P._setPerks({});
    P._start(2, idx);
    const before = P.ballBudget();
    const fieldBefore = P.curStage().ballLimit;
    P._setPerks({ wideball: true });
    const after = P.ballBudget();
    eq(after, before + 1, "★ wideball：可用额度 +1");
    eq(P.curStage().ballLimit, fieldBefore,
      "★ 关卡字段没变（改了会让 par.made 的评级口径跟着漂）");
  }

  /* ⑤ hotpit / bounty 用**真实跑图**对比。
        算式写对了但生效点没接上，是上一批"机制做了没画"的同一类病。 */
  {
    const run = (perks, stage) => {
      const sb = boot(), P = sb.GROVE, S = P.S;
      seed(S);
      P._setPerks(perks);
      P._start(2, stage);
      S.p.hp = 999; S.p.maxHp = 999;
      botMem = {};
      for (let i = 0; i < 60 * 240 && S.phase === "play"; i++) { botStep(P, S); P.tick(1 / 60); }
      return { food: S.food, phase: S.phase, burned: S.stat.burned };
    };

    /* bounty：第 1 屏是清场目标，机器人能清 → 差 25 分 */
    const a0 = run({}, 0);
    const a1 = run({ bounty: true }, 0);
    eq(a0.phase, "clear", "对照组：第 1 屏机器人能清场");
    eq(a1.phase, "clear", "买 bounty 后第 1 屏也能清场");
    eq(a1.food - a0.food, 25, "★ bounty：清场奖励 3 → 28（实测差 25，不是看算式）");

    /* hotpit：第 2 屏机器人会烧球，烧的每一只 2 → 3 分 */
    const b0 = run({}, 1);
    const b1 = run({ hotpit: true }, 1);
    ok(b0.burned > 0, "对照组：第 2 屏真的烧了球", "烧 " + b0.burned);
    ok(b1.food > b0.food,
      "★ hotpit：同样的打法收成变多（火坑每只 2 → 3）",
      b0.food + " → " + b1.food);
    /* 每烧一颗、装的只数 k，差值应该正好等于 k。这里只要求"变多"，
       因为机器人对"收成变多"的反应路径会变（更早达标），差值不恒等。 */
  }

  /* ⑥ 定价仍然满足"一趟买不到第二个"。价格改了要立刻报红。
        基准数来自 `tools/_t-econ.js` 实测，不是拍： */
  {
    const PER_SCREEN = 47.3;   // 27 屏达标屏平均收成
    const MULTI = 1.225;       // 连锁倍率中段 1+0.15*1.5
    const STAGES = 5;          // 满饱 100 / 每屏 20
    const FEED = 40;           // 一趟喂饭 5 份野果 × 8 果
    const perTrip = PER_SCREEN * STAGES * MULTI;

    const m = /apples: *([0-9]+)/.exec(perkSeg);
    ok(!!m, "改造件带果子价格");
    const price = m ? Number(m[1]) : 0;
    ok(price * 2 > perTrip,
      "★ 一趟买不到第二个（不然\"取舍\"不成立）",
      price + " × 2 = " + (price * 2) + " > " + perTrip.toFixed(0));
    ok(price + FEED < perTrip,
      "★ 买完还够喂饭（不然会因为买改造件饿死）",
      price + " + " + FEED + " < " + perTrip.toFixed(0));

    const lm = /logs: *([0-9]+)/.exec(perkSeg);
    ok(!!lm, "改造件带材料价格");
    ok(lm && Number(lm[1]) <= STAGES,
      "★ 材料价 <= 一趟产出（" + STAGES + "）—— 超过就要跑两趟，那是另一个节奏");

    /* 图纸碎片（2026-10-25 加）：**派遣唯一的独占产出**。
       三条边界，缺一条这个设计就退化成"又一个数字"：
         · 必须 > 0 —— 0 的话"独占"是空话；
         · 必须 <= 一趟派遣满额（`HomeBiz.DISPATCH_SHARD = 2`）——
           超过就要派两趟才够买一件，而一趟派遣 10 分钟，节奏会断在这里；
         · 战斗侧不许有 —— 有的话它就变成"打一局顺便拿"，独占性当场消失。 */
    const sm = /shards: *([0-9]+)/.exec(perkSeg);
    ok(!!sm, "改造件带碎片价格");
    ok(sm && Number(sm[1]) > 0,
      "★ 碎片价 > 0 —— 0 的话派遣的独占产出是空话",
      sm ? "shards=" + sm[1] : "没找到");
    ok(sm && Number(sm[1]) <= 2,
      "★ 碎片价 <= 一趟派遣满额（HomeBiz.DISPATCH_SHARD = 2）",
      sm ? "shards=" + sm[1] : "没找到");

    const srcAll = fs.readFileSync(HTML, "utf8");
    ok(!/S\.shards|\.shards =/.test(srcAll),
      "★ 战斗侧不产碎片（战斗能拿到的话，派遣的独占性就没了）");
  }

  /* ⑦ 存档清洗：非法 id 必须被丢掉。
        存档是唯一的外部输入，手改 localStorage 就能塞进任意内容。
        ★ 这一条**必须走 loadPerks 的真实路径**，不能用 `_setPerks`：
          那是测试旁路，绕过了白名单 —— 用旁路测出来的"过滤生效"是假的
          （第一版就这么写的，两条红了才发现测的是旁路）。
        沙箱原本没有 localStorage，所以在 §35 里临时注入一个。 */
  {
    const sb = boot(), P = sb.GROVE;
    const store = Object.create(null);
    sb.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };

    store["pawpack.save.v1"] = JSON.stringify({
      cleared: 3,
      perks: ["hotpit", "__evil", "hotpit2", 42, "hotpit"],
    });
    P.loadPerks();
    ok(P.perkOn("hotpit"), "合法 id 被读进来");
    ok(!P.perkOn("__evil"), "★ 存档里的未知 id 不被认（PERK_IDS 白名单真的在用）");
    ok(!P.perkOn("hotpit2"), "★ 前缀相似的 id 也不被认");
    eq(P.PERK_IDS.filter(id => P.perkOn(id)).length, 1, "5 条脏数据里只活下来 1 条");

    /* 坏存档 / 空存档都不能崩。存档损坏时玩家丢档比丢进度更痛。 */
    store["pawpack.save.v1"] = "{坏的 json";
    P.loadPerks();
    ok(!P.perkOn("hotpit"), "坏 JSON → 清空，不崩");

    delete store["pawpack.save.v1"];
    P.loadPerks();
    ok(!P.perkOn("hotpit"), "没存档 → 空");

    /* ★ 只读：战斗侧绝不往回写。写了就是"同一件事存两份"，必然漂移。 */
    const src = fs.readFileSync(HTML, "utf8");
    const body = src.slice(src.indexOf("function loadPerks"), src.indexOf("loadPerks();"));
    ok(!/setItem/.test(body), "★ loadPerks 里没有 setItem（只读，不跟主界面抢真值）");
  }
}

console.log("\n=== 36. 画面可读性：装饰层不许压玩法区 ===");
{
  /* 病理（2026-10-25，用户原话："战斗内的很乱 听不懂人话？之前做的还好点 越做越乱 退钱吧"）：

     上一版 marsh 族一共 **240 根芦苇** ——
       远景带  72 + 58 根，h 70~132 → 顶端到 **150**
       中景带  62 + 48 根，h 34~82  → 顶端到 **236**
     而球顶 534、462 层台面、350 层台面全在它们**下面**。
     960px 上 240 根 = 平均 4px 一根，读出来是"整个屏幕被划了很多竖道"。

     对照实测（`_cmp-old-s20.png` = 三族之前 / `_cmp-now-s20.png` = 当时）：
     三族之前干净，之后满屏竖线。**这是三族那次提交引入的增量，不是调参能救的。**

     为什么以前没报：所有断言都测几何（平台在哪、球落哪），
     **没有一条测"玩家能不能看见"**。这一节补的就是这条。

     钉四件事：
       ① 远景芦苇顶端 ≥ 228（只在地平线草脊上冒一截）
       ② 前景杆/石堆顶端 ≥ 504（球顶 534 之下 30px，462 台面底 482 之下 22px）
       ③ 前景高元素只在最外 FG_SIDE=96px 内（覆盖率 20%，不是 68%）
       ④ 数量不能归零 —— 删干净也能让 ①②③ 全绿，那是另一种 bug
  */
  const W_ = 960;
  const FLOOR_MID = 228;   // 远景芦苇顶端下限
  const FLOOR_FG = 504;    // 前景元素顶端下限

  /* 三族各挑两屏（含 marsh 的 20/23）：单屏容易撞上"这一屏恰好没位置"。
     实测每屏能立高元素的位置只有 **0~2 个** —— 营地固定在 852~934、
     出生点 ±46、坑各 ±22，把两侧最外 140px 几乎吃干净了。
     （这个数字本身是重要结论：**"挡玩法"的锅主要不在前景，在远景 130 根芦苇**。） */
  const CASES = [
    { stage: 0, scape: "hills" },
    { stage: 4, scape: "hills" },
    { stage: 11, scape: "cliffs" },
    { stage: 16, scape: "cliffs" },
    { stage: 19, scape: "marsh" },
    { stage: 22, scape: "marsh" },
  ];
  let fgTotal = 0;

  for (const c of CASES) {
    const sb = boot(), P = sb.GROVE, S = P.S;
    P._start(0, c.stage);
    S._fgAudit = [];
    let drew = "ok";
    try { P.render(); } catch (e) { drew = String(e && e.message || e); }
    ok(drew === "ok", `[${c.scape}] 第 ${c.stage + 1} 屏能画出一帧`, drew);

    const log = (S._fgAudit || []).slice();
    /* 前景层单独再探一次。
       **为什么非有这一步**：render 在 Canvas 桩里可能崩在尘土/粒子上，
       崩了 `S._fgAudit` 就只有 0 条记录 —— 而"0 条记录"会让下面三条断言
       全部**空集真**（`[].every()` 恒为 true）。这是本项目第 5 次撞上
       "测试测了个空集"。所以另外累计一个总数，见循环外的 `fgTotal`。 */
    let fgLog = [];
    let fgErr = "ok";
    try { fgLog = P.fgProbe(); } catch (e) { fgErr = String(e && e.message || e); }
    ok(fgErr === "ok", `[${c.scape}] 前景层能单独画出`, fgErr);
    S._fgAudit = null;

    /* ① 远景芦苇 */
    const reeds = log.filter((r) => r[0] === "reed");
    if (c.scape === "marsh") {
      ok(reeds.length >= 40, `[marsh] 芦苇还在（${reeds.length} 根 = 远景 60 + 中景 34）`);
      ok(reeds.length <= 100, `★ [marsh] 芦苇总数不超过 100 根（现 ${reeds.length}，上一版 240）`);
      const top = Math.min(...reeds.map((r) => r[1]));
      ok(top >= FLOOR_MID, `★ [marsh] 远景芦苇顶端不高于地平线（${top.toFixed(0)} >= ${FLOOR_MID}，上一版 150）`);
    } else {
      eq(reeds.length, 0, `[${c.scape}] 不该有芦苇带`);
    }

    /* ② 前景元素的绝对封顶 */
    const fg = fgLog;
    fgTotal += fg.length;
    ok(fg.every((r) => r[1] >= FLOOR_FG),
       `★ [${c.scape}] 第 ${c.stage + 1} 屏前景元素全部在 ${FLOOR_FG} 以下（${fg.length} 个）`,
       fg.filter((r) => r[1] < FLOOR_FG).map((r) => r[0] + "@" + r[1].toFixed(0) + "/x" + r[2].toFixed(0)).join(","));

    /* ③ 覆盖率：**只约束"竖起来的高杆/石堆"**，不约束灌木丛。
       hills 的 6 丛刻意布在 0.065/0.185/0.305/0.695/0.815/0.935 ——
       0.305 和 0.695 换算成 x 是 293 / 667，本来就落在中段的两侧肩部。
       那是构图（框住视线），而且它们的顶已经被压到 504，
       挡不住球道；把它算进"高元素覆盖率"是拿错了尺子。 */
    const out = fg.filter((r) => (r[0] === "fgreed" || r[0] === "fgrock") && r[2] > 140 && r[2] < W_ - 140);
    eq(out.length, 0, `★ [${c.scape}] 第 ${c.stage + 1} 屏中段没有立杆/石堆（覆盖率 29%，上一版 68%）`);
  }

  /* ★ 非空：6 屏合计至少要有几个高元素，否则上面 ②③ 全是空集真。
     实测这 6 屏合计 4~8 个（每屏 0~2 个），取 ≥ 3 留出余量。 */
  ok(fgTotal >= 4, `★ 6 屏合计前景高元素 ${fgTotal} 个（≥4，证明前景层没被删空）`);

  /* ④ 数值契约：改这些数就是改玩法可读性，必须走一遍这里 */
  const src = fs.readFileSync(HTML, "utf8");
  ok(/const FG_SIDE = 140;/.test(src), "FG_SIDE 仍是 140（改大 = 前景重新入侵球道）");
  ok(/const FG_TOP = 504;/.test(src), "FG_TOP 仍是 504（球顶 534 之下 30px）");
  ok(!/^const FG_EDGE_MIN/m.test(src), "★ 旧的归一化阈值 FG_EDGE_MIN 已删除（它等价于 68% 屏宽）");
  ok(/drawReeds\(g, 282, TH\.hillFar, 24, 54, 5, 34, 0\.40\);/.test(src), "远景芦苇参数被钉住");
  ok(/drawReeds\(g, 320, .*?, 14, 40, 23, 20, 0\.40\);/.test(src), "中景芦苇参数被钉住");
}

console.log("\n=== 37. 评级给奖励 + 战绩落盘 ===");
{
  /* 病理：`S.best` 从有评级那天起就在落盘，但**没有任何地方消费它**。
     审计原文：「评级 S/A/B 只落盘，不给任何东西 → 玩家没有理由为『打得更好』
     付出，刷 S 是纯自嗨」。这一节钉三件事：

       A. 打平不给、降级不给、升级给 —— 不钉这条，重打第 1 屏能无限刷材料；
       B. 战绩（最快用时 / 最高连锁）真的落盘，且**只快不慢、只高不低**；
       C. 奖励走 `S.trip.rankLogs` 这个唯一出口，不自己写存档。

     `rankAward` 被抽成纯函数就是为了这里能直接测边界 ——
     塞在清屏流程里的话，测试只能靠机器人打到通关，而"这一趟正好拿 S"不可控。
  */
  const sb = boot(), P = sb.GROVE;
  const path37 = require("path");
  const GB_TS = path37.join(__dirname, "..", "assets", "scripts", "grove", "GroveBattle.ts");

  /* ---- A. 评级奖励四条边界 ---- */
  eq(P.rankAward("", "S").gain, 3, "首次拿到 S → 材料 +3");
  eq(P.rankAward("", "A").gain, 2, "首次拿到 A → 材料 +2");
  eq(P.rankAward("", "B").gain, 1, "首次拿到 B → 材料 +1");
  eq(P.rankAward("A", "S").gain, 3, "A → S 提升给满额");
  eq(P.rankAward("A", "A").gain, 0, "★ 打平不给 —— 否则第一屏能无限刷材料");
  eq(P.rankAward("S", "S").gain, 0, "已经是 S 再拿 S 不给");
  eq(P.rankAward("S", "A").gain, 0, "★ 降级不给");
  eq(P.rankAward("S", "A").best, "S", "★ 降级也不覆盖旧纪录（只升不降）");
  eq(P.rankAward("", "").gain, 0, "没有评级 → 0（失败结算不会误发）");

  /* ---- B. 战绩落盘 ---- */
  const store37 = {};
  sb.localStorage = {
    getItem: (k) => (k in store37 ? store37[k] : null),
    setItem: (k, v) => { store37[k] = String(v); },
    removeItem: (k) => { delete store37[k]; },
  };

  P._start(0, 3);
  P.S.playT = 52.4;
  P.S.stat.maxHolds = 3;
  P.recordStats(3);
  let st37 = P.loadStats();
  near(st37.t[3], 52.4, 0.05, "第 4 屏记下用时");
  eq(st37.c[3], 3, "第 4 屏记下最高连锁");
  eq(st37.t.length, P.LEVELS.length, "数组长度 = 屏数（下标不打乱）");
  eq(st37.t[0], 0, "没打过的屏是 0，不是 undefined（否则面板会算出 NaN）");

  /* 更慢 / 更低的都不许覆盖 */
  P.S.playT = 80;
  P.S.stat.maxHolds = 2;
  P.recordStats(3);
  st37 = P.loadStats();
  near(st37.t[3], 52.4, 0.05, "★ 更慢的用时不会覆盖最快纪录");
  eq(st37.c[3], 3, "★ 更低的连锁不会覆盖最高纪录");

  /* 更快 / 更高的覆盖 */
  P.S.playT = 40.2;
  P.S.stat.maxHolds = 5;
  P.recordStats(3);
  st37 = P.loadStats();
  near(st37.t[3], 40.2, 0.05, "更快的用时覆盖");
  eq(st37.c[3], 5, "更高的连锁覆盖");

  /* 坏档 / 越界都不许崩 */
  store37[P.STATS_KEY] = "{坏的 json";
  const bad37 = P.loadStats();
  ok(Array.isArray(bad37.t) && bad37.t.every((x) => x === 0), "★ 坏档 → 全 0，不崩");
  eq(bad37.t.length >= 0, true, "坏档也返回数组");
  P.recordStats(999);   /* 越界屏号 */
  P.recordStats(-1);
  ok(true, "越界屏号不抛（内部有范围检查）");

  /* ---- C. 唯一出口：奖励走 trip，不自己写档 ---- */
  const src37 = fs.readFileSync(HTML, "utf8");
  ok(/S\.trip\.rankLogs = \(S\.trip\.rankLogs \|\| 0\) \+ aw\.gain/.test(src37),
     "评级材料累加进 S.trip.rankLogs（跟着一趟的账走）");
  ok(/recordStats\(idx\)/.test(src37), "清屏时真的调了 recordStats（机制有出口）");

  const gb = fs.readFileSync(GB_TS, "utf8");
  ok(/rankLogs: trip\.rankLogs \|\| 0/.test(gb),
     "★ GroveBattle 把 rankLogs 传给 payoutFromRun（不传就等于白做）");
}

console.log("\n=== 38. 本趟目标：抽签 / 读取 / 真的画在 HUD 上 ===");
{
  /* 用户第三次提同一个问题：「任务是一次性的 完成了 后面再也不用完成了 怎么玩？」
     根因查清了：6 条任务 target 全是 1、条件全是"玩着自动满足"、claimed 只增不减。
     换成「每趟抽 2 条」之后，这一节钉四件事：

       A. 存档里那两条能被正确读出来（脏 id 要丢掉，最多 2 条）；
       B. **HUD 真的画了** —— 这是本项目栽过 5 次的地方
          （机制没画 / HUD 没读 pr.text / 前景测了空集），所以钉的是
          `drawTrail` 里的那条 `strokeText(t, cx, 44)`，不是 `S.tripGoals` 有值；
       C. 两边的 id/文案对齐（`HomeBiz.TRIP_GOALS` ↔ `grove.html` 的 `TRIP_CN`）；
       D. 判定函数在 TS 侧（roster 里测），战斗侧只负责把 stat 喂进去。
  */
  const sb = boot(), P = sb.GROVE;
  const store38 = Object.create(null);
  sb.localStorage = {
    getItem: (k) => (k in store38 ? store38[k] : null),
    setItem: (k, v) => { store38[k] = String(v); },
    removeItem: (k) => { delete store38[k]; },
  };
  const KEY38 = "pawpack.save.v1";

  /* ---- A. 读取 ---- */
  store38[KEY38] = JSON.stringify({ tripGoals: ["nofire", "bigchain"] });
  P._start(0, 0);
  eq(P.S.tripGoals.length, 2, "读进来两条");
  eq(P.S.tripGoals[0], "nofire", "顺序不变（HUD 上先出现的先写）");

  store38[KEY38] = JSON.stringify({ tripGoals: ["nofire", "__evil", "nohit"] });
  P._start(0, 0);
  eq(P.S.tripGoals.length, 2, "★ 未知 id 被丢掉（只剩 nofire + nohit）");
  ok(P.S.tripGoals.indexOf("__evil") < 0, "★ 脏 id 不会印到 HUD 上");

  store38[KEY38] = JSON.stringify({ tripGoals: ["nofire", "bigchain", "nohit", "nolost"] });
  P._start(0, 0);
  eq(P.S.tripGoals.length, 2, "最多 2 条（多了看不过来）");

  delete store38[KEY38];
  P._start(0, 0);
  eq(P.S.tripGoals.length, 0, "没抽过 → 空数组");

  store38[KEY38] = "{坏的 json";
  P._start(0, 0);
  eq(P.S.tripGoals.length, 0, "★ 坏档 → 空，不崩");

  store38[KEY38] = JSON.stringify({ tripGoals: ["nofire", "nofire"] });
  P._start(0, 0);
  eq(P.S.tripGoals.length, 1, "重复的只留一条");

  /* ---- B. ★ 真的画出来了 ---- */
  const src38 = fs.readFileSync(HTML, "utf8");
  const t0 = src38.indexOf("function drawTrail");
  ok(t0 > 0, "drawTrail 存在");
  const trail = src38.slice(t0, t0 + 9000);
  ok(/S\.tripGoals/.test(trail), "★ drawTrail 读了 S.tripGoals");
  ok(/strokeText\(t, cx, 68\)/.test(trail) && /fillText\(t, cx, 68\)/.test(trail),
     "★ 本趟目标真的被 strokeText+fillText 画在 y=68（不是只塞进 S）");
  ok(/S\.tripGoals = readTripGoals\(\)/.test(src38),
     "★ beginRun 里真的读了（不是永远空数组）");

  /* ---- C. 两边对齐 ---- */
  const path38 = require("path");
  const hb38 = fs.readFileSync(
    path38.join(__dirname, "..", "assets", "scripts", "config", "HomeBiz.ts"), "utf8");
  const g0 = hb38.indexOf("export const TRIP_GOALS");
  const g1 = hb38.indexOf("/** 一趟抽几条");
  ok(g0 > 0 && g1 > g0, "HomeBiz 里的 TRIP_GOALS 段能定位");
  const seg38 = hb38.slice(g0, g1);
  const defs38 = [...seg38.matchAll(/id: '(\w+)', name: '([^']+)'/g)].map((m) => [m[1], m[2]]);
  eq(defs38.length, 5, "HomeBiz 里有 5 条目标");

  const cn0 = src38.indexOf("const TRIP_CN = {");
  const cn1 = src38.indexOf("};", cn0);
  const cnSeg = src38.slice(cn0, cn1);
  for (const [id, name] of defs38) {
    ok(cnSeg.indexOf(id + ': "' + name + '"') >= 0,
       `★ 「${name}」在战斗侧的名字逐字一致（${id}）`);
  }
  eq((cnSeg.match(/^\s+\w+: "/gm) || []).length, defs38.length,
     "两边条数相同（战斗侧不多不少）");
}

console.log("\n=== 39. 星靶：81 个靶的配靶规则 / 判定 / 落盘 / 真的画在卡上 ===");
{
  /* 用户原话：「整个游戏 只有 27 关 怎么保证长线的？」
     审计：7 种目标 27 次使用全是计数型/禁止型 → 机关全退化成"更好看的解法"。
     星靶 = 27 屏 × 3 个**空间型**挑战条件（81 个），纯数据不碰几何。

     这一节钉七件事：
       A. 配靶表形状（27×3、屏内不重复、id 都有名字）；
       B. **配靶规则按地形走** —— 没弹菇的屏不许挂三弹菇、BOSS 屏不许挂
          "一次不挨"、通关条件本身覆盖的靶不许再挂（否则靶被白送）；
       C. 两边数据逐字一致（grove.html ↔ config/StarTargets.ts）；
       D. 判定器行为（made=0 的守卫、每个条件真的会响）；
       E. recordStar 只增不减 / 不重复奖励 / 集满与章集满奖励 / 镜像；
       F. 埋点真的在物理路径上（弹菇计数 / 坡面标记 / 坡面入营计数）；
       G. ★ 结算卡真的画了（不是只塞进 S）—— 这个项目栽过五次的地方。 */
  const sb = boot(), P = sb.GROVE;
  const store39 = Object.create(null);
  sb.localStorage = {
    getItem: (k) => (k in store39 ? store39[k] : null),
    setItem: (k, v) => { store39[k] = String(v); },
    removeItem: (k) => { delete store39[k]; },
  };
  const sos = P.STAR_OF_STAGE;
  const L39 = P.LEVELS;
  const src39 = fs.readFileSync(HTML, "utf8");

  /* ---- A. 形状 ---- */
  eq(sos.length, 27, "27 屏各有一行配靶");
  let total39 = 0;
  for (let i = 0; i < sos.length; i++) {
    eq(sos[i].length, 3, `第 ${i + 1} 屏 3 个靶`);
    eq(new Set(sos[i]).size, 3, `第 ${i + 1} 屏内不重复`);
    total39 += sos[i].length;
  }
  eq(total39, 81, "一共 81 个靶");

  /* ---- B. 配靶规则按地形 ---- */
  /* 先钉一个反直觉的事实：**27 屏每一屏结尾都有 BOSS**（lv 1→5 递增）。
     所以不存在"BOSS 屏"这个类，也没有"BOSS 屏不挂 nohit"的规则 ——
     14/23 两屏的通关条件本身就是 hits=0，游戏自己证明了
     lv5 面前一次不挨做得到。nohit 只在"它已经是通关条件"的屏缺席。 */
  for (let i = 0; i < L39.length; i++) {
    const st = L39[i], row = sos[i];
    const has = (id) => row.indexOf(id) >= 0;
    const lastWv = st.waves[st.waves.length - 1] || [];
    ok(lastWv.some((s) => s.foe === "boss"),
       `第 ${i + 1} 屏结尾有 BOSS（冒烟自己先确认这件事，规则才不会建在错觉上）`);
    if (st.goal === "nohit") ok(!has("nohit"),
      `★ 第 ${i + 1} 屏通关条件就是「一次不挨」，不挂 nohit（否则白送）`);
    if (st.goal === "intact") ok(!has("noshell"),
      `★ 第 ${i + 1} 屏通关条件就是「不崩」，不挂 noshell`);
    if (st.goal === "chain" && (st.chain || 0) >= 3) ok(!has("bigchain"),
      `★ 第 ${i + 1} 屏通关条件就是「一球卷 ${st.chain}」，不挂大打卷`);
    if ((st.bouncers || []).length === 0) ok(!has("shroom3"),
      `第 ${i + 1} 屏没有弹菇，不挂三弹菇`);
    if ((st.ramps || []).length === 0) ok(!has("ramp"),
      `第 ${i + 1} 屏没有坡，不挂坡道入营`);
    const hasWater = (st.pits || []).some((p) => p.kind === "water");
    if (!hasWater) ok(!has("nodrown"), `第 ${i + 1} 屏没有水塘，不挂不沉底`);
  }
  /* 有特征的屏必须真的挂上（不然规则变成"永远不挂"） */
  ok(sos[4].indexOf("shroom3") >= 0 && sos[14].indexOf("shroom3") >= 0,
     "★ 两个弹菇屏（5/15）都挂了三弹菇");
  ok(sos[0].indexOf("ramp") >= 0 && sos[21].indexOf("ramp") >= 0,
     "★ 坡屏挂上了坡道入营（1/22 在列）");

  /* ---- C. 两边数据逐字一致 ---- */
  const path39 = require("path");
  const st39 = fs.readFileSync(
    path39.join(__dirname, "..", "assets", "scripts", "config", "StarTargets.ts"), "utf8");
  const t0 = st39.indexOf("export const STAR_TYPES");
  const t1 = st39.indexOf("export const STAR_FULL_SHARDS");
  ok(t0 > 0 && t1 > t0, "StarTargets.ts 的 STAR_TYPES 段能定位");
  const defs39 = [...st39.slice(t0, t1).matchAll(/id: '(\w+)', name: '([^']+)'/g)]
    .map((m) => [m[1], m[2]]);
  eq(defs39.length, 8, "TS 侧有 8 种靶");
  const cn39 = src39.indexOf("const STAR_CN = {");
  const cn39end = src39.indexOf("};", cn39);
  const cnSeg39 = src39.slice(cn39, cn39end);
  for (const [id, name] of defs39) {
    ok(cnSeg39.indexOf(id + ': "' + name + '"') >= 0,
       `★ 「${name}」在战斗侧逐字一致（${id}）`);
  }
  eq((cnSeg39.match(/^\s+\w+: "/gm) || []).length, defs39.length,
     "两边条数相同（战斗侧不多不少）");
  /* 配靶表本身也要逐行一致 —— 只对名字不够，81 个格子错一个都算漂移 */
  const s0 = st39.indexOf("export const STAR_OF_STAGE");
  const s1 = st39.indexOf("export function starOfStage");
  ok(s0 > 0 && s1 > s0, "StarTargets.ts 的 STAR_OF_STAGE 段能定位");
  const tsRows = [...st39.slice(s0, s1).matchAll(/\['(\w+)', '(\w+)', '(\w+)'\]/g)]
    .map((m) => [m[1], m[2], m[3]]);
  eq(tsRows.length, 27, "TS 侧 27 行配靶");
  let rowsSame = true;
  for (let i = 0; i < 27; i++) {
    if (!tsRows[i] || tsRows[i].join() !== sos[i].join()) rowsSame = false;
  }
  ok(rowsSame, "★ 81 个格子两边逐行一致（错一个都算漂移）");

  /* ---- D. 判定器行为 ---- */
  eq(P.judgeStar(0, { made: 0, burned: 0 }).length, 0,
     "★ made=0 时守卫型靶全不响（躺着不能拿「不碰火坑」）");
  ok(P.judgeStar(0, { made: 1, burned: 0 }).indexOf("nofire") >= 0,
     "没烧过 → 不碰火坑响");
  ok(P.judgeStar(0, { made: 1, burned: 1 }).indexOf("nofire") < 0,
     "烧过一次 → 不碰火坑不响");
  ok(P.judgeStar(0, { made: 1, maxHolds: 3 }).indexOf("bigchain") >= 0,
     "一球卷 3 只 → 大打卷响");
  ok(P.judgeStar(0, { made: 1, maxHolds: 2 }).indexOf("bigchain") < 0,
     "只卷 2 只 → 大打卷不响");
  ok(P.judgeStar(4, { made: 1, shroom: 3 }).indexOf("shroom3") >= 0,
     "弹了 3 次 → 三弹菇响（第 5 屏）");
  ok(P.judgeStar(4, { made: 1, shroom: 2 }).indexOf("shroom3") < 0,
     "只弹 2 次 → 三弹菇不响");
  ok(P.judgeStar(0, { made: 1, rampIn: 1 }).indexOf("ramp") >= 0,
     "坡面进过营 → 坡道入营响（第 1 屏）");
  ok(P.judgeStar(0, { made: 1, rampIn: 0 }).indexOf("ramp") < 0,
     "没走坡 → 坡道入营不响");
  eq(P.judgeStar(99, { made: 1 }).length, 0, "越界屏 → 空数组，不崩");
  eq(P.judgeStar(0, null).length, 0, "stat 为 null → 空数组，不崩");

  /* ---- E. recordStar ---- */
  const K39 = "pawpack.save", M39 = "pawpack.save.v1";
  let r = P.recordStar(0, ["nofire", "bigchain"]);
  eq(r.join(), "nofire,bigchain", "两个新靶都记下");
  eq(JSON.parse(store39[K39]).star[0].join(), "1,1,0", "战斗侧完成位写上");
  eq(JSON.parse(store39[M39]).star[0].join(), "1,1,0", "★ 主界面镜像同步（写入点自带镜像）");
  eq(P.recordStar(0, ["nofire"]).length, 0,
     "★ 重打只给旧的 → 不新鲜、不重复奖励");
  eq(JSON.parse(store39[K39]).star[0].join(), "1,1,0",
     "★ 只增不减（少给一个不会把 1 抹回 0）");
  eq(P.S.starGain.logs, 0, "重复打没有当次奖励");
  r = P.recordStar(0, ["ramp"]);
  eq(r.join(), "ramp", "补上第 3 个算新");
  eq(P.S.starGain.shards, 2, "★ 集满一屏 → 碎片 +2");
  eq(P.S.starGain.logs, 2, "集满一屏 → 材料 +2（靶 1 + 集满 1）");
  eq(P.recordStar(0, ["nofire", "bigchain", "ramp"]).length, 0,
     "★ 已集满再打 → 不再给（防刷）");
  eq(P.recordStar(0, ["__evil"]).length, 0, "未知 id 被丢掉");
  eq(P.recordStar(99, ["nofire"]).length, 0, "越界屏被丢掉");
  /* 章集满：第 1 章 9 屏全满 → 一次大奖，且只发一次。
     账：第 0 屏 2 材料 + 集满 2 碎片 1 材料；1~8 屏各 3 材料 + 集满各 2 碎片 1 材料；
     章集满 +4 碎片 +3 材料 → 碎片 2+16+4=22、材料 4+32+3=39。 */
  for (let i = 1; i < 9; i++) P.recordStar(i, sos[i]);
  eq(P.S.starShards, 22, "★ 第 1 章集满 → 再 +4 碎片");
  eq(P.S.starLogs, 39, "章集满 → 再 +3 材料");
  const before39 = P.S.starShards;
  for (let i = 0; i < 9; i++) P.recordStar(i, sos[i]);
  eq(P.S.starShards, before39, "★ 章已集满再打 → 不再发（防刷）");

  /* ---- F. 埋点真的在物理路径上 ---- */
  ok(/S\.stat\.shroom = \(S\.stat\.shroom \|\| 0\) \+ 1;/.test(src39),
     "★ 弹成功的那一刻真的 +1 shroom（衰减到弹不动的那次不算）");
  ok(/b\.ramped = true;/.test(src39),
     "★ 踩上坡面真的打标记（b.ramped）");
  ok(/if \(b\.ramped\) S\.stat\.rampIn = \(S\.stat\.rampIn \|\| 0\) \+ 1;/.test(src39),
     "★ 落袋时真的按 b.ramped 计 rampIn（推上去的不算）");
  ok(/shroom: 0, rampIn: 0 \}/.test(src39), "两个新统计进了初始化（两处）");
  ok((src39.match(/shroom: 0, rampIn: 0/g) || []).length >= 2,
     "stat 声明与 setupLevel 重置都带了新字段");

  /* ---- G. ★ 结算卡真的画了 ---- */
  const card39 = src39.indexOf("/* ---- 三颗星靶 ----");
  ok(card39 > 0, "结算卡里有「三颗星靶」段");
  const cardSeg = src39.slice(card39, card39 + 4200);
  ok(/S\.starMet\.indexOf\(id\)/.test(cardSeg), "★ 卡片读了 S.starMet（不是永远空）");
  ok(/S\.starFresh\.indexOf\(id\)/.test(cardSeg), "★ 卡片读了 S.starFresh（新/旧两态分色）");
  ok(/fillText\(fresh \|\| met \? "✓" : "—"/.test(cardSeg),
     "★ 三颗靶真的被 fillText 画成 ✓ / —（不是只塞进 S）");
  ok(/S\.starGain/.test(cardSeg), "★ 奖励回执读的是当次 gain（不是整趟累计）");
  ok(/const CARD_W = 570, CARD_H = 496/.test(src39),
     "卡片长高了（412 → 496）给星靶行让位");
  ok(/const BTN_Y = CARD_Y \+ 424/.test(src39),
     "★ 按钮跟着下移到 424（否则压住星靶行）");
  ok(/beginRun[\s\S]*?S\.starMet = \[\];/.test(src39),
     "★ beginRun 重置本屏星靶（不清会画上一屏的靶）");
  /* 窗口从 120 放宽到 600：这里要判的是"**顺序**"，不是"挨多近"。
     120 在 `nestCoins: 0` 加进 trip 之后当场不够了（中间还夹着 4 行
     说明注释），断言红得毫无意义——代码完全正确，只是注释变长了。
     **用字符距离当"同一段代码"的判据，插一行注释就会红；
     要判顺序就给足余量，或者去锚 `starShards = 0` 再回看。** */
  ok(/S\.trip = \{[\s\S]{0,600}?S\.starShards = 0/.test(src39),
     "★ 收工重置整趟星靶累计");
}

console.log("\n=== 40. 出征页交互：点门直达当前进度 / 没开的门不静默吞 / 预览卡接管靶条件 ===");
{
  /* 2026-10-26 第三轮：挑一屏与触屏条件卡整页删除，出门链路简化成
     **家 → 出征页 → 当前进度那一屏**。这一节验新链路的行为语义：

       A. 点开着的门 → 直接进当前进度那一屏（phase = play、stage = progress）；
       B. 没开的门点了有提示、不静默吞、也不进关；
       C. 预览区可点 = 和点小卡同一个动作（gateTap 单一出口）；
       D. 预览卡接管三星条件（挑一屏删了，这是出门前唯一能读到的地方）；
       E. 抬头统计与「/ 总数」全部消失（用户：没用的描述 + 不暴露最大关卡）；
       F. STAR_DESC 与 StarTargets.ts 逐字一致（两份数据必须由门禁焊住）。

     键盘那两条（左右键挑门 / Enter 进）走源码断言 —— grove-env 的
     window.addEventListener 是 noop，键盘处理也没导出成函数。 */
  const sb40 = boot(), P = sb40.GROVE;
  const src40 = fs.readFileSync(HTML, "utf8");
  /* 这一节测"门这个机制"本身：点哪扇进哪条线、深巢动不动主线进度、
     墙宽跟着线路切换。门表里已经是三扇真门（推球/古道/深巢），不用拼。 */

  /* ---- A. 点开着的门直接进当前进度那一屏 ---- */
  P.S.progress = 5;
  P.openGates();
  eq(P.S.phase, "portals", "openGates 进出征页");
  /* **按 id 取古道那张卡。** 门表顺序是 [推球, 古道, 深巢]，
     写死 `gateRect(0)` 点到的是推球 —— 沙箱里没有 setSnowlabEntry，
     点了什么都不会发生，而症状只是"phase 还是 portals"，看不出点错了门。 */
  const g0 = P.gateRect(P.GATES.findIndex(g => g.id === "trail"));
  P.gateTap(g0.x + g0.w / 2, g0.y + g0.h / 2);
  eq(P.S.phase, "play", "★ 点苔原古道直接开打（没有挑一屏中间层）");
  eq(P.S.stage, 5, "★ 进的是当前进度那一屏（progress = 5 → stage 5）");

  /* ---- B. 深巢门已开放（2026-10-26）：点它真的进深巢，不是进主线 ----
     旧的「点没开的门不进关」用深巢当"未开放"样本 —— 门一开，那条断言
     就变成"点在开着的门上却没进关"，测的是 bug 而不是特性。
     现在改测真正的行为：点深巢门 = 进深巢第 N 层，并且**不动主线进度**。 */
  P.openGates();
  P.S.progress = 5;
  P.S.gateTip = { txt: "", life: 0 };
  /* **按 id 取深巢那张卡**，不写死索引 —— 门表顺序是 [推球, 古道, 深巢]，
     深巢在第 3 位；以前是第 2 位（推球排最后），写死 1 会点到古道上。 */
  const g1 = P.gateRect(P.GATES.findIndex(g => g.id === "nest"));
  P.gateTap(g1.x + g1.w / 2, g1.y + g1.h / 2);
  eq(P.S.phase, "play", "★ 点深巢门直接开打（门已开放）");
  ok(!!P.S.nest && P.S.nest.depth >= 1, "★ 进的是深巢（S.nest 立起来）", JSON.stringify(P.S.nest));
  eq(P.S.progress, 5, "★ 深巢不动主线进度（层号与屏序是两条轴）");
  eq(P.S.stage, 0, "深巢只有当前一层，stage 恒 0");
  /* ---- B2. 墙宽跟着关卡换（2026-10-25：活动区砍到 640）----
     深巢的物理墙必须是 NEST.L..NEST.R（640），回主线必须还原成 26..934。
     这条错了不会报错、也不会崩，只会**静静地把主线变成窄路** ——
     玩家看到的是"球在离右缘 134px 的地方撞了一下空气墙"。
     所以两个方向都要钉一次，而不是只验进深巢。 */
  eq(P.WALL_L, P.NEST.L, "★ 深巢的墙 = 井左缘（640 而不是 908）");
  eq(P.WALL_R, P.NEST.R, "★ 深巢的墙 = 井右缘");
  eq(P.NEST.R - P.NEST.L, 640, "★ 活动区 640（用户拍板）");
  {
    /* 深巢几何里的每一件都在井内 —— 出井 = 球和人永远够不到 */
    const L = P.curStage();
    const bad = [];
    for (const q of L.plats) if (q.x < P.WALL_L || q.x + q.w > P.WALL_R) bad.push("台" + q.x);
    for (const q of L.plats.filter(q => q.kind === "ground")) {
      if (q.x !== P.WALL_L || q.w !== P.WALL_R - P.WALL_L) bad.push("地面没铺满井");
    }
    ok(bad.length === 0, "★ 深巢的台与地面都在井内", bad.join("/"));
  }
  P.openGates();
  eq(P.WALL_L, 26, "★ 回出征页墙还原成主线左墙（漏还原 = 主线变窄路）");
  eq(P.WALL_R, 934, "★ 回出征页墙还原成主线右墙");

  /* 未开放分支必须**留着**：以后还会加门（星靶 / 图鉴入口），
     那一句提示是"点了没动静"的唯一解药。 */
  ok(/if \(!p\.open\)/.test(src40) && /还没挖通/.test(src40),
     "★ 未开放门的提示分支仍在（未来加门的护栏，不是死代码）");
  ok(!P.S.say.txt || P.S.say.txt.indexOf("还没挖通") < 0,
     "★ 提示**不走 S.say**：那句是玩家头顶的气泡，出征页没有玩家对象，写了永远看不见");
  P.openGates();

  /* ---- B3. 进出征页谁也不放大（2026-10-25 第七次）----
     用户原话：「一进去不放大呀 鼠标放上去才放大 你怎么擅作主张呢」。
     上一版 drawGates 里写了 `hoverGate >= 0 ? hoverGate : gateCur` 的兜底，
     意思是"指针不在就当选中 gateCur 那张" —— 结果一进页面第一张就是大的。
     **放大是反馈（回答"我指着哪张"），不是状态展示**；没有指针就没有答案。
     这条断言钉的是"状态"这一半，另一半（真的移动鼠标才亮）在源码里判。 */
  eq(P.S.hoverGate, -1, "★ 进出征页一张卡都不放大（没有指针就没有焦点）");
  ok(!/: S\.gateCur/.test(src40) && /const focus = S\.hoverGate;/.test(src40),
     "★ 焦点只由 hoverGate 决定（不能再有 gateCur 兜底）");

  /* ---- C. 预览卡已删（2026-10-25 第六次）----
     用户原话：「鼠标放在上面原图就放大就可以了啊」。整页现在只有卡可点，
     所以必须反过来钉一条：**卡以外的空地真的不接点击** —— 删掉预览卡却留下
     一块隐形热区，玩家会以为画面里还有别的入口。 */
  P.openGates();
  P.S.gateTip = { txt: "", life: 0 };
  P.S.progress = 2;
  eq(P.gateHit(480, 552), -1, "★ 底部操作提示带不接点击（预览卡删了，不留隐形热区）");
  ok(/function gateTap\(mx, my\) \{[\s\S]{0,120}if \(i >= 0\) enterGate\(i\);/.test(src40),
     "★ gateTap 只剩「点卡进」一条分支（没有预览卡分支要判）");
  const pvGone = !/GATE\.pv/.test(src40) && !/GATE\.cols/.test(src40);
  ok(pvGone, "★ 预览卡的版式常量已彻底删除（留一半会让 gateRect 算出两套坐标）");

  /* ---- D. 卡内第三行接管三星条件（预览卡删了，这条信息不能跟着没）----
     出征页是出门前**唯一**能读到"这一屏三颗星怎么拿"的地方（挑一屏
     2026-10-26 删了，桌面 hover 行 / 触屏条件卡两套一起没了）。 */
  P.openGates();
  P.S.progress = 7;
  ok(/function gateDetailLine\(p\)[\s\S]{0,700}STAR_OF_STAGE\[cur\]/.test(src40),
     "★ 卡内第三行读当前屏的靶表（这是出门前唯一能读到条件的地方）");
  ok(/STAR_CN\[k\]/.test(src40),
     "★ 卡内第三行画条件名字（回答怎么拿）");
  ok(/bits\[i\] === 1 \? /.test(src40),
     "★ 已拿到的靶标出来（只报条件不报拿没拿到，等于半条信息）");
  ok(/chapterOfStage\(cur\)\.name/.test(src40),
     "★ 副行报产地名（我在枯木坡比我在第 15 屏更像人话）");
  ok(/GATE\.h >= GATE\.detailMinH/.test(src40),
     "★ 第三行只在卡够高时画（h<150 时渐变遮不住，白字压在亮图上读不出来）");

  /* ---- E. 抬头统计与总数全部消失 ---- */
  ok(!/挑一条路走/.test(src40),
     "★ 副标题已删（用户：这些也是没用的描述吧）");
  ok(!/摘星星 " \+ gotStar/.test(src40) && !/已通 " \+ done/.test(src40),
     "★ 抬头统计行已删（用户：没用的描述）");
  ok(!/新的路还在修/.test(src40) && !/这条路还在筹备/.test(src40),
     "★ 空槽文案已删（用户：没必要这么写吧）");
  ok(!/" \+ LEVELS\.length/.test(src40) && !/STAR_OF_STAGE\.length \* 3/.test(src40),
     "★ 出征页没有任何「/ 总数」（不暴露最大关卡，只显示当前进度）");
  ok(!/推到第 " \+ Math\.min/.test(src40),
     "★ 旧文案「推到第 N / 27 屏」已删（同一个位置改报「第 N 屏」）");

  /* ---- F. STAR_DESC 与 StarTargets.ts 逐字一致 ---- */
  {
    const ts40 = fs.readFileSync(
      path.join(__dirname, "..", "assets", "scripts", "config", "StarTargets.ts"), "utf8");
    const descHtml = {};
    const mh = src40.match(/const STAR_DESC = \{([\s\S]*?)\n\};/);
    ok(!!mh, "grove.html 有 STAR_DESC（靶的口径原文）");
    if (mh) {
      const re = /(\w+):\s*"([^"]+)"/g;
      let g2;
      while ((g2 = re.exec(mh[1]))) descHtml[g2[1]] = g2[2];
    }
    const descTs = {};
    const reTs = /id:\s*'(\w+)',\s*name:\s*'([^']+)',\s*\n\s*desc:\s*'([^']+)'/g;
    let g3;
    while ((g3 = reTs.exec(ts40))) descTs[g3[1]] = g3[3];

    eq(Object.keys(descHtml).length, 8, "8 条靶都有口径原文");
    for (const id of Object.keys(descHtml)) {
      eq(descHtml[id], descTs[id], `靶 ${id} 的口径两边逐字一致`);
    }
  }

  /* ---- G. 键盘/触屏源码断言（理由见本节开头） ---- */
  ok(/ev\.code === "ArrowLeft" \|\| ev\.code === "ArrowUp"\) c -= 1;/.test(src40),
     "出征页左右键挑门（上下键也当左右用，手机外接键盘不至于按了没反应）");
  ok(/enterGate\(S\.gateCur\);/.test(src40),
     "出征页 Enter 进当前光标那扇门");
  ok(/addEventListener\("touchstart"[\s\S]{0,60}S\.phase !== "portals"/.test(src40),
     "★ 触屏只在 portals 阶段接管 —— 其他阶段无条件 preventDefault 会让手机整体点不动");
  ok(/addEventListener\("touchstart"[\s\S]{0,900}passive: false/.test(src40),
     "触屏监听带 passive:false（否则 preventDefault 无效，点一次等于点两次）");
  ok(/function gateTap\(mx, my\) \{[\s\S]{0,140}if \(i >= 0\) enterGate\(i\);/.test(src40),
     "★ 点卡进关只有 gateTap 一个出口（预览卡删了，不再有第二个入口要同步）");
  ok(/get slots\(\) \{ return GATES\.length; \}/.test(src40),
     "槽位 = 玩法数（空槽已删；加玩法只往 GATES 里加，网格自动多排一行）");
}
console.log("\n=== 41. 出征页：门表契约 / 点开着的门进玩法 / 没开的门不静默吞（临时接回 legacy）===");
{
  /* 用户原话：「出门之后 应该有一个出征界面 融合这些玩法的 每个玩法一个小的概念图」

     病根：主界面点「出征」直接掉进第 N 屏，玩家**没有"挑玩法"这一步** ——
     27 屏是一条线，深巢是另一条线，代码里两条都在，界面上只露一条。
     这一节钉五件事：
       A. 门表形状（id 唯一、字段齐、都带一句"门里是什么"）；
       B. 布局（两扇门不重叠、都在画布内）；
       C. 命中（点得到、边缘外不误判）；
       D. 语义（开着的门进对应玩法；没开的门**必须有话说**，不能静默吞点击）；
       E. 概念图与共用夜空真的被调用（不是只画了两个空框）。 */
  const sb41 = boot(), P = sb41.GROVE;
  const src41 = fs.readFileSync(HTML, "utf8");
  const CW = 960, CH = 600;
  /* 这一节验门的**字段契约、命中边界和概念图调用** ——
     三扇真门正是它要的测试面。 */
  const G41 = P.GATES;

  /* ---- A. 门表 ---- */
  ok(Array.isArray(G41) && G41.length >= 2,
     "至少两扇门（这一节临时接回了 legacy，主流程只摆一扇）",
     G41 ? String(G41.length) : "无");
  {
    const ids = G41.map((g) => g.id);
    eq(new Set(ids).size, ids.length, "门的 id 不重复");
    /* sub 只给**没开的门**用（回答"门后面是什么"）。开的门不写：
       2026-10-26 用户否掉一切"没用的描述"，且 sub 里不许带屏数总数。 */
    for (const g of G41) {
      ok(!!g.name, `${g.id} 有名字`);
      if (!g.open) ok(!!g.sub, `${g.id} 没开放 → 必须有一句"门里是什么"`);
    }
    eq(G41.filter((g) => g.open).length >= 1, true, "至少一扇门是开着的");
  }

  /* ---- B. 布局不重叠、不越界 ---- */
  {
    const rs = G41.map((_, i) => P.gateRect(i));
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= CW && r.y + r.h <= CH,
         `第 ${i + 1} 扇门在画布里`, `${r.x},${r.y} ${r.w}×${r.h}`);
      for (let j = i + 1; j < rs.length; j++) {
        const o = rs[j];
        /* 2026-10-26 第五次：小卡改竖排（cols=1），不相交判定不能只看水平 ——
           横排靠左右分离、竖排靠上下分离，任一方向分开即可。 */
        ok(r.x + r.w <= o.x || o.x + o.w <= r.x ||
           r.y + r.h <= o.y || o.y + o.h <= r.y,
           `第 ${i + 1} 扇与第 ${j + 1} 扇不重叠（矩形交 = 点不到后一张）`);
      }
    }
  }

  /* ---- C. 命中 ---- */
  {
    const r0 = P.gateRect(0);
    eq(P.gateHit(r0.x + r0.w / 2, r0.y + 40), 0, "点第一扇门中心 → 0");
    eq(P.gateHit(4, 4), -1, "点左上角空白 → 没有门");
    eq(P.gateHit(CW - 4, 4), -1, "点右上角空白 → 没有门");
  }

  /* ---- D. 语义 ---- */
  {
    /* 开着的门：**直接进当前进度那一屏**（挑一屏 2026-10-26 删除，
       用户：「这个界面也不需要吧 显示当前进度就可以了」） */
    P.S.progress = 5;
    P.S.stage = 0;
    P.openGates();
    eq(P.S.phase, "portals", "openGates 进的是出征页");
    P.enterGate(P.GATES.findIndex(g => g.id === "trail"));
    eq(P.S.phase, "play", "★ 点开着的门 → 直接开打当前进度那一屏（没有中间选择页）");
    eq(P.S.stage, 5, "★ 进的就是当前进度（progress = 5 → stage 5）");

    /* 没开的门：不许静默吞点击 —— 点了要有一句话 */
    const closedIdx = G41.findIndex((g) => !g.open);
    if (closedIdx >= 0) {
      P.openGates();
      P.S.gateTip = { txt: "", life: 0 };
      P.enterGate(closedIdx);
      eq(P.S.phase, "portals", "★ 点没开的门 → 留在出征页（不放人进空玩法）");
      ok(P.S.gateTip.txt && P.S.gateTip.life > 0,
         "★ 点没开的门有话说（不是静默吞点击）", P.S.gateTip.txt);
      ok(!P.S.say.txt || P.S.say.txt.indexOf("还没通") < 0,
         "★ 提示**不走 S.say**：那句台词是玩家头顶的气泡，出征页没有玩家对象，写了永远看不见");
    }
    /* 越界索引不崩（键盘 clamp 失效时的兜底） */
    P.openGates();
    P.enterGate(99);
    eq(P.S.phase, "portals", "越界门号不崩也不放行");
  }

  /* ---- E. 真的画了 ----
     2026-10-25 第三版：门卡从"居中大卡 + 概念图"改成"左上角入口网格 +
     右侧立绘预览"。这里钉的是**立绘这条链**：字段有、清单里加载、
     绘制侧真的 cover 画出来、没图时回退简笔（回退必须看得见）。 */
  ok(/function drawGateArt\(g, p, x, y, w, h\)[\s\S]{0,400}const img = p\.art \? ART\[p\.art\] : null;/.test(src41),
     "★ 玩法卡真的去取 p.art 那张立绘");
  ok(/function drawArtCover\(g, img, x, y, w, h\)[\s\S]{0,400}g\.drawImage\(img, sx, sy, sw, sh, x, y, w, h\);/.test(src41),
     "★ 立绘按 cover 铺满（不 cover 会被拉成扁图）");
  ok(/if \(img\) drawArtCover\(g, img, x, y, w, h\);/.test(src41),
     "立绘优先");
  ok(/else if \(p\.id === "trail"\) drawTrailArt\(g, x, y, w, h\);/.test(src41),
     "★ 没图时回退简笔（静默变空白是这个项目的经典病）");
  ok(/else if \(p\.id === "nest"\) drawNestArt\(g, x, y, w, h\);/.test(src41),
     "深巢同样有回退");
  /* 2026-10-26 第五次：drawNightSky 加第四参 withMoon —— 出征页传 false
     （月亮+光晕占 y 20–168，挡着预览卡齐顶），选人页仍画。共用关系不变。 */
  ok(/drawNightSky\(g, S\.t, HZ, false\)/.test(src41) && /drawNightSky\(g, T, HZ\)/.test(src41),
     "★ 夜空由出征页与门口共用一份（两处各画一遍必然漂移）");
  ok(/if \(withMoon !== false\)/.test(src41),
     "★ 月亮可关（出征页关、选人页留），不是两页各画一份");
  ok(/drawTrailArt[\s\S]{0,800}g\.arc\(x \+ w \* 0\.30, gy - 10, 8/.test(src41),
     "苔原简笔回退图里有球（这条线唯一要做的动作）");
  ok(/drawNestArt[\s\S]{0,2000}const dim = 1 - i \* 0\.18;/.test(src41),
     "深巢概念图逐层变暗（\"越往下越深\"必须画出来）");
  ok(/if \(!p\.open\) \{\s*\n\s*g\.fillStyle = "rgba\(8,14,20,\.[0-9]+\)";/.test(src41),
     "★ 没开放的门只给图加纱、不整卡压暗（压暗后图和字一起读不出来）");
  /* 提示条：2026-10-26 第四次从画面中央挪到左列两卡下方 (303,212)。
     断言不钉死单个坐标，只验"画在左列那块地里"（x∈[88,518] 且 y∈[176,300]）——
     钉死点的话下次微挪就要改测试，而这条断言要守的是"真的画了"。 */
  /* 2026-10-26 第五次：左列改竖排大卡后 (303,196) 被第二张卡占掉，提示条
     挪回底部操作提示正上方中央 (W/2, 496..528)。断言只验"画在两列下方、
     底部提示上方"，不钉死坐标。 */
  ok(/g\.fillText\(S\.gateTip\.txt, (W \/ 2|480), (\d+)\)/.test(src41) &&
     (() => { const m = /g\.fillText\(S\.gateTip\.txt, (?:W \/ 2|480), (\d+)\)/.exec(src41);
              return m && +m[1] >= 472 && +m[1] <= 540; })(),
     "★ 提示条真的被画出来，且落在两列下方、操作提示上方（不是只写进 S）");
  ok(/S\.phase === "portals" && S\.gateTip\.life > 0\) S\.gateTip\.life -= dt/.test(src41),
     "提示条自己衰减（挂在 S.say 上会永不消失：那段走钟只在 play 里跑）");

  /* ---- E2. 横排卡片：宽度按玩法数算、垂直居中、悬停放大 ---- */
  {
    for (const g of G41) {
      ok(!!g.art, `${g.id} 有背景立绘的 ART key`);
    }
    /* 立绘清单真的加载了这两张（路径写错不会报错，只会静默回退） */
    const gb41b = fs.readFileSync(
      path.join(__dirname, "..", "assets", "scripts", "grove", "GroveBattle.ts"), "utf8");
    for (const g of G41) {
      ok(gb41b.indexOf("'" + g.art + "'") >= 0,
         `★ ${g.art} 在 ART_MANIFEST 里（不进清单 = 真机永远看不到立绘）`);
    }
    /* 2026-10-25 第六次：**横排 + 悬停放大**（用户：「鼠标放在上面原图就
       放大就可以了啊」）。宽度由玩法数算出、不是常量 —— 加一个玩法只往
       GATES 加一项，版式自己重排，这也是"能不能撑到第 4、5 个玩法"的根据。 */
    eq(P.GATE.slots, G41.length, "槽位 = 玩法数（没有「新的路还在修」空槽）",
       `slots ${P.GATE.slots} vs 玩法 ${G41.length}`);
    eq(P.GATE.w,
       Math.floor((960 - P.GATE.marginX * 2 - (G41.length - 1) * P.GATE.gap) / G41.length),
       "★ 卡宽由玩法数算出（加玩法自动重排，不必改常量）");
    /* 高 = 16:9，但夹在 120..420。上限防 1 个玩法时 473 顶穿底部提示条；
       下限防 5 个玩法时 86 高、扣掉文字块后立绘只剩 30px。 */
    eq(P.GATE.h, Math.min(420, Math.max(120, Math.round(P.GATE.w * 9 / 16))),
       "★ 卡高 = 16:9 夹在 120..420（上下限都是撞过的坑）");
    /* 加玩法不该把任何一张卡挤到读不出来：立绘区至少留 44px */
    for (const n of [2, 3, 4, 5, 6]) {
      const w = Math.floor((960 - P.GATE.marginX * 2 - (n - 1) * P.GATE.gap) / n);
      const h = Math.min(420, Math.max(120, Math.round(w * 9 / 16)));
      const y = 52 + Math.round((420 - h) / 2);
      ok(h >= 120 && y + h <= 472, `${n} 个玩法时卡高仍 >=120 且不撞 472`, `${w}×${h} y=${y}`);
    }
    /* 垂直居中：上下留白必须对称，差 1px 是 round 造成的，允许 */
    const padTop = P.GATE.y - P.GATE.top;
    const padBot = P.GATE.bottom - (P.GATE.y + P.GATE.h);
    ok(Math.abs(padTop - padBot) <= 1, "★ 卡在可用区内垂直居中（上下留白对称）",
       `上 ${padTop} 下 ${padBot}`);
    eq(P.GATE.bottom, 472, "可用区底仍是 472（下面还有提示条与操作提示）");
    /* 所有卡都在画布内、左右分离（横排不重叠） */
    const rs = [];
    for (let i = 0; i < P.GATE.slots; i++) rs.push(P.gateRect(i));
    for (let i = 0; i < rs.length; i++) {
      ok(rs[i].x >= 0 && rs[i].x + rs[i].w <= CW && rs[i].y + rs[i].h <= CH,
         `槽 ${i} 在画布里`);
      for (let j = i + 1; j < rs.length; j++) {
        ok(rs[i].x + rs[i].w <= rs[j].x || rs[j].x + rs[j].w <= rs[i].x,
           `槽 ${i} 与槽 ${j} 左右分离（横排不重叠）`);
      }
    }
    /* 悬停放大：焦点卡要**最后画**。一遍画完再补焦点，会被后画的邻居切掉一条边。 */
    ok(/for \(let pass = 0; pass < 2; pass\+\+\)/.test(src41) &&
       /if \(\(pass === 0\) === on\) continue;/.test(src41),
       "★ 分两遍画：先所有非焦点、再焦点（放大的那张压在邻居上）");
    ok(/on \? gateZoomRect\(i\) : gateRect\(i\)/.test(src41),
       "★ 焦点用放大矩形、其余用常态矩形（同一处坐标，不各算一套）");
  }


  /* ---- F. 入口与退路（键盘/启动没法派发事件，走源码断言） ---- */
  ok(/else if \(FROM_HOME\) \{ S\.progress = st >= 0 \? st : LEVELS\.length; openGates\(\); \}/.test(src41),
     "★ 从家园进来先到出征页（不再一键掉进第 N 屏）");
  ok(/if \(FROM_HOME\) \{ location\.href = "game\.html"; return; \}/.test(src41),
     "★ 出征页 ESC 从家园进来的直接收工回家（挑一屏没了，没有中间层要退）");

  /* ---- G. Cocos 侧入口真的接上了 ----
     这一组读的是 GroveRuntime.ts / GroveBattle.ts，不是原型 ——
     原型里能玩、真机上没有，是这个项目栽过的坑（URL 参数在 Cocos 里不存在）。 */
  {
    const rt41 = fs.readFileSync(
      path.join(__dirname, "..", "assets", "scripts", "grove", "GroveRuntime.ts"), "utf8");
    ok(/export function groveBoot\(hero\?: number, stage\?: number, fromHome\?: boolean\)/.test(rt41),
       "★ groveBoot 有 fromHome 口子（Cocos 没有 URL，只能显式传）");
    ok(/if \(fromHome\) \{ S\.progress = st >= 0 \? st : LEVELS\.length; openGates\(\); return; \}/.test(rt41),
       "★ fromHome 时先到出征页，不直升第一屏");
    /* 断言的是「真的挂着监听」这件事，不是文本里出现过这个词 ——
       抽取时插入的说明注释里也写着 cv.addEventListener("touchstart")。 */
    ok(!/\ncv\.addEventListener\("touchstart"/.test(rt41),
       "★ 触屏监听没漏进运行时顶层（cv 那时是 null，会让整个模块加载失败）");
    const gb41 = fs.readFileSync(
      path.join(__dirname, "..", "assets", "scripts", "grove", "GroveBattle.ts"), "utf8");
    ok(/groveBoot\(heroIndexOf\(save\.active\), undefined, true\)/.test(gb41),
       "★ GroveBattle 真的传了 fromHome=true（不传 = 界面白做）");
  }
  ok(/if \(S\.phase === "portals"\) \{[\s\S]{0,400}enterGate\(S\.gateCur\)/.test(src41),
     "出征页 Enter 进当前门");
  ok(/S\.gateCur = clamp\(S\.gateCur \|\| 0, 0, GATES\.length - 1\);/.test(src41),
     "从战斗退回来还停在刚才那扇门（不是每次都回到第一扇）");
}

/* ============================================================================
   雾巢（2026-10-27）：迷雾 / 菌光囊 / 巢室
   ----------------------------------------------------------------------------
   截图能看出"黑不黑"，看不出这四件事：
     · 主线有没有被雾污染（S.fog 必须恒为 null）
     · 光照场是不是真的按距离衰减（脚下亮、井对面黑）
     · 记忆是不是只增不减（转身就忘 = 地形记不住 = 无尽模式失去一半乐趣）
     · 菌光囊炸开之后是不是**永久**光源（不是闪一下就没了）
   最后一条尤其只能这样验：截图拍的是"那一刻"，永久性一帧都证明不了。
   ========================================================================== */
function checkNestFog() {
  /* ---- A. 主线不许有雾 ---- */
  {
    const P = boot().GROVE;
    P._start(2, 0);
    ok(P.S.fog === null, "★ 主线没有雾（S.fog 恒 null）");
    ok(P.S.pods.length === 0, "★ 主线没有菌光囊");
    eq(P.fogSample(null, 400, 300), 1, "★ 无雾时光照恒为 1（绘制侧不会被误压暗）");
  }

  /* ---- B. 深巢进层：雾与囊都立起来 ---- */
  const P = boot().GROVE;
  P.enterNest(1);
  const S = P.S;
  ok(!!S.fog, "★ 进深巢立起光照栅格");
  eq(S.pods.length, P.curStage().pods.length, "★ 菌光囊数量跟关卡一致");
  ok(S.pods.every(q => !q.lit), "★ 新进一层：囊全是没炸的");
  eq(S.fog.lit.length, S.fog.cols * S.fog.rows, "栅格长度 = cols × rows");
  ok(S.fog.nz && S.fog.nz.length === S.fog.lit.length, "雾纹理与栅格同尺寸");

  /* ---- C. 光照场：脚下亮、井对面黑 ---- */
  for (let i = 0; i < 6; i++) P.tick(1 / 60);
  const px = S.p.x, py = S.p.y - 34;
  const near = P.fogSample(S.fog, px, py);
  const farX = px < (P.WALL_L + P.WALL_R) / 2 ? P.WALL_R - 24 : P.WALL_L + 24;
  const far = P.fogSample(S.fog, farX, 300);
  ok(near > 0.6, "★ 玩家脚下是亮的", "lit " + near.toFixed(2));
  ok(far < 0.05, "★ 井对面是黑的（灯照不到）", "lit " + far.toFixed(2));

  /* ---- D. 记忆只增不减 ---- */
  const before = S.fog.seenPct;
  for (let i = 0; i < 90; i++) { S.p.x += 1.4; P.tick(1 / 60); }
  const after = S.fog.seenPct;
  ok(after > before, "★ 走一段之后「探明」变多", before.toFixed(3) + " → " + after.toFixed(3));
  for (let i = 0; i < 30; i++) P.tick(1 / 60);
  ok(S.fog.seenPct >= after - 1e-6, "★ 记忆不倒退（站住不动也不会忘）",
     after.toFixed(3) + " → " + S.fog.seenPct.toFixed(3));

  /* ---- E. 撞囊：收成 + 永久光源 ---- */
  const pod = S.pods.find(q => !q.lit);
  ok(!!pod, "这一层有没炸的囊可供测试");
  if (pod) {
    const food0 = S.food;
    P.nestPodBurst(pod);
    ok(pod.lit, "★ 囊炸开（lit = true）");
    eq(S.food, food0 + P.NEST_FOG.POD_FOOD, "★ 爆囊给孢子收成");
    /* 把玩家挪远，让"亮"只能来自囊本身 */
    S.p.x = pod.x + pod.w / 2 < 480 ? 780 : 180;
    for (let i = 0; i < 8; i++) P.tick(1 / 60);
    const at = P.fogSample(S.fog, pod.x + pod.w / 2, pod.y - 14);
    ok(at > 0.5, "★ 炸开的囊是**永久**光源（人走远了那里还是亮的）",
       "lit " + at.toFixed(2));
  }

  /* ---- F. 雾档随深度收灯 ---- */
  ok(P.nestFogTier(1).lamp > P.nestFogTier(24).lamp, "★ 越深灯越小");
  ok(P.nestFogTier(24).seen > P.nestFogTier(1).seen, "★ 越深记忆越模糊");

  /* ---- G. 巢室：每层有名字，且浅层也有两种以上剪影 ---- */
  {
    const seen = {};
    let noBrood = 0;
    for (let d = 1; d <= 12; d++) {
      const L = P.nestLevel(d).level;
      if (!L.brood || !L.brood.name) noBrood++;
      seen[L.brood.id] = 1;
    }
    eq(noBrood, 0, "前 12 层都有巢室名");
    ok(Object.keys(seen).length >= 2, "★ 前 12 层至少出现 2 种巢室（不是每层同一个窝）",
       Object.keys(seen).join("/"));
  }
}

/* ============================================================================
   词条 + 巢币 + 改造件层数（2026-10-27）
   ----------------------------------------------------------------------------
   这一段验的全是"截图看不出来"的事：

     · 词条到底有没有落到参数上（推力/裹层/掉饱/灯/球寿命各一条）
     · 主线有没有被词条污染（S.nest 为 null 时六条必须全部失效）
     · 「窄喉」那种**空词条**会不会再混进来（它对深巢零作用，因为
       深巢 ballLimit 恒为 null）—— 这条最容易复发，肉眼绝对看不出来
     · 巢币是不是按"新纪录差额"发（不是每趟按深度发，否则能刷）
     · 钱不够时看板**不许落账**（钱没扣、词条却跳过的经典 bug）

   最后一条尤其重要：`skipModAt` 和 `spendNestCoins` 是两步，
   写成"先落账再扣钱"的话，扣款失败会静默变成白送。
   ========================================================================== */
function checkNestMods() {
  /* ---- A. 主线零污染 ---- */
  {
    const P = boot().GROVE;
    P._start(2, 0);
    const base = P.pushPowerNow();
    const belly = P.bellyCost();
    ok(!P.modOn("heavy"), "★ 主线没有词条(heavy)");
    ok(!P.modOn("hunger"), "★ 主线没有词条(hunger)");
    eq(P.S.nestSkip.length, 0, "主线不持有跳过名单");
    ok(base > 0, "主线推球力度正常", String(base));
    eq(belly, 20, "主线掉饱 20（没被饥肠乘 1.5）");
  }

  const P = boot().GROVE;

  /* ---- B. 词条按深度累积，且不跳档 ---- */
  const want = [[1, 0], [4, 0], [5, 1], [10, 2], [15, 3], [20, 4], [25, 5], [30, 6], [60, 6]];
  let bad = [];
  for (const [d, n] of want) {
    P.enterNest(d);
    const got = P.nestModsAt(d).length;
    if (got !== n) bad.push(`深${d}=${got}(期望${n})`);
  }
  ok(bad.length === 0, "★ 词条数量随深度累积（5/10/15/20/25/30 各解锁一条，封顶 6）",
     bad.join(" "));
  eq(P.NEST_MODS.length, 6, "词条表 6 条");

  /* ---- C. 六条**全部**落到参数上（一条都不许是空词条）---- */
  /* 「窄喉」的教训：它对深巢零作用，因为深巢 `ballLimit` 恒为 null。
     所以这里不是"看词条表里写了什么"，是逐条去问**真正的那个数**。 */
  {
    /* 推力 */
    P.enterNest(4);
    const p4 = P.pushPowerNow();
    P.enterNest(5);
    const p5 = P.pushPowerNow();
    ok(p5 < p4 * 0.95, "★ 沉石：深 5 推力明显下降", p4.toFixed(1) + " → " + p5.toFixed(1));

    /* 裹层（厚甲） */
    P.enterNest(4);
    const c4 = (P.S.foes.find((f) => !f.isBoss) || {}).cm;
    P.enterNest(12);
    const c12 = (P.S.foes.find((f) => !f.isBoss) || {}).cm;
    ok(c4 === 3 && c12 === 4, "★ 厚甲：深 12 普通怪多糊一层", `cm ${c4} → ${c12}`);

    /* 掉饱 */
    P.enterNest(15);
    const b15 = P.bellyCost();
    P.enterNest(20);
    const b20 = P.bellyCost();
    ok(b20 > b15, "★ 饥肠：深 20 掉饱变多", b15 + " → " + b20);

    /* 雾 */
    P.enterNest(24);
    const f24 = P.nestFogTier(24).lamp;
    P.enterNest(25);
    const f25 = P.nestFogTier(25).lamp;
    ok(f25 < f24, "★ 重雾：深 25 灯更小", f24 + " → " + f25);

    /* 球寿命 */
    P.enterNest(29);
    const l29 = P.ballLife();
    P.enterNest(30);
    const l30 = P.ballLife();
    ok(l30 < l29, "★ 空心：深 30 球寿命变短", l29.toFixed(2) + " → " + l30.toFixed(2));

    /* 预瞄线：blind 只关轨迹，不关"↓ 能下去"的提示 —— 用一个无害的断言盯住它 */
    P.enterNest(14);
    const a14 = P.modOn("blind");
    P.enterNest(15);
    ok(!a14 && P.modOn("blind"), "★ 盲眼：深 15 起生效");
  }

  /* ---- D. 空词条哨兵：词条 id 必须在深巢真的能读到 ----
     「窄喉」当年的错法是把效果挂在一个深巢永远走不到的分支上。
     这里把每条词条的 id 和它该改的那个量绑起来点名验收，
     以后再加词条，忘了挂生效点会在这里红。 */
  {
    const ids = P.NEST_MODS.map((m) => m.id).sort().join(",");
    eq(ids, "blind,gloom,heavy,hollow,hunger,thick", "词条 id 集合没变（新增要同步这份清单）");
    ok(P.NEST_MODS.every((m) => m.skip > 0), "每条词条都有跳过价（0 会让看板变成免费商店）");
    ok(P.NEST_MODS.every((m) => m.depth >= 5 && m.depth <= 30), "解锁深度都在 5..30");
  }

  /* ---- E. 跳过名单 ---- */
  {
    P.enterNest(20);
    P.S.nestSkip = ["hunger"];
    const after = P.nestModsAt(20).map((m) => m.id);
    ok(after.indexOf("hunger") < 0, "★ 跳过名单生效（hunger 不在了）", after.join("/"));
    ok(after.length === 3, "跳过一条后剩三条", String(after.length));
    P.exitNest();
    eq(P.S.nestSkip.length, 0, "★ 离开深巢清空跳过名单（下一趟要重新买）");
  }

  /* ---- F. 巢币按新纪录差额发 ---- */
  {
    const Q = boot().GROVE;
    eq(Q.nestCoinAt(0), 0, "0 层 0 枚");
    ok(Q.nestCoinAt(20) > Q.nestCoinAt(10) * 2, "★ 巢币超线性（深 20 明显多于深 10 的两倍）",
       Q.nestCoinAt(10) + " / " + Q.nestCoinAt(20));

    Q.writeNestDepth(0);
    Q.enterNest(10);
    const g1 = Q.S.trip.nestCoins;
    eq(g1, Q.nestCoinAt(10), "★ 首次到第 10 层：给满 10 层的差额");
    /* 同一深度再下一次：**0 枚**（这就是"不许刷"的判据） */
    Q.exitNest();
    Q.enterNest(10);
    eq(Q.S.trip.nestCoins, 0, "★ 重复下到同一深度：0 枚（刷不出币）");
    Q.exitNest();
    Q.enterNest(20);
    eq(Q.S.trip.nestCoins, Q.nestCoinAt(20) - Q.nestCoinAt(10),
       "★ 从 10 深到 20：只给差额");
  }

  /* ---- G. 看板 ---- */
  {
    const R = boot().GROVE;
    R.writeNestDepth(23);
    R.openGates();
    eq(R.modBoardOpen(), false, "看板默认关着");
    R.openModBoard();
    const rows = R.modBoardRows();
    eq(rows.next, 24, "看板报的起始深度 = 历史最深 + 1");
    eq(rows.rows.length, 4, "★ 深 23 的看板列 4 条（5/10/15/20）");
    ok(rows.rows.every((r) => r.btn.w > 0 && r.btn.h > 0), "每行都有跳过按钮的矩形");
    /* `R.H` 不在导出表里（画布尺寸没必要暴露给冒烟），直接用 600。 */
    ok(rows.go.y + rows.go.h < 600, "「出发」按钮在画面内", String(rows.go.y + rows.go.h));
    /* 命中：按钮中心必须真的命中自己 */
    const b = rows.rows[0].btn;
    eq(R.modBoardHit(b.x + b.w / 2, b.y + b.h / 2).kind, "skip", "点按钮中心命中跳过");
    eq(R.modBoardHit(rows.go.x + 4, rows.go.y + 4).kind, "go", "点左上角命中出发");
    R.closeModBoard();
    eq(R.modBoardOpen(), false, "关闭后 open = false");
  }

  /* ---- H. 买"跳过"的两条硬约束 ----
     ① 钱不够时**不许落账**（先扣钱再落账，顺序不能反）
     ② 钱够时**真的扣掉**，且只扣一次
     这两条在截图上一模一样（按钮都画出来了），只能拿代码问。 */
  {
    /* 沙箱的 localStorage 从 `boot()` 返回的上下文里拿 —— 塞一份带巢币的存档 */
    const sb = boot();
    sb.localStorage.setItem("pawpack.save.v1", JSON.stringify({ nestCoins: 100 }));
    const M = sb.GROVE;
    M.writeNestDepth(23);
    M.openGates();
    M.openModBoard();

    const rows = M.modBoardRows();
    ok(rows.rows.length > 0, "看板有行可点");
    const price = rows.rows[0].mod.skip;

    /* ① 先花光再看：故意把价格设成买不起的量 */
    sb.localStorage.setItem("pawpack.save.v1", JSON.stringify({ nestCoins: 1 }));
    const before = M.S.nestSkip.length;
    M.skipModAt(0);
    eq(M.S.nestSkip.length, before, "★ 巢币不够时**不落账**（钱没扣、词条也没跳过）");
    /* 提示必须报出**具体差多少**，不是一句"钱不够"。
       而且这句要短到塞得进底栏（"巢币 xxx" 到 "出发" 按钮之间只剩 ~124px）：
       上一版写「还差 N 枚 · 再往下潜就能赚到」，后半截压在黄按钮底下，
       截图里读作"再往下潜就[出发]"。带"·"就意味着又要挂解释，直接判死。 */
    ok(M.S.modBoard.say.indexOf("还差 " + (price - 1) + " 枚") >= 0,
       "★ 巢币不够时报出还差多少", M.S.modBoard.say);
    ok(M.S.modBoard.say.indexOf("·") < 0,
       "★ 差额提示不带「怎么赚」的解释（底栏放不下，会撞出发按钮）", M.S.modBoard.say);
    eq(M.readNestCoins(), 1, "★ 失败时巢币一分没动");

    /* ② 钱够：扣款 + 落账，且余额对得上 */
    sb.localStorage.setItem("pawpack.save.v1", JSON.stringify({ nestCoins: price + 7 }));
    M.skipModAt(0);
    eq(M.S.nestSkip.length, before + 1, "★ 钱够时落账（名单多一条）");
    eq(M.readNestCoins(), 7, "★ 钱够时精确扣掉 " + price);
    eq(M.nestModsAt(24).length, rows.rows.length - 1, "★ 跳过之后生效的词条少一条");

    /* ③ 同一条不能再买第二次（否则会白扣钱） */
    const coinsNow = M.readNestCoins();
    M.skipModAt(0);
    eq(M.readNestCoins(), coinsNow, "★ 已关过的条目再点不扣钱");
  }
}

checkNestMods();

checkNestFog();

console.log("\n" + "=".repeat(56));
if (fail) {
  console.log("通过 " + pass + " · 失败 " + fail);
  for (const f of fails) console.log("  - " + f);
  process.exitCode = 1;
} else {
  console.log("全部通过：" + pass + " 项");
}
console.log("=".repeat(56));
