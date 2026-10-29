/* ============================================================================
   _entry-shot.js —— 验「出征页 → 推球 → 回来」这条链路的画面
   ----------------------------------------------------------------------------
   为什么单独一个脚本：`_floors-shot.js` 那一套走的是离屏 canvas + 手工调
   `L.draw()`，它验的是**关卡内容**。这条链路验的是**入口本身**：
     · `?from=grove` 有没有把「← 出征」按钮挂上去
     · 存档里第 N 关进来，HUD 进度芯片是不是「第 N 关」+ 骨架名
     · 同一关重开是不是同一张图（关号派生种子）
   这三件事只有真浏览器 + 真 URL 才量的到。

   用法：
     NODE_PATH=<隔离 workspace>/node_modules node _entry-shot.js
   产物落 ../shots/_t-entry-*.png（`_` 前缀，不入库）。
   ========================================================================== */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SNOW = "file:///" + path.join(ROOT, "prototype", "snowlab.html").replace(/\\/g, "/");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.log("  !! 页面报错: " + e.message));
  page.on("console", m => { if (m.type() === "error") console.log("  !! console: " + m.text()); });

  /* ① 从出征页进来，先往 localStorage 里塞一份"打到第 24 关"的存档 */
  await page.goto(SNOW + "?from=grove", { waitUntil: "load" });
  await page.evaluate(() => localStorage.setItem("pawpack.snow", JSON.stringify({ stage: 24 })));
  await page.reload({ waitUntil: "load" });
  await sleep(700);

  const info = await page.evaluate(() => {
    const S = window.SNOWLAB.S;
    return {
      stage: S.stage,
      skel: S.level && S.level.skel,
      hasBack: !!document.getElementById("toGrove"),
      backHref: (document.getElementById("toGrove") || {}).getAttribute
        ? document.getElementById("toGrove").getAttribute("href") : null,
      save: localStorage.getItem("pawpack.snow"),
    };
  });
  console.log("进关:", JSON.stringify(info));

  await page.screenshot({ path: path.join(OUT, "_t-entry-in.png") });
  console.log("  ✓ _t-entry-in.png");

  /* ② 通关 → 结算卡（标题应是「第 24 关」，底部提示「Enter 进第 25 关」） */
  await page.evaluate(() => {
    const L = window.SNOWLAB, S = L.S;
    S.phase = "clear";
    S.clearT = 0;
    S.kills = S.killedTarget;
    L.draw();
  });
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, "_t-entry-clear.png") });
  console.log("  ✓ _t-entry-clear.png");

  /* ③ Enter → 应该到第 25 关，并且存档跟着走 */
  await page.keyboard.press("Enter");
  await sleep(500);
  const after = await page.evaluate(() => {
    const L = window.SNOWLAB, S = L.S;
    return { stage: S.stage, phase: S.phase, skel: S.level && S.level.skel,
      save: localStorage.getItem("pawpack.snow"),
      /* 同一关重开两次的种子必须一样（"第 7 关在谁的机器上都是同一张图"） */
      seedA: L.stageSeed(25), seedB: L.stageSeed(25), seedOther: L.stageSeed(26) };
  });
  console.log("Enter 之后:", JSON.stringify(after));
  await page.screenshot({ path: path.join(OUT, "_t-entry-next.png") });
  console.log("  ✓ _t-entry-next.png");

  await browser.close();
})();
