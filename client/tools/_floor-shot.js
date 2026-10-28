/* ===========================================================================
   「楼板半透 / 落球砸箱 / 箱顶推球」四格评审图
   ---------------------------------------------------------------------------
   用户 2026-10-28 第四轮的三条原话：
     ① 「这个横梁我方是可以跳上去的　也可以下来　只要没箱子
        　不需要在空档里才能跳」
     ② 「球掉下去 是可以杂碎箱子」
     ③ 「这种1级平面 球很难撞击到　最好想想机制上去规避」

   **这不是摆拍。** 四格里的人和球都是真跑出来的（按键是真按的、碰撞是真算的），
   只是把时间停在了"最能说明问题"的那一帧。合成场清过箱子 / 怪，
   和 `_snowlab-floor.js` 里的断言用的是同一套试验场做法。

   跑法：NODE_PATH=<workspace>/node_modules node client/tools/_floor-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "prototype", "snowlab.html");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(SRC, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const W = 960, H = 600, DT = 1 / 60;

const frame = createCanvas(W, H);
const g = frame.getContext("2d");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.devicePixelRatio = 1;
window.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
window.requestAnimationFrame = () => 0;
window.eval(m[1]);

const L = window.SNOWLAB;
let S = L.S, NUM = L.NUM;

const keys = () => L.S.keys;
const clearKeys = () => { const k = keys(); for (const x in k) delete k[x]; };
const tap = k => { const K = keys(); K[k] = true; L.step(DT); delete K[k]; };
const settle = n => { for (let i = 0; i < (n || 30); i++) L.step(DT); };
const quiet = () => { S = L.S; S.foes.length = 0; S.nests.length = 0; S.ebullets.length = 0; };

function jumpSpot(sd, k) {
  L.reset(sd); settle(20);
  const lays = L.LAYERS;
  if (k < 1 || k >= lays.length) return null;
  const inner = (segs, x, wd) => segs.some(s => x >= s.x + 24 && x + wd <= s.x + s.w - 24);
  for (let i = 1; i <= 17; i++) {
    const x = i * 48;
    if (inner(lays[k].segs, x, 96) && inner(lays[k - 1].segs, x, 96)) return x;
  }
  return null;
}
/** 干净的试验场：清掉窗口内这一层的箱子和小地形 */
function stage(sd, k, x0, x1) {
  L.reset(sd); S = L.S; settle(20);
  const fl = L.FLOORS[k];
  S.plats = S.plats.filter(p => !(p.kind === 'ramp' && p.x + p.w > x0 && p.x < x1)
    && !(p.h === 34 && p.x + p.w > x0 && p.x < x1 && p.y !== fl));
  for (const b of S.boxes) if (b.x + b.w > x0 - 200 && b.x < x1 + 200 && b.y > fl - 360 && b.y < fl + 40) b.dead = true;
  S.foes.length = 0; S.balls.length = 0;
  return fl;
}
function mkBox(x, y, mat) {
  const b = { x, y, w: 48, h: 48, mat, hp: NUM.box[mat].hp, dead: false, hitT: 0,
    taught: false, fell: 0, frost: false, loot: false, barrel: false };
  S.boxes.push(b); return b;
}
/** 等镜头缓动到位（按层吸附，7/s） */
const cueCam = () => { for (let i = 0; i < 70; i++) L.step(DT); };

const panels = [];
function grab(label, hint) {
  S.showMeter = false;
  S.t = 12;
  L.draw();
  const img = createCanvas(W, H);
  img.getContext("2d").drawImage(frame, 0, 0);
  panels.push({ img, label, hint });
  console.log("  拍好：" + label);
}

(async () => {
  try { L.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
  catch (e) { L.setBackdrop(null); }
  try { L.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { console.log("（贴图未加载）"); }

  /* ---- ① 二段跳穿过楼板：人身体正压在楼板上那一刻 ---- */
  {
    const spot = jumpSpot(3, 1), fl = stage(3, 1, spot - 60, spot + 200);
    quiet(); clearKeys();
    const p = L.S.p;
    L.placePlayer(spot + 1.5, fl - p.h); p.onGround = true;
    settle(40);
    const upY = L.FLOORS[0];
    tap('w'); for (let i = 0; i < 18; i++) L.step(DT); tap('w');
    /* **在"头刚冒出横梁面"那一帧停。** 落点在楼板顶（feet == upY）和
       站住是同一帧，所以"穿过去"根本不存在中间态 —— 能拍的只有
       "身子还在梁下面、头已经上来了"这一帧，那才是"穿"的读法。 */
    for (let i = 0; i < 40; i++) {
      L.step(DT);
      if (!p.onGround && p.y <= upY - 16) break;
    }
    console.log("  ① 穿楼板：upY=" + upY + " 头顶=" + p.y.toFixed(1) + " 脚底=" + (p.y + p.h).toFixed(1) + " onG=" + p.onGround);
    grab("① 楼板是半透的：从下面二段跳直接穿上横梁", "没箱子就能上，站住后按 S 原路下来");
  }

  /* ---- ② 站在横梁（楼板）顶上 ---- */
  {
    const spot = jumpSpot(3, 1), fl = stage(3, 1, spot - 60, spot + 200);
    quiet(); clearKeys();
    const p = L.S.p;
    L.placePlayer(spot + 1.5, fl - p.h); p.onGround = true;
    settle(40);
    tap('w'); for (let i = 0; i < 18; i++) L.step(DT); tap('w');
    settle(60);
    settle(20);
    console.log("  ② 站横梁：脚底=" + (p.y + p.h).toFixed(1) + " 楼上地板=" + L.FLOORS[0]);
    grab("② 上去之后站得稳，脚下就是横梁面", "这一格没摞箱子 —— 摞了箱子就只剩 63px 净空（断言守着）");
  }

  /* ---- ③ 球从上层掉下来，连碎箱堆 ---- */
  {
    const fl = stage(3, 0, 60, 900);
    const x = 380;
    const stack = [mkBox(x, fl - 48, 'wood'), mkBox(x, fl - 96, 'wood'),
                   mkBox(x, fl - 144, 'wood'), mkBox(x, fl - 192, 'wood')];
    quiet(); clearKeys();
    const p = L.S.p;
    L.placePlayer(x - 220, fl - p.h); p.onGround = true;
    settle(40);
    const b = L.spawnBall(x + 24, fl - 430, 0, 6);
    b.vy = 0;
    /* **拍"连碎到一半"那一刻。** 等碎完再拍就只剩一堆碎片和一个空位，
       看不出"一球犁穿一摞"；只等第一口碎（第一版这么写）又只碎了 1 口。 */
    let after = -1;
    for (let i = 0; i < 140; i++) {
      L.step(DT);
      if (b.chain >= 2 && after < 0) after = i;
      if (after >= 0 && i - after >= 5) break;
    }
    console.log("  ③ 落砸：剩 " + stack.filter(o => !o.dead).length + "/4 口，chain=" + b.chain);
    grab("③ 球从上层掉下来，一路把箱堆犁穿", "vy 够大 = 落砸；球在箱顶上滚不算（那是「滚」不是「砸」）");
  }

  /* ---- ④ 站在一格矮箱顶上，把球推向对面的箱子 ---- */
  {
    const fl = stage(3, 0, 60, 900);
    const x = 200;
    mkBox(x, fl - 48, 'wood');
    const target = mkBox(x + 300, fl - 48, 'wood');
    const target2 = mkBox(x + 300, fl - 96, 'wood');
    quiet(); clearKeys();
    const p = L.S.p;
    L.placePlayer(x + 2, fl - 48 - p.h); p.onGround = true;
    const ball = L.spawnBall(x + 120, fl - 22, 0, 2);
    settle(20);
    keys()['d'] = true;
    let frames = 0;
    for (let i = 0; i < 160; i++) {
      L.step(DT);
      if (target.dead) { S.rings.length && frames++; }
      if (frames >= 5) break;
    }
    clearKeys();
    console.log("  ④ 推球：人站在矮箱顶，球到 " + ball.x.toFixed(0) + "，目标 " +
      (target.dead ? "已碎" : "未碎") + " / 上层 " + (target2.dead ? "已碎" : "未碎"));
    grab("④ 站在一格箱顶上也能推球 —— 推出去的球照样撞碎箱子", "旧判据用包围盒：人比球顶高 4px 就推不动（1 级平面上最常见的站位）");
  }

  /* ---- 拼图：2 列 × 2 行，每格下面一条说明 ---- */
  const PAD = 16, BAR = 46;
  const cw = W, ch = H + BAR;
  const out = createCanvas(PAD + (cw + PAD) * 2, PAD + (ch + PAD) * 2);
  const o = out.getContext("2d");
  o.fillStyle = "#F5F7F9";
  o.fillRect(0, 0, out.width, out.height);
  panels.forEach((pn, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x0 = PAD + col * (cw + PAD), y0 = PAD + row * (ch + PAD);
    o.drawImage(pn.img, x0, y0);
    o.fillStyle = "#1B2430";
    o.font = "bold 20px 'Microsoft YaHei', sans-serif";
    o.fillText(pn.label, x0 + 4, y0 + H + 24);
    o.fillStyle = "#5B6B7B";
    o.font = "15px 'Microsoft YaHei', sans-serif";
    o.fillText(pn.hint, x0 + 4, y0 + H + 42);
    o.strokeStyle = "#C9D4DE"; o.lineWidth = 2;
    o.strokeRect(x0 + 1, y0 + 1, cw - 2, H - 2);
  });
  const file = path.join(OUT, "snowlab-floor-4up.png");
  fs.writeFileSync(file, out.toBuffer("image/png"));
  console.log("\n出图 " + file + "（" + out.width + "×" + out.height + "）");
})().catch(e => { console.error("出图失败：" + e.stack); process.exit(1); });
