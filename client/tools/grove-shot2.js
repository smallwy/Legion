/* ============================================================================
   grove.html 真浏览器截图（playwright）
   ----------------------------------------------------------------------------
   走真 Chromium：字体、圆角、渐变、setLineDash 都是真的，
   看到什么就是玩家看到什么。

   这一版要验证三件事，所以截图分三组：
     · 八关各一张 —— 每关是**不同的场地**，不逐关截看不出布局差异
     · 六把武器各一张 —— 溜溜球 / 镰刀 / 影分身这些必须能看见
     · 结算一张 —— 推关的衔接全在这儿

   运行：
     NODE_PATH=C:/Users/汪宇/.workbuddy/binaries/node/workspace/node_modules \
       node grove-shot2.js
   ========================================================================== */

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const HTML = "file:///" + path.join(__dirname, "..", "prototype", "grove.html").replace(/\\/g, "/");
const OUT = path.join(__dirname, "..", "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 660 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.log("  !! 页面报错: " + e.message));
  await page.goto(HTML);
  await sleep(400);

  async function shot(name) {
    const file = path.join(OUT, name);
    await page.screenshot({ path: file });
    console.log("  " + file);
  }

  // 1. 选人
  await page.mouse.move(500, 260);
  await sleep(120);
  await shot("grove-01-选人.png");

  // 2. 第 1 关开场
  await page.keyboard.press("Digit1");
  await sleep(700);
  await shot("grove-02-第1关-苔原入口.png");

  // 3. 预瞄线：造一颗球停在地上，左右两条预测线会自动出现
  await page.evaluate(() => {
    const { S } = window.GROVE;
    S.texts.length = 0;
    const f = S.foes.find(f => !f.dead);
    window.GROVE.coatFoe(f, 3);
    const b = S.balls[0];
    b.x = 300; b.y = 462; b.vx = 0; b.vy = 0; b.onGround = true;
    S.p.x = 250; S.p.y = 462;
  });
  await sleep(320);
  await shot("grove-03-预瞄线.png");

  // 4~11. 八关各一张
  const levels = [
    [1, "grove-04-第2关-泥沼.png", 460, 462],
    [2, "grove-05-第3关-断崖.png", 300, 462],
    [3, "grove-06-第4关-缓坡.png", 440, 462],
    [4, "grove-07-第5关-弹跳林.png", 380, 462],
    [5, "grove-08-第6关-深井.png", 200, 462],
    [6, "grove-09-第7关-阶梯塔.png", 400, 462],
    [7, "grove-10-第8关-双塔.png", 180, 462],
  ];
  for (const [idx, name, bx, by] of levels) {
    await page.evaluate((i) => window.GROVE._start(2, i), idx);
    await sleep(420);
    await page.evaluate(({ bx, by }) => {
      const { S } = window.GROVE;
      S.texts.length = 0;
      S.foes.forEach((f, k) => { if (k % 2 === 0) f.coat = k % 3 === 0 ? 1 : 2; });
      const f = S.foes.find(x => !x.dead && x.coat === 0);
      if (f) {
        window.GROVE.coatFoe(f, 3);
        const b = S.balls[0];
        if (b) { b.x = bx; b.y = by; b.vx = 0; b.vy = 0; b.onGround = true; }
      }
    }, { bx, by });
    await sleep(300);
    await shot(name);
  }

  // 12~14. 武器手感：挑三个形状最不一样的，各截一张
  const skills = [
    [0, "grove-11-武器-溜溜球.png", 0.22],
    [4, "grove-12-武器-飞刀.png", 0.13],
    [5, "grove-13-武器-影分身.png", 0.30],
  ];
  for (const [hero, name, wait] of skills) {
    await page.evaluate((h) => {
      const P = window.GROVE, S = P.S;
      P._start(h, 0);
      S.p.x = 420; S.p.y = 462; S.p.face = 1;
      S.foes.forEach(f => { f.x = 2000; });
      P.HEROES[h].fire(S.p);
    }, hero);
    await sleep(wait * 1000);
    await shot(name);
  }

  // 14. BOSS：第 8 关的最后一波，lv5
  await page.evaluate(() => {
    const P = window.GROVE, S = P.S;
    P._start(0, 7);
    S.foes.length = 0;
    S.balls.length = 0;
    S.texts.length = 0;
    S.wave = P.WAVES.length - 1;
    S.foes.push(P.foeFromSpec({ foe: "boss", x: 340, y: -140, lv: 3 }, true));
  });
  await sleep(1050);
  await page.evaluate(() => {
    const { S } = window.GROVE;
    const b = S.foes.find(f => f.isBoss);
    if (b) { b.coat = 4; b.slamT = 999; }      // 糊了 4 层，先别砸
    S.texts.length = 0;
  });
  await sleep(220);
  await shot("grove-14-BOSS.png");

  // 15. BOSS 砸地：抬手的最高点 + 贴地冲击波
  await page.evaluate(() => {
    const { S } = window.GROVE;
    const b = S.foes.find(f => f.isBoss);
    if (b) { b.slamT = 999; b.slamming = 0.42; }
    S.shocks.length = 0;
    S.shocks.push({ x: 560, y: 556, t: 0.06, life: 0.62, dir: 1 });
    S.shocks.push({ x: 840, y: 556, t: 0.20, life: 0.62, dir: -1 });
    S.texts.length = 0;
  });
  await sleep(120);
  await shot("grove-15-BOSS砸地.png");

  // 16. 波次预告：下一波刷新前 1 秒，地上会先画圈
  await page.evaluate(() => {
    const P = window.GROVE, S = P.S;
    P._start(0, 1);
    S.foes.length = 0;
    S.wave = 0;
    S.waveT = 9;
    S.waveGap = 0.9;
    S.texts.length = 0;
  });
  await sleep(240);
  await shot("grove-16-波次预告.png");

  // 17. 宝箱：连着几个人一起烧掉才掉，所以直接摆一颗在火坑边上
  await page.evaluate(() => {
    const P = window.GROVE, S = P.S;
    P._start(1, 1);
    S.p.x = 700; S.p.y = 462;
    S.drops.push({ kind: "chest", x: 620, y: 440, vx: 0, vy: 0, taken: false, t: 0, spin: 0.4, holds: 3 });
    S.drops.push({ kind: "gem",   x: 548, y: 452, vx: 0, vy: 0, taken: false, t: 0, spin: 0.2 });
    S.texts.length = 0;
  });
  await sleep(520);
  await shot("grove-17-宝箱.png");

  // 18. 结算
  await page.evaluate(() => {
    const { S } = window.GROVE;
    window.GROVE._start(0, 4);
    S.killed = S.total;
    S.stat.made = 6;
    S.playT = 47.2;
    S.food = 22;
    S.clearT = 0.8;
    S.phase = "clear";
    S.best[4] = "S";
  });
  await sleep(280);
  await shot("grove-18-结算.png");

  await browser.close();
  console.log("\n完成");
})();
