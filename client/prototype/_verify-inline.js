/* ============================================================================
   内联完整性校验
   ----------------------------------------------------------------------------
   浏览器遇到坏 data URI 和遇到 404 是一样的症状：**静默空图**。
   所以"文件里有 base64"不等于"图能用"，必须真的解码一遍。

   取图一律按 game.html 首行的 ASSET_ORDER 注释走名字，不按下标猜位置 ——
   图标散落在 CSS 和 HTML 里，插入位置一改，pets 就不在 imgs[1..6]，
   按下标取会拼出一张"屋顶站着豆奶"的胡说图（已经踩过）。

   用法：node _verify-inline.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const FILE = path.join(__dirname, "game.html");
const html = fs.readFileSync(FILE, "utf8");

/* ---------- 1. 顺序声明 ---------- */
const om = html.match(/<!--\s*ASSET_ORDER:\s*([^>]*?)\s*-->/);
if (!om) {
  console.error("✗ 找不到 ASSET_ORDER 注释 —— 这份 game.html 不是 _build-game.js 产出的？");
  process.exit(1);
}
const order = om[1].split(",").map(s => s.trim());
const uris = [...html.matchAll(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/g)].map(m => m[1]);
console.log(`ASSET_ORDER ${order.length} 项 / 实际内联 ${uris.length} 段`);
if (order.length !== uris.length) {
  console.error("✗ 声明数与实际段数不一致");
  process.exit(1);
}
if (order.includes("?")) {
  console.error("✗ 有无法归名的资源段：" + order.join(","));
  process.exit(1);
}

/* ---------- 2. 逐段解码 ---------- */
let bad = 0;
const byName = {};

(async () => {
  for (let i = 0; i < uris.length; i++) {
    const buf = Buffer.from(uris[i], "base64");
    const riff = buf.slice(0, 4).toString("ascii");
    const webp = buf.slice(8, 12).toString("ascii");
    let ok = riff === "RIFF" && webp === "WEBP";
    let dim = "?", im = null;
    try {
      im = await loadImage(buf);
      dim = im.width + "×" + im.height;
      byName[order[i]] = im;
    } catch (e) {
      ok = false; dim = "解码失败";
    }
    if (!ok) bad++;
    if (!ok) console.log(`  ✗ ${order[i].padEnd(22)} ${dim}`);
    else if (i < 3 || order[i].startsWith("pet/") || order[i].startsWith("head/")) {
      console.log(`  ✓ ${order[i].padEnd(22)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB  ${dim}`);
    }
  }
  console.log(`  合计 ${uris.length} 段，损坏 ${bad} 段`);

  /* ---------- 3. 还原一张画面图 ----------
     用的坐标必须和 game.src.html 的 PETS 完全一致，否则还原图不能用来判断对错。 */
  const PETS = [
    ["sugar-stand", 490, 156, 82],
    ["nian-gao-dog", 250, 600, 146],
    ["tuan-zi-ham", 716, 598, 136],
    ["xue-tuan-rab", 450, 596, 126],
    ["dou-nai-ox", 862, 592, 136],
    ["xing-xie-fox", 1148, 596, 112],
  ];
  const W = 1280, H = 720;
  const cv = createCanvas(W, H), g = cv.getContext("2d");
  g.drawImage(byName["bg"], 0, -40, 1280, 853);   // 与 CSS 的 #bg 同一套裁切参数
  for (const [id, cx, footY, h] of PETS) {
    const im = byName["pet/" + id];
    const w = h * (im.width / im.height);
    const srx = Math.max(10, w * 0.34), sry = Math.max(4, h * 0.052);
    g.fillStyle = "rgba(74,44,24,.18)";
    g.beginPath(); g.ellipse(cx, footY, srx, sry, 0, 0, 6.2832); g.fill();
    g.drawImage(im, cx - w / 2, footY - h, w, h);
  }
  // 底带：头像 + 图标，确认两类资产都能用
  g.fillStyle = "rgba(20,12,6,.74)"; g.fillRect(0, H - 118, W, 118);
  let x = 40;
  for (const [id] of PETS) {
    const cx = x + 34, cy = H - 62;
    g.save(); g.beginPath(); g.arc(cx, cy, 34, 0, 6.2832); g.clip();
    g.fillStyle = "#FFF6E4"; g.fillRect(cx - 34, cy - 34, 68, 68);
    g.drawImage(byName["head/" + id], cx - 37, cy - 37, 74, 74);
    g.restore();
    g.strokeStyle = "rgba(255,246,228,.62)"; g.lineWidth = 2.4;
    g.beginPath(); g.arc(cx, cy, 34, 0, 6.2832); g.stroke();
    x += 82;
  }
  const icons = Object.keys(byName).filter(k => k.startsWith("icon/") && k !== "icon/paw-red");
  x = 600;
  for (const k of icons) {
    const name = k.slice(5);
    const cx = x + 24, cy = H - 62;
    g.beginPath(); g.arc(cx, cy, 24, 0, 6.2832);
    g.fillStyle = "rgba(255,252,244,.94)"; g.fill();
    g.strokeStyle = "rgba(110,70,44,.82)"; g.lineWidth = 2.4; g.stroke();
    g.drawImage(byName[k], cx - 10.5, cy - 10.5, 21, 21);   // 徽标里的真实显示尺寸
    x += 54;
  }
  g.fillStyle = "#FFF6E4"; g.font = "bold 17px Microsoft YaHei"; g.textAlign = "left";
  g.fillText(`从内联 base64 还原的画面 —— 能拼出这张就说明 ${uris.length} 段数据全部有效`, 40, H - 118 + 32);
  g.font = "12px Microsoft YaHei"; g.fillStyle = "rgba(255,246,228,.72)";
  g.fillText("立绘坐标与 game.src.html 的 PETS 一致；底排图标按徽标的真实显示尺寸 21px 绘制", 40, H - 118 + 54);
  fs.writeFileSync(path.join(__dirname, "..", "shots", "_inline-verify.png"), cv.toBuffer("image/png"));

  /* ---------- 4. 反向检查：不该再有任何外部资源路径 ---------- */
  const externals = [
    ...html.matchAll(/(?:src|href)="(\.\.[^"]*)"/g),
    ...html.matchAll(/url\((\.\.[^)]*)\)/g),
  ].map(m => m[1]);
  if (externals.length) {
    console.log("\n✗ 仍存在外部相对路径（预览器里必 404）：");
    for (const e of [...new Set(externals)]) console.log("   " + e);
    process.exit(1);
  }
  console.log("✓ 无外部相对路径");

  console.log("\n" + "=".repeat(56));
  console.log(bad === 0 ? `✓ ${uris.length} 段全部有效，已输出还原图 shots/_inline-verify.png`
                       : `✗ ${bad} 段损坏`);
  process.exit(bad ? 1 : 0);
})();
