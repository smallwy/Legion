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
     7. 崩开：球停太久，里面的人复活
     8. 玩家：火坑烫 / 碰敌人受伤
     9. 整局跑通：机器人按规则打，必须能在时限内清场

   运行：node grove-smoke.js
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

/* ---------- 每段测试都重开一局，避免状态串味 ---------- */
console.log("\n=== 1. 开局与选人 ===");
{
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  eq(S.phase, "select", "刚打开应在选人界面");
  eq(S.foes.length, 6, "6 只敌人在场");
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
  eq(S.cleared, 3, "算清掉 3 只");
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
  P._start(0);
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

  // 再撞一次撞碎
  b.x = st.x - st.w / 2 - 30;
  b.vx = 1200;
  b.dead = false;
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
  for (let i = 0; i < 60 * 6; i++) P.tick(1 / 60);

  ok(S.balls.length === 0, "6 秒后球崩开了");
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

  ok(S.phase === "clear", "无限血下能把整片空地清空", "phase=" + S.phase + " alive=" + S.foes.length);
  ok(S.food >= 8, "8 只敌人打完，收成要上双位数", "food=" + S.food);
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
  ok(S.t > 8, "3 血能撑过 8 秒（低于这个数说明开局就被秒）", "t=" + S.t.toFixed(1));
}

function runBot(P, S, maxFrames) {
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
        " | balls=" + S.balls.length);
    }
  }
  return "用时 " + (frames / 60).toFixed(1) + "s · 阶段 " + S.phase +
         " · 清掉 " + S.cleared + "/" + S.total +
         " · 场上 " + S.foes.length + " 只 · 球 " + S.balls.length +
         " · 收成 " + S.food + " · 球[造" + S.stat.made + " 烧" + S.stat.burned + " 袋" + S.stat.banked + " 崩" + S.stat.burst + "]";
}

/**
 * 机器人策略刻意做成"一个正常玩家会做的事"，不用最优解：
 *  - 优先处理快崩开的球（那是已经到手的收益）
 *  - 只在**同一层**打人，不同层就先换层
 *  - 保持约 170px 距离喷，不贴脸（贴脸必吃碰撞）
 *  - 裹到两层才冲撞
 *
 * 它跑不通就说明关卡本身有硬伤，而不是"AI 不够聪明"。
 */
function botStep(P, S) {
  const p = S.p;
  if (!p || p.dead) return;
  S.keys.left = false; S.keys.right = false;

  // 1) 有停住的球就去推。这是整局唯一的收益出口 ——
  //    不推的话球会崩开，等于把这轮白打。所以优先级高于打人。
  //    而且要**推到结算点的那一侧**：站错边会把球推向远处，白推。
  if (S.balls.length) {
    let nb = S.balls[0], nd = 1e9;
    for (const b of S.balls) {
      const d = Math.abs(b.x - p.x) + Math.abs(b.y - p.y) * 0.8;
      if (d < nd) { nd = d; nb = b; }
    }
    if (Math.abs(nb.vx) < 100 && Math.abs(nb.y - p.y) < 50) {
      // 推向**最近的那个结算点**（火坑 535 / 营地 891），不是"离谁近就离开谁"。
      // 判断写反的话会把球一路推向左墙 —— 左墙什么都不是，
      // 球只会反弹回来然后崩开，一整局清不掉一只。
      const fireCx = 535, campCx = 891;
      const target = Math.abs(fireCx - nb.x) < Math.abs(campCx - nb.x) ? fireCx : campCx;
      const goRight = target > nb.x;
      const standX = nb.x + (goRight ? -48 : 48);
      if (p.x < standX - 14) S.keys.right = true;
      else if (p.x > standX + 14) S.keys.left = true;
      else if (goRight) S.keys.right = true;
      else S.keys.left = true;
      return;
    }
    // 只有**停住的**球才需要人管。还在滚的球别追 —— 追也追不上，
    // 而且会把整段时间浪费在等它停上（实测会变成 180 秒只造 5 个球）。
    // 空档期应该拿去打下一只。
    if (Math.abs(nb.vx) < 100) {
      // 球在别的层。注意这里不能只写"朝球水平移动" ——
      // 球如果在玩家正上方或正下方，水平方向已经是 0，机器人会站着不动，
      // 整局就卡在那儿（实测能卡满 180 秒）。
      if (Math.abs(nb.x - p.x) < 26 && nb.y < p.y - 40 && p.onGround) {
        S.press.jump = true;
      } else if (nb.x > p.x + 10) S.keys.right = true;
      else if (nb.x < p.x - 10) S.keys.left = true;
      return;
    }
  }

  const alive = S.foes.filter(f => !f.dead);
  if (!alive.length) return;

  // 2) 同层优先
  const same = alive.filter(f => Math.abs(f.y - p.y) < 56);
  const pool = same.length ? same : alive;
  let tgt = pool[0], bd = 1e9;
  for (const f of pool) {
    const d = Math.abs(f.x - p.x);
    if (d < bd) { bd = d; tgt = f; }
  }

  const dx = tgt.x - p.x;
  const dy = tgt.y - p.y;
  const dist = Math.abs(dx);

  // 3) 不同层：换层去（喷是水平的，隔着层打不到）
  if (Math.abs(dy) > 56) {
    if (dy > 56) {
      // 目标在**下面**：必须走到平台边缘掉下去。
      // 只写"朝目标 x 移动"会死锁 —— 目标就在自己正下方时，
      // 玩家会在它头顶的平台上左右横跳，永远不下去（实测 100 秒没进展）。
      const g = p.ground;
      if (g && p.onGround) {
        const toL = p.x - g.x, toR = (g.x + g.w) - p.x;
        if (toL < toR) S.keys.left = true; else S.keys.right = true;
      } else {
        if (dx > 10) S.keys.right = true;
        else if (dx < -10) S.keys.left = true;
      }
      return;
    }

    let plat = null;
    for (const q of P.PLATS) {
      if (Math.abs(q.y - tgt.y) < 8 && tgt.x > q.x - 20 && tgt.x < q.x + q.w + 20) { plat = q; break; }
    }
    if (plat && dy < -30) {
      // 跳的时候别落在敌人身上 —— 落在平台离它最远的那一头，
      // 上去之后再水平靠近。硬顶着跳等于拿血换位。
      const L = plat.x + 42, Rr = plat.x + plat.w - 42;
      const safeX = Math.abs(L - tgt.x) > Math.abs(Rr - tgt.x) ? L : Rr;
      if (p.x < safeX - 14) S.keys.right = true;
      else if (p.x > safeX + 14) S.keys.left = true;
      if (p.onGround && Math.abs(p.x - safeX) < 80) S.press.jump = true;
    } else {
      if (dx > 10) S.keys.right = true;
      else if (dx < -10) S.keys.left = true;
      if (p.onGround) S.press.jump = true;
    }
    return;
  }

  // 4) 同层：保持距离喷；太近就撞开（撞的时候无敌，比站着挨打安全）
  const IDEAL = 175;

  // 子弹会被木桩挡住 —— 站在桩子这侧一直喷是打不到另一侧的，
  // 而玩家又不会自己想到"这局是不是被挡住了"。不处理的话机器人
  // 会在木桩后面站满 100 秒，一枪都不中（实测）。
  let blocked = false;
  for (const st of S.stumps) {
    if (st.hp <= 0) continue;
    const lo = Math.min(p.x, tgt.x), hi = Math.max(p.x, tgt.x);
    if (st.x > lo && st.x < hi && Math.abs(st.y - p.y) < 110) blocked = true;
  }
  if (blocked) {
    if (dx > 0) S.keys.right = true; else S.keys.left = true;
    if (p.onGround) S.press.jump = true;    // 跳上桩子，从另一侧下来
    return;
  }

  if (dist > IDEAL + 55) {
    if (dx > 0) S.keys.right = true; else S.keys.left = true;
  } else if (dist < 100) {
    if (dx > 0) S.keys.left = true; else S.keys.right = true;
    if (p.dashCd <= 0) S.press.dash = true;
  } else {
    p.face = dx >= 0 ? 1 : -1;
  }

  if (dist < 300) S.press.atk = true;
  if (tgt.coat >= 2 && dist < 64 && p.dashCd <= 0) S.press.dash = true;
}

/* ---------- 汇总 ---------- */
console.log("\n" + "=".repeat(56));
if (fail === 0) {
  console.log("全部通过：" + pass + " 项");
} else {
  console.log("通过 " + pass + " · 失败 " + fail);
  for (const f of fails) console.log("  - " + f);
  process.exitCode = 1;
}
console.log("=".repeat(56) + "\n");
