const path=require("path"),fs=require("fs");
const {createCanvas,loadImage}=require("@napi-rs/canvas");
const AI="D:/Legion/client/art/03-candidate/01-pets";
const files=["sugar-stand","nian-gao-dog","tuan-zi-ham","xue-tuan-rab","dou-nai-ox","xing-xie-fox"];
(async()=>{
  const out={};
  console.log("文件".padEnd(14),"源尺寸".padEnd(12),"内容框".padEnd(26),"底留白","占比");
  for(const f of files){
    const img=await loadImage(path.join(AI,f+"@v1.png"));
    const c=createCanvas(img.width,img.height), g=c.getContext("2d");
    g.drawImage(img,0,0);
    const d=g.getImageData(0,0,img.width,img.height).data;
    let top=-1,bot=-1,left=img.width,right=-1;
    for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++)
      if(d[(y*img.width+x)*4+3]>18){if(top<0)top=y;if(y>bot)bot=y;if(x<left)left=x;if(x>right)right=x;}
    const w=right-left+1,h=bot-top+1;
    out[f]={w:img.width,h:img.height,left,top,right,bot,cw:w,ch:h,
            padBot:(img.height-1-bot)/img.height,
            padTop:top/img.height,
            cxRatio:((left+right)/2)/img.width};
    console.log(f.padEnd(14),`${img.width}x${img.height}`.padEnd(12),
      `(${left},${top})-(${right},${bot})`.padEnd(26),
      String(img.height-1-bot).padStart(4),
      `${(out[f].padBot*100).toFixed(1)}%  内容高${h} 中心x${((left+right)/2).toFixed(0)}`);
  }
  fs.writeFileSync(path.join(AI,"_anchor.json"),JSON.stringify(out,null,1));
  console.log("\n✓ ai/_anchor.json");
})();
