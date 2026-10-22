/**
 * 一球最多卷几只 —— 「吸引」策略的地基验证。
 *
 * 为什么单独写一个脚本：
 *   上一轮我说「一球 5 连、连锁滚穿整屏」，那是 BALL x PIT 的机制。
 *   本游戏的真实机制是**雪球**：球滚过糊满的人 → 卷进球里 → 球变大继续滚。
 *   两者画面完全不同（一个是"炸开一串"，一个是"越滚越大"），
 *   卖点文案和 GIF 分镜全都要按真实机制写。
 *
 * 所以先量清楚三件事，再决定要不要改关卡：
 *   1. 现状第 1 关 P1（一行 3 只）一球能卷几只 —— 上限是几
 *   2. 改成一行 6 只后能卷几只 —— 「5 连」在几何上成不成立
 *   3. 球卷到第 N 只时直径多大 —— 会不会大到撞不上台面上的人
 *
 * 用法：node tools/_chain-test.js
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "prototype", "grove.html");

function boot() {
  const code = fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
  const main = createCanvas(960, 600);
  main.style = {};
  main.addEventListener = () => {};
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 600 });
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN, parseInt, parseFloat,
    document: {
      getElementById: () => main,
      createElement: () => {
        const c = createCanvas(1, 1);
        c.style = {};
        c.addEventListener = () => {};
        return c;
      },
    },
    performance: { now: () => Date.now() },
    addEventListener: () => {},
    innerWidth: 1280, innerHeight: 800,
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return { P: sb.GROVE, S: sb.GROVE.S };
}

/**
 * 摆一排敌人 + 造一颗球，让它往右滚，统计卷了几只。
 *
 * @param n      一排摆几只
 * @param gap    间距（px）
 * @param x0     第一只的 x
 * @returns {holds, koed, trace}
 */
function run(n, gap, x0, y) {
  const { P, S } = boot();
  P._start(0, 0);

  // 清场：只留我们自己摆的这一排，否则波次刷新会把变量搅乱
  S.foes.length = 0;
  S.balls.length = 0;
  S.shots.length = 0;
  S.hudTip = 0;

  const foes = [];
  for (let i = 0; i < n; i++) {
    const f = P.foeFromSpec({ foe: "bug", x: x0 + i * gap, y, lv: 1 }, false);
    f.vx = 0; f.vy = 0; f.face = 1; f.stun = 999;   // 冻住：只测滚球能卷几只，不测它会跑
    f.dir = 0; f.chargeT = 999; f.hitT = 0;
    // 前置条件：玩家已经把它糊到 2 层（cm=3），差最后一下
    f.coat = 2;
    S.foes.push(f);
    foes.push(f);
  }

  // 用第一只造球（模拟玩家技能推击：vx 660 是 2014 行的实测值）
  const first = foes[0];
  first.coat = 3;
  P.makeBallFrom(first, 660, 0);
  const ball = S.balls[0];
  if (!ball) throw new Error("makeBallFrom 没造出球");
  // 抬到台面上方：球底贴台面顶，不然它一出生就掉下去
  ball.vy = 0;

  const trace = [];
  let lastHolds = ball.holds;
  for (let i = 0; i < 150; i++) {
    P.updateBalls(1 / 60);
    if (ball.dead) { trace.push({ f: i, note: "球的 dead=true" }); break; }
    if (ball.holds !== lastHolds) {
      trace.push({ f: i, holds: ball.holds, r: +ball.r.toFixed(1), x: +ball.x.toFixed(0) });
      lastHolds = ball.holds;
    }
  }

  const alive = S.foes.filter((f) => !f.dead).length;
  return {
    holds: ball.dead ? (ball.holds || 0) : ball.holds,
    maxHolds: S.stat.maxHolds,
    koed: S.foes.filter((f) => f.dead).length,
    alive,
    rFinal: +ball.r.toFixed(1),
    ballDead: !!ball.dead,
    xFinal: +ball.x.toFixed(0),
    trace,
  };
}

const Y = 462;   // 第 1 关主球道台面顶

console.log("=== 一球能卷几只（第 1 关球道 y=462）===\n");

const cases = [
  ["现状 P1：一行 3 只，间距 150", 3, 150, 150],
  ["改后：一行 4 只，间距 130", 4, 130, 120],
  ["改后：一行 5 只，间距 110", 5, 110, 110],
  ["改后：一行 6 只，间距 92", 6, 92, 110],
  ["极限：一行 8 只，间距 68", 8, 68, 100],
];

for (const [label, n, gap, x0] of cases) {
  let r;
  try {
    r = run(n, gap, x0, Y);
  } catch (e) {
    console.log(label.padEnd(30) + "  异常：" + e.message);
    continue;
  }
  const tail = r.xFinal > 620 ? "  ← 冲出球道末端(620)" : "";
  console.log(
    label.padEnd(30) +
    "  卷 " + String(r.holds).padStart(2) + " / " + n +
    "  球径 " + String(r.rFinal).padStart(5) + "px" +
    "  终点x " + String(r.xFinal).padStart(4) + tail
  );
  if (r.trace.length) {
    console.log("      逐只：" + r.trace.map((t) => "第" + t.f + "帧 x" + t.x + "→" + t.holds + "只(r" + t.r + ")").join(" · "));
  }
}

console.log("\n注：球径 = 20 + min(16, holds×2.8)。台面厚 20，球径超过 60 时球心已高出很多，");
console.log("    但碰撞用的是圆心距，不影响能不能卷 —— 影响的是**看起来球压在人上面**。");
