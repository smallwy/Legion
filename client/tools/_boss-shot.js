/* ===========================================================================
   第五十一轮：终局 BOSS 的四格状态
   ---------------------------------------------------------------------------
   一张图回答一个问题：**「壳还剩几层」能不能只看剪影就读出来**。
   不靠读标题、不靠 HUD —— 玩家在打的时候没有标题。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_boss-shot.js
   环境变量：ART=1 挂磁盘真立绘；STAGE=n 换关（默认 48）
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const STAGE = Number(process.env.STAGE || 48);
const ART = !!process.env.ART;
const PROTO = path.join(ROOT, "prototype", "snowlab.html");
const FONT = "Microsoft YaHei, PingFang SC, sans-serif";
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
  if (ART) {
    try { window.SNOWLAB.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
    catch (e) { }
    try { window.SNOWLAB.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { }
  }
  return { L: window.SNOWLAB, S: window.SNOWLAB.S, real, g };
}

/** 镜头锁在门厅层（BOSS 所在那层），和玩家走到那儿看见的一致。 */
function aimBossFloor(inst) {
  const { L, S } = inst;
  const k = L.FLOORS.length;
  const cY = L.FLOORS[k - 1] + 26, fY = L.FLOORS[k - 1];
  void fY;
  const bottom = L.FLOORS[k - 1];
  S.cam.y = clamp((cY + bottom) / 2 - H / 2 + 40, 0, L.WORLD_H - H);
  S.cam.k = k;
  S.showMeter = false; S.showHint = false; S.showHud = false;
  S.texts.length = 0; S.balls.length = 0; S.shots.length = 0;
  S.shake = 0; S.flash = 0;
  S.t = 12;
  L.placePlayer(70, bottom - L.PLAYER_H);
  S.p.vy = 0; S.p.onGround = true;
}

function shot(inst, shell) {
  const { L, S } = inst;
  S.boss.shell = shell;
  S.boss.dead = shell <= 0;
  S.boss.flash = 0;
  aimBossFloor(inst);
  L.draw();
  const c = createCanvas(W / 2, H / 2);
  c.getContext("2d").drawImage(inst.real, 0, 0, W / 2, H / 2);
  /* **特写必须当场抠。** 四格都画完再回头抠，`inst.real` 里只剩最后
     那一格（上一版四格特写全是"壳碎"），而拼图本身是对的 —— 这种
     "主图对、附图画错"最难发现。 */
  const B = S.boss;
  const cw = 220, chh = 200, Z = 3;
  const crop = createCanvas(cw * Z, chh * Z);
  /* **世界坐标要减 cam.y 才是画布坐标。** 直接用 B.y 抠出来是一片空白 ——
     门厅层在世界 y≈1200，而画布只有 600 高。 */
  crop.getContext("2d").drawImage(
    inst.real,
    B.x + B.w / 2 - cw / 2, B.y - 44 - S.cam.y, cw, chh, 0, 0, cw * Z, chh * Z);
  return { card: c, crop };
}

(async () => {
  const inst = await boot();
  const { L } = inst;
  L.reset(L.stageSeed(STAGE), STAGE);
  console.log("第 " + STAGE + " 关 · 场景 " + L.THEME.id + " · boss=" + JSON.stringify(L.S.boss));

  const CASES = [
    { shell: 3, label: "三层壳（未开打）", note: "R 最大，核心光照不出来" },
    { shell: 2, label: "破一层", note: "整体缩一圈 · 核心开始漏光" },
    { shell: 1, label: "破两层", note: "最亮、最小 —— 下一击就穿" },
    { shell: 0, label: "壳碎", note: "只剩碎石与余烬 · 门才开" },
  ];
  const shots = CASES.map(c => shot(inst, c.shell).card);

  const SW = W / 2, SH = H / 2, PAD = 10, TOP = 76;
  const cv = createCanvas(PAD + (SW + PAD) * 2, TOP + (SH + 46) * 2 + PAD);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
  g.font = "bold 20px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("第 " + STAGE + " 关终局：BOSS 的四格状态（" + L.THEME.id + " 场景）", 12, 32);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("同一种子、同一机位。判据：只看剪影能不能说出还剩几层。", 12, 54);

  shots.forEach((s, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x = PAD + col * (SW + PAD), y = TOP + row * (SH + 46);
    g.drawImage(s, x, y, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, SW - 2, SH - 2);
    g.font = "bold 15px " + FONT; g.fillStyle = "#1B2430";
    g.fillText(CASES[i].label, x + 2, y + SH + 20);
    g.font = "12px " + FONT; g.fillStyle = "#6B7B8B";
    g.fillText(CASES[i].note, x + 2, y + SH + 38);
  });

  /* ---- 特写条：把 BOSS 抠出来放大 3 倍，验「三层壳」到底看不看得见 ---- */
  {
    const crops = CASES.map(c => shot(inst, c.shell).crop);
    const cw = crops[0].width, chh = crops[0].height, GAP = 10;
    const strip = createCanvas(GAP + (cw + GAP) * 2, 34 + (chh + 26) * 2 + GAP);
    const sg2 = strip.getContext("2d");
    sg2.fillStyle = "#FFFDF8"; sg2.fillRect(0, 0, strip.width, strip.height);
    sg2.font = "bold 14px " + FONT; sg2.fillStyle = "#1B2430";
    sg2.fillText("同一帧放大 3 倍：三层壳还剩几层，看弧线数量", GAP, 24);
    crops.forEach((cp, i) => {
      const col = i % 2, row = (i / 2) | 0;
      const x = GAP + col * (cw + GAP), y = 34 + row * (chh + 26);
      sg2.drawImage(cp, x, y);
      sg2.font = "bold 13px " + FONT; sg2.fillStyle = "#1B2430";
      sg2.fillText(CASES[i].label, x + 2, y + chh + 18);
    });
    fs.writeFileSync(path.join(OUT, "boss-close-" + STAGE + ".png"), strip.toBuffer("image/png"));
  }

  const out = path.join(OUT, "boss-" + STAGE + (ART ? "-art" : "") + ".png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("→ " + out);
})();
