const fs=require("fs"), path=require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("home-demo.html","utf8");
const dom = new JSDOM(html, { runScripts:"outside-only", pretendToBeVisual:true, url:"https://x/" });
const { window } = dom;
const doc = window.document;

// --- stubs ---
window.Image = class {
  constructor(){ this.naturalWidth=900; this.naturalHeight=1300; }
  set src(v){ this._src=v; setTimeout(()=>this.onload && this.onload(), 0); }
  get src(){ return this._src; }
};
window.HTMLElement.prototype.animate = function(){ return { finished:Promise.resolve(), cancel(){}, onfinish:null }; };
window.Element.prototype.animate = window.HTMLElement.prototype.animate;
let rafCount=0;
window.requestAnimationFrame = (cb)=>{ rafCount++; if(rafCount<4) setTimeout(()=>cb(window.performance.now()+16),0); return rafCount; };

let errs=[];
window.addEventListener("error", e=>errs.push(e.message));
window.onerror = (m)=>errs.push(m);

const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
try { window.eval(script); } catch(e){ console.log("✗ 脚本抛错:", e.message); process.exit(1); }

setTimeout(()=>{
  const q=s=>doc.querySelectorAll(s);
  const pets=q(".pet"), bench=q("#bench .glass"), pips=q("#pips .pip");
  const checks=[
    ["宠物数 = 6", pets.length===6, pets.length],
    ["待命队 = 5 格", bench.length===5, bench.length],
    ["进度格 = 8 格", pips.length===8, pips.length],
    ["出战头像已挂", !!doc.querySelector('img[src*="nian-gao-dog-head"]'), "ok"],
    ["背景已挂", doc.querySelector("#bg").src.includes("home-bg"), "ok"],
    ["六只 img 各有 src", [...pets].every(p=>p.querySelector("img") && p.querySelector("img").src.includes("@v1.png")), "ok"],
    ["每只都有名字牌", [...pets].every(p=>p.querySelector(".namecard")), "ok"],
  ];
  let bad=0;
  for(const [name,ok,detail] of checks){ console.log((ok?"  ✓ ":"  ✗ ")+name+(ok?"":"  → "+detail)); if(!ok)bad++; }

  // 模拟点击第一只
  const before = doc.querySelectorAll("#fx .p").length;
  const ev = (typeof window.PointerEvent === "function")
    ? new window.PointerEvent("pointerdown",{bubbles:true,clientX:200,clientY:400})
    : new window.MouseEvent("pointerdown",{bubbles:true,clientX:200,clientY:400});
  pets[0].dispatchEvent(ev);
  setTimeout(()=>{
    const after = doc.querySelectorAll("#fx .p").length;
    const bub = doc.querySelectorAll("#fx .bubble").length;
    const rip = doc.querySelectorAll("#fx .ripple").length;
    console.log((after>before?"  ✓ ":"  ✗ ")+`点击产生粒子 (${before} → ${after})`);
    console.log((bub>0?"  ✓ ":"  ✗ ")+`点击产生反应泡 (${bub})`);
    console.log((rip>0?"  ✓ ":"  ✗ ")+`点击产生涟漪 (${rip})`);
    console.log(errs.length? "  ✗ 运行期报错: "+errs.join(" | ") : "  ✓ 无运行期报错");
    console.log(`\n帧回调触发 ${rafCount} 次（动画循环${rafCount>1?"在跑":"没跑"}）`);
  }, 30);
}, 120);
