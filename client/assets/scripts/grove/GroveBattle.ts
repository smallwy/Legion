/**
 * GroveBattle —— 战斗场景的**推球玩法**挂载点（雪人兄弟式）
 * ============================================================================
 *
 * 为什么是这个形状：
 *   推球玩法（物理/关卡/坡/波次/BOSS/冰壳/球）在 client/prototype/grove.html 里
 *   已经调了八轮，那 6800 行是唯一跑通过的手感来源。
 *   把规则重写成 Cocos 组件 = 把八轮调参全部作废。
 *
 *   所以这里不重写玩法，只做三件事：
 *     ① 开一块 960x600 的离屏 canvas 交给 GroveRuntime 原样绘制
 *     ② 把这块 canvas 作为 DOM 层铺在 Cocos 画布上面
 *     ③ 每帧 groveTick + groveRender
 *
 * 【为什么不用 Sprite 贴纹理 —— 2026-10-21 黑屏事故复盘】
 *   第一版走的是「离屏 canvas → Texture2D.uploadData → 全屏 Sprite」。
 *   进 Cocos 后纯黑，但脚本日志全打出来了（说明没崩，是画不出来）。
 *   对着 Engine 3.8.8 源码查出两条硬约束，两条都不满足：
 *     ① `RenderRoot2D` 源码原话："所有的 2D 渲染对象需在 RenderRoot 节点下才可以被渲染"。
 *        而 Battle.scene 里 **一个 Canvas / RenderRoot2D 都没有**（只有 Scene + BattleRoot），
 *        Sprite 挂在没有渲染根的节点上 → batcher2D 根本不收集它。
 *     ② 相机默认 `visibility = CAMERA_DEFAULT_MASK`，而它是
 *        `Layers.makeMaskExclude([UI_2D, GIZMOS, EDITOR, ...])` —— **排除 UI_2D**。
 *        自己 new 的相机默认看不见 UI_2D 层的东西。
 *   要么补 Canvas + 改相机可见层 + 处理 Canvas 抢管 orthoHeight 那一串，
 *   要么换条不碰 2D 管线的路。选后者：DOM 叠加。
 *
 *   代价（如实说）：
 *   - 只有 Web 平台能跑（依赖 document）。原生/小游戏得把 ctx 调用换成 Graphics。
 *   - 它不是"Cocos 渲染出来的"，是叠在 Cocos 画布上的一层 DOM。
 *     好处是画面和原型**像素级一致**（同一个 canvas、同一套绘制代码），没有纹理上传的模糊。
 *   - 以后真要上原生，那是重写渲染层（~2000 行 ctx 调用），本文件的挂载逻辑照样能用。
 *
 *   玩法改在 grove.html，改完跑：
 *     python client/tools/extract_grove_runtime.py
 *     node   client/tools/grove-runtime-check.js
 *
 * 键位和原型完全一致（键盘监听在 GroveRuntime 内部的 window 上，和原型同一份代码）：
 *   ←→/AD 移动 · 空格/W/↑ 跳 · J 喷裹 · K 撞飞 · 走进球里顶它 推球
 *   Shift 按住看预测线 · R 重打 · Esc 收工回主界面
 */
import {
    _decorator, Component, Node, Camera, Color,
    director, assetManager, SceneAsset, resources, ImageAsset,
    input, Input, KeyCode, EventKeyboard,
} from 'cc';
import {
    groveAttachCanvas, groveBoot, grovePointer, groveRender, groveSetArt,
    groveSetExitHook, groveTick, GROVE, setSnowlabEntry,
} from './GroveRuntime';
import { battleSwitch, battleSetCurrent } from '../BattleSwitch';
import { loadSave, saveSave, LEVEL_COUNT } from '../config/SaveData';
import { heroIndexOf } from '../config/Roster';
import { applyRunReward, payoutFromRun, judgeTripGoals, tripReward } from '../config/HomeBiz';

const { ccclass } = _decorator;

/** 原型的世界尺寸，必须和 GroveRuntime 里的 W/H 一致 */
const W = 960;
const H = 600;

/** Home 场景的资产 uuid（取自 Home.scene.meta），"收工"回主界面用 */
const HOME_UUID = 'ce855542-8bb9-44de-8e9d-20c436ed206f';

/** DOM 叠加层的 z-index。Cocos 画布默认 0，取 10 足够压住。 */
const STAGE_Z = '10';

/** 六只宠物的 heroId（和 GroveRuntime 的 HEROES[].id 一一对应） */
const HERO_IDS = ['cat', 'dog', 'ham', 'rab', 'ox', 'fox'];

/**
 * 引擎键盘通道的**状态键**表（按住 / 松开，幂等）。
 *
 * 只放"按住才有效"的键。**按一下执行一次**的键（F2 跳关 / R 重打 /
 * [ ] 换屏 / Esc 收工 / Enter 继续）走下面的 CODE_NAME，交回运行时的
 * onKeyDown —— 那边已经有一份 40ms 去重守卫，双路进来只生效一次。
 *
 * 为什么非要分两张：状态键要的是"零延迟、每帧都读"，
 * 而动作键要的是"一份判断逻辑"。动作键也塞进这儿就等于在 Cocos 里
 * 再实现一遍跳关面板和收工流程 —— 那是第二份真值，迟早漂移。
 */
const KEY_MAP: Readonly<Record<number, string>> = {
    [KeyCode.ARROW_LEFT]: 'left', [KeyCode.KEY_A]: 'left',
    [KeyCode.ARROW_RIGHT]: 'right', [KeyCode.KEY_D]: 'right',
    [KeyCode.ARROW_UP]: 'jump', [KeyCode.KEY_W]: 'jump', [KeyCode.SPACE]: 'jump',
    [KeyCode.ARROW_DOWN]: 'down', [KeyCode.KEY_S]: 'down',
    [KeyCode.KEY_J]: 'atk',
    [KeyCode.KEY_K]: 'dash',
};

/**
 * keyCode（DOM 老值）→ `ev.code` 字符串。运行时内部用的是 `ev.code`，
 * 引擎给的是 `ev.keyCode`，这张表就是那道翻译。
 *
 * **只列"运行时按名字认、但不在 KEY_MAP 里"的键**：漏一个的症状是
 * "这个键在 Cocos 里按了没反应，在浏览器里正常" —— 极难从画面上判断。
 * 新增热键时两边都要看一眼。
 *
 * 顺带记一笔：**跳关面板是 F2，不是 F12**。F12 在浏览器和 Creator 里
 * 是开发者工具的快捷键，按键根本到不了页面。
 */
const CODE_NAME: Readonly<Record<number, string>> = {
    113: 'F2',
    219: 'BracketLeft', 221: 'BracketRight',
    82: 'KeyR', 69: 'KeyE', 76: 'KeyL',
    13: 'Enter', 27: 'Escape', 32: 'Space',
    37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
    49: 'Digit1', 50: 'Digit2', 51: 'Digit3',
    52: 'Digit4', 53: 'Digit5', 54: 'Digit6',
};

/**
 * 美术图清单：注入键 → resources 下的路径。
 *
 * 图是 client/tools/gen_grove_art.py 从 ui/home/ 收缩出来的副本
 * （立绘高 292、头像 96，合计约 1MB）。
 * 目录按用途分：`grove/pet/` `grove/head/` `grove/foe/` `grove/ui/` ——
 * 以前 28 张平铺在一个文件夹里，找图只能靠前缀扫。
 * 改任何一行都要跑 `node tools/check-resources.js`：路径写错**不会报错**，
 * 只会静默退回代码图形，画面变丑但看不出原因。
 *
 * 为什么不直接引用 ui/ 下的原图：那些文件主界面是**场景直连 spriteFrame**，
 * 而动过的才放进 resources 才能用 resources.load 动态加载。
 *
 * 加载失败只 warning、不中断 —— 绘制侧有回退分支，没图就画代码图形。
 */
const ART_MANIFEST: ReadonlyArray<readonly [string, string]> = [
    ...HERO_IDS.map((id) => ['pet-' + id, 'grove/pet/' + id] as const),
    ...HERO_IDS.map((id) => ['head-' + id, 'grove/head/' + id] as const),
    /* 敌人立绘（client/tools/prep_foes.py 产出，4x）。
       键名约定 foe-<FOES 的 id>；绘制侧靠 `artOf('foe-' + key)` 取，
       取不到就回退到三档色代码图形 —— 所以这里少一项也不会白屏，
       只会那一种敌人退回旧画法（画风断层又回来一格，但玩法不受影响）。 */
    ['foe-bug', 'grove/foe/bug'],
    ['foe-crow', 'grove/foe/crow'],
    ['foe-boar', 'grove/foe/boar'],
    ['foe-larva', 'grove/foe/larva'],
    ['ui-pip', 'grove/ui/pip'],
    ['ui-pip-on', 'grove/ui/pip-on'],
    ['ui-coin', 'grove/ui/coin'],
    // 战斗 HUD / 结算面板。这几张是"奶油风"的唯一来源 ——
    // 缺了它们 hudSkin() 会返回 cream: false，整块退回深色玻璃风，
    // 不会出现"奶白底 + 浅绿字"那种读不出来的组合。
    ['ui-tip', 'grove/ui/tip'],
    ['ui-cream', 'grove/ui/cream'],
    ['ui-prog', 'grove/ui/prog'],
    ['ui-res', 'grove/ui/res'],
    ['ui-belly', 'grove/ui/belly'],
    ['ui-btn', 'grove/ui/btn'],
    ['ui-ring', 'grove/ui/ring'],
    ['ui-star', 'grove/ui/star'],
    ['ui-arrow', 'grove/ui/arrow'],
    /* 出征页的玩法立绘（768×432，16:9）。缺了不白屏 —— 出征页会回退到
       简笔概念图，但那样和设计稿差得远，所以**这里必须和 GATES[].art
       同名同条数**（三条：古道 / 深巢 / 雪原推球）。 */
    ['gate-trail', 'grove/gate/trail'],
    ['gate-nest', 'grove/gate/nest'],
    ['gate-snow', 'grove/gate/snow'],
];

@ccclass('GroveBattle')
export class GroveBattle extends Component {
    private _cv: HTMLCanvasElement | null = null;
    /** 承载画布的 DOM 容器；收工/销毁时整块摘掉 */
    private _stage: HTMLDivElement | null = null;
    /** 本组件自己建的那台清屏相机。换手到推球时必须拆掉，理由见 onDestroy */
    private _camNode: Node | null = null;
    private _ready = false;
    /** 收工只入账一次。钩子和销毁都可能再进来 */
    private _paid = false;
    /** 上一帧的 grove phase，用来抓「刚通关」那一帧 */
    private _lastPhase = '';

    onLoad(): void {
        if (typeof document === 'undefined' || !document.createElement || !document.body) {
            /* **必须炸，不能 return。**（2026-10-27）
             *
             * 原来是 console.error + return：真机上进战斗是一整块黑屏，
             * 日志在打包后的控制台里根本没人看，现象等于"点了没反应"。
             * 这一层画不出来不是"降级"，是**这个平台完全没有画面** ——
             * 静默降级的代价是把「没实现」伪装成「坏了」。
             *
             * 为什么不在屏幕上弹一行字：弹字要 Canvas + RenderRoot2D + 相机可见层，
             * 而这套东西正好就是当初黑屏事故的两条硬约束（见文件头）。
             * 为了显示一句"不支持"去踩一遍那个坑，不如让引擎把栈打出来。 */
            console.error(
                '[GroveBattle] 当前平台没有 DOM（原生/小游戏）。推球目前只接了 Web 路径。',
            );
            throw new Error('[GroveBattle] 平台无 DOM：推球玩法尚未移植到原生渲染管线');
        }

        // 场景里一个相机都没有的话，渲染器每帧会刷 "no camera"。
        // 这台只负责清屏，不渲染任何东西（真正的画面在 DOM 层）。
        this._buildClearCamera();

        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;

        this._mountStage(cv);
        this._cv = cv;

        /* 先绑画布再开局：绘制要 ctx，beginRun 会立刻画一帧。 */
        groveAttachCanvas(cv);
        groveSetExitHook((kind) => this._backHome(kind));
        this._loadArt();

        /* **带着主界面选好的那只出门。**
         *
         * 这一行是「主界面解锁了五只，进战斗还是尖耳猫」那条链的最后一环。
         * 上一版这里是裸的 `groveBoot()` —— 不传 hero，运行时就用默认值 0，
         * 于是不管你在主界面选谁，场上永远是第一只。玩家读成
         * 「解锁有什么用」，而实际上中间只差这一次换算。
         *
         * 数据源只有一个：存档的 `active`。不另开一条跨场景通道 ——
         * **同一件事存两份必然漂移**（这个项目已经为这条交过两次学费）。
         * `heroIndexOf` 是 id → HEROES 下标的唯一换算点。
         */
        const save = loadSave();
        /* 第三个参数 fromHome = 先到出征页挑门。
         * **Cocos 里必须显式传**：原型的 FROM_HOME 是读 URL 的
         * `?from=home`，而真机上没有 URL，那个判断恒为 false ——
         * 出征页在原型里出现、在真机上不出现，同一个按钮两个结果。 */
        groveBoot(heroIndexOf(save.active), undefined, true);

        /* **第三扇门（雪原推球）的出口。**
         *
         * 原型里这一扇门是 `location.href = "snowlab.html?from=grove"`，
         * 而那行在 Cocos 里有两个问题：
         *   ① 构建产物里**没有 snowlab.html** —— 它是个组件，不是页面；
         *   ② `location.href = 一个不存在的路径` **不抛异常**，所以打包后
         *      点这扇门的表现是白页，控制台一片安静。
         * 原型里跑得好好的、打包才炸，这类问题只在真机上出现，测试全绿也没用。
         *
         * 换成切组件：`battleSwitch` 会先销毁本组件（摘 DOM 层 + 拆相机），
         * 死透之后再把 SnowlabBattle 挂到同一个 BattleRoot 上。
         */
        setSnowlabEntry(() => { battleSwitch('snowlab'); });
        /* 登记"当前活着的是我"——换手的起点靠这个，不靠外部去猜。
           必须排在 setSnowlabEntry **之后**：登记会把 switching 复位，
           反过来写的话"点门那一瞬间还处于换手中"会被这条登记提前放行。 */
        battleSetCurrent('grove', this);

        this._bindCocosInput();
        this._ready = true;

        console.log(
            '[GroveBattle] 推球已接管战斗场景（DOM 叠加层）—— ' +
            '←→ 移动 / 空格 跳 / J 喷裹 / K 撞飞 / 走进球里顶它推球 / Shift 看预测线 / Esc 收工',
        );
    }

    update(dt: number): void {
        if (!this._ready) return;
        // 和原型 frame() 同一个上限：切标签页回来不要一次跳半秒
        groveTick(Math.min(dt, 0.034));
        groveRender();
        this._syncOnClear();
    }

    /**
     * 通关瞬间就把进度写回主界面。
     *
     * `_syncProgressToHome` 原来只在「收工回主界面」时调（`_backHome`），
     * 而推关模式是 grove 内部的 `nextLevel()` 直接 `beginRun(stage+1)`，
     * **根本不经过 exitHook**。于是玩家连过五关、一只只伙伴到家，
     * 主界面存档的 `cleared` 还停在进战斗前那个旧值 ——
     * 这就是「解锁了但主界面没有」的第二条断点（第一条是 bindPets 的判据）。
     *
     * 挂在 `phase` 的上升沿而不是每帧调：两个回写函数内部都有 no-op 保护，
     * 但每帧 JSON 序列化一次存档是纯浪费。
     */
    private _syncOnClear(): void {
        const S = (GROVE as any)?.S;
        const ph = S ? String(S.phase || '') : '';
        if (ph === this._lastPhase) return;
        this._lastPhase = ph;
        if (ph !== 'clear') return;
        this._syncProgressToHome();
        this._syncRanksToHome();
    }

    /* ------------------------------------------------------------------ 美术 */

    /**
     * 把美术图喂给运行时。
     *
     * 运行时是纯 canvas 2D，要的是"能被 drawImage 直接吃掉"的东西 ——
     * HTMLImageElement / ImageBitmap / HTMLCanvasElement 都行，
     * 所以从 ImageAsset 里把底层数据取出来，取不到就用 nativeUrl 再拉一次。
     *
     * 失败不抛、不中断：运行时那边 artOf() 会因为拿不到图而走代码图形。
     */
    private _loadArt(): void {
        for (const [key, path] of ART_MANIFEST) {
            resources.load(path, ImageAsset, (err: Error | null, asset: ImageAsset) => {
                if (err || !asset) {
                    console.warn('[GroveBattle] 美术图没加载上，回退代码图形：' + path, err);
                    return;
                }
                const drawable = this._toDrawable(asset);
                if (!drawable) {
                    console.warn('[GroveBattle] 美术图取不到可绘制数据：' + path);
                    return;
                }
                groveSetArt(key, drawable);
            });
        }
    }

    /**
     * ImageAsset → 可绘制对象。
     *
     * 正常路径：Web 上 `.data` 就是解码好的 HTMLImageElement，直接能用。
     * 兜底路径：某些平台上 `.data` 是 ArrayBuffer（压缩纹理），那就用
     * `nativeUrl` 重新 new Image 拉一遍 —— 图本身就在包内，不会再走网络。
     * 返回值可能还没解码完（width 为 0），运行时 artOf() 会跳过它，解码完自动生效。
     */
    private _toDrawable(asset: ImageAsset): unknown {
        const raw = (asset as unknown as { data?: unknown; _data?: unknown }).data
            ?? (asset as unknown as { _data?: unknown })._data;
        if (raw && typeof (raw as { width?: number }).width === 'number'
            && (raw as { width: number }).width > 0) {
            return raw;
        }

        const url = (asset as unknown as { nativeUrl?: string; _nativeUrl?: string }).nativeUrl
            ?? (asset as unknown as { _nativeUrl?: string })._nativeUrl;
        if (url && typeof Image !== 'undefined') {
            const img = new Image();
            img.src = url;
            return img;
        }
        return null;
    }

    /* ------------------------------------------------------------------ 骨架 */

    /**
     * 只清屏的相机。
     * 故意不建 Canvas/Sprite：Battle.scene 没有 RenderRoot2D，
     * 走 Cocos 2D 管线要额外补一堆东西，得不偿失（见文件头复盘）。
     *
     * 节点要留引用并在 onDestroy 里拆掉：换成推球时同一个 BattleRoot 上
     * 会再挂一台 SnowlabClearCamera，两台同参数相机同时活着时，
     * 后建的那台清屏会把先画的内容盖掉 —— 表现是"画面闪一下就定住"。
     */
    private _buildClearCamera(): void {
        const camNode = new Node('GroveClearCamera');
        this.node.addChild(camNode);
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.orthoHeight = H / 2;
        cam.near = 1;
        cam.far = 2000;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        // 深墨绿：和原型留边色一致，露出来时读作画框
        cam.clearColor = new Color(14, 24, 18, 255);
        camNode.setPosition(0, 0, 1000);
        this._camNode = camNode;
    }

    /**
     * 把画布铺在 Cocos 画布上面。
     *
     * 尺寸交给浏览器算：canvas 的固有尺寸是 960x600，配 max-width/max-height 100%
     * 之后浏览器会按比例收缩（替换元素规则），永远不会裁掉左右或上下，
     * 窗口比例不对时两侧/上下留深色边 —— 和原型里 fit() 的行为一致。
     */
    private _mountStage(cv: HTMLCanvasElement): void {
        const doc = document;

        const stage = doc.createElement('div');
        stage.id = 'grove-stage';
        const s = stage.style;
        s.position = 'fixed';
        s.left = '0';
        s.top = '0';
        s.width = '100%';
        s.height = '100%';
        s.display = 'flex';
        s.alignItems = 'center';
        s.justifyContent = 'center';
        s.background = '#0E1812';
        s.zIndex = STAGE_Z;
        s.overflow = 'hidden';
        // 别让浏览器把拖动/长按手势当成滚动
        (s as unknown as { touchAction: string }).touchAction = 'none';

        cv.style.display = 'block';
        cv.style.maxWidth = '100%';
        cv.style.maxHeight = '100%';
        cv.style.width = 'auto';
        cv.style.height = 'auto';

        stage.appendChild(cv);
        doc.body.appendChild(stage);
        this._stage = stage;

        this._bindPointer(cv);
    }

    /**
     * 鼠标 / 触摸 → 运行时的 `grovePointer`。
     *
     * **这条线之前是断的。** 原型里是 `cv.addEventListener('mousedown', ...)`，
     * 抽取成运行时的时候那两行被换成了具名函数 `onCanvasMove/onCanvasDown`，
     * 事件绑定本身没有生成 —— 而 GroveBattle 也从没调用 grovePointer。
     * 结果：键盘全通、鼠标全哑 —— 结算界的两个按钮点了没反应，选人界面点不动。
     * 键盘能玩，所以这个洞一直没暴露出来，直到玩家真的去点"收工回家"。
     *
     * 坐标必须自己换算：canvas 固有尺寸 960×600，被 max-width/height 收缩后
     * 显示尺寸会小一圈，直接拿 offsetX 得到的是**显示像素**，不是世界坐标。
     * 用 getBoundingClientRect 的宽高做比例换算，顺带把 DPR 的影响抵消掉。
     */
    private _bindPointer(cv: HTMLCanvasElement): void {
        const toWorld = (ev: MouseEvent | PointerEvent): { x: number; y: number } => {
            const r = cv.getBoundingClientRect();
            if (!r.width || !r.height) return { x: -1, y: -1 };
            return {
                x: (ev.clientX - r.left) * (W / r.width),
                y: (ev.clientY - r.top) * (H / r.height),
            };
        };

        cv.addEventListener('pointermove', (ev) => {
            const p = toWorld(ev);
            grovePointer('move', p.x, p.y);
        });

        // pointerdown 同时覆盖鼠标和触摸。不用 click —— click 要等 up，
        // 结算界"点了就有反应"比"点了要等抬手指"更符合预期。
        cv.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            const p = toWorld(ev);
            grovePointer('down', p.x, p.y);
            this._handAtk(true);
        });

        /* 松开、滑出画面、系统打断（来电 / 切应用）都要收枪。
           漏一个，角色就会一直自己喷 —— 玩家只会觉得"游戏疯了"。 */
        const release = (): void => this._handAtk(false);
        cv.addEventListener('pointerup', release);
        cv.addEventListener('pointercancel', release);
        cv.addEventListener('pointerleave', release);
        window.addEventListener('blur', release);
    }

    /**
     * 指针施法：战斗中按住鼠标 / 手指 = 连喷。
     *
     * 这是给键盘留的**兜底通路**。玩家反馈"能走能跳就是打不了"，
     * 而 pointer 这条路是确定通的（选人界面、结算按钮都靠它）。
     * 键盘能喷就用键盘，键盘哑了鼠标照样能把一整关打完。
     *
     * 只在 play 阶段生效：点结算按钮、点选人卡片都不会被当成开火。
     */
    private _handAtk(on: boolean): void {
        const S = (GROVE as any).S;
        if (!S || !S.keys) return;
        if (on && S.phase !== 'play') return;
        S.keys.atk = on;
    }

    /**
     * 引擎自己的键盘通道 —— 和运行时内部那套 window 监听**并存**，不是替换。
     *
     * DOM 那条是运行时自带的（原型里就靠它，走捕获阶段），但进了 Cocos 之后
     * keydown 可能压根到不了页面：编辑器 Game View 的焦点、宿主页面的快捷键拦截，
     * 都能把它吃掉。症状不是"全哑"，而是**能走能跳、按 J 喷不出来** ——
     * 走跳是引擎另一条路径转发的，喷只认 S.keys.atk 这一张表。
     *
     * 引擎的 input 由 Cocos 自己注册在 canvas 上，只要有焦点就一定收得到。
     */
    private _bindCocosInput(): void {
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown);
        input.on(Input.EventType.KEY_UP, this._onKeyUp);
    }

    /**
     * 按住不放时引擎会不停重发 KEY_DOWN，但 EventKeyboard 上**没有 `repeat` 字段**。
     * 运行时里的挑一屏 / 跳关面板都靠 `!ev.repeat` 挡重发（不挡的话按住方向键
     * 一秒连发 30 次，光标从第 5 屏直接飞到第 27 屏），所以这个状态得我们自己记。
     */
    private _held = new Set<number>();

    private _onKeyDown = (ev: EventKeyboard): void => {
        const S = (GROVE as any).S;
        const k = KEY_MAP[ev.keyCode];

        if (k && S && S.keys && S.phase === 'play') {
            // 状态键的快通道：直接写键表，不走运行时那把大 switch。
            if (!S.keys[k]) S.press[k] = true;
            S.keys[k] = true;
            this._held.add(ev.keyCode);
            return;
        }

        /* 其余一切键都交回运行时：
           - play 里的 F2 / [ ] / R / Esc（KEY_MAP 里没有）
           - 所有非 play 阶段的方向键、回车、Esc（挑一屏、跳关面板、结算）
           一份判断逻辑，两个入口。 */
        const code = CODE_NAME[ev.keyCode];
        if (!code) return;
        const repeat = this._held.has(ev.keyCode);
        this._held.add(ev.keyCode);
        (GROVE as any)._key(code, repeat);
    };

    private _onKeyUp = (ev: EventKeyboard): void => {
        this._held.delete(ev.keyCode);
        const k = KEY_MAP[ev.keyCode];
        if (!k) return;
        const S = (GROVE as any).S;
        if (!S || !S.keys) return;
        S.keys[k] = false;
    };

    private _unbindCocosInput(): void {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown);
        input.off(Input.EventType.KEY_UP, this._onKeyUp);
    }

    private _unmountStage(): void {
        const stage = this._stage;
        if (!stage) return;
        this._stage = null;
        if (stage.parentNode) stage.parentNode.removeChild(stage);
    }

    /* ------------------------------------------------------------------ 退出 */

    /**
     * 把推球打出来的通关进度回写给主界面。
     *
     * 两套存档是历史原因，字段口径都不一样：
     *   主界面（config/SaveData.ts） key `pawpack.save.v1`，cleared 是**数字**（通关数）
     *   推球（grove.html）          key `pawpack.save`，   cleared 是**数组**（关卡索引）
     * 不接这一下，就会"打完一关回主界面，进度还是 0"。
     * 只推进、不回退：主界面已经通了 5 关的档，不会被一个推球新档打回 1 关。
     */
    private _syncProgressToHome(): void {
        try {
            const g = globalThis as unknown as {
                localStorage?: Storage;
                cc?: { sys?: { localStorage?: Storage } };
            };
            const store = (g.cc && g.cc.sys && g.cc.sys.localStorage) || g.localStorage;
            if (!store) return;

            const mineRaw = store.getItem('pawpack.save');
            if (!mineRaw) return;
            const mine = JSON.parse(mineRaw) as { cleared?: unknown };
            const arr = Array.isArray(mine.cleared) ? (mine.cleared as number[]) : [];
            if (!arr.length) return;

            const homeRaw = store.getItem('pawpack.save.v1');
            const home = homeRaw ? (JSON.parse(homeRaw) as Record<string, unknown>) : {};
            const prev = typeof home.cleared === 'number' ? home.cleared : 0;
            /* 用**去重后的关数**，不是数组长度。
             *
             * 数组里可能重复（重打同一关会再 push 一次索引），长度就会虚高；
             * 而主界面 `unlockedPets(cleared)` 的语义是「通了几关」，
             * 口径必须和 game.html 的 `new Set(save.cleared).size` 逐字一致，
             * 否则同一份存档在两边解锁出不同数量的伙伴。 */
            const done = new Set(arr).size;
            const next = Math.max(prev, done);
            if (next === prev) return;

            home.cleared = next;
            home.v = typeof home.v === 'number' ? home.v : 1;
            store.setItem('pawpack.save.v1', JSON.stringify(home));
            console.log('[GroveBattle] 通关进度已回写主界面：cleared ' + prev + ' -> ' + next);
        } catch (e) {
            // 存档坏了不该把人卡在战斗里
            console.warn('[GroveBattle] 存档同步失败（不影响战斗本身）', e);
        }
    }

    /**
     * 把每关的最佳评级合并进家园存档。
     *
     * 评级是**唯一的重玩动机**，而它原来只活在推球侧的 `S.best` 里：
     * 算出来、写内存、从不显示、重启归零。主界面图鉴要读它，
     * 所以必须有这一趟"合并写回"。
     *
     * 只升不降：家园已经是 S，推球这次打 A 不会抹掉 S —— 否则玩家
     * 会因为"怕打坏纪录"而不敢重打，正好和重玩动机相反。
     *
     * 独立成一个函数而不是塞进 `_syncProgressToHome`：那个函数在
     * `next === prev` 时 early return（进度没变就什么都不做），
     * 而"重打一关刷 S"恰恰是进度不变、评级变了的场景。
     */
    private _syncRanksToHome(): void {
        try {
            const g = globalThis as unknown as {
                localStorage?: Storage;
                cc?: { sys?: { localStorage?: Storage } };
            };
            const store = (g.cc && g.cc.sys && g.cc.sys.localStorage) || g.localStorage;
            if (!store) return;

            const raw = store.getItem('pawpack.best');
            if (!raw) return;
            const arr: unknown = JSON.parse(raw);
            if (!Array.isArray(arr)) return;

            const homeRaw = store.getItem('pawpack.save.v1');
            const home = homeRaw ? (JSON.parse(homeRaw) as Record<string, unknown>) : {};
            const prev = Array.isArray(home.best) ? (home.best as unknown[]) : [];
            const ORD: Record<string, number> = { B: 1, A: 2, S: 3 };

            const out: string[] = [];
            let changed = false;
            const n = Math.max(prev.length, arr.length, LEVEL_COUNT);
            for (let i = 0; i < n; i++) {
                const a = typeof prev[i] === 'string' ? prev[i] as string : '';
                const bv = typeof arr[i] === 'string' ? arr[i] as string : '';
                const keep = (ORD[bv] || 0) > (ORD[a] || 0) ? bv : a;
                if (keep !== a) changed = true;
                out.push(keep);
            }
            if (!changed) return;

            home.best = out;
            home.v = typeof home.v === 'number' ? home.v : 1;
            store.setItem('pawpack.save.v1', JSON.stringify(home));
            console.log('[GroveBattle] 评级已回写主界面：' + out.join('|'));
        } catch (e) {
            // 存档坏了不该把人卡在战斗里
            console.warn('[GroveBattle] 评级同步失败（不影响战斗本身）', e);
        }
    }

    /** 把这一趟的果子 / 材料 / 吧唧写进家园存档。回到主界面再报一句。 */
    private _bankRun(kind: string): void {        const s = GROVE.S;
        const home = s.home || {};
        const trip = s.trip || {};
        /* ★ 本趟目标结算（2026-10-25）。
           `judgeTripGoals` 读的是 `S.stat`（战斗侧唯一的统计真值）——
           判定放这里而不是"边打边判"，因为"一次都没被打到"这类
           只有在整趟结束时才成立。 */
        const met = judgeTripGoals(loadSave().tripGoals || [], s.stat || {});
        const goal = tripReward(met);
        /* ★ 星靶结算（2026-10-25）。
           完成位已经在战斗侧写好了（`recordStar` 每屏落盘 + 镜像），
           这里只要把这一趟**新达成**攒下的货币带回家。
           为什么不在这里判靶：判定要读当屏的 `S.stat` 快照，而收工时
           那个快照早被后面的屏覆盖了 —— 边打边判、按屏累计是唯一解。 */
        const starShards = Math.max(0, Math.round((s as unknown as { starShards?: number }).starShards || 0));
        const starLogs = Math.max(0, Math.round((s as unknown as { starLogs?: number }).starLogs || 0));
        /* ★ 巢币（2026-10-27）。**战斗侧已经按"新到达的最深层差额"算好了**
           （`enterNest` 里，必须在 `writeNestDepth` 之前算，否则差额恒 0）。
           这里只把这一趟攒下的数带走 —— 重算一遍就会和"历史最深"分叉，
           而那两个数一旦分叉，玩家会遇到"下到 20 层却给了 5 层的币"。 */
        const nestCoins = Math.max(0, Math.round((trip as { nestCoins?: number }).nestCoins || 0));
        const payout = payoutFromRun({
            kind,
            lastLoot: home.lastLoot || 0,
            lastStages: home.lastStages || 0,
            tripLoot: trip.loot || 0,
            tripStages: trip.stages || 0,
            food: s.food || 0,
            /* 评级材料。**和果子走同一个出口** —— 中途退出也只按已攒下的算。 */
            rankLogs: trip.rankLogs || 0,
            /* 目标奖励。和果子/材料走同一个出口 —— 自己写一份存档的话，这一趟的账当场分叉。 */
            goalShards: goal.shards,
            goalLogs: goal.logs,
            /* 星靶奖励。同上，同一个出口。 */
            starShards,
            starLogs,
            /* 巢币。只有深巢有（主线那一趟 `trip.nestCoins` 不存在 = 0）。 */
            nestCoins,
        });
        const next = applyRunReward(loadSave(), payout);
        /* 目标一次性：结算完清空，下一趟重新抽。
           不清的话，"上一趟的目标"一直挂着，玩家会以为下一趟还是这两条。 */
        if (met.length) next.lastReward = (next.lastReward || '') + ` · 目标 ${met.length} 条达成`;
        /* 星靶同理点一句：不点的话，碎片涨了玩家不知道是哪来的 ——
           「机制做了 ≠ 玩家看得见」在这个项目栽过五次。 */
        if (starShards > 0 || starLogs > 0) {
            next.lastReward = (next.lastReward || '') +
                ` · 星靶 碎片 +${starShards} · 材料 +${starLogs}`;
        }
        next.tripGoals = [];
        saveSave(next);
    }

    /** "收工"回主界面。和 HomeRuntime 进战斗用同一套 uuid 加载方式。 */
    private _backHome(kind?: string): void {
        if (this._paid) return;
        this._paid = true;
        this._ready = false;
        this._unmountStage();
        this._bankRun(kind || 'done');
        this._syncProgressToHome();
        this._syncRanksToHome();

        assetManager.loadAny(HOME_UUID, (err: Error | null, asset: unknown) => {
            if (!err && asset instanceof SceneAsset) {
                director.runScene((asset as SceneAsset).scene);
                return;
            }
            console.warn('[GroveBattle] 按 uuid 回主界面失败，回退 loadScene：', err);
            director.loadScene('Home', (e2) => {
                if (e2) console.error('[GroveBattle] 回主界面失败：', e2);
            });
        });
    }

    onDestroy(): void {
        this._ready = false;
        this._unbindCocosInput();
        groveSetExitHook(null);
        this._unmountStage();
        this._cv = null;

        /* 相机必须跟着走。**不是洁癖**：换手到推球时本组件 destroy、
         * SnowlabBattle 在同一个 BattleRoot 上再建一台清屏相机。
         * 留着这台的话场上两台同参数相机都吃 SOLID_COLOR 清屏，
         * 谁后画谁说话 —— 表现是"点第三扇门之后画面定住"。
         * 以前不会切换，所以这一条一直没暴露。 */
        if (this._camNode && this._camNode.isValid) this._camNode.destroy();
        this._camNode = null;

        /* 松手时把出口还原。下次谁再挂它会在 onLoad 里重新装一遍；
           还原是为了不留一个指向"已经销毁的组件"的闭包 ——
           那个闭包里调 battleSwitch 会去碰一个死组件。 */
        setSnowlabEntry(null);
    }
}
