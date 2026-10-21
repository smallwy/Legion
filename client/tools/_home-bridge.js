/* grove 侧接入钩子的断言：通关记账要去重、只在"恰好跨阈值"时报解锁 */
const { boot } = require("./grove-env");
const sb = boot();

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✓ " + l); } else { fail++; console.log("  ✗ " + l + (x !== undefined ? "  → " + JSON.stringify(x) : "")); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (${JSON.stringify(a)})`);

/* 补上浏览器才有的东西（沙箱里没有） */
const store = {};
sb.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
sb.setTimeout = setTimeout; sb.clearTimeout = clearTimeout;

const G = sb.GROVE;
const saved = () => JSON.parse(store["pawpack.save"] || "{}");

console.log("\n=== 1. 钩子都在 ===");
ok(typeof G.recordClear === "function", "recordClear 已导出");
ok(typeof G.readHomeSave === "function", "readHomeSave 已导出");
eq(G.FROM_HOME, false, "无参数时 FROM_HOME=false（旧流程不受影响）");

console.log("\n=== 2. 记账与去重 ===");
eq(G.recordClear(0), ["dog"], "通第 1 关 → 跨过 1，年糕到家");
eq(saved().cleared, [0], "cleared 写入 [0]");
eq(G.recordClear(0), [], "重打第 1 关 → 不报解锁（去重）");
eq(saved().cleared, [0], "cleared 仍是 [0]");
eq(G.recordClear(1), [], "通第 2 关 → 没跨阈值");
eq(G.recordClear(2), ["ham"], "通第 3 关 → 团子到家");
eq(saved().cleared, [0,1,2], "cleared 累积 [0,1,2]");

console.log("\n=== 3. 顺序推关，逐个跨阈值 ===");
eq(G.recordClear(3), [], "第 4 关 → 通关数 4，无新伙伴");
eq(G.recordClear(4), ["rab"], "第 5 关 → 通关数 5，雪团到家");
eq(G.recordClear(5), [], "第 6 关 → 通关数 6，无新伙伴");
eq(G.recordClear(6), ["ox"], "第 7 关 → 通关数 7，豆奶到家");

console.log("\n=== 4. 全清 ===");
eq(G.recordClear(7), ["fox"], "第 8 关 → 通关数 8，星屑到家");
const c = saved().cleared.slice().sort((a,b)=>a-b);
eq(c, [0,1,2,3,4,5,6,7], "cleared 与八关一一对应");
eq(new Set(c).size, 8, "去重后 8 项");

console.log("\n=== 5. 存档与主界面同源 ===");
ok(store["pawpack.save"] !== undefined, "写在 pawpack.save（game.html 读同一个 key）");
eq(saved().v, 1, "带版本号 v=1");

console.log("\n" + "=".repeat(56));
console.log(fail === 0 ? `全部通过：${pass} 项` : `失败 ${fail} 项 / 通过 ${pass} 项`);
process.exit(fail ? 1 : 0);
