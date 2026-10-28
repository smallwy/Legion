/* 把 client/assets/snowlab/bg-*.jpg 以 base64 内嵌进 snowlab.html 的
   `<script id="art-bg" type="text/plain">` 块里。

   **为什么是内嵌而不是外链**：这份原型的定位是"双击就能玩、任何预览里
   都长一样"。外链的兄弟文件在 preview 的 static-html 服务里拿不到，
   一 404 就静默回退到程序化天空 —— 看起来像"改了没生效"，最难查。
   37KB 的 JPEG base64 之后 50KB，换一个"永远在"是划算的。

   用法：node client/tools/_snowlab-embed-bg.js
   =========================================================================== */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'prototype', 'snowlab.html');
const IMG = path.join(ROOT, 'assets', 'snowlab', 'bg-surface.jpg');

const b64 = fs.readFileSync(IMG).toString('base64');
const uri = 'data:image/jpeg;base64,' + b64;
let html = fs.readFileSync(FILE, 'utf8');

const RE = /<script id="art-bg"[^>]*>[\s\S]*?<\/script>/;
const block = '<script id="art-bg" type="text/plain">' + uri + '</script>';
if (RE.test(html)) html = html.replace(RE, block);
else html = html.replace('<div id="wrap"><canvas id="cv"></canvas></div>',
  '<div id="wrap"><canvas id="cv"></canvas></div>\n' + block);
fs.writeFileSync(FILE, html);
console.log('内嵌完成：' + (b64.length / 1024).toFixed(0) + 'KB base64');
