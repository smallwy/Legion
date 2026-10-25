/* ============================================================================
   grove-cmp-shot.js —— 给**任意一版** grove.html 拍照，用来判断"画面是什么时候变乱的"
   ----------------------------------------------------------------------------
   为什么需要它：用户说「战斗内的很乱……之前做的还好点 越做越乱」。
   "还好点"是一个**时间点**，不是一个形容词 —— 光看现在这一版，
   永远分不清"一直是这么乱"还是"某一次改动引入的"。必须把几个历史版本并排拍出来。

   2026-10-25 就靠它定位到：marsh 族 **240 根芦苇**是「场景三族」那次提交（13e6e42）加的。
   三族之前（b59d040）画面干净得多，之后满屏竖线。
   证据图：`shots/_cmp-old-s20.png` / `_cmp-fam-s20.png` / `_cmp-now-s20.png`。

   用法：
     git show 13e6e42:client/prototype/grove.html > /tmp/v-3fam.html
     node grove-cmp-shot.js /tmp/v-3fam.html fam s1 s8 s20

   产物：`shots/_cmp-<tag>-<屏>.png`（`_` 前缀，不入库）

   注意：老版本的 `GROVE` 可能没有 `_start`，脚本会打 `no _start` 并跳过那一屏，
   不会静默出一张黑图假装通过。
   ========================================================================== */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const [htmlArg, tag, ...stages] = process.argv.slice(2);
if (!htmlArg || !tag) { console.log("用法: node grove-cmp-shot.js <html> <tag> s1 s8"); process.exit(0); }
const HTML = "file:///" + path.resolve(htmlArg).replace(/\\/g, "/");
const ART = path.join(__dirname, "..", "assets", "resources", "grove") + "/";
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 660 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("  !! 页面报错: " + e.message));
  await page.goto(HTML, { waitUntil: "load" });

  await page.evaluate(async (base) => {
    if (!window.GROVE || !window.GROVE.setArt) return;
    const names = [
      "pet-cat", "pet-dog", "pet-ham", "pet-rab", "pet-ox", "pet-fox",
      "head-cat", "head-dog", "head-ham", "head-rab", "head-ox", "head-fox",
      "ui-arrow", "ui-belly", "ui-btn", "ui-coin", "ui-cream", "ui-pip",
      "ui-pip-on", "ui-prog", "ui-res", "ui-ring", "ui-star", "ui-tip",
    ];
    await Promise.all(names.map((n) => new Promise((res) => {
      const im = new Image();
      im.onload = () => { window.GROVE.setArt(n, im); res(); };
      im.onerror = () => res();
      im.src = base + n.replace("-", "/") + ".png";
    })));
  }, "file:///" + ART.replace(/\\/g, "/"));
  await sleep(400);

  for (const a of stages) {
    const st = Number(a.replace("s", "")) - 1;
    const ok = await page.evaluate((n) => {
      const G = window.GROVE;
      if (!G || !G._start) return "no _start";
      try { G._start(0, n); G.S.phase = "play"; return "ok"; } catch (e) { return String(e); }
    }, st);
    if (ok !== "ok") { console.log("  ✗ " + a + " → " + ok); continue; }
    await sleep(700);
    const nm = `_cmp-${tag}-${a}.png`;
    await page.screenshot({ path: path.join(OUT, nm) });
    console.log("  ✓ " + nm);
  }
  await browser.close();
})();
