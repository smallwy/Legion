/* ============================================================================
   _snowlab-art.js —— snowlab 的贴图清单（所有出图工具的唯一入口）
   ----------------------------------------------------------------------------
   **为什么抽出来。** 以前每个出图工具各抄一段"遍历 grove/pet 目录塞进 setArt"。
   加了敌人贴图之后就有三份要改，漏一份就出现"这张图上有贴图、那张没有"，
   而且不会报错 —— 只是静默退回代码图形。这类不一致只能靠"只有一个入口"防。

   用法：
     const { loadArt } = require("./_snowlab-art");
     const art = await loadArt();
     L.setArt(art.map);
     console.log(art.report);          // 给人看的加载报告

   **加载失败要吭声，不要静默退回。** 代码图形画得也不难看，图上不容易看出来，
   很容易把"没加载上"当成"就长这样"，白量半天。
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { loadImage } = require("@napi-rs/canvas");

const ROOT = path.join(__dirname, "..");
const DIRS = [
  /* 主角六只：从 ui/home 的立绘收缩出来的游戏内版本，和 GroveBattle 的
     ART_MANIFEST 同一套名字（`pet-<id>`）。 */
  { dir: path.join(ROOT, "assets", "resources", "grove", "pet"), prefix: "pet-" },
  /* 敌人三只：从 art/02-concept/02-foes 的三视图里抠出来的（tools/_cut-foe-sheet.js）。
     放在 assets/snowlab 而不是 assets/resources/grove —— 后者是 grove 那个原型的
     资源，名字（boar/bug/crow/larva）和这里的 breed（moss/fang/grub）不是一套，
     混在一处早晚要搞错"这张图是谁的"。 */
  { dir: path.join(ROOT, "assets", "snowlab", "foe"), prefix: "foe-" },
];

async function loadArt() {
  const map = {}, lines = [], missing = [];
  for (const { dir, prefix } of DIRS) {
    if (!fs.existsSync(dir)) { missing.push(path.relative(ROOT, dir)); continue; }
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".png")).sort();
    for (const f of files) {
      map[prefix + f.replace(/\.png$/, "")] = await loadImage(path.join(dir, f));
    }
    lines.push(prefix + "* " + files.length + " 张");
  }
  const report = lines.join("，") + (missing.length ? "；缺目录：" + missing.join(" ") : "");
  return { map, report };
}

module.exports = { loadArt };
