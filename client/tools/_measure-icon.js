/* 图标 PNG 的内容是否在画布中心 —— Dock 图标位置偏了 4px，先确认是资产问题还是 CSS 问题 */
const path=require("path");
const {createCanvas,loadImage}=require("@napi-rs/canvas");
(async()=>{
  for(const f of process.argv.slice(2)){
    const img=await loadImage(path.resolve(f));
    const cv=createCanvas(img.width,img.height),g=cv.getContext("2d");
    g.drawImage(img,0,0);
    const d=g.getImageData(0,0,img.width,img.height).data;
    let x0=1e9,y0=1e9,x1=-1,y1=-1;
    for(let j=0;j<img.height;j++)for(let i=0;i<img.width;i++){
      const k=(j*img.width+i)*4;
      if(d[k+3]>28){if(i<x0)x0=i;if(i>x1)x1=i;if(j<y0)y0=j;if(j>y1)y1=j;}
    }
    const w=x1-x0+1,h=y1-y0+1;
    console.log(path.basename(f).padEnd(14),
      `画布 ${img.width}×${img.height}  内容 ${w}×${h} @(${x0},${y0})`,
      ` 内容中心 (${(x0+w/2).toFixed(1)},${(y0+h/2).toFixed(1)})`,
      ` 画布中心 ${img.width/2}`,
      ` 占画布 ${(Math.max(w,h)/img.width*100).toFixed(1)}%`);
  }
})();
