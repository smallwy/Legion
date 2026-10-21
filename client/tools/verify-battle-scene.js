/**
 * verify-battle-scene.js —— Battle.scene 的结构验证
 *
 * 和主界面的验证器不是同一套检查项：
 * 主界面查的是「Canvas 位置、相机 z、父子双向、九宫格」；
 * 战斗场景是「代码自建世界」，场景本身只有一个挂载点，
 * 所以要查的是**基础设施是否完整**、以及**有没有违反 GameBootstrap 的前置假设**。
 *
 * 用法：node tools/verify-battle-scene.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'assets', 'scenes', 'Battle.scene');
const docs = JSON.parse(fs.readFileSync(FILE, 'utf8'));

let pass = 0;
const fails = [];
function ok(cond, name, detail) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fails.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('Battle.scene 结构验证\n');

/* 1. 基础设施 */
const iAsset = docs.findIndex((d) => d.__type__ === 'cc.SceneAsset');
const iScene = docs.findIndex((d) => d.__type__ === 'cc.Scene');
const iGlobals = docs.findIndex((d) => d.__type__ === 'cc.SceneGlobals');

console.log('1. 基础设施');
ok(iAsset >= 0, 'SceneAsset 存在');
ok(iScene >= 0, 'Scene 存在');
ok(iGlobals >= 0, 'SceneGlobals 存在');

const globalTypes = ['cc.AmbientInfo', 'cc.ShadowsInfo', 'cc.SkyboxInfo', 'cc.FogInfo',
    'cc.OctreeInfo', 'cc.SkinInfo', 'cc.LightProbeInfo', 'cc.PostSettingsInfo'];
const missingGlobal = globalTypes.filter((t) => !docs.some((d) => d.__type__ === t));
ok(missingGlobal.length === 0, 'SceneGlobals 的 8 个配置齐全', missingGlobal.join(', '));

/* 2. 引用完整性 */
console.log('\n2. 引用完整性');
function isRef(v) {
    return v && typeof v === 'object' && typeof v.__id__ === 'number' && Object.keys(v).length === 1;
}
let badRef = 0;
(function scan(v, where) {
    if (Array.isArray(v)) { v.forEach((x) => scan(x, where)); return; }
    if (v && typeof v === 'object') {
        if (isRef(v)) {
            if (!docs[v.__id__]) { badRef++; console.log('    悬空引用', where, '→', v.__id__); }
            return;
        }
        for (const k of Object.keys(v)) scan(v[k], where + '.' + k);
    }
})(docs, 'root');
ok(badRef === 0, '没有悬空 __id__ 引用', `${badRef} 处`);

/* 3. 节点树 */
console.log('\n3. 节点树');
const scene = docs[iScene];
const kids = scene._children || [];
ok(kids.length === 1, 'Scene 下只有一个根节点', `${kids.length} 个`);
const rootIdx = kids.length ? kids[0].__id__ : -1;
const root = docs[rootIdx] || {};
ok(root._name === 'BattleRoot', '根节点名为 BattleRoot', root._name);
ok(root._parent && root._parent.__id__ === iScene, 'BattleRoot._parent 反向指向 Scene');

/* 父子双向 */
let pairOk = true;
for (const c of scene._children || []) {
    if (!docs[c.__id__] || !docs[c.__id__]._parent || docs[c.__id__]._parent.__id__ !== iScene) pairOk = false;
}
ok(pairOk, 'Scene ↔ BattleRoot 父子互指');

/* 4. 挂载点约束 */
console.log('\n4. 挂载点约束');
const comps = (root._components || []).map((c) => docs[c.__id__]);
ok(comps.every((c) => c && c.__type__.startsWith('cc.')), '场景里不含自定义组件（不依赖压缩 uuid）',
    comps.map((c) => c && c.__type__).join(', '));

const hasCanvas = comps.some((c) => c && c.__type__ === 'cc.Canvas');
ok(!hasCanvas, '没有 Canvas 组件（避免与 visibleHalfSize 基准打架）');

const hasCamera = docs.some((d) => d.__type__ === 'cc.Camera');
ok(!hasCamera, '没有预置相机（由 PlayerController 自建唯一的正交相机）');

const ut = comps.find((c) => c && c.__type__ === 'cc.UITransform');
ok(!!ut, 'BattleRoot 带 UITransform');
if (ut) {
    ok(ut.node && ut.node.__id__ === rootIdx, 'UITransform.node 反向指向 BattleRoot');
}

const uts = docs.filter((d) => d.__type__ === 'cc.UITransform');
ok(uts.every((u) => u.node && docs[u.node.__id__]), '所有 UITransform 都有 node 反向引用');

/* 5. 唯一性 */
console.log('\n5. 唯一性');
const ids = docs.map((d) => d._id).filter((v) => v);
ok(new Set(ids).size === ids.length, '_id 唯一', `${ids.length} 个`);

/* 汇总 */
console.log('\n' + '='.repeat(48));
if (fails.length) {
    console.log(`失败 ${fails.length} 项：`);
    for (const f of fails) console.log('  · ' + f);
    process.exit(1);
}
console.log(`全部通过：${pass} 项`);
console.log(`\n文档对象 ${docs.length} 个 · 节点 ${docs.filter((d) => d.__type__ === 'cc.Node').length} 个`);
