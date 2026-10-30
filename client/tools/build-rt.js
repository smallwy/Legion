/* ============================================================================
   build-rt.js —— 重建 tools/_rt-build（HomeRuntime + config 的 CJS 产物）

   为什么需要单独一个"清完再编"的入口
   ---------------------------------------------------------------------------
   `tsc -p tsconfig.homeruntime.build.json` **只增不删**：源文件删掉、改名、
   或者某个文件从 include 里掉出去，旧 .js 会一直留在 outDir 里。
   `_home-rt-shot.js` / `_rt-check.js` / `_rt-frames.js` / `verify-roster.js`
   全都 require 这个目录 —— 于是它们跑的是**几周前的代码**，而且一片绿。

   2026-10-30 实测到的具体形态：`_rt-build/config/Roster.js` 停在 10-23，
   而 `Roster.ts` 10-27 才加的 `heroIndexOf` 在里面根本不存在。
   `_battle-mount-smoke` 拷了那份旧产物，报 `heroIndexOf is not a function`，
   看起来像产品代码坏了，实际是产物过期。
   ——「生成物过期不报错」是这个项目反复栽的同一个坑，这次栽在工具自己身上。

   用法：node tools/build-rt.js
        （改了 assets/scripts/config/** 或 HomeRuntime.ts 之后跑一次）
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tools/_rt-build");

function req(name, absDir) {
  try { return require(name); } catch (e) {
    if (!absDir) throw e;
    return require(absDir);
  }
}
const TSC_DIR = "C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript";

/* ① 清干净。**这一步是重点**，不是顺手 —— 不清就等于允许"过期产物"存在。 */
if (fs.existsSync(OUT)) {
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log("已清空 " + path.relative(ROOT, OUT));
}

/* ② 编。tsc 的 bin 用 node 直接跑，避免依赖 PATH 里有没有 tsc。 */
const tscBin = path.join(TSC_DIR, "bin/tsc");
const r = spawnSync(process.execPath, [tscBin, "-p", "tools/tsconfig.homeruntime.build.json"], {
  cwd: ROOT,
  encoding: "utf8",
});

const out = (r.stdout || "") + (r.stderr || "");
if (r.status !== 0) {
  console.log(out.trim() || "（tsc 没有输出，但退出码 " + r.status + "）");
  console.log("\n✗ 编译失败");
  process.exit(1);
}
/* noEmitErrors 之外，tsc 会把类型错误打到 stdout 但退出码仍是 0 吗？
   不会：有 error 时 status 非 0。这里再兜一层，防止未来换 tsconfig。 */
if (/\berror TS\d+/.test(out)) {
  console.log(out.trim());
  console.log("\n✗ 有类型错误");
  process.exit(1);
}

/* ③ 报产物清单 + 最新源时间，让"产物是不是新的"这件事一眼可见。 */
const walk = (d, acc) => {
  if (!fs.existsSync(d)) return acc;
  for (const f of fs.readdirSync(d)) {
    const full = path.join(d, f);
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
};
const files = walk(OUT, []);
console.log("产物 " + files.length + " 个：");
for (const f of files) console.log("  " + path.relative(OUT, f).replace(/\\/g, "/"));

/* ④ 关键锚点自检：这几样是下游脚本真正会 import 的，
   缺了就是"编成功了但产物对不上"，比编译失败更难查。 */
const must = [
  ["config/Roster.js", "heroIndexOf"],
  ["config/SaveData.js", "loadSave"],
  ["config/HomeBiz.js", "applyRunReward"],
];
let bad = 0;
for (const [rel, sym] of must) {
  const p = path.join(OUT, rel);
  const ok = fs.existsSync(p) && fs.readFileSync(p, "utf8").includes(sym);
  if (!ok) { bad++; console.log("  ✗ " + rel + " 里没有 " + sym); }
}
if (bad) { console.log("\n✗ 产物和源码对不上"); process.exit(1); }
console.log("\n✓ 产物已重建，锚点齐全");
