# 吧唧军团 / Munch Legion

> 像素 Q萌宠物 + 昆虫敌人的双线（战斗 / 家园养成）独立游戏。Steam 方向立项代号 **PAWPACK**。
> 立项计划书（宪法）在 workspace 根的 `立项计划书_PAWPACK_v1.0.md`；《美术风格指引》在 `美术风格指引_PAWPACK.md`。

## 当前进度
- **Day1 垂直切片（Web 原型）**：`index.html`。验证「2D + 昆虫敌人可移动 + 百炼英雄式移动中捕杀」手感与具象美术。
- 战斗模型（CR-007）：玩家 WASD 只控制中心点；宠物环绕中心点**自动施法捕杀**；敌方为昆虫类等可移动单位。
- 原型期使用 **AI 风格锚定占位精灵**（`assets/placeholder/`，¥0），仅限内部试玩，**发布前替换为买/外包成品**。

## 运行 Day1 原型
```bash
cd Legion
python -m http.server 8123
# 浏览器打开 http://localhost:8123/
```
> 必须用本地 HTTP 服务打开（canvas 色键抠图需要同源，file:// 会被浏览器拦截 getImageData）。
> 操作：WASD 移动中心点 · H 切换「半饿最强」(×1.5 火力 + 金环) · 宠物自动开火。

## 后续路线（参见计划书）
1. Day1-3 Web 原型验证手感 → port 到 **Cocos Creator 3.8+**（用户指定前端）。
2. 后端 **Go + Nakama**：阶段 5 才需要（前 5 阶段全单机）。
3. 严格按 `立项计划书_PAWPACK_v1.0.md` 第 8/9 章做变更登记与每周纠偏巡检。

## 资产目录
- `assets/placeholder/` — AI 生成占位精灵（宠物 / 昆虫 / 战斗场景概念）。**非成品，发布前替换。**
