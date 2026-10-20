/**
 * 森林原型离屏截图
 *
 * 用 @napi-rs/canvas 真渲染 forest.html 的场景，导出 PNG。
 *
 * 为什么需要它：背景树有没有压到战场、格子读不读得清、施法特效看不看得见，
 * 这些都是**视觉判断**。靠坐标算只能证明"树冠的 x 区间和格子重叠"，
 * 证明不了"重叠之后看起来像不像站在树上"。有图才能拍板。
 *
 * 跑法：node forest-shot.js [输出目录]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "forest.html");
const OUT = process.argv[2] || path.join(__dirname, "..", "shots");

const W = 960, H = 600;
const noop = () => {};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const html = fs.readFileSync(HTML, "utf8");
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

  // 先把所有 data URI 贴图解码成真图。页面里的 Image 桩是同步触发的，
  // 所以必须在跑脚本之前就把解码做完 —— 否则 bake() 拿到的是空对象。
  // 按 data URI 建索引 —— 页面里的 Image.src 拿到的是一整串 URI，
  // 按 sprite key 索引的话查不到，贴图会静默变成"加载失败"，
  // 而画面看起来只是"单位没画出来"，很容易误判成绘制 bug。
  const decoded = {};
  const re = /'([\w:-]+)':\s*'(data:image\/[^']+)'/g;
  let m;
  while ((m = re.exec(code))) {
    decoded[m[2]] = await loadImage(m[2]);
  }

  const mainCanvas = createCanvas(W, H);
  mainCanvas.style = {};
  mainCanvas.addEventListener = noop;
  mainCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });

  function makeImage() {
    const im = { width: 0, height: 0, onload: null, onerror: null, _src: "" };
    Object.defineProperty(im, "src", {
      get: () => im._src,
      set(v) {
        im._src = v;
        const real = decoded[v] || null;
        if (real) { im.width = real.width; im.height = real.height; im._real = real; }
        if (im.onload) im.onload();      // 同步触发：与 data URI 的浏览器行为一致
      },
    });
    return im;
  }

  /** drawImage 要能吃我们自己的 Image 桩（只有 _real 才是真图） */
  function wrapCtx(cx) {
    const orig = cx.drawImage.bind(cx);
    cx.drawImage = function (img, ...rest) {
      const real = img && (img._real || img);
      if (!real) return;
      try { orig(real, ...rest); } catch (e) { /* 尺寸为 0 的贴图直接跳过 */ }
    };
    return cx;
  }

  const sandbox = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean, isNaN,
    Image: makeImage,
    document: {
      getElementById: () => mainCanvas,
      createElement: (tag) => {
        if (tag !== "canvas") return { style: {} };
        const c = createCanvas(1, 1);
        const getCtx = c.getContext.bind(c);
        c.getContext = (t) => wrapCtx(getCtx(t));
        c.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
        c.addEventListener = noop;
        return c;
      },
    },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,   // 不跑主循环，下面手动驱动
    addEventListener: noop,
    innerWidth: 1280,
    innerHeight: 800,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "forest.html" });

  const P = sandbox.window.PAWPACK;
  if (!P) throw new Error("PAWPACK 没挂上，脚本可能在中途抛错");

  const g = mainCanvas.getContext("2d");
  wrapCtx(g);

  function shot(name) {
    P._render();
    const file = path.join(OUT, name + ".png");
    fs.writeFileSync(file, mainCanvas.toBuffer("image/png"));
    console.log("  → " + file);
  }

  // ---- 1. 战斗开场全景（纯背景 + 格子 + 就位的单位）
  P._reset();
  P._setParty(["cat", "dog", "ham", "rab", "duck"]);
  P._startRun();
  shot("01-开场全景");

  // ---- 2. 交手瞬间：跑到目标身前、特效刚亮起来
  const S = P._S;
  const pets = S.pets.filter(p => p.hp > 0);
  const foe = P._aliveEnemies()[0];
  if (foe && pets.length) {
    // 挑一只近战的，让它打一次
    const melee = pets.find(p => p.def.skills.includes("scratch")) || pets[0];
    P._petAct(melee, melee.def.skills[0], foe);
    // 推到「命中」那一刻：approach 结束的瞬间
    for (let i = 0; i < 20; i++) { P._tick(1 / 60); if (i >= 16) break; }
    shot("02-冲到目标身前");

    // 命中后 0.1 秒：星芒 + 斩击 + 顿帧都在
    for (let i = 0; i < 4; i++) P._tick(1 / 60);
    shot("03-命中瞬间");

    // 回程
    for (let i = 0; i < 12; i++) P._tick(1 / 60);
    shot("04-走回格子");
  }

  // ---- 3. 多打一会儿，看群伤 / 治疗 / 残影叠在一起会不会糊
  P._reset();
  P._setParty(["cat", "dog", "ham", "rab", "duck"]);
  P._startRun();
  for (let i = 0; i < 60 * 6; i++) P._tick(1 / 60);
  shot("05-打了六秒");

  // ---- 4. boss 层
  P._reset();
  P._setParty(["cat", "dog", "ham", "rab", "duck"]);
  P._startRun();
  S.depth = 5;
  P._startBattle();
  shot("06-boss层");
  for (let i = 0; i < 60 * 4; i++) P._tick(1 / 60);
  shot("07-boss交手");

  console.log("\n完成，输出在 " + OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
