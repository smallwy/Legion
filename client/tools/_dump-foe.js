/* 单只怪的逐帧时间线 + 它身下的实体。用来看「y 突然变小」是谁干的。
   用法：node tools/_dump-foe.js <种子> <breed> [帧数] */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "prototype/snowlab.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB, S = L.S;
const DT = 1 / 60;
const seed = Number(process.argv[2] || 3);
const breed = process.argv[3] || "moss";
const FR = Number(process.argv[4] || 200);

L.newLevel(seed);
const foe = S.foes.find(f => f.breed === breed);
if (!foe) { console.log("这关没有 " + breed + "，有：" + S.foes.map(f => f.breed).join("/")); process.exit(1); }
console.log("目标 " + breed + " 初始 x " + foe.x.toFixed(1) + " y " + foe.y.toFixed(1) +
  " w/h " + (foe.w || foe.r) + "/" + foe.h + "  homeX " + foe.homeX);

let prevY = foe.y, prevVy = foe.vy;
for (let fr = 0; fr < FR; fr++) {
  L.step(DT);
  const dy = foe.y - prevY;
  if (Math.abs(dy) > 1.5 || fr < 3) {
    /* 它脚底正下方有什么 */
    const cx = foe.x + foe.w / 2, foot = foe.y + foe.h;
    const near = L.S.level.terrain
      .filter(t => cx >= t.x - 4 && cx <= t.x + t.w + 4 && t.y >= foot - 30 && t.y <= foot + 60)
      .map(t => `[x${Math.round(t.x)} w${Math.round(t.w)} y${Math.round(t.y)} k${t.kind}]`)
      .join(" ");
    console.log(
      "帧" + String(fr).padStart(3) +
      "  y " + prevY.toFixed(1) + "→" + foe.y.toFixed(1) + " (dy " + dy.toFixed(1) + ")" +
      "  x " + foe.x.toFixed(1) +
      "  vy " + prevVy.toFixed(1) + "→" + foe.vy.toFixed(1) +
      "  og " + foe.onGround +
      "  下方 " + (near || "-")
    );
  }
  prevY = foe.y; prevVy = foe.vy;
}
