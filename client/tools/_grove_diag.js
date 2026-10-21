const fs=require('fs'),vm=require('vm');
const noop=()=>{};
function mkCtx(){return new Proxy({},{get:(t,k)=>{
  if(k==='measureText') return ()=>({width:8});
  if(k==='createLinearGradient'||k==='createRadialGradient') return ()=>({addColorStop:noop});
  return noop;
},set:()=>true});}
function mkCanvas(){const c={width:960,height:600,style:{}};c.getContext=()=>mkCtx();c.addEventListener=noop;c.getBoundingClientRect=()=>({left:0,top:0,width:960,height:600});return c;}
const main=mkCanvas();
const sb={console,Math,Date,JSON,String,Number,Array,Object,Boolean,isNaN,Set,Map,
  document:{getElementById:()=>main,createElement:()=>mkCanvas()},
  performance:{now:()=>Date.now()},addEventListener:noop,innerWidth:1280,innerHeight:800};
sb.window=sb;vm.createContext(sb);
vm.runInContext(fs.readFileSync('../prototype/grove.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1],sb,{filename:'g'});
const P=sb.GROVE,S=P.S;
P._start(2);

// 直接读源码里的 botStep 太长，这里复刻一份精简版
function bot(){
  const p=S.p; if(!p||p.dead) return;
  S.keys.left=false;S.keys.right=false;
  if(S.balls.length){
    let nb=S.balls[0],nd=1e9;
    for(const b of S.balls){const d=Math.abs(b.x-p.x)+Math.abs(b.y-p.y)*0.8;if(d<nd){nd=d;nb=b;}}
    if(Math.abs(nb.vx)<100&&Math.abs(nb.y-p.y)<50){
      const goRight=Math.abs(891-nb.x)<Math.abs(535-nb.x);
      const standX=nb.x+(goRight?-48:48);
      if(p.x<standX-14)S.keys.right=true;else if(p.x>standX+14)S.keys.left=true;
      else if(goRight)S.keys.right=true;else S.keys.left=true;
      return;
    }
  }
  const alive=S.foes.filter(x=>!x.dead); if(!alive.length)return;
  const same=alive.filter(x=>Math.abs(x.y-p.y)<56);
  const pool=same.length?same:alive;
  let tgt=pool[0],bd=1e9;
  for(const x of pool){const d=Math.abs(x.x-p.x);if(d<bd){bd=d;tgt=x;}}
  if(!tgt)return;
  const dx=tgt.x-p.x,dy=tgt.y-p.y,dist=Math.abs(dx);
  if(Math.abs(dy)>56){
    let plat=null;
    for(const q of P.PLATS){if(Math.abs(q.y-tgt.y)<8&&tgt.x>q.x-20&&tgt.x<q.x+q.w+20){plat=q;break;}}
    if(plat&&dy<-30){
      const L=plat.x+42,Rr=plat.x+plat.w-42;
      const safeX=Math.abs(L-tgt.x)>Math.abs(Rr-tgt.x)?L:Rr;
      if(p.x<safeX-14)S.keys.right=true;else if(p.x>safeX+14)S.keys.left=true;
      if(p.onGround&&Math.abs(p.x-safeX)<80)S.press.jump=true;
    } else {
      if(dx>10)S.keys.right=true;else if(dx<-10)S.keys.left=true;
      if(dy<-30&&p.onGround)S.press.jump=true;
    }
    return;
  }
  if(dist>230){if(dx>0)S.keys.right=true;else S.keys.left=true;}
  else if(dist<100){if(dx>0)S.keys.left=true;else S.keys.right=true;}
  else p.face=dx>=0?1:-1;
  if(dist<300)S.press.atk=true;
  if(tgt.coat>=2&&dist<64&&p.dashCd<=0)S.press.dash=true;
}

let prev=3;
for(let f=0;f<60*60;f++){
  bot();
  const p=S.p;
  const before={x:p.x,y:p.y,vy:p.vy,onG:p.onGround};
  P.tick(1/60);
  if(S.p.hp!==prev){
    const near=S.foes.filter(x=>!x.dead).map(x=>({n:x.def.name,d:+Math.hypot(x.x-p.x,(x.y-x.h/2)-(p.y-p.h/2)).toFixed(0)})).sort((a,b)=>a.d-b.d)[0];
    console.log((f/60).toFixed(1)+'s HP '+prev+'->'+S.p.hp+' at('+before.x.toFixed(0)+','+before.y.toFixed(0)+') vy='+before.vy.toFixed(0)+' onG='+before.onG+' 最近='+JSON.stringify(near));
    prev=S.p.hp;
  }
  if(S.phase!=='play'){console.log('END',S.phase,(f/60).toFixed(1)+'s cleared='+S.cleared);break;}
}
