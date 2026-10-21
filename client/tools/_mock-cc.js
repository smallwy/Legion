/**
 * _mock-cc.js —— 极简 `cc` 运行时替身，只为实现 HomeRuntime 的端到端验证。
 *
 * 目的：不打开 Cocos 编辑器，也能证明「宠物会动 / 按钮被点到了 / 弹层出现了」。
 * 只 mock HomeRuntime 用到的 API，不追求行为完整。
 */

class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vec3(this.x, this.y, this.z); }
}

class Color {
    constructor(r = 255, g = 255, b = 255, a = 255) {
        this.r = r; this.g = g; this.b = b; this.a = a;
    }
}

class Node {
    constructor(name = 'Node') {
        this.name = name;
        this._parent = null;
        this.children = [];
        this._pos = new Vec3();
        this._scale = new Vec3(1, 1, 1);
        this.active = true;
        this._comps = [];
        this._listeners = Object.create(null);
        this.destroyed = false;
    }

    get parent() { return this._parent; }
    set parent(p) {
        if (this._parent) {
            const i = this._parent.children.indexOf(this);
            if (i >= 0) this._parent.children.splice(i, 1);
        }
        this._parent = p;
        if (p && p.children.indexOf(this) < 0) p.children.push(this);
    }

    get position() {
        /* 按现场报错反推的行为：节点销毁后 `position` 不再返回 Vec3。
           线上报的是 "Cannot read properties of null (reading 'x')"，
           读的就是这里返回的对象 —— 所以 mock 必须如实复现，
           否则"切场景后旧控制器还在跑"这个问题在离线测试里永远看不见。 */
        return this.destroyed ? null : this._pos;
    }
    set position(v) { this._pos = new Vec3(v.x, v.y, v.z || 0); }

    get scale() { return this._scale; }

    setPosition(x, y, z) {
        if (typeof x === 'object') this._pos = new Vec3(x.x, x.y, x.z || 0);
        else this._pos = new Vec3(x, y, z || 0);
    }

    setScale(x, y, z) { this._scale = new Vec3(x, y, z === undefined ? 1 : z); }

    get worldPosition() {
        let x = 0, y = 0, n = this;
        while (n) { x += n._pos.x; y += n._pos.y; n = n._parent; }
        return new Vec3(x, y, 0);
    }

    addComponent(C) {
        const c = new C();
        c.node = this;
        this._comps.push(c);
        return c;
    }

    getComponent(C) {
        for (const c of this._comps) if (c instanceof C) return c;
        return null;
    }

    getChildByName(n) {
        for (const c of this.children) if (c.name === n) return c;
        return null;
    }

    on(type, cb) {
        (this._listeners[type] || (this._listeners[type] = [])).push(cb);
    }

    off(type, cb) {
        const a = this._listeners[type];
        if (!a) return;
        const i = a.indexOf(cb);
        if (i >= 0) a.splice(i, 1);
    }

    /** 测试用：模拟引擎派发一次触摸 */
    emitTouch(type) {
        const ev = { propagationStopped: false, type };
        for (const cb of (this._listeners[type] || []).slice()) cb(ev);
        return ev;
    }

    hasListener(type) { return !!(this._listeners[type] && this._listeners[type].length); }

    removeFromParent() {
        if (!this._parent) return;
        const i = this._parent.children.indexOf(this);
        if (i >= 0) this._parent.children.splice(i, 1);
        this._parent = null;
    }

    setSiblingIndex(i) {        const p = this._parent;
        if (!p) return;
        const cur = p.children.indexOf(this);
        if (cur < 0) return;
        p.children.splice(cur, 1);
        const at = i < 0 ? p.children.length : Math.min(i, p.children.length);
        p.children.splice(at, 0, this);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this._parent) {
            const i = this._parent.children.indexOf(this);
            if (i >= 0) this._parent.children.splice(i, 1);
        }
    }

    /** 真实引擎销毁场景时会级联，mock 里手动级联，供"切场景"测试使用 */
    destroyTree() {
        for (const c of this.children.slice()) c.destroyTree();
        this.destroy();
    }

    get isValid() { return !this.destroyed; }
}

/* Cocos 的触摸事件名常量 */
Node.EventType = {
    TOUCH_START: 'touch-start',
    TOUCH_END: 'touch-end',
    TOUCH_CANCEL: 'touch-cancel',
    TOUCH_MOVE: 'touch-move',
};

class Scene extends Node {}

class UITransform {
    constructor() {
        this.contentSize = { width: 0, height: 0 };
        this._anchorPoint = { x: 0.5, y: 0.5 };
    }
    setContentSize(w, h) {
        if (typeof w === 'object') this.contentSize = { width: w.width, height: w.height };
        else this.contentSize = { width: w, height: h };
    }
    /** 测试里 Canvas 位于原点，世界坐标即本地坐标 */
    convertToNodeSpaceAR(v) { return new Vec3(v.x, v.y, v.z || 0); }
}

class UIOpacity { constructor() { this.opacity = 255; } }

class Label {
    constructor() {
        this.string = '';
        this.fontSize = 20;
        this.lineHeight = 26;
        this.color = new Color();
        this.horizontalAlign = 1;
        this.verticalAlign = 1;
        this.overflow = 0;
    }
}
Label.HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 };
Label.VerticalAlign = { TOP: 0, CENTER: 1, BOTTOM: 2 };
Label.Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 };

class Sprite { constructor() { this.color = new Color(); this.spriteFrame = null; } }

class Graphics {
    constructor() {
        this.fillColor = new Color();
        this.strokeColor = new Color();
        this.lineWidth = 1;
        this.paths = [];
    }
    rect(x, y, w, h) { this.paths.push(['rect', x, y, w, h]); }
    roundRect(x, y, w, h, r) { this.paths.push(['roundRect', x, y, w, h, r]); }
    fill() { this.paths.push(['fill']); }
    stroke() { this.paths.push(['stroke']); }
    clear() { this.paths.length = 0; }
}

class EventTouch {}

/* ---- tween：测试里同步跑完，只保证 call 会执行、属性会写入 ---- */
function tween(target) {
    const ops = [];
    const h = {
        to(dur, props) { ops.push({ dur, props }); return h; },
        by(dur, props) { ops.push({ dur, props, by: true }); return h; },
        delay() { return h; },
        call(cb) { ops.push({ cb }); return h; },
        start() {
            for (const o of ops) {
                if (o.cb) o.cb();
                else if (o.props) {
                    for (const k of Object.keys(o.props)) {
                        const v = o.props[k];
                        if (o.by && target[k] && typeof target[k] === 'object') {
                            target[k] = new Vec3(target[k].x + v.x, target[k].y + v.y, 0);
                        } else {
                            target[k] = v;
                        }
                    }
                }
            }
            return h;
        },
        stop() { return h; },
    };
    return h;
}
tween.stopAllByTarget = () => { };

/* ---- director ---- */
const director = {
    _scene: null,
    _handlers: Object.create(null),
    EVENT_AFTER_SCENE_LAUNCH: 'after-scene-launch',
    EVENT_BEFORE_SCENE_LAUNCH: 'before-scene-launch',
    EVENT_BEFORE_UPDATE: 'before-update',
    /* 测试用：记录最近一次 loadScene 的目标场景名 */
    _loaded: null,
    loadScene(name, cb) {
        this._loaded = name;
        if (cb) cb(null, null);
    },
    getScene() { return this._scene; },
    setScene(s) { this._scene = s; },
    on(ev, cb, target) { (this._handlers[ev] || (this._handlers[ev] = [])).push(cb); },
    emit(ev) { for (const cb of (this._handlers[ev] || []).slice()) cb(); },
    listenerCount(ev) { return (this._handlers[ev] || []).length; },
};

const Director = {
    EVENT_AFTER_SCENE_LAUNCH: 'after-scene-launch',
    EVENT_BEFORE_SCENE_LAUNCH: 'before-scene-launch',
    EVENT_BEFORE_UPDATE: 'before-update',
};

/* EDITOR 用 getter 读全局开关，这样同一个 mock 可以分别模拟「运行时」和「编辑器」 */
const exportsObj = {
    Node, Scene, UITransform, UIOpacity, Label, Sprite, Graphics,
    Color, Vec3, EventTouch, tween, director, Director,
};
Object.defineProperty(exportsObj, 'EDITOR', {
    get() { return globalThis.__MOCK_EDITOR === true; },
    enumerable: true,
});

module.exports = exportsObj;
