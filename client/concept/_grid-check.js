/* ⚠ 输入基准图已不存在（2026-10-23 美术资源整理时清理）。
   本脚本是一次性测量工具，当年用 AI 背景图读栅格坐标；
   实测结论已写进 home2-shot.js / kit2.js 的坐标常量，此处仅作历史留存，不再可运行。 */
const path=require("path"),fs=require("fs");
const {createCanvas,loadImage}=require("@napi-rs/canvas");
const P="D:/Legion/client/shots/_ai-bench/Keep_this_EXACT_children_s_sto_2026-10-21T06-31-25.png";
(async()=>{
  const img=await loadImage(P);
  console.log("源尺寸",img.width,img.height, "比例",(img.width/img.height).toFixed(4));
  const W=1280,H=720, T=48;
  const cv=createCanvas(W,H), g=cv.getContext("2d");
  // 裁 y=48..912 得 1536x864 = 16:9
  g.drawImage(img,0,T,img.width,864,0,0,W,H);
  // 网格
  g.font="11px monospace";
  for(let x=0;x<=W;x+=40){
    g.strokeStyle = x%160===0 ? "rgba(255,0,0,.60)" : "rgba(0,120,255,.18)";
    g.lineWidth = x%160===0 ? 1.4 : 1;
    g.beginPath(); g.moveTo(x+.5,0); g.lineTo(x+.5,H); g.stroke();
    if(x%160===0){
      g.fillStyle="rgba(255,0,0,.95)"; g.fillText(String(x),x+2,12);
      g.fillText(String(x),x+2,H-4);
    }
  }
  for(let y=0;y<=H;y+=40){
    g.strokeStyle = y%160===0 ? "rgba(255,0,0,.60)" : "rgba(0,120,255,.18)";
    g.lineWidth = y%160===0 ? 1.4 : 1;
    g.beginPath(); g.moveTo(0,y+.5); g.lineTo(W,y+.5); g.stroke();
    if(y%160===0){
      g.fillStyle="rgba(255,0,0,.95)"; g.fillText(String(y),3,y-3);
      g.fillText(String(y),W-38,y-3);
    }
  }
  fs.writeFileSync("D:/Legion/client/shots/_grid-ref.png",cv.toBuffer("image/png"));
  console.log("✓ _grid-ref.png");
})();
