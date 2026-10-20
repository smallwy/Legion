const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','prototype','tactics.html'),'utf8');
const code=html.match(/<script>([\s\S]*)<\/script>/)[1];
const noop=()=>{};
function mkCtx(){return{canvas:null,fillStyle:'',strokeStyle:'',lineWidth:1,globalAlpha:1,font:'',textAlign:'',textBaseline:'',globalCompositeOperation:'source-over',save:noop,restore:noop,translate:noop,rotate:noop,scale:noop,beginPath:noop,closePath:noop,moveTo:noop,lineTo:noop,arcTo:noop,arc:noop,ellipse:noop,rect:noop,bezierCurveTo:noop,quadraticCurveTo:noop,fill:noop,stroke:noop,clip:noop,fillRect:noop,strokeRect:noop,clearRect:noop,drawImage:noop,fillText:noop,strokeText:noop,setLineDash:noop,getLineDash:()=>[],measureText:()=>({width:10}),createLinearGradient:()=>({addColorStop:noop})};}
function mkCanvas(w,h){const c={width:w||0,height:h||0,style:{}};const cx=mkCtx();cx.canvas=c;c.getContext=()=>cx;c.getBoundingClientRect=()=>({left:0,top:0,width:960,height:600});c.addEventListener=noop;return c;}
function mkImg(){const im={width:0,height:0,onload:null};let s='';Object.defineProperty(im,'src',{get:()=>s,set(v){s=v;im.width=32;im.height=32;if(im.onload)im.onload();}});return im;}
const sb={console,Math,Date,JSON,Image:mkImg,document:{getElementById:()=>mkCanvas(960,600),createElement:t=>mkCanvas(0,0)},addEventListener:noop,innerWidth:1280,innerHeight:800,requestAnimationFrame:()=>0,performance:{now:()=>Date.now()}};
sb.window=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'t.html'});
const P=sb.PAWPACK,S=P._S,NEST=P._NEST,SIM=P._SIM_DUR;

P._reset();
console.log('回合 | 来怪 | 场上 | 死亡 | 粮 | 怪最近距窝');
let guard=0;
while(S.phase!=='over'&&guard++<20){
  if(S.phase==='forage')S.phase='plan';
  const before=S.enemies.length;
  S.pets.forEach((p,i)=>{if(!p.down&&p.forageT<=0)P._setOrder(i,'guard',p.x,p.y,null);});
  P._startTurn();
  let t=0;while(t<SIM+0.1){P._simTick(1/120);t+=1/120;}
  S.phase='resolve';S.simT=1;
  const deadN=S.enemies.filter(e=>e.dead).length;
  const mind=S.enemies.filter(e=>!e.dead).reduce((m,e)=>Math.min(m,Math.hypot(e.x-NEST.x,e.y-NEST.y)),9999);
  const row=[String(S.round).padStart(3),String(before).padStart(4),String(S.enemies.filter(e=>!e.dead).length).padStart(4),String(deadN).padStart(4),String(S.food).padStart(3),mind.toFixed(0).padStart(10)].join(' |');
  P._endRound();
  console.log(row);
  if(S.phase==='over'){console.log('结束:',S.result,'剩粮',S.food);break;}
}
