/* 扫一条横带，把「非背景像素」按颜色归类成区段 —— 用来量 HUD 里关卡格与文案的实际占位 */
const path=require("path");
const {createCanvas,loadImage}=require("@napi-rs/canvas");
(async()=>{
  const [f,x0,x1,y0,y1]=[process.argv[2],+process.argv[3],+process.argv[4],+process.argv[5],+process.argv[6]];
  const img=await loadImage(path.resolve(f));
  const cv=createCanvas(img.width,img.height),g=cv.getContext("2d");
  g.drawImage(img,0,0);
  const d=g.getImageData(x0,y0,x1-x0,y1-y0).data, W=x1-x0, H=y1-y0;
  const kinds=[];
  for(let i=0;i<W;i++){
    let green=0,gray=0,ink=0;
    for(let j=0;j<H;j++){
      const k=(j*W+i)*4;
      const r=d[k],gg=d[k+1],b=d[k+2],a=d[k+3];
      if(a<40)continue;
      if(gg>190&&r<180&&b>140&&b<215) green++;
      else if(r>130&&r<235&&gg>115&&gg<225&&b>85&&b<205&&Math.abs(r-gg)<40) gray++;
      else if(r<150&&gg<115&&b<100) ink++;
    }
    kinds.push(green>3?"G":ink>2?"K":gray>3?"d":".");
  }
  // 压缩成区段
  const runs=[];let i=0;
  while(i<W){
    const c=kinds[i];let j=i;while(j<W&&kinds[j]===c)j++;
    if(c!==".")runs.push(`${c}:${x0+i}-${x0+j-1}(${j-i})`);
    i=j;
  }
  console.log(path.basename(f)); console.log("  "+runs.join("  "));
})();
