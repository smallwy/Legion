/* ============================================================================
   _battle-mount-smoke.js —— 「点出发之后还黑不黑」

   这不是玩法冒烟（那是 grove-smoke.js），只回答一件事：
   **Battle 场景里挂上 GroveBattle 之后，DOM 层到底有没有画面。**

   为什么要单独造：2026-10-30 的黑屏是 `import { setSnowlabEntry }` 指向
   一个没 export 的函数 —— ESM 在链接阶段就抛，`addComponent(GroveBattle)`
   拿到 undefined，一台相机都没建。这一类错误**语法检查、玩法断言、
   离屏出图全都看不见**（它们跑的是原型代码或生成物内部，不跨模块解析）。

   做法：把 GroveBattle / GroveRuntime / BattleSwitch 转译成 CJS，
   配一层 cc 桩 + 一块真画布（@napi-rs/canvas），照组件的真实顺序
   （onLoad → update × N）跑一遍，然后**数画布上的颜色种类**。
   纯色 = 黑屏，有内容 = 挂载成功。

   用法：node tools/_battle-mount-smoke.js
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

function req(name, absDir) {
  try { return require(name); } catch (e) {
    if (!absDir) throw e;
    return require(absDir);
  }
}
const ts = req("typescript",
  "C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tools/_gb-build");
const W = 960, H = 600;

/* ---------- ① 转译 ---------- */
function transpile(absIn, relOut) {
  const src = fs.readFileSync(absIn, "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  const errs = (out.diagnostics || []).filter((d) => d.category === 1);
  if (errs.length) {
    for (const e of errs) console.error(ts.flattenDiagnosticMessageText(e.messageText, "\n"));
    throw new Error(path.basename(absIn) + " 有语法错误");
  }
  fs.mkdirSync(path.dirname(relOut), { recursive: true });
  fs.writeFileSync(relOut, out.outputText);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

transpile(path.join(ROOT, "assets/scripts/grove/GroveRuntime.ts"), path.join(OUT, "grove/GroveRuntime.js"));
transpile(path.join(ROOT, "assets/scripts/grove/GroveBattle.ts"), path.join(OUT, "grove/GroveBattle.js"));
transpile(path.join(ROOT, "assets/scripts/BattleSwitch.ts"), path.join(OUT, "BattleSwitch.js"));
/* 推球那一套也编：出征页第三扇门会换手过去，这条路不验就是"修好了门厅、
   门后面黑着"。SnowlabBattle 的依赖很少（只有 SnowlabRuntime + BattleSwitch）。 */
transpile(path.join(ROOT, "assets/scripts/snowlab/SnowlabRuntime.ts"), path.join(OUT, "snowlab/SnowlabRuntime.js"));
/* SnowlabRuntime 还 import 了 ./SnowlabArt（美术清单）。漏了的话
   require 直接 MODULE_NOT_FOUND —— 报错在转译产物里，指不到真凶。 */
transpile(path.join(ROOT, "assets/scripts/snowlab/SnowlabArt.ts"), path.join(OUT, "snowlab/SnowlabArt.js"));
transpile(path.join(ROOT, "assets/scripts/snowlab/SnowlabBattle.ts"), path.join(OUT, "snowlab/SnowlabBattle.js"));

/* config 层（SaveData / Roster / HomeBiz / BattleConfig）**现场转译**。
   原来这里拷 `tools/_rt-build/config/*.js`，结果拿到的是 10-23 的旧产物 ——
   Roster.ts 10-27 才加的 `heroIndexOf` 在那里根本不存在，冒烟报
   "heroIndexOf is not a function"，看起来像产品代码坏了，实际是产物过期。
   **过期产物不报错**是这个项目栽过多次的坑，所以这里不留缓存可选项。 */
const SRC_CONFIG = path.join(ROOT, "assets/scripts/config");
const CFG_OUT = path.join(OUT, "config");
fs.mkdirSync(CFG_OUT, { recursive: true });
for (const f of fs.readdirSync(SRC_CONFIG)) {
  if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
  transpile(path.join(SRC_CONFIG, f), path.join(CFG_OUT, f.replace(/\.ts$/, ".js")));
}

/* ---------- ② cc 桩 ---------- */
fs.mkdirSync(path.join(OUT, "node_modules/cc"), { recursive: true });
fs.writeFileSync(path.join(OUT, "node_modules/cc/package.json"),
  JSON.stringify({ name: "cc", version: "0.0.0", main: "index.js" }));
fs.writeFileSync(path.join(OUT, "node_modules/cc/index.js"), `
const _decorator = { ccclass: () => (c) => c, property: () => () => {} };

let _uid = 0;
class Node {
  constructor(name) {
    this.name = name || ('Node' + (++_uid));
    this.children = [];
    this.components = [];
    this.parent = null;
    this.active = true;
    this.isValid = true;
  }
  addChild(n) { n.parent = this; this.children.push(n); return n; }
  addComponent(C) {
    const inst = new C();
    inst.node = this;
    this.components.push(inst);
    if (typeof inst.onLoad === 'function') inst.onLoad();
    return inst;
  }
  getComponent(C) { return this.components.find((c) => c instanceof C) || null; }
  setPosition() {}
  setWorldPosition() {}
  destroy() {
    this.isValid = false;
    /* 真引擎是延迟销毁；这里同步标记 invalid + 立刻回调 onDestroy，
       因为冒烟要验的是"拆干净了没有"，不是销毁时机。 */
    for (const c of this.components) if (typeof c.onDestroy === 'function') c.onDestroy();
    return true;
  }
}

class Component {
  constructor() { this.node = new Node('Component'); this.isValid = true; }
  destroy() { this.isValid = false; if (typeof this.onDestroy === 'function') this.onDestroy(); return true; }
}

class Camera {
  constructor() { this.node = null; this.orthoHeight = 0; this.visibility = 0; }
}
Camera.ProjectionType = { ORTHO: 0, PERSPECTIVE: 1 };
Camera.ClearFlag = { SOLID_COLOR: 7, DEPTH_ONLY: 6, DONT_CLEAR: 0 };

class Color { constructor(r, g, b, a) { this.r = r; this.g = g; this.b = b; this.a = a; } }
class SceneAsset { constructor() { this.scene = {}; } }
class ImageAsset { constructor(o) { Object.assign(this, o || {}); } }

/* 美术图**默认全部失败**：黑屏不该依赖图到没到 —— 没图时运行时应当
   回退代码图形。真实环境里图是异步的，第一帧一定是没图的。

   ART=1（环境变量）改成**真读磁盘**。为什么需要这个开关：出征页收成一扇门之后
   卡片是 840×420、名字 34px，这些数字必须落在真立绘（夜空、雪地、草地）
   上才看得出对不对 —— 回退的代码图形没有那些亮暗，文字对比度是假的。
   **只影响出图，不影响断言**："画布不是纯色"两种模式下都成立。 */
/* 这个桩是**单独的文件**（tools/_gb-build/node_modules/cc/index.js），
   它自己看不见 _battle-mount-smoke.js 里的 path 和 __dirname。
   相对层级：cc -> node_modules -> _gb-build -> tools -> client，上四级。 */
const ART_DIR = require("path").join(__dirname, "..", "..", "..", "..", "assets", "resources");
const resources = {
  load(p, t, cb) {
    if (process.env.ART !== "1") {
      setImmediate(() => cb(new Error("smoke: 不加载美术图 " + p), null));
      return;
    }
    setImmediate(() => {
      /* **loadImage 返回的是 Promise，不是 Image。** 直接取 .width 得到
         undefined —— 于是 GroveBattle._toDrawable 判"取不到可绘制数据"，
         返回 null，一张图都注不进 ART，画面回到代码图形，
         而"加载成功"这条日志一条不少。第一版就是这么栽的。
         另外注入用的字段必须是 data（_toDrawable 读的就是它），不是 image。 */
      require("@napi-rs/canvas").loadImage(ART_DIR + "/" + p + ".png")
        .then((img) => cb(null, new ImageAsset({ data: img, width: img.width, height: img.height })))
        .catch((e) => cb(e, null));
    });
  },
};

const director = {
  runScene() {}, loadScene(n, cb) { if (cb) cb(null); },
  on() {}, once() {}, off() {},
  getScene() { return null; },
};
director.EVENT_AFTER_SCENE_LAUNCH = 'launch';
director.EVENT_BEFORE_UPDATE = 'bu';

const assetManager = { loadAny(u, cb) { setImmediate(() => cb(new Error('smoke'), null)); } };

const input = { on() {}, off() {} };
const Input = { EventType: { KEY_DOWN: 'keydown', KEY_UP: 'keyup' } };
const KeyCode = {
  ARROW_LEFT: 37, ARROW_RIGHT: 39, ARROW_UP: 38, ARROW_DOWN: 40,
  KEY_A: 65, KEY_D: 68, KEY_W: 87, KEY_S: 83, SPACE: 32,
  KEY_J: 74, KEY_K: 75,
};

module.exports = {
  _decorator, Node, Component, Camera, Color, SceneAsset, ImageAsset,
  resources, director, assetManager, input, Input, KeyCode,
};
`);

/* ---------- ③ 浏览器桩 ---------- */
const main = createCanvas(W, H);
const bodies = [];

globalThis.localStorage = (() => {
  const mem = {};
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
  };
})();

globalThis.document = {
  /* Cocos 页面里没有 preview 的那几个 div —— 如实 null */
  getElementById: (id) => {
    const st = bodies.find((b) => b.id === id);
    return st || null;
  },
  createElement: (tag) => {
    if (tag === "canvas") {
      const c = createCanvas(W, H);
      c.style = {};
      /* @napi-rs/canvas 的 Canvas **没有** addEventListener（浏览器有）。
         GroveBattle._bindPointer 会往上挂 pointermove/pointerdown ——
         不补这两个空函数，冒烟会报 "cv.addEventListener is not a function"，
         看起来像产品代码的 bug，其实是桩不够（真实浏览器里这条一定存在）。 */
      c.addEventListener = () => {};
      c.removeEventListener = () => {};
      c.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
      return c;
    }
    const el = {
      tagName: String(tag).toUpperCase(), id: "", style: {}, children: [],
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { c.parentNode = null; return c; },
      addEventListener() {},
    };
    return el;
  },
  body: {
    appendChild(el) { bodies.push(el); el.parentNode = this; return el; },
    removeChild(el) {
      const i = bodies.indexOf(el);
      if (i >= 0) bodies.splice(i, 1);
      el.parentNode = null;
    },
    addEventListener() {},
  },
  addEventListener() {},
};

globalThis.location = { search: "", href: "http://localhost/", hash: "" };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.window = globalThis;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 800;
globalThis.requestAnimationFrame = () => 0;
globalThis.devicePixelRatio = 1;
globalThis.Image = class { constructor() { this.width = 0; this.height = 0; } set src(_) {} };

/* ---------- ④ 跑 ---------- */

let failed = 0;
const ck = (name, ok, extra) => {
  if (!ok) failed++;
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (extra === undefined ? "" : "   " + extra));
};

(async () => {
  console.log("=== ① 挂 GroveBattle（和 BattleBoot 一样：BattleRoot.addComponent）===");

  const cc = require(path.join(OUT, "node_modules/cc/index.js"));
  const { GroveBattle } = require(path.join(OUT, "grove/GroveBattle.js"));
  const { groveBoot, GROVE } = require(path.join(OUT, "grove/GroveRuntime.js"));

  ck("GroveBattle 是个类（import 解析成功）", typeof GroveBattle === "function");
  if (typeof GroveBattle !== "function") {
    console.log("\n✗ 模块根本没加载出来 —— 这就是黑屏");
    process.exit(1);
  }

  const root = new cc.Node("BattleRoot");
  let gb = null;
  let loadErr = null;
  try {
    gb = root.addComponent(GroveBattle);
  } catch (e) {
    loadErr = e;
  }
  ck("addComponent 不抛错", !loadErr, loadErr ? String(loadErr.message) : "");
  ck("DOM 层已挂到 body（#grove-stage）", bodies.some((b) => b.id === "grove-stage"),
     "body 里：" + bodies.map((b) => b.id || b.tagName).join(","));

  const stage = bodies.find((b) => b.id === "grove-stage");
  const cv = stage && stage.children[0];
  ck("stage 里有一块画布", !!cv);
  ck("画布是 960x600", !!cv && cv.width === W && cv.height === H,
     cv ? cv.width + "x" + cv.height : "无");

  /* **先让事件循环转一圈再跑帧。** 美术图是异步的（resources.load 内部
     setImmediate），同步跑完 30 帧时一张图都还没进来 —— 出出来的是代码
     图形回退版，而"画布不是纯色"这条在回退版下照样绿。
     于是出图看着像"立绘没画出来"，断言却说一切正常。 */
  await new Promise((r) => setTimeout(r, 150));

  console.log("\n=== ② 跑 30 帧 update ===");
  let runErr = null;
  try {
    for (let i = 0; i < 30; i++) gb.update(1 / 60);
  } catch (e) {
    runErr = e;
  }
  ck("update 30 帧不抛错", !runErr,
     runErr ? String(runErr.stack || runErr).split("\n")[0] : "");
  ck("phase 是出征页（portals）", GROVE.S.phase === "portals", "phase=" + GROVE.S.phase);

  /* ---------- ③ 真数像素 ---------- */
  let blank = true, colors = 0, dominant = 0;
  if (cv) {
    const g = cv.getContext("2d");
    const img = g.getImageData(0, 0, W, H).data;
    const seen = new Map();
    for (let i = 0; i < img.length; i += 4) {
      const k = (img[i] >> 4) + "," + (img[i + 1] >> 4) + "," + (img[i + 2] >> 4);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    colors = seen.size;
    dominant = Math.max(...seen.values());
    blank = colors < 8 || dominant / (W * H) > 0.96;
  }
  console.log("    已注入的美术图：" + JSON.stringify(GROVE.ART ? Object.keys(GROVE.ART) : "ART 没导出"));
  console.log("\n=== ③ 画布内容 ===");
  console.log("    颜色种类（4bit 量化）= " + colors +
              "   最大单色占比 = " + (100 * dominant / (W * H)).toFixed(1) + "%");
  ck("画布上不是纯色（不黑屏）", !blank);

  fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
  const shot = path.join(ROOT, "shots/grove-battle-mount.png");
  if (cv) fs.writeFileSync(shot, cv.toBuffer("image/png"));
  console.log("已出图：" + path.relative(ROOT, shot));

  /* ---------------- ④ 点第三扇门：出征页 → 雪原推球 ---------------- */
  console.log("\n=== ④ 点第三扇门（雪原推球）能不能换手 ===");

  const { battleRegister, battleCurrent } = require(path.join(OUT, "BattleSwitch.js"));
  const { SnowlabBattle } = require(path.join(OUT, "snowlab/SnowlabBattle.js"));
  /* 和 BattleBoot 顶层做的一样：把"怎么挂"注册进来。
     注意 mount smoke 是手动 addComponent，没走 tryBoot —— 这里手动补上注册，
     否则 battleSwitch 会 warn "没有注册这个玩法" 然后什么都不做。 */
  battleRegister("grove", (n) => n.addComponent(GroveBattle));
  battleRegister("snowlab", (n) => n.addComponent(SnowlabBattle));

  const groveStageBefore = bodies.filter((b) => b.id === "grove-stage").length;
  ck("换手前只有一块 grove 画布", groveStageBefore === 1, "count=" + groveStageBefore);

  let switchErr = null;
  try {
    /* **按 id 找，不按槽号。** 原来写的是 `enterGate(2)` —— 出征页有三扇门
     时推球正好在 2。2026-10-30 收成一扇门之后 GATES[2] 是 undefined，
     这一句变成静默空操作，三次断言一起翻红，而报错信息说"没切过去"，
     看起来像换手坏了。按 id 找就不会被"门摆了几扇"这件事带跑。 */
  const snowSlot = GROVE.GATES.findIndex((g) => g.id === "snow");
  ck("出征页上还找得到推球那扇门", snowSlot >= 0, "slot=" + snowSlot);
  GROVE.enterGate(snowSlot);
  } catch (e) {
    switchErr = e;
  }
  ck("点门不抛错", !switchErr, switchErr ? String(switchErr.message) : "");

  /* battleSwitch 是「先 destroy、再用宏任务轮询 isValid 才挂新的」，等它落地 */
  await new Promise((r) => setTimeout(r, 150));

  ck("当前玩法已切到 snowlab", battleCurrent() === "snowlab", "current=" + battleCurrent());
  ck("旧画布已摘掉（不然两块 DOM 层互相压）",
     !bodies.some((b) => b.id === "grove-stage"),
     "body：" + bodies.map((b) => b.id || b.tagName).join(","));
  const snowStage = bodies.find((b) => b.id === "snowlab-stage" || (b.children || []).length);
  ck("新画布已挂上", !!snowStage,
     "body：" + bodies.map((b) => b.id || b.tagName).join(","));

  /* 新组件再跑几帧，确认推球那边也真的在画 */
  const snowComp = root.components.find((c) => c instanceof SnowlabBattle);
  let snowRunErr = null;
  try {
    for (let i = 0; i < 30; i++) snowComp.update(1 / 60);
  } catch (e) {
    snowRunErr = e;
  }
  ck("推球 update 30 帧不抛错", !snowRunErr,
     snowRunErr ? String(snowRunErr.stack || snowRunErr).split("\n")[0] : "");

  const snowCv = snowStage && snowStage.children[0];
  let snowColors = 0;
  if (snowCv) {
    const g2 = snowCv.getContext("2d");
    const im2 = g2.getImageData(0, 0, snowCv.width, snowCv.height).data;
    const seen2 = new Set();
    for (let i = 0; i < im2.length; i += 4) {
      seen2.add((im2[i] >> 4) + "," + (im2[i + 1] >> 4) + "," + (im2[i + 2] >> 4));
    }
    snowColors = seen2.size;
    if (snowColors > 8) {
      fs.writeFileSync(path.join(ROOT, "shots/grove-to-snowlab.png"), snowCv.toBuffer("image/png"));
    }
  }
  ck("推球画布不是纯色", snowColors > 8, "颜色种类=" + snowColors);

  console.log("\n" + (failed ? "✗ " + failed + " 项失败" : "✓ 全部通过"));
  process.exit(failed ? 1 : 0);
})();
