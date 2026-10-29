/* 关卡结构图：把「空间设计」画成俯视示意图，一屏看几关。

   **为什么不直接用游戏截图？** 真实渲染一张只有一层（960×600），
   而"死胡同"是**层内横向**的事、"难度递进"是**层与层之间**的事 ——
   两者都要"一次看完整关"才读得出来。截图只能看一层，看完 5 层再拼脑内图。

   图上每个东西都对应一条玩法事实：
     箱柱高度 = 地形台阶（一格 48）      洞 = 楼板缺口（掉下一层）
     灰块    = 平台 / 雪包（可走）        门 = 绿色方块，被冰箱包着
     星      = 出生点                     竖线 = 主通道（0 格列）

   用法：
     node tools/_level-map.js                 默认 6 个种子
     node tools/_level-map.js 7 12 119        指定种子
     SEEDS=1,2,3 OUT=x.png node tools/_level-map.js

   需要 NODE_PATH 指到 workspace/node_modules（@napi-rs/canvas）。
*/
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const SRC = process.env.PROTO || path.join(ROOT, "prototype", "snowlab.html");
const OUT = process.env.OUT || path.join(ROOT, "shots", "_level-map.png");

const CW = 20;               // 列数
const COL_W = 14;            // 每列像素
const LAY_H = 46;            // 每层像素
const PAD = 14;
const HEAD = 26;

function loadLab() {
  const html = fs.readFileSync(SRC, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const cv = createCanvas(960, 600);
  const g = cv.getContext("2d");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = () => g;
  window.requestAnimationFrame = () => 0;
  window.eval(m[1]);
  return window.SNOWLAB;
}

function main() {
  const L = loadLab();
  const args = process.argv.slice(2).map(Number).filter(n => n > 0);
  const seeds = args.length ? args
    : (process.env.SEEDS ? process.env.SEEDS.split(",").map(Number) : [1, 2, 3, 5, 7, 12]);

  const panels = seeds.map(sd => ({ sd, lv: L.genLevel(sd) }));
  const cols = Math.min(3, panels.length);
  const rows = Math.ceil(panels.length / cols);
  const pW = PAD * 2 + CW * COL_W;
  const maxF = Math.max(...panels.map(p => p.lv.layers.length));
  const pH = HEAD + PAD + maxF * LAY_H + PAD;

  const cv = createCanvas(cols * pW, rows * pH);
  const g = cv.getContext("2d");
  g.fillStyle = "#141821"; g.fillRect(0, 0, cv.width, cv.height);

  panels.forEach(({ sd, lv }, idx) => {
    const ox = (idx % cols) * pW, oy = Math.floor(idx / cols) * pH;
    const N = lv.layers.length;

    g.fillStyle = "#1b2130";
    g.fillRect(ox + 2, oy + 2, pW - 4, pH - 4);

    g.fillStyle = "#e8eef8";
    g.font = "bold 13px 'Microsoft YaHei', sans-serif";
    g.fillText("种子 " + sd + " · " + N + " 层 · 箱 " + lv.boxes.length + " 口", ox + PAD, oy + 18);
    g.fillStyle = "#8fa0b8";
    g.font = "11px 'Microsoft YaHei', sans-serif";
    g.fillText("门 x=" + lv.door.x, ox + PAD + 150, oy + 18);

    const x0 = ox + PAD, y0 = oy + HEAD + PAD;
    /* 每层画一条带：自下而上（第 0 层在上，和游戏一致） */
    lv.layers.forEach((l, k) => {
      const by = y0 + k * LAY_H;
      const floorY = by + LAY_H - 8;          // 该层地板线的像素位置
      /* 层底淡色背景 + 层名 */
      g.fillStyle = k % 2 ? "#202838" : "#1e2534";
      g.fillRect(x0, by, CW * COL_W, LAY_H - 2);

      g.fillStyle = "#5f7290";
      g.font = "10px 'Microsoft YaHei', sans-serif";
      g.fillText((k === N - 1 ? "门厅" : "L" + k) + " t" + l.tier.toFixed(2), x0 + 2, by + 11);

      /* 箱柱：一格 48 → 7px */
      const H = l.colHgt || new Array(CW).fill(0);
      for (let i = 0; i < CW; i++) {
        const h = H[i];
        if (h <= 0) continue;
        const bh = h * 7;
        g.fillStyle = h >= 3 ? "#c08a4e" : h === 2 ? "#d9a86a" : "#e8c48c";
        g.fillRect(x0 + i * COL_W + 1, floorY - bh, COL_W - 2, bh);
      }
      /* 地形：平台 / 雪包（灰） */
      for (const t of l.terrain) {
        const tx = x0 + (t.x / 48) * COL_W;
        const tw = Math.max(2, (t.w / 48) * COL_W);
        if (t.kind === "ramp") {
          const hgt = Math.abs(t.rise) * 0.15;
          g.fillStyle = "rgba(150,160,175,.55)";
          g.beginPath();
          if (t.rise > 0) { g.moveTo(tx, floorY); g.lineTo(tx + tw, floorY - hgt); g.lineTo(tx + tw, floorY); }
          else { g.moveTo(tx, floorY - hgt); g.lineTo(tx + tw, floorY); g.lineTo(tx, floorY); }
          g.closePath(); g.fill();
        } else {
          g.fillStyle = "rgba(150,160,175,.75)";
          g.fillRect(tx, floorY - 12, tw, 4);
        }
      }
      /* 洞：红色缺口（地板断开） */
      for (const h of l.holes) {
        g.fillStyle = h.cover === "ice" ? "#4aa6e8" : h.cover === "frost" ? "#9fd8f0" : "#e05555";
        g.fillRect(x0 + (h.x / 48) * COL_W, floorY, Math.max(3, (h.w / 48) * COL_W), 6);
      }
      /* 地板线 */
      g.fillStyle = "#7f8ea6";
      for (const s of l.segs) {
        g.fillRect(x0 + (s.x / 48) * COL_W, floorY + 6, Math.max(1, (s.w / 48) * COL_W), 2);
      }
      /* 主通道：0 格且段内的列，画一条竖直淡线 */
      g.fillStyle = "rgba(120,220,170,.30)";
      for (let i = 0; i < CW; i++) {
        if (H[i] !== 0) continue;
        const x = x0 + i * COL_W + COL_W / 2;
        g.fillRect(x, by + 14, 1, LAY_H - 24);
      }
      /* 出生点 */
      if (k === 0) {
        const sx = x0 + (lv.start.x / 48) * COL_W;
        g.fillStyle = "#9be86e";
        g.beginPath(); g.arc(sx + 4, floorY - 6, 3.4, 0, Math.PI * 2); g.fill();
      }
      /* 门 */
      if (k === N - 1 && lv.door) {
        const dx = x0 + (lv.door.x / 48) * COL_W;
        g.fillStyle = "#64e08c";
        g.fillRect(dx, floorY - 16, Math.max(4, COL_W), 16);
        g.fillStyle = "#0d1117";
        g.fillRect(dx + 2, floorY - 12, 2, 2);
      }
      /* 怪：小黄点 */
      for (const sp of lv.spawns) {
        if (sp.layer !== k) continue;
        g.fillStyle = "#ffd166";
        g.beginPath();
        g.arc(x0 + (sp.x / 48) * COL_W + COL_W / 2, floorY - 3, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    });
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, cv.toBuffer("image/png"));
  console.log("结构图 → " + OUT + "（" + panels.length + " 关）");
}

main();
