# -*- coding: utf-8 -*-
"""
把 prototype/grove.html 的 <script> 抽成 Cocos 可 import 的 TS 运行时。

    python client/tools/extract_grove_runtime.py

源改了以后重跑本脚本，**别手改生成物**（GroveRuntime.ts 会被整体覆盖）。

只做三件事，玩法代码一行不动：
  ① 去掉"自己取 canvas / 自己起 rAF"（进 Cocos 后由 GroveBattle 组件驱动）
  ② window.GROVE 调试导出 -> export（顺带让 Cocos 侧能 import）
  ③ "收工回 game.html" -> 退出钩子（Cocos 里回的是 Home 场景）

为什么要抽而不是重写：原型 6800 行里约 2000 行是 ctx 绘制、
3500 行是推球/坡/波次/BOSS 的规则。规则一行都不能重写 ——
重写就等于把八轮调出来的手感全部作废。
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'prototype', 'grove.html')
OUT = os.path.join(ROOT, 'assets', 'scripts', 'grove', 'GroveRuntime.ts')


def must(s, old, new, n=1):
    """替换 n 次；次数不对就直接失败 —— 静默半替换会生成一个更难查的怪物。"""
    c = s.count(old)
    if c != n:
        raise SystemExit('锚点命中 %d 次（期望 %d）：%r' % (c, n, old[:90]))
    return s.replace(old, new, n)


def cut(s, start, end):
    """删掉 [start, end] 这整段（含两端）。"""
    i = s.index(start)
    j = s.index(end, i) + len(end)
    return s[:i] + s[j:]


HEADER = '''/* ⚠ 自动生成，勿手改 —— 源：client/prototype/grove.html
   重新生成：python client/tools/extract_grove_runtime.py

   这是推球玩法的**引擎无关运行时**（物理 / 关卡 / 波次 / BOSS / 冰壳 / 球）。
   绘制同样原样保留：一套 Canvas 2D 代码（960x600）。GroveBattle 开一块
   960x600 的离屏 canvas 喂进来，再把这块 canvas 作为 **DOM 层**铺在 Cocos
   画布上面 —— 不走 Cocos 渲染管线（为什么这么做见 GroveBattle 文件头）。

   导出：
     groveAttachCanvas(canvas)  绑定画布
     groveBoot(hero?, stage?, fromHome?)   开一局（fromHome = 先到出征页挑门）
     groveTick(dt) / groveRender()
     groveSetExitHook(fn)       "收工 / ESC 退出"交给 Cocos 处理
     groveSetArt(key, img)      注入美术图（pet-cat / head-cat / ui-coin …）
     GROVE                      调试导出（和浏览器里的 window.GROVE 同一份）
   ========================================================================= */
'''

BOOT = '''/* ---------- Cocos 侧入口 ----------
   原型靠 URL 参数（?from=home&hero=N&stage=K）从 game.html 进来；
   Cocos 里没有 URL，改成显式传参。不传就按存档推。 */
export function groveBoot(hero?: number, stage?: number, fromHome?: boolean): void {
  loadProgress();
  loadBest();
  resetRun();
  /* 主界面的 cleared 更全时补进来（老存档 / 只在浏览器里玩过的机器）。
     必须排在 readHomeSave 之前 —— 下面"第一个没通的"读的就是它写的那份。 */
  adoptHomeMirror();

  if (typeof hero === "number" && hero >= 0 && hero < HEROES.length) S.heroIdx = hero;

  /* 起始关跟着主界面的"第一个没通的关"走 —— 两边用同一份 cleared，不会打架。
   *
   * **全通是必须单独处理的第三种情况。** 原写法是
   *   `let st = 0; for (...) if (!done.has(i)) { st = i; break; }`
   * 全通时循环一次都不命中，`st` 保持初值 0 —— "27 屏打完"和"一关没打"
   * 在代码里长得一模一样，玩家每次进战斗都被塞回第一屏。
   * 这不是漏了一句提示，是**那个变量表达不了"没有下一关"**。
   * 现在用 -1 表示"没有下一个"。 */
  const s: any = readHomeSave();
  const done = new Set(Array.isArray(s.cleared) ? s.cleared : []);
  let st = -1;
  for (let i = 0; i < LEVELS.length; i++) { if (!done.has(i)) { st = i; break; } }

  if (typeof stage === "number" && stage >= 0 && stage < LEVELS.length) { S.progress = st; beginRun(stage); return; }
  /* 从主界面「出征」进来：**先到出征页挑门**，不直升第一个没通的屏。
     Cocos 里没有 URL，所以 fromHome 只能显式传 —— 靠 `?from=home` 判断
     在真机上恒为 false，出征页永远不会出现（原型里却会出现），
     同一次点击两个结果。 */
  if (fromHome) { S.progress = st >= 0 ? st : LEVELS.length; openGates(); return; }
  /* 全通之后落到哪。**这里原来写的是 `openPick()`** —— 挑一屏界面
     2026-10-26 被删掉了，函数没了、调用方留着，一进战斗就 ReferenceError。
     `grove.html` 里没有这行（它只在浏览器从 game.html 带参数进来时走），
     所以原型和冒烟都验不到，只有 tsc 的 TS2304 指出来。
     现在落出征页：27 扇门全开着，等价于原来"挑一屏"那个入口。 */
  if (st < 0) { S.progress = LEVELS.length; openGates(); return; }
  S.progress = st;
  beginRun(st);
}

'''

EXIT_HOOK = '''const FROM_HOME = URLP.get("from") === "home";

/* "收工回主界面"这件事在浏览器和 Cocos 里落点不同：
   浏览器跳 game.html，Cocos 切 Home 场景。所以只留一个钩子。 */
let exitHook: ((kind: string) => void) | null = null;
export function groveSetExitHook(fn: ((kind: string) => void) | null): void {
  exitHook = fn;
}
function groveExit(kind: string): boolean {
  if (exitHook) { exitHook(kind); return true; }
  if (FROM_HOME) { location.href = "game.html"; return true; }
  return false;
}'''

TAIL = '''

/* ---------- Cocos 侧 API ----------
   原型里"取 canvas"和"起 requestAnimationFrame"是启动段的活；
   进了 Cocos 这两件事由 GroveBattle 组件接管，所以在这里开两个小口子。 */
export function groveAttachCanvas(c: any): void {
  cv = c;
  ctx = c.getContext("2d");
}
export function groveTick(dt: number): void { tick(dt); }
export function groveRender(): any { return render(); }

/* 美术图注入。原型要能双击打开、零依赖，所以 grove.html 里一张图都不引；
   进了 Cocos 由 GroveBattle 用 resources.load 拿到图，再从这个口子喂进来。
   有图贴图、没图回退代码图形 —— 两边都不会坏。
   键名：pet-<heroId> / head-<heroId> / ui-<name> */
export { groveSetArt };

/* 原型里鼠标事件直接挂在 canvas 上；进 Cocos 后画布是离屏的、不接 DOM 事件，
   事件源换成 GroveBattle 转发过来的指针坐标（已经是 960x600 画布坐标系）。 */
export function grovePointer(kind: "move" | "down", x: number, y: number): void {
  if (kind === "move") onCanvasMove({ x, y });
  else onCanvasDown({ x, y });
}
'''


def main():
    html = io.open(SRC, encoding='utf-8').read()
    lines = html.split('\n')
    a = next(i for i, l in enumerate(lines) if l.strip() == '<script>')
    b = next(i for i, l in enumerate(lines) if l.strip() == '</script>')
    body = '\n'.join(lines[a + 1:b])
    # 先记下源行数：后面 ④b 段会把 a/b 覆盖成 body 内的**字符索引**，
    # 末尾那句 print 就变成"源 script 行数 363"（实际两万多行）。
    # 纯显示 bug，但它会让人以为抽取只吃了开头一小段。
    src_lines = b - a - 1

    # ① 画布改由外部注入
    body = must(
        body,
        'const cv = document.getElementById("cv");\nconst ctx = cv.getContext("2d");',
        'let cv: any = null;\nlet ctx: any = null;',
    )

    # ① fit()（DOM 缩放）整段删掉 —— Cocos 侧按相机正交高度自己适配
    body = cut(body, 'function fit() {', 'fit();\n')

    # ① 主循环整段删掉 —— 由 GroveBattle.update() 驱动
    body = cut(body, 'let lastT = 0;', 'requestAnimationFrame(frame);\n}')

    # ① 启动段（loadProgress/loadBest/resetRun + 从 URL 进来 + rAF 兜底）换成显式入口
    # 锚点只认 `loadProgress();` 这一句 —— 原来写的是
    # `'loadProgress();\nresetRun();'`，加一行 `loadBest()` 就 index 失败。
    # 函数定义是 `function loadProgress() {`，不含 `loadProgress();`，不会误命中。
    i = body.index('loadProgress();')
    j = body.index('/* ---------- 调试导出 ---------- */')
    body = body[:i] + BOOT + body[j:]

    # ② 调试导出 -> export
    body = must(body, 'window.GROVE = {', 'export const GROVE: any = {')
    body = body.replace('Object.defineProperty(window.GROVE,', 'Object.defineProperty(GROVE,')
    # 单个字段的写法有两类：`window.GROVE.X = X;`（下面这个循环）和
    # 对象字面量 `window.GROVE.CARD = {...}`。后者不在循环里，
    # 漏掉的话 Cocos 侧会去给一个不存在的 window.GROVE 赋值。
    body = must(body, 'window.GROVE.CARD =', 'GROVE.CARD =')
    # WALL_L / WALL_R 2026-10-25 起是**变量**（深巢 640 井会改它们），
    # 导出口改成了 `Object.defineProperty(..., {get})`，由上面那行统一处理。
    # 留在这里的 must 会让抽取直接失败 —— 那也是它该做的事：
    # 锚点消失时宁可报错，也不要静默抽出一份"墙永远 26/934"的运行时。
    for k in ('GROUND_Y',):
        body = must(body, 'window.GROVE.%s = %s;' % (k, k), 'GROVE.%s = %s;' % (k, k))

    # ③ 回主界面 -> 钩子
    body = must(
        body,
        '    if (FROM_HOME) { location.href = "game.html"; return; }',
        '    if (groveExit("esc")) return;',
    )
    body = must(
        body,
        '  if (FROM_HOME) { location.href = "game.html"; }',
        '  groveExit("done");',
    )
    body = must(
        body,
        'const FROM_HOME = URLP.get("from") === "home";',
        EXIT_HOOK,
    )

    # ④ 鼠标监听原本**在模块顶层**直接挂在 canvas 上 —— 进 Cocos 后画布是离屏的，
    #    而且那时 cv 还是 null，顶层执行会直接抛错、整个模块加载失败（表现就是黑屏）。
    #    改成具名函数，事件源由 GroveBattle 转发（grovePointer）。
    i = body.index('cv.addEventListener("mousemove", (ev) => {')
    j = body.index('});', body.index('cv.addEventListener("mousedown"')) + 3
    seg = body[i:j]
    seg = seg.replace('cv.addEventListener("mousemove", (ev) => {', 'function onCanvasMove(loc: any): void {')
    seg = seg.replace('cv.addEventListener("mousedown", (ev) => {', 'function onCanvasDown(loc: any): void {')
    seg = seg.replace('  const loc = toLocal(ev);\n', '')
    seg = re.sub(r'^\}\);', '}', seg, flags=re.M)
    if 'cv.addEventListener' in seg:
        raise SystemExit('鼠标监听没切干净：' + seg[:200])
    body = body[:i] + seg + body[j:]

    # ④b 触屏监听同样在模块顶层，而且**紧跟在 mousedown 之后**，所以上面的
    #     范围没盖住它 —— 漏掉的后果不是断言失败，是整个模块在 Cocos 里加载
    #     阶段就抛 `Cannot read properties of null`（cv 那时还是 null），
    #     表现就是黑屏。确认过 grove-runtime-check 会在这里停住。
    #     Cocos 侧不需要它：画布是离屏的，触点由 GroveBattle 转成 grovePointer
    #     的 down/move，和鼠标走同一条路。所以整段删掉，不给它开口子。
    if 'cv.addEventListener("touchstart"' in body:
        a = body.index('cv.addEventListener("touchstart"')
        # 从这一点往后找 `}, { passive: false });` 结束
        b = body.index('}, { passive: false });', a) + len('}, { passive: false });')
        body = body[:a] + (
            '/* 触屏监听（cv.addEventListener("touchstart")）在这里被抽掉：\n'
            '   画布进了 Cocos 是离屏的、不接 DOM 事件，触点在 GroveBattle 里\n'
            '   已经转成 grovePointer 的 down/move，和鼠标同一条路。\n'
            '   原型的触屏语义（出征页 / 挑一屏的点击落点）由 grove.html 自己验。 */'
        ) + body[b:]

    # ⑤ 纯 JS 里没有 `as` 断言。但 S.stumps 初始是 []，TS 会把它推成 never[]，
    #    循环体里每一处 s.hp / s.x 都报 TS2339 "does not exist on type 'never'"。
    #    在原型里写成 JSDoc 注解（JS 完全合法、可读），抽取时换成 TS 断言 ——
    #    两边各自的语言检查都不再吵，也不用为了迁就类型去改运行时代码。
    body = must(body, '/** @type {any[]} */ (S.stumps)', '(S.stumps as any[])')
    #    同理：S.p 初值是 null，TS 把它推成 "p: null"，任何 S.p.x 都是 TS2339。
    body = must(body, '/** @type {any} */ (S.p)', '(S.p as any)')
    #    新函数的形参在 .ts 里会报 implicit any（原型里其余函数是历史遗留，同理）。
    body = must(body, 'function nudgeOutOfStumps(f) {', 'function nudgeOutOfStumps(f: any): void {')

    # ⑥ 出征页第三扇门的出口必须**导出**。
    #
    #    原型里 `setSnowlabEntry` 只是同文件内部用的普通函数（页面里
    #    `snowEntry` 是个变量，改它就够了），抽取时忘了加 export。
    #    后果不是"点了没反应"，是 **Cocos 的模块链接阶段**就抛
    #    `The requested module './GroveRuntime' does not provide an export named
    #    'setSnowlabEntry'` —— 整个 GroveBattle 模块加载失败，
    #    `addComponent(GroveBattle)` 拿到 undefined，一台相机都没建，
    #    点「出发」之后**纯黑屏、控制台一行日志都没有**（模块根本没跑起来，
    #    连 onLoad 里的 console.log 都没机会打）。
    #    2026-10-30 实际踩到一次。判据：凡是 Cocos 侧 `import { X }` 的名字，
    #    这里必须有 export —— 现在由 tools/import-export-check.js 兜底。
    body = must(
        body,
        'function setSnowlabEntry(fn) {',
        'export function setSnowlabEntry(fn: any): void {',
    )

    out = HEADER + '\n' + body.rstrip() + TAIL

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, 'w', encoding='utf-8', newline='').write(out)

    print('生成 %s' % OUT)
    print('  源 script 行数 %d -> 输出 %d 行 / %d 字节'
          % (src_lines, out.count('\n') + 1, len(out.encode('utf-8'))))


if __name__ == '__main__':
    main()
