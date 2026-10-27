/* 60 层指纹 —— 改生成器前后各跑一次：
     地形哈希必须**一字不差**（地形是"记住这一层"的载体，不许漂移）；
     波次哈希变化是预期的（巢室生态就是来改它的）。
   用法：node tools/_nest-hash.js [输出文件] */
const { boot } = require("./grove-env.js");
const crypto = require("crypto");
const fs = require("fs");
const G = boot().GROVE;
const ter = [], wav = [];
for (let d = 1; d <= 60; d++) {
  const L = G.nestLevel(d, (d * 7919) >>> 0).level;
  ter.push([d,
    L.plats.map(p => [p.x, p.y, p.w].join(",")).join("|"),
    (L.pits || []).map(p => [p.x, p.w, p.kind].join(",")).join("|"),
    (L.ramps || []).map(p => [p.x, p.w, p.yL, p.yR].join(",")).join("|"),
    (L.chasms || []).map(c => [c.x, c.w].join(",")).join("|"),
    L.camp ? L.camp.x : "-", L.spawn.x, L.goal, L.collect || 0,
  ].join("#"));
  wav.push([d, (L.waves || []).map(w => w.map(f => f.foe + f.x).join(",")).join("|"),
    L.brood ? L.brood.id : "-", (L.pods || []).map(p => p.x).join(",")].join("#"));
}
const h = (s) => crypto.createHash("sha256").update(s).digest("hex");
console.log("地形 " + h(ter.join("\n")));
console.log("波次 " + h(wav.join("\n")));
if (process.argv[2]) fs.writeFileSync(process.argv[2], ter.join("\n") + "\n----\n" + wav.join("\n"));
