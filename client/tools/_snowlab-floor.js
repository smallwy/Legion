/* 楼板半透 / 落球砸箱 / 推球判定 —— 2026-10-28 第四轮的三条用户要求。

   用户原话：
     ① 「这个横梁我方是可以跳上去的　也可以下来　只要没箱子
        　不需要在空档里才能跳」
     ② 「球掉下去 是可以杂碎箱子」
     ③ 「这种1级平面 球很难撞击到　最好想想机制上去规避」

   这里守的就是这三条，加上两条"顺带不许坏"：
     · 怪不许跟着穿楼板（它们的巡逻走廊是按本层量的，上去就回不来）
     · 下落时楼板照旧接住 —— 少这条，人站在楼板上会一帧穿一帧接，闪

   跑法：NODE_PATH=<工具链 node_modules> node tools/_snowlab-floor.js
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const PROTO = process.env.PROTO || path.join(__dirname, "..", "prototype", "snowlab.html");
const html = fs.readFileSync(PROTO, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("找不到 <script>"); process.exit(1); }
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
const w = dom.window;
w.HTMLCanvasElement.prototype.getContext = () => null;
w.requestAnimationFrame = () => 0;
w.eval(m[1]);
const L = w.SNOWLAB;
const DT = 1 / 60;
let S = L.S, NUM = L.NUM;

let pass = 0, fail = 0;
const ok = (name, good, extra) => {
  console.log((good ? "  ✓ " : "  ✗ ") + name + (extra != null ? "：" + extra : ""));
  good ? pass++ : fail++;
};
const group = t => console.log("\n" + t);

const keys = () => L.S.keys;
function clearKeys() { const k = keys(); for (const x in k) delete k[x]; }
function tap(k) { const K = keys(); K[k] = true; L.step(DT); delete K[k]; }
function settle(n) { for (let i = 0; i < (n || 30); i++) L.step(DT); }

/** **量物理先清场。** 场上的怪会撞玩家（`hurtPlayer` 把 vy 打成 -320），
    一被撞就离开地面，"按 S 下跳"当然不生效 —— 那是怪的问题，不是楼板的问题。
    2026-10-28 第四轮第一次跑就是这样：5 个样本里 2 个"按 S 没反应"。 */
function quiet() {
  S = L.S;
  S.foes.length = 0;
  S.nests.length = 0;
  S.ebullets.length = 0;
}

/** 双跳：第一跳，18 帧后（最高点附近）第二跳 */
function doubleJump() {
  tap('w');
  for (let i = 0; i < 18; i++) L.step(DT);
  tap('w');
}

/** 找一块"上下两层都是完整地板"的窗口（避开所有洞口），用来做合成试验场。
    **不要用生成器的 `colHgt` 判"这格有没有箱子"** —— 它只是生成期的列模型，
    洞口的冰盖 / 井梯 / 掉下来过的箱子都和它不一致（2026-10-28 踩过：
    colHgt 说 0 的那一格，实际摞着两口冰盖）。判空间一律问活着的盒子。 */
function jumpSpot(sd, k) {
  L.reset(sd);
  settle(20);
  const lays = L.LAYERS;
  if (k < 1 || k >= lays.length) return null;
  const inner = (segs, x, w) => segs.some(s => x >= s.x + 24 && x + w <= s.x + s.w - 24);
  for (let i = 1; i <= 17; i++) {
    const x = i * 48;
    if (inner(lays[k].segs, x, 96) && inner(lays[k - 1].segs, x, 96)) return x;
  }
  return null;
}

/** 造一块干净的试验场（清掉 [x0,x1] 里这一层的箱子和地形），返回本层地板 y */
function stage(sd, k, x0, x1) {
  L.reset(sd); S = L.S;
  settle(20);
  const fl = L.FLOORS[k];
  S.plats = S.plats.filter(p => !(p.kind === 'ramp' && p.x + p.w > x0 && p.x < x1)
    && !(p.h === 34 && p.x + p.w > x0 && p.x < x1 && p.y !== fl));
  /* **清箱子的窗口要盖住"上一层"的箱子。**
     上一层的箱子摞在 fl-240 上，最高 3 格 → 底边落在 fl-288-fl-240 一带。
     第一版写 `|b.y - fl| < 260`，正好漏掉它们 —— 于是"跳不上去"的 11 个
     失败样本里，绝大多数是人一头顶在上一层的箱底上（合法行为，不是 bug）。
     窗口放到 fl-360 ~ fl+40 之后，试验场里就真的只剩楼板了。 */
  for (const b of S.boxes) if (b.x + b.w > x0 - 200 && b.x < x1 + 200 && b.y > fl - 360 && b.y < fl + 40) b.dead = true;
  for (const f of S.foes) f.dead = true;
  S.foes.length = 0;
  for (const b of S.balls) b.dead = true;
  S.balls.length = 0;
  return fl;
}

function mkBox(x, y, mat) {
  const b = {
    x, y, w: 48, h: 48, mat,
    hp: NUM.box[mat].hp, dead: false, hitT: 0, taught: false, fell: 0,
    frost: false, loot: false, barrel: false,
  };
  S.boxes.push(b); return b;
}

/* =========================================================================
   一、楼板是半透层：能跳上去、能按 S 下来
   -------------------------------------------------------------------------
   **在合成试验场上量，不在真实关卡上量。** 真关卡里"这一列干不干净"要跟
   地形、洞口、掉落的箱子、洞口的冰盖一起判 —— 第一版按 `colHgt === 0`
   取了 11 个样本，4 个失败全是选点问题（站在斜坡上、站在掉下来的箱子里），
   跟楼板没关系。合成场里就只有"一层楼板 + 240 净空"，量的东西是干净的。
   ========================================================================= */
group("一、楼板：二段跳能上、按 S 能下");
{
  let tried = 0, up = 0, stay = 0, down = 0, margin = 1e9;
  for (const sd of [1, 2, 3, 4, 5, 6, 7, 8]) {
    for (const k of [1, 2]) {
      const spot = jumpSpot(sd, k);
      if (spot == null) continue;
      const fl = stage(sd, k, spot - 60, spot + 200);
      if (Math.abs(fl - L.FLOORS[k]) > 0.01) continue;
      quiet();
      clearKeys();
      const p = L.S.p;
      L.placePlayer(spot + 7, fl - p.h);
      p.onGround = true;
      settle(6);
      if (Math.abs((p.y + p.h) - fl) > 3) continue;       // 没站到本层地板上
      tried++;
      const want = L.FLOORS[k - 1];
      doubleJump();
      settle(60);
      const feet = p.y + p.h;
      if (Math.abs(feet - want) <= 3 && p.onGround) {
        up++;
        margin = Math.min(margin, L.FLOORS[k] - feet);
        settle(30);
        if (Math.abs((p.y + p.h) - want) <= 3 && p.onGround) stay++;   // 不许自己漏下去
        tap('s');
        settle(60);
        if (Math.abs((p.y + p.h) - fl) <= 3 && p.onGround) down++;
      }
    }
  }
  ok("二段跳能从本层跳到上一层楼板顶", tried > 0 && up === tried, up + "/" + tried + "，净空抬升 " + Math.round(margin) + "px");
  ok("站上去之后不会自己漏下去", stay === up, stay + "/" + up);
  ok("按 S 能从楼板穿回本层", down === up, down + "/" + up);
}

/* 上方那一格摞着箱子 → 撞箱底，上不去（"只要没箱子"） */
{
  let tried = 0, blocked = 0, tops = [], slipped = [];
  for (const sd of [1, 2, 3, 4]) {
    for (const k of [1, 2]) {
      const spot = jumpSpot(sd, k);
      if (spot == null) continue;
      const fl = stage(sd, k, spot - 60, spot + 200);
      quiet();
      clearKeys();
      const upY = L.FLOORS[k - 1];
      /* **两口箱子横着铺满 96px，人才真的被封在下面。**
         第一版只放一口（48 宽），人放在窗口左边 7px 处 → 玩家 45 宽，
         右边溢出箱沿 4px，就顺着箱侧擦上去站到了楼上地板。
         那不是"楼板能穿"，是试验场没铺满。 */
      mkBox(spot - 24, upY - 48, 'wood');
      mkBox(spot + 24, upY - 48, 'wood');
      const p = L.S.p;
      L.placePlayer(spot + 1.5, fl - p.h);          // 人整个落在箱底覆盖范围内
      p.onGround = true;
      settle(6);
      tried++;
      doubleJump();
      /* **判据是"最高摸到哪"，不是"最后站在哪"。**
         头撞箱底之后人会落回本层，最终脚底 == 起跳高度 —— 用最终位置判，
         "被挡住"和"根本没跳"长得一模一样（第一版 4/7，7 个样本全是挡住了）。 */
      let minFeet = 1e9;
      for (let i = 0; i < 60; i++) { L.step(DT); minFeet = Math.min(minFeet, p.y + p.h); }
      tops.push(Math.round(minFeet - upY));
      if (minFeet > upY + 30) blocked++;             // 脚始终在楼上地板下方（撞箱底 ≈ upY+63）
      else slipped.push("seed" + sd + "k" + k + "→" + Math.round(minFeet));
    }
  }
  ok("上方摞着箱子的那一格跳不上去（撞箱底）", tried > 0 && blocked === tried,
    blocked + "/" + tried + "（最高脚底距楼上地板 +" + tops.join("/+") + "px"
    + (slipped.length ? "；漏上去 " + slipped.join(",") : "") + "）");
}

/* 下落照旧接住：从上方掉到楼板上会站住，不会穿过去 */
{
  const spot = jumpSpot(3, 1);
  const fl = stage(3, 1, spot - 60, spot + 200);
  quiet(); clearKeys();
  const p = L.S.p;
  L.placePlayer(spot + 7, fl - 200 - p.h);         // 脚在本层地板上方 200
  p.onGround = false; p.vy = 0;
  settle(50);
  ok("下落时楼板照旧接住（不会穿透）", Math.abs((p.y + p.h) - fl) <= 4,
    "脚底 " + (p.y + p.h).toFixed(1) + " / 楼板顶 " + fl);
}

/* 怪不许跟着穿楼板 */
{
  const spot = jumpSpot(2, 1);
  const fl = stage(2, 1, spot - 60, spot + 200);
  const thick = L.GEN.thick;
  quiet(); clearKeys();
  const f = L.spawnFoe(spot + 2, fl - 120, 'crawler');    // 站在本层地板上
  f.vy = -900;
  let minY = 1e9;
  for (let i = 0; i < 40; i++) { L.step(DT); minY = Math.min(minY, f.y); }
  ok("怪不会穿楼板（楼板只对玩家半透）", minY >= fl - 240 + thick - 4,
    "怪头最高 " + minY.toFixed(1) + " / 楼板底 " + (fl - 240 + thick));
}

/* =========================================================================
   二、落球砸箱
   ========================================================================= */
group("二、球掉下去砸碎箱子");
{
  const x = 240, fl = stage(3, 0, 60, 900);
  const stack = [];
  for (let j = 0; j < 3; j++) stack.push(mkBox(x, fl - 48 * (j + 1), 'wood'));
  const b = L.spawnBall(x + 24, fl - 320, 0, 1);
  settle(90);
  const alive = stack.filter(o => !o.dead).length;
  ok("从一层高处落下的球砸穿 3 格木箱堆", alive === 0, "剩 " + alive + " 口，chain=" + b.chain);
  ok("砸完继续往下掉到地面（不是停在箱顶）",
    Math.abs((b.y + b.r) - fl) < 3, "球底 " + (b.y + b.r - fl).toFixed(1) + "（0=地面）");
}

{
  const x = 240, fl = stage(3, 0, 60, 900);
  const stone = [mkBox(x, fl - 48, 'stone'), mkBox(x, fl - 96, 'stone')];
  const b = L.spawnBall(x + 24, fl - 320, 0, 1);
  settle(90);
  ok("一层高的落球砸得碎石箱",
    stone.every(o => o.dead), "剩 " + stone.filter(o => !o.dead).length + " 口");
}

{
  const x = 240, fl = stage(3, 0, 60, 900);
  const iron = [mkBox(x, fl - 48, 'iron')];
  const b = L.spawnBall(x + 24, fl - 320, 0, 1);
  settle(90);
  ok("铁箱砸不动（落球停在箱顶）", !iron[0].dead && Math.abs((b.y + b.r) - (fl - 48)) < 3,
    "球底 " + (b.y + b.r - fl).toFixed(1) + "（-48 = 箱顶）");
}

/* 静止/滚动的球压在箱顶上不许把箱子砸掉 —— crushVy 是拿来区分这件事的 */
{
  const x = 240, fl = stage(3, 0, 60, 900);
  const box = mkBox(x, fl - 48, 'wood');
  const b = L.spawnBall(x + 24, fl - 48 - 22, 0, 1);      // 正好坐在箱顶
  b.vy = 0;
  settle(60);
  ok("球在箱顶上滚不算「落砸」（vy 不到阈值）", !box.dead);
}

/* =========================================================================
   三、推球：站位别再卡死
   ========================================================================= */
group("三、推球判定（1 级平面上的两种死角）");
{
  /* ① 站在一格矮箱顶上，推脚下地面上的球 */
  const x = 240, fl = stage(3, 0, 60, 900);
  const nb = mkBox(x, fl - 48, 'wood');
  const p = L.S.p;
  L.placePlayer(x + 2, fl - 48 - p.h);
  p.onGround = true;
  const ball = L.spawnBall(x + 96 + 24, fl - 22, 0, 1);   // 右边空地
  clearKeys();
  settle(4);
  keys()['d'] = true;
  let pushed = false;
  for (let i = 0; i < 40; i++) { L.step(DT); if (Math.abs(ball.vx) > 1) { pushed = true; break; } }
  ok("站在一格矮箱顶上推得动地面上的球", pushed,
    pushed ? "" : "球 vx 一直 0");
}

{
  /* ① 的闭环版：**从箱顶上推出去的球，真的能滚过去把箱子撞碎。**
     "推得动"只是手感，玩家要的是结果 —— 1 级平面上一路矮箱，
     如果推出去的球滚两步就停/被地形吃掉，推得动也没意义。 */
  const x = 240, fl = stage(3, 0, 60, 900);
  mkBox(x, fl - 48, 'wood');
  const target = mkBox(x + 240, fl - 48, 'wood');
  const p = L.S.p;
  L.placePlayer(x + 2, fl - 48 - p.h);
  p.onGround = true;
  const ball = L.spawnBall(x + 96 + 24, fl - 22, 0, 1);
  clearKeys();
  settle(4);
  keys()['d'] = true;
  for (let i = 0; i < 120; i++) { L.step(DT); if (target.dead) break; }
  clearKeys();
  ok("箱顶上推出去的球滚到对面把木箱撞碎", target.dead,
    target.dead ? "撞碎" : "球到 " + ball.x.toFixed(0) + " / 目标 " + target.x);
}

{
  /* ② 站在两格高箱顶上，推不动 —— 推球不该变成"隔一层也能推" */
  const x = 240, fl = stage(3, 0, 60, 900);
  mkBox(x, fl - 48, 'wood'); mkBox(x, fl - 96, 'wood');
  const p = L.S.p;
  L.placePlayer(x + 2, fl - 96 - p.h);
  p.onGround = true;
  const ball = L.spawnBall(x + 96 + 24, fl - 22, 0, 1);
  clearKeys();
  settle(4);
  keys()['d'] = true;
  let pushed = false;
  for (let i = 0; i < 40; i++) { L.step(DT); if (Math.abs(ball.vx) > 1) { pushed = true; break; } }
  clearKeys();
  ok("站在两格箱顶上推不动（高度差太大）", !pushed);}

{
  /* ③ 站着不动、从球旁边走过都不推送 */
  const x = 240, fl = stage(3, 0, 60, 900);
  const p = L.S.p;
  L.placePlayer(x, fl - p.h);
  p.onGround = true;
  const ball = L.spawnBall(x + 70, fl - 22, 0, 1);
  clearKeys();
  let pushed = false;
  for (let i = 0; i < 40; i++) { L.step(DT); if (Math.abs(ball.vx) > 1) pushed = true; }
  ok("站着不动不推球", !pushed);
}

{
  /* ④ 慢速贴住箱子：球不许留在箱体里（旧版 `<40 就 continue` 会穿进去） */
  const x = 240, fl = stage(3, 0, 60, 900);
  const box = mkBox(x + 96, fl - 48, 'wood');
  const ball = L.spawnBall(x + 20, fl - 22, 30, 1);       // 慢速滚过去
  for (let i = 0; i < 60; i++) L.step(DT);
  const overlap = (ball.x + ball.r) - box.x;
  ok("慢速球抵住箱子就停，不穿进箱体", !box.dead && overlap <= 1.5,
    "重叠 " + overlap.toFixed(1) + "px");
}

console.log("\n" + "=".repeat(56));
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
