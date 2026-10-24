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
    } else if (kind === "pick") {
      /* 挑一屏。不带数字 = 全通（27 格全亮，每格带评级）；
         带数字 = 只通到那一屏，后面的格子应该是锁的。 */
      await page.evaluate((pr) => {
        const G = window.GROVE, S = G.S;
        const n = G.LEVELS.length;
        const k = (pr === null || pr === undefined || pr === "") ? n : Number(pr);
        S.progress = k;
        for (let i = 0; i < n; i++) {
          // 造一组有分布的评级：全 S 看不出色阶，全 B 看不出金色
          S.best[i] = i < k ? ["S", "A", "B"][i % 3] : null;
        }
        S.hoverStage = -1;
        G.openPick();
      }, s === undefined ? "" : s);
    } else if (kind === "boss") {
      /* `boss:12` = 第 12 屏，BOSS 站着抬手（断台预告）。
         `boss:20:mud` = 第 20 屏，泥潮预告。
         `boss:12:slam` = 砸地（对照：老动作长什么样）。
         直接造一只 BOSS 进 S.foes —— BOSS 本来只在最后一波刷，
         靠机器人打到最后一波再截图，拍成什么样全看运气。 */
      await page.evaluate((arg) => {
        const G = window.GROVE, S = G.S;
        const parts = arg.split(":");
        const st = Number(parts[0]) - 1;
        const what = parts[1] || "crack";
        G._start(0, st);
        S.phase = "play";
        S.foes.length = 0;
        const b = G.foeFromSpec({ foe: "boss", lv: 5, x: 520, y: G.GROUND_Y }, false);
        b.face = -1;
        if (what === "crack") {
          b.cracking = 0.46;
          b._crackTgt = G.crackTarget(b);
        } else if (what === "mud") {
          /* 玩家站到 BOSS **左边**：泥是朝玩家那一侧铺的。
             站右边的话，落点会撞上营地通道的护栏（营地左边 280px 不铺），
             mudSpot 返回 null，截出来什么预告都没有 —— 第一次就这么拍的。 */
          S.p.x = 160;
          b.face = 1;
          b.mucking = 0.44;
          b._mudSpot = G.mudSpot(b);
        } else if (what === "muddone") {
          /* 铺完之后长什么样（对照"预告"用）：直接落手，不等计时器。 */
          S.p.x = 160;
          b.face = 1;
          const sp = G.mudSpot(b);
          if (sp) G.mudRise(b, sp);
          b.mucking = 0;
        } else if (what === "slam") {
          b.slamming = 0.62;
        } else if (what === "spawn") {
          b.breeding = 0.52;
        } else if (what === "fan") {
          b.spitting = 0.40;
        }
        S.foes.push(b);
        /* ★ 主循环是活的：取值 0.46 的抬手在 700ms 的等待里会一路减到 0.30 以下，
           落手、地形变样 —— 截到的是"变完之后"，不是"预告"。第一版就这么翻了车。
           所以每帧把计时器按回去：状态冻结在"抬手到一半"那一刻。 */
        const hold = () => {
          if (what === "crack") { b.cracking = 0.46; }
          else if (what === "mud") { b.mucking = 0.44; }
          else if (what === "slam") { b.slamming = 0.62; }
          else if (what === "spawn") { b.breeding = 0.52; }
          else if (what === "fan") { b.spitting = 0.40; }
        };
        S._shotHold = setInterval(hold, 16);
      }, a.slice(5));
    } else if (kind === "jump") {
      /* 测试跳关面板（F2）。`jump` = 存档只通到第 3 屏、光标停在当前屏；
         `jump:12` = 光标挪到第 13 格。
         故意把 progress 压到 2 —— 面板的全部意义就是"没解锁也能点"，
         拿全通的存档来拍，看不出这个功能到底做没做。 */
      await page.evaluate((cur) => {
        const G = window.GROVE, S = G.S;
        const n = G.LEVELS.length;
        S.progress = 2;
        for (let i = 0; i < n; i++) {
          S.best[i] = i < 5 ? ["S", "A", "B"][i % 3] : null;
        }
        G._start(0, 5);
        G.openJump();
        if (cur !== null) S.jumpCur = Number(cur);
        S.jumpHover = 13;
      }, s === undefined ? null : s);
    } else {
      /* `s8` = 第 8 屏带默认那只（尖耳猫）；`s8#3` = 第 8 屏带第 3 只（长耳兔）。
         加这个后缀是为了**用画面证明"换宠物真的换了"** ——
         光看 `heroIndexOf()` 的断言只能证明算出了数字，证明不了场上换成了谁。 */
      const m = /^s(\d+)(?:#(\d+))?$/.exec(a);
      const st = m ? Number(m[1]) - 1 : Number(a.replace("s", "")) - 1;
      const hero = m && m[2] !== undefined ? Number(m[2]) : 0;
      await page.evaluate(({ n, h }) => { window.GROVE._start(h, n); window.GROVE.S.phase = "play"; }, { n: st, h: hero });
    }
    await sleep(700);
    const nm = "_t-" + a.replace(/[:#]/g, "-") + ".png";
    await page.screenshot({ path: path.join(OUT, nm) });
    console.log("  ✓ " + nm);
  }
  await browser.close();
})();
