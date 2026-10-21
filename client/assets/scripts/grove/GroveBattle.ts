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
} from 'cc';
import {
    groveAttachCanvas, groveBoot, groveRender, groveSetArt, groveSetExitHook, groveTick,
} from './GroveRuntime';

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
 * 美术图清单：注入键 → resources 下的路径。
 *
 * 图是 client/tools/gen_grove_art.py 从 ui/home/ 收缩出来的副本
 * （立绘高 192、头像 96，合计 395KB）。
 * 为什么不直接引用 ui/ 下的原图：那些文件主界面是**场景直连 spriteFrame**，
 * 而动过的才放进 resources 才能用 resources.load 动态加载。
 *
 * 加载失败只 warning、不中断 —— 绘制侧有回退分支，没图就画代码图形。
 */
const ART_MANIFEST: ReadonlyArray<readonly [string, string]> = [
    ...HERO_IDS.map((id) => ['pet-' + id, 'grove/pet-' + id] as const),
    ...HERO_IDS.map((id) => ['head-' + id, 'grove/head-' + id] as const),
    ['ui-pip', 'grove/ui-pip'],
    ['ui-pip-on', 'grove/ui-pip-on'],
    ['ui-coin', 'grove/ui-coin'],
    // 战斗 HUD / 结算面板。这几张是"奶油风"的唯一来源 ——
    // 缺了它们 hudSkin() 会返回 cream: false，整块退回深色玻璃风，
    // 不会出现"奶白底 + 浅绿字"那种读不出来的组合。
    ['ui-tip', 'grove/ui-tip'],
    ['ui-cream', 'grove/ui-cream'],
    ['ui-prog', 'grove/ui-prog'],
    ['ui-res', 'grove/ui-res'],
    ['ui-belly', 'grove/ui-belly'],
    ['ui-btn', 'grove/ui-btn'],
    ['ui-ring', 'grove/ui-ring'],
    ['ui-star', 'grove/ui-star'],
    ['ui-arrow', 'grove/ui-arrow'],
];

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
        this._loadArt();
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
