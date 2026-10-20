# 吧唧军团 / Munch Legion · Day 1 垂直切片（Cocos Creator 3.8+）

> 本目录是**可直接粘贴进 Cocos Creator 工程**的客户端源码。
> 交付形态说明（SC-002）：开发沙箱**无法运行 Cocos 编辑器**，所以这里给的是
> 「完整源码 + 组装说明」，你在本机 Dashboard 建项目、拷 `assets/`、挂一个组件即可跑起来。
>
> 对应《排期台账_PAWPACK》**Day 1 · 单宠自动战斗**。
> 验收线：**能玩 30 秒不死 · 60FPS · DrawCall < 20**。

---

## 一、5 分钟组装步骤

### 1. 建空项目
Cocos Dashboard → **新建项目** → 选 **Empty (2D)** 模板，命名如 `MunchLegion`，**引擎版本 3.8.x**。
（必须 3.8+：本项目用到的 `screen` 属性、`Graphics` 合批语义均以 3.8.0 引擎源码核实。）

### 2. 拷贝资源与脚本
把本目录的两块内容拷进新项目：

```
本目录 assets/resources/art/        →  新项目 assets/resources/art/
本目录 assets/scripts/              →  新项目 assets/scripts/
```

拷完回编辑器等它自动导入（右下角进度条走完）。**不要**把 `tools/` 拷进去——那是沙箱侧的
预处理与静态检查脚本，不属于游戏工程。

### 3. 建场景 + 挂唯一组件
1. `assets/` 里新建场景 → 命名 `Battle` → 双击打开。
2. 层级面板右键 → **创建空节点**，命名 `Game`。
3. 选中 `Game`，属性检查器 → **添加组件** → **自定义脚本** → `GameBootstrap`。
4. 保存场景（Ctrl+S）。

> 整个 demo **只挂 `GameBootstrap` 一个组件**。相机、玩家、宠物、敌人、渲染器、HUD、
> 结算面板全部由代码运行时搭建，编辑器里不需要摆任何东西——方便整包迁移与参数复现。

### 4. 运行
点预览（浏览器 / 模拟器均可）。控制台应打印：
```
[GameBootstrap] 世界构建完成 · 占位精灵 已加载 · 操作：WASD/方向键移动 · E 撤离
```
如果是 `占位精灵 全部缺失（程序化兜底层）`，说明第 2 步的 `resources/art/` 没拷到位——
也没关系，程序会用几何图形兜底画出来（见 §4 容错策略）。

### 5. 可选项：把场景设为启动场景
`项目设置 → 项目数据 → 起始场景` 选 `Battle`，这样预览直接进战斗。

---

## 二、操作说明

| 操作 | 按键 | 说明 |
|---|---|---|
| 移动中心点 | `WASD` / 方向键 | 八向，斜向已归一化（不会斜着更快） |
| 提前撤离 | `E` 或 `Esc` | 立即结束远征、进结算（红线②：无失败惩罚） |
| 再次远征 | 结算时按 `空格` 或**点鼠标** | 全部实体重置、重新开一局 |
| 自动行为 | — | 宠物**自动索敌开火**；敌人按攻击/施法半径自动逼近与读条 |

玩法要点（对齐 CR-007 / CR-008 / CR-009）：
- 你只控**中心点**（金环+金点），宠物绕圈**自动施法**，你的走位决定"打谁、躲谁"。
- 怪物是**踩怪窝成批生成**（地图上 4 个绿圈）：进圈才激活，一窝 12 只。**不是从屏幕外追你**。
- 敌人有**攻击半径 60px**（红圈前摇，走开就躲掉）与**施法半径 140px**（橙圈读条，飞虫专属）。

---

## 三、目录结构

```
client/
├── assets/
│   ├── resources/art/          # 占位精灵（真像素：24/24/24/28px、≤14 色、1px 描边）
│   │   ├── pet.png             #   宠物（圆滚猪）
│   │   ├── enemy-walker.png    #   步行虫（绿）
│   │   ├── enemy-flyer.png     #   飞虫（红，远程施法）
│   │   └── enemy-tank.png      #   甲虫（灰蓝，厚血）
│   └── scripts/
│       ├── GameBootstrap.ts    # ★ 唯一入口组件（挂场景上）
│       ├── config/BattleConfig.ts   # ★★ 全部可调数值（调参只改这里）
│       ├── core/               # 无依赖工具层
│       │   ├── MathUtil.ts     #   clamp / lerp / TAU / 角度
│       │   ├── ColorUtil.ts    #   hexColor（含 alpha）
│       │   ├── ViewUtil.ts     #   当前宽高比 / 可见半屏尺寸（适配用）
│       │   └── Pool.ts         #   通用对象池（子弹/敌人/珠子零分配复用）
│       ├── battle/             # 战斗逻辑层（纯数据，不含渲染）
│       │   ├── BattleDirector.ts    #   阶段机/计时/撤离/结算 stats
│       │   ├── PlayerController.ts  #   WASD 中心点 + 相机跟随
│       │   ├── PetSquad.ts          #   环绕弹性跟随 + 三段施法状态机
│       │   ├── EnemyManager.ts      #   游走 AI + 攻击/施法半径 + 分离
│       │   ├── MonsterNest.ts       #   怪窝触发 + 成批刷新
│       │   ├── ProjectileManager.ts #   我方子弹 / 敌方弹道
│       │   └── OrbManager.ts        #   经验珠 + 磁吸拾取
│       ├── view/               # 渲染层
│       │   ├── SpriteAssets.ts      #   占位精灵加载（带容错）
│       │   ├── BackgroundRenderer.ts#   静态背景（1 DrawCall，只画一次）
│       │   └── EntityRenderer.ts    #   ★ 批量实体渲染器（全场动态物 1 DrawCall）
│       └── ui/
│           ├── BattleHud.ts         #   血量心 + 统计文字（10Hz 节流）
│           └── SettlementPanel.ts   #   结算面板
├── art-source/256px/           # 原始 AI 厚涂稿归档（不入包；回滚用）
├── docs/pixel-preview.png      # 像素化前后对比图
├── tools/                      # 仅沙箱侧使用，不要拷进游戏工程
│   ├── preprocess_sprites.py   #   原始占位图抠透明 + 生成敌人配色变体
│   ├── pixelize_sprites.py     #   ★ 降成真像素：量化色板 + 硬边 + 1px 描边
│   ├── cc-stub.d.ts            #   cc 模块类型桩（离线类型检查用）
│   └── tsconfig.check.json     #   静态检查配置
├── package.json                # 工程描述（供参考；新项目由 Dashboard 生成）
└── README.md                   # 本文件
```

---

## 四、DrawCall 预算（验收线 < 20）

**关键设计**：全场**所有动态实体共用一个 `Graphics` 组件**。

已用 **3.8.0 引擎源码核实**：`Graphics` 组件内多次 `fill()/stroke()` 会合并进**同一个 mesh**，
一个 `Graphics` 组件 = **1 个 DrawCall**（65535 顶点以内）。（读 `graphics-assembler.ts` 的
`stroke()/fill()` 与 `batcher-2d.ts` 的 `walk()` 得出。）

对比：如果每个敌人一个 `Graphics`，同屏 28 只敌人 = 28+ DrawCall，直接爆验收线。

静态估算：

| 来源 | DrawCall | 备注 |
|---|---|---|
| 背景 `BackgroundRenderer` | 1 | 静态，只画一次 |
| 动态场 `EntityRenderer` | 1 | 敌人兜底体 + 前摇圈 + 子弹 + 珠子 + 怪窝 |
| 玩家金环 | 1 | 独立 Graphics |
| 宠物精灵 | 1 | `pet.png` 一张贴图 |
| 步行虫精灵 | 1 | `enemy-walker.png` |
| 飞虫精灵 | 1 | `enemy-flyer.png` |
| 甲虫精灵 | 1 | `enemy-tank.png` |
| HUD 文字 + 血量 | 2 | 1 Label + 1 Graphics |
| 结算面板 | ~2 | 仅在结算时激活 |
| **合计** | **≈11** | 结算未弹出时 ≈9 |

> ⚠️ **验证方式**（我无法在沙箱实测，必须你本机确认）：
> 预览时打开左下角 **Profiler** → 看 `Draw Call` 与 `FPS`。
> 预期 FPS 稳定 60、DrawCall 在 10 上下。若明显偏高，最可能是 4 张占位精灵各占 1 次
> （不同贴图不合批）——把 `art/` 下 4 张图做成一个 **Auto Atlas**（编辑器：右键图片 →
> 属性检查器改导入为 `sprite-frame` → 建 Auto Atlas 资源把 4 张拖进去）即可再降。
> 这属于 **Day 2 优化项**，Day 1 不阻塞。

### 4.1 像素风的两个硬性设置（不做就必糊）

占位精灵已按 **工作分辨率 24/24/24/28px、≤14 色、1px 描边** 重做（`tools/pixelize_sprites.py`），
显示尺寸 = 工作分辨率 **×2**（48/48/48/56），保证整数倍放大。但引擎侧还有两件事必须做：

| # | 设置 | 位置 | 不做的后果 |
|---|---|---|---|
| 1 | **Filter Mode = Point** | 选中 `resources/art/` 里 4 张图 → 属性检查器 → `Filter Mode` 改 **Point** | 默认 Bilinear 会把像素插值成糊块，24px 变成"毛玻璃" |
| 2 | **关闭 Mipmap**（如开启） | 同上，`Generate Mip Maps` 取消勾选 | 远景自动降采样，像素颗粒随机跳变 |

> 为什么不用代码调：Cocos 3.8 的 `Filter` 枚举公共导出路径在不同小版本上不一致
> （3.8.0 源码里 `asset-enum.ts` 未被 `cc` 重导出，但 `Texture2D.setFilters()` 本身存在），
> 编辑器设置最稳、不挑版本。若你确认本版本有 `Texture2D.Filter`，也可在 `SpriteAssets` 里补：
> `tex.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST)`。

**美术轻量化的实测数据**（本次转换前后）：

| 维度 | 转换前 | 转换后 | 降幅 |
|---|---|---|---|
| 单张分辨率 | 224×189 / 256×256 | 24×20 / 24×24 / 28×28 | — |
| 单张颜色数 | 15,915 ~ 24,817 | 14 ~ 16 | **-99.9%** |
| 4 张文件总体积 | 290.3 KB | **3.4 KB** | **-98.8%** |
| 纹理显存（未压缩 RGBA） | 933 KB | **9 KB** | **-99%** |

> 原始 256px 厚涂稿已归档到 `client/art-source/256px/`（**归档≠删除**，随时可回滚）。
> 重跑转换：`python client/tools/pixelize_sprites.py`；对比图输出到 `client/docs/pixel-preview.png`。

⚠️ **必须说清的局限**：这是**自动降采样的占位**，不是手工像素画。24px 已低于原设计的
细节下限，飞虫/甲虫在放大 8 倍看时面部仍是糊的。**屏幕上按 ×2 显示时能读成"Q 萌小怪"，
够验证玩法与手感；正式美术仍需人工按美术指引 §7/§8 重画（30–60 分钟/只）或外包。**

---

## 五、调参入口（只改 `config/BattleConfig.ts`）

所有数值集中在这一个文件，改完**重启预览即生效**，无需动其他脚本。
文件内标记：`★` = 计划书 §2.7 明确规定；`△` = 计划书未定、Day 1 试玩暂定值（验证后回写计划书）。

| 关注 | 常量 | 当前值 | 说明 |
|---|---|---|---|
| 战场尺寸 | `FIELD` | 2400×1350 | 世界单位，1 单位 ≈ 1px |
| 相机 | `CAMERA` | viewHeight 540 | 正交；`followLerp` 越大越跟手 |
| 玩家 | `PLAYER` | HP 6 / 速度 190 | 受击无敌帧 0.8s（△ 防秒杀） |
| 宠物 | `PET` | 1 只 / 火力 10 | `count` 改 3 即 Day 2 三宠（**不用改代码**） |
| 宠物施法 | `PET` | 前摇 .25 / 施法 .1 / 后摇 .3 | ★ CR-009 三段链路 |
| 敌人 | `ENEMIES` | 3 种 | 攻击半径 60 / 施法半径 140 / 前摇给反应窗口 |
| 怪窝 | `NEST` | 4 窝 × 12 只 | `batch` 一批数量；`respawnDelay` 清空后刷新冷却 |
| 同屏上限 | `BATTLE.maxAlive` | 28 | 性能预算；满了暂停刷新 |
| 远征时长 | `BATTLE.durationMs` | 180000 (3 分钟) | ★ |

**Day 2 「半饿最强」挂钩点已预留**：`PET.powerMultiplier`（半饿 1.5 / 满饱 1.0 / 全饿 0.6）。
Day 2 只需接饱食度系统去改这个值 + 触发金环特效，战斗公式与渲染都不用动。

---

## 六、已知简化 & 与计划书的差异（诚实清单）

1. **施法时长矛盾（需你拍板）**：计划书 §2.7 同时写「总攻速 **2.2 次/秒**（≈0.65s/轮）」，
   但 0.65s/轮实际只有 **1.54 次/秒**，两者对不上。
   本实现按 **CR-009 的三段时长**（前摇 0.25 + 施法 0.1 + 后摇 0.3 = **0.65s/轮 = 1.54 次/秒**）。
   若要精确到 2.2 次/秒，把 `PET.recovery` 从 `0.3` 改 `0.1`（总 0.45s/轮 = 2.22 次/秒）。
   **待你确认后回写计划书 §2.7。**

2. **Day 1 只出 1 只宠**（排期规定）。系统已按 N 只写好（环绕角度/半径自动均分），
   Day 2 把 `PET.count` 改 `3` 即可，无需改任何逻辑代码。

3. **资源映射是暂定值**：结算面板「食物 = 经验珠数、材料 = floor(击杀/2)」是临时约定，
   等 Day 3 家园资源池接线后回写。

4. **占位美术是"轻量化占位"，不是成品**：`resources/art/` 的 4 张精灵由 AI 占位图
   （`assets/placeholder/sprite-*-v2.png`）经 `preprocess_sprites.py` 抠透明 →
   `pixelize_sprites.py` 降成真像素（24/24/24/28px、≤14 色）。**仅内部试玩**，发布前
   必须人工重画或外包替换（美术指引 §11 已声明）。自动降采样能压体积、能统一风格，
   但**压不出好的像素画**——24px 下飞虫/甲虫的面部细节已损失，别拿它当验收美术。

5. **坐标系说明**：所有玩法节点在 `z = 0~100`，相机的 `z = camZ(1000)`、`near/far = 1/3000`，
   即「相机架高处朝 -z 看」。这是为了避开 3.x 里 `Canvas` 适配体系的耦合——本 demo **不用
   `Canvas` 组件**，直接用 `Camera(ORTHO)` + `UITransform`，`Widget` 适配由 `ViewUtil` 手算。

6. **2D 绘制顺序**：已核对 3.8 `Batcher2D.walk()` —— 按 children **遍历序**深度优先决定绘制优先级。
   因此代码把世界拆成**实体树**与**相机树**两棵：相机树整体挂在实体树之后，保证 HUD/结算永远在最上层。

---

## 七、离线静态校验（沙箱侧已做）

沙箱跑不了编辑器，但用 TypeScript 编译器 + `cc` 类型桩对**全部脚本**做了 `--strict` 检查：

```bash
cd client
"C:/……/node.exe" "……/typescript/bin/tsc" -p tools/tsconfig.check.json
# 结果：0 error
```

它抓出并修掉的**真 bug**（都是"粘贴才暴露"的类型/作用域坑）：
- `new Node('Field')` 误用浏览器全局 `Node`（GameBootstrap 漏从 `cc` 导入）→ 已修。
- `EnemyManager` 同模块重复 import / 未使用符号 → 已修。

**局限**：类型桩是我写的，只能验证**脚本之间的自洽**，无法替代真机运行。
运行时行为（数值手感、64 位浮点边界、平台差异）仍需你本机预览确认。

---

## 八、Day 2 / Day 3 衔接点（代码已留口）

| 计划项 | 本代码已预留的接口 |
|---|---|
| Day 2 三宠环绕 | `PET.count`（改数字即可） |
| Day 2 饱食度 + 半饿倍率 | `PET.powerMultiplier`（+ `Pet` 已支持状态字段） |
| Day 2 兴奋特效 | `EntityRenderer.drawPetRings()`（已画前摇金环） |
| Day 3 家园 Hub | 结算 `BattleStats` 已带 `kills/orbs/timeMs/endReason`，接资源池即可 |
| Day 3 关系网 | 宠物已是数组实体，加"相邻加成"只需在 `PetSquad` 里按位置算系数 |

---

## 九、动手前请确认

- [ ] 引擎是 **3.8.x**（不是 3.7 及以下）——本项目 API 按 3.8.0 核实。
- [ ] `assets/resources/art/` 4 张图已导入（否则走程序化兜底，也能跑，但看不到形象美术）。
- [ ] 场景里只挂了 `GameBootstrap`，且 `Game` 节点在场景根下（不要嵌套在 Canvas 里）。
- [ ] 首轮跑完把 **Profiler 的 FPS / DrawCall** 读数发我，作为 Day 1 验收凭据。

---

*本目录代码由「银橙AI · Cocos 引擎开发专家」按立项计划书 Day 1 排期生成，2026-10-14。*
