/* 把一个「单帧凭空上移」事件逐帧打印出来。
   用法：node tools/_dump-lift.js <种子> [帧数] */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(process.env.PROTO || path.join(ROOT, "prototype/snowlab.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () { return null; };
window.requestAnimationFrame = () => 0;
window.eval(m[1]);
const L = window.SNOWLAB, S = L.S;
const DT = 1 / 60;
const seed = Number(process.argv[2] || 3);
const FR = Number(process.argv[3] || 360);

L.newLevel(seed);
const prev = new Map();
for (const f of S.foes) prev.set(f, { x: f.x, y: f.y, vy: f.vy, og: f.onGround, kind: f.kind });

for (let fr = 0; fr < FR; fr++) {
  for (const f of S.foes) prev.set(f, { x: f.x, y: f.y, vy: f.vy, og: f.onGround, kind: f.kind, dead: f.dead });
  L.step(DT);
  for (const f of S.foes) {
    const b = prev.get(f);
    if (!b) continue;
    const dy = f.y - b.y;
    if (dy < -4 && f.vy >= -1) {
      console.log(`帧 ${fr}  ${b.kind}/${f.breed}  y ${b.y.toFixed(1)} → ${f.y.toFixed(1)}  (dy ${dy.toFixed(1)})`);
      console.log(`        x ${b.x.toFixed(1)} → ${f.x.toFixed(1)}   vx ${(f.vx||0).toFixed(1)} vy ${(f.vy||0).toFixed(1)}`);
      console.log(`        onGround ${b.og} → ${f.onGround}   dead ${!!f.dead}   state ${f.state || '-'}   actor ${f.actor || '-'}`);
      console.log(`        玩家 x ${S.p.x.toFixed(0)} y ${S.p.y.toFixed(0)}   球 ${S.balls.length}`);
    }
  }
}
