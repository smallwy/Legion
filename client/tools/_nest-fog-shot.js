/* ============================================================================
   _nest-fog-shot.js —— 雾巢的离屏验收图（不开浏览器）
   ----------------------------------------------------------------------------
   验的是"雾到底有没有被看成一件事"，不是"代码跑不跑"：
     1. 进层第一帧：整屏被雾封住，只有随身灯一圈 ——
        这一帧决定玩家信不信"这里是黑的"
     2. 走两步之后：走过的地方留下**记忆**（比未探亮、比脚下暗），
        三档明度必须能一眼分开，分不开的话雾就只是"变暗"
     3. 推一颗球：球是火，它会照亮一条路 —— 这是整个玩法的支点
     4. 打碎菌光囊：那片永久亮起来
     5. 深层：雾更浓、灯更小
     6. 雾里的怪：只看得见一双眼睛

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_nest-fog-shot.js
     DEPTH=12 NODE_PATH=... node tools/_nest-fog-shot.js     # 换层
     PROTO=prototype/_grove-old.html NODE_PATH=... node tools/_nest-fog-shot.js  # 拍改之前
   产物落 ../shots/_nest-fog-*.png（`_` 前缀，不入库）。
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const PREFIX = process.env.PREFIX || "_nest-fog-";
const DEPTH = Number(process.env.DEPTH || 1);
const noop = () => {};

/* 真实 canvas 桩：雾要用 globalCompositeOperation、渐变、putImageData，
   假 ctx 上这些全是 noop，出来一片黑 —— 什么都验不出来。 */
function boot() {
  const code = fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
  const main = createCanvas(W, H);
  main.style = {};
  main.addEventListener = noop;
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
  const mem = {};
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN,
    localStorage: {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    },
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
  return { P: sb.GROVE, canvas: main };
}

function shot(P, canvas, name) {
  P.render();
  const f = path.join(OUT, PREFIX + name + ".png");
  fs.writeFileSync(f, canvas.toBuffer("image/png"));
  console.log("  " + f);
}

/** 走一段：**每帧只挪一小步**，让物理和雾都按真实节奏走。
 *  直接改 x 会很远再 tick 的话，雾只会亮"起点"和"终点"两团，
 *  中间那段路是黑的 —— 看起来像雾漏了。 */
function walk(P, dx, frames) {
  const S = P.S;
  for (let i = 0; i < frames; i++) {
    S.p.x += dx / frames;
    P.tick(1 / 60);
  }
}

function run() {
  const depth = DEPTH;

  /* ---- 1. 进层第一帧 ---- */
  {
    const { P, canvas } = boot();
    P.enterNest(depth);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 8; i++) P.tick(1 / 60);
    shot(P, canvas, depth + "-01-start");
  }

  /* ---- 2. 走一段，看记忆区 ---- */
  {
    const { P, canvas } = boot();
    P.enterNest(depth);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 10; i++) P.tick(1 / 60);
    walk(P, 210, 150);
    shot(P, canvas, depth + "-02-walk");
  }

  /* ---- 3. 推一颗球（球是火）---- */
  {
    const { P, canvas } = boot();
    P.enterNest(depth);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 10; i++) P.tick(1 / 60);
    walk(P, 160, 110);
    /* 把最近的一只小怪裹成球再推出去 —— 这是游戏里真实存在的动作，
       不自己拼一个球的假数据（拼出来的球不经过 spawn 的各项初始化）。 */
    /* 特意挑**离玩家最远**的那只：这一张要证明的是"球把光带到了灯照不到的地方"，
       放在脚边就什么都证明不了。 */
    let best = null, bd = -1;
    for (const f of S.foes) {
      if (f.isBoss) continue;
      const d = Math.abs(f.x - S.p.x);
      if (d > bd) { bd = d; best = f; }
    }
    if (best) {
      P.makeBallFrom(best, best.x < S.p.x ? -300 : 300, -40);
      for (let i = 0; i < 45; i++) P.tick(1 / 60);
    }
    shot(P, canvas, depth + "-03-ball");
  }

  /* ---- 4. 打碎菌光囊 ---- */
  {
    const { P, canvas } = boot();
    P.enterNest(depth);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 10; i++) P.tick(1 / 60);
    const pod = S.pods[0];
    if (pod) {
      const tx = pod.x + pod.w / 2;
      /* 走过去（分帧挪），最后落在囊身上让它炸开 */
      let left = tx - S.p.x;
      const frames = 160;
      for (let i = 0; i < frames; i++) {
        S.p.x += left / (frames - i);
        P.tick(1 / 60);
      }
      for (let i = 0; i < 30; i++) P.tick(1 / 60);
    }
    shot(P, canvas, depth + "-04-pod");
  }

  /* ---- 5. 深层（雾更浓、灯更小）---- */
  {
    const { P, canvas } = boot();
    P.enterNest(24);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 10; i++) P.tick(1 / 60);
    walk(P, 150, 120);
    shot(P, canvas, "24-05-deep");
  }

  /* ---- 6. 雾里的怪：只有眼睛 ---- */
  {
    const { P, canvas } = boot();
    P.enterNest(depth);
    const S = P.S;
    S.hudT = 99;
    for (let i = 0; i < 10; i++) P.tick(1 / 60);
    /* 把玩家挪到离第一只怪 300px 的位置：够远（怪在雾里），
       又不至于出井。这一张是"你看见两点光，但不知道那是什么"的唯一证据。 */
    const f = S.foes.find(q => !q.isBoss);
    if (f) {
      const target = Math.max(190, Math.min(770, f.x - 300));
      walk(P, target - S.p.x, 90);
    }
    shot(P, canvas, depth + "-06-eyes");
    const lit = f ? f.fogLit : null;
    console.log("  雾中怪 fogLit =", lit == null ? "null" : lit.toFixed(3));
  }
}

run();
