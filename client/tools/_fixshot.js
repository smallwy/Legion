/* ===========================================================================
   2026-10-29 第五轮反馈的"改前 / 改后"对照图
   ---------------------------------------------------------------------------
   这一轮的四条反馈里有三条是**动态**的（球在墙角推不动、碎箱放圈、梯子
   突兀）。单张截图证明不了任何东西，所以这个工具做两件事：

     MODE=ladder  同一个种子、同一层、同一个镜头，改前 / 改后上下对照
                  —— 证明"断梯子"真的没了、坡的形状真的变了；
     MODE=wall    同一套操作（人往右顶着球），按帧抽 3 张排成时间轴
                  —— 改前：球贴在墙上纹丝不动；改后：球被挤回场内。

   跑法：
     NODE_PATH=<workspace>/node_modules node client/tools/_fixshot.js
     BEFORE=<旧版 html> MODE=wall PREFIX=fix-wall node ... 
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600, DT = 1 / 60;
const AFTER = path.join(ROOT, "prototype", "snowlab.html");
const BEFORE = process.env.BEFORE ? path.resolve(process.env.BEFORE) : null;
const MODE = process.env.MODE || "ladder";
const PFX = process.env.PREFIX || ("fix-" + MODE);

/** 装一份原型：独立的 jsdom + 独立画布（两个实例不能共用 ctx）。 */
async function boot(protoPath) {
  const real = createCanvas(W, H);
  const g = real.getContext("2d");
  const html = fs.readFileSync(protoPath, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
  window.requestAnimationFrame = () => 0;
  window.eval(m[1]);
  if (window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));
  try { window.SNOWLAB.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
  catch (e) { window.SNOWLAB.setBackdrop(null); }
  try { window.SNOWLAB.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { /* 走代码图形 */ }
  return { L: window.SNOWLAB, S: window.SNOWLAB.S, real, g, canvas: real };
}

/** 把角色放到第 k 层某个 x 上，跑够帧数让镜头缓动到位，然后出图。 */
function settle(inst, k, x) {
  const { L, S } = inst;
  L.placePlayer(x, L.FLOORS[k] - L.PLAYER_H);
  for (let i = 0; i < 90; i++) L.step(DT);
  S.foes.length = 0; S.shots.length = 0; S.ebullets.length = 0;
  S.showMeter = false; S.showHint = false; S.t = 12;
  return S.cam.y;
}

/* ---------------------------------------------------------------- MODE=ladder
   在**旧版**里找一个"有断梯"的（种子，层，梯子 x），两边用同一个镜头出图。 */
async function modeLadder() {
  const before = await boot(BEFORE || AFTER);
  let pick = null;
  for (let sd = 1; sd < 40 && !pick; sd++) {
    const Lv = before.L.genLevel(sd);
    /* **挑画面中间的梯子。** 贴着墙那根在出图时被裁掉一半，
       看图的人根本分不清"没了"和"被裁了"。 */
    for (const d of Lv.deco) {
      if (d.kind !== "ladder") continue;
      if (d.x < 220 || d.x > 740) continue;
      pick = { sd, k: d.layer, x: d.x };
      break;
    }
  }
  if (!pick) { console.log("旧版里没找到断梯"); return; }
  console.log("断梯：种子 " + pick.sd + " 第 " + (pick.k + 1) + " 层 x=" + pick.x);

  const shots = [];
  for (const [tag, p] of [["改前", BEFORE], ["改后", AFTER]]) {
    const inst = tag === "改前" ? before : await boot(p);
    inst.L.reset(pick.sd);
    settle(inst, pick.k, Math.max(80, Math.min(W - 90, pick.x - 120)));
    inst.L.draw();
    shots.push({ tag, cv: inst.real });
  }
  return shots;
}

/* ---------------------------------------------------------------- MODE=wall
   同一串操作：球放在离右墙 200px，人从左边顶着推 70 帧。
   取第 0 / 14 / 40 帧 —— 改前是"球贴墙不动"，改后是"球被挤回去"。 */
async function modeWall() {
  const shots = [];
  for (const [tag, p] of [["改前", BEFORE], ["改后", AFTER]]) {
    const inst = await boot(p);
    const { L, S } = inst;
    L.reset(3);
    S.boxes.length = 0; S.foes.length = 0;
    const r = L.NUM.ball.baseR + 6 * L.NUM.ball.perAbsorb;
    const b = L.spawnBall(W - 24 - r - 200, L.GROUND_Y - r, 0, 6);
    b.vy = 0;
    L.placePlayer(b.x - 120, L.GROUND_Y - L.PLAYER_H);
    for (let i = 0; i < 40; i++) L.step(DT);          // 镜头落位
    S.showMeter = false; S.showHint = false; S.t = 12;
    const frames = [];
    /* 抽帧的位置有讲究：**必须跨过"挤出去"那一下**。
       取 1/14/40 时球刚滑到墙边，改前改后长得一模一样（第一版就这样）——
       三帧要分别落在"开始推 / 顶住墙 / 已经弹回来"。 */
    for (let i = 0; i < 80; i++) {
      S.keys = { d: true };
      L.step(DT);
      if (i === 0 || i === 34 || i === 74) {
        S.showHint = false;
        L.draw();
        const c = createCanvas(W, H);
        c.getContext("2d").drawImage(inst.real, 0, 0);
        frames.push({ tag, f: i + 1, cv: c, bx: b.x, px: S.p.x });
      }
    }
    S.keys = {};
    shots.push(frames);
  }
  return shots;
}

/* ---------------------------------------------------------------- 拼图 */
function label(g, text, x, y, size, color) {
  g.font = "bold " + size + "px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "rgba(12,18,24,.72)";
  const w = g.measureText(text).width;
  g.fillRect(x - 8, y - size, w + 16, size + 10);
  g.fillStyle = color || "#F6FAFF";
  g.fillText(text, x, y + 2);
}

(async () => {
  if (MODE === "ladder") {
    const shots = await modeLadder();
    if (!shots) return;
    const SW = 640, SH = Math.round(SW * H / W);
    const cv = createCanvas(SW + 24, 96 + (SH + 58) * 2);
    const g = cv.getContext("2d");
    g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
    shots.forEach((s, i) => {
      const y = 96 + i * (SH + 58);
      g.drawImage(s.cv, 12, y, SW, SH);
      g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(12, y, SW, SH);
      label(g, s.tag + (i === 0 ? "：断梯立在坡脚（爬不上去）" : "：断梯已删，坡面有起伏 / 断面往里塌"), 16, y - 8, 17,
        i === 0 ? "#FFB4A2" : "#9BE8A8");
    });
    g.font = "bold 20px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#1B2430";
    g.fillText("梯子没啥用（删掉） + 斜坡太笔直（改成自然轮廓）", 16, 34);
    const out = path.join(OUT, PFX + ".png");
    fs.writeFileSync(out, cv.toBuffer("image/png"));
    console.log("出图 " + out);
    return;
  }

  if (MODE === "wall") {
    const rows = await modeWall();
    const SW = 470, SH = Math.round(SW * H / W);
    const cv = createCanvas(SW * 3 + 40, 96 + (SH + 62) * 2);
    const g = cv.getContext("2d");
    g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
    rows.forEach((frames, ri) => {
      const y = 96 + ri * (SH + 62);
      frames.forEach((fr, ci) => {
        const x = 12 + ci * (SW + 8);
        g.drawImage(fr.cv, x, y, SW, SH);
        g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(x, y, SW, SH);
        label(g, "第 " + fr.f + " 帧", x + 4, y - 6, 14, "#FFE9A8");
        label(g, "球 x=" + Math.round(fr.bx), x + 4, y + SH - 8, 13, "#9FD8FF");
      });
      label(g, frames[0].tag + (ri === 0 ? "：球贴墙 → 推不动（死球）" : "：球贴墙 → 被挤回场内"),
        16, y - 26, 17, ri === 0 ? "#FFB4A2" : "#9BE8A8");
    });
    g.font = "bold 20px 'Microsoft YaHei', sans-serif";
    g.fillStyle = "#1B2430";
    g.fillText("球在最左右推不动（墙角挤球）", 16, 34);
    const out = path.join(OUT, PFX + ".png");
    fs.writeFileSync(out, cv.toBuffer("image/png"));
    console.log("出图 " + out);
  }
})();
