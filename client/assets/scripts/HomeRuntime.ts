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
import {
    STAR_TYPES, STAR_OF_STAGE, starBitsOf, stageStarFull, chapterStarFull,
    STAR_FULL_SHARDS, STAR_FULL_LOGS, STAR_CHAPTER_SHARDS, STAR_CHAPTER_LOGS,
} from './config/StarTargets';
import { loadSave, saveSave, loadBattleStats } from './config/SaveData';
import type { SaveState } from './config/SaveData';
import { SATIETY } from './config/BattleConfig';
import {
    MEALS, RECIPES, PERKS, PET_LINE, DISPATCH_SEC, DISPATCH_CAP, DISPATCH_SHARD,
    feed, craft, recordPat, setActive, startDispatch, collectDispatch, peekDispatch,
    buyPerk, perkOwned,
    toggleMute, toggleCrisp, heartText, heartsOf, canDispatch, yieldText,
    TRIP_GOALS, TRIP_PICK, tripGoal, rollTripGoals, judgeTripGoals, tripReward,
    STORY, storyNow, storyDone, settleStory, rewardText, sumReward,
    dailyRows, claimDaily, rollDailyIfNeeded, dailyDoneCount,
    DAILY_N, DAILY_CHESTS, claimChest,
    starsOf, STAR_MAX, rankBoard, myRank, rankFloor, RANK_SIZE,
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
/* 2026-10-25：只剩一个空壳。原来这里是"行 / 折叠组"两种，
   对应 6 条任务的分组渲染；换成本趟目标之后内容固定，
   `taskLayout()` 只返回一个写死的高度，不再需要这一套。 */
type TaskItem = never;

const BADGE_INFO: Record<string, string> = {
    // 「工坊」= 原工作台 + 灶台，已经是真面板（openHome），这里只为兜底
    '工作台': '家 · 喂饭与制作都在这里',
    // 图鉴已经是真面板了（openCodex），这里留着只为兜底 —— 它不会再被读到
    '图鉴': '图鉴 · 查看已收服的宠物',
    '灶台': '排行榜 · 本机通关榜',
    '派遣': '派遣 · 让宠物出门带资源回来（待实装）',
    '去苔原': '苔原 · 下一关的入口（已由底部「出门」承担）',
};

/* 锁定槽位"还差几关"的判定已改到 `Roster.petGap()` —— 那张写死的表
   会和花名册漂移（改一次解锁节奏要记得改两处），所以删掉，只留一处真值。 */

/* ==========================================================================
 * 工具
 * ========================================================================== */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** 「第一章」。图鉴星靶页的章标签和章集满条共用 —— 一处写死三处必然漂移 */
const chapterOrd = (ch: number) => `第${['一', '二', '三', '四', '五'][ch] || ch + 1}章`;
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
    /** 图鉴面板当前停在哪一页。`pet` = 宠物，`star` = 星靶（81 格） */
    private codexTab: 'pet' | 'star' = 'pet';
    /** 星靶页选中的屏（0 基）。-1 = 没选中，详情区显示引导句 */
    private starPick = -1;

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
     * 派遣板上那颗「有东西可收」的红点。
     *
     * 用户原话：「派遣这个功能 不知道咋玩 应该有挂机属性啊」——
     * 挂机属性的第一块不是倒计时，是**回来之后看得见**。
     * 院子里没有任何提示时，"60 秒一趟"对玩家等于不存在：
     * 他不会记得回来点，派出去的那只就永远在路上。
     */
    private dispatchDot: Node | null = null;

    /**
     * 派遣面板里**每帧都要变**的那几样：进度条 / 「第 N/10 趟 · X 秒」/ 收成明细。
     *
     * 没有这个的话，"60 秒一趟"只是一句写在副标题里的说明文字 ——
     * 打开面板盯一小时，画面一个像素都不会变，玩家无法确认"是不是真的在攒"。
     * 关面板（`closeSheet`）必须置空，否则 tick 会去摸已销毁的节点。
     */
    private dispatchLive: {
        petId: string;
        bar: Graphics | null;
        head: Label | null;
        meta: Label | null;
        act: Label | null;
    } | null = null;

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
        /* 宠物格在 page-pet 底下，不在 card 底下 —— 星靶页开来时
           整页宠物节点都不 active，遍历不到也无妨（heads 只补宠物页的脸）。 */
        const page = card.getChildByName('page-pet');
        if (!page) return;
        for (const p of PETS) {
            const cell = page.getChildByName(`cell-${p.id}`);
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
     * 底部那排宠物格 —— **2026-10-25 全部收掉**。
     *
     * 用户原话：「下面的出征 不能单独汇总 一个宠物 ICON 吗」。
     * 收之前的状态是**同一件事说了两遍**：
     *   · 底部 5 格 `Slot-年糕…星屑`，每格一张压暗的头像（tint 126,112,98 + 父节点
     *     UIOpacity 140）+ 一把锁 + 一个药丸写着「差2关 / 差5关 / 差14关 / 差18关」；
     *   · 右边 `GoCard` 已经在说「这趟带谁」。
     * 两处都不是"出征"：底部在说解锁进度，而解锁进度属于图鉴。
     * 玩家扫一眼底栏得到的信息是"还有四只没解锁"，不是"我要带谁出门"。
     *
     * 现在：底栏只留三个资源 + 一张出征卡。**出征 = 一个入口 = 一张脸。**
     * 想换人点那张脸 → `openRoster()`（这次新加的选人面板，六只一行）。
     *
     * 为什么不是"删掉节点"而是 `active = false`：
     * 场景是手工搭的，删节点要改 `Home.scene`（沙箱没有编辑器 GUI）。
     * 隐藏是纯运行时代码，可逆、可测，而且 `_measure-*.js` 这类工具还能继续量到它。
     * 等哪天真的扩了编辑器节点，把这段连同节点一起删即可。
     */
    private refreshSlots() {
        const root = this.canvas.getChildByName('Dock');
        if (!root) return;
        for (const n of root.children) {
            if (n.name.startsWith('Slot-')) n.active = false;
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
           灶台在左侧偏下、离宠物群太近，牌子和宠物会挤。
           ★ 2026-10-25：「灶台」复活成**排行榜**（用户：「排行榜不应该是单独的
           ICON 吗 现在谁知道排行榜在哪」）。它原本被这张表排除、`active=false`
           藏掉了 —— 所以必须加回 keep，否则 bindBadges 里 `if (!n.active) continue`
           会跳过它，改多少映射都点不到。位置 (-35,53) 在主界面上方正中，
           比藏在 HUD 进度点里显眼得多。 */
        const keep = new Set(['图鉴', '工作台', '派遣', '灶台']);
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

        /* 「排行榜」沿用灶台那块牌子。
           底板收到 40 宽、位置按徽标实际宽度重摆 —— 和图鉴 / 派遣 / 工坊同一套
           数字，一排看过去才是齐的。⚠ 不重摆位置的话，36 宽的旧底板配 40 的新字，
           牌子会偏右 2px，四块牌子肉眼可辨地不齐。 */
        const rcap = badges.getChildByName('Cap-灶台');
        const rbd = badges.getChildByName('Badge-灶台');
        const rbt = rbd?.getComponent(UITransform);
        const rcut = rcap?.getComponent(UITransform);
        if (rcap && rcut && rbd && rbt) {
            const lbl = rcap.getChildByName('txt')?.getComponent(Label);
            if (lbl) lbl.string = '排行榜';
            rcut.setContentSize(40, rcut.contentSize.height);
            rcap.setPosition(rbd.position.x + (rbt.contentSize.width - 40) / 2, rcap.position.y, 0);
            this.fitCapText(rcap, 40);
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
        this.toneBadges();
        /* 工坊 → 锅（pot）。图是异步来的，这里先试一次，没图就保留原来的锤子。 */
        this.swapBadgeIcon('Badge-工作台', 'pot');
        /* 排行榜 → 旗子（flag）。同一套降级逻辑：没图就留场景里那张，
           不能画个空方块等它。 */
        this.swapBadgeIcon('Badge-灶台', 'flag');
    }

    /** 给某颗徽标的 `ico` 子节点换图。抽出来是因为现在有两颗要换 */
    private swapBadgeIcon(badge: string, key: string) {
        const sf = this.icons[key];
        if (!sf) return;
        const ico = this.canvas.getChildByName('Badges')
            ?.getChildByName(badge)?.getChildByName('ico');
        const sp = ico?.getComponent(Sprite);
        if (!sp || sp.spriteFrame === sf) return;
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = sf;
    }

    /**
     * 五个入口徽章的"白卡"收敛。
     *
     * 病理（2026-10-25，用户：「现在 UI 上都没正确显示宠物 ICON，比如工坊的 icon」）：
     *   截图 `_t-crop-ico.png` 放大后看得很清楚 ——
     *   `Badge-*` 是**场景里 48×48 的纯白圆角 Sprite**（`_contentSize 48,48`），
     *   中间再叠一个 30×30 的棕色图标。它压在水彩木头和草地上，
     *   读起来是"贴了一张纯白矢量的方块"，不是"木牌旁边钉了一枚徽章"。
     *   五个入口里它最抢眼，因为它最大、最白、最不透明，而且旁边就是
     *   手绘风的木牌和锤子 —— 一块 48px 的纯白就是那块"糊掉的白"。
     *
     * 为什么不换图：`ui/` 图集里没有暖色圆底，硬换要重新出图，
     * 而这是"白得过了"而不是"图形错了"。**先改数值，能解决九成。**
     *
     *   48 → 38（面积降 37%，从"卡片"回到"徽章"）
     *   纯白 (255,255,255) → 暖白 (255,250,240)，和场景米白同族
     *   alpha 255 → 235，边缘和水彩融一点
     *   内层图标 30 → 26（图标/底 = 0.68，原来 0.63，松快一点）
     */
    private toneBadges() {
        const badges = this.canvas.getChildByName('Badges');
        if (!badges) return;
        for (const n of badges.children) {
            if (!n.name.startsWith('Badge-')) continue;
            const ut = n.getComponent(UITransform);
            if (ut) ut.setContentSize(38, 38);
            const sp = n.getComponent(Sprite);
            if (sp) {
                sp.sizeMode = Sprite.SizeMode.CUSTOM;
                sp.color = new Color(255, 250, 240, 235);
            }
            const ico = n.getChildByName('ico');
            if (!ico) continue;
            const iut = ico.getComponent(UITransform);
            if (iut) iut.setContentSize(26, 26);
            const isp = ico.getComponent(Sprite);
            if (isp) isp.sizeMode = Sprite.SizeMode.CUSTOM;
        }
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
        /* ★ 主线结算 + 跨天重抽（2026-10-25）。
         *
         * 放在 `bindSave` 是因为它有两个特性正好合用：
         *   · 启动时会跑一次（重开游戏也能补发上次没领的主线）
         *   · 每次 `commit` 后也会跑（打完一屏回来立刻结算）
         *
         * **循环会一次过完多条**：玩家可能一口气通过 9 屏，
         * 第 6/7/8 条主线同时满足，只结算一条的话他得回三次家。
         *
         * 这里直接改 `this.save` 并落盘，**不调 `commit`** ——
         * `commit` 会再调 `bindSave`，那就是递归。 */
        {
            const d = rollDailyIfNeeded(this.save);
            if (d.changed) { this.save = d.next; saveSave(d.next); }
            const st = settleStory(this.save);
            if (st.gained.length) {
                this.save = st.next;
                saveSave(st.next);
                /* 连跳好几条时报**总账**，不报名字。
                   新手第一天很可能一次满足 3~4 条（出门/喂饭/摸头/制作），
                   报 4 个名字的 toast 会横穿整个屏幕，而且玩家记不住。 */
                this.toast(st.gained.length === 1
                    ? `主线完成 · ${st.gained[0].name} · ${rewardText(st.gained[0].reward)}`
                    : `主线完成 ${st.gained.length} 条 · ${rewardText(sumReward(st.gained))}`);
            }
        }
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
                /* ★ 2026-10-25：「灶台」这颗徽标复活成**排行榜**。
                   用户原话：「排行榜不应该是单独的 ICON 吗 现在谁知道排行榜在哪」。
                   上一版把榜藏在 HUD 那排进度点里，确实没人找得到。
                   灶台本身是死节点（喂饭并入工坊后零引用），位置 (-35,53) 在
                   主界面上方正中，比进度点显眼得多 —— 复用而不是 new 节点，
                   因为沙箱没有编辑器 GUI，改不了场景。
                   ⚠ 连带三处必须一起改，只改这里会得到「点了没反应」：
                   `BADGE_INFO` 文案 / `layoutRail` 里 Cap 文字 / ico 图标。 */
                : key === '灶台' ? () => this.openRank()
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

        /* —— 宠物卡：**这是唯一一个"带谁出门"的入口** ——
         *
         * 2026-10-25 之前这里只弹一句 toast（`goCardText()`，内容是"尖耳猫 · 溜溜球 ·
         * 亲密度 2/5"）。问题是：**看得见却不能改**。玩家想知道"能不能换一只"
         * 只能去点底栏那五格"差N关"，而那一排压根不是入口（现在是隐藏的）。
         * 改成点开选人面板：看到的和能改的是同一个地方。
         */
        const card = root.getChildByName('GoCard');
        if (card) {
            this.press(card, 0.97, 0.012, 1.6);
            card.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                this.openRoster();
            });
        }

        /* 底栏的六格已经隐藏（见 `refreshSlots`），这里不再绑点击 ——
           绑了也收不到触摸，却会在隐藏节点上多挂一层热区组件，
           下次 `stripStaleHots` 清理时容易和真正的热区混在一起。
           换人改走 `openRoster()`（点出征卡那张脸）。 */
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
            /* ★ 2026-10-25 撤回：这里一度点开过一个「战绩面板」，
               被用户一句话否掉 ——「这个排行榜我看不懂，你能看懂吗，没有游戏这么设计的吧」。
               他说得对：那块面板是**四个数字 + 27 个色格 + 三项纪录**，
               玩家要想知道自己"打得怎么样"，得先读三个数字再心算
               —— 那是数据看板，不是游戏界面。

               现在只留一句人能读懂的话。位置感本来就已经在两处给了：
                 · HUD 每颗进度点下面那条 11×3 色条（S/A/B 一眼看出）
                 · 「挑一屏」面板里每格的字母评级
               两处都比一块报表直观，所以不再另起一个页面。 */
            /* 点进度点 → 排行榜。语义正好对上：那排点回答"我走到哪"，
               排行榜回答"我比别人走到哪"。 */
            this.makeHot(hud, 'HudProgress-hot', 560, HOT_MIN, () => this.openRank(), 0.985);
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
        this.dispatchDot = null;
        this.dispatchLive = null;
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
        this.tickDispatchLive();

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

    /**
     * 派遣的「挂机感」由 tick 里这两件事撑起来：
     *   ① 院子里的红点 —— **不在主界面喊，玩家永远想不起去收**。
     *      挂机游戏的收益必须"可见地等在门口"，而不是藏在三级面板里；
     *   ② 面板里的倒计时（见 `tickDispatchLive`）—— 打开后数字真的在走。
     *
     * 顺带修一处文案：原来喊的是「带东西回来了」，可那只明明还在外面，
     * 玩家会去院子里找一只并不存在的宠物。改成「攒了 N 趟东西」。
     */
    private pingDispatch() {
        const job = this.save.dispatch;
        if (!job) {
            this.setDispatchDot(false);
            return;
        }
        const peek = peekDispatch(this.save, Date.now());
        this.setDispatchDot(peek.hauls > 0);
        if (this.dispatchPing || this.sheet) return;
        if (peek.hauls < 1) return;
        this.dispatchPing = true;
        const name = PETS.find((p) => p.id === job.id);
        this.toast(`${name ? name.name : '它'} 攒了 ${peek.hauls} 趟东西 · 去派遣板收下`);
    }

    private setDispatchDot(on: boolean) {
        const d = this.dispatchDot;
        if (d && d.isValid && d.active !== on) d.active = on;
    }

    /**
     * 派遣面板的实时刷新：进度条 + 「第 N/10 趟 · X 秒」+ 收成明细。
     *
     * 只在面板开着且派的是同一只时跑。`hauls` 从 0 跳到 1 的那一刻
     * **整块面板重画一次** —— 因为「收回」按钮要从不可点变成可点，
     * 那是挂点击的，改文字改不动。
     */
    private tickDispatchLive() {
        const ui = this.dispatchLive;
        if (!ui) return;
        if (!this.sheet) { this.dispatchLive = null; return; }
        const job = this.save.dispatch;
        if (!job || job.id !== ui.petId) { this.dispatchLive = null; return; }

        const peek = peekDispatch(this.save, Date.now());
        if (ui.bar && ui.bar.isValid) {
            const g = ui.bar;
            g.clear();
            /* 一趟的进度：0 → 60s 走满一格，满 10 趟之后停在满格 */
            const cyc = peek.hauls >= DISPATCH_CAP
                ? 1
                : Math.max(0, Math.min(1, 1 - peek.left / DISPATCH_SEC));
            const BW = 480;
            g.fillColor = new Color(232, 220, 198, 255);
            g.roundRect(-BW / 2, -4.5, BW, 9, 4.5);
            g.fill();
            if (cyc > 0.001) {
                g.fillColor = new Color(232, 149, 26, 255);
                g.roundRect(-BW / 2, -4.5, Math.max(9, BW * cyc), 9, 4.5);
                g.fill();
                /* 亮面：纯色条在暖底上发"闷"，加一条 45% 高的浅色才读作进度 */
                g.fillColor = new Color(255, 226, 168, 190);
                g.roundRect(-BW / 2, 0.5, Math.max(9, BW * cyc), 3.5, 1.75);
                g.fill();
            }
        }
        if (ui.head && ui.head.isValid) {
            ui.head.string = peek.hauls >= DISPATCH_CAP
                ? `第 ${DISPATCH_CAP} / ${DISPATCH_CAP} 趟 · 攒满了，收回`
                : `第 ${peek.hauls} / ${DISPATCH_CAP} 趟 · ${peek.left} 秒后下一趟`;
        }
        if (ui.meta && ui.meta.isValid) {
            ui.meta.string = peek.hauls > 0
                ? `${peek.hauls} 趟 · ${[
                    peek.shards ? `图纸碎片 ${peek.shards}` : '',
                    peek.ration ? `干粮 ${peek.ration}` : '',
                    peek.apples ? `果子 ${peek.apples}` : '',
                    peek.logs ? `材料 ${peek.logs}` : '',
                    peek.coins ? `吧唧 ${peek.coins}` : '',
                ].filter(Boolean).join(' · ')}`
                : `${peek.left} 秒后才有第一趟`;
        }
        if (ui.act && ui.act.isValid) {
            ui.act.string = peek.hauls > 0 ? '收回' : '等着';
        }
    }

    private closeSheet() {
        /* 派遣面板的实时倒计时跟着面板一起死。不清的话 tick 会每帧去摸
           已 destroy 的 Label —— 而且 `dispatchLive.petId` 还指向上一只，
           下次开面板会先闪一秒旧数字。 */
        this.dispatchLive = null;
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
    ): Node {
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

        /* 返回行节点：调用方可能要拿它的子 Label 做实时刷新
           （派遣面板的倒计时就是这么接的）。灰行也返回 ——
           调用方不该因为"这一行点不了"就找不到它。 */
        if (!enabled) return row;
        this.press(row, 0.98);
        row.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            onClick();
        });
        return row;
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
    /**
     * 工坊的三个分栏。
     *
     * **`perk`（改造）是第三栏，不是第二个按钮**：改造件是全游戏唯一的
     * 永久成长出口，把它和"做一份干粮"并排成两行清单，玩家会读成
     * "又一个消耗品"。独立一栏 + 独立文案（`已装` / 装上）才立得住。
     */
    private homeTab: 'feed' | 'craft' | 'perk' = 'feed';

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
            `果子 ${s.apples} · 材料 ${s.logs} · 吧唧 ${s.coins} · 碎片 ${s.shards || 0} · 干粮 ${s.bag.ration}`,
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
                const TABS: Array<{ k: 'feed' | 'craft' | 'perk'; t: string }> = [
                    { k: 'feed', t: '喂饭' },
                    { k: 'craft', t: '制作' },
                    { k: 'perk', t: '改造' },
                ];
                /* ★ 三个 tab 的位置是**按内容区反推的**，不是按 tab 自己排的
                   （用户 2026-10-25 截图 3：「工坊的 UI 也没对齐啊」）。
                   右栏 item card 中心 110、宽 400 → 占 -90..290。
                   上一版 tab 中心 -70/70/210、宽 128 → 占 -134..274：
                     · 右边界差 16px（274 vs 290）
                     · 组中心 70 vs 内容中心 110，**整体偏左 40px**
                   两者叠加就是「tab 和下面的卡片对不齐」。
                   现在 124 宽 + 8 间距：三颗总宽 388，中心对齐 110
                     → tab0 中心 -22，tab1 102，tab2 226，右边界 288 ≈ 290。
                   124 是能用的最小宽度（「改造」两字 15px=30px，容器 112 仍有大量余量），
                   再窄字就会开始挤。 */
                TABS.forEach((tab, i) => {
                    const on = this.homeTab === tab.k;
                    this.mkPill(card, `tab-${tab.k}`, tab.t, 124, 40, -22 + i * 132, 112, true, () => {
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
                } else if (this.homeTab === 'perk') {
                    /* ---------- 改造栏：全游戏唯一的永久成长 ----------
                       为什么单独一栏、为什么文案是"已装"而不是"×N"：
                       这一栏的每一行都是一次**不可逆的永久选择**，
                       和"再做一份干粮"不是同一类东西，不能长得一样。
                       价格 180 果 + 4 材料来自实测（见 `HomeBiz.PERKS` 注释），
                       一趟走满 5 屏才够买一个，一趟买不到第二个。 */
                    PERKS.forEach((pk, i) => {
                        const owned = perkOwned(s, pk.id);
                        const myShards = s.shards || 0;
                        const lack = s.apples < pk.apples || s.logs < pk.logs || myShards < pk.shards;
                        /* 代价一行**只写数字，不写单位汉字**：
                           `180 果 · 4 材 · 2 图` 比 `果子 180 + 材料 4 + 图纸 2` 短一半，
                           而右边那句效果只有 120px 可用。
                           货不够时改写成"还差 X"，并且**按最先缺的那样报** ——
                           三种都不够时只说果子，玩家修好果子再来还是买不到，会骂人。
                           所以顺序是：碎片 > 材料 > 果子（碎片最难拿，先说它最有信息量）。 */
                        const cost = owned ? '已装'
                            : myShards < pk.shards
                                ? `还差 ${pk.shards - myShards} 碎片`
                                : s.logs < pk.logs
                                    ? `还差 ${pk.logs - s.logs} 材`
                                    : s.apples < pk.apples
                                        ? `还差 ${pk.apples - s.apples} 果`
                                        : `${pk.apples} 果 · ${pk.logs} 材 · ${pk.shards} 图`;
                        /* 效果文案压到 10 个中文字以内（12px × 10 = 120px，
                           gainW 150 放得下）。完整说明在 PERKS.desc 里，
                           那一份给文档和后续详情页用。 */
                        const SHORT: Record<string, string> = {
                            hotpit: '火坑每只 2→3 分',
                            wideball: '球额度 +1',
                            thrift: '掉饱 20→15',
                            bounty: '清场奖励 3→28',
                        };
                        /* 图标传 `mail`（图纸 / 信封）而不是 ''：
                           传空串时 `mkItemCard` 会画一个灰圆占位 —— 四张卡左边
                           四个一模一样的灰圆，读作"图没加载出来"，不是"这是改造件"。
                           图纸碎片是本栏的代价，用同一张图建立"碎片 → 改造"的联想。 */
                        this.mkItemCard(card, pk.id, 'mail', pk.name, cost, SHORT[pk.id] ?? pk.desc,
                            110, 48 - i * 78, !owned && !lack, owned ? '已装' : '装上', () => {
                                this.act(buyPerk(this.save, pk.id), () => this.openHome());
                            }, true);
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
        /** 紧凑行。改造栏一次要排 4 行，标准 92px 高排到第 4 行会顶穿面板底沿
         *（520 高的面板，上下各 260，四张 92 卡 + 间距 = 356，最后一张底边 -270）。
         *  84px 只压高度，不压字号 —— 字号是给"缩到一半也要认得出"定的。 */
        dense = false,
    ) {
        /* ★ 紧凑版的高度是**算出来的**，不是凑的：
             标题 18px @ y=20  → 占  8..32
             代价 12px @ y=-2  → 占 -10..6
             收益 12px @ y=-24 → 占 -34..-18
           需要 -34..32，加上下边距 → **76**。
           为什么不能再高：面板 520，tab 底在 92，所以第一张卡中心最高 44；
           往下到面板底 -260，可用 304px。四张卡要 `4H + 3×gap`：
             H=92 → 368 + gap，装不下（差 60）
             H=84 → 336 + gap，还是差
             H=76 → 304 + 3×4，**刚好**
           间距 78 > 76 才不重叠；起点 48 是 tab 底（92）减半卡高（38）再留 6px。
           改高度前先算这一步，别直接调数字。 */
        const W0 = 400, H0 = dense ? 76 : 92;
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
        /* ★ 布局有两种，选哪种不是审美问题，是**宽度算出来的**。
         *
         * 标准版（喂饭 / 制作）：代价和收益**同一行**，代价左对齐、收益右对齐。
         *   - 代价 从 -124 起，宽 170 → 右界 46
         *   - 收益 右缘 94，宽 130 → 左界 -36
         *   46 > -36，**本来就该重叠**。它没重叠的唯一原因是
         *   代价文案只有「果子 10 + 材料 2」那么短（实际 ~83px，到 -41）。
         *
         * 紧凑版（改造栏）：代价「180 果 · 4 材」+ 一句效果，同宽塞不下。
         *   实测（`--text`）：`hotpit/cost × hotpit/gain 28×17px`，
         *   四行全红，净间隙 < 4px 还有 7 处。所以改成**三行左对齐**：
         *   标题 24 / 代价 -2 / 收益 -28，各 26px 行距，宽度统一 200
         *   （-124 → 76，按钮起于 106，留 30px）。
         *   左对齐而不是右对齐：三行都以同一个 x 起，长短不齐也不会互相顶。
         *   （MEMORY 里「两个 Label 都放宽到同宽 = 矩形必然互压」是同一条规律，
         *    这里靠**换行**而不是靠调宽度解决 —— 调宽度只是在挪那条边界。） */
        if (dense) {
            mkLeftLabel(card, 'nm', title, 18, enabled ? INK : INK_SOFT, tx, 20, 200, 24);
            mkLeftLabel(card, 'cost', cost, 12, enabled ? INK_SOFT : new Color(190, 120, 110, 255), tx, -2, 200, 17);
            mkLeftLabel(card, 'gain', gain, 12, new Color(122, 146, 88, 255), tx, -24, 200, 17);
        } else {
            mkLeftLabel(card, 'nm', title, 18, enabled ? INK : INK_SOFT, tx, 20, 140, 24);
            mkLeftLabel(card, 'cost', cost, 12, enabled ? INK_SOFT : new Color(190, 120, 110, 255), tx, -16, 170, 17);
            mkRightLabel(card, 'gain', gain, 12, new Color(122, 146, 88, 255), btnCx - bw / 2 - 12, -16, 130, 17);
        }

        this.mkPill(card, 'act', action, bw, bh, W0 / 2 - 10 - bw / 2, 0, enabled, onClick);
    }

    /**
     * 从院子里那只宠物身上取立绘 —— 同步、零加载，且和玩家刚看到的是同一张图。
     *
     * ★ 2026-10-25 修：**这里原来是"取不到图"的根因。**
     *   `this.pets[].name` 存的是 `slot.name`，也就是**节点名**（砂糖 / 年糕 / 团子…），
     *   而调用方传进来的是 `who.name`，也就是**显示名**（尖耳猫 / 短尾犬…）。
     *   `p.name !== name` 永远成立 → 每一只都跳过 → 返回 null →
     *   工坊左边永远画一个空圆圈（`else` 分支的占位圆）。
     *   用户的原话是「现在 UI 上都没正确显示宠物 ICON，比如工坊的 icon」。
     *
     *   修法不是"再多写一份名字表"，而是**统一走 `petByNode`**：
     *   节点名 → `PetDef` → 显示名，全项目只有这一处映射（和 `refreshSlots`
     *   用的是同一个函数），改解锁节奏或改名都不会漏。
     */
    private petFrame(name: string): SpriteFrame | null {
        for (const p of this.pets) {
            if (!p.node || !p.node.isValid) continue;
            const def = petByNode(p.node.name);
            const shown = def ? def.name : p.name;
            if (shown !== name) continue;
            const sp = p.node.getComponent(Sprite);
            if (sp && sp.spriteFrame) return sp.spriteFrame;
        }
        /* 院子里那只正在派遣 / 还没站起来时，退回 96 的头像 ——
           宁可给一张小图，也不要给一个空圆（空圆读作"加载失败"）。 */
        const d = PETS.find((x) => x.name === name);
        if (d) return this.heads[d.short] ?? null;
        return null;
    }

    /**
     * 选人面板 —— 「这趟带谁出门」。
     *
     * **为什么需要它**：2026-10-25 把底栏那五格 `Slot-*` 收掉之后，
     * 「带谁」这件事就只剩一张 `GoCard`。看得见、但当时点不动（只弹 toast）。
     * 一个"能看到却不能改"的卡片，比一排看不清的小格子更容易让人以为卡了。
     *
     * 设计要点：
     *   · **六只全列出来，包括没到家的** —— 玩家需要知道"再打几关就多一个选择"，
     *     这比在主界面底栏挂五个「差N关」有意义得多（那里是装饰，这里是菜单）。
     *   · 每行左边是**头像**（`mkRow` 的 `headShort`），不是汉字首字。
     *   · 状态四种：还没回家 / 在外面采集 / 这趟就是它 / 可以换上。
     *     四种必须用**不同的词**，不能有三种都写"不可选" —— 后者玩家不知道差在哪。
     *   · 底线没变：**一宠出征**。换的是"哪一只"，不是"几只"。
     */
    private openRoster() {
        const s = this.save;
        const home = unlockedPets(s.cleared).length;
        this.openSheet(
            '带谁出门',
            `家里 ${home} 位 · 一次只带一只 · 剩下的看家`,
            (card) => {
                PETS.forEach((p, i) => {
                    const need = petGap(s.cleared, p.id);
                    const owned = need <= 0;
                    const on = p.id === s.active;
                    const out = !!(s.dispatch && s.dispatch.id === p.id);
                    const meta = !owned
                        ? `还差 ${need} 关回家`
                        : out
                            ? `在外面采集 · ${DISPATCH_SEC} 秒一趟`
                            : `招式「${p.tag}」· ${heartText(s.pats[p.id] || 0)}`;
                    const action = !owned ? '没到家' : on ? '这趟带它' : out ? '在外面' : '换上';
                    const ok = owned && !on && !out;
                    this.mkRow(
                        card, 'r-' + p.id, p.name, meta, action,
                        0, 104 - i * 58,
                        () => {
                            const r = setActive(this.save, p.id);
                            this.toast(r.say);
                            if (!r.ok) return;
                            /* commit 会给草地上那只一个弹跳回执 ——
                               否则玩家只看到面板数字变了，怀疑是不是真换了 */
                            this.commit(r.next);
                            const lawn = this.pets.find((x) => petByNode(x.node.name)?.id === p.id);
                            if (lawn) lawn.pop = 0.5;
                        },
                        ok, 58, p.short,
                    );
                });
            },
            640, 520,
        );
    }


    /**
     * 派遣面板（2026-10-25 重做：补上「挂机属性」）。
     *
     * 用户原话：「派遣这个功能 不知道咋玩 应该有挂机属性啊
     *            派出去多久 获得奖励 不应该这样吗」
     *
     * 改造前那一版已经把"攒了几趟 / 还差几秒 / 产出明细"写进了行里，
     * 但**它是静态的**：打开面板盯一分钟，画面一个像素都不变。
     * 玩家无法确认"是不是真的在攒"，于是"60 秒一趟"退化成一句说明文字。
     *
     * 这一版补三样，把派遣从"一个按钮"变成"一个看得见在走的挂机点"：
     *
     *   ① **顶部状态卡**：头像 + 「第 N/10 趟 · X 秒后下一趟」+ **进度条**
     *      （一趟 60s 走满一格）。每帧刷新（`tickDispatchLive`）。
     *   ② **院子里那颗红点**：攒满 ≥1 趟就亮（`pingDispatch`）。
     *      **不在主界面喊，玩家永远想不起去收** —— 挂机收益必须可见地等在门口。
     *   ③ **离线也在攒**：`dispatch.since` 是墙上时钟，关掉游戏再开，
     *      流失的真实时间照算（封顶 10 趟）。副标题必须把这句写出来，
     *      否则玩家根本不知道可以关掉游戏去睡觉。
     *
     * 同时修一个自查出来的硬伤：**第 5 只宠物的行和底部「点空白处关闭」
     *   重叠 376×21px**（`--audit` 报的 `sugar-stand × tip`）。
     *   根因是面板写死 460 高，而宠物数从 1 到 6 都会开这个面板。
     *   修法不是把 tip 挪开（那是把症状挪到第 6 只身上），而是
     *   **面板高度跟着条数算**：`ch = (job?277:223) + (n-1)*pitch`。
     *
     * 这里不出"多宠并行"：存档里 `dispatch` 是单只（`{id, since}`），
     * 改成数组要迁移存档，而"一次一只"本身也是这套养成的节奏
     * （一宠出征、六宠看家 —— 出去的永远只有一只）。
     */
    private openDispatch() {
        const s = this.save;
        const job = s.dispatch;

        const owned = unlockedPets(s.cleared);
        /* 出门在外的排最前 —— 玩家点进这个面板十次有九次是来收东西的。 */
        const list = owned.slice().sort((a, b) => {
            const ra = job && job.id === a.id ? 0 : a.id === s.active ? 2 : 1;
            const rb = job && job.id === b.id ? 0 : b.id === s.active ? 2 : 1;
            return ra - rb;
        });

        /* 面板高度跟着条数走（见上面 ③ 的算式依据）。
           5 只以上收紧行距：640 宽的面板在 720 高的屏上，再宽就顶到边了。
           ⚠ 行距下限 = 行高 + 2（56 + 2 = 58）。写成 54 时相邻两行
           真的互叠 2px（`--audit` 报 `nian-gao-dog × tuan-zi-ham 526×2`）。 */
        const n = Math.max(1, list.length);
        const pitch = n >= 5 ? 58 : 60;
        const ch = Math.max(340, Math.round((job ? 277 : 223) + (n - 1) * pitch));

        this.openSheet(
            '派遣',
            /* 副标题只放**规则**，不放状态 —— 状态在顶部状态卡里，而且是活的。
               原来这里拼了半行"攒了 3 趟 · 还能再攒 7 趟"，和状态卡重复，
               而且它是死的，两处数字会对不上。 */
            `一趟 ${DISPATCH_SEC} 秒 · 最多攒 ${DISPATCH_CAP} 趟 · 关掉游戏也在攒`,
            (card) => {
                const top = ch / 2 - 114;

                /* ---------------- 顶部状态卡（只有派出着才画） ---------------- */
                if (job) {
                    const who = petById(job.id);
                    const sc = new Node('away');
                    sc.parent = card;
                    const sut = sc.addComponent(UITransform);
                    sut.setContentSize(560, 46);
                    sut.setAnchorPoint(0.5, 0.5);
                    sc.setPosition(0, top - 23, 0);
                    const sg = sc.addComponent(Graphics);
                    /* 底色比行更暖：这是"这一趟正在进行中"的那一块，
                       要和下面那些"待命"的行分开。 */
                    sg.fillColor = new Color(252, 240, 214, 255);
                    sg.roundRect(-280, -23, 560, 46, 14);
                    sg.fill();
                    sg.lineWidth = 2;
                    sg.strokeColor = new Color(214, 138, 60, 255);
                    sg.roundRect(-280, -23, 560, 46, 14);
                    sg.stroke();

                    const hsf = who ? this.heads[who.short] : undefined;
                    if (hsf) {
                        const hn = new Node('head');
                        hn.parent = sc;
                        hn.addComponent(UITransform).setContentSize(34, 34);
                        hn.setPosition(-252, 0, 0);
                        const hs = hn.addComponent(Sprite);
                        hs.sizeMode = Sprite.SizeMode.CUSTOM;
                        hs.spriteFrame = hsf;
                    } else {
                        mkLabel(sc, 'head', who ? who.name.slice(0, 1) : '?', 18,
                            new Color(120, 76, 20, 255), 34, 34).node.setPosition(-252, 0, 0);
                    }
                    /* 左对齐：容器左缘就是 x（`mkLeftLabel` 会把节点摆到 x+w/2）。
                       直接 `mkLabel` + `horizontalAlign=LEFT` 的话容器还是以节点为中心，
                       矩形会往左探出半个容器宽 —— 和左边那枚头像的矩形叠上，
                       `--audit` 报的 `head × nm` 就是这么来的（视觉没叠，矩形叠了）。 */
                    const nm = mkLeftLabel(sc, 'nm', who ? who.name : '它', 19,
                        new Color(112, 66, 22, 255), -228, 11, 180, 24);
                    /* 「第 N/10 趟 · X 秒后下一趟」—— 右缘钉在 272（卡片右内沿）。
                       满趟时换成"攒满了，收回"，因为那时"下一趟"永远不会来。 */
                    const hd = mkRightLabel(sc, 'hd', '', 14, new Color(150, 92, 30, 255), 272, 11, 250, 22);

                    const bar = new Node('bar');
                    bar.parent = sc;
                    bar.addComponent(UITransform).setContentSize(480, 9);
                    bar.setPosition(11, -11, 0);
                    const bg = bar.addComponent(Graphics);
                    /* 空槽：画在这里，刷新时只重画填充部分会连槽一起没 */
                    bg.fillColor = new Color(232, 220, 198, 255);
                    bg.roundRect(-240, -4.5, 480, 9, 4.5);
                    bg.fill();

                    this.dispatchLive = {
                        petId: job.id,
                        bar: bg,
                        head: hd,
                        meta: null,
                        act: null,
                    };
                }

                /* ---------------- 待命列表 ---------------- */
                const firstTop = top - (job ? 54 : 0) - 8;
                list.forEach((p, i) => {
                    const isAway = !!job && job.id === p.id;
                    const isOut = p.id === s.active;

                    let meta: string;
                    let action: string;
                    let ok = false;
                    let onClick = () => {};

                    if (isAway) {
                        const peek = peekDispatch(s, Date.now());
                        const ready = peek.hauls > 0;
                        /* 收成明细和"还差几秒"分两段写：玩家要的是"现在能不能点"，
                           而不是一个混合了两种状态的句子。 */
                        meta = ready
                            ? `${peek.hauls} 趟 · ${[
                                peek.shards ? `图纸碎片 ${peek.shards}` : '',
                                peek.ration ? `干粮 ${peek.ration}` : '',
                                peek.apples ? `果子 ${peek.apples}` : '',
                                peek.logs ? `材料 ${peek.logs}` : '',
                                peek.coins ? `吧唧 ${peek.coins}` : '',
                            ].filter(Boolean).join(' · ')}`
                            : `${peek.left} 秒后才有第一趟`;
                        action = ready ? '收回' : '等着';
                        /* 未满一趟也**挂点击**：点了要告诉他还要几秒，
                           静默一行比灰掉一行更让人以为界面坏了。 */
                        ok = true;
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
                        /* 派出前就要说清"这一趟能捡到碎片" —— 那是玩家派它的**理由**。
                           `yieldText` 里没有碎片（它按趟算产出，碎片是满 10 趟才结）
                           所以单独补一句，写成"满一趟 N 碎片"而不是"每趟 0.2 个"。 */
                        meta = `${yieldText(p.id)} · 满一趟 碎片 ${DISPATCH_SHARD}`;
                        action = '派出';
                        ok = canDispatch(s, p.id);
                        onClick = () => this.act(
                            startDispatch(this.save, p.id, Date.now()),
                            () => this.openDispatch(),
                        );
                    }

                    const row = this.mkRow(
                        card, p.id, p.name, meta, action,
                        0, firstTop - 28 - i * pitch, onClick, ok, 56, p.short,
                    );
                    /* 外出那一行的三个字段交给 tick 实时改写（进度条在状态卡上，
                       这里改的是文字）—— 少了这一行，状态卡和行会对不上。 */
                    if (isAway && this.dispatchLive) {
                        this.dispatchLive.meta = row.getChildByName('meta')?.getComponent(Label) ?? null;
                        this.dispatchLive.act = row.getChildByName('act')?.getComponent(Label) ?? null;
                    }
                });

                if (!owned.length) {
                    mkLabel(card, 'none', '家里还没有伙伴', 18, INK_SOFT, 400, 32)
                        .node.setPosition(0, 20, 0);
                }
            },
            640, ch,
        );
    }

    private openSettings() {
        const s = this.save.settings;
        /* 640×300 而不是默认的 640×520。
           用户原话「界面 UI 也对不起 你检查下你做的系统」——
           这块面板原来只有两行开关，却开了 520 高的框，七成是空白。
           **面板尺寸要跟着内容走**，不是所有面板都长一样大。 */
        this.openSheet(
            '设置',
            '画质会立刻改帧率；音效开关会记住，但这一版还没有声音。',
            (card) => {
                this.mkRow(card, 'crisp', '画质', s.crisp ? '清晰 · 60 帧' : '流畅 · 30 帧', s.crisp ? '清晰' : '流畅', 0, 22, () => {
                    this.act(toggleCrisp(this.save), () => this.openSettings());
                });
                this.mkRow(card, 'mute', '音效', '这一版还没有声音，开关会记住', s.mute ? '关' : '开', 0, -46, () => {
                    this.act(toggleMute(this.save), () => this.openSettings());
                });
            },
            640, 300,
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
        /* 每次打开都从宠物页开始、不记住上次选中的屏。
           图鉴是**常驻重建**的（这里每次都销毁再 ensure），所以页签状态
           只能靠字段带过来 —— 不重置的话，上次翻到星靶页又选了第 12 屏，
           这次点"图鉴"直接落在星靶页，玩家会以为点错了入口。 */
        this.codexTab = 'pet';
        this.starPick = -1;
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

        /* ★ 2026-10-26：卡面 510 → 620，图鉴从"宠物名册"扩成两页：
           宠物（原样）+ 星靶（27 屏 × 3 靶 = 81 格）。星靶是"挑战收集"，
           和宠物收集是同一类东西，所以不新开入口 ICON（rail 四徽标已满），
           在这里开第二页。
           原「战绩条」一行（S×n A×n B×n）并进副标题 —— 信息一个字没少，
           但副标题下面的位置腾出来放 tab 了。 */
        const CW = 700, CH = 620;
        const card = new Node('card');
        card.parent = root;
        card.addComponent(UITransform).setContentSize(CW, CH);
        paintCard(card.addComponent(Graphics), CW, CH);
        /* 卡面吃掉点击，别透到遮罩上把面板关掉 */
        card.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; });

        mkLabel(card, 'title', '图鉴', 34, INK, 400, 48).node.setPosition(0, 190, 0);
        /* 副标题跟着 tab 走：宠物页报收服/通关/评级，星靶页报靶数/章集满。
           容器 620 宽 + SHRINK：星靶页文案比宠物页长，写死 400 会被截。 */
        const subLb = mkLabel(card, 'sub', '', 18, INK_SOFT, 620, 28);
        subLb.overflow = Label.Overflow.SHRINK;
        subLb.node.setPosition(0, 146, 0);

        /* tab：宠物 / 星靶。两颗各 120×36，心在 ±90，中间空 60。 */
        this.mkCodexTab(card, 'pet', '宠物', -90);
        this.mkCodexTab(card, 'star', '星靶', 90);

        /* 两页都是空壳容器（锚点对齐 card 中心，内部用 card 绝对坐标）——
           内容**打开时现画**：存档可能被战斗侧的 recordStar 改过，
           建一次就再也不刷的面板会显示上一次的旧完成位。 */
        const pagePet = new Node('page-pet');
        pagePet.parent = card;
        pagePet.addComponent(UITransform).setContentSize(CW, CH);

        const pageStar = new Node('page-star');
        pageStar.parent = card;
        pageStar.addComponent(UITransform).setContentSize(CW, CH);

        this.syncCodexTab(pagePet, pageStar);

        this.codexOp = root.addComponent(UIOpacity);
    }

    /**
     * 图鉴的页签。选中态 = 深底白字，未选 = 浅底深字。
     * 点击只改 `codexTab` 再走 `syncCodexTab` 重画 —— 不在这里直接切 active，
     * 否则"两页各画一次"的初始化路径和"点一次切一页"的路径会各写一半。
     */
    private mkCodexTab(card: Node, key: 'pet' | 'star', text: string, x: number) {
        const TW = 120, TH = 36;
        const btn = new Node(`tab-${key}`);
        btn.parent = card;
        btn.addComponent(UITransform).setContentSize(TW, TH);
        btn.setPosition(x, 108, 0);
        const g = btn.addComponent(Graphics);
        const on = this.codexTab === key;
        g.fillColor = on ? new Color(176, 122, 60, 255) : new Color(240, 226, 206, 255);
        g.roundRect(-TW / 2, -TH / 2, TW, TH, 18);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = new Color(198, 168, 136, 255);
        g.roundRect(-TW / 2, -TH / 2, TW, TH, 18);
        g.stroke();
        mkLabel(btn, 'txt', text, 17, on ? new Color(255, 250, 240, 255) : INK, TW - 16, TH - 6)
            .node.setPosition(0, 0, 0);
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            if (this.codexTab === key) return;
            this.codexTab = key;
            this.starPick = -1;
            const card0 = btn.parent;
            const pp = card0?.getChildByName('page-pet');
            const ps = card0?.getChildByName('page-star');
            if (pp && ps) this.syncCodexTab(pp, ps);
        });
    }

    /**
     * 按当前 tab 重画：副标题文案 + 两页显隐 + 当前页内容。
     * 页签的选中配色也在这里刷（`mkCodexTab` 画的是初始态）。
     */
    private syncCodexTab(pagePet: Node, pageStar: Node) {
        const card = pagePet.parent;
        const cleared = this.save.cleared;
        const owned = PETS.filter((p) => cleared >= p.at).length;
        const cnt: Record<string, number> = { S: 0, A: 0, B: 0 };
        for (const r of this.save.best) if (r === 'S' || r === 'A' || r === 'B') cnt[r]++;
        const bits = starBitsOf(this.save.star);
        let gotStars = 0;
        for (let i = 0; i < STAGE_COUNT; i++) for (let k = 0; k < 3; k++) if (bits[i] && bits[i][k]) gotStars++;
        let fullCh = 0;
        for (let c = 0; c < CHAPTERS.length; c++) if (chapterStarFull(bits, c)) fullCh++;

        const sub = card?.getChildByName('sub')?.getComponent(Label);
        if (sub) {
            sub.string = this.codexTab === 'pet'
                ? `已收服 ${owned} / ${PETS.length} · 已通 ${cleared} / ${STAGE_COUNT} · S×${cnt.S} A×${cnt.A} B×${cnt.B}`
                : `星靶 ${gotStars} / ${STAGE_COUNT * 3} · 章集满 ${fullCh} / ${CHAPTERS.length}`;
        }

        /* 页签配色：两颗都重画（Graphics 没有"改个颜色"的 API，只能重画） */
        const tp = card?.getChildByName('tab-pet');
        const ts = card?.getChildByName('tab-star');
        this.paintCodexTab(tp, 'pet');
        this.paintCodexTab(ts, 'star');

        pagePet.active = this.codexTab === 'pet';
        pageStar.active = this.codexTab === 'star';
        pagePet.removeAllChildren();
        pageStar.removeAllChildren();
        if (this.codexTab === 'pet') this.drawPetPage(pagePet);
        else this.drawStarPage(pageStar);
    }

    /** 页签重画。和 `mkCodexTab` 里的绘制逐字同源，只差"选中"这一个输入 */
    private paintCodexTab(btn: Node | undefined | null, key: 'pet' | 'star') {
        if (!btn) return;
        const g = btn.getComponent(Graphics);
        const txt = btn.getChildByName('txt')?.getComponent(Label);
        if (!g || !txt) return;
        const TW = 120, TH = 36;
        const on = this.codexTab === key;
        g.clear();
        g.fillColor = on ? new Color(176, 122, 60, 255) : new Color(240, 226, 206, 255);
        g.roundRect(-TW / 2, -TH / 2, TW, TH, 18);
        g.fill();
        g.lineWidth = 2;
        g.strokeColor = new Color(198, 168, 136, 255);
        g.roundRect(-TW / 2, -TH / 2, TW, TH, 18);
        g.stroke();
        txt.color = on ? new Color(255, 250, 240, 255) : INK;
    }

    /**
     * 宠物页（原图鉴内容）。
     * **内容全部从存档现算**，和锁定槽、出发卡共用同一份 `PETS` / `petGap()`。
     * 头像走 `this.heads`；图没加载上时退回"圆底 + 首字"。
     */
    private drawPetPage(page: Node) {
        const cleared = this.save.cleared;

        /* 3 列 × 2 行。列宽 200、行高 160 —— 六个格子占满 600×320。
           行心 [6,-154]：第一行顶 81 让开 tab（底 90），第二行底 -229
           让开 tip（顶 -273）。 */
        const COL_X = [-200, 0, 200];
        const ROW_Y = [6, -154];

        PETS.forEach((p, i) => {
            const cx0 = COL_X[i % 3];
            const cy0 = ROW_Y[Math.floor(i / 3)];
            const got = cleared >= p.at;
            const gap = petGap(cleared, p.id);

            const cell = new Node(`cell-${p.id}`);
            cell.parent = page;
            cell.addComponent(UITransform).setContentSize(190, 150);
            cell.setPosition(cx0, cy0, 0);
            const cg = cell.addComponent(Graphics);

            /* 圆底：**只作兜底**。头像本身是自带奶油底的圆片（96×96），
               贴上去就把这个圆盖住了。没有图时才靠它。 */
            const sf = this.heads[p.short];
            if (!sf) {
                cg.fillColor = got ? new Color(246, 206, 128, 255) : new Color(206, 198, 186, 255);
                cg.circle(0, 34, 42);
                cg.fill();
                mkLabel(cell, 'mark', got ? p.name.slice(0, 1) : '?', 34,
                        got ? new Color(92, 60, 24, 255) : new Color(120, 112, 104, 255), 80, 44)
                    .node.setPosition(0, 34, 0);
            }

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
               所以另起一个节点。这一圈是"收服了"和"没解锁"唯一的硬区别。 */
            const ring = new Node('ring');
            ring.parent = cell;
            ring.addComponent(UITransform).setContentSize(88, 88);
            ring.setPosition(0, 34, 0);
            const rg2 = ring.addComponent(Graphics);
            rg2.lineWidth = 3;
            rg2.strokeColor = got ? new Color(176, 122, 60, 255) : new Color(158, 148, 136, 255);
            rg2.circle(0, 0, 42);
            rg2.stroke();

            if (!got) {
                mkLabel(cell, 'mark', '?', 40, new Color(255, 250, 240, 235), 80, 52)
                    .node.setPosition(0, 34, 0);
            }

            /* 三行的容器高宽是 24/20/18，按 4px 净间隙排开：
               name [-32,-8] / state [-56,-36] / line [-79,-61]。 */
            mkLabel(cell, 'name', got ? p.name : '未收服', 19,
                    got ? INK : INK_SOFT, 180, 24).node.setPosition(0, -20, 0);

            const pats = this.save.pats[p.id] || 0;
            mkLabel(cell, 'state', got ? `${heartText(pats)} · 摸 ${pats}` : `还差 ${gap} 关`, 14,
                    got ? new Color(63, 125, 36, 255) : INK_SOFT, 180, 20)
                .node.setPosition(0, -46, 0);
            mkLabel(cell, 'line', got ? (PET_LINE[p.id] || '') : '', 13, INK_SOFT, 180, 18)
                .node.setPosition(0, -70, 0);
        });

        /* 本页自己的 tip（星靶页另有一个 y=-296 的）——
           卡面 510→620 之后两页底部留白不一样，共用一个坐标必有一页贴边。 */
        mkLabel(page, 'tip', '点空白处关闭', 14, INK_SOFT, 400, 22).node.setPosition(0, -272, 0);
    }

    /**
     * 星靶页：27 屏 × 3 靶 = 81 格，按章分三行。
     *
     * **为什么一屏一格、格内画三颗点，而不是画 81 个独立格子**：
     * 81 个可点目标在一屏里是噪声；玩家先认出"第 5 屏"，再关心它挂哪三靶。
     * 格内三点 = 该屏三靶的完成位，集满的格加金框。
     *
     * 三态分色沿用结算卡口径，但图鉴里没有"本趟"概念，所以只有两态：
     * 达成 = 金底白勾 / 未达成 = 灰底空心。"早就有了"和"从没拿到"在两态里
     * 也读得出来（金 / 灰），而"刚拿到"的 hot 感由结算卡承担。
     */
    private drawStarPage(page: Node) {
        /* 这一页有两个入口：切 tab（syncCodexTab 已清过）和**点格子重画**
           （cell.on 直接调它，page 是脏的）。不在这里清，第二轮开始
           旧网格和旧详情就全留在节点树上，和新的一份叠着画。 */
        page.removeAllChildren();
        const bits = starBitsOf(this.save.star);
        const COL_X: number[] = [];
        for (let i = 0; i < 9; i++) COL_X.push(-216 + 54 * i);
        /* 三行的章标签心 / 格心。标签 16 高、格 44 高，
           相邻容器净间隙全部 ≥4px（audit 的红线）。 */
        const LAB_Y = [78, 2, -72];
        const CELL_Y = [44, -34, -108];
        const GOLD = new Color(214, 148, 40, 255);
        const GOLD_PALE = new Color(246, 222, 168, 255);
        const GRAY = new Color(206, 198, 186, 255);

        for (let ch = 0; ch < CHAPTERS.length; ch++) {
            const c = CHAPTERS[ch];
            mkLabel(page, `ch-lab-${ch}`, `${chapterOrd(ch)} · ${c.name}`, 15, INK_SOFT, 400, 16)
                .node.setPosition(0, LAB_Y[ch], 0);

            let chGot = 0;
            for (let j = 0; j < c.count; j++) {
                const i = c.from + j;
                const cell = new Node(`star-${i}`);
                cell.parent = page;
                cell.addComponent(UITransform).setContentSize(44, 44);
                cell.setPosition(COL_X[j], CELL_Y[ch], 0);
                const cg = cell.addComponent(Graphics);
                const full = stageStarFull(bits, i);
                /* 集满的格铺金底，没满的铺米白 —— 远看就知道哪几屏打穿了 */
                cg.fillColor = full ? GOLD_PALE : new Color(248, 242, 230, 255);
                cg.roundRect(-22, -22, 44, 44, 10);
                cg.fill();
                cg.lineWidth = full ? 3 : 1.5;
                cg.strokeColor = full ? GOLD : new Color(198, 168, 136, 255);
                cg.roundRect(-22, -22, 44, 44, 10);
                cg.stroke();

                /* 屏号小字贴格底（11px），三点在格心偏上 10px */
                mkLabel(cell, 'no', String(i + 1), 11, INK_SOFT, 40, 14)
                    .node.setPosition(0, -14, 0);
                let got = 0;
                for (let k = 0; k < 3; k++) {
                    const met = !!(bits[i] && bits[i][k]);
                    if (met) got++;
                    const dot = new Node(`dot-${k}`);
                    dot.parent = cell;
                    dot.addComponent(UITransform).setContentSize(14, 14);
                    dot.setPosition((k - 1) * 14, 8, 0);
                    const dg = dot.addComponent(Graphics);
                    if (met) {
                        dg.fillColor = GOLD;
                        dg.circle(0, 0, 6);
                        dg.fill();
                        mkLabel(dot, 'ck', '✓', 9, new Color(255, 252, 245, 255), 12, 12)
                            .node.setPosition(0, 0, 0);
                    } else {
                        dg.fillColor = new Color(255, 255, 255, 255);
                        dg.circle(0, 0, 6);
                        dg.fill();
                        dg.lineWidth = 1.5;
                        dg.strokeColor = GRAY;
                        dg.circle(0, 0, 6);
                        dg.stroke();
                    }
                }
                chGot += got;

                /* 选中框：点过的格描粗棕边，告诉玩家"详情区正在说这一屏" */
                if (this.starPick === i) {
                    cg.lineWidth = 3;
                    cg.strokeColor = new Color(122, 80, 52, 255);
                    cg.roundRect(-22, -22, 44, 44, 10);
                    cg.stroke();
                }

                cell.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                    e.propagationStopped = true;
                    this.starPick = this.starPick === i ? -1 : i;
                    const ps = cell.parent;
                    if (ps) this.drawStarPage(ps);
                });
            }

            /* 章集满条：三段并排，与网格同宽（476）。
               满章铺金 —— 和格子的集满标记同一套颜色。 */
            const seg = new Node(`ch-bar-${ch}`);
            seg.parent = page;
            seg.addComponent(UITransform).setContentSize(152, 22);
            seg.setPosition(-162 + 162 * ch, -148, 0);
            const bgg = seg.addComponent(Graphics);
            const chFull = chapterStarFull(bits, ch);
            bgg.fillColor = chFull ? GOLD_PALE : new Color(240, 226, 206, 255);
            bgg.roundRect(-76, -11, 152, 22, 11);
            bgg.fill();
            bgg.lineWidth = 1.5;
            bgg.strokeColor = chFull ? GOLD : new Color(198, 168, 136, 255);
            bgg.roundRect(-76, -11, 152, 22, 11);
            bgg.stroke();
            mkLabel(seg, 'txt',
                chFull ? `${chapterOrd(ch)} 集满 ✓` : `${chapterOrd(ch)} ${chGot} / ${c.count * 3}`,
                13, chFull ? new Color(133, 94, 20, 255) : INK_SOFT, 140, 18)
                .node.setPosition(0, 0, 0);
        }

        this.drawStarDetail(page, bits);
    }

    /**
     * 星靶详情区：选中一屏 → 屏名 + 三靶条件原文（`STAR_TYPES[].desc`，
     * 出发前就要能读懂，所以不截断）；没选中 → 引导句 + 奖励口径。
     *
     * 奖励口径（一屏集满 +2 碎片 +1 材料）写在右侧计数行里，不单开一行：
     * 620 的卡高放完「网格 + 章条 + 详情 + tip」之后只剩两行，
     * 而"集满给多少"必须贴着"这屏还差几靶"读才成立。
     */
    private drawStarDetail(page: Node, bits: number[][]) {
        const i = this.starPick;
        if (i < 0 || i >= STAGE_COUNT) {
            mkLabel(page, 'd-hint', '点一格，看这一屏的三颗靶和达成条件', 15, INK_SOFT, 620, 20)
                .node.setPosition(0, -182, 0);
            mkLabel(page, 'd-prize',
                `一屏集满 碎片 +${STAR_FULL_SHARDS} · 材料 +${STAR_FULL_LOGS}　一章集满 碎片 +${STAR_CHAPTER_SHARDS} · 材料 +${STAR_CHAPTER_LOGS}`,
                13, INK_SOFT, 620, 20).node.setPosition(0, -208, 0);
            mkLabel(page, 'tip', '点空白处关闭', 14, INK_SOFT, 400, 22).node.setPosition(0, -296, 0);
            return;
        }

        const ids = STAR_OF_STAGE[i] || [];
        const got = ids.filter((id, k) => bits[i] && bits[i][k]).length;
        const full = stageStarFull(bits, i);
        mkLeftLabel(page, 'd-title', `第 ${i + 1} 屏 · ${stageLabel(i)}`, 17, INK, -320, -180, 340, 24);
        mkRightLabel(page, 'd-count',
            full ? '一屏集满 ✓'
                : `${got} / 3 · 集满奖 碎片+${STAR_FULL_SHARDS} 材料+${STAR_FULL_LOGS}`,
            13, full ? new Color(133, 94, 20, 255) : INK_SOFT, 320, -178, 280, 20);

        ids.forEach((id, k) => {
            const t = STAR_TYPES.find((x) => x.id === id);
            const met = !!(bits[i] && bits[i][k]);
            const y = -208 - 20 * k;
            mkLeftLabel(page, `d-mk-${k}`, met ? '✓' : '—', 13,
                met ? new Color(63, 125, 36, 255) : new Color(150, 144, 136, 255), -320, y, 24, 16);
            mkLeftLabel(page, `d-nm-${k}`, t ? t.name : id, 13, INK, -292, y, 110, 16);
            mkLeftLabel(page, `d-ds-${k}`, t ? t.desc : '', 13, INK_SOFT, -176, y, 496, 16);
        });

        mkLabel(page, 'tip', '点空白处关闭', 14, INK_SOFT, 400, 22).node.setPosition(0, -296, 0);
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

        /* 「有东西可收」红点：右上角，压在图钉旁边。
           只有攒满至少一趟才亮（`pingDispatch` 每帧判）——
           常亮红点是噪音，玩家三分钟后就当它不存在了。 */
        if (!badges.getChildByName('Dot-派遣')) {
            const dot = new Node('Dot-派遣');
            dot.parent = card;
            const dut = dot.addComponent(UITransform);
            dut.setContentSize(18, 18);
            dut.setAnchorPoint(0.5, 0.5);
            dot.setPosition(CW / 2 - 4, CH / 2 - 4, 0);
            const dg = dot.addComponent(Graphics);
            /* 外圈白环：红点压在暖米纸上，没有描边会"陷"进去 */
            dg.fillColor = new Color(255, 250, 240, 235);
            dg.circle(0, 0, 8.5);
            dg.fill();
            dg.fillColor = new Color(214, 74, 54, 255);
            dg.circle(0, 0, 6.5);
            dg.fill();
            dg.fillColor = new Color(255, 176, 158, 255);
            dg.circle(-1.8, 1.8, 2.0);
            dg.fill();
            dot.active = false;
            this.dispatchDot = dot;
        } else {
            this.dispatchDot = badges.getChildByName('Dot-派遣');
        }
    }

    private refreshTaskBtn() {
        const btn = this.canvas.getChildByName('Badges')?.getChildByName('TaskBtn');
        const lb = btn?.getChildByName('txt')?.getComponent(Label);
        if (!btn || !lb) return;
        this.taskBtn = btn;
        /* 2026-10-25（第三版）：红点数 = **今天能领的每日任务条数**。
           主线奖励是自动发的（`bindSave` 里结算），不参与红点 ——
           一个"会自动消失的红点"会让玩家白点一次。 */
        const rows = dailyRows(this.save);
        const n = rows.filter((r) => r.done && !r.claimed).length;
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
     * 排行榜（本机）。
     *
     * 用户原话：「排行榜不应该是通关的吗」「排行榜你先做本地 客户端做」。
     *
     * 上一版做成了"我的数据看板"（总星 / 分布 / 三项纪录），**没有对照组** ——
     * 排行榜的最小定义是"我和别人比"。这一版是街机厅 TOP 10：
     * 9 条影子记录 + 你，成绩插入后重排。
     *
     * **数据形状和真榜一致**（`{name, cleared, stars, runs}`），
     * 将来接服务端只换 `rankBoard()` 一个函数，面板不用改。
     */
    private openRank() {
        const s = this.save;
        const board = rankBoard(s);
        const mine = myRank(s);
        const floor = rankFloor();
        this.openSheet(
            '排行榜',
            /* 榜单永远 10 条（9 条影子 + 你），所以 `mine` 恒为 1..10。
               新手一进来就是第 10 名 —— 这不是 bug，是设计：
               **永远有 9 个够得着的目标在前面**，比"你还没上榜"有方向感。 */
            `本机通关榜 · 你排第 ${mine} / ${RANK_SIZE}`,
            (card) => {
                const W0 = 560;
                /* 表头 y=156 不是 190：openSheet 的副标题在 CH/2-88 = 172，
                   190 会和它叠上（截图 `_t-rank` 第一版「通关」压在"你排第 7"上）。 */
                /* 表头 */
                mkLabel(card, 'h0', '#', 11, INK_SOFT, 40, 16).node.setPosition(-250, 156, 0);
                const h1 = mkLabel(card, 'h1', '名字', 11, INK_SOFT, 120, 16);
                h1.node.setPosition(-160, 156, 0);
                h1.horizontalAlign = Label.HorizontalAlign.LEFT;
                mkLabel(card, 'h2', '通关', 11, INK_SOFT, 70, 16).node.setPosition(30, 156, 0);
                mkLabel(card, 'h3', '星', 11, INK_SOFT, 60, 16).node.setPosition(120, 156, 0);
                mkLabel(card, 'h4', '趟', 11, INK_SOFT, 60, 16).node.setPosition(200, 156, 0);

                board.forEach((r, i) => {
                    const y = 126 - i * 34;
                    const row = new Node('r-' + i);
                    row.parent = card;
                    row.addComponent(UITransform).setContentSize(W0, 30);
                    row.setPosition(0, y, 0);
                    const rg = row.addComponent(Graphics);
                    /* 自己那一行高亮 —— 一屏 10 条同色的表，玩家第一件事是找自己 */
                    if (r.me) {
                        rg.fillColor = new Color(255, 226, 150, 255);
                        rg.roundRect(-W0 / 2, -15, W0, 30, 9);
                        rg.fill();
                    } else if (i % 2 === 1) {
                        rg.fillColor = new Color(240, 234, 222, 255);
                        rg.roundRect(-W0 / 2, -15, W0, 30, 9);
                        rg.fill();
                    }
                    const col = r.me ? new Color(120, 76, 20, 255) : INK;
                    const soft = r.me ? new Color(140, 96, 40, 255) : INK_SOFT;
                    /* 前三名给个色：金 / 银 / 铜。不是装饰，是让"前三"变成一个可数的目标 */
                    const medal = ['#E8951A', '#9AA5AD', '#B5793F'][i];
                    mkLabel(row, 'n', String(i + 1), 13,
                        medal ? new Color(
                            parseInt(medal.slice(1, 3), 16),
                            parseInt(medal.slice(3, 5), 16),
                            parseInt(medal.slice(5, 7), 16), 255) : soft,
                        40, 20).node.setPosition(-250, 0, 0);
                    const nm = mkLabel(row, 'm', r.name, 14, col, 120, 20);
                    nm.node.setPosition(-160, 0, 0);
                    nm.horizontalAlign = Label.HorizontalAlign.LEFT;
                    mkLabel(row, 'c', String(r.cleared), 13, col, 70, 20).node.setPosition(30, 0, 0);
                    mkLabel(row, 's', String(r.stars), 13, col, 60, 20).node.setPosition(120, 0, 0);
                    mkLabel(row, 'u', String(r.runs), 13, soft, 60, 20).node.setPosition(200, 0, 0);
                });

                mkLabel(card, 'foot', '先比通关屏数，再比星数，最后比谁用的趟数少',
                    10, INK_SOFT, 520, 16).node.setPosition(0, -200, 0);
            },
            /* 560 而不是 520：表头 y=156 和副标题（CH/2-88）之间
               只差 6px，520 时会重叠 2px（截图 `_t-rank`/`_t-rank2`）。 */
            640, 560,
        );
    }

    /**
     * 任务面板 —— **居中大面板，不是侧边抽屉**（2026-10-25 第四次调整）。
     *
     * 用户原话：「每日 3 条肯定少了啊 而且你的任务界面搞的也不好
     *            你参考下其他 Q 版游戏怎么设计的」
     *
     * 参考的是常规 Q 版/休闲手游的任务界面三件套（原神 / 蛋仔 / 摩尔庄园都是这个形状）：
     *   ① 顶部一条**活跃度进度条** + 阶梯宝箱（完成 N 条开一个）
     *   ② 主线一条大卡，带"第几条 / 共几条"
     *   ③ 每日 5 行，每行 = 图标 + 名字 + **进度条** + 奖励 + 领取按钮
     *
     * 为什么必须从抽屉换成居中面板：
     *   抽屉只有 300 宽，一行塞不下"名字 + 进度条 + 奖励 + 按钮"四样，
     *   只能把进度压成一个 "1/3" 的文字 —— 而**进度条才是这类界面的主角**，
     *   它让玩家一眼看出"还差多少"，文字要读。
     */
    private openTasks() {
        /* 跨天重抽放在这里：玩家可能开着游戏过零点。
           `commit` 会跑 `bindSave`，主线也一起结算掉。 */
        const d = rollDailyIfNeeded(this.save);
        if (d.changed) this.commit(d.next);

        const done = dailyDoneCount(this.save);
        this.openSheet(
            '任务',
            `${this.save.dailyAt || '今天'} · 每日完成 ${done} / ${DAILY_N} · 主线 ${storyDone(this.save)} / ${STORY.length}`,
            (card) => this.paintTaskBoard(card),
            /* 600 高而不是 560：5 行每日 + 主线 + 活跃度刚好占满，
               560 时第 5 行会和 openSheet 自己的「点空白处关闭」叠上（截图 `_t-task5`）。 */
            640, 600,
        );
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
     * 抽屉内容的高度 —— **写死，不再按条目累加**。
     *
     * 原来这里算的是"6 条任务按状态分组后一共多高"，于是领完一条纸就矮一截，
     * 玩家读作"这页在收缩"。换成「本趟目标」之后内容固定三块（本趟 2 条 +
     * 目标池 5 条 + 一句规则），高度自然也就固定了。
     */
    private taskLayout(): { items: TaskItem[]; height: number } {
        return { items: [], height: 470 };
    }

    /**
     * 任务面板内容 —— 参考常规 Q 版游戏的三段式。
     *
     * ```
     *  ┌──────────────────────────────────────────┐
     *  │ 活跃度  3 / 5   [▓▓▓▓▓▓░░░]   🎁3   🎁5 │
     *  ├──────────────────────────────────────────┤
     *  │ 主线  6 / 10                              │
     *  │ ┌────────────────────────────────────┐   │
     *  │ │ 拿到第一个 S            碎片 2      │   │
     *  │ │ 一屏里「用时」和「用球」都达标就是 S │   │
     *  │ └────────────────────────────────────┘   │
     *  ├──────────────────────────────────────────┤
     *  │ 每日                                      │
     *  │ ① 出门 2 趟   ▓▓▓▓▓▓▓ 2/2   果20  [领取] │
     *  │ ② 推进 2 屏   ▓▓▓░░░░ 1/2   果25  [进行] │
     *  │ …                                         │
     *  └──────────────────────────────────────────┘
     * ```
     *
     * **进度条是主角，文字是辅助**。上一版只写 "1 / 3"，玩家得读数字才知道差多少；
     * 一根条扫一眼就够 —— 这是这类界面唯一真正的信息设计。
     */
    private paintTaskBoard(card: Node) {
        const W0 = 560;
        const s = this.save;
        const done = dailyDoneCount(s);
        const g = new Node('deco');
        g.parent = card;
        g.addComponent(UITransform).setContentSize(W0, 560);
        const gg = g.addComponent(Graphics);

        /* ================= ① 活跃度 ================= */
        /* 176 不是 208：openSheet 的标题在 CH/2-48、副标题在 CH/2-88，
           CH=560 时分别距顶 48 / 88。内容从 208（距顶 72）起会压住副标题 ——
           截图 `_t-task3` 第一版就是这样，「任务」大字被活跃度那行穿过。 */
        const AY = 156;
        mkLeftLabel(card, 'at', '活跃度', 14, INK, -W0 / 2, AY, 80, 20);
        mkLeftLabel(card, 'an', `${done} / ${DAILY_N}`, 14,
            new Color(232, 149, 26, 255), -W0 / 2 + 62, AY, 60, 20);

        /* 进度条：底 + 填充。宽度 240，从 -W0/2+118 起 */
        const BX = -W0 / 2 + 118, BW = 240, BH = 12, BY = AY + 8;
        gg.fillColor = new Color(226, 214, 198, 255);
        gg.roundRect(BX, BY - BH / 2, BW, BH, 6);
        gg.fill();
        if (done > 0) {
            gg.fillColor = new Color(232, 149, 26, 255);
            gg.roundRect(BX, BY - BH / 2, Math.max(6, BW * Math.min(1, done / DAILY_N)), BH, 6);
            gg.fill();
        }

        /* 宝箱：两个台阶。能开时金底，开过时灰，没到数量时暗。
           ★ 位置和宽度是**算出来的，不是凑的**（用户 2026-10-25 截图红框：
             「宝箱 5」整颗超出面板右沿）：
             面板半宽 320。上一版 `cx = W0/2-96+i*96` + 宽 82 → 第二个中心 280、
             右边界 321，**越界 1px**。现在宽 72、`cx = W0/2-92+i*88` → 第二个中心 276、
             右边界 312，离面板边 8px。
             72 宽不是随手缩的：「宝箱 5」四个字符 13px ≈ 46px，容器 72-12=60 仍有余量，
             缩到 60 以下就开始挤压字距。 */
        DAILY_CHESTS.forEach((c, i) => {
            const cx = W0 / 2 - 92 + i * 88;
            const got = (Array.isArray(s.dailyChests) ? s.dailyChests : []).indexOf(c.need) >= 0;
            const can = !got && done >= c.need;
            const bc = got ? new Color(206, 198, 186, 255)
                : can ? new Color(255, 206, 92, 255)
                    : new Color(228, 218, 202, 255);
            this.mkPill(card, `chest-${c.need}`,
                got ? `已开 ${c.need}` : `宝箱 ${c.need}`, 72, 30, cx, AY, can, () => {
                    const r = claimChest(this.save, c.need);
                    this.toast(r.say);
                    if (!r.ok) return;
                    this.commit(r.next);
                    this.openTasks();
                });
            /* mkPill 不接收自定义底色，用一条细标记补上"能不能开"的差别 */
            const dot = new Node('cd');
            dot.parent = card;
            dot.addComponent(UITransform).setContentSize(6, 6);
            dot.setPosition(cx - 44, AY, 0);
            const dg = dot.addComponent(Graphics);
            dg.fillColor = bc;
            dg.circle(0, 0, 3);
            dg.fill();
        });

        /* 分隔线 */
        gg.fillColor = new Color(214, 176, 140, 110);
        gg.rect(-W0 / 2, 134, W0, 2);
        gg.fill();

        /* ================= ② 主线 ================= */
        const cur = storyNow(s);
        mkLeftLabel(card, 'st', '主线', 14, INK, -W0 / 2, 114, 80, 20);
        mkRightLabel(card, 'sn', `${storyDone(s)} / ${STORY.length}`, 12, INK_SOFT,
            W0 / 2, 114, 80, 18);

        if (cur) {
            const sc = new Node('story');
            sc.parent = card;
            sc.addComponent(UITransform).setContentSize(W0, 76);
            sc.setPosition(0, 62, 0);
            const sg = sc.addComponent(Graphics);
            sg.fillColor = new Color(246, 232, 206, 255);
            sg.roundRect(-W0 / 2, -38, W0, 76, 14);
            sg.fill();
            sg.lineWidth = 2;
            sg.strokeColor = new Color(214, 176, 140, 255);
            sg.roundRect(-W0 / 2, -38, W0, 76, 14);
            sg.stroke();

            mkLeftLabel(sc, 'n', cur.name, 16, INK, -W0 / 2 + 14, 22, 300, 22);
            mkLeftLabel(sc, 'd', cur.desc, 11, INK_SOFT, -W0 / 2 + 14, -2, 380, 16);
            mkRightLabel(sc, 'r', rewardText(cur.reward), 12,
                new Color(122, 146, 88, 255), W0 / 2 - 14, 22, 160, 18);
            mkRightLabel(sc, 'tag', '做完自动发', 10, INK_SOFT, W0 / 2 - 14, -2, 160, 14);
        } else {
            mkLeftLabel(card, 'sall', '主线全部做完了 · 剩下的 S 靠你自己刷',
                12, INK_SOFT, -W0 / 2, 62, W0, 18);
        }

        gg.fillColor = new Color(214, 176, 140, 110);
        gg.rect(-W0 / 2, 16, W0, 2);
        gg.fill();

        /* ================= ③ 每日 5 行 ================= */
        mkLeftLabel(card, 'dt', '每日', 14, INK, -W0 / 2, -2, 80, 20);
        /* 日期已经在副标题里了，这里不再重复 —— 同一块面板上同一个数字出现两次，
           玩家会以为其中一个是对的、另一个是坏的。 */

        const rows = dailyRows(s);
        rows.forEach((r, i) => {
            const y = -36 - i * 50;
            const rowH = 44;
            const rn = new Node('d-' + r.def.id);
            rn.parent = card;
            rn.addComponent(UITransform).setContentSize(W0, rowH);
            rn.setPosition(0, y, 0);
            const rg = rn.addComponent(Graphics);
            /* 三档底色：已领灰 / 完成绿 / 未完成米 */
            rg.fillColor = r.claimed ? new Color(226, 220, 208, 255)
                : r.done ? new Color(234, 244, 218, 255)
                    : new Color(243, 237, 224, 255);
            rg.roundRect(-W0 / 2, -rowH / 2, W0, rowH, 11);
            rg.fill();

            /* 序号圆：没有图标可用，序号比"首字"干净（首字会出现两个"出"） */
            rg.fillColor = r.done ? new Color(150, 190, 110, 255) : new Color(212, 200, 184, 255);
            rg.circle(-W0 / 2 + 26, 0, 13);
            rg.fill();
            mkLabel(rn, 'idx', String(i + 1), 12, WHITE, 26, 26).node.setPosition(-W0 / 2 + 26, 0, 0);

            mkLeftLabel(rn, 'n', r.def.name, 13, r.claimed ? INK_SOFT : INK,
                -W0 / 2 + 50, 8, 130, 18);

            /* 进度条 130×8 */
            const pbx = -W0 / 2 + 50, pby = -10, pbw = 130, pbh = 8;
            const frac = Math.min(1, r.cur / Math.max(1, r.def.target));
            rg.fillColor = new Color(212, 202, 188, 255);
            rg.roundRect(pbx, pby - pbh / 2, pbw, pbh, 4);
            rg.fill();
            if (frac > 0) {
                rg.fillColor = r.claimed ? new Color(178, 172, 160, 255)
                    : r.done ? new Color(120, 176, 88, 255) : new Color(232, 178, 74, 255);
                rg.roundRect(pbx, pby - pbh / 2, Math.max(4, pbw * frac), pbh, 4);
                rg.fill();
            }
            mkRightLabel(rn, 'p', `${r.cur}/${r.def.target}`, 10, INK_SOFT,
                pbx + pbw, pby + 10, 60, 14);

            mkRightLabel(rn, 'r', rewardText(r.def.reward), 11,
                new Color(122, 146, 88, 255), 96, 0, 110, 16);

            const bw = 68, bh = 30;
            this.mkPill(rn, 'act', r.claimed ? '已领' : r.done ? '领取' : '进行中',
                bw, bh, W0 / 2 - 12 - bw / 2, 0, r.done && !r.claimed, () => {
                    const res = claimDaily(this.save, r.def.id);
                    this.toast(res.say);
                    if (!res.ok) return;
                    this.commit(res.next);
                    this.openTasks();
                });
        });

        /* 底部不写规则：`openSheet` 自己有一行「点空白处关闭」在 -CH/2+26，
           再放一行会直接叠上去（截图 `_t-task4` 就是两行糊在一起）。
           规则已经写进副标题了。 */
    }



    /* `repaintDrawer` 已删除（2026-10-25）：任务面板从抽屉换成居中面板之后
       它没有调用方了，而且它内部引用的 `paintTaskBody` 也一起被替换掉了。
       抽屉那套（`closeDrawer` / `drawerTap`）还留着 —— `openSheet` 打开时会调，
       玩家可能从抽屉里点开工坊/派遣。 */


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
        /* ★ 出门这一刻抽这一趟的目标（2026-10-25）。
         *
         * 为什么在**出发前**抽、不是回主界面抽：玩家必须在出发前看到
         * "这趟要怎么打"，否则目标就是打完才发下来的考卷 ——
         * 那和原来的"一次性清单"没有区别，还是事后发奖。
         *
         * 直接 `saveSave` 不走 `commit`：马上要切场景了，
         * `commit` 里的 bindSave / syncLawn 全是白跑（而且会闪一下）。
         */
        const goals = rollTripGoals();
        this.save = { ...this.save, tripGoals: goals };
        saveSave(this.save);

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
