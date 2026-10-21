/* ============================================================================
   Home.scene 结构自检
   ----------------------------------------------------------------------------
   手写/生成的 scene 出错只有两种后果：编辑器打不开，或者打开后一片空白。
   两者都不会给报错提示。所以下面六类问题必须在打开编辑器之前就查掉：

     ① __id__ 指向不存在的文档（越界 / 指向 null）
     ② 父子不一致：A 的 _children 里有 B，但 B 的 _parent 不是 A
     ③ 组件反向引用错：cc.Sprite.node 指向的节点 _components 里没有它
     ④ __uuid__ 指向 assets 里不存在的资源（图会变白块）
     ⑤ Canvas 缺 UITransform / Canvas / Widget
     ⑥ _id 重复（编辑器会随机丢组件）

   用法：node verify-scene.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..");
const SCENE = path.join(CLIENT, "assets", "scenes", "Home.scene");

let pass = 0, fail = 0;
const ok = (c, msg, detail) => {
  if (c) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ " + msg + (detail !== undefined ? "  → " + detail : "")); }
};

const docs = JSON.parse(fs.readFileSync(SCENE, "utf8"));
const N = docs.length;
console.log(`Home.scene 解析成功，${N} 个文档对象\n`);

/* ---------- 收集所有资源 uuid ---------- */
const metaUuids = new Set();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith(".meta")) continue;
    try {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      if (m.uuid) metaUuids.add(m.uuid);
      for (const k in (m.subMetas || {})) {
        if (m.subMetas[k].uuid) metaUuids.add(m.subMetas[k].uuid);
      }
    } catch (e) { /* 目录 meta 之类，忽略 */ }
  }
})(path.join(CLIENT, "assets"));

/* ---------- ① 引用越界 ---------- */
console.log("=== 1. __id__ 引用 ===");
const badIds = [];
(function scan(obj) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) { obj.forEach(scan); return; }
  if (typeof obj.__id__ === "number") {
    const v = obj.__id__;
    if (v < 0 || v >= N || docs[v] === null || docs[v] === undefined) badIds.push(v);
  }
  for (const k in obj) if (k !== "__id__") scan(obj[k]);
})(docs);
ok(badIds.length === 0, "全部 __id__ 有效", badIds.slice(0, 8).join(","));

/* ---------- ② 父子一致 ----------
   ⚠ cc.Scene 也要当父节点查。只遍历 cc.Node 的话，Scene 的 _children 里
     放着的 Canvas 就算 _parent 是 null 也查不出来 —— 而这正是预览白屏那次的
     元凶（Widget 对齐拿 null 目标 → getReadonlyNodeSize 无保护地取 UITransform）。 */
console.log("\n=== 2. 父子关系 ===");
let parentBad = 0;
for (let i = 0; i < N; i++) {
  const d = docs[i];
  if (!d || (d.__type__ !== "cc.Node" && d.__type__ !== "cc.Scene")) continue;
  for (const c of d._children || []) {
    const child = docs[c.__id__];
    if (!child) { parentBad++; continue; }
    if (!child._parent || child._parent.__id__ !== i) {
      parentBad++;
      console.log(`     ${d._name} 的子里有 ${child._name}，但它的 _parent 不是 ${d._name}`);
    }
  }
}
ok(parentBad === 0, "父子双向一致（含 Scene → Canvas）", parentBad);

/* 同一子节点被登记两次 / 被两个父节点同时登记 —— 编辑器建树时会 _parent 打架，
   直接 `Open scene failed`，但在文件层面完全合法，所以必须专门查。
   （踩过：addSprite(iCanvas,…) 顺手挂一次，末尾的统一挂载循环又挂一次。） */
let dupKid = 0;
const ownerOf = new Map();
for (let i = 0; i < N; i++) {
  const d = docs[i];
  if (!d || d.__type__ !== "cc.Node") continue;
  const ids = (d._children || []).map((c) => c.__id__);
  if (new Set(ids).size !== ids.length) {
    dupKid++;
    console.log(`     ${d._name} 的 _children 里有重复项：${ids.join(",")}`);
  }
  for (const id of ids) {
    if (ownerOf.has(id)) {
      dupKid++;
      console.log(`     ${docs[id] && docs[id]._name} 同时挂在 ${docs[ownerOf.get(id)]._name} 与 ${d._name} 下`);
    } else ownerOf.set(id, i);
  }
}
ok(dupKid === 0, "每个子节点只登记一次、只有一个父节点", dupKid);

/* ---------- ③ 组件反向引用 ---------- */
console.log("\n=== 3. 组件挂载 ===");
let compBad = 0;
for (let i = 0; i < N; i++) {
  const d = docs[i];
  if (!d || !d.__type__ || d.__type__ === "cc.Node" || d.__type__.startsWith("cc.Scene")) continue;
  if (typeof d.node === "undefined") continue;      // 纯数据类（Vec3/Size…）
  const owner = docs[d.node.__id__];
  if (!owner) { compBad++; continue; }
  const listed = (owner._components || []).some((c) => c.__id__ === i);
  if (!listed) { compBad++; console.log(`     ${d.__type__} 属于 ${owner._name}，但不在它的 _components 里`); }
}
ok(compBad === 0, "每个组件都挂在它声明的节点上", compBad);

/* ---------- ④ 资源 uuid ---------- */
console.log("\n=== 4. 资源引用 ===");
const usedUuids = [];
(function scan(obj) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) { obj.forEach(scan); return; }
  if (typeof obj.__uuid__ === "string") usedUuids.push(obj.__uuid__);
  for (const k in obj) if (k !== "__uuid__") scan(obj[k]);
})(docs);
const missing = usedUuids.filter((u) => !metaUuids.has(u));
ok(missing.length === 0, `引用的 ${usedUuids.length} 个资源 uuid 全部存在`, missing.join(", "));

/* ---------- ⑤ Canvas 必需组件 ---------- */
console.log("\n=== 5. Canvas ===");
const canvasNode = docs.find((d) => d && d.__type__ === "cc.Node" && d._name === "Canvas");
ok(!!canvasNode, "存在 Canvas 节点");
if (canvasNode) {
  const types = canvasNode._components.map((c) => docs[c.__id__].__type__);
  ok(types.includes("cc.UITransform"), "有 UITransform", types.join(","));
  ok(types.includes("cc.Canvas"), "有 cc.Canvas", types.join(","));
  ok(types.includes("cc.Widget"), "有 cc.Widget", types.join(","));
  const ut = docs[canvasNode._components.map((c) => c.__id__).find((i) => docs[i].__type__ === "cc.UITransform")];
  ok(ut._contentSize.width === 1280 && ut._contentSize.height === 720,
     `Canvas 尺寸 1280×720（实际 ${ut._contentSize.width}×${ut._contentSize.height}）`);
  const cam = docs.find((d) => d && d.__type__ === "cc.Camera");
  ok(!!cam && cam._orthoHeight === 360, `正交相机 orthoHeight=360（实际 ${cam && cam._orthoHeight}）`);
  ok(!!cam && cam._projection === 0, "相机是正交投影（_projection=0）");
}

/* ---------- ⑤b 坐标基准（最容易静默出错的一组） ----------
   Canvas 锚点 (0.5,0.5) + 尺寸 1280×720 时，子节点局部原点 = 屏幕中心。
   于是：Canvas 自身位置必须是 (640,360)；相机必须在 z>0 才不与 UI 同平面。 */
console.log("\n=== 5b 坐标基准 ===");
if (canvasNode) {
  const p = canvasNode._lpos;
  ok(p.x === 640 && p.y === 360,
     `Canvas 位置 = 屏幕中心 (640,360)（实际 ${p.x},${p.y}）—— 写成 (-640,360) 会整体左移一屏`);
}

const camNode = docs.find((d) => d && d.__type__ === "cc.Node" && d._name === "Camera");
ok(!!camNode, "存在 Camera 节点");
if (camNode) {
  const z = camNode._lpos.z;
  ok(z > 0,
     `相机 z > 0（实际 ${z}）—— z=0 时相机与 UI 同平面，near=0 会切掉整个界面`);
}

/* 除相机外，所有节点都必须有 UITransform。
   缺了在编辑器里报 `_getUITransformComp` of null，或者子树完全不参与布局。 */
const noUT = [];
for (const d of docs) {
  if (!d || d.__type__ !== "cc.Node") continue;
  if (d._name === "Camera") continue;                 // 3D 相机本来就没有
  const types = (d._components || []).map((c) => docs[c.__id__] && docs[c.__id__].__type__);
  if (!types.includes("cc.UITransform")) noUT.push(d._name);
}
ok(noUT.length === 0, "除相机外每个节点都有 UITransform", noUT.slice(0, 8).join(","));

/* ---------- ⑥ _id 唯一 ---------- */
console.log("\n=== 6. _id 唯一 ===");
const seen = new Map();
let dup = 0;
for (let i = 0; i < N; i++) {
  const d = docs[i];
  if (!d || !d._id) continue;
  if (seen.has(d._id)) { dup++; console.log(`     ${d._id} 在 #${seen.get(d._id)} 与 #${i} 重复`); }
  else seen.set(d._id, i);
}
ok(dup === 0, `${seen.size} 个 _id 全部唯一`, dup);

/* ---------- 场景内容清点 ---------- */
console.log("\n=== 场景内容 ===");
const sprites = docs.filter((d) => d && d.__type__ === "cc.Sprite");
const labels = docs.filter((d) => d && d.__type__ === "cc.Label");
const sliced = sprites.filter((s) => s._type === 1);
console.log(`  Sprite ${sprites.length} 个（Sliced ${sliced.length} / Simple ${sprites.length - sliced.length}）`);
console.log(`  Label  ${labels.length} 个`);
for (const s of sliced) {
  const nd = docs[s.node.__id__];
  const ut = docs[nd._components.map((c) => c.__id__).find((i) => docs[i].__type__ === "cc.UITransform")];
  console.log(`    · ${nd._name.padEnd(14)} ${ut._contentSize.width}×${ut._contentSize.height}`);
}

console.log("\n" + "=".repeat(52));
console.log(fail === 0 ? `全部通过：${pass} 项` : `失败 ${fail} 项 / 通过 ${pass} 项`);
process.exit(fail ? 1 : 0);
