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
- 离屏出图读**编译产物**，改完 `.ts` 先 `tsc -p tools/tsconfig.homeruntime.build.json`。
- Cocos 常驻后台会回写 `Home.scene` / `.meta`：提交前确认 diff 是**纯增量**。

## 两条铁律
- **原型是唯一真源**：改 `prototype/*.html` → 跑 `extract_*_runtime.py` 重抽。直接改 `.ts` 会被覆盖，且**生成物过期不报错**（曾在 `cce5c23` 停四轮）。
- 抽取脚本锚点**别用整段字面量**（原型一改就「命中 0 次」，生成物停在上版还不报错）。只锚首尾两行、用正则。
- **仓库存 LF、工作区 CRLF**（`core.autocrlf=true`）：替换串按工作区行尾写，否则 `assert count==1` 炸。

## 验收工具
| 目标 | 命令 |
|---|---|
| snowlab 结构+玩法 | `_snowlab-check.js`（320 项） |
| 运行时等价 | `snowlab-runtime-check.js`（14 项 / 900 帧 0 偏差） |
| 难度离散 / 形状 | `_diff-audit.js [N]`、`_shape-probe.js [N]` |
| 行为 | `_jitter-probe.js`、`_foe-bounce.js`、`_ball-chaos.js` |
| 性能 | `_ab-perf.js`（同进程 A/B，**只看比值**） |
| 出图 | `_floors-shot.js`（锁镜 + `BEFORE=`）、`_entry-shot.js`（真浏览器验入口） |
| 存量对照 | `_legacy-audit.js`（只读，两套关卡参数表） |

性能尖峰先做**最小复现**（剥到只剩画布）—— 唯一能钉死「环境还是我们」。

## 常返工的坑
- 震屏唯一出口 `kickShake(px, key)`，峰值 8px；散落 `S.shake = Math.max` 会**重复点火**。`hitStop()` 同语义，小值调用是死代码。
- `b.y` 是**球底**不是球心。`wellClimb` 不许直接设坐标，走 `startClimb()`。
- 出图前手动调 `L.draw()`（rAF 被设 noop），否则全白不报错。
- 尺度：箱子 48 不动 / 玩家 45×63 / 敌人 ≤0.85 箱宽，形象与框同比例。
- 美术：Q 版 = 硬边色块（`foeCel`），**角色不要渐变**；光源统一左上。
- 推球**无条件给满速**（1209）；抵住会变 60Hz 冲撞，靠 `pushBlocked()` / `pushT`（回弹 8%）挡；**反弹不许比入射快**（×0.92）。
- 刷怪间距判据是**这段台面站得下几只**（`cap = 1+floor((段长−74)/110)`），不是比 x。
- 清残留节点用**后缀**；自启动脚本 `if (!EDITOR)` 守卫；12px 一空格只有 3px。
- **未解决**：每层装饰太满导致噪声，出生点有时在人缝里。

## 出征页 → 推球（`e1d4c93`）
- 第三扇门 `snow` 跳 `snowlab.html?from=grove`。**Cocos 里没这个 html**（是组件），必须走
  `setSnowlabEntry(fn)`；写死 `location.href` 打包后白页 404。
- 关号 `stageSeed(n)=mix32(n*0x9E3779B1)`，存档 `{stage}` 记**下次从哪开始**；R 重打本关 / Enter 下一关，48 封顶。

## 玩法存量（CR-032，`fa55eb2`）
- **规划前先盘点存量。** 这次漏了：48 关曲线做在 snowlab，而 `grove.html` 早有 27 屏手工关
  （**7 目标** / 81 星 / BOSS）+ 深巢无尽。漏因：顺着「最近在做什么」规划，没验证
  「snowlab 是主线」这个前提。已拍板 **snowlab 为下一代、grove 冻结不删**。
- **深潜 ≈ 深巢**：同源 `seed ^ (depth*7919)`，要合并成一份。深潜种子过 `mix32`（线性会半循环）。
- snowlab 48 关真形状：6 骨架 × 8 轮，**目标只有「进门」1 种**。三星已落地
  （`nohit`/`bigchain`/`clearout`），存**位**不存数组（浅合并会替换），配 `Math.max`；
  0 只怪关须判 `killedTarget>0` 防白送。详见 `docs/CR-032`。
- **出图工具不许自己造状态**：绕过 stepDoor 算星 → 三颗全空；`S.kills` 拼错 → 悄悄少一颗。

## 骨架 / 关卡生成（CR-031 落地版）
- `genLevel(seed, stage)` 一参三态；主线层数只查 `STAGES`（7 段到 48），**不写箱子/怪**。
- 骨架 = 每层一组**锚点列**；洞 x = 合法列按距锚点排序取第一个不撞约束的。**锚点只能当目标**。
- **层间 24 不许动**：48 网格 + 洞宽 144 + 留 24 → 中心差下限就是 192。放宽成重叠 48 会让两层洞连成竖井（死局）。
- **HUD 走 `HUD_RECTS` 表**，断言量「任两矩形不相交」。芯片压面板读代码看不见，只有出图能抓。
- 出图用 **stage 25~30 不用 1~6**（教学关只有 1 洞）；循环里别读 `L.S.level`（那是最后 reset 的关）。
