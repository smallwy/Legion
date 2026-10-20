/**
 * `cc` 模块的**运行时**桩（仅 fx-smoke 用，不要拷进游戏工程）。
 * 目的：在沙箱里没有 Cocos 编辑器的情况下，真正 `new FxSystem()` 跑起来，
 * 记录 Graphics 收到的绘制调用，从而验证字模位与绘制次数。
 */
'use strict';

class Color {
    constructor(r = 255, g = 255, b = 255, a = 255) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }
    toString() {
        return `rgba(${this.r},${this.g},${this.b},${this.a})`;
    }
}

/** 记录型 Graphics：把每次 fill/stroke 连同其路径形状数量记下来 */
class Graphics {
    constructor() {
        this.calls = [];
        this._pathRects = 0;
        this._pathOther = 0;
        this._fillColor = null;
        this._strokeColor = null;
        this.lineWidth = 1;
    }
    clear() {
        this.calls = [];
        this._pathRects = 0;
        this._pathOther = 0;
    }
    set fillColor(c) { this._fillColor = c; }
    get fillColor() { return this._fillColor; }
    set strokeColor(c) { this._strokeColor = c; }
    get strokeColor() { return this._strokeColor; }

    rect() { this._pathRects++; }
    circle() { this._pathOther++; }
    moveTo() { this._pathOther++; }
    lineTo() { this._pathOther++; }
    close() { /* noop */ }

    fill() {
        this.calls.push({ type: 'fill', rects: this._pathRects, other: this._pathOther, color: this._fillColor });
        this._pathRects = 0;
        this._pathOther = 0;
    }
    stroke() {
        this.calls.push({ type: 'stroke', rects: this._pathRects, other: this._pathOther, color: this._strokeColor });
        this._pathRects = 0;
        this._pathOther = 0;
    }
}

class UITransform {}
class Component {}

class Node {
    constructor(name = '') {
        this.name = name;
        this.children = [];
        this.active = true;
        this._comps = [];
        this.x = 0; this.y = 0; this.z = 0;
    }
    addChild(n) { this.children.push(n); n.parent = this; }
    addComponent(cls) { const c = new cls(); this._comps.push(c); return c; }
    setPosition(x, y, z) { this.x = x; this.y = y; if (z !== undefined) this.z = z; }
    setScale() { /* noop */ }
    setSiblingIndex() { /* noop */ }
}

module.exports = { Color, Graphics, Node, UITransform, Component };
