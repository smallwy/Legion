/* 一次性诊断：平地 / 凹槽里的球到底能不能撞到箱子。

   用户第 3 条：「这种1级平面 球很难撞击到　最好想想机制上去规避」。
   先把四种站位摆出来量，别猜：
     ① 开阔平地，玩家推球撞一排 1 格矮箱        —— 能碎几口
     ② 球卡在 1 格宽凹槽里，玩家站在旁边的箱顶上推
     ③ 球卡在 1 格宽凹槽里，玩家也在槽里推
     ④ 大球（r=46）在 1 格宽凹槽里推
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const PROTO = path.join(__dirname, "..", "prototype", "snowlab.html");
const html = fs.readFileSync(PROTO, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const w = dom.window;
w.HTMLCanvasElement.prototype.getContext = () => null;
w.requestAnimationFrame = () => 0;
w.eval(m[1]);
const L = w.SNOWLAB, DT = 1 / 60;

let S = L.S, NUM = L.NUM;
function mkBox(x, y, mat) {
  const b = { x, y, w: 48, h: 48, mat, hp: NUM.box[mat].hp, dead: false, hitT: 0, taught: false, fell: 0, frost: false, loot: false, barrel: false };
  S.boxes.push(b); return b;
}

/** 造一块干净的平地：拿第 k 层地板，清掉 x∈[x0,x1] 里的箱子和地形 */
function stage(k, x0, x1) {
  L.reset(3);
  S = L.S;
  for (let i = 0; i < 20; i++) L.step(DT);
  const fl = L.FLOORS[k];
  S.plats = S.plats.filter(p => !(p.x + p.w > x0 && p.x < x1 && p.y !== fl)                  // 清地形
    && !(p.kind === 'ramp' && p.x + p.w > x0 && p.x < x1));
  for (const b of S.boxes) if (b.x + b.w > x0 - 200 && b.x < x1 + 200 && Math.abs(b.y - fl) < 260) b.dead = true;
  for (const f of S.foes) f.dead = true;
  for (const b of S.balls) b.dead = true;
  S.balls = [];
  return fl;
}

function report(tag, boxes, ball, p, fl) {
  const alive = boxes.filter(b => !b.dead).length;
  console.log("  " + tag);

  console.log("     碎箱 " + (boxes.length - alive) + "/" + boxes.length +
    "  球终点 x=" + ball.x.toFixed(0) + " vx=" + ball.vx.toFixed(0) +
    "  球底相对地面 " + (ball.y + ball.r - fl).toFixed(1) +
    "  chain=" + ball.chain + "  player x=" + p.x.toFixed(0) + " 底=" + (p.y + p.h - fl).toFixed(0));
}

/* ① 开阔平地：球 ← 玩家，右前方一排 5 口 1 格矮箱 */
console.log("① 开阔平地，推球撞一排矮箱");
{
  const x0 = 120, fl = stage(0, 60, 900);
  const boxes = [];
  for (let i = 0; i < 5; i++) boxes.push(mkBox(x0 + 180 + i * 48, fl - 48, 'wood'));
  const p = S.p;
  p.x = x0; p.y = fl - p.h; p.vx = 0; p.vy = 0; p.onGround = true;
  const ball = L.spawnBall(x0 + 70, fl - 22, 0, 1);
  for (const kk in S.keys) delete S.keys[kk];
  S.keys['d'] = true;
  for (let i = 0; i < 200; i++) L.step(DT);
  report("结果：", boxes, ball, p, fl);
}

/* ② 球卡在 1 格宽凹槽（两侧 1 格矮箱），玩家站在左边箱顶上往右推 */
console.log("\n② 1 格宽凹槽，玩家站箱顶推");
{
  const x0 = 240, fl = stage(0, 60, 900);
  const nb = mkBox(x0, fl - 48, 'wood');        // 左侧箱（玩家站它上面）
  const boxes = [nb];
  for (let i = 0; i < 3; i++) boxes.push(mkBox(x0 + 96 + i * 48, fl - 48, 'wood'));   // 右侧一排
  const p = S.p;
  p.x = x0 + 2; p.y = fl - 48 - p.h; p.vx = 0; p.vy = 0; p.onGround = true;
  const ball = L.spawnBall(x0 + 66, fl - 22, 0, 1);   // 凹槽里（x0+48 ~ x0+96）
  for (const kk in S.keys) delete S.keys[kk];
  S.keys['d'] = true;
  let pushedAt = -1;
  for (let i = 0; i < 200; i++) {
    L.step(DT);
    if (pushedAt < 0 && Math.abs(ball.vx) > 1) pushedAt = i;
  }
  console.log("  起推帧:", pushedAt);
  report("结果：", boxes, ball, p, fl);
}

/* ③ 球卡在凹槽里，玩家也在槽里（槽宽 1 列，人 45 宽，几乎塞满） */
console.log("\n③ 1 格宽凹槽，玩家在槽里往右推");
{
  const x0 = 240, fl = stage(0, 60, 900);
  const boxes = [];
  boxes.push(mkBox(x0, fl - 48, 'wood'));
  for (let i = 0; i < 3; i++) boxes.push(mkBox(x0 + 96 + i * 48, fl - 48, 'wood'));
  const p = S.p;
  p.x = x0 + 1; p.y = fl - p.h; p.vx = 0; p.vy = 0; p.onGround = true;
  const ball = L.spawnBall(x0 + 66, fl - 22, 0, 1);
  for (const kk in S.keys) delete S.keys[kk];
  S.keys['d'] = true;
  let pushedAt = -1;
  for (let i = 0; i < 200; i++) {
    L.step(DT);
    if (pushedAt < 0 && Math.abs(ball.vx) > 1) pushedAt = i;
  }
  console.log("  起推帧:", pushedAt);
  report("结果：", boxes, ball, p, fl);
}

/* ④ 大球在 1 格宽凹槽里 */
console.log("\n④ 1 格宽凹槽，特大球（r=46）");
{
  const x0 = 240, fl = stage(0, 60, 900);
  const boxes = [];
  boxes.push(mkBox(x0, fl - 48, 'wood'));
  for (let i = 0; i < 3; i++) boxes.push(mkBox(x0 + 96 + i * 48, fl - 48, 'wood'));
  const p = S.p;
  p.x = x0 + 2; p.y = fl - 48 - p.h; p.vx = 0; p.vy = 0; p.onGround = true;
  const ball = L.spawnBall(x0 + 70, fl - 46, 0, 100);   // 满吸收
  console.log("  球 r =", ball.r.toFixed(1));
  for (const kk in S.keys) delete S.keys[kk];
  S.keys['d'] = true;
  let pushedAt = -1;
  for (let i = 0; i < 200; i++) {
    L.step(DT);
    if (pushedAt < 0 && Math.abs(ball.vx) > 1) pushedAt = i;
  }
  console.log("  起推帧:", pushedAt);
  report("结果：", boxes, ball, p, fl);
}
