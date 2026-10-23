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
} from 'cc';
import { EDITOR } from 'cc/env';
import { MAX_SQUAD, PETS, petGap, squadSize, unlockedPets } from './config/Roster';
import type { PetDef } from './config/Roster';
import { loadSave, saveSave } from './config/SaveData';
import type { SaveState } from './config/SaveData';
import { SATIETY } from './config/BattleConfig';
import {
    MEALS, RECIPES, PET_LINE, DISPATCH_SEC, DISPATCH_CAP,
    feed, craft, recordPat, startDispatch, collectDispatch, peekDispatch,
    toggleMute, toggleCrisp, heartText, canDispatch,
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
 * 六只**坐在屋前那块粉色垫子上**（派遣绿牌左边），前后两排、零遮挡
 *
 * 上一版把六只摆在房子正前方 396~606 —— 那不是垫子，是草地中央：
 * 六只挤成一坨、互相挡脸，而旁边真正的垫子和派遣牌一直空着。
 *
 * 垫子在渲染图里的实际范围（1280×720 一像素等于一个设计单位，直接量）：
 *   木框（含编织边）x 768..1038 / y 495..618
 *   粉色软垫      x 792..1010 / y 498..600
 *   派遣绿牌      x 979..1107 / y 455..575
 *
 * **右边界必须停在 971**：绿牌是立在垫子右侧的，宠物站上去会挡掉
 * 半个入口（那块绿芯是"派遣"的可点热区）。所以可用带是 770..979，共 209px。
 * -------------------------------------------------------------------------- */
const PET_BAND_X = 770;
const PET_BAND_W = 209;

/**
 * 宠物统一可见高（设计像素）。
 *
 * 60 是**算出来的，不是挑的**：可用带宽 209，最宽的那一排三只
 * （砂糖 49.6 + 团子 76.6 + 豆奶 63，按宽高比折算）合计 189，
 * 剩 20 分给两道缝 —— 每道 10px。H 再大它们就会贴在一起，
 * 而"贴住"和"遮挡"在玩家眼里是同一件事。
 */
const PET_H = 60;

/**
 * 后排 / 前排的落脚 y。**差 68 > 宠物高 60，就是零遮挡的全部秘密。**
 *
 * 前后两排不遮挡只有两种办法：横向错开超过半只身宽（垫子放不下六只），
 * 或者纵向错开超过整只身高。这里选后者：610 - 542 = 68 > 60 ——
 * 后排的脚落在前排头顶**之上**，两张图在屏幕上不重叠一个像素。
 *
 * 这也是**为什么不能"两排 3+3 对齐"** —— 那样两排 y 只能差 40 左右
 * （再大就顶出垫子后沿/压到 Dock），后排会被前排切掉下半身，
 * 只剩一排脑袋。上一版实测就是这个结果：白兔只剩耳朵。
 */
const PET_Y_BACK = 532;
const PET_Y_FRONT = 600;

/** 只解锁 1~3 只时的单排中线（垫子正中） */
const PET_Y_SOLO = 566;

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
 * 走动开关。**现在是关的。**
 *
 * 上一版放开了"走两步"（±26 领地），单只看没问题；六只坐到同一块垫子上，
 * 走动就必然走进邻只的格子里 —— 而这次的要求是"互相不要遮挡"，位移与它直接冲突。
 * 生气改由**原地姿势**承担（坐 / 趴 / 舔毛 / 打滚），不需要一只脚离地。
 *
 * 行走序列帧到位以后把它打开，同时把 PET_ROAM_R 调回 20+，见 startWalk 注释。
 */
const PET_WALK = false;

/** 横向溜达半径。PET_WALK 为 false 时不生效；打开后不得大于最小缝的一半 */
const PET_ROAM_R = 6;

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
const BADGE_INFO: Record<string, string> = {
    '工作台': '工作台 · 升级装备与宠物配件（待实装）',
    // 图鉴已经是真面板了（openCodex），这里留着只为兜底 —— 它不会再被读到
    '图鉴': '图鉴 · 查看已收服的宠物',
    '灶台': '灶台 · 喂饭提升饱食与心情（待实装）',
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
    private fogs: FogRt[] = [];

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
        this.bindPets();
        /* 存档刷新必须排在 bindDock / bindHud 之前：
           它们绑的事件回调里会读 this.save（比如出战卡文案），
           先刷一遍能保证第一帧看到的就是真值。 */
        this.bindSave();
        this.syncLawn();
        this.applyPrefs();
        this.bindBadges();
        this.bindDock();
        this.bindHud();
        this.placeResources();
        this.bindAmbient();
        this.placeTaskBtn();
        this.placeDispatchCard();
        if (this.save.lastReward) {
            const msg = this.save.lastReward;
            this.commit({ ...this.save, lastReward: '' });
            this.toast(msg);
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

                const txt = cap.getChildByName('txt');
                const tut = txt && txt.getComponent(UITransform);
                if (txt && tut) {
                    txt.setPosition((cw - tut.contentSize.width) / 2,
                                    -(ch - tut.contentSize.height) / 2, 0);
                }
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

    /* ----------------------------------------------------------------------
     * 1c. 系统入口：从"散贴在地图上"收成一条竖栏
     * -------------------------------------------------------------------- */

    /**
     * 四个建筑入口用场景里摆好的位置：工作台在木桌，图鉴在屋门，
     * 灶台在石灶，派遣在告示板。运行时再挪一次，就会飘到宠物头上、
     * 或者压进出门按钮。
     * 「去苔原」藏掉：右下角的出门按钮已经是这条路。
     */
    private layoutRail() {
        const badges = this.canvas.getChildByName('Badges');
        if (!badges) return;

        const keep = new Set(['图鉴', '工作台', '灶台', '派遣']);
        for (const n of badges.children.slice()) {
            if (n.name.indexOf('-hot') >= 0) continue;
            const key = n.name.startsWith('Badge-') ? n.name.slice(6)
                : n.name.startsWith('Cap-') ? n.name.slice(4) : '';
            if (!key || keep.has(key)) continue;
            n.active = false;
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
            if (txt) txt.string = `${s.cleared} / 8 关`;
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
           换成这一趟最关键的两个数：几个人、饿到什么程度。 */
        const go = this.canvas.getChildByName('Dock')?.getChildByName('Btn-Go');
        const gl = go?.getChildByName('line')?.getComponent(Label);
        if (gl) {
            gl.overflow = Label.Overflow.SHRINK;
            gl.string = `${squadSize(s.cleared)} 只 · 饱食 ${Math.round(s.satiety)}`;
        }
        this.refreshTaskBtn();

        /* ---- 饱食度：与战斗同一个 0~100 的数 ---- */
        this.refreshSatiety();
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
    private setResVal(nodeName: string, v: number) {
        const dock = this.canvas.getChildByName('Dock');
        const card = dock?.getChildByName(nodeName);
        const lbl = card?.getChildByName('val')?.getComponent(Label);
        if (lbl) lbl.string = String(v);
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
        const id = this.save.active;
        const def = PETS.find((p) => p.id === id);
        const name = def ? def.name : '砂糖';
        const v = Math.round(clamp(this.save.satiety, 0, SATIETY.max));
        return `${name} · 心情 3 颗心 · 饱食 ${v} / ${SATIETY.max}`;
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
            const def = PETS.find((p) => p.name === n.name);
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
                baseY: n.position.y,
                left: lx(slot.x - PET_ROAM_R),
                right: lx(slot.x + PET_ROAM_R),
                /* 前后只给 ±5：PET_WALK 关着时用不到，打开后也别让它们走散 */
                far: -5,
                near: 5,
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
     * 重新启用的前提：垫子上只放 1~2 只（那时横向有富余），
     * 或者换成更大的场地。把 PET_WALK 打开、PET_ROAM_R 调到
     * "最小缝的一半"以内即可，别直接调大。
     */
    private startWalk(p: PetRt) {
        const curX = p.node.position.x;
        let tx = curX;
        let ty = p.yOff;

        if (Math.random() < 0.78) {
            /* 横向：在自己的 ±26 领地里挑一个点。
               距离压到 18~44px —— 再长就没有"一群"的紧凑感，也重新读成滑。 */
            const dist = rand(18, 44) * (Math.random() < 0.5 ? -1 : 1);
            tx = clamp(curX + dist, p.left, p.right);
            ty = clamp(p.yOff + rand(-4, 4), p.far, p.near);
        } else {
            /* 前后：在两排之间挪一点（±7px 的深度带） */
            ty = rand(p.far, p.near);
            tx = clamp(curX + rand(-10, 10), p.left, p.right);
        }
        /* 两条支路都收一次口，保证永远站在草地这条带上 */
        ty = clamp(ty, p.far, p.near);

        const d = Math.hypot(tx - curX, ty - p.yOff);
        /* 走不出东西就换一个，不要把"原地抖"当成一次移动 */
        if (d < 10) { p.wait = 0.4; return; }

        p.fx = curX; p.fy = p.yOff;
        p.tx = tx; p.ty = ty;
        p.wt = 0;
        /* 42~58 px/s：84px 高的角色按人步速等比约 50px/s。
           低于 40 读成"飘"，高于 65 读成"溜"。 */
        p.wd = clamp(d / rand(42, 58), 0.55, 2.0);
        p.dir = tx >= curX ? 1 : -1;
        p.moving = true;
        /* 起身：取消正在演的原地姿势，不然会一边伸懒腰一边走 */
        p.pose = 0;
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

        if (p.moving) {
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

        const wy = p.baseY + yOff + bob + pop;
        p.node.setPosition(x, wy, pos.z);
        p.node.setScale(p.sx, p.sy, 1);
        p.node.angle = p.rot;

        /* ---------- 影子：只跟 x 和地面，不跟 bob ----------
           **这是"飘不飘"的唯一开关。** 影子跟着 bob 一起上下，眼睛就找不到地面，
           1.2px 的起伏都会被读成脚离地 —— 当年就是这么判定失败的。
           离地越高影子越小，这也是"跳起来了"唯一的视觉提示。 */
        if (p.shadow && p.shadow.isValid) {
            p.shadow.setPosition(x, p.baseY + yOff - 3, 0);
            const lift = Math.max(0, bob + pop);
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
                : key === '灶台' ? () => this.openKitchen()
                : key === '工作台' ? () => this.openBench()
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

        /* —— 锁定槽：视觉降到 55% 表达不可用，点击给出还差几关 —— */
        for (const n of root.children.slice()) {
            if (!n.name.startsWith('Slot-')) continue;
            const pet = n.name.slice(5);
            /* 还差几关从**花名册 + 存档**算，不再查一张写死的表 ——
               那张表在家园和战斗各有一份，改了解锁节奏必然漏一处。 */
            const def = PETS.find((p) => p.name === pet);
            const need = def ? petGap(this.save.cleared, def.id) : 0;

            const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
            /* 已解锁的槽位必须**亮起来**。
             *
             * 原来这里对**所有** Slot 一律 `opacity = 140`（55% 透明）——
             * 玩家把宠物接回家了，底部那一格还是灰的，读成"根本没解锁"。
             * 这是「解锁了主界面没有」最直观的那一刀：草地上的判据错了是看不见，
             * 槽位这里错了是**看得见的灰**，杀伤更大。
             *
             * 140 = 未解锁（必须灰，否则玩家以为能换出战位）；
             * 255 = 已到家（原色，和旁边资源卡同一亮度档）。 */
            op.opacity = need > 0 ? 140 : 255;

            /* tag 是场景里**写死**的「第N关」，HomeRuntime 从来没人改过它。
             *
             * 两个后果叠在一起，就是玩家看到的「解锁了但主界面没有」：
             *   ① 文字永远是「第1关 / 第3关」这种名词短语，玩家读成关卡编号，
             *      而不是「我还差几关」；
             *   ② 已到家的那几格也还挂着「第N关」，加上 55% 灰 ——
             *      看起来和没解锁的一模一样。
             *
             * 已到家 → 写宠物名（这一格从此是「我的伙伴」，不是「待办」）；
             * 未到家 → 写「差N关」，把距离写在脸上。
             * 口径和 game.html 的 `.tag` 保持一致，两边读起来是同一句话。 */
            const tag = n.getChildByName('tag')?.getComponent(Label);
            if (tag) tag.string = need > 0 ? `差${need}关` : pet;

            this.press(n, 0.94);
            n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                this.toast(need > 0
                    ? `${pet} · 再通过 ${need} 关就会回家`
                    : `${pet} 已经在家了 · 待解锁出战位`);
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
                this.toast(c >= 8
                    ? '苔原 8/8 · 全部通关，回草原养老吧'
                    : `苔原 ${c}/8 · 打一场推进 1 关，新伙伴会回家`);
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
        this.arrow = this.tip = this.goCard = null;
        this.toastBox = null;
        this.toastOp = null;
        this.toastLbl = null;
        this.depart = null;
        this.departOp = null;
        this.departScrim = null;
        this.sheet = null;
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
        const mul = s.satiety >= SATIETY.fullLine
            ? SATIETY.mulFull
            : s.satiety >= SATIETY.hungryLine
                ? SATIETY.mulHungry
                : SATIETY.mulStarving;
        const nextPet = PETS.find((p) => p.at > s.cleared);

        mkLabel(card, 'title', `苔原 ${Math.min(8, s.cleared + 1)} / 8`, 40, INK, 500, 56)
            .node.setPosition(0, 108, 0);
        /* 副标题从"能量够不够"换成**这一关你打过多好**。
           出门前是最适合告诉玩家"S 线在哪"的位置：他还没进去，
           正好带着一个目标进去。没有战绩就说实话（还没打过）。 */
        const stageIdx = Math.min(8, s.cleared + 1) - 1;
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

        mkLabel(card, 'row1', `队伍   ${squad} 只 · ${names.join(' / ')}`, 20, INK, 500, 32)
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
            const def = PETS.find((x) => x.name === p.node.name);
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
    private openSheet(title: string, sub: string, fill: (card: Node) => void) {
        this.closeSheet();
        if (this.codex) {
            this.codex.removeFromParent();
            this.codex.destroy();
            this.codex = null;
            this.codexOp = null;
        }

        const CW = 640;
        const CH = 520;
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

        mkLabel(row, 'mark', title.slice(0, 1), 18, new Color(92, 60, 24, 255), 36, 26)
            .node.setPosition(-w / 2 + 36, 0, 0);
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

    private openKitchen() {
        const s = this.save;
        const who = PETS.find((p) => p.id === s.active);
        this.openSheet(
            '灶台',
            `${who ? who.name : '出战'} 的肚子 ${Math.round(s.satiety)}/100 · 果子 ${s.apples} · 材料 ${s.logs} · 干粮 ${s.bag.ration}`,
            (card) => {
                MEALS.forEach((m, i) => {
                    const cost = [
                        m.apples ? `果子 ${m.apples}` : '',
                        m.logs ? `材料 ${m.logs}` : '',
                        m.ration ? '背包 1' : '',
                    ].filter(Boolean).join(' + ');
                    this.mkRow(card, m.id, m.name, `${cost}   饱食 +${m.sat}`, '喂', 0, 78 - i * 76, () => {
                        this.act(feed(this.save, m.id), () => this.openKitchen());
                    });
                });
            },
        );
    }

    private openBench() {
        const s = this.save;
        this.openSheet(
            '工作台',
            `果子 ${s.apples} · 材料 ${s.logs} · 吧唧 ${s.coins} · 干粮 ${s.bag.ration} · 收集篮 ${s.bag.basket}`,
            (card) => {
                RECIPES.forEach((r, i) => {
                    const cost = [
                        r.apples ? `果子 ${r.apples}` : '',
                        r.logs ? `材料 ${r.logs}` : '',
                        r.coins ? `吧唧 ${r.coins}` : '',
                    ].filter(Boolean).join(' + ');
                    const use = r.give === 'ration' ? '拿到灶台就能吃' : '派遣产量多一半';
                    this.mkRow(card, r.id, r.name, `${cost}   ${use}`, '制作', 0, 36 - i * 84, () => {
                        this.act(craft(this.save, r.id), () => this.openBench());
                    });
                });
            },
        );
    }

    private openDispatch() {
        const s = this.save;
        const job = s.dispatch;
        if (job) {
            const peek = peekDispatch(s, Date.now());
            const name = PETS.find((p) => p.id === job.id);
            const who = name ? name.name : '它';
            const sub = peek.hauls > 0
                ? `${who} 可以收回 ${peek.hauls} 趟 · 果子 ${peek.apples} · 材料 ${peek.logs} · 吧唧 ${peek.coins}`
                : `${who} 还要 ${peek.left} 秒 · 一趟 ${DISPATCH_SEC} 秒，最多 ${DISPATCH_CAP} 趟`;
            this.openSheet('派遣', sub, (card) => {
                this.mkRow(
                    card, 'back', who,
                    peek.hauls > 0
                        ? `果子 ${peek.apples} · 材料 ${peek.logs} · 吧唧 ${peek.coins}`
                        : `还要 ${peek.left} 秒`,
                    peek.hauls > 0 ? '收回' : '等着',
                    0, 20,
                    () => { this.act(collectDispatch(this.save, Date.now()), () => this.openDispatch()); },
                    peek.hauls > 0,
                );
            });
            return;
        }
        const owned = unlockedPets(s.cleared);
        this.openSheet(
            '派遣',
            owned.length < 2
                ? '家里只有一只，先去苔原带同伴回来'
                : '留在家里的去采集。跟你出门的那只这趟不派。',
            (card) => {
                const choices = owned.filter((p) => p.id !== s.active);
                if (!choices.length) {
                    mkLabel(card, 'none', '没有能派的同伴', 18, INK_SOFT, 400, 32).node.setPosition(0, 20, 0);
                    return;
                }
                choices.forEach((p, i) => {
                    const ok = canDispatch(s, p.id);
                    this.mkRow(
                        card, p.id, p.name,
                        ok ? '留在家里，可以去采' : '跟你出门，这趟不派',
                        ok ? '派出' : '不能派',
                        0, 78 - i * 70,
                        () => { this.act(startDispatch(this.save, p.id, Date.now()), () => this.openDispatch()); },
                        ok,
                    );
                });
            },
        );
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
     * 头像不用贴图：六个头像分别绑在场景节点上（`ui/home/heads-circle/*`），
     * 不在 `resources` 下，运行时 load 不到。这里用 Graphics 画圆 + 首字，
     * 已收服的用暖黄、未收服用灰 —— 一眼分得清"有"和"没有"就够，
     * 图鉴的职责是陈列状态，不是展示立绘（立绘在主界面场景里已经能看）。
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
        mkLabel(card, 'sub', `已收服 ${owned} / ${PETS.length}`, 18, INK_SOFT, 400, 28)
            .node.setPosition(0, 154, 0);

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
                    ? `S ×${cnt.S}    A ×${cnt.A}    B ×${cnt.B}    已通 ${cleared} / 8 关`
                    : `已通 ${cleared} / 8 关 · 结算会给 S / A / B，最好成绩记在这里`,
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

            /* 圆底：已收服暖黄、未收服灰。半径 42，直径 84 —— 
               手指点不到不是问题（这一格不可点），但要一眼看清"有没有"。 */
            cg.fillColor = got ? new Color(246, 206, 128, 255) : new Color(206, 198, 186, 255);
            cg.circle(0, 34, 42);
            cg.fill();
            cg.lineWidth = 3;
            cg.strokeColor = got ? new Color(176, 122, 60, 255) : new Color(158, 148, 136, 255);
            cg.circle(0, 34, 42);
            cg.stroke();

            /* 圆里放名字首字 / 问号。用 Label 而不是画图形：
               中文首字只有 Label 能保证对齐。 */
            mkLabel(cell, 'mark', got ? p.name.slice(0, 1) : '?', 34,
                    got ? new Color(92, 60, 24, 255) : new Color(120, 112, 104, 255), 80, 44)
                .node.setPosition(0, 34, 0);

            mkLabel(cell, 'name', got ? p.name : '未收服', 19,
                    got ? INK : INK_SOFT, 180, 26).node.setPosition(0, -22, 0);

            const pats = this.save.pats[p.id] || 0;
            mkLabel(cell, 'state', got ? `${heartText(pats)}  摸 ${pats}` : `还差 ${gap} 关`, 14,
                    got ? new Color(63, 125, 36, 255) : INK_SOFT, 180, 22)
                .node.setPosition(0, -48, 0);
            mkLabel(cell, 'line', got ? (PET_LINE[p.id] || '') : '', 13, INK_SOFT, 180, 20)
                .node.setPosition(0, -68, 0);
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
    private placeDispatchCard() {
        const badges = this.canvas.getChildByName('Badges');
        if (!badges || badges.getChildByName('DispatchCard')) return;
        const card = new Node('DispatchCard');
        card.parent = badges;
        const box = card.addComponent(UITransform);
        /* 高 116（不是 79+12=91）：卡片不只是"盖住绿板"，它还要把
           **派遣徽标（475）+ 文字底牌（到 544）**一起框进去，
           而且两者都得落在内圈浅描边里面 —— 内圈离边 8px + 2px 线宽，
           所以上下各让出 13px：460+13=473 ≤ 475，558-13=545 ≥ 544。 */
        const CW = 132, CH = 116;
        box.setContentSize(CW, CH);
        box.setAnchorPoint(0.5, 0.5);
        card.setPosition(406, -156, 0);

        const g = card.addComponent(Graphics);
        /* 和资源卡同一套：米白填充 + 深棕粗描边 + 内圈浅描边。
           圆角 22 = 资源卡（89×72，圆角 28）的同一比例：短边的 0.24 倍左右。
           改尺寸的时候圆角必须跟着算，固定 28 会让 108 高的卡看起来"角被啃掉了"。 */
        g.fillColor = CARD_FILL_SOLID;
        g.roundRect(-CW / 2, -CH / 2, CW, CH, 22);
        g.fill();
        g.lineWidth = 4;
        g.strokeColor = new Color(122, 80, 52, 255);
        g.roundRect(-CW / 2, -CH / 2, CW, CH, 22);
        g.stroke();
        g.lineWidth = 2;
        g.strokeColor = new Color(214, 176, 140, 210);
        g.roundRect(-CW / 2 + 8, -CH / 2 + 8, CW - 16, CH - 16, 16);
        g.stroke();

        card.setSiblingIndex(0);
    }

    private refreshTaskBtn() {
        const lb = this.canvas.getChildByName('Badges')
            ?.getChildByName('TaskBtn')
            ?.getChildByName('txt')
            ?.getComponent(Label);
        if (!lb) return;
        const n = claimableCount(this.save);
        lb.string = n > 0 ? `任务 ${n}` : '任务';
    }

    private openTasks() {
        const n = claimableCount(this.save);
        this.openSheet('任务', n > 0 ? `${n} 件可以领 · 做完就领，不每天刷新` : '做完就领，不每天刷新', (card) => {
            TASKS.forEach((t, i) => {
                const phase = taskPhase(this.save, t.id);
                const mark = phase === 'claimed' ? '已领' : phase === 'ready' ? '领取' : '未完成';
                this.mkRow(card, t.id, t.name, `${t.desc} · ${t.reward}`, mark, 0, 96 - i * 50, () => {
                    this.act(claimTask(this.save, t.id), () => this.openTasks());
                }, phase === 'ready', 46);
            });
        });
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
    console.log('[HomeRuntime] 已接管主界面：宠物待机 / 点击反馈 / 出发卡 全部就绪');
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
