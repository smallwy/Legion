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
import { loadSave, saveSave } from './config/SaveData';
import type { SaveState } from './config/SaveData';
import { SATIETY } from './config/BattleConfig';
import {
    MEALS, RECIPES, PET_LINE, DISPATCH_SEC, DISPATCH_CAP,
    ENERGY_MAX, ENERGY_COST,
    feed, craft, recordPat, startDispatch, collectDispatch, peekDispatch,
    toggleMute, toggleCrisp, heartText, canDispatch,
    settleEnergy, spendEnergy, TASKS, taskPhase, claimTask, claimableCount,
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
 * 宠物领地（设计坐标 0~1280，取自 game.src.html 的 PETS.roam，唯一真值）
 *
 * 初始只解锁砂糖，它独占房子前那片草地（120~392），所以领地给得宽，
 * 走动才看得出来。其余五只等解锁后按各自位置收窄，避免两只走到一起。
 * 两条领地不许重叠：重叠就必然出现「走两步贴在一起」。
 * -------------------------------------------------------------------------- */
const PET_ROAM: Record<string, [number, number]> = {
    '砂糖': [120, 392],
    '年糕': [288, 358],
    '雪团': [472, 532],
    '团子': [676, 746],
    '豆奶': [862, 932],
    '星屑': [1106, 1162],
};

/**
 * 六只的落脚点。脚底锚点，坐标是画布中心系。
 *
 * 都站在屋前那条空地上，左右错开、深浅只差二十像素。
 * 第一只如果贴在前景大花里，会比房子还抢眼；后面解锁的再排成一排，
 * 就成了贴在镜头前的贴纸。空地装得下以后再来的同伴。
 */
/**
 * 草地上只站当前这一只。脚底锚点，画布中心系。
 * 落在屋前空地、灶台和告示板之间，不挡门，也不站进花里。
 */
const LAWN_SPOT: [number, number] = [170, -168];

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
    /** 步频相位。1 = 迈一步；24 只脚交替靠它算 */
    step: number;
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
        const settled = settleEnergy(this.save, Date.now());
        if (settled !== this.save) this.commit(settled);
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
        const BADGE_W = 47, BADGE_H = 48;
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

        const lead = PETS.find((p) => s.cleared >= p.at);
        const tipTxt = this.canvas.getChildByName('HUD')
            ?.getChildByName('HudTip')
            ?.getChildByName('txt')
            ?.getComponent(Label);
        if (tipTxt && lead) tipTxt.string = `${lead.name} 在院子里`;

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

        /* ---- 出门按钮副标题：原来烘死在 Label 里写着"带砂糖" ---- */
        const go = this.canvas.getChildByName('Dock')?.getChildByName('Btn-Go');
        const gl = go?.getChildByName('line')?.getComponent(Label);
        if (gl) {
            gl.overflow = Label.Overflow.SHRINK;
            gl.string = `能量 ${s.energy}`;
        }
        this.refreshTaskBtn();

        /* ---- 饱食度：与战斗同一个 0~100 的数 ---- */
        this.refreshSatiety();
    }

    /** 果子 / 材料 / 吧唧排到右上，给院子中间和左下的宠物留空。 */
    private placeResources() {
        const dock = this.canvas.getChildByName('Dock');
        if (!dock) return;
        const names = ['Res-Apple', 'Res-Log', 'Res-Coin'];
        const cards: { n: Node; ut: UITransform }[] = [];
        for (const name of names) {
            const n = dock.getChildByName(name);
            const ut = n && n.getComponent(UITransform);
            if (n && ut) cards.push({ n, ut });
        }
        const gap = 8;
        const right = 568;
        const top = 346;
        const total = cards.reduce((s, c) => s + c.ut.contentSize.width, 0) + gap * Math.max(0, cards.length - 1);
        let left = right - total;
        let cardH = 72;
        for (const c of cards) {
            const w = c.ut.contentSize.width;
            cardH = c.ut.contentSize.height;
            c.n.setPosition(left + w * c.ut.anchorX, top - cardH * (1 - c.ut.anchorY), 0);
            left += w + gap;
        }

        /* 提示条原来横在资源卡上面。挪到这一排的下沿，避免和果子叠在一起。 */
        const tip = this.canvas.getChildByName('HUD')?.getChildByName('HudTip');
        const tut = tip && tip.getComponent(UITransform);
        if (tip && tut) {
            const tw = tut.contentSize.width;
            const th = tut.contentSize.height;
            const tipTop = top - cardH - 8;
            tip.setPosition(
                right - tw * (1 - tut.anchorX),
                tipTop - th * (1 - tut.anchorY),
                0,
            );
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

        /* ⚠ 必须快照：下面会往 children 里加节点，直接遍历原数组会无限递归 */
        for (const n of root.children.slice()) {
            if (n.name.indexOf('-hot') >= 0) continue;
            /* 存档说了算：场景把六只都预置好了，但只有解锁的该出现在草地上。
               未解锁的连热区都不建 —— 一只看不见的宠物能点出 toast 是 bug。 */
            const def = PETS.find((p) => p.name === n.name);
            const lead = PETS.find((p) => this.save.cleared >= p.at);
            const on = !!def && !!lead && def.id === lead.id;
            n.active = on;
            if (!on) continue;

            n.setPosition(LAWN_SPOT[0], LAWN_SPOT[1], 0);
            const roam = PET_ROAM[n.name] ?? [120, 392];
            const ut = n.getComponent(UITransform);
            const petH = ut ? ut.contentSize.height : 84;

            const rt: PetRt = {
                node: n,
                baseY: n.position.y,
                left: lx(roam[0]),
                right: lx(roam[1]),
                /* 深度范围：往上是"走远"，往下是"走近"。正视图角色朝镜头走才成立，
                   横向长距离位移无论怎么调都会读成"贴纸在滑"。 */
                far: -20,
                near: 8,
                ph: rand(0, Math.PI * 2),
                dur: rand(2.8, 3.7),
                moving: false,
                /* 首次延迟错开，避免一进场景所有宠物同时起步 */
                wait: rand(0.6, 2.2),
                fx: 0, fy: 0, tx: 0, ty: 0, wt: 0, wd: 1, yOff: 0,
                dir: 1,
                step: rand(0, 1),
                pop: 0,
                down: false,
                sy: 1, sx: 1, rot: 0,
            };
            this.pets.push(rt);

            /* 热区挂在宠物**节点下**，跟着一起动。
               不接管缩放 —— 步态和按下蹲下都走 scale，两个 tween 抢同一通道必然打架。 */
            const hot = new Node(`${n.name}-hot`);
            hot.parent = n;
            hot.addComponent(UITransform).setContentSize(HOT_MIN, HOT_MIN);
            hot.setPosition(0, petH / 2, 0);

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
    }

    /**
     * 起步走一段。**当前没有调用方。**
     *
     * 单帧正面立绘试过三种动法，都站不住：
     *   横移 → 贴纸在滑；蹦跳 → 撒欢；朝镜头走近走远 → 上下一窜，看起来还是跳。
     * 行走序列帧（规格见 §14.4）补上之前，宠物站在原地，只留呼吸。
     * 这段留着，是为了帧到了以后把 `tickPet` 里那一行调用接回去，而不是重写领地夹取。
     */
    private startWalk(p: PetRt) {
        const curX = p.node.position.x;

        let tx = curX;
        let ty = p.yOff;

        if (Math.random() < 0.6) {
            /* 前后：深度变化，走近还会略微变大 */
            ty = rand(p.far, p.near);
            tx = clamp(curX + rand(-26, 26), p.left, p.right);
        } else {
            /* 横向：短距离。距离一长就会重新变成"滑"，所以压到 40~90px */
            const dist = rand(40, 90) * (Math.random() < 0.5 ? -1 : 1);
            tx = clamp(curX + dist, p.left, p.right);
            /* ⚠ 深度必须夹回地面带：横走这一支只是"顺带偏一点"，
               不夹的话每段 ±5px 累加，30 秒就能漂到离草地 250px 的地方。 */
            ty = clamp(p.yOff + rand(-5, 5), p.far, p.near);
        }
        /* 两条支路都收一次口，保证永远站在草地这条带上 */
        ty = clamp(ty, p.far, p.near);

        const d = Math.hypot(tx - curX, ty - p.yOff);
        /* 走不出东西就换一个，不要把"原地抖"当成一次移动 */
        if (d < 12) { p.wait = 0.4; return; }

        p.fx = curX; p.fy = p.yOff;
        p.tx = tx; p.ty = ty;
        p.wt = 0;
        /* 速度 28~40 px/s：人的步行速度换算到 84px 高的角色上大约就是这个区间。
           再快就没有"走"的节奏了，再慢会读成"飘"。 */
        p.wd = clamp(d / rand(28, 40), 0.7, 3.2);
        p.dir = tx >= curX ? 1 : -1;
        p.moving = true;
    }

    private tickPet(p: PetRt, dt: number) {
        /* 节点被销毁后，`position` 会返回 null（读它立刻抛 "reading 'x'"）。
           这里再兜一层 —— 就算哪天 dispose 漏调，也只会少动一只宠物，不会崩整帧。 */
        if (!p.node || !p.node.isValid || !p.node.active) return;

        const pos = p.node.position;
        if (!pos) return;

        let x = pos.x;
        let yOff = p.yOff;
        /** 行走强度 0~1：用来让"起步/停步"的碎步幅度自然衰减，而不是开关式跳变 */
        let gait = 0;

        if (p.moving) {
            p.wt += dt;
            const k = clamp(p.wt / p.wd, 0, 1);

            /* smoothstep：两端速度为 0，天然对上"起步/停步"那两拍。
               线性走会让起步瞬间像被推了一把。 */
            const e = k * k * (3 - 2 * k);
            x = p.fx + (p.tx - p.fx) * e;
            yOff = p.fy + (p.ty - p.fy) * e;
            p.yOff = yOff;

            /* 归一化速度（smoothstep 的导数，峰值 1.5）
               步频跟着速度走 —— 匀速步频 + 变速位移 = 脚在原地打滑。 */
            const spd = 6 * k * (1 - k);
            gait = clamp(spd * 0.75, 0, 1);
            p.step += dt * clamp(spd * 2.4, 0.35, 2.2);

            if (k >= 1) {
                p.moving = false;
                /* 走完歇 0.9~2.6s：一直走像机器，停太久又像卡住 */
                p.wait = rand(0.9, 2.6);
            }
        } else {
            /* 不调用 startWalk。没有行走帧时，任何位移都会被读成滑或者跳。 */
            p.wait = 0;
        }

        /* ---- 碎步：每步一次起伏 + 每步一次左右摇摆 ----
           起伏只有 1.2px、摇摆 1.5°，刻意做得很小 —— 大一点就会像"跳"。 */
        const ph = p.step * Math.PI * 2;
        const bob = Math.sin(ph) * 1.2 * gait;
        const sway = Math.sin(p.step * Math.PI) * 1.5 * gait * p.dir;

        /* **静止时完全不动。**
           上一版给了 1.5px、周期 0.9~2.2 秒的"呼吸"，本意是让院子有生气；
           实际读起来是"宠物飘在水上" —— 用户原话是"宠物在场景晃动不要了"。
           锚点在脚底 (0.5, 0)，任何竖直位移都会被读成**脚离地**，1.5px 也够露馅，
           因为没有影子跟着一起动。
           交互反馈（点一下弹起来 + 冒心）保留：那是"回应"，不是"晃动"。 */
        const breath = 0;

        /* 点击弹跳：抛物线包络，跟碎步的 y 通道叠加 */
        let pop = 0;
        if (p.pop > 0) {
            p.pop = Math.max(0, p.pop - dt);
            pop = Math.sin((1 - p.pop / 0.42) * Math.PI) * 10;
        }

        /* 近大远小：往远处走缩一点、往近处走放大一点。
           幅度只给 ±3% —— 再大就会暴露"这只是个贴纸在缩放"。 */
        const depth = clamp(1 + yOff * 0.0016, 0.965, 1.035);

        /* 每步一次轻微竖向压缩，落脚那一下有重量 */
        let syT = depth * (1 - Math.max(0, Math.sin(ph)) * 0.012 * gait);
        let sxT = depth * (1 + Math.max(0, Math.sin(ph)) * 0.006 * gait);

        /* 按住 = 蹲下。和步态共用 scale 通道，所以在这里合并，不另开一条 tween。 */
        if (p.down) { syT *= 0.93; sxT *= 1.06; }

        const kk = smoothK(dt, 30);
        p.sy += (syT - p.sy) * kk;
        p.sx += (sxT - p.sx) * kk;
        p.rot += (sway - p.rot) * kk;

        p.node.setPosition(x, p.baseY + yOff + bob + breath + pop, pos.z);
        p.node.setScale(p.sx, p.sy, 1);
        p.node.angle = p.rot;
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

        /* —— 主行动：出门。收到右下角，不再横在院子下沿 —— */
        const go = root.getChildByName('Btn-Go');
        if (go) {
            const gut = go.getComponent(UITransform);
            if (gut) {
                gut.setContentSize(248, 76);
                /* 锚点是左上。右缘离屏幕 20，下缘离屏幕 18。告示板在它上方。 */
                go.setPosition(640 - 20 - 248, -360 + 18 + 76, 0);
            }
            const txt = go.getChildByName('txt');
            if (txt) txt.setPosition(108, -20, 0);
            const line = go.getChildByName('line');
            if (line) {
                line.setPosition(20, -48, 0);
                const lut = line.getComponent(UITransform);
                if (lut) lut.setContentSize(200, 16);
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
                ar.setPosition(214, -36, 0);
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
            op.opacity = 140;

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
        this.tickEnergy(dt);

        for (const p of this.pets) this.tickPet(p, dt);

        for (const p of this.presses) {
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
        const enough = s.energy >= ENERGY_COST;
        mkLabel(card, 'sub',
            `能量 ${s.energy}/${ENERGY_MAX} · 出发消耗 ${ENERGY_COST} · 回来按这一趟的收成给奖励`,
            16, enough ? INK_SOFT : new Color(176, 72, 48, 255), 520, 36)
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
        mkLabel(btn, 'txt', enough ? '出  发' : '能量不足', 24, new Color(96, 58, 28, 255), 180, 40);

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

    private energyAcc = 0;

    /** 派出的那只暂时离开草地，收回来再出现 */
    private syncLawn() {
        const away = this.save.dispatch ? this.save.dispatch.id : '';
        const lead = PETS.find((p) => this.save.cleared >= p.at);
        for (const p of this.pets) {
            const def = PETS.find((x) => x.name === p.node.name);
            if (!def) continue;
            p.node.active = !!lead && def.id === lead.id && def.id !== away;
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
            this.closeSheet();
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

    private act(r: { ok: boolean; say: string; next?: SaveState }, reopen: () => void) {
        if (r.ok && r.next) {
            this.commit(r.next);
            this.applyPrefs();
        }
        /* 失败也重画：派遣的倒计时、背包数字才跟得上刚点的那一下 */
        reopen();
        this.toast(r.say);
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
        const settled = settleEnergy(this.save, Date.now());
        if (settled !== this.save) this.commit(settled);
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
        /* 点击区 84×76：比视觉大一圈，因为底下是"牌子上的一行字"，
           看着小但必须好点。视觉尺寸由 Label 自己定，和点击区分离。 */
        box.setContentSize(84, 76);
        box.setAnchorPoint(0.5, 0.5);
        /* 路标牌**中间那块**木板的正文中心。
           用 tools/_grid-crop.js 在原图坐标系上量（不是看缩放后的截图）：
             整块板 y 250..285、x 168..256；
             去掉左侧箭头尖（x<190）和右侧缺口（x>252），
             可放字的净区是 x 190..252 / y 254..282，中心 (221, 268)；
             转到以画布中心为原点的 Cocos 坐标 —— 中心 (-419, 90)。
           上一版写 (-416, 101)：右 3px、上 9px，字压在木牌的上沿高光线上，
           看起来像"贴纸没贴正"而不是"牌子上写着字"。
           实测校验：渲染后按墨色 (86,50,24) 取掩膜，字形框 x 210..231 /
           y 261..272，中心 (220.5, 266.5) —— 与净区中心差 1.5px，收工。 */
        btn.setPosition(-419, 90, 0);

        /* **不画底，字直接写在木牌上。**
           上一版是一个 72×36 的橙色胶囊浮在牌子右边：既不在牌子上
           （用户第 1 条"任务我想在牌子上"），又正好压在"去苔原"那个
           圆形徽标的位置上（用户第 2 条"很多重了"）。两条说的是同一件事。

           现在没有底板：木牌本来的木色就是背景，字是深棕，
           读作"牌子上写着任务"，而不是"一个按钮贴在牌子旁边"。

           按下反馈不能再用缩放（透明底缩放看不出来），改成在牌面上
           压一层暖光 —— 相当于"按下去的时候那块木头被照亮了一点"。 */
        /* 按下时的暖光块**不能超出木牌正文**：正文只有 62px 宽，
           上一版的 84px 会盖到木牌两侧的描边上，读作"牌子被人用荧光笔涂了"。
           66×24 正好比正文字宽 4px，四边都在木头里。 */
        const g = btn.addComponent(Graphics);
        const repaint = (a: number) => {
            g.clear();
            g.fillColor = new Color(255, 244, 206, a);
            g.roundRect(-33, -12, 66, 24, 10);
            g.fill();
        };
        repaint(0);

        /* 15px：木牌正文净高 28px，15px 的字形实高约 15px（占 54%）。
           13px 只占 43%，在 1280×720 的实机上看是"木牌上有个小logo"，
           不是"木牌上写着字"。再加就顶到上下描边了。 */
        mkLabel(btn, 'txt', '任务', 15, new Color(86, 50, 24, 255), 62, 20);

        btn.on(Node.EventType.TOUCH_START, () => repaint(64));
        btn.on(Node.EventType.TOUCH_CANCEL, () => repaint(0));
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            repaint(0);
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

    private tickEnergy(dt: number) {
        this.energyAcc += dt;
        if (this.energyAcc < 1) return;
        this.energyAcc = 0;
        const next = settleEnergy(this.save, Date.now());
        if (next !== this.save) this.commit(next);
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
     * 进入战斗。能量够才扣；场景没打开就不扣。
     *
     * 用 tween 的 call 切场景，而不是 setTimeout：出发卡有 0.18s 淡出，
     * 立刻 loadScene 会把动画连同场景一起销毁（"闪一下"）。
     */
    private launchBattle() {
        const paid = spendEnergy(this.save, Date.now());
        if (!paid.ok) {
            this.toast(paid.say);
            return;
        }
        const ticket = paid.next;
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
                    this.commit(ticket);
                    director.runScene(sc);
                    return;
                }
                console.warn('[HomeRuntime] 按 uuid 载入战斗失败，回退 loadScene：', err);
                director.loadScene('Battle', (e2) => {
                    if (e2) {
                        console.error('[HomeRuntime] 进入战斗失败：', e2);
                        this.toast('苔原没打开，能量还在');
                        return;
                    }
                    this.commit(ticket);
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
