/* ============================================================================
   build-post-overlay.js —— 生成「镜头叠加层」PNG
   ----------------------------------------------------------------------------
   为什么需要一张图而不是在 Cocos 里实时算：
   主界面（Cocos 3.8）是 Sprite 拼的场景，没有后处理管线。要实时做泛光/颗粒，
   得挂一整套自定义 render pipeline + 三个 pass，代价远超收益。
   而暗角和颗粒是**静态**的 —— 它们不随场景内容变化，烤成一张图，
   运行时只多一个 Sprite、多一次 alpha 混合，成本约等于零。

   这张图只做三件主界面做不到的事：
     ① 暗角：把视线收回中间，同时让画面四角"沉下去"（真实镜头一定有）
     ② 颗粒：给画面加胶片噪声。程序化/Sprite 拼出来的场景每个像素都太干净，
        "零噪声"本身就是"这是画出来的"的直接证据
     ③ 边缘冷调：四角略偏冷，和背景中央的暖光形成色温差

   为什么 640×360 再拉伸而不是 1280×720 原尺寸：
   颗粒的有效尺寸是**显示屏上的像素**，不是设计稿像素。640 的颗粒拉伸到
   1280 之后直径翻倍，更接近胶片颗粒；原尺寸的颗粒在 2x 屏上会缩成
   看不见的单像素噪点，等于白做。顺带文件小 4 倍。

   用法：
     NODE_PATH=<workspace>/node_modules node tools/build-post-overlay.js
   产物：assets/resources/ui/post-overlay.png（+ .meta）
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");

const W = 640, H = 360;
/* 设计分辨率 1280×720 的两倍关系：这张图运行时会被拉满全屏。
   比例必须和 16:9 的 Canvas 一致，否则暗角会变成上下偏或左右偏。 */
const OUT_PNG = path.join(__dirname, "..", "assets", "resources", "ui", "post-overlay.png");
const OUT_META = OUT_PNG + ".meta";

/* 确定性噪声：每次重建都得到同一张图。
   用 Math.random 的话，每跑一次生成脚本图的哈希就变一次 ——
   git 里会出现"只改了 1 个字节"的假 diff，评审时完全看不出改了什么。 */
function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const c = createCanvas(W, H);
const g = c.getContext("2d");

/* ---- ① 暗角 ----
   椭圆而不是正圆：按 H/W 压扁，四角的衰减才均匀。
   中心留 0.56 半径的干净区（画面主体都在这里），
   从 0.56 到 1.0 之间线性加深，最外圈 alpha 0.46。

   颜色取 (8,14,11) 的暗绿黑，不是纯黑。
   纯黑会把暗角里的草地色相吸掉，读作"给画面加了个黑框"；
   带一点点绿，它才读作"镜头边缘的光衰减"。 */
g.save();
g.translate(W / 2, H / 2);
g.scale(1, H / W);
const R = W * 0.54;
const vg = g.createRadialGradient(0, 0, R * 0.56, 0, 0, R);
vg.addColorStop(0, "rgba(8,14,11,0)");
vg.addColorStop(0.55, "rgba(8,14,11,0.11)");
vg.addColorStop(1, "rgba(8,14,11,0.46)");
g.fillStyle = vg;
g.fillRect(-W, -W, W * 2, W * 2);
g.restore();

/* ---- ② 颗粒 ----
   每个像素要么偏亮要么偏暗，alpha 都压得很低（0~14）。
   normal 混合下它等效于"±5% 的明度抖动"，这就是颗粒。

   为什么不用 overlay 混合：Cocos 的 Sprite 默认只有 normal，
   要换混合模式得自定义 material。normal 已经够了 ——
   颗粒的本质是"相邻像素有微小随机差"，不需要真的做加减混合。

   分布用"大部分接近 0、少数偏大"（平方再开方那种手感）：
   均匀分布看起来像电视雪花，胶片颗粒是稀疏且不均匀的。 */
const img = g.getImageData(0, 0, W, H);
const d = img.data;
const vgData = new Uint8ClampedArray(d);   // 先把暗角拷出来，颗粒只往透明处加
for (let i = 0; i < W * H; i++) {
  const r1 = hash(i * 1.37 + 0.11);
  const r2 = hash(i * 2.71 + 5.3);
  /* 三角分布：两个均匀随机相减，结果集中在 0 附近，
     只有约 12% 的像素会拿到接近满值的强度 —— 那才是颗粒的样子。 */
  const t = r1 - r2;
  const a = Math.min(1, Math.abs(t) * 2.4);
  const level = Math.round(a * 13);          // 0 ~ 13
  d[i * 4] = t > 0 ? 255 : 0;
  d[i * 4 + 1] = t > 0 ? 251 : 0;
  d[i * 4 + 2] = t > 0 ? 240 : 0;
  /* 颗粒和暗角共存：取两者中更"重"的那一个 alpha。
     直接相加会在四角叠出过黑的噪点，看起来像"镜头发霉"。 */
  d[i * 4 + 3] = Math.max(level, vgData[i * 4 + 3]);
  if (vgData[i * 4 + 3] > level) {
    // 暗角主导的像素保留暗角的颜色，别被颗粒的纯白/纯黑盖掉
    d[i * 4] = vgData[i * 4];
    d[i * 4 + 1] = vgData[i * 4 + 1];
    d[i * 4 + 2] = vgData[i * 4 + 2];
  }
}
g.putImageData(img, 0, 0);

fs.mkdirSync(path.dirname(OUT_PNG), { recursive: true });
fs.writeFileSync(OUT_PNG, c.toBuffer("image/png"));

/* ---- .meta ----
   Cocos 靠 uuid 认资源。这里手写一份：不手写的话编辑器打开时会自己生成，
   但 HomeRuntime 在**编辑器生成之前**就已经 resources.load 了 —— 那一下必然
   拿不到图，表现是"主界面有时候有暗角、有时候没有"，且开一次编辑器就好。
   uuid 用固定值（不是随机）：重跑脚本不能换 uuid，否则场景里的引用会全断。 */
const UUID = "8f3c1d0a-7b52-4e6a-9c11-2d5a0ef71b33";
const meta = {
  ver: "1.0.27",
  importer: "image",
  imported: true,
  uuid: UUID,
  files: [".json", ".png"],
  subMetas: {
    "6c48a": {
      importer: "texture",
      uuid: UUID + "@6c48a",
      displayName: "post-overlay",
      id: "6c48a",
      name: "texture",
      userData: {
        wrapModeS: "clamp-to-edge",
        wrapModeT: "clamp-to-edge",
        minfilter: "linear",
        magfilter: "linear",
        mipfilter: "none",
        anisotropy: 0,
        isUuid: true,
        imageUuidOrDatabaseUri: UUID,
        visible: false,
      },
      ver: "1.0.22",
      imported: true,
      files: [".json"],
      subMetas: {},
    },
  },
  userData: {
    type: "texture",
    fixAlphaTransparencyArtifacts: false,
    hasAlpha: true,
    redirect: UUID + "@6c48a",
  },
};
fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + "\n");

const kb = (fs.statSync(OUT_PNG).size / 1024).toFixed(0);
console.log("  " + OUT_PNG + "  " + W + "×" + H + "  " + kb + " KB");
