/* ===========================================================================
   五个考点，同一层：这一关长什么样子
   ---------------------------------------------------------------------------
   排班表（_lesson-shot.js）证明的是"参数偏了"，这张图证明的是"偏了看得见"。

   每格都是**真实生成的关卡 + 真实 draw()**，镜头一律放到地表层（第 0 层），
   tier 都是 0 —— 这样六格的对比只差"考点"这一个变量，不掺层深。
   缩到 0.5 之后一处细节都看不清，所以它只回答一个问题：
   **六张并排放，一眼能不能认出不是同一关。**

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_lesson-grid.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const FONT = "Microsoft YaHei, PingFang SC, sans-serif";
const W = 960, H = 600;
const PROTO = process.env.PROTO ? path.resolve(process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function boot() {
  const real = createCanvas(W, H);
  const g = real.getContext("2d");
  const html = fs.readFileSync(PROTO, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
  window.requestAnimationFrame = () => 0;
  window.eval(m[1]);
  if (window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));
  try { window.SNOWLAB.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
  catch (e) { window.SNOWLAB.setBackdrop(null); }
  try { window.SNOWLAB.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { }
  return { L: window.SNOWLAB, S: window.SNOWLAB.S, real, g };
}

/** 进第 n 关，镜头压到地表层，跑 30 帧让箱子/怪落定，然后 draw。 */
function shotOf(inst, n) {
  const { L, S } = inst;
  L.startStage(n);
  /* 开局飘字会挡住画面正中，全关掉 */
  S.texts.length = 0;
  S.showMeter = false; S.showHint = false; S.showHud = false;
  for (let i = 0; i < 30; i++) L.step(1 / 60);
  S.cam.y = clamp(S.level.floors[0] - H * 0.55, 0, Math.max(0, L.WORLD_H - H));
  S.cam.k = 0;
  L.draw();
  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(inst.real, 0, 0);
  const g = L.genLevel(L.stageSeed(n), n);
  return {
    card: c, n, les: L.lessonOf(n), goal: L.goalOf(n), nF: g.nFloors,
    terr: g.layers.reduce((a, l) => a + (l.terrain || []).length, 0),
    foes: g.spawns.length,
  };
}

const LES_COLOR = {
  bare: "#8A7B5E", narrow: "#4A7FB5", rush: "#9B4B5E", maze: "#5E9C6B", perch: "#8E6BC4",
  seal: "#2F8F8A",
};

(async () => {
  const inst = await boot();
  const { L } = inst;
  /* 每个考点挑一关。**刻意选不同的关号**，因为排班本来就不让它们挨着；
     第 5 关是无考点的基线（同一档层数，做对照）。 */
  /* **前五格同为 4 层** —— 层数一样才叫"只差考点"。
     9~13 正好是 5 个不同考点（窄洞 / 追兵 / 迷径 / 封关 / 空场）。
     悬台只能在寻宝关（`perch` 的硬约束），4 层没有寻宝关，所以那格退到 5 层，
     **下面标签会写出来** —— 换了一个不变量就必须说明，否则这张图的
     全部说服力（"只差考点一个变量"）就没了。 */
  const picks = [9, 10, 11, 12, 13, 17];
  const shots = picks.map(n => shotOf(inst, n));

  const COLS = 3, PAD = 16, SW = (W / 2) | 0, SH = (H / 2) | 0, TOP = 152;
  const CW = PAD + COLS * (SW + PAD);
  const CH = TOP + 2 * (SH + 74 + PAD) + 20;
  const cv = createCanvas(CW, CH);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, CW, CH);

  g.font = "bold 23px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("六个考点，前五格同为 4 层：一眼看得出来不是同一关吗", PAD, 38);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("六格全是真实生成的关卡 + 真实 draw()，镜头一律放在地表层（tier 都是 0），只差考点一个变量。", PAD, 62);
  g.fillStyle = "#E05A2B";
  g.fillText("前五格层数相同、场景相同，只差考点。悬台那格只能在寻宝关出现，所以退了 5 层。", PAD, 84);
  /* **第六个考点不在这张图里。** `seal` 封的是"通向门厅"那一层，
     把它压到地表层拍就什么都看不见 —— 放进来会让读者以为"封关没生效"。
     它单独一张（seal-gate.png），镜头就在封口层。 */
  g.fillText("封关封的是倒数第二层，这几格拍不到冰墙 —— 封死/通了那张对比图在 shots/seal-gate.png", PAD, 102);

  shots.forEach((s, i) => {
    const cx = PAD + (i % COLS) * (SW + PAD);
    const cy = TOP + Math.floor(i / COLS) * (SH + 74 + PAD);
    g.drawImage(s.card, cx, cy, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(cx + 1, cy + 1, SW - 2, SH - 2);

    const cn = s.les ? L.LESSONS[s.les].cn : "基线";
    const col = s.les ? LES_COLOR[s.les] : "#8A97A5";
    /* 标签用色块 + 白字，和排班表同一套颜色 —— 两张图对得起来 */
    g.fillStyle = col;
    g.fillRect(cx, cy - 20, 52, 19);
    g.font = "bold 12px " + FONT; g.fillStyle = "#FFFFFF";
    g.fillText(cn, cx + 10, cy - 6);

    g.font = "bold 14px " + FONT; g.fillStyle = "#1B2430";
    g.fillText("第 " + s.n + " 关 · " + s.nF + " 层", cx + 60, cy - 6);
    g.font = "12px " + FONT; g.fillStyle = "#5B6B7B";
    const say = s.les ? L.LESSONS[s.les].say : "没有考点：地形/箱子/怪都在常规档位";
    g.fillText(say, cx, cy + SH + 20);
    g.fillStyle = "#8A97A5";
    g.fillText("地形 " + s.terr + " 件 · 怪 " + s.foes + " 只 · 目标 " +
      ({ door: "破门", collect: "寻宝", limit: "省球" })[s.goal], cx, cy + SH + 40);
    /* 第 13 关起换场景（熔炉）。**必须点一句** —— 否则读者会把底色差异
       当成"考点造成的"，而这张图的全部说服力就在"只差考点一个变量"。 */
    if (s.n >= 13) {
      g.fillStyle = "#B4501E";
      g.fillText("（熔炉场景：底色不同是换地方，不是考点）", cx, cy + SH + 58);
    }
  });

  fs.writeFileSync(path.join(OUT, "lesson-grid.png"), cv.toBuffer("image/png"));
  console.log("出图 " + path.join(OUT, "lesson-grid.png"));
  for (const s of shots) {
    console.log("第 " + s.n + " 关 " + (s.les ? L.LESSONS[s.les].cn : "基线") +
      " · " + s.nF + " 层 · 地形 " + s.terr + " · 怪 " + s.foes + " · " + s.goal);
  }
})();
