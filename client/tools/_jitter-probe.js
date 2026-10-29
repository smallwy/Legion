/* 量敌人"上下抖"—— 目标是**不靠跳跃也会抖的那一类**。

   为什么单独造一个（`_foe-bounce.js` 已经存在）：
   `_foe-bounce` 只数两种动作 —— 真跳（离地且 vy < 0）和蹭坎（站着把 y 抬上去）。
   2026-10-29 用户第二次反馈「一直在弹弹弹」，我把那只怪逐帧抓下来才发现：
   **它 x 一动不动、tryN 全程 0、一次都没起跳**，y 却在 931↔949 之间以 10Hz 往返。
   那是 `stepBody` 水平碰撞里的「台阶助步」把人抬上去、重心不在那块上又掉回来，
   每帧重复。两种动作都不算，所以旧探针报"0 连弹"，画面里却在弹。

   口径：**y 的方向反转次数**。
   正常走路 y 只在重力下单向增大、落地后持平，反转极少；
   真跳是 1 次上 + 1 次下的完整抛物线（周期 ~30 帧），也不算抖；
   抖是"1 秒内反转 8 次以上"。同时单独标出这一段里有没有起跳，
   好区分「跳来跳去」和「根本没跳，是碰撞在推」。

   用法：
     node tools/_jitter-probe.js [秒数] [种子...]
     PROTO=D:/path/other.html  换一份 html 做对照   OUT=... 存原始数据

   注意：`_start(hero, stage)` 是两个参数，这里不碰它，直接 newLevel。
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const FILE = process.env.PROTO || path.join(ROOT, "prototype", "snowlab.html");

const html = fs.readFileSync(FILE, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("找不到脚本块");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
/* 只要物理和 AI，不要绘制 —— getContext 返 null 让绘制路径自己早退 */
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);

const L = window.SNOWLAB;
const S = L.S;

const DT = 1 / 60;
const SECS = Number(process.argv[2] || 20);
const seeds = process.argv.slice(3).map(Number);
if (!seeds.length) seeds.push(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20);

const FRAMES = Math.round(SECS * 60);
/* 一秒窗口里 y 方向反转这么多次就算在抖。
   真跳一次抛物线只有 2 次反转（顶点一次、落地一次），远低于 8。 */
const REV_LIMIT = 8;

const keyOf = f => Math.round(f.homeX) + ":" + Math.round(f.homeY) + ":" + f.breed;

let grand = { jitter: 0, worst: 0, worstAt: null, jumpedInJitter: 0 };
const rows = [];

for (const seed of seeds) {
  L.newLevel(seed);

  const track = new Map();
  for (const f of S.foes) {
    track.set(keyOf(f), {
      f, breed: f.breed,
      /* 滑窗：只留最近 60 帧 */
      ys: [], dys: [], revs: [],
      revTotal: 0, prevDy: 0,
      jitterSpans: 0, maxRev: 0, maxRevAmp: 0, maxRevAt: null,
      jumpedInWindow: false, jumpInJitter: 0,
    });
  }

  for (let fr = 0; fr < FRAMES; fr++) {
    L.step(DT);
    for (const f of S.foes) {
      const t = track.get(keyOf(f));
      if (!t) continue;
      const p = t.ys.length ? t.ys[t.ys.length - 1] : f.y;
      const dy = f.y - p;

      t.ys.push(f.y);
      t.dys.push(dy);

      /* 方向反转：只有幅度 > 0.15px 的位移才算一个方向，
         否则浮点噪声会让静止的怪也"反转"上千次。 */
      const dir = dy > 0.15 ? 1 : (dy < -0.15 ? -1 : 0);
      if (dir !== 0) {
        if (t.prevDy !== 0 && dir !== t.prevDy) {
          t.revs.push({ at: t.ys.length - 1, y: f.y });
          t.revTotal++;
        }
        t.prevDy = dir;
      }
      if (!f.onGround && f.vy < -80) t.jumpedInWindow = true;

      if (t.ys.length > 60) {
        const dropY = t.ys.shift();
        t.dys.shift();
        const dropR = t.revs.length && t.revs[0].at === 0;
        if (dropR) t.revs.shift();
        if (dropY === undefined) { /* noop */ }
      }

      /* 每秒结算一次 */
      if ((fr + 1) % 60 === 0) {
        const n = t.revs.length;
        if (n >= REV_LIMIT) {
          const ys = t.ys;
          const amp = Math.max(...ys) - Math.min(...ys);
          t.jitterSpans++;
          if (n > t.maxRev) {
            t.maxRev = n; t.maxRevAmp = amp;
            t.maxRevAt = { x: f.x, y: f.y };
            t.jumpInJitter = t.jumpedInWindow ? 1 : 0;
          }
          if (t.jumpedInWindow) grand.jumpedInJitter++;
        }
        t.revs = [];
        t.jumpedInWindow = false;
      }
    }
  }

  for (const t of track.values()) {
    if (!t.jitterSpans) continue;
    grand.jitter++;
    if (t.maxRev > grand.worst) {
      grand.worst = t.maxRev;
      grand.worstAt = { seed, breed: t.breed, ...t.maxRevAt };
    }
    rows.push({ seed, breed: t.breed, spans: t.jitterSpans, rev: t.maxRev, amp: t.maxRevAmp, jumped: t.jumpInJitter, at: t.maxRevAt });
  }
}

console.log(`文件 ${path.basename(FILE)} · ${SECS} 秒 × ${seeds.length} 关 · 抖动判据 = 1 秒内 y 反转 ≥ ${REV_LIMIT} 次\n`);

if (!rows.length) {
  console.log("✓ 没有一只怪在非跳跃状态下上下抖");
} else {
  rows.sort((a, b) => b.rev - a.rev);
  console.log("有抖动的怪（按严重程度）：");
  for (const r of rows.slice(0, 14)) {
    console.log(
      "  种子" + String(r.seed).padStart(3) + "  " + r.breed.padEnd(5) +
      "  抖 " + String(r.spans).padStart(2) + " 秒" +
      "  最密 " + String(r.rev).padStart(3) + " 次/秒" +
      "  幅 " + String(Math.round(r.amp)).padStart(3) + "px" +
      (r.jumped ? "  [夹着跳]" : "  [全程没起跳]") +
      "  @" + Math.round(r.at.x) + "," + Math.round(r.at.y)
    );
  }
}

console.log(
  "\n合计：抖动怪 " + grand.jitter + " 只 · 最密 " + grand.worst + " 次/秒" +
  (grand.worstAt ? "（种子" + grand.worstAt.seed + " " + grand.worstAt.breed + "）" : "") +
  " · 抖动窗口里夹着起跳的 " + grand.jumpedInJitter + " 次"
);
process.exit(grand.jitter > 0 ? 1 : 0);
