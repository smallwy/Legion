/* ============================================================================
   import-export-check.js —— 「import 的名字，目标模块到底导没导出」

   为什么需要它（2026-10-30，点「出发」黑屏）
   ---------------------------------------------------------------------------
   `GroveBattle` 里写了 `import { setSnowlabEntry } from './GroveRuntime'`，
   而 GroveRuntime 是**抽取生成物**，那个函数在原型里只是同文件内部用的
   普通函数 —— 抽取时没加 export。

   后果不是"点了没反应"，是 **ESM 链接阶段就抛**
   `The requested module './GroveRuntime' does not provide an export named
   'setSnowlabEntry'`：整个 GroveBattle 模块加载失败，
   `addComponent(GroveBattle)` 拿到 undefined，一台相机都没建。
   表现：**点「出发」纯黑屏，控制台一行日志都没有** —— 因为模块根本没执行，
   onLoad 里那句 "[GroveBattle] 推球已接管战斗场景" 都没机会打。

   为什么现有检查全绿：
     · `ts-syntax-check.js` 用的是 `transpileModule`，**只查语法、不做
       模块解析** —— 它不知道目标文件导出了什么；
     · 冒烟/断言都跑在 grove.html 的代码上（原型里那个函数是存在的）；
     · 全量 `tsc -p tools/tsconfig.all.json` 能抓到（TS2459），
       但它会另外吐出两千多条生成物里的 implicit any，没人会去看第一页。

   所以单独做一个只回答这一个问题的门禁：**快、零误报、能当提交前必跑**。

   判据：每个相对 import 的命名符号，都必须在目标文件里找到 export。
   覆盖的形式：export function/const/let/var/class/interface/type/enum/abstract class、
   `export { a, b as c }`（含 `from`）、`export * from`（放行 —— 它意味着
   "不知道有哪些"，静态查不了，交给 tsc）。

   用法：node tools/import-export-check.js
   ========================================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT_DIR = path.join(ROOT, "assets", "scripts");

/** 剥注释但**保留行数**（块注释换成等量空行） */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    /* 行注释只剥**行首**的：`'http://x'` 这种字符串里也有 `//`，
       用 `//[^\n]*` 会从那里开始吃，把同一行后半段（可能是 import）删掉。 */
    .replace(/^[ \t]*\/\/[^\n]*/gm, "");
}

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const st = fs.statSync(full);
    if (st.isDirectory()) { walk(full, out); continue; }
    if (f.endsWith(".ts") && !f.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** 一个文件导出了哪些名字 */
function exportsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const names = new Set();
  let hasDefault = false;
  let hasStar = false;

  /* 先剥注释，避免注释里的 "export function foo" 被当真。
     **块注释要换成等量换行**，不是删掉 —— 否则后面算出来的行号全部前移
     （第一次跑时它把 GroveBattle.ts 的第 48 行报成第 6 行，指到一句无关的
     import 上，等于让人顺着错的行号去看别的代码）。 */
  const code = stripComments(src);

  if (/^\s*export\s+default\b/m.test(code)) hasDefault = true;
  if (/^\s*export\s+\*\s+from\b/m.test(code)) hasStar = true;

  const decl = /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = decl.exec(code))) names.add(m[1]);

  /* export { a, b as c } / export { a } from './x' */
  const braced = /^\s*export\s*\{([^}]*)\}/gm;
  while ((m = braced.exec(code))) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(t);
      names.add(as ? as[1] : t.split(/\s+/)[0]);
    }
  }
  return { names, hasDefault, hasStar };
}

/** 一个文件 import 了哪些名字、来自哪个相对路径 */
function importsOf(file) {
  const src = fs.readFileSync(file, "utf8");
  const code = stripComments(src);
  const out = [];
  const re = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) {
    const clause = m[1].trim();
    const spec = m[2];
    if (!spec.startsWith(".")) continue;          // 'cc' / 'cc/env' 之类，交给引擎

    const named = [];
    const b = /\{([\s\S]*)\}/.exec(clause);
    if (b) {
      for (const part of b[1].split(",")) {
        const t = part.trim();
        if (!t) continue;
        named.push(t.split(/\s+as\s+/)[0].trim());
      }
    }
    const dflt = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.test(clause) && !/^\{/.test(clause)
      ? clause.split(",")[0].trim()
      : null;
    const star = /\*\s+as\s+/.test(clause);
    out.push({ spec, named, dflt, star, line: lineOf(src, m.index) });
  }
  return out;
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src[i] === "\n") n++;
  return n;
}

/** './x' → 磁盘上的 .ts；找不到返回 null（那本身也是错误） */
function resolveSpec(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const tries = [base + ".ts", path.join(base, "index.ts")];
  for (const t of tries) if (fs.existsSync(t)) return t;
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) return null;
  return null;
}

/* ---------------- 跑 ---------------- */

const files = walk(SCRIPT_DIR, []);
const cache = new Map();
const getExports = (f) => {
  if (!cache.has(f)) cache.set(f, exportsOf(f));
  return cache.get(f);
};

const problems = [];
for (const f of files) {
  for (const imp of importsOf(f)) {
    const target = resolveSpec(f, imp.spec);
    const where = path.relative(ROOT, f) + ":" + imp.line;
    if (!target) {
      problems.push({ where, msg: "找不到模块 '" + imp.spec + "'" });
      continue;
    }
    if (imp.star) continue;
    const ex = getExports(target);
    if (ex.hasStar) continue;                     // export * → 静态查不了

    if (imp.dflt && !ex.hasDefault) {
      problems.push({
        where,
        msg: "默认导入 '" + imp.dflt + "'，但 " + path.relative(ROOT, target) + " 没有 export default",
      });
    }
    for (const n of imp.named) {
      if (n === "type") continue;                 // import { type X } 的写法
      if (!ex.names.has(n)) {
        problems.push({
          where,
          msg: "import { " + n + " } ← " + path.relative(ROOT, target) + " 没有导出这个",
        });
      }
    }
  }
}

console.log("扫了 " + files.length + " 个 .ts");
if (!problems.length) {
  console.log("✓ 全部 import 的名字都能在目标模块里找到 export");
  process.exit(0);
}
for (const p of problems) console.log("  ✗ " + p.where + "  " + p.msg);
console.log("\n" + problems.length + " 处：上面这些名字在运行时是 undefined，");
console.log("ESM 会在链接阶段直接抛，症状通常是「整块黑屏 + 零日志」。");
process.exit(1);
