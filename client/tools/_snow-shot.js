/* ============================================================================
   _snow-shot.js —— 雪原主题验收图（离屏，不开浏览器）
   ----------------------------------------------------------------------------
   目的单一：把「暖金森林（第 1 关）」和「雪原（第 2 关）」放在同一张图上，
   看两件事：
     1. 雪面有没有被压成灰地（SNOW_DIM 0.90 那条例外到底对不对）；
     2. 木平台/角色/弹丸在白底上还读不读得出来 —— 雪地真正的风险不是"不像雪"，
        是"该看见的东西看不见了"。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/_snow-shot.js

   产物落 ../shots/_snow-*.png（`_` 前缀，不入库）。
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const W = 960, H = 600;
const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const RES = path.join(__dirname, "..", "assets", "resources", "grove");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const noop = () => {};

async function decodeArt() {
  const art = {};
  const pets = ["cat", "dog", "ham", "rab", "ox", "fox"];
  const foes = ["bug", "crow", "boar", "larva"];
  for (const k of pets) {
    const f = path.join(RES, "pet", k + ".png");   /* 资源已按用途分目录 */
    if (fs.existsSync(f)) art["pet-" + k] = await loadImage(f);
  }
  for (const k of foes) {
    const f = path.join(RES, "foe", k + ".png");
    if (fs.existsSync(f)) art["foe-" + k] = await loadImage(f);
  }
  return art;
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
  const P = sb.GROVE;
  if (art) for (const k in art) P.setArt(k, art[k]);
  return { P, S: P.S, canvas: main };
}

function shot(canvas, name) {
  const f = path.join(OUT, name + ".png");
  fs.writeFileSync(f, canvas.toBuffer("image/png"));
  console.log("  " + f);
  return f;
}

/** 跑一关到"已经打起来"的状态：刷完开场波、走两步、让落雪滚起来 */
function stage(num, art) {
  const { P, S, canvas } = boot(art);
  P._start(0, num);
  for (let i = 0; i < 40; i++) P.tick(1 / 60);
  S.hudT = 99;
  S.shots.length = 0;
  P.render();
  return { P, S, canvas };
}

/**
 * 把雪定到某个厚度，再让猫走一段留下脚印。
 *
 * 为什么手动设 depth 而不是"跑 90 秒"：90 秒 × 60 帧 = 5400 次 tick，
 * 敌人早把猫打死了，而且玩家不操作的话画面里不会有脚印 ——
 * 那样渲出来的"最厚雪"和"薄雪"除了白一点没有任何区别，
 * 就验不到这次真正要看的东西（厚度有没有改变地面结构感）。
 *
 * 走 1.2 秒 ≈ 240px：够留十几个脚印（间距 11px），
 * 又不至于撞到右边墙。
 */
function atDepth(num, d, art) {
  const { P, S, canvas } = boot(art);
  P._start(0, num);
  for (let i = 0; i < 40; i++) P.tick(1 / 60);

  S.snowDepth = d;
  if (d > 0.2) {
    P._press("right", true);
    /* 48 帧 ≈ 1.2 秒 ≈ 240px。原来 96 帧走 480px，猫跑出裁剪窗，
       屏幕上只剩下脚印、没有留下脚印的人 —— 而"谁踩的"正是这张图要说的。 */
    for (let i = 0; i < 48; i++) {
      S.snowDepth = d;          // 覆盖自动增长，锁在这个厚度
      P.tick(1 / 60);
    }
    P._press("right", false);
  }
  S.snowDepth = d;
  S.hudT = 99;
  S.shots.length = 0;
  P.render();
  return { P, S, canvas, px: S.p ? S.p.x : 480 };
}

async function main() {
  const art = await decodeArt();
  console.log("注入 " + Object.keys(art).length + " 张");

  console.log("第 1 关（暖金森林，tundra）：");
  const a = stage(0, art);
  shot(a.canvas, "_snow-0-tundra");

  console.log("第 2 关（雪原，snow）：");
  const b = stage(1, art);
  shot(b.canvas, "_snow-1-snow");
  console.log("    关卡名 = " + b.P.LEVELS[b.S.stage].name +
              "  snow 标记 = " + !!b.P.THEMES[b.P.LEVELS[b.S.stage].theme].snow);

  /* ---- 三个厚度 ---- */
  const depths = [0, 0.5, 1];
  const frames = [];
  for (const d of depths) {
    const r = atDepth(1, d, art);
    const xs = r.S.footprints.map((q) => q.x);
    frames.push({
      d, canvas: r.canvas, px: r.px, prints: r.S.footprints.length, foes: r.S.foes.length,
      fx0: xs.length ? Math.min(...xs) : r.px,
      fx1: xs.length ? Math.max(...xs) : r.px,
    });
    const fp = r.S.footprints;
    /* 直接在 canvas 上采样脚印中心，确认它到底有没有被画出来 ——
       肉眼看缩略图会漏掉 5% 的色差，而"没画"和"画得太淡"修法完全不同。 */
    if (fp.length) {
      const c2d = r.canvas.getContext("2d");
      const q = fp[fp.length - 1];
      const px1 = c2d.getImageData(Math.round(q.x), Math.round(q.y - 2), 1, 1).data;
      const px2 = c2d.getImageData(Math.round(q.x), Math.round(q.y - 22), 1, 1).data;
      console.log("     采样 脚印处 rgb(" + px1[0] + "," + px1[1] + "," + px1[2] +
                  ")  同x上方22px rgb(" + px2[0] + "," + px2[1] + "," + px2[2] + ")");
    }
    console.log(`  雪厚 ${d.toFixed(1)}  脚印 ${fp.length}  猫 x=${r.px.toFixed(0)} y=${r.S.p ? r.S.p.y.toFixed(0) : '-'} onGround=${r.S.p ? r.S.p.onGround : '-'}  场上 ${r.S.foes.length} 只`);
    if (fp.length) console.log('     前 4 个脚印：' + fp.slice(0, 4).map((q) => `(${q.x.toFixed(0)},${q.y.toFixed(0)})`).join(' '));
  }

  /* 拼一张：**局部放大**而不是整张缩下来。
     470 宽的缩略图里，雪带只有 4px、脚印只有 2px —— 而"厚度有没有变"
     和"脚印看不看得见"正是这张图唯一要证明的两件事。 */
  /* 裁剪窗以**脚印的中点**为中心，不是猫的最终位置。
     猫走 1.6 秒跨了 480px，脚印留在起点那一段 ——
     第一版按猫的位置裁，三张图全是空地，一个脚印都没有。 */
  const CW = 300, CH = 200, CROP_Y = 380, ZOOM = 1.7;
  const pad = 6, labH = 20;
  const DW = Math.round(CW * ZOOM), DH = Math.round(CH * ZOOM);
  const out = createCanvas(depths.length * (DW + pad) + pad, DH + labH + pad * 2);
  const g = out.getContext("2d");
  g.fillStyle = "#16181B";
  g.fillRect(0, 0, out.width, out.height);
  g.font = "13px sans-serif";
  g.textBaseline = "top";
  for (let i = 0; i < frames.length; i++) {
    const img = await loadImage(frames[i].canvas.toBuffer("image/png"));
    const dx = pad + i * (DW + pad);
    const mid = (frames[i].fx0 + frames[i].fx1) / 2;
    const cx = Math.max(0, Math.min(W - CW, Math.round(mid - CW / 2)));
    g.drawImage(img, cx, CROP_Y, CW, CH, dx, pad + labH, DW, DH);
    g.fillStyle = "#E8EBEF";
    g.fillText(`雪厚 ${frames[i].d.toFixed(1)} · 脚印 ${frames[i].prints}`, dx + 2, pad + 2);
    g.strokeStyle = "#3A3F47";
    g.strokeRect(dx + 0.5, pad + labH + 0.5, DW - 1, DH - 1);
  }
  fs.writeFileSync(path.join(OUT, "_snow-depth.png"), out.toBuffer("image/png"));
  console.log("\n  " + path.join(OUT, "_snow-depth.png"));

  console.log("\n完成，输出在 " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
