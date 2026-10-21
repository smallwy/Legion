# client/concept —— 正式概念图（v2「棉花糖」）

六张 UI/立绘概念图，用 `@napi-rs/canvas` 离屏渲染。**不是手绘死图**：改参数重跑，六张同步变。

> v1「糖果纸」脚本（`concept-shot.js` / 输出 `concept-*.png`）**已废弃**，仅保留作历史对照。
> 现行脚本是 `kit2.js` + `concept2-shot.js`，输出 `concept2-*.png`。

## 为什么是代码画的

- AI 出图的中文必然糊，而 UI 概念图的全部价值就是"字怎么写、按钮多宽、几号字"
- 每个元素有确定坐标，可以直接抄进 Cocos；AI 图只能"看着差不多"
- 立绘和游戏内用同一个 `drawPal()`，不是两张皮
- 矢量资产不算 AI 生成，规避 Steam 的 AI 披露标签

## 运行

```bash
export PATH="/c/Users/yu.wang/.workbuddy/binaries/node/versions/22.22.2-6:$PATH"
export NODE_PATH="C:/Users/yu.wang/.workbuddy/binaries/node/workspace/node_modules"

node client/concept/concept2-shot.js                       # 出全部六张
ONLY=sheet node client/concept/concept2-shot.js            # 只出立绘谱
ONLY=meadow,well,tower node ...                            # 只出三关
ONLY=home,result node ...                                  # 只出家园 + 结算
```

`ONLY` 的可选值：`sheet` `home` `meadow` `well` `tower` `result`

输出到 `../shots/`：

| 文件 | 内容 |
|---|---|
| `concept2-0-立绘谱.png` | 六只大图 + 剪影检验 + 四态 + 材质/稀有度说明 |
| `concept2-1-家园.png` | 家园主界面（养成循环四件套 + 底部整条 HUD） |
| `concept2-2-战斗-草甸.png` | 第 1 关 · 横向 · 教「推」 |
| `concept2-3-战斗-深井.png` | 第 5 关 · 纵向 · 教「落」 |
| `concept2-4-战斗-高塔.png` | 第 8 关 · 阶梯 · 教「绕」 |
| `concept2-5-结算.png` | 过关结算（S 奖章 + 这一趟的账 + 两个出口） |

## 结构

```
kit2.js                              ← 设计 token + 立绘（唯一来源）
  ├─ T / F / rr / fs / shadow / card / btn / text / textO / blob / star
  ├─ PALS / ORDER                    ← 六只：配色 + 体型 + 脸型 + 材质 + 稀有度
  ├─ headPath(g,cx,cy,rx,ry,chin)    ← 头形（六只不共用圆）
  ├─ bigEye(g,cx,cy,R,ink,o)         ← 大眼睛三要素（竖椭圆/双高光/下缘蓝反光）
  ├─ eggBody()                       ← 蛋形身体
  ├─ drawPal(g,key,footX,footY,h,mood,opt)   ← 立绘，可移植进 grove.html
  └─ rarityTag()

concept2-shot.js                     ← 四类画面
  ├─ silhouette()                    ← 剪影检验（读像素染色）
  ├─ wantBubble / finger / hut / bed / bowl / fence / tree2 / toyBall
  ├─ drawSheet / drawHome
  ├─ hud(g,o) + STAGES{meadow,well,tower}   ← 一套 HUD 适配三种空间
  └─ drawResult
```

## 规格说明

坐标、层级、切图规则、脸型/体型/稀有度表、家园养成循环、三关空间对照，
全在 **`docs/UI_概念设计_PAWPACK_v2.0.md`**。改图前先读那一份。

v1（已废弃）：`docs/_归档-UI_概念设计_v1.0-糖果纸版.md`

## 注意

- `drawPal()` 的 `footY` 语义和 `grove.html` 的 `p.y` 一致（脚底），移植时不用换算
- 改立绘比例时**必须重跑剪影行**，否则会悄悄退化成"六个一样的雪人"
- **配件不能画在脸内部**（v1 的猫毛尖画在脸上，读成"被蚊子咬了两口"）。区分靠体型 + 材质 + 脸形，配件只做点缀
- 任何"贴在身体旁边"的附件（卷尾、巨尾）都要检查剪影：贴在头旁会读成"耳朵上套了个环"
- **同一个特征不能有两种画法**。狐原来常态是闭眼弧线、满饱才是大眼球，结果六只里只有它没有眼白；
  现在六只常态一律 `bigEye()`
- **UI 元素不能贴到角色身上**。家园的手指光标原本在年糕头右缘外 9px，读成"狗竖起一根手指"；
  气泡/光标/飘字都要留出至少 40px 净距
- **谱上每格的 `clip` 会裁掉"超常规的那一件"**。狐的巨尾甩到 `cx±137`，半宽 96 的 clip 直接把它裁没了——
  而"尾巴比身子还大"正是它作为传说位的唯一理由。放宽 clip 或镜像，别让规格图自己骗自己
- 中文字体靠 `GlobalFonts.registerFromPath` 显式注册微软雅黑；换机器若缺字体，文字会退化成方框

---

## v3 混合生产（2026-10-21）

**v2 是纯矢量，用户反馈「像贴上去的」。** 这不是参数问题，是生产方式的天花板。

### 新增脚本 `concept3-shot.js`

职责：把 **AI 背景图** 与 **矢量 HUD** 合成为一张图。

```
NODE_PATH=<managed>/node_modules node client/concept/concept3-shot.js
  → client/shots/concept3-1-家园-AI混合.png
```

依赖 AI 原图放在 `client/shots/_ai-bench/`，文件名写死在脚本里 —— 换图要改路径。

### 试错记录（两条，别再踩）

1. **底部雾 148px / `.94` 实心 → 把整个前景花层压成一片米色，景深白做了。**
   雾的职责是让控件「有落脚处」，不是盖住画面。收到 116px / `.80`。
2. **左上 340×112 的今日目标方卡 → 正好压在小屋屋顶上**，卡片边缘和红白条纹交错，
   读成「贴错了位置」。改成顶部横贯信息条（走天空区域），薄条不和场景体积打架。

### 最重要的一条

**角色锚定的 UI 元素（气泡 / 光标 / 飘心 / 伤害数字），前提是角色坐标可控。**

第一版把气泡、飘心、手指按 AI 图上「兔子」的位置摆好（估的 y 185–275）。
渲染出来发现兔子实际在 **y > 330**（缩略图里把 display 坐标当成了原图坐标），
只露两只耳朵，身体被底部 HUD 吃掉。气泡落在空草地上，手指悬在路牌边，
读成一个白色胶囊 —— **比原来的贴纸感更糟**。

→ **AI 出整张场景 = 坐标随机 = 所有贴着角色的 UI 必然落空。**
→ 角色必须单出（透明底），坐标由脚本按栅格定。

完整规范见 `docs/混合生产管线_PAWPACK_v3.0.md`。


---

## v4 AI 立绘 + 行为动效（2026-10-21 下午）

### 新增脚本

| 脚本 | 职责 | 输出 |
|---|---|---|
| `chromakey.js` | 品红底 → 透明底 RGBA，自适应阈值 + despill + 去噪 + 裁边 | `client/shots/ai/*.png` |
| `_size-test.js` | 五档尺寸 + 剪影检验 | `client/shots/_ai-bench/_size-test.png` |
| `_roster.js` | 六只验收合集（彩色 / 剪影 / 四档尺寸 / 稀有度） | `client/shots/ai/_roster.png` |
| `concept4-motion.js` | 宠物行为动效分解（被摸反应 + 自主行为 + 三层栈） | `client/shots/concept4-动效分解.png` |

### 三条硬规矩（都是踩出来的）

1. **`background:"transparent"` 不可用**。AI 会把"透明"画成灰白棋盘格底纹。
   必须纯品红 `#FF00FF` 出图 + 程序键控。
2. **键控阈值不能写死**。AI 不保证输出纯品红，实测四只是 `rgb(215,50,142)` 暗品红，
   固定阈值会留一层 54% alpha 的淡紫，包围盒撑满全图。
   改成 `sampleBg()` 采样四边中位数 → `LO=score0×0.50 / HI=score0×0.78`。
3. **姿态模板本身就是同质化**。六只都用"站正 + 举爪 + 领巾 + 呆毛"，就是六次换色。
   画风锁统一，**姿态语言必须各不同**，且六只都朝正面（侧身会另需一套正面图）。

### 一个必须提前决定的技术分叉

单帧立绘**做不到**真走路循环（腿不动却平移 = 滑步）。两条路：
① 每只再出 2–4 帧行走姿态（+12–24 张图，一致性风险高）
② **蹦跳式移动**（跳跃位移 + squash/stretch，0 张额外图）—— 已选 ②

移动参数写在 `docs/混合生产管线_PAWPACK_v3.0.md` §11.4。
