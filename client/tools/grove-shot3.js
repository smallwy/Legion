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
      /* 出征页的玩法立绘（768×432）。少了这几张，出征页会走简笔回退分支，
         截出来和真机不是一个东西。**条数必须跟 GATES 一样多** ——
         新加门忘了加这里，截图只会"那张卡是简笔画"，不会报错。 */
      "gate-trail", "gate-nest", "gate-snow",
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
    /* 场景串可以有三段以上（`portals:1:tip:extra`）。这里只切**第一刀**，
       剩下的整段交给分支自己 split —— 用 `const [kind, s] = a.split(":")`
       会把第三段以后全丢掉，而丢掉的部分恰好是"要不要塞星靶种子"
       （第一版就这么拍的：总账 0/81，三颗星全是空心）。 */
    const cut = a.indexOf(":");
    const kind = cut < 0 ? a : a.slice(0, cut);
    const s = cut < 0 ? undefined : a.slice(cut + 1);
    if (kind === "clear") {
      await page.evaluate((st) => {
        const G = window.GROVE;
        G._start(0, st);
        const S = G.S;
        S.phase = "clear";
        S.kills = 9; S.total = 9; S.maxBall = 3; S.time = 41.2;
        S.usedBall = 2; S.bag = 21;
      }, Number(s || 0));
    } else if (kind === "nestclear") {
      /* 深巢第 N 层的结算卡（`nestclear:11`）。**先用真实入口 enterNest**，
         再只把 phase 拨到 clear —— 结算卡读的是 S.nest / S.stat / S.trip，
         那些必须由真实链路填，手工造一个关卡对象的话，卡上文案是假的。 */
      await page.evaluate((arg) => {
        const G = window.GROVE;
        const d = Number(arg);
        if (!Number.isFinite(d) || d < 1) throw new Error(`nestclear 只接层号，收到 "${arg}"`);
        G.enterNest(d);
        const S = G.S;
        S.phase = "clear";
        S.trip.stages = 3;
        S.belly = Math.max(0, S.belly - 20);
      }, s === undefined ? 0 : s);
    } else if (kind === "star") {
      /* `star:5` = 第 6 屏的结算卡，**三颗靶三态同屏**：
           金底 ✓ = 这一趟新达成（fresh）
           绿底 ✓ = 早就有了（这趟又满足一次）
           灰底 — = 没做到
         外加一条集满回执（碎片 +2 · 材料 +3）。
         `star:5:lean` = 只达成 1 个且不是新的 → 应该**没有回执**，
         卡片上只有一个绿 pill + 两个灰 pill。

         为什么值得单独一个 kind：星靶的判定 / 落盘 / 奖励全在 recordStar 里，
         但"玩家看得见"只发生在这一张卡上（MEMORY：机制做了 ≠ 玩家看得见，
         这个项目在这上面栽过五次）。截图是唯一能验"画出来了"的手段。 */
      await page.evaluate((arg) => {
        const G = window.GROVE, S = G.S;
        const parts = arg.split(":");
        const st = Number(parts[0]);
        const lean = parts[1] === "lean";
        G._start(0, st);
        S.phase = "clear";
        S.kills = 9; S.total = 9; S.maxBall = 3; S.time = 41.2;
        S.usedBall = 2; S.bag = 21;
        const row = G.STAR_OF_STAGE[S.stage] || [];
        if (lean) {
          /* 只达成第一个、且存档里早有 → 绿 pill，无回执 */
          S.starMet = row.slice(0, 1);
          S.starFresh = [];
          S.starGain = { shards: 0, logs: 0 };
        } else {
          /* 三个全达成，其中第 1、3 个是新的 → 金/金/绿 + 集满回执。
             starGain 的账和 mergeStarBits 一致：2 个新靶各 1 材，
             外加集满 2 碎片 + 1 材 = 3 材。 */
          S.starMet = row.slice();
          S.starFresh = [row[0], row[2]];
          S.starGain = { shards: 2, logs: 3 };
        }
      }, a.slice(5));
    } else if (kind === "fail") {
      await page.evaluate(() => {
        const G = window.GROVE, S = G.S;
        S.phase = "fail";
      });
    } else if (kind === "portals") {
      /* 出征页。`portals` = 常态；`portals:n` = 键盘光标停在第 n 扇门；
         `portals:n:rich` = 再塞一份"推了很多屏 + 一堆星"的存档，
         验进度条与星靶总账不是永远 0。 */
      await page.evaluate((arg) => {
        const G = window.GROVE, S = G.S;
        const parts = String(arg === undefined ? "" : arg).split(":");
        const n = G.LEVELS.length;
        if (parts[1] === "rich") {
          /* 半进度而不是全通：全通时 cur = 最后一屏，那一屏的星必然是空的，
             预览卡三颗星全灰，验不到三态。半进度（13）时 seed[13] 有 1 颗，
             同屏能看到 金 / 空心 两种。 */
          S.progress = 13;
          for (let i = 0; i < n; i++) S.best[i] = i < 13 ? ["S", "A", "B"][i % 3] : null;
        } else {
          S.progress = 6;
          for (let i = 0; i < n; i++) S.best[i] = i < 6 ? ["S", "A", "B"][i % 3] : null;
        }
        G.openGates();
        if (parts[1] === "rich") {
          /* 前三屏集满 / 第 4~14 屏各拿 1 颗 / 其余全空。
             cur = 13 落在"1 颗"区间，预览卡同屏出现 金 + 空心。 */
          const seed = [];
          for (let i = 0; i < n; i++) {
            const r = [0, 0, 0];
            if (i < 3) r[0] = r[1] = r[2] = 1;
            else if (i < 14) r[0] = 1;
            seed.push(r);
          }
          S.starBits = seed;
        }
        if (parts[0] !== undefined && parts[0] !== "") {
          /* NaN 静默错：`portals:rich`（rich 放第一段）时 Number("rich") = NaN，
             clamp(NaN) 还是 NaN，GATES[NaN] = undefined → 预览卡整块被跳过。
             小卡和底部提示照画，截图"看起来只是少了预览卡" —— 最难查的那类。
             这里不 Finite 就抛，别让它静默。正确写法：portals:0:rich。 */
          const g0 = Number(parts[0]);
          if (!Number.isFinite(g0)) {
            throw new Error(`portals 场景第一段只能是门序号（数字），收到 "${parts[0]}"；` +
              `带存档的场景串写作 portals:0:rich（序号占第一段）`);
          }
          S.gateCur = g0;
        }
        /* `portals:1:tip` = 点一下那扇没开的门，验提示条真的画出来 */
        if (parts[1] === "tip") G.enterGate(1);
        /* `portals:2:snow` = 塞一份"推到第 24 关"的推球存档，
           验第三扇门的副行真的报关号（而不是永远「还没出发」）。
           键名和结构必须和 snowlab.html 里的 SNOW_SAVE_KEY 逐字一致 ——
           两个文件只能靠 localStorage 见面，写错一个字母就是静默不显示。 */
        if (parts[1] === "snow") {
          try { localStorage.setItem("pawpack.snow", JSON.stringify({ stage: 24 })); } catch (e) {}
          G.render();
        }
      }, s === undefined ? "" : s);
    } else if (kind === "nest") {
      /* 深巢第 N 层（`nest:7`）。**走真实入口 enterNest** —— 手工拼一个
         关卡对象喂给 loadLevel 也能出图，但那样拍出来的东西和玩家点门
         走的那条路是两套代码，"截图能过、真机是坏的"就是这么来的。 */
      await page.evaluate((arg) => {
        const G = window.GROVE;
        const d = Number(arg);
        if (!Number.isFinite(d) || d < 1) {
          throw new Error(`nest 场景只接层号（1 起的数字），收到 "${arg}"；写作 nest:7`);
        }
        G.enterNest(d);
      }, a.slice(5));
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
