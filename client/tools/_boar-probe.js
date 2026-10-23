/* ============================================================================
   _boar-probe.js —— 野猪（kind:"charge"）行为探针
   ----------------------------------------------------------------------------
   目的：用**真实模拟**判断两件事，不靠看图和猜：

     1. 它有没有"长时间停滞"（连续多帧位移几乎为 0）？停在哪、被什么挡住？
     2. 它的步态相位实际是多少步/秒？（采样 drawFoe 用的那个 cyc，
        通过劫持 canvas ctx 的 translate/scale 把形变参数抓出来）

   为什么会卡：野猪的朝向每帧被 `f.face = sign(p.x - f.x)` 重写，
   而结尾的 `if (f.hitWall) f.dir = -f.hitWall` 只翻 `dir` ——
   charge 分支根本不读 dir，它读 face。于是撞墙后 dir 翻了、face 下帧又被
   扳回去，vx 一直朝墙推、又被 stepBody 清零，位置钉死在墙边。
   下面 LAST 表就是这条链的直接读数。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_boar-probe.js
     PROTO=../prototype/grove.html STAGE=1 SECS=20 node tools/_boar-probe.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const RES = path.join(__dirname, "..", "assets", "resources", "grove");
const STAGE = Number(process.env.STAGE ?? 1);
const SECS = Number(process.env.SECS ?? 20);
const noop = () => {};
const KEYS = ["bug", "crow", "boar", "larva"];

async function decodeArt() {
  const art = {};
  for (const k of KEYS) {
    const f = path.join(RES, "foe", k + ".png");   /* 资源已按用途分目录 */
    if (!fs.existsSync(f)) continue;
    art["foe-" + k] = await loadImage(f);
  }
  return art;
}

/* 劫持 ctx：抓"这只敌人被画出来时"的形变。
   drawFoe 的顺序是 translate(cx,cy) → scale(sx,sy) → scale(face,1)
   → translate(fwd,hop) → rotate → scale(sqX,sqY) → translate(...) → drawImage。
   所以**在 drawImage 那一刻**取最近一次 scale/translate 的残留值，
   拿到的就是最终作用在贴图上的形变 —— 比"抓所有 translate"精确得多。 */
function makeGrabber(ctx, expectW) {
  const rec = { fwd: null, hop: null, sqX: null, sqY: null, n: 0, on: false };
  let lx = 0, ly = 0, sx = 1, sy = 1;
  const t0 = ctx.translate.bind(ctx);
  const s0 = ctx.scale.bind(ctx);
  const d0 = ctx.drawImage.bind(ctx);
  ctx.translate = (x, y) => { if (rec.on) { lx = x; ly = y; } return t0(x, y); };
  ctx.scale = (x, y) => { if (rec.on) { sx = x; sy = y; } return s0(x, y); };
  ctx.drawImage = (...a) => {
    /* 只认"宽度等于野猪贴图宽"的那次绘制 —— 背景/UI/宠物都画不上这个尺寸，
       这样 sqX 拿到的就是野猪自己的形变，不掺别人。 */
    if (rec.on && Math.abs(a[3] - expectW) < 1.5) {
      rec.fwd = lx; rec.hop = ly; rec.sqX = sx; rec.sqY = sy; rec.n++;
    }
    return d0(...a);
  };
  return rec;
}

function boot(art) {
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
      createElement: () => { const c = createCanvas(1, 1); c.style = {}; c.addEventListener = noop; return c; },
    },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  const P = sb.GROVE;
  if (art) for (const k in art) P.setArt(k, art[k]);
  return { P, S: P.S, canvas: main };
}

(async () => {
  const art = await decodeArt();
  const { P, S, canvas } = boot(art);
  P._start(0, STAGE);

  /* 不等波次：波次要玩家清场才推进，探针里没人打怪，永远到不了第 2 波。
     直接在第 1 波里补一只野猪，摆在关卡表里那个坐标（x=650 / y=350）。 */
  const SPAWN_X = Number(process.env.SPAWN_X ?? 650);
  const SPAWN_Y = Number(process.env.SPAWN_Y ?? 350);
  const boar0 = P.foeFromSpec({ foe: "boar", x: SPAWN_X, y: SPAWN_Y, lv: 1 }, false);
  S.foes.push(boar0);
  /* 玩家摆到它左边 —— 和截图一致：猫在左、猪在右。 */
  if (S.p) { S.p.x = Number(process.env.PX ?? 560); S.p.y = SPAWN_Y; S.p.vy = 0; }

  const FPS = 60, DT = 1 / FPS, FRAMES = Math.round(SECS * FPS);

  /* 每只 charge 敌人的轨迹。key 用对象本身（没 id 字段）。 */
  const track = new Map();
  const ensure = (f) => {
    if (!track.has(f)) {
      track.set(f, { x0: f.x, y: Math.round(f.y), samples: [], trace: [], stall: 0, maxStall: 0, walls: 0, faceFlips: 0, lastFace: f.face, lastX: f.x, stallStart: -1, stallSnap: null, prevStall: 0 });
    }
    return track.get(f);
  };

  const gait = [];
  let rec = null;
  const DO_GAIT = process.env.GAIT === "1";

  for (let i = 0; i < FRAMES; i++) {
    P.tick(DT);
    const boars = S.foes.filter((f) => !f.dead && f.kind === "charge" && !f.isBoss);
    for (const f of boars) {
      const t = ensure(f);
      const dx = Math.abs(f.x - t.lastX);
      /* 保留原始双精度 + vx，用来判断"x 不变"到底是"没人推"还是"被抵消" */
      t.samples.push(+f.x.toFixed(3));
      t.trace.push([i, +f.x.toFixed(4), +f.vx.toFixed(3), f.face, f.hitWall, +f.y.toFixed(1)]);
      if (dx < 0.05) {
        t.stall++;
        if (t.stall === 1) t.stallStart = i;
        if (t.stall > t.maxStall) {
          t.maxStall = t.stall;
          /* 停住的第一帧快照 —— 这是判断"到底谁不让它动"的唯一证据 */
          if (t.stall === 20 || t.stall === 200) {
            t.stallSnap = {
              frame: i, x: +f.x.toFixed(2), y: +f.y.toFixed(2),
              vx: +f.vx.toFixed(2), face: f.face, dir: f.dir,
              coat: f.coat, cm: f.cm, stun: +f.stun.toFixed(2),
              hitWall: f.hitWall, onGround: f.onGround,
              charging: +f.charging.toFixed(2), chargeT: +f.chargeT.toFixed(2),
              px: S.p ? +S.p.x.toFixed(2) : null,
              py: S.p ? +S.p.y.toFixed(2) : null,
              pdead: S.p ? S.p.dead : null,
            };
          }
        }
      } else t.stall = 0;
      if (f.hitWall) t.walls++;
      if (f.face !== t.lastFace) { t.faceFlips++; t.lastFace = f.face; }
      t.lastX = f.x;
    }

    /* 每帧抓一次步态形变（只对第一只普通野猪，且它必须活着）。
       render 很慢，默认关掉 —— 行为诊断不需要画面。 */
    if (DO_GAIT && boars.length) {
      const ctx = canvas.getContext("2d");
      const img = art["foe-boar"];
      const expectW = img ? 54 * (img.width / img.height) : 76;
      if (!rec) rec = makeGrabber(ctx, expectW);
      rec.on = true; rec.n = 0;
      P.render();
      rec.on = false;
      if (rec.n > 0) gait.push({ t: i * DT, fwd: +rec.fwd.toFixed(3), sqX: +rec.sqX.toFixed(4) });
    }
  }

  /* SHOT=1 出一张现场图：什么都不改，只把当前这一帧存下来，
     用来确认"修完之后画面还是对的"（不靠看代码下结论）。 */
  if (process.env.SHOT === "1") {
    P.render();
    const outDir = path.join(__dirname, "..", "shots");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, "_boar-fixed.png");
    fs.writeFileSync(p, canvas.toBuffer("image/png"));
    console.log("  截图 " + p);
  }

  console.log("=== 野猪行为探针（关卡 " + STAGE + "，" + SECS + " 秒）===");
  console.log("存活过的 charge 敌人：" + track.size);
  let idx = 0;
  for (const [f, t] of track) {
    console.log(`\n[#${idx++}] y=${t.y}  x: ${t.x0.toFixed(1)} -> ${f.dead ? "(已消失)" : f.x.toFixed(1)}`);
    console.log(`    最长连续静止帧 ${t.maxStall} (${(t.maxStall / 60).toFixed(2)}s)   撞墙帧 ${t.walls}   朝向翻转 ${t.faceFlips} 次`);
    if (t.stallSnap) {
      console.log("    停滞快照：" + JSON.stringify(t.stallSnap));
    }
    if (t.stallStart > 0) {
      const a = Math.max(0, t.stallStart - 6), b = Math.min(t.trace.length, t.stallStart + 10);
      console.log("    停滞起点 frame=" + t.stallStart + " 前后逐帧 [f, x, vx, face, hitWall, y]：");
      for (const r of t.trace.slice(a, b)) console.log("      " + r.join("  "));
    }
    const tail = t.samples.slice(0, 90);
    console.log("    前 1.5s 的 x：" + tail.filter((_, k) => k % 6 === 0).join(" "));
  }

  /* 步态频率：对 sqX 数"极大值"个数（伸缩每走一步出现一次峰值） */
  if (gait.length > 10) {
    const v = gait.map((g) => g.sqX);
    let peaks = 0, lastSign = 0;
    const d = [];
    for (let i = 1; i < v.length; i++) d.push(v[i] - v[i - 1]);
    for (const x of d) {
      const s = x > 0 ? 1 : x < 0 ? -1 : lastSign;
      if (lastSign === 1 && s === -1) peaks++;
      if (s) lastSign = s;
    }
    const span = gait[gait.length - 1].t - gait[0].t;
    console.log(`\n=== 步态 ===`);
    console.log(`  采样 ${gait.length} 帧 / ${span.toFixed(2)}s`);
    console.log(`  sqX 峰值 ${peaks} 次  =>  ${(peaks / span).toFixed(2)} 步/秒`);
    console.log(`  sqX 范围 ${Math.min(...v).toFixed(4)} ~ ${Math.max(...v).toFixed(4)}`);
    console.log(`  fwd  范围 ${Math.min(...gait.map(g=>g.fwd)).toFixed(2)} ~ ${Math.max(...gait.map(g=>g.fwd)).toFixed(2)}`);
    console.log(`  设计值：野猪 0.45s/步 = 2.22 步/秒；虫子 0.62s/步 = 1.61 步/秒`);
  }
})();
