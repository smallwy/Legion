/**
 * make-battle-scene.js —— 生成 Battle.scene
 *
 * 为什么不做成「复制一份再手改」：
 * Cocos 的 SceneGlobals（Ambient/Shadows/Skybox/Fog/Octree/Skin/LightProbe/PostSettings）
 * 有 9 个文档对象和一堆互相引用，手写漏一个就是「能生成、引擎不认」。
 * 所以这里从已经验证过的 Home.scene 里**原样继承**这段基础设施，只换节点树。
 *
 * 战斗场景为什么只要一个空节点：
 * GameBootstrap 的契约是「世界全部由代码搭建，不依赖编辑器内手动摆放」——
 * 相机、主角、英雄小队、敌人、渲染器、HUD 全部由它在 onLoad 里创建。
 * 所以场景本身只需要一个挂载点。这也避开了「手写自定义组件引用」的 uuid 陷阱：
 * 组件在运行时用 `addComponent(GameBootstrap)` 动态挂，场景里不出现任何非 cc.* 类型。
 *
 * 注意不要给 BattleRoot 加 Canvas：
 * 战斗侧所有 HUD 坐标都基于 `visibleHalfSize()`（相机视野 540），
 * 而 Canvas 会把自己的 UITransform 对齐到 1280×720 设计分辨率 ——
 * 两套基准混在一起，HUD 会整体偏移。BattleRoot 保持零尺寸容器即可。
 */
const fs = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '..');
const SRC = path.join(CLIENT, 'assets', 'scenes', 'Home.scene');
const DST = path.join(CLIENT, 'assets', 'scenes', 'Battle.scene');
const DST_META = DST + '.meta';

/** Battle.scene 的场景 uuid（固定值，改了会让 preview 的 start_scene 失效） */
const SCENE_UUID = 'b1a4d7e2-3c58-4f90-8a61-2e7b9c4d5f03';

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));

/* ---------- 1. 取出要继承的文档 ---------- */
const iAsset = src.findIndex((d) => d.__type__ === 'cc.SceneAsset');
const iScene = src.findIndex((d) => d.__type__ === 'cc.Scene');
const iGlobals = src.findIndex((d) => d.__type__ === 'cc.SceneGlobals');
if (iAsset < 0 || iScene < 0 || iGlobals < 0) throw new Error('源场景缺少 SceneAsset / Scene / SceneGlobals');

/* SceneGlobals 之后的所有配置对象（Ambient/Shadows/... ） */
const globalKids = [];
for (let i = iGlobals + 1; i < src.length; i++) globalKids.push(i);

/* ---------- 2. 组装新文档列表 ---------- */
/* 顺序：SceneAsset / Scene / BattleRoot / UITransform / SceneGlobals / ...配置 */
const docs = [];

docs.push(JSON.parse(JSON.stringify(src[iAsset])));            // 0
docs.push(JSON.parse(JSON.stringify(src[iScene])));            // 1

/* BattleRoot：零尺寸容器，世界原点即屏幕中心（相机由 GameBootstrap 建在它下面） */
docs.push({
    __type__: 'cc.Node',
    _name: 'BattleRoot',
    _objFlags: 0,
    __editorExtras__: {},
    _parent: { __id__: 1 },
    _children: [],
    _active: true,
    _components: [{ __id__: 3 }],
    _prefab: null,
    _lpos: { x: 0, y: 0, z: 0 },
    _lrot: { x: 0, y: 0, z: 0, w: 1 },
    _lscale: { x: 1, y: 1, z: 1 },
    _mobility: 0,
    _layer: 1073741824,
    _euler: { x: 0, y: 0, z: 0 },
});                                                            // 2

docs.push({
    __type__: 'cc.UITransform',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: 2 },
    _enabled: true,
    __prefab: null,
    _contentSize: { width: 0, height: 0 },
    _anchorPoint: { x: 0.5, y: 0.5 },
});                                                            // 3

const iNewGlobals = docs.length;                               // 4
docs.push(JSON.parse(JSON.stringify(src[iGlobals])));

/* 全局配置对象：它们相互之间也有 __id__ 引用，先整体搬过来再重映射 */
const globalMap = new Map();
for (const oldIdx of globalKids) {
    globalMap.set(oldIdx, docs.length);
    docs.push(JSON.parse(JSON.stringify(src[oldIdx])));
}

/* ---------- 3. 重映射 __id__ ---------- */
const idMap = new Map();
idMap.set(iAsset, 0);
idMap.set(iScene, 1);
idMap.set(iGlobals, iNewGlobals);
for (const [oldIdx, newIdx] of globalMap) idMap.set(oldIdx, newIdx);

let dropped = 0;
function remap(value) {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) value[i] = remap(value[i]);
        return value;
    }
    if (value && typeof value === 'object') {
        if (typeof value.__id__ === 'number' && Object.keys(value).length === 1) {
            const to = idMap.get(value.__id__);
            if (to === undefined) { dropped++; return null; }
            return { __id__: to };
        }
        for (const k of Object.keys(value)) value[k] = remap(value[k]);
    }
    return value;
}

/* ⚠ 只 remap 从 Home.scene 继承来的文档。
   新造的 BattleRoot / UITransform 里的 __id__ 已经是**最终索引**，
   再走一遍 remap 会被当成旧索引查表，查不到就清成 null ——
   我第一次就是这么把 UITransform.node 清空的。 */
const remapTargets = [docs[0], docs[1], docs[iNewGlobals]];
for (let i = iNewGlobals + 1; i < docs.length; i++) remapTargets.push(docs[i]);
/* Scene 原来的 _children 指向 Canvas（旧索引），先清掉，remap 后再指向 BattleRoot */
docs[1]._children = [];
for (const d of remapTargets) remap(d);

/* ---------- 4. 修正场景根 ---------- */
const sceneDoc = docs[1];
sceneDoc._name = 'Battle';
sceneDoc._children = [{ __id__: 2 }];
sceneDoc._parent = null;
sceneDoc._globals = { __id__: iNewGlobals };
docs[0]._name = 'Battle';
docs[0].scene = { __id__: 1 };

/* ---------- 5. 写盘 ---------- */
fs.writeFileSync(DST, JSON.stringify(docs, null, 2));
fs.writeFileSync(DST_META, JSON.stringify({
    ver: '1.1.50',
    importer: 'scene',
    imported: true,
    uuid: SCENE_UUID,
    files: ['.json'],
    subMetas: {},
    userData: {},
}, null, 2) + '\n');

/* ---------- 6. 自检 ---------- */
const types = {};
for (const d of docs) types[d.__type__] = (types[d.__type__] || 0) + 1;
const custom = Object.keys(types).filter((t) => !t.startsWith('cc.'));

console.log(`✓ Battle.scene  ${docs.length} 个文档对象`);
console.log(`  节点树：Battle → BattleRoot（零尺寸容器）+ UITransform`);
console.log(`  继承自 Home.scene：SceneAsset / Scene / SceneGlobals ×1 + 全局配置 ×${globalKids.length}`);
console.log(`  非 cc.* 类型：${custom.length === 0 ? '0（场景里不含自定义组件，靠运行时 addComponent）' : custom.join(', ')}`);
if (dropped) console.log(`  ⚠ 有 ${dropped} 个引用无法映射（已置空）：${dropped > 0 ? '请检查' : ''}`);
console.log(`  uuid ${SCENE_UUID}`);
