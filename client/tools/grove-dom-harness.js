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
  import { groveBoot } from './GroveRuntime.js';

  const q = new URLSearchParams(location.search);
  const frames = Number(q.get('frames') || 90);

  const gb = new GroveBattle();
  gb.onLoad();

  // ?stage=3 直接开第 4 关（长滑道），验关卡几何有没有正确带过来
  const st = q.get('stage');
  if (st !== null) groveBoot(0, Number(st));

  const stage = document.getElementById('grove-stage');
  if (!stage) console.error('[harness] 没找到 #grove-stage —— 组件没挂 DOM 层');

  let last = performance.now(), n = 0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.034);
    last = now;
    gb.update(dt);
    if (++n < frames) { requestAnimationFrame(loop); return; }
    // 再画一帧把最终状态留下，然后停住等截图
    gb.update(0.016);
    window.__harnessDone = true;
    document.title = 'DONE ' + n;
    console.log('[harness] 跑完 ' + n + ' 帧');
  }
  requestAnimationFrame(loop);
</script>
</body>
</html>
`);

console.log('已生成验证页：client/prototype/_check2/');
console.log('  访问 http://127.0.0.1:8899/_check2/?frames=90');
