/* ============================================================================
   出征页：三扇门的版式（2026-10-30 晚）
   ----------------------------------------------------------------------------
   用户先问「这个尺寸你觉的合适吗 之前不是做过吗」，再问「还有和深巢呢」。
   两张图回答：
     ① 三扇门并排时公式算出来的 266×150 是不是真的排得下（悬停放大出不出画布）；
     ② 深巢回来了没有。
   顺带一张鼠标悬停的那张（放大 1.2 是这张页唯一的手感来源）。

   跑法（要真浏览器）：
     NODE_PATH=<隔离 workspace>/node_modules node client/tools/_gates-shot.js
   ========================================================================== */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const GROVE = "file:///" + path.join(ROOT, "prototype", "grove.html").replace(/\\/g, "/");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.log("  !! 页面报错: " + e.message));
  page.on("console", m => { if (m.type() === "error") console.log("  !! console: " + m.text()); });

  await page.goto(GROVE + "?from=home");
  await sleep(1200);

  const info = await page.evaluate(() => {
    const P = window.GROVE;
    P.openGates();
    return {
      gates: P.GATES.map(g => g.id + "/" + g.name),
      rects: P.GATES.map((_, i) => { const r = P.gateRect(i); return [r.x, r.y, r.w, r.h]; }),
      scale: P.GATE.scale, detailMinH: P.GATE.detailMinH,
    };
  });
  console.log("门：" + info.gates.join("  "));
  info.rects.forEach((r, i) => console.log("  第 " + (i + 1) + " 张 " + r[2] + "×" + r[3] + " @ " + r[0] + "," + r[1]));
  console.log("悬停放大 " + info.scale + " · 第三行最小高度 " + info.detailMinH);

  await sleep(400);
  await page.screenshot({ path: path.join(OUT, "gates3.png") });

  /* 悬停第 2 张（古道）——验证放大后不出画布，也不会盖住邻居的点击区。 */
  const r1 = info.rects[1];
  await page.mouse.move(r1[0] + r1[2] / 2, r1[1] + r1[3] / 2);
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, "gates3-hover.png") });

  await browser.close();
  console.log("出图 " + path.join(OUT, "gates3.png"));
  console.log("出图 " + path.join(OUT, "gates3-hover.png"));
})();
