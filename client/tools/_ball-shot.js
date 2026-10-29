/* 「踩球」评审图 —— 2026-10-28 第三轮。

   用户报「没办法站在球上」。改完之后球顶能站人、能借高起跳，
   但这件事**只有图能看出来**：球和脚之间有没有缝、人被球顶到哪儿、
   旁边箱子和球的比例对不对，断言都不管。

   出两张：
     snowlab-ball-stand.png  站在球上（静止）
     snowlab-ball-hold.png   站在球上正往上跳（脚已离球顶，球还在下面）

   跑法：NODE_PATH=<workspace>/node_modules node client/tools/_ball-shot.js
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "prototype", "snowlab.html");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const real = createCanvas(W, H);
const g = real.getContext("2d");

const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = (t) => (t === "2d" ? g : null);
window.requestAnimationFrame = () => 0;
window.eval(m[1]);

/* 离屏工厂：这个工具把 getContext 全指向同一块 ctx，静态层缓存必须另开一块，否则会画到主画布上。 */
if (window.SNOWLAB && window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));

const L = window.SNOWLAB;
const S = L.S;
const DT = 1 / 60;
const SEED = 2;

(async () => {
  /* 背景与宠物贴图：不注入会静默走程序化 / 代码图形，图上"看着也还行"，
     但和真机差一截。加载失败必须吭声。 */
  try {
    L.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg")));
  } catch (e) {
    L.setBackdrop(null);
    console.log("（背景未加载：" + e.message + "）");
  }
  /* 贴图清单走共用入口（主角 + 敌人一起）—— 各抄一段的话，加了敌人贴图
     就会出现"这张图上有、那张没有"，而且不报错。 */
  try {
    const art = await require("./_snowlab-art").loadArt();
    L.setArt(art.map);
  } catch (e) {
    console.log("（贴图未加载：" + e.message + "）");
  }

  /** 把玩家放到第 0 层最宽那段的中部，造一颗球让它落上去，返回球 */
  function setup() {
    L.reset(SEED);
    S.showMeter = false;
    S.showHint = false;   // 「走过去顶它」气泡必压在主角身上
    S.foes.length = 0;
    S.nests.length = 0;
    S.t = 12;
    const segs = L.LAYERS[0].segs.filter((s) => s.w >= 96).sort((a, b) => b.w - a.w);
    const seg = segs[0];
    const x = seg.x + seg.w * 0.5 - S.p.w / 2;
    L.placePlayer(x, L.FLOORS[0] - S.p.h);
    for (let i = 0; i < 40; i++) L.step(DT);
    /* **用 absorbed = 1，也就是"冻住一只怪刚掉出来的那颗"。**
       8 是特大球（半径 44 + 一圈淡蓝光晕），图上看着像个泡泡，
       而玩家 90% 时间踩的是小球 —— 评审图要拍常见情况。 */
    const b = L.spawnBall(x + S.p.w / 2, L.FLOORS[0] - 120, 0, 1);
    for (let i = 0; i < 70; i++) L.step(DT);
    L.placePlayer(x, b.y - b.r - S.p.h - 40);
    S.p.onGround = false;
    for (let i = 0; i < 60; i++) L.step(DT);
    for (let i = 0; i < 60; i++) L.step(DT);   // 镜头缓动到位
    return b;
  }

  /* 出图前清掉飘字与粒子：`once()` 会在开局塞一条「走过去顶它」，
     正好压在主角身上 —— 设计图里那是噪音。 */
  function clearFx() { S.texts.length = 0; S.frags.length = 0; S.rings.length = 0; }

  /* 1) 站着 */
  const b1 = setup();
  clearFx();
  console.log("站球：onBall=" + !!S.p.onBall + " 脚=" + Math.round(S.p.y + S.p.h) + " 球顶=" + Math.round(b1.y - b1.r));
  L.draw();
  fs.writeFileSync(path.join(OUT, "snowlab-ball-stand.png"), real.toBuffer("image/png"));

  /* 2) 起跳后 9 帧 —— 脚已离开球顶，球仍在下面 */
  const b2 = setup();
  S.keys["w"] = true; L.step(DT); delete S.keys["w"];
  for (let i = 0; i < 9; i++) L.step(DT);
  console.log("跳起：脚=" + Math.round(S.p.y + S.p.h) + " 球顶=" + Math.round(b2.y - b2.r) + " vy=" + Math.round(S.p.vy));
  clearFx();
  L.draw();
  fs.writeFileSync(path.join(OUT, "snowlab-ball-hold.png"), real.toBuffer("image/png"));

  console.log("出图完成 → " + OUT);
})();
