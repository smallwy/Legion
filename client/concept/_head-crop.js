const path=require("path"),fs=require("fs");
const {createCanvas,loadImage}=require("@napi-rs/canvas");
const AI="D:/Legion/client/art/03-candidate/01-pets";
const OUT="D:/Legion/client/shots/head";
if(!fs.existsSync(OUT)) fs.mkdirSync(OUT,{recursive:true});
const files=["sugar-stand","nian-gao-dog","tuan-zi-ham","xue-tuan-rab","dou-nai-ox","xing-xie-fox"];
(async()=>{
for(const f of files){
  const img=await loadImage(path.join(AI,f+"@v1.png"));
  const c=createCanvas(img.width,img.height), g=c.getContext("2d");
  g.drawImage(img,0,0);
  const d=g.getImageData(0,0,img.width,img.height).data;
  let top=-1,bot=-1,left=img.width,right=-1;
  for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++)
    if(d[(y*img.width+x)*4+3]>18){if(top<0)top=y;bot=y;if(x<left)left=x;if(x>right)right=x;}
  const ch=bot-top+1, cw=right-left+1;
  // 头部：内容顶部往下 58%（卡通头部占比大），正方形边长留 8% 余量
  const headH = Math.round(ch*0.58);
  const side = Math.round(Math.max(headH, cw*0.96) * 1.10);
  const ccx = (left+right)/2, ccy = top + headH/2 - side*0.02;
  const sx = Math.round(ccx - side/2), sy = Math.round(ccy - side/2);
  const S=256;
  const o=createCanvas(S,S), og=o.getContext("2d");
  og.imageSmoothingEnabled=true; og.imageSmoothingQuality="high";
  og.drawImage(img, sx, sy, side, side, 0, 0, S, S);
  fs.writeFileSync(path.join(OUT,f+"-head@v1.png"), o.toBuffer("image/png"));
  console.log(`✓ ${f}-head@v1.png  内容 ${cw}x${ch} | 裁 (${sx},${sy}) ${side}px`);
}
// 拼一张验收条
const strip=createCanvas(files.length*140, 150), sg=strip.getContext("2d");
sg.fillStyle="#F4E6CC"; sg.fillRect(0,0,strip.width,strip.height);
for(let i=0;i<files.length;i++){
  const im=await loadImage(path.join(OUT,files[i]+"-head@v1.png"));
  sg.save(); sg.beginPath(); sg.arc(i*140+70,72,56,0,6.2832); sg.clip();
  sg.fillStyle="#FFF6E4"; sg.fillRect(i*140+14,16,112,112);
  sg.drawImage(im,i*140+26,26,92,92); sg.restore();
  sg.strokeStyle="#8A5E3C"; sg.lineWidth=2.6;
  sg.beginPath(); sg.arc(i*140+70,72,56,0,6.2832); sg.stroke();
  sg.fillStyle="#5A3826"; sg.font="bold 12px sans-serif"; sg.textAlign="center";
  sg.fillText(files[i].replace(/-.*/,"").replace(/^./,s=>s.toUpperCase()), i*140+70, 144);
}
fs.writeFileSync(path.join(OUT,"_head-strip.png"),strip.toBuffer("image/png"));
console.log("✓ _head-strip.png");
})();
