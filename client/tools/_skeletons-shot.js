/* 六种骨架 + 深潜出图。

   骨架这一轮**没有任何新美术**，所以"验收图"要证明的不是"画得好看"，
   而是**六种空间走向能不能被一眼分开**：

     直井  洞在两列之间小幅交替，一路往下
     之字  每层横穿整屏
     双井  每层两个镜像口
     靠壁  洞全挤在半屏之内
     中枢  洞贴中线
     螺旋  左→中→右→中，四段一轮

   每张卡片只画**上面两层**：骨架在前两层就定型了（shaft/wall/hub
   是两列交替，zigzag 是左右交替，helix 是左中右轮转），
   画满五层只是把图缩得更小、看不出东西。

   用法：
     node client/tools/_skeletons-shot.js           骨架六连（stage 1~6）
     node client/tools/_skeletons-shot.js dive      深潜三连（关卡 / HUD / 结算）
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
const W = 960, H = 600;
const PFX = process.env.PREFIX || "g10";
const MODE = process.argv[2] || "skel";

const SKEL_CN = { shaft: "直井", zigzag: "之字", twin: "双井", wall: "靠壁", hub: "中枢", helix: "螺旋" };
const SKEL_DESC = {
  shaft: "两列之间小幅交替，一路往下",
  zigzag: "每层横穿整屏，先看清再走",
  twin: "每层两个镜像口，走哪边都要选",
  wall: "洞全挤在半屏之内，另一侧留空",
  hub: "洞贴中线，四周全是箱山",
  helix: "左→中→右→中，四段一轮",
};

function fresh() {
  const html = fs.readFileSync(path.join(ROOT, "prototype/snowlab.html"), "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const real = createCanvas(W, H);
  const g = real.getContext("2d");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const w = dom.window;
  w.devicePixelRatio = 1;
  w.HTMLCanvasElement.prototype.getContext = () => g;
  w.requestAnimationFrame = () => 0;
  w.eval(m[1]);
  const L = w.SNOWLAB;
  if (L.setOffscreen) L.setOffscreen((cw, ch) => createCanvas(cw, ch));
  return { L, S: L.S, g, real };
}

/* 画一层并立刻拷出来 —— 主画布是共用的，下一次 draw 会覆盖。 */
function tileOf(env, k) {
  const { L, S, real } = env;
  const fY = L.FLOORS[k] || 0;
  S.cam.y = Math.max(0, Math.min(L.WORLD_H - H, fY - 330));
  S.t = 6;
  L.draw();
  const t = createCanvas(W, H);
  t.getContext("2d").drawImage(real, 0, 0);
  return t;
}

async function main() {
  const env = fresh();
  const { L, S } = env;
  try {
    await L.setBackdrop(await loadImage(path.join(ROOT, "assets/snowlab/bg-surface.jpg")));
  } catch (e) { /* 没背景也能出图，只是空 */ }
  S.showHud = false;
  S.showMeter = false;

  if (MODE === "dive") {
    /* ---------- 深潜三连 ---------- */
    L.startDive(20261029);
    for (let i = 0; i < 4; i++) L.diveNext();
    S.showHud = true; S.showMeter = true;
    S.balls.length = 0;
    const tiles = [tileOf(env, 0), tileOf(env, 1)];

    /* 结算页 */
    S.showHud = true;
    S.phase = "dead";
    S.deadT = 1.2;
    S.dive.depth = 7;
    S.dive.kills = 34;
    S.dive.score = 7 * 100 + Math.round(S.belly) * 3 + 34 * 5;
    /* **best 要给一个不同的数。** 让它等于本局，卡片上会读成「本局 1170 = 最佳 1170 · 刚破纪录」，
       但这是评审图，要演示的是两栏并排怎么读 —— 给 1480 才是常态（以前最好过 1480）。 */
    S.dive.best = 1480;
    L.draw();
    const over = createCanvas(W, H);
    over.getContext("2d").drawImage(env.real, 0, 0);

    /* **两张图都必须等比。** 上一版把 960×600 的结算页塞进 235×294，
       横向 0.245 / 纵向 0.49 —— 结算卡片被压成一条，字全糊了。
       现在：左边整屏按 0.625 缩（600×375），右边**不缩整屏，直接 1:1
       裁出卡片那一块**（卡片 420×300，位置 cx=270 cy=120，四周留 20）。
       评审要看的是"卡片上写了什么"，不是"卡片在一张 960 图里多小"。 */
    const SW = 600, SH = 375, PAD = 26, TOP = 124;
    const CX0 = 250, CY0 = 100, CWD = 460, CHT = 340;   // 1:1 裁切区
    const cv = createCanvas(PAD + SW + PAD + CWD + PAD, TOP + SH + 78);
    const g = cv.getContext("2d");
    g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
    g.font = "bold 22px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#1B2430";
    g.fillText("深潜（无尽）：一命到底，深度即分数", PAD, 38);
    g.font = "14px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#5B6B7B";
    g.fillText("零新美术 —— 生成器 / 骨架 / 饱食条 / 结算全是现成的；过门不清资源，hp 归零即结束。", PAD, 64);
    g.fillStyle = "#8A97A3";
    g.fillText("深度写在右侧芯片上（试验台面板正下方）当唯一进度量；死亡不复活，直接结算。", PAD, 86);

    g.drawImage(tiles[1], PAD, TOP, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(PAD + 1, TOP + 1, SW - 2, SH - 2);
    g.font = "bold 14px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#16537E";
    g.fillText("深度 5 · 第 5 关的 5 层", PAD, TOP - 10);
    g.font = "13px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#5B6B7B";
    g.fillText("右侧「深度 5」是唯一进度量；左上饱食条接着上一关的余量走。", PAD, TOP + SH + 22);
    g.fillStyle = "#A8B4BE";
    g.fillText("过门只补 1 点 hp，肚子和子弹原样带过去 —— 越深越紧。", PAD, TOP + SH + 42);

    const ox = PAD + SW + PAD;
    /* 背景铺暗一档，免得裁切区的边缘看起来像"图没对齐" */
    g.fillStyle = "#0B1418";
    g.fillRect(ox - 1, TOP - 1, CWD + 2, CHT + 2);
    g.drawImage(over, CX0, CY0, CWD, CHT, ox, TOP, CWD, CHT);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(ox + 1, TOP + 1, CWD - 2, CHT - 2);
    g.font = "bold 14px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#16537E";
    g.fillText("结算卡（1:1）· 深度 / 本局 / 最佳", ox, TOP - 10);
    g.font = "13px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#5B6B7B";
    g.fillText("分数 = 深度×100 + 肚里余粮×3 + 击杀×5。", ox, TOP + CHT + 22);
    g.fillStyle = "#A8B4BE";
    g.fillText("刻意不摆主线那张量具表：深潜只比一件事 —— 敢下多深。", ox, TOP + CHT + 42);

    const out = path.join(OUT, PFX + "-dive.png");
    fs.writeFileSync(out, cv.toBuffer("image/png"));
    console.log("出图 " + out);
    return;
  }

  /* ---------- 骨架六连 ---------- */
  /* **用 stage 25~30（4 层关），不用 stage 1~6。**
     前 6 关是 2 层的教学关，只有 1 个洞 —— 六种骨架里有五种在那里
     退化成"洞开在某一列"，图上看不出任何差别。骨架需要**至少两层洞**
     才读得出来（交替 / 横穿 / 轮转都是"两层之间"的关系）。
     25 起是 4 层关（3 个洞），且 `(stage-1)%6` 正好从头开始发六种。 */
  const cards = [];
  for (let st = 25; st <= 30; st++) {
    L.reset(1000 + st * 37, st);
    const lv = L.S.level;
    const xs = [...new Set(lv.layers.flatMap(l => l.holes.map(h => h.x)))].sort((a, b) => a - b);
    cards.push({
      skel: lv.skel, nF: lv.nFloors, xs,
      /* **洞要在这里就抄出来。** L.S.level 是「最后一次 reset 的关卡」——
         在 forEach 里读它，六张卡片会全被画成 stage 30（双井）的洞。
         上一版就是这么错的：直井那张画出了两个框。 */
      holes: lv.layers.map(l => l.holes.map(h => ({ x: h.x, w: h.w }))),
      tiles: [tileOf(env, 0), tileOf(env, 1), tileOf(env, 2)],
    });
  }

  /* **版面按"等比"排。** 上一版把 960×450 的源硬拉进 468×112 的目标，
     横向 0.49、纵向 0.25 —— 图被压扁，洞的横向位移全看不出来了。
     现在每层固定 300×140（960 宽 → 300，450 高 → 140.6，误差 <1px），
     3 列 × 2 行。 */
  /* **行距要按"文字实际高度"算，不能拍脑袋。**
     每块卡片占：标题 2 行（cy-30 / cy-12，字高 17+12）
     + 图 2×FH + 描述 2 行（cy+FH*2+22 / +42，字高 13+12）
     → 上一行描述底部在 cy+FH*2+42，下一行标题顶部在 cy+FH*2+CAP-30-17
     要 +CAP-47 > +42 → **CAP 至少 90**。
     头部 4 行说明压到 y=108，第一行标题写 cy-30 → TOP 至少 168。 */
  const CW = 300, FH = 140, PAD = 16, TOP = 172, COLS = 3, CAP = 92;
  const rows = Math.ceil(cards.length / COLS);
  const cv = createCanvas(PAD + COLS * (CW + PAD), TOP + rows * (FH * 2 + CAP) + 10);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);

  g.font = "bold 22px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#1B2430";
  g.fillText("六种骨架：洞开在哪，决定这关怎么走", PAD, 40);
  g.font = "14px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#5B6B7B";
  g.fillText("只改洞的 x，0 新美术。主线按 stage 发牌（任意连续 6 关不重复），深潜按种子随机。", PAD, 66);
  g.fillStyle = "#8A97A3";
  g.fillText("每张画上面两层（stage 25~30，4 层关）—— 洞的横向位移在两层之间最明显。", PAD, 88);
  g.fillStyle = "#8A97A3";
  g.fillText("前 6 关是 2 层教学关，只有 1 个洞，骨架在那里退化成「洞开在某一列」。", PAD, 108);

  cards.forEach((c, i) => {
    const cx = PAD + (i % COLS) * (CW + PAD);
    const cy = TOP + Math.floor(i / COLS) * (FH * 2 + CAP);
    for (let j = 0; j < 2; j++) {
      const ty = cy + j * FH;
      g.drawImage(c.tiles[j], 0, 150, W, 450, cx, ty, CW, FH);
      /* **把洞描出来。** 不描的话，缺口被箱子和装饰淹掉 ——
         六张图读起来都是"一堆箱子"，差别要靠数。
         源坐标里这一层的楼板在屏幕 y=330（相机 = floorY-330），
         板厚 26 → 楼板占 330..356。上一版把框画在 300..330（楼板上方
         的空中），看着像浮在缝里的虫子。现在框 320..360，**跨在楼板线
         上**，缺口本身被填成粉色。 */
      for (const h of (c.holes[j] || [])) {
        const dx = cx + (h.x / W) * CW;
        const dw = (h.w / W) * CW;
        const dy = ty + ((320 - 150) / 450) * FH;
        const dh = (40 / 450) * FH;
        g.fillStyle = "rgba(255,61,113,.26)";
        g.fillRect(dx, dy, dw, dh);
        g.strokeStyle = "#FF3D71"; g.lineWidth = 1.6;
        g.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
        /* 楼板线位置再压一条实线，读图时不用猜缺口在哪一水平线上 */
        const fy = ty + ((330 - 150) / 450) * FH;
        g.beginPath();
        g.moveTo(dx, fy); g.lineTo(dx + dw, fy);
        g.strokeStyle = "rgba(255,61,113,.85)"; g.lineWidth = 1.4; g.stroke();
      }
      if (j) {
        g.beginPath();
        g.moveTo(cx, ty); g.lineTo(cx + CW, ty);
        g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1.2; g.stroke();
      }
    }
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(cx + 1, cy + 1, CW - 2, FH * 2 - 2);

    g.font = "bold 17px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#16537E";
    g.fillText(SKEL_CN[c.skel] || c.skel, cx + 1, cy - 30);
    g.font = "12px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#8A97A3";
    g.fillText("洞 x = " + c.xs.join(" / "), cx + 1, cy - 12);
    g.font = "13px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#5B6B7B";
    g.fillText(SKEL_DESC[c.skel] || "", cx + 1, cy + FH * 2 + 22);
    g.font = "12px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#A8B4BE";
    g.fillText(c.nF + " 层 · " + (c.xs.length > 1 ? "dx " + (c.xs[1] - c.xs[0]) : "单洞"), cx + 1, cy + FH * 2 + 42);
  });
  g.fillStyle = "#8A97A3";
  g.font = "12px 'Microsoft YaHei', sans-serif";
  g.fillText("粉框 = 下行口。看「每层的口往哪挪」就是骨架。", PAD, cv.height - 6);

  const out = path.join(OUT, PFX + "-skeletons.png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out);
  for (const c of cards) console.log("  " + (SKEL_CN[c.skel] || c.skel) + " 洞 x = " + c.xs.join("/"));
}

main().catch(e => { console.error(e); process.exit(1); });
