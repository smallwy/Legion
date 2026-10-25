/* ============================================================================
   grove-env.js —— 无头环境：把 grove.html 里的 <script> 拉进 vm 沙箱跑

   冒烟测试、诊断脚本、一次性探针都从这里 boot()，避免三份 Canvas 桩各写一遍
   （写三份就会漂移，漂移过的桩会让测试假通过 —— 已经踩过）。

   boot() 返回沙箱对象本身，`sb.GROVE` 就是页面里的 window.GROVE。
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = path.join(__dirname, "..", "prototype", "grove.html");

function noop() {}

function mkCanvas(w, h) {
  const c = {
    width: w, height: h,
    getContext: () => new Proxy({}, {
      get: (t, k) => {
        if (k === "canvas") return c;
        if (k === "createLinearGradient" || k === "createRadialGradient")
          return () => ({ addColorStop: noop });
        if (k === "measureText") return () => ({ width: 10 });
        if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
        return typeof k === "string" ? noop : undefined;
      },
      set: () => true,
    }),
    style: {},
    addEventListener: noop,
  };
  return c;
}

function boot() {
  const html = fs.readFileSync(HTML, "utf8");
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const main = mkCanvas(960, 600);
  /* 内存 localStorage 桩。**必须有**：grove.html 的存档链路
     （pawpack.save / pawpack.save.v1 / pawpack.best / pawpack.stats）
     全部走 localStorage，没有它时「读档」抛 ReferenceError、「写档」
     被 try/catch 吞掉 —— 于是所有涉及存档的断言都会**假通过**
     （函数返回空数组，看起来跟"没有新达成"一模一样）。
     内存版而不是抛错：沙箱里要测的就是"写进去再读回来"这条链。 */
  const mem = {};
  const ls = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
    clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
  };
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN, undefined,
    document: {
      getElementById: () => main,
      createElement: () => mkCanvas(1, 1),
    },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
    localStorage: ls,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return sb;
}

/** 固定种子：同样的关卡必须每次都跑出同样的结果，否则调参没法比 */
function seed(S, n) {
  let x = (n === undefined ? 20261020 : n) >>> 0;
  S.rng = () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

module.exports = { boot, seed, mkCanvas, noop, HTML };
