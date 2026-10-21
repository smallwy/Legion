/* game.html 冒烟：解锁闭环。断言的是"开局只有 1 只、逐步到家、过场只播一次"，不测好看。 */
const fs = require("fs");
const { JSDOM } = require("jsdom");

let pass = 0, fail = 0;
const ok = (c, l, x) => { if (c) { pass++; console.log("  ✓ " + l); } else { fail++; console.log("  ✗ " + l + (x !== undefined ? "  → " + x : "")); } };
const eq = (a, b, l) => ok(a === b, `${l} (${JSON.stringify(a)} === ${JSON.stringify(b)})`);

const html = fs.readFileSync("game.html", "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/game.html" });
const { window } = dom;
const doc = window.document;

/* --- stubs --- */
window.Image = class {
  constructor() { this.naturalWidth = 900; this.naturalHeight = 1300; }
  set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src; }
};
const animStub = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
window.Element.prototype.animate = animStub;
window.HTMLElement.prototype.animate = animStub;

let errs = [];
window.addEventListener("error", e => errs.push(e.message));
const origErr = console.error.bind(console);
window.console.error = (...a) => { errs.push(a.map(String).join(" ")); };

const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
try { window.eval(script); } catch (e) { console.log("✗ 脚本抛错:", e.message); process.exit(1); }

const SAVE = "pawpack.save";
const readSave = () => { try { return JSON.parse(window.localStorage.getItem(SAVE) || "{}"); } catch (e) { return {}; } };
const petsNow = () => [...doc.querySelectorAll("#pets .pet")].map(p => p.dataset.id);
const slots = () => [...doc.querySelectorAll("#slots .slot")];
const locked = () => slots().filter(s => s.classList.contains("locked"));
const introOn = () => doc.getElementById("intro").classList.contains("on");
const step = (ms) => new Promise(r => setTimeout(r, ms));
const tap = () => doc.getElementById("intro").dispatchEvent(
  new window.MouseEvent("pointerdown", { bubbles: true }));

(async () => {
  await step(260);   // 等 boot

  console.log("\n=== 1. 开局：只有一只 ===");
  eq(petsNow().length, 1, "场景里只有 1 只");
  eq(petsNow()[0], "sugar-stand", "开局那只是砂糖");
  eq(slots().length, 5, "Dock 待命位 5 格（出战的那只不进这一排）");
  eq(locked().length, 5, "开局五格全锁着");
  ok(doc.getElementById("solo").style.display !== "none", "只有一只时给独白");
  eq(doc.getElementById("tipBar").textContent.includes("年糕"), true, "顶部提示条指向年糕");
  eq(doc.getElementById("stageProg").textContent.trim(), "0 / 8 关", "关卡进度 0/8");
  ok(!readSave().cleared || readSave().cleared.length === 0, "存档 cleared 为空");

  console.log("\n=== 2. 通关第 1 关 → 年糕到家 ===");
  doc.querySelector('[data-dev="clear"]').click();
  await step(120);
  ok(introOn(), "过场出现");
  eq(doc.getElementById("introName").textContent, "年糕", "过场显示年糕");
  ok(doc.getElementById("introLine").textContent.includes("门口"), "台词是门口等那句");
  tap();
  await step(400);
  eq(petsNow().length, 2, "场景变 2 只");
  eq(locked().length, 4, "锁着的剩 4 格");
  eq(readSave().seen.includes("nian-gao-dog"), true, "seen 记下年糕（不重复播过场）");
  eq(doc.getElementById("stageProg").textContent.trim(), "1 / 8 关", "关卡进度 1/8");

  console.log("\n=== 3. 再通两关 → 团子（阈值 3） ===");
  doc.querySelector('[data-dev="clear"]').click();
  await step(80);
  ok(!introOn(), "第 2 关不触发过场（还没到阈值）");
  doc.querySelector('[data-dev="clear"]').click();
  await step(120);
  ok(introOn(), "第 3 关触发过场");
  eq(doc.getElementById("introName").textContent, "团子", "过场显示团子");
  tap(); await step(400);
  eq(petsNow().length, 3, "场景 3 只");
  eq(locked().length, 3, "锁着的剩 3 格");

  console.log("\n=== 4. 重开关卡不重复播过场 ===");
  const seenBefore = readSave().seen.length;
  doc.querySelector('[data-dev="clear"]').click();
  await step(120);
  ok(!introOn(), "第 4 关无新解锁 → 不弹过场");
  eq(readSave().seen.length, seenBefore, "seen 没变长");

  console.log("\n=== 5. 全解锁 ===");
  doc.querySelector('[data-dev="all"]').click();
  await step(120);
  eq(doc.getElementById("introName").textContent, "雪团", "第一个播的是雪团（阈值 5）");
  tap(); await step(360);
  ok(introOn(), "接着播豆奶");
  eq(doc.getElementById("introName").textContent, "豆奶", "第二个是豆奶");
  tap(); await step(360);
  eq(doc.getElementById("introName").textContent, "星屑", "第三个是星屑");
  tap(); await step(500);
  eq(petsNow().length, 6, "六只都在院子里");
  eq(slots().length, 5, "待命位仍然是 5 格");
  eq(locked().length, 0, "没有锁着的格");
  eq(doc.getElementById("tipBar").textContent.includes("都在家"), true, "提示条改成都在家");
  eq(doc.getElementById("stageProg").textContent.trim(), "8 / 8 关", "8/8 关");
  eq(doc.getElementById("chain").textContent, "连锁 ×2.00", "连锁倍率封顶 2.00（8 关 ×1.15 超过上限）");

  console.log("\n=== 6. 出战切换 ===");
  ok(doc.querySelector('[data-slot="nian-gao-dog"]') !== null, "年糕本来在待命位里");
  doc.querySelector('[data-slot="nian-gao-dog"]').click();
  await step(60);
  eq(readSave().active, "nian-gao-dog", "存档记下出战宠物");
  ok(doc.querySelector('[data-slot="nian-gao-dog"]') === null,
     "出战之后该格从待命位移除（出征信息只在出战卡里出现一次）");
  eq(doc.querySelector('[data-slot="sugar-stand"]') !== null, true, "原来的出战宠换到了待命位");
  eq(slots().length, 5, "待命位仍是 5 格");
  ok(doc.querySelector("#pets .pet[data-id='nian-gao-dog']").classList.contains("active"),
     "场景里那只脚下亮金环");
  ok(doc.getElementById("goLine").textContent.includes("年糕"), "出门按钮文案跟着换");

  console.log("\n=== 7. 解密调全解锁不重复播 ===");
  doc.querySelector('[data-dev="all"]').click();
  await step(100);
  ok(!introOn(), "已经全解锁后再点，不弹过场");

  console.log("\n=== 8. 运行期报错 ===");
  ok(errs.length === 0, "无脚本错误", errs.join(" | "));

  console.log("\n" + "=".repeat(56));
  console.log(fail === 0 ? `全部通过：${pass} 项` : `失败 ${fail} 项 / 通过 ${pass} 项`);
  console.log("=".repeat(56));
  process.exit(fail ? 1 : 0);
})();
