/* ===========================================================================
   2026-10-30：三种关卡目标长什么样
   ---------------------------------------------------------------------------
   一屏一张，竖排三格：破门（第 1 关）/ 寻宝（第 7 关）/ 省球（第 13 关）。

   这张图要回答两个**只能看、不能读代码**的问题：
     ① HUD 那一格（原来的「击杀」）换标签之后，还认得出这关要干嘛吗？
     ② 残球和满球在缩略图上分得开吗？（省球关第 4 颗之后裹出来的是残球）

   为什么不用断言代替：断言验的是"S.goal === 'limit'"和"weak === true"，
   验不了"玩家看一眼知不知道"。上一轮 HUD 的两行字挤在一起时，
   「任两矩形不相交」也是全绿的。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_goal-shot.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "shots");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 960, H = 600;
const PROTO = process.env.PROTO ? path.resolve(process.env.PROTO)
    : path.join(ROOT, "prototype", "snowlab.html");

/* **必须带 CJK 兜底。** `@napi-rs/canvas` 不做字形回退，等宽栈里没有中文时
   「破门」「寻宝」会渲成豆腐块 —— Chromium 会自动回退，所以只有离屏出图看得见。 */
const FONT = '"Microsoft YaHei","PingFang SC",sans-serif';

async function boot() {
    const real = createCanvas(W, H);
    const g = real.getContext("2d");
    const html = fs.readFileSync(PROTO, "utf8");
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x/" });
    const { window } = dom;
    window.devicePixelRatio = 1;
    window.HTMLCanvasElement.prototype.getContext = t => (t === "2d" ? g : null);
    window.requestAnimationFrame = () => 0;
    window.eval(m[1]);
    if (window.SNOWLAB.setOffscreen) window.SNOWLAB.setOffscreen((w, h) => createCanvas(w, h));
    try { window.SNOWLAB.setBackdrop(await loadImage(path.join(ROOT, "assets", "snowlab", "bg-surface.jpg"))); }
    catch (e) { window.SNOWLAB.setBackdrop(null); }
    try { window.SNOWLAB.setArt((await require("./_snowlab-art").loadArt()).map); } catch (e) { }
    return { L: window.SNOWLAB, S: window.SNOWLAB.S, real, g };
}

/* 造一颗球放进画面。用 `makeBallFrom`（真实入口）而不是手拼一个球对象 ——
   手拼会绕过省球关的额度判定，那这张图就变成"我造了个假的残球给你看"。 */
function dropBall(L, x, y) {
    L.makeBallFrom({ x: x, y: y, w: 30, h: 30, dead: false, hits: 0 });
    const b = L.S.balls[L.S.balls.length - 1];
    b.vx = 0; b.vy = 0;
    return b;
}

(async () => {
    const { L, S, real, g } = await boot();

    const CASES = [
        { st: 1, note: "基线：清够怪 → 门开" },
        { st: 7, note: "不要求击杀，但要横穿全图挖出金箱" },
        { st: 13, note: "只有 3 颗满球，之后裹出来的是残球" },
    ];

    const shots = [];
    for (const c of CASES) {
        L.startStage(c.st);
        /* 进关那句话会挡在画面中央，出图前把它撤掉 —— 图要拍的是常驻 HUD，
           不是那行 2.4 秒的提示。`_entry-shot.js` 也这么处理。 */
        S.texts = [];
        if (c.st === 13) {
            /* 4 颗：前 3 颗满球 + 第 4 颗残球。
               **球必须真的走 `makeBallFrom`**（额度判定在里面，手拼一个球对象
               就等于"我造了个假的残球给你看"），但**位置由这里摆** ——
               出图要的是"四颗并排能对比"，让它们自由落体只会叠成一堆。 */
            const px = L.S.p.x, py = L.S.p.y;
            const balls = [];
            for (let i = 0; i < 4; i++) balls.push(dropBall(L, px, py - 60));
            /* **横向用画面中心排，不用玩家位置排。** 玩家可能贴着左墙，
               `px - 130 + i*120` 会被 clamp 成一串重叠的点 —— 第一版就是这样，
               四颗球全挤在左边箱堆上，图上一坨。横向不滚动，所以
               世界 x 就等于屏幕 x，直接按画面宽排最稳。 */
            balls.forEach((b, i) => {
                b.x = W / 2 - 180 + i * 120;
                /* 让球底贴在这一层地面上（玩家脚下就是地面），
                   悬空会读成"球能飞"。 */
                b.y = py - b.r - 2;
                b.vx = 0; b.vy = 0;
                b.onGround = true;
            });
            S.texts = [];
        }
        L.draw();
        const cv = createCanvas(W, H);
        cv.getContext("2d").drawImage(real, 0, 0, W, H);
        const cn = L.GOAL_CN[S.goal];
        shots.push({ cv, title: `第 ${c.st} 关 · ${cn}`, note: c.note, goal: S.goal });

        /* **残球特写单独存一张 3 倍图。** 拼图缩到 66% 之后，一颗 r≈20 的球
           只剩 13px —— 那上面"脏色 vs 纯白"根本判不出来，评审的时候
           会说"看不出区别"，而实际区别是有的。这条和"断言量不出读不清"同源：
           **要验的东西必须在能读的分辨率上呈现。** */
        if (c.st === 13) {
            const pad = 26;
            const bx = W / 2 - 180 - 60 - pad, by = S.p.y - 130;
            const bw = 4 * 120 + 120 + pad * 2, bh = 150;
            const zoom = 3;
            const zc = createCanvas(bw * zoom, bh * zoom);
            const z = zc.getContext("2d");
            z.imageSmoothingEnabled = false;
            z.fillStyle = "#0B1621"; z.fillRect(0, 0, bw * zoom, bh * zoom);
            z.drawImage(real, bx, by, bw, bh, 0, 0, bw * zoom, bh * zoom);
            const zf = path.join(OUT, "snowlab-goals-balls.png");
            fs.writeFileSync(zf, zc.toBuffer("image/png"));
            console.log("  ✓ 残球特写 " + zf + "  (" + (bw * zoom) + "×" + (bh * zoom) + ")");
        }

        console.log(`  ✓ 第 ${c.st} 关 · ${S.goal} · ${c.note}`);
    }

    /* ---- 竖排拼图 ---- */
    const TITLE = 46;
    const PAD = 14;
    const SW = Math.round(W * 0.66);
    const SH = Math.round(H * 0.66);
    const outW = SW + PAD * 2;
    const outH = (TITLE + SH) * shots.length + PAD * 2;
    const out = createCanvas(outW, outH);
    const o = out.getContext("2d");
    o.fillStyle = "#0B1621";
    o.fillRect(0, 0, outW, outH);

    shots.forEach((s, i) => {
        const y0 = PAD + i * (TITLE + SH);
        o.fillStyle = "#132433";
        o.fillRect(PAD, y0, SW, TITLE);
        o.fillStyle = "#EAF4F8";
        o.font = `700 22px ${FONT}`;
        o.textBaseline = "middle";
        o.fillText(s.title, PAD + 14, y0 + TITLE / 2);
        o.fillStyle = "#8FA8B8";
        o.font = `400 14px ${FONT}`;
        const tw = o.measureText(s.title).width;
        o.fillText(s.note, PAD + 14 + tw + 16, y0 + TITLE / 2 + 1);
        o.drawImage(s.cv, PAD, y0 + TITLE, SW, SH);
        o.strokeStyle = "#1E3346";
        o.lineWidth = 1;
        o.strokeRect(PAD + 0.5, y0 + TITLE + 0.5, SW - 1, SH - 1);
    });

    const file = path.join(OUT, "snowlab-goals.png");
    fs.writeFileSync(file, out.toBuffer("image/png"));
    console.log("\n出图 " + file + "  (" + outW + "×" + outH + ")");
})().catch(e => { console.error(e); process.exit(1); });
