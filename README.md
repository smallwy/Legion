# 吧唧军团 / Munch Legion

> 像素 Q萌宠物 + 昆虫敌人的双线（战斗 / 家园养成）独立游戏。Steam 方向立项代号 **PAWPACK**。
> **游戏名（已定，CR-005）**：《吧唧军团 / Munch Legion》——"吧唧"=啃食拟声（绑定喂养+半饿线），"军团"=最多 6 只并肩（绑定战斗线）。

## ★ 开发路径（重要）
- **正式路径 = Cocos Creator 3.8+（用户指定前端，立项第 1 条铁律）。** 所有游戏工程代码进 Cocos。
- `archive/web-prototype-legacy/index.html` 是我**未经确认擅自做的 Web 原型**（已记为失误，SC-001 修订）。**它已降级为遗留内部试玩件，不是正式交付。** 如果你要我把它从仓库删掉，说一声即可。

## 仓库结构
```
Legion/
├── docs/                         # ★ 项目资料（设计/调研/计划书），已同步进 git
│   ├── 立项计划书_PAWPACK_v1.0.md #   项目宪法（含 CR-001~008 变更日志、市场纠偏机制）
│   ├── 美术风格指引_PAWPACK.md    #   美术 Art Bible（含 §5.6 昆虫敌人、§3.5 家园交互帧）
│   ├── 排期台账_PAWPACK.md        #   操作层进度/周检/变更登记
│   └── *.md                      #   21 份市场与玩法调研底稿
├── assets/placeholder/           # AI 风格锚定占位美术（宠物/昆虫/战斗场景概念），非成品，发布前替换
│   ├── ref-mainvisual.png         #   主视觉锚点
│   ├── ref-pet-pig.png            #   圆滚猪 4 表情基准
│   ├── ref-ui-icons.png           #   UI 图标概念
│   ├── ref-battle.png             #   战斗场景概念锚点
│   ├── sprite-pet.png             #   宠物战斗精灵（洋红底，色键抠图）
│   └── sprite-bug.png             #   昆虫敌人精灵（洋红底）
├── client/                        # ★★ 正式游戏工程源码（Cocos Creator 3.8+）
│   ├── assets/scripts/            #   全套战斗脚本（入口 GameBootstrap）
│   ├── assets/resources/art/      #   透明占位精灵（宠物 + 3 种敌人）
│   ├── tools/                     #   沙箱侧：占位图预处理 + cc 类型桩 + 静态检查
│   └── README.md                  #   ★ 5 分钟组装步骤 / 操作 / 调参 / DrawCall 预算
├── archive/web-prototype-legacy/  # ★ 遗留 Web 原型（非官方路径，已降级）
│   └── index.html
└── README.md
```

> **怎么开始？** 看 `client/README.md`：Dashboard 建 Empty(2D) 项目 → 拷 `assets/` → 场景挂
> `GameBootstrap` → 运行。整个 demo 只挂一个组件，其余由代码搭建。

## 关键设计决策（摘要，详见 docs/）
- **双线互补**（Hub-and-Spoke 资源网，非推图）：家园养宠 ←→ 远征打怪，宠物不是子弹，是有状态/关系/记忆的活物。
- **战斗生成模型（CR-008）**：玩家**移动到地点后该地点成批生成一群怪物**（像踩怪窝），**不是怪物从屏幕外涌来追你**。怪物有独立 AI：可移动、可施法、各有**攻击半径**（进入才攻击）与**施法半径**（进入即可施法，有前摇读条）。
- **战斗操作**：玩家 WASD 只控制中心点走位；最多 6 只宠物环绕中心点**自动施法捕杀**；「半饿最强」(×1.5 火力 + 金环) 是签名微操。
- **美术**：像素 Q萌 16-32px；原型期用 AI 占位精灵（¥0，仅内部试玩，发布前替换为买/外包）。

## 运行遗留 Web 原型（仅内部试玩，非官方）
```bash
cd Legion/archive/web-prototype-legacy
python -m http.server 8123
# 浏览器打开 http://localhost:8123/index.html
```
> 必须用本地 HTTP（canvas 色键抠图需同源）。操作：WASD 移动 · H 切半饿。

## 后续路线（正式）
1. 直接进 **Cocos Creator 3.8+** 工程（计划书第 3 章 Day1-3 排期）。
2. 后端 **Go + Nakama**：阶段 5 才需要（前 5 阶段全单机）。
3. 严格按 `docs/立项计划书_PAWPACK_v1.0.md` 第 8/9 章做变更登记与每周纠偏巡检。
