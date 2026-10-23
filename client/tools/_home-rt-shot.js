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
            if (sf && sf.uuid) sfToPng.set(sf.uuid, p.replace(/\.meta$/, ''));
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
    else if (!a.startsWith('--')) OPT.out = a;
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

const W = 1280, H = 720, CX = W / 2, CY = H / 2;
const OUT = path.join(CLIENT, 'shots', OPT.out + '.png');

if (OPT.audit) audit();

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
                const file = sfToPng.get(uuid);
                if (!file) { missed.push(n.name + ' ← ' + uuid); continue; }
                const im = await img(file);
                const w = (ut ? ut.contentSize.width : im.width) * s;
                const h = (ut ? ut.contentSize.height : im.height) * s;
                const ax = ut ? ut._anchorPoint.x : 0.5;
                const ay = ut ? ut._anchorPoint.y : 0.5;
                const col = comp.color;
                const src = (col.r !== 255 || col.g !== 255 || col.b !== 255)
                    ? await tint(file, col) : im;
                g.save();
                g.globalAlpha = alpha * (col.a / 255);
                g.drawImage(src, px - ax * w, py - (1 - ay) * h, w, h);
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
            for (const c of n.children || []) dump(c);
        };
        dump(scene);
    }

    fs.writeFileSync(OUT, cv.toBuffer('image/png'));
    console.log(`✓ ${path.relative(CLIENT, OUT)}  Sprite ${nSprite} / Label ${nLabel} / Graphics ${nGraph}` +
        (missed.length ? `  缺贴图 ${missed.length}` : ''));
    for (const m of missed) console.log('   · ' + m);
})();
