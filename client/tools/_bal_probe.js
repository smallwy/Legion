/**
 * 森林觅食 · 难度采样（CR-021：全自动战斗）
 *
 * 战斗改成全自动之后，"会不会选招"不再是变量 —— 那是代码决定的。
 * 所以这里只对比**玩家真正能决定的三件事**：
 *   1. 带几只
 *   2. 谁站前排（全自动下唯一的战斗内决策）
 *   3. 喂不喂、路上吃不吃
 *
 * 跑法：node tools/forest-balance.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "forest.html");

const noop = () => {};
function makeCtx() {
  return {
    canvas: null, fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1,
    font: "", textAlign: "", textBaseline: "", globalCompositeOperation: "source-over",
    lineCap: "butt", lineJoin: "miter",
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, setTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, arcTo: noop, ellipse: noop, rect: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop,
    fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop,
    setLineDash: noop, getLineDash: () => [],
    measureText: t => ({ width: String(t).length * 7 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    drawImage: noop,
  };
}
function makeCanvas(w, h) {
  const c = { width: w || 0, height: h || 0, style: {} };
  const cx = makeCtx();
  cx.canvas = c;
  c.getContext = () => cx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 600 });
  c.addEventListener = noop;
  return c;
}
function makeImg() {
  const im = { width: 0, height: 0, onload: null, onerror: null };
  let s = "";
  Object.defineProperty(im, "src", {
    get: () => s,
    set(v) { s = v; im.width = 32; im.height = 32; if (im.onload) im.onload(); },
  });
  return im;
}

const sandbox = {
  console, Math, Date, JSON, String, Number, Array, Object, Boolean, isNaN, Set,
  Image: makeImg,
  document: {
    getElementById: () => makeCanvas(960, 600),
    createElement: () => makeCanvas(0, 0),
  },
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  addEventListener: noop,
  innerWidth: 1280, innerHeight: 800,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*)<\/script>/)[1],
  sandbox,
  { filename: "forest.html" }
);

const P = sandbox.PAWPACK;
const S = P._S;
const PET = P._PET_DEFS;
const DT = 1 / 60;

const HP = id => (PET.find(p => p.id === id) || {}).hp || 0;

/* ---------------- 站位策略 ---------------- */

/**
 * 把编队落成 6 格。
 * 索引 = row*2+col，列 1 是前排（靠敌方）—— 和游戏里同一套编号。
 * 前两只放前排，其余填后排。
 */
function formation(ids, mode) {
  const front = ids.slice();
  if (mode === "tank") front.sort((a, b) => HP(b) - HP(a));          // 血厚的顶前面
  else if (mode === "squishy") front.sort((a, b) => HP(a) - HP(b));  // 脆皮顶前面（反例）

  const slots = [null, null, null, null, null, null];
  slots[1] = front[0] || null;
  slots[3] = front[1] || null;

  let k = 2;
  for (let i = 0; i < 6 && k < front.length; i++) {
    if (slots[i]) continue;
    slots[i] = front[k++];
  }
  return slots;
}

/* ---------------- 跑一局 ---------------- */

function playOne(party, opt) {
  P._reset();
  P._setParty(party);
  S.slots = formation(party, opt.formation || "order");
  if (opt.fed) for (const id of party) P._setFed(id, true);
  S.food = opt.food === undefined ? 6 : opt.food;

  let seed = 12345 + party.length * 7;
  S.rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  P._startRun();

  let guard = 0;
  let maxDepth = 1;

  while (S.phase !== "result" && guard++ < 400000) {
    if (S.phase === "battle") {
      maxDepth = Math.max(maxDepth, S.depth);
      P._tick(DT);
    } else if (S.phase === "trail") {
      const hpK = S.pets.reduce((a, p) => a + Math.max(0, p.hp), 0) /
                  Math.max(1, S.pets.reduce((a, p) => a + p.maxHp, 0));
      if (opt.smart) {
        // 血低了先开饭（吃得起才吃），吃不上又太低就撤
        if (hpK < 0.58 && !S.ateThisTrail && S.carried + S.food >= 3 && S.depth < 5) {
          if (P._eatNow()) continue;
        }
        if (hpK < 0.28 && S.depth >= 2) { P._retreat(); continue; }
      }
      P._goDeeper();
    } else break;
  }

  return {
    result: S.result,
    depth: maxDepth,
    food: S.food + S.carried,
    casts: S.castCount || 0,
  };
}

void 0; const sample = (party, opt, n) => {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(playOne(party, opt));
  return rows;
};

/* ---------------- 输出 ---------------- */

const ALL5 = ["cat", "dog", "ham", "rab", "duck"];

const CONFIGS = [
  ["5 只 · 顺序站位", ALL5, { formation: "order", smart: true }],
  ["5 只 · 坦克在前", ALL5, { formation: "tank", smart: true }],
  ["5 只 · 脆皮在前", ALL5, { formation: "squishy", smart: true }],
  ["5 只 · 坦克在前 + 喂", ALL5, { formation: "tank", smart: true, fed: true }],
  ["4 只 · 坦克在前", ["cat", "dog", "ham", "rab"], { formation: "tank", smart: true }],
  ["3 只 · 坦克在前", ["cat", "dog", "ham"], { formation: "tank", smart: true }],
  ["单猫单刷", ["cat"], { formation: "tank", smart: true }],
  ["4 只 · 无治疗位", ["cat", "dog", "ham", "duck"], { formation: "tank", smart: true }],
  ["5 只 · 不吃饭硬冲", ALL5, { formation: "tank", smart: false }],
];

const N = 40;
const width = s => {
  let w = 0;
  for (const ch of String(s)) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  return w;
};
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));

console.log(`每格 ${N} 局，伪随机按局号固定\n`);
console.log(pad("配置", 24) + pad("通关", 8) + pad("团灭", 8) +
            pad("到第5层", 12) + pad("出手", 8) + "带回食物");
console.log("-".repeat(80));


module.exports={playOne,S,P};