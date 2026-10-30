/* ===========================================================================
   2026-10-30：球与球 —— "撞"和"合"长什么样
   ---------------------------------------------------------------------------
   一屏两行，每行四帧的时间序列：

     第一行（撞）：一颗快球从左边追上静止的球 → 接触 → 动量传过去，
                   前面那颗被打出去、后面那颗几乎停住。
     第二行（合）：两颗慢球贴在一起 → 计时 → 合成一颗更大的，
                   位置往大的那边偏（面积加权，不是取中点）。

   为什么必须出图：断言只能问"vx 变了多少""活球剩几颗"，
   问不出"玩家看不看得出这是在撞、还是在合"。
   上一轮残球靠透明度区分时，断言全绿而缩略图上和满球一模一样 ——
   同一类错误只会在图上露出来。

   跑法：
     NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
     node client/tools/_pairs-shot.js
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

/* **必须带 CJK 兜底。** @napi-rs/canvas 不做字形回退，
   等宽栈里没有中文时标注会渲成豆腐块，而 Chromium 会自动回退 ——
   所以只有离屏出图看得见。 */
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
    return { L: window.SNOWLAB, real };
}

/** 把一颗球放到指定 x、**贴在地面上**（y 是球心，球底 = y + r）。 */
function place(L, x, vx, absorb, weak) {
    const S = L.S;
    L.makeBallFrom({ x: x, y: 120, w: 30, h: 30, dead: false, hits: 0 });
    const b = S.balls[S.balls.length - 1];
    /* 吸收量直接改：makeBallFrom 固定给 1，而这里要摆出"两颗一样大"
       和"两颗都满"的对比，靠多吃几只怪做不到这么干净。 */
    b.absorbed = absorb;
    b.r = L.ballR(absorb);
    b.weak = !!weak;
    /* **贴到玩家脚下那一层的地面。** 第一版在这里从 yy=0 往下扫
       `groundAt`，结果第一个采样点就满足 `t > yy + 4`（地面在 538、
       采样在 0），gy 直接取 0 —— 两颗球被放到 y=-33 的天上，
       间距 130 永远碰不到，而"撞"那一行看起来只是"两颗球没动"。
       玩家的脚底就是这一层的地面，直接用它，不要自己扫。 */
    const gy = S.p ? (S.p.y + S.p.h) : 538;
    b.y = gy - b.r;
    b.vx = vx; b.vy = 0; b.onGround = true; b.life = L.NUM.ball.life;
    S.texts = [];
    return b;
}

function clear(L) {
    L.S.balls.length = 0;
    L.S.texts = [];
    L.S.frags.length = 0;
}

/** 跑 n 帧球物理。**必须同时跑 stepBalls** —— 位置积分（vx*dt、摩擦、
    落地、撞墙）全在它里面，只跑 stepBallPairs 的话两颗球是"冻住的"，
    摆在那儿互相看着，一帧都不会靠近。第一版就是这么写的，
    出图前完全没意识到：断言组里手动调 stepBallPairs 是对的（它只测碰撞），
    但"演示球滚过去撞上"必须走完整物理。
    不跑整局 step()：那会刷怪、掉箱子、镜头自己动，四帧之间地形就变了。 */
function tick(L, n) {
    const S = L.S;
    for (let i = 0; i < n; i++) {
        for (const b of S.balls) {
            if (b.dead) continue;
            b.x += b.vx / 60;
            b.y += b.vy / 60;
            /* **只夹墙，不走重力/摩擦/箱子。** 走 stepBalls 的话 15 帧里
               球会掉洞、撞箱、贴坡 —— 四格拼图就对不上了，而且第 25 关
               地表本来就有洞（第一版出图就是"两颗球都不见了"）。
               这张图要证的是"碰撞把动量传过去"，不是"球能滚多远"。 */
            const lo = 26 + b.r, hi = 934 - b.r;
            if (b.x < lo) { b.x = lo; b.vx = Math.abs(b.vx) * 0.5; }
            if (b.x > hi) { b.x = hi; b.vx = -Math.abs(b.vx) * 0.5; }
        }
        L.stepBallPairs(1 / 60);
    }
    S.texts = [];            // 飘字在拼图里会糊成一片
}

/* 拍一帧，**裁到球附近再放大**。
   整关一张图里雪球只有 33px，缩到 320 宽的格子里剩 11px —— 撞没撞、
   合成没合成都看不出来，等于没出图。
   镜头只做 y 平移（x 固定 960 宽），所以屏幕坐标 = (世界 x, 世界 y - cam.y)。 */
const CROP_W = 380, CROP_H = 172;
function grab(L, real, wx, wy) {
    L.draw();
    const sx = Math.max(0, Math.min(W - CROP_W, wx - CROP_W / 2));
    const sy = Math.max(0, Math.min(H - CROP_H, wy - L.S.cam.y - CROP_H / 2));
    const cv = createCanvas(CROP_W, CROP_H);
    cv.getContext("2d").drawImage(real, sx, sy, CROP_W, CROP_H, 0, 0, CROP_W, CROP_H);
    return cv;
}
/** 两颗球的屏幕中点（用来决定裁哪儿）。 */
function midY(L) {
    const live = L.S.balls.filter(b => !b.dead);
    if (!live.length) return 300;
    return live.reduce((a, b) => a + b.y, 0) / live.length;
}
/** 用**外接框中点**而不是平均位置：两颗球拉开之后，平均值会被拖向中间，
   裁剪框跟着跑，最后把被撞出去那颗切掉一半 —— 而那正是这张图要证的东西。 */
function midX(L) {
    const live = L.S.balls.filter(b => !b.dead);
    if (!live.length) return 480;
    let lo = Infinity, hi = -Infinity;
    for (const b of live) { lo = Math.min(lo, b.x - b.r); hi = Math.max(hi, b.x + b.r); }
    return (lo + hi) / 2;
}

(async () => {
    const { L, real } = await boot();

    /* 挑一关地形平坦的（第 25 关：8 层、地面连续），不然球会掉进洞里，
       四帧拍下来只剩"球不见了"。 */
    L.startStage(25);
    const S = L.S;
    /* 镜头锁到最底层：这两颗球都在地表，不锁的话画面在下层，
       球在视野外 —— 出图会得到一张"什么都没有"的图。 */
    S.cam.y = Math.max(0, S.cam.y);

    const rows = [];

    /* ---------------- 第一行：撞 ---------------- */
    clear(L);
    const groundY = (() => {
        const probe = place(L, 380, 0, 4, false);
        return probe.y + probe.r;
    })();
    clear(L);
    /* 初速 420 而不是推球满速 1209：满速一帧走 20px，接触那一下会在
       两帧之间跳过去，拼图上只剩"没碰"和"已经分开"。420 一帧 7px，
       接触前后各留得下一帧。 */
    const A = place(L, 220, 420, 4, false);      // 快球，从左边追上来
    const B = place(L, 340, 0, 4, false);        // 慢球，等着挨撞
    const hit = [];
    hit.push({ cv: grab(L, real, midX(L), midY(L)),
               note: "① 左球 " + Math.round(A.vx) + " 追上来，右球 " + Math.round(B.vx) });
    /* 快球一帧走 16px，130px 的间距约 8 帧追上；逐帧跑到重叠为止。 */
    let contact = -1;
    for (let f = 0; f < 20; f++) {
        tick(L, 1);
        const d = Math.hypot(B.x - A.x, B.y - A.y);
        if (contact < 0 && d < A.r + B.r + 2) { contact = f; break; }
    }
    hit.push({ cv: grab(L, real, midX(L), midY(L)), note: "② 接触（第 " + (contact + 1) + " 帧）" });
    tick(L, 1);
    hit.push({ cv: grab(L, real, midX(L), midY(L)), note: "③ 冲量过去：右球 vx=" + Math.round(B.vx) });
    tick(L, 14);
    hit.push({ cv: grab(L, real, midX(L), midY(L)), note: "④ 右球被打出去（vx=" + Math.round(B.vx) +
              "，左球 " + Math.round(A.vx) + "）" });
    rows.push({ title: "撞 · 快球把动量传给慢球（后面那颗几乎停住）", cells: hit,
                vx: [Math.round(A.vx), Math.round(B.vx)] });

    /* ---------------- 第二行：合 ---------------- */
    clear(L);
    const C = place(L, 400, 0, 2, false);
    const D = place(L, 428, 0, 2, false);
    const fuse = [];
    fuse.push({ cv: grab(L, real, midX(L), midY(L)), note: "① 两颗慢球贴住（都 vx=0）" });
    tick(L, Math.floor(L.NUM.ball.fuseHold * 60 * 0.5));
    fuse.push({ cv: grab(L, real, midX(L), midY(L)), note: "② 贴了 " + (L.NUM.ball.fuseHold * 0.5).toFixed(2) +
              "s，还没合（反悔窗口）" });
    tick(L, Math.ceil(L.NUM.ball.fuseHold * 60));
    const alive = S.balls.filter(b => !b.dead);
    fuse.push({ cv: grab(L, real, midX(L), midY(L)), note: "③ 合成一颗（absorbed=" +
              (alive[0] ? alive[0].absorbed : "?") + "，半径 " +
              (alive[0] ? Math.round(alive[0].r) : "?") + "）" });
    tick(L, 20);
    fuse.push({ cv: grab(L, real, midX(L), midY(L)), note: "④ 合成后继续滚，不弹飞（vx=" +
              Math.round(alive[0] ? alive[0].vx : 0) + "）" });
    rows.push({ title: "合 · 两颗慢球贴够 0.28s 变成一颗更大的", cells: fuse,
                vx: [Math.round(alive[0] ? alive[0].vx : 0), alive[0] ? alive[0].absorbed : 0] });

    /* ---------------- 拼图 ---------------- */
    const COL = 4, CW = 320, CH = 200, GAP = 10, PAD = 16, HEAD = 34;
    const TW = PAD * 2 + COL * CW + (COL - 1) * GAP;
    const TH = PAD + rows.length * (HEAD + CH + GAP) + 8;
    const out = createCanvas(TW, TH);
    const o = out.getContext("2d");
    /* 深色底：出图是给人看的，白底会让雪球边缘糊掉。 */
    o.fillStyle = "#0E1A22";
    o.fillRect(0, 0, TW, TH);

    let y = PAD;
    for (const r of rows) {
        o.font = "700 15px " + FONT;
        o.fillStyle = "#CFE8F5";
        o.textAlign = "left";
        o.fillText(r.title, PAD, y + 18);
        y += HEAD;
        for (let i = 0; i < r.cells.length; i++) {
            const x = PAD + i * (CW + GAP);
            o.drawImage(r.cells[i].cv, x, y, CW, CH);
            o.strokeStyle = "rgba(140,190,215,.35)";
            o.lineWidth = 1;
            o.strokeRect(x + 0.5, y + 0.5, CW - 1, CH - 1);
            /* 小字标注放在每格下方留白里 —— 画在图上会盖住球。 */
            o.font = "600 12px " + FONT;
            o.fillStyle = "#9FBCCD";
            o.fillText(r.cells[i].note, x, y + CH + 15);
        }
        y += CH + GAP + 22;
    }

    const file = path.join(OUT, "snowlab-ball-pairs.png");
    fs.writeFileSync(file, out.toBuffer("image/png"));
    console.log("已出图：" + path.relative(ROOT, file) + "  " + TW + "×" + TH);
    console.log("撞：左球 vx=" + rows[0].vx[0] + "  右球 vx=" + rows[0].vx[1]);
    console.log("合：合成后 vx=" + rows[1].vx[0] + "  absorbed=" + rows[1].vx[1]);
})();
