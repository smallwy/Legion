# 26 · 出征页接上推球玩法（2026-10-30）

## 为什么做这一版

用户原话：**「最初的出征 又玩法界面 我需要你用上」**。

查下来的硬事实不是"入口不明显"，是**根本没有入口**：

| 检查项 | 结果 |
|---|---|
| `grove.html` 的 `GATES` | 只有 `trail`（苔原古道）/ `nest`（深巢无尽）两扇门 |
| `game.html` / `index.html` / `HomeRuntime.ts` 对 snowlab 的引用 | **0 次**（只有两行注释提到"和 snowlab 同步"） |
| snowlab 里的主线关号 | **不存在**。`STAGES` 表和 48 关骨架都在，但通关只是停在结算卡上按 R 换一张随机图 |

所以「48 关主线 + 六种骨架 + 深潜无尽」全部做完之后，玩家**一步都走不进去**。
这一版补的是这条链路本身，不是加内容。

## 四张图在验什么

| # | 画面 | 验的事 |
|---|---|---|
| ① | 出征页三扇门 | 第三扇门「雪原推球」进得来，卡面是新立绘，三张卡等宽等高 |
| ② | 副行报「第 24 关」 | 存档读得到。① 是「还没出发」、② 是「第 24 关」，同一份代码的两种状态 |
| ③ | 进关画面 | 进度芯片 = 「第 24 关」+ 骨架名「双井」；左下角有「← 出征」 |
| ④ | 通关结算 | 标题报关号，底部提示「Enter 进第 25 关 · R 重打本关」 |

## 落地的三件事

### 1. 第三扇门（`grove.html`）

```js
{ id: "snow", name: "雪原推球", sub: "把球顶进洞 · 一层层往下",
  art: "gate-snow", open: true }
```

立绘 `assets/resources/grove/gate/snow.png`（768×432），风格和前两张对齐
（Q 版卡通厚涂、左上光源、暖木棕 + 橘黄灯 + 冷蓝雪影）。
`GroveBattle.ts` 的 `ART_MANIFEST` 同步加 `['gate-snow', 'grove/gate/snow']`。

**3 张卡时末卡贴边差 2px 是数学必然**：`floor((840-40)/3) = 266`，
800 不能被 3 整除。`GATE.w` 的注释里早就写明这是故意的（用 round 会超出 1px，
还会半像素错位）。旧断言要求 `=== 60`，两扇门时能过、三扇门必红 ——
**标准写错了，不是代码错**，改成容差 2px。

### 2. 主线关号链路（`snowlab.html`）

这一条是真正的缺口：没有关号，"48 关"就只是生成器的一个参数。

```js
stageSeed(n) = mix32(n * 0x9E3779B1)   // 关号 → 种子，可复现
startStage(n)  // 唯一换关出口：clamp(1..48) + reset + 存档 + 飘字
```

- **同关号必然同图**：第 7 关在谁的机器上都是同一张图，否则"我卡在第 7 关"没法复现、没法分享。
- **通关即推进**：`stepDoor` 里写 `stage: min(48, n+1)`，**不等玩家按 Enter** —— 打完直接关页面是常态。
- **48 关封顶**：写 49 会让出征页显示「第 49 关」，点进去被 clamp 回 48，一个玩家看得见的假数字。
- **R 的语义变了**：有关号之后 R = 重打本关（原来 = 换一张随机图）。有关号还换图，就是在破坏"第 7 关永远是第 7 关"。
- **Enter = 往前走**，和 R 分开。以前只有 R，因为那时"下一关"和"换一关"在玩家眼里是同一件事。

存档 `localStorage['pawpack.snow'] = { stage }`，grove 和 snowlab 各读一半 ——
两个独立 html 只能靠 localStorage 见面。

### 3. HUD 进度芯片（第二处"只有出图才看得见"）

| 版本 | 问题 |
|---|---|
| 原 `diveChip`(34 高) + `diveBest`(14 高) 上下相接 | 第二行**没有底板**，12px 灰黄字直接压在亮雪地上，基本读不出来 |
| 合并成 `progChip`(48 高，138 宽) | 「最佳 1234」这类五位数会贴边 |
| 最终 `progChip`(48 高，**164 宽**) | 主行 22px + 次行 13px，两行都在板内 |

主线报关号 + 骨架名，深潜报深度 + 最佳 —— **两个模式互斥，共用一块矩形**。
写成两个 key 会让「任两矩形不许相交」的断言直接红（同坐标必然相交），
那就变成断言在管一件根本不存在的冲突。

## 一个原型看不出来的坑：Cocos 里没有 snowlab.html

原型里点第三扇门是 `location.href = "snowlab.html?from=grove"`。
**Cocos 构建产物里没有这个 html** —— 那边推球是 `SnowlabBattle` 组件。
写死跳转的后果是：原型跑得好好的，打包之后点第三扇门白页 404，而且不报错。

所以入口做成了可替换的变量：

```js
let snowEntry = function () { /* 原型：真跳页 */ };
export function setSnowlabEntry(fn) { snowEntry = fn; }  // Cocos 侧换成"切组件"
```

## 验收

| 套件 | 结果 |
|---|---|
| `_snowlab-check.js` | **297 / 0**（+第四十五组「主线关号」14 条） |
| `_snowlab-floor.js` | 16 / 0 |
| `_snowlab-jump.js` | 4 / 0 |
| `snowlab-runtime-check.js` | 14 / 0（重抽 9646→9796 行） |
| `grove-smoke.js` | 1488 / 0 |
| `grove-runtime-check.js` | 39 / 0 |
| `ts-syntax-check.js` | 4 / 0 |

新增的 14 条断言里有 4 条是**做过变异测试的**：把修复改回旧写法必须变红。
第 48 关那条尤其重要 —— 它差一点就是假通过（门被箱子埋着、`stepDoor`
直接 return，而"存档还停在 48"照样成立），所以补了「先确认真的进门了」。

## 复现

```bash
NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules" \
  node client/tools/_entry-shot.js          # 出征页 → 进关 → 通关 三张
NODE_PATH=... node client/tools/grove-shot3.js portals:0 portals:2:snow
```

出图工具 `_entry-shot.js` 是本轮新写的：`_floors-shot.js` 那套走离屏 canvas，
验的是**关卡内容**；这一套走真浏览器 + 真 URL，验的是**入口本身**
（`?from=grove` 的返回钮、存档读关号、同关号同种子）。
