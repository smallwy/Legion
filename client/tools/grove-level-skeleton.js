/* ============================================================================
   grove-level-skeleton.js —— 27 屏空间骨架接触表（关卡空间骨架审计工具）
   ----------------------------------------------------------------------------
   为什么要有这个：判断"每屏长得像不像"不能靠记忆，要能把 27 张图**并排放在一起**。
   这就是美术里的缩略图测试 —— 缩到 24% 还分得开的关卡才是不同的关卡；
   缩下来全一样，那就是同一张图换了皮肤。

   用法：
     node client/tools/grove-level-skeleton.js
   产出：
     docs/assets/level-skeleton-audit.html
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'client/prototype/grove.html');
const OUT = path.join(ROOT, 'docs/assets/level-skeleton-audit.html');

const html = fs.readFileSync(SRC, 'utf8');
const i0 = html.indexOf('const LEVELS = [');
const i1 = html.indexOf('\n];', i0);
const body = html.slice(i0, i1 + 3);
const LEVELS = eval('const GROUND_Y=556; const WALL_L=26, WALL_R=934;\n' + body + '\nLEVELS');

/* ---------- 几何常量（必须和 grove.html 一致） ---------- */
const W = 960, H = 600, GROUND_Y = 556;
const SC = 0.30;                        // 缩略比例：960×600 → 288×180
const CW = Math.round(W * SC), CH = Math.round(H * SC);
const PAD = 12;
const LEVEL_Y = [156, 248, 350, 462];
const PIT_COL = { mud: '#8A6240', fire: '#E2622E', water: '#3E8FC4' };
const PIT_LBL = { mud: '泥', fire: '火', water: '水' };

const sx = (x) => x * SC;
const sy = (y) => y * SC;

function cell(L, idx) {
  const o = [];
  // 底板
  o.push(`<rect x="0" y="0" width="${CW}" height="${CH}" fill="#111A22"/>`);
  // 高度基准线
  LEVEL_Y.forEach((y, k) => {
    o.push(`<line x1="0" y1="${sy(y).toFixed(1)}" x2="${CW}" y2="${sy(y).toFixed(1)}" stroke="#1E2C38" stroke-width="1"/>`);
    o.push(`<text x="2" y="${(sy(y) - 2).toFixed(1)}" font-size="7" fill="#2A3B4A">L${k + 1}</text>`);
  });
  // 台面（含地面）先画 —— 坑必须在台面**之上**覆盖，否则整条地面把坑盖死了，
  // 缩略图上会看成"这关一个坑都没有"，和实际读感完全相反。
  (L.plats || []).forEach((p) => {
    const isGround = p.kind === 'ground';
    o.push(`<rect x="${sx(p.x).toFixed(1)}" y="${sy(p.y).toFixed(1)}" width="${(p.w * SC).toFixed(1)}" height="${isGround ? ((H - p.y) * SC).toFixed(1) : 4}" fill="${isGround ? '#2B3A47' : '#C8D8E4'}"/>`);
  });
  // 坑：在地面带里开洞
  (L.pits || []).forEach((p) => {
    o.push(`<rect x="${sx(p.x).toFixed(1)}" y="${sy(p.y).toFixed(1)}" width="${(p.w * SC).toFixed(1)}" height="${((H - p.y) * SC).toFixed(1)}" fill="${PIT_COL[p.kind] || '#666'}"/>`);
  });
  // 坡
  (L.ramps || []).forEach((r) => {
    const a = sx(r.x), b = sx(r.x + r.w);
    o.push(`<polygon points="${a.toFixed(1)},${sy(r.yL).toFixed(1)} ${b.toFixed(1)},${sy(r.yR).toFixed(1)} ${b.toFixed(1)},${(sy(r.yR) + 4).toFixed(1)} ${a.toFixed(1)},${(sy(r.yL) + 4).toFixed(1)}" fill="#59C0B4"/>`);
  });
  // 木桩
  (L.stumps || []).forEach((s) => {
    o.push(`<rect x="${(sx(s.x) - s.w * SC / 2).toFixed(1)}" y="${sy(s.y - s.h).toFixed(1)}" width="${(s.w * SC).toFixed(1)}" height="${(s.h * SC).toFixed(1)}" fill="#A9793F"/>`);
  });
  // 弹菇
  (L.bouncers || []).forEach((b) => {
    o.push(`<circle cx="${sx(b.x).toFixed(1)}" cy="${sy(b.y).toFixed(1)}" r="3.4" fill="#8ED36A"/>`);
  });
  // 传送门
  (L.portals || []).forEach((p) => {
    o.push(`<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.2" fill="none" stroke="#9FE4FF" stroke-width="1.6"/>`);
  });
  // 敌人站位（按波次全画出来）—— 用来看"每屏的敌人分布是不是同一张图"
  const FOE_COL = { bug: '#8FD45E', boar: '#E8A06A', crow: '#A98CF0', boss: '#E04040', larva: '#CDE888' };
  (L.waves || []).forEach((wv) => {
    wv.forEach((f) => {
      const r = f.foe === 'boss' ? 3.0 : 1.7;
      o.push(`<circle cx="${sx(f.x).toFixed(1)}" cy="${(sy(f.y) - r - 2).toFixed(1)}" r="${r}" fill="${FOE_COL[f.foe] || '#999'}"/>`);
    });
  });
  // 营地（终点）：永远是同一个绿三角
  if (L.camp) {
    const cx = sx(L.camp.x), cy = sy(L.camp.y);
    o.push(`<polygon points="${cx.toFixed(1)},${(cy - 10).toFixed(1)} ${(cx + 7).toFixed(1)},${cy.toFixed(1)} ${(cx - 7).toFixed(1)},${cy.toFixed(1)}" fill="#F2C14E"/>`);
  }
  // 出生点
  if (L.spawn) {
    o.push(`<circle cx="${sx(L.spawn.x).toFixed(1)}" cy="${(sy(L.spawn.y) - 3).toFixed(1)}" r="2.6" fill="#FFF3C4"/>`);
  }
  // 边框 + 编号
  o.push(`<rect x="0.5" y="0.5" width="${CW - 1}" height="${CH - 1}" fill="none" stroke="#243646"/>`);
  return `<svg viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}">${o.join('')}</svg>`;
}

function group(a, b, title, sub, accent) {
  const cells = [];
  for (let k = a; k <= b; k++) {
    const L = LEVELS[k - 1];
    const prim = [];
    if ((L.ramps || []).length) prim.push('坡');
    if ((L.bouncers || []).length) prim.push('菇');
    if ((L.portals || []).length) prim.push('门');
    if ((L.stumps || []).length) prim.push('桩');
    const tag = prim.length ? prim.join('') : '平地';
    cells.push(`
      <figure class="cell">
        ${cell(L, k)}
        <figcaption><b>${k}</b> ${L.name} <span class="tag${prim.length ? '' : ' dim'}">${tag}</span></figcaption>
        <div class="sub">${L.sub || ''}</div>
      </figure>`);
  }
  return `
  <section class="grp">
    <header style="border-left:4px solid ${accent}">
      <h2>${title}</h2><p>${sub}</p>
    </header>
    <div class="grid">${cells.join('')}</div>
  </section>`;
}

/* 27 屏全部叠在一张图上。重叠越亮的地方 = 越多关共用同一条骨架。
   这是"章节同质化"最直接的证据：什么都不用说，亮的地方就是共同点。 */
function overlay() {
  const o = [];
  o.push(`<rect x="0" y="0" width="${CW}" height="${CH}" fill="#0E151C"/>`);
  LEVEL_Y.forEach((y) => {
    o.push(`<line x1="0" y1="${sy(y).toFixed(1)}" x2="${CW}" y2="${sy(y).toFixed(1)}" stroke="#22333F"/>`);
  });
  LEVELS.forEach((L) => {
    (L.plats || []).forEach((p) => {
      const g = p.kind === 'ground';
      o.push(`<rect x="${sx(p.x).toFixed(1)}" y="${sy(p.y).toFixed(1)}" width="${(p.w * SC).toFixed(1)}" height="${g ? ((H - p.y) * SC).toFixed(1) : 3}" fill="#5FC8E8" opacity="${g ? 0.075 : 0.055}"/>`);
      if (!g) o.push(`<rect x="${sx(p.x).toFixed(1)}" y="${sy(p.y).toFixed(1)}" width="${(p.w * SC).toFixed(1)}" height="1" fill="#BFE6F5" opacity="0.10"/>`);
    });
  });
  LEVELS.forEach((L) => {
    if (L.camp) {
      const cx = sx(L.camp.x), cy = sy(L.camp.y);
      o.push(`<polygon points="${cx.toFixed(1)},${(cy - 12).toFixed(1)} ${(cx + 9).toFixed(1)},${cy.toFixed(1)} ${(cx - 9).toFixed(1)},${cy.toFixed(1)}" fill="#F2C14E" opacity="0.16"/>`);
    }
    if (L.spawn) {
      o.push(`<circle cx="${sx(L.spawn.x).toFixed(1)}" cy="${(sy(L.spawn.y) - 3).toFixed(1)}" r="4" fill="#FFF3C4" opacity="0.22"/>`);
    }
  });
  o.push(`<rect x="0.5" y="0.5" width="${CW - 1}" height="${CH - 1}" fill="none" stroke="#2A3E4E"/>`);
  return `<svg viewBox="0 0 ${CW} ${CH}">${o.join('')}</svg>`;
}

const doc = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>Legion · 27 屏空间骨架接触表</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px 24px 60px; background:#0B1218; color:#C9D6E0;
         font:13px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; color:#EAF2F8; letter-spacing:.5px; }
  .lead { margin:0 0 22px; color:#7E93A4; font-size:12.5px; }
  .lead b { color:#F2C14E; }
  .grp { margin-bottom:26px; }
  .grp header { padding-left:10px; margin-bottom:10px; }
  .grp h2 { font-size:14.5px; margin:0; color:#EAF2F8; }
  .grp p { margin:2px 0 0; font-size:11.5px; color:#6E8494; }
  .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; max-width:900px; }
  .grid svg, .overlay svg { width:100%; height:auto; display:block; }
  .cell { margin:0; }
  figcaption { font-size:11.5px; color:#D5E2EC; margin-top:3px; }
  figcaption b { display:inline-block; min-width:15px; color:#8FA6B8; font-weight:600; }
  .tag { float:right; font-size:9.5px; padding:0 5px; border-radius:3px;
         background:#1D3346; color:#7FD8F0; }
  .tag.dim { background:#1A232B; color:#4C5F6E; }
  .sub { font-size:10px; color:#5D7284; }
  .legend { display:flex; gap:18px; flex-wrap:wrap; margin:0 0 18px; font-size:11.5px; color:#8CA1B2; }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:2px;
              margin-right:5px; vertical-align:-1px; }
  .overlay { display:flex; gap:22px; align-items:flex-start; flex-wrap:wrap; margin:0 0 20px; }
  .overlay figure { margin:0; width:430px; flex:0 0 430px; }
  .overlay figcaption { font-size:11px; color:#6E8494; margin-top:5px; }
  .overlay .notes { flex:1 1 260px; min-width:250px; font-size:12px; line-height:1.85; color:#9FB3C2; }
  .overlay .notes b { color:#F2C14E; }
  .overlay .notes em { color:#7FD8F0; font-style:normal; }
  .warn { border:1px solid #4A2E23; background:#1E1410; color:#E0A98A;
          padding:10px 14px; border-radius:6px; font-size:12px; margin:0 0 22px; }
  .warn b { color:#F0B27A; }
</style></head><body>
<h1>Legion · 27 屏空间骨架接触表</h1>
<p class="lead">按 <b>30% 缩放</b>绘制，只画几何不画皮肤 —— 这是判断「章节之间长得像不像」的唯一客观方式。
缩到这个尺寸还分得开的才是不同的关；缩下来一样，就是同一张图换皮。</p>

<div class="legend">
  <span><i style="background:#C8D8E4"></i>台面</span>
  <span><i style="background:#2B3A47"></i>地面</span>
  <span><i style="background:#59C0B4"></i>坡</span>
  <span><i style="background:#8ED36A;border-radius:50%"></i>弹菇</span>
  <span><i style="background:none;border:1.5px solid #9FE4FF;border-radius:50%"></i>传送门</span>
  <span><i style="background:#A9793F"></i>木桩</span>
  <span><i style="background:#8A6240"></i>泥</span>
  <span><i style="background:#E2622E"></i>火</span>
  <span><i style="background:#3E8FC4"></i>水</span>
  <span><i style="background:#F2C14E"></i>营地</span>
  <span><i style="background:#FFF3C4;border-radius:50%"></i>出生点</span>
</div>

<div class="overlay">
  <figure>
    ${overlay()}
    <figcaption>27 屏几何全部叠在一张图上 · 越亮 = 越多关共用同一段骨架</figcaption>
  </figure>
  <div class="notes">
    <b>这张图就是「同质化」的本体。</b><br/>
    如果 27 屏真的是 27 个不同的空间，叠加后应该是一团均匀的雾。
    <br/><br/>
    实际看到的是 <em>几条非常清晰的横线</em> —— 那是 462 和 350 两层台面，
    27 屏里有 53 块和 47 块落在同一条高度上。也就是说，
    <b>几乎每一屏都有一条贯通左右的 462 长台</b>，只是断口位置挪了几十像素。
    <br/><br/>
    右下角的黄斑是 27 个营地三角叠在一起 —— 它们全在同一格。
    左侧的亮点是 27 个出生点 —— 全在地面。
  </div>
</div>

<div class="warn">
  <b>看这三点就够了：</b><br/>
  ① 每一格的 <b>绿三角（营地）都在右下角同一处</b> —— 27 屏里 24 屏 x=852，2 屏 848，1 屏 830，极差 22px。<br/>
  ② 每一格的 <b>黄点（出生点）都在左下角地面</b> —— 全部 y=556，x 只在 60~230 之间浮动。<br/>
  ③ 每格只有 <b>4 条灰色高度线</b>可用 —— 整部游戏的高度空间就是 156/248/350/462/556 五档，没有第六档。<br/>
  结果：起点、终点、可用高度全部固定，玩家每屏只是在同一张环形跑道里换一条 S 形路线。
</div>

${group(1, 9, '产地一 · 苔原 / 雪线', '空间语法：高度与落差 —— 在塔上造球，让重力替你滚。', '#5FC8E8')}
${group(10, 18, '产地二 · 枯木林', '空间语法：结构会崩 —— 你在顶棚下面打，地形本身是对手。', '#E8A05F')}
${group(19, 27, '产地三 · 沼泽', '空间语法：介质会变 —— 落点会自己跑，球会被推走。', '#6FD08A')}
</body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, doc, 'utf8');
console.log('written', path.relative(ROOT, OUT), doc.length, 'bytes');
