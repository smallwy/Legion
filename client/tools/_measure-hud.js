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
  return {w:x1-x0+1,h:y1-y0+1,x:x+x0,y:y+y0,cx:+(x+x0+(x1-x0+1)/2).toFixed(1),cy:+(y+y0+(y1-y0+1)/2).toFixed(1)};
}
const INK=(r,g,b,a)=>a>120&&r<135&&g<100&&b<85;
const INK2=(r,g,b,a)=>a>100&&r<170&&g<115&&b<100;
const GREEN=(r,g,b,a)=>a>140&&g>190&&r<180&&b<210&&b>140;

const PROBES=[
  ["苔原(苔)",  [462,20,26,24],  INK],
  ["3/8关",    [462,40,60,16],  INK2],
  ["第1格(绿)", [548,24,22,22],  GREEN],
  ["连锁×",　   [640,24,60,20],  INK2],
];
(async()=>{
  const rows=[];
  for(const f of process.argv.slice(2,4)){
    const img=await loadImage(path.resolve(f));
    const cv=createCanvas(img.width,img.height),g=cv.getContext("2d");
    g.drawImage(img,0,0);
    const o={}; for(const [n,box,t] of PROBES) o[n]=bbox(g,box,t);
    rows.push(o);
  }
  for(const [n] of PROBES){
    const a=rows[0][n], b=rows[1][n];
    const f=(v)=>v?`x${String(v.x).padStart(4)} y${String(v.y).padStart(3)} ${v.w}×${v.h} c(${v.cx},${v.cy})`:"—";
    console.log(n.padEnd(10)+"\n   概念 "+f(a)+"\n   游戏 "+f(b));
  }
})();
