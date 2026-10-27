/* 把雾巢的几张验收图拼成一张评审图（每行：左 = 改前 / 右 = 改后）。
   **单列**：一行一张对照，宽度按 960 屏的一半算，标题和正文各占一行不重叠。
   产物落 ../shots/_nest-fog-sheet.png（`_` 前缀，不入库）。 */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const OUT = path.join(__dirname, "..", "shots");
try { GlobalFonts.registerFromPath("C:/Windows/Fonts/msyh.ttc", "YaHei"); } catch (e) {}
try { GlobalFonts.registerFromPath("C:/Windows/Fonts/msyhbd.ttc", "YaHeiBold"); } catch (e) {}

const ITEMS = [
  { key: "01-start", t: "进层第一帧", s: "一进场只有随身灯那一圈；左图整屏全亮，右图只有灯照到的地方" },
  { key: "02-walk",  t: "走过一段",   s: "走过的地方留下记忆：比未探亮、比脚下暗（三档明度）" },
  { key: "03-ball",  t: "把球推出去", s: "球就是火把 —— 光被带到灯照不到的地方，代价是那颗球回不来" },
  { key: "06-eyes",  t: "雾里的怪",   s: "只看得见一双眼睛，看不出是什么（改前没有这一层）" },
  { key: "04-pod",   t: "打碎菌光囊", s: "这片永久亮起，还掉孢子（改前没有菌光囊）" },
];

const SC = 0.5, PAD = 20, TITLE = 64, LBL = 52;
const cw = Math.round(960 * SC), chh = Math.round(600 * SC);

(async () => {
  const rows = ITEMS.filter(it => fs.existsSync(path.join(OUT, "_nest-fog-1-" + it.key + ".png")))
    .map(it => {
      const od = path.join(OUT, "_nest-old-1-" + it.key + ".png");
      return { ...it, nw: path.join(OUT, "_nest-fog-1-" + it.key + ".png"),
               od: fs.existsSync(od) ? od : null };
    });
  const cW = cw * 2 + PAD * 3;
  const cH = TITLE + rows.length * (chh + LBL + PAD) + PAD;
  const cv = createCanvas(cW, cH);
  const g = cv.getContext("2d");
  g.fillStyle = "#11151B"; g.fillRect(0, 0, cW, cH);

  g.fillStyle = "#EAF1F7";
  g.font = 'bold 24px "YaHeiBold","YaHei",sans-serif';
  g.fillText("雾巢 · 改前 / 改后", PAD, 34);
  g.fillStyle = "#8CA0B4";
  g.font = '14px "YaHei",sans-serif';
  g.fillText("左：2026-10-26 版（一进场整屏全亮）　　右：加雾之后（只有灯照到的地方是亮的）", PAD, 56);

  for (let i = 0; i < rows.length; i++) {
    const y = TITLE + i * (chh + LBL + PAD);
    const r = rows[i];
    if (r.od) {
      const im = await loadImage(r.od);
      g.drawImage(im, PAD, y, cw, chh);
    } else {
      g.fillStyle = "#1A2029"; g.fillRect(PAD, y, cw, chh);
      g.fillStyle = "#5B6B7C";
      g.font = '14px "YaHei",sans-serif';
      g.fillText("（这一版还没有这个机制）", PAD + 24, y + chh / 2);
    }
    const im2 = await loadImage(r.nw);
    g.drawImage(im2, PAD * 2 + cw, y, cw, chh);
    g.strokeStyle = "rgba(255,255,255,.10)"; g.lineWidth = 1;
    g.strokeRect(PAD + .5, y + .5, cw - 1, chh - 1);
    g.strokeRect(PAD * 2 + cw + .5, y + .5, cw - 1, chh - 1);

    g.fillStyle = "#D3E0EC";
    g.font = 'bold 15px "YaHeiBold","YaHei",sans-serif';
    g.fillText(r.t, PAD, y + chh + 22);
    g.fillStyle = "#7E90A4";
    g.font = '13px "YaHei",sans-serif';
    g.fillText(r.s, PAD, y + chh + 42);
  }
  const f = path.join(OUT, "_nest-fog-sheet.png");
  fs.writeFileSync(f, cv.toBuffer("image/png"));
  console.log("  " + f + `  (${cW}×${cH})`);
})();
