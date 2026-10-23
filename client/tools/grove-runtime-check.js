/**
 * GroveRuntime 运行时体检
 * ============================================================================
 *   node client/tools/grove-runtime-check.js
 *
 * 为什么要有这个脚本：
 *   GroveRuntime.ts 是从 grove.html 抽出来的，抽取过程会剥掉 canvas/rAF/DOM。
 *   剥错了的表现是"Cocos 里黑屏"，而黑屏在浏览器里几乎无法定位
 *   （既没有报错栈指向源码，也没有断点位置）。
 *   所以这里用一个万能 canvas 上下文桩，在 node 里把玩法真跑几十秒，
 *   抽取一坏就立刻红。
 *
 * 验什么：
 *   ① 模块能被解析/执行（语法 + 没有残留的 DOM 硬依赖）
 *   ② groveBoot 能开局，八关都能进、能跑满 10 秒不抛
 *   ③ tick + render 每帧都跑（render 是绘制层，崩在这里等于黑屏）
 *   ④ groveSetExitHook 接管"收工回家"
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TS = path.join(ROOT, 'assets', 'scripts', 'grove', 'GroveRuntime.ts');

/* ---------------- 1) TS -> 可执行 JS ---------------- */
function toJs(ts) {
    let s = ts;
    // 导出统统去掉，最后手动 return 一份出来
    s = s.replace(/^export\s+/gm, '');

    // 全文件只有下面这几处类型注解（抽取脚本自己写的），精确剥掉。
    // 出现次数不对就报错 —— 静默半剥会生成一个语法错误，报错行号还指不到真凶。
    const subs = [
        ['let cv: any = null;', 'let cv = null;'],
        ['let ctx: any = null;', 'let ctx = null;'],
        ['let exitHook: ((kind: string) => void) | null = null;', 'let exitHook = null;'],
        ['function groveExit(kind: string): boolean {', 'function groveExit(kind) {'],
        ['function groveSetExitHook(fn: ((kind: string) => void) | null): void {', 'function groveSetExitHook(fn) {'],
        ['function groveBoot(hero?: number, stage?: number): void {', 'function groveBoot(hero, stage) {'],
        ['const GROVE: any = {', 'const GROVE = {'],
        ['const s: any = readHomeSave();', 'const s = readHomeSave();'],
        ['function groveAttachCanvas(c: any): void {', 'function groveAttachCanvas(c) {'],
        ['function groveTick(dt: number): void { tick(dt); }', 'function groveTick(dt) { tick(dt); }'],
        ['function groveRender(): any { return render(); }', 'function groveRender() { return render(); }'],
        ['function onCanvasMove(loc: any): void {', 'function onCanvasMove(loc) {'],
        ['function onCanvasDown(loc: any): void {', 'function onCanvasDown(loc) {'],
        ['function grovePointer(kind: "move" | "down", x: number, y: number): void {', 'function grovePointer(kind, x, y) {'],
        /* nudgeOutOfStumps 是防卡死的保险。它带 `f: any` 与两处 `as any` ——
           都不合法于 JS，必须跟着剥。注意这里剥的是**形参标注**，
           不是把整个函数删掉：这个函数本身要被真的跑到。 */
        ['function nudgeOutOfStumps(f: any): void {', 'function nudgeOutOfStumps(f) {'],
        ['const stumps = (S.stumps as any[]);', 'const stumps = S.stumps;'],
        ['const p0 = (S.p as any);', 'const p0 = S.p;'],
    ];
    for (const [a, b] of subs) {
        if (s.indexOf(a) < 0) throw new Error('剥类型失败，找不到：' + a);
        s = s.split(a).join(b);
    }
    return s;
}

/* ---------------- 2) 万能 Canvas 2D 桩 ----------------
   绘制代码有上千次 ctx 调用（渐变/贝塞尔/图片/文字），
   逐个实现是体力活且容易漏 —— 用一个"什么都能调、什么都能取"的 Proxy。
   取属性返回自己、调用返回自己、转数字返回 0，于是数值参与运算也不会崩。 */
function makeCtxProxy() {
    let any;
    const handler = {
        get(t, k) {
            if (k === Symbol.toPrimitive) return () => 0;
            if (k === 'toString') return () => '';
            if (k === 'valueOf') return () => 0;
            return any;
        },
        set() { return true; },
        apply() { return any; },
        construct() { return any; },
    };
    any = new Proxy(function () {}, handler);
    return any;
}

const ctxStub = makeCtxProxy();
const canvasStub = {
    width: 960,
    height: 600,
    getContext: () => ctxStub,
};

/* ---------------- 3) DOM 桩 ---------------- */
const store = new Map();
const localStorageStub = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
};

const documentStub = {
    getElementById: () => null,       // unlockTip / toHome：外面都有 null 保护
    createElement: () => canvasStub,
};

const windowStub = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => {},
    removeEventListener: () => {},
};

/* ---------------- 4) 装进函数跑起来 ---------------- */
function load() {
    const src = toJs(fs.readFileSync(TS, 'utf8'));
    const tail = '\nreturn { groveAttachCanvas, groveBoot, groveTick, groveRender, groveSetExitHook, grovePointer, GROVE };';
    const factory = new Function(
        'window', 'document', 'localStorage', 'location', 'navigator',
        'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'console',
        src + tail,
    );
    return factory(
        windowStub, documentStub, localStorageStub,
        { search: '', href: '' }, { userAgent: 'node' },
        setTimeout, clearTimeout, () => 0, console,
    );
}

/* ---------------- 5) 断言 ---------------- */
let pass = 0;
const fails = [];
function ok(cond, name, extra) {
    if (cond) { pass++; return; }
    fails.push(name + (extra ? '  [' + extra + ']' : ''));
    console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : ''));
}

const T0 = Date.now();
console.log('GroveRuntime 运行时体检');
console.log('  源 ' + path.relative(ROOT, TS));

const G = load();
ok(typeof G.groveBoot === 'function', '模块可执行，groveBoot 已导出');
ok(G.GROVE && Array.isArray(G.GROVE.LEVELS), 'GROVE.LEVELS 已导出');
ok(G.GROVE.LEVELS.length === 8, '八关都在', 'n=' + G.GROVE.LEVELS.length);

G.groveAttachCanvas(canvasStub);

/* 每关跑 10 秒（600 帧 @60fps），tick + render 都跑 */
const SEC = 600;
for (let i = 0; i < G.GROVE.LEVELS.length; i++) {
    const lv = G.GROVE.LEVELS[i];
    const tag = (i + 1) + ' ' + lv.name;
    let err = null;
    try {
        G.groveBoot(0, i);
        for (let f = 0; f < SEC; f++) {
            G.groveTick(1 / 60);
            G.groveRender();
        }
    } catch (e) {
        err = e;
    }
    ok(!err, '第 ' + tag + ' 跑 10 秒不抛', err ? String(err && err.message || err) : '');
    if (err) console.log(err);
}

/* 收工回家：钩子必须被子系统叫到，而不是去跳 URL */
let exited = null;
G.groveSetExitHook((k) => { exited = k; });
try { G.GROVE.goHome(false); } catch (e) { /* goHome 里可能有渲染相关副作用 */ }
ok(exited === 'done', 'goHome 会通知退出钩子', 'kind=' + exited);

/* 状态自检：跑到这里，玩家/球/敌人这些核心对象都得是活的 */
const S = G.GROVE.S;
ok(S && typeof S === 'object', 'S（全局状态）存在');
ok(S.phase === 'select' || S.phase === 'play' || S.phase === 'clear' || S.phase === 'fail',
   'S.phase 是已知状态', 'phase=' + (S && S.phase));

console.log('');
if (fails.length) {
    console.log('✗ ' + fails.length + ' 项失败 / 共 ' + (pass + fails.length) + ' 项');
    process.exit(1);
}
console.log('✓ ' + pass + ' 项全绿（' + ((Date.now() - T0) / 1000).toFixed(1) + 's）');
