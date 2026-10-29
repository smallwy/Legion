# PAWPACK 项目长期约定（索引）

> 只留「必须马上知道」的硬规矩。长篇（宪法 / 机制 / 表现层 / 美术标尺 /
> 敌人弹三成因 / 层差异化 / 关卡曲线）在 `DETAILS.md`。

## 版本控制
- `D:/Legion` = git，`main` ← `origin`（`https://github.com/smallwy/Legion.git`）。
- **做完直接 commit + push，不问、不等确认。** 提交信息写「为什么这么改」+ 踩过的坑。
- **代理端口每次会变，推前先探**（38190 / 7897 实测反转过）：
  `curl -s -o /dev/null -w "%{http_code}" --max-time 6 -x http://127.0.0.1:<port> https://github.com/smallwy/Legion.git/info/refs?service=git-upload-pack`
  200 = 可用；也试 `--noproxy '*'`。

## 环境
- Cocos 3.8.8 在 `C:/ProgramData/cocos/editors/Creator/3.8.8`。沙箱**启不了预览**，验收走离线工具。
- 依赖一律 `$HOME` 展开（两台机器分别是 `yu.wang` / `汪宇`）：
  `NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules"`。
- 离屏出图读**编译产物**，改完 `.ts` 先 `tsc -p tools/tsconfig.homeruntime.build.json`。
- Cocos 常驻后台会回写 `Home.scene` / `.meta`：提交前确认 diff 是**纯增量**。

## 两条铁律
- **原型是唯一真源**：改 `prototype/*.html` → 跑 `extract_*_runtime.py` 重抽。直接改 `.ts` 会被覆盖，且**生成物过期不报错**（snowlab 曾在 `cce5c23` 停四轮）。
- **仓库存 LF、工作区 CRLF**（`core.autocrlf=true`）。脚本替换串要按工作区行尾写，否则 `assert count==1` 炸；`git diff --stat` 数字暴涨就是行尾被动过。

## 验收工具
| 目标 | 命令 |
|---|---|
| snowlab 结构+玩法 | `client/tools/_snowlab-check.js`（249 项） |
| 运行时等价 | `client/tools/snowlab-runtime-check.js`（14 项 / 900 帧 0 偏差） |
| 难度离散度 | `_diff-audit.js [N]` —— 200 种子的层数/箱子/怪/铁箱/冰墙 |
| 关卡形状 | `_shape-probe.js [N]` —— 相邻层洞的水平差分布（量"骨架"） |
| 行为 | `_jitter-probe.js`（量 y 反转）、`_foe-bounce.js`、`_spawn-probe.js`、`_ball-chaos.js` |
| 性能 | `_ab-perf.js`（同进程 A/B，**只看比值**） |
| 出图 | `_floors-shot.js`（逐房间锁镜，`BEFORE=` 对照）、`_snowlab-shot.js`、`_ramp-shot.js`、`_slab-probe.js` |

**性能尖峰先做最小复现**：剥掉游戏代码、只留几百次画布操作再跑。剥比读代码快，
是唯一能钉死"环境还是我们"的办法（340ms 尖峰就是这么确认成 `@napi-rs/canvas` 自身行为）。

## 最常返工的坑
- 震屏唯一出口 `kickShake(px, key)`，峰值上限 8px；散落的 `S.shake = Math.max` 会**重复点火**。
- `hitStop()` 是 `Math.max` 语义 —— 小值调用是死代码。
- `b.y` 是**球底**不是球心。
- `wellClimb` 不许直接设坐标（用户原话「瞬间移动」），走 `startClimb()`。
- 清残留节点用**后缀**不用前缀（`Badge-x-hot` 也满足 `startsWith('Badge-')`）。
- 顶层自启动脚本必须 `if (!EDITOR)` 守卫。
- 12px 下一个空格只有 3px，中文并列一律用顿号。
- 出图前必须手动调 `L.draw()`（rAF 被设 noop），否则全白且不报错。
- 角色尺度：箱子 48 永不动 / 玩家 45×63 / 敌人 ≤0.85 箱宽；形象与碰撞框同比例。
- 美术：Q 版 = 硬边色块（`foeCel`），**角色身上不要渐变**；统一光源左上。
- 推球是**无条件给满速**（1209）。任何"球抵住不动"都会变成 60Hz 冲撞 ——
  靠 `pushBlocked()` 挡、`pushT` 让压墙只回弹 8%；**任何反弹不许比入射快**（×0.92 上限）。
- 刷怪间距判据是**这段台面站得下几只**（`cap = 1 + floor((段长−74)/110)`），不是比 x。
- **已知未解决**：每层塞满装饰导致画面噪声、主角出生点有时在人缝里。
