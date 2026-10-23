const path=require("path"),fs=require("fs");
const {createCanvas,loadImage}=require("@napi-rs/canvas");
const AI=path.join(__dirname,"..","art","03-candidate","01-pets");
const files=["sugar-stand","nian-gao-dog","tuan-zi-ham","xue-tuan-rab","dou-nai-ox","xing-xie-fox"];
(async()=>{
for(const f of files){
  const img=await loadImage(path.join(AI,f+"@v1.png"));
  const c=createCanvas(img.width,img.height),g=c.getContext("2d");
  g.drawImage(img,0,0);
  const d=g.getImageData(0,0,img.width,img.height).data;
  let top=-1,bot=-1,left=img.width,right=-1;
  for(let y=0;y<img.height;y++){for(let x=0;x<img.width;x++){
    if(d[(y*img.width+x)*4+3]>18){if(top<0)top=y;bot=y;if(x<left)left=x;if(x>right)right=x;}}}
  const w=right-left+1,h=bot-top+1;
  console.log(f.padEnd(14),`src ${img.width}x${img.height}`,
    `| 实际内容 ${w}x${h}`,`| 底部留白 ${img.height-1-bot}`,`| 左${left} 右${img.width-1-right}`,
    `| 底边占高 ${(bot/img.height).toFixed(3)}`);
}
})();
