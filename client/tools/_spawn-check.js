/* ============================================================================
   _spawn-check.js —— 敌人出生点 vs 实心木桩 重叠扫描
   ----------------------------------------------------------------------------
   背景：第 5 关（弹跳林）里 stumps 和 waves 都写了 (650, 350) —— 野猪出生点
   正好压在木桩正中心。stepBody 的木桩判定是"谁先重叠就把谁顶到桩外侧"，
   于是它每帧被顶回 x=700（= 672 + 半宽 28），hitWall 帧帧为 -1，
   charge 分支又不读 dir，位置就永远钉死在那儿。

   这个脚本对**所有关卡**做同一件事：把每只敌人的出生包围盒和每根木桩的
   横向区间比一遍，列出重叠的。跑一次就知道还有没有别的地方也这样。

   用法：node tools/_spawn-check.js
   ========================================================================== */
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const HTML = process.env.PROTO || path.join(__dirname, "..", "prototype", "grove.html");
const noop = () => {};

function boot() {
  const code = fs.readFileSync(HTML, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
  const main = createCanvas(960, 600);
  main.style = {};
  main.addEventListener = noop;
  main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 600 });
  const sb = {
    console, Math, Date, JSON, String, Number, Array, Object, Boolean,
    isNaN, isFinite, Set, Map, Infinity, NaN,
    document: {
      getElementById: () => main,
      createElement: () => { const c = createCanvas(1, 1); c.style = {}; c.addEventListener = noop; return c; },
    },
    performance: { now: () => Date.now() },
    addEventListener: noop,
    innerWidth: 1280, innerHeight: 800,
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: "grove.html" });
  return sb;
}

const sb = boot();
const P = sb.GROVE;
const LEVELS = P.LEVELS, FOES = P.FOES;

let bad = 0, checked = 0;
console.log("敌人出生点 vs 实心木桩 重叠扫描\n");

LEVELS.forEach((lv, li) => {
  const stumps = lv.stumps || [];
  if (!stumps.length) return;
  (lv.waves || []).forEach((wv, wi) => {
    (wv || []).forEach((sp) => {
      const def = FOES[sp.foe];
      if (!def) return;
      checked++;
      const hw = (sp.foe === "boss" ? 78 : def.w) / 2;
      const hh = (sp.foe === "boss" ? 84 : def.h);
      for (const s of stumps) {
        /* 纵向重叠：敌人底边 sp.y 落在桩身区间内（和 stepBody 的判据一致） */
        const top = s.y - s.h;
        if (sp.y <= top + 4) continue;        // 站在桩顶之上
        if (sp.y - hh >= s.y - 2) continue;   // 整个人在桩底下面
        const l = s.x - s.w / 2, r = s.x + s.w / 2;
        if (sp.x + hw > l && sp.x - hw < r) {
          const overlapL = Math.min(sp.x + hw, r) - Math.max(sp.x - hw, l);
          bad++;
          console.log(`  ✗ 第 ${li + 1} 关「${lv.name}」第 ${wi + 1} 波  ${sp.foe} @ (${sp.x}, ${sp.y})`);
          console.log(`      与木桩 (${s.x}, ${s.y}) w=${s.w} h=${s.h} 横向重叠 ${overlapL.toFixed(1)}px` +
            `  [桩区间 ${l}..${r}，敌人 ${(sp.x - hw).toFixed(0)}..${(sp.x + hw).toFixed(0)}]`);
        }
      }
    });
  });
});

console.log(`\n扫描 ${LEVELS.length} 关 / ${checked} 个敌人出生点，重叠 ${bad} 处。`);
process.exit(bad ? 1 : 0);
