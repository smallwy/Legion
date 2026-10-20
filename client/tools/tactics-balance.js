const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','prototype','tactics.html'),'utf8');
const code=html.match(/<script>([\s\S]*)<\/script>/)[1];
const noop=()=>{};
function mkCtx(){return{canvas:null,fillStyle:'',strokeStyle:'',lineWidth:1,globalAlpha:1,font:'',textAlign:'',textBaseline:'',globalCompositeOperation:'source-over',save:noop,restore:noop,translate:noop,rotate:noop,scale:noop,beginPath:noop,closePath:noop,moveTo:noop,lineTo:noop,arcTo:noop,arc:noop,ellipse:noop,rect:noop,bezierCurveTo:noop,quadraticCurveTo:noop,fill:noop,stroke:noop,clip:noop,fillRect:noop,strokeRect:noop,clearRect:noop,drawImage:noop,fillText:noop,strokeText:noop,setLineDash:noop,getLineDash:()=>[],measureText:()=>({width:10}),createLinearGradient:()=>({addColorStop:noop})};}
function mkCanvas(w,h){const c={width:w||0,height:h||0,style:{}};const cx=mkCtx();cx.canvas=c;c.getContext=()=>cx;c.getBoundingClientRect=()=>({left:0,top:0,width:960,height:600});c.addEventListener=noop;return c;}
function mkImg(){const im={width:0,height:0,onload:null};let s='';Object.defineProperty(im,'src',{get:()=>s,set(v){s=v;im.width=32;im.height=32;if(im.onload)im.onload();}});return im;}
const sb={console,Math,Date,JSON,Image:mkImg,document:{getElementById:()=>mkCanvas(960,600),createElement:t=>mkCanvas(0,0)},addEventListener:noop,innerWidth:1280,innerHeight:800,requestAnimationFrame:()=>0,performance:{now:()=>Date.now()}};
sb.window=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'t.html'});
const P=sb.PAWPACK,S=P._S,PETS=P._PET_DEFS,GATES=P._GATES,NEST=P._NEST,SIM=P._SIM_DUR;

function play(strategy){
  P._reset();
  let guard=0;
  while(S.phase!=='over' && guard++<60){
    if(S.phase==='forage'){S.phase='plan';}
    // 策略：每只宠物按"最靠近窝的怪"分工
    const live=S.enemies.filter(e=>!e.dead);
    const sorted=live.slice().sort((a,b)=>Math.hypot(a.x-NEST.x,a.y-NEST.y)-Math.hypot(b.x-NEST.x,b.y-NEST.y));
    S.pets.forEach((p,i)=>{
      if(p.down||p.forageT>0)return;
      if(strategy==='guardall'){P._setOrder(i,'guard',p.x,p.y,null);return;}
      // active：最近的怪给最近的宠物，冲；没怪就护窝
      if(sorted[i]) P._setOrder(i,'rush',sorted[i].x,sorted[i].y,sorted[i]);
      else P._setOrder(i,'cover',0,0,null);
    });
    P._startTurn();
    let t=0;while(t<SIM+0.1){P._simTick(1/120);t+=1/120;}
    S.phase='resolve';S.simT=1;P._endRound();
  }
  return {r:S.result,round:S.round,food:S.food};
}
for(const st of ['guardall','active']){
  const res=[];
  for(let i=0;i<30;i++)res.push(play(st));
  const win=res.filter(r=>r.r==='win').length;
  const rounds=res.map(r=>r.round).sort((a,b)=>a-b);
  const foods=res.map(r=>r.food);
  console.log(st.padEnd(9),'胜率',String(Math.round(win/30*100)).padStart(3)+'%',
    '| 结束回合 中位',rounds[15],'范围',rounds[0]+'~'+rounds[29],
    '| 剩余粮 均值',(foods.reduce((a,b)=>a+b,0)/30).toFixed(1));
}
