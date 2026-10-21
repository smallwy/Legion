/* ============================================================================
   把 game.src.html 构建成自包含的 game.html
   ----------------------------------------------------------------------------
   为什么必须这么做：

   game.src.html 用 `../shots/xxx.png` 引外部图。这在两种环境里会全部 404：
     ① file:// 之外的一切预览器（把服务根挂在 prototype/ 上，`../` 越界被拦）
     ② 把文件发给别人、或换台机器

   症状特别有欺骗性 —— HTML/CSS/JS 全部正常，只有图片静默消失，
   画面变成一片淡黄 + 一堆悬空控件，看起来像"设计做漏了"，
   实际是资源没到。

   所以交付形态必须是单文件：图片全部压成 WebP 内联。780KB 左右。

   用法：
     node _build-game.js            # 构建
     node _build-game.js --check    # 只报体积，不写文件

   以后要改界面 -> 改 game.src.html -> 跑一次本脚本 -> 交付 game.html
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const SRC = path.join(HERE, "game.src.html");
const OUT = path.join(HERE, "game.html");
const CHECK = process.argv.includes("--check");

const PETS = [
  "sugar-stand", "nian-gao-dog", "tuan-zi-ham",
  "xue-tuan-rab", "dou-nai-ox", "xing-xie-fox",
];

/* 界面图标：这些直接写在 CSS 的 url() 与 HTML 的 background 里，
   不进 ASSET 表，构建时按路径字符串整体替换。
   显示尺寸最大 21px（徽标里的图标框），×2 DPI 也只要 42，给 96 已经很宽裕。 */
const ICONS = ["hammer", "paw", "paw-red", "pot", "mail", "flag",
  "gear", "book", "apple", "log", "coin", "lock"];

/* 内联后的 data URI 段数必须**恰好**等于 1 + 6 + 6 + 12 = 25。
   多出来就说明某个资源同时出现在「表」和「静态引用」里，存了两份。
   这个坑已经踩过三次（背景 170KB、11 个图标、再 11 个图标），所以改成硬断言。 */
const EXPECT_URIS = 1 + PETS.length * 2 + ICONS.length;

/* 显示尺寸决定内联分辨率：
   - 背景铺满 1280×853 的舞台，1080p 满屏时舞台放大 1.5× → 原尺寸 1536 不缩
   - 场景里立绘最高 h=146，舞台 1.5× = 219px；过场 210 → 315px；再乘 2×DPI = 630
     所以 640 是够的，再大是白烧体积
   - 头像最大显示 46px（出战卡 100px 会 -27px 裁切）→ 160 足够 */
async function toDataURI(file, maxH, quality) {
  const img = await loadImage(file);
  let w = img.width, h = img.height;
  if (maxH && h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, w, h);
  const buf = c.toBuffer("image/webp", quality);
  return { uri: "data:image/webp;base64," + buf.toString("base64"), kb: buf.length / 1024, w, h };
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error("✗ 找不到 game.src.html —— 源文件丢了，构建中止");
    process.exit(1);
  }

  const t0 = Date.now();
  const jobs = [];

  // 背景：不缩，q=88（大面积渐变，质量低了会有色带）
  jobs.push([["bg"], path.join(ROOT, "shots", "bg", "home-bg@v2.png"), 0, 88]);

  for (const id of PETS) {
    jobs.push([["pet", id], path.join(ROOT, "shots", "ai", `${id}@v1.png`), 640, 92]);
    jobs.push([["head", id], path.join(ROOT, "shots", "ai", "head", `${id}-head@v1.png`), 160, 90]);
  }
  for (const name of ICONS) {
    jobs.push([["icon", name], path.join(ROOT, "assets", "ui", "icons", `${name}.png`), 96, 90]);
  }

  const A = { pet: {}, head: {} };   // 背景与图标都不进表：它们只出现在静态属性/CSS 里
  const iconURIs = {};               //   进表就会存两份，白占体积（已经踩过两次）
  let bgURI = "";
  let total = 0;
  const lines = [];

  for (const [keyPath, file, maxH, q] of jobs) {
    if (!fs.existsSync(file)) {
      console.error("✗ 缺资源：" + file);
      process.exit(1);
    }
    const r = await toDataURI(file, maxH, q);
    if (keyPath[0] === "bg") bgURI = r.uri;
    else if (keyPath[0] === "icon") iconURIs[keyPath[1]] = r.uri;
    else A[keyPath[0]][keyPath[1]] = r.uri;
    total += r.kb;
    lines.push(`  ${path.basename(file).padEnd(26)} ${String(r.w + "×" + r.h).padStart(10)}  ${r.kb.toFixed(0).padStart(5)} KB`);
  }

  console.log("资源压缩：");
  console.log(lines.join("\n"));
  console.log(`  ${"原始合计".padEnd(24)} ${"".padStart(10)}  ${total.toFixed(0).padStart(5)} KB`);
  console.log(`  base64 后约 ${(total * 1.37).toFixed(0)} KB（+33%）`);

  if (CHECK) { console.log("\n--check 模式，未写文件"); return; }

  let s = fs.readFileSync(SRC, "utf8");
  const before = s.length;
  const miss = [];
  const rep = (from, to, tag) => {
    const n = s.split(from).length - 1;
    if (n === 0) { miss.push(tag); return; }
    s = s.split(from).join(to);
  };

  /* ① 背景：静态属性，直接塞 data URI。
        这里用**不认版本号**的正则 —— 背景图从 v1 换到 v2 时，
        写死 "home-bg@v1.png" 的字符串替换会静默漏掉背景，
        最后只表现为"data URI 少一段"，完全看不出是背景丢了。 */
  const BG_RE = /src="\.\.\/shots\/bg\/home-bg@v\d+\.png"/;
  if (!BG_RE.test(s)) miss.push("背景 src");
  else s = s.replace(BG_RE, `src="${bgURI}"`);

  // ② 立绘：三处模板字符串，整体换成查表
  rep("`../shots/ai/${p.id}@v1.png`", "ASSET.pet[p.id]", "立绘（p.id）");

  // ③ 头像：在模板字符串内部，保留 ${} 插值
  rep("../shots/ai/head/${p.id}-head@v1.png",     "${ASSET.head[p.id]}",     "头像（p.id）");
  rep("../shots/ai/head/${active.id}-head@v1.png", "${ASSET.head[active.id]}", "头像（active.id）");

  // ③b 图标：它们在 CSS url() 和 HTML style 里，按路径字符串整体替换
  let iconHits = 0;
  for (const name of ICONS) {
    const from = `../assets/ui/icons/${name}.png`;
    const n = s.split(from).length - 1;
    iconHits += n;
    if (n) s = s.split(from).join(iconURIs[name]);
  }

  // ④ 资源表注入到唯一的 <script> 开头
  const table = "const ASSET = " + JSON.stringify(A) + ";\n";
  const anchor = "<script>\n";
  if (!s.includes(anchor)) {
    console.error("✗ 找不到 `<script>` 锚点，构建中止");
    process.exit(1);
  }
  s = s.replace(anchor, anchor + table, 1);

  // ⑤ 兜底哨兵：内联之后本不该再有加载失败。真失败了就喊出来，
  //    不要像上一版那样静默变空白 —— 那会被误读成"设计漏画了"。
  rep(
    `const loadImg = (src) => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
});`,
    `let assetFails = 0;
const loadImg = (src) => new Promise((res, rej) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => {
    assetFails++;
    const el = document.getElementById("assetErr");
    if (el) {
      el.style.display = "block";
      el.textContent = "⚠ 有 " + assetFails + " 个资源没加载出来 —— 这份 HTML 不是自包含版，请重跑 _build-game.js";
    }
    rej(new Error("asset load failed"));
  };
  i.src = src;
});`,
    "加载失败哨兵"
  );

  if (miss.length) console.log("⚠ 未命中的替换（源文件已改过？）: " + miss.join(" / "));

  // ⑥ 硬断言：data URI 总量 + 每段唯一
  const uriCount = s.split("data:image/webp;base64,").length - 1;
  const expectURIs = 1 + PETS.length * 2 + iconHits;
  const dup = [];
  const seenURI = new Set();
  for (const m of s.matchAll(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g)) {
    if (seenURI.has(m[0])) dup.push(m[0].length);
    else seenURI.add(m[0]);
  }
  if (uriCount !== expectURIs || dup.length) {
    console.error(`\n✗ data URI 校验失败：段数 ${uriCount}，应为 ${expectURIs}；重复 ${dup.length} 段`);
    console.error("  先查 ASSET 表与静态引用是否指向同一资源，再查同图标是否被引用两次");
    process.exit(1);
  }

  /* ⑦ 写一份"第 i 段是什么"的自描述清单。
     验证脚本要按名字取图，不能按下标猜 —— 图标散落在 CSS 和 HTML 里，
     插入位置一改，pets 就不再是 imgs[1..6]，按下标取会拼出一张胡说八道的图。
     这行注释只在源码里，不影响渲染。 */
  const nameByURI = new Map();
  nameByURI.set(bgURI, "bg");
  for (const id of PETS) {
    nameByURI.set(A.pet[id], "pet/" + id);
    nameByURI.set(A.head[id], "head/" + id);
  }
  for (const n of ICONS) if (iconURIs[n]) nameByURI.set(iconURIs[n], "icon/" + n);
  const order = [];
  for (const m of s.matchAll(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g)) {
    order.push(nameByURI.get(m[0]) || "?");
  }
  s = `<!-- ASSET_ORDER: ${order.join(",")} -->\n` + s;

  fs.writeFileSync(OUT, s, "utf8");
  const kb = (s.length / 1024).toFixed(0);
  console.log(`\n✓ game.html 已生成  ${kb} KB（源 ${(before / 1024).toFixed(0)} KB，含图 ${((s.length - before) / 1024).toFixed(0)} KB）`);
  console.log(`  图标替换命中 ${iconHits} 处 / data URI ${uriCount} 段，无重复`);
  console.log(`  耗时 ${Date.now() - t0} ms`);
  if (miss.length) console.log("  ⚠ 未命中的替换（源文件已改过？）: " + miss.join(" / "));
})();
