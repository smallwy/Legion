const fs=require("fs"), path=require("path");
const {createCanvas, loadImage}=require("@napi-rs/canvas");
const OUT=path.join(__dirname,"..","assets","ui","home");
(async()=>{
  const p=await loadImage(path.join(OUT,"panel-cream.png"));
  const b=await loadImage(path.join(OUT,"btn-gold.png"));
  const S=3, pad=24;
  const W=(96+128)*S+pad*3, H=128*S+pad*2+40;
  const cv=createCanvas(W,H), g=cv.getContext("2d");
  g.fillStyle="#3A2A1E"; g.fillRect(0,0,W,H);
  let x=pad;
  for(const [img,border,label] of [[p,24,"panel-cream 96×96 · border 24"],[b,34,"btn-gold 128×128 · border 34"]]){
    const w=img.width*S, h=img.height*S;
    g.drawImage(img,x,pad,w,h);
    // border 虚线（3 倍缩放后也要 ×3）
    g.save(); g.strokeStyle="rgba(80,220,255,.9)"; g.lineWidth=1.6; g.setLineDash([7,5]);
    const B=border*S;
    g.strokeRect(x+B,pad+B,w-B*2,h-B*2);
    g.beginPath(); g.moveTo(x+B,pad); g.lineTo(x+B,pad+h);
    g.moveTo(x+w-B,pad); g.lineTo(x+w-B,pad+h);
    g.moveTo(x,pad+B); g.lineTo(x+w,pad+B);
    g.moveTo(x,pad+h-B); g.lineTo(x+w,pad+h-B);
    g.stroke(); g.restore();
    g.fillStyle="#FFF6E4"; g.font="bold 14px sans-serif";
    g.fillText(label, x, H-14);
    g.fillStyle="rgba(80,220,255,.9)"; g.font="12px sans-serif";
    g.fillText("青色虚线 = border 切口（中间那格才会被拉伸）", x, pad+h+18);
    x+=w+pad;
  }
  fs.writeFileSync(path.join(__dirname,"..","shots","_nine-slice.png"), cv.toBuffer("image/png"));
  console.log("✓ shots/_nine-slice.png");
})();
