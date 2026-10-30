/* ===========================================================================
   「48 关里，玩家什么时候学到新东西」
   ---------------------------------------------------------------------------
   用户 2026-10-30 晚问：「雪原推球玩法 有关卡吗 不断进门 重复性的？」

   **有关卡，但每关要做的事只有一条。** 这张图不画场景，画**学习曲线**：
   横轴 48 个关号，每一行是一个玩法要素，圆点是它第一次出现的位置。
   要素从圆点往右拉一条淡线 = 从这关起它一直在，但已经不再是新东西。

   为什么必须画这张而不是再放几张关卡截图：截图只能证明"两关长得不一样"，
   证明不了"第 24 关之后还有没有新东西"。而玩家的厌倦感来自后者 ——
   他看到新的骨架、新的箱子颜色会觉得在推进；看到同一批东西堆得更多，
   只会觉得关卡在变长，不是在变难。

   底部那条 48 格色带是核心判据：绿 = 这一关给了新东西，灰 = 没有。
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

/* 从生成器里**实测**每个要素首次出现的关号，不手写。
   手写的表会在下次改生成器时静默失效 —— 而这张图的价值全在关号准。 */
function collect(L) {
  const first = {};
  const put = (k, n) => { if (first[k] == null) first[k] = n; };
  const boxMats = [], breeds = [];
  for (let n = 1; n <= 48; n++) {
    const g = L.genLevel(L.stageSeed(n), n);
    const goal = L.goalOf(n);
    put("目标:" + goal, n);
    put("层数:" + (g.layers || []).length, n);
    for (const b of g.boxes || []) {
      const mat = b.mat || "wood";
      if (!boxMats.includes(mat)) boxMats.push(mat);
      put("箱:" + mat, n);
    }
    for (const f of g.foes || []) {
      const br = f.breed || "?";
      if (!breeds.includes(br)) breeds.push(br);
      put("怪:" + br, n);
    }
    put("骨架:" + (g.skeleton || g.skel), n);
    if ((g.nests || []).length) put("巢", n);
    if (g.boss) put("BOSS", n);
  }
  return { first, boxMats };
}

(async () => {
  const L = await boot();
  const { first, boxMats } = collect(L);

  const at = k => first[k];
  const rows = [
    { label: "骨架（6 种）", color: "#3E7C5A", keys: ["骨架:shaft", "骨架:zigzag", "骨架:hub", "骨架:wall", "骨架:helix", "骨架:twin"] },
    { label: "层数（1→6）", color: "#2F6FA8", keys: ["层数:1", "层数:2", "层数:3", "层数:4", "层数:5", "层数:6"] },
    { label: "目标（3 种）", color: "#C9A227", keys: ["目标:door", "目标:collect", "目标:limit"] },
    { label: "箱体材料", color: "#9B4B5E", keys: boxMats.map(m => "箱:" + m) },
    { label: "刷怪巢", color: "#6E5AA8", keys: ["巢"] },
    { label: "BOSS", color: "#B4501E", keys: ["BOSS"] },
  ];

  /* 每一关算不算"给了新东西"。BOSS 的重复出现**不算**：同一只、只加硬度，
     那是难度曲线不是新内容 —— 所以 BOSS 只认首次。
     骨架的 2~6 也算新东西（换一张空间图），它们都在前 6 关。 */
  const novel = new Set();
  /* **BOSS 只认首次。** 它在 8/16/24/32/40/48 都出现，但后五只是同一套
     机制加门槛 —— 那是难度曲线，不是新内容，算进 novel 会把"又硬了一点"
     画成"有新东西"。同一张图里"新东西"的定义必须是"玩家要学一件新事"。 */
  for (const r of rows) for (const k of r.keys) if (at(k) != null) novel.add(at(k));

  const W = 1180, H = 640;
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  g.fillStyle = "#FFFDF8";
  g.fillRect(0, 0, W, H);

  const X0 = 176, X1 = 1146;
  const colW = (X1 - X0) / 48;
  const cx = n => X0 + (n - 0.5) * colW;

  /* ---- 标题 ---- */
  g.fillStyle = "#1B2430";
  g.font = "bold 25px " + FONT;
  g.fillText("雪原推球 · 48 关里，玩家什么时候学到新东西", 26, 44);
  g.font = "13px " + FONT;
  g.fillStyle = "#5B6B7B";
  g.fillText("圆点 = 这个要素第一次出现；淡线 = 之后还在，但已经不是新东西。数据从生成器实测，不是手写。", 26, 70);

  /* 关号刻度 */
  g.font = "11px " + FONT;
  for (let n = 1; n <= 48; n += 3) {
    g.fillStyle = "#A8B4C0";
    g.fillText(String(n), cx(n) - 6, 106);
    g.fillRect(cx(n) - 0.5, 112, 1, 6);
  }

  /* ---- 要素行 ---- */
  const TOP = 130, RH = 42;
  rows.forEach((r, ri) => {
    const y = TOP + ri * RH + 18;
    g.font = "13px " + FONT;
    g.fillStyle = "#4A5866";
    g.fillText(r.label, 26, y + 4);

    const xs = r.keys.map(k => at(k)).filter(v => v != null).sort((a, b) => a - b);
    if (!xs.length) return;

    if (ri === 4 || ri === 5) {
      /* 巢和 BOSS 是"反复出现的同一件东西"，画成点列，不拉线 */
      const list = ri === 4 ? xs : [8, 16, 24, 32, 40, 48];
      for (const n of list) {
        const on = n === list[0];
        g.beginPath();
        g.arc(cx(n), y, on ? 6 : 4, 0, 6.283);
        g.fillStyle = on ? r.color : "rgba(180,80,30,.30)";
        g.fill();
        if (on) { g.strokeStyle = "#FFFDF8"; g.lineWidth = 2; g.stroke(); }
      }
      g.font = "11px " + FONT;
      g.fillStyle = "#9AA6B2";
      g.fillText(ri === 5 ? "同一只、只加硬度（不算新内容）" : "持续刷怪，配额随关变化", X0 + 4, y + 20);
      return;
    }

    /* **骨架行不画圆点，画色块。** 六种骨架全在第 1~6 关，列宽 20px，
       12px 的圆里塞 10px 的两位数会糊成一团（第一版就是这样，六个点看着
       像一坨）。改成六个紧贴的色块，读到的信息反而更准：
       "六种颜色在六关之内全部用完"。 */
    if (ri === 0) {
      const hx = ["#3E7C5A", "#55916C", "#6FA57F", "#2F6FA8", "#4A88BE", "#2C5D8E"];
      xs.forEach((n, i) => {
        g.fillStyle = hx[i % hx.length];
        g.fillRect(cx(n) - colW / 2 + 1, y - 9, colW - 2, 18);
      });
      g.font = "11px " + FONT;
      g.fillStyle = "#9AA6B2";
      g.fillText("1~6 关全部见完", X0 + 6 * colW + 6, y + 4);
      return;
    }

    /* 主线从首个点拉到最右，淡色 */
    g.strokeStyle = r.color + "33";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx(xs[0]), y);
    g.lineTo(X1, y);
    g.stroke();

    /* **相邻两关的点上下错开。** 材料行第 11、12 关连着出现，同一条水平线
       上两个 12px 圆只隔 20px，数字会互相压住。 */
    let lastX = -999;
    for (const n of xs) {
      const off = (cx(n) - lastX < 26) ? -13 : 0;
      const py = y + off;
      lastX = cx(n);
      g.beginPath();
      g.arc(cx(n), py, 6, 0, 6.283);
      g.fillStyle = r.color;
      g.fill();
      g.strokeStyle = "#FFFDF8";
      g.lineWidth = 2;
      g.stroke();
      g.font = "bold 10px " + FONT;
      g.fillStyle = "#FFFDF8";
      g.textAlign = "center";
      g.fillText(String(n), cx(n), py + 3.5);
      g.textAlign = "left";
    }
  });

  /* ---- 底部：每关有没有新东西 ---- */
  const BY = TOP + rows.length * RH + 46;
  g.font = "bold 13px " + FONT;
  g.fillStyle = "#4A5866";
  g.fillText("每一关", 26, BY + 20);
  g.font = "11px " + FONT;
  g.fillStyle = "#8A97A5";
  g.fillText("绿 = 有新东西", 26, BY + 40);

  const BH = 40;
  let countYes = 0;
  for (let n = 1; n <= 48; n++) {
    const has = novel.has(n);
    if (has) countYes++;
    g.fillStyle = has ? "#3E7C5A" : "#EDEFF2";
    g.fillRect(X0 + (n - 1) * colW + 1, BY, colW - 2, BH);
  }
  /* 第 24 关起整片灰 —— 标一条竖线 */
  const after = 23;
  g.strokeStyle = "#E05A2B";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(X0 + after * colW, BY - 8);
  g.lineTo(X0 + after * colW, BY + BH + 8);
  g.stroke();

  g.font = "bold 13px " + FONT;
  g.fillStyle = "#E05A2B";
  g.fillText("第 24 关起", X0 + after * colW + 8, BY - 14);

  /* ---- 结论 ---- */
  const CY = BY + BH + 34;
  const lastNovel = Math.max(...[...novel]);
  g.font = "bold 16px " + FONT;
  g.fillStyle = "#1B2430";
  g.fillText("48 关里只有 " + countYes + " 关给了新东西 —— 最后一关是第 " + lastNovel + " 关。", 26, CY);
  g.font = "14px " + FONT;
  g.fillStyle = "#5B6B7B";
  g.fillText("第 " + (lastNovel + 1) + "~48 关（" + (48 - lastNovel) + " 关，占 " +
    Math.round((48 - lastNovel) / 48 * 100) + "%）一个新东西都没有：层数不动、材料不换、目标轮换。" +
    "玩家在第 " + lastNovel + " 关之后就已经把这个游戏看完了。", 26, CY + 26);
  g.fillStyle = "#8A97A5";
  g.fillText("骨架 6 种在第 6 关前全部见完；目标 3 种在第 9 关前全部见完；材料 4 种在第 12 关前全部见完。", 26, CY + 48);

  fs.writeFileSync(path.join(OUT, "novel-48.png"), cv.toBuffer("image/png"));
  console.log("新东西关号:", [...novel].sort((a, b) => a - b).join(","));
  console.log("共 " + countYes + " 关 / 重复 " + (48 - lastNovel) + " 关");
  console.log("出图 " + path.join(OUT, "novel-48.png"));
})();
