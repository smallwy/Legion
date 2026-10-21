/* 量地平面：沿若干列向下扫，找出「卡通描边」的位置 —— 用来判断宠物的脚底该落在哪。
   背景源图是 1536×1024，设计坐标 (x,y) → 源图 (x*1.2, y*1.2+48)。 */
const path=require("path");
const {createCanvas,loadImage}=require("@napi-rs/canvas");
const K=1.2, DY=48;
(async()=>{
  const img=await loadImage(path.resolve(process.argv[2]));
  const cv=createCanvas(img.width,img.height),g=cv.getContext("2d");
  g.drawImage(img,0,0);
  const d=g.getImageData(0,0,img.width,img.height).data;
  const W=img.width;
  // 深棕色描边（家具/建筑的轮廓）
  const isInk=(r,gg,b,a)=>a>128&&r<150&&gg<110&&b<95;
  const cols=[180,250,330,420,500,520,560,660,720,800,880,1000,1100,1180];
  console.log("列      最深墨迹(设计坐标 y)   该列 y<640 的所有墨迹段");
  for(const dx of cols){
    const sx=Math.round(dx*K);
    const runs=[];
    let start=null;
    for(let sy=Math.round(20*K+DY); sy<img.height; sy++){
      const k=(sy*W+sx)*4;
      const ink=isInk(d[k],d[k+1],d[k+2],d[k+3]);
      if(ink&&start===null) start=sy;
      else if(!ink&&start!==null){ runs.push([start,sy-1]); start=null; }
    }
    const des=(sy)=>Math.round((sy-DY)/K);
    const segs=runs.filter(([a,b])=>des(b)<660).map(([a,b])=>`${des(a)}-${des(b)}`);
    console.log(String(dx).padEnd(7)+"─".padEnd(4)+(segs.length?segs.join("  "):"(无)"));
  }
})();
