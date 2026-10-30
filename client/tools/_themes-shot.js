/* ===========================================================================
   2026-10-30：四个场景（霜原 / 熔炉 / 菌窟 / 沙塚）
   ---------------------------------------------------------------------------
   用户原话：「感觉用雪原推球把场景定义死了，应该可以很多场景都可以」。

   这张图是这件事唯一的验收标准。**看缩略图就要能说出"这是四个不同的地方"**，
   如果需要读标题才能分辨，那就只是换了块背景布，等于没做。

   四格各自取第 1 / 13 / 25 / 37 关的**地表层**（镜头锁在世界 top，
   所以天空、三道脊、中景道具、地表顶面、HUD 名词全在同一张里）。

   **一张图出两版，因为在答两个不同的问题：**
   · 不加参数 → 全部走程序化。问的是「四个场景的代码底子是不是真的不同」
     （配色 / 脊线 / 中景 / 粒子 / 地表顶面）。这一版必须不挂立绘，
     否则 `drawSky` 第一行就 return，程序化那套一次都不执行，图会骗人。
   · `ART=1` → 四格都挂厚涂立绘。问的是「玩家实际看到的四个地方像不像
     四个地方」。2026-10-30 菌窟/沙塚的立绘补齐之后，这一版才第一次
     是"四张真图"，之前只有霜原/熔炉有。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_themes-shot.js            # → shots/themes-4.png
     ART=1 ... node client/tools/_themes-shot.js  # → shots/themes-4-art.png
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const FONT = '"Microsoft YaHei","PingFang SC",sans-serif';
const PROTO = process.env.PROTO ? path.resolve(process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");
const WITH_ART = !!process.env.ART;

const CASES = [
  { stage: 1, id: "snow", label: "霜原", note: "青蓝天空 / 松林 / 落雪 / 雪面" },
  { stage: 13, id: "ember", label: "熔炉", note: "烧红的天 / 烟囱黑烟 / 尖峰 / 火星往上" },
  { stage: 25, id: "spore", label: "菌窟", note: "没有天空 / 钟乳石垂顶 / 巨菇 / 孢子悬着" },
  { stage: 37, id: "dune", label: "沙塚", note: "沙黄天空 / 方尖碑 / 枯树 / 沙粒横扫" },
];

/* 立绘文件 → 场景 id。**和 `_snowlab-embed-bg.js` 的 FILES 是同一张表**，
   那边加一行这里也要加 —— 不然那格会画成程序化版本，图上看不出是漏了。 */
const BG_FILES = [
  ["bg-surface.jpg", "snow"],
  ["bg-forge.jpg", "ember"],
  ["bg-spore.jpg", "spore"],
  ["bg-dune.jpg", "dune"],
];

async function boot(protoPath) {
  const real = createCanvas(W, H);
  const g = real.getContext("2d");
  const html = fs.readFileSync(protoPath, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
  window.requestAnimationFrame = () => 0;
  window.eval(m[1]);
  const L = window.SNOWLAB;
  if (L.setOffscreen) L.setOffscreen((w, h) => createCanvas(w, h));
  /* **先把四张图全清掉**：不清的话霜原那张内嵌立绘会让第 1 格走
     `if (bg) return;`，程序化的雪脊一次都不执行 —— 这张图就成了
     "一格是照片、三格是代码"，没法比。 */
  L.setBackdrop({ snow: null, ember: null, spore: null, dune: null });
  /* **ART=1 要在这里用 `loadImage` 真读文件。** 靠 HTML 里那几块 base64
     是不行的：jsdom 不实现 canvas，`Image` 的 onload 永远不触发 ——
     背景看着"没挂上"，而文件明明内嵌了。
     **四个场景一起挂。** 2026-10-30 之前只有霜原/熔炉有图，这里写死两张；
     菌窟/沙塚补了立绘之后，写死的版本会让那两格"看起来是程序化的"，
     而它其实已经有图了 —— 出图骗人比代码错更难发现。 */
  if (WITH_ART) {
    const bg = {};
    for (const [f, id] of BG_FILES) {
      try { bg[id] = await loadImage(path.join(ROOT, "assets", "snowlab", f)); } catch (e) { bg[id] = null; }
    }
    L.setBackdrop(bg);
  }
  try { L.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { }
  return { L, S: L.S, real, g };
}

function shotStage(inst, stage) {
  const { L, S } = inst;
  L.reset(L.stageSeed(stage), stage);
  if (!WITH_ART) L.setBackdrop({ snow: null, ember: null, spore: null, dune: null });

  /* 镜头锁在世界顶端：0..600 里 0..380 是天空 + 远中近三脊 + 地表板，
     刚好一屏装下"这是哪儿"。 */
  S.cam.y = 0; S.cam.k = 0;
  S.showMeter = false; S.showHint = true; S.showHud = true;
  S.texts.length = 0; S.balls.length = 0; S.shots.length = 0;
  S.shake = 0;
  S.t = 12;
  L.draw();

  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(inst.real, 0, 0);
  /* **id 必须在画完当场取**。四个场景共用同一个全局 `THEME`，
     等四格都画完再读，拿到的是最后一格（dune）—— 第一版就这么写过，
     日志显示"四格全是 dune"而图其实是对的，白白怀疑了半天。 */
  return { canvas: c, id: L.THEME.id, ammo: L.THEME.words.ammo, need: L.snowNeed() };
}

(async () => {
  const inst = await boot(PROTO);
  const { L } = inst;
  console.log("场景表：" + L.themes().join(" / "));

  const shots = CASES.map(c => shotStage(inst, c.stage));
  CASES.forEach((c, i) => {
    const ok = shots[i].id === c.id;
    console.log((ok ? "  ✓ " : "  ✗ ") + "第 " + c.stage + " 关 → " + shots[i].id +
      "（弹药「" + shots[i].ammo + "」，裹一只怪 " + shots[i].need + " 发）");
  });

  const SW = 480, SH = 300, PADX = 12, PADY = 34, TOP = 150;
  const cv = createCanvas(PADX * 3 + SW * 2, TOP + (SH + PADY) * 2 + 42);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);

  shots.forEach((s, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x = PADX + col * (SW + PADX), y = TOP + row * (SH + PADY);
    g.drawImage(s.canvas, x, y, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, SW - 2, SH - 2);
    g.font = "bold 15px " + FONT; g.fillStyle = "#1B2430";
    g.fillText("第 " + CASES[i].stage + " 关：" + CASES[i].label +
      "（" + shots[i].ammo + " · " + shots[i].need + " 发/只）", x + 2, y - 9);
  });

  g.font = "bold 21px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("四个场景：同一个玩法动词（吐 → 裹 → 推 → 砸）", 14, 34);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  CASES.forEach((c, i) => g.fillText(c.label + "｜" + c.note, 14 + (i % 2) * 500, 62 + ((i / 2) | 0) * 22));
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText(WITH_ART
    ? "ART=1：四格都挂厚涂立绘 —— 验「四个地方」靠的是四张图，不是四套配色"
    : "全部走程序化绘制（不挂立绘）：四格的天空 / 脊色 / 中景 / 粒子 / 地表顶面都不同",
    14, 122);

  /* **两种模式写两个文件名。** 都写 themes-4.png 的话，先跑哪次都会被
     后一次盖掉，而两张图的说明文字不一样 —— 留下的是哪一张全靠跑的顺序。 */
  const out = path.join(OUT, WITH_ART ? "themes-4-art.png" : "themes-4.png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out);
})();
