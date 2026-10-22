# PAWPACK · 敌人立绘 · 落地清单

> 版本 v1.0 ｜ 2026-10-22
> 对应提交：`441d7ce`（立绘与管线）/ `273ce55`（文档）
> 上游文档：`docs/混合生产管线_PAWPACK_v3.0.md` §13、`docs/画风断层诊断_PAWPACK_v1.md` §8

---

## 1 · 资源清单（4 个文件，全部已入库）

| 文件 | 4x 尺寸 | 显示尺寸 | 键名 | uuid |
|---|---|---|---|---|
| `assets/resources/grove/foe-bug.png` | 176×112 | 44×28 | `foe-bug` | `bf4f3a1a-b3eb-428b-addc-766e62b55070` |
| `assets/resources/grove/foe-crow.png` | 168×136 | 42×34 | `foe-crow` | `c5165a6f-8f69-436c-963f-137200cad2db` |
| `assets/resources/grove/foe-boar.png` | 304×216 | 76×54 | `foe-boar` | `541ab95b-c831-4963-824c-f665384981a5` |
| `assets/resources/grove/foe-larva.png` | 120×96 | 30×24 | `foe-larva` | `0fe9695a-19b8-4721-a6e0-b7d53c9cb138` |

**命名**：`foe-<FOES 的 id>`。id 只有四个：`bug` / `crow` / `boar` / `larva`。
新加敌人时**必须同时改三处**，否则会静默走回退：

1. `client/prototype/grove.html` 的 `FOES`（含 `w/h` 碰撞盒与 `vw/vh` 视觉尺寸）
2. `client/tools/prep_foes.py` 的 `FOES`（`vw/vh` 与 html **逐字一致**）
3. `client/assets/scripts/grove/GroveBattle.ts` 的 `ART_MANIFEST`

**格式**：PNG / RGBA / 4x 超采样。4x 是为了 Cocos 在 2x 屏上采样不糊；
不是 2 的幂（不需要，走 `resources.load` 不是图集）。

**.meta**：四张都有，与 `pet-*.png.meta` 同构（`userData.type = "texture"`，
redirect 到 texture subMeta）。**不要手动改 uuid** —— 场景/预制体可能已经引用。

---

## 2 · 注入链（一张图从磁盘到画布）

```
ART_MANIFEST[key, path]
  → resources.load(path, ImageAsset)
  → GroveBattle._toDrawable(asset)     // .data 是 HTMLImageElement 就直接用；
                                       // 是 ArrayBuffer 就用 nativeUrl new Image
  → groveSetArt(key, drawable)         // 写进 ART 表
  → artOf(key)                         // 取图；width 为 0（没解码完）返回 null
  → drawFoe() 的贴图分支
```

**两套并存**：`artOf()` 返回 null 时自动回退三档色代码图形（`drawWorm` / `drawCrow` /
`drawBoar` / `drawLarva`）。所以：加载失败不白屏，只会那一只敌人退回旧画法。
`ART_MANIFEST` 少一项的后果就是「那一只又断层了」，不是崩。

---

## 3 · 绘制约定（三条，都是踩出来的）

**① 用 `def.vw/vh` 画，不用 `bw/bh`**

`FOES[].w/h` 是**碰撞盒**，`vw/vh` 是**画多大**。贴图是按 `vw:vh` 等比装框的，
所以绘制侧按 `vw:vh` 还原才不会变形。用 `bw/bh` 会把图压扁。

```js
const ih = d.vh || bh, iw = ih * (foeImg.width / foeImg.height);
```

**② 贴图底边贴 `f.y`**

局部坐标 y 向下为正，底边要落在世界 `f.y` 上 → `yTop = bh / 2 - ih`。
**不是 `-ih / 2`** —— 写成 `-ih/2` 会让视觉比碰撞高的敌人往地里陷 `(ih-bh)/2`，
野猪陷 7px，脚看不见。

**③ 包裹层（血条）也要按视觉体算**

```js
const cvw = d.vw || bw, cvh = d.vh || bh;
const ccy = f.y - cvh / 2;      // 视觉体中心 ≠ cy（cy 是按 bh 算的）
g.ellipse(cx, ccy, cvw * 0.5 + 3 + p * 5, cvh * 0.5 + 3 + p * 5, ...)
```

用 `bw/bh` 的后果是环切进身体里 —— 野猪的血条会比它自己小一圈。

---

## 4 · 视觉溢出与判定风险

| 敌人 | 碰撞 w×h | 视觉 vw×vh | 宽溢出 |
|---|---|---|---|
| 刺毛虫 | 34×28 | 44×28 | 29% |
| 乌 鸦 | 36×32 | 42×34 | 17% |
| 小野猪 | 56×40 | 76×54 | 36% |
| 幼 虫 | 26×22 | 30×24 | 15% |

**已知风险**：视觉比碰撞宽 = 球从边缘擦过不命中，玩家会觉得「打空了」。
野猪 36% 是这批的上限。**`grove-smoke` 367 项测不出这个**（它测数值），
只能实机试手感。如果要再放大视觉尺寸，先上机试。

---

## 5 · 复现命令

```bash
# 1. 重出贴图（改了描边/色彩参数后）
python client/tools/prep_foes.py            # 只出预览到 shots/_foe-preview/
python client/tools/prep_foes.py --write    # 写进 assets/resources/grove

# 2. 重抽运行时（改了 grove.html 之后必跑，否则 .ts 还是旧的）
python client/tools/extract_grove_runtime.py

# 3. 验收
node client/tools/grove-runtime-check.js    # 结构 14 项
node client/tools/grove-smoke.js            # 玩法 367 项

# 4. 看图（离屏，不开浏览器）
node client/tools/_foe-shot.js
```

⚠️ `prep_foes.py` 的源图路径**写死文件名**（ImageGen 产物是时间戳命名，
靠 glob 猜"哪个是 bug"迟早拿错图）。换图要去 `FOES[key]["src"]` 改。

---

## 6 · 待办

| # | 事项 | 卡在哪 |
|---|---|---|
| 1 | 按产地 tint（C 方案） | 项目是 **8 套主题**不是 3 产地。按主题出图 = 32 张；正解是**一套中性光立绘 + `sprite.color = theme.foe`**，`THEMES` 里还没有 `foe` 字段 |
| 2 | 敌人有情绪（球上保留表情） | 要改 `drawBall`，属玩法表现层 |
| 3 | 敌人是生态（从树后/洞里钻出来） | 要改出场时序，属关卡设计 |
| 4 | 敌人用序列帧（换掉 1.2px 走路弹跳） | 静态贴图丢了"腿在动"的信息，现在用弹跳补偿；真解是 2–3 帧循环 |
