# PAWPACK 项目长期约定（索引）

> 只留「必须马上知道」的硬规矩。长篇（宪法 / 机制 / 表现层 / 美术标尺 /
> 敌人弹三成因 / 层差异化 / 关卡曲线 / 主线之后）在 `DETAILS.md`。

## 版本控制
- `D:/Legion` = git，`main` ← `origin`（`https://github.com/smallwy/Legion.git`）。
- **做完直接 commit + push，不问、不等确认。** 提交信息写「为什么这么改」+ 踩过的坑。
- **代理端口每次会变，推前先探**（2026-10-30：7897/7993/38190/7890 全 000，直连 200，
  环境变量里的 `https_proxy=6671` 可用）。git 里硬写了 `http.https://github.com.proxy=7897`
  会**盖掉环境变量** —— 推的时候用 `git -c "http.https://github.com.proxy=" push origin main`。

## 环境
- Cocos 3.8.8 在 `C:/ProgramData/cocos/editors/Creator/3.8.8`；沙箱启不了预览，验收走离线工具。
- 依赖一律 `$HOME` 展开（两台机器分别是 `yu.wang` / `汪宇`）：
  `NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules"`。
- 离屏出图读**编译产物**，改完 `.ts` 先 `tsc -p tools/tsconfig.homeruntime.build.json`。
- Cocos 常驻后台会回写 `Home.scene` / `.meta`：提交前确认 diff 是**纯增量**。

## 两条铁律
- **原型是唯一真源**：改 `prototype/*.html` → 跑 `extract_*_runtime.py` 重抽。直接改 `.ts` 会被覆盖，且**生成物过期不报错**（snowlab 曾在 `cce5c23` 停四轮）。
- 抽取脚本的锚点**别用整段字面量**（原型一改就「命中 0 次」，而生成物停在上个版本不报错）。只锚首尾两行、用正则。
- **仓库存 LF、工作区 CRLF**（`core.autocrlf=true`）。脚本替换串要按工作区行尾写，否则 `assert count==1` 炸；`git diff --stat` 数字暴涨就是行尾被动过。

## 验收工具
| 目标 | 命令 |
|---|---|
| snowlab 结构+玩法 | `_snowlab-check.js`（297 项） |
| 运行时等价 | `snowlab-runtime-check.js`（14 项 / 900 帧 0 偏差） |
| 难度离散 / 形状 | `_diff-audit.js [N]`、`_shape-probe.js [N]` |
| 行为 | `_jitter-probe.js`（量 y 反转）、`_foe-bounce.js`、`_ball-chaos.js` |
| 性能 | `_ab-perf.js`（同进程 A/B，**只看比值**） |
| 出图 | `_floors-shot.js`（锁镜 + `BEFORE=`）、`_entry-shot.js`（真浏览器验入口）、`_slab-probe.js` |

性能尖峰先做**最小复现**（剥掉游戏代码只留画布）—— 唯一能钉死「环境还是我们」的办法。

## 最常返工的坑
- 震屏唯一出口 `kickShake(px, key)`，峰值 8px；散落 `S.shake = Math.max` 会**重复点火**。`hitStop()` 同为 `Math.max` 语义，小值调用是死代码。
- `b.y` 是**球底**不是球心。`wellClimb` 不许直接设坐标，走 `startClimb()`。
- 出图前必须手动调 `L.draw()`（rAF 被设 noop），否则全白且不报错。
- 角色尺度：箱子 48 永不动 / 玩家 45×63 / 敌人 ≤0.85 箱宽；形象与碰撞框同比例。
- 美术：Q 版 = 硬边色块（`foeCel`），**角色身上不要渐变**；统一光源左上。
- 推球**无条件给满速**（1209）——「球抵住不动」会变 60Hz 冲撞，靠 `pushBlocked()` / `pushT`（回弹 8%）挡；**反弹不许比入射快**（×0.92）。
- 刷怪间距判据是**这段台面站得下几只**（`cap = 1 + floor((段长−74)/110)`），不是比 x。
- 清残留节点用**后缀**；顶层自启动脚本 `if (!EDITOR)` 守卫；12px 一空格只有 3px，中文并列用顿号。
- **已知未解决**：每层装饰太满导致噪声，出生点有时在人缝里。

## 主线之后
6~8h 只是首次通关，撑后半程的是**深潜无尽**（成本≈0）。**别为「怕玩完」拉长主线**。

## 出征页 → 推球（`e1d4c93`）
- 第三扇门 `snow` 跳 `snowlab.html?from=grove`。**Cocos 里没有这个 html**（是 `SnowlabBattle`
  组件），必须走 `setSnowlabEntry(fn)`；写死 `location.href` 打包后白页 404。
- 关号 `stageSeed(n)=mix32(n*0x9E3779B1)`，存档 `pawpack.snow={stage}` 记**下一次从哪开始**；
  **R 重打本关 / Enter 下一关**（否则第 7 关会换图），48 封顶。

## 骨架 / 关卡生成（CR-031 落地版）
- `genLevel(seed, stage)` 一参三态；主线层数只查 `STAGES`（7 段到 48），**不写箱子/怪**。
- 骨架 = 每层一组**锚点列**；洞 x = 合法列按到锚点距离排序、取第一个不撞约束的。
  **锚点只能当目标不能直接赋值**，否则撞层间 24 后被推到 ±192 外。
- **层间 24 不许动**：48 网格 + 洞宽 144 + 留 24 → 相邻层中心差下限就是 192。
  放宽成重叠 48 会让两层洞连成竖井（死局）。骨架靠**自带错位**被感知。
- 深潜种子过 `mix32`（线性会出 hub/twin 半循环）。
- **HUD 一律走 `HUD_RECTS` 表**，断言量「任两矩形不相交」。芯片压面板这种 bug
  读代码看不见（两边硬编码，改一处不提醒另一处），只有出图能抓。
- 出图用 **stage 25~30 不用 1~6**（2 层教学关只有 1 洞，骨架退化）；循环里别读 `L.S.level`
  （那是最后一次 reset 的关），在 reset 时就抄下来。
