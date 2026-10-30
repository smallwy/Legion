/* ===========================================================================
   2026-10-30：雪晶 / 图鉴 / 裂壳 / 悬台 / 深潜词条 —— 这一轮新加的东西长什么样
   ---------------------------------------------------------------------------
   五样东西，**四样只能靠出图判**：

     · 图鉴面板：一屏塞了 4 张场景卡 + 3 只怪 + 4 格裂壳 + 终局正文。
       断言能验"未解锁时 codexSeen 里没有这个 key"，验不了
       "「？ ？ ？」和已解锁的卡在缩略图上分不分得开"。
       上一轮 HUD 两块芯片叠在一起时，「任两矩形不相交」也是全绿的。
     · 裂壳：它不是新怪物、不是新材质箱子，是**长在墙里的一口木箱**。
       判据是"玩家能不能看出这口箱子和旁边的木箱不一样"——
       这只有把两个并排放大到 3 倍才判得了。
     · 悬台（第 43 关）：整关就是"离地 140 的一块台 + 台上一口金箱"。
       图上一眼看不出 140，但能看出"它离地面到底有多高""会不会像浮空bug"。
     · 深潜词条：四条并排挂在 HUD 右侧，和雪晶同一列。
       位置对不对只能看。

   第五样（雪晶余额）只是"面板里那个黄色数字读不读得出是钱"。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_codex-shot.js
   环境变量：ART=1 挂真立绘（默认也挂 —— 这五样都在 UI 层，背景是不是照片
             不影响判断，但挂着更像玩家的画面）
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const PROTO = process.env.PROTO ? path.resolve(process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");
/* @napi-rs/canvas 不做字形回退，中文必须带 Microsoft YaHei，否则全是豆腐块。 */
const FONT = '"Microsoft YaHei","PingFang SC",sans-serif';

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

  const L = window.SNOWLAB;
  /* 四张立绘全挂。jsdom 不解码 <img>，base64 那几块永远不会 onload，
     所以必须用 loadImage 真读文件再 setBackdrop。 */
  const bg = {};
  for (const [f, id] of [["bg-surface.jpg", "snow"], ["bg-forge.jpg", "ember"],
                         ["bg-spore.jpg", "spore"], ["bg-dune.jpg", "dune"]]) {
    try { bg[id] = await loadImage(path.join(ROOT, "assets", "snowlab", f)); } catch (e) { bg[id] = null; }
  }
  L.setBackdrop(bg);
  try { L.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { }
  return { L, S: L.S, real, g };
}

/** 把主画布当前内容拷成一张独立的 960×600 */
function grab(real) {
  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(real, 0, 0);
  return c;
}

/** 每格都从"干净的一关"开始：进关提示、「深度 N」那行大字都会挡在画面中间，
 *  出图前一律清掉 —— 要拍的是常驻 UI，不是那 2 秒的提示。 */
function clearFx(L) {
  L.S.texts.length = 0;
  L.S.balls.length = 0;
  L.S.shots.length = 0;
  L.S.shake = 0;
  L.S.flash = 0;
  L.S.t = 12;
}

(async () => {
  const { L, S, real } = await boot();
  const cells = [];

  /* ---- ① 图鉴 · 只解锁了一半 ----
     刻意只记两个场景、两只怪、一块裂壳。要验的是"没解锁的卡长什么样" ——
     全解锁的图鉴看不出这条，而玩家第一次按下 B 的时候看到的就是半解锁。 */
  L.writeSnowProgress({
    coins: 65,
    codex: { biome: { snow: 1, ember: 1 }, breed: { moss: 1, fang: 1 } },
    relic: 1,
  });
  L.startStage(13);
  clearFx(L);
  S.codexOpen = true;
  L.draw();
  cells.push({ cv: grab(real), title: "图鉴 · 只到过霜原和熔炉",
               note: "菌窟/沙塚「？ ？ ？」· 霜甲虫灰着 · 裂壳 1/4 · 雪晶 65" });

  /* ---- ② 图鉴 · 全解锁 ----
     `relic: 4` 是集齐的状态，终局那格的正文才会出（左侧四个壳片同时点亮）。
     这一格守的是"集齐前后不是同一块地方"—— 只改数字不改版面的话，
     集齐了玩家也不会觉得自己解锁了什么。 */
  L.writeSnowProgress({
    coins: 320,
    codex: { biome: { snow: 1, ember: 1, spore: 1, dune: 1 },
             breed: { moss: 1, fang: 1, grub: 1 } },
    relic: 4,
  });
  L.startStage(37);
  clearFx(L);
  S.codexOpen = true;
  L.draw();
  cells.push({ cv: grab(real), title: "图鉴 · 四场景 + 三只怪 + 裂壳集齐",
               note: "每张卡带「裹一只几发」· 终局正文在右侧 · 雪晶 320" });
  S.codexOpen = false;

  /* ---- ③ 第 43 关 · 悬台 ----
     镜头压到让"台面 + 台下的地面层"同屏 —— 只看台面看不出 140 有多高。 */
  L.startStage(L.PERCH_STAGE);
  clearFx(L);
  {
    /* 台面那口金箱是这关唯一的「金箱」（genLevel 里摘掉了别处的），
       所以"最高的那个 loot"就是它。
       **金箱是标记 `b.loot`，不是材质 `mat === 'loot'`** —— 它仍然是一口
       木箱，只是被打了标记（`NUM.box` 里没有 loot 这个材质）。第一版这里
       按材质筛，筛出空数组，`cam.y` 就落到默认值 0，图上悬台贴在顶边、
       金箱根本没进画面，而"图出了、没报错"。 */
    const loot = S.boxes.filter(b => !b.dead && b.loot)
      .sort((a, b) => a.y - b.y)[0];
    /* 台面顶 = 金箱底（球底坐标那套在这里是箱子的 y+h）。地板在它下面 140。
       **镜头对准两者中点**：只拍台面看不出 140 有多高，只拍地板看不出
       "从地上够不着" —— 一个数只在两者同框时才成立。 */
    const top = loot ? loot.y + loot.h : 300;
    S.cam.y = Math.max(0, Math.min(top + L.PERCH_H / 2 - H / 2, (L.WORLD_H || 2000) - H));
    S.cam.k = 0;
    L.draw();

    const cv = grab(real);
    const gg = cv.getContext("2d");
    /* 在图上量一根标尺。**这张图是评审用的，不是玩家截图** ——
       "140、单跳 123、二段跳 272" 这三个数光看画面永远对不上，
       而这一关的全部设计就压在这三个数上。 */
    const y1 = top - S.cam.y, y2 = y1 + L.PERCH_H;
    const rx = Math.max(70, Math.min((loot ? loot.x : 480) - 56, W - 120));
    gg.strokeStyle = "#FF6B4A"; gg.lineWidth = 2;
    gg.beginPath();
    gg.moveTo(rx, y1); gg.lineTo(rx, y2);
    gg.moveTo(rx - 7, y1); gg.lineTo(rx + 7, y1);
    gg.moveTo(rx - 7, y2); gg.lineTo(rx + 7, y2);
    gg.stroke();
    gg.font = "800 15px " + FONT;
    gg.textAlign = "left";
    gg.fillStyle = "#FF6B4A";
    gg.fillText(L.PERCH_H + "px", rx + 10, (y1 + y2) / 2 + 5);
    gg.font = "700 12.5px " + FONT;
    gg.fillStyle = "#8A3B22";
    gg.fillText("单跳 123 够不着", rx + 10, (y1 + y2) / 2 + 23);

    cells.push({ cv: cv, title: "第 " + L.PERCH_STAGE + " 关 · 悬台离地 " + L.PERCH_H,
                 note: "单跳 123 够不着、二段跳 272 够 —— 「踩实」才有非用它不可的理由" });
  }

  /* ---- ④ 裂壳 vs 木箱（3 倍特写）----
     **必须并排。** 单看裂壳只能看出"这箱子画得花"，看不出
     "它和旁边的木箱是不是一眼可分" —— 而"可分辨"才是这一版补的东西。
     另一个候选方案（靠透明度变淡）在雪地背景上根本看不出来，也是这么否掉的。 */
  L.startStage(L.RELIC_STAGES[0]);
  clearFx(L);
  {
    const husk = S.boxes.filter(b => !b.dead && b.mat === "husk")[0];
    const wood = S.boxes.filter(b => !b.dead && b.mat === "wood")[0];
    const Z = 3, BOX = 48;
    const cw = 480, ch = 300;
    const cv = createCanvas(cw, ch);
    const g = cv.getContext("2d");
    /* 底色跟着场景走一点，别用纯白 —— 木箱的描边是深灰，白底上显得比游戏里重。 */
    g.fillStyle = "#E8E4DA"; g.fillRect(0, 0, cw, ch);
    const pair = [[husk, "裂壳（打碎得雪晶 + 线索）"], [wood, "木箱（对照）"]];
    pair.forEach(([b, label], i) => {
      if (!b) return;
      const ox = 40 + i * 250, oy = 40;
      g.save();
      g.translate(ox, oy);
      g.scale(Z, Z);
      g.translate(-b.x, -b.y);
      L.drawBox(g, b);
      g.restore();
      g.fillStyle = "#2C3A46";
      g.font = "700 13px " + FONT;
      g.textAlign = "center";
      g.fillText(label, ox + BOX * Z / 2, oy + BOX * Z + 26);
    });
    /* 放大镜说法：告诉看图的这是 3 倍，不然"裂壳占满一格"会被当成尺寸变了。 */
    g.textAlign = "left";
    g.fillStyle = "#7A8896";
    g.font = "12px " + FONT;
    g.fillText("原尺寸 48px ×3 放大", 40, 276);
    cells.push({ cv: cv, title: "裂壳 · 和木箱并排（3×）",
                 note: "冷灰箱体 + 四角护铁 + 嵌进去的浅色壳板（两层理）+ 三处豁口 —— 不靠透明度区分" });
  }

  /* ---- ⑤ 深潜第 20 层 · 四条词条全开 ----
     20 层是最后一条（饥肠）生效的深度，四条正好排满 HUD 右侧那一列。
     **必须走 `diveNext()` 一层层推上去**，不能手改 `S.dive.depth` ——
     手改的话"新词条飘字""过门掉饱食"这些副作用一个都不发生，
     图就成了"我摆了一个深度给你看"。 */
  L.startDive(20931);
  for (let i = 0; i < 19; i++) L.diveNext();
  clearFx(L);
  S.cam.y = 0; S.cam.k = 0;
  L.draw();
  cells.push({ cv: grab(real), title: "深潜第 " + S.dive.depth + " 层 · 四条词条",
               note: "重石 / 厚甲 / 急冻 / 饥肠 —— 和雪晶同一列，是最容易撞的一组" });

  /* ---------------------------------------------------------------- 拼图 */
  const SW = 480, SH = 300, PADX = 12, PADY = 40, TOP = 132;
  const rows = Math.ceil(cells.length / 2);
  const cv = createCanvas(PADX * 3 + SW * 2, TOP + (SH + PADY) * rows + 10);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);

  g.fillStyle = "#1B2430";
  g.font = "bold 21px " + FONT;
  g.fillText("这一轮新加的五样东西：钱、图鉴、裂壳、悬台、词条", 14, 34);
  g.fillStyle = "#5B6B7B";
  g.font = "13px " + FONT;
  g.fillText("四样只能靠出图判 —— 断言验得了「状态对不对」，验不了「看一眼知不知道」。", 14, 58);
  g.fillText("B 开关图鉴 · 1/2/3 花雪晶买补给 · 踩实（C）在第 43 关才有非用它不可的理由", 14, 78);

  cells.forEach((c, i) => {
    const x = PADX + (i % 2) * (SW + PADX), y = TOP + ((i / 2) | 0) * (SH + PADY);
    g.drawImage(c.cv, x, y, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, SW - 2, SH - 2);
    g.fillStyle = "#1B2430";
    g.font = "bold 15px " + FONT;
    g.fillText(c.title, x + 2, y - 20);
    g.fillStyle = "#5B6B7B";
    g.font = "12.5px " + FONT;
    g.fillText(c.note, x + 2, y - 5);
  });

  const out = path.join(OUT, "codex-and-relic.png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out + "（" + cells.length + " 格）");
})();
