/**
 * _mock-cc.js —— 极简 `cc` 运行时替身，只为实现 HomeRuntime 的端到端验证。
 *
 * 目的：不打开 Cocos 编辑器，也能证明「宠物会动 / 按钮被点到了 / 弹层出现了」。
 * 只 mock HomeRuntime 用到的 API，不追求行为完整。
 */
const fs = require('fs');
const path = require('path');

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

    /* 真实引擎的 `setParent(n)` = 从旧父摘下 + 挂到新父。
       `node.parent = n` 也能用，但两处语义不完全一样（引擎里 setParent 还会
       保留/重置本地变换、处理激活状态），代码里既然写的是 setParent，
       替身就得有同名方法 —— 少一个方法不会给出"找不到"的清晰报错，
       而是 `plate.setParent is not a function`，看着像业务代码写错了。 */
    setParent(p) {
        if (this._parent === p) return;
        this.removeFromParent();
        this._parent = p || null;
        if (p) p.children.push(this);
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

/* ==========================================================================
   组件基类：`isValid`
   --------------------------------------------------------------------------
   真引擎里**每个 Component 都有 `isValid`**，业务代码大量用它做守卫
   （HomeRuntime.ts 里 24 处，`if (x && x.isValid)`）。
   桩里原来只有 Node 有 —— 于是这些守卫在离线渲染里**全部静默为假**：
   tick 里的实时刷新一行不跑，画面停在初始状态，而断言和截图都"正常"。
   这就是「测试测了空集」：不是没测，是测的那条路从来没被走进来。

   桩里的语义取"只要没被 destroy 就有效"。Node.destroy() 只摘父不断子组件，
   所以这里不做联动 —— 桩要的是"别把有效代码静默跳过"，不是完整生命周期。
   ========================================================================== */
class Comp {
    get isValid() { return !this._destroyed; }
    destroy() { this._destroyed = true; }
}

class UITransform extends Comp {
    constructor() {
        super();
        this.contentSize = { width: 0, height: 0 };
        this._anchorPoint = { x: 0.5, y: 0.5 };
    }
    setContentSize(w, h) {
        if (typeof w === 'object') this.contentSize = { width: w.width, height: w.height };
        else this.contentSize = { width: w, height: h };
    }
    setAnchorPoint(x, y) {
        if (typeof x === 'object') this._anchorPoint = { x: x.x, y: x.y };
        else this._anchorPoint = { x, y };
    }
    get width() { return this.contentSize.width; }
    get height() { return this.contentSize.height; }
    /* ⚠ `anchorX` / `anchorY` 是 UITransform 上**独立于 `_anchorPoint`** 的存取器，
       真引擎里有。缺了它们，`left + w * ut.anchorX` 会算出 NaN，
       于是节点被 setPosition(NaN, NaN) —— 画面上直接消失，而且**不报错**。
       placeResources() 正是这么写的：三张资源卡在离线渲染里凭空失踪了好几轮，
       直到 _home-rt-shot.js 的 --audit 加了 NaN 报警才暴露。 */
    get anchorX() { return this._anchorPoint.x; }
    set anchorX(v) { this._anchorPoint.x = v; }
    get anchorY() { return this._anchorPoint.y; }
    set anchorY(v) { this._anchorPoint.y = v; }
    /** 测试里 Canvas 位于原点，世界坐标即本地坐标 */
    convertToNodeSpaceAR(v) { return new Vec3(v.x, v.y, v.z || 0); }
}

class UIOpacity extends Comp { constructor() { super(); this.opacity = 255; } }

class Label extends Comp {
    constructor() {
        super();
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

class Sprite extends Comp {
    constructor() { super(); this.color = new Color(); this.spriteFrame = null; this.sizeMode = 0; this.type = 0; }
}
/* 枚举要补齐：HomeRuntime 里 `sp.sizeMode = Sprite.SizeMode.CUSTOM` 是常见写法，
   桩里没有 SizeMode 就会在**运行时**抛 undefined.CUSTOM，
   而这行在 openSheet 里 —— 表现是"点了没反应"，比渲染错还难查。 */
Sprite.SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
Sprite.Type = { SIMPLE: 0, SLICED: 1, TILED: 2, FILLED: 3 };

class Graphics extends Comp {
    constructor() {
        super();
        this.fillColor = new Color();
        this.strokeColor = new Color();
        this.lineWidth = 1;
        this.paths = [];
    }
    rect(x, y, w, h) { this.paths.push(['rect', x, y, w, h]); }
    roundRect(x, y, w, h, r) { this.paths.push(['roundRect', x, y, w, h, r]); }
    circle(cx, cy, r) { this.paths.push(['circle', cx, cy, r]); }
    ellipse(cx, cy, rx, ry) { this.paths.push(['ellipse', cx, cy, rx, ry]); }
    moveTo(x, y) { this.paths.push(['moveTo', x, y]); }
    lineTo(x, y) { this.paths.push(['lineTo', x, y]); }
    close() { this.paths.push(['close']); }
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

/* ---- game / assetManager / SceneAsset ----
   这三个是 HomeRuntime 的「设置」和「进战斗」两条路要用的。
   最初没 mock，于是 `applyPrefs()` 一跑就 TypeError，
   整份 _rt-check 连断言都进不去 —— 而它报的是引擎 API 不存在，
   看起来像脚本写错，实际是替身缺件。补上之后才不会一直误判。 */
const game = { frameRate: 60 };

class SceneAsset {
    constructor() { this.scene = null; }
}

/* 默认走「载入失败」分支：离线环境没有真实资源包，
   能验证的重点是"失败后会回退、不会崩"。 */
const assetManager = {
    loadAny(uuid, cb) { cb(new Error('mock: 无资源包'), null); },
};

class SpriteFrame {
    constructor(name = 'SpriteFrame') {
        this._name = name;
        /* rect / originalSize 必须有：主界面按立绘宽高比算摆放宽度（`sf.rect.width/height`），
           桩里没有就是 undefined.width 直接崩在 openHome 里 */
        this.rect = { x: 0, y: 0, width: 64, height: 64 };
        this.originalSize = { width: 64, height: 64 };
    }
}

/* ImageAsset / Texture2D：只有「运行时从 ImageAsset 自己拼 SpriteFrame」那条
   兜底路径会用到（`grove/head/*` 的 meta 是 type:texture，没有 spriteFrame 子资源）。
   桩里给个空壳 —— 真正要验证的是"这条路不会崩"，不是纹理内容。 */
class ImageAsset {
    constructor() { this.width = 0; this.height = 0; this.data = null; }
}
class Texture2D {
    constructor() { this.image = null; }
}

/* resources：默认失败，但**能读到盘上的真图**就走真图。
   要验证的正是「图不在时主界面照常进」—— 所以缺图时**必须回调 err**，
   而不是永不回调：永不回调会让 _rt-check 挂在那儿等，比报错更难查。

   为什么现在要真读：图鉴 / 底部槽 / 出战卡的头像是运行时 `resources.load`
   拿到的（`grove/head/<short>`）。桩里一律失败的话，截图永远是"没有 ICON 的
   那一版"—— 拿它验收"ICON 补上了没有"会得出完全错的结论。
   约定：造出来的 SpriteFrame 用 `res:<相对 resources 的路径>` 当 `__uuid__`，
   截图脚本按这个前缀去 assets/resources 下找文件。 */
const RES_ROOT = path.join(__dirname, '..', 'assets', 'resources');
const resources = {
    load(rel, type, cb) {
        /* 回调在**第三个**参数，不是"第一个函数参数"。
           写成 `typeof type === 'function' ? type : cb` 会把 SpriteFrame 这个
           类当成回调直接调用 —— 症状是 "Class constructor cannot be invoked
           without 'new'"，看起来像 HomeRuntime 写错了。 */
        const done = typeof cb === 'function' ? cb : type;
        if (typeof done !== 'function') return;
        /* 形参不能叫 path —— 会把 node 的 path 模块盖掉，
           报的是 "path.join is not a function"，看着像模块坏了。 */
        const file = rel ? path.join(RES_ROOT, rel + '.png') : '';
        if (file && fs.existsSync(file)) {
            if (type === SpriteFrame) {
                const sf = new SpriteFrame(rel);
                sf.__uuid__ = 'res:' + rel;
                done(null, sf);
                return;
            }
            if (type === ImageAsset) {
                const ia = new ImageAsset();
                ia.__uuid__ = 'res:' + rel;
                done(null, ia);
                return;
            }
        }
        done(new Error('mock: 无资源包 ' + rel), null);
    },
};

/* EDITOR 用 getter 读全局开关，这样同一个 mock 可以分别模拟「运行时」和「编辑器」 */
const exportsObj = {
    Node, Scene, UITransform, UIOpacity, Label, Sprite, Graphics,
    Color, Vec3, EventTouch, tween, director, Director,
    game, assetManager, SceneAsset, resources, SpriteFrame,
    ImageAsset, Texture2D,
};
Object.defineProperty(exportsObj, 'EDITOR', {
    get() { return globalThis.__MOCK_EDITOR === true; },
    enumerable: true,
});

module.exports = exportsObj;
