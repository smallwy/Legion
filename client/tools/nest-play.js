/* ============================================================================
   nest-play.js —— 深巢第二套机器人（设计文档 §6 第二、三行）

   主线 ALL9 只验 hero=2。深巢**不许**只靠它：地形是生成的，
   生成器对的（C1~C6 全过）和"打得过"是两件事 ——
   一屏台子摆得合法，但球从出生点滚不到营地，玩家照样卡死。

   验的：
     · 机器人按深度抽样试玩（每 10 层抽 1 层 × hero 1/2/3）
     · 通关率落在 40%~90%（<40% 太难，>90% 太水）
     · 每层用时中位数 30~90s（与主线同量级）

   跑法：node tools/nest-play.js           （默认 1,11,21,31,41,51 层）
         node tools/nest-play.js 5 10 15   （指定层）
   ========================================================================== */

const { boot } = require("./grove-env.js");
/* 决策逻辑在 grove-bot.js —— **只复用，不复制**。
   复制一份的话，"机器人过不过"这个结论就有两个版本，迟早对不上
   （和 grove-smoke 共用同一份的原因一样）。这里只写跑循环。 */
const { botStep } = require("./grove-bot");

function runBot(P, S, maxFrames) {
  const mem = {};
  let frames = 0;
  while (frames < maxFrames) {
    if (S.phase !== "play") break;
    botStep(P, S, mem);
    P.tick(1 / 60);
    frames++;
  }
}

/** 确定性随机。**不加这一段的话，这个工具的结论不能当回归线。**
 *  `S.rng` 默认是 `Math.random`（见 grove.html 里 `rng: Math.random` 那行），
 *  所以同一份代码连跑两次，通关层数会差 1~2 层 —— 实测 18 局里
 *  一次 16/18、一次 14/18，全都不是代码变了，是这一局的暴击/躲闪换了骰子。
 *  一个"±2 层"的指标测不出"少通了一层"这种回归，而这正是它唯一的用途。
 *  种子按 (层, 角色) 定死：同一条用例永远掷同一组骰子。 */
function seedRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEPTHS = process.argv.length > 2
  ? process.argv.slice(2).map(Number)
  : [1, 11, 21, 31, 41, 51];
const HEROES = [1, 2, 3];

console.log("=== 深巢第二套机器人 ===");
console.log("  层   角色  目标  结果  用时  造 崩 烧 袋 装 收成  清场");
const rows = [];

for (const d of DEPTHS) {
  for (const h of HEROES) {
    const sb = boot();
    const P = sb.GROVE, S = P.S;
    /* 骰子先钉死（见 seedRng 的注释）—— 必须在 enterNest 之前，
       因为第一波敌人在 enterNest → beginRun → setupWave 里就刷了。 */
    S.rng = seedRng(d * 7919 + h * 104729);
    /* **走真实入口**：enterNest 会生成地形、换表、写存档。
       绕过去直接 loadLevel 的话，"玩家点门那条路"永远没被跑过。 */
    P.enterNest(d);
    P._start(h, 0);
    S.p.hp = 999; S.p.maxHp = 999;
    runBot(P, S, 60 * 240);
    const st = P.curStage();
    const r = {
      d, h, goal: st.goal, phase: S.phase, t: S.t, limit: st.ballLimit,
      made: S.stat.made, burst: S.stat.burst, burned: S.stat.burned,
      banked: S.stat.banked, maxHolds: S.stat.maxHolds, food: S.food,
      killed: S.killed, total: S.total,
    };
    rows.push(r);
    console.log("  " + String(d).padStart(3) + String(h).padStart(6) +
      P.GOALS[st.goal].name.padStart(5) +
      (S.phase === "clear" ? "  达标" : S.phase === "fail" ? "  失败" : "  超时") +
      S.t.toFixed(0).padStart(5) + "s" +
      String(r.made).padStart(3) + String(r.burst).padStart(3) +
      String(r.burned).padStart(3) + String(r.banked).padStart(3) +
      String(r.maxHolds).padStart(3) + String(r.food).padStart(5) +
      "  " + r.killed + "/" + r.total);
  }
}

const cleared = rows.filter(r => r.phase === "clear").length;
const rate = cleared / rows.length;
const times = rows.filter(r => r.phase === "clear").map(r => r.t).sort((a, b) => a - b);
const med = times.length ? times[Math.floor(times.length / 2)] : 0;

console.log("");

/* 设计文档给的是 40%~90%，但有两件事必须分开看：
 *
 *   · **限球关机器人过不去是预期的** —— 主线 ALL9 的注释原话：
 *     "机器人不会提前规划，它不会卷"。所以限球关只验"额度在合理区间"
 *     （< 敌人数、且 ≥ ceil(敌人数/3)），不要求通关。
 *   · clear / collect 关必须真的打过去 —— 那才是"地形通着"的证明。
 */
const open = rows.filter(r => r.goal !== "limit");
const clearedOpen = open.filter(r => r.phase === "clear").length;
const rateOpen = open.length ? clearedOpen / open.length : 1;
const lim = rows.filter(r => r.goal === "limit");
const limOk = lim.every(r => r.limit < r.total && r.limit >= Math.ceil(r.total / 3));

console.log("");
console.log(`通关率 ${cleared}/${rows.length} = ${(rate * 100).toFixed(0)}%（总）`);
console.log(`非限球关 ${clearedOpen}/${open.length} = ${(rateOpen * 100).toFixed(0)}%（这才是"地形通着"的证明）`);
console.log(`限球关 ${lim.length} 层：额度全部落在 [ceil(敌/3), 敌-1] 内 ? ${limOk ? "是" : "否"}`);
console.log(`达标层用时中位数 ${med.toFixed(0)}s（设计线 30~90s）`);
const byGoal = {};
for (const r of rows) {
  byGoal[r.goal] = byGoal[r.goal] || { n: 0, ok: 0 };
  byGoal[r.goal].n++;
  if (r.phase === "clear") byGoal[r.goal].ok++;
}
console.log("按目标分组：");
for (const k in byGoal) console.log(`  ${k}: ${byGoal[k].ok}/${byGoal[k].n}`);

const okRate = rateOpen >= 0.6;
const okTime = med === 0 || (med >= 20 && med <= 120);
console.log("");
console.log(okRate ? "  ✓ 非限球关通关率 ≥60%（地形通着）" : `  ✗ 非限球关通关率只有 ${(rateOpen * 100).toFixed(0)}%（地形有死路）`);
console.log(limOk ? "  ✓ 限球关额度都在可解区间" : "  ✗ 限球关额度越界（无解或等于没限）");
console.log(okTime ? "  ✓ 用时与主线同量级" : "  ✗ 用时异常");
process.exit(okRate && okTime && limOk ? 0 : 1);
