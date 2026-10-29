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
- **仓库源码是 LF**。脚本改写后看 `git diff --stat`，数字暴涨就是行尾被转成 CRLF（`io.open(...,newline='')`）。

## 验收工具
| 目标 | 命令 |
|---|---|
| snowlab 结构+玩法 | `tools/_snowlab-check.js`（239 项） |
| snowlab 运行时 | `client/tools/snowlab-runtime-check.js`（14 项 / 900 帧 0 偏差） |
| grove 玩法 | `tools/grove-smoke.js`、`grove-runtime-check.js` |
| 编译期致命码 | `tools/runtime-sanity.js`（阈值 0） |
| 出图 | `_snowlab-shot.js`（种子 7）、`_well-shot.js`、`_cmp-shot.js`、`_crop.js` |
| 性能 | `_ab-perf.js`（**同进程交替 A/B，只看比值**，绝对毫秒不可信）、`_perf-probe.js`、`_stop-probe.js` |

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
