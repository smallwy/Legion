const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(ROOT,'prototype','snowlab.html'),'utf8');
const m=html.match(/<script>([\s\S]*?)<\/script>/);
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://x/'});
const {window}=dom; window.HTMLCanvasElement.prototype.getContext=()=>null; window.requestAnimationFrame=()=>0;
window.eval(m[1]); const L=window.SNOWLAB;
console.log('n  层 考点   目标     箱  怪  口  场景  骨架');
for(let n=1;n<=10;n++){
  const g=L.genLevel(L.stageSeed(n),n);
  const holes=g.layers.reduce((a,l)=>a+l.holes.length,0);
  const th=(L.THEMES||[]).find(t=>n<=(t.to||0));
  console.log([String(n).padStart(2), String(g.nFloors).padStart(2), (L.lessonOf(n)||'无').padEnd(6),
    L.goalOf(n).padEnd(7), String(g.boxes.length).padStart(3), String(g.spawns.length).padStart(3),
    String(holes).padStart(2), (th?th.cn:'?').padEnd(5), g.skel].join(' '));
}
