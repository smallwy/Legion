# client/shots —— 工具落点（里面的东西可以随时删）

**这里不是资源库，是离线工具跑图时倒垃圾的地方。** 除本文件外，整个目录都在
`.gitignore` 里（`client/shots/*` + `!client/shots/README.md`），删了不影响任何东西。

## 游戏运行时会不会用到这里？

**不会，一张都不会。** 三条硬证据：

1. **不在 `assets/` 里。** Cocos 的 asset-db 只扫 `client/assets/`，这个目录在它视野之外，
   既不导入、也不进包体。
2. **运行时代码零引用。** `assets/scripts/` 下没有任何一处读 `shots`。
   战斗里的图走 `resources.load('grove/pet/cat')`，主界面的图走场景里的 `uuid`。
3. **工具链也几乎不读它。** 极少数读了的那几个（`tools/_ui-diff.py` 读 `_home-rt.png`）
   读的是**同一次刚生成的产物**，重新跑一遍生成工具就有了。

## 谁会往这里写

| 工具 | 产物 |
|---|---|
| `tools/_home-rt-shot.js` | `_home-rt.png`（主界面离屏渲染） |
| `tools/_foe-shot.js` | `_foe-new.png` / `_foe-old.png` / `_foe-coat.png` / `_foe-ground.png` |
| `tools/_clear-shot.js` | `_clear.png`（通关画面） |
| `tools/grove-shot3.js` / `grove-shot.js` | `grove-0X-*.png`（战斗关卡截图） |
| `tools/_boar-probe.js` | `_boar-fixed.png`（野猪行为探针取证图） |
| `concept/*.js` | `concept2-*.png` / `concept3-*` / `concept4-*`（概念图） |

这些文件名统一以 `_` 开头或带工具前缀，一眼能看出是产物不是资产。

## 想留档怎么办

产物只是「某一次运行的样子」。真正值得留的评审图，**人工挑出来放进
`client/art/04-review/` 的对应子目录**再提交 —— 那里才是入库的评审库：

```
art/04-review/00-早期截图/   01-battle/   02-home/   03-ui/   04-bg/   05-quality/   06-dispatch/
```

## 清空

```bash
# 保留本 README，其余全删
find client/shots -mindepth 1 ! -name README.md -delete
```

## 2026-10-23 清过一次，删掉的东西记在这里

| 内容 | 为什么删 |
|---|---|
| `_old/Home.scene.bak`（27 MB / 150 万行 / 43535 个节点） | 不是有效备份。这是热区递归套娃事故炸出来的场景（现在正常的 `Home.scene` 只有 1.2 万行）。谁要是"恢复"它，主界面会直接爆 |
| `_old/grove-old.html`、`_old/Home-head.scene` | 原型/场景的历史副本，git 里都有（`git show 937b056^:client/prototype/grove.html`） |
| `_old/badge-v1/` 3 张 | 勋章初版，**已归档**到 `art/05-archive/v1-勋章/`（归档≠删除） |
| `_foe-preview/foe-bug.png`、6 张 `_*.png` | 一次性产物，重跑工具即得 |
