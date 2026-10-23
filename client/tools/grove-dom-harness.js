/**
 * 生成一个「模拟 Cocos 运行环境」的浏览器验证页。
 *
 * 目的：GroveBattle.ts 依赖 'cc' 引擎模块，在 node 里跑不了、在没有 Cocos GUI 的
 * 沙箱里也跑不了。但黑屏事故证明「语法通过 + 运行时体检通过」不足以保证出画面 ——
 * 这两项检查都不覆盖"组件有没有真的把画面挂上去"。
 *
 * 所以这里造一个极简 cc 桩：只有 Component / Node / Camera / Color / Layers /
 * director / assetManager / SceneAsset 的空壳，够 GroveBattle 的 onLoad 走完。
 * 然后照 Cocos 预览页的样子铺一块全屏黑 canvas（冒充游戏画布），
 * 再 new GroveBattle + 手动 update —— 画面出来就说明挂载逻辑是对的。
 *
 * 用法：node client/tools/grove-dom-harness.js  然后开 http://127.0.0.1:8899/_check2/
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TS_DIR = path.join(ROOT, 'assets/scripts/grove');
const OUT = path.join(ROOT, 'prototype/_check2');

const ts = require('typescript');

function transpile(file) {
    const src = fs.readFileSync(path.join(TS_DIR, file), 'utf8');
    const out = ts.transpileModule(src, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
        reportDiagnostics: true,
    });
    const errs = (out.diagnostics || []).filter((d) => d.category === 1);
    if (errs.length) {
        for (const e of errs) console.error(ts.flattenDiagnosticMessageText(e.messageText, '\n'));
        throw new Error(file + ' 有语法错误');
    }
    return out.outputText;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* ---- ⓪ 美术图（resources/grove 下的原样拷一份，给 resources 桩读） ---- */
const ART_SRC = path.join(ROOT, 'assets/resources/grove');
const ART_OUT = path.join(OUT, 'art');
fs.mkdirSync(ART_OUT, { recursive: true });
let artCount = 0;
/* 资源已按用途分成 grove/pet|head|foe|ui 四个子目录，
   所以拷的时候要保持相对结构 —— 扁平拷会让 pet/cat 和 head/cat 撞成同一个文件。 */
if (fs.existsSync(ART_SRC)) {
    const walk = (d) => {
        for (const f of fs.readdirSync(d)) {
            const full = path.join(d, f);
            if (fs.statSync(full).isDirectory()) { walk(full); continue; }
            if (!f.endsWith('.png')) continue;
            const rel = path.relative(path.join(ROOT, 'assets/resources'), full);
            const dst = path.join(ART_OUT, rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(full, dst);
            artCount++;
        }
    };
    walk(ART_SRC);
}

/* ---- ① cc 桩 ---- */
fs.writeFileSync(path.join(OUT, 'cc-stub.js'), `
export const _decorator = { ccclass: () => (cls) => cls, property: () => () => {} };

export class Node {
  constructor(name = 'Node') {
    this.name = name;
    this.children = [];
    this.parent = null;
    this.active = true;
    this.layer = 1 << 30;
    this.components = [];
    this._pos = { x: 0, y: 0, z: 0 };
  }
  addChild(c) { c.parent = this; this.children.push(c); }
  addComponent(C) {
    const inst = new C();
    inst.node = this;
    this.components.push(inst);
    return inst;
  }
  setPosition(x, y, z) { this._pos = { x, y, z }; }
  setWorldPosition(x, y, z) { this._pos = { x, y, z }; }
}

export const Layers = { Enum: { UI_2D: 1 << 25, DEFAULT: 1 << 30 } };

export class Camera {
  constructor() { this.node = null; this.orthoHeight = 0; this.visibility = 0; }
}
Camera.ProjectionType = { ORTHO: 0, PERSPECTIVE: 1 };
Camera.ClearFlag = { SOLID_COLOR: 7, DEPTH_ONLY: 6, DONT_CLEAR: 0 };

export class Color {
  constructor(r = 0, g = 0, b = 0, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a; }
}

export class Component { constructor() { this.node = new Node('Component'); } }

export class SceneAsset { constructor() { this.scene = {}; } }

export class ImageAsset {
  constructor(o) { Object.assign(this, o || {}); }
}

/* resources.load 的桩：直接从 ./art/ 读同名 png，塞成 { data: img } ——
   和 Cocos Web 上 ImageAsset.data 就是 HTMLImageElement 的行为对齐。 */
export const resources = {
  load(path, type, cb) {
    const img = new Image();
    img.onload = () => cb(null, { data: img });
    img.onerror = () => cb(new Error('404 ' + path), null);
    /* path 是 resources 相对路径（grove/pet/cat），art/ 下按同样的结构存 */
    img.src = './art/' + path + '.png';
  },
};

export const director = {
  runScene() { console.log('[stub] director.runScene'); },
  loadScene(n, cb) { console.log('[stub] director.loadScene', n); if (cb) cb(null); },
};
export const assetManager = {
  loadAny(uuid, cb) { console.log('[stub] assetManager.loadAny', uuid); setTimeout(() => cb(null, null), 0); },
};
`);

/* ---- ② 玩法运行时 ---- */
fs.writeFileSync(path.join(OUT, 'GroveRuntime.js'), transpile('GroveRuntime.ts'));

/* ---- ③ 适配组件（把 'cc' 指到桩、'./GroveRuntime' 补扩展名） ---- */
fs.writeFileSync(
    path.join(OUT, 'GroveBattle.js'),
    transpile('GroveBattle.ts')
        .replace(/from ['"]cc['"]/g, "from './cc-stub.js'")
        .replace(/from ['"]\.\/GroveRuntime['"]/g, "from './GroveRuntime.js'"),
);

/* ---- ④ 验证页 ---- */
fs.writeFileSync(path.join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>GroveBattle DOM 叠加层验证</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  /* 冒充 Cocos 的游戏画布：全屏纯黑，证明"如果只有 Cocos 渲染就是黑的" */
  #GameCanvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<canvas id="GameCanvas"></canvas>
<script type="module">
  import { GroveBattle } from './GroveBattle.js';
  import { groveBoot, GROVE } from './GroveRuntime.js';

  const q = new URLSearchParams(location.search);
  const frames = Number(q.get('frames') || 90);

  const gb = new GroveBattle();
  gb.onLoad();

  // ?stage=3 直接开第 4 关（长滑道），验关卡几何有没有正确带过来
  // ?hero=4 换角色（cat0 dog1 ham2 rab3 ox4 fox5），验六张立绘都对得上
  const st = q.get('stage');
  const ho = q.get('hero');
  if (st !== null || ho !== null) {
    groveBoot(ho === null ? 0 : Number(ho), st === null ? 0 : Number(st));
  }
  // ?phase=clear / fail —— 直接构造结算画面。结算 UI 是这一版改动最大的地方，
  // 但它只在"打完一关"时出现，靠跑帧永远截不到（机器人要跑几十秒）。
  const ph = q.get('phase');
  if (ph === 'clear' || ph === 'fail') {
    const S = GROVE.S;
    S.phase = ph;
    S.killed = 9; S.total = 9; S.playT = 41.2;
    S.food = 12;
    S.stat.made = 3; S.stat.burst = 0; S.stat.maxHolds = 3;
    S.trip.loot = 21; S.trip.multi = 1.15; S.trip.stages = 2;
    S.belly = 62;
    if (ph === 'fail') S.failWhy = '球被烧掉 2 次 —— 这一关要的是从营地走 3 只';
  }

  // ?ball=1 —— 在玩家前面摆一颗球。推球是这个玩法的核心交互，
  // 但它要先"糊三下变球"才出现，靠跑帧截不到，得先造一颗。
  if (q.get('ball')) {
    // 必须把当前波次序号传进去。spawnWave() 不传参时 WAVES[undefined] 是空数组，
    // S.wave 会被写成 undefined —— HUD 上那行直接变成"第 NaN / 3 波"。
    GROVE.spawnWave(GROVE.S.wave || 0);
    const f = GROVE.S.foes[0];
    if (f) {
      GROVE.coatFoe(f, 3);
      if (!GROVE.S.balls.length) GROVE.makeBallFrom(f, 0, 0);
      const b = GROVE.S.balls[0];
      if (b) {
        b.x = GROVE.S.p.x + 78;
        b.y = GROVE.S.p.y;
        b.vx = 0; b.vy = 0; b.pushed = false;
      }
    }
  }

  const stage = document.getElementById('grove-stage');
  if (!stage) console.error('[harness] 没找到 #grove-stage —— 组件没挂 DOM 层');
  window.__grove = GROVE;   // 调试用：控制台能直接看 S.p / S.phase

  /* 等美术图解码完再跑帧。
     资源是异步 new Image() 加载的，而下面跑帧是同步的 —— 不等待的话
     截图截到的是"立绘还没到、只有代码图形"的那一版，头像会是一个纯色圆。
     这个坑只在把 rAF 换成同步循环之后才暴露出来（原来是靠 2 秒的真实时间等到的）。 */
  await new Promise((r) => setTimeout(r, 400));

  // ?act=cast-left / cast-right —— 结尾前几帧按下方向 + 攻击，
  // 让截图正好停在"施法动作进行到一半"。动作只有 0.26 秒，
  // 靠人手点截图永远截不到。
  const act = q.get('act');
  const dirKey = act === 'cast-left' ? 'left' : act === 'cast-right' ? 'right' : null;

  /* 固定步长同步跑完，不等 rAF。
     上一版把 gb.update 挂在 requestAnimationFrame 上，帧率一抖（这个环境实测
     只有 30fps 上下）就"跑不满也不报错"，截图截到的是第 80 帧而不是第 120 帧 ——
     同一个 URL 截两次画面不一样，验证就没意义了。
     固定 1/60 之后：同一个 URL 每次跑出来的画面完全一样。 */
  for (let i = 0; i < frames; i++) {
    if (dirKey && i === frames - 12) GROVE._press(dirKey, true);
    if (dirKey && i === frames - 7) {
      GROVE._press(dirKey, false);
      GROVE._press('atk', true);
    }
    // 推球演示：提前按住方向，走过去顶球
    if (act === 'push' && i === frames - 40) GROVE._press('right', true);
    gb.update(1 / 60);

    /* 推到球就停，不等固定帧数跑完。
       按固定帧数跑的话，球早就滚出画面、甚至进坑烧掉了 —— 截出来的图里
       只有"推!"两个字，看不见球，也就看不见这一下到底有没有劲。 */
    if (act === 'push' && i > frames - 40) {
      const b = (GROVE.S.balls || []).find((x) => x && !x.dead && x.pushed);
      if (b) break;
    }
  }
  gb.update(1 / 60);
  window.__harnessDone = true;
  document.title = 'DONE ' + frames;
  console.log('[harness] 跑完 ' + frames + ' 帧（固定 1/60 步长）');

</script>
</body>
</html>
`);

console.log('已生成验证页：client/prototype/_check2/');
console.log('  美术图 %d 张已就位', artCount);
console.log('  访问 http://127.0.0.1:8899/_check2/?frames=90');
