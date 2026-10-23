/* ============================================================================
   grove-shot3.js —— **带 UI 美术图**的截图器（playwright）
   ----------------------------------------------------------------------------
   和 grove-shot2.js 的区别只有一件事：**它会把 resources/grove 里的图注进 ART 表**。

   为什么必须有这一版：`grove.html` 是零外部依赖的（要能双击打开），
   所以 file:// 打开时 ART 是空的，所有面板都走代码回退分支 ——
   结算卡从奶白变成深绿、HUD 变成半透明块。用它验收美术会得出完全错的结论
   （这一版就踩过：以为面板改坏了，其实是拍早了 400ms）。

   用法：
     NODE_PATH=<隔离 workspace>/node_modules node grove-shot3.js s1 s4 s8
     NODE_PATH=... node grove-shot3.js clear:3        # 第 4 关的结算卡
     NODE_PATH=... node grove-shot3.js fail           # 失败结算

   产物落 ../shots/_t-<tag>.png（`_` 前缀，不入库）。
   ========================================================================== */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const HTML = "file:///" + path.join(__dirname, "..", "prototype", "grove.html").replace(/\\/g, "/");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
if (!args.length) { console.log("给个 tag，例如 s1 / clear:3"); process.exit(0); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 660 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.log("  !! 页面报错: " + e.message));
  page.on("console", m => { if (m.type() === "error") console.log("  !! console: " + m.text()); });
  await page.goto(HTML, { waitUntil: "load" });
  /* 注入美术图。grove.html 本身零外部依赖，file:// 打开时 ART 是空的，
     结算卡会走代码回退分支（奶白变深绿）—— 截图和真机就对不上了。 */
  await page.evaluate(async () => {
    const names = [
      "pet-cat", "pet-dog", "pet-ham", "pet-rab", "pet-ox", "pet-fox",
      "head-cat", "head-dog", "head-ham", "head-rab", "head-ox", "head-fox",
      "ui-arrow", "ui-belly", "ui-btn", "ui-coin", "ui-cream", "ui-pip",
      "ui-pip-on", "ui-prog", "ui-res", "ui-ring", "ui-star", "ui-tip",
    ];
    /* 资源按用途分目录：pet-cat -> grove/pet/cat.png。
       只替换第一个 '-'，'ui-pip-on' 才会变成 ui/pip-on 而不是 ui/pip/on。 */
    const base = "../assets/resources/grove/";
    await Promise.all(names.map((n) => new Promise((res) => {
      const im = new Image();
      im.onload = () => { window.GROVE.setArt(n, im); res(); };
      im.onerror = () => res();
      im.src = base + n.replace("-", "/") + ".png";
    })));
  });
  await sleep(400);

  for (const a of args) {
    const [kind, s] = a.split(":");
    if (kind === "clear") {
      await page.evaluate((st) => {
        const G = window.GROVE;
        G._start(0, st);
        const S = G.S;
        S.phase = "clear";
        S.kills = 9; S.total = 9; S.maxBall = 3; S.time = 41.2;
        S.usedBall = 2; S.bag = 21;
      }, Number(s || 0));
    } else if (kind === "fail") {
      await page.evaluate(() => {
        const G = window.GROVE, S = G.S;
        S.phase = "fail";
      });
    } else {
      const st = Number(a.replace("s", "")) - 1;
      await page.evaluate((n) => { window.GROVE._start(0, n); window.GROVE.S.phase = "play"; }, st);
    }
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, "_t-" + a.replace(":", "") + ".png") });
    console.log("  ✓ _t-" + a.replace(":", "") + ".png");
  }
  await browser.close();
})();
