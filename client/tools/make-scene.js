/* ============================================================================
   生成 Cocos Creator 3.8.8 的 Home.scene + 全部资源 .meta
   ----------------------------------------------------------------------------
   三个硬约束（做不到就别开编辑器，开了也是白屏）：
     ① __id__ 引用永远合法  → 先 reserve 占位再回填
     ② 父子双向一致         → _children 与 _parent 必须成对写
     ③ 组件反向引用一致     → cc.Sprite.node 指向的节点必须把它列进 _components

   ---------- 坐标约定：一律「左上角锚点」（本次重写的核心）----------
   网页和 Cocos 的坐标差，只有「原点位置」和「y 方向」两条。
   之前用**中心锚点**换算，每个元素都要先算 cx - w/2、再算 360 - (cy + h/2)，
   一次心算错误就是一个控件偏 20px，而且要对着截图找半天。

   现在全部节点用 **anchor (0,1) = 左上角**，于是：
       pos = (wx - 640, 360 - wy)        ← wx/wy 就是 CSS 里的 left/top
   子节点同理，直接写「相对父元素左上角的 left/top」偏移。
   **CSS 里怎么写，这里就怎么抄，不出现任何除以 2。**

   唯一例外是宠物：它们的锚点是 (0.5, 0) = 脚底中心，
   因为立绘要按"脚踩在地上"对齐，不能用左上角。

   ---------- 带 pad 的部件 ----------
   panel / badge-ring / btn-go 这些贴图四周有留白（投影 (2,5) + 描边外扩 1.4），
   pad 记录在 _cocos-assets.json 里。节点位置 = (wx - pad.l, wy - pad.t)，
   节点尺寸 = 设计尺寸 + 四边 pad。**不要手抄偏移量**，一律走 addPart()。

   用法：node make-scene.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CLIENT = path.join(__dirname, "..");
const UIROOT = path.join(CLIENT, "assets", "ui");
const SCENES = path.join(CLIENT, "assets", "scenes");

const W = 1280, H = 720;
const CX = W / 2, CY = H / 2;

const newUUID = () => crypto.randomUUID();
const newId = () => crypto.randomBytes(16).toString("base64")
  .replace(/[+/=]/g, (c) => (c === "+" ? "X" : c === "/" ? "Y" : "")).slice(0, 22);

/** 网页左上角 (wx, wy) → Cocos 局部坐标（父级锚点处为原点，y 轴向上） */
const TL = (wx, wy) => ({ x: wx - CX, y: CY - wy });

/* ---------- 六只：坐标直接搬 game.src.html 的 PETS ---------- */
/* 六个字段全都必须和 game.src.html 的 PETS 一致 —— 这个文件里**不要再有第二份真值**。
   footY 同时是景深：548 / 568 / 574 / 596 / 602 / 610 六档，不是一条水平线。
   砂糖原本写 490/156 踩在穹顶上：屋顶是弧面，没有平台，弧面站猫一定穿模。 */
const PETS = [
  { id: "sugar-stand",  name: "砂糖", at: 0, cx: 160,  footY: 548, h: 84  },
  { id: "nian-gao-dog", name: "年糕", at: 1, cx: 320,  footY: 602, h: 148 },
  { id: "tuan-zi-ham",  name: "团子", at: 3, cx: 700,  footY: 596, h: 138 },
  { id: "xue-tuan-rab", name: "雪团", at: 5, cx: 500,  footY: 574, h: 128 },
  { id: "dou-nai-ox",   name: "豆奶", at: 7, cx: 890,  footY: 610, h: 138 },
  { id: "xing-xie-fox", name: "星屑", at: 8, cx: 1130, footY: 568, h: 112 },
];

/** 本场景演示的状态：已过 3 关（概念图 home-layout@v2 的快照状态） */
const CLEARED = 0;   // 首屏：一关未过
const ACTIVE = "sugar-stand";
const PIPS_ON = CLEARED;
const CHAIN = Math.min(2, 1 + 0.15 * CLEARED).toFixed(2);   // 与 game.html 同一公式

/* 场景摆的是**首屏**：0 关，只有砂糖在家，另外五格带锁显示「第 N 关」。
   之前这里写死 true（为了和概念图对比），结果是玩家一进 Cocos 就看到六只全在，
   而实际规则是「过关才回家」—— 静态场景在撒谎。
   需要出概念图对照版时改这两个开关，不要改 isUnlocked 的规则本身。 */
const ALL_UNLOCKED = false;
/* 「新」角标同理：首屏没有任何一位是刚解锁的。 */
const SHOW_NEW_BADGE = false;

const DIMS = JSON.parse(fs.readFileSync(path.join(__dirname, "_cocos-assets.json"), "utf8"));
const PARTS = DIMS.parts;

/* ---------- 文档构造器 ---------- */
const docs = [];
const reserve = () => { docs.push(null); return docs.length - 1; };
const put = (id, obj) => { docs[id] = obj; };

/* ============================================================================
   图片 .meta
   ----------------------------------------------------------------------------
   uuid 必须**跨次生成保持一致**：每次跑都换新 uuid 的话，编辑器会把所有贴图
   当成新资源重新导入（几 MB 的立绘要重算一遍），而且旧引用会全部失效。
   所以：已有 meta 就复用它的 uuid，没有才生成。
   ========================================================================== */
const metaCache = new Map();

function readMeta(rel) {
  const p = path.join(UIROOT, rel + ".png.meta");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}

function writeImageMeta(rel, opts) {
  const o = opts || {};
  const old = readMeta(rel);
  const uuid = (old && old.uuid) || newUUID();
  const texUuid = uuid + "@6c48a";
  const sfUuid = uuid + "@f9941";
  const w = o.w, h = o.h;
  const b = o.border || { l: 0, r: 0, t: 0, b: 0 };
  const name = path.basename(rel);
  const halfW = w / 2, halfH = h / 2;

  const meta = {
    ver: "1.0.27",
    importer: "image",
    imported: true,
    uuid,
    files: [".json", ".png"],
    subMetas: {
      "6c48a": {
        importer: "texture", uuid: texUuid, displayName: name, id: "6c48a", name: "texture",
        userData: {
          wrapModeS: "clamp-to-edge", wrapModeT: "clamp-to-edge",
          imageUuidOrDatabaseUri: uuid, isUuid: true, visible: false,
          minfilter: "linear", magfilter: "linear", mipfilter: "none", anisotropy: 0,
        },
        ver: "1.0.22", imported: true, files: [".json"], subMetas: {},
      },
      "f9941": {
        importer: "sprite-frame", uuid: sfUuid, displayName: name, id: "f9941", name: "spriteFrame",
        userData: {
          trimThreshold: 1, rotated: false,
          offsetX: 0, offsetY: 0, trimX: 0, trimY: 0,
          width: w, height: h, rawWidth: w, rawHeight: h,
          borderTop: b.t, borderBottom: b.b, borderLeft: b.l, borderRight: b.r,
          packable: b.l + b.r + b.t + b.b === 0,
          pixelsToUnit: 100, pivotX: 0.5, pivotY: 0.5, meshType: 0,
          vertices: {
            rawPosition: [-halfW, -halfH, 0, halfW, -halfH, 0, -halfW, halfH, 0, halfW, halfH, 0],
            indexes: [0, 1, 2, 2, 1, 3],
            uv: [0, h, w, h, 0, 0, w, 0],
            nuv: [0, 0, 1, 0, 0, 1, 1, 1],
            minPos: [-halfW, -halfH, 0], maxPos: [halfW, halfH, 0],
          },
          isUuid: true, imageUuidOrDatabaseUri: texUuid,
          atlasUuid: "", trimType: "auto",
        },
        ver: "1.0.12", imported: true, files: [".json"], subMetas: {},
      },
    },
    userData: {
      type: "sprite-frame",
      fixAlphaTransparencyArtifacts: false,
      hasAlpha: o.hasAlpha !== false,
      redirect: texUuid,
    },
  };

  fs.mkdirSync(path.dirname(path.join(UIROOT, rel)), { recursive: true });
  fs.writeFileSync(path.join(UIROOT, rel + ".png.meta"), JSON.stringify(meta, null, 2));
  metaCache.set(rel, sfUuid);
  return sfUuid;
}

/** 部件贴图的 spriteFrame uuid —— 尺寸取 _cocos-assets.json 的 cw/ch */
function part(rel) {
  if (metaCache.has("home/" + rel)) return metaCache.get("home/" + rel);
  const P = PARTS[rel];
  if (!P) throw new Error("未知部件：" + rel);
  return writeImageMeta("home/" + rel, { w: P.cw, h: P.ch, hasAlpha: true });
}

/** 图标贴图 128×128 */
function icon(name) {
  if (metaCache.has("icons/" + name)) return metaCache.get("icons/" + name);
  return writeImageMeta("icons/" + name, { w: 128, h: 128, hasAlpha: true });
}

/* ============================================================================
   节点 / 组件辅助
   ========================================================================== */
const LAYER_UI = 33554432;

function node(name, opts) {
  const o = opts || {};
  return {
    __type__: "cc.Node",
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _parent: null,
    _children: [],
    /* 预置但默认隐藏用 `active: false`。⚠️ 必须显式透传：
       写死 true 的话，那些"还没回家"的宠物节点一进场景就会出现在草地上 ——
       而且场景文件里看不出任何异常（_active 是合法的 true）。 */
    _active: o.active !== false,
    _components: [],
    _prefab: null,
    /* ⚠ z 必须透传：相机要靠 z=1000 拉开与 UI 平面的距离。
       写死 0 的话相机就在 UI 所在的平面上，near=0 会把它切掉 ——
       表现为「编辑器里一片黑 / 只有背景边缘」，而且没有任何报错。 */
    _lpos: { __type__: "cc.Vec3", x: o.x || 0, y: o.y || 0, z: o.z || 0 },
    _lrot: { __type__: "cc.Quat", x: 0, y: 0, z: 0, w: 1 },
    _lscale: { __type__: "cc.Vec3", x: 1, y: 1, z: 1 },
    _mobility: 0,
    _layer: LAYER_UI,
    _euler: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 },
    _id: newId(),
  };
}

function uiTransform(nodeId, w, h, ax, ay) {
  return {
    __type__: "cc.UITransform",
    _name: "", _objFlags: 0, __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: null,
    _contentSize: { __type__: "cc.Size", width: w, height: h },
    _anchorPoint: { __type__: "cc.Vec2", x: ax === undefined ? 0 : ax, y: ay === undefined ? 1 : ay },
    _id: newId(),
  };
}

/** trim=true 时 Cocos 会按 alpha 裁掉透明边 —— 带 pad 的部件必须关掉，
    否则投影留白被裁，位置整体漂移。 */
function sprite(nodeId, sfUuid, color, trim) {
  const c = color || { r: 255, g: 255, b: 255, a: 255 };
  return {
    __type__: "cc.Sprite",
    _name: "", _objFlags: 0, __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: null,
    _customMaterial: null,
    _srcBlendFactor: 2, _dstBlendFactor: 4,
    _color: { __type__: "cc.Color", r: c.r, g: c.g, b: c.b, a: c.a },
    _spriteFrame: { __uuid__: sfUuid, __expectedType__: "cc.SpriteFrame" },
    _type: 0,
    _fillType: 0,
    _sizeMode: 0,
    _fillCenter: 0, _fillStart: 0, _fillRange: 0,
    _isTrimmedMode: trim === undefined ? false : !!trim,
    _useGrayscale: false,
    _atlas: null,
    _id: newId(),
  };
}

/**
 * 文字。全部走 (0,1) 左上锚点 + 与 CSS 相同的 line-height：
 *   网页 top:13px / line-height:13px  → 这里 y = -13，_lineHeight = 13
 * 不写死 lineHeight 的话字号一改位置就漂（网页那边已经踩过一次）。
 */
function label(nodeId, str, o) {
  const c = o.color || { r: 90, g: 56, b: 38, a: 255 };
  return {
    __type__: "cc.Label",
    _name: "", _objFlags: 0, __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: null,
    _customMaterial: null,
    _srcBlendFactor: 2, _dstBlendFactor: 4,
    _color: { __type__: "cc.Color", r: c.r, g: c.g, b: c.b, a: c.a },
    _string: str,
    _horizontalAlign: o.align === "right" ? 2 : o.align === "center" ? 1 : 0,
    _verticalAlign: 1,
    _actualFontSize: o.fs,
    _fontSize: o.fs,
    _fontFamily: "Microsoft YaHei",
    _lineHeight: o.lh === undefined ? Math.round(o.fs * 1.35) : o.lh,
    _overflow: 0,
    _enableWrapText: !!o.wrap,
    _font: null,
    _isSystemFontUsed: true,
    _spacingX: o.spacing || 0,
    _isItalic: false,
    _isBold: !!o.bold,
    _isUnderline: false,
    _underlineHeight: 2,
    _cacheMode: 0,
    _enableOutline: !!o.outline,
    _outlineColor: o.outline
      ? { __type__: "cc.Color", r: o.outline[0], g: o.outline[1], b: o.outline[2], a: o.outline[3] }
      : { __type__: "cc.Color", r: 0, g: 0, b: 0, a: 255 },
    _outlineWidth: o.outline ? o.outline[4] : 2,
    _enableShadow: false,
    _shadowColor: { __type__: "cc.Color", r: 0, g: 0, b: 0, a: 255 },
    _shadowOffset: { __type__: "cc.Vec2", x: 2, y: 2 },
    _shadowBlur: 2,
    _id: newId(),
  };
}

/* ============================================================================
   构建
   ========================================================================== */
const SCENE_META = path.join(SCENES, "Home.scene.meta");
let sceneUUID = "";
if (fs.existsSync(SCENE_META)) {
  try { sceneUUID = JSON.parse(fs.readFileSync(SCENE_META, "utf8")).uuid || ""; } catch (e) {}
}
if (!sceneUUID) sceneUUID = newUUID();

const iSceneAsset = reserve();
const iScene = reserve();
const iCanvas = reserve();
const iCameraNode = reserve();
const iCamera = reserve();

/* Canvas 节点自身的位置 = 屏幕中心 (640,360)。
   TL() 是给**子节点**用的（相对 Canvas 中心），不能拿它定位 Canvas 本身。
   锚点 (0.5,0.5) + 尺寸 1280×720 → 左上角正好落在屏幕 (0,0)。 */
const canvasNode = node("Canvas", { x: W / 2, y: H / 2, z: 0 });
/* ⚠ Canvas 的 _parent 必须指回 Scene。
   漏了的话：Scene._children 里明明有 Canvas，但 Canvas._parent 是 null。
   cc.Widget 的对齐逻辑是 `const target = this._target || this.node.parent`
   —— 拿到 null 就调 getReadonlyNodeSize(null)，而它第一行是
   `parent._getUITransformComp()`，**没有 null 保护** → 每帧 refreshScene 抛
   `Cannot read properties of null (reading '_getUITransformComp')`，预览直接白屏。
   这个错在文件层面完全合法（Scene 那边是对的），所以只能靠验证器反向查。 */
canvasNode._parent = { __id__: iScene };
put(iCanvas, canvasNode);

/** 挂一个子节点到父节点。
    ⚠ 必须**双向**写：子节点写 _parent、父节点 _children 里 push 一项。
      只写 _parent 的话，编辑器里父节点下面看不到它，运行时也不渲染 ——
      而且 verify-scene 原来的检查是「_children 里的都在 _parent 上」，
      单向写正好绕过它：一个都不在 _children 里，于是"全部通过"。
      现在两个方向都查（验证器第 7 项）。 */
function attach(nodeId, parentId, compIds) {
  const n = docs[nodeId];
  n._parent = { __id__: parentId };
  if (compIds) n._components = compIds.map((i) => ({ __id__: i }));
  const p = docs[parentId];
  if (!p._children) p._children = [];
  /* 幂等：同一节点只登记一次。
     addSprite(iCanvas, "BG", …) 会顺手把 BG 挂到 Canvas，
     末尾那个「按渲染顺序统一 attach」的循环又会挂一次 ——
     重复项会让编辑器建树时 _parent 打架，直接 Open scene failed。 */
  if (!p._children.some((c) => c.__id__ === nodeId)) p._children.push({ __id__: nodeId });
  return nodeId;
}

/** 显式声明子节点顺序。顺序 = 渲染顺序（后写的压在上面）。
    ⚠ 顺序不能靠 attach 的调用先后决定：BG / FogTop / FogBot 是在建它们的那一刻
      就挂上 Canvas 的，而 Camera 是最后才挂 —— 结果相机排在图层前面。
      这里在所有节点建完之后一次性重排，顺序与网页的 DOM 顺序一致。 */
function setOrder(parentId, ids) {
  docs[parentId]._children = ids.map((i) => ({ __id__: i }));
}

/** 带 pad 的部件：按「视觉左上角」定位。
    ⚠ 坐标走 TL()，是**相对 Canvas 中心**的绝对定位。
      只允许挂到铺满屏幕、位置为 (0,0) 的容器上（iCanvas / iHUD / iDock / iBadges）。
      父节点自己有位移时（HudProgress / HudTip / GoCard / Slot）必须改用
      addSprite + inPart()，否则会叠加一次父偏移 —— 元素整个飞出屏幕，
      而场景文件里看不出任何异常（坐标是合法数字，只是参照错了）。
      踩过：HUD 的 8 个关卡格全部消失。 */
function addPart(parentId, name, partName, wx, wy, color) {
  const P = PARTS[partName];
  const [l, t, r, b] = P.pad;
  const iN = reserve();
  put(iN, node(name, TL(wx - l, wy - t)));
  const iU = reserve(), iS = reserve();
  put(iU, uiTransform(iN, P.cw, P.ch, 0, 1));
  put(iS, sprite(iN, part(partName), color));
  attach(iN, parentId, [iU, iS]);
  return iN;
}

/** 部件内部的子元素：dx/dy = 相对**部件视觉左上角**的偏移（= CSS 的 left/top） */
function inPart(partName, dx, dy) {
  const [l, t] = PARTS[partName].pad;
  return { x: l + dx, y: -(t + dy) };
}

function addSprite(parentId, name, relSf, pos, w, h, ax, ay, color) {
  const iN = reserve();
  put(iN, node(name, pos));
  const iU = reserve(), iS = reserve();
  put(iU, uiTransform(iN, w, h, ax === undefined ? 0 : ax, ay === undefined ? 1 : ay));
  put(iS, sprite(iN, relSf, color));
  attach(iN, parentId, [iU, iS]);
  return iN;
}

function addLabel(parentId, name, str, pos, w, h, o) {
  const iN = reserve();
  put(iN, node(name, pos));
  const iU = reserve(), iL = reserve();
  put(iU, uiTransform(iN, w, h, o.ax === undefined ? 0 : o.ax, 1));
  put(iL, label(iN, str, o));
  attach(iN, parentId, [iU, iL]);
  return iN;
}

/* ---------- Camera ---------- */
put(iCamera, {
  __type__: "cc.Camera",
  _name: "", _objFlags: 0, __editorExtras__: {},
  node: { __id__: iCameraNode },
  _enabled: true, __prefab: null,
  _projection: 0, _priority: 0,
  _fov: 45, _fovAxis: 0,
  _orthoHeight: CY,
  _near: 0, _far: 2000,
  _color: { __type__: "cc.Color", r: 0, g: 0, b: 0, a: 255 },
  _depth: 1, _stencil: 0, _clearFlags: 7,
  _rect: { __type__: "cc.Rect", x: 0, y: 0, width: 1, height: 1 },
  _aperture: 19, _shutter: 7, _iso: 0,
  _screenScale: 1, _visibility: 1108344832,
  _targetTexture: null, _postProcess: null, _usePostProcess: false,
  _cameraType: -1, _trackingType: 0,
  _id: newId(),
});
const camNode = node("Camera", { x: 0, y: 0, z: 1000 });
camNode._layer = 1073741824;
put(iCameraNode, camNode);

/* ---------- 背景（v2：已烘入告示板 / 红旗 / 光斑花瓣） ---------- */
const bgSf = writeImageMeta("home/bg", { w: DIMS.bg.w, h: DIMS.bg.h, hasAlpha: false });
/* 显示高度按 CSS 反推：网页是 1280×853（源图 1536×1024 等比缩到 1280 宽）。
   ⚠ 这里必须写 853 而不是 DIMS.bg.h（1024）—— 直接把图片像素高当显示高，
     背景会被拉长 20%，六只宠物全部站到房子上面去。 */
const BG_DISPLAY_H = Math.round((W * DIMS.bg.h) / DIMS.bg.w * 100) / 100;
const iBG = addSprite(iCanvas, "BG", bgSf, TL(0, -40), W, BG_DISPLAY_H, 0, 1);

/* ---------- 宠物 ---------- */
const iPetsRoot = reserve();
put(iPetsRoot, node("Pets"));
const petIds = [];
for (const p of PETS) {
  /* 六只**全部预置**，还没回家的那一批 `active: false`。
     为什么不再"未解锁就不建节点"：
       战斗侧的出战人数 = 已解锁数（config/Roster.ts）。打赢一局 → 关卡 +1 →
       年糕解锁 → 战斗里真的多出一只。如果家里连节点都没有，
       就会出现"战斗里多了一只、家里看不见"的新断层 —— 正是这次要修的毛病。
     为什么不运行时动态建节点：
       家园贴图不在 resources 下（走 UUID 直连），运行时拿不到。
       预置 + 开关 active 是这条链路上唯一不需要改资源管线的做法。

     ⚠️ 静态场景表达的是"这一帧家里有谁"，所以这里按 `CLEARED` 决定初始 active；
        真正的开关在 `HomeRuntime.bindPets()`，它按存档再刷一遍。 */
  const d = DIMS.pets[p.id];
  const w = Math.round(p.h * (d.w / d.h) * 10) / 10;
  const sf = writeImageMeta("home/pets/" + p.id, { w: d.w, h: d.h, hasAlpha: true });
  const on = ALL_UNLOCKED || CLEARED >= p.at;

  const iNode = reserve();
  put(iNode, node(p.name, Object.assign(TL(p.cx, p.footY), { active: on })));
  const iU = reserve(), iS = reserve();
  put(iU, uiTransform(iNode, w, p.h, 0.5, 0));   // 锚点 = 脚底中心
  put(iS, sprite(iNode, sf, null, true));
  attach(iNode, iPetsRoot, [iU, iS]);
  petIds.push({ iNode, w, h: p.h, name: p.name, cx: p.cx, footY: p.footY, on });
}

/* ---------- 雾层（CSS 的 .fog-top / .fog-bot） ---------- */
const iFogTop = addPart(iCanvas, "FogTop", "fog-top", 0, 0);
const iFogBot = addPart(iCanvas, "FogBot", "fog-bot", 0, 568);

/* ---------- 场景入口徽标 ×5 ---------- */
/* 场景入口。两条规则，和网页版逐字对应：
     ① left/top = 圆心 − 20（40px 盒）；
     ② x 必须与它标注的物件中心对齐，否则玩家看不出这个图标指的是哪件东西。
        物件实测中心：木桌 232 / 门口 500 / 右锅 628 / 告示板 1048 / 路牌 250。
   标签是常驻的：之前只有 hover 提示，手柄与触屏永远看不到「这是干什么的」。 */
const BADGES = [
  ["hammer", 212, 320, "工作台", 3],
  ["paw",    480, 332, "图鉴",   2],
  ["pot",    608, 310, "灶台",   2],
  ["mail",  1028, 478, "派遣",   2],
  ["flag",   264, 182, "去苔原", 3],
];
const iBadges = reserve();
put(iBadges, node("Badges"));
const badgeIds = [];
for (const [ico, left, top, nm, nch] of BADGES) {
  const iB = addPart(iBadges, "Badge-" + nm, "badge-ring", left, top);
  // 图标视觉 32×32 居中于 40 的圆 → 相对视觉左上角 (4,4)
  addSprite(iB, "ico", icon(ico), inPart("badge-ring", 4, 4), 32, 32);

  /* 标签：胶囊中心落在徽标圆心下方 26px。
     宽度只有 34（2 字）/ 45（3 字）两种，出两张图比配九宫格 border 省事，
     也不会出现「四个边界值顺序接反」这种只在引擎里才暴露的错。 */
  const capPart = "badge-cap-" + nch;
  const CW = nch === 3 ? 45 : 34;
  /* 胶囊顶边 = 圆底边 + 4（网页是 top:100% + margin-top:4px）。
     ⚠ 不是「圆心 +26」—— 圆心到圆底就有 20，再减半高 9，写 37 会让胶囊压住圆底 3px。 */
  const iCap = addPart(iBadges, "Cap-" + nm, capPart, left + 20 - CW / 2, top + 44);
  addLabel(iCap, "txt", nm, inPart(capPart, 0, 0), CW, 18,
           { fs: 11, lh: 11, align: "center", color: { r: 107, g: 64, b: 37, a: 255 } });
  badgeIds.push(iB);
}

/* ============================================================================
   HUD
   ========================================================================== */
const iHUD = reserve();
put(iHUD, node("HUD"));
const hudKids = [];

/* --- 标题（CSS #logo：left 24 / top 0，.t margin-top 21 fs24 lh24） --- */
hudKids.push(addLabel(iHUD, "Logo-Title", "吧唧军团", TL(24, 21), 120, 24, {
  fs: 24, lh: 24, bold: true,
  color: { r: 255, g: 255, b: 255, a: 255 },
  outline: [120, 66, 44, 153, 3],
}));
hudKids.push(addLabel(iHUD, "Logo-Sub", "M U N C H   L E G I O N", TL(26, 45.5), 200, 9, {
  fs: 8.5, lh: 9, bold: true,
  color: { r: 255, g: 255, b: 255, a: 242 },
}));

/* --- 关卡进度条（.hud-prog：left 450 top 12 340×46 r23） --- */
const iProg = addPart(iHUD, "HudProgress", "panel-hud-prog", 450, 12);
hudKids.push(iProg);
addLabel(iProg, "txt-stage", "苔 原", inPart("panel-hud-prog", 20, 13.5), 60, 13, {
  fs: 12.5, lh: 13, bold: true, color: { r: 90, g: 56, b: 38, a: 255 },
});
addLabel(iProg, "txt-prog", `${CLEARED} / 8 关`, inPart("panel-hud-prog", 20, 30), 60, 10, {
  fs: 10, lh: 10, color: { r: 112, g: 72, b: 46, a: 189 },
});
// 关卡格：px+96+i*22 的 15×15 r4 → 本实现 15 + 间距 6 = 21 的节奏
for (let i = 0; i < 8; i++) {
  addSprite(iProg, "pip-" + i, part(i < PIPS_ON ? "pip-on" : "pip"),
            inPart("panel-hud-prog", 96 + i * 21 - 2, 16 - 2), 19, 19);
}
addLabel(iProg, "txt-chain", `连锁 ×${CHAIN}`, inPart("panel-hud-prog", 340 - 16, 17), 80, 12, {
  fs: 11, lh: 12, bold: true, align: "right", ax: 1,
  color: { r: 140, g: 74, b: 24, a: 255 },
});

/* --- 提示条（.hud-tip：left 820 top 16 236×30 r15） --- */
const iTip = addPart(iHUD, "HudTip", "panel-hud-tip", 820, 16);
hudKids.push(iTip);
addSprite(iTip, "paw", icon("paw-red"), inPart("panel-hud-tip", 10, 9), 20, 20);
addLabel(iTip, "txt", "年糕想出门了", inPart("panel-hud-tip", 36, 13), 150, 12, {
  fs: 11.5, lh: 12, bold: true, color: { r: 122, g: 58, b: 24, a: 255 },
});
{
  const A = PARTS["tip-arrow"];
  addSprite(iTip, "ar", part("tip-arrow"), inPart("panel-hud-tip", 236 - 26 - A.w, 10), A.cw, A.ch);
}

/* --- 右上设置键（.ico-btn：left 1222 top 17 36×36） --- */
const iGear = addPart(iHUD, "IconBtn", "ico-btn", 1222, 17);
hudKids.push(iGear);
addSprite(iGear, "ico", icon("gear"), inPart("ico-btn", 3, 3), 30, 30);


/* ============================================================================
   Dock（CSS #dock：left 0 top 618，本身没有底板 —— 只有卡片）
   ========================================================================== */
const iDock = reserve();
put(iDock, node("Dock"));
const dockKids = [];

/** 资源卡。结构：图标 + 右下角两行（数值 17px / 标签 10px） */
function addResCard(name, left, icoName, val, lbl) {
  const iC = addPart(iDock, name, "panel-res", left, 633);
  addSprite(iC, "ico", icon(icoName), inPart("panel-res", 8, 4), 32, 32);
  addLabel(iC, "val", val, inPart("panel-res", 82 - 10, 17), 50, 18, {
    fs: 17, lh: 18, bold: true, align: "right", ax: 1, color: { r: 90, g: 56, b: 38, a: 255 },
  });
  addLabel(iC, "lbl", lbl, inPart("panel-res", 82 - 10, 39), 50, 10, {
    fs: 10, lh: 10, align: "right", ax: 1, color: { r: 112, g: 72, b: 46, a: 168 },
  });
  return iC;
}
dockKids.push(addResCard("Res-Apple", 20, "apple", "248", "果子"));
dockKids.push(addResCard("Res-Log", 108, "log", "36", "材料"));
dockKids.push(addResCard("Res-Coin", 196, "coin", "12", "吧唧"));

/* --- 出战卡（.go-card：left 290 top 15 200×62） --- */
const iGoCard = addPart(iDock, "GoCard", "panel-go-card", 290, 633);
dockKids.push(iGoCard);
{
  const headSf = writeImageMeta("home/heads-circle/" + ACTIVE, { w: 160, h: 160, hasAlpha: true });
  addSprite(iGoCard, "av", headSf, inPart("panel-go-card", 9, 9), 44, 44);

  const nm = PETS.find((p) => p.id === ACTIVE).name;
  addLabel(iGoCard, "name", nm.split("").join(" "), inPart("panel-go-card", 60, 11.5), 60, 15, {
    fs: 13.5, lh: 15, bold: true, color: { r: 90, g: 56, b: 38, a: 255 },
  });
  {
    const S = PARTS["star"];
    addSprite(iGoCard, "star", part("star"), inPart("panel-go-card", 103, 9), S.cw, S.ch);
  }
  // 五心：已喂出 3 颗（pats 12 → 1 + floor(12/5) = 3，与 game.html 同一公式）
  const PITCH = 13;
  const hearts = 3;
  addLabel(iGoCard, "hearts-on", "♥".repeat(hearts), inPart("panel-go-card", 64, 25), 60, 16, {
    fs: 11.5, lh: 16, spacing: 2, color: { r: 255, g: 158, b: 182, a: 255 },
  });
  addLabel(iGoCard, "hearts-off", "♥".repeat(5 - hearts),
    inPart("panel-go-card", 64 + hearts * PITCH, 25), 40, 16, {
      fs: 11.5, lh: 16, spacing: 2, color: { r: 122, g: 80, b: 52, a: 41 },
    });
  /* 饱食三段 + 数值。
     ⚠ 这里写 `100/100` 而不是「满饱」：战斗里的 SATIETY 是 0~100 制，
       家园用形容词、战斗用数字，玩家读不出是不是同一个属性。
       `HomeRuntime.refreshSatiety()` 运行时算出来的也是这个格式 ——
       静态场景和运行时必须长得一样，否则"编辑器里对、跑起来不对"。 */
  /* ⚠ 这里**不能**用 addPart：GoCard 自己有位移（left 290 / top 633），
     addPart 走的是相对 Canvas 中心的绝对定位，叠一次父偏移就会飞到屏幕外 ——
     场景文件里完全看不出异常（坐标是合法数字，只是参照错了）。
     这三格 bar 从上线起就一直没渲染出来过，就是这么丢的。
     父节点有位移时必须走 addSprite + inPart()。 */
  /* 静态场景直接按"满饱"着色（= 默认存档 satiety 100 的档位色，PALETTE.safe 绿）。
     不留给运行时再染：编辑器里看到橘色、跑起来变绿色，是最容易让人误判
     "我改的没生效"的那种差异。运行时 `refreshSatiety()` 会在别的档位重新染色。 */
  for (let i = 0; i < 3; i++) {
    addSprite(iGoCard, "belly-" + i, part("belly-bar"),
      inPart("panel-go-card", 60 + i * 23, 44), 20, 9, 0, 1,
      { r: 107, g: 203, b: 119, a: 255 });
  }
  addLabel(iGoCard, "belly-txt", "100/100", inPart("panel-go-card", 136, 44), 44, 10, {
    fs: 9, lh: 10, bold: true, color: { r: 140, g: 74, b: 24, a: 255 },
  });
}

/* --- 待命位 ×5（.slot：left 506+i*46 top 15 40×62）---
   出战的那一只不进这一排 —— 它在左边的出战卡里已经有了。 */
const REST = PETS.filter((p) => p.id !== ACTIVE);
const NEWEST = Math.max(...PETS.filter((p) => CLEARED >= p.at).map((p) => p.at));
for (let i = 0; i < REST.length; i++) {
  const p = REST[i];
  const unlocked = ALL_UNLOCKED || CLEARED >= p.at;
  const isNew = SHOW_NEW_BADGE && unlocked && p.at === NEWEST;
  const skin = !unlocked ? "panel-slot-locked" : isNew ? "panel-slot-new" : "panel-slot";
  const iS = addPart(iDock, "Slot-" + p.name, skin, 506 + i * 46, 633);
  dockKids.push(iS);

  if (unlocked) {
    const hs = writeImageMeta("home/heads-circle/" + p.id, { w: 160, h: 160, hasAlpha: true });
    addSprite(iS, "av", hs, inPart(skin, 6, 12), 28, 28);
    addLabel(iS, "tag", "待", inPart(skin, 20, 62 - 4 - 10), 40, 10, {
      fs: 8, lh: 10, align: "center", ax: 0.5, color: { r: 112, g: 72, b: 46, a: 117 },
    });
    if (isNew) {
      const N = PARTS["slot-new"];
      addSprite(iS, "new", part("slot-new"), inPart(skin, 40 - 4 - N.w, 3), N.cw, N.ch);
      addLabel(iS, "new-txt", "新", inPart(skin, 40 - 4 - N.w / 2, 3 + 1), 14, 9, {
        fs: 7.5, lh: 9, bold: true, align: "center", ax: 0.5, color: { r: 90, g: 48, b: 8, a: 255 },
      });
    }
  } else {
    addSprite(iS, "av-bg", icon("lock"), inPart(skin, 12, 18), 16, 16);
    addLabel(iS, "tag", `第${p.at}关`, inPart(skin, 20, 62 - 4 - 10), 40, 10, {
      fs: 8, lh: 10, align: "center", ax: 0.5, color: { r: 122, g: 80, b: 52, a: 133 },
    });
  }
}

/* --- 出门主按钮（#go：left 760 top 12 500×68，含 6px 厚底 + 投影） --- */
const iGo = addPart(iDock, "Btn-Go", "btn-go", 760, 630);
dockKids.push(iGo);
addLabel(iGo, "txt", "出　门", inPart("btn-go", 72, 21.5), 120, 27, {
  fs: 27, lh: 27, bold: true, align: "center", ax: 0.5, color: { r: 62, g: 35, b: 18, a: 255 },
});
/* 两行副标题也走"花名册口径"，不再写死"带砂糖"。
   队伍人数 = 已解锁数（config/Roster.ts），写死名字在解锁第二只的当天就过期。
   `HomeRuntime.bindSave()` 运行时会用同一套算法重算一遍。 */
addLabel(iGo, "line", `带 ${Math.min(3, Math.max(1, CLEARED >= 3 ? 3 : CLEARED >= 1 ? 2 : 1))} 只 · 苔原 ${CLEARED + 1} / 8`, inPart("btn-go", 172, 19.5), 240, 15, {
  fs: 14, lh: 15, bold: true, color: { r: 74, g: 44, b: 24, a: 255 },
});
addLabel(iGo, "sub", "家门口的草地就够打一场 · 战利品直接进池", inPart("btn-go", 172, 42.5), 300, 11, {
  fs: 10, lh: 11, color: { r: 88, g: 46, b: 20, a: 209 },
});


/* ---------- Canvas 组装 ---------- */
/* Canvas 的子节点顺序 = 渲染顺序（后画的压在上面），与网页的 DOM 顺序一致：
   BG → Pets → FogTop → FogBot → Badges → HUD → Dock
   ⚠ 顺序错了不会报错，只表现为"徽标被雾盖住"这种说不清的现象。 */
/* 相机不参与 UI 渲染，放第一个（它只负责投影，不影响批次）。
   其余图层用 setOrder 一次性定序 —— 不靠 attach 调用先后。 */
attach(iCameraNode, iCanvas);
for (const id of [iBG, iPetsRoot, iFogTop, iFogBot, iBadges, iHUD, iDock]) attach(id, iCanvas);
setOrder(iCanvas, [iCameraNode, iBG, iPetsRoot, iFogTop, iFogBot, iBadges, iHUD, iDock]);

/* 纯容器节点也要挂 UITransform。
   Cocos 的 UI 批次与 Widget 都要求父链上有 UITransform；缺了在编辑器里
   通常表现为 `_getUITransformComp` of null，或者整棵子树不参与布局计算。
   容器本身不画东西，尺寸给满屏、锚点左上即可。 */
for (const id of [iPetsRoot, iBadges, iHUD, iDock]) {
  const iU = reserve();
  put(iU, uiTransform(id, W, H, 0, 1));
  docs[id]._components = [{ __id__: iU }];
}
const iCanvasUT = reserve();
const iCanvasComp = reserve();
const iCanvasWidget = reserve();
canvasNode._components = [
  { __id__: iCanvasUT }, { __id__: iCanvasComp }, { __id__: iCanvasWidget },
];
camNode._parent = { __id__: iCanvas };
camNode._components = [{ __id__: iCamera }];

put(iCanvasUT, uiTransform(iCanvas, W, H, 0.5, 0.5));
put(iCanvasComp, {
  __type__: "cc.Canvas",
  _name: "", _objFlags: 0, __editorExtras__: {},
  node: { __id__: iCanvas },
  _enabled: true, __prefab: null,
  _cameraComponent: { __id__: iCamera },
  _alignCanvasWithScreen: true,
  _id: newId(),
});
put(iCanvasWidget, {
  __type__: "cc.Widget",
  _name: "", _objFlags: 0, __editorExtras__: {},
  node: { __id__: iCanvas },
  _enabled: true, __prefab: null,
  _alignFlags: 45, _target: null,
  _left: 0, _right: 0, _top: 0, _bottom: 0,
  _horizontalCenter: 0, _verticalCenter: 0,
  _isAbsLeft: true, _isAbsRight: true, _isAbsTop: true, _isAbsBottom: true,
  _isAbsHorizontalCenter: true, _isAbsVerticalCenter: true,
  _originalWidth: 0, _originalHeight: 0,
  _alignMode: 2, _lockFlags: 0,
  _id: newId(),
});

/* ---------- SceneGlobals（照抄真实工程，改一个字段编辑器就报警告） ---------- */
const iGlobals = reserve();
const infoIds = [];
for (let k = 0; k < 8; k++) infoIds.push(reserve());

put(iGlobals, {
  __type__: "cc.SceneGlobals",
  ambient: { __id__: infoIds[0] },
  shadows: { __id__: infoIds[1] },
  _skybox: { __id__: infoIds[2] },
  fog: { __id__: infoIds[3] },
  octree: { __id__: infoIds[4] },
  skin: { __id__: infoIds[5] },
  lightProbeInfo: { __id__: infoIds[6] },
  postSettings: { __id__: infoIds[7] },
  bakedWithStationaryMainLight: false,
  bakedWithHighpLightmap: false,
});

put(infoIds[0], {
  __type__: "cc.AmbientInfo",
  _skyColorHDR: { __type__: "cc.Vec4", x: 0, y: 0, z: 0, w: 0.520833125 },
  _skyColor: { __type__: "cc.Vec4", x: 0, y: 0, z: 0, w: 0.520833125 },
  _skyIllumHDR: 20000, _skyIllum: 20000,
  _groundAlbedoHDR: { __type__: "cc.Vec4", x: 0, y: 0, z: 0, w: 0 },
  _groundAlbedo: { __type__: "cc.Vec4", x: 0, y: 0, z: 0, w: 0 },
  _skyColorLDR: { __type__: "cc.Vec4", x: 0.2, y: 0.5, z: 0.8, w: 1 },
  _skyIllumLDR: 20000,
  _groundAlbedoLDR: { __type__: "cc.Vec4", x: 0.2, y: 0.2, z: 0.2, w: 1 },
});
put(infoIds[1], {
  __type__: "cc.ShadowsInfo", _enabled: false, _type: 0,
  _normal: { __type__: "cc.Vec3", x: 0, y: 1, z: 0 },
  _distance: 0, _planeBias: 1,
  _shadowColor: { __type__: "cc.Color", r: 76, g: 76, b: 76, a: 255 },
  _maxReceived: 4, _size: { __type__: "cc.Vec2", x: 512, y: 512 },
});
put(infoIds[2], {
  __type__: "cc.SkyboxInfo", _envLightingType: 0,
  _envmapHDR: null, _envmap: null, _envmapLDR: null,
  _diffuseMapHDR: null, _diffuseMapLDR: null,
  _enabled: false, _useHDR: true, _editableMaterial: null,
  _reflectionHDR: null, _reflectionLDR: null, _rotationAngle: 0,
});
put(infoIds[3], {
  __type__: "cc.FogInfo", _type: 0,
  _fogColor: { __type__: "cc.Color", r: 200, g: 200, b: 200, a: 255 },
  _enabled: false, _fogDensity: 0.3, _fogStart: 0.5, _fogEnd: 300,
  _fogAtten: 5, _fogTop: 1.5, _fogRange: 1.2, _accurate: false,
});
put(infoIds[4], {
  __type__: "cc.OctreeInfo", _enabled: false,
  _minPos: { __type__: "cc.Vec3", x: -1024, y: -1024, z: -1024 },
  _maxPos: { __type__: "cc.Vec3", x: 1024, y: 1024, z: 1024 },
  _depth: 8,
});
put(infoIds[5], { __type__: "cc.SkinInfo", _enabled: false, _blurRadius: 0.01, _sssIntensity: 3 });
put(infoIds[6], {
  __type__: "cc.LightProbeInfo", _giScale: 1, _giSamples: 1024, _bounces: 2,
  _reduceRinging: 0, _showProbe: true, _showWireframe: true, _showConvex: false,
  _data: null, _lightProbeSphereVolume: 1,
});
put(infoIds[7], { __type__: "cc.PostSettingsInfo", _toneMappingType: 0 });

/* ---------- Scene / SceneAsset ---------- */
put(iScene, {
  __type__: "cc.Scene",
  _name: "Home",
  _objFlags: 0,
  __editorExtras__: {},
  _parent: null,
  _children: [{ __id__: iCanvas }],
  _active: true,
  _components: [],
  _prefab: null,
  _lpos: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 },
  _lrot: { __type__: "cc.Quat", x: 0, y: 0, z: 0, w: 1 },
  _lscale: { __type__: "cc.Vec3", x: 1, y: 1, z: 1 },
  _mobility: 0,
  _layer: 1073741824,
  _euler: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 },
  autoReleaseAssets: false,
  _globals: { __id__: iGlobals },
  _id: sceneUUID,
});
put(iSceneAsset, {
  __type__: "cc.SceneAsset",
  _name: "Home",
  _objFlags: 0,
  __editorExtras__: {},
  _native: "",
  scene: { __id__: iScene },
});

/* ---------- 输出 ---------- */
fs.mkdirSync(SCENES, { recursive: true });
fs.writeFileSync(path.join(SCENES, "Home.scene"), JSON.stringify(docs, null, 2));
fs.writeFileSync(SCENE_META, JSON.stringify({
  ver: "1.1.50", importer: "scene", imported: true,
  uuid: sceneUUID, files: [".json"], subMetas: {}, userData: {},
}, null, 2));

// 同步 current-scene —— 漏了这一步，双击打开后是空场景，而且不报错
const settingsDir = path.join(CLIENT, "settings", "v2", "packages");
if (fs.existsSync(settingsDir)) {
  fs.writeFileSync(
    path.join(settingsDir, "scene.json"),
    JSON.stringify({ __version__: "1.0.3", "current-scene": sceneUUID }, null, 2)
  );
}

/* ---------- 报告 ---------- */
const nNode = docs.filter((d) => d && d.__type__ === "cc.Node").length;
const nSprite = docs.filter((d) => d && d.__type__ === "cc.Sprite").length;
const nLabel = docs.filter((d) => d && d.__type__ === "cc.Label").length;
console.log(`✓ Home.scene  ${docs.length} 个文档对象 / 节点 ${nNode} / Sprite ${nSprite} / Label ${nLabel}`);
console.log(`✓ Home.scene.meta  uuid ${sceneUUID}`);
console.log(`✓ 图片 meta ×${metaCache.size}`);
console.log("\n场景结构（anchor 0,1 = 左上角；坐标 = CSS 的 left/top − 640 / 360 − top）");
console.log("  Canvas 1280×720");
console.log("  ├ Camera       正交 orthoHeight 360");
console.log(`  ├ BG           (0,-40) 1280×${BG_DISPLAY_H}  ← home-bg@v2（源 1536×${DIMS.bg.h}）`);
console.log("  ├ Pets      ×6 锚点 (0.5,0) = 脚底中心");
console.log("  ├ FogTop/FogBot  渐变雾层");
console.log(`  ├ Badges    ×${BADGES.length} 圆钮 40px + 线描图标 32px + 标签胶囊`);
console.log(`  ├ HUD       Logo / HudProgress(8 格 + 连锁 ×${CHAIN}) / HudTip / IconBtn`);
console.log(`  └ Dock      Res×3 / GoCard / Slot×${REST.length} / Btn-Go`);
