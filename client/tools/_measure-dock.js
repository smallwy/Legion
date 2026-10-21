/* Dock 逐件测量：概念图 vs 游戏截图
   每个探针 = 一个矩形区域 + 一个颜色判据，输出墨迹包围盒。
   只用来定位差异，不作为验收指标（字体渲染差异不可消除）。 */
const path=require("path");
const {createCanvas,loadImage}=require("@napi-rs/canvas");

function bbox(g,[x,y,w,h],test){
  const d=g.getImageData(x,y,w,h).data;
  let x0=1e9,y0=1e9,x1=-1,y1=-1;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const k=(j*w+i)*4;
    if(test(d[k],d[k+1],d[k+2],d[k+3])){if(i<x0)x0=i;if(i>x1)x1=i;if(j<y0)y0=j;if(j>y1)y1=j;}
  }
  if(x1<0)return null;
  return {w:x1-x0+1,h:y1-y0+1,cx:+(x+x0+(x1-x0+1)/2).toFixed(1),cy:+(y+y0+(y1-y0+1)/2).toFixed(1)};
}
const INK=(r,g,b,a)=>a>120&&r<135&&g<100&&b<85;            // #5A3826 深棕
const INK_SOFT=(r,g,b,a)=>a>90&&r<170&&g<130&&b<115&&r>50;  // rgba(112,72,46,.66)
const RED=(r,g,b,a)=>a>140&&r>195&&g<165&&b<155;            // #FF8A72 果子
const PINK=(r,g,b,a)=>a>140&&r>220&&g>130&&g<190&&b>150&&b<200; // #FF9EB6 心

const PROBES=[
  ["果子图标",  [24,636,44,40],  RED],
  ["248",       [52,644,44,26],  INK],
  ["果子标签",   [52,668,44,18],  INK_SOFT],
  ["出战名年糕",  [338,636,50,22], INK],
  ["心(第1颗)",  [344,658,16,18], PINK],
];

(async()=>{
  const files=[process.argv[2],process.argv[3]];
  const rows=[];
  for(const f of files){
    const img=await loadImage(path.resolve(f));
    const cv=createCanvas(img.width,img.height),g=cv.getContext("2d");
    g.drawImage(img,0,0);
    const o={};
    for(const [n,box,t] of PROBES) o[n]=bbox(g,box,t);
    rows.push([path.basename(f),o]);
  }
  console.log("探针".padEnd(12)+"│ 概念图 cy / h".padEnd(24)+"│ 游戏 cy / h".padEnd(24)+"│ Δcy  Δh");
  for(const [n] of PROBES){
    const a=rows[0][1][n], b=rows[1][1][n];
    const f=(v)=>v?`${String(v.cy).padStart(6)} / ${String(v.h).padStart(2)}`:"   —";
    const d=(x,y)=>x&&y?`${(y-x>=0?"+":"")}${(y-x).toFixed(1)}`:"  —";
    console.log(n.padEnd(12)+"│ "+f(a).padEnd(22)+"│ "+f(b).padEnd(22)+"│ "+d(a&&a.cy,b&&b.cy).padStart(5)+" "+d(a&&a.h,b&&b.h).padStart(4));
  }
})();
