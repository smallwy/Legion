/* ===========================================================================
   怪物"原地弹"探针 —— 只打印数字，不判 pass/fail
   ---------------------------------------------------------------------------
   用户反馈：「到这里会一直弹弹弹 好像遇到路障就有些问题 要不一直跳跳跳」
   截图里那只绿色的怪是 `moss`（`NUM.breed.moss.jump === 0`），它**根本不会跳**。
   所以"弹"只可能来自另外两条路：

     ① **蹭坎**（`f.y -= min(rise, crawlStep)`）—— 每一帧无条件抬起来。
        抬上去以后如果脚落不到那个面上（横向被箱子挡住），重力又把它拉下来，
        下一帧再抬 —— 画面就是一帧上一帧下的弹。这条路**没有冷却、没有次数上限**。
     ② **真跳**（`fang`，`jump: 545`）—— `jumpCd` 只有 0.75 秒，
        跳不上去就每 0.75 秒重复一次。

   本探针把两种分开计数，并且记下"每次在原地弹了多少下"——
   **一两次是巧合，连着十几次是被卡住了**。

   跑法：NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
         node client/tools/_foe-bounce.js [秒数] [种子...]
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
/* `PROTO=` 指另一份 html —— 和 `_snowlab-shot.js` 同一个约定。
   **改之前先跑一次对照组**，否则没法说"这数字是变好了还是本来就这样"。 */
const FILE = process.env.PROTO
  ? path.resolve(process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");
const SECS = Number(process.argv[2] || 20);
const SEEDS = process.argv.slice(3).map(Number).filter(n => !isNaN(n));
if (!SEEDS.length) SEEDS.push(7, 3, 12, 21, 42);

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("找不到内联脚本"); process.exit(1); }

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB, S = L.S;

const DT = 1 / 60;
const FRAMES = Math.round(SECS / DT);
const pad = (s, n) => String(s).padEnd(n);

let totalBounce = 0, totalJump = 0, worstList = [];

for (const seed of SEEDS) {
  L.newLevel(seed);
  for (let i = 0; i < 60; i++) L.step(DT);

  /* 每个怪一份轨迹。用 homeX+breed 当键 —— 敌人数组会 filter，下标不稳 */
  const track = new Map();
  const keyOf = f => f.breed + "@" + Math.round(f.homeX) + "/" + Math.round(f.homeY);
  S.foes.forEach(f => track.set(keyOf(f), {
    f, x0: f.x, y0: f.y, lifts: 0, jumps: 0, lands: 0,
    /* 连着弹的次数：一次"抬起来又落回去"算一下 */
    streak: 0, streakMax: 0, streakAt: null,
    yMin: 1e9, yMax: -1e9, xMin: 1e9, xMax: -1e9,
    liftRise: [],
    /* **"原地"才算弹。** 一串尝试里横向走开不到 3px 才是"撞在原地"；
       横跨 130px 一路蹭上去是正常爬坡，不能算。
       第一版不分这个，把一只正常爬箱堆的 grub 判成"连弹 50 次"。 */
    streakX0: null,
  }));

  let prev = new Map();
  for (const [k, t] of track) prev.set(k, { y: t.f.y, onGround: t.f.onGround, x: t.f.x, vy: t.f.vy });

  /** 记一次尝试。
      **连击的判据是"相对连击起点有没有走开"，不是"相对上一次"。**
      连续每帧抬 1px 的爬坡，相邻两次只差 1~2px，按"上一次"比会一路累加成
      几十连击 —— 可它其实横着走了 280px。改成每次都跟**这一串的起点**比，
      走开 3px 就重起一串。 */
  function note(t, f) {
    if (t.streakX0 === null) { t.streakX0 = f.x; t.streak = 1; t.lastX = f.x; return; }
    if (Math.abs(f.x - t.streakX0) < 3) {
      t.streak++;
      if (t.streak > t.streakMax) { t.streakMax = t.streak; t.streakAt = { x: f.x, y: f.y }; }
    } else {
      t.streak = 1; t.streakX0 = f.x;
    }
    t.lastX = f.x;
  }

  for (let fr = 0; fr < FRAMES; fr++) {
    L.step(DT);
    for (const f of S.foes) {
      const k = keyOf(f);
      const t = track.get(k);
      if (!t) continue;
      const p = prev.get(k);
      if (!p) continue;

      t.yMin = Math.min(t.yMin, f.y); t.yMax = Math.max(t.yMax, f.y);
      t.xMin = Math.min(t.xMin, f.x); t.xMax = Math.max(t.xMax, f.x);

      /* ---- 蹭坎：站在地上、y 却变小了。重力只会让 y 变大，所以这一定是抬上来的。
         **只算 ≥4px 的。** 0~2px 那些是斜坡/箱沿的对齐毛刺（身体贴地时每帧
         被地形回贴 1px），不是"想上上不去"。 */
      if (p.onGround && f.onGround && f.y < p.y - 0.4) {
        const rise = p.y - f.y;
        if (rise >= 4) { t.lifts++; t.liftRise.push(Math.round(rise)); note(t, f); }
      }
      /* ---- 真跳：从站在地上变成空中，且 vy < 0 */
      if (p.onGround && !f.onGround && f.vy < 0) {
        t.jumps++;
        note(t, f);
      }
      /* ---- 落地 */
      if (p.onGround && f.onGround && f.y >= p.y - 0.4) t.lands++;

      prev.set(k, { y: f.y, onGround: f.onGround, x: f.x, vy: f.vy });
    }
  }

  const rows = [...track.values()].filter(t => t.lifts + t.jumps > 0);
  const bad = rows.filter(t => t.streakMax >= 4);

  console.log("种子 " + seed + " · " + SECS + " 秒 · 怪 " + track.size + " 只");
  for (const t of rows.sort((a, b) => b.streakMax - a.streakMax).slice(0, 6)) {
    const rise = t.liftRise.length
      ? "抬幅 " + Math.min(...t.liftRise) + "~" + Math.max(...t.liftRise) + "px"
      : "—";
    console.log("  " + pad(t.f.breed, 6) +
      " 蹭 " + pad(t.lifts, 4) + " 跳 " + pad(t.jumps, 3) +
      " 原地连弹 " + pad(t.streakMax, 3) + " 次" +
      "  x " + pad(Math.round(t.xMax - t.xMin), 4) +
      " y " + pad(Math.round(t.yMax - t.yMin), 4) +
      "  " + rise +
      (t.streakAt ? "  @(" + Math.round(t.streakAt.x) + "," + Math.round(t.streakAt.y) + ")" : ""));
    totalBounce += t.lifts; totalJump += t.jumps;
    if (t.streakMax >= 4) worstList.push({ seed, breed: t.f.breed, n: t.streakMax, at: t.streakAt });
  }
  if (!rows.length) console.log("  （这一关没有怪动过）");
  if (bad.length) console.log("  → " + bad.length + " 只连续弹 ≥4 次");
  console.log("");
}

console.log("合计：蹭坎 " + totalBounce + " 次 · 真跳 " + totalJump + " 次 · 连续弹 ≥4 次的怪 " + worstList.length + " 只");
if (worstList.length) {
  console.log("最严重的几只：");
  for (const w of worstList.sort((a, b) => b.n - a.n).slice(0, 5)) {
    console.log("  种子 " + w.seed + " " + w.breed + " 连弹 " + w.n + " 次 @(" +
                Math.round(w.at.x) + "," + Math.round(w.at.y) + ")");
  }
}
