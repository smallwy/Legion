/* ============================================================================
   把 Home.scene 渲染成 PNG —— 不开 Cocos 编辑器也能看到场景长什么样
   ----------------------------------------------------------------------------
   为什么必须做这件事：
     手写/生成的 scene 打开后只有两种结果 —— 正常，或者一片空白 / 全错位，
     而且**不报错**。真开编辑器一轮要几十秒，改一次看一次根本推不动。
     所以这里用 40 行把 Cocos 的 UI 排版规则重实现一遍：
       节点 y 向上、anchor 决定 contentSize 怎么摆、Sprite 铺满 contentSize。
     它不追求像素级等于 Cocos 的渲染器（字体度量、抗锯齿会差一点），
     但**位置错 1px 就是 1px**，足以把"放错了"和"字体不同"分开。

   规则来源（照着 Cocos Creator 3.8 的 UITransform 行为写）：
     · 节点局部坐标原点 = 父节点锚点处
     · 自身矩形：x ∈ [px − ax·w, px + (1−ax)·w]，y ∈ [py − ay·h, py + (1−ay)·h]
     · Sprite Simple + sizeMode CUSTOM：把整张 spriteFrame 画进该矩形
     · Label overflow NONE：先按 alignment 定水平位置，再按 lineHeight 定竖直位置

   用法：node _render-scene.js [输出名]
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const CLIENT = path.join(__dirname, "..");
const ASSETS = path.join(CLIENT, "assets");
const SCENE = process.env.PAW_SCENE || path.join(ASSETS, "scenes", "Home.scene");
const OUT = path.join(CLIENT, "shots", (process.argv[2] || "_cocos") + ".png");

const W = 1280, H = 720, CX = W / 2, CY = H / 2;

/* ---------- 收集 spriteFrame uuid → png 路径 ---------- */
const sfToPng = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith(".png.meta")) continue;
    try {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      const sf = (m.subMetas || {}).f9941;
      if (sf && sf.uuid) sfToPng.set(sf.uuid, p.replace(/\.meta$/, ""));
    } catch (err) { /* 目录 meta */ }
  }
})(ASSETS);

const docs = JSON.parse(fs.readFileSync(SCENE, "utf8"));
const N = docs.length;

(async () => {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);

  const imgCache = new Map();
  const img = async (p) => {
    if (!imgCache.has(p)) imgCache.set(p, await loadImage(p));
    return imgCache.get(p);
  };

  /* ---- Sprite 染色 ----
     Cocos 的 `cc.Sprite._color` 是**乘算 tint**，不是透明度。
     之前这里只处理了 a<255，所以任何靠染色表达的语义在图里都看不见 ——
     饱食度三格（绿/金/红）、以及用同一张贴图染不同色的图标全都会读成原色。
     做 UI 评审的时候，"颜色对不对"占了很大比重，渲染器看不见颜色等于看不见一半。
     实现：multiply 上色 + destination-in 抠回原 alpha，结果按「图 + 色」缓存。 */
  const tintCache = new Map();
  const tint = async (p, col) => {
    const key = p + "|" + col.r + "," + col.g + "," + col.b;
    if (tintCache.has(key)) return tintCache.get(key);
    const base = await img(p);
    const c = createCanvas(base.width, base.height);
    const cg = c.getContext("2d");
    cg.drawImage(base, 0, 0);
    cg.globalCompositeOperation = "multiply";
    cg.fillStyle = `rgb(${col.r},${col.g},${col.b})`;
    cg.fillRect(0, 0, base.width, base.height);
    cg.globalCompositeOperation = "destination-in";
    cg.drawImage(base, 0, 0);
    tintCache.set(key, c);
    return c;
  };

  let drawnSprite = 0, drawnLabel = 0, missed = [];

  /* 递归绘制。world = 父级的「锚点原点」在画布上的像素坐标 */
  async function draw(nodeIdx, ox, oy) {
    const n = docs[nodeIdx];
    if (!n || n.__type__ !== "cc.Node" || !n._active) return;
    const px = ox + (n._lpos ? n._lpos.x : 0);
    const py = oy - (n._lpos ? n._lpos.y : 0);   // y 向上 → 画布 y 向下

    /* 局部缩放与 2D 旋转。
       之前只读 _lpos，所以「挤压拉伸」和「倾斜」这两类姿态在预览里完全看不见 ——
       用这种渲染器验收步态，永远只会看到一堆位置不同的静图，看不出动得好不好。 */
    const ls = n._lscale || { x: 1, y: 1 };
    const lq = n._lrot || { x: 0, y: 0, z: 0, w: 1 };
    const rotZ = 2 * Math.atan2(lq.z, lq.w);     // 四元数 → 弧度
    const hasT = Math.abs(ls.x - 1) > 1e-4 || Math.abs(ls.y - 1) > 1e-4 || Math.abs(rotZ) > 1e-4;

    // 组件
    let ut = null;
    for (const c of n._components || []) {
      const comp = docs[c.__id__];
      if (!comp) continue;
      if (comp.__type__ === "cc.UITransform") ut = comp;
    }

    for (const c of n._components || []) {
      const comp = docs[c.__id__];
      if (!comp) continue;

      if (comp.__type__ === "cc.Sprite") {
        const uuid = comp._spriteFrame && comp._spriteFrame.__uuid__;
        const file = sfToPng.get(uuid);
        if (!file) { missed.push(n._name + " ← " + uuid); continue; }
        const im = await img(file);
        const w = ut ? ut._contentSize.width : im.width;
        const h = ut ? ut._contentSize.height : im.height;
        const ax = ut ? ut._anchorPoint.x : 0.5;
        const ay = ut ? ut._anchorPoint.y : 0.5;
        const left = px - ax * w;
        const top = py - (1 - ay) * h;
        const col = comp._color;
        const src = col && (col.r !== 255 || col.g !== 255 || col.b !== 255)
          ? await tint(file, col)
          : im;
        g.save();
        if (comp._color && comp._color.a < 255) g.globalAlpha = comp._color.a / 255;
        if (hasT) {
          /* 以锚点为原点做 变换 → 画本地坐标。顺序必须 translate→rotate→scale。 */
          g.translate(px, py);
          g.rotate(-rotZ);            // 画布 y 轴向下，角度取反
          g.scale(ls.x, ls.y);
          g.drawImage(src, -ax * w, -(1 - ay) * h, w, h);
        } else {
          g.drawImage(src, left, top, w, h);
        }
        g.restore();
        drawnSprite++;
      }

      if (comp.__type__ === "cc.Label") {
        const fs_ = comp._fontSize || 20;
        const lh = comp._lineHeight || Math.round(fs_ * 1.35);
        const ax = ut ? ut._anchorPoint.x : 0;
        const w = ut ? ut._contentSize.width : 0;
        g.save();
        g.font = `${comp._isBold ? "bold " : ""}${fs_}px "Microsoft YaHei", "PingFang SC", sans-serif`;
        g.textBaseline = "middle";
        const col = comp._color;
        const rgb = `rgba(${col.r},${col.g},${col.b},${(col.a / 255).toFixed(3)})`;
        if (comp._enableOutline && comp._outlineWidth > 0) {
          const o = comp._outlineColor;
          g.strokeStyle = `rgba(${o.r},${o.g},${o.b},${(o.a / 255).toFixed(3)})`;
          g.lineWidth = comp._outlineWidth * 2;
          g.lineJoin = "round";
        }
        g.fillStyle = rgb;
        /* ⚠ 文字中心 = 盒顶 + 盒高/2，而**盒顶取决于 anchor.y**：
             anchor.y = 1（本场景的默认）→ 盒从 py 向下延伸 → 中心 = py + h/2
             anchor.y = 0            → 盒从 py 向上延伸 → 中心 = py − h/2
           原来写死 `py − lh/2`，等于假设 anchor.y = 0 且用行高当盒高 ——
           两处都错，叠起来正好把「工作台」三个字推到圆钮的底边上。 */
        const ay = ut ? ut._anchorPoint.y : 1;
        const th = ut ? ut._contentSize.height : lh;
        const ty = py + (ay - 0.5) * th;
        let tx = px;
        if (comp._horizontalAlign === 2) { g.textAlign = "right"; tx = px + (1 - ax) * w; }
        else if (comp._horizontalAlign === 1) { g.textAlign = "center"; tx = px + (0.5 - ax) * w; }
        else { g.textAlign = "left"; tx = px - ax * w; }
        // 字间距（Cocos _spacingX）：逐字画
        if (comp._spacingX) {
          const chars = [...comp._string];
          let cx = tx - (comp._horizontalAlign === 1 ? comp._spacingX * (chars.length - 1) / 2 : 0);
          for (const ch of chars) {
            if (comp._enableOutline) g.strokeText(ch, cx, ty);
            g.fillText(ch, cx, ty);
            cx += g.measureText(ch).width + comp._spacingX;
          }
          void w; void ax;
        } else {
          if (comp._enableOutline) g.strokeText(comp._string, tx, ty);
          g.fillText(comp._string, tx, ty);
        }
        g.restore();
        drawnLabel++;
      }
    }

    for (const c of n._children || []) await draw(c.__id__, px, py);
  }

  // 场景根 → Canvas（Canvas 的锚点在中心，所以它的"锚点原点"在画布中心 + 它自己的位置）
  const sceneDoc = docs.find((d) => d && d.__type__ === "cc.Scene");
  const canvasIdx = sceneDoc._children[0].__id__;
  const canvasNode = docs[canvasIdx];
  await draw(canvasIdx, CX - canvasNode._lpos.x, CY + canvasNode._lpos.y);

  fs.writeFileSync(OUT, cv.toBuffer("image/png"));
  console.log(`✓ ${path.relative(CLIENT, OUT)}  Sprite ${drawnSprite} / Label ${drawnLabel}` +
    `（文档 ${N} 个，缺少贴图引用 ${missed.length}）`);
  if (missed.length) {
    console.log("  ✗ 缺失贴图：");
    for (const m of missed.slice(0, 10)) console.log("    " + m);
    process.exit(1);
  }
})();
