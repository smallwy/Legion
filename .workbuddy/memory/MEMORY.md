# PAWPACK 项目长期约定

## 版本控制（2026-10-21 用户明确要求）

- `D:/Legion` 是 **git** 仓库，主分支 `main`，远端 `origin` = `https://github.com/smallwy/Legion.git`。
  （另有一个 `local` 远端指向旧的 WorkBuddy 会话目录，不用它。）
- **做完工作直接 commit + push，不要问用户、不要等确认。** 原话：「直接推送啊 不要问我 每次做完先推送」。
  只在推送失败（认证、冲突、大文件被拒）时才回来报告。
- 提交信息按「子系统的变更意图」写，不按文件类型堆。一个提交说清一件事为什么这么改，
  踩过的坑写在信息里（这些信息比代码注释更常被翻）。
- 截图 / 评审图一律入库，不做体积优化（用户已确认接受仓库变大）。

## 工程事实

- Cocos Creator 3.8.8，编辑器在 `C:/ProgramData/cocos/editors/Creator/3.8.8`。
- 沙箱里**启不了 Cocos 预览**（进程 3 秒即退）。验收只能走离线路线：
  `tools/verify-*.js`（结构 + 跨模块等式）、`tools/_rt-check.js`（带 `_mock-cc` 替身的运行时断言）、
  `tools/tsconfig.all.json`（全量 strict 类型检查）、`tools/_render-scene.js`（评审图渲染）、
  `tools/runtime-sanity.js`（**编译期体检**：只守 TS2304/1117/2739/2741 四个"根本跑不起来"的码，
  阈值 0。tsc 那 2200+ 条 implicit-any 技术债会把真 bug 埋掉，所以单开一道）。
- 需要 tsc 时用编辑器自带的那份：
  `C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript/bin/tsc`
- node 用 `C:/Users/yu.wang/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`；
  渲染图需要 `NODE_PATH=C:/Users/yu.wang/.workbuddy/binaries/node/workspace/node_modules`（`@napi-rs/canvas`）。
- **离屏渲染工具读的是编译产物，不是源码**：`tools/_home-rt-shot.js` 加载
  `tools/_rt-build/HomeRuntime.js`。改完 `.ts` 必须先
  `tsc -p tools/tsconfig.homeruntime.build.json`，否则会拿旧代码"渲染成功"，白量半天。
- **Cocos 编辑器（`CocosCreator.exe`）常常在后台开着，会回写 `Home.scene` 与 `.meta`**
  （实测把 `_orthoHeight` 从 360 改回 468.06、`-390.0` 变 `-390`、Cap 的 txt `height` 16 变 20.16）。
  改场景前先 `git status`：**工作区可能带着一批不是自己写的改动**。
  正确做法是先 `git checkout --` 回已确认版本再加节点，提交前确认 diff 是**纯增量**（只增不删）。

## 几条硬规矩（都是踩过坑换来的）

- **所有在顶层自启动的脚本必须加 `if (!EDITOR)` 守卫。** Cocos 编辑器为注册 ccclass 也会
  import 全部脚本，否则运行时会往场景里加节点、编辑器再写回磁盘。
- **判定「运行时残留节点」不要用前缀，要用后缀。** `Badge-x-hot` 也满足 `startsWith('Badge-')`，
  会导致热区代代相套（10 → 85 节点）。
- **`director` 上的事件监听是模块级的，不随场景销毁。** 场景常驻脚本必须在
  `EVENT_BEFORE_SCENE_LAUNCH` 里 dispose，否则切场景后旧控制器会读已销毁节点。
- **写会进 git 的文档时不要编造未验证的结论**；没跑过的就说没跑过。
- **仓库里的源码是 LF 行尾。用 Python/Node 脚本改写后必须确认行尾没变。**
  `io.open(..., "w")` 在 Windows 上默认走文本模式，会把整个文件转成 CRLF ——
  踩过一次，8783 行的 `grove.html` diff 变成 17025 行。
  改完先看 `git diff --stat`：数字远大于预期就是行尾被动过。
  修法：二进制读改写（`d.replace(b'\r\n', b'\n')`），或 `io.open(..., newline='')`。
- **出图工具必须注入 `assets/resources/grove/` 的全部贴图**（抄 `_clear-shot.js`
  的 `injectArt`）。不注入的话：`hudSkin()` 靠 `!!artOf("ui-tip")` 判断走哪套皮肤，
  而 `creamCard()` 是**无条件**画奶白底 → 渲成"奶白卡 + 浅绿字"，整张读不出来，
  还会把出图工具的问题误导成"这张卡坏了"。2026-10-27 为这个查了半天。
- **12px 下的一个空格只有 3px**，中文并列一律用顿号，不能用空格拼 ——
  `["沉石","厚甲"].join(" ")` 渲出来是"沉石厚甲"，读成一条词条。
- **对比 `nest-play` 这类指标必须真跑对照组**：`git show HEAD:client/prototype/grove.html`
  导出后用 `PROTO=` 指过去。别引用别处记的数字 —— 2026-10-27 就因为引用了
  一个"89%"，差点把 78% 当成自己的回归。

## 推球战斗（prototype/grove.html → GroveRuntime.ts）

- **原型是唯一真源**：改 `client/prototype/grove.html`，然后跑
  `python client/tools/extract_grove_runtime.py` 抽出 `assets/scripts/grove/GroveRuntime.ts`。
  **直接改 .ts 会被下次抽取覆盖。**
- 验收四件套（2026-10-27 的数据）：`tools/grove-runtime-check.js`（39 项结构）、
  `tools/grove-smoke.js`（1463 项玩法）、`tools/runtime-sanity.js`（编译期致命码 = 0）、
  `tools/_bg-shot.js <关号...>`（离屏渲染，支持 `PROTO=` / `PREFIX=` 做新旧对比）。
  深巢另有三件：`_nest-hash.js`（地形哈希必须一字不差）、`nest-check.js`（9889 项）、
  `nest-play.js`（机器人通关率，种子按 层×角色 定死）。
  主线敌人改动另有两件：`_jumper-shot.js`（蹲身/滞空/落地三个可读窗口）、
  `_jumper-clear.js`（逐屏清场，**必须配 `PROTO=` 跑对照组** —— 机器人本来就有
  5 屏清不掉，只看新版数字会把既有问题算到自己头上）。
- **`_start(hero, stage)` 是两个参数，不是 `_start(stage)`。**
  `grove-smoke` 里所有 `_start(2)` 实际是"2 号角色 + 第 1 屏"，不是"第 3 屏"。
  按单参数写诊断脚本会崩在 `beginRun` 的 `H.w`（hero 下标越界）。
  既有断言没改（改了会让一堆数字失去可比性），**新脚本一律 `_start(0, stage)`**。
- `b.y` 是**球底**不是球心（落袋判据 `b.y >= GROUND_Y - 6` 靠这个成立）。


## 美术资源的三个家（2026-10-23 定的，别再混）

| 目录 | 是什么 | 规矩 |
|---|---|---|
| `client/assets/` | 引擎资产 | 场景按 uuid 引用、代码按路径加载；**删了会坏** |
| `client/art/` | 素材源 / 概念 / 候选 / 评审 / 归档 | 不进包，目录带数字前缀，见 `art/README.md` |
| `client/shots/` | 工具出图落点 | **整个 gitignore**，随便删；值得留的人工归档到 `art/04-review/` |

- 改 `GroveBattle.ts` 的 `ART_MANIFEST` 后必须跑 `node tools/check-resources.js`。
  `resources.load` 路径写错不报错，只静默退回代码图形 —— 这类错误只能机器查。
- **查「这张图还有没有用」要问两层，只问一层一定漏**：
  ① 有没有引用 → `node tools/asset-crosscheck.js`（三条通道：场景 uuid / 运行时路径 / 生成器输入）
  ② **引用者自己是否可达** → 同一个工具会从 `HomeRuntime`/`BattleBoot` 走 import 图，
     遇到 `FROZEN`（现只有 `GameBootstrap.ts`，`MODE` 写死 `'grove'` 所以永不挂载）就停。
     2026-10-23 就是只做了①，把 `resources/art` 4 张 mow 占位图判成「在用」漏掉了。
- **「0 引用」不等于「没用」**（已踩三次）：`ui/home/panel-cream.png`、`pip-on.png`、
  `heads-circle/` 里除 `sugar-stand` 的 5 张，场景都不引用，但都是 `gen_grove_art.py` 的**输入**。
  删前必须单独 grep 一遍生成器源码。
- 当前 assets 下 72 张图全部有归属（场景 36 / 运行时 29 / 生成器输入 7 / 无引用 0）。
- `client/concept/`（脚本+产物同目录、自带 README）和 `assets/ui/home/`（贴图与生成器源图混放）
  **刻意不拆**，理由写在各 README 里。动 `ui/home/` 会牵到六七个按具体路径读图的工具。

## snowlab（prototype/snowlab.html，单文件原型）

- 验收：`tools/_snowlab-check.js`（**183 项**结构+玩法闭环）、
  `tools/_snowlab-feel2.js`（手感探针，只打印数字不判 pass/fail）、
  `tools/_snowlab-shot.js`（全量出图，种子固定 7）、
  `tools/_crop.js <图> <x,y,w,h> <倍数> <输出>`（放大看局部）。
  都要 `NODE_PATH=C:/Users/yu.wang/.workbuddy/binaries/node/workspace/node_modules`。
- **房间画法是"盒子"不是"矩形"**（`drawRoomWall`）：后墙左右内收 `DI=54`、
  上下内收 `DY=11`，两侧侧墙 + AO，内角一条亮缝，后墙压一层极淡暖灰。
  `DI` 小于 40 读不出透视，大于 70 会吃掉一整列箱子（列宽 48）。
- **一点透视的两个死规矩**：
  ① 沿进深方向的线必须朝消失点收，方向别反（第一版反了，看起来像"墙越往里越宽"）；
  ② **消失点取房间中点，不读 `S.cam.y`** —— `camViewOffset()` 已保证镜头停稳时
     房间居中在屏幕 300，读镜头反而会跟着抖。
- **侧墙材质必须跟房间主题走**：wood 压缩竖缝 / brick 朝消失点收的横缝
  （相位和后墙一致，墙角处连成一条）/ rock 两道顺墙裂缝 / niche 只留 AO。
- 墙面挂件的"退后"：柔影 + 降透明度，**按"像不像能站的东西"分档**
  （`DECO_FAR`：横梁 0.54 / 蛛网 0.56 / 其余 0.66）；自发光三件不降。
- **怪物的 `want` 是外部驱动时，撞边必须"钉住"而不是"回头"。**
  runner 每帧按"玩家在哪边"算方向，撞边反弹 turnLock 0.3s
  （148×0.3 = 44px）再撞回去 —— 探针量到"2 秒换向 6 次"。
  现在撞边/撞崖/贴身（30px 死区）一律站定，窄台面走速衰减到 0.35 倍，
  有断言「二十九」守着（阈值 3）。
- **`b.y` 是球底不是球心**（`snowlab` 里同理，别当成中心）。

## 美术方向：往「商业化 2.5D + 手绘立绘」走（2026-10-28 定的）

- **Cocos 侧的真实形态**：`Battle.scene` 里 0 Camera / 0 Canvas / 0 Sprite，
  战斗画面是 `GroveBattle.ts` 往 Cocos 画布上盖的 **DOM canvas**。
  全工程 0 个 3D 模型、0 套骨骼。真要 Sprite 分层 = 新建一条渲染管线，
  不是改配置。`Home.scene` 才是有 Camera + Canvas + 62 Sprite 的纯 2D UI 场景。
- **战斗场景只纵向移动**（`WALL_L=24, WALL_R=936`，关卡宽 = 视口宽 960），
  镜头按层吸附。所以**没有横向视差可做**，纵深只能靠透视 / 遮挡 / 光影。
- **不是 3D**。玩法判定永远在同一个 XY 平面，目标图在
  `client/art/02-concept/03-battle-target/`（四层：远景墙 / 中景挂件 / 玩法层 / 前景遮挡）。
- **立绘的收益受尺寸限制**：玩家 42px、敌人 30px、屏高 600 → 角色只占 7%，
  30px 下草叶牙齿冰棱全糊。要上立绘得先把角色渲染尺寸提到 48~56。
- **两条撤回的试错**（别再重走）：
  ① 前景遮挡层 —— 贴层吸附镜头下，画面顶部永远是「地表或上一层的墙」，
     「从上面垂下来的东西」没有容身之处；2.5D 前景遮挡要求镜头自由移动。
  ② 道具换手绘贴图 —— 半套换 = **净负收益**。手绘贴图自带描边，为了不双描边
     会跳过统一描边，而 `COL.ink` 那圈统一描边正是整个游戏的视觉语言。
     要换就必须全套（同描边 / 同视角 / 同光源）。
- **换美术前先定三条规范**：描边（是否共用 `COL.ink`）、视角（纯正交侧视 or 允许顶面）、
  光源（统一左上？）。不定这三条，做什么都会割裂。
- AI 出图的实操：`background:"transparent"` **不生效**，实际会给白底或深色底。
  要白底 + 自己 flood fill 抠（脚本见 `client/tools/`）；深色底和深棕描边糊在一起没法抠。

## 角色尺度（2026-10-28 定的，snowlab）

- 玩家 **45×63**、敌人 **51×45**，占屏高 10.5%（形象 12%）。原来 30×42 = 7%，
  **比木箱（48）还矮**；立绘在 30px 下草叶牙齿全糊，"精致"无从谈起。
- **形象和碰撞框必须同比例**：绘制靠 `ART_K`（脚底中心套缩放）放大，
  碰撞靠 `PLAYER_W/H`。只改一边 = "看着能过、其实过不去"。
  断言第三十节守着（判据 `30 × ART_K === PLAYER_W`，乘法不用相等）。
- 绘制函数里的坐标是**按 30×42 的手画比例**铺的硬编码，改尺度动 `ART_K` 和
  `PLAYER_W/H`，别去逐个改坐标。
- **统一光源：左上。** 主角/敌人/箱子/球共用。箱子是"斜向明暗一笔管住全部材质"
  （在统一描边之前压，描边才不会被渐变盖住而连成一片）。
- 主角四档色（`cat` / `catLight` / `catDark` / `catShade`），敌人三档
  （`FOE_SKIN.lit` / `body` / `shade`）。两档只能叫"明暗"，四档才叫"体积"。
- **绘制四条坑**：腿会被身体盖住（裤裆到脚底要留 5px 以上）、
  脸部元素别重复加 `face` 偏移、ω 嘴不能用两条 arc（接不上，画成问号，用二次曲线）、
  腮红必须 clip 在头圆里（否则溢出挂在脸颊外）。
- 影子用 `groundAt(cx, by+6)` 落在地面，跳起来不跟着飞。
- `tools/_well-shot.js` 出"井梯顶 / 洞口"自检图 —— 全场最紧的位置。
  `tools/_cmp-shot.js` 拼"改前/改后"上下对比（旧图用 `git stash` 后跑同一个工具）。
- **出图前必须手动调 `L.draw()`**（rAF 被设成 noop），否则导出一张全白且不报错。

## 美术风格：Q 版卡通（2026-10-28 用户明确）

- **用户的原话**：「我要的美术风格是 Q 版卡通　之前雪人那个版本的昆虫还可以」
  「敌方体态都超过了箱子 是不是不太好」「要你自己去创新设计啊　不是我说了 你就拿来用」。
- **参考基准**：`client/art/04-review/11-snowlab-enemy/01-三种敌人侧视与投掷物.png`
  那版（提交 e4e8edd）—— 扁平色块 + 粗描边 + 圆润造型 + 小圆眼。
  "雪人"在工程里只是「雪人兄弟」玩法参考，不是角色。
- **Q 版 ≠ 平涂无体积，也 ≠ 厚涂渐变。** 判据是**边界**：
  Q 版靠硬边色块塑体积（`foeCel`：clip 轮廓 → 铺暗色 → 偏移左上的基色椭圆盖上去），
  厚涂靠 colorStop 连续过渡。**角色身上一个渐变都不该有**。
  场景的渐变（墙的空气透视、灯光光晕）是光影，保留。
- **四个数值坑**：暗面方向要跟着体态（趴着的兽最暗在下沿，不是右下，
  右下会被它自己的头挡住）；暗面 < 3px 等于没有；**不要加独立高光块**
  （0.44 是椭圆贴片，0.24 是"长了块斑"）；肚皮色块离身体下沿必须留一个暗面宽度。
- **三样东西三个尺度，不许共用一个系数**：箱子 48（地形单位，永不动）/
  玩家 45×63（比箱子窄、比箱子高）/ 敌人 37×33（**必须明显小于箱子**，≤0.85）。
- **动法从体态推出来**（`NUM.breed.gait`）：moss 无腿→slide / fang 四足→run 会跳 /
  grub 多足→crawl 只爬（20px 内蹭坎）。`jump: 0` = 这条腿不会跳，物理层就不起跳。
  **"该不该会跳"由体态决定，不由关卡决定。**
- **敌人之间要分离**：出生隔 96px 但跑几秒就互相穿过。分离推力**必须明显大于走速**
  （1.6px/帧 vs 1.67px/帧 正好抵消，两只贴着一路顶着走）。
- **出生点不许叠加**：`if (!pool.length) pool = all.slice()` 这种"整池重来"
  等于允许两只怪同位置。改两档间距，都不够就挑最远的（不要 break，
  会让"一关至少 8 只"掉下来）。
- **诊断颜色问题不要靠看图猜，直接染色。** 为了找"那块亮椭圆是谁画的"绕了三次，
  把可疑填充分别染成品红/纯绿，一次就定位。
- **还没解决**：画面噪声（每层塞满蘑菇/路牌/管子/桶/坛子/旗子/蛛网，
  一屏露 2.5 层），以及主角出生点在人缝里。这是"乱"的主要来源。
