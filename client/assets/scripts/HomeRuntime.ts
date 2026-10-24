/**
 * HomeRuntime —— PAWPACK 主界面运行时行为（Cocos Creator 3.8.8）
 * ============================================================================
 *
 * 为什么需要这个文件
 * ------------------
 * Home.scene 是脚本生成的静态序列化产物：场景里只有 cc.Node / cc.UITransform /
 * cc.Sprite / cc.Label，`cc.Button` 数量为 0、自定义脚本组件数量为 0。
 * 也就是说它本质上是一张「可以点的贴图」—— 点了没反应、宠物不动，是必然结果，
 * 不是配置错了。
 *
 * 这个文件补齐四件事：
 *
 *   1. 可点性 —— 每个入口有按下反馈（0.90~0.97 缩放）。热区不小于 88×88
 *      逻辑像素；徽标视觉 47×48 太小，另开隐形热区，视觉不动。
 *      按下必监听 TOUCH_CANCEL，否则手指滑出去会卡在按下的状态弹不回来。
 *
 *   2. 生命感 —— 宠物站在原地呼吸，点它会弹一下并冒颗心。
 *      单帧正面立绘做不出走路：横移读成贴纸在滑，上下位移读成跳。
 *      行走序列帧补上之前先站着（规格见 §14.4）。雾层仍缓移，空气感留着。
 *
 *   3. 结果 —— 点了之后一定有事发生。灶台 / 工作台 / 派遣 / 设置 / 图鉴
 *      都打开真面板并写存档。主行动「出门」给出发确认卡，
 *      卡上的「出发」真的 `loadScene('Battle')`。
 *
 *   4. 存档回流 —— 资源池 / 关卡进度 / 饱食度全部读自 `config/SaveData.ts`，
 *      不再显示场景里写死的假数字。战斗结算写战利品，家园入口写喂饭、
 *      制作、派遣和亲密度。
 *
 * 生效方式
 * --------
 * 不需要在场景里挂组件。Cocos 预览/构建会把 `assets/scripts` 下所有 .ts
 * 通过 `cce:/internal/x/prerequisite-imports` 全部 import（已核实
 * temp/programming/packer-driver/targets/preview/main-record.json），
 * 所以本文件顶层代码一定会执行。这里监听场景启动事件自动接管，
 * 场景文件一行都不用改 —— 避免再触发反序列化失败。
 *
 * 设计边界
 * --------
 * · 只处理主界面，不碰战斗场景。
 * · 所有尺寸/坐标沿用 Home.scene 既有值，不改已确认的版式。
 * · 新宠物「回家」的**节点**仍由 `tools/make-scene.js` 静态预置，
 *   运行时只按存档切换 `active`；不动态建节点（贴图加载是另一条链路）。
 */

import {
    Node, UITransform, UIOpacity, Label, Sprite, Graphics, Color,
    EventTouch, Vec3, tween, director, Director, game,
    assetManager, SceneAsset,
    resources, SpriteFrame, ImageAsset, Texture2D,
} from 'cc';
import { EDITOR } from 'cc/env';
import { MAX_SQUAD, PETS, petByNode, petGap, petById, squadSize, unlockedPets } from './config/Roster';
import type { PetDef } from './config/Roster';
import { CHAPTERS, STAGE_COUNT, chapterOf, stageLabel, stageInChapter } from './config/Stages';
import type { TaskDef } from './config/HomeBiz';
import { loadSave, saveSave } from './config/SaveData';
import type { SaveState } from './config/SaveData';
import { SATIETY } from './config/BattleConfig';
import {
    MEALS, RECIPES, PET_LINE, DISPATCH_SEC, DISPATCH_CAP,
    feed, craft, recordPat, setActive, startDispatch, collectDispatch, peekDispatch,
    toggleMute, toggleCrisp, heartText, heartsOf, canDispatch, yieldText,
    TASKS, taskPhase, claimTask, claimableCount,
} from './config/HomeBiz';

/* ==========================================================================
 * 设计常量（引擎中立规格，单位＝设计像素，基准 1280×720）
 * ========================================================================== */

const W = 1280;
const H = 720;

/** 最小热区边长：触屏下限 88×88 逻辑像素 */
const HOT_MIN = 88;

const WHITE = new Color(255, 255, 255, 255);

/**
 * 卡片白 —— 这一档色值不是"我挑的白"，是**从现有 UI 贴图上采下来的**。
 *
 * 采样（assets/ui/home/*.png，取卡片中心像素）：
 *   badge-cap-3.png     (255, 252, 244, 240)
 *   panel-res.png       (252, 249, 237, 241)
 *   panel-hud-tip.png   (252, 247, 235, 241)
 *
 * 三张都在 (252~255, 247~252, 235~244) 这个区间里 —— 也就是说这一屏的"白"
 * 本身就是**带一点暖调的米白**，不是 #FFFFFF。运行时新画的卡片必须落进同一个
 * 区间，否则同一屏里会出现两种白，读作"这两块不是一套的"。
 *
 * 上一版写 (255,246,233)，比贴图低 6~11 个色阶，明显偏黄；
 * 用户的原话是"其他 UI 底色还是以白色的" —— 他要的不是纯白，
 * 是"别突然变黄"。
 */
const CARD_FILL = new Color(255, 252, 244, 242);
const CARD_LINE = new Color(214, 168, 128, 255);
const INK = new Color(92, 66, 50, 255);
const INK_SOFT = new Color(150, 118, 96, 255);
const SCRIM = new Color(38, 26, 20, 255);
const BTN_FILL = new Color(242, 186, 108, 255);
const BTN_DEEP = new Color(150, 104, 58, 255);
const ROW_FILL = new Color(255, 252, 246, 255);
const ROW_OFF = new Color(232, 224, 212, 255);

/**
 * 不透明的卡片白 —— 只在"卡片要**盖住**底下的东西"时用。
 *
 * 上面那档 242 的 alpha 是给弹层用的：下面压着一层深色遮罩，半透一点更像玻璃。
 * 但派遣卡要盖住的是**背景图里那块深绿告示板**，而那块板上画满了白色横线
 * （告示板的"文字"）。242 的 alpha 会让那几条白线以 5% 的强度透出来，
 * 卡片上浮着几条鬼影，比原来的深绿板还像 bug —— 这是渲染图上一眼看到的。
 */
const CARD_FILL_SOLID = new Color(255, 252, 244, 255);

/** 米白卡片：外圈深棕、内圈浅缝，和院子里的圆牌是同一套 */
function paintCard(g: Graphics, w: number, h: number) {
    const x = -w / 2;
    const y = -h / 2;
    g.fillColor = CARD_FILL;
    g.roundRect(x, y, w, h, 28);
    g.fill();
    g.lineWidth = 4;
    g.strokeColor = new Color(122, 80, 52, 255);
    g.roundRect(x, y, w, h, 28);
    g.stroke();
    g.lineWidth = 2;
    g.strokeColor = new Color(214, 176, 140, 210);
    g.roundRect(x + 10, y + 10, w - 20, h - 20, 20);
    g.stroke();
}

/* --------------------------------------------------------------------------
 * 六只**坐在屋前那块粉色垫子上**（派遣牌左边），前后两排、零遮挡
 *
 * 垫子在渲染图里的实际范围（1280×720 一像素等于一个设计单位，直接量）：
 *   木框（含编织边）x 768..1038 / y 495..618
 *   粉色软垫      x 792..1010 / y 498..600
 *   派遣告示牌    x 1062..1182 / y 458..543（板面含木框），腿到 572
 *
 * **那块牌子是烤在 bg.png 里的**，场景里只有它的点击热区 `Badge-派遣`
 * 和标题 `Cap-派遣` 两个节点。它曾经被右移过 75（tools/move-bg-sign.py），
 * 现在的位置离垫子只有 24px —— 这就是宠物带只能到 1048 的原因。
 *
 * 想让宠物区再大一截，唯一的办法是把牌子搬到画面左侧，但那要改 bg.png：
 * 牌子原位正好卡在「粉垫粉色 / 木栅栏棕色 / 前景虚化花」三种边界之间，
 * 补草地时拉普拉斯解会把这三种颜色拖进来，留一块看得见的补丁
 * （实测过，见 tools/move-bg-sign-left.py 的注释）。
 * 在拿到更好的修补法之前，**不动 bg.png**。
 * -------------------------------------------------------------------------- */
const PET_BAND_X = 770;
/**
 * 可用带宽。**上限是那块告示牌的左缘 1062**，不是垫子的右缘。
 *
 * 770..1015 是 v2 的数据，右边还留着 47px 不敢用 —— 因为牌子立在 1062，
 * 宠物凑过去会跟牌子挤在一起。现在卡缩进板面、牌子本身没动，但视觉上
 * 那一带不再是"一块压下来的白板"，所以敢把带子推到底：
 * 770..1040（270 宽），离牌子（左缘 1062）还剩 22px 呼吸。
 */
const PET_BAND_W = 270;

/**
 * 宠物统一可见高（设计像素）。**算出来的，不是挑的**：
 * 最宽的那一排三只（砂糖 0.864 + 团子 1.277 + 豆奶 1.053 = 3.194 个身高单位）。
 *
 * 带宽 270 → 3.194 × 74 = 236.4，两道缝各 16.8。缝宽和 v2 基本持平，
 * 涨的是**宠物本身**（66 → 74，+12%）：同一个坑里画面被占满，观感上就是"它们更大了"。
 * 74 是**前后排间距倒推出来的上限**：两排 y 差 78，宠物再高就会互相切到头。
 * 想更大只能把垫子画大，或者把牌子挪走 —— 后者要动 bg.png，代价见布局注释。
 */
const PET_H = 74;

/**
 * 后排 / 前排的落脚 y。**差 78 > 宠物高 74，就是零遮挡的全部秘密。**
 *
 * 前后两排不遮挡只有两种办法：横向错开超过半只身宽（垫子放不下六只），
 * 或者纵向错开超过整只身高。这里选后者：604 - 526 = 78 > 74 ——
 * 后排的脚落在前排头顶**之上**，两张图在屏幕上不重叠一个像素。
 *
 * 这也是**为什么不能"两排 3+3 对齐"** —— 那样两排 y 只能差 40 左右
 * （再大就顶出垫子后沿/压到 Dock），后排会被前排切掉下半身，
 * 只剩一排脑袋。上一版实测就是这个结果：白兔只剩耳朵。
 *
 * 526 / 604 都还在垫子木框（y 495..618）以内，脚没有踩到草地上。
 */
const PET_Y_BACK = 526;
const PET_Y_FRONT = 604;

/** 只解锁 1~3 只时的单排中线（垫子正中） */
const PET_Y_SOLO = 565;

/**
 * 每只立绘的**可见宽高比**（w ÷ h）。
 *
 * 量法：alpha 包围盒。六张画布都是 209~272 × 292，但内容高度从 213 到 292，
 * 宽高比从 0.74（兔子，又高又瘦）到 1.28（仓鼠，又矮又胖）。
 *
 * **必须用这个比例去定 contentSize，不能沿用场景里的旧尺寸** ——
 * 场景里那六个 UITransform 是历次手调留下的（53.7×84 / 108.9×148 /
 * 110×138 / 55.8×128 / 120.5×138 / 73.3×112），彼此既不等高也不等比
 * （雪团甚至被横向压窄了 40%）。散着看不出来，坐到一块就是
 * "大小不齐 + 变形"，而那两样恰好是"贴纸感"最直接的来源。
 */
const PET_ART: Record<string, number> = {
    '砂糖': 0.864,
    '年糕': 1.000,
    '团子': 1.277,
    '雪团': 0.740,
    '豆奶': 1.053,
    '星屑': 0.956,
};

/**
 * 走动开关。**已打开**（用户明确要求"宠物嬉戏玩耍"）。
 *
 * 历史包袱（留档）：上一版关掉它是因为六只坐在同一块垫子上，
 * 位移与"互相不要遮挡"冲突。现在靠两条规矩把冲突解开：
 *   · 活动边界是**绝对**的（slot ± PET_ROAM_R），不随当前位置累积漂移；
 *   · 互动剧本（追逐/扑跳）的落点在出发前就算好，主动贴到对方边缘为止，
 *     绝不进对方格子 —— 见 stageChase()。
 *
 * 剩下的一条硬约束没变：**立绘不翻转**（高光方向会露馅），方向感全靠 sway。
 */
const PET_WALK = true;

/** 横向溜达半径（slot ± 20）。两排的中心距实测 ≥96px，
 *  ±20 加上各自半宽最多 35px，极端情况下边缘仍留 6px 空隙 —— 不遮挡。 */
const PET_ROAM_R = 20;

/** 扑跳开关。**现在是关的（2026-10-23 用户反馈"跳的也很奇怪，处理不了就下放"）。**
 *
 * 关它的原因很诚实：宠物是单帧立绘，没有腾空/落地/下蹲的动画帧，
 * 扑跳只能靠 scale + 抛物线硬演 —— 蹲下是整体压扁、腾空是整体拉长，
 * 观感是"一张贴纸在蹦"，不是"一只动物在跳"。这不是调参数能救的，
 * 需要美术出 2~3 帧跳姿（蹲/腾空/落地）才有资格重开。
 *
 * 关掉后的嬉戏 = 自由溜达 + 追逐（追逐全程在走，被堵到边的反应改为不动），
 * 蝴蝶照飞，只是没有谁扑它 —— 它仍是画面里的第三方动点。 */
const PET_POUNCE = false;

/** 落点：名字 → 垫子上的位置 */
type PetSlot = { name: string; x: number; y: number; depth: number };

/**
 * 把"这一局在场的宠物"排到垫子上，返回 名字 → 落点。
 *
 * 必须是个函数而不是一张写死的坐标表，因为**在场的只数是变的**：
 * 通关 3 关只有一只、8 关六只全到。写死六个位置的话，一只的时候
 * 它会站在最左边（那是"给六只排的位置"里的第 0 个），看着像排漏了。
 *
 * 规则：
 *   · 1~3 只 → 单排，居中；
 *   · 4~6 只 → 前后两排，按**原顺序奇偶**分（前排 1/3/5、后排 2/4/6）。
 *     不按宽度排序分排，是因为那样"谁站哪儿"会随立绘尺寸变化，说不清；
 *     按原顺序分，两排的宽度天然接近（210 vs 178），已经够用。
 *   · 每排内部按各自剩余宽度均分缝隙，上限 30px（两只时别拉到垫子两头），
 *     下限 6px（再小就贴住了）。
 */
function layoutPets(names: string[]): Map<string, PetSlot> {
    const out = new Map<string, PetSlot>();
    if (names.length === 0) return out;

    const wOf = (n: string) => (PET_ART[n] ?? 1) * PET_H;

    /** 横向摆好一排，整排居中于可用带 */
    const row = (list: string[]) => {
        const ws = list.map(wOf);
        const sum = ws.reduce((a, b) => a + b, 0);
        const n = list.length;
        const gap = n > 1 ? clamp((PET_BAND_W - sum) / (n - 1), 6, 30) : 0;
        const total = sum + gap * (n - 1);
        let x = PET_BAND_X + Math.max(0, (PET_BAND_W - total) / 2);
        return list.map((name, i) => {
            const cx = x + ws[i] / 2;
            x += ws[i] + gap;
            return { name, x: cx };
        });
    };

    if (names.length <= 3) {
        for (const r of row(names)) {
            out.set(r.name, { name: r.name, x: r.x, y: PET_Y_SOLO, depth: 0.5 });
        }
        return out;
    }

    const front = names.filter((_, i) => i % 2 === 0);
    const back = names.filter((_, i) => i % 2 === 1);
    for (const r of row(back)) {
        out.set(r.name, { name: r.name, x: r.x, y: PET_Y_BACK, depth: 0 });
    }
    for (const r of row(front)) {
        out.set(r.name, { name: r.name, x: r.x, y: PET_Y_FRONT, depth: 1 });
    }
    return out;
}

/**
 * 兜底落脚点：存档里出现 `PET_ART` 没登记的宠物时用（设计坐标，y 向下）。
 * 落在垫子正中，不落进花里。
 */
const LAWN_SPOT: [number, number] = [874, 578];

/* --------------------------------------------------------------------------
 * 入口说明文案。没有 hover 的平台上只有 :hover 提示等于没有提示，
 * 所以这些文案在点击时以 toast 形式常驻显示，不依赖悬停。
 * -------------------------------------------------------------------------- */
/**
 * 抽屉里的一行。**高度计算和绘制读同一份清单**（`taskLayout()`）——
 * 两处各算一遍就会漂移，漂移的症状是最后一行被面板底边切掉半截。
 */
type TaskItem =
    | { kind: 'row'; t: TaskDef; h: number }
    | { kind: 'fold'; h: number; n: number };

const BADGE_INFO: Record<string, string> = {
    // 「工坊」= 原工作台 + 灶台，已经是真面板（openHome），这里只为兜底
    '工作台': '家 · 喂饭与制作都在这里',
    // 图鉴已经是真面板了（openCodex），这里留着只为兜底 —— 它不会再被读到
    '图鉴': '图鉴 · 查看已收服的宠物',
    '灶台': '灶台 · 已并入「工坊」',
    '派遣': '派遣 · 让宠物出门带资源回来（待实装）',
    '去苔原': '苔原 · 下一关的入口（已由底部「出门」承担）',
};

/* 锁定槽位"还差几关"的判定已改到 `Roster.petGap()` —— 那张写死的表
   会和花名册漂移（改一次解锁节奏要记得改两处），所以删掉，只留一处真值。 */

/* ==========================================================================
 * 工具
 * ========================================================================== */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** 帧率无关的指数平滑：dt 抖动不会改变收敛速度 */
const smoothK = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

/**
 * 站着的时候做点什么。0 = 什么都不做。
 *
 * **"什么都不做"也要占 34%。** 六只各有各的节奏、还夹着静止，
 * 才像一窝活物；每只都在不停动，反而像六个上了发条的玩具。
 */
/**
 * 换一个原地姿势。
 *
 * 权重不是平均分的：**坐和趴占 64%**。六只待在家里的垫子上，
 * 大部分时间本来就该是休息态 —— 平均分会让它们像一套循环播放的小动画。
 * 发呆（0）也留了一档，因为"什么都不做"本身是一种休息。
 */
function pickPose(): number {
    const r = Math.random();
    if (r < 0.14) return 0;   // 发呆
    if (r < 0.50) return 4;   // 坐下
    if (r < 0.64) return 5;   // 趴下
    if (r < 0.80) return 3;   // 舔毛
    if (r < 0.92) return 1;   // 伸懒腰
    return 2;                 // 打滚
}

/** 设计坐标 x → Canvas 本地 x（Canvas 锚点 0.5/0.5，本地原点即屏幕中心） */
const lx = (designX: number) => designX - W / 2;

/** 宠物视觉宽度。立绘按 alpha 包围盒装进 PET_H 高的框，
 *  宽度就是宽高比 × PET_H —— 互动剧本算"贴到对方边缘"要用它。 */
const petW = (n: string) => (PET_ART[n] ?? 1) * PET_H;

function mkLabel(
    parent: Node, name: string, text: string,
    size: number, color: Color, w = 400, h = 40,
): Label {
    const n = new Node(name);
    n.parent = parent;
    n.addComponent(UITransform).setContentSize(w, h);
    const lb = n.addComponent(Label);
    lb.string = text;
    lb.fontSize = size;
    lb.lineHeight = Math.round(size * 1.3);
    lb.color = color;
    lb.horizontalAlign = Label.HorizontalAlign.CENTER;
    lb.verticalAlign = Label.VerticalAlign.CENTER;
    lb.overflow = Label.Overflow.NONE;
    return lb;
}

/**
 * 左对齐标签：`x` 是**文字左缘**，不是中心。
 *
 * `mkLabel` 的定位语义是"中心"（锚点 0.5），做左对齐时要在调用处写
 * `x + w/2`，这个转换在六个面板里各写一遍必然写错一个（差 w/2 就是整块文字飞出去）。
 * 所以单独封一个"我说左缘就是左缘"的版本。
 */
function mkLeftLabel(
    parent: Node, name: string, text: string,
    size: number, color: Color, x: number, y: number, w: number, h: number,
): Label {
    const lb = mkLabel(parent, name, text, size, color, w, h);
    lb.horizontalAlign = Label.HorizontalAlign.LEFT;
    lb.node.setPosition(x + w / 2, y, 0);
    return lb;
}

/**
 * 右对齐标签：`x` 是**文字右缘**。和 `mkLeftLabel` 是同一个理由 ——
 * "收益"这类字要靠右钉在按钮左边，用居中的话字数一变就左右乱跑。
 */
function mkRightLabel(
    parent: Node, name: string, text: string,
    size: number, color: Color, x: number, y: number, w: number, h: number,
): Label {
    const lb = mkLabel(parent, name, text, size, color, w, h);
    lb.horizontalAlign = Label.HorizontalAlign.RIGHT;
    lb.node.setPosition(x - w / 2, y, 0);
    return lb;
}

function mkSpriteNode(parent: Node, name: string, w: number, h: number): { node: Node; ut: UITransform } {
    const n = new Node(name);
    n.parent = parent;
    const ut = n.addComponent(UITransform);
    ut.setContentSize(w, h);
    return { node: n, ut };
}

/* ==========================================================================
 * 运行时类型
 * ========================================================================== */

/** 按压反馈单元：一个可点元素 = 一条记录，缩放统一在 tick 里收敛，不用 tween */
type PressRt = {
    /** 接收触摸的节点（可能是隐形热区） */
    node: Node;
    /** 真正被缩放的节点（隐形热区时指向视觉本体） */
    target: Node;
    /** 按下时的缩放 */
    min: number;
    /** 当前缩放（实际写入 node.scale） */
    cur: number;
    down: boolean;
    /** 待机脉动幅度，0 = 不脉动 */
    pulse: number;
    pulseDur: number;
    ph: number;
};

type PetRt = {
    node: Node;
    /** 立绘名（PET_ART 的键）。互动剧本算"贴到对方边缘"要用宽度 */
    name: string;
    baseY: number;
    /** 领地本地坐标（横向） */
    left: number;
    right: number;
    /** 可走的深度范围（相对 baseY 的 y 偏移，负值 = 往远处走） */
    far: number;
    near: number;
    /** 呼吸相位与周期，各只错开，否则六只一起起伏 */
    ph: number;
    dur: number;
    /** 正在走 */
    moving: boolean;
    /** 距下一段走的剩余秒 */
    wait: number;
    /* ⚠ fy / ty 是**相对 baseY 的深度偏移**，不是世界 y。
       直接拿 pos.y 当输入再写回 pos.y，每帧的呼吸（1.5px）会被当成新起点累加，
       30 秒就漂出去一百多像素 —— 宠物会自己走到天上去。 */
    fx: number; fy: number; tx: number; ty: number;
    /** 当前深度偏移（不走路时保持不动） */
    yOff: number;
    wt: number; wd: number;
    /** 走向 ±1，只用来决定身体朝哪边晃 */
    dir: number;
    /** 步频相位。1 = 迈一步；两只脚交替靠它算 */
    step: number;
    /**
     * 累计走过的距离（像素）。`step = walked / stride`。
     *
     * **不能再用 `step += dt * clamp(...)`。** 老写法的下限会卡住步频：
     * 速度降下来了步子降不下去，腿在原地迈 —— 这就是"脚打滑"的成因。
     * 由位移推相位，走多远迈多少，物理上不可能打滑。
     */
    walked: number;
    /** 一步跨多远（像素）。速度 ÷ 步幅 = 步频 */
    stride: number;
    /** 平滑后的行走强度 0~1（起步/停步不要开关式跳变） */
    gait: number;
    /** 原地姿势：0 发呆 / 1 伸懒腰 / 2 打滚 / 3 舔毛 / 4 坐下 / 5 趴下 */
    pose: number;
    poseT: number;
    poseDur: number;
    /** 群内深度 0=后排(远) 1=前排(近)，决定基础缩放 */
    depth: number;
    /**
     * 影子。**单独挂在 Pets 根下，不挂宠物节点下。**
     * 挂宠物下面就会跟着 bob 一起上下 —— 影子跟着跳等于没有接地，
     * 这正是当年"宠物像飘在水上"的根因（见 L893 那段注释）。
     */
    shadow: Node | null;
    /** 被点击后的弹跳剩余时间（秒） */
    pop: number;
    /** 按住（蹲下） */
    down: boolean;
    /**
     * 扑跳（嬉戏主动作）：剩余总时长，0 = 没在扑。
     * 三段固定节拍：蹲 0.26s（压到 0.84）→ 腾空 0.38s（抛物线 + 前冲）
     * → 落地 0.30s（压到 0.88 回弹）。落点在出发前一次算好
     * （pFx + pDx），不逐帧随机 —— 逐帧决定会刹不住车撞进邻只。
     */
    pounce: number;
    pounceT: number;
    pDir: number;
    pDx: number;
    pFx: number;
    /** 平滑后的姿态 */
    sy: number; sx: number; rot: number;
};

type FogRt = {
    node: Node;
    baseY: number;
    op: UIOpacity | null;
    ph: number;
    /** 只允许往上位移 0~amp，向下会露边 */
    amp: number;
    period: number;
};

/** 蝴蝶（Graphics 手绘，不占资源）。on=false 后节点保留、等下次复用，
 *  节点无效（场景销毁）才置 null。 */
type BfRt = {
    node: Node;
    g: Graphics;
    on: boolean;
    x: number; y: number; baseY: number;
    dir: number;
    t: number;
    /** 这次飞行里已经扑过的宠物 —— 一只蝴蝶只许被同一只扑一次 */
    chased: Set<PetRt>;
};

/** 一缕炊烟。自绘软圆：升起、变大、变淡。不是粒子系统，别往通用化做 */
type PuffRt = {
    x: number; y: number;
    r: number;
    life: number; max: number;
    vx: number; vy: number;
};

/** 一只远处的飞鸟。两段线画的 V，扑扇 = 翅尖 y 振荡。远到看不清形态，反而真 */
type BirdRt = {
    x: number; y: number;
    dir: number;
    t: number;
    sp: number;
    ph: number;
    s: number;
};

/* ==========================================================================
 * 控制器
 * ========================================================================== */

class HomeController {
    private canvas: Node;
    private canvasUT: UITransform;

    private t = 0;
    private lastMs = 0;

    /**
     * 已经作废。
     *
     * 切场景时旧场景的节点会被销毁，但 `director` 上的 BEFORE_UPDATE 监听
     * 是**模块级**的，不会随场景消失 —— 于是 tick 会继续拿一堆已销毁的节点
     * 算位置。报错长这样：
     *
     *   TypeError: Cannot read properties of null (reading 'x')
     *     at HomeController.tickPet
     *
     * 也就是说：点「出发」不是跳转失败，而是**跳转成功了**，然后旧控制器
     * 在死后继续跑。这个标志让它在第一帧就停手。
     */
    private dead = false;

    private pets: PetRt[] = [];
    private presses: PressRt[] = [];
    /** 点击回调里不能当场拆面板。触摸还在这个节点上，拆掉会直接抛错。 */
    private later: Array<() => void> = [];

    /** 嬉戏调度：倒计时到 0 就挑一个剧本演。间隔随机 —— 固定间隔读成节目单 */
    private playCd = rand(2.5, 5);
    /** 延时剧本队列：追逐是"逼近 → 反应 → 邀玩"的三拍时序，不是两条 tween */
    private scriptQ: Array<{ at: number; fn: () => void }> = [];
    /** 蝴蝶。首次起飞前靠 bfCd 倒计时 */
    private bf: BfRt | null = null;
    private bfCd = rand(5, 9);
    private fogs: FogRt[] = [];

    /** 炊烟。烟囱口在 bg.png (415,163) → 设计 (346,98) → 本地 (-294,262)。
     *  bg 里烟囱上方本来就画了一缕淡烟，动态烟从同一个口续上、顺同一个风向。 */
    private smoke: PuffRt[] = [];
    private smokeG: Graphics | null = null;
    private smokeCd = 1.0;
    /** 远处飞鸟。8~15 秒一批（1~3 只）横穿天空 */
    private birds: BirdRt[] = [];
    private birdG: Graphics | null = null;
    private birdCd = rand(2, 5);

    /** 待机引导动效的目标（按钮箭头、提示条、宠物卡） */
    private arrow: Node | null = null;
    private arrowBaseX = 0;
    private tip: Node | null = null;
    private tipBaseY = 0;
    private goCard: Node | null = null;

    /* toast */
    private toastBox: Node | null = null;
    private toastOp: UIOpacity | null = null;
    private toastLbl: Label | null = null;
    private toastT = 0;
    private toastState: 'in' | 'hold' | 'out' | 'off' = 'off';

    /* 出发卡 */
    private depart: Node | null = null;
    private departOp: UIOpacity | null = null;
    private departScrim: Graphics | null = null;

    /* 图鉴面板（右侧竖栏的「图鉴」入口打开） */
    private codex: Node | null = null;
    private codexOp: UIOpacity | null = null;

    /** 灶台 / 工作台 / 派遣 / 设置共用的一张卡片。同时只开一张。 */
    private sheet: Node | null = null;
    /** 派遣已经喊过「回来了」，避免每一帧都 toast */
    private dispatchPing = false;

    /**
     * UI 图标缓存（key → SpriteFrame）。
     *
     * **加载是异步的，绘制是同步的** —— 所以这里不阻塞面板：拿不到图就返回 null，
     * 调用方退回"圆点 + 首字"的老画法。加载完成后把 `iconsReady` 置真，
     * 下次开面板自动升级。这条"有图贴图、没图回退"和战斗侧 `ART` 表同一套思路。
     *
     * 资源在 `assets/resources/ui/icons/`（从 `assets/ui/icons/` 收缩复制来的 64px 版）。
     * 原始 128px 图**不动**，主界面顶部资源条还直连着它们。
     */
    private icons: Record<string, SpriteFrame> = {};
    private iconsReady = false;

    /** 任务抽屉（右侧滑出，不压暗场景）。同时只开一个 */
    private drawer: Node | null = null;
    private drawerOp: UIOpacity | null = null;
    /** 抽屉正在滑出/滑入，期间拒绝重开 —— 否则连点两下会建出两个抽屉 */
    private drawerBusy = false;

    /** 顶部资源数字的滚动动画：节点名 → { 起点, 终点, 已过秒数 } */
    private resAnim: Record<string, { from: number; to: number; t: number }> = {};
    /** 首次写值不走动画（场景里的初值是手写假数，滚出来像资源蒸发） */
    private resReady = false;

    /** 任务徽标的脉冲幅度（0 = 不脉冲）。有可领时才动 */
    private taskPulse = 0;
    private taskBtn: Node | null = null;

    /**
     * 存档快照。战斗结算写战利品，这里写喂饭 / 制作 / 派遣 / 亲密度。
     * 改完立刻 `saveSave`，顶部三个数字和饱食条同一帧刷新。
     */
    private save: SaveState = loadSave();

    constructor(canvas: Node) {
        this.canvas = canvas;
        this.canvasUT = canvas.getComponent(UITransform)!;
        this.lastMs = performance.now();
        /* 先清场：上一次会话（或曾经在编辑器里被写回盘的热区）会留下
           `Badge-工作台-hot` 这类节点，不清掉就会一路套娃
           （`-hot` → `-hot-hot` → `-hot-hot-hot`），最终把徽标层塞爆。 */
        this.stripStaleHots(canvas);
        /* 归位要排在 bindBadges 之前：热区是按徽标当前尺寸算的，
           先把图标/文字摆正，再挂热区，热区和视觉才对得上。 */
        this.alignHud();
        /* 先 alignHud 再钉到建筑上：alignHud 会把说明牌子贴回徽标下面。 */
        this.layoutRail();
        /* 文字拉开要排在 alignHud 之后：进度条的 txt-prog 是跟着 txt-stage 的
           实际位置下推的，alignHud 还没跑的话拿到的是场景里的旧值。 */
        this.fixLabelTightness();
        this.bindPets();
        /* 存档刷新必须排在 bindDock / bindHud 之前：
           它们绑的事件回调里会读 this.save（比如出战卡文案），
           先刷一遍能保证第一帧看到的就是真值。 */
        this.bindSave();
        /* 首帧写值不走滚动动画（原因见 setResVal）—— 必须紧跟 bindSave */
        this.resReady = true;
        this.syncLawn();
        this.applyPrefs();
        this.bindBadges();
        this.bindDock();
        this.bindHud();
        this.placeResources();
        this.bindAmbient();
        /* 图标是异步的，先发起加载再摆任务按钮 —— 加载完的回调会自己刷新徽标 */
        this.loadIcons();
        /* 宠物头像同理：图鉴 / 底部槽 / 出战卡都等它，回调里自己刷 */
        this.loadHeads();
        this.placeTaskBtn();
        this.placeDispatchCard();
        if (this.save.lastReward) {
            const msg = this.save.lastReward;
            this.commit({ ...this.save, lastReward: '' });
            this.toast(msg);
        }
    }

    /* ----------------------------------------------------------------------
     * 1a. UI 图标：异步加载 + 无图回退
     * -------------------------------------------------------------------- */

    /** 面板里要用到的全部图标。命名与 `resources/ui/icons/<key>.png` 一致 */
    private static readonly ICON_KEYS = [
        'apple', 'log', 'coin', 'hammer', 'pot', 'paw', 'paw-red', 'flag', 'mail',
        'gear', 'stew', 'basket', 'ration',
    ];

    /**
     * 预加载图标集。
     *
     * 为什么不用 `resources.loadDir`：loadDir 拿到的是一个数组、类型靠猜，
     * 而这里要的是"key → SpriteFrame"的确定性映射（`mkIcon('stew')` 必须拿到热汤）。
     * 逐个 load 的代价是 13 次回调，但每次都是同一路径，错了会立刻在控制台报出来。
     *
     * ⚠ 这些 PNG 是**脚本复制**进 assets 的，没有 .meta ——
     * Cocos 编辑器首次打开会自动生成。生成前 `resources.load` 找不到资源，
     * 表现为面板退回文字画法（不报错、不崩），属于预期降级。
     */
    private loadIcons() {
        const keys = HomeController.ICON_KEYS;
        let left = keys.length;
        const done = () => {
            if (--left > 0) return;
            this.iconsReady = true;
            this.refreshTaskBtn();
            this.paintHomeBadge();
        };
        for (const k of keys) {
            /* ⚠ 先试 `/spriteFrame` 后缀。Cocos 的图片在 resources 里是三层
               （ImageAsset → Texture2D → SpriteFrame），不带后缀可能拿到 ImageAsset，
               赋给 `Sprite.spriteFrame` 在运行时**静默失败** —— 不报错、图不显示。
               但后缀能不能用又取决于 meta 里 `userData.type`：
               本项目现有的 `post-overlay.png` meta 是 `type: texture`、只生成 texture 子资源，
               而代码里走的是 `/spriteFrame` —— 两种写法在项目里同时存在。
               所以这里**两条路都试**，谁成功用谁；都失败就退回文字画法（不崩、不空框）。 */
            const store = (sf: SpriteFrame | null | undefined) => {
                if (sf) this.icons[k] = sf;
                done();
            };
            resources.load(`ui/icons/${k}/spriteFrame`, SpriteFrame, (err, sf) => {
                if (!err && sf) { store(sf); return; }
                resources.load(`ui/icons/${k}`, SpriteFrame, (err2, sf2) => {
                    store(err2 ? null : sf2);
                });
            });
        }
    }

    /**
     * 往面板里放一颗图标。**没有图就返回 null，让调用方画回退样式** ——
     * 绝不留一个空白方块（那比没有图标更像 bug）。
     */
    private mkIcon(parent: Node, name: string, key: string, size: number, x: number, y: number): Node | null {
        const sf = this.icons[key];
        if (!sf) return null;
        const n = new Node(name);
        n.parent = parent;
        n.addComponent(UITransform).setContentSize(size, size);
        n.setPosition(x, y, 0);
        const sp = n.addComponent(Sprite);
        /* Sprite 默认 TRIMMED 会把 contentSize 改回贴图尺寸，
           这里要的是"我指定的 size"，必须 CUSTOM */
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = sf;
        return n;
    }

    /* ----------------------------------------------------------------------
     * 1a2. 宠物头像：图鉴格 / 底部槽 / 出战卡共用同一份
     *
     * **这一块是"图鉴只有汉字首字、太 low"那条的修法。** 在这之前，
     * 图鉴格子里写的是 `p.name.slice(0, 1)`（"尖""短""胖"），底部槽位
     * 连这个都没有 —— 六只宠物在 UI 上**一张脸都没露过**，只有草地上的立绘。
     * 玩家认脸比认字快，"回家的是谁"本来就是个脸的问题。
     *
     * 图从 `resources/grove/head/<short>.png` 来（96×96，`gen_grove_art.py`
     * 从 `ui/home/heads-circle/` 收缩，和战斗 HUD 左上角那个头像是同一份）。
     *
     * 加载走三条路，谁成功用谁（原因见 loadIcons 里那段注释）：
     *   ① `/spriteFrame` 子资源 —— 标准做法，但**这批图 meta 是 `type: texture`**，
     *      只生成 texture 子资源，所以这条大概率失败；
     *   ② `resources.load(path, SpriteFrame)` —— 同理会静默失败；
     *   ③ 取 ImageAsset，**运行时自己拼一个 SpriteFrame**（Texture2D 的 image
     *      = ImageAsset）。这条不依赖 meta 配置，永远能用。
     * 三条都失败就把节点藏掉 —— 留一个白框比没有图更像 bug。
     * -------------------------------------------------------------------- */

    /** 键 = `PetDef.short`。加载不到就是缺 key */
    private heads: Record<string, SpriteFrame> = {};

    private loadHeads() {
        for (const p of PETS) {
            const put = (sf: SpriteFrame | null | undefined) => {
                if (sf) {
                    this.heads[p.short] = sf;
                    this.refreshGoCard();
                    this.refreshSlots();
                    this.refreshCodexHeads();
                }
            };
            resources.load(`grove/head/${p.short}/spriteFrame`, SpriteFrame, (e1, sf1) => {
                if (!e1 && sf1) { put(sf1); return; }
                resources.load(`grove/head/${p.short}`, SpriteFrame, (e2, sf2) => {
                    if (!e2 && sf2) { put(sf2); return; }
                    resources.load(`grove/head/${p.short}`, ImageAsset, (e3, img) => {
                        if (e3 || !img) {
                            console.warn(`[Home] 头像没加载上（会退回文字）：grove/head/${p.short}`, e3);
                            return;
                        }
                        const tex = new Texture2D();
                        tex.image = img;
                        const sf = new SpriteFrame();
                        sf.texture = tex;
                        put(sf);
                    });
                });
            });
        }
    }

    /* 出战卡里那排心的几何。场景里 hearts-on 在 x=67、hearts-off 在 x=106，
       "♥♥♥" 占 23.62px → 每颗 7.87px 步进。
       为什么要这个数：`♡` 那几个必须**跟在实心心的右边**，而实心的数量随亲密度变。
       读 Label.width 不可靠（内容高度是下一帧才重算），所以用实测步进推。 */
    private static readonly HEART_X = 67;
    private static readonly HEART_ADV = 7.87;

    /**
     * 头像比图鉴面板晚到一步时，把已经建好的格子补上脸。
     *
     * 时序是真的会反过来的：`ensureCodex()` 是**点开图鉴那一刻**同步建的，
     * 而 `loadHeads()` 是 9 次 resources.load 的异步回调。玩家在主界面
     * 第一秒就点图鉴的话，格子先建出来、图后到 —— 不补就会出现
     * "开得早的那一次没有图，退出再进才有"这种鬼现象。
     */
    private refreshCodexHeads() {
        if (!this.codex) return;
        const card = this.codex.getChildByName('card');
        if (!card) return;
        for (const p of PETS) {
            const cell = card.getChildByName(`cell-${p.id}`);
            const head = cell?.getChildByName('head');
            const sf = this.heads[p.short];
            if (!cell || !head || !sf) continue;
            const hs = head.getComponent(Sprite);
            if (!hs) continue;
            const got = this.save.cleared >= p.at;
            hs.sizeMode = Sprite.SizeMode.CUSTOM;
            hs.color = got ? WHITE : new Color(110, 100, 92, 255);
            hs.spriteFrame = sf;
            head.active = true;
            /* 已收服那格原来用"名字首字"占位，有脸了就把那个字删掉；
               未收服那格的问号要留着（它回答的是"能不能带"）。 */
            if (got) {
                const mark = cell.getChildByName('mark');
                if (mark && mark.isValid) { mark.removeFromParent(); mark.destroy(); }
            }
        }
    }

    /**
     * 刷新出战卡：头像 / 名字 / 心。
     *
     * **这三个原来全是场景里写死的** —— `av` 永远是砂糖那张图、`name` 永远
     * 写着「砂 糖」、心永远是 ♥♥♥。于是不管换谁出战，卡片都长一个样，
     * 读起来就是"这卡片跟我的队伍没关系"，这是"完全不知道有啥用"的一半。
     */
    private refreshGoCard() {
        const card = this.canvas.getChildByName('Dock')?.getChildByName('GoCard');
        if (!card) return;
        const def = petById(this.save.active) ?? PETS[0];

        const av = card.getChildByName('av');
        if (av) {
            const sp = av.getComponent(Sprite);
            const sf = this.heads[def.short];
            if (sp && sf) {
                sp.sizeMode = Sprite.SizeMode.CUSTOM;
                sp.spriteFrame = sf;
                sp.color = WHITE;
            }
        }

        const nm = card.getChildByName('name')?.getComponent(Label);
        if (nm) {
            nm.string = def.name;
            /* 场景里这个名字的容器宽只有 31（够"砂 糖"两个字加空格）。
               "尖耳猫"要 40.5px —— 不放开就会缩成一个看不懂的小字。
               右边 star 在 106，名字从 63 起，可给 42。 */
            nm.overflow = Label.Overflow.SHRINK;
            const ut = nm.node.getComponent(UITransform);
            if (ut) ut.setContentSize(42, 18.9);
        }

        const h = heartsOf(this.save.pats[def.id] || 0);
        const on = card.getChildByName('hearts-on')?.getComponent(Label);
        const off = card.getChildByName('hearts-off')?.getComponent(Label);
        /* 两个心形 Label 的容器宽是场景里按"3 颗 / 2 颗"写死的（23.6 / 15.7），
           而根数随亲密度变 —— 不放开会把字**裁掉**（"换了只宠物，心不见了"）。
           但也不能无脑放到 44：两个容器都 44 宽时它们的矩形整个互相压住，
           文字审计直接报 `hearts-on × hearts-off 44×20 重叠`。
           所以**按实际心数分格**：实心占 h 格、空心占 (5-h) 格，右邻接左、不留缝也不重叠。
           锚点是 (0,1)，x0 = pos.x，所以右边界 = 位置 + 宽度，紧挨着就正好贴边。 */
        const ADV = HomeController.HEART_ADV;
        const H0 = HomeController.HEART_X;
        if (on) {
            on.overflow = Label.Overflow.NONE;
            on.string = '♥'.repeat(h);
            /* 场景里 hearts-off 的 alpha 只有 **41**（16%），压在奶白卡片上等于隐形，
               所以"0 颗心"和"这排心根本不存在"在玩家眼里长得一样。
               两档都给实色，靠色相区分有没有 —— 空槽要看得见，才有"可以涨"的信息。 */
            on.color = new Color(232, 104, 124, 255);
            const ut = on.node.getComponent(UITransform);
            if (ut) ut.setContentSize(h * ADV, 20.16);
            on.node.setPosition(H0, on.node.position.y, 0);
        }
        if (off) {
            /* 空心 `♡` 在中文字体里没有字形，渲染成方块（图鉴上那排方块）。
               所以空的那几颗也用 `♥`，靠 hearts-off 自己的浅色区分 ——
               形状一样、颜色两档，比"一半方块"清楚得多。 */
            off.overflow = Label.Overflow.NONE;
            const n = Math.max(0, 5 - h);
            off.string = '♥'.repeat(n);
            off.color = new Color(184, 168, 148, 255);
            const ut = off.node.getComponent(UITransform);
            if (ut) ut.setContentSize(n * ADV, 20.16);
            off.node.setPosition(H0 + h * ADV, off.node.position.y, 0);
        }
    }

    /**
     * 刷新底部六个槽：头像 / 锁 / 「这趟带谁」的金圈。
     *
     * 改造前这里只有一个 16×16 的锁图标 + 一行 `差N关`，**六只宠物一张脸都没露**。
     * 玩家看到的是一排密码锁，难怪"完全不知道有啥用"。
     *
     * 现在每格是一张头像：
     *  · 已到家 → 原色 + 名字；
     *  · 没到家 → 压暗 + 锁 + 「差N关」；
     *  · 这趟带的那只 → 金圈。
     */
    private refreshSlots() {
        const root = this.canvas.getChildByName('Dock');
        if (!root) return;
        const active = this.save.active;

        for (const n of root.children.slice()) {
            if (!n.name.startsWith('Slot-')) continue;
            const def = petByNode(n.name.slice(5));
            if (!def) continue;
            const need = petGap(this.save.cleared, def.id);
            const owned = need <= 0;
            const on = owned && def.id === active;

            /* ---- 头像 ----
               28×28 @ (9.5, -15)：槽位 47×72，tag 从 -51 起，
               所以脸占 -15..-43、正中在 -29 —— 和原来那个 16×16 的锁
               （-21..-37，中心 -29）同一个视觉中心。上一版放 -9 顶上去了，
               截图里头像是从盒子上沿冒出来的。 */
            const sf = this.heads[def.short];
            let head = n.getChildByName('__head');
            if (sf) {
                if (!head || !head.isValid) {
                    head = new Node('__head');
                    head.parent = n;
                    head.addComponent(UITransform).setContentSize(28, 28);
                    const hs = head.addComponent(Sprite);
                    hs.sizeMode = Sprite.SizeMode.CUSTOM;
                    head.setSiblingIndex(0);
                }
                head.active = true;
                head.setPosition(9.5, -15, 0);
                const hs = head.getComponent(Sprite);
                if (hs) {
                    hs.spriteFrame = sf;
                    /* 没到家的压暗而不是隐身：玩家要看见"这一格是谁"，
                       只是知道"还不能带它"。 */
                    hs.color = owned ? WHITE : new Color(126, 112, 98, 255);
                }
            } else if (head && head.isValid) {
                head.active = false;
            }

            /* ---- 锁：只在没到家时显示 ---- */
            const lock = n.getChildByName('av-bg');
            if (lock) lock.active = !owned;

            /* ---- 金圈：这趟带的那一只 ---- */
            let ring = n.getChildByName('__pick');
            if (on) {
                if (!ring || !ring.isValid) {
                    ring = new Node('__pick');
                    ring.parent = n;
                    ring.addComponent(UITransform).setContentSize(34, 34);
                    ring.setPosition(6.5, -12, 0);
                    const rg = ring.addComponent(Graphics);
                    rg.lineWidth = 2.6;
                    rg.strokeColor = new Color(245, 185, 60, 255);
                    rg.roundRect(-17, -17, 34, 34, 11);
                    rg.stroke();
                }
                ring.active = true;
            } else if (ring && ring.isValid) {
                ring.active = false;
            }

            /* ---- 透明度：没到家 140，已到家 255 ---- */
            const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
            op.opacity = owned ? 255 : 140;

            /* ---- tag：已到家写名字，没到家写还差几关，出战那只写「出战」 ----
             * 场景里这行是**写死**的「第1关 / 第3关」，HomeRuntime 从来没人改过。
             * 两个后果叠在一起就是玩家看到的「解锁了但主界面没有」：
             *   ① 文字永远是「第N关」，玩家读成关卡编号而不是"还差几关"；
             *   ② 已到家的那几格也挂着「第N关」+ 55% 灰，和没解锁的一模一样。 */
            const tag = n.getChildByName('tag')?.getComponent(Label);
            if (tag) {
                tag.string = !owned ? `差${need}关` : on ? '出战' : def.name;
                /* 场景里这行是 **8px / alpha 133**（给「第1关」这种短标签定的）。
                   8px 的中文在 1280 宽下是 4 行以后就糊掉的大小，
                   而这里要读的是名字 —— 换成 11px + 实色，
                   「没到家」那几格的灰由父节点 UIOpacity(140) 统一压，不在这层减。 */
                tag.fontSize = 11;
                tag.overflow = Label.Overflow.SHRINK;
                tag.color = on ? new Color(170, 108, 26, 255) : new Color(122, 80, 52, 255);
                const tut = tag.node.getComponent(UITransform);
                if (tut) tut.setContentSize(44, 14);
            }
        }
    }

    /* ----------------------------------------------------------------------
     * 1b. 对齐：图标 / 文字按容器中心归位
     * -------------------------------------------------------------------- */

    /**
     * 把所有"图标 + 文字"的组合重新归位。
     *
     * 场景里这些坐标是手写 JSON 摆的，五个徽标各写一遍，于是：
     *   · 说明底板的文字统一放在 (1,-1)，而底板有 48 宽（三个字）和 37 宽
     *     （两个字）两种 —— 结果每块牌子里的字都偏左 6.5px、偏上 3.5px；
     *   · 徽标里的图标各有 0~1px 漂移（(7,-7) 想居中的是 47×48 里的 32×32，
     *     应然是 (7.5,-8)）；
     *   · 左上角提示条的图标/文字/箭头三个中心落在 -22 / -23.5 / -21，
     *     差 2.5px，一条水平线上三个高度。
     * 单个看都不明显，五个并排（工作台 / 图鉴 / 灶台）就一眼是歪的。
     *
     * 这里统一按**容器中心**算一遍，不再依赖手摆的数字。前提是这些节点的
     * anchor 都是 (0,1)（场景里确实全是），所以 position 就等于"左上角"，
     * 居中公式可以直接用 (父宽 - 子宽) / 2。
     */
    private alignHud() {
        const BADGE_W = 48, BADGE_H = 48;
        /* 说明底板离圆徽 46px：牌子顶边压在圆徽下沿上面 2px，
           看起来是"挂"在徽标下面，不是浮在旁边 */
        const CAP_GAP = 46;

        const badges = this.canvas.getChildByName('Badges');
        if (badges) {
            for (const b of badges.children.slice()) {
                if (!b.name.startsWith('Badge-') || b.name.indexOf('-hot') >= 0) continue;
                const key = b.name.slice(6);

                const ico = b.getChildByName('ico');
                const iut = ico && ico.getComponent(UITransform);
                if (ico && iut) {
                    ico.setPosition((BADGE_W - iut.contentSize.width) / 2,
                                    -(BADGE_H - iut.contentSize.height) / 2, 0);
                }

                const cap = badges.getChildByName(`Cap-${key}`);
                const cut = cap && cap.getComponent(UITransform);
                if (!cap || !cut) continue;
                const cw = cut.contentSize.width, ch = cut.contentSize.height;
                // 底板与圆徽共用一条竖直中轴
                cap.setPosition(b.position.x + (BADGE_W - cw) / 2, b.position.y - CAP_GAP, 0);

                /* ⚠ 这里原来是 `txt.setPosition((cw - tut.contentSize.width) / 2, ...)` ——
                   它默认"容器宽 = 文字宽"，而场景里 txt 的宽是**写死的**
                   （「工作台」36 / 「图鉴」24），Label 又是左对齐。
                   文案字数一变，字就贴到容器左边（「家」偏左 12px）。
                   改成容器吃满 + 居中 + SHRINK，以后改文案不会再歪。 */
                this.fitCapText(cap, cw);
            }
        }

        const hud = this.canvas.getChildByName('HUD');
        if (!hud) return;

        /* 左上角提示条：「爪印 · 文案 · 箭头」三点一线。
           三个东西高度不同（20 / 15 / 16），所以按各自高度算居中，不能写同一个 y。 */
        const tip = hud.getChildByName('HudTip');
        const tut2 = tip && tip.getComponent(UITransform);
        if (tip && tut2) {
            const ph = tut2.contentSize.height;
            for (const nm of ['paw', 'txt', 'ar']) {
                const n = tip.getChildByName(nm);
                const ut = n && n.getComponent(UITransform);
                if (n && ut) n.setPosition(n.position.x, -(ph - ut.contentSize.height) / 2, 0);
            }
        }

        /* 进度条卡：关卡名和连锁倍率都跟进度点对齐同一条中线。
           原来 stage 比 pip 高 2px、chain 比 pip 低 1px —— 一行字配一排方块，
           差 2px 就是"没对齐"。 */
        const prog = hud.getChildByName('HudProgress');
        const pip = prog && prog.getChildByName('pip-0');
        const put = pip && pip.getComponent(UITransform);
        if (prog && pip && put) {
            const mid = pip.position.y - put.contentSize.height / 2;
            for (const nm of ['txt-stage', 'txt-chain']) {
                const n = prog.getChildByName(nm);
                const ut = n && n.getComponent(UITransform);
                if (n && ut) n.setPosition(n.position.x, mid + ut.contentSize.height / 2, 0);
            }
        }

        /* 设置按钮：43×46 里放 30×30，应然是 (6.5,-8)，原来写成 (6,-6)。 */
        const btn = hud.getChildByName('IconBtn');
        const but = btn && btn.getComponent(UITransform);
        if (btn && but) {
            const ico = btn.getChildByName('ico');
            const iut = ico && ico.getComponent(UITransform);
            if (ico && iut) {
                ico.setPosition((but.contentSize.width - iut.contentSize.width) / 2,
                                -(but.contentSize.height - iut.contentSize.height) / 2, 0);
            }
        }

        /* Logo 副标题与主标题左边缘对齐。两行字差 2px，中文标题和全大写英文
           并排时特别明显 —— 英文的 M 左边缘会显得往里缩。 */
        const title = hud.getChildByName('Logo-Title');
        const sub = hud.getChildByName('Logo-Sub');
        if (title && sub) sub.setPosition(title.position.x, sub.position.y, 0);
    }

    /**
     * 文字贴合修正：把"容器重叠"的地方拉开。
     *
     * 为什么单独一个方法、而不改场景里的坐标：
     *   Home.scene 里的 Label 容器高是手工写的，而**实际文字行高按 fontSize×1.3 算**——
     *   两者对不上时文字就溢出容器压到下一行。这类问题靠眼睛看不出来
     *   （缩到 50% 就是一团糊），必须让工具量。数值来自
     *   `node tools/_home-rt-shot.js <名> --text` 的"文字间距"报告，不是估的。
     *
     * 为什么不在场景 JSON 里改：`JSON.stringify` 重写场景会让 `__id__` 重排，
     * 2000+ 行全量 diff（这个坑踩过），而且坐标真相会分裂成两处。
     *
     * 已修的 6 处（改前数值 → 改后）：
     *   1. Logo 英文副标题整行被中文标题压住 —— 文字重叠 8.5px，屏幕上根本看不见
     *   2. 关卡进度「苔 原」与「x / 8 关」重叠 1.8px（txt-prog 没参与中线对齐）
     *   3. 出战卡「砂 糖」与心形重叠 2.1px
     *   4.~6. 三个资源卡的数字与标签（果子/材料/吧唧）重叠 0.5px —— 贴死了
     */
    private fixLabelTightness() {
        const hud = this.canvas.getChildByName('HUD');

        /* 1. Logo：24px 中文标题的行高 31、8.5px 英文副标题行高 11，
              容器却是 36.2 和 11.3 —— 副标题整块被压在标题下半截里。
              下移到 299（原 314）后间隙 6.4px。 */
        const sub = hud?.getChildByName('Logo-Sub');
        if (sub) sub.setPosition(sub.position.x, 299, 0);

        /* 2. 关卡进度：alignHud 只把 txt-stage / txt-chain 对齐到 mini 中线，
              txt-prog 没管 → 它坐在 stage 的容器里。按 stage 的实际位置下推 20。 */
        const prog = hud?.getChildByName('HudProgress');
        const stage = prog?.getChildByName('txt-stage');
        const progTxt = prog?.getChildByName('txt-prog');
        if (stage && progTxt) progTxt.setPosition(progTxt.position.x, stage.position.y - 20, 0);

        const gc = this.canvas.getChildByName('Dock')?.getChildByName('GoCard');
        if (gc) {
            /* 3. 名字 13.5px（行高 17.5）与心形 11.5px（行高 15）只差 1.5px 就贴上。
                  心形下移到 -36；belly 从 -47 让到 -53 给它腾地方（卡高 72，底 -62 仍有余量）。
                  上一版 -34 只拉开 0.6px（审计报“太近”），再降 2px 才有 2.6px 净间隙。 */
            for (const nm of ['hearts-on', 'hearts-off']) {
                const n = gc.getChildByName(nm);
                if (n) n.setPosition(n.position.x, -36, 0);
            }
            for (const nm of ['belly-0', 'belly-1', 'belly-2', 'belly-txt']) {
                const n = gc.getChildByName(nm);
                if (n) n.setPosition(n.position.x, -53, 0);
            }
        }

        /* 4. 资源卡：18px 数字的容器底边和 10px 标签的容器顶边只差 0.7px，
              文字实际渲染出来是"248"和"果子"贴着。标签下移 3。 */
        const dock = this.canvas.getChildByName('Dock');
        for (const card of ['Res-Apple', 'Res-Log', 'Res-Coin']) {
            const lbl = dock?.getChildByName(card)?.getChildByName('lbl');
            if (lbl) lbl.setPosition(lbl.position.x, -45, 0);
        }
    }

    /* ----------------------------------------------------------------------
     * 1c. 系统入口：从"散贴在地图上"收成一条竖栏
     * -------------------------------------------------------------------- */

    /**
     * 系统入口：从"散贴在地图上的五个"收成三个建筑入口 + 一个设置。
     *
     * **收敛依据**：灶台和工作台做的事情是同一类 —— "花资源换一个数值"。
     * 分成两个入口的代价是玩家要记住食物在哪个炉子旁、配方在哪个桌子旁，
     * 而两边加起来只有 5 个可选项目。合并成「工坊」之后点一次进去左右分栏，
     * 喂饭和制作在同一个面板里，还省掉一块牌子。
     *
     * 改前：工作台 / 图鉴 / 灶台 / 派遣（四块牌子）+ 右上角设置。
     * 改后：工坊 / 图鉴 / 派遣（三块牌子）+ 右上角设置 = **四个入口**。
     * 「去苔原」仍然藏掉 —— 右下角的出门按钮已经是这条路。
     */
    private layoutRail() {
        const badges = this.canvas.getChildByName('Badges');
        if (!badges) return;

        /* 「工坊」沿用工作台那块牌子的位置（木桌旁）。
           为什么不搬到灶台那边：木桌更靠画面中部，是玩家视线落点；
           灶台在左侧偏下、离宠物群太近，牌子和宠物会挤。 */
        const keep = new Set(['图鉴', '工作台', '派遣']);
        for (const n of badges.children.slice()) {
            if (n.name.indexOf('-hot') >= 0) continue;
            const key = n.name.startsWith('Badge-') ? n.name.slice(6)
                : n.name.startsWith('Cap-') ? n.name.slice(4) : '';
            if (!key || keep.has(key)) continue;
            n.active = false;
        }

        /* 工作台 → 工坊：牌子上写「工坊」。
           本来的名字是「家」，但它底下同时有灶台（喂饭）和木工台（做东西），
           叫「家」把"在这儿能动手做东西"这件事整个盖掉了，读起来像一个目的地。
           底板收到 40 宽 —— 和图鉴 / 派遣一致，一排看过去才是齐的。
           ⚠ 改了宽度必须重摆位置：alignHud 是按 52 宽算的，直接用会偏右 6px。 */
        const cap = badges.getChildByName('Cap-工作台');
        const bd = badges.getChildByName('Badge-工作台');
        const bt = bd?.getComponent(UITransform);
        const cut = cap?.getComponent(UITransform);
        if (cap && cut && bd && bt) {
            const lbl = cap.getChildByName('txt')?.getComponent(Label);
            if (lbl) lbl.string = '工坊';
            cut.setContentSize(40, cut.contentSize.height);
            cap.setPosition(bd.position.x + (bt.contentSize.width - 40) / 2, cap.position.y, 0);
            this.fitCapText(cap, 40);
        }

        /* 图标换成锅（pot）。图是异步来的，这里先试一次，
           没图就保留原来那把锤子 —— 等 loadIcons 回来会再调一次。
           不能画个空方块等它，那在首帧就是一块白板。 */
        this.paintHomeBadge();
    }

    /**
     * 说明牌里的字，永远在牌子正中。
     *
     * **这是"UI 字体对不齐"的根因，不是微调 1~2px 能解决的**：
     * `Cap-工作台/txt` 的容器宽在场景里写死 36（那是给「工作台」三个字留的），
     * 而 Label 的对齐方式是 hAlign NONE（左对齐）。改成「家」一个字之后，
     * 12px 的字放进 36 宽的容器里，字整个贴在容器左边 —— 视觉上就是
     * "字偏到牌子左侧 12px"，牌子越大越明显。
     *
     * 修法不是把坐标挪 12px（下次改文案又歪），而是让容器吃满牌子 + 居中 + SHRINK：
     * 不管写两个字还是三个字，都自动居中，且永远不会溢出牌子。
     */
    private fitCapText(cap: Node, capW: number) {
        const txt = cap.getChildByName('txt');
        const tut = txt?.getComponent(UITransform);
        const tlb = txt?.getComponent(Label);
        if (!txt || !tut || !tlb) return;
        const cw = capW - 6;
        const ch = cap.getComponent(UITransform)!.contentSize.height - 4;
        tut.setContentSize(cw, ch);
        tlb.horizontalAlign = Label.HorizontalAlign.CENTER;
        tlb.verticalAlign = Label.VerticalAlign.CENTER;
        tlb.overflow = Label.Overflow.SHRINK;
        /* anchor 是 (0,1)，所以 position 就是"左上角"：居中 = (父宽-子宽)/2 */
        txt.setPosition(3, -2, 0);
    }

    /**
     * 给「工坊」换锅图标。幂等，可以随便多调。
     * 幂等是有必要的：`layoutRail` 和 `loadIcons` 的回调都会调它，
     * 谁先到谁先生效，后到的不该把已经换好的图再换回去。
     */
    private paintHomeBadge() {
        const sf = this.icons['pot'];
        if (!sf) return;
        const ico = this.canvas.getChildByName('Badges')
            ?.getChildByName('Badge-工作台')?.getChildByName('ico');
        const sp = ico?.getComponent(Sprite);
        if (!sp || sp.spriteFrame === sf) return;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = sf;
    }

    /**
     * 移除残留热区。
     *
     * 热区名一律带 `-hot`，而手工搭的场景里不会有这种名字 —— 所以"名字里含 -hot"
     * 就是可靠的判定。这层自愈是必需的：热区是运行时节点，一旦被写回场景文件，
     * 就会在新会话里被当成正常元素再包一层热区，越开越多。
     */
    private stripStaleHots(root: Node, depth = 0) {
        if (depth > 4) return;
        for (const n of root.children.slice()) {
            if (n.name.indexOf('-hot') >= 0) {
                n.removeFromParent();
                n.destroy();
                continue;
            }
            this.stripStaleHots(n, depth + 1);
        }
    }

    /* ----------------------------------------------------------------------
     * 0. 存档回流：把战斗带回来的东西刷到界面上
     *
     * 改造前：家园顶部三个数字（248 / 36 / 12）是**场景里写死的 Label**，
     * 打一百场也不会变；出战卡写着"饱食 12 / 20"、战斗里却是 100 制。
     * 现在三个数字、关卡进度、饱食度全部来自同一个存档。
     * -------------------------------------------------------------------- */

    private bindSave() {
        const s = this.save;

        /* ---- 资源池 ---- */
        this.setResVal('Res-Apple', s.apples);
        this.setResVal('Res-Log', s.logs);
        this.setResVal('Res-Coin', s.coins);

        /* 院子里现在可能站着好几只，提示不能再只报一只的名字 ——
           「星屑 在院子里」配着草地上三只宠物，读起来像另外两只是走丢的。 */
        const home = unlockedPets(s.cleared);
        const tipTxt = this.canvas.getChildByName('HUD')
            ?.getChildByName('HudTip')
            ?.getChildByName('txt')
            ?.getComponent(Label);
        if (tipTxt && home.length) {
            tipTxt.string = home.length === 1
                ? `${home[0].name} 在院子里`
                : `${home.length} 位伙伴在院子里`;
        }

        /* ---- 关卡进度（苔原 x / 8 + 8 个关卡格）---- */
        const prog = this.canvas.getChildByName('HUD')?.getChildByName('HudProgress');
        if (prog) {
            const txt = prog.getChildByName('txt-prog')?.getComponent(Label);
            /* 关卡进度：**报总数不报产地**。
             * 原来是「苔原 x / 8」—— 8 是写死的，27 屏下第 9 屏就撞上界。
             * 现在报「x / 27 关」，产地由下面那排点分组表达，
             * 不必再挤进这个 66px 宽的 Label（它旁边紧挨着「苔 原」两个字）。
             *
             * ⚠ 容器宽只有 35（场景里按「1 / 8 关」一位数写的）。两位数就会溢出：
             * 文字审计报 `txt-prog [NONE] 文字 40px > 容器 35px 「11 / 27 关」`，
             * 溢出部分直接画到容器外 —— 而且它跟「苔 原」是上下叠放的，
             * 横向加宽不会撞到谁。所以放到 46 并加 SHRINK 兜住三位数。 */
            if (txt) {
                txt.overflow = Label.Overflow.SHRINK;
                const ut = txt.node.getComponent(UITransform);
                if (ut && ut.contentSize.width < 46) ut.setContentSize(46, ut.contentSize.height);
                txt.string = `${s.cleared} / ${STAGE_COUNT} 关`;
            }
            /* 关卡格：已通关的点亮。`pip-on` / `pip` 是两张不同的贴图，
               换图要换 spriteFrame + 尺寸，这里只做透明度降权 —— 
               保持"已确认版式不动"的原则，不引入新的切图。 */
            for (let i = 0; i < 8; i++) {
                const pip = prog.getChildByName(`pip-${i}`);
                if (!pip) continue;
                const on = i < s.cleared;
                const op = pip.getComponent(UIOpacity) ?? pip.addComponent(UIOpacity);
                op.opacity = on ? 255 : 90;
            }
        }

        /* ---- 出门按钮副标题：原来烘死在 Label 里写着"带砂糖" ----
           能量门禁删掉之后这里没有"还够不够出门"要报了，
           换成这一趟最关键的两个数：**带谁**、饿到什么程度。
           写"3 只"是错的 —— 战斗里只有 1 个单位（一宠出征），
           玩家会以为三个都上场。 */
        const go = this.canvas.getChildByName('Dock')?.getChildByName('Btn-Go');
        const gl = go?.getChildByName('line')?.getComponent(Label);
        if (gl) {
            gl.overflow = Label.Overflow.SHRINK;
            gl.string = `带 ${this.carrierText()} · 饱食 ${Math.round(s.satiety)}`;
        }
        this.refreshTaskBtn();

        /* ---- 饱食度：与战斗同一个 0~100 的数 ---- */
        this.refreshSatiety();
        /* ---- 出战卡的头像 / 名字 / 心，以及底部槽的「这趟带谁」金圈 ----
           这两件事原来**完全没有**：卡片和槽位都是场景里写死的静态图，
           换谁出战都不变 —— 玩家看不出 bottom 那排格子和"出门"有关系。 */
        this.refreshGoCard();
        this.refreshSlots();
    }

    /**
     * 三张资源卡**留在 Dock 左端**，并排贴紧。
     *
     * 上一版把它们搬到右上角（right=568 / top=346）。那个位置和提示条
     * HudTip（屏幕 965..1208 / 6..46）**整块重叠** —— 果子卡 925..1014、
     * 材料卡 1022..1111、吧唧卡 1119..1208，后两张直接盖在提示条上。
     * 这就是用户说的"位置也不对"。而 Dock 左端 17..282 反过来空出 265px，
     * 一格宽的空洞比放三张卡还显眼。
     *
     * 而且 Dock 本来就是按"左边三张资源卡"排的：宠物卡起点 287
     * 正好接在 282 后面。所以正确的做法不是给卡找新位置，是**别动它们**。
     *
     * 只修一处：场景里三张卡是 89 宽、间距 88，相邻两张压 1px。
     * 1px 重叠在纯色卡上看不出来，但两张卡都有 4px 深棕描边，
     * 叠起来会在交界处出现一条双倍深的竖线。改成间距 90（留 1px 缝）。
     */
    private placeResources() {
        const dock = this.canvas.getChildByName('Dock');
        if (!dock) return;
        const names = ['Res-Apple', 'Res-Log', 'Res-Coin'];
        const LEFT = -623;   // 屏幕 x 17
        const TOP = -270;    // 屏幕 y 630
        const GAP = 1;
        let x = LEFT;
        for (const name of names) {
            const n = dock.getChildByName(name);
            const ut = n && n.getComponent(UITransform);
            if (!n || !ut) continue;
            /* 两张卡的锚点都是左上，所以 position 就是左上角，不用再算 anchor */
            n.setPosition(x, TOP, 0);
            x += ut.contentSize.width + GAP;
        }
    }

    /** 写一个资源卡的数值（`Res-*` 节点下名为 `val` 的 Label） */
    /**
     * 顶栏资源数字。
     *
     * **首次直接写，之后的变化才滚动** —— 这两件事必须分开：
     * 场景里这三个数是手工写的（248 / 36 / 12），存档里可能是 3。
     * 如果第一帧也走滚动动画，玩家看到的是"248 一路掉到 3"，
     * 读作资源蒸发；而"喂一次饭 +22"的滚动才是他真正该看到的信息。
     */
    private setResVal(nodeName: string, v: number) {
        const lbl = this.resLabel(nodeName);
        if (!lbl) return;
        if (!this.resReady) { lbl.string = String(v); return; }
        const cur = Number(lbl.string) || 0;
        if (cur === v) return;
        this.resAnim[nodeName] = { from: cur, to: v, t: 0 };
    }

    private resLabel(nodeName: string): Label | null {
        const dock = this.canvas.getChildByName('Dock');
        const card = dock?.getChildByName(nodeName);
        return card?.getChildByName('val')?.getComponent(Label) ?? null;
    }

    /**
     * 资源数字滚动。0.34s cubicOut。
     *
     * 为什么值得为三个数字写一段动画：资源变化是家园里**唯一的高频反馈** ——
     * 喂一次饭扣果子、派遣回来加材料，全是数字跳变。
     * 直接跳变玩家注意不到（数字从 12 变 4，扫一眼以为没变），
     * 滚一下就有了"东西进来了/出去了"的读数。
     */
    private tickResAnim(dt: number) {
        const keys = Object.keys(this.resAnim);
        if (!keys.length) return;
        for (const k of keys) {
            const a = this.resAnim[k];
            a.t = Math.min(0.34, a.t + dt);
            const p = a.t / 0.34;
            const e = 1 - Math.pow(1 - p, 3);
            const lbl = this.resLabel(k);
            if (lbl) lbl.string = String(Math.round(a.from + (a.to - a.from) * e));
            if (p >= 1) delete this.resAnim[k];
        }
    }

    /**
     * 刷新出战卡的饱食度显示。
     *
     * **3 格 bar 不是"三等分"**，是按战斗里的档位线 70 / 30 着色：
     *  · ≥70 满饱（绿）· 30~70 半饿（金，**最强区间**）· <30 全饿（红）
     * 这样家园那条 bar 的形状本身就把"半饿最强"教给了玩家 ——
     * 金色是招牌色，战斗里 `C_SATIETY_SWEET` 用的也是金。
     * 改造前这 3 格是三个同色小方块，不表达任何信息。
     */
    private refreshSatiety() {
        const v = clamp(this.save.satiety, 0, SATIETY.max);
        const full = v >= SATIETY.fullLine;
        const hungry = v >= SATIETY.hungryLine;

        const col = full
            ? new Color(107, 203, 119, 255)      // PALETTE.safe
            : hungry
                ? new Color(255, 215, 0, 255)    // PALETTE.gold
                : new Color(255, 82, 82, 255);   // PALETTE.danger
        const dim = new Color(126, 104, 82, 60);

        const card = this.canvas.getChildByName('Dock')?.getChildByName('GoCard');
        if (card) {
            for (let i = 0; i < 3; i++) {
                const seg = card.getChildByName(`belly-${i}`);
                const sp = seg?.getComponent(Sprite);
                if (sp) sp.color = dim;
            }
            /* 亮的格数：满饱 3 格、半饿 2 格、全饿 1 格。
               不用"按数值比例"填 —— 3 格里填 1.7 格读成一个色块，
               反而看不出档位。 */
            const lit = full ? 3 : hungry ? 2 : 1;
            for (let i = 0; i < lit; i++) {
                const sp = card.getChildByName(`belly-${i}`)?.getComponent(Sprite);
                if (sp) sp.color = col;
            }
        }

        const txt = card?.getChildByName('belly-txt')?.getComponent(Label);
        if (txt) {
            /* 显示 N/100 而不是"满饱/半饿"：
               一个数字比一个形容词更能让玩家把家园和战斗里的两条 bar 认成同一件事。 */
            txt.string = `${Math.round(v)}/${SATIETY.max}`;
        }
    }

    /** 出战卡的文案（多处复用，避免各写一份各说一套） */
    private goCardText(): string {
        const def = petById(this.save.active) ?? PETS[0];
        const v = Math.round(clamp(this.save.satiety, 0, SATIETY.max));
        /* 心情读**这只自己的**亲密度。上一版这里写死 "心情 3 颗心" ——
           六只共用一个假数字，而图鉴里同一只明明白白写着 ♥♡♡♡♡。 */
        const h = heartsOf(this.save.pats[def.id] || 0);
        return `${def.name} · 招式「${def.tag}」· 亲密度 ${h} / 5 · 饱食 ${v} / ${SATIETY.max}`;
    }

    /** 队伍一句话（出战卡 / 出发卡共用） */
    private squadText(): string {
        const out = unlockedPets(this.save.cleared).slice(0, MAX_SQUAD);
        const names = out.map((p) => p.name);
        const next = PETS.find((p) => p.at > this.save.cleared);
        const tail = next
            ? `　再通 ${petGap(this.save.cleared, next.id)} 关 ${next.name} 回家`
            : '　全员到齐';
        return `${squadSize(this.save.cleared)} 只　${names.join(' / ')}${tail}`;
    }

    /**
     * 这趟带谁 —— 出门按钮副标题 / 出发卡第一行共用。
     *
     * **"队伍 3 只"是个会误导人的说法。** 战斗里只有 1 个单位
     * （宪法红线：一宠出征、六宠看家），所以玩家需要知道的是
     * **哪一只**，而不是"一共几只"。写"3 只"会让人以为三个都上场。
     */
    private carrierText(): string {
        const def = petById(this.save.active) ?? PETS[0];
        return `${def.name} · ${def.tag}`;
    }

    /* ----------------------------------------------------------------------
     * 1. 宠物：呼吸 / 溜达 / 点击
     * -------------------------------------------------------------------- */

    private bindPets() {
        const root = this.canvas.getChildByName('Pets');
        if (!root) return;

        /* bindPets 会重复跑（切场景回来 / 派遣前后来回），先清掉运行时状态 */
        this.pets.length = 0;

        /* ⚠ 必须快照：下面会往 children 里加节点，直接遍历原数组会无限递归 */
        const kids = root.children.slice().filter((n) => n.name.indexOf('-hot') < 0);

        /* ---- 第一遍：定下谁在场 ----
           存档说了算：场景把六只都预置好了，但只有解锁的该出现在垫子上。
           未解锁的连热区都不建 —— 一只看不见的宠物能点出 toast 是 bug。

           判据是「通关数够不够它回家」，**不是**「它是不是已解锁里最新那一只」。
           原来写的是 `def.id === lead.id`（lead = 已解锁中 at 最大的那只），
           后果不是「新解锁的不出现」，而是**更严重的一种**：
           解锁雪团的那一刻 lead 换成雪团，砂糖/年糕/团子同时 active=false ——
           院子里立刻只剩一只，而且以后再解锁谁，上一只就消失。
           玩家看到的现象正是「我明明解锁了几只，主界面还是只有一个」。

           这条判据在 bindPets 和 syncLawn 各写了一份，两处必须一起改，
           否则派出去/收回来一次，垫子又回到一只。 */
        const onKinds: { n: Node; def: PetDef }[] = [];
        for (const n of kids) {
            /* 用 node 匹配，不是 name —— name 是显示文案，随文案改就会断 */
            const def = petByNode(n.name);
            const on = !!def && this.save.cleared >= def.at;
            n.active = on;
            if (on && def) onKinds.push({ n, def });
        }

        /* ---- 第二遍：排座位 ----
           **必须等"谁在场"全都知道了再排**：落点是按在场只数算的。
           一边遍历一边排，就会按"遍历到第几个"算 —— 只解锁一只时
           它会站在最左边（那是给六只排的位置里的第 0 个）。 */
        const slots = layoutPets(onKinds.map((k) => k.n.name));

        let shadowIdx = 0;
        for (const { n, def } of onKinds) {
            const slot = slots.get(n.name)
                ?? { name: n.name, x: LAWN_SPOT[0], y: LAWN_SPOT[1], depth: 0.5 };

            /* 设计坐标转画布中心系：x 走 `lx()`，y 是 `H/2 - y`（Cocos 的 y 向上） */
            n.setPosition(lx(slot.x), H / 2 - slot.y, 0);

            /* ---- 尺寸归一：按**宽高比**重设 contentSize ----
               场景里那六个 UITransform 是历次手调的（既不等高也不等比，
               雪团被横向压窄了 40%），六只坐到一块就是"大小不齐 + 变形"。
               这是**唯一一处**把它们拉回同一把尺子的地方：
                 · 高统一 = PET_H → 视觉体重一致；
                 · 宽 = PET_H × 原图宽高比 → 等比，不拉伸；
                 · 图片内容贴底（六张 bottom-gap 都是 0）→ 脚底正好落在锚点上。 */
            const art = PET_ART[n.name] ?? 1;
            const petW = PET_H * art;
            const ut = n.getComponent(UITransform);
            if (ut) ut.setContentSize(petW, PET_H);

            /* ---- 影子 ----
               bindPets 可能重复跑（切场景回来），先清掉旧的再建，
               否则 Pets 下会积一堆重名影子，越切越黑。 */
            const oldSh = root.getChildByName(`${n.name}__shadow`);
            if (oldSh && oldSh.isValid) { oldSh.removeFromParent(); oldSh.destroy(); }
            const sh = new Node(`${n.name}__shadow`);
            sh.parent = root;
            sh.addComponent(UITransform).setContentSize(petW, 16);
            const sg = sh.addComponent(Graphics);
            /* alpha 110 而不是 92：六只现在统一缩到 60px 高，影子只有
               25×14，92 的投影在明亮的草地上几乎读不出来。
               这是"接地"的唯一证据，宁可略重也不能看不见。 */
            sg.fillColor = new Color(52, 36, 26, 110);
            sg.ellipse(0, 0, petW * 0.46, 7);
            sg.fill();
            /* 排在宠物前面 —— 先画影子，宠物才会压在影子上面。
               用递增计数器而不是 `n.getSiblingIndex()`：所有影子占 0..N，
               宠物自然被顶到后面，而且不依赖"当前节点在第几位"（重复调用也稳）。 */
            sh.setSiblingIndex(shadowIdx++);
            sh.setPosition(n.position.x, n.position.y - 2, 0);

            const depth = slot.depth;

            const rt: PetRt = {
                node: n,
                name: slot.name,
                baseY: n.position.y,
                left: lx(slot.x - PET_ROAM_R),
                right: lx(slot.x + PET_ROAM_R),
                /* 前后 ±7：给"凑近一点玩"留深度余地，再大后排脚会顶到前排头顶 */
                far: -7,
                near: 7,
                ph: rand(0, Math.PI * 2),
                dur: rand(2.8, 3.7),
                moving: false,
                /* 首次延迟错开，避免一进场景六只同时起步 */
                wait: rand(0.6, 2.2),
                fx: 0, fy: 0, tx: 0, ty: 0, wt: 0, wd: 1, yOff: 0,
                dir: 1,
                step: rand(0, 1),
                walked: rand(0, 40),
                /* 24px 一步：84px 高的 Q 版宠物腿短，一步 24 刚好。
                   速度 42~58px/s ÷ 24 ≈ 1.8~2.4 步/秒。 */
                stride: 24,
                gait: 0,
                /* 姿势从随机态起步：六只同时伸懒腰比"都不动"更假 */
                pose: pickPose(), poseT: 0, poseDur: rand(0.8, 2.0),
                depth,
                shadow: sh,
                pop: 0,
                down: false,
                pounce: 0, pounceT: 0, pDir: 1, pDx: 0, pFx: 0,
                /* 直接给目标缩放：从 1 平滑过去会先演一段"长出来" */
                sy: 0.98 + depth * 0.04,
                sx: 0.98 + depth * 0.04,
                rot: 0,
            };
            this.pets.push(rt);

            /* 热区挂在宠物**节点下**，跟着一起动。
               不接管缩放 —— 步态和按下蹲下都走 scale，两个 tween 抢同一通道必然打架。 */
            const hot = new Node(`${n.name}-hot`);
            hot.parent = n;
            hot.addComponent(UITransform).setContentSize(HOT_MIN, HOT_MIN);
            hot.setPosition(0, PET_H / 2, 0);

            hot.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
                e.propagationStopped = true;
                rt.down = true;
            });
            hot.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                rt.down = false;
                rt.pop = 0.42;
                this.popHeart(n);
                if (!def) return;
                const r = recordPat(this.save, def.id);
                if (r.ok) this.commit(r.next);
                this.toast(r.say);
            });
            hot.on(Node.EventType.TOUCH_CANCEL, () => { rt.down = false; });
        }

        /* 按群内深度重排绘制顺序：y 大的（近）必须**后**画。
           不排的话顺序就是 PETS 的顺序 —— 后排的白兔会画在前排的仓鼠上面，
           变成"远的盖住近的"，一眼假。影子已经占了 0..N-1，宠物从 N 开始。 */
        this.pets
            .slice()
            .sort((a, b) => a.depth - b.depth)
            .forEach((p, i) => p.node.setSiblingIndex(this.pets.length + i));
    }

    /**
     * 起步走一段。**当前没有被调用** —— `PET_WALK` 是 false。
     *
     * 关掉的原因不是这套动作不对，是**场地变了**：六只现在坐在同一块
     * 直径 209px 的垫子上，任何位移都会走进邻只的格子，而
     * "互相不要遮挡"是这一版的第一要求。位移和它直接冲突，只能二选一。
     *
     * 方法本身留着，因为它已经跨过了当年那道坎。当年它被判死刑，
     * 注释写的是「横移 → 贴纸在滑」。那次判断没错，但缺的不是曲线，
     * 是**接地**：没有影子的时候，任何位移都读成"贴图被拖着走"。
     *
     * 现在它成立靠三层，缺一层就不成立：
     *   1. 影子钉住地面（`shadow`，不跟 bob）；
     *   2. 步频由位移推（`walked / stride`），脚不打滑；
     *   3. 距离压到 18~44px —— 长距离会重新暴露"这是一张图"。
     *
     * 没做的一件：**左右翻转**。立绘是正面偏侧（光从左上打过来），
     * 翻转会让高光跑到右边，比"不转身"更假。方向感交给 `sway`（左右倾）。
     *
     * PET_WALK 已打开（用户要求嬉戏）。自由溜达照旧只走小步；
     * 大幅度的位移全部来自互动剧本（stageChase / stagePounce），
     * 它们的落点都是**预先算好、保证不进邻只格子**的。
     */
    private startWalk(p: PetRt) {
        const curX = p.node.position.x;
        let tx = curX;
        let ty = p.yOff;

        if (Math.random() < 0.78) {
            /* 横向：在自己的 ±PET_ROAM_R 领地里挑一个点。
               距离压到 18~44px —— 再长就没有"一群"的紧凑感，也重新读成滑。 */
            const dist = rand(18, 44) * (Math.random() < 0.5 ? -1 : 1);
            tx = clamp(curX + dist, p.left, p.right);
            ty = clamp(p.yOff + rand(-4, 4), p.far, p.near);
        } else {
            /* 前后：在深度带里挪一点 */
            ty = rand(p.far, p.near);
            tx = clamp(curX + rand(-10, 10), p.left, p.right);
        }
        /* 两条支路都收一次口，保证永远站在草地这条带上 */
        ty = clamp(ty, p.far, p.near);

        /* 走不出东西就换一个，不要把"原地抖"当成一次移动 */
        if (Math.hypot(tx - curX, ty - p.yOff) < 10) { p.wait = 0.4; return; }

        this.setWalkTarget(p, tx, ty, rand(42, 58));
    }

    /**
     * 设定一次行走目标并起步。自由溜达和互动剧本共用同一条位移管线
     * （梯形速度 + 步频锁位移）—— 剧本要是另写一套移动，脚就会打滑。
     * spd 是期望的匀速段速度（px/s），实际时长由距离反推。
     */
    private setWalkTarget(p: PetRt, tx: number, ty: number, spd: number) {
        if (!p.node || !p.node.isValid) return;
        const curX = p.node.position.x;
        tx = clamp(tx, p.left, p.right);
        ty = clamp(ty, p.far, p.near);

        p.fx = curX; p.fy = p.yOff;
        p.tx = tx; p.ty = ty;
        p.wt = 0;
        const d = Math.hypot(tx - curX, ty - p.yOff);
        /* 42~58 px/s：84px 高的角色按人步速等比约 50px/s。
           低于 40 读成"飘"，高于 65 读成"溜"。 */
        p.wd = clamp(d / Math.max(24, spd), 0.35, 2.0);
        p.dir = tx >= curX ? 1 : -1;
        p.moving = true;
        /* 起身：取消正在演的原地姿势，不然会一边伸懒腰一边走 */
        p.pose = 0;
    }

    /* ------------------------------------------------------------------
     * 嬉戏剧本
     * 用户的原话是"嬉戏玩耍空间"。原地姿势是"活着"，剧本互动才是"玩耍"。
     * 所有位移的落点都**预先算好**（贴边即停、钳进领地），
     * 嬉戏绝不破坏"互相不遮挡"那条底线。
     * ------------------------------------------------------------------ */

    private petOk(q: PetRt): boolean {
        return !!(q.node && q.node.isValid && q.node.active);
    }

    /** 延时剧本。用 this.t 排程而不是 setTimeout —— 测试环境没有真实的定时器 */
    private script(delay: number, fn: () => void) {
        this.scriptQ.push({ at: this.t + delay, fn });
    }

    private tickScript() {
        if (!this.scriptQ.length) return;
        const keep: Array<{ at: number; fn: () => void }> = [];
        for (const s of this.scriptQ) {
            if (this.t >= s.at) s.fn(); else keep.push(s);
        }
        this.scriptQ = keep;
    }

    private tickPlay(dt: number) {
        this.tickScript();
        this.playCd -= dt;
        if (this.playCd <= 0) {
            this.playCd = rand(4.5, 8.5);
            this.stagePlay();
        }
        this.tickButterfly(dt);
    }

    /** 挑剧本：有伴就追逐。PET_POUNCE=false 时落单的保持自由溜达 */
    private stagePlay() {
        const idle = this.pets.filter(q => this.petOk(q) && !q.moving && q.pounce === 0 && q.pop <= 0);
        if (!idle.length) return;

        if (idle.length >= 2 && Math.random() < 0.62) {
            /* 同排相邻对：创建顺序 = 排位顺序（前排偶数位、后排奇数位），
               同排相邻的索引差是 2。只挑相邻 —— 隔着两只去追，
               中间那位就成了被无视线穿过的路人 */
            const pairs: Array<[PetRt, PetRt]> = [];
            for (let i = 0; i < this.pets.length - 2; i++) {
                const a = this.pets[i], b = this.pets[i + 2];
                if (this.petOk(a) && this.petOk(b) && !a.moving && !b.moving &&
                    a.pounce === 0 && b.pounce === 0) pairs.push([a, b]);
            }
            if (pairs.length) {
                const pick = pairs[Math.floor(Math.random() * pairs.length)];
                this.stageChase(pick[0], pick[1]);
                return;
            }
        }
        if (PET_POUNCE) this.stagePounce(idle[Math.floor(Math.random() * idle.length)]);
    }

    /** 追逐：a 逼近 → b 逃（或被追到墙角原地急跳）→ a 弓背邀玩。
     *  a 的停点 = 贴到 b 的近侧边缘外 10px，**预先算好**，绝不进对方格子。 */
    private stageChase(a: PetRt, b: PetRt) {
        if (!this.petOk(a) || !this.petOk(b)) return;
        const ax = a.node.position.x, bx = b.node.position.x;
        const sign = bx >= ax ? 1 : -1;
        const stopX = bx - sign * (petW(a.name) / 2 + petW(b.name) / 2 + 10);
        if (Math.abs(stopX - ax) < 16) return;
        /* 追逐比散步快一档：62 px/s。追逐读成散步是最常见的"假" */
        this.setWalkTarget(a, stopX, a.yOff, 62);

        /* 第二拍：b 反应。逃得掉就窜开（92 px/s，被追的必须更快）；
           逃不掉（已经在自己领地边缘）就原地双跳 —— 那是"被堵住了"的读法 */
        this.script(0.85, () => {
            if (!this.petOk(b) || b.moving || b.pounce > 0) return;
            const nbx = b.node.position.x;
            const flee = nbx + sign * rand(26, 36);
            const aNow = this.petOk(a) ? a.node.position.x : nbx;
            const room = flee >= b.left && flee <= b.right &&
                Math.abs(flee - aNow) > petW(a.name) / 2 + 6;
            if (room) {
                this.setWalkTarget(b, flee, b.yOff, 92);
            } else if (PET_POUNCE) {
                /* 逃不掉（已经在自己领地边缘）就原地双跳 —— 那是"被堵住了"的读法。
                   PET_POUNCE=false 时什么都不做：被堵住就站着看它追过来 */
                b.pop = 0.42;
                this.script(0.46, () => {
                    if (this.petOk(b) && !b.moving && b.pounce === 0) b.pop = 0.42;
                });
            }
        });
        /* 第三拍：追到了，弓背邀玩（伸懒腰的短促版 —— 完整的 2.6s 太拖） */
        this.script(1.6, () => {
            if (!this.petOk(a) || a.moving || a.pounce > 0) return;
            a.pose = 1; a.poseT = 0; a.poseDur = 0.9;
        });
    }

    /** 扑跳。给 towardX 就朝那个方向扑（蝴蝶引导），否则随机 */
    private stagePounce(p: PetRt, towardX?: number) {
        if (!this.petOk(p) || p.moving || p.pounce > 0) return;
        const curX = p.node.position.x;
        const dir = towardX !== undefined ? (towardX >= curX ? 1 : -1)
            : (Math.random() < 0.5 ? -1 : 1);
        /* 落点：26~44px，钳进自己的领地。领地里够不着（贴边）就换反方向 ——
           别把"扑不出"演成原地抖 */
        let fx = clamp(curX + dir * rand(26, 44), p.left, p.right);
        if (Math.abs(fx - curX) < 14) {
            fx = clamp(curX - dir * rand(26, 44), p.left, p.right);
        }
        if (Math.abs(fx - curX) < 12) return;

        p.moving = false;
        p.pose = 0;
        p.pDir = dir;
        p.pDx = fx - curX;
        p.pFx = curX;
        p.pounce = 0.94;
        p.pounceT = 0;
        /* 步相位一次性推过这段距离：腾空时 gait≈0 看不见跳变，
           落地后的碎步从正确相位继续 —— "走多远迈多少"这条铁律不破 */
        p.walked += Math.abs(p.pDx);
    }

    /* ---------------- 蝴蝶：嬉戏的"借口" ----------------
       宠物互玩需要由头。一只周期掠过垫子上空的蝴蝶给"扑"一个对象，
       也给整个画面一个不属于宠物阵营的第三方动点 —— 画面因此有了纵深。 */

    private tickButterfly(dt: number) {
        const bf = this.bf;
        if (!bf) {
            if ((this.bfCd -= dt) <= 0) this.launchButterfly();
            return;
        }
        if (!bf.node.isValid) { this.bf = null; return; }
        if (!bf.on) return;

        bf.t += dt;
        bf.x += bf.dir * 74 * dt;
        /* 蛾式的飘：主飞行是匀速直线，上下是正弦 —— 蝴蝶不走直线 */
        bf.y = bf.baseY + Math.sin(bf.t * 3.4) * 13;
        bf.node.setPosition(bf.x, bf.y, 0);
        this.drawButterfly(bf);

        for (const p of this.pets) {
            if (!this.petOk(p) || bf.chased.has(p)) continue;
            if (Math.abs(p.node.position.x - bf.x) < 44 &&
                !p.moving && p.pounce === 0) {
                bf.chased.add(p);
                /* PET_POUNCE=false：蝴蝶只是动点，没人扑它 */
                if (PET_POUNCE) this.stagePounce(p, bf.x);
            }
        }

        if ((bf.dir > 0 && bf.x > W / 2 + 70) || (bf.dir < 0 && bf.x < -W / 2 - 70)) {
            bf.on = false;
            bf.node.active = false;
            this.bf = null;
            this.bfCd = rand(7, 12);
        }
    }

    private launchButterfly() {
        const n = new Node('__butterfly');
        n.parent = this.canvas;
        n.addComponent(UITransform).setContentSize(48, 40);
        const g = n.addComponent(Graphics);
        /* 顶层：它是镜头前的活物，压在宠物上面 */
        n.setSiblingIndex(this.canvas.children.length - 1);
        const dir = Math.random() < 0.5 ? 1 : -1;
        /* 飞行高度：设计 y≈700，在前排头顶（602+66=668）上方掠过 */
        const baseY = H / 2 - 700;
        this.bf = {
            node: n, g, on: true,
            x: dir > 0 ? -W / 2 - 50 : W / 2 + 50,
            y: baseY, baseY, dir, t: 0,
            chased: new Set<PetRt>(),
        };
    }

    /** 每帧重画。两个翅膀同相位扑扇（蛾类），身体是深色小椭圆 + 两根触角 */
    private drawButterfly(bf: BfRt) {
        const g = bf.g;
        g.clear();
        const flap = Math.sin(bf.t * 21);
        g.fillColor = new Color(255, 205, 96, 235);
        g.ellipse(-5, 5, 5.5, 2.6 + 2.8 * flap);
        g.fill();
        g.ellipse(5, 5, 5.5, 2.6 + 2.8 * flap);
        g.fill();
        g.fillColor = new Color(64, 50, 38, 255);
        g.ellipse(0, 2, 2.0, 3.2);
        g.fill();
        g.lineWidth = 1.2;
        g.strokeColor = new Color(64, 50, 38, 255);
        g.moveTo(-1, 4); g.lineTo(-3, 8);
        g.moveTo(1, 4); g.lineTo(3, 8);
        g.stroke();
    }

    /** 把节点插到背景之上（紧贴 BG 上面一层）。
     *  **不能写死 setSiblingIndex(1)**：BG 本来就占着 Canvas 的第 1 位，
     *  插到 1 会把 BG 顶到 2，自己反而落到 BG **下面** —— 整张背景盖住，
     *  节点在、笔画在、日志全绿，像素上一个都没有。这个坑排查了很久，
     *  记在这里：判断"画了没有"永远以像素为准，不以节点为准。 */
    private aboveBg(n: Node) {
        const kids = this.canvas.children;
        for (let i = 0; i < kids.length; i++) {
            if (kids[i].name === 'BG') { n.setSiblingIndex(i + 1); return; }
        }
        n.setSiblingIndex(1);
    }

    /* ---------------- 炊烟 ----------------
       三条铁律决定"烟"读不读得成烟：半径必须单调变大（散开）、
       alpha 必须单调变小（消散）、上升必须匀速（热浮力不是弹跳）。
       任何一条破了就读成泡泡。峰值 alpha 只有 ~132：上面还压着雾层。 */
    private tickSmoke(dt: number) {
        if (!this.canvas || !this.canvas.isValid) return;
        if (!this.smokeG || !this.smokeG.node.isValid) {
            const n = new Node('__smoke');
            n.parent = this.canvas;
            n.addComponent(UITransform).setContentSize(90, 220);
            this.smokeG = n.addComponent(Graphics);
            this.aboveBg(n);
        }
        this.smokeCd -= dt;
        if (this.smokeCd <= 0) {
            this.smokeCd = rand(0.45, 0.8);
            this.smoke.push({
                x: -294 + rand(-3, 3), y: 262 + rand(-2, 2),
                r: rand(3.4, 5),
                life: 0, max: rand(4.2, 5.4),
                /* 上升压慢：太快的话烟的后半生都在屏幕外，白升 */
                vx: rand(7, 15), vy: rand(14, 20),
            });
            if (this.smoke.length > 10) this.smoke.shift();
        }
        let w = 0;
        for (const q of this.smoke) {
            q.life += dt;
            if (q.life < q.max) this.smoke[w++] = q;
        }
        this.smoke.length = w;

        const g = this.smokeG;
        g.clear();
        for (const q of this.smoke) {
            const k = q.life / q.max;
            /* 峰值 128：上面还罩着雾层（fog-top），76 的烟透过来就没了 */
            const a = Math.round(132 * (1 - k) * (1 - k * 0.3));
            const r = q.r + k * 11;
            g.fillColor = new Color(252, 248, 240, a);
            g.ellipse(q.x + q.vx * q.life, q.y + q.vy * q.life, r, r * 0.82);
            g.fill();
        }
    }

    /* ---------------- 远处的飞鸟 ----------------
       零素材的纵深：天上是唯一还没放任何"活物"的层，一只慢速横穿的
       小 V 形，比任何云的位移都更能说明"这个世界在镜头外面继续着"。
       参数刻意压小：翅幅 ≤8px、速度 ≤60px/s、颜色比天空深一档 ——
       它们是"远处的鸟"，不是"屏幕上的动画"。 */
    private tickBirds(dt: number) {
        if (!this.canvas || !this.canvas.isValid) return;
        if (!this.birdG || !this.birdG.node.isValid) {
            const n = new Node('__birds');
            n.parent = this.canvas;
            n.addComponent(UITransform).setContentSize(W, 240);
            this.birdG = n.addComponent(Graphics);
            this.aboveBg(n);
        }
        this.birdCd -= dt;
        if (this.birdCd <= 0) {
            this.birdCd = rand(8, 15);
            const dir = Math.random() < 0.5 ? 1 : -1;
            const y = rand(100, 230);   // 本地坐标：设计 y 130~260 的天空带
            const n2 = 1 + Math.floor(Math.random() * 3);
            let off = 0;
            for (let i = 0; i < n2; i++) {
                off += rand(22, 38);
                this.birds.push({
                    x: -dir * (W / 2 + 60) - dir * off,
                    y: y + rand(-14, 14),
                    dir, t: rand(0, 6), sp: rand(46, 60),
                    ph: rand(0, 6.28), s: rand(0.75, 1.15),
                });
            }
        }
        let w = 0;
        for (const b of this.birds) {
            b.t += dt;
            b.x += b.dir * b.sp * dt;
            if ((b.dir > 0 && b.x < W / 2 + 80) || (b.dir < 0 && b.x > -W / 2 - 80)) {
                this.birds[w++] = b;
            }
        }
        this.birds.length = w;

        const g = this.birdG;
        g.clear();
        g.lineWidth = 1.9;
        g.strokeColor = new Color(118, 98, 102, 165);
        for (const b of this.birds) {
            const wy = Math.sin(b.t * 7.5 + b.ph) * 4.2 * b.s;
            const x = b.x, y = b.y + Math.sin(b.t * 1.1 + b.ph) * 3;
            g.moveTo(x - 6.5 * b.s, y + wy);
            g.lineTo(x, y - 1.5 * b.s);
            g.lineTo(x + 6.5 * b.s, y + wy);
            g.stroke();
        }
    }

    private tickPet(p: PetRt, dt: number) {
        /* 节点被销毁后，`position` 会返回 null（读它立刻抛 "reading 'x'"）。
           这里再兜一层 —— 就算哪天 dispose 漏调，也只会少动一只宠物，不会崩整帧。 */
        if (!p.node || !p.node.isValid || !p.node.active) return;

        const pos = p.node.position;
        if (!pos) return;

        const x0 = pos.x;
        const y0 = p.yOff;
        let x = x0;
        let yOff = y0;

        /* ---------- 扑跳（嬉戏主动作）----------
           三段固定节拍：蹲 0.26 / 腾空 0.38 / 落地 0.30。
           扑跳期间**不走路、不摆姿势** —— 位移和姿势两条通道同时动，
           就会变成"一边伸懒腰一边飞"，那不是嬉戏是抽搐。 */
        let hop = 0;
        if (p.pounce > 0) {
            p.pounceT += dt;
            const T = p.pounceT;
            if (T >= 0.26 && T < 0.64) {
                const k = (T - 0.26) / 0.38;
                const e = 1 - (1 - k) * (1 - k);   // easeOut：起跳猛、落地缓
                x = p.pFx + p.pDx * e;
                /* 抛物线只给腾空段。15px 是身高的 23% ——
                   再高就读成"跳高"，扑是贴地前扑的爆发。 */
                hop = Math.sin(k * Math.PI) * 15;
            }
            if (T >= 0.94) {
                p.pounce = 0;
                p.wait = rand(0.8, 1.8);
            }
        } else if (p.moving) {
            p.wt += dt;
            const raw = clamp(p.wt / p.wd, 0, 1);

            /* 短距离用 smoothstep（画不出匀速段），长距离用梯形。
               梯形 = 加速 12% + 匀速 72% + 减速 16%，中段速度几乎恒定 —— 那才是"走"。
               smoothstep 两端速度都是 0，读起来是"被磁铁吸过去"。

               分档按**距离**不是按时长：一步只走 24px 时，再精确的曲线
               也画不出匀速段，不如让 smoothstep 软着落地。 */
            const span = Math.abs(p.tx - p.fx);
            let e: number;
            if (span < 70) {
                e = raw * raw * (3 - 2 * raw);
            } else {
                const A = 0.12, D = 0.16;
                const AREA = 1 - A / 2 - D / 2;
                if (raw <= A) e = (raw * raw) / (2 * A * AREA);
                else if (raw >= 1 - D) e = (AREA - (1 - raw) * (1 - raw) / (2 * D)) / AREA;
                else e = (A / 2 + (raw - A)) / AREA;
            }

            x = p.fx + (p.tx - p.fx) * e;
            yOff = p.fy + (p.ty - p.fy) * e;
            p.yOff = yOff;

            if (raw >= 1) {
                p.moving = false;
                /* 走完歇 0.9~2.6s：一直走像机器，停太久又像卡住 */
                p.wait = rand(0.9, 2.6);
            }
        } else {
            /* 坐着：演完一个原地姿势，再换下一个。
               姿势和走动互斥 —— 同时开就会一边伸懒腰一边挪。 */
            p.poseT += dt;
            if (p.poseT >= p.poseDur) {
                p.pose = pickPose();
                p.poseT = 0;
                /* 坐 / 趴 是"休息"，得坐得住：2.6~5.2 秒；
                   伸懒腰 / 打滚是"活动一下"，短：0.9~1.8 秒。
                   节奏差是"活着"的一半 —— 全都 1.5 秒一轮就读成动画机。 */
                p.poseDur = (p.pose === 4 || p.pose === 5)
                    ? rand(2.6, 5.2)
                    : p.pose === 0 ? rand(1.4, 2.6) : rand(0.9, 1.8);
            }
            /* **PET_WALK 关着就是不走。** 六只坐同一块垫子，
               任何位移都会走进邻只的格子 —— 而这次的第一要求是"不遮挡"。 */
            if (PET_WALK) {
                p.wait -= dt;
                if (p.wait <= 0) this.startWalk(p);
            }
        }

        /* 步频 = 走过的距离 ÷ 步幅。
           老写法 `p.step += dt * clamp(spd * 2.4, 0.35, 2.2)` 里那个**下限 0.35
           就是"脚打滑"的元凶**：速度降下来了步频降不下去，腿还在原地迈。
           现在直接由位移推相位 —— 走多远迈多少，物理上不可能打滑。 */
        const moved = Math.abs(x - x0) + Math.abs(yOff - y0);
        p.walked += moved;
        p.step = p.walked / p.stride;

        /* 行走强度平滑过渡：起步/停步那两拍不要开关式跳变 */
        p.gait += ((p.moving ? 1 : 0) - p.gait) * smoothK(dt, 14);
        const gait = p.gait;

        /* ---- 碎步：每步一次起伏 + 每步一次左右摇摆 ----
           起伏只有 1.2px、摇摆 1.5°，刻意做得很小 —— 大一点就会像"跳"。 */
        const ph = p.step * Math.PI * 2;
        const bob = Math.sin(ph) * 1.2 * gait;
        const sway = Math.sin(p.step * Math.PI) * 1.5 * gait * p.dir;

        /* ---------- 原地姿势（D）：不加一张图，用变形演 ----------
           "有生气"的观感主要来自**动作种类多**，不是来自"会移动"。
           六只坐在垫子上时位移是禁忌（会撞邻只），生气全押在这里。

           锚点在脚底 (0.5, 0)，所以**压扁就是坐下 / 趴下**：脚不动、头顶下沉，
           这正是真宠物坐下去的样子。影子不跟着缩 —— 身体矮了，地面没矮。

           幅度：坐 0.84、趴 0.74。上一版只压到 0.94，
           120px 宽的截图里根本看不出它在坐 —— "坐着休息"必须看得见。 */
        let psx = 1, psy = 1, prot = 0;
        if (p.pose > 0 && gait < 0.5) {
            const w = clamp(p.poseT / p.poseDur, 0, 1);
            const bell = Math.sin(w * Math.PI);      // 进、出都是 0，中间最大
            if (p.pose === 1) {                       // 伸懒腰：压扁 + 拉长
                psy = 1 - 0.10 * bell; psx = 1 + 0.07 * bell;
            } else if (p.pose === 2) {                // 打滚：先倒向一边再倒回来
                prot = Math.sin(w * Math.PI * 2) * 9;
                psy = 0.97;
            } else if (p.pose === 3) {                // 舔毛：小幅度左右蹭
                prot = Math.sin(p.poseT * 9) * 2.0 * bell;
                psy = 0.98;
            } else if (p.pose === 4) {                // 坐下：蹲下来，略宽
                psy = 1 - 0.16 * bell; psx = 1 + 0.04 * bell;
            } else if (p.pose === 5) {                // 趴下：缩成一团
                psy = 1 - 0.26 * bell; psx = 1 + 0.08 * bell;
            }
        }

        /* 扑跳的三段形变（优先于原地姿势 —— 扑跳开始时姿势已被清零）：
           蹲（压 0.84 预备）→ 腾空（拉长 1.07，"弹出去"）→ 落地（压 0.88 回弹）。 */
        if (p.pounce > 0) {
            const T = p.pounceT;
            if (T < 0.26) {
                const w = T / 0.26;
                psy = 1 - 0.16 * w; psx = 1 + 0.08 * w;
            } else if (T < 0.64) {
                psy = 1.07; psx = 0.94;
            } else {
                const bell = Math.sin(clamp((T - 0.64) / 0.30, 0, 1) * Math.PI);
                psy = 1 - 0.12 * bell; psx = 1 + 0.06 * bell;
            }
        }

        /* 点击弹跳：抛物线包络，跟碎步的 y 通道叠加 */
        let pop = 0;
        if (p.pop > 0) {
            p.pop = Math.max(0, p.pop - dt);
            pop = Math.sin((1 - p.pop / 0.42) * Math.PI) * 10;
        }

        /* 群内深度：后排 1.00、前排 1.03。
           高度已经由 contentSize 统一成 PET_H 了，这里只留 3% 的近大远小 ——
           再大就会把后排的脚顶到前排头顶上去（那正是"遮挡"回来的方式）。 */
        const base = 1.0 + p.depth * 0.03;
        const depthK = clamp(1 + yOff * 0.0012, 0.99, 1.01);

        /* 每步一次轻微竖向压缩，落脚那一下有重量 */
        let syT = base * depthK * (1 - Math.max(0, Math.sin(ph)) * 0.012 * gait) * psy;
        let sxT = base * depthK * (1 + Math.max(0, Math.sin(ph)) * 0.006 * gait) * psx;

        /* 按住 = 蹲下。和步态共用 scale 通道，所以在这里合并，不另开一条 tween。 */
        if (p.down) { syT *= 0.93; sxT *= 1.06; }

        const kk = smoothK(dt, 30);
        p.sy += (syT - p.sy) * kk;
        p.sx += (sxT - p.sx) * kk;
        p.rot += ((sway + prot) - p.rot) * kk;

        const wy = p.baseY + yOff + bob + pop + hop;
        p.node.setPosition(x, wy, pos.z);
        p.node.setScale(p.sx, p.sy, 1);
        p.node.angle = p.rot;

        /* ---------- 影子：只跟 x 和地面，不跟 bob ----------
           **这是"飘不飘"的唯一开关。** 影子跟着 bob 一起上下，眼睛就找不到地面，
           1.2px 的起伏都会被读成脚离地 —— 当年就是这么判定失败的。
           离地越高影子越小，这也是"跳起来了"唯一的视觉提示。
           扑跳的腾空弧线（hop）同样计入离地量，扑出去时影子收小。 */
        if (p.shadow && p.shadow.isValid) {
            p.shadow.setPosition(x, p.baseY + yOff - 3, 0);
            const lift = Math.max(0, bob + pop + hop);
            const k2 = 1 - Math.min(0.32, lift * 0.028);
            /* 横向跟身体一起变宽（坐/趴下去时身子变宽，接触面也确实更宽），
               但只跟一半 —— 跟满会让影子比身体还宽，那就成了水渍。 */
            const kw = 1 + (p.sx / base - 1) * 0.5;
            p.shadow.setScale(k2 * kw, 1, 1);
        }
    }

    /** 冒一颗心上浮消失 —— 点击宠物要有回应，不能只是动一下就完 */
    private popHeart(target: Node) {
        const wp = target.worldPosition;
        const lp = this.canvasUT.convertToNodeSpaceAR(wp);

        const n = new Node('__heart');
        n.parent = this.canvas;
        n.addComponent(UITransform).setContentSize(40, 40);
        n.setPosition(lp.x, lp.y + 74, 0);
        n.setSiblingIndex(-1);

        const op = n.addComponent(UIOpacity);
        op.opacity = 255;
        mkLabel(n, 'h', '♥', 26, new Color(232, 120, 138, 255), 40, 40);

        tween(n)
            .by(0.9, { position: new Vec3(rand(-8, 8), 48, 0) }, { easing: 'quadOut' })
            .call(() => n.destroy())
            .start();
        tween(op).to(0.9, { opacity: 0 }, { easing: 'quadIn' }).start();
    }

    /* ----------------------------------------------------------------------
     * 2. 徽标入口：热区扩到 88×88 + 按下反馈 + 结果说明
     * -------------------------------------------------------------------- */

    private bindBadges() {
        const root = this.canvas.getChildByName('Badges');
        if (!root) return;

        /* 只认圆形徽标本体，Cap-* 是它的常驻说明标签，不单独做热区。
           ⚠ 快照 + 跳过 `-hot`：热区名字也带 `Badge-` 前缀，漏了这条判定就会
           自己给自己套热区（`Badge-x-hot` → `Badge-x-hot-hot` → …），
           徽标层会从 10 个节点涨到上百个。 */
        for (const n of root.children.slice()) {
            if (!n.name.startsWith('Badge-')) continue;
            if (n.name.indexOf('-hot') >= 0) continue;
            const key = n.name.slice(6);
            if (!n.active) continue;

            const open = key === '图鉴' ? () => this.openCodex()
                : key === '工作台' ? () => this.openHome()
                : key === '派遣' ? () => this.openDispatch()
                : null;
            if (open) {
                this.makeHot(n, `${n.name}-hot`, HOT_MIN, HOT_MIN, open, 0.90);
                continue;
            }

            const msg = BADGE_INFO[key] ?? `${key} · 待实装`;
            this.makeHot(n, `${n.name}-hot`, HOT_MIN, HOT_MIN, () => this.toast(msg), 0.90);
        }
    }

    /* ----------------------------------------------------------------------
     * 3. Dock：出门按钮 / 宠物卡 / 锁定槽 / 资源条
     * -------------------------------------------------------------------- */

    private bindDock() {
        const root = this.canvas.getChildByName('Dock');
        if (!root) return;

        /* —— 主行动：出门。收到右下角，但不留空洞 ——
         *
         * 上一版 248 宽：按钮右缘贴到 1260，左边就从"星屑"槽的 734
         * 一路空到 1012 —— 278px、占屏宽 22% 的空洞。
         * 整条底栏读成"左边一堆东西 + 右边一个孤零零的按钮"。
         *
         * 460 宽：右缘仍在 1260（离屏 20），左缘落在 800，
         * 和槽位之间留 66px 的分隔。460 也不是新数字 ——
         * 场景里这个按钮本来就画成 509 宽，是运行时把它砍到 248 的。
         */
        const GW = 460;
        const go = root.getChildByName('Btn-Go');
        if (go) {
            const gut = go.getComponent(UITransform);
            if (gut) {
                gut.setContentSize(GW, 76);
                /* 锚点是左上。右缘离屏幕 20，下缘离屏幕 18。告示板在它上方。 */
                go.setPosition(640 - 20 - GW, -360 + 18 + 76, 0);
            }
            /* 子节点坐标是相对**按钮左上角**的。按钮 76 高、中心在 -38：
               出门字高 34 → -22 时占 22..56；能量行高 16 → -30 时占 30..46；
               两者中线都在 38 附近，和按钮中线对齐。 */
            const txt = go.getChildByName('txt');
            if (txt) txt.setPosition(120, -22, 0);
            const line = go.getChildByName('line');
            if (line) {
                line.setPosition(200, -30, 0);
                const lut = line.getComponent(UITransform);
                if (lut) lut.setContentSize(200, 16);
                /* 居中而不是左对齐：按钮变宽以后左对齐会让"能量 100"这五个字
                   贴在左边、右边留一大块空，看起来像漏了内容。 */
                const llb = line.getComponent(Label);
                if (llb) llb.horizontalAlign = Label.HorizontalAlign.CENTER;
            }
            const sub = go.getChildByName('sub');
            if (sub) sub.active = false;
            this.press(go, 0.965);
            go.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                this.openDepart();
            });

            /* 箭头左右摆：主行动需要一个持续的视觉邀请 */
            const ar = go.getChildByName('ar');
            if (ar) {
                ar.setPosition(430, -30, 0);
                this.arrow = ar;
                this.arrowBaseX = ar.position.x;
            }
        }

        /* —— 宠物卡：点开详情。心跳给它生命感 —— */
        const card = root.getChildByName('GoCard');
        if (card) {
            this.press(card, 0.97, 0.012, 1.6);
            card.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                this.toast(this.goCardText());
            });
        }

        /* —— 底部六格：**这就是「这趟带谁出门」的开关** ——
         *
         * 改造前这六格点下去只弹一句「已经在家了 · 待解锁出战位」——
         * 一个指向"以后会有"的功能，而它当时没有任何写入路径。
         * `save.active` 从头到尾只有开局那只，于是：
         *   主界面解锁了五只 → 进战斗还是尖耳猫 → 「解锁有什么用」。
         *
         * 现在点一下 = 换出战（`setActive` 写存档），卡片、金圈、出门按钮
         * 同一帧跟着变，`launchBattle` 带的就是它。
         * **出场人数仍然是 1 只**（宪法红线：一宠出征，六宠看家）——
         * 换的是"哪一只"，不是"几只"。
         */
        for (const n of root.children.slice()) {
            if (!n.name.startsWith('Slot-')) continue;
            const pet = n.name.slice(5);
            /* 还差几关从**花名册 + 存档**算，不再查一张写死的表 ——
               那张表在家园和战斗各有一份，改了解锁节奏必然漏一处。 */
            const def = petByNode(pet);
            if (!def) continue;

            this.press(n, 0.94);
            n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                const r = setActive(this.save, def.id);
                this.toast(r.say);
                if (!r.ok) return;
                /* commit 会跑 bindSave → refreshGoCard / refreshSlots，
                   卡片和六格同一帧换脸，不需要在这里手工刷。 */
                this.commit(r.next);
                /* 草地上那只跳一下：让"换人"在世界里也有回执，
                   否则玩家只看见底栏变了，怀疑是不是真换了。 */
                const lawn = this.pets.find((p) => petByNode(p.node.name)?.id === def.id);
                if (lawn) lawn.pop = 0.5;
            });
        }
    }

    /* ----------------------------------------------------------------------
     * 4. HUD：提示条浮动 + 图标按钮
     * -------------------------------------------------------------------- */

    private bindHud() {
        const root = this.canvas.getChildByName('HUD');
        if (!root) return;

        const tip = root.getChildByName('HudTip');
        if (tip) {
            this.tip = tip;
            this.tipBaseY = tip.position.y;
        }

        const gear = root.getChildByName('IconBtn');
        if (gear) {
            /* 视觉 43×46 太小，热区补到 88×88 */
            this.makeHot(gear, 'IconBtn-hot', HOT_MIN, HOT_MIN, () => this.openSettings(), 0.90);
        }

        const hud = root.getChildByName('HudProgress');
        if (hud) {
            this.press(hud, 0.985);
            hud.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                const c = this.save.cleared;
                /* 全通判定必须读 STAGE_COUNT。写死 8 的时候，玩家打到第 10 屏
                 * 就会收到「苔原 8/8 · 全部通关」—— 一句假话，而且是他手感上
                 * 明显不对的假话（第 11 屏还在前面等着）。 */
                this.toast(c >= STAGE_COUNT
                    ? `${STAGE_COUNT} 屏全部走完 · 挑一屏重打可以刷 S`
                    : `${stageLabel(c)} · 打一场推进 1 屏，新伙伴会回家`);
            });
        }
    }

    /* ----------------------------------------------------------------------
     * 5. 环境层：雾的缓移与透明度呼吸
     * -------------------------------------------------------------------- */

    private bindAmbient() {
        const cfg: Record<string, { ph: number; amp: number; period: number }> = {
            FogTop: { ph: 0, amp: 6, period: 14 },
            FogBot: { ph: Math.PI, amp: 9, period: 18 },
        };

        for (const name of Object.keys(cfg)) {
            const n = this.canvas.getChildByName(name);
            if (!n) continue;
            const c = cfg[name];
            this.fogs.push({
                node: n,
                baseY: n.position.y,
                op: n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity),
                ph: c.ph,
                amp: c.amp,
                period: c.period,
            });
        }
    }

    /* ----------------------------------------------------------------------
     * 按压反馈绑定
     * -------------------------------------------------------------------- */

    /**
     * 把已有节点做成可点：本体热区。
     * @param pulse 待机脉动幅度（1 的百分比）
     */
    private press(node: Node, min: number, pulse = 0, pulseDur = 2.2, scaleTarget?: Node) {
        const rt: PressRt = {
            node, target: scaleTarget ?? node, min, cur: 1, down: false,
            pulse, pulseDur, ph: rand(0, Math.PI * 2),
        };
        this.presses.push(rt);

        node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            rt.down = true;
        });
        node.on(Node.EventType.TOUCH_END, () => { rt.down = false; });
        /* 必须监听 CANCEL：手指滑出节点范围时只会收到 CANCEL，
           少这一条就会出现「按下去弹不回来」的卡死态 */
        node.on(Node.EventType.TOUCH_CANCEL, () => { rt.down = false; });
        return rt;
    }

    /**
     * 视觉尺寸不足 88×88 的元素：叠一层隐形热区，视觉一个像素都不动。
     * 这是「视觉尺寸与点击区分离」的标准做法。
     */
    private makeHot(
        target: Node, name: string, w: number, h: number,
        onTap: () => void, min = 0.90,
    ) {
        const hot = new Node(name);
        hot.parent = target.parent!;
        hot.addComponent(UITransform).setContentSize(w, h);
        /* 对齐到目标视觉中心：目标锚点 (0,1)，尺寸从场景读 */
        const tut = target.getComponent(UITransform);
        const tw = tut ? tut.contentSize.width : w;
        const th = tut ? tut.contentSize.height : h;
        hot.setPosition(
            target.position.x + tw / 2,
            target.position.y - th / 2,
            0,
        );
        /* 置顶，避免被同层后画的元素盖住 */
        hot.setSiblingIndex(-1);

        /* ⚠ 缩放必须作用在视觉本体上，不能作用在隐形热区上 ——
           热区不可见，缩放它等于没有按下反馈。 */
        this.press(hot, min, 0, 2.2, target);
        hot.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            onTap();
        });
        return hot;
    }

    /* ----------------------------------------------------------------------
     * 主循环
     * -------------------------------------------------------------------- */

    /**
     * 作废自己。
     *
     * 只清引用、不 destroy 节点 —— 场景切走时引擎已经销毁了它们，
     * 这里再 destroy 一遍只会撞上"已销毁"的报错。保存下来的活干的事：
     * 让 tick 立刻空转，并释放数组里的引用，避免把整棵旧场景留在内存里。
     */
    dispose() {
        this.dead = true;
        this.pets.length = 0;
        this.presses.length = 0;
        this.later.length = 0;
        this.fogs.length = 0;
        /* 延时剧本里闭包持有的宠物全部失效了，留着只会演出鬼戏 */
        this.scriptQ.length = 0;
        /* 蝴蝶节点挂在 canvas 下，随场景销毁；这里只断引用。
           bf.node 有效性不检查 —— dispose 本来就可能在场景销毁之后被调 */
        this.bf = null;
        this.smoke.length = 0; this.smokeG = null;
        this.birds.length = 0; this.birdG = null;
        this.arrow = this.tip = this.goCard = null;
        this.toastBox = null;
        this.toastOp = null;
        this.toastLbl = null;
        this.depart = null;
        this.departOp = null;
        this.departScrim = null;
        this.sheet = null;
        /* 抽屉的「点场景关闭」是挂在 canvas 上的**外部监听**，节点销毁不会带走它。
           不清的话切场景后旧监听还活着，下一次点草地会在已销毁的控制器上跑 closeDrawer。 */
        if (this.drawerTap && this.canvas && this.canvas.isValid) {
            this.canvas.off(Node.EventType.TOUCH_END, this.drawerTap);
        }
        this.drawerTap = null;
        this.drawer = null;
        this.drawerOp = null;
        this.drawerBusy = false;
        this.toastState = 'off';
    }

    tick() {
        /* 两道闸：先看自己有没有作废，再看画布还在不在。
           光靠事件解绑不够 —— 场景销毁和事件顺序没有保证，
           所以每一帧都要能自证"我还活着"。 */
        if (this.dead) return;
        if (!this.canvas || !this.canvas.isValid) { this.dispose(); return; }

        const now = performance.now();
        let dt = (now - this.lastMs) / 1000;
        this.lastMs = now;
        /* 挂起回来时 dt 会很大，钳住，否则宠物会瞬移 */
        if (!isFinite(dt) || dt <= 0) return;
        dt = Math.min(dt, 0.05);
        this.t += dt;
        this.pingDispatch();

        if (this.later.length) {
            const jobs = this.later.splice(0);
            for (const fn of jobs) fn();
        }

        /* 嬉戏剧本先于宠物步进：剧本设的行走目标，本帧就该被步进用上 */
        this.tickPlay(dt);
        for (const p of this.pets) this.tickPet(p, dt);

        for (let i = this.presses.length - 1; i >= 0; i--) {
            const p = this.presses[i];
            if (!p.node.isValid || !p.target.isValid) {
                this.presses.splice(i, 1);
                continue;
            }
            const idle = p.pulse > 0
                ? 1 + Math.sin((this.t / p.pulseDur) * Math.PI * 2 + p.ph) * p.pulse
                : 1;
            const target = p.down ? p.min : idle;
            p.cur += (target - p.cur) * smoothK(dt, 26);
            p.target.setScale(p.cur, p.cur, 1);
        }

        for (const f of this.fogs) {
            const s = Math.sin((this.t / f.period) * Math.PI * 2 + f.ph);
            /* 只往一个方向位移：雾图宽度正好铺满，往上移会露边 */
            f.node.setPosition(f.node.position.x, f.baseY - (s * 0.5 + 0.5) * f.amp, 0);
            if (f.op) f.op.opacity = Math.round(228 + s * 27);
        }

        this.tickSmoke(dt);
        this.tickBirds(dt);
        this.tickResAnim(dt);

        /* 任务徽标脉冲：**只在有可领的时候动**。
           常驻脉冲会变成噪音，玩家三分钟后就当它不存在了 ——
           动起来的唯一理由是"现在有事可做"。 */
        if (this.taskBtn && this.taskBtn.isValid) {
            const s = this.taskPulse > 0 ? 1 + Math.sin(this.t * 4.0) * this.taskPulse : 1;
            this.taskBtn.setScale(s, s, 1);
        }

        if (this.arrow) {
            this.arrow.setPosition(this.arrowBaseX + Math.sin(this.t * Math.PI * 2 / 1.9) * 3, this.arrow.position.y, 0);
        }
        if (this.tip) {
            this.tip.setPosition(this.tip.position.x, this.tipBaseY + Math.sin(this.t * Math.PI * 2 / 2.6) * 2, 0);
        }

        this.tickToast(dt);
    }

    /* ----------------------------------------------------------------------
     * Toast
     * -------------------------------------------------------------------- */

    private ensureToast() {
        if (this.toastBox) return;

        const n = new Node('__Toast');
        n.parent = this.canvas;
        n.addComponent(UITransform).setContentSize(560, 56);
        n.setPosition(0, -230, 0);
        n.setSiblingIndex(-1);

        const g = n.addComponent(Graphics);
        g.fillColor = new Color(52, 36, 28, 226);
        g.roundRect(-280, -28, 560, 56, 28);
        g.fill();

        const lb = mkLabel(n, 'msg', '', 19, new Color(255, 244, 232, 255), 520, 40);

        this.toastBox = n;
        this.toastOp = n.addComponent(UIOpacity);
        this.toastOp.opacity = 0;
        this.toastLbl = lb;
        this.toastState = 'off';
    }

    toast(msg: string) {
        this.ensureToast();
        if (!this.toastLbl || !this.toastOp) return;
        this.toastLbl.string = msg;
        this.toastState = 'in';
        this.toastT = 0;
        this.toastOp.opacity = 0;
    }

    private tickToast(dt: number) {
        if (this.toastState === 'off' || !this.toastOp) return;
        this.toastT += dt;

        if (this.toastState === 'in') {
            this.toastOp.opacity = Math.round(clamp(this.toastT / 0.16, 0, 1) * 255);
            if (this.toastT >= 0.16) { this.toastState = 'hold'; this.toastT = 0; }
        } else if (this.toastState === 'hold') {
            if (this.toastT >= 1.5) { this.toastState = 'out'; this.toastT = 0; }
        } else {
            this.toastOp.opacity = Math.round((1 - clamp(this.toastT / 0.28, 0, 1)) * 255);
            if (this.toastT >= 0.28) { this.toastState = 'off'; }
        }
    }

    /* ----------------------------------------------------------------------
     * 出发确认卡
     *
     * 「出门」→ 确认卡 → 「出发」→ `loadScene('Battle')`，是真跳转。
     * 中间这一层不是为了好看：它同时承担"这一局打的是什么"的告知
     * （第几关、几个人、什么饱食度、下一只什么时候回家），
     * 以及防止误触直接进入一局 90 秒的战斗。
     * -------------------------------------------------------------------- */

    private ensureDepart() {
        if (this.depart) return;

        const root = new Node('__Depart');
        root.parent = this.canvas;
        root.addComponent(UITransform).setContentSize(W, H);
        root.setSiblingIndex(-1);
        root.active = false;

        /* 全屏压暗：点击蒙层关闭 */
        const scrim = new Node('scrim');
        scrim.parent = root;
        scrim.addComponent(UITransform).setContentSize(W, H);
        const sg = scrim.addComponent(Graphics);
        sg.fillColor = SCRIM;
        sg.rect(-W / 2, -H / 2, W, H);
        sg.fill();

        /* 卡片 */
        const card = new Node('card');
        card.parent = root;
        card.addComponent(UITransform).setContentSize(560, 344);

        paintCard(card.addComponent(Graphics), 560, 344);

        /* ---- 卡片文案全部从存档现算 ----
           原来这三行是写死的「苔原 1 / 8」「饱食 12/20」「战力 ×1.21」：
           前两个和存档不对应，第三个（×1.21）根本没有任何系统产出过这个数。
           一张写着假数据的确认卡，比没有确认卡更伤信任。 */
        const s = this.save;
        const squad = squadSize(s.cleared);
        const names = unlockedPets(s.cleared).slice(0, MAX_SQUAD).map((p) => p.name);
        const carry = petById(s.active) ?? PETS[0];
        const mul = s.satiety >= SATIETY.fullLine
            ? SATIETY.mulFull
            : s.satiety >= SATIETY.hungryLine
                ? SATIETY.mulHungry
                : SATIETY.mulStarving;
        const nextPet = PETS.find((p) => p.at > s.cleared);

        /* 出发卡的标题 **报章节，不报「第 10 / 27 关」**。
         * 27 是内部数字：玩家在枯木坡第 1 屏，告诉他"第 10 关"只会让他
         * 觉得前面还有 26 个一样的东西 —— 这正是"关卡搞得那么长"的观感来源。
         * 章的边界由文案给出，产地名比总数更能建立"我走到哪了"。 */
        const nextIdx = Math.min(STAGE_COUNT - 1, s.cleared);
        mkLabel(card, 'title', stageLabel(nextIdx), 40, INK, 500, 56)
            .node.setPosition(0, 108, 0);
        /* 副标题从"能量够不够"换成**这一关你打过多好**。
           出门前是最适合告诉玩家"S 线在哪"的位置：他还没进去，
           正好带着一个目标进去。没有战绩就说实话（还没打过）。 */
        const stageIdx = Math.min(STAGE_COUNT - 1, s.cleared);
        const bestHere = s.best[stageIdx] || '';
        mkLabel(card, 'sub',
            bestHere
                ? `第 ${stageIdx + 1} 关 · 最好成绩 ${bestHere} · 再打一次看能不能刷到 S`
                : `第 ${stageIdx + 1} 关 · 还没打过 · 回来按这一趟的收成给奖励`,
            16, INK_SOFT, 520, 36)
            .node.setPosition(0, 66, 0);

        /* 分隔线 */
        const ln = new Node('line');
        ln.parent = card;
        ln.addComponent(UITransform).setContentSize(480, 2);
        ln.setPosition(0, 40, 0);
        const lg = ln.addComponent(Graphics);
        lg.fillColor = new Color(226, 196, 170, 255);
        lg.rect(-240, -1, 480, 2);
        lg.fill();

        /* 第一行报**这趟带谁**，不是"队伍几只"。
           一宠出征，场上只有一个单位 —— 写"3 只"会让人以为三个人上场。 */
        mkLabel(card, 'row1', `这趟带   ${this.carrierText()}`, 20, INK, 500, 32)
            .node.setPosition(0, 8, 0);
        mkLabel(card, 'row2',
            `饱食   ${Math.round(s.satiety)}/${SATIETY.max} · 火力 ×${mul.toFixed(2)}` +
            (mul > 1 ? '（半饿最强）' : mul < 1 ? '（全饿最弱）' : ''),
            20, INK, 500, 32).node.setPosition(0, -26, 0);
        mkLabel(card, 'row3',
            nextPet
                ? `下一只   ${nextPet.name} 还需通过 ${petGap(s.cleared, nextPet.id)} 关`
                : '下一只   全员到齐',
            18, INK_SOFT, 500, 28).node.setPosition(0, -58, 0);

        /* 「出发」按钮 */
        const btn = new Node('go');
        btn.parent = card;
        btn.addComponent(UITransform).setContentSize(200, 60);
        btn.setPosition(0, -110, 0);
        const bg = btn.addComponent(Graphics);
        bg.fillColor = BTN_FILL;
        bg.roundRect(-100, -30, 200, 60, 30);
        bg.fill();
        bg.lineWidth = 3;
        bg.strokeColor = BTN_DEEP;
        bg.roundRect(-100, -30, 200, 60, 30);
        bg.stroke();
        /* 文案固定成「出 发」。
         * 上一版这里是 `enough ? '出  发' : '能量不足'` —— 删能量系统时
         * enough 这个变量一起被删了，但这一行漏改，于是运行时 ReferenceError，
         * 整张出发卡渲染失败（点"出门"什么都不会弹出来）。
         * 教训：删一个机制时，**它的"文案"和它的"数值"要一起找一遍**，
         * 字符串里的分支最容易漏，因为 tsc 只有在真的扫到这个文件时才报。 */
        mkLabel(btn, 'txt', '出  发', 24, new Color(96, 58, 28, 255), 180, 40);

        this.press(btn, 0.95);
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            this.launchBattle();
        });

        /* 关闭（点击蒙层空白处） */
        scrim.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            this.closeDepart();
        });

        mkLabel(root, 'hint', '点击空白处返回家园', 17, new Color(255, 238, 220, 190), 400, 28).node.setPosition(0, -268, 0);

        this.depart = root;
        this.departOp = root.addComponent(UIOpacity);
        this.departOp.opacity = 0;
        this.departScrim = sg;
    }

    /* ----------------------------------------------------------------------
     * 家园业务：写存档、刷数字、打开面板
     * -------------------------------------------------------------------- */

    private commit(next: SaveState) {
        const since = this.save.dispatch ? this.save.dispatch.since : 0;
        this.save = next;
        saveSave(next);
        this.bindSave();
        this.syncLawn();
        if (!next.dispatch || next.dispatch.since !== since) this.dispatchPing = false;
        /* 出发卡是打开时现算的。喂完饭再出门，卡上必须是新的饱食度。 */
        if (this.depart && !this.depart.active) {
            this.depart.destroy();
            this.depart = null;
            this.departOp = null;
        }
    }

    /** 派出的那只暂时离开草地，收回来再出现 */
    private syncLawn() {
        const away = this.save.dispatch ? this.save.dispatch.id : '';
        /* 和 bindPets 同一套判据（`cleared >= at`，逐个判断）。
           不能再用「只留 lead 一只」—— 派遣一次回来，草地又只剩一只，
           玩家会以为自己的解锁被吞了。 */
        for (const p of this.pets) {
            const def = petByNode(p.node.name);
            if (!def) continue;
            p.node.active = this.save.cleared >= def.at && def.id !== away;
        }
    }

    private applyPrefs() {
        game.frameRate = this.save.settings.crisp ? 60 : 30;
    }

    private pingDispatch() {
        const job = this.save.dispatch;
        if (!job || this.dispatchPing || this.sheet) return;
        if (peekDispatch(this.save, Date.now()).hauls < 1) return;
        this.dispatchPing = true;
        const name = PETS.find((p) => p.id === job.id);
        this.toast(`${name ? name.name : '它'} 带东西回来了 · 去派遣板收下`);
    }

    private closeSheet() {
        if (!this.sheet) return;
        const n = this.sheet;
        this.sheet = null;
        n.removeFromParent();
        n.destroy();
    }

    /**
     * 一张米白卡片盖在院子上。点空白关掉。
     * 内容每次现画，所以喂完、做完、收回来，数字都是刚写进存档的。
     */
    private openSheet(title: string, sub: string, fill: (card: Node) => void, cw = 640, ch = 520) {
        this.closeSheet();
        this.closeDrawer();
        if (this.codex) {
            this.codex.removeFromParent();
            this.codex.destroy();
            this.codex = null;
            this.codexOp = null;
        }

        const CW = cw;
        const CH = ch;
        const root = new Node('__Sheet');
        root.parent = this.canvas;
        root.addComponent(UITransform).setContentSize(W, H);
        root.setSiblingIndex(-1);
        this.sheet = root;

        const scrim = new Node('scrim');
        scrim.parent = root;
        scrim.addComponent(UITransform).setContentSize(W, H);
        const sg = scrim.addComponent(Graphics);
        sg.fillColor = new Color(38, 26, 20, 205);
        sg.rect(-W / 2, -H / 2, W, H);
        sg.fill();
        scrim.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            this.queue(() => this.closeSheet());
        });

        const card = new Node('card');
        card.parent = root;
        card.addComponent(UITransform).setContentSize(CW, CH);
        paintCard(card.addComponent(Graphics), CW, CH);
        card.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; });

        mkLabel(card, 'title', title, 34, INK, 560, 44).node.setPosition(0, CH / 2 - 48, 0);
        const subLb = mkLabel(card, 'sub', sub, 16, INK_SOFT, 580, 36);
        subLb.overflow = Label.Overflow.SHRINK;
        subLb.node.setPosition(0, CH / 2 - 88, 0);
        fill(card);
        mkLabel(card, 'tip', '点空白处关闭', 14, INK_SOFT, 400, 22).node.setPosition(0, -CH / 2 + 26, 0);

        /* 进场：0.94 → 1 的 backOut（会略微过冲再回落）+ 淡入。
           直接"啪"出现读作切换页面，弹一下才读作"这张卡被打开了"。
           0.20s 是上限 —— 再长就成了等待，玩家点开之后想立刻看到内容。 */
        card.setScale(0.94, 0.94, 1);
        const cop = card.addComponent(UIOpacity);
        cop.opacity = 0;
        tween(card).to(0.20, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        tween(cop).to(0.14, { opacity: 255 }).start();
    }

    private mkBtn(parent: Node, name: string, text: string, x: number, y: number, onClick: () => void, h = 52) {
        const w = 520;
        const btn = new Node(name);
        btn.parent = parent;
        btn.addComponent(UITransform).setContentSize(w, h);
        btn.setPosition(x, y, 0);
        const rad = Math.min(26, h / 2);
        const g = btn.addComponent(Graphics);
        g.fillColor = BTN_FILL;
        g.roundRect(-w / 2, -h / 2, w, h, rad);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = BTN_DEEP;
        g.roundRect(-w / 2, -h / 2, w, h, rad);
        g.stroke();
        const lb = mkLabel(btn, 'txt', text, 16, new Color(96, 58, 28, 255), w - 24, h - 8);
        lb.overflow = Label.Overflow.SHRINK;
        this.press(btn, 0.97);
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            onClick();
        });
    }

    /**
     * 一行功能：左边首字圆标，中间名字和花费，右边一颗杏黄按钮。
     * 不能点的行（未解锁、已领）整行变灰，不挂点击。
     */
    private mkRow(
        parent: Node, name: string, title: string, meta: string, action: string,
        x: number, y: number, onClick: () => void, enabled = true, h = 62,
        headShort = '',
    ) {
        const w = 560;
        const row = new Node(name);
        row.parent = parent;
        row.addComponent(UITransform).setContentSize(w, h);
        row.setPosition(x, y, 0);
        const g = row.addComponent(Graphics);
        g.fillColor = enabled ? ROW_FILL : ROW_OFF;
        g.roundRect(-w / 2, -h / 2, w, h, 18);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = enabled ? BTN_DEEP : new Color(176, 160, 144, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 18);
        g.stroke();
        g.fillColor = enabled ? new Color(246, 214, 150, 255) : new Color(206, 196, 184, 255);
        g.circle(-w / 2 + 36, 0, 18);
        g.fill();
        const aw = 96;
        const ah = 34;
        const ax = w / 2 - 14 - aw / 2;
        g.fillColor = enabled ? BTN_FILL : new Color(196, 184, 168, 255);
        g.roundRect(ax - aw / 2, -ah / 2, aw, ah, 16);
        g.fill();

        /* 左边那枚圆：有头像就贴头像，没有才用"名字首字"。
           派遣 / 工坊这些面板里全是宠物，一个汉字对着一排汉字认不出谁是谁 ——
           头像比首字快一个量级，而且和底部槽 / 图鉴是同一张图。 */
        const hsf = headShort ? this.heads[headShort] : undefined;
        if (hsf) {
            const hn = new Node('head');
            hn.parent = row;
            hn.addComponent(UITransform).setContentSize(34, 34);
            hn.setPosition(-w / 2 + 36, 0, 0);
            const hs = hn.addComponent(Sprite);
            hs.sizeMode = Sprite.SizeMode.CUSTOM;
            hs.spriteFrame = hsf;
            hs.color = enabled ? WHITE : new Color(150, 138, 126, 255);
        } else {
            mkLabel(row, 'mark', title.slice(0, 1), 18, new Color(92, 60, 24, 255), 36, 26)
                .node.setPosition(-w / 2 + 36, 0, 0);
        }
        const two = h >= 56;
        const tl = mkLabel(row, 'title', title, two ? 20 : 16, enabled ? INK : INK_SOFT, 220, two ? 26 : 22);
        tl.horizontalAlign = Label.HorizontalAlign.LEFT;
        tl.node.setPosition(-w / 2 + 66 + (two ? 100 : 110), two ? 10 : 8, 0);
        const ml = mkLabel(row, 'meta', meta, two ? 14 : 12, INK_SOFT, 300, two ? 20 : 16);
        ml.horizontalAlign = Label.HorizontalAlign.LEFT;
        ml.overflow = Label.Overflow.SHRINK;
        ml.node.setPosition(-w / 2 + 66 + 150, two ? -14 : -10, 0);
        mkLabel(row, 'act', action, 16, new Color(96, 58, 28, 255), aw - 8, 24)
            .node.setPosition(ax, 0, 0);

        if (!enabled) return;
        this.press(row, 0.98);
        row.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            onClick();
        });
    }

    private queue(fn: () => void) {
        this.later.push(fn);
    }

    private act(r: { ok: boolean; say: string; next?: SaveState }, reopen: () => void) {
        if (r.ok && r.next) {
            this.commit(r.next);
            this.applyPrefs();
        }
        /* 失败也重画：派遣的倒计时、背包数字才跟得上刚点的那一下。
           重画会拆掉正在被点的那一行，必须等这下触摸结束。 */
        const say = r.say;
        this.queue(() => {
            reopen();
            this.toast(say);
        });
    }

    /** 家面板的分栏。跨次打开保持 —— 上次在看制作，下次多半还想制作 */
    private homeTab: 'feed' | 'craft' = 'feed';

    /**
     * 「家」= 灶台 + 工作台。
     *
     * 合并的依据是**同类**：两个都是"花资源换一个数值"，加起来只有 5 个可选项目。
     * 分成两个入口的代价是玩家要记住食物在哪个炉子旁 —— 而它们本来就都在院子里。
     *
     * **它和别的面板最大的不同：界面里有一只宠物。**
     * 改造前灶台的全部内容是"砂糖 的肚子 42/100 · 果子 3 · 材料 5 · 干粮 0"一行字：
     * 你给谁做饭、它现在饿成什么样，全靠读数字。这里把当前出战那只的立绘摆进来，
     * 饱食做成可视条 —— 喂完立刻看见条涨，比 toast 里一句"饱食 +22"强得多。
     */
    private openHome() {
        const s = this.save;
        const who = PETS.find((p) => p.id === s.active);
        const wn = who ? who.name : '砂糖';

        this.openSheet(
            '工坊',
            `果子 ${s.apples} · 材料 ${s.logs} · 吧唧 ${s.coins} · 干粮 ${s.bag.ration} · 收集篮 ${s.bag.basket}`,
            (card) => {
                /* 装饰层单独一个节点：Cocos 一个节点只能挂一个 Graphics 组件，
                   后面还要画饱食条、卡片底、分割线，全挤在 card 上会互相覆盖 */
                const deco = new Node('deco');
                deco.parent = card;
                deco.addComponent(UITransform).setContentSize(700, 520);
                const g = deco.addComponent(Graphics);

                /* 分割线：左栏 | 右栏 */
                g.fillColor = new Color(214, 176, 140, 120);
                g.rect(-118, -196, 2, 340);
                g.fill();
                g.rect(-330, 150, 640, 2);
                g.fill();

                /* ---------- 左栏：这一趟陪你出门的那只 ---------- */
                const LX = -230;
                const H = 160;
                const sf = this.petFrame(wn);
                if (sf) {
                    /* `rect` 在真机上一定有，但离屏渲染桩（tools/_mock-cc.js）里没有 ——
                       直接读 `.width` 会在截图工具里崩在 openSheet 里，
                       而崩在 openSheet 的表现是"点了没反应"，最难查的那种。
                       取不到就按 1:1 放，立绘轻微变形好过整个面板打不开。 */
                    const r = sf.rect;
                    const ratio = r && r.height ? r.width / r.height : 1;
                    const w = H * ratio;
                    const n = new Node('portrait');
                    n.parent = card;
                    n.addComponent(UITransform).setContentSize(w, H);
                    /* 脚底落在 y=-28：立绘是"站"在这里的，中心对齐会读成浮着 */
                    n.setPosition(LX, -28 + H / 2, 0);
                    const sp = n.addComponent(Sprite);
                    sp.sizeMode = Sprite.SizeMode.CUSTOM;
                    sp.spriteFrame = sf;
                } else {
                    /* 没有立绘就画个圆占位 —— 绝不空着。
                       空着的位置玩家会以为是加载失败，画个底至少读作"肖像框" */
                    g.fillColor = new Color(238, 226, 208, 255);
                    g.circle(LX, 60, 52);
                    g.fill();
                }

                mkLabel(card, 'who', wn, 22, INK, 200, 30).node.setPosition(LX, -56, 0);

                const sat = Math.round(clamp(s.satiety, 0, SATIETY.max));
                const full = s.satiety >= SATIETY.fullLine;
                const hungry = s.satiety >= SATIETY.hungryLine;
                mkLabel(card, 'satTxt', `肚子 ${sat}/${SATIETY.max}`, 12, INK_SOFT, 200, 18)
                    .node.setPosition(LX, -84, 0);

                /* 饱食条：颜色沿用出战卡的三档（满饱绿 / 半饿金 / 全饿红）。
                   **金是"最强区间"的招牌色** —— 玩家在战斗里见过的那个金，
                   在家园里必须还是同一个意思，两个界面不能各用一套配色 */
                const BW = 176, BH = 14, BY = -106;
                g.fillColor = new Color(228, 214, 196, 255);
                g.roundRect(LX - BW / 2, BY - BH / 2, BW, BH, 7);
                g.fill();
                const col = full ? new Color(107, 203, 119, 255)
                    : hungry ? new Color(255, 215, 0, 255)
                        : new Color(255, 82, 82, 255);
                g.fillColor = col;
                g.roundRect(LX - BW / 2, BY - BH / 2, Math.max(8, BW * (s.satiety / SATIETY.max)), BH, 7);
                g.fill();

                /* ⚠ **不要用 `heartText`（♥♡）画心**。
                   这个符号靠字体兜底：Cocos 的系统字体通常有，但换设备/换引擎渲染
                   就可能整排显示成方块（离屏渲染桩里就是五个方块）。
                   "亲密度 2 / 5" 信息量完全等价，而且不可能缺字形。 */
                mkLabel(card, 'heart', `亲密度 ${heartsOf(s.pats[s.active] || 0)} / 5`,
                    13, new Color(170, 116, 96, 255), 200, 20).node.setPosition(LX, -134, 0);

                /* ---------- 右栏：分栏 + 可选项目 ---------- */
                const TABS: Array<{ k: 'feed' | 'craft'; t: string }> = [
                    { k: 'feed', t: '喂饭' },
                    { k: 'craft', t: '制作' },
                ];
                TABS.forEach((tab, i) => {
                    const on = this.homeTab === tab.k;
                    this.mkPill(card, `tab-${tab.k}`, tab.t, 128, 40, -27 + i * 142, 112, true, () => {
                        this.homeTab = tab.k;
                        this.openHome();
                    }, on);
                });

                if (this.homeTab === 'feed') {
                    const ICON: Record<string, string> = { fruit: 'apple', stew: 'stew', ration: 'ration' };
                    MEALS.forEach((m, i) => {
                        const cost = [
                            m.apples ? `果子 ${m.apples}` : '',
                            m.logs ? `材料 ${m.logs}` : '',
                            m.ration ? '背包 1' : '',
                        ].filter(Boolean).join(' + ');
                        const lack = (m.apples > s.apples) || (m.logs > s.logs) || (m.ration > s.bag.ration);
                        this.mkItemCard(card, m.id, ICON[m.id] ?? '', m.name, cost, `饱食 +${m.sat}`,
                            110, 44 - i * 104, !lack, '喂', () => {
                                this.act(feed(this.save, m.id), () => this.openHome());
                            });
                    });
                } else {
                    const ICON: Record<string, string> = { ration: 'ration', basket: 'basket' };
                    RECIPES.forEach((r, i) => {
                        const cost = [
                            r.apples ? `果子 ${r.apples}` : '',
                            r.logs ? `材料 ${r.logs}` : '',
                            r.coins ? `吧唧 ${r.coins}` : '',
                        ].filter(Boolean).join(' + ');
                        const lack = (r.apples > s.apples) || (r.logs > s.logs) || (r.coins > s.coins);
                        const use = r.give === 'ration' ? '喂饭时能直接吃' : '派遣产量多一半';
                        this.mkItemCard(card, r.id, ICON[r.id] ?? '', r.name, cost, use,
                            110, 44 - i * 104, !lack, '制作', () => {
                                this.act(craft(this.save, r.id), () => this.openHome());
                            });
                    });
                }
            },
            700, 520,
        );
    }

    /**
     * 一张"有对象的"选项卡：左边是**那个东西的图**，右边是做这件事的代价。
     *
     * 这就是对象型面板和清单型面板的全部区别 —— 原来这里只有一行字
     * `野果 | 果子 8 | 饱食 +22 | 喂`，玩家不知道野果长什么样。
     */
    private mkItemCard(
        parent: Node, name: string, icon: string, title: string, cost: string, gain: string,
        x: number, y: number, enabled: boolean, action: string, onClick: () => void,
    ) {
        const W0 = 400, H0 = 92;
        const card = new Node(name);
        card.parent = parent;
        card.addComponent(UITransform).setContentSize(W0, H0);
        card.setPosition(x, y, 0);
        const g = card.addComponent(Graphics);
        g.fillColor = enabled ? ROW_FILL : ROW_OFF;
        g.roundRect(-W0 / 2, -H0 / 2, W0, H0, 16);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = enabled ? new Color(214, 176, 140, 255) : new Color(196, 184, 168, 255);
        g.roundRect(-W0 / 2, -H0 / 2, W0, H0, 16);
        g.stroke();

        /* 产物图 52×52。没有图就画个圆底 —— 位置留着，形态不变 */
        const ix = -W0 / 2 + 10 + 26;
        if (!this.mkIcon(card, 'ico', icon, 52, ix, 0)) {
            g.fillColor = enabled ? new Color(246, 232, 206, 255) : new Color(224, 218, 208, 255);
            g.circle(ix, 0, 24);
            g.fill();
        }

        /* 三块的位置钉死，各管一格：
             左  —— 名字（18px，上）
             左  —— 代价（12px，下），和名字中心距 36
             右  —— 收益（12px，下），**右缘贴按钮左侧 14px**，"饱食 +22" 和 "饱食 +48"
                   字数一样也要对齐，居中的话长短一差就左右跳
           两行中心距 36 而不是上一版的 28：18px 中文的行高约 23、12px 约 16，
           28 只剩 8px 净间隙，缩到一半看就是两行糊在一起。 */
        const tx = -W0 / 2 + 76;
        const bw = 84, bh = 36;
        const btnCx = W0 / 2 - 10 - bw / 2;
        mkLeftLabel(card, 'nm', title, 18, enabled ? INK : INK_SOFT, tx, 20, 140, 24);
        mkLeftLabel(card, 'cost', cost, 12, enabled ? INK_SOFT : new Color(190, 120, 110, 255), tx, -16, 170, 17);
        mkRightLabel(card, 'gain', gain, 12, new Color(122, 146, 88, 255), btnCx - bw / 2 - 12, -16, 130, 17);

        this.mkPill(card, 'act', action, bw, bh, W0 / 2 - 10 - bw / 2, 0, enabled, onClick);
    }

    /** 从院子里那只宠物身上取立绘 —— 同步、零加载，且和玩家刚看到的是同一张图 */
    private petFrame(name: string): SpriteFrame | null {
        for (const p of this.pets) {
            if (p.name !== name || !p.node || !p.node.isValid) continue;
            const sp = p.node.getComponent(Sprite);
            if (sp && sp.spriteFrame) return sp.spriteFrame;
        }
        return null;
    }

    /**
     * 派遣面板。
     *
     * **改造前它只有一个「派出」按钮和一句 toast** —— 面板上既没有产出预期、
     * 也没有"已经攒了几趟"、更没有"这些产出拿去干嘛"。玩家的原话是
     * 「派遣也是很简单，不知道有啥用」。三件事一起补：
     *
     *   ① **产出预期写在每一行上**（`yieldText`，和结算读同一张表）；
     *   ② **攒了几趟 / 还差多少秒**写出来 —— 60 秒一趟、最多 10 趟，
     *      所以"先去打一局再回来收"是一个算得出来的决定；
     *   ③ **把用途接上**：产出里有**干粮**，而干粮是灶台直接吃的东西。
     *      饱食度每关 −16、饿了火力降 —— 派遣第一次接进了战力那条链。
     *
     * 这里不出"多宠并行"：存档里 `dispatch` 是单只（`{id, since}`），
     * 改成数组要迁移存档，而"一次一只"本身也是这套养成的节奏
     * （一宠出征、六宠看家 —— 出去的永远只有一只）。
     */
    private openDispatch() {
        const s = this.save;
        const job = s.dispatch;
        const peek = peekDispatch(s, Date.now());

        const bits: string[] = [];
        if (job) {
            const who = petById(job.id);
            const n = who ? who.name : '它';
            bits.push(peek.hauls >= DISPATCH_CAP
                ? `${n} 攒满 ${DISPATCH_CAP} 趟了，先收回`
                : peek.hauls > 0
                    ? `${n} 攒了 ${peek.hauls} 趟 · 还能再攒 ${DISPATCH_CAP - peek.hauls} 趟`
                    : `${n} 还要 ${peek.left} 秒才攒满第一趟`);
        } else {
            bits.push('留在家里的能出门采集 · 干粮能直接喂肚子');
        }
        bits.push(`一趟 ${DISPATCH_SEC} 秒 · 最多攒 ${DISPATCH_CAP} 趟`);

        this.openSheet('派遣', bits.join('　·　'), (card) => {            const owned = unlockedPets(s.cleared);
            /* 出门在外的排最前 —— 玩家点进这个面板十次有九次是来收东西的。 */
            const list = owned.slice().sort((a, b) => {
                const ra = job && job.id === a.id ? 0 : a.id === s.active ? 2 : 1;
                const rb = job && job.id === b.id ? 0 : b.id === s.active ? 2 : 1;
                return ra - rb;
            });

            list.forEach((p, i) => {
                const isAway = !!job && job.id === p.id;
                const isOut = p.id === s.active;

                let meta: string;
                let action: string;
                let ok = false;
                let onClick = () => {};

                if (isAway) {
                    const ready = peek.hauls > 0;
                    /* 收成明细和"还差几秒"分两段写：玩家要的是"现在能不能点"，
                       而不是一个混合了两种状态的句子。 */
                    meta = ready
                        ? `${peek.hauls} 趟 · ${[
                            peek.ration ? `干粮 ${peek.ration}` : '',
                            peek.apples ? `果子 ${peek.apples}` : '',
                            peek.logs ? `材料 ${peek.logs}` : '',
                            peek.coins ? `吧唧 ${peek.coins}` : '',
                        ].filter(Boolean).join(' · ')}`
                        : `${peek.left} 秒后来收`;
                    action = ready ? '收回' : '等着';
                    ok = ready;
                    onClick = () => this.act(
                        collectDispatch(this.save, Date.now()),
                        () => this.openDispatch(),
                    );
                } else if (isOut) {
                    meta = `跟你出门 · ${yieldText(p.id)}`;
                    action = '出战';
                } else if (job) {
                    meta = '一次只能派一只，先收回外面的';
                    action = '不能派';
                } else {
                    meta = yieldText(p.id);
                    action = '派出';
                    ok = canDispatch(s, p.id);
                    onClick = () => this.act(
                        startDispatch(this.save, p.id, Date.now()),
                        () => this.openDispatch(),
                    );
                }

                this.mkRow(card, p.id, p.name, meta, action, 0, 132 - i * 64, onClick, ok, 58, p.short);
            });

            if (!owned.length) {
                mkLabel(card, 'none', '家里还没有伙伴', 18, INK_SOFT, 400, 32)
                    .node.setPosition(0, 20, 0);
            }
        }, 640, 560);
    }

    private openSettings() {
        const s = this.save.settings;
        this.openSheet(
            '设置',
            '画质会立刻改帧率。音效开关先记住，这一版还没有声音。',
            (card) => {
                this.mkRow(card, 'crisp', '画质', s.crisp ? '清晰 · 60 帧' : '流畅 · 30 帧', s.crisp ? '清晰' : '流畅', 0, 40, () => {
                    this.act(toggleCrisp(this.save), () => this.openSettings());
                });
                this.mkRow(card, 'mute', '音效', '这一版还没有声音，开关会记住', s.mute ? '关' : '开', 0, -40, () => {
                    this.act(toggleMute(this.save), () => this.openSettings());
                });
            },
        );
    }

    /* ----------------------------------------------------------------------
     * 图鉴面板：右侧竖栏「图鉴」打开
     * -------------------------------------------------------------------- */

    private openCodex() {
        this.closeSheet();
        /* 图鉴的入口在抽屉右侧（不被抽屉盖住），点了会同时出现两个浮层。
           它不像 openSheet 那样自带 closeDrawer，必须显式关。 */
        this.closeDrawer();
        if (this.codex) {
            this.codex.removeFromParent();
            this.codex.destroy();
            this.codex = null;
            this.codexOp = null;
        }
        this.ensureCodex();
        /* 取到局部变量再判空：TS 不会因为调用 `ensureCodex()` 就认为
           `this.codex` 可能又变成非空，于是在 `this.codex = null` 之后
           把它收窄成 `never`，下面这行就报 "Property 'active' does not
           exist on type 'never'"，编译红着、却完全不影响运行。
           用局部量把这个收窄打断，写法也更难出错。 */
        const cx = this.codex as Node | null, cxOp = this.codexOp;
        if (!cx || !cxOp) return;
        cx.active = true;
        cxOp.opacity = 0;
        tween(cxOp).to(0.20, { opacity: 255 }).start();
    }

    private closeCodex() {
        if (!this.codex || !this.codexOp) return;
        const c = this.codex;
        const op = this.codexOp;
        tween(op)
            .to(0.16, { opacity: 0 })
            .call(() => { c.active = false; })
            .start();
    }

    /**
     * 图鉴面板。**内容全部从存档现算**，和锁定槽、出发卡共用同一份
     * `PETS` / `petGap()` —— 三处写三个解锁节奏，改一次必然漏两处。
     *
     * 头像走 `this.heads`（`resources/grove/head/<short>.png`，和战斗 HUD
     * 左上角那个头像是同一份图）。**上一版这里画的是名字首字** ——
     * 格子里是「尖」「短」「胖」，玩家管这叫"图鉴不显示 ICON，太 low"。
     * 当时不贴图的理由是"头像不在 resources 下、运行时 load 不到"，
     * 而 `gen_grove_art.py` 早就把 `ui/home/heads-circle/` 收缩进
     * `resources/grove/head/` 了 —— 那个理由当时就不成立，只是一直没人回头看。
     *
     * 图没加载上时仍然退回"圆底 + 首字"：不留白框，也不崩。
     */
    private ensureCodex() {
        if (this.codex) return;

        const root = new Node('__Codex');
        root.parent = this.canvas;
        root.addComponent(UITransform).setContentSize(W, H);
        root.setSiblingIndex(-1);
        root.active = false;
        this.codex = root;

        /* 压暗 + 点击关闭。
           这里用**半透明**的遮罩，不像出发卡那样整块盖住：图鉴是要"看后面的家"
           的 —— 玩家刚在主界面点进来，画面还得认得出是自家院子。 */
        const scrim = new Node('scrim');
        scrim.parent = root;
        scrim.addComponent(UITransform).setContentSize(W, H);
        const sg = scrim.addComponent(Graphics);
        sg.fillColor = new Color(38, 26, 20, 205);
        sg.rect(-W / 2, -H / 2, W, H);
        sg.fill();
        scrim.on(Node.EventType.TOUCH_END, () => this.closeCodex());

        const CW = 700, CH = 470;
        const card = new Node('card');
        card.parent = root;
        card.addComponent(UITransform).setContentSize(CW, CH);
        paintCard(card.addComponent(Graphics), CW, CH);
        /* 卡面吃掉点击，别透到遮罩上把面板关掉 */
        card.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; });

        const cleared = this.save.cleared;
        const owned = PETS.filter((p) => cleared >= p.at).length;

        mkLabel(card, 'title', '图鉴', 34, INK, 400, 48).node.setPosition(0, 190, 0);
        /* 标题容器 [166,214]、副标题容器 [140,168] 原来差 2px 就咬在一起，
           文字审计报 `card/title × card/sub 400×2px`。下移到 148 → 净间隙 4px。 */
        mkLabel(card, 'sub', `已收服 ${owned} / ${PETS.length}`, 18, INK_SOFT, 400, 28)
            .node.setPosition(0, 148, 0);

        /* ---- 战绩条：每关的最佳评级 ----
         *
         * 为什么放在图鉴里：图鉴是"我收集到哪了"的地方，关卡成绩属于同一类东西。
         * 更要紧的是 —— 评级原来是**死数据**（算了、写内存、从不显示、重启归零），
         * 把它挂在玩家一定会点进来的面板上，它才第一次变成"成绩"。
         *
         * 全空时不显示一排 0：那看着像坏了。改成一句说明，告诉玩家这里会有什么。
         */
        {
            const cnt: Record<string, number> = { S: 0, A: 0, B: 0 };
            for (const r of this.save.best) if (r === 'S' || r === 'A' || r === 'B') cnt[r]++;

            const row = new Node('ranks');
            row.parent = card;
            row.addComponent(UITransform).setContentSize(560, 22);
            /* y=129 / 高 22 是**量出来的唯一存活区间**：
               副标题底在 140、第一行格子实际图形顶在 116（格心 40 + 圆顶 76），
               中间只有 24px。再高一点压副标题，再低一点压宠物圆底。 */
            row.setPosition(0, 129, 0);
            const rg = row.addComponent(Graphics);
            rg.fillColor = new Color(240, 226, 206, 255);
            rg.roundRect(-280, -11, 560, 22, 11);
            rg.fill();
            rg.lineWidth = 2;
            rg.strokeColor = new Color(198, 168, 136, 255);
            rg.roundRect(-280, -11, 560, 22, 11);
            rg.stroke();

            const any = cnt.S + cnt.A + cnt.B > 0;
            mkLabel(row, 'txt',
                any
                    ? `S ×${cnt.S}    A ×${cnt.A}    B ×${cnt.B}    已通 ${cleared} / ${STAGE_COUNT} 屏`
                    : `已通 ${cleared} / ${STAGE_COUNT} 屏 · 结算会给 S / A / B，最好成绩记在这里`,
                16, any ? INK : INK_SOFT, 540, 20).node.setPosition(0, 0, 0);
        }

        /* 3 列 × 2 行。列宽 200、行高 160 —— 六个格子占满 600×320，
           四周留 50 的内边距，卡片边框不会被格子压到。 */
        const COL_X = [-200, 0, 200];
        const ROW_Y = [40, -140];

        PETS.forEach((p, i) => {
            const cx0 = COL_X[i % 3];
            const cy0 = ROW_Y[Math.floor(i / 3)];
            const got = cleared >= p.at;
            const gap = petGap(cleared, p.id);

            const cell = new Node(`cell-${p.id}`);
            cell.parent = card;
            cell.addComponent(UITransform).setContentSize(190, 150);
            cell.setPosition(cx0, cy0, 0);
            const cg = cell.addComponent(Graphics);

            /* 圆底：**只作兜底**。头像本身是自带奶油底的圆片（96×96，
               四角透明），贴上去就把这个圆盖住了。没有图时才靠它。 */
            const sf = this.heads[p.short];
            if (!sf) {
                cg.fillColor = got ? new Color(246, 206, 128, 255) : new Color(206, 198, 186, 255);
                cg.circle(0, 34, 42);
                cg.fill();
                mkLabel(cell, 'mark', got ? p.name.slice(0, 1) : '?', 34,
                        got ? new Color(92, 60, 24, 255) : new Color(120, 112, 104, 255), 80, 44)
                    .node.setPosition(0, 34, 0);
            }

            /* 头像（84×84，和原来的圆同直径）。没到家的压暗 —— 不是隐身：
               玩家要看见"这一格是谁"，只是知道"还不能带它"。 */
            const head = new Node('head');
            head.parent = cell;
            head.addComponent(UITransform).setContentSize(84, 84);
            head.setPosition(0, 34, 0);
            const hs = head.addComponent(Sprite);
            hs.sizeMode = Sprite.SizeMode.CUSTOM;
            if (sf) {
                hs.spriteFrame = sf;
                hs.color = got ? WHITE : new Color(110, 100, 92, 255);
            } else {
                head.active = false;
            }

            /* 描边画在头像**上面**：Graphics 挂在 cell 上会先于子节点绘制，
               所以另起一个节点。这一圈是"收服了"和"没解锁"唯一的硬区别 ——
               只靠压暗的话，暖黄底下压暗一档还是暖的。 */
            const ring = new Node('ring');
            ring.parent = cell;
            ring.addComponent(UITransform).setContentSize(88, 88);
            ring.setPosition(0, 34, 0);
            const rg2 = ring.addComponent(Graphics);
            rg2.lineWidth = 3;
            rg2.strokeColor = got ? new Color(176, 122, 60, 255) : new Color(158, 148, 136, 255);
            rg2.circle(0, 0, 42);
            rg2.stroke();

            /* 没到家的在头像上盖一个问号 —— 压暗的头像仍然认得出是谁，
               问号回答的是"能不能带"，两件事分开说。 */
            if (!got) {
                mkLabel(cell, 'mark', '?', 40, new Color(255, 250, 240, 235), 80, 52)
                    .node.setPosition(0, 34, 0);
            }

            /* 三行的容器高宽是 24/20/18，按 4px 净间隙排开：
               name [-32,-8] / state [-56,-36] / line [-79,-61]。
               原来 26/22/20 挤在 -22/-48/-68 上，state 与 line 的容器
               直接咬 1px（审计报 `state × line 180×1px`）——
               换心形文案后读起来就是"亲密度这行贴着台词"。 */
            mkLabel(cell, 'name', got ? p.name : '未收服', 19,
                    got ? INK : INK_SOFT, 180, 24).node.setPosition(0, -20, 0);

            const pats = this.save.pats[p.id] || 0;
            mkLabel(cell, 'state', got ? `${heartText(pats)} · 摸 ${pats}` : `还差 ${gap} 关`, 14,
                    got ? new Color(63, 125, 36, 255) : INK_SOFT, 180, 20)
                .node.setPosition(0, -46, 0);
            mkLabel(cell, 'line', got ? (PET_LINE[p.id] || '') : '', 13, INK_SOFT, 180, 18)
                .node.setPosition(0, -70, 0);
        });

        mkLabel(card, 'tip', '点空白处关闭', 14, INK_SOFT, 400, 22).node.setPosition(0, -206, 0);

        this.codexOp = root.addComponent(UIOpacity);
    }

    /** 出门入口。这就是「点了要有反应」的落点。 */
    private openDepart() {
        this.closeSheet();
        if (this.depart) {
            this.depart.destroy();
            this.depart = null;
            this.departOp = null;
        }
        this.ensureDepart();
        /* 同 openCodex：局部量打断 TS 的属性收窄，避免 never 报错 */
        const dp = this.depart as Node | null, dpOp = this.departOp;
        if (!dp || !dpOp) return;
        dp.active = true;
        dpOp.opacity = 0;
        tween(dpOp).to(0.22, { opacity: 255 }).start();
    }

    /** @param after 淡出播完后再执行（切场景要等动画收尾，否则是"闪一下"） */
    private closeDepart(after?: () => void) {
        if (!this.depart || !this.departOp) { if (after) after(); return; }
        const d = this.depart;
        const op = this.departOp;
        tween(op)
            .to(0.18, { opacity: 0 })
            .call(() => { d.active = false; if (after) after(); })
            .start();
    }

    private placeTaskBtn() {
        const badges = this.canvas.getChildByName('Badges');
        if (!badges || badges.getChildByName('TaskBtn')) return;
        const btn = new Node('TaskBtn');
        btn.parent = badges;
        const box = btn.addComponent(UITransform);
        /* 点击区 84×76：比视觉（54×26 的胶囊）大一圈。
           视觉尺寸与点击区分离是硬规矩 —— 54×26 只有 1404px²，
           手指按不准；84×76 是 6384px²，且四边仍在木牌范围内，
           不会和旁边的「去苔原」热区抢触摸。 */
        box.setContentSize(84, 76);
        box.setAnchorPoint(0.5, 0.5);
        /* 路标牌**中间那块**木板的牌面中心。
           像素分段（tools/_home-rt-shot.js 渲染后逐列扫描，不是看缩放截图）：
             整块板 x 166..254，其中 166..175 是左侧的厚度斜面（高光+暗边），
             175..254 才是真正能放东西的牌面 —— 宽 79，中心 x=214.5；
             纵向 250..290，中心 y=270。
           上一版写 (-419, 90) = 屏幕 (221, 270)：那是按"净区 190..252"
           算的中心，而 190 这个左界把斜面的一部分也算进去了 ——
           两个字时看不出偏，加了 54 宽的椭圆底板就立刻读成"牌没钉正"。
           改成 x=214.5 = 木牌正面中心，底板左右留白才对称。 */
        btn.setPosition(-425, 90, 0);

        /* **底板 = 场景里的 TaskPlate（54×26 椭圆胶囊），搬进 btn 下当底。**
           前两版的历史：72×36 橙色胶囊浮在牌子右边（"任务我想在牌子上" +
           压在"去苔原"圆徽上 → "很多重了"）→ 干脆去掉底板、字直接写在木牌上。
           这一版是用户第三次收口："任务也要处理起来椭圆" —— 要的是**跟另外
           四块名字板同一种形态**，不是再做一个橙色胶囊。
           形状语言统一之后，任务读作"路标牌上钉的一块米白椭圆牌"。

           为什么底板走场景静态 Sprite、不在这里 resources.load：
           HomeRuntime 全程是 Graphics 程序化绘制，唯一一次动态加载是
           launchBattle 按 uuid 拉场景。为一块 54×26 的底引入 resources
           目录 + 异步回调，会出现"第一帧没有底、第二帧才出现"的跳变；
           场景里的静态 Sprite 是同步的，反序列化完就在。
           搬进 btn 下（而不是留在 Badges 里各自定位）：位置真相只留
           btn 一处，底板自动跟随，不会出现"按钮挪了底板没跟"的分裂。 */
        const plate = badges.getChildByName('TaskPlate');
        if (plate) {
            plate.setParent(btn);
            /* 局部位置归零 = 与按钮同心。搬过来的节点会带着场景里的 (-425, 90)，
               不归零就会二次偏移（这个错很好犯，而且不会报错，只是在图上看不见底牌）。 */
            plate.setPosition(0, 0, 0);
            plate.setSiblingIndex(0);
        }

        /* 按下反馈 = 给底板做 tint，**不再叠一层暖光 Graphics**。
           为什么 Graphics 不行：Graphics 是 btn 自己的组件，渲染顺序在
           子节点之前；底板 plate 是 btn 的不透明子 Sprite，会把暖光整块
           盖住 —— 离屏渲染图上看得出变化，真实引擎里按下态等于没有反馈。
           tint 是乘在贴图颜色上的，不占层级，也不会被自己盖住。
           色值 (255, 226, 168)：米白 (255, 252, 240) 乘上去偏淡黄，
           读作"牌面被灯火照亮了一下"，而不是"牌面变成了黄色"。 */
        const plateSprite = plate ? plate.getComponent(Sprite) : null;
        const paintPress = (pressed: boolean) => {
            if (!plateSprite) return;
            plateSprite.color = pressed
                ? new Color(255, 226, 168, 255)
                : new Color(255, 255, 255, 255);
        };
        paintPress(false);

        /* 13px / 行高 17，字色 #6B4025 —— 这三项**不是重新挑的**，是跟着
           名字板抄的：名字板 24 高配 12px 字（字占 50%），任务胶囊 26 高
           按同一比例该配 13px；字色与 Cap-* 的 (107,64,37) 完全一致。
           上一版 15px 是"字直接写在木牌上"时定的 —— 没有底板，字就是主体，
           笔画像要够重；加了底板之后字要退到"牌面上的字"，13px 才不顶描边：
           26 高减两侧 3px 描边只剩 20px 内区，15px 的字上下各留 2.5px，
           读作"字撑满了胶囊"。 */
        mkLabel(btn, 'txt', '任务', 13, new Color(107, 64, 37, 255), 54, 20);

        btn.on(Node.EventType.TOUCH_START, () => paintPress(true));
        btn.on(Node.EventType.TOUCH_CANCEL, () => paintPress(false));
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            paintPress(false);
            this.openTasks();
        });
        this.refreshTaskBtn();
    }

    /**
     * 派遣：把背景图里那块深绿告示板**盖成一张白卡**。
     *
     * 用户两条反馈是同一件事的首尾：
     *   · "派遣很突兀"
     *   · "其他 UI 底色还是以白色的"
     * 那一屏里只有这块板是深绿 —— 暖黄草地上唯一的高饱和冷色，
     * 眼睛第一眼就落在它上面；而资源卡、芽屋卡、宠物卡全是米白圆角卡，
     * 它是个异类。盖成同一套白卡，两条一起解决。
     *
     * 绿板是**背景图的一部分**，删不掉，所以只能用一张同尺寸的卡盖住。
     *
     * 尺寸是量出来的，不是估的（tools/_grid-crop.js + 像素分段）：
     *   bg.png 里那块板的绿芯是 rgb(78,107,82)、外框是 rgb(96,61,35)，
     *   分段得到 bg 坐标 x 1185..1326 / y 637..732；
     *   bg.png 是 1536×1024 画进 1280×853.33，缩放 0.8333，顶点在 (0,-40)，
     *   换成屏幕坐标 = **x 987..1105 / y 491..570**，也就是 118×79。
     *
     * 上一版按"x 987~1145 / y 482~595"取了 170×128 —— 那份数字是看缩放后的
     * 截图读的，宽高都大了四成，卡片糊成一块白板，比原来的绿板还抢眼。
     *
     * 卡片取 132×108：横向盖住绿板（987..1105，两侧各留 6px），
     * 纵向要额外吃进**派遣徽标的顶边**（475）——徽标+文字底牌
     * （475..544）本来就压在板上，卡片必须把它们一起框进来，
     * 否则白卡上会浮着一半在板外、一半在板内的图标。
     * 132×108 中心 (406,-162) → 屏幕 980..1112 / 468..576。
     */
    /**
     * 派遣：缩成一张**钉在告示板上的纸**。
     *
     * 历史三版，问题各不相同，别重犯：
     *   v1 170×128 —— 数字是看缩放截图读的，宽高大了四成，糊成一块白板；
     *   v2 132×132 —— 尺寸勉强对了，但把整块绿板**盖死**：玩家端到端的
     *      读数只有"草地上浮着一个白色圆角方块"。用户的原话是
     *      「派遣很突兀，之前不是有个像广告牌吗」—— 突兀的不是白卡本身，
     *      是**告示板被吃掉了**。一块水彩木牌旁边贴一张纯白矢量的卡，
     *      两套语言，看不出从属关系。
     *   v3（这一版）92×80 —— 缩到板面以内，四周露出木框和绿边，
     *      底色从纯白改成暖米纸色、描边收细、顶上钉两枚红图钉。
     *      读出来是"贴在木牌上的一张纸"，而不是"浮在草地上的按钮"。
     *
     * 尺寸依据是**实测**（像素分段 + bg→设计的 0.8333 换算）：
     *   bg.png 板面（含木框）x 1274..1418 / y 594..700
     *   → 设计 x 1062..1182（120 宽）/ y 458..543（85 高），中心 (1122, 500)
     *   卡片 92×80 居中放进去：左右各露 14px 绿边、上下各露 2.5px 木框。
     *
     * ⚠ 高度上不去了：派遣徽标 48 + 文字底牌 20 = 70，卡片 80 只剩上下各 5。
     *   想让卡片更小就得缩徽标（会连带缩小 88×88 的热区），不划算。
     */
    private placeDispatchCard() {
        const badges = this.canvas.getChildByName('Badges');
        if (!badges) return;

        const CW = 92, CH = 80;
        /* 板面中心换算到 Canvas 本地坐标（中心原点、y 向上）：
           设计 (1122, 500) → (1122-640, 360-500) = (482, -140) */
        const CX = 482, CY = -140;

        /* 徽标与文字跟着卡片重排。不重排就会「纸缩小了，字还在纸外面」——
           原来徽标顶在 483，卡片缩到 460..540 之后徽标底会漏出去。
           内容 70 高、卡片 80 → 上下各留 5，于是徽标顶 = 465、文字顶 = 515。 */
        const badge = badges.getChildByName('Badge-派遣');
        const cap = badges.getChildByName('Cap-派遣');
        if (badge) badge.setPosition(458, -(465 - 360), 0);
        if (cap) cap.setPosition(464, -(515 - 360), 0);

        if (badges.getChildByName('DispatchCard')) return;
        const card = new Node('DispatchCard');
        card.parent = badges;
        const box = card.addComponent(UITransform);
        box.setContentSize(CW, CH);
        box.setAnchorPoint(0.5, 0.5);
        card.setPosition(CX, CY, 0);

        const g = card.addComponent(Graphics);
        /* 纸落在木牌上的那点软影。
           只画三层、每层 12 的 alpha 往外递推 —— Graphics 没有模糊，单层的
           半透明矩形会在纸下面留一条**硬暗边**（第一版 46 的 alpha 就是这样，
           放大看像纸底下垫了块砖）。三层叠出渐变，读作"纸有点厚度"。
           注意这不是"接地影"：纸是钉在牌**面上**的，不落地。 */
        for (const [dx, dy, a] of [[1.2, -1.4, 14], [2.4, -2.6, 10], [3.6, -3.8, 7]]) {
            g.fillColor = new Color(58, 40, 26, a);
            g.roundRect(-CW / 2 + dx, -CH / 2 + dy, CW, CH, 16);
            g.fill();
        }

        /* 暖米纸色，不是纯白（255,252,244）。纯白在这张暖黄的图里是"最高明度"，
           眼睛一定会先看到它 —— 那正是"突兀"的来源。纸色压在板面的深绿上，
           对比已经很够了，不需要靠白去抢。 */
        g.fillColor = new Color(250, 240, 214, 255);
        g.roundRect(-CW / 2, -CH / 2, CW, CH, 16);
        g.fill();

        /* 外框 2px（原来 4px）。4px 的粗描边是"界面控件"的画法，
           细描边才是"手绘纸片"的画法 —— UI 语言的一致性就在这些笔画上。 */
        g.lineWidth = 2;
        g.strokeColor = new Color(122, 80, 52, 235);
        g.roundRect(-CW / 2, -CH / 2, CW, CH, 16);
        g.stroke();

        /* 内圈浅缝：和资源卡、芽屋卡同一套（外深棕 + 内浅棕）。 */
        g.lineWidth = 1.5;
        g.strokeColor = new Color(206, 168, 132, 170);
        g.roundRect(-CW / 2 + 6, -CH / 2 + 6, CW - 12, CH - 12, 12);
        g.stroke();

        /* 两枚图钉：压在纸的顶边，颜色取 bg 那块牌上本来就有的红图钉 (190,70,58)。
           这是整张纸里唯一的高饱和色，也顺手把"纸"和"牌"在语义上钉在一起。 */
        for (const px of [-CW * 0.28, CW * 0.28]) {
            g.fillColor = new Color(122, 78, 56, 90);
            g.circle(px + 0.6, CH / 2 - 5.4, 3.4);
            g.fill();
            g.fillColor = new Color(190, 74, 60, 255);
            g.circle(px, CH / 2 - 6, 3.0);
            g.fill();
            g.fillColor = new Color(236, 156, 138, 210);
            g.circle(px - 0.8, CH / 2 - 6.8, 1.1);
            g.fill();
        }

        /* 压在所有徽标下面：卡片是底板，徽标和文字要浮在它上面 */
        card.setSiblingIndex(0);
    }

    private refreshTaskBtn() {
        const btn = this.canvas.getChildByName('Badges')?.getChildByName('TaskBtn');
        const lb = btn?.getChildByName('txt')?.getComponent(Label);
        if (!btn || !lb) return;
        this.taskBtn = btn;
        const n = claimableCount(this.save);
        /* 数字直接写进牌子：玩家不用点开就知道"有几件事等着"。
           没有可领时回到光秃秃的"任务"，不显示 0 —— 0 是个比空白更没信息的字。 */
        lb.string = n > 0 ? `任务 ${n}` : '任务';
        this.taskPulse = n > 0 ? 0.035 : 0;
        if (n <= 0) btn.setScale(1, 1, 1);
    }

    /* ----------------------------------------------------------------------
     * 任务抽屉：左侧滑出，不压暗场景，高度跟着条目走
     * -------------------------------------------------------------------- */

    /**
     * 抽屉宽度 300。
     *
     * 上一版 340 × 606。问题是**内容是轻的**：六条任务，每行只有"名字 + 两件小奖励"，
     * 却按"每行一张 72 高的圆角卡"排下来占了半个屏幕 ——
     * 读起来像"翻了一整页"，不像"从边上抽出一张纸"。
     *
     * 现在 300 宽 + 单行 48：六条全铺开 400 出头，
     * 再把已领的折起来（常态），实际高度只有 200 上下，正好是"瞟一眼"的量。
     */
    private static readonly DRAWER_W = 300;

    /** 单行 44：图标 22 + 名字 14px + 右侧「奖励组 / 进度」+ 领取钮，全在一行 */
    private static readonly TASK_ROW_H = 44;

    /**
     * 已领的默认折叠成一行「已完成 N 件」。
     *
     * 这不是省地方的小聪明：做完的任务在列表里**没有任何可操作性**，
     * 平铺五个灰行只会把"现在能领什么"往下压，甚至压出屏幕。
     */
    private tasksDoneOpen = false;

    /** 点场景关闭用的 canvas 监听（要能摘掉，否则关一次抽屉就多挂一个） */
    private drawerTap: ((e: EventTouch) => void) | null = null;

    /**
     * 为什么任务不是弹窗，以及**为什么在左边**。
     *
     * 任务是"随时瞟一眼"的东西，不是"进入一个地方"，所以不压暗、不挡操作。
     * 位置这条放错过一次（放右边），必须写清楚：
     *
     *   主界面右侧 300 宽 = 派遣告示牌 + 粉垫上六只宠物的右半 + 右下角「出门」。
     *   **那是全屏最活跃的一块**，抽屉一出来就全盖住 ——
     *   玩家想"一边看任务一边看宠物"恰恰做不到。
     *   左侧盖住的是 Logo、路标牌、木桌边缘，开抽屉时本来就不需要看；
     *   而且任务入口（路标牌上的胶囊）就在左边，从入口位置展开也更顺。
     */
    private openTasks() {
        if (this.drawerBusy) return;
        if (this.drawer) { this.closeDrawer(); return; }
        this.closeSheet();

        const DW = HomeController.DRAWER_W;
        /* 下限 150（不是 240）：内容只有两条 + 折叠行时高度约 194，
           撑到 240 会在纸底留 40px 空气 —— 那点空气就是"占位太多"的由来之一。 */
        const DH = clamp(this.taskLayout().height, 150, H - 100);

        const OPEN_X = -(W / 2) + DW / 2;
        const SHUT_X = -(W / 2) - DW / 2;
        /* 垂直位置：**居中略偏上 20**，不再按公式反推。
           原来的 `DH/2-268` 在大内容时抬得对、小内容时把抽屉推到屏幕下半截。
           实际上内容最高（六条全展开 370）时底边也只到 -165，
           离资源条（y -290）还有 125px —— 根本不需要让，直接定值最省事。 */
        const DY = 20;

        const root = new Node('__Drawer');
        root.parent = this.canvas;
        root.addComponent(UITransform).setContentSize(W, H);
        root.setSiblingIndex(-1);
        this.drawer = root;
        const op = root.addComponent(UIOpacity);
        op.opacity = 0;
        this.drawerOp = op;

        const panel = new Node('panel');
        panel.parent = root;
        panel.addComponent(UITransform).setContentSize(DW, DH);
        panel.setPosition(SHUT_X, DY, 0);
        /* 抽屉内部吃掉触摸：不然点行 / 点按钮都会冒到 canvas，
           被下面那个"点场景关闭"的监听接住 —— 点「领取」变成"关抽屉" */
        panel.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; });
        this.paintDrawerBg(panel.addComponent(Graphics), DW, DH);

        this.paintTaskBody(panel, DH);
        this.stageIn(panel);

        /* 点抽屉以外任何地方都关。靠 canvas 冒泡实现 —— **不加全屏拦截层**：
           拦截层会把整个场景的点击都吃掉（宠物摸不到、徽标点不到），
           那就等于一个"不压暗的弹窗"，目的白费了。 */
        this.drawerTap = () => this.closeDrawer();
        this.canvas.on(Node.EventType.TOUCH_END, this.drawerTap);

        /* 纸**不淡入**：它是从屏幕左缘滑出来的，淡入会读成"凭空浮现"。
           只有内容层做延迟淡入（见 stageIn）。 */
        op.opacity = 255;
        tween(panel).to(0.26, { position: new Vec3(OPEN_X, DY, 0) }, { easing: 'cubicOut' }).start();
    }

    /**
     * 纸的底色：投影 + 双层边。
     *
     * 不用 `ui-res` 九宫格：那是泡泡卡（圆角约 150px），拉成 300×400 会糊成一团。
     * 投影用 3 条 alpha 递减的竖条近似（Graphics 没有渐变）——
     * 纯描边读起来是"贴在屏幕上的贴纸"，加一层投影才是"浮在草地上的一张纸"。
     */
    private paintDrawerBg(g: Graphics, DW: number, DH: number) {
        g.clear();
        for (let i = 0; i < 3; i++) {
            g.fillColor = new Color(84, 54, 30, 24 - i * 7);
            g.rect(DW / 2 + i * 5, -DH / 2 + 12 + i * 4, 5, DH - 24 - i * 8);
            g.fill();
        }
        /* 左边超出屏幕 30px：纸是"贴在屏幕左缘"的，不是一张浮着的卡 */
        g.fillColor = CARD_FILL_SOLID;
        g.roundRect(-DW / 2 - 30, -DH / 2, DW + 30, DH, 22);
        g.fill();
        g.lineWidth = 3;
        g.strokeColor = new Color(122, 80, 52, 255);
        g.roundRect(-DW / 2 - 30, -DH / 2, DW + 30, DH, 22);
        g.stroke();
        /* 内层浅色描边 —— 双层纸的"第二层"，成本 3 行，观感差很多 */
        g.lineWidth = 2;
        g.strokeColor = new Color(255, 255, 255, 120);
        g.roundRect(-DW / 2 - 26, -DH / 2 + 5, DW + 22, DH - 10, 18);
        g.stroke();
    }

    /**
     * 内容层进场：**纸先到、字后落**。
     *
     * 上一版整块一起匀速平移进来，一张写满字的纸机械感很强。
     * 拆成两层（纸 0.26s 滑入 + 内容延迟 0.07s 从下方 8px 淡入）才有"落定"的感觉，
     * 而且不需要任何新素材。
     */
    private stageIn(panel: Node) {
        const body = panel.getChildByName('body');
        if (!body) return;
        const bop = body.getComponent(UIOpacity) ?? body.addComponent(UIOpacity);
        bop.opacity = 0;
        body.setPosition(0, -8, 0);
        tween(body).delay(0.07).to(0.18, { position: new Vec3(0, 0, 0) }, { easing: 'quadOut' }).start();
        tween(bop).delay(0.07).to(0.18, { opacity: 255 }).start();
    }

    private closeDrawer() {
        const n = this.drawer;
        if (!n || this.drawerBusy) return;
        this.drawer = null;
        this.drawerOp = null;
        this.drawerBusy = true;
        if (this.drawerTap) {
            this.canvas.off(Node.EventType.TOUCH_END, this.drawerTap);
            this.drawerTap = null;
        }
        const DW = HomeController.DRAWER_W;
        const panel = n.getChildByName('panel');
        if (!panel) {
            n.removeFromParent(); n.destroy(); this.drawerBusy = false; return;
        }
        /* y 用当前值：抽屉高度会随内容变，写死一个数会让关闭时"跳一下" */
        const py = panel.position.y;
        const body = panel.getChildByName('body');
        const bop = body?.getComponent(UIOpacity);
        if (bop) tween(bop).to(0.08, { opacity: 0 }).start();
        tween(panel)
            .to(0.15, { position: new Vec3(-(W / 2) - DW / 2, py, 0) }, { easing: 'quadIn' })
            .call(() => {
                this.drawerBusy = false;
                if (n.isValid) { n.removeFromParent(); n.destroy(); }
            })
            .start();
    }

    /**
     * 抽屉的内容清单。**高度计算和绘制共用这一份** ——
     * 两处各写一遍必然漂移，漂移的结果是最后一行被切掉半截。
     *
     * 顺序按"现在能不能动手"排：能领的 → 还差一点的 → 做完了的（折起来）。
     */
    private taskLayout(): { items: TaskItem[]; height: number } {
        const s = this.save;
        const ready = TASKS.filter((t) => taskPhase(s, t.id) === 'ready');
        const open = TASKS.filter((t) => taskPhase(s, t.id) === 'open');
        const done = TASKS.filter((t) => taskPhase(s, t.id) === 'claimed');

        const items: TaskItem[] = [];
        for (const t of ready) items.push({ kind: 'row', t, h: HomeController.TASK_ROW_H });
        for (const t of open) items.push({ kind: 'row', t, h: HomeController.TASK_ROW_H });
        if (done.length) {
            items.push({ kind: 'fold', h: 34, n: done.length });
            if (this.tasksDoneOpen) {
                for (const t of done) items.push({ kind: 'row', t, h: HomeController.TASK_ROW_H });
            }
        }
        const body = items.reduce((a, b) => a + b.h, 0);
        /* 12 上边距 + 46 标题带 + 内容 + 14 下边距 */
        return { items, height: 12 + 46 + body + 14 };
    }

    /**
     * 画抽屉内容。领取 / 展开之后整块重画（数字、状态全部现算），
     * 所以这里必须是纯函数式的：进来先拆旧的 body 再建新的。
     *
     * **所有 y 从面板顶边往下算**（`top - offset`），不是从中心算 ——
     * 面板高度是变的，从中心算等于每改一次高度就要重算一遍全部坐标。
     */
    private paintTaskBody(panel: Node, DH: number) {
        const old = panel.getChildByName('body');
        if (old) { old.removeFromParent(); old.destroy(); }

        const DW = HomeController.DRAWER_W;
        const RW = DW - 28;                    // 272：左右各留 14
        const top = DH / 2;
        const { items } = this.taskLayout();
        const readyList = TASKS.filter((t) => taskPhase(this.save, t.id) === 'ready');

        const body = new Node('body');
        body.parent = panel;
        body.addComponent(UITransform).setContentSize(DW, DH);
        body.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; });

        /* 标题带：「任务」22 + 紧跟的件数 12 + 右侧「全部领取」小胶囊。
           两个字号按**中心**对齐，对齐字底会让小字看起来往下沉。 */
        /* 容器宽只给 48（两个 22px 字实际占 48）—— 写 110 会跟右边的件数
           容器重叠 52px（审计报「重叠 body/title × body/cnt」），
           视觉上因为文字没那么宽所以看不出来，但下次改文案就会撞上。 */
        mkLeftLabel(body, 'title', '任务', 22, INK, -RW / 2, top - 35, 48, 30);
        const cnt = readyList.length > 0 ? `${readyList.length} 件可领` : `${TASKS.length} 件`;
        /* 件数紧贴「任务」右侧（22px 两个字实际 48 宽，所以 +56 才留出 8px 间隙），不是靠右 ——
           靠右会和「全部领取」抢同一块地方，两个东西中间空一大段，读不成一组 */
        mkLeftLabel(body, 'cnt', cnt, 12,
            readyList.length > 0 ? BTN_DEEP : INK_SOFT, -RW / 2 + 56, top - 35, 80, 18);

        /* 表头下的分隔线：没有它，第一条任务像是标题的一部分 */
        const hline = new Node('hdiv');
        hline.parent = body;
        hline.addComponent(UITransform).setContentSize(DW, DH);
        const hg = hline.addComponent(Graphics);
        hg.fillColor = new Color(214, 176, 140, 110);
        hg.rect(-RW / 2, top - 52, RW, 1.5);
        hg.fill();

        if (readyList.length > 0) {
            /* 「全部领取」做在标题行里，不占一整条。
               上一版是一行 272 宽的实心大按钮 —— 它把抽屉撑高 46px，
               而下面的每一行本身已经写清了能领什么，汇总条纯属重复。
               现在只留一个 84×26 的小胶囊，动作还在，版面省掉一整行。 */
            this.mkPill(body, 'claimAll', '全部领取', 84, 28, RW / 2 - 42, top - 35,
                true, () => this.claimAllTasks());
        }

        let y = top - 56;
        for (const it of items) {
            if (it.kind === 'fold') {
                this.mkDoneFold(body, y - it.h / 2, it.n, RW);
                y -= it.h;
            } else {
                this.mkTaskRow(body, it.t, y - it.h / 2, RW);
                y -= it.h;
            }
        }
    }

    /**
     * 一行任务：图标 + 名字 +（右侧）奖励组 / 进度 + 状态。
     *
     * **单行 48 高**。上一版是 72 高的双行（名字在上、奖励在下），六条下来 432px，
     * 加标题和聚合条就是 606 —— 占了大半屏。而双行并没有多给信息：
     * 第二行只放了两件小奖励，横向排开在名字右侧完全放得下。
     */
    private mkTaskRow(parent: Node, t: TaskDef, cy: number, RW: number) {
        const RH = HomeController.TASK_ROW_H;
        const half = RW / 2;
        const phase = taskPhase(this.save, t.id);
        const isReady = phase === 'ready';
        const isDone = phase === 'claimed';

        const row = new Node(t.id);
        row.parent = parent;
        row.addComponent(UITransform).setContentSize(RW, RH);
        row.setPosition(0, cy, 0);
        row.addComponent(UIOpacity).opacity = isDone ? 150 : 255;

        const g = row.addComponent(Graphics);
        if (isReady) {
            /* 可领的行给整行浅杏底 + 左竖条：满屏同高的行里，
               只有这两样能在缩略图尺寸下分出"哪行现在能点" */
            /* 底色要够黄才看得出来（#FFF9EA 和纸底 #FFFCF4 只差 1~2 级亮度，
               屏幕上等于没有），但**不描边** —— 描边会让每行变成一张独立小卡，
               五条都能领的时候就是"五张黄卡堆叠"，比白底还重。 */
            g.fillColor = new Color(255, 245, 224, 255);
            g.roundRect(-half, -RH / 2 + 2, RW, RH - 4, 12);
            g.fill();
            g.fill();
            g.fillColor = BTN_FILL;
            g.roundRect(-half + 7, -13, 4, 26, 2);
            g.fill();
        } else {
            /* 其余行不画卡片，只画一条短分隔线 —— 一行一张圆角卡会读成"六个按钮" */
            g.fillColor = new Color(206, 186, 164, 80);
            g.rect(-half + 10, -RH / 2, RW - 20, 1);
            g.fill();
        }

        const icoX = -half + 10 + 11;
        if (!this.mkIcon(row, 'ico', t.icon, 22, icoX, 0)) {
            g.fillColor = isReady ? new Color(246, 214, 150, 255) : new Color(233, 223, 210, 255);
            g.circle(icoX, 0, 11);
            g.fill();
            mkLabel(row, 'mark', t.name.slice(0, 1), 12, new Color(92, 60, 24, 255), 22, 16)
                .node.setPosition(icoX, 0, 0);
        }

        /* 横向分配（行宽 272）：
             图标 22 | 名字 72 | 奖励组 2×35 + 组间距 9 | 按钮 52
           名字 5 字在 14px 下是 70，容器 72 刚好贴满；SHRINK 兜底防止以后加长任务名。 */
        const btnW = 52, btnH = 26;
        const btnCx = half - 10 - btnW / 2;
        const nameX = -half + 10 + 22 + 8;
        const nameW = isReady ? 72 : 124;
        const nameLb = mkLeftLabel(row, 'name', t.name, 14, isDone ? INK_SOFT : INK,
            nameX, 0, nameW, 20);
        nameLb.overflow = Label.Overflow.SHRINK;

        if (phase === 'open') {
            mkRightLabel(row, 'prog', `${Math.min(t.cur(this.save), t.target)} / ${t.target}`,
                12, INK_SOFT, half - 12, 0, 52, 16);
        } else if (isDone) {
            /* 已领的行**不列奖励**，只留一个「已领」。
               奖励信息在领的那一刻就已经给过了，重复列出来只会和「已领」打架
               （上一版就是 "+2 已领+6" 叠在一起，右边完全读不出是几个字）。 */
        } else {
            /* 奖励组：**图标贴着数字左边**，一组 = 数字 20 + 间隙 3 + 图标 12。
               上一版把每个图标和数字分开定位、组间给了 52 宽，
               结果"+"和图标错开一截，看着像六七个散落的数字。 */
            const rc = isDone ? new Color(176, 156, 138, 255) : new Color(122, 146, 88, 255);
            const numW = 20, iconW = 12, gap = 3, groupGap = 9;
            const unit = numW + gap + iconW;
            let rx = isReady ? btnCx - btnW / 2 - 10 : half - 12;
            for (const r of [...t.rewardList].reverse()) {
                mkRightLabel(row, `n-${r.kind}`, `+${r.n}`, 11, rc, rx, 0, numW, 15);
                /* 没有图标就只留数字（不留空框 —— 空框比没有更像 bug） */
                this.mkIcon(row, `r-${r.kind}`, r.kind, iconW, rx - numW - gap - iconW / 2, 0);
                rx -= unit + groupGap;
            }
        }

        if (isReady) {
            this.mkPill(row, 'act', '领取', btnW, btnH, btnCx, 0, true, () => {
                /* 不关抽屉、不重开 —— 原地重画。领完的行会落进「已完成」里，
                   才符合"一次把能领的都领了"的实际行为 */
                this.act(claimTask(this.save, t.id), () => this.repaintDrawer());
            });
        } else if (isDone) {
            /* 右缘和上面各行的进度数字对齐（half-12），不是钉在按钮位置上 ——
               展开后整列右缘必须是一条线 */
            mkRightLabel(row, 'done', '已领', 12, new Color(170, 148, 128, 255), half - 12, 0, 40, 16);
        }

        return row;
    }

    /** 「已完成 N 件」折叠行。三角用 Graphics 画 —— `▾` 靠字体兜底，缺字形就是一格方块 */
    private mkDoneFold(parent: Node, cy: number, n: number, RW: number) {
        const half = RW / 2;
        const row = new Node('fold');
        row.parent = parent;
        row.addComponent(UITransform).setContentSize(RW, 34);
        row.setPosition(0, cy, 0);

        const g = row.addComponent(Graphics);
        g.fillColor = new Color(206, 186, 164, 80);
        g.rect(-half + 10, 15, RW - 20, 1);
        g.fill();
        /* 三角刻意比文字左缘再往左 6px：视觉重心靠左，玩家才会先读到"这是可点的" */
        g.fillColor = INK_SOFT;
        if (this.tasksDoneOpen) {
            g.moveTo(-half + 18, 2); g.lineTo(-half + 28, 2); g.lineTo(-half + 23, -4); g.close(); g.fill();
        } else {
            g.moveTo(-half + 19, 4); g.lineTo(-half + 19, -4); g.lineTo(-half + 25, 0); g.close(); g.fill();
        }

        /* 文字左缘和上面每行的任务名对齐（都是 -half+40）——
           不对齐的话折叠行看着像另一张表格 */
        mkLeftLabel(row, 'txt', `已完成 ${n} 件`, 12, INK_SOFT, -half + 40, 0, 140, 16);
        mkRightLabel(row, 'hint', this.tasksDoneOpen ? '收起' : '展开', 11,
            new Color(178, 150, 126, 255), half - 10, 0, 44, 16);

        this.press(row, 0.98);
        row.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            this.tasksDoneOpen = !this.tasksDoneOpen;
            this.repaintDrawer();
        });
    }

    /**
     * 原地重画抽屉。领取或展开会让内容变高变矮，**面板跟着变**。
     *
     * 关键是**顶边钉住**：高度变了之后只改底边，否则纸会"往上长"——
     * 玩家读作整张纸跳了一下。顶边的位置要先用旧高度反推出来。
     */
    private repaintDrawer() {
        const p = this.drawer?.getChildByName('panel');
        if (!p) return;
        const ut = p.getComponent(UITransform);
        const g = p.getComponent(Graphics);
        const DW = HomeController.DRAWER_W;
        const oldH = ut ? ut.contentSize.height : H - 100;
        const newH = clamp(this.taskLayout().height, 150, H - 100);
        const topEdge = p.position.y + oldH / 2;
        if (ut) ut.setContentSize(DW, newH);
        if (g) this.paintDrawerBg(g, DW, newH);
        p.setPosition(p.position.x, topEdge - newH / 2, 0);
        this.paintTaskBody(p, newH);
    }

    /** 把所有可领的一次领完 */
    private claimAllTasks() {
        let s = this.save;
        let n = 0;
        for (const t of TASKS) {
            if (taskPhase(s, t.id) !== 'ready') continue;
            const r = claimTask(s, t.id);
            if (r.ok && r.next) { s = r.next; n++; }
        }
        if (!n) { this.toast('没有可以领的'); return; }
        this.commit(s);
        this.repaintDrawer();
        this.toast(`${n} 件奖励都收下了`);
    }

    /**
     * 窄版药丸按钮。**不能复用 `mkBtn`** —— 那个是写死 520 宽的卡内主按钮，
     * 塞进 324 宽的抽屉行里会撑破。
     *
     * `active` 是分栏 tab 的选中态：选中用深棕底 + 米白字（反转），
     * 未选用杏黄底 + 深棕字。两个都用杏黄会读成"两个都能点，但不知道现在在哪个"。
     */
    private mkPill(
        parent: Node, name: string, text: string, w: number, h: number,
        x: number, y: number, enabled: boolean, onClick: () => void, active = false,
    ): Node {
        const btn = new Node(name);
        btn.parent = parent;
        btn.addComponent(UITransform).setContentSize(w, h);
        btn.setPosition(x, y, 0);
        const g = btn.addComponent(Graphics);
        const fill = !enabled ? new Color(206, 196, 184, 255)
            : active ? BTN_DEEP : BTN_FILL;
        g.fillColor = fill;
        g.roundRect(-w / 2, -h / 2, w, h, Math.min(17, h / 2));
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = enabled ? BTN_DEEP : new Color(176, 160, 144, 255);
        g.roundRect(-w / 2, -h / 2, w, h, Math.min(17, h / 2));
        g.stroke();
        const ink = active ? new Color(255, 250, 240, 255) : new Color(96, 58, 28, 255);
        const lb = mkLabel(btn, 'txt', text, h <= 30 ? 13 : 15,
            enabled ? ink : new Color(150, 140, 128, 255), w - 12, h - 6);
        lb.overflow = Label.Overflow.SHRINK;
        if (!enabled) return btn;
        this.press(btn, 0.95);
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            onClick();
        });
        return btn;
    }

    /**
     * 进入战斗。**没有门槛** —— 能量门禁已删（见 HomeBiz 文件头）。
     *
     * 出门现在只做两件事：进场景、把这一趟的账挂到存档上。
     * 节奏由饱食度管（每关 −16，饿了火力下降），不靠"等时间"。
     *
     * 用 tween 的 call 切场景，而不是 setTimeout：出发卡有 0.18s 淡出，
     * 立刻 loadScene 会把动画连同场景一起销毁（"闪一下"）。
     */
    private launchBattle() {
        this.closeDepart(() => {
            /* 为什么不用 director.loadScene('Battle')：
               本工程 settings 里没有 scenes 注册表（program.json / builder.json
               都只有版本号），Cocos 预览只把"当前场景 Home"打进包，
               loadScene 按名字解析不到 Battle → 报"找不到场景"。
               这里直接按场景资产 uuid 拉取并 runScene，绕过名字注册表，
               预览里一定能进。正式构建时仍建议把 Battle.scene 加进
               构建面板的 Scenes 列表（标准做法）。 */
            const BATTLE_UUID = 'b1a4d7e2-3c58-4f90-8a61-2e7b9c4d5f03';
            assetManager.loadAny(BATTLE_UUID, (err: Error | null, asset: unknown) => {
                /* `SceneAsset.scene` 的声明是 `Scene | null`（资源还没展开时是 null），
                   直接 runScene 会塞进去一个 null 场景，引擎那边只会给一句莫名其妙的报错。
                   所以先取出来判空，再交给回退分支处理。 */
                const sc = asset instanceof SceneAsset ? asset.scene : null;
                if (!err && sc) {
                    director.runScene(sc);
                    return;
                }
                console.warn('[HomeRuntime] 按 uuid 载入战斗失败，回退 loadScene：', err);
                director.loadScene('Battle', (e2) => {
                    if (e2) {
                        console.error('[HomeRuntime] 进入战斗失败：', e2);
                        this.toast('苔原没打开，再点一次');
                        return;
                    }
                });
            });
        });
    }
}

/* ==========================================================================
 * 自启动
 *
 * 不依赖场景里挂组件：脚本被 prerequisite-imports 全量 import 后，
 * 这里注册场景启动回调，见到 Home 场景就接管。
 * 三重兜底（场景启动事件 / 引擎初始化 / 首帧轮询），确保任意加载顺序都能接上。
 * ========================================================================== */

let ctrl: HomeController | null = null;
let bootedScene: Node | null = null;

function tryBoot() {
    const sc = director.getScene();
    if (!sc) return;

    /* 场景换了：先把上一任作废，再清标记。
       不清标记的话 `bootedScene === sc` 会一直不成立、或者一直成立 ——
       两种都会把"离开再回家"这条路堵死。 */
    if (bootedScene && bootedScene !== (sc as unknown as Node)) {
        if (ctrl) { ctrl.dispose(); ctrl = null; }
        bootedScene = null;
    }
    if (bootedScene === (sc as unknown as Node)) return;

    const canvas = sc.getChildByName('Canvas');
    if (!canvas) return;
    if (!canvas.getComponent(UITransform)) return;

    /* 不靠场景名认主界面 —— 认结构。主界面的结构特征是
       Canvas 下同时有 Badges / Dock / Pets 三层。
       名字会改，结构不会。 */
    if (!canvas.getChildByName('Badges') || !canvas.getChildByName('Dock')) return;

    bootedScene = sc as unknown as Node;
    ctrl = new HomeController(canvas);
    attachPostOverlay(canvas);
    console.log('[HomeRuntime] 已接管主界面：宠物待机 / 点击反馈 / 出发卡 全部就绪');
}

/* ==========================================================================
 * 镜头叠加层（暗角 + 颗粒）
 * ==========================================================================
 * 为什么主界面和战斗用了两套完全不同的做法：
 * 战斗是 canvas 2D 画的，后期可以在同一张画布上逐帧算（见 grove.html 的
 * drawPost）；主界面是 Cocos 的 Sprite 场景，没有后处理管线，为了实时算一层
 * 泛光得挂一整套自定义 pipeline —— 不值。
 *
 * 而暗角和颗粒恰好是**静态**的：它们不随画面内容变化。烤成一张 PNG
 * （生成脚本 tools/build-post-overlay.js），运行时只多一个 Sprite、一次混合。
 *
 * 它的收益不在"更好看"，在"更像被拍下来的"：
 * 主界面每个元素都做了柔光和暖色，唯独没有一处是"脏"的 ——
 * 四角和中心一样亮，每个像素一样干净。这两点本身就是"这是画出来的"的读数。
 */
function attachPostOverlay(canvas: Node): void {
    /* 路径必须带 /spriteFrame。Cocos 的图片在 resources 里是三层：
       ImageAsset → Texture2D → SpriteFrame。直接取 'ui/post-overlay'
       拿到的是 ImageAsset，赋给 Sprite.spriteFrame 在运行时静默失败 ——
       不报错、也不显示，最难查的一类。 */
    resources.load('ui/post-overlay/spriteFrame', SpriteFrame, (err: Error | null, sf: SpriteFrame) => {
        /* 图丢了就静默跳过。这一层是锦上添花 ——
           少一层暗角玩家不会觉得不对，主界面白屏他会。
           而且这里是异步回调：回来的时候场景可能已经切走了，
           所以必须再验一次 canvas.isValid。 */
        if (err || !sf || !canvas.isValid) return;
        if (canvas.getChildByName('__PostOverlay')) return;

        const n = new Node('__PostOverlay');
        n.parent = canvas;
        const ut = n.addComponent(UITransform);
        ut.setContentSize(W, H);
        const sp = n.addComponent(Sprite);
        sp.spriteFrame = sf;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.type = Sprite.Type.SIMPLE;
        n.setPosition(0, 0, 0);
        /* 排到当前最上层（它盖的是"整帧画面"），但**不抢占之后弹出的
           出发卡 / 图鉴** —— 那些是 UI 里的"纸"，不该被镜头暗角压暗。
           所以只排到最后一位，后建的弹窗自然还在它上面。 */
        n.setSiblingIndex(canvas.children.length - 1);
    });
}

/**
 * ⚠ 必须在编辑器里彻底不启动。
 *
 * Cocos 编辑器为了注册 ccclass，**也会 import 项目下所有脚本**（和运行时同一条
 * `prerequisite-imports`）。不加这道守卫，顶层的 tryBoot 就会在编辑器进程里跑，
 * 给场景动态添加热区节点；编辑器随后把内存里的场景写回磁盘 ——
 * 结果 Home.scene 里堆出了 15 个 `Badge-*-hot`，而且越开越多。
 *
 * 这个坑很隐蔽：文件层的验证器 17 项全过（那些节点结构本身是合法的），
 * 只有对比「场景里怎么会有运行时节点」才会发现。
 */
if (!EDITOR) {
    /* 场景要切走的那一刻就把控制器作废 —— 这是唯一能保证"旧节点还活着"的时机。
       AFTER_SCENE_LAUNCH 再处理已经晚了：旧场景的节点已经销毁，而 BEFORE_UPDATE
       是模块级监听、不会随场景消失，下一帧就会拿着已销毁节点的 position 去算 →
       "Cannot read properties of null (reading 'x')"。 */
    director.on(Director.EVENT_BEFORE_SCENE_LAUNCH, () => {
        if (ctrl) { ctrl.dispose(); ctrl = null; }
        bootedScene = null;
    });

    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, tryBoot);

    director.on(Director.EVENT_BEFORE_UPDATE, () => {
        if (!ctrl) tryBoot();
        if (ctrl) ctrl.tick();
    });

    tryBoot();
}
