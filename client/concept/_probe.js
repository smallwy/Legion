const {createCanvas,loadImage}=require("@napi-rs/canvas");
const BG="D:/Legion/client/shots/_ai-bench/Keep_this_EXACT_children_s_sto_2026-10-21T06-31-25.png";
const SRC={x:0,y:48,w:1536,h:864}, W=1280,H=720;
(async()=>{
  const img=await loadImage(BG);
  const cv=createCanvas(W,H), g=cv.getContext("2d");
  g.drawImage(img,SRC.x,SRC.y,SRC.w,SRC.h,0,0,W,H);
  const d=g.getImageData(0,0,W,H).data;
  const tests={
    roofRed:  (r,gg,b)=> r>170 && gg>45 && gg<115 && b>40 && b<100 && r-gg>75,
    doorWood: (r,gg,b)=> r>110 && r<185 && gg>60 && gg<125 && b>35 && b<95 && r-b>55 && r-gg>35,
    darkPot:  (r,gg,b)=> r<95 && gg<95 && b<95 && Math.abs(r-gg)<40,
    cushion:  (r,gg,b)=> r>195 && gg>135 && gg<190 && b>140 && b<200 && r-b>25 && r-gg>25,
    fenceWood:(r,gg,b)=> r>150 && r<215 && gg>105 && gg<170 && b>65 && b<135 && r-b>50,
  };
  const res={};
  for(const k in tests){
    const f=tests[k];
    const cols=new Int32Array(W), rows=new Int32Array(H);
    let n=0,l=W,r_=-1,t=H,b_=-1;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=(y*W+x)*4;
      if(f(d[i],d[i+1],d[i+2])){n++;cols[x]++;rows[y]++;if(x<l)l=x;if(x>r_)r_=x;if(y<t)t=y;if(y>b_)b_=y;}
    }
    res[k]={n,box:[l,t,r_,b_]};
  }
  console.log("mask".padEnd(11),"像素数".padStart(7),"  包围盒 [l,t,r,b]");
  for(const k in res) console.log(k.padEnd(11),String(res[k].n).padStart(7),"  ",JSON.stringify(res[k].box));

  // 暗色连通块（找黑锅）：按行扫描聚段
  const darkF=tests.darkPot;
  const segs=[];
  for(let y=0;y<H;y++){
    let run=-1;
    for(let x=0;x<=W;x++){
      const on = x<W && (()=>{const i=(y*W+x)*4;return darkF(d[i],d[i+1],d[i+2]);})();
      if(on && run<0) run=x;
      if(!on && run>=0){ if(x-run>14) segs.push([run,y,x-1,y]); run=-1; }
    }
  }
  // 聚类
  const clusters=[];
  for(const s of segs){
    let hit=null;
    for(const c of clusters){
      if(s[0]<=c[2]+18 && s[2]>=c[0]-18 && s[1]<=c[3]+22 && s[3]>=c[1]-22){hit=c;break;}
    }
    if(hit){hit[0]=Math.min(hit[0],s[0]);hit[1]=Math.min(hit[1],s[1]);hit[2]=Math.max(hit[2],s[2]);hit[3]=Math.max(hit[3],s[3]);hit[4]++;}
    else clusters.push([s[0],s[1],s[2],s[3],1]);
  }
  clusters.sort((a,b)=>(b[2]-b[0])*(b[3]-b[1])-(a[2]-a[0])*(a[3]-a[1]));
  console.log("\n暗色连通块 Top6（黑锅候选）：");
  clusters.slice(0,6).forEach(c=>console.log(`  [${c[0]},${c[1]}] - [${c[2]},${c[3]}]  尺寸 ${c[2]-c[0]+1}x${c[3]-c[1]+1}  重心 (${Math.round((c[0]+c[2])/2)}, ${Math.round((c[1]+c[3])/2)})`));
})();
