/* 把生成的部件铺在一张验收图上，按 1:1 显示尺寸（不是放大）——
   "质感对不对"要在实际尺寸下看。 */
const fs=require("fs"),path=require("path");
const {createCanvas,loadImage}=require("@napi-rs/canvas");
const OUT=path.join(__dirname,"..","assets","ui","home");
const R=JSON.parse(fs.readFileSync(path.join(__dirname,"_cocos-assets.json"),"utf8"));
(async()=>{
  const names=Object.keys(R.parts).filter(n=>!n.startsWith("fog"));
  const W=560,H=Math.ceil(names.length/2)*(96+22)+40;
  const cv=createCanvas(W,H),g=cv.getContext("2d");
  g.fillStyle="#FFF0D8"; g.fillRect(0,0,W,H);
  for(let i=0;i<names.length;i++){
    const n=names[i], p=R.parts[n];
    const x=20+(i%2)*280, y=30+Math.floor(i/2)*(96+22);
    const im=await loadImage(path.join(OUT,n+".png"));
    const k=p.k;
    g.drawImage(im, x, y+(96-p.ch), p.cw, p.ch);
    g.fillStyle="#8A5232"; g.font="bold 10px Microsoft YaHei"; g.textAlign="left";
    g.fillText(`${n}  ${p.cw}×${p.ch}`, x, y+96+14);
  }
  fs.writeFileSync(path.join(__dirname,"..","shots","_parts.png"),cv.toBuffer("image/png"));
  console.log("✓ shots/_parts.png",W+"×"+H);
})();
