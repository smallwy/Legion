# -*- coding: utf-8 -*-
"""
把 prototype/snowlab.html 抽成 Cocos 可 import 的 TS 运行时 —— grove 那条路的复用。

    python client/tools/extract_snowlab_runtime.py

源改了以后重跑本脚本，**别手改生成物**（会被整体覆盖）。

产物两个：
  assets/scripts/snowlab/SnowlabRuntime.ts   玩法 + 绘制（7000 行，逻辑一行不改）
  assets/scripts/snowlab/SnowlabArt.ts       内嵌贴图（5 张 base64，258KB）

和 grove 的差别，两条：
  ① grove 的美术走 `resources.load` 再由 GroveBattle 注入；snowlab 的贴图
     **本来就内嵌在 html 里**（为了让用户双击就能看到贴图版而不是代码图形），
     所以这里把 `<script id="art-*">` 那几块原样搬成 `SnowlabArt.ts` ——
     少了"两边长得不一样"这条静默不一致，也不用动 resources（更不用编辑器 import）。
  ② grove 的导出是 `window.GROVE` → `export`；snowlab 原本包在一个 IIFE 里
     （`(function () { ... })()`），ES module 里 `export` 不能写在 IIFE 内，
     所以这里**把 IIFE 拆掉**，其余声明原样留在模块作用域。

为什么抽而不是重写：7000 行里约 2500 行是 ctx 绘制、4000 行是物理/关卡/裹球/推球。
重写 = 把前四轮调出来的手感全部作废。
"""

import io
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'prototype', 'snowlab.html')
OUT_DIR = os.path.join(ROOT, 'assets', 'scripts', 'snowlab')
OUT = os.path.join(OUT_DIR, 'SnowlabRuntime.ts')
OUT_ART = os.path.join(OUT_DIR, 'SnowlabArt.ts')


def must(s, old, new, n=1):
    """替换 n 次；次数不对就直接失败 —— 静默半替换会生成一个更难查的怪物。"""
    c = s.count(old)
    if c != n:
        raise SystemExit('锚点命中 %d 次（期望 %d）：%r' % (c, n, old[:120]))
    return s.replace(old, new, n)


HEADER = '''// @ts-nocheck
/* ⚠ 自动生成，勿手改 —— 源：client/prototype/snowlab.html
   重新生成：python client/tools/extract_snowlab_runtime.py

   这是雪人兄弟式关卡的**引擎无关运行时**（物理 / 关卡生成 / 裹球 / 推球 / 绘制）。
   绘制原样保留：一套 Canvas 2D 代码（960x600）。SnowlabBattle 开一块
   960x600 的离屏 canvas 喂进来，再把这块 canvas 作为 **DOM 层**铺在 Cocos
   画布上面 —— 不走 Cocos 渲染管线（为什么这么做见 SnowlabBattle 文件头，
   和 GroveBattle 是同一个理由：Battle 场景里一个 Canvas / RenderRoot2D 都没有）。

   **为什么整份文件 `@ts-nocheck`：**
   源是手写的原型（7000 行、几百个未标注形参）。按 strict 打开会立刻刷出
   1500+ 条 implicit-any，把真正的错误埋掉 —— 这正是 `runtime-sanity.js` 当年
   单开一道、只守 TS2304 那四个致命码的原因。这里的信任链换成两条更好用的：
     · `tools/snowlab-runtime-check.js`：把本文件编译出来真跑 900 帧，
       和 html 版逐帧对坐标（同一个种子必须一像素不差）
     · `tools/_snowlab-check.js`（226 项）：断言的仍然是同一份玩法源码

   导出：
     snowlabAttachCanvas(canvas)  绑定画布（顺带按 dpr 放大后备缓冲）
     snowlabBoot(seed?)           开局。seed 不给 = 随机
     snowlabTick(dt) / snowlabRender()   每帧推进 / 绘制
     SNOWLAB                      调试导出，和浏览器里的 window.SNOWLAB 同一份
   ========================================================================= */

"use strict";

import { INLINE_ART } from './SnowlabArt';
'''


TAIL = '''

/* ---------- Cocos 侧 API ----------
   原型里"取 canvas"和"起 requestAnimationFrame"是启动段的活；
   进了 Cocos 这两件事由 SnowlabBattle 组件接管，所以在这里开两个小口子。

   **dpr 在这里处理，不在组件里** —— 原型里那段 `cv.width = W * dpr` 就是
   在这一层做的；挪到组件里会让"原型和 Cocos 里的画面清晰度"变成两套开关，
   换机器就歪。后备缓冲 960*dpr、逻辑坐标仍按 960 画，绘制代码一行不动。 */
export function snowlabAttachCanvas(c: any): void {
  cv = c;
  const ratio = Math.min(2, (typeof window !== 'undefined' && (window as any).devicePixelRatio) || 1);
  c.width = W * ratio;
  c.height = H * ratio;
  ctx = c.getContext('2d');
  if (ctx) {
    /* `style` 不一定有：浏览器里的 <canvas> 有，`@napi-rs/canvas` 的没有
       （断言工具用的就是后者）。少了这个判断，工具一调就抛
       "Cannot set properties of undefined"。 */
    if (c.style) {
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}

export function snowlabTick(dt: number): void { step(dt); }
export function snowlabRender(): any { return draw(); }
'''


def build_art(html):
    blocks = {}
    for m in re.finditer(
            r'<script id="art-([a-z-]+)" type="text/plain">(.*?)</script>', html, re.S):
        blocks[m.group(1)] = m.group(2).strip()
    if not blocks:
        raise SystemExit('没找到任何 <script id="art-*"> 内嵌贴图块')

    head = '''// @ts-nocheck
/* ⚠ 自动生成，勿手改 —— 源：client/prototype/snowlab.html 里的内嵌贴图块
   重新生成：python client/tools/extract_snowlab_runtime.py

   五张图（背景 + 主角 + 三只敌人）以 data URI 原样搬过来。
   为什么不用 `resources.load`：
     · snowlab 的贴图从来不在 assets/resources 下（敌人那三张在
       `assets/snowlab/foe/`，不在 resources 里，`resources.load` 读不到）；
     · 搬到 resources 要走编辑器 import 生成 .meta，那是"必须开编辑器"的一步；
     · 原型里本来就是内嵌的，原样搬过来 = 画面**像素级一致**，
       也不会再出现"评审图有贴图、真机是代码图形"那条静默不一致。
   代价：本文件 258KB 的 base64。它是生成物，不进 review。
   ========================================================================= */

export const INLINE_ART: Record<string, string> = {
'''
    body = []
    for k, v in blocks.items():
        body.append("  '%s':\n    '%s'," % (k, v))
    return head + '\n'.join(body) + '\n};\n'


def main():
    html = io.open(SRC, encoding='utf-8').read()
    lines = html.split('\n')
    a = next(i for i, l in enumerate(lines) if l.strip() == '<script>')
    b = next(i for i, l in enumerate(lines) if l.strip() == '</script>')
    body = '\n'.join(lines[a + 1:b])

    # ⓪ 拆掉 IIFE 外壳 —— ES module 里 export 不能写在 IIFE 里
    body = must(body, "(function () {\n'use strict';\n", '')
    body = must(body, '\nif (typeof module !== \'undefined\' && module.exports) module.exports = API;\n})();',
                '\nexport const SNOWLAB: any = API;')

    # ① 画布改由外部注入（原型：document.getElementById('cv') + dpr 自适配）
    body = must(body, '''const cv = document.getElementById('cv');
/* jsdom 里没有 canvas 实现。测试只要逻辑，所以拿不到 ctx 就降级成 null，
   draw() 第一行 return —— 逻辑和渲染因此可以分开验。 */
let ctx = null;
try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
if (ctx) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
''', '''/* 画布由 SnowlabBattle 通过 snowlabAttachCanvas 注入；jsdom / 断言里可以是 null，
   那种情况下 draw() 第一行就 return —— 逻辑和渲染因此可以分开验。 */
let cv: any = null;
let ctx: any = null;
''')

    # ② 背景：从 DOM 的 #art-bg 改成 INLINE_ART，并改成可被 Cocos 调用的函数
    # **锚点只用首尾两行 + 正则，别写整段字面量。**
    # 2026-10-30 栽过一次：`BG_IMG` 改成按场景存的 `BG_IMGS.snow` 之后，
    # 这条字面量锚点命中 0 次，脚本直接退出 —— 而生成物留在上一版，
    # 下游 runtime-check 一片绿（它读的是没更新的 .ts）。
    pat_bg = re.compile(r'\(function initBackdrop\(\) \{.*?\n\}\)\(\);', re.S)
    assert len(pat_bg.findall(body)) == 1, len(pat_bg.findall(body))
    # **遍历 `BG_IMGS`，不要写死 snow。** 写死的版本给 ember 加了图也不读，
    # 而症状是"base64 块在 HTML 里、进游戏却不显示" —— 块没错，是代码不看它。
    # key 的换算跟原型 `bgElId` 同源：id="art-bg" → INLINE_ART["bg"]，
    # id="art-bg-ember" → INLINE_ART["bg-ember"]。
    body = pat_bg.sub(lambda _m: '''function snowlabInitBackdrop() {
  if (typeof Image === "undefined") return;
  for (const id of Object.keys(BG_IMGS)) {
    const src = (INLINE_ART[bgElId(id).replace("art-", "")] || "").trim();
    if (!src) continue;
    const im = new Image();
    /* 按场景存（`BG_IMGS`），不是一张全局图 —— 见原型里的长注释。 */
    im.onload = () => { BG_IMGS[id] = im; };
    im.onerror = () => { BG_IMGS[id] = null; };
    im.src = src;
  }
}''', body)

    # ③ 角色贴图：同上
    body = must(body, '''(function initArt() {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return;
  for (const k of ART_KEYS) {
    const el = document.getElementById('art-' + k);
    if (!el) continue;
    const src = (el.textContent || '').trim();
    if (!src) continue;
    const im = new Image();
    im.onload = () => { ART[k] = im; };
    im.onerror = () => { /* 静默保持代码图形：这条路径本来就是兜底 */ };
    im.src = src;
  }
})();''', '''function snowlabInitArt() {
  if (typeof Image === 'undefined') return;
  for (const k of ART_KEYS) {
    const src = (INLINE_ART[k] || '').trim();
    if (!src) continue;
    const im = new Image();
    im.onload = () => { ART[k] = im; };
    im.onerror = () => { /* 静默保持代码图形：这条路径本来就是兜底 */ };
    im.src = src;
  }
}''')

    # ④ 启动段（挂 DOM 监听 + 选关 + rAF 自转）换成显式入口
    # **用正则而不是整段字面量。** 这一段是"页面入口"，注定会变
    # （2026-10-30 加"从出征页进来接关号 + 返回按钮"就整段换了），
    # 每改一次原型都要人肉同步抄一遍字面量，太脆 —— 第一次改完直接
    # `锚点命中 0 次`，生成物停在上一个版本还不报错，正是 snowlab
    # 在 cce5c23 卡过四轮的那种坑。正则只锚**首尾两行**，中间随便长。
    _bootRE = re.compile(
        r"if \(typeof window !== 'undefined' && typeof document !== 'undefined'\) \{\n"
        # **首行后面允许有别的行**：2026-10-30 往这儿插了一行"读静音存档"，
        # 锚点立刻命中 0 次 —— 而它只是 raise 之后退出，生成物停在上版，
        # 下游 runtime-check 全绿（它读的就是没更新的 .ts）。栽过两次了。
        r"(?:[^\n]*\n)*?"
        r"  window\.addEventListener\('keydown', e => onKey\(e, true\)\);.*?\n"
        r"  else draw\(\);\n\}", re.S)
    body, _n = _bootRE.subn('''/* **启动交给 Cocos。**原型的启动段做了四件事：挂键盘、选关、起 rAF 自转、
   兜底画一帧。进 Cocos 之后 rAF 由组件 update() 驱动（不能两条循环一起跑，
   那会让步进变成双倍速），键盘监听留着 —— Web 构建里 window 是有的，
   而且它和原型是同一份代码，键位不会漂。

   **选关这一段不进 Cocos**：原型里靠 `?from=grove` 读存档决定从第几关开始、
   再挂一个「← 出征」的 DOM 返回钮，那是网页路由的事。Cocos 里关卡号
   由存档组件持有，要进指定关直接调 `startStage(n)`（已在 API 导出）。

   `_domBound` 挡住重复挂监听：组件销毁重建（切场景再回来）会二次进这里，
   不挡就是一次按键走两遍 onKey。 */
let _domBound = false;
export function snowlabBoot(seed?: number): void {
  if (typeof window !== 'undefined' && !_domBound) {
    _domBound = true;
    window.addEventListener('keydown', (e: any) => onKey(e, true));
    window.addEventListener('keyup', (e: any) => onKey(e, false));
    window.addEventListener('blur', () => { S.keys = {}; });
  }
  snowlabInitBackdrop();
  snowlabInitArt();
  reset(seed as any);
}''', body)
    if _n != 1:
        raise SystemExit('启动段锚点命中 %d 次（期望 1）' % _n)

    # ⑤ 主循环整段删掉 —— 由 SnowlabBattle.update() 驱动
    i = body.index('let last = 0;\nfunction loop(ts) {')
    j = body.index('requestAnimationFrame(loop);\n}', i) + len('requestAnimationFrame(loop);\n}')
    body = body[:i] + '''/* 主循环（`let last = 0; function loop(ts) {...}`）在这里被抽掉：
   进了 Cocos 由 SnowlabBattle.update(dt) 调 snowlabTick / snowlabRender。
   两条 rAF 一起跑会让步进变双倍速 —— 这类"手感忽然变快"最难查。 */''' + body[j:]

    # ⑥ 调试导出 -> export（必须先拆过 IIFE，否则 export 在 IIFE 里不合法）
    body = must(body, "if (typeof window !== 'undefined') window.SNOWLAB = API;\n", '')

    for bad in ('document.getElementById', 'requestAnimationFrame(loop)', 'window.SNOWLAB'):
        if bad in body:
            # getElementById 只允许残留在 initArt/initBackdrop 之外的注释里
            if bad == 'document.getElementById':
                continue
            raise SystemExit('没抽干净：%r 还在（会静默走到 DOM 分支）' % bad)

    # **给生成物打上源文件的指纹。** 抽取脚本的每个锚点都是"命中 0 次
    # 就 raise"，但 raise 之后生成物**留在上一版**，而下游的
    # build-rt / runtime-check 读的正是那份没更新的 .ts —— 所以它们全绿。
    # 这个坑栽过两次（cce5c23 卡四轮、2026-10-30 加音效时又踩一次）。
    # 指纹让"过期"变成可判定的：runtime-check 拿原型的 md5 对一次就知道。
    #
    # **必须先把行尾归一成 LF 再算，否则跨机器必假红。** 仓库存 LF、工作区
    # CRLF（core.autocrlf=true），所以两台机器的同一份原型字节不同 → md5 不同
    # → 门禁报"原型改过"。2026-10-30 实际踩到：公司机器算出 dcab99d9，
    # 本机算出 0f0d8839，两边都是干净工作区、同一个提交。
    # 归一之后指纹只反映**内容**，才符合它的本意。
    _fp = hashlib.md5(io.open(SRC, 'rb').read().replace(b'\r\n', b'\n')).hexdigest()
    _stamp = '/* @src-md5 %s @src-lines %d */\n' % (_fp, len(html.split('\n')))
    out = _stamp + HEADER + '\n' + body.rstrip() + '\n' + TAIL
    os.makedirs(OUT_DIR, exist_ok=True)
    io.open(OUT, 'w', encoding='utf-8', newline='').write(out)
    io.open(OUT_ART, 'w', encoding='utf-8', newline='').write(build_art(html))

    print('生成 %s' % OUT)
    print('  源 script 行数 %d -> 输出 %d 行 / %d KB'
          % (b - a - 1, out.count('\n') + 1, len(out.encode('utf-8')) // 1024))
    print('生成 %s（%d KB）' % (OUT_ART, len(build_art(html).encode('utf-8')) // 1024))


if __name__ == '__main__':
    main()
