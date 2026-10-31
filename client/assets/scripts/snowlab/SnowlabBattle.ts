/**
 * SnowlabBattle —— 战斗场景的**雪人兄弟式关卡**挂载点
 * ============================================================================
 *
 * 和 GroveBattle 是同一个形状，理由也一样，见 `grove/GroveBattle.ts` 文件头
 * 那段黑屏复盘：Battle.scene 里一个 Canvas / RenderRoot2D 都没有，
 * 自己 new 的相机默认看不见 UI_2D 层 —— 走 Cocos 2D 管线要补一堆东西，
 * 而且补完还不保证和原型像素级一致。所以这里同样**不重写玩法、不碰渲染管线**：
 *
 *   ① 开一块 960x600 的离屏 canvas 交给 SnowlabRuntime 原样绘制
 *   ② 把这块 canvas 作为 DOM 层铺在 Cocos 画布上面
 *   ③ 每帧 snowlabTick + snowlabRender
 *
 * 【和 grove 的三处不同】
 *   ① **美术不用注入。** snowlab 的 5 张贴图内嵌在运行时里
 *      （`SnowlabArt.ts`，从 html 的 `<script id="art-*">` 原样搬来），
 *      `snowlabBoot` 自己 new Image 解码。少了 GroveBattle 那套
 *      `ART_MANIFEST` + `resources.load` —— 因为 snowlab 的敌人图
 *      根本不在 `assets/resources` 下（在 `assets/snowlab/foe/`），
 *      `resources.load` 读不到，搬过去还得开编辑器生成 .meta。
 *   ② **没有存档结算。** grove 那套（果子/材料/评级/目标）挂在它的 `S.trip` 上，
 *      snowlab 现在还没有经济系统。这里只回主界面，不写存档。
 *   ③ **键位是运行时自己挂的 window 监听**（和原型同一份代码），
 *      所以这里不接管键盘 —— 只额外听一个 Esc 用来回主界面。
 *
 * 玩法改在 `prototype/snowlab.html`，改完跑：
 *   python client/tools/extract_snowlab_runtime.py
 *   node   client/tools/snowlab-runtime-check.js     ← 逐帧对坐标，必须 0 偏差
 *
 * 键位（和原型完全一致）：
 *   A/D 移动 · W 跳（空中再按 = 二段跳）· S 从楼板穿下去 · J/K 喷雪弹
 *   走过去顶球 = 推球 · R 换一关 · Esc 回主界面
 *
 * ⚠ 只有 Web 平台能跑（依赖 document）。原生/小游戏要重写渲染层。
 */
import { _decorator, Component, Node, Camera, Color, director, assetManager, SceneAsset } from 'cc';
import { snowlabAttachCanvas, snowlabBoot, snowlabRender, snowlabTick, SNOWLAB } from './SnowlabRuntime';
import { battleSwitch, battleSetCurrent, battleTakeEntryMode } from '../BattleSwitch';

const { ccclass } = _decorator;

/** 原型的世界尺寸，必须和 SnowlabRuntime 里的 W/H 一致 */
const W = 960;
const H = 600;

/** DOM 层的层级。和 GroveBattle 用同一个值 —— 两块画布永不同时出现 */
const STAGE_Z = '10';
/** 主界面场景的 uuid。和 GroveBattle 同一条路子（按 uuid 加载，失败再按名字） */
const HOME_UUID = 'ce855542-8bb9-44de-8e9d-20c436ed206f';

@ccclass('SnowlabBattle')
export class SnowlabBattle extends Component {
    private _cv: HTMLCanvasElement | null = null;
    private _stage: HTMLDivElement | null = null;
    private _ready = false;
    /** 本组件建的清屏相机。换手回出征页时必须拆掉，见 onDestroy */
    private _camNode: Node | null = null;
    /** Esc 是这里的监听，不是运行时的 —— 运行时没有"退出"这个概念 */
    private _onEsc: ((e: KeyboardEvent) => void) | null = null;

    onLoad(): void {
        if (typeof document === 'undefined' || !document.createElement || !document.body) {
            /* **必须炸，不能 return**（理由同 GroveBattle）：
               这一层画不出来不是"降级"，是这个平台完全没有画面。
               静默 return 的表现就是"点了没反应"。 */
            console.error('[SnowlabBattle] 当前平台没有 DOM（原生/小游戏）。雪人关卡目前只接了 Web 路径。');
            throw new Error('[SnowlabBattle] 平台无 DOM：雪人关卡尚未移植到原生渲染管线');
        }

        // 场景里一台相机都没有的话，渲染器每帧刷 "no camera"
        this._buildClearCamera();

        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        this._mountStage(cv);
        this._cv = cv;

        /* **先绑画布再开局。** snowlabBoot 里 reset() 之后会立刻需要 ctx
           （hud 要读字体、tips 要排位置），顺序反了就是第一帧画到 null 上。 */
        snowlabAttachCanvas(cv);
        snowlabBoot();
        /* **深巢无尽从这里进来。**（2026-10-31）
           两扇门进的是同一个玩法，区别只有这一个参数：主线照旧 `reset`
           到存档那一关，无尽直接 `startDive()`（一命到底、比下到第几层）。
           取走即清空 —— 留着的话下次从别处进推球会莫名其妙掉进无尽。 */
        if (battleTakeEntryMode() === 'dive') {
            SNOWLAB.startDive();
        }

        this._bindEsc();
        this._ready = true;

        /* 登记"当前活着的是我"：出征页那边换手靠这个找到起点。 */
        battleSetCurrent('snowlab', this);

        console.log(
            '[SnowlabBattle] 雪人关卡已接管战斗场景（DOM 叠加层）—— ' +
            'A/D 移动 · W 跳（空中再按二段跳）· S 穿楼板 · J 喷雪弹 · 顶球推 · R 换关 · Esc 回主界面',
        );
    }

    update(dt: number): void {
        if (!this._ready) return;
        // 和原型 loop() 同一个上限：切标签页回来不要一次跳半秒
        snowlabTick(Math.min(dt, 0.034));
        snowlabRender();
    }

    /* ------------------------------------------------------------------ 骨架 */

    /**
     * 只清屏的相机。故意不建 Canvas/Sprite —— Battle.scene 没有 RenderRoot2D，
     * 真正的画面在 DOM 层（见文件头）。
     *
     * 节点留引用、onDestroy 拆掉：换手回出征页时 GroveBattle 会在同一个
     * BattleRoot 上再建一台，两台都吃 SOLID_COLOR 清屏 —— 后画的盖先画的，
     * 表现是"按 Esc 回去之后画面定住"。
     */
    private _buildClearCamera(): void {
        const camNode = new Node('SnowlabClearCamera');
        this.node.addChild(camNode);
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.orthoHeight = H / 2;
        cam.near = 1;
        cam.far = 2000;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        // 和原型留边色一致：露出来时读作画框，不是"没画完"
        cam.clearColor = new Color(11, 22, 33, 255);
        camNode.setPosition(0, 0, 1000);
        this._camNode = camNode;
    }

    /**
     * 把画布铺在 Cocos 画布上面。
     * 尺寸交给浏览器（max-width/max-height 100% + 固有尺寸 960×600），
     * 窗口比例不对时留边 —— 和原型里 fit() 的行为一致。
     */
    private _mountStage(cv: HTMLCanvasElement): void {
        const doc = document;
        const stage = doc.createElement('div');
        stage.id = 'snowlab-stage';
        const s = stage.style;
        s.position = 'fixed';
        s.left = '0';
        s.top = '0';
        s.width = '100%';
        s.height = '100%';
        s.display = 'flex';
        s.alignItems = 'center';
        s.justifyContent = 'center';
        s.background = '#0B1621';
        s.zIndex = STAGE_Z;
        s.overflow = 'hidden';
        (s as unknown as { touchAction: string }).touchAction = 'none';

        /* canvas 的 CSS 尺寸由 snowlabAttachCanvas 写成 960x600（它要按 dpr 放大
           后备缓冲，逻辑坐标必须还是 960）；这里只负责"不许超过窗口"。 */
        cv.style.display = 'block';
        cv.style.maxWidth = '100%';
        cv.style.maxHeight = '100%';

        stage.appendChild(cv);
        doc.body.appendChild(stage);
        this._stage = stage;
    }

    /**
     * Esc 回**出征页**（不是回主界面）。
     *
     * 2026-10-30：出征页接回来之后，玩家是从那三扇门里点进来的，
     * 出关就该回到那三扇门前面。原来一律回主界面，等于"打一关就要
     * 重新走一遍出门流程"——多一次点击，也丢掉了"再换一种玩法试试"这条路。
     *
     * 直连调试（`?mode=snowlab`，压根没有出征页）时 `battleSwitch` 返回 false，
     * 退化成原来的回主界面。两条路都要留，不能只认一条。
     *
     * **不加 Esc 这整条，Cocos 里就没有出口了。** 原型是双击打开的独立页，
     * 关标签页就是退出；进了 Cocos，玩家卡在这块 DOM 层里，只能刷新页面
     * 或者杀掉进程 —— 那比"没做退出"更糟，因为它看起来像卡死。
     *
     * 用 capture 阶段而不是普通冒泡：运行时的 keydown 监听也在 window 上，
     * 谁先谁后不确定；capture 保证退出键先被看到。
     */
    private _bindEsc(): void {
        const onEsc = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            /* 切走之后 this 已经被 destroy，这一句之后不许再碰 this。 */
            if (battleSwitch('grove')) return;
            this._backHome();
        };
        window.addEventListener('keydown', onEsc, true);
        this._onEsc = onEsc;
    }

    private _backHome(): void {
        if (!this._ready) return;
        this._ready = false;
        this._unmountStage();
        assetManager.loadAny(HOME_UUID, (err: Error | null, asset: unknown) => {
            if (!err && asset instanceof SceneAsset) {
                /* `scene` 的类型是 `Scene | null`。原来写的是 `scene!` ——
                   类型上糊过去了，真拿到 null 时 `runScene(null)` 不动声色，
                   玩家看到的是"按了 Esc 没反应"。落到下面的 loadScene 兜底
                   比赌它非空好（和 GroveBattle 那边同步改的）。 */
                const sc = (asset as SceneAsset).scene;
                if (sc) { director.runScene(sc); return; }
            }
            console.warn('[SnowlabBattle] 按 uuid 回主界面失败，回退 loadScene：', err);
            director.loadScene('Home', (e2) => {
                if (e2) console.error('[SnowlabBattle] 回主界面失败：', e2);
            });
        });
    }

    private _unmountStage(): void {
        if (this._stage && this._stage.parentNode) this._stage.parentNode.removeChild(this._stage);
        this._stage = null;
    }

    onDestroy(): void {
        this._ready = false;
        if (this._onEsc) {
            window.removeEventListener('keydown', this._onEsc, true);
            this._onEsc = null;
        }
        this._unmountStage();
        this._cv = null;
        if (this._camNode && this._camNode.isValid) this._camNode.destroy();
        this._camNode = null;
    }
}
