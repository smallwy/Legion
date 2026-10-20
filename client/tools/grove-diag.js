/* ============================================================================
   grove-diag.js —— 诊断工具：球的生死簿 + 落点可达性地图

   冒烟测试只告诉你"过了 / 没过"，不告诉你**为什么**。这个脚本回答三个问题：

     1. 每颗球是怎么没的？（烧掉 / 进袋 / 漏气崩开）
        崩开是纯浪费 —— 造出来没人推，等于白造。占比高就说明关卡引导有问题，
        或者机器人够不到它，而不是"关太难"。

     2. 机器人卡在哪里？（连续 N 秒位置不变 / 反复换层）
        死锁是设计硬伤：玩家也会卡在同一个地方。

     3. 从某个位置朝某个方向推，球最终会去哪？
        用游戏自己的 predictBall 枚举全图，输出"可达性地图"。
        如果营地从头到尾没有被任何位置指向，那这屏的「落袋」目标**天生无解** ——
        这不是调参能救的，必须改几何。

   运行：
     node grove-diag.js               全部关卡
     node grove-diag.js 2             只看第 2 关（0-8）
     node grove-diag.js reach 1       只看第 1 屏的可达性地图
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = path.join(__dirname, "..", "prototype", "grove.html");

function noop() {}
function mkCanvas(w, h) {
  const c = {
    width: w, height: h,
    getContext: () => new Proxy({}, {
      get: (t, k) => {
        if (k === "canvas") return c;
        if (k === "createLinearGradient" || k === "createRadialGradient")
          return () => ({ addColorStop: noop });
        if (k === "measureText") return () => ({ width: 10 });
        if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
        if (k === "putImageData" || k === "drawImage") return noop;
        return typeof k === "string" ? noop : undefined;
      },
      set: () => true,
    }),
    style: {},
    addEventListener: noop,
  };
  return c;
}

function boot() {
  const html = fs.readFileSync(HTML, "utf8");
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const main = mkCanvas(960, 600);
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN, undefined,
    document: { getElementById: () => main, createElement: () => mkCanvas(1, 1) },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return sb;
}

function seed(S, n) {
  let x = (n === undefined ? 20261020 : n) >>> 0;
  S.rng = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

/* ---------- 机器人：和冒烟测试共用 grove-bot.js ---------- */
const { botStep } = require("./grove-bot");

const STAGE_NAMES = ["1-1 断崖·清场", "1-2 断崖·限球", "1-3 断崖·连锁",
  "2-1 双坑·清场", "2-2 双坑·限球", "2-3 双坑·落袋",
  "3-1 高台·清场", "3-2 高台·限球", "3-3 高台·连锁"];

/* ---------- 生死簿 ---------- */

function runStage(P, S, maxFrames) {
  const mem = { fallDir: 0 };
  const seen = new Map();          // ball -> { x, y, bornT }
  const book = [];                 // { x, y, bornT, diedT, why }
  let stuck = 0, lastX = -1e9, stuckLog = [];
  let burned0 = 0, banked0 = 0, made0 = 0;

  for (let f = 0; f < maxFrames; f++) {
    if (S.phase !== "play") break;
    botStep(P, S, mem);
    P.tick(1 / 60);
    const t = S.t;

    for (const b of S.balls) {
      if (!seen.has(b)) { seen.set(b, { x: b.x, y: b.y, bornT: t }); }
    }
    // 结算：本帧里 burned / banked 涨了，就认为最后一颗离场的球是这么没的
    const dBurn = S.stat.burned - burned0, dBank = S.stat.banked - banked0;
    const nowIds = new Set(S.balls);
    for (const [b, rec] of seen) {
      if (nowIds.has(b)) continue;
      seen.delete(b);
      let why = "burst";
      if (dBurn > 0) why = "burn";
      else if (dBank > 0) why = "bank";
      book.push({ x: b.x, y: b.y, bornT: rec.bornT, diedT: t, why, holds: b.holds || 0 });
    }
    burned0 = S.stat.burned; banked0 = S.stat.banked; made0 = S.stat.made;

    // 死锁检测：位置连续 6 秒不动
    if (Math.abs(S.p.x - lastX) < 3) stuck++; else { stuck = 0; lastX = S.p.x; }
    if (stuck === 360) {
      stuckLog.push({ t: t.toFixed(0), x: S.p.x.toFixed(0), y: S.p.y.toFixed(0),
        balls: S.balls.map(b => b.x.toFixed(0) + "," + b.y.toFixed(0)).join(" ") });
    }
    if (stuck === 720) stuck = 0;
  }
  return { book, stuckLog };
}

/* ---------- 落点可达性地图 ---------- */

function reachMap(P, levelIdx) {
  const sb = boot();
  const PP = sb.GROVE, SS = PP.S;
  seed(SS);
  PP._start(0, levelIdx);
  const R = PP.curStage();

  const ys = [248, 350, 462, PP.PLATS[0].y];
  const map = {};   // y -> { fire: [...], camp: [...], stump: [...], wall: [...], mud:[...] }

  for (const y of ys) {
    const key = y === PP.PLATS[0].y ? "ground" : String(y);
    map[key] = { camp: [], fire: [], stump: [], wall: [], stop: [], air: [] };
    for (let x = PP.WALL_L + 14; x <= PP.WALL_R - 14; x += 8) {
      // 该位置得真的有站得住的东西
      const onIt = PP.PLATS.some(q => Math.abs(q.y - y) < 4 && x > q.x && x < q.x + q.w);
      if (!onIt) continue;
      for (const dir of [-1, 1]) {
        // 直接借 predictBall：造一颗临时球塞进去
        const tmp = {
          x, y: y - 24, vx: dir * 620, vy: 0, onGround: true, r: 24,
          holds: 0, mud: false, air: 1, packed: [], dead: false,
        };
        PP.S.balls.push(tmp);
        let pr;
        try { pr = PP.predictBall(tmp, dir); } catch (e) { pr = { end: "none", pts: [] }; }
        PP.S.balls.pop();
        const k = map[key][pr.end] !== undefined ? pr.end : "air";
        const last = pr.pts[pr.pts.length - 1] || { y: y };
        map[key][k].push(Math.round(x) + (dir > 0 ? ">" : "<") +
          (pr.end === "stop" ? "@" + Math.round(last.y + 24) : ""));
      }
    }
  }
  return { room: R, map };
}

function summarize(list) {
  if (!list || !list.length) return "—";
  if (list.length <= 6) return list.join(" ");
  return list.slice(0, 6).join(" ") + " …共" + list.length;
}

/* ---------- 主流程 ---------- */

const arg = process.argv[2];

if (arg === "reach") {
  const only = process.argv[3] !== undefined ? Number(process.argv[3]) : -1;
  for (let i = 0; i < 3; i++) {
    if (only >= 0 && i !== only) continue;
    const { room, map } = reachMap(null, i);
    console.log("\n=== 落点可达性地图：" + room.name + " ===");
    console.log("  格式：起点x + 推的方向（> 向右 / < 向左）→ 终点");
    for (const y of Object.keys(map)) {
      console.log("  " + y + ":");
      for (const k of ["camp", "fire", "stump", "stop", "wall", "air"]) {
        if (map[y][k].length) console.log("    " + k.padEnd(6) + summarize(map[y][k]));
      }
    }
  }
  process.exit(0);
}

const only = arg !== undefined ? Number(arg) : -1;

console.log("\n=== 关卡诊断：球是怎么没的 ===");
const NLEV = boot().GROVE.LEVELS.length;
for (let i = 0; i < NLEV; i++) {
  if (only >= 0 && i !== only) continue;
  const sb = boot();
  const P = sb.GROVE, S = P.S;
  seed(S);
  P._start(2, i);
  S.p.hp = 999; S.p.maxHp = 999;

  const { book, stuckLog } = runStage(P, S, 60 * 240);
  const n = k => book.filter(b => b.why === k).length;
  const early = book.filter(b => b.why === "burst" && (b.diedT - b.bornT) < 12).length;

  console.log("\n" + (i + 1) + ". " + P.curStage().name +
    "   " + (S.phase === "clear" ? "达标" : S.phase === "fail" ? "失败" : "超时") +
    " · " + S.t.toFixed(0) + "s · 清 " + S.killed + "/" + S.total +
    " · 造 " + S.stat.made + " 崩 " + n("burst") + " 烧 " + n("burn") + " 袋 " + n("bank") +
    " · 单球最多装 " + S.stat.maxHolds + " 只 · 落袋人头 " + S.stat.bankHolds +
    " · 收成 " + S.food);
  if (n("burst")) {
    console.log("    崩开的球里，有 " + early + " 颗活不过 12 秒（造出来就没人管）");
    const byY = {};
    for (const b of book) if (b.why === "burst") {
      const k = Math.round(b.y / 50) * 50;
      byY[k] = (byY[k] || 0) + 1;
    }
    console.log("    崩开位置分层：" + Object.entries(byY).map(([k, v]) => k + "→" + v).join("  "));
  }
  if (stuckLog.length) {
    console.log("    死锁：" + stuckLog.slice(0, 4).map(s =>
      "t=" + s.t + " 站(" + s.x + "," + s.y + ")" + (s.balls ? " 球[" + s.balls + "]" : "")).join(" | "));
  }
  const alive = S.foes.filter(f => !f.dead);
  if (alive.length) {
    console.log("    剩下：" + alive.map(f => f.def.name + "@" + f.x.toFixed(0) + "," + f.y.toFixed(0)).join("  "));
  }
}
console.log("");
