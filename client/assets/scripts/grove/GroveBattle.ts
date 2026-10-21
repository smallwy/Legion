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
    _decorator, Component, Node, Camera, Color, Layers,
    director, assetManager, SceneAsset,
} from 'cc';
import {
    groveAttachCanvas, groveBoot, groveRender, groveSetExitHook, groveTick,
} from './GroveRuntime';

const { ccclass } = _decorator;

/** 原型的世界尺寸，必须和 GroveRuntime 里的 W/H 一致 */
const W = 960;
const H = 600;

/** Home 场景的资产 uuid（取自 Home.scene.meta），"收工"回主界面用 */
const HOME_UUID = 'ce855542-8bb9-44de-8e9d-20c436ed206f';

/** DOM 叠加层的 z-index。Cocos 画布默认 0，取 10 足够压住。 */
const STAGE_Z = '10';

@ccclass('GroveBattle')
export class GroveBattle extends Component {
    private _cv: HTMLCanvasElement | null = null;
    /** 承载画布的 DOM 容器；收工/销毁时整块摘掉 */
    private _stage: HTMLDivElement | null = null;
    private _ready = false;

    onLoad(): void {
        if (typeof document === 'undefined' || !document.createElement || !document.body) {
            console.error(
                '[GroveBattle] 当前平台没有 DOM（原生/小游戏）。\n' +
                '推球目前只接了 Web 路径，请在浏览器预览里玩。',
            );
            return;
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
        groveSetExitHook(() => this._backHome());
        groveBoot();

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
    }

    /* ------------------------------------------------------------------ 骨架 */

    /**
     * 只清屏的相机。
     * 故意不建 Canvas/Sprite：Battle.scene 没有 RenderRoot2D，
     * 走 Cocos 2D 管线要额外补一堆东西，得不偿失（见文件头复盘）。
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
            const next = Math.max(prev, arr.length);
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

    /** "收工"回主界面。和 HomeRuntime 进战斗用同一套 uuid 加载方式。 */
    private _backHome(): void {
        this._ready = false;
        this._unmountStage();
        this._syncProgressToHome();

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
        groveSetExitHook(null);
        this._unmountStage();
        this._cv = null;
    }
}
