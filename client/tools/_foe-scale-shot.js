/* ============================================================================
   _foe-scale-shot.js —— 敌人贴图化评审图
   ----------------------------------------------------------------------------
   2026-10-28 第四轮。三只敌人从「代码画的扁平色块」换成从概念图抠出来的
   厚涂贴图（`assets/snowlab/foe/`），和主角那张猫同属一套笔触。

   三格，回答断言管不了的事：
     A. 贴图 · 站定     —— 体态能不能一眼分开？和主角、木箱（48）的比例对不对？
     B. 贴图 · 三种状态 —— 雪覆盖 / 蓄力 / 受击闪白。**这三样是共享代码画的**，
                           配料（覆盖椭圆、蓄力位置）以前是照着代码图形手调的
                           常数，换贴图之后必须重看一遍，否则会飘在头顶上。
     C. 代码图形 · 回退 —— 贴图加载失败时玩家看到的就是这一格。它不许坏。

   产物：shots/snowlab-foe-art.png
   跑法：NODE_PATH=<workspace>/node_modules node client/tools/_foe-scale-shot.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "prototype", "snowlab.html");
const OUT = path.join(ROOT, "shots");
const W = 960, H = 600;

/* 三只从左到右的顺序 = 轮廓差异从大到小：圆团 → 横长 → 拱壳 */
const BREEDS = ["moss", "fang", "grub"];
const NAMES = { moss: "moss 苔泥团", fang: "fang 尖牙兽", grub: "grub 霜甲虫" };

/** 起一个独立 jsdom 世界绑到指定 ctx。`draw()` 用的是初始化时拿到的那个
    ctx，中途换不了 —— 所以"贴图 / 代码"两份对比必须两个世界。 */
function boot(ctx) {
  const html = fs.readFileSync(SRC, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = (t) => (t === "2d" ? ctx : null);
  window.requestAnimationFrame = () => 0;
  window.eval(m[1]);
  return window.SNOWLAB;
}

(async () => {
  const art = await require("./_snowlab-art").loadArt();
  console.log("贴图：" + art.report);
  const bg = await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"));

  /** 地表层最长的一段"能站人"的空地。
      **地面是随机生成的，不是想站哪就站哪**：不少种子的地表被箱子切成
      一两百像素的碎段，四只角色根本排不开。所以反过来 —— 先找空地，再挑种子。 */
  function clearSpan(L) {
    const S = L.S, floorY = L.FLOORS[0];
    let best = { a: 0, b: -1 }, runA = -1;
    for (let x = 20; x <= 940; x += 4) {
      let ok = Math.abs(L.groundAt(x, floorY - 6) - floorY) < 1;
      if (ok) {
        for (const b of S.boxes) {
          if (b.dead || b.y >= floorY) continue;
          if (b.x + b.w <= x - 14 || b.x >= x + 14) continue;
          if (b.y + b.h > floorY - 170) { ok = false; break; }
        }
      }
      if (ok) { if (runA < 0) runA = x; if (x - runA > best.b - best.a) best = { a: runA, b: x }; }
      else runA = -1;
    }
    return best;
  }

  /** 摆一场：三只怪一字排开、主角站最右。`state` 决定三只分别处于什么状态。 */
  function stage(L, seed, span, state) {
    L.reset(seed);
    const S = L.S;
    S.showMeter = false; S.showHint = false;
    S.foes.length = 0; S.nests.length = 0; S.balls.length = 0;
    S.texts.length = 0; S.frags.length = 0; S.rings.length = 0;
    S.t = 12;
    const floorY = L.FLOORS[0];

    /* **装饰物也要清掉。** 空地判据只看箱子（装饰不带碰撞），但路牌会正好
       挡在怪脸前面 —— 第一版尖牙兽就是这么被一块牌子糊住的。 */
    const keep = S.deco.filter(dc =>
      !(dc.x > span.a - 24 && dc.x < span.b + 40 && dc.y > floorY - 140 && dc.y < floorY + 20));
    S.deco.length = 0;
    for (const dc of keep) S.deco.push(dc);

    /* 四个站位：三只怪 + 主角。**主角要留出 45 宽**，否则会被画布右边缘切掉一半。 */
    const room = span.b - span.a;
    const gap = Math.max(80, Math.min(130, (room - 100) / 3));
    const spots = [0, 1, 2, 3].map(i => Math.round(span.a + 16 + i * gap));

    for (let i = 0; i < BREEDS.length; i++) {
      const f = L.spawnFoe(spots[i] + 14, floorY - L.FOE_H - 2, "crawler", BREEDS[i]);
      f.vx = 0; f.face = 1; f.aim = 0;
    }
    L.placePlayer(spots[3] + 8, floorY - L.S.p.h - 2);

    /* 走几帧让物理把人踩稳（直接写 y 会和箱子重叠 1~2px，出图会悬空） */
    const keys = S.keys;
    for (const k in keys) delete keys[k];
    for (let i = 0; i < 8; i++) L.step(1 / 60);
    for (const f of S.foes) { f.vx = 0; f.face = 1; f.aim = 0; f.hitT = 0; f.hits = 0; }

    if (state === "states") {
      /* 三只各展示一种"共享代码画的东西"：
         moss 吃两发（雪覆盖）、fang 蓄力（嘴前的投掷物）、grub 受击闪白 */
      const [a, b, c] = S.foes;
      if (a) { a.hits = 2; a.needAt = L.snowNeed(); }
      if (b) b.aim = L.NUM.ebullet.windup * 0.85;
      if (c) c.hitT = 0.2;
    }
    S.texts.length = 0; S.frags.length = 0; S.rings.length = 0;
    return { floorY, spots };
  }

  /* ---- 挑种子：地表空地最长的那个 ---- */
  const probeC = createCanvas(W, H), probeG = probeC.getContext("2d");
  const LP = boot(probeG);
  let SEED = 1, SPAN = { a: 0, b: -1 };
  for (let s = 1; s <= 400; s++) {
    LP.reset(s);
    const sp = clearSpan(LP);
    if (sp.b - sp.a > SPAN.b - SPAN.a) { SPAN = sp; SEED = s; }
    if (SPAN.b - SPAN.a >= 700) break;
  }
  console.log("种子 " + SEED + "：地表空地 " + SPAN.a + ".." + SPAN.b + "（" + (SPAN.b - SPAN.a) + "px）");

  /* ---- 三个面板 ---- */
  function render(withArt, state) {
    const c = createCanvas(W, H), ctx = c.getContext("2d");
    const L = boot(ctx);
    L.setBackdrop(bg);
    if (withArt) L.setArt(art.map);
    else { const n = {}; for (const k in art.map) n[k] = null; L.setArt(n); }
    const st = stage(L, SEED, SPAN, state);
    L.draw();
    return { canvas: c, st, L };
  }
  const A = render(true, "idle");
  const B = render(true, "states");
  const C = render(false, "idle");

  /* ---- 拼图：三格都裁到"角色带"，等比放大到满宽 ---- */
  const st = A.st;
  const bandX0 = Math.max(0, st.spots[0] - 26);
  const bandX1 = Math.min(W, st.spots[3] + 70);
  const bandY0 = st.floorY - 170;
  const bandY1 = st.floorY + 34;
  const bw = bandX1 - bandX0, bh = bandY1 - bandY0;
  const S = Math.min(3.2, 960 / bw);
  const panelW = Math.round(bw * S), panelH = Math.round(bh * S);

  const PAD = 26, GAP = 12;
  const out = createCanvas(Math.max(960, panelW), PAD + (panelH + GAP) * 3 + PAD);
  const g = out.getContext("2d");
  g.fillStyle = "#EFE7DA"; g.fillRect(0, 0, out.width, out.height);

  const titles = [
    "A. SPRITES / idle        can you tell them apart at a glance?",
    "B. SPRITES / states      moss = snow coat, fang = aiming, grub = hit flash",
    "C. CODE FALLBACK         what you see when the sprites fail to load",
  ];
  [A, B, C].forEach((p, i) => {
    const y = PAD + i * (panelH + GAP);
    g.drawImage(p.canvas, bandX0, bandY0, bw, bh, 0, y, panelW, panelH);
    /* 标题压在图上：加一条半透明底，白字直接压雪地会看不清 */
    g.fillStyle = "rgba(30,22,14,.62)";
    g.fillRect(0, y, Math.min(panelW, 640), 24);
    g.fillStyle = "#FFF6E4";
    g.font = "bold 14px sans-serif";
    g.textBaseline = "middle";
    g.fillText(titles[i], 10, y + 12);
  });

  /* 48px 比例尺：画在第一格右下 —— "谁比箱子大"要有据可查 */
  g.font = "bold 13px sans-serif";
  const ry = PAD + panelH - 8;
  g.fillStyle = "rgba(30,22,14,.75)";
  g.fillRect(panelW - 34, ry - 48 * S, 2, 48 * S);
  g.fillRect(panelW - 38, ry - 48 * S, 10, 2);
  g.fillRect(panelW - 38, ry - 2, 10, 2);
  g.fillText("48px = one crate", panelW - 132, ry - 56 * S);

  fs.writeFileSync(path.join(OUT, "snowlab-foe-art.png"), out.toBuffer("image/png"));
  console.log("出图 shots/snowlab-foe-art.png → " + out.width + "×" + out.height +
    "（每格放大 " + S.toFixed(2) + " 倍）");

  console.log("形象尺寸（世界像素，木箱一格 = 48）：");
  for (const b of BREEDS) {
    const z = A.L.foeArtSize(b);
    console.log("  " + NAMES[b].padEnd(14) +
      (z ? z.w.toFixed(1) + " × " + z.h.toFixed(1) + "   宽/箱 = " + (z.w / 48).toFixed(2) : "（贴图没加载到）"));
  }
})();
