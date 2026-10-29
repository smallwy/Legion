/* ===========================================================================
   2026-10-29 第六轮反馈的三条，全部是"过程"问题 —— 出图不能只截一张终态。
   ---------------------------------------------------------------------------
     MODE=climb    井口往上爬：**轨迹图**。改前是 L 形（先升到顶、再在地板
                   面高度横着滑 97px），改后是一条沿井壁的曲线（边升边靠）。
                   两条轨迹叠在同一张底图上，形状差异一眼可见。
     MODE=lobby    门厅（最底层）按 ↓：改前被传送到地表，改后留在门厅。
                   两张截图上下排，标注脚底 y。
     MODE=bigramp  大球（r=46）推上坡：改前卡在坡顶，改后越过坡顶。
                   同样叠轨迹。

   跑法（BEFORE 指向旧版原型，不给就只画"改后"）：
     NODE_PATH=<workspace>/node_modules \\
     BEFORE=/tmp/snowlab-before6.html MODE=climb \\
     node client/tools/_round6-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600, DT = 1 / 60;
const AFTER = path.join(ROOT, "prototype", "snowlab.html");
const BEFORE = process.env.BEFORE ? path.resolve(process.env.BEFORE) : null;
const MODE = process.env.MODE || "climb";
const PFX = process.env.PREFIX || ("r6-" + MODE);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 装一份原型。 */
async function boot(protoPath) {
  const real = createCanvas(W, H);
  const g = real.getContext("2d");
  const html = fs.readFileSync(protoPath, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
  window.requestAnimationFrame = () => 0;
  window.eval(m[1]);
  if (window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));
  try { window.SNOWLAB.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
  catch (e) { window.SNOWLAB.setBackdrop(null); }
  try { window.SNOWLAB.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { /* 代码图形 */ }
  return { L: window.SNOWLAB, S: window.SNOWLAB.S, real, g };
}

function camOffset() { return (240 - 26) / 2 + H / 2; }

/** 找一个"能按 W 爬上去"的井梯：{seed, k, hole, upper, col}。 */
function findClimb(L) {
  for (let sd = 1; sd < 20; sd++) {
    L.reset(sd);
    const F = L.FLOORS, LY = L.LAYERS;
    for (let k = 1; k < F.length; k++) {
      const h = (LY[k - 1].holes || [])[0];
      if (!h) continue;
      const upper = F[k - 1];
      /* **挑横移最大的那个站位。** 洞口中心往往两侧都够，落点就近选一边，
         横移只剩 48px —— 而用户看到的"往左跑"是 97px 那种。
         图要证明的是"过程变了"，站位得选最极端的。 */
      let best = null;
      for (const rel of [h.w * 0.08, h.w * 0.25, h.w * 0.5, h.w * 0.75, h.w * 0.92]) {
        L.placePlayer(h.x + rel, upper + 144 - L.PLAYER_H);
        L.S.p.vy = 0; L.S.p.onGround = true;
        const cw = L.wellClimb(L.S.p);
        if (!cw) continue;
        const d = Math.abs(cw.x - L.S.p.x);
        if (!best || d > best.d) best = { sd, k, hole: h, upper, rel, cw, d };
      }
      if (best) return best;
    }
  }
  return null;
}

/** 把井口盖板砸掉（不然一撞头就掉回来，那是设计）。 */
function clearCover(L, upper, hole) {
  L.S.boxes.filter(b => !b.dead && b.x + b.w > hole.x && b.x < hole.x + hole.w &&
                        b.y + b.h > upper - 200 && b.y < upper + 4)
    .forEach(b => L.breakBox(b, "ball"));
  L.S.foes.length = 0;
  L.S.shots.length = 0;
}

/** 跑一遍攀爬，返回采样点。镜头锁死，方便叠轨迹。 */
function runClimb(inst, pick) {
  const { L, S } = inst;
  L.reset(pick.sd);
  clearCover(L, pick.upper, pick.hole);
  const camFix = clamp(pick.upper - camOffset(), 0, L.WORLD_H - H);
  S.cam.y = camFix; S.cam.k = pick.k;
  L.placePlayer(pick.hole.x + pick.rel, pick.upper + 144 - L.PLAYER_H);
  S.p.vy = 0; S.p.onGround = true;
  for (let i = 0; i < 6; i++) { L.step(DT); S.cam.y = camFix; }
  const pts = [];
  const cw = L.wellClimb(S.p);
  if (!cw) return { pts, camFix };
  L.startClimb(S.p, cw);
  pts.push({ x: S.p.x + S.p.w / 2, y: S.p.y + S.p.h });
  for (let i = 0; i < 70 && S.p.climb; i++) {
    L.step(DT);
    S.cam.y = camFix;
    pts.push({ x: S.p.x + S.p.w / 2, y: S.p.y + S.p.h });
  }
  return { pts, camFix, end: { x: S.p.x, y: S.p.y } };
}

/** 只画背景（把玩家挪到画面外、清掉 HUD）。 */
function bgOnly(inst, camFix) {
  const { L, S } = inst;
  const saveX = S.p.x, saveY = S.p.y;
  S.p.x = -9999; S.p.y = -9999;
  S.cam.y = camFix;
  S.showMeter = false; S.showHint = false; S.showHud = false; S.texts.length = 0;
  S.balls.length = 0;
  S.t = 12;
  L.draw();
  S.p.x = saveX; S.p.y = saveY;
  const c = createCanvas(W, H);
  c.getContext("2d").drawImage(inst.real, 0, 0);
  return c;
}

function label(g, text, x, y, size, color) {
  g.font = "bold " + size + "px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "rgba(12,18,24,.72)";
  const w = g.measureText(text).width;
  g.fillRect(x - 8, y - size, w + 16, size + 10);
  g.fillStyle = color || "#F6FAFF";
  g.fillText(text, x, y + 2);
}

/* ---------------------------------------------------------------- MODE=climb */
async function modeClimb() {
  const after = await boot(AFTER);
  const pick = findClimb(after.L);
  if (!pick) { console.log("没找到可爬的井梯"); return null; }
  console.log("井梯：种子 " + pick.sd + " 第 " + pick.k + " 层 洞口 x=" + pick.hole.x + " w=" + pick.hole.w);

  const a = runClimb(after, pick);
  let b = null;
  if (BEFORE) {
    const before = await boot(BEFORE);
    const p2 = findClimb(before.L);
    // 旧版层结构一样（生成器没动），用同一组坐标重跑，保证是同一个井
    b = runClimb(before, { sd: pick.sd, k: pick.k, hole: pick.hole, upper: pick.upper, rel: pick.rel });
    if (!b.pts.length) console.log("改前没跑出轨迹（wellClimb 未命中）");
  }
  const bg = bgOnly(after, a.camFix);

  /* 先画在一张"整屏"上，再裁到轨迹周围放大 2 倍。
     144px 的井在 960 宽的画面里只占一小块，不放大看不出两条线的形状差异。 */
  const stage = createCanvas(W, H);
  const sg = stage.getContext("2d");
  sg.drawImage(bg, 0, 0);
  const g = sg;

  const draw = (pts, color, width) => {
    if (!pts.length) return;
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y - a.camFix) : g.moveTo(p.x, p.y - a.camFix)));
    g.stroke();
    /* 每 3 帧一个点：看得到"用的是几帧" */
    for (let i = 0; i < pts.length; i += 3) {
      g.fillStyle = color;
      g.beginPath(); g.arc(pts[i].x, pts[i].y - a.camFix, 2.6, 0, Math.PI * 2); g.fill();
    }
  };
  if (b) draw(b.pts, "#FF7A6B", 3.2);
  draw(a.pts, "#25C46B", 3.2);

  /* 起止标记：起点在轨迹正下方，终点在左上方 —— 都往外挪，
     免得压住另一条线的横段（第一版"终点"标签正好盖在红线的水平段上）。 */
  const mark = (p, text, color, dx, dy) => {
    if (!p) return;
    const x = p.x, y = p.y - a.camFix;
    g.strokeStyle = color; g.lineWidth = 2.5;
    g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.stroke();
    label(g, text, x + dx, y + dy, 14, color);
  };
  mark(a.pts[0], "起点", "#9BE8A8", -16, 30);
  mark(a.pts[a.pts.length - 1], "终点（站上楼板）", "#9BE8A8", 26, -34);

  /* 裁剪窗口：轨迹的包围盒往外放一圈，保持 1.6 的纵横比 */
  const all = (b ? b.pts : []).concat(a.pts);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const q of all) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y - a.camFix); maxY = Math.max(maxY, q.y - a.camFix);
  }
  let vh = Math.max(260, (maxY - minY) * 2.1);
  let vw = vh * (W / H);
  const vcx = clamp((minX + maxX) / 2, vw / 2, W - vw / 2);
  const vcy = clamp((minY + maxY) / 2, vh / 2, H - vh / 2);
  const sx = vcx - vw / 2, sy = vcy - vh / 2;

  const cv = createCanvas(W, H + 108);
  const g2 = cv.getContext("2d");
  g2.fillStyle = "#FFFDF8"; g2.fillRect(0, 0, cv.width, cv.height);
  g2.imageSmoothingQuality = "high";
  g2.drawImage(stage, sx, sy, vw, vh, 0, 108, W, H);
  g2.strokeStyle = "#2C3A46"; g2.lineWidth = 2; g2.strokeRect(1, 108, W - 2, H - 2);

  g2.font = "bold 21px 'Microsoft YaHei', sans-serif";
  g2.fillStyle = "#1B2430";
  g2.fillText("井口往上爬：L 形（升到顶再横滑）→ 沿井壁的曲线", 16, 34);
  g2.font = "bold 15px 'Microsoft YaHei', sans-serif";
  if (b) {
    g2.strokeStyle = "#FF7A6B"; g2.lineWidth = 5; g2.lineCap = "round";
    g2.beginPath(); g2.moveTo(24, 66); g2.lineTo(76, 66); g2.stroke();
    label(g2, "改前 " + b.pts.length + " 帧：先竖直爬到楼板面，再贴着地面横滑 " + Math.round(Math.abs(b.pts[b.pts.length-1].x - b.pts[0].x)) + "px",
      86, 71, 15, "#FFB4A2");
  }
  g2.strokeStyle = "#25C46B"; g2.lineWidth = 5; g2.lineCap = "round";
  g2.beginPath(); g2.moveTo(24, 94); g2.lineTo(76, 94); g2.stroke();
  label(g2, "改后 " + a.pts.length + " 帧：边升边往边上靠，最后 8% 纯竖直爬出洞口",
    86, 99, 15, "#9BE8A8");

  const out = path.join(OUT, PFX + ".png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out + "  改前 " + (b ? b.pts.length : 0) + " 帧 / 改后 " + a.pts.length + " 帧");
  return out;
}

/* ---------------------------------------------------------------- MODE=lobby */
async function modeLobby() {
  const shots = [];
  for (const [tag, p] of [["改前", BEFORE], ["改后", AFTER]]) {
    if (!p) continue;
    const inst = await boot(p);
    const { L, S } = inst;
    L.reset(3);
    const k = L.FLOORS.length - 1;
    const fl = L.FLOORS[k];
    /* 站在门厅地板上，按 ↓（从楼板穿下去） */
    L.placePlayer(300, fl - L.PLAYER_H);
    S.p.vy = 0; S.p.onGround = true;
    S.foes.length = 0;
    for (let i = 0; i < 30; i++) L.step(DT);
    S.keys = { s: true };
    for (let i = 0; i < 40; i++) { L.step(DT); if (i === 2) S.keys = {}; }
    S.keys = {};
    for (let i = 0; i < 40; i++) L.step(DT);
    const feet = S.p.y + S.p.h;
    const layer = L.FLOORS.findIndex(f => Math.abs(f - feet) < 8);
    console.log(tag + "：脚底 y=" + Math.round(feet) + "  落在第 " + (layer < 0 ? "?" : layer + 1) + " 层（共 " + L.FLOORS.length + " 层）");
    S.showMeter = false; S.showHint = false; S.showHud = false; S.texts.length = 0;
    S.t = 12;
    L.draw();
    const c = createCanvas(W, H);
    c.getContext("2d").drawImage(inst.real, 0, 0);
    shots.push({ tag, cv: c, feet, layer, nF: L.FLOORS.length, fl });
  }
  if (!shots.length) return null;

  const SW = W, SH = H;
  const cv = createCanvas(SW, 84 + (SH * 0.52 + 52) * shots.length);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
  shots.forEach((s, i) => {
    const h2 = SH * 0.52;
    const y = 84 + i * (h2 + 52);
    g.drawImage(s.cv, 0, y, SW, h2);
    g.strokeStyle = "#2C3A46"; g.lineWidth = 2; g.strokeRect(1, y, SW - 2, h2);
    const where = s.layer < 0 ? "不在任何一层上" : "第 " + (s.layer + 1) + " 层";
    label(g, s.tag + "：按 ↓ 之后脚底 y=" + Math.round(s.feet) + "，人在" + where,
      12, y - 8, 16, i === 0 ? "#FFB4A2" : "#9BE8A8");
  });
  g.font = "bold 20px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#1B2430";
  g.fillText("门厅（最底层）按 ↓：改前被送到地表，改后老老实实站在门厅", 16, 30);
  g.font = "14px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#5B6B7B";
  g.fillText("根因：门厅地板也带 floor:true，穿下去就掉出世界；掉落兜底用 groundAt(x,0) 找的是最上面那一层。", 16, 56);

  const out = path.join(OUT, PFX + ".png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out);
  return out;
}

/* ---------------------------------------------------------------- MODE=bigramp */
async function modeBigRamp() {
  const findRamp = L => {
    for (let sd = 1; sd < 30; sd++) {
      L.reset(sd);
      for (let k = 0; k < L.LAYERS.length; k++) {
        for (const t of L.LAYERS[k].terrain) {
          if (t.kind === "ramp" && t.rise > 90) return { sd, k, t };
        }
      }
    }
    return null;
  };
  const runBall = (inst, pick) => {
    const { L, S } = inst;
    L.reset(pick.sd);
    S.boxes.length = 0; S.foes.length = 0; S.balls.length = 0;
    const t = pick.t;
    const lowY = Math.max(t.y, t.y - t.rise);
    const camFix = clamp(t.y - camOffset(), 0, L.WORLD_H - H);
    S.cam.y = camFix; S.cam.k = pick.k;
    const b = L.spawnBall(t.x - 70, lowY - 20, 1209, 24);
    b.y = lowY - b.r; b.vy = 0; b.onGround = true;
    /* 人跟着推，但不参与出图 */
    L.placePlayer(t.x - 130, lowY - L.PLAYER_H);
    S.p.vy = 0; S.p.onGround = true;
    const pts = [];
    for (let i = 0; i < 150; i++) {
      S.keys = { d: true };
      L.step(DT);
      S.cam.y = camFix;
      pts.push({ x: b.x, y: b.y + b.r, dead: b.dead });
      if (b.dead) break;
    }
    S.keys = {};
    /* **截到"最远那一帧"。** 球越过坡顶之后会撞墙弹回来、再滚下坡、
       最后掉进洞里 —— 后半段和"能不能上坡"无关，画上去只会让轨迹
       缠成一团（第一版就是这样，看起来像球在爬墙）。 */
    let far = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].x > pts[far].x) far = i;
    const cut = pts.slice(0, Math.min(pts.length, far + 8));
    S.balls.length = 0; S.frags.length = 0;
    S.p.x = -9999;
    return { pts: cut, camFix, r: b.r, top: pts[far].x, touched: pts[far].y };
  };

  const after = await boot(AFTER);
  const pick = findRamp(after.L);
  if (!pick) { console.log("没找到坡"); return null; }
  const a = runBall(after, pick);
  let b = null;
  if (BEFORE) {
    const before = await boot(BEFORE);
    b = runBall(before, pick);
  }
  const bg = bgOnly(after, a.camFix);

  const cv = createCanvas(W, H + 96);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(bg, 0, 96);
  g.save(); g.translate(0, 96);

  const t = pick.t;
  const topY = Math.min(t.y, t.y - t.rise);
  /* 坡顶位置画一条竖线：越过它 = 上到台面 */
  const topX = t.rise > 0 ? t.x + t.w : t.x;
  g.strokeStyle = "rgba(255,194,75,.9)"; g.lineWidth = 3; g.setLineDash([8, 6]);
  g.beginPath(); g.moveTo(topX, topY - 46 - a.camFix + a.camFix); g.lineTo(topX, topY + 20); g.stroke();
  g.setLineDash([]);
  label(g, "坡顶", topX + 6, topY - 4, 13, "#FFD98A");

  const draw = (pts, color, width) => {
    if (!pts.length) return;
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y - a.camFix) : g.moveTo(p.x, p.y - a.camFix)));
    g.stroke();
    for (let i = 0; i < pts.length; i += 10) {
      g.fillStyle = color;
      g.beginPath(); g.arc(pts[i].x, pts[i].y - a.camFix, 3, 0, Math.PI * 2); g.fill();
    }
    const last = pts[pts.length - 1];
    g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath(); g.arc(last.x, last.y - a.camFix, 8, 0, Math.PI * 2); g.stroke();
  };
  if (b) draw(b.pts, "#FF7A6B", 3.4);
  draw(a.pts, "#25C46B", 3.4);

  g.font = "bold 15px 'Microsoft YaHei', sans-serif";
  if (b) {
    label(g, "改前：卡在 x=" + Math.round(b.top) + "（离坡顶还差 " + Math.round(topX - b.top) + "px）",
      80, 40, 14, "#FFB4A2");
  }
  label(g, "改后：越过坡顶，落到台面上（最远 x=" + Math.round(a.top) + "）",
    80, 70, 14, "#9BE8A8");
  g.restore();

  g.font = "bold 20px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#1B2430";
  g.fillText("最大的球（r=" + a.r.toFixed(0) + "）推上坡：球心贴面，坡顶那一步要按半径给助步量", 16, 30);
  g.font = "14px 'Microsoft YaHei', sans-serif";
  g.fillStyle = "#5B6B7B";
  g.fillText("旧门槛写死 24px；38° 的坡上 r=46 差 36px —— 小球上得去、大球永远卡住。", 16, 54);

  const out = path.join(OUT, PFX + ".png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out + "  改前最远 x=" + (b ? Math.round(b.top) : "-") + "  改后最远 x=" + Math.round(a.top) + "  坡顶 x=" + topX);
  return out;
}

(async () => {
  if (MODE === "climb") await modeClimb();
  else if (MODE === "lobby") await modeLobby();
  else if (MODE === "bigramp") await modeBigRamp();
})();
