/* ============================================================================
   runtime-sanity.js —— 生成物里"根本跑不起来"的那类错，单独守一道
   ----------------------------------------------------------------------------
   为什么需要它（2026-10-27）：
     `extract_grove_runtime.py` 的 `BOOT` 模板里写着 `openPick()`，
     而那个函数 2026-10-26 就随「挑一屏」界面一起删了。
     结果：全通存档一进战斗就 ReferenceError。
     这个洞**四套检查全漏**——
       · grove.html 里没有这行（它只在 Cocos 侧 groveBoot 里）
       · 冒烟跑的是原型，不进 groveBoot
       · grove-runtime-check 只验模块能不能加载，进不到全通分支
       · 出图工具也不走这条路
     只有 tsc 的 TS2304 看见了，而 tsc 现在有 2200+ 条既有技术债，
     没人会去里面找那一条。

   所以这里只守"不可运行"的少数几个码，剩下的当技术债放过：
     TS2304  找不到名字        —— 调用了一个不存在的函数
     TS1117  对象字面量重复键  —— 同名的键只有最后一个生效
     TS2739 / TS2741  缺必填字段 —— 结构漏了字段（会 undefined 起算）
   阈值是 **0**：这几个码没有"可接受的量"，出现一条就是一条 bug。

   用法：
     node tools/runtime-sanity.js
     TSC=/path/to/tsc node tools/runtime-sanity.js   （默认用 Cocos 编辑器自带那份）
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TSC = process.env.TSC ||
  "C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/bin/tsc";
const CFG = path.join(__dirname, "tsconfig.all.json");

/** 这些码出现即失败 */
const FATAL = {
  TS2304: "找不到名字（调用了不存在的函数/变量）",
  TS1117: "对象字面量重复键（后者覆盖前者）",
  TS2739: "对象缺少必填字段",
  TS2741: "缺少必填属性",
};

function main() {
  if (!fs.existsSync(TSC)) {
    console.error("找不到 tsc：" + TSC + "\n用 TSC=... 指定。");
    process.exit(2);
  }

  let out = "";
  try {
    /* tsc 是个 .js，用当前这个 node 跑它 —— 不用管机器上有没有全局 node。 */
    out = execFileSync(process.execPath, [TSC, "-p", CFG, "--noEmit"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // tsc 有错时退出码非 0，输出在 stdout
    out = (e.stdout || "") + (e.stderr || "");
  }

  const lines = out.split("\n").filter((l) => /error TS\d+/.test(l));
  const total = lines.length;
  const bad = {};
  for (const l of lines) {
    const m = l.match(/error (TS\d+)/);
    if (m && FATAL[m[1]]) (bad[m[1]] = bad[m[1]] || []).push(l);
  }

  const codes = Object.keys(bad);
  console.log("运行时体检（编译期）");
  console.log("  配置 " + path.relative(ROOT, CFG));
  console.log("  错误总数 " + total + "（既有 implicit-any 技术债，不计）");

  if (!codes.length) {
    console.log("\n✓ 不可运行的错误 0 条（TS2304 / TS1117 / TS2739 / TS2741）");
    return;
  }

  console.log("");
  for (const c of codes) {
    console.log("✗ " + c + " " + FATAL[c] + " × " + bad[c].length);
    for (const l of bad[c]) console.log("    " + l.trim());
  }
  process.exit(1);
}

main();
