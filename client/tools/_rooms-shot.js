/* ===========================================================================
   地下岩层也换场景 —— 四套主题 × 同一张关卡的同一层
   ---------------------------------------------------------------------------
   为什么要这张图：地表换色只覆盖开场两秒，玩家 90% 的时间在四层房间里。
   如果地下四层永远是同一套灰蓝/紫，"四个场景"就只是四张不同的天空。

   判据：不看标题，只问一句 —— **这四格像不像四个不同的地方？**
   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_rooms-shot.js
   环境变量：STAGE=n（默认 30，取第 3 层：那一层东西最多）
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const STAGE = Number(process.env.STAGE || 30);
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
  return { L: window.SNOWLAB, S: window.SNOWLAB.S, real };
}

function shot(inst, themeId, floor) {
  const { L, S } = inst;
  L.applyTheme(themeId);
  const k = floor;
  const cY = L.FLOORS[k - 1] + 26, fY = L.FLOORS[k];
  S.cam.y = clamp((cY + fY) / 2 - H / 2, 0, L.WORLD_H - H);
  S.cam.k = k;
  S.showMeter = false; S.showHint = false; S.showHud = false;
  S.texts.length = 0; S.balls.length = 0; S.shots.length = 0;
  S.shake = 0; S.t = 12;
  L.placePlayer(70, fY - L.PLAYER_H);
  S.p.vy = 0; S.p.onGround = true;
  L.draw();
  const c = createCanvas(W / 2, H / 2);
  c.getContext("2d").drawImage(inst.real, 0, 0, W / 2, H / 2);
  return c;
}

(async () => {
  const inst = await boot();
  const { L, S } = inst;
  L.reset(L.stageSeed(STAGE), STAGE);
  const nF = L.FLOORS.length;
  const floor = Math.max(1, Math.min(nF - 1, 3));
  const ids = L.themes();
  console.log("场景表：" + ids.join(" / ") + "　关卡：" + STAGE + "　楼层：" + floor + "/" + nF);

  const shots = ids.map(id => shot(inst, id, floor));

  /* 顺手量一下：四张图两两之间平均色差够不够大。**这不是验收，是防退化的
     哨兵** —— 哪天有人把 ROOM_RAMP 的系数调成 0.05，肉眼在缩略图上未必
     立刻看出来，但这个数会掉到个位数。 */
  const avg = c => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 37) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return [r / n, g / n, b / n];
  };
  const means = shots.map(avg);
  let minD = 1e9;
  for (let i = 0; i < means.length; i++) for (let j = i + 1; j < means.length; j++) {
    const d = Math.hypot(means[i][0] - means[j][0], means[i][1] - means[j][1], means[i][2] - means[j][2]);
    minD = Math.min(minD, d);
  }
  console.log("四张图两两最小平均色差：" + minD.toFixed(1) + "（<8 就是「还是同一个地方」）");

  const SW = W / 2, SH = H / 2, PAD = 10, TOP = 74;
  const cv = createCanvas(PAD + (SW + PAD) * 2, TOP + (SH + 40) * 2 + PAD);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
  g.font = "bold 20px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("地下第 " + floor + " 层 · 同一张关卡 · 四种岩层", 12, 32);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("地表换色只覆盖开场两秒；这一层才是玩家待得最久的地方。", 12, 54);

  shots.forEach((s, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x = PAD + col * (SW + PAD), y = TOP + row * (SH + 40);
    g.drawImage(s, x, y, SW, SH);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, SW - 2, SH - 2);
    g.font = "bold 15px " + FONT; g.fillStyle = "#1B2430";
    g.fillText(ids[i] + "　" + (L.themeCn ? L.themeCn(ids[i]) : ""), x + 2, y + SH + 22);
  });

  const out = path.join(OUT, "rooms-4.png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("→ " + out);
  S.stage = STAGE;
})();
