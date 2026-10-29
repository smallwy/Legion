/* 采样楼板顶面/板体的实际颜色，确认"每层不同材质"真的落到像素上。
   跑：NODE_PATH=... node client/tools/_slab-probe.js */
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const ROOT = path.resolve(__dirname, "..");
const W = 960, H = 600;

(async () => {
  const real = createCanvas(W, H);
  const g = real.getContext("2d");
  const html = fs.readFileSync(path.join(ROOT, "prototype/snowlab.html"), "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const w = dom.window;
  w.devicePixelRatio = 1;
  w.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
  w.requestAnimationFrame = () => 0;
  w.eval(m[1]);
  /* **必须给离屏工厂。** 不给的话 STATIC 静态层退回 jsdom 的 <canvas>，
     它的 drawImage 参数是 jsdom 元素，@napi-rs 认不出来 —— 报的是
     "provided value is not of type CanvasElement"，和背景图完全无关。 */
  if (w.SNOWLAB.setOffscreen) w.SNOWLAB.setOffscreen((cw, ch) => createCanvas(cw, ch));
  const L = w.SNOWLAB, S = w.SNOWLAB.S;
  try { L.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
  catch (e) { console.log("背景加载失败：" + e.message); L.setBackdrop(null); }

  const SEED = Number(process.env.SEED || 6);
  L.reset(SEED);
  S.showMeter = false; S.showHint = false; S.showHud = false;
  S.texts.length = 0; S.balls.length = 0; S.foes.length = 0; S.shake = 0;
  S.t = 12;

  const named = ["", "木屋", "砖房", "石洞", "地窖"];
  for (let k = 0; k < L.FLOORS.length; k++) {
    const fy = L.FLOORS[k];
    const cY = k > 0 ? L.FLOORS[k - 1] + 26 : fy - 150;
    S.cam.y = Math.max(0, Math.min(L.WORLD_H - H, fy - 407));
    L.placePlayer(-999, -999);
    S.p.vy = 0;
    try { L.draw(); } catch (e) { console.log("draw 失败: " + e.message); break; }
    const sy = Math.round(fy - S.cam.y);
    if (sy < 0 || sy > H - 30) { console.log("floor " + k + " 出屏，跳过"); continue; }
    const sample = (x, y) => {
      const d = g.getImageData(x, y, 1, 1).data;
      return d[0] + "," + d[1] + "," + d[2];
    };
    /* 顶面：板顶 +3；板体：板顶 + 16。都取 3 个 x 的中位数附近，避开箱子。 */
    const cols = [70, 500, 890].map(x => "顶" + sample(x, sy + 3) + " 体" + sample(x, sy + 16));
    console.log("floor" + k + " y=" + fy + " 房=" + (named[Math.min(k, 4)] || "-") + "  " + cols.join("  |  "));
  }
})();
