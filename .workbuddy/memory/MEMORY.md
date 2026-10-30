# PAWPACK 项目长期约定（索引）

> 只留硬规矩。长篇（宪法 / 机制 / 表现层 / 美术 / 弹三成因 / 关卡曲线）在 `DETAILS.md`。

## 版本控制
- `D:/Legion` = git，`main` ← `origin`（smallwy/Legion）。
- **做完直接 commit + push，不问、不等确认**；提交信息写「为什么改」+ 踩的坑。
- **代理端口每次会变，推前先探**（2026-10-30 全 000、直连 200）。git 里硬写了
  `http.https://github.com.proxy=7897` 会盖掉环境变量 → `git -c "http.https://github.com.proxy=" push origin main`。

## 环境
- Cocos 3.8.8 在 `C:/ProgramData/cocos/editors/Creator/3.8.8`；沙箱启不了预览，验收走出图/断言。
- 依赖按 `$HOME` 展开（两台机器分别是 `yu.wang` / `汪宇`）：`NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules"`。
- 离屏出图读**编译产物**，改完 `.ts` 先跑 `node tools/build-rt.js`（清空 `_rt-build` 再 tsc）。
  **别直接 `tsc -p tools/tsconfig.homeruntime.build.json`** —— 它只增不删，
  2026-10-30 实测那份产物停在 10-23，`Roster.heroIndexOf`（10-27 加的）根本不在里面，
  下游检查却一片绿。
- Cocos 常驻后台会回写 `Home.scene` / `.meta`：提交前确认 diff 是**纯增量**。

## 两条铁律
- **原型是唯一真源**：改 `prototype/*.html` → 跑 `extract_*_runtime.py` 重抽。直接改 `.ts` 会被覆盖，且**生成物过期不报错**（曾在 `cce5c23` 停四轮）。
- 抽取脚本锚点**别用整段字面量**（原型一改就「命中 0 次」，生成物停在上版还不报错）。只锚首尾两行、用正则。
- **仓库存 LF、工作区 CRLF**（`core.autocrlf=true`）：替换串按工作区行尾写，否则 `assert count==1` 炸。

## 验收工具
| 目标 | 命令 |
|---|---|
| snowlab 结构+玩法 | `_snowlab-check.js`（425 项） |
| 运行时等价 | `snowlab-runtime-check.js`（14 项 / 900 帧 0 偏差）、`grove-runtime-check.js`（39 项） |
| 玩法冒烟 | `grove-smoke.js`（1501 项） |
| **跨模块导出** | `import-export-check.js`（39 文件 / 0.2 秒，**提交前必跑**） |
| **组件挂载 + 换手** | `_battle-mount-smoke.js`（cc 桩 + 真画布，验「点出发不黑屏」「点第三扇门能换到推球」） |
| 出征页门接线 | `_entry-wire.js`（11 项） |
| 难度离散 / 形状 | `_diff-audit.js [N]`、`_shape-probe.js [N]` |
| 行为 | `_jitter-probe.js`、`_foe-bounce.js`、`_ball-chaos.js` |
| 性能 | `_ab-perf.js`（同进程 A/B，**只看比值**） |
| 出图 | `_boss-shot.js`（终局四态+3 倍特写）、`_rooms-shot.js`（四场景地下同层对照） | `_floors-shot.js`（锁镜 + `BEFORE=`）、`_goal-shot.js`（三种目标 + 残球特写）、`_pairs-shot.js`（撞/合四格序列）、`_entry-shot.js`（真浏览器验入口）；**真立绘要 `ART=1`** |
| CJS 产物 | `build-rt.js`（**清完再编**；别直接 tsc，只增不删） |
| 存量对照 | `_legacy-audit.js`（只读，两套关卡参数表） |

TS 语法检查要用 **Cocos 自带 typescript**（隔离 workspace 里没装）：
`NODE_PATH="C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules"`。
它现在自动扫全部 39 个 `.ts` —— 以前写死 4 个，`SnowlabBattle.ts` 从没被查过。
**但 `transpileModule` 只查语法、不解析模块** —— 所以还需要 import-export-check。

性能尖峰先做**最小复现**（剥到只剩画布）—— 唯一能钉死「环境还是我们」。

## 场景主题 / BOSS（2026-10-30 第 3-4 批）
- 场景 = 5 样东西：`sky/脊色/deco/frame/mote` + `words` + `medium`（弹速/发数）。
  **只换背景图是最吃亏的**：动作节奏全不变，玩家只觉得在刷同一张图。
- **地下必须一起换。** 地表换色只覆盖开场两秒，90% 时间在四层房间里。
  `ROOM_RAMP` 每场景四档、混 68%；`let ROOM` 是"当前场景的表"，6 处引用不用改。
  → **换表不换位图等于没换**：墙预渲染进 `STATIC`，`applyTheme` 必须置空。
- BOSS 判据是**动量**不是"打中 N 发"；**球不消失只被弹开**（球是唯一通道，
  撞一次少一颗 = 第二次就死局）；它不还手不吐怪（压力来自球有寿命、会被弹开）。
- **摆位要扫全宽**：箱子按 48 网格排，132 宽的怪只进得了 144 的档，
  从某个 x 往一个方向退 16 会整段跳过唯一空档 → `boss=null`，
  而"没 BOSS"和"BOSS 坏了"外观完全一样。
- 圆判定 vs 方判定：圆形会把贴地滚来的球推到地板下面，且比画出来的大一圈；
  用 AABB + 最小穿透轴。
- 出图抠特写：**世界坐标要减 `S.cam.y`**；多格图要**画完当场抠**（否则四格
  全是最后一帧）。

## 常返工的坑
- 震屏唯一出口 `kickShake(px, key)`，峰值 8px；散落 `S.shake = Math.max` 会**重复点火**。`hitStop()` 同语义，小值调用是死代码。
- `b.y` 是**球底**不是球心。`wellClimb` 不许直接设坐标，走 `startClimb()`。
- 出图前手动调 `L.draw()`（rAF 被设 noop），否则全白不报错。
- 尺度：箱子 48 不动 / 玩家 45×63 / 敌人 ≤0.85 箱宽，形象与框同比例。
- 美术：Q 版 = 硬边色块（`foeCel`），**角色不要渐变**；光源统一左上。
- 推球**无条件给满速**（1209）；抵住会变 60Hz 冲撞，靠 `pushBlocked()` / `pushT`（回弹 8%）挡；**反弹不许比入射快**（×0.92）。
- 刷怪间距判据是**这段台面站得下几只**（`cap = 1+floor((段长−74)/110)`），不是比 x。
- 清残留节点用**后缀**；自启动脚本 `if (!EDITOR)` 守卫；12px 一空格只有 3px。
- **球与球**：碰撞按「重叠」判、**合体按「挨着」判（`minD+3`）** —— 位置分离会把两球
  推到正好相切，下一帧 `d < minD` 就不成立，计时逐帧清零 → 永远合不上。
- `drawBall` 必须过滤 `b.dead`，合体要**当场 splice 出数组**：一帧内死两颗加一颗，
  只标 dead 的话本帧会多画两颗（"合完了还站着原来的"）。
- **`@napi-rs/canvas` 的 `loadImage` 返回 Promise**，不是 Image；`.width` 直接取是 undefined。
  注入 Cocos `ImageAsset` 用 `data` 字段（`_toDrawable` 读的就是它），不是 `image`。
- **未解决**：每层装饰太满导致噪声，出生点有时在人缝里。

## 出征页 → 推球（`e1d4c93` / 0726 轮）
- 第三扇门 `snow` 跳 `snowlab.html?from=grove`。**Cocos 里没这个 html**（是组件），必须走
  `setSnowlabEntry(fn)`；写死 `location.href` 打包后白页 404。**传 null 必须能还原**，
  否则留一个指向已销毁组件的闭包。
- 关号 `stageSeed(n)=mix32(n*0x9E3779B1)`，存档 `{stage}` 记**下次从哪开始**；R 重打本关 / Enter 下一关，48 封顶。
- **Cocos 的入口是出征页**：`BattleBoot.DEFAULT_MODE='grove'` → `GroveBattle` →
  `groveBoot(…, fromHome=true)` → `openGates()`。主界面「出发」不再直接开打；
  `?mode=snowlab` 只给调试直连。`snowlab` 按 Esc 回出征页，出征页按 Esc 回主界面。
- 两套玩法换手走 `BattleSwitch.ts`（**中介，不许互相 import**）。
  `Component.destroy()` 是延迟销毁 → 必须等 `isValid` 变 false 再挂新的，
  否则两台 ClearCamera + 两块 DOM 层，症状是"画面定住"。
- **出征页只摆一扇门**（`GATES` = snow），grove 的 27 屏 / 深巢留在 `GATES_LEGACY`
  不摆出来。断言要测它们时**临时 `unshift(...GATES_LEGACY)`** ——
  「不摆出来」和「坏掉了」外观完全一样。单卡时 `GATE.scale` 必须回到 1（840×1.2 出画布）。
- **给 Cocos 用的函数必须 `export`**。原型里 `setSnowlabEntry` 只是文件内部用的，
  抽取时没加 export → `import` 拿到 undefined → **ESM 链接阶段就抛**，
  `addComponent` 拿不到类 → 一台相机都没建 → 点出发**纯黑屏、零日志**
  （连 onLoad 里的 log 都不打）。2026-10-30 实际踩到。
  → 凡是将要被 import 的名字，改原型时就想清楚，跑 `import-export-check.js`。

## 关卡目标（`2026-10-30` 第 2 步）
- 三种：`door` 破门 / `collect` 寻宝（挖出全部金箱，不看击杀）/ `limit` 省球（前 3 颗满球，之后残球）。
- **目标和星不许共用判据**：`nohit` 是星，就不能再当目标 —— 否则一件事数两遍。
  分工是「目标=准入条件，星=评价」。
- 分配 `floor((n-1)/6)%3`，和骨架 `(n-1)%6` **正交**；第 7 关 = 旧骨架 + 新目标。
- **省球不许硬禁**（球是唯一击杀通道，禁了就死局），改成残球寿命 ×0.45。
  额度按"造了几颗"数，**不按 `S.belly` 反推**（吃碎片会把额度刷回来）。
- **寻宝关的门开在 `breakBox`**，不是 `killFoe` —— 那只怪一只不打也能过。
- 残球**靠脏色 + 裂纹区分，不靠透明度**（雪地背景亮，0.66 alpha 缩图后看不出来）。

## 玩法存量（CR-032，`fa55eb2`）
- **规划前先盘点存量。** 这次漏了：48 关曲线做在 snowlab，而 `grove.html` 早有 27 屏手工关
  （**7 目标** / 81 星 / BOSS）+ 深巢无尽。漏因：顺着「最近在做什么」规划，没验证
  「snowlab 是主线」这个前提。已拍板 **snowlab 为下一代、grove 冻结不删**。
- **深潜 ≈ 深巢**：同源 `seed ^ (depth*7919)`，要合并成一份。深潜种子过 `mix32`（线性会半循环）。
- snowlab 48 关真形状：6 骨架 × 8 轮，**目标只有「进门」1 种**。三星已落地
  （`nohit`/`bigchain`/`clearout`），存**位**不存数组（浅合并会替换），配 `Math.max`；
  0 只怪关须判 `killedTarget>0` 防白送。详见 `docs/CR-032`。
- **出图工具不许自己造状态**：绕过 stepDoor 算星 → 三颗全空；`S.kills` 拼错 → 悄悄少一颗。

## 场景主题（2026-10-30 第 3 步，`fa20edd`）
- 用户一句「用雪原推球把场景定义死了」→ 把「雪」从机制里剥出来。它在
  snowlab 里干三件事：背景板 / 名词（雪弹·雪之碎片）/ 数值（发数·弹速）。
  **只换色 = 重新上漆**，三件一起进 `THEME` 才算换地方。
- `THEMES` = 霜原 1–12 / 熔炉 13–24 / 菌窟 25–36 / 沙塚 37–48。和 `STAGES`
  的 7 段难度**刻意错开（4 与 7 互质）**：换地方和变难不同时发生。
- 每套五件：`sky/cap/rim/deco/frame/mote` + `words` + `medium{speedK,needK}`。
  **介质只改手感不改规则** —— 某场景一旦有专属规则，另外三个就成半成品。
- `snowNeed()` 与 `shoot()` 乘场景系数。**只乘 speed 不乘 life**，否则是
  「打得远」不是「飞得快」，射程翻倍、两侧高台的取舍全废。
- 地表颜色散在 6 处（snowCap 三档 + 坡面渐变 + 碎石/土堆/雪包）。**只改
  snowCap 不改坡** = 熔炉的坡暗红、板雪白，一眼两套素材拼的。全部走 `THEME.cap[4]`。
- `BG_IMG` → `BG_IMGS`（按 theme.id）。原来挂一张图 `drawSky` 就整段 return，
  四套主题全被盖住。「加场景」= 往 `BG_IMGS` 塞一张，绘制代码不动。
- 出图 `_themes-shot.js`（四场景地表，`ART=1` 给霜原挂回立绘验兼容）。

## 踩过的静默失败（`fa20edd` 一轮）
- **抽取脚本锚点写整段字面量 = 定时炸弹**：改 `BG_IMG`→`BG_IMGS.snow` 后
  命中 0 次、脚本退出，生成物留在上一版，而 `runtime-check` 全绿（它读的就是
  那份旧的 `.ts`）。必须首尾两行 + 正则。
- **`Object.defineProperties` 里不能写 `applyTheme,`** —— 那不是描述符对象，
  被静默丢掉，`L.applyTheme` 是 undefined。要放 API 字面量里。
- **出图工具不能在循环外读全局态**：四格都画完再读 `THEME.id`，拿到永远是
  最后一格。图是对的、日志全错。

## 骨架 / 关卡生成（CR-031 落地版）
- `genLevel(seed, stage)` 一参三态；主线层数只查 `STAGES`（7 段到 48），**不写箱子/怪**。
- 骨架 = 每层一组**锚点列**；洞 x = 合法列按距锚点排序取第一个不撞约束的。**锚点只能当目标**。
- **层间 24 不许动**：48 网格 + 洞宽 144 + 留 24 → 中心差下限就是 192。放宽成重叠 48 会让两层洞连成竖井（死局）。
- **HUD 走 `HUD_RECTS` 表**，断言量「任两矩形不相交」。芯片压面板读代码看不见，只有出图能抓。
- 出图用 **stage 25~30 不用 1~6**（教学关只有 1 洞）；循环里别读 `L.S.level`（那是最后 reset 的关）。
