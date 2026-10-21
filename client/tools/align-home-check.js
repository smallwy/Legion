/* 主界面对齐自检：把 alignHud 的公式套在 Home.scene 的真实尺寸上，
   逐个算"图标中心 vs 容器中心""文字中心 vs 底板中心"，打印修复前后的偏差。

   沙箱里跑不起 Cocos，所以这里只验几何 —— 节点尺寸和 anchor 都从场景里读，
   公式跟 HomeRuntime.alignHud 保持一致。所有比较都在**同一个父坐标系**里做。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const j = JSON.parse(fs.readFileSync(path.join(root, 'assets/scenes/Home.scene'), 'utf8'));
const get = (id) => (id && typeof id === 'object') ? j[id.__id__] : j[id];

function sizeOf(n) {
  for (const cid of (n._components || [])) {
    const c = get(cid);
    if (c && c.__type__ === 'cc.UITransform') {
      return { w: c._contentSize.width, h: c._contentSize.height, ax: c._anchorPoint.x, ay: c._anchorPoint.y };
    }
  }
  return null;
}
const child = (n, nm) => (n._children || []).map(get).find(c => c && c._name === nm);
// anchor (0,1)：position 即左上角，中心 = (x + w/2, y - h/2)
const centerAt = (pos, s) => ({ x: pos.x + s.w / 2, y: pos.y - s.h / 2 });

const nodes = j.filter(o => o && o.__type__ === 'cc.Node');
const canvas = nodes.find(n => n._name === 'Canvas');
const badges = child(canvas, 'Badges');
const hud = child(canvas, 'HUD');

const BADGE_W = 47, BADGE_H = 48, CAP_GAP = 46;
const rows = [];
let bad = 0;

function line(label, v, limit = 0.75) {
  const bad0 = Math.abs(v) > limit;
  if (bad0) bad++;
  rows.push([label, v.toFixed(2), bad0 ? '  ✗' : '  ✓']);
}

/* ---- 徽标：图标 / 底板 / 文字 ---- */
for (const b of badges._children.map(get)) {
  if (!b._name.startsWith('Badge-')) continue;
  const key = b._name.slice(6);
  const bpos = b._lpos;
  const bCenterAbs = centerAt(bpos, { w: BADGE_W, h: BADGE_H });        // Badges 坐标系
  const bCenterLocal = { x: BADGE_W / 2, y: -BADGE_H / 2 };             // 徽标局部坐标系

  const ico = child(b, 'ico');
  if (ico) {
    const s = sizeOf(ico);
    const after = { x: (BADGE_W - s.w) / 2, y: -(BADGE_H - s.h) / 2 };
    const c = centerAt(after, s);
    line(`${key} · 图标 x(改后)`, c.x - bCenterLocal.x);
    line(`${key} · 图标 y(改后)`, c.y - bCenterLocal.y);
    const before = centerAt(ico._lpos, s);
    line(`${key} · 图标 x(改前)`, before.x - bCenterLocal.x);
    line(`${key} · 图标 y(改前)`, before.y - bCenterLocal.y);
  }

  const cap = child(badges, `Cap-${key}`);
  if (!cap) continue;
  const cs = sizeOf(cap);
  const capAfter = { x: bpos.x + (BADGE_W - cs.w) / 2, y: bpos.y - CAP_GAP };
  const capC = centerAt(capAfter, cs);
  line(`${key} · 底板 x(改后)`, capC.x - bCenterAbs.x);

  const txt = child(cap, 'txt');
  if (txt) {
    const ts = sizeOf(txt);
    const capLocal = { x: cs.w / 2, y: -cs.h / 2 };
    const after = { x: (cs.w - ts.w) / 2, y: -(cs.h - ts.h) / 2 };
    const c = centerAt(after, ts);
    line(`${key} · 文字 x(改后)`, c.x - capLocal.x);
    line(`${key} · 文字 y(改后)`, c.y - capLocal.y);
    const before = centerAt(txt._lpos, ts);
    line(`${key} · 文字 x(改前)`, before.x - capLocal.x);
    line(`${key} · 文字 y(改前)`, before.y - capLocal.y);
  }
}

/* ---- 左上提示条：三个中心必须在同一 y ---- */
const tip = child(hud, 'HudTip');
if (tip) {
  const ph = sizeOf(tip).h;
  const after = [], before = [];
  for (const nm of ['paw', 'txt', 'ar']) {
    const n = child(tip, nm);
    if (!n) continue;
    const s = sizeOf(n);
    after.push({ nm, y: centerAt({ x: 0, y: -(ph - s.h) / 2 }, s).y });
    before.push(centerAt(n._lpos, s).y);
  }
  const avg = after.reduce((a, b) => a + b.y, 0) / after.length;
  for (const a of after) line(`提示条 · ${a.nm} y(改后)`, a.y - avg);
  const spread = Math.max(...before) - Math.min(...before);
  rows.push(['提示条 · 改前三者落差', spread.toFixed(2), spread > 0.75 ? '  ✗' : '  ✓']);
  if (spread > 0.75) bad++;
}

/* ---- 进度卡：关卡名 / 连锁 与进度点同一中线 ---- */
const prog = child(hud, 'HudProgress');
if (prog) {
  const pip = child(prog, 'pip-0');
  const ps = sizeOf(pip);
  const mid = centerAt(pip._lpos, ps).y;
  for (const nm of ['txt-stage', 'txt-chain']) {
    const n = child(prog, nm);
    if (!n) continue;
    const s = sizeOf(n);
    line(`进度卡 · ${nm}(改后)`, centerAt({ x: 0, y: mid + s.h / 2 }, s).y - mid);
    line(`进度卡 · ${nm}(改前)`, centerAt(n._lpos, s).y - mid);
  }
}

/* ---- 设置按钮 ---- */
const btn = child(hud, 'IconBtn');
if (btn) {
  const bs = sizeOf(btn), ico = child(btn, 'ico');
  if (ico) {
    const s = sizeOf(ico);
    const c = centerAt({ x: (bs.w - s.w) / 2, y: -(bs.h - s.h) / 2 }, s);
    line('设置 · 图标 x(改后)', c.x - bs.w / 2);
    line('设置 · 图标 y(改后)', c.y + bs.h / 2);
  }
}

/* ---- Logo 左边缘 ---- */
const t1 = child(hud, 'Logo-Title'), s1 = child(hud, 'Logo-Sub');
if (t1 && s1) {
  rows.push(['Logo · 左边缘(改前)', (s1._lpos.x - t1._lpos.x).toFixed(2),
    Math.abs(s1._lpos.x - t1._lpos.x) > 0.2 ? '  ✗' : '  ✓']);
  if (Math.abs(s1._lpos.x - t1._lpos.x) > 0.2) bad++;
}

const pad = (s, n) => String(s).padEnd(n);
for (const r of rows) console.log(pad(r[0], 26) + pad(r[1], 9) + r[2]);
console.log('\n不过关项：' + bad);
