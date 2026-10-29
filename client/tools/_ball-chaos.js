/* ===========================================================================
   球"乱弹"的完整回放探针 —— 用真实操作跑一局，事后扫轨迹

   ---------------------------------------------------------------------------
   三次定向构造（撞冰墙 / 卡箱缝 / 墙角来回）都没复现出"乱弹"，说明触发
   条件不在我能想到的那几种几何里。那就不再猜几何，改成**让玩家自己玩**：

   玩家 AI（很朴素，但覆盖真实动作）：朝最近的球走 → 撞它 → 撞完换个方向
   继续 → 每 3 秒跳一次 → 每 1.2 秒朝面向扔一发雪弹。跑 45 秒。

   全程逐帧记录每颗球的 (x, y, vx, vy)，事后用 20 帧滑窗扫：
     · y 方向反转 ≥ 5 次  → 上下弹（这才是"乱弹"最可能的样子）
     · x 方向反转 ≥ 5 次  → 左右弹
   两种都打出来，附上球当时的位置，方便对着关卡图找现场。

   用法：
     NODE_PATH=... node tools/_ball-chaos.js [种子数] [秒数]
   ========================================================================= */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = process.env.PROTO
  ? path.resolve(ROOT, process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");

const html = fs.readFileSync(FILE, "utf8");
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(src);

const L = window.SNOWLAB;
const S = L.S;
const NSEED = Number(process.argv[2] || 4);
const SECS = Number(process.argv[3] || 45);
const DT = 1 / 60;

const reports = [];

for (let sd = 1; sd <= NSEED; sd++) {
  L.newLevel(sd);
  const tracks = new Map();          // ball -> [{fr,x,y,vx,vy}]
  let fr = 0, shotT = 0, jumpT = 0, flipT = 0;
  let dir = 1;

  const total = Math.round(SECS / DT);
  for (; fr < total; fr++) {
    /* ---- 玩家 AI ---- */
    const balls = S.balls.filter(b => !b.dead);
    let target = null, best = 1e9;
    for (const b of balls) {
      const d = Math.abs(b.x - (S.p.x + S.p.w / 2));
      if (d < best) { best = d; target = b; }
    }
    S.keys = {};
    if (target) {
      const dx = target.x - (S.p.x + S.p.w / 2);
      if (Math.abs(dx) > 8) dir = Math.sign(dx);
      S.keys[dir > 0 ? "d" : "a"] = true;
    } else {
      S.keys[dir > 0 ? "d" : "a"] = true;
    }
    flipT += DT;
    if (flipT > 2.5) { flipT = 0; dir = -dir; }        // 定期换个方向，别把球顶死在墙里
    jumpT += DT;
    if (jumpT > 3.0) { jumpT = 0; S.keys["w"] = true; }
    shotT += DT;
    let shooting = false;
    if (shotT > 1.2) { shotT = 0; shooting = true; }

    if (shooting) L.shoot();
    S.p.lockT = 0;                                     // 射击锁会挡住移动，这里手动放开
    L.step(DT);

    for (const b of S.balls) {
      if (!tracks.has(b)) tracks.set(b, []);
      const t = tracks.get(b);
      if (t.length < 4000) t.push({ fr, x: b.x, y: b.y, vx: b.vx, vy: b.vy });
    }
  }

  /* ---- 事后扫窗：20 帧内方向反转次数 ---- */
  let worst = null;
  for (const [, t] of tracks) {
    for (let i = 20; i < t.length; i++) {
      let fy = 0, fx = 0;
      let lastDy = 0, lastDx = 0;
      for (let k = i - 20; k < i; k++) {
        const dy = t[k + 1].y - t[k].y;
        const dx = t[k + 1].x - t[k].x;
        if (Math.abs(dy) > 1.2) { if (lastDy && Math.sign(dy) !== Math.sign(lastDy)) fy++; lastDy = dy; }
        if (Math.abs(dx) > 1.5) { if (lastDx && Math.sign(dx) !== Math.sign(lastDx)) fx++; lastDx = dx; }
      }
      const score = Math.max(fy, fx);
      if (!worst || score > worst.score) {
        worst = { score, fy, fx, at: t[i], fr: t[i].fr };
      }
    }
  }
  reports.push({ sd, worst, nballs: tracks.size });
}

console.log("═══ 球乱弹回放 ═══  " + NSEED + " 关 × " + SECS + " 秒（玩家 AI 自动推球）");
for (const r of reports) {
  const w = r.worst;
  if (!w) { console.log("种子 " + r.sd + "  没出现过球"); continue; }
  console.log("种子 " + String(r.sd).padStart(2) +
    "  共 " + String(r.nballs).padStart(2) + " 颗球 · 最乱的一段：20 帧内 y 反转 " + w.fy +
    " 次 / x 反转 " + w.fx + " 次  @(" + Math.round(w.at.x) + "," + Math.round(w.at.y) +
    ") vx" + Math.round(w.at.vx) + " vy" + Math.round(w.at.vy));
}
