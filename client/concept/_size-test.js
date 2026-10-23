/* 尺寸检验：把 AI 立绘缩到游戏内各档尺寸，并做剪影检测 */
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const K = require("./kit2.js");

(async () => {
  const ai = await loadImage(
    "D:/Legion/client/art/03-candidate/01-pets/sugar-stand@v1.png"
  );
  const W = 1280, H = 780;
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");

  const paper = "#FFF6E4", tile = "#EFE6D6", ink = "#6B4A42";
  g.fillStyle = paper; g.fillRect(0, 0, W, H);

  /* ---- 第一行：游戏内各档尺寸 ---- */
  const sizes = [240, 180, 128, 96, 60];
  const labels = {
    240: "家园 240", 180: "战斗 180", 128: "远景 128",
    96: "图鉴格 96", 60: "HUD 头像 60",
  };
  let x = 24;
  for (const s of sizes) {
    const w = ai.width * s / ai.height;
    const cw = Math.max(w, 64);
    g.fillStyle = tile; g.fillRect(x - 6, 34, cw + 12, s + 12);
    g.drawImage(ai, x + (cw - w) / 2, 40, w, s);
    g.fillStyle = ink; g.font = K.F(12, false); g.textAlign = "center";
    g.fillText(labels[s], x + cw / 2, 40 + s + 26);
    x += cw + 24;
  }

  /* ---- 剪影工具 ---- */
  function toSilhouette(src, tw, th) {
    const c = createCanvas(tw, th);
    const cg = c.getContext("2d");
    const ww = src.width * th / src.height;
    cg.drawImage(src, (tw - ww) / 2, 0, ww, th);
    const img = cg.getImageData(0, 0, tw, th);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 90) {
        d[i] = 40; d[i + 1] = 30; d[i + 2] = 26; d[i + 3] = 255;
      } else {
        d[i + 3] = 0;
      }
    }
    cg.putImageData(img, 0, 0);
    return c;
  }

  /* ---- 第二行：同尺寸 AI vs 矢量 + 剪影 ---- */
  g.fillStyle = ink; g.font = K.F(15, true); g.textAlign = "left";
  g.fillText("同尺寸对比 240 高 —— 彩色 / 剪影", 24, 452);

  const SZ = 240, TW = 250;
  const panels = [];
  // AI 彩色 + 剪影
  panels.push({ label: "AI 出图 · 彩色", draw: (cg, w, h) => {
    const ww = ai.width * h / ai.height; cg.drawImage(ai, (w - ww) / 2, 0, ww, h);
  } });
  panels.push({ label: "AI 出图 · 剪影", sil: toSilhouette(ai, TW, SZ) });
  // 矢量
  const vc = createCanvas(TW, SZ);
  K.drawPal(vc.getContext("2d"), "cat", TW / 2, SZ - 4, SZ - 4, "normal");
  panels.push({ label: "v2 矢量 · 彩色", img: vc });
  panels.push({ label: "v2 矢量 · 剪影", sil: toSilhouette(vc, TW, SZ) });

  let px = 24;
  for (const p of panels) {
    g.fillStyle = tile; g.fillRect(px - 6, 466, TW + 12, SZ + 12);
    if (p.img) g.drawImage(p.img, px, 472);
    if (p.sil) g.drawImage(p.sil, px, 472);
    if (p.draw) {
      const c = createCanvas(TW, SZ);
      p.draw(c.getContext("2d"), TW, SZ);
      g.drawImage(c, px, 472);
    }
    g.fillStyle = ink; g.font = K.F(13, false); g.textAlign = "left";
    g.fillText(p.label, px, 472 + SZ + 28);
    px += TW + 24;
  }

  fs.writeFileSync(
    "D:/Legion/client/shots/_ai-bench/_size-test.png",
    cv.toBuffer("image/png")
  );
  console.log("ok");
})();
