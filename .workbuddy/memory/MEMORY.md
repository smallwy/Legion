# PAWPACK 项目长期约定（索引）

> 本文件只留「必须马上知道」的硬规矩，压着 3000 字符上限写。
> 长篇脉络（宪法 / 机制 / 表现层 / 美术标尺 / 2026-10-29 归档全文）在 `DETAILS.md`。

## 版本控制
- `D:/Legion` = git，`main` ← `origin` = `https://github.com/smallwy/Legion.git`（`local` 远端弃用）。
- **做完直接 commit + push，不问、不等确认。** 提交信息写「为什么这么改」+ 踩过的坑。
- **代理端口每次会变，推前先探**（上午 38190 通、下午 7897 通，实测反转过）：
  `curl -s -o /dev/null -w "%{http_code}" --max-time 6 -x http://127.0.0.1:<port> https://github.com/smallwy/Legion.git/info/refs?service=git-upload-pack`
  200 = 可用；也试 `--noproxy '*'` 直连。

## 环境
- Cocos Creator 3.8.8 在 `C:/ProgramData/cocos/editors/Creator/3.8.8`。沙箱**启不了预览**，验收走离线工具。
- 依赖一律 `$HOME` 展开，别写死用户名（两台机器分别是 `yu.wang` / `汪宇`）：
  `NODE_PATH="$HOME/.workbuddy/binaries/node/workspace/node_modules"`。
- 离屏出图读**编译产物**不读源码，改完 `.ts` 先 `tsc -p tools/tsconfig.homeruntime.build.json`。
- Cocos 编辑器常驻后台会回写 `Home.scene` / `.meta`：改场景前先 `git status`，提交前确认 diff 是**纯增量**。

## 两条铁律（都踩过多次）
- **原型是唯一真源**：改 `prototype/*.html` → 跑 `extract_*_runtime.py` 重抽运行时。直接改 `.ts` 会被覆盖，且**生成物过期不报错**（snowlab 曾在 `cce5c23` 停四轮，用户玩到旧版本）。
- **仓库里存的是 LF，工作区是 CRLF**（`core.autocrlf=true`）。用脚本改文件时替换串要按**工作区实际行尾**写，否则 `assert count==1` 就炸；改完看 `git diff --stat`，数字暴涨就是行尾被动过。

## 验收工具
| 目标 | 命令 |
|---|---|
| snowlab 结构+玩法 | `tools/_snowlab-check.js`（244 项） |
| snowlab 运行时 | `client/tools/snowlab-runtime-check.js`（14 项 / 900 帧 0 偏差） |
| grove 玩法 | `tools/grove-smoke.js`、`grove-runtime-check.js` |
| 编译期致命码 | `tools/runtime-sanity.js`（阈值 0） |
| 出图 | `_snowlab-shot.js`（种子 7）、`_well-shot.js`、`_cmp-shot.js`、`_perfhud-shot.js`、`_crop.js`、`_ramp-shot.js`（斜坡局部）、`_fixshot.js`（改前改后对照，`MODE=ladder/wall`） |
| 行为 | `_foe-bounce.js`（数跳/蹭坎）、`_jitter-probe.js`（**量 y 方向反转**）、`_spawn-probe.js`（量两只怪的中心距+中间有无阻挡）、`_ball-chaos.js`（**玩家 AI 自动推球 40 秒再扫反转**，定向构造不出来时用它）、`_foe-seq-shot.js` |
| 性能 | `_ab-perf.js`（**同进程交替 A/B，只看比值**，绝对毫秒不可信）、`_perf-probe.js`、`_stop-probe.js` |

**性能尖峰先做最小复现**：把游戏代码整个剥掉、只留几百次画布操作再跑一遍。
剥比读代码快，而且是唯一能钉死「是环境还是我们」的办法 —— 2026-10-29 那个
每 550ms 一次的 340ms 尖峰，就是这么确认成 `@napi-rs/canvas` 自身行为的。

## 最常返工的坑
- 震屏唯一出口 `kickShake(px, key)`，峰值硬上限 8px；散落的 `S.shake = Math.max` 会**重复点火**，让调公式完全失效。
- `hitStop()` 是 `Math.max` 语义 —— 更小的值抬不动已有值，小值调用是死代码。
- `b.y` 是**球底**不是球心。
- `wellClimb` 不许直接设坐标（用户原话「瞬间移动」），走 `startClimb()`：竖直段→水平段。
- 清残留节点用**后缀**不用前缀（`Badge-x-hot` 也满足 `startsWith('Badge-')`）。
- 顶层自启动脚本必须 `if (!EDITOR)` 守卫。
- 12px 下一个空格只有 3px，中文并列一律用顿号。
- 出图前必须手动调 `L.draw()`（rAF 被设 noop），否则全白且不报错。
- 角色尺度：箱子 48 永不动 / 玩家 45×63 / 敌人 ≤0.85 箱宽；形象与碰撞框同比例（`ART_K` 与 `PLAYER_W/H` 一起改）。
- 美术：Q 版 = 硬边色块（`foeCel`），**角色身上不要渐变**；统一光源左上。
- **已知未解决**：每层塞满装饰导致画面噪声、主角出生点有时在人缝里。
- 推球是**无条件给满速**（1209）。所以任何"球抵住不动"的地方都会变成
  60Hz 冲撞 —— 现在靠 `pushBlocked()` 挡（墙 / 砸不动且高于 56 的箱子），
  靠 `pushT` 让"被压着撞墙"只回弹 8%。反弹速度也加了上限 `×0.92`：
  **任何反弹都不许比入射快**，否则两块硬箱之间会锁在 140 永远停不下来。
- 刷怪间距不能只比 x：两只同高、中间没阻挡，走两步就顶死。判据是
  **这段台面站得下几只**（`cap = 1 + floor((段长−74)/110)`）。

## 敌人「弹」有三种成因（2026-10-29 两轮才分清，别再只查一种）

真跳（上限要从 `apex = jump²/(2·2100)` 反推，不许手写）→ 蹭坎（门槛 ≥4px）→
**碰撞推挤**：`step-up`/挤出把 y 设成 `s.y - o.h`（正好相切），而 `aabb` 用严格 `>`，
下帧判不相交 → 不落地 → 掉 → 又被抬，10Hz 无限循环。
第三种 `_foe-bounce` 抓不到，只有 `_jitter-probe`（量 y 方向反转次数）能抓。

## 层与层差异化（2026-10-29，第七轮）
读得出"换了一层"靠**面积**不是细节：楼板（每层出现两次）、平台顶面、光色。
只换墙纹理 = 同一间屋子换块布。四条轴要一起动：明度阶梯 + 色相跳冷
（第三层必须跳冷，否则前两层白调）+ 楼板换材质 + 天花板剪影（头顶那条边
是唯一没人遮的横幅）。**板体 `rockFill` 和顶面 `snowCap` 是两个函数，
只改一处看不出效果**；冷色房间的压暗色不能用暖棕（发脏绿）。
验收：`_floors-shot.js`（逐房间锁镜头，`BEFORE=` 对照）+ `_slab-probe.js`（采样像素）。
