/* ============================================================================
   _inline-art.js —— 把角色贴图内嵌进 snowlab.html（让浏览器里也能看到贴图）
   ----------------------------------------------------------------------------
   **为什么必须内嵌。** snowlab 是自包含单文件，双击就能玩；而预览面板的静态
   服务只给这一个文件，兄弟图片一律 404。原来只有背景立绘走内嵌（`#art-bg`），
   角色贴图**只在出图工具里注入** —— 结果就是"评审图上是我画的贴图版，
   你打开看到的还是代码图形的小猫"，这类静默不一致最难解释。

   规矩和背景那条一样：内嵌一份 base64，程序化那套留作回退。

   用法：
     node tools/_inline-art.js            # 重新生成内嵌块（改了 png 之后跑）
     node tools/_inline-art.js --check    # 只检查有没有过期，过期 exit 1

   **内嵌块是生成物，不许手改。** `_snowlab-check.js` 里有一条断言按 sha256
   比对"内嵌的字节"和"磁盘上的 png"，改了图忘了重新跑这个工具会当场变红。
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const HTML = path.join(ROOT, "prototype", "snowlab.html");
const BEGIN = "<!-- ART-INLINE-BEGIN：由 tools/_inline-art.js 生成，别手改 -->";
const END = "<!-- ART-INLINE-END -->";

/* **只内嵌真正会用到的图。** 六只宠物里现在只硬编码了 `pet-cat`
   （换角色那条待办还没做），把另外五只也塞进来只是让文件胖 400KB。
   敌人三只全要。以后做了多角色，往这张表里加键即可。 */
const KEYS = [
  { key: "pet-cat", file: path.join(ROOT, "assets", "resources", "grove", "pet", "cat.png") },
  { key: "foe-moss", file: path.join(ROOT, "assets", "snowlab", "foe", "moss.png") },
  { key: "foe-fang", file: path.join(ROOT, "assets", "snowlab", "foe", "fang.png") },
  { key: "foe-grub", file: path.join(ROOT, "assets", "snowlab", "foe", "grub.png") },
];

function sha(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

/** 从 html 里取出所有内嵌块：key → (base64 字符串, 原始字节) */
function readBlocks(text) {
  const out = {};
  const re = /<script id="art-([a-z-]+)" type="text\/plain">data:[^;]+;base64,([A-Za-z0-9+/=]+)<\/script>/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = Buffer.from(m[2], "base64");
    out[m[1]] = { b64: m[2], raw };
  }
  return out;
}

function buildBlock(key, buf) {
  return '<script id="art-' + key + '" type="text/plain">data:image/png;base64,' +
    buf.toString("base64") + "</script>";
}

const text = fs.readFileSync(HTML, "utf8");   /* 文件是 LF，readFileSync 不转换行尾 */
const check = process.argv.includes("--check");
const blocks = readBlocks(text);

let bad = 0;
if (check) {
  for (const { key, file } of KEYS) {
    const buf = fs.readFileSync(file);
    const b = blocks[key];
    if (!b) { console.log("✗ 缺内嵌块 art-" + key); bad++; continue; }
    const ok = sha(b.raw) === sha(buf);
    if (!ok) { console.log("✗ art-" + key + " 与 " + path.relative(ROOT, file) + " 不一致（改完图忘了跑 _inline-art.js）"); bad++; }
    else console.log("✓ art-" + key + "  " + Math.round(buf.length / 1024) + "KB  sha " + sha(buf).slice(0, 12));
  }
  process.exit(bad ? 1 : 0);
}

/* ---- 生成：整块删旧再插新，插在 art-bg 之后 ---- */
let body = text;
const i0 = body.indexOf(BEGIN), i1 = body.indexOf(END);
if (i0 >= 0 && i1 > i0) body = body.slice(0, i0) + body.slice(i1 + END.length);

const region = "\n" + BEGIN + "\n" +
  KEYS.map(({ key, file }) => buildBlock(key, fs.readFileSync(file))).join("\n") +
  "\n" + END;

/* 插在 art-bg 那一行的末尾（它是一整行，后面紧跟 `<script>`） */
const bgLine = body.indexOf('<script id="art-bg"');
const bgEnd = body.indexOf("\n", bgLine);
if (bgLine < 0 || bgEnd < 0) { console.error("找不到 art-bg 那一段，html 结构变了？"); process.exit(1); }
body = body.slice(0, bgEnd) + region + body.slice(bgEnd);

fs.writeFileSync(HTML, body, "utf8");

let total = 0;
for (const { key, file } of KEYS) {
  const kb = Math.round(fs.statSync(file).size / 1024);
  total += kb;
  console.log("  内嵌 art-" + key + "  " + kb + "KB");
}
console.log("已写入 " + path.relative(ROOT, HTML) + "（新增 base64 ≈ " +
  Math.round(total * 1.37) + "KB，当前文件 " + Math.round(fs.statSync(HTML).size / 1024) + "KB）");
