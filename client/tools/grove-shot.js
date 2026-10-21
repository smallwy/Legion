/* ============================================================================
   grove.html 离屏渲染截图
   ----------------------------------------------------------------------------
   用 @napi-rs/canvas 把真实的一帧画出来，而不是靠坐标推断"应该长什么样"。
   上一版就是因为没截图，把六棵树画在了战场背后，读起来像"战斗发生在树上"。

   运行：
     NODE_PATH=.../node_modules node grove-shot.js
   ========================================================================== */

const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const noop = () => {};

function boot() {
  const code = fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];

  const main = createCanvas(W, H);
  main.style = {};
  main.addEventListener = noop;
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });

  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN,
    document: {
      getElementById: () => main,
      createElement: () => {
        const c = createCanvas(1, 1);
        c.style = {};
        c.addEventListener = noop;
        return c;
      },
    },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return { P: sb.GROVE, S: sb.GROVE.S, canvas: main };
}

function save(canvas, name) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
  console.log("  " + file);
}

function step(P, n, dt) {
  for (let i = 0; i < n; i++) P.tick(dt || 1 / 60);
}

/* ---------------- 1. 门口：六只等着出门 ---------------- */
{
  const { P, S, canvas } = boot();
  step(P, 30);                 // 先走几帧，星星和呼吸才不是静止的
  S.hover = 3;                 // 悬停长耳兔，看它的自荐台词
  P.render();
  save(canvas, "grove-01-门口.png");
}

/* ---------------- 1b. 出门演出：其余五只的反应 ----------------
   这一格就是 B 路线的全部赌注 —— 商店页 GIF 的第二帧。
   拍在 0.77s：门已经掀开、落选反应到了一半（狗在往门口挪、猫转过身、
   牛趴下了、狐狸只剩眼睛）。 */
{
  const { P, S, canvas } = boot();
  step(P, 20);
  P.pickHero(3);               // 带长耳兔走
  step(P, 46);                 // 46 帧 ≈ 0.77s
  P.render();
  save(canvas, "grove-01b-出门.png");
}


/* ---------------- 1c. 门口动画帧序列（给 GIF 用） ----------------
   DOOR_GIF=1 时输出到 shots/_door_frames/，再由 make-gif.py 合成。
   20fps = 每帧走 3 个 1/60 tick。

   为什么要 GIF 而不是几张静帧：这 1.6 秒卖的是"其余五只的反应"，
   而那是一个**动作**（狗追上去、猫扭头、牛趴下、狐后退），
   静帧只能证明"它们站在这"，证明不了"它们有反应"。 */
if (process.env.DOOR_GIF) {
  const dir = path.join(OUT, "_door_frames");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const { P, S, canvas } = boot();
  let n = 0;
  const grab = () => {
    P.render();
    fs.writeFileSync(path.join(dir, "f" + String(n).padStart(4, "0") + ".png"),
                     canvas.toBuffer("image/png"));
    n++;
  };

  // 待机 12 帧（0.6s）：悬停在长耳兔身上，让它先自荐一句
  step(P, 8);
  S.hover = 3;
  for (let f = 0; f < 12; f++) { step(P, 3); grab(); }

  // 出发 34 帧（1.7s）：picked 之后到 1.62s 会自动 beginRun，所以够用
  S.hover = -1;
  P.pickHero(3);
  for (let f = 0; f < 34; f++) { step(P, 3); grab(); }

  console.log("  帧序列 → " + dir + "（" + n + " 帧）");
}

/* ---------------- 1d. 结算面板：继续，还是收工 ----------------
   这一格承载"一趟"的全部信息：攒了多少、× 多少倍、肚子还剩多少、
   它说了一句什么、以及"继续 / 收工"两个按钮。
   用第 1 关（goal = clear）伪造一次过关，数字全部写到面板上。 */
{
  const { P, S, canvas } = boot();
  P._start(0, 0);
  S.foes.length = 0;
  S.balls.length = 0;
  S.wave = P.WAVES.length - 1;
  S.waveGap = 0;
  S.killed = S.total;
  S.food = 40;
  S.playT = 41.2;
  S.stat.made = 3;
  S.stat.maxHolds = 4;
  S.stat.burst = 0;
  S.stat.hits = 1;
  P.tick(1 / 60);
  step(P, 10);                 // 让面板上的"它说"那句淡入
  P.render();
  save(canvas, "grove-23-结算面板.png");
}

/* ---------------- 1e. 全饿：饿牌 + 瘪肚子 + 抱怨 ----------------
   这一格要证明"饿"不是一张图标，而是能一眼看出来的状态：
   肚子瘪下去、眼睛垂、头顶挂一个"饿"、台词换成求饶。 */
{
  const { P, S, canvas } = boot();
  S.belly = 22;                // 必须先设肚子再开局：全饿的关卡提示是在 beginRun 里发的
  P._start(1, 2);              // 短尾犬 · 第 3 关
  step(P, 24);
  S.say.txt = "……真的跑不动了。";
  S.say.t = 1; S.say.life = 2;
  P.render();
  save(canvas, "grove-24-饿了.png");
}

/* ---------------- 1f. 门口：带回来的果子 ----------------
   "出门有产出"唯一看得见的证据。没有家园之前，它们就堆在屋前。 */
{
  const { P, S, canvas } = boot();
  step(P, 30);
  S.home = { loot: 78, runs: 3, lastLoot: 49 };
  S.progress = 4;
  P.render();
  save(canvas, "grove-25-屋前果子.png");
}

/* ---------------- 2. 开场 ---------------- */
{
  const { P, S, canvas } = boot();
  P._start(0);
  step(P, 40);
  P.render();
  save(canvas, "grove-02-开场.png");
}

/* ---------------- 3. 战斗中期：包裹层 + 滚球 ---------------- */
{
  const { P, S, canvas } = boot();
  P._start(0);
  step(P, 30);

  const p = S.p;
  p.x = 300; p.y = 462; p.face = 1;

  const bugs = S.foes.filter(f => f.kind === "walk");
  // 一只裹了 1 层、一只裹了 2 层（发光，提示"撞一下就成球"）
  if (bugs[0]) { bugs[0].x = 620; bugs[0].y = 462; bugs[0].coat = 2; bugs[0].hitT = 0.05; }
  if (bugs[1]) { bugs[1].x = 760; bugs[1].y = 462; bugs[1].coat = 1; }
  if (bugs[2]) { bugs[2].x = 200; bugs[2].y = 350; bugs[2].coat = 0; }

  // 一颗已经滚起来的球（里面装了 3 个）
  const f = S.foes.find(x => x.kind === "walk");
  if (f) {
    P.coatFoe(f, 3);
    const b = S.balls[0];
    b.x = 520; b.y = 462; b.vx = 520; b.vy = 0;
    b.packed = [f.def, f.def, f.def]; b.holds = 3;
    b.r = 20 + Math.min(16, 3 * 2.8); b.w = b.h = b.r * 2;
    b.spin = 1.2; b.onGround = true;
  }

  // 玩家刚喷出去的弹丸
  P.spawnShot({ x: p.x + 22, y: p.y - 26, vx: 640, vy: 0, r: 10, life: 0.9, color: "#FFDCA8" });
  P.spawnShot({ x: p.x + 14, y: p.y - 34, vx: 640, vy: -105, r: 10, life: 0.9, color: "#FFDCA8" });
  P.spawnShot({ x: p.x + 14, y: p.y - 18, vx: 640, vy: 105, r: 10, life: 0.9, color: "#FFDCA8" });

  S.texts.length = 0;   // 清掉开场那行大字，别挡住画面
  S.t = 3.2;
  step(P, 2);
  P.render();
  save(canvas, "grove-03-战斗中期.png");
}

/* ---------------- 4. 火坑烧球 ---------------- */
{
  const { P, S, canvas } = boot();
  P._start(0);
  step(P, 30);
  const p = S.p;
  p.x = 380; p.y = 556; p.face = 1;

  const fire = P.PITS.find(x => x.kind === "fire");
  const f = S.foes.find(x => x.kind === "walk");
  P.coatFoe(f, 3);
  const b = S.balls[0];
  b.x = fire.x + fire.w / 2; b.y = 556; b.vx = 200; b.onGround = true;
  b.packed = [f.def, f.def]; b.holds = 2;

  S.t = 5;
  step(P, 3);
  P.render();
  save(canvas, "grove-04-火坑.png");
}

/* ---------------- 5. 整局跑完的结算 ---------------- */
{
  const { P, S, canvas } = boot();
  P._start(2);

  // 复刻测试里的机器人，把这一局真的打完
  let frames = 0;
  while (frames < 60 * 180 && S.phase === "play") {
    bot(P, S);
    P.tick(1 / 60);
    frames++;
  }
  step(P, 30);
  P.render();
  save(canvas, "grove-05-结算.png");
  console.log("   （结算：阶段 " + S.phase + " · 收成 " + S.food + " · 用时 " + S.t.toFixed(1) + "s）");
}

/* ---------------- 6. 地形特写：每个有斜坡/特殊地形的关卡各一张 ---------------- */
{
  // 只看一张图会漏掉别的关卡：斜坡的坡度不同，垂直等厚的效果要逐关看。
  // 八关全拍。空间设计是这一版的主线之一，只看两三关没法判断"每关轮廓能不能一眼分开"。
  const shots = [
    [0, "苔原入口"],
    [1, "泥沼"],
    [2, "断崖"],
    [3, "缓坡"],
    [4, "弹菇"],
    [5, "深井"],
    [6, "阶梯塔"],
    [7, "双塔"],
  ];
  for (const [idx, name] of shots) {
    const { P, S, canvas } = boot();
    P._start(0, idx);   // 第 1 个参数是角色，第 2 个才是关卡
    step(P, 20);
    S.texts.length = 0;   // 清掉开场大字，别挡住地形
    S.p.x = 560; S.p.y = 350;
    S.t = 2;
    step(P, 2);
    P.render();
    save(canvas, "grove-06-地形-" + idx + "-" + name + ".png");
  }
}

function bot(P, S) {
  const p = S.p;
  if (!p || p.dead) return;
  S.keys.left = false; S.keys.right = false;

  if (S.balls.length) {
    let nb = S.balls[0], nd = 1e9;
    for (const b of S.balls) {
      const d = Math.abs(b.x - p.x) + Math.abs(b.y - p.y) * 0.8;
      if (d < nd) { nd = d; nb = b; }
    }
    if (Math.abs(nb.vx) < 100 && Math.abs(nb.y - p.y) < 50) {
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
    if (Math.abs(nb.vx) < 100) {
      if (Math.abs(nb.x - p.x) < 26 && nb.y < p.y - 40 && p.onGround) S.press.jump = true;
      else if (nb.x > p.x + 10) S.keys.right = true;
      else if (nb.x < p.x - 10) S.keys.left = true;
      return;
    }
  }

  const alive = S.foes.filter(f => !f.dead);
  if (!alive.length) return;
  const same = alive.filter(f => Math.abs(f.y - p.y) < 56);
  const pool = same.length ? same : alive;
  let tgt = pool[0], bd = 1e9;
  for (const f of pool) {
    const d = Math.abs(f.x - p.x);
    if (d < bd) { bd = d; tgt = f; }
  }
  if (!tgt) return;

  const dx = tgt.x - p.x, dy = tgt.y - p.y, dist = Math.abs(dx);

  if (Math.abs(dy) > 56) {
    if (dy > 56) {
      const g = p.ground;
      if (g && p.onGround) {
        const toL = p.x - g.x, toR = (g.x + g.w) - p.x;
        if (toL < toR) S.keys.left = true; else S.keys.right = true;
      } else if (dx > 10) S.keys.right = true;
      else if (dx < -10) S.keys.left = true;
      return;
    }
    if (dx > 10) S.keys.right = true;
    else if (dx < -10) S.keys.left = true;
    if (p.onGround) S.press.jump = true;
    return;
  }

  let blocked = false;
  for (const st of S.stumps) {
    if (st.hp <= 0) continue;
    const lo = Math.min(p.x, tgt.x), hi = Math.max(p.x, tgt.x);
    if (st.x > lo && st.x < hi && Math.abs(st.y - p.y) < 110) blocked = true;
  }
  if (blocked) {
    if (dx > 0) S.keys.right = true; else S.keys.left = true;
    if (p.onGround) S.press.jump = true;
    return;
  }

  if (dist > 230) {
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

console.log("\n截图完成 → " + OUT);
