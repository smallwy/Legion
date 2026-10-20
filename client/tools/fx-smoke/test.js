/**
 * FxSystem 离线冒烟测试（沙箱里没有 Cocos 编辑器，跑不了真机，但能跑真代码）。
 *
 * 它验证的四件事，都是"编译能过但一跑就错"的类型：
 *  1. 字模位有没有反（3×5 的 3 bit 行，翻错一列整个数字就变形）
 *  2. 横向 run 合并有没有生效（每个数字应该是 3~7 个 rect，不是 15 个）
 *  3. 粒子/飘字的**同屏上限**有没有生效（这是 DrawCall 与帧率的保险丝）
 *  4. 一顿狂刷之后会不会抛异常 / 数组无限增长
 *
 * 运行：node tools/fx-smoke/test.js
 */
'use strict';

const path = require('path');
const assert = require('assert');
const Module = require('module');

/**
 * 把 `require('cc')` 劫持到本地桩。
 * 不用 `build/node_modules/cc/` 那套目录约定的原因：仓库 .gitignore 里有
 * `node_modules/` 和 `build/`，桩文件会被静默忽略掉 —— 别人拉下来直接跑不通。
 */
const CC_STUB = path.join(__dirname, 'cc-runtime-stub.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (request === 'cc') return CC_STUB;
    return origResolve.call(this, request, ...rest);
};

const { FxSystem } = require(path.join(__dirname, 'build', 'view', 'FxSystem.js'));
const { Node, Graphics } = require(CC_STUB);

let passed = 0;
function ok(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ok   ' + name);
    } catch (e) {
        console.log('  FAIL ' + name + '\n       ' + e.message);
        process.exitCode = 1;
    }
}

function makeFx() {
    const parent = new Node('Field');
    const fx = new FxSystem(parent);
    // FxSystem 是 Graphics 的宿主节点
    const layer = parent.children[0];
    const g = layer._comps.find((c) => c instanceof Graphics);
    return { fx, g };
}

function totalRects(g) {
    return g.calls.reduce((n, c) => n + c.rects + c.other, 0);
}
function fills(g) {
    return g.calls.filter((c) => c.type === 'fill');
}

console.log('\n== FxSystem 冒烟 ==');

ok('空场景重画：0 次 fill（不该有无用绘制）', () => {
    const { fx, g } = makeFx();
    fx.redraw();
    assert.strictEqual(fills(g).length, 0, '空场景产生了 fill');
});

ok('爆散 10 颗 → 恰好 10 个 rect', () => {
    const { fx, g } = makeFx();
    fx.burst(0, 0, 'tank', 10);
    fx.redraw();
    assert.strictEqual(totalRects(g), 10, 'rect 数不是 10，实际 ' + totalRects(g));
});

ok('同色粒子合并成 1 次 fill（不是每颗一次）', () => {
    const { fx, g } = makeFx();
    fx.burst(0, 0, 'tank', 10);
    fx.redraw();
    assert.strictEqual(fills(g).length, 1, '同色同档应只 1 次 fill，实际 ' + fills(g).length);
});

ok('粒子会自然消亡，2 秒后不再有任何绘制', () => {
    const { fx, g } = makeFx();
    fx.burst(0, 0, 'walker', 10);
    for (let i = 0; i < 130; i++) fx.tick(1 / 60);   // ≈2.2s
    fx.redraw();
    assert.strictEqual(totalRects(g), 0, '2 秒后还剩 ' + totalRects(g) + ' 个图形');
});

ok('粒子池上限生效：塞 300 颗只留 200', () => {
    const { fx, g } = makeFx();
    fx.burst(0, 0, 'tank', 300);
    fx.redraw();
    assert.strictEqual(totalRects(g), 200, '上限没生效，实际 ' + totalRects(g));
});

ok('字模 "+35" → 13 个 rect（3+5+5，run 合并生效）', () => {
    const { fx, g } = makeFx();
    fx.text(0, 0, '+35', 'safe', 3);
    fx.redraw();
    assert.strictEqual(totalRects(g), 13, '实际 ' + totalRects(g) + '，说明 run 合并或字模错了');
});

ok('字模 "8" → 7 个 rect（三横三竖，最多的一位数）', () => {
    const { fx, g } = makeFx();
    fx.text(0, 0, '8', 'white', 3);
    fx.redraw();
    assert.strictEqual(totalRects(g), 7, '实际 ' + totalRects(g));
});

ok('字模 "1" → 5 个 rect', () => {
    const { fx, g } = makeFx();
    fx.text(0, 0, '1', 'white', 3);
    fx.redraw();
    assert.strictEqual(totalRects(g), 5, '实际 ' + totalRects(g));
});

ok('飘字上限生效：刷 30 条只留 12 条', () => {
    // '9' = [7,5,7,1,7] → 1+2+1+1+1 = 6 个 rect；12 条 × 6 = 72
    const { fx, g } = makeFx();
    for (let i = 0; i < 30; i++) fx.text(i * 10, 0, '9', 'white', 3);
    fx.redraw();
    assert.strictEqual(totalRects(g), 72, '实际 ' + totalRects(g) + '，上限可能是 12 但拦错了');
});

ok('无法识别的字符被丢弃（中文不该画出一堆乱方块）', () => {
    const { fx, g } = makeFx();
    fx.text(0, 0, '升级呀', 'gold', 3);
    fx.redraw();
    assert.strictEqual(totalRects(g), 0, '未知字符产生了绘制');
});

ok('扩散圈会自己结束（不会永久占着 maxRings 名额）', () => {
    const { fx, g } = makeFx();
    fx.ring(0, 0, 'gold', 100, 0.5, 3);
    for (let i = 0; i < 60; i++) fx.tick(1 / 60);   // 1s > dur 0.5
    fx.redraw();
    assert.strictEqual(g.calls.filter((c) => c.type === 'stroke').length, 0, '圈没结束');
});

ok('狂刷 600 帧不抛异常、内存不无限增长', () => {
    const { fx } = makeFx();
    for (let f = 0; f < 600; f++) {
        fx.hit(Math.random() * 100, Math.random() * 100, 1, 0.2, 'walker');
        if (f % 3 === 0) fx.burst(0, 0, 'tank', 10);
        if (f % 11 === 0) fx.text(0, 0, '12', 'white', 3);
        if (f % 29 === 0) fx.ring(0, 0, 'gold', 100, 0.5);
        fx.tick(1 / 60);
        fx.redraw();
    }
    const ps = fx._ps.length;
    const ts = fx._texts.length;
    const rs = fx._rings.length;
    assert.ok(ps <= 210, '粒子内部数组涨到 ' + ps);
    assert.ok(ts <= 14, '飘字内部数组涨到 ' + ts);
    assert.ok(rs <= 10, '圈内部数组涨到 ' + rs);
});

ok('失效项尚未回收时也能出特效（复用空槽，不是把数组长度当上限）', () => {
    const { fx, g } = makeFx();
    fx.burst(0, 0, 'tank', 200);
    // 模拟"已经死了但还没到 0.5s 回收时机"：数组长度仍是 200
    for (const p of fx._ps) p.active = false;
    fx.burst(0, 0, 'tank', 10);
    fx.redraw();
    assert.strictEqual(totalRects(g), 10, '空槽没被复用，实际 ' + totalRects(g) + ' 个图形');
});

ok('clear() 之后一片干净', () => {
    const { fx, g } = makeFx();
    fx.burst(0, 0, 'tank', 20);
    fx.text(0, 0, '99', 'white', 3);
    fx.ring(0, 0, 'gold', 100, 0.5);
    fx.clear();
    fx.redraw();
    assert.strictEqual(totalRects(g), 0, 'clear 后仍有绘制');
    assert.strictEqual(fx._ps.length, 0);
});

console.log('\n通过 ' + passed + ' / 14\n');
