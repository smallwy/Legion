/**
 * _rt-frames.js —— 抓一段行走的连续帧 + 姿态曲线
 *
 * 上一版只抓 4 个稀疏时刻，只能证明"位置在变"，证明不了"动作像不像"。
 * 这一版做两件事：
 *   1. 逐帧记录砂糖的 x / y / scaleX / scaleY / angle；
 *   2. 定位一次跳跃的起点，从起点连续取 8 帧（间隔约 0.05s），
 *      连同 _lpos/_lscale/_lrot 写进场景副本，交给 _render-scene.js 出图。
 *
 * 输出：temp/_frames/hop<序号>.scene + 控制台姿态表
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', {
    value: { now: () => fakeNow }, configurable: true, writable: true,
});

const MOCK = path.join(__dirname, '_mock-cc.js');
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) {
    if (r === 'cc' || r === 'cc/env') return MOCK;
    return orig.call(this, r, ...a);
};

const cc = require(MOCK);
const { Node, Scene, UITransform, director, Director } = cc;

const SCENE = path.join(__dirname, '..', 'assets', 'scenes', 'Home.scene');
const RAW = JSON.parse(fs.readFileSync(SCENE, 'utf8'));

function buildScene() {
    const si = RAW.findIndex((x) => x.__type__ === 'cc.Scene');
    const scene = new Scene(RAW[si]._name);
    const map = new Map();

    function build(idx, parent) {
        const d = RAW[idx];
        const node = new Node(d._name || '?');
        const lp = d._lpos || {};
        node.setPosition(lp.x || 0, lp.y || 0, lp.z || 0);
        node.parent = parent;
        map.set(node, idx);
        for (const cref of (d._components || [])) {
            const comp = RAW[cref.__id__];
            if (comp && comp.__type__ === 'cc.UITransform') {
                const ut = node.addComponent(UITransform);
                const cs = comp._contentSize || {};
                ut.setContentSize(cs.width || 0, cs.height || 0);
                ut._anchorPoint = {
                    x: (comp._anchorPoint && comp._anchorPoint.x) ?? 0.5,
                    y: (comp._anchorPoint && comp._anchorPoint.y) ?? 0.5,
                };
            }
        }
        for (const cref of (d._children || [])) build(cref.__id__, node);
    }
    for (const cref of (RAW[si]._children || [])) build(cref.__id__, scene);
    return { scene, map };
}

const { scene, map } = buildScene();
director.setScene(scene);
require(path.join(__dirname, '_rt-build', 'HomeRuntime.js'));

const canvas = scene.getChildByName('Canvas');
const sugar = canvas.getChildByName('Pets').getChildByName('砂糖');
const sugarIdx = map.get(sugar);
const BASE_Y = sugar.position.y;

/* ---------- 逐帧录制 ---------- */
const FRAMES = 60 * 25;          // 录 25 秒
const rec = [];
for (let i = 0; i < FRAMES; i++) {
    fakeNow += 1000 / 60;
    director.emit(Director.EVENT_BEFORE_UPDATE);
    rec.push({
        i,
        x: sugar.position.x,
        y: sugar.position.y,
        sx: sugar.scale.x,
        sy: sugar.scale.y,
        rot: sugar.angle || 0,
    });
}

/* ---------- 找一段"走得最远"的连续 24 帧 ----------
 *
 * 上一版找的是"蹦跳"，现在已经不是蹦跳了：判定条件换成**位移**。
 * 取位移最大的 24 帧窗口（12 个采样点 × 2 帧步长 = 0.4 秒），
 * 这样拍到的必然是一段真正在走的动作，而不是站着呼吸。
 */
let s = 0;
let best = -1;
for (let i = 6; i + 24 < rec.length; i += 3) {
    const d = Math.hypot(rec[i + 24].x - rec[i].x, rec[i + 24].y - rec[i].y);
    if (d > best) { best = d; s = i; }
}
if (best < 3) { console.error('没抓到行走 —— 检查 startWalk 是否被调用'); process.exit(1); }

const PICKS = [];
for (let k = 0; k < 12; k++) PICKS.push(rec[Math.min(rec.length - 1, s + k * 2)]);

/* ---------- 姿态表 ---------- */
console.log('一段行走的姿态序列（每 0.033s）：\n');
console.log("  t(ms)   x(design)  yOff    scaleX  scaleY  angle");
for (let k = 0; k < PICKS.length; k++) {
    const r = PICKS[k];
    console.log(
        '  ' + String(Math.round(k * 33)).padStart(4) +
        '   ' + (r.x + 640).toFixed(1).padStart(7) +
        '   ' + (r.y - BASE_Y).toFixed(2).padStart(6) +
        '   ' + r.sx.toFixed(3).padStart(6) +
        '   ' + r.sy.toFixed(3).padStart(6) +
        '   ' + r.rot.toFixed(2).padStart(6)
    );
}

/* 挤压拉伸幅度：这是"像不像在动"的核心指标，而不是位移 */
const syMin = Math.min(...PICKS.map((r) => r.sy));
const syMax = Math.max(...PICKS.map((r) => r.sy));
const rotMax = Math.max(...PICKS.map((r) => Math.abs(r.rot)));
const xSpan = Math.max(...PICKS.map((r) => r.x)) - Math.min(...PICKS.map((r) => r.x));
const ySpan = Math.max(...PICKS.map((r) => r.y)) - Math.min(...PICKS.map((r) => r.y));
console.log(`\n  缩放区间 ${(syMin * 100).toFixed(1)}% ~ ${(syMax * 100).toFixed(1)}%` +
    `（幅度 ${((syMax - syMin) * 100).toFixed(1)}%）  最大摇摆 ${rotMax.toFixed(2)}°`);
console.log(`  0.4 秒内位移：横 ${xSpan.toFixed(1)}px / 纵 ${ySpan.toFixed(1)}px`);

/* ---------- 写场景副本 ---------- */
const OUTDIR = path.join(__dirname, '..', 'temp', '_frames');
fs.mkdirSync(OUTDIR, { recursive: true });

/* 清掉上一版的 t??.scene，避免和这一版混在一起 */
for (const f of fs.readdirSync(OUTDIR)) {
    if (/^(t\d+|hop\d+)\.scene$/.test(f)) fs.unlinkSync(path.join(OUTDIR, f));
}

for (let k = 0; k < PICKS.length; k++) {
    const r = PICKS[k];
    const doc = JSON.parse(JSON.stringify(RAW));
    const n = doc[sugarIdx];
    n._lpos.x = +r.x.toFixed(2);
    n._lpos.y = +r.y.toFixed(2);
    n._lscale = { x: +r.sx.toFixed(4), y: +r.sy.toFixed(4), z: 1 };
    const half = (r.rot * Math.PI / 180) / 2;
    n._lrot = { x: 0, y: 0, z: +Math.sin(half).toFixed(6), w: +Math.cos(half).toFixed(6) };
    fs.writeFileSync(path.join(OUTDIR, `hop${k}.scene`), JSON.stringify(doc));
}

console.log(`\n  写出 ${PICKS.length} 个场景副本 → temp/_frames/hop0..${PICKS.length - 1}.scene`);
