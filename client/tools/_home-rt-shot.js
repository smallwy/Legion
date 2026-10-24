/* ============================================================================
   _home-rt-shot.js —— 把 Home.scene + HomeRuntime 的**运行结果**渲染成 PNG
   ----------------------------------------------------------------------------
   为什么需要这个：
     `_render-scene.js` 只读 `.scene` 文件，而任务按钮、派遣白卡、出发卡、
     提示条这些东西是 HomeRuntime 在运行期 new 出来的 —— 文件里根本没有。
     于是"改完看不见效果"，只能靠脑补坐标，正是 UI 返工的来源。

   做法：
     1. 用 _mock-cc 把 Home.scene 构造成节点树（同时保留 Sprite/Label 原始数据）；
     2. require 编译后的 HomeRuntime，让它照常接管场景、把运行时节点加进去；
     3. 从最终节点树 DFS 画图：Sprite（含染色）→ Graphics（圆角/描边）→ Label。

   做法上的坑：
     · Graphics 的坐标是 y 向上，画布 y 向下 —— 整体 scale(1,-1) 比逐点取反可靠。
     · Cocos 的 `fill()/stroke()` 只作用于**上一次 fill/stroke 之后**新增的路径
       （impl 里的 `_updatePathOffset` 机制），所以 paintCard 那种
       "同一个 Graphics 里先填外圈、再描外圈、再描内圈" 才能成立。
       这里必须照样实现，否则内圈浅描边会把外圈深描边整条盖掉。

   用法：node tools/_home-rt-shot.js [输出名] [--t=毫秒] [--touch=节点名]
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

/* ---------- 时间可控 ---------- */
let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', {
    value: { now: () => fakeNow }, configurable: true, writable: true,
});

/* ---------- cc 替身 ---------- */
const MOCK = path.join(__dirname, '_mock-cc.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) {
    if (req === 'cc' || req === 'cc/env') return MOCK;
    return origResolve.call(this, req, ...a);
};
const cc = require(MOCK);
const { Node, Scene, UITransform, UIOpacity, Label, Sprite, Graphics, Color, director } = cc;

/* Graphics 的 fill/stroke 只记了路径，没记当时的颜色。
   这里包一层，把颜色快照进去，才能在离线渲染里还原。 */
for (const m of ['fill', 'stroke']) {
    Graphics.prototype[m] = function () {
        this.paths.push([m, {
            fill: this.fillColor, stroke: this.strokeColor, lw: this.lineWidth,
        }]);
    };
}

/* ---------- 贴图 uuid → png ---------- */
const CLIENT = path.join(__dirname, '..');
const ASSETS = path.join(CLIENT, 'assets');
const sfToPng = new Map();
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.png.meta')) continue;
        try {
            const m = JSON.parse(fs.readFileSync(p, 'utf8'));
            const sf = (m.subMetas || {}).f9941;
            if (sf && sf.uuid) {
                const u = sf.userData || {};
                /* **只存裁剪框，不存整张图。**
                   引擎在 sizeMode=CUSTOM 下把 `spriteFrame.rect`（裁剪后的内容）
                   铺满节点矩形，透明边根本不参与。原来这里整张 PNG 直接拉进节点，
                   宠物立绘（rawHeight 640 / height 525）就被纵向压扁 18%、
                   横向撑宽 22% —— 截图里看着"矮胖"，真机其实是对的。
                   这种"截图骗人"比没截图更糟：尺寸判断全建立在错的画面上。 */
                sfToPng.set(sf.uuid, {
                    file: p.replace(/\.meta$/, ''),
                    tx: u.trimX || 0, ty: u.trimY || 0,
                    tw: u.width || 0, th: u.height || 0,
                });
            }
        } catch (err) { /* 目录 meta */ }
    }
})(ASSETS);

/* ---------- 构造场景树（带组件数据） ---------- */
const SCENE = path.join(ASSETS, 'scenes', 'Home.scene');
const raw = JSON.parse(fs.readFileSync(SCENE, 'utf8'));
const sceneIdx = raw.findIndex((x) => x.__type__ === 'cc.Scene');
const scene = new Scene(raw[sceneIdx]._name || 'Home');

function build(idx, parent) {
    const d = raw[idx];
    const n = new Node(d._name || '?');
    const lp = d._lpos || {};
    n.setPosition(lp.x || 0, lp.y || 0, lp.z || 0);
    const ls = d._lscale || { x: 1, y: 1 };
    n.setScale(ls.x, ls.y, 1);
    n.active = d._active !== false;
    n.parent = parent;

    for (const cref of (d._components || [])) {
        const c = raw[cref.__id__];
        if (!c) continue;
        if (c.__type__ === 'cc.UITransform') {
            const ut = n.addComponent(UITransform);
            const cs = c._contentSize || {};
            ut.setContentSize(cs.width || 0, cs.height || 0);
            ut._anchorPoint = {
                x: (c._anchorPoint && c._anchorPoint.x) ?? 0.5,
                y: (c._anchorPoint && c._anchorPoint.y) ?? 0.5,
            };
        } else if (c.__type__ === 'cc.Sprite') {
            const sp = n.addComponent(Sprite);
            sp.color = new Color(c._color.r, c._color.g, c._color.b, c._color.a);
            sp.spriteFrame = { __uuid__: (c._spriteFrame || {}).__uuid__ };
            sp.sizeMode = c._sizeMode;
        } else if (c.__type__ === 'cc.Label') {
            const lb = n.addComponent(Label);
            lb.string = c._string || '';
            lb.fontSize = c._fontSize || 20;
            lb.lineHeight = c._lineHeight || Math.round((c._fontSize || 20) * 1.35);
            lb.color = new Color(c._color.r, c._color.g, c._color.b, c._color.a);
            lb.horizontalAlign = c._horizontalAlign;
            lb.isBold = !!c._isBold;
            lb.enableOutline = !!c._enableOutline;
            lb.outlineColor = c._outlineColor;
            lb.outlineWidth = c._outlineWidth || 0;
            lb.spacingX = c._spacingX || 0;
        } else if (c.__type__ === 'cc.UIOpacity') {
            n.addComponent(UIOpacity).opacity = c._opacity ?? 255;
        }
    }
    for (const cref of (d._children || [])) build(cref.__id__, n);
}
for (const cref of (raw[sceneIdx]._children || [])) build(cref.__id__, scene);

director.setScene(scene);

/* ---------- 跑起来 ---------- */
const OPT = { out: '_home-rt', t: 1200, touch: null, press: null };
for (const a of process.argv.slice(2)) {
    const m = /^--(\w+)=(.*)$/.exec(a);
    if (m) OPT[m[1]] = m[2];
    /* 无值开关：--petbox / --dbg / --audit 这种写法原来会被**静默丢掉**，
       表现是明明加了参数却没输出，很容易怀疑到别的地方去。 */
    else if (a.startsWith('--')) OPT[a.slice(2)] = '1';
    else OPT.out = a;
}
fakeNow = 0;

/* `--cleared=8` 把存档里的通关数顶到 8，六只全解锁 ——
   改宠物布局时必须能一次看到六只挤在一起的样子，否则"聚没聚起来"只能靠脑补。
   存档只给 cleared，其余字段走 SaveData 的默认值。 */
if (OPT.cleared !== undefined) {
    const mem = new Map();
    mem.set('pawpack.save.v1', JSON.stringify({ cleared: Number(OPT.cleared) }));
    globalThis.localStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => { mem.set(k, String(v)); },
        removeItem: (k) => { mem.delete(k); },
    };
}

require(path.join(__dirname, '_rt-build', 'HomeRuntime.js'));

/* 从 0 一路推进到 `--t`，每 16ms 一帧。
   ⚠ 原来是"把时钟拨到 t、然后只推 3 帧"——宠物连首次等待（0.6~2.2s）都没走完，
   所以任何跟时间有关的动效（走动、原地姿势）在渲染图上永远是第 48ms 的样子。
   要看走动就必须真的跑够帧数。 */
{
    const target = Number(OPT.t) || 1200;
    let guard = 0;
    while (fakeNow < target && guard++ < 20000) {
        fakeNow += 16;
        director.emit('before-update');
    }
}

const findNode = (name) => (function find(n) {
    if (n.name === name) return n;
    for (const c of n.children) { const r = find(c); if (r) return r; }
    return null;
})(scene);

if (OPT.touch) {
    const hit = findNode(OPT.touch);
    if (!hit) { console.error(`找不到节点 ${OPT.touch}`); process.exit(1); }
    hit.emitTouch('touch-start');
    hit.emitTouch('touch-end');
    for (let i = 0; i < 3; i++) { fakeNow += 16; director.emit('before-update'); }
}

/* `--press=X` 只发 touch-start、不发 touch-end：用来冻结"按下态"。
   `--touch` 是完整点一下 —— start 之后立刻 end，暖光刚画上就被清掉，
   渲染出来跟常态一模一样，按不下去的效果根本看不见。 */
if (OPT.press) {
    const hit = findNode(OPT.press);
    if (!hit) { console.error(`找不到节点 ${OPT.press}`); process.exit(1); }
    hit.emitTouch('touch-start');
    for (let i = 0; i < 2; i++) { fakeNow += 16; director.emit('before-update'); }
}

/* ---------- 布局体检 ----------
   把最终节点树里每个"有视觉尺寸"的节点换成屏幕矩形，两两求交。
   UI 里"重了"这件事人不一定看得出来（半透明卡片叠在一起反而像一张），
   但矩形相交是硬事实。只报面积 > 4px² 的相交，免得相邻贴边刷屏。 */
function audit() {
    const rects = [];
    const walk = (n, ox, oy, sc) => {
        if (!n.active) return;
        const px = ox + n._pos.x * sc;
        const py = oy - n._pos.y * sc;
        const s = sc * (n._scale ? n._scale.x : 1);
        const ut = n.getComponent(UITransform);
        const hasVisual = n._comps.some((c) => c instanceof Sprite ||
            c instanceof Label || c instanceof Graphics);
        if (ut && hasVisual && ut.contentSize.width > 1 && ut.contentSize.height > 1) {
            const w = ut.contentSize.width * s, h = ut.contentSize.height * s;
            const ax = ut._anchorPoint.x, ay = ut._anchorPoint.y;
            if (!isFinite(px) || !isFinite(py) || !isFinite(w) || !isFinite(h)) {
                /* NaN 不会抛错，只会让这一格"从图上消失" —— 报出来，别让它静默 */
                console.log(`  ⚠ ${n.name} 坐标/尺寸是 NaN：pos(${n._pos.x},${n._pos.y}) ` +
                    `size(${ut.contentSize.width}×${ut.contentSize.height}) scale(${n._scale.x})`);
            }
            rects.push({
                node: n,
                name: n.name, x0: px - ax * w, y0: py - (1 - ay) * h,
                x1: px - ax * w + w, y1: py - (1 - ay) * h + h,
            });
        }
        for (const c of n.children) walk(c, px, py, s);
    };
    walk(scene, 0, H, 1);

    const group = (n) => rects.filter((r) => r.name.startsWith(n));
    console.log('\n=== Badges / HUD / Dock 矩形（屏幕坐标，1280×720）===');
    for (const r of group('Badge-')) {
        console.log(`  ${r.name.padEnd(14)} x ${r.x0.toFixed(0).padStart(4)}..${r.x1.toFixed(0).padStart(4)}` +
            `   y ${r.y0.toFixed(0).padStart(3)}..${r.y1.toFixed(0).padStart(3)}`);
    }
    for (const r of rects.filter((r) => /^(TaskBtn|DispatchCard|Hud|IconBtn|Res-|GoCard|Btn-Go|Slot-)/.test(r.name))) {
        console.log(`  ${r.name.padEnd(14)} x ${r.x0.toFixed(0).padStart(4)}..${r.x1.toFixed(0).padStart(4)}` +
            `   y ${r.y0.toFixed(0).padStart(3)}..${r.y1.toFixed(0).padStart(3)}`);
    }

    console.log('\n=== 相交（面积 > 4px²，已排除父子）===');
    const isAncestor = (a, b) => {
        for (let n = b.parent; n; n = n.parent) if (n === a) return true;
        return false;
    };
    /* 背景 / 雾层 / 宠物这三层本来就在所有 UI 底下，和谁"相交"都正常。
       放进报告只会把真正的重叠淹掉。 */
    const BACKDROP = /^(BG|FogTop|FogBot|Pets|Camera|Canvas|Scene|Home)$/;
    let hits = 0;
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (BACKDROP.test(a.name) || BACKDROP.test(b.name)) continue;
            /* 父子天然重叠（子节点就画在父板上），不算问题 */
            if (isAncestor(a.node, b.node) || isAncestor(b.node, a.node)) continue;
            const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
            const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
            const area = w * h;
            if (w > 0 && h > 0 && area > 4) {
                hits++;
                console.log(`  ${a.name} × ${b.name}  ${w.toFixed(0)}×${h.toFixed(0)}px`);
            }
        }
    }
    console.log(hits ? `  共 ${hits} 处` : '  无');
}

/* ---------- 文字溢出体检 ----------
   `audit()` 比的是**容器矩形**，而 Label 的容器是写死的（400 / 580 …）——
   文字超出容器时矩形一点没变，所以"字压到邻居身上"这件事它永远查不出来。
   这里换成量**实际文本宽度**：中文按字体度量逐字累加，和 contentSize 比。

   为什么要分 overflow 模式：
     · NONE   —— 超出直接画到容器外面，**会压住邻居**，是真问题；
     · CLAMP  —— 超出被裁掉，不压人但会截断（"收集篮 0" 变 "收集篮"），要报；
     · SHRINK —— 引擎自动缩字号，不会溢出，不算问题。
   只报前两种。 */
function auditText() {
    const mctx = createCanvas(8, 8).getContext('2d');
    console.log('\n=== 文字溢出（实际宽度 vs 容器宽）===');
    let over = 0, clipped = 0;
    const walk = (n, depth) => {
        if (!n.active) return;
        const lb = n._comps.find((c) => c instanceof Label);
        if (lb && lb.string !== '' && lb.string != null) {
            const size = lb.fontSize * (n._scale ? n._scale.x : 1);
            mctx.font = `${size}px sans-serif`;
            const tw = mctx.measureText(String(lb.string)).width;
            const ut = n.getComponent(UITransform);
            const cw = ut ? ut.contentSize.width : 0;
            if (cw > 1 && tw > cw + 1) {
                const mode = lb.overflow;
                const tag = mode === 2 ? 'SHRINK' : mode === 1 ? 'CLAMP' : 'NONE';
                if (mode === 2) { /* 自动缩字号，安全 */ }
                else {
                    const kind = mode === 1 ? 'clipped' : 'over';
                    if (mode === 1) clipped++; else over++;
                    console.log(`  ${mode === 1 ? '⚠' : '✗'} ${n.name.padEnd(16)} ` +
                        `[${tag}] 文字 ${tw.toFixed(0)}px > 容器 ${cw.toFixed(0)}px  「${lb.string}」`);
                }
            }
        }
        for (const c of n.children) walk(c, depth + 1);
    };
    walk(scene, 0);
    console.log(`  NONE 溢出 ${over} 处 / CLAMP 截断 ${clipped} 处`);

    /* ---------- 文字间距体检 ----------
       "文字压在一起"**不是**溢出问题：两个 Label 各自都在自己容器里，
       矩形审计也通过，但它们挨得太近，肉眼就是一团。
       判据：同一父节点下两个 Label，在另一轴上有重叠时，净间隙 < 4px 就报。
       只看同父（跨层的 Label 本来就该叠，比如标题压在卡上）。 */
    console.log('\n=== 文字间距 < 4px（同父节点）===');
    let tight = 0, collide = 0;
    const eachNode = (n) => {
        const kids = n.children.filter((c) => c.active && c._comps.some((x) => x instanceof Label));
        const boxes = kids.map((c) => {
            const ut = c.getComponent(UITransform);
            const w = ut ? ut.contentSize.width : 0;
            const h = ut ? ut.contentSize.height : 0;
            const sc = c._scale ? c._scale.x : 1;
            /* ⚠ 锚点**不是** (0.5,0.5)：Home.scene 里的 Label 绝大多数是 (0,1) /
               (0.5,1)。把锚点当 0.5 硬算，会把"并排"的标签报成"重叠"
               （Btn-Go/txt 和 /line 就这么被误报过 61×16），
               然后照着假数据去改 UI —— 越改越乱。 */
            const ax = ut && ut._anchorPoint ? ut._anchorPoint.x : 0.5;
            const ay = ut && ut._anchorPoint ? ut._anchorPoint.y : 0.5;
            const W2 = w * sc, H2 = h * sc;
            return {
                name: c.name, text: (c._comps.find((x) => x instanceof Label) || {}).string,
                x0: c._pos.x - ax * W2, x1: c._pos.x + (1 - ax) * W2,
                y0: c._pos.y - ay * H2, y1: c._pos.y + (1 - ay) * H2,
            };
        });
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
                const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
                if (ox > 0 && oy > 0) {
                    collide++;
                    console.log(`  ✗ 重叠 ${n.name}/${a.name} × ${n.name}/${b.name}  ${ox.toFixed(0)}×${oy.toFixed(0)}px  「${a.text}」「${b.text}」`);
                } else if (ox > 0 && oy > -4) {
                    tight++;
                    console.log(`  · 太近 ${n.name}/${a.name} × ${b.name}  纵向 ${(-oy).toFixed(1)}px  「${a.text}」「${b.text}」`);
                }
            }
        }
        for (const c of n.children) eachNode(c);
    };
    eachNode(scene);
    console.log(`  重叠 ${collide} 处 / 净间隙 < 4px ${tight} 处`);
}

/* ---------- 宠物遮挡体检 ----------
   "六只互不遮挡"这件事不能靠看截图：一张 1280 宽的图缩到 640 显示，
   叠掉的耳朵和没叠掉的耳朵长得几乎一样。这里直接算每只的屏幕矩形
   （锚点 0.5,0 = 脚底中心，矩形 = [x-w/2, x+w/2] × [y-h, y]），两两求交。
   只有"零相交"才是真的零遮挡。 */
function petBox() {
    const root = (function find(n) {
        if (n.name === 'Pets') return n;
        for (const c of n.children) { const r = find(c); if (r) return r; }
        return null;
    })(scene);
    if (!root) { console.log('[petbox] 找不到 Pets 节点'); return; }

    const boxes = [];
    const walk = (n, ox, oy, sc) => {
        if (!n.active) return;
        const px = ox + n._pos.x * sc;
        const py = oy - n._pos.y * sc;
        const s = sc * (n._scale ? n._scale.x : 1);
        const ut = n.getComponent(UITransform);
        if (n.parent === root && ut && n._comps.some((c) => c instanceof Sprite) &&
            n.name.indexOf('-hot') < 0 && n.name.indexOf('shadow') < 0) {
            const w = ut.contentSize.width * sc * (n._scale ? n._scale.x : 1);
            const h = ut.contentSize.height * sc * (n._scale ? n._scale.y : 1);
            boxes.push({ name: n.name, x0: px - w / 2, x1: px + w / 2, y0: py - h, y1: py, w, h });
        }
        for (const c of n.children) walk(c, px, py, s);
    };
    /* 必须从 scene 起算 —— Pets / Canvas 都有位移，从 Pets 起算会丢掉
       Canvas 的 (640,360)，坐标直接跑到画面外（y 800+）。 */
    walk(scene, 0, H, 1);

    console.log('\n=== 宠物矩形（屏幕坐标，锚点 0.5,0）===');
    for (const b of boxes) {
        console.log(`  ${b.name.padEnd(4)} x ${b.x0.toFixed(1).padStart(7)}..${b.x1.toFixed(1).padStart(7)}` +
            `  y ${b.y0.toFixed(1).padStart(6)}..${b.y1.toFixed(1).padStart(6)}` +
            `  ${b.w.toFixed(1)}×${b.h.toFixed(1)}`);
    }
    let worst = Infinity, hit = 0;
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
            const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
            if (ox > 0 && oy > 0) {
                hit++;
                console.log(`  ✗ 相交 ${a.name} × ${b.name}: ${ox.toFixed(1)}×${oy.toFixed(1)}px`);
            }
            /* 最近间距：横向分开就记横距，纵向分开就记纵距 */
            const gap = (ox <= 0 || oy <= 0) ? Math.max(-ox, -oy) : Math.min(-ox, -oy);
            if (gap < worst) worst = gap;
        }
    }
    console.log(hit ? `  ✗ ${hit} 对相交` : `  ✓ 零相交，最近间距 ${worst.toFixed(1)}px`);
}

const W = 1280, H = 720, CX = W / 2, CY = H / 2;
const OUT = path.join(CLIENT, 'shots', OPT.out + '.png');

if (OPT.audit) audit();
if (OPT.petbox) petBox();
if (OPT.text) auditText();

/* ---------- 渲染 ---------- */

(async () => {
    const cv = createCanvas(W, H);
    const g = cv.getContext('2d');
    g.fillStyle = '#2a2a2a';
    g.fillRect(0, 0, W, H);

    const imgCache = new Map();
    const img = async (p) => {
        if (!imgCache.has(p)) imgCache.set(p, await loadImage(p));
        return imgCache.get(p);
    };
    const tintCache = new Map();
    const tint = async (p, col) => {
        const key = p + '|' + col.r + ',' + col.g + ',' + col.b;
        if (tintCache.has(key)) return tintCache.get(key);
        const base = await img(p);
        const c = createCanvas(base.width, base.height);
        const cg = c.getContext('2d');
        cg.drawImage(base, 0, 0);
        cg.globalCompositeOperation = 'multiply';
        cg.fillStyle = `rgb(${col.r},${col.g},${col.b})`;
        cg.fillRect(0, 0, base.width, base.height);
        cg.globalCompositeOperation = 'destination-in';
        cg.drawImage(base, 0, 0);
        tintCache.set(key, c);
        return c;
    };

    let nSprite = 0, nLabel = 0, nGraph = 0;
    const missed = [];

    /* 节点树 → 画布坐标。父级锚点原点在 (ox, oy)。
       这里把"世界位置"和"世界缩放"一起往下传，因为宠物的挤压拉伸是
       scale 写在节点上的，只算位置会全画成原大小。 */
    async function draw(n, ox, oy, sc) {
        if (!n.active) return;
        const px = ox + n._pos.x * sc;
        const py = oy - n._pos.y * sc;
        const s = sc * (n._scale ? n._scale.x : 1);

        const ut = n.getComponent(UITransform);
        const op = n.getComponent(UIOpacity);
        const alpha = op ? op.opacity / 255 : 1;

        for (const comp of n._comps) {
            if (comp instanceof Sprite) {
                const uuid = comp.spriteFrame && comp.spriteFrame.__uuid__;
                const rec = sfToPng.get(uuid);
                if (!rec) { missed.push(n.name + ' ← ' + uuid); continue; }
                const im = await img(rec.file);
                const w = (ut ? ut.contentSize.width : im.width) * s;
                const h = (ut ? ut.contentSize.height : im.height) * s;
                const ax = ut ? ut._anchorPoint.x : 0.5;
                const ay = ut ? ut._anchorPoint.y : 0.5;
                const col = comp.color;
                const src = (col.r !== 255 || col.g !== 255 || col.b !== 255)
                    ? await tint(rec.file, col) : im;
                g.save();
                g.globalAlpha = alpha * (col.a / 255);
                if (rec.tw && rec.th) {
                    g.drawImage(src, rec.tx, rec.ty, rec.tw, rec.th,
                        px - ax * w, py - (1 - ay) * h, w, h);
                } else {
                    g.drawImage(src, px - ax * w, py - (1 - ay) * h, w, h);
                }
                g.restore();
                nSprite++;
            }

            if (comp instanceof Label) {
                const fs_ = comp.fontSize;
                const lh = comp.lineHeight;
                const w = ut ? ut.contentSize.width * s : 0;
                const ax = ut ? ut._anchorPoint.x : 0;
                const ay = ut ? ut._anchorPoint.y : 0.5;
                const th = ut ? ut.contentSize.height * s : lh * s;
                const col = comp.color;
                g.save();
                g.globalAlpha = alpha * (col.a / 255);
                g.font = `${comp.isBold ? 'bold ' : ''}${fs_ * s}px "Microsoft YaHei", "PingFang SC", sans-serif`;
                g.textBaseline = 'middle';
                const fill = `rgb(${col.r},${col.g},${col.b})`;
                let tx = px;
                if (comp.horizontalAlign === 2) { g.textAlign = 'right'; tx = px + (1 - ax) * w; }
                else if (comp.horizontalAlign === 1) { g.textAlign = 'center'; tx = px + (0.5 - ax) * w; }
                else { g.textAlign = 'left'; tx = px - ax * w; }
                const ty = py + (ay - 0.5) * th;
                if (comp.enableOutline && comp.outlineWidth > 0) {
                    const o = comp.outlineColor;
                    g.strokeStyle = `rgba(${o.r},${o.g},${o.b},${(o.a / 255).toFixed(3)})`;
                    g.lineWidth = comp.outlineWidth * 2 * s;
                    g.lineJoin = 'round';
                    g.strokeText(comp.string, tx, ty);
                }
                g.fillStyle = fill;
                if (comp.spacingX) {
                    const chars = [...comp.string];
                    let cx = tx - (comp.horizontalAlign === 1 ? comp.spacingX * s * (chars.length - 1) / 2 : 0);
                    for (const ch of chars) {
                        g.fillText(ch, cx, ty);
                        cx += g.measureText(ch).width + comp.spacingX * s;
                    }
                } else {
                    g.fillText(comp.string, tx, ty);
                }
                g.restore();
                nLabel++;
            }

            if (comp instanceof Graphics) {
                /* 局部 y 向上 → 画布 y 向下：整体翻转，路径照抄 */
                g.save();
                g.globalAlpha = alpha;
                g.translate(px, py);
                g.scale(s, -s);
                let got = [];
                const flush = (kind, st) => {
                    if (!got.length) return;
                    g.beginPath();
                    for (const p of got) {
                        if (p[0] === 'rect') g.rect(p[1], p[2], p[3], p[4]);
                        else if (p[0] === 'roundRect') g.roundRect(p[1], p[2], p[3], p[4], p[5]);
                        else if (p[0] === 'moveTo') g.moveTo(p[1], p[2]);
                        else if (p[0] === 'lineTo') g.lineTo(p[1], p[2]);
                        else if (p[0] === 'circle') g.arc(p[1], p[2], p[3], 0, Math.PI * 2);
                        /* 椭圆：canvas 没有原生 API，用 save + 缩放画一个单位圆。
                           影子的接地投影全靠它，缺了这条渲染图上就看不到影子。 */
                        else if (p[0] === 'ellipse') {
                            g.save();
                            g.translate(p[1], p[2]);
                            g.scale(Math.max(0.01, p[3]), Math.max(0.01, p[4]));
                            g.arc(0, 0, 1, 0, Math.PI * 2);
                            g.restore();
                        }
                        else if (p[0] === 'arc') g.arc(p[1], p[2], p[3], p[4], p[5]);
                        else if (p[0] === 'close') g.closePath();
                    }
                    if (kind === 'fill') {
                        g.fillStyle = `rgba(${st.fill.r},${st.fill.g},${st.fill.b},${(st.fill.a / 255).toFixed(3)})`;
                        g.fill();
                    } else {
                        g.strokeStyle = `rgba(${st.stroke.r},${st.stroke.g},${st.stroke.b},${(st.stroke.a / 255).toFixed(3)})`;
                        g.lineWidth = st.lw;
                        g.stroke();
                    }
                    got = [];
                };
                for (const p of comp.paths) {
                    if (p[0] === 'fill' || p[0] === 'stroke') flush(p[0], p[1]);
                    else got.push(p);
                }
                g.restore();
                nGraph++;
            }
        }

        for (const c of n.children) await draw(c, px, py, s);
    }

    /* 场景根的原点 = 设计分辨率的**左下角**（Cocos 的 UI 坐标系）。
       Canvas 自己挂在 (640,360) —— 这一层别当成"已经在中心"了，
       否则整张图会整体右移 640、上移 360。 */
    await draw(scene, 0, H, 1);

    /* `--dbg` 打印 Pets 下每只的落点与尺寸：调布局时"差 25px 看不出来"，
       目测截图会一路调错。设计坐标 = x + 640 / 360 - y。 */
    if (OPT.dbg) {
        const dump = (n) => {
            if (n.name === 'Pets') {
                for (const c of n.children) {
                    const ut = c.getComponent(UITransform);
                    const sc = c.scale;
                    console.log('[pet]', c.name,
                        'x', (c.position.x + 640).toFixed(1),
                        'y', (360 - c.position.y).toFixed(1),
                        'w', ut ? (ut.contentSize.width * sc.x).toFixed(1) : '-',
                        'h', ut ? (ut.contentSize.height * sc.y).toFixed(1) : '-',
                        's', sc.x.toFixed(3));
                }
            }
            /* Graphics 节点的笔画数：渲染图上"看不见但节点在"的层
               （烟/鸟/蝴蝶）靠这条分辨是没画还是画了没显形 */
            const gcomp = n.getComponent ? n.getComponent(Graphics) : null;
            if (gcomp) {
                /* 父链坐标 + 第一笔的实际颜色：这两样是"节点在、笔画在、
                   像素没有"这类问题的分水岭 —— 坐标错了是树的问题，
                   颜色错了是快照的问题。 */
                const chain = [];
                let q = n;
                while (q) { chain.push(`${q.name}(${q.position.x.toFixed(0)},${q.position.y.toFixed(0)})`); q = q.parent; }
                console.log('[gfx]', n.name, 'active', n.active,
                    'paths', gcomp.paths.length,
                    'chain', chain.join(' < '),
                    'p0', JSON.stringify(gcomp.paths[0]),
                    'p1', JSON.stringify(gcomp.paths[1]));
            }
            for (const c of n.children || []) dump(c);
        };
        dump(scene);
    }

    fs.writeFileSync(OUT, cv.toBuffer('image/png'));
    console.log(`✓ ${path.relative(CLIENT, OUT)}  Sprite ${nSprite} / Label ${nLabel} / Graphics ${nGraph}` +
        (missed.length ? `  缺贴图 ${missed.length}` : ''));
    for (const m of missed) console.log('   · ' + m);
})();
