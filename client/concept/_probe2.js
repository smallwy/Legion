const {createCanvas,loadImage}=require("@napi-rs/canvas");
const BG="D:/Legion/client/shots/_ai-bench/Keep_this_EXACT_children_s_sto_2026-10-21T06-31-25.png";
const SRC={x:0,y:48,w:1536,h:864}, W=1280,H=720;
(async()=>{
  const img=await loadImage(BG);
  const cv=createCanvas(W,H), g=cv.getContext("2d");
  g.drawImage(img,SRC.x,SRC.y,SRC.w,SRC.h,0,0,W,H);
  const d=g.getImageData(0,0,W,H).data;
  function peak(name, roi, f){
    const [x0,y0,x1,y1]=roi;
    const cols=new Int32Array(W), rows=new Int32Array(H);
    let n=0,l=W,r_=-1,t=H,b_=-1;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const i=(y*W+x)*4;
      if(f(d[i],d[i+1],d[i+2])){n++;cols[x]++;rows[y]++;if(x<l)l=x;if(x>r_)r_=x;if(y<t)t=y;if(y>b_)b_=y;}
    }
    if(!n){console.log(name,"无匹配");return;}
    let mx=0,mxv=0,my=0,myv=0;
    for(let x=x0;x<x1;x++) if(cols[x]>mxv){mxv=cols[x];mx=x;}
    for(let y=y0;y<y1;y++) if(rows[y]>myv){myv=rows[y];my=y;}
    console.log(`${name.padEnd(12)} 像素${String(n).padStart(6)}  盒[${l},${t}]-[${r_},${b_}]  列峰x=${mx}  行峰y=${my}`);
  }
  // 屋顶红（限上半部天空以下）
  peak("屋顶红",[200,100,700,300],(r,g,b)=> r>165 && g>40 && g<120 && b>35 && b<105 && r-g>70);
  // 木门（限小屋区域中部）
  peak("木门",[380,300,680,470],(r,g,b)=> r>105 && r<190 && g>55 && g<130 && b>30 && b<100 && r-b>50 && r-g>30);
  // 工作台（限左侧，屋基以外）
  peak("工作台木",[140,260,400,430],(r,g,b)=> r>120 && r<205 && g>72 && g<150 && b>40 && b<110 && r-b>52 && r-g>32);
  // 粉垫子（限下半）
  peak("粉垫子",[600,440,1100,640],(r,g,b)=> r>200 && g>140 && g<195 && b>145 && b<205 && r-b>28 && r-g>22);
  // 路牌（限左上）
  peak("路牌",[120,150,320,330],(r,g,b)=> r>140 && r<215 && g>95 && g<165 && b>55 && b<125 && r-b>45);
  // 右栅栏（限右侧）
  peak("右栅栏",[900,300,1280,440],(r,g,b)=> r>150 && r<220 && g>105 && g<175 && b>60 && b<135 && r-b>48);
})();
