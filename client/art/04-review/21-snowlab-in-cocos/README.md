# 21 · snowlab 接进 Cocos（2026-10-29）

## 一句话

`prototype/snowlab.html` 的 7000 行玩法原样抽成 `SnowlabRuntime.ts`，
由 `SnowlabBattle.ts` 挂成 DOM 叠加层 —— 和 grove 同一条已踩通的路。
**玩法代码一行没改，逐帧坐标 0 偏差。**

## 图

`01-抽取后的运行时画出的一帧.png` —— 这不是原型截的，是**抽取产物的第一帧**：
`@napi-rs/canvas` 当画布 → `snowlabAttachCanvas` → `snowlabBoot(7)` → 30 帧 → `snowlabRender`。
也就是 Cocos 组件每帧做的事，一模一样（差一步 window 上的键盘监听）。
主角贴图、三只敌人、厚涂天空、HUD 全在 —— 说明 `INLINE_ART` 那条解码路径真跑了。

## 怎么切过去

`assets/scripts/BattleBoot.ts` 第 33 行：

```ts
const MODE: 'grove' | 'snowlab' | 'mow' = 'grove';   // 改成 'snowlab'
```

进战斗场景就换成雪人关卡。三套玩法都还在，谁也没被删掉。

## 三个文件

| 文件 | 是什么 |
|---|---|
| `assets/scripts/snowlab/SnowlabRuntime.ts` | 生成物（344KB）。物理/关卡/裹球/推球/绘制，7000 行 |
| `assets/scripts/snowlab/SnowlabArt.ts` | 生成物（259KB）。5 张内嵌贴图，从 html 的 `<script id="art-*">` 原样搬来 |
| `assets/scripts/snowlab/SnowlabBattle.ts` | 手写组件（200 行）。挂画布 / 驱动 tick / Esc 回主界面 |

改玩法仍然改 `prototype/snowlab.html`，然后：

```
python client/tools/extract_snowlab_runtime.py
node   client/tools/snowlab-runtime-check.js     # 必须 14 项全绿、0 偏差
```

## 为什么贴图是内嵌的，不像 grove 那样走 resources.load

- snowlab 的敌人图在 `assets/snowlab/foe/`，**不在 `assets/resources` 下**，
  `resources.load` 读不到；搬过去要走编辑器 import 生成 `.meta`。
- 原型里本来就是内嵌的（为了让用户双击就看到贴图版），原样搬 = 像素级一致，
  也不会再出现「评审图有贴图、真机是代码图形」那条静默不一致。

代价：仓库多了 259KB 的 base64 生成物。它是生成物，不进 review。

## 还没做的（如实说）

- **只有 Web 平台能跑**。原生/小游戏没有 DOM，要重写渲染层（~2500 行 ctx 调用）。
- **主角写死 `cat`**。主界面选了别的角色，进雪人关卡还是猫 ——
  因为内嵌的只有 `pet-cat` 一张。要接的话得把 `HERO_ID` 变成参数、
  并把六只的图都内嵌（或改走 resources）。
- **没有存档结算**。grove 那套果子/材料/评级挂在它的 `S.trip` 上，
  snowlab 现在没有经济系统，回主界面什么都不写。
