/* 把 client/assets/snowlab/bg-*.jpg 以 base64 内嵌进 snowlab.html 的
   `<script id="art-bg[-<场景>]">` 块里。

   **为什么是内嵌而不是外链**：这份原型的定位是"双击就能玩、任何预览里
   都长一样"。外链的兄弟文件在 preview 的 static-html 服务里拿不到，
   一 404 就静默回退到程序化天空 —— 看起来像"改了没生效"，最难查。
   37KB 的 JPEG base64 之后 50KB，换一个"永远在"是划算的。

   **2026-10-30 起按场景多张**（用户：要"很多场景都可以"）。
   块 id 的规矩：`snow` 用历史的 `art-bg`（`_inline-art.js` 锚着它，
   改 id 会让角色贴图块插不进来），其余场景一律 `art-bg-<场景 id>`。
   这个映射和原型里的 `bgElId()` 必须一致，两边改一处就得同步。

   用法：node client/tools/_snowlab-embed-bg.js
   =========================================================================== */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'prototype', 'snowlab.html');
const DIR = path.join(ROOT, 'assets', 'snowlab');

/* 文件名 → 场景 id。**加一张图就在这里加一行** —— 不写的话脚本不知道
   这张属于哪个场景，做出来的块 id 是错的，而错 id 的块浏览器会照原样
   解析、drawSky 也照原样看不到它，等于内嵌了个空气。 */
const FILES = [
  ['bg-surface.jpg', 'snow'],
  ['bg-forge.jpg', 'ember'],
  ['bg-spore.jpg', 'spore'],
  ['bg-dune.jpg', 'dune'],
];

const bgElId = id => (id === 'snow' ? 'art-bg' : 'art-bg-' + id);

let html = fs.readFileSync(FILE, 'utf8');
let total = 0;
for (const [file, id] of FILES) {
  const abs = path.join(DIR, file);
  if (!fs.existsSync(abs)) { console.log('跳过（没有这个文件）：' + file); continue; }
  const b64 = fs.readFileSync(abs).toString('base64');
  const uri = 'data:image/jpeg;base64,' + b64;
  const elId = bgElId(id);
  const block = '<script id="' + elId + '" type="text/plain">' + uri + '</script>';
  /* 只匹配**自己那一块**：`art-bg` 后面必须紧跟引号或 `>`，
     否则 `art-bg-ember` 会被 `art-bg` 的规则抢走，两块互相覆盖。 */
  const RE = new RegExp('<script id="' + elId + '" type="text/plain">[\\s\\S]*?</script>');
  if (RE.test(html)) {
    html = html.replace(RE, block);
    console.log('替换 ' + elId + ' ← ' + file + '（' + (b64.length / 1024).toFixed(0) + 'KB）');
  } else {
    /* 新场景第一次内嵌：插在上一块后面，保持"所有 art-* 块挨在一起"。 */
    const anchor = html.indexOf('</script>', html.lastIndexOf('<script id="art-'));
    if (anchor < 0) { console.error('找不到 art-* 块，html 结构变了？'); process.exit(1); }
    const at = anchor + '</script>'.length;
    html = html.slice(0, at) + '\n' + block + html.slice(at);
    console.log('新增 ' + elId + ' ← ' + file + '（' + (b64.length / 1024).toFixed(0) + 'KB）');
  }
  total += b64.length;
}
fs.writeFileSync(FILE, html);
console.log('内嵌完成：共 ' + (total / 1024).toFixed(0) + 'KB base64');
