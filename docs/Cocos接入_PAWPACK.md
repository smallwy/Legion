# PAWPACK 接入 Cocos Creator 3.8.8

> 2026-10-21 · 用户要求：「你能做到 cocos 里面吗 我通过 cocos 看」

---

## 一句话

主界面已经落成 **Cocos Creator 工程里的一个真实场景**（`Home.scene`），不是效果图。工程根就是 `D:\Legion\client`，双击 `打开Cocos工程.bat` 即可。

**但要先讲清一件事**：这个场景里**没有交互脚本**（呼吸、蹦跳、点击反应）。那些属于运行时代码，不在我的交付范围。**能动的版本在 `client/prototype/game.html`**，Cocos 这边目前是「资产 + 摆位 + 九宫格」都到位、逻辑层待接。

---

## 怎么打开

### 方式一（推荐）：双击

```
D:\Legion\client\打开Cocos工程.bat
```

首次打开要 **1–3 分钟**：编辑器会导入全部资源并生成 `library/`。第二次起十几秒。

### 方式二：Cocos Dashboard

`添加项目` → 选 `D:\Legion\client` → 打开。

**进去之后**：资源管理器里双击 `assets/scenes/Home.scene`，看层级管理器应该是 `Canvas → Camera / BG / Pets / HUD / Dock / Title`。

---

## 场景结构（已生成）

| 节点 | 尺寸 / 位置 | 说明 |
|---|---|---|
| `Canvas` | 1280×720，pos (640, 360) | UITransform + Canvas + Widget，`alignCanvasWithScreen` |
| `Camera` | orthoHeight **360**，投影 **正交** | 像素 1:1，UI 不会被透视拉斜 |
| `BG` | 1280×853，pos **(0, −26.5)** | 对应网页 `#bg { top:−40; height:853 }` |
| `Pets` ×6 | 见下表 | **锚点 (0.5, 0) = 脚底中心** |
| `HUD-Progress` | 320×52，pos (−60, 320) | 九宫格 Sliced，border 24 |
| `HUD-Tip` | 300×52，pos (307, 320) | 同上 |
| `Dock-Bar` | 1280×82，pos (0, −299) | 九宫格 Sliced |
| `Btn-Go` | 512×68，pos (363, −304) | 金色九宫格，border 34 |
| `Title` | — | 「吧唧军团」 |

### 六只的落位

锚点统一 `(0.5, 0)`（脚底中心），所以**换立绘不会漂** —— 这是立绘合成的第一原则。

| 宠物 | Cocos pos | 尺寸 | 网页原值 |
|---|---|---|---|
| 砂糖 | (−150, 204) | 52.4×82 | cx490 / footY156 / h82 |
| 年糕 | (−390, −240) | 107.4×146 | cx250 / footY600 / h146 |
| 团子 | (76, −238) | 108.4×136 | cx716 / footY598 / h136 |
| 雪团 | (−190, −236) | 54.9×126 | cx450 / footY596 / h126 |
| 豆奶 | (222, −232) | 118.8×136 | cx862 / footY592 / h136 |
| 星屑 | (508, −236) | 73.3×112 | cx1148 / footY596 / h112 |

宽度不是拍的：`宽 = h × 原图宽高比`，从 `_cocos-assets.json` 里读真实比例算。

---

## 坐标换算（以后加节点照这个来）

网页版是**左上原点、y 向下**；Cocos 是**Canvas 中心原点、y 向上**。只差一个变换：

```
cocosX = webX − 640
cocosY = 360 − webY
```

`BG` 那个 −26.5 就是这么来的：网页占据 `y ∈ [−40, 813]`，中心 386.5，`360 − 386.5 = −26.5`。

**不要重新目测**。上一轮我肉眼读栅格图换算，徽标偏了 40–70px，最后靠颜色分割才量准。

---

## 九宫格参数（Cocos 的写法和别家不一样）

Cocos 的 `SpriteFrame` 用的是**具名四值**，不是位置序列：

| 资源 | borderLeft | borderRight | borderTop | borderBottom | 圆角 | 尺寸 |
|---|---|---|---|---|---|---|
| `panel-cream` | 24 | 24 | 24 | 24 | 22 | 96×96 |
| `btn-gold` | 34 | 34 | 34 | 34 | 30 | 128×128 |

这三个数字是硬约束，不能随手改：

1. **border > 圆角**（24 > 22 / 34 > 30）。反了，四角会被拉伸成椭圆。
2. **顶部高光 / 底部内阴影必须落在 border 区内**。落进中间那一格，横向一拉就变成一条贯穿的白带。
3. **尺寸 ≥ border×2 + 可见拉伸区**。96 = 24+48+24，中间留 48 才拉得动。

> 顺带澄清一个常见误解：**Cocos 不存在「border 顺序」问题**，因为它是具名赋值。真正有顺序差异的是 Unity（左下右上）。所以跨引擎交付时我一律写四个具名值，由引擎去排 —— 写序列必然有人接反。

九宫格验收图见 `client/shots/_nine-slice.png`（青色虚线就是 border 切口）。

---

## 资源清单

```
client/assets/
├── scenes/
│   ├── Home.scene            12 个节点 / 11 Sprite / 5 Label
│   └── Home.scene.meta
└── ui/home/
    ├── bg.png                1536×1024
    ├── panel-cream.png       96×96    border 24
    ├── btn-gold.png          128×128  border 34
    ├── pets/                 ×6  高 640（透明底）
    └── heads/                ×6  160×160
```

每个 PNG 都手写了 `.meta`，uuid 固定。**这点很重要**：`scene` 里引的是 `<uuid>@f9941`，如果 meta 不存在，编辑器会生成随机 uuid，场景里的图就会变成白块。

`texture` 子资源 id 固定为 `6c48a`、`spriteFrame` 固定为 `f9941` —— 这是 Cocos importer 的确定性约定（我在现成工程里核对过 6 张图，全部一致），所以可以放心手写。

---

## 验证到什么程度（不夸大）

| 项 | 状态 |
|---|---|
| scene JSON 可解析 | ✅ |
| 全部 `__id__` 引用有效 | ✅ |
| 父子双向一致 | ✅ |
| 组件都挂在声明的节点上 | ✅ 抓出真错误 ①（BG 的 UITransform 漏挂） |
| 资源 uuid 全部存在 | ✅ 11 个引用全命中 |
| Canvas 组件齐全、尺寸 1280×720 | ✅ |
| 正交相机 orthoHeight=360 | ✅ |
| 58 个 `_id` 唯一 | ✅ |
| 场景 uuid 三处一致（meta / settings.scene / scene._id） | ✅ |
| **编辑器里实际打开** | ❌ **未验证** |

最后一行要说实话：我在沙箱里启动了 `CocosCreator.exe`，进程 12 秒后被回收（Cocos 启动要 20–60 秒），工程目录没生成 `library/`，说明它没跑到加载工程那一步。**这是环境限制，不是工程问题，但也不等于工程一定没问题。**

所以：**请你在桌面上双击那个 bat，看一眼场景。如果编辑器报错或场景空白，把控制台截图给我，我按报错修。**

### 自检抓到的两个真错误

**① `BG` 的 `UITransform` 漏挂** —— 只挂了 `cc.Sprite`。背景没有尺寸和锚点，编辑器里会定位失败。肉眼看不出来。

**② 场景 uuid 每次生成都会变** —— `settings/v2/packages/scene.json` 里的 `current-scene` 立刻指向一个不存在的场景。后果是**双击打开后是空场景，而且不报错**。

修法：`make-scene.js` 现在先读已有 `Home.scene.meta` 的 uuid 复用，每次生成完再同步 `scene.json`。三处（meta / settings / `scene._id`）必须永远一致。

自检脚本可以随时重跑：

```bash
cd client/tools
node verify-scene.js      # 12 项结构自检
node make-scene.js        # 重新生成场景（改完坐标表后跑）
node build-nine-slice.js  # 重新生成九宫格母版
```

---

## 明确没做的（都不是漏项，是分工）

| 没做 | 为什么 |
|---|---|
| 呼吸 / 蹦跳 / 点击反应的脚本 | 引擎运行时代码，不在交付范围。**去 `game.html` 看效果** |
| 图鉴 / 选宠 / 喂养等二级页 | 还需要先定版式规格 |
| Label 的自定义字体 | 现在用系统字体（Arial）。中文在 Cocos 里可能不稳，正式版要挂 TTF 或 Bitmap Font |
| 图集打包 | 13 张图直接引用。等到要合批再打 |

**如果打开后控制台出现 TypeScript 报错**：`assets/scripts/battle/` 下是既有的战斗脚本，与主界面无关，不影响你查看场景。

---

## 下一步建议

1. **你先打开确认场景长什么样** —— 这是唯一能推翻我上面所有推断的一步。
2. 确认没问题后，我把 **Dock 的 6 个伙伴位 + 资源卡** 也搭进去，让主界面在 Cocos 里是完整的。
3. 之后才轮到交互脚本（那需要 `cocos-engine-expert`，不是我做）。
