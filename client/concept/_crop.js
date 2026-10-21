const {createCanvas,loadImage}=require("@napi-rs/canvas");
const fs=require("fs");
(async()=>{
  const img=await loadImage("D:/Legion/client/shots/home-layout@v2.png");
  const args=process.argv.slice(2);
  const [x,y,w,h,scale,out]=[+args[0],+args[1],+args[2],+args[3],+args[4],args[5]];
  const cv=createCanvas(w*scale,h*scale), g=cv.getContext("2d");
  g.imageSmoothingEnabled=true; g.imageSmoothingQuality="high";
  g.drawImage(img,x,y,w,h,0,0,w*scale,h*scale);
  fs.writeFileSync(out,cv.toBuffer("image/png"));
  console.log("✓",out);
})();
