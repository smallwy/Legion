/**
 * _rt-check.js —— HomeRuntime 端到端验证（不需要打开 Cocos 编辑器）
 *
 * 做法：用真实 Home.scene 的节点数据构造一棵树，把 `cc` 换成 _mock-cc，
 * 编译后直接跑 HomeRuntime，然后用「派发触摸事件 + 推进帧」的方式断言：
 *
 *   1. 脚本能接管场景（说明顶层自启动这条路通）
 *   2. 宠物会走动会嬉戏（PET_WALK 开），但不出领地、影子不跟跳
 *   3. 每个入口都注册了点击监听（这是「点了有反应」的充要条件）
 *   4. 点出门 → 出发卡出现；点徽标 → 提示出现且有正确文案
 *
 * 用法：node tools/_rt-check.js
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

/* ---------- 1. 时间控制：让 performance.now 可推进 ---------- */
let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', {
    value: { now: () => fakeNow },
    configurable: true,
    writable: true,
});

/* ---------- 2. 把 'cc' 指向替身 ---------- */
const MOCK = path.join(__dirname, '_mock-cc.js');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'cc' || request === 'cc/env') return MOCK;
    return origResolve.call(this, request, ...args);
};

const cc = require(MOCK);
const { Node, Scene, UITransform, Label, director, Director } = cc;

/* ---------- 3. 从真实场景文件构造节点树 ---------- */
const SCENE = path.join(__dirname, '..', 'assets', 'scenes', 'Home.scene');

function buildScene() {
    const raw = JSON.parse(fs.readFileSync(SCENE, 'utf8'));
    const si = raw.findIndex((x) => x.__type__ === 'cc.Scene');
    if (si < 0) throw new Error('场景里找不到 cc.Scene');

    const scene = new Scene(raw[si]._name || 'Home');

    function build(idx, parent) {
        const d = raw[idx];
        const node = new Node(d._name || '?');
        const lp = d._lpos || {};
        node.setPosition(lp.x || 0, lp.y || 0, lp.z || 0);
        /* `_active` 必须透传：还没回家的宠物是预置但隐藏的（`active:false`）。
           不透传的话它们会全部出现在测试场景里，于是"未解锁不显示"这条永远测不出来。 */
        node.active = d._active !== false;
        node.parent = parent;

        for (const cref of (d._components || [])) {
            const comp = raw[cref.__id__];
            if (!comp) continue;
            if (comp.__type__ === 'cc.UITransform') {
                const ut = node.addComponent(UITransform);
                const cs = comp._contentSize || {};
                ut.setContentSize(cs.width || 0, cs.height || 0);
                ut._anchorPoint = {
                    x: (comp._anchorPoint && comp._anchorPoint.x) ?? 0.5,
                    y: (comp._anchorPoint && comp._anchorPoint.y) ?? 0.5,
                };
            } else if (comp.__type__ === 'cc.Label') {
                /* 场景里的 Label 也要挂上。以前只挂 UITransform，于是
                   `getChildByName('line').getComponent(Label)` 拿到 null ——
                   这一点让 bindDock 里对着 Label 设 alignment 的代码直接崩，
                   而真引擎里那个节点**是有 Label 的**。
                   替身比真引擎"少一个组件"，报出来的错就会指错地方。 */
                const lb = node.addComponent(Label);
                lb.string = comp._string || '';
                lb.fontSize = comp._fontSize || 20;
                lb.lineHeight = comp._lineHeight || Math.round(lb.fontSize * 1.35);
                lb.color = new cc.Color(
                    comp._color.r, comp._color.g, comp._color.b, comp._color.a);
                lb.horizontalAlign = comp._horizontalAlign ?? 1;
            }
        }
        for (const cref of (d._children || [])) build(cref.__id__, node);
    }

    for (const cref of (raw[si]._children || [])) build(cref.__id__, scene);
    return scene;
}

/* ---------- 4. 断言 ---------- */
let pass = 0;
const fails = [];
function ok(cond, name, detail) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fails.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

/* ---------- 5. 跑起来 ---------- */
console.log('HomeRuntime 端到端验证\n');

const scene = buildScene();
director.setScene(scene);

/* ⚠ 场景纯净性必须在 require 之前查：脚本会往场景里加热区节点。
   曾经因为编辑器模式下也执行了自启动，Home.scene 被写进了 15 个
   `Badge-*-hot`，而且每开一次编辑器就多一批。 */
const canvas0 = scene.getChildByName('Canvas');
const badges0 = canvas0.getChildByName('Badges');
/* 11 = 5 个圆徽（Badge-*）+ 4 个名字板（Cap-*）+ 1 个任务椭圆底板（TaskPlate）。
   这个数写死是对的 —— 它测的正是"场景里有多少静态子节点"，
   改场景就该动这个数（改错了会立刻红，不会悄悄放过一条残留）。 */
const BADGES_STATIC = 11;
ok(badges0.children.length === BADGES_STATIC,
    '场景文件里不含运行时残留节点',
    `Badges children = ${badges0.children.length}（应为 ${BADGES_STATIC}）`);

/* require 即触发 HomeRuntime 顶层代码（对应引擎里的 prerequisite-imports） */
require(path.join(__dirname, '_rt-build', 'HomeRuntime.js'));

const canvas = canvas0;
ok(!!canvas, '场景里找到 Canvas');
ok(director.listenerCount(Director.EVENT_BEFORE_UPDATE) > 0, '注册了每帧回调');

const petsRoot = canvas.getChildByName('Pets');
const sugar = petsRoot && petsRoot.getChildByName('砂糖');
ok(!!sugar, '找到宠物节点 Pets/砂糖');

/* --- 5.1 宠物走动（PET_WALK 已打开，用户要求"嬉戏玩耍"）。
   旧断言"站在原地"已作废 —— 那是走动被关掉时代的防抖回归。
   新不变量：会走，但不出领地（slot ± PET_ROAM_R = ±20，放宽到 26 收噪声）。 */
const x0 = sugar.position.x;
let minX = Infinity, maxX = -Infinity, maxDev = 0;

/* 推进 20 秒。x 允许溜达，但不许漂出领地、也不许横穿整条垫子。 */
for (let i = 0; i < 1200; i++) {
    fakeNow += 1000 / 60;
    director.emit(Director.EVENT_BEFORE_UPDATE);
    const x = sugar.position.x;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    maxDev = Math.max(maxDev, Math.abs(x - x0));
}

const travel = maxX - minX;
ok(travel >= 6, '宠物真的会走动（PET_WALK 生效）',
    `20 秒内跨度 ${travel.toFixed(2)}px`);
ok(maxDev <= 26, '走动不越领地（slot ± 20）',
    `最大偏离 ${maxDev.toFixed(2)}px（上限 26）`);

/* --- 5.1b 影子仍然钉地。走动带来的竖直通道（碎步 bob ±1.2、
   扑跳 hop 15、点击 pop 10）只许出现在**宠物**上 ——
   影子 y 只由深度 yOff（±7）决定，跨度必须 < 16。
   影子跟着跳 = 回到"飘在水上"，这条是当年的根因，永远要守。 */
const shadow = petsRoot.getChildByName('砂糖__shadow');
ok(!!shadow, '找到影子节点 砂糖__shadow');
let sMinY = Infinity, sMaxY = -Infinity;
let shOk = true;
for (let i = 0; i < 1800; i++) {
    fakeNow += 1000 / 60;
    director.emit(Director.EVENT_BEFORE_UPDATE);
    sMinY = Math.min(sMinY, shadow.position.y);
    sMaxY = Math.max(sMaxY, shadow.position.y);
    /* 影子横向必须钉住宠物本体（误差 0.5px）—— 拖在后面就是"贴图被拖着走" */
    if (Math.abs(shadow.position.x - sugar.position.x) > 0.5) shOk = false;
}
ok(shOk, '影子横向钉住宠物（不拖尾）');
ok(sMaxY - sMinY < 16, '影子不跟跳（竖直只跟深度）',
    `影子 y 跨度 ${(sMaxY - sMinY).toFixed(2)}px（上限 16）`);

/* --- 5.2 姿势在动，y 也允许动（走动/扑跳都会带竖直分量）。
 *  40 秒而不是 10 秒：姿势触发是随机的，10 秒窗口可能一只都
 *  没轮到大幅度姿势，断言就成了抽签。 --- */
const ys = [];
const sxs = [];
for (let i = 0; i < 2400; i++) {
    fakeNow += 1000 / 60;
    director.emit(Director.EVENT_BEFORE_UPDATE);
    ys.push(sugar.position.y);
    sxs.push(sugar.scale.x);
}
/* 原地姿势（坐 0.84 / 趴 0.74）的 scale 本来就该一路变 ——
   恒定反而是 bug（说明姿势没生效）。 */
const sMin = Math.min(...sxs), sMax = Math.max(...sxs);
ok(sMax - sMin > 0.04, '原地姿势真的改变了轮廓',
    `scale 幅度 ${(sMax - sMin).toFixed(3)}（应 > 0.04）`);
ok(sMin > 0.6, '姿势不会把角色压扁（趴下最扁 0.74）',
    `最小 scale ${sMin.toFixed(3)}`);

/* --- 5.3 每个入口都注册了点击 --- */
function collectClickable(root, acc = []) {
    if (root.hasListener(Node.EventType.TOUCH_END)) acc.push(root.name);
    for (const c of root.children) collectClickable(c, acc);
    return acc;
}
const clickable = collectClickable(canvas);
ok(clickable.length >= 10, '可点元素数量达到预期', `${clickable.length} 个：${clickable.join(', ')}`);

/* 注意：徽标本体不绑触摸，点击目标是它的 88×88 热区（视觉尺寸与点击区分离） */
const need = ['Btn-Go', 'GoCard', 'Badge-工作台-hot', 'Badge-图鉴-hot',
    'IconBtn-hot', 'HudProgress', 'Slot-年糕', 'Slot-星屑', '砂糖-hot'];
for (const n of need) {
    ok(clickable.includes(n), `入口可点：${n}`);
}
/* 入口收敛之后灶台并进了「家」—— 断言要跟着设计走。
   ⚠ 这条原来写的是"灶台也必须可点"，收敛后永远红。测试红着不管，
   下次真出问题就没人分辨得出来了。 */
ok(!clickable.includes('Badge-灶台-hot'), '灶台入口已并入「家」（不再单独可点）');

/* --- 5.4 点出门 → 出发卡出现 --- */
const goBtn = canvas.getChildByName('Dock').getChildByName('Btn-Go');
goBtn.emitTouch(Node.EventType.TOUCH_START);
/* 缩放是在下一帧的 tick 里收敛的（实际游戏里延迟 16ms，感知不到） */
for (let i = 0; i < 3; i++) {
    fakeNow += 1000 / 60;
    director.emit(Director.EVENT_BEFORE_UPDATE);
}
ok(goBtn.scale.x < 1, '出门按钮按下有缩放反馈', `scale=${goBtn.scale.x.toFixed(3)}`);
goBtn.emitTouch(Node.EventType.TOUCH_CANCEL);

/* CANCEL 之后必须回到 1（否则就是「按下去弹不回来」的卡死态） */
for (let i = 0; i < 30; i++) {
    fakeNow += 1000 / 60;
    director.emit(Director.EVENT_BEFORE_UPDATE);
}
ok(Math.abs(goBtn.scale.x - 1) < 0.01, '松手后回到常态（没有卡在按下态）',
    `scale=${goBtn.scale.x.toFixed(3)}`);

goBtn.emitTouch(Node.EventType.TOUCH_END);
const depart = canvas.getChildByName('__Depart');
ok(!!depart, '点出门后创建了出发卡');
ok(depart && depart.active, '出发卡已显示');

/* 出发卡上的「出发」按钮存在且可点 */
const card = depart && depart.getChildByName('card');
const goInCard = card && card.getChildByName('go');
ok(!!goInCard, '出发卡里有「出发」按钮');
if (goInCard) {
    goInCard.emitTouch(Node.EventType.TOUCH_END);
    ok(!depart.active, '点「出发」后卡片关闭');
    ok(director._loaded === 'Battle', '点「出发」真的切到战斗场景', `loadScene = ${director._loaded}`);
}

/* --- 5.5 点徽标 → 面板出现 ---
   ⚠ 这里原来断言的是"出现 __Toast 提示条"。徽标后来升级成了真面板
   （工作台 → openBench、图鉴 → openCodex），提示条只剩兜底路径，
   断言于是永远失败 —— 改的时候顺手把断言改成对**当前设计**的描述，
   否则这条测试会一直红着，红久了就没人看了。 */
const hotWt = canvas.getChildByName('Badges').getChildByName('Badge-工作台-hot');
hotWt.emitTouch(Node.EventType.TOUCH_END);
const sheetNode = canvas.getChildByName('__Sheet');
ok(!!sheetNode, '点徽标后打开了面板（__Sheet）');
const sheetTitle = sheetNode && sheetNode.getChildByName('card')
    && sheetNode.getChildByName('card').getChildByName('title');
const sheetTitleComp = sheetTitle && sheetTitle.getComponent(cc.Label);
/* 「工坊」= 工作台 + 灶台合并后的入口，所以标题断言的是「工坊」而不是「工作台」 */
ok(!!sheetTitleComp && sheetTitleComp.string === '工坊',
    '面板标题指向被点的入口', sheetTitleComp ? sheetTitleComp.string : '(无)');

for (let i = 0; i < 12; i++) {
    fakeNow += 1000 / 60;
    director.emit(Director.EVENT_BEFORE_UPDATE);
}
/* 面板没有淡入（openSheet 里直接建好就显示），所以这里原来断言
   `UIOpacity.opacity > 100` 会拿到 null —— 面板根节点压根没挂 UIOpacity。
   改成断言"它真的画出来了"：卡片有 Graphics、遮罩有 Graphics。 */
const sheetCard = sheetNode.getChildByName('card');
const sheetScrim = sheetNode.getChildByName('scrim');
ok(!!sheetCard && !!sheetCard.getComponent(cc.Graphics), '面板卡片已绘制（paintCard）');
ok(!!sheetScrim && !!sheetScrim.getComponent(cc.Graphics), '面板有全屏遮罩');

/* 点遮罩应当关掉面板 —— 这是唯一的关闭路径，必须测。
   ⚠ closeSheet 走的是 `queue()`（下一帧才执行），不推一帧就永远读到没关。 */
sheetScrim.emitTouch(Node.EventType.TOUCH_END);
fakeNow += 1000 / 60;
director.emit(Director.EVENT_BEFORE_UPDATE);
ok(!canvas.getChildByName('__Sheet'), '点遮罩能关掉面板');

/* 再开一次，确认"关了还能开"，不是一次性的 */
hotWt.emitTouch(Node.EventType.TOUCH_END);
ok(!!canvas.getChildByName('__Sheet'), '关掉后能再次打开（面板仍只有一个）');

/* --- 5.6 徽标热区不小于 88×88 --- */
const hotUT = hotWt.getComponent(UITransform);
ok(hotUT.contentSize.width >= 88 && hotUT.contentSize.height >= 88,
    '徽标热区达到 88×88 触屏下限',
    `${hotUT.contentSize.width}×${hotUT.contentSize.height}`);

/* --- 5.7 锁定槽降到 55% 不透明度，表达不可用 --- */
const slot = canvas.getChildByName('Dock').getChildByName('Slot-年糕');
const slotOp = slot.getComponent(cc.UIOpacity);
ok(slotOp && slotOp.opacity < 200, '锁定槽视觉降权（不可用态）', `opacity=${slotOp && slotOp.opacity}`);

/* --- 5.8 防复发：编辑器模式必须彻底不介入场景 --- */
globalThis.__MOCK_EDITOR = true;
delete require.cache[require.resolve(path.join(__dirname, '_rt-build', 'HomeRuntime.js'))];

const scene2 = buildScene();
director.setScene(scene2);
require(path.join(__dirname, '_rt-build', 'HomeRuntime.js'));

const badges2 = scene2.getChildByName('Canvas').getChildByName('Badges');
ok(badges2.children.length === BADGES_STATIC,
    '编辑器模式下完全不介入场景（守卫生效）',
    `Badges children = ${badges2.children.length}（应为 ${BADGES_STATIC}）`);
globalThis.__MOCK_EDITOR = false;

/* --- 5.9 存档回流：家园显示的三组数字必须读自存档 ---
 *
 * 这一节要的是**能读到非默认值**，所以先塞一个假存档进去：
 * 如果实现里还留着任何写死的 "248 / 满饱 / 苔原 1 / 8"，这里就会露。
 *
 * ⚠ `SaveData` 会把存储后端缓存在模块作用域里，所以光清 HomeRuntime 的缓存不够，
 *    必须连 `config/SaveData.js` 一起清，否则它还用着上一轮解析出来的 null。 */
function fakeStore() {
    const m = Object.create(null);
    return {
        getItem: (k) => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: (k) => { delete m[k]; },
        _data: m,
    };
}

const store = fakeStore();
store.setItem('pawpack.save.v1', JSON.stringify({
    cleared: 3, apples: 999, logs: 88, coins: 44,
    active: 'sugar-stand', satiety: 52, runs: 7,
}));
globalThis.localStorage = store;

for (const f of ['HomeRuntime.js', 'config/SaveData.js']) {
    try { delete require.cache[require.resolve(path.join(__dirname, '_rt-build', f))]; } catch (e) { /* 忽略 */ }
}

/** 手搭一棵最小场景树（带 Label / Sprite），只为验证"数值真的写进了控件" */
function buildSaveScene() {
    const sc = new Scene('Home');
    const canvas = new Node('Canvas');
    canvas.addComponent(UITransform).setContentSize(1280, 720);
    canvas.parent = sc;

    const mk = (name, parent) => { const n = new Node(name); n.parent = parent; return n; };
    const lbl = (parent, name, size) => {
        const n = mk(name, parent);
        n.addComponent(UITransform).setContentSize(size || 80, 16);
        const l = n.addComponent(cc.Label);
        l.string = '';
        return l;
    };

    const badges = mk('Badges', canvas);
    const badge = mk('Badge-工作台', badges);
    badge.addComponent(UITransform).setContentSize(47, 48);

    const hud = mk('HUD', canvas);
    const prog = mk('HudProgress', hud);
    prog.addComponent(UITransform).setContentSize(239, 76);
    lbl(prog, 'txt-prog');
    for (let i = 0; i < 8; i++) mk('pip-' + i, prog);

    const dock = mk('Dock', canvas);
    for (const n of ['Res-Apple', 'Res-Log', 'Res-Coin']) {
        const card = mk(n, dock);
        card.addComponent(UITransform).setContentSize(72, 44);
        lbl(card, 'val');
    }
    const goCard = mk('GoCard', dock);
    goCard.addComponent(UITransform).setContentSize(200, 62);
    for (let i = 0; i < 3; i++) {
        const seg = mk('belly-' + i, goCard);
        seg.addComponent(UITransform).setContentSize(20, 7);
        seg.addComponent(cc.Sprite);
    }
    lbl(goCard, 'belly-txt');
    const slot = mk('Slot-年糕', dock);
    slot.addComponent(UITransform).setContentSize(40, 62);
    const go = mk('Btn-Go', dock);
    go.addComponent(UITransform).setContentSize(509, 84);
    lbl(go, 'line');

    /* 宠物：全部预置，按存档决定 active */
    const pets = mk('Pets', canvas);
    for (const name of ['砂糖', '年糕', '团子', '雪团', '豆奶', '星屑']) {
        const p = mk(name, pets);
        p.addComponent(UITransform).setContentSize(58, 84);
        p.active = false;
    }

    return sc;
}

const scene3 = buildSaveScene();
director.setScene(scene3);
require(path.join(__dirname, '_rt-build', 'HomeRuntime.js'));

const c3 = scene3.getChildByName('Canvas');
const dock3 = c3.getChildByName('Dock');
const valOf = (card) => {
    const n = dock3.getChildByName(card).getChildByName('val');
    const l = n.getComponent(cc.Label);
    return l ? l.string : '';
};

ok(valOf('Res-Apple') === '999', '果子数值读自存档', `val = ${valOf('Res-Apple')}`);
ok(valOf('Res-Log') === '88', '材料数值读自存档', `val = ${valOf('Res-Log')}`);
ok(valOf('Res-Coin') === '44', '吧唧数值读自存档', `val = ${valOf('Res-Coin')}`);

const bellyTxt = dock3.getChildByName('GoCard').getChildByName('belly-txt')
    .getComponent(cc.Label).string;
ok(bellyTxt === '52/100', '饱食度与战斗同一量纲（N/100）', `belly-txt = ${bellyTxt}`);

/* 52 落在 30~70 = 半饿：亮 2 格且是金色（PALETTE.gold 255,215,0），第 3 格暗 */
const segs = [0, 1, 2].map((i) => dock3.getChildByName('GoCard')
    .getChildByName('belly-' + i).getComponent(cc.Sprite).color);
ok(segs[0].r === 255 && segs[0].g === 215 && segs[0].b === 0,
    '半饿三格 bar 用金色（把"最强区间"教给玩家）',
    `seg0 = ${segs[0].r},${segs[0].g},${segs[0].b}`);
ok(segs[2].a < 120, '未点亮的格降到低不透明度', `seg2.a = ${segs[2].a}`);

const progTxt = c3.getChildByName('HUD').getChildByName('HudProgress')
    .getChildByName('txt-prog').getComponent(cc.Label).string;
ok(progTxt === '3 / 8 关', '关卡进度读自存档', `txt-prog = ${progTxt}`);

const goLine = dock3.getChildByName('Btn-Go').getChildByName('line')
    .getComponent(cc.Label).string;
/* 副标题现在是"带几只 + 当前饱食"（`3 只 · 饱食 52`）。
   中间试过换成「能量 100」，但按钮上"这一下带谁出门"比"花多少能量"
   更先被读到，又换回来了 —— 断言跟着实现走，别再写死某一种文案。 */
ok(/^\d+ 只 · 饱食 \d+$/.test(goLine), '出门按钮显示带几只 + 当前饱食', `line = ${goLine}`);

/* 宠物：**已解锁的全部在场**（`cleared >= at`），不是"只站一只"。
   这条断言在历史上翻过两次面（三只 → 一只 → 全部），跟着实现走。 */
const pets3 = c3.getChildByName('Pets');
const petOn = (n) => pets3.getChildByName(n).active;
const onGrass = ['砂糖', '年糕', '团子', '雪团', '豆奶', '星屑'].filter(petOn);
ok(onGrass.length === 3, '在场宠物 = 已解锁数',
    `cleared=3 时站着的是 ${onGrass.join('/') || '(无)'}`);
ok(!petOn('雪团') && !petOn('豆奶') && !petOn('星屑'),
    '未解锁的宠物不出现（预置但 active=false）',
    `雪团=${petOn('雪团')} 豆奶=${petOn('豆奶')} 星屑=${petOn('星屑')}`);

/* --- 5.10 出发卡上的文案不许再有写死的数字 --- */
const go3 = dock3.getChildByName('Btn-Go');
go3.emitTouch(Node.EventType.TOUCH_END);
const dep3 = c3.getChildByName('__Depart');
const card3 = dep3 && dep3.getChildByName('card');
const textOf = (parent, n) => {
    const x = parent && parent.getChildByName(n);
    const l = x && x.getComponent(cc.Label);
    return l ? l.string : '';
};
ok(textOf(card3, 'title') === '苔原 4 / 8', '出发卡标题 = 下一关', textOf(card3, 'title'));
ok(textOf(card3, 'row1').indexOf('3 只 · 砂糖 / 年糕 / 团子') > 0,
    '出发卡队伍与存档一致', textOf(card3, 'row1'));
ok(textOf(card3, 'row2').indexOf('52/100') > 0, '出发卡饱食度与存档一致', textOf(card3, 'row2'));
ok(textOf(card3, 'row2').indexOf('×1.50') > 0, '半饿在出发卡上就标出 ×1.5', textOf(card3, 'row2'));
ok(textOf(card3, 'row3').indexOf('雪团') > 0, '出发卡预告下一只回家的宠物', textOf(card3, 'row3'));

/* 顺便确认没有一张卡还在写"战力 ×1.21"这种没有系统产出过的数 */
ok(textOf(card3, 'row2').indexOf('1.21') < 0, '出发卡不再显示凭空的"战力 ×1.21"', textOf(card3, 'row2'));

/* --- 5.11 防复发：切场景之后旧控制器必须停手 ---
 *
 * 现场报错（点「出发」）：
 *   TypeError: Cannot read properties of null (reading 'x')
 *     at HomeController.tickPet
 *
 * 原因不是跳转失败，恰恰是**跳转成功了**：`director` 上的 BEFORE_UPDATE 是
 * 模块级监听，不随场景销毁；旧场景节点已经没了，`position` 返回 null，
 * 下一帧就拿 null 去读 .x。
 *
 * 所以这里要证明两件事：① 收到 BEFORE_SCENE_LAUNCH 后旧控制器不再碰旧节点；
 * ② 从战斗回家能重新接管（不然离开一次就永远回不来）。
 */
director.emit(Director.EVENT_BEFORE_SCENE_LAUNCH);
c3.destroyTree();                    // 模拟引擎销毁旧场景（级联）

let threw = null;
try {
    for (let i = 0; i < 10; i++) director.emit(Director.EVENT_BEFORE_UPDATE);
} catch (e) {
    threw = e;
}
ok(!threw, '切场景后旧控制器不再碰已销毁节点',
    threw ? String(threw && threw.message) : '10 帧无异常');

/* 回家园：新场景 + AFTER_SCENE_LAUNCH 必须能重新接管 */
const scene4 = buildSaveScene();
director.setScene(scene4);
director.emit(Director.EVENT_AFTER_SCENE_LAUNCH);
const badges4 = scene4.getChildByName('Canvas').getChildByName('Badges');
ok(!!badges4.getChildByName('Badge-工作台-hot'),
    '回家园后重新接管（热区重建，不是空场景）',
    `Badges children = ${badges4.children.length}`);

/* --- 5.12 自愈：场景里若残留 -hot 节点，接管时必须清掉 ---
 *
 * 这类残留不是空想：编辑器曾经把运行时热区写回场景文件，`Badges` 从 10 个
 * 涨到 85 个（`-hot` → `-hot-hot` → 四代）。结构验证器抓不到（节点本身合法），
 * 所以运行时要能自己恢复干净。
 */
const scene5 = buildSaveScene();
const badges5 = scene5.getChildByName('Canvas').getChildByName('Badges');
const stale1 = new Node('Badge-工作台-hot'); stale1.parent = badges5;
const stale2 = new Node('Badge-工作台-hot-hot'); stale2.parent = badges5;
director.setScene(scene5);
director.emit(Director.EVENT_AFTER_SCENE_LAUNCH);

const hots5 = badges5.children.filter((n) => n.name.indexOf('-hot') >= 0);
ok(hots5.length === 1,
    '接管时清掉残留热区，只剩本代 1 个（自愈生效）',
    `残留 ${hots5.length} 个：${hots5.map((n) => n.name).join(', ')}`);

/* --- 5.13 炊烟与飞鸟：环境生命层必须真的在画 ---
 * 这层是"纯加法"——加错了顶多没画面，不会崩；所以最危险的失败模式是
 * "节点在、paths 空"（每帧 clear 后什么都没画上去），离屏渲染看起来
 * 一切正常但天上地上没有活物。这里直接查笔画数。 */
const canvas5 = scene5.getChildByName('Canvas');
for (let i = 0; i < 1500; i++) {
    fakeNow += 1000 / 60;
    director.emit(Director.EVENT_BEFORE_UPDATE);
}
const smokeN = canvas5.getChildByName('__smoke');
const birdsN = canvas5.getChildByName('__birds');
ok(!!smokeN, '炊烟节点存在', 'canvas 下没找到 __smoke');
ok(!!birdsN, '飞鸟节点存在', 'canvas 下没找到 __birds');
if (smokeN && birdsN) {
    const sg = smokeN.getComponent(cc.Graphics);
    const bgc = birdsN.getComponent(cc.Graphics);
    ok(!!sg && sg.paths.length > 0, '炊烟有笔画', `paths=${sg ? sg.paths.length : '无组件'}`);
    ok(!!bgc && bgc.paths.length > 0, '飞鸟有笔画', `paths=${bgc ? bgc.paths.length : '无组件'}`);
}

delete globalThis.localStorage;

/* ---------- 汇总 ---------- */
console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
    console.log('\n失败项：');
    for (const f of fails) console.log('  · ' + f);
    process.exit(1);
}
console.log('全部通过。');
