/* ===========================================================================
   关卡曲线：48 关的层数 / 骨架 / 目标排班
   ---------------------------------------------------------------------------
   用户 2026-10-30 晚：「这个战斗内容 不应该是递进吗 一开始是 1 层 2 层 3 层
   等等 不应该是关卡递进原则吗 现在各个关卡大同小异啊」

   这句话里有三个断言，必须分开验，不能混成一句"我改了"：
     ① 层数是不是**单调递进**（1→6，不是 2/3/3/4/4/5/5 那种半段停滞）；
     ② 骨架是不是**每轮换起手**（原来 (n-1)%6，第 7 关和第 1 关一模一样）；
     ③ 目标是不是**错开**（6 关一换，不能和骨架同时变）。

   所以这张图不是截图，是**排班表**：三段横轴都是同一批 48 个关号，
   任何一条要是在某段平掉，玩家就会在那一段觉得"又是这一关"。
   截图只能证明"某两关长得不同"，证明不了"没有哪一段是平的"。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_ladder-shot.js
   =========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const FONT = "Microsoft YaHei, PingFang SC, sans-serif";
const PROTO = path.join(ROOT, "prototype", "snowlab.html");

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

const SK_COLOR = {
  shaft: "#4A7FB5", zigzag: "#C9752E", hub: "#5E9C6B",
  wall: "#9B5E8A", helix: "#C2A23A", twin: "#6E7B8B",
};

(async () => {
  const L = await boot();
  const rows = [];
  for (let n = 1; n <= 48; n++) {
    const g = L.genLevel(L.stageSeed(n), n);
    const holes = (g.layers || []).reduce((a, l) => a + ((l.holes || []).length), 0);
    rows.push({
      n, floors: g.nFloors, skel: g.skel, goal: L.goalOf(n),
      boxes: g.boxes.length, holes, nests: (g.nests || []).length,
      quota: (g.nests || []).reduce((a, x) => a + (x.left || 0), 0),
    });
  }

  /* **图例统一横排在最上面**（2026-10-30 第一版把图例竖着挤在 46px 高的
     条带左边：6 个骨架名最窄排到 5.6px 行距，全叠在一起看不出来）。
     左边只留"层数/骨架/目标"三个词，颜色对照交给顶部两行。 */
  const PAD = 26, LEFT = 64, RIGHT = 30, TOP = 172;
  const COLW = 21;                      // 每关一列
  const BAND_H = 46, GAP = 22;
  const W = LEFT + COLW * 48 + RIGHT;
  const H = TOP + BAND_H * 3 + GAP * 4 + 64;
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  g.fillStyle = "#FFFDF8"; g.fillRect(0, 0, W, H);
  g.font = "bold 22px " + FONT; g.fillStyle = "#1B2430";
  g.fillText("48 关的排班：层数 / 骨架 / 目标", PAD, 40);
  g.font = "13px " + FONT; g.fillStyle = "#5B6B7B";
  g.fillText("三条横轴用的是同一批关号。任何一段平掉，玩家在那一段就会觉得「又是这一关」。", PAD, 64);
  g.fillStyle = "#E05A2B";
  g.fillText("现在层数 1→6 单调（1-3 关只有一层、没有洞）；骨架每轮换起手；目标 6 关一换。", PAD, 86);

  /* 图例：一行骨架、一行目标，横排。 */
  {
    const names = Object.keys(SK_COLOR);
    const GN = { door: "破门", collect: "寻宝", limit: "省球" };
    const GC = { door: "#3E7C5A", collect: "#C9A227", limit: "#9B4B5E" };
    let x = PAD;
    g.font = "11px " + FONT;
    g.fillStyle = "#8A97A5"; g.fillText("骨架", x, 110); x += 34;
    for (const nm of names) {
      g.fillStyle = SK_COLOR[nm]; g.fillRect(x, 102, 10, 10);
      g.fillStyle = "#4A5866"; g.fillText(nm, x + 14, 111); x += 14 + g.measureText(nm).width + 14;
    }
    x = PAD;
    g.fillStyle = "#8A97A5"; g.fillText("目标", x, 132); x += 34;
    for (const k of Object.keys(GN)) {
      g.fillStyle = GC[k]; g.fillRect(x, 124, 10, 10);
      g.fillStyle = "#4A5866"; g.fillText(GN[k], x + 14, 133); x += 14 + g.measureText(GN[k]).width + 16;
    }
  }

  const x0 = i => LEFT + i * COLW;
  const bandTop = k => TOP + k * (BAND_H + GAP);

  /* ---- ① 层数 ---- */
  {
    const top = bandTop(0);
    g.font = "bold 13px " + FONT; g.fillStyle = "#1B2430";
    g.fillText("层数", PAD, top + 16);
    const maxF = 6, uh = (BAND_H - 6) / maxF;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const cm = ["#CFE3F5", "#AFCFEA", "#8FBBDF", "#6BA3D2", "#4A7FB5", "#2E5C8A"][r.floors - 1];
      for (let f = 0; f < r.floors; f++) {
        g.fillStyle = cm;
        g.fillRect(x0(i) + 1, top + BAND_H - (f + 1) * uh, COLW - 2, uh - 1);
      }
      g.fillStyle = "#7A8896"; g.font = "10px " + FONT;
      if (r.floors === 1) g.fillText("1", x0(i) + 7, top + BAND_H - 8);
    }
    /* 层数变化的竖线（让"哪一关加层"可读） */
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].floors !== rows[i - 1].floors) {
        g.strokeStyle = "#E05A2B"; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x0(i), top - 4); g.lineTo(x0(i), top + BAND_H + 4); g.stroke();
        g.fillStyle = "#E05A2B"; g.font = "bold 10px " + FONT;
        g.fillText(rows[i].floors + "层", x0(i) + 2, top - 8);
      }
    }
  }

  /* ---- ② 骨架（拉丁方） ---- */
  {
    const top = bandTop(1);
    const names = Object.keys(SK_COLOR);
    g.font = "bold 13px " + FONT; g.fillStyle = "#1B2430";
    g.fillText("骨架", PAD, top + 16);
    const rowH = (BAND_H - 8) / names.length;
    for (let i = 0; i < rows.length; i++) {
      const ri = names.indexOf(rows[i].skel);
      g.fillStyle = SK_COLOR[rows[i].skel];
      g.fillRect(x0(i) + 1, top + 4 + ri * rowH, COLW - 2, rowH - 1.5);
    }
    /* 每 6 关一轮的分隔线 */
    for (let r = 1; r <= 8; r++) {
      const x = x0(r * 6 - 1) + COLW;
      g.strokeStyle = "rgba(27,36,48,.18)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, top - 2); g.lineTo(x, top + BAND_H + 2); g.stroke();
    }
  }

  /* ---- ③ 目标 ---- */
  {
    const top = bandTop(2);
    const GC = { door: "#3E7C5A", collect: "#C9A227", limit: "#9B4B5E" };
    const GN = { door: "破门", collect: "寻宝", limit: "省球" };
    g.font = "bold 13px " + FONT; g.fillStyle = "#1B2430";
    g.fillText("目标", PAD, top + 16);
    for (let i = 0; i < rows.length; i++) {
      g.fillStyle = GC[rows[i].goal];
      g.fillRect(x0(i) + 1, top + 8, COLW - 2, BAND_H - 16);
    }
  }

  /* ---- 关号刻度 ---- */
  {
    const y = bandTop(2) + BAND_H + 14;
    g.font = "10px " + FONT; g.fillStyle = "#8A97A5";
    for (let i = 0; i < 48; i++) {
      const n = i + 1;
      if (n === 1 || n % 6 === 0) g.fillText(String(n), x0(i) + 4, y);
    }
  }

  /* ---- 底部：一段话讲清"合起来发生了什么" ---- */
  {
    const y = H - 34;
    g.font = "12.5px " + FONT; g.fillStyle = "#4A5866";
    const seq = [...new Set(rows.map(r => r.floors))].join("→");
    const firstRound = rows.slice(0, 6).map(r => r.skel).join(" ");
    const secondRound = rows.slice(6, 12).map(r => r.skel).join(" ");
    g.fillText("层数 " + seq + "（第 1 关单层无洞）    第 1 轮骨架：" + firstRound, PAD, y);
    g.fillText("第 2 轮骨架：" + secondRound + "    —— 每轮起手都不一样，所以「第 7 关」不是「第 1 关 + 一层」。", PAD, y + 20);
  }

  const out = path.join(OUT, "ladder-48.png");
  fs.writeFileSync(out, cv.toBuffer("image/png"));
  console.log("出图 " + out);
  console.log("层数序列 " + [...new Set(rows.map(r => r.floors))].join("→"));
  console.log("目标分布 " + JSON.stringify(rows.reduce((a, r) => (a[r.goal] = (a[r.goal] || 0) + 1, a), {})));
})();
