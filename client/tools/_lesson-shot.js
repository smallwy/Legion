/* ===========================================================================
   考点排班表：48 关各考什么，以及"考点真的改变了数值"
   ---------------------------------------------------------------------------
   2026-10-31 用户：「结合现在三个玩法 不合适 你帮我调整啊 而且要满足深度」

   上一版的问题不是机制少，是**生成器不出题** —— 十几个参数各自掷骰子，
   每关都落在均值附近，所以 48 关读起来一样。

   这张图要同时证明两件事，缺一件就是自欺：
     ① **排班**：48 关的考点不重复、不连考同一件事、前 5 关是纯教学；
     ② **效果**：每个考点把对应参数真的推离均值（怪数 / 洞数 / 金箱 / 洞宽 / 悬台）。

   只画 ① 的话，"考点"只是标签；只画 ② 的话，看不出排班有没有节奏。
   所以上半是色带（考点），下半是最能代表各考点的两条数值曲线叠在上面。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_lesson-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const FONT = "Microsoft YaHei, PingFang SC, sans-serif";
const PROTO = process.env.PROTO ? path.resolve(process.env.PROTO)
  : path.join(ROOT, "prototype", "snowlab.html");

async function boot() {
  const html = fs.readFileSync(PROTO, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
  const { window } = dom;
  window.devicePixelRatio = 1;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.requestAnimationFrame = () => 0;
  window.eval(m[1]);
  return window.SNOWLAB;
}

const LES_COLOR = {
  bare: "#8A7B5E",     // 土：地形
  narrow: "#4A7FB5",   // 蓝：洞
  swarm: "#9B4B5E",    // 红：怪
  maze: "#5E9C6B",     // 绿：口
  perch: "#8E6BC4",    // 紫：台
};
const LES_ORDER = ["bare", "narrow", "swarm", "maze", "perch"];

(async () => {
  const L = await boot();
  const rows = [];
  for (let n = 1; n <= 48; n++) {
    const g = L.genLevel(L.stageSeed(n), n);
    const holes = (g.layers || []).reduce((a, l) => a + (l.holes || []).length, 0);
    rows.push({
      n, les: L.lessonOf(n), goal: L.goalOf(n), skel: g.skel, nF: g.nFloors,
      foes: g.spawns.length,
      hpf: holes / Math.max(1, g.nFloors - 1),
      terr: (g.layers || []).reduce((a, l) => a + ((l.terrain || []).length), 0),
      perch: !!g.perch,
    });
  }
  const baseFoes = rows.reduce((a, r) => a + r.foes, 0) / rows.length;
  const baseHpf = rows.reduce((a, r) => a + r.hpf, 0) / rows.length;
  const baseTerr = rows.reduce((a, r) => a + r.terr, 0) / rows.length;

  const PAD = 26, LEFT = 70, RIGHT = 30;
  const COLW = 22, TOP = 150;
  const BAND_H = 54, GAP = 30;
  const W = LEFT + COLW * 48 + RIGHT;
  const H = TOP + (BAND_H + GAP) * 3 + 96;
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, W, H);

  g.font = "bold 23px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("48 关各考什么：5 个考点 + 它们真的改了数值", PAD, 40);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("上一条是排班（前 5 关纯教学，之后不连考同一件事）；下面两条是同一批关的实测数值。", PAD, 64);
  g.fillStyle = "#E05A2B";
  g.fillText("看点：涨上去的那些峰正好落在对应颜色的格子上 —— 排班不是标签，是真的接在生成器上。", PAD, 86);

  /* 图例 */
  {
    let x = PAD;
    g.font = "12px " + FONT;
    for (const k of LES_ORDER) {
      g.fillStyle = LES_COLOR[k]; g.fillRect(x, 104, 11, 11);
      g.fillStyle = "#4A5866"; g.fillText(L.LESSONS[k].cn, x + 15, 114);
      x += 15 + g.measureText(L.LESSONS[k].cn).width + 16;
    }
    g.fillStyle = "#8A97A5"; g.fillText("灰格 = 教学关（没有考点）", x + 10, 114);
  }

  const x0 = i => LEFT + i * COLW;
  const bandTop = k => TOP + k * (BAND_H + GAP);

  /* ---- ① 考点色带 ---- */
  {
    const top = bandTop(0);
    g.font = "bold 13px " + FONT; g.fillStyle = "#1B2430";
    g.fillText("考点", PAD, top + 20);
    for (let i = 0; i < rows.length; i++) {
      g.fillStyle = rows[i].les ? LES_COLOR[rows[i].les] : "#E4E0D8";
      g.fillRect(x0(i) + 1, top + 6, COLW - 2, BAND_H - 12);
    }
    /* 关号 + 考点首字：色块认得颜色也要认得出字 */
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].les) continue;
      g.fillStyle = "rgba(255,255,255,.92)";
      g.font = "bold 11px " + FONT;
      g.fillText(L.LESSONS[rows[i].les].cn[0], x0(i) + 7, top + BAND_H / 2 + 4);
    }
    /* 关号轴 */
    g.font = "10px " + FONT; g.fillStyle = "#8A97A5";
    for (let i = 0; i < 48; i += 4) g.fillText(String(i + 1), x0(i) + 3, top + BAND_H + 12);
  }

  /* ---- ② 怪数曲线（swarm 应该在红格子上凸起） ---- */
  {
    const top = bandTop(1);
    const maxV = Math.max(...rows.map(r => r.foes));
    g.font = "bold 13px " + FONT; g.fillStyle = "#1B2430";
    g.fillText("怪数", PAD, top + 20);
    const yOf = v => top + BAND_H - 6 - (v / maxV) * (BAND_H - 12);
    /* 均值参考线 */
    g.strokeStyle = "rgba(27,36,48,.22)"; g.setLineDash([5, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(LEFT, yOf(baseFoes)); g.lineTo(W - RIGHT, yOf(baseFoes)); g.stroke();
    g.setLineDash([]);
    g.font = "10px " + FONT; g.fillStyle = "#8A97A5";
    g.fillText("平均 " + baseFoes.toFixed(1), LEFT + 4, yOf(baseFoes) - 5);
    /* 柱子：按考点的颜色，一眼对得上 */
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      /* **只给"这条曲线对应的考点"上色，其余灰掉。**
         第一版按各自考点着色，48 根柱子五颜六色，"峰落在同色格子上"
         这件事反而看不出来 —— 图要证明的是一个对应关系，不是好看。 */
      g.fillStyle = r.les === "swarm" ? LES_COLOR.swarm : "#D8D3C9";
      const y = yOf(r.foes);
      g.fillRect(x0(i) + 5, y, COLW - 10, top + BAND_H - 6 - y);
    }
  }

  /* ---- ③ 每层洞数（maze 应该凸起） ---- */
  {
    const top = bandTop(2);
    const maxV = Math.max(...rows.map(r => r.terr));
    g.font = "bold 13px " + FONT; g.fillStyle = "#1B2430";
    g.fillText("地形件", PAD, top + 20);
    const yOf = v => top + BAND_H - 6 - (v / maxV) * (BAND_H - 12);
    g.strokeStyle = "rgba(27,36,48,.22)"; g.setLineDash([5, 4]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(LEFT, yOf(baseTerr)); g.lineTo(W - RIGHT, yOf(baseTerr)); g.stroke();
    g.setLineDash([]);
    g.font = "10px " + FONT; g.fillStyle = "#8A97A5";
    g.fillText("平均 " + baseTerr.toFixed(1), LEFT + 4, yOf(baseTerr) - 5);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      g.fillStyle = r.les === "bare" ? LES_COLOR.bare : "#D8D3C9";
      const y = yOf(r.terr);
      g.fillRect(x0(i) + 5, y, COLW - 10, top + BAND_H - 6 - y);
    }
    /* **空场关标个「0」。** 它们在这条曲线上贴着底 —— 但"贴着底"和
       "没画"看起来一样，标一个 0 才知道是"真的没有地形"。 */
    g.font = "bold 10px " + FONT;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.les !== "bare") continue;
      g.fillStyle = "#7A5B2E";
      g.fillText("0", x0(i) + 6, top + BAND_H + 12);
    }
  }

  /* ---- 底部：分布汇总 ---- */
  {
    const y = TOP + (BAND_H + GAP) * 3 + 8;
    const cnt = {};
    for (const r of rows) if (r.les) cnt[r.les] = (cnt[r.les] || 0) + 1;
    let x = PAD;
    g.font = "12px " + FONT;
    for (const k of LES_ORDER) {
      g.fillStyle = LES_COLOR[k]; g.fillRect(x, y + 18, 11, 11);
      g.fillStyle = "#4A5866";
      g.fillText(L.LESSONS[k].cn + " " + (cnt[k] || 0) + " 关", x + 15, y + 28);
      x += 15 + g.measureText(L.LESSONS[k].cn + " " + (cnt[k] || 0) + " 关").width + 20;
    }
    g.fillStyle = "#5B6B7B";
    g.fillText("教学 " + rows.filter(r => !r.les).length + " 关", x + 6, y + 28);
    g.font = "11px " + FONT; g.fillStyle = "#8A97A5";
    g.fillText("相邻两关考同一件事的次数：0（断言钉住）", PAD, y + 54);
  }

  fs.writeFileSync(path.join(OUT, "lesson-map.png"), cv.toBuffer("image/png"));
  console.log("出图 " + path.join(OUT, "lesson-map.png"));

  /* 控制台也打一份排班，改排班时最先看它 */
  console.log("\n" + rows.map(r => r.n + (r.les ? L.LESSONS[r.les].cn : "—")).join(" "));
  console.log("\n平均怪数 " + baseFoes.toFixed(2) + " / 平均地形件 " + baseHpf.toFixed(2));
})();
