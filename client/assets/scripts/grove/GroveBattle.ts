/**
 * GroveBattle —— 战斗场景的**推球玩法**挂载点（雪人兄弟式）
 * ============================================================================
 *
 * 为什么是这个形状：
 *   推球玩法（物理/关卡/坡/波次/BOSS/冰壳）在 client/prototype/grove.html 里
 *   已经调了八轮，那 6800 行是唯一跑通过的手感来源。
 *   把规则重写成 Cocos 组件 = 把八轮调参全部作废。
 *
 *   所以这里不重写玩法，只做三件事：
 *     ① 建一台正交相机（视野高度 600 单位，对上原型的 960x600 坐标系）
 *     ② 开一块离屏 canvas 交给 GroveRuntime 原样绘制
 *     ③ 每帧把 canvas 传成 Cocos 纹理，贴在一个全屏 Sprite 上
 *
 * 代价（如实说）：
 *   - 每帧一次 960x600 的纹理上传，桌面端约 1~3ms，可以接受；
 *   - 这条路径依赖 document.createElement('canvas')，**只有 Web 平台能跑**
 *     （Cocos 原生平台没有 DOM）。要上原生，得把 ctx 调用逐条换成 Graphics，
 *     或者改成 getImageData + uploadData(ArrayBufferView)。
 *   - 玩法改在 grove.html，改完跑：
 *       python client/tools/extract_grove_runtime.py
 *       node   client/tools/grove-runtime-check.js
 *
 * 键位和原型完全一致：
 *   ←→/AD 移动 · 空格/W/↑ 跳 · J 喷裹 · K 撞飞 · 走进球里顶它 推球
 *   Shift 按住看预测线 · R 重打 · Esc 收工回主界面
 */
import {
    _decorator, Component, Node, Sprite, SpriteFrame, Texture2D, ImageAsset,
    UITransform, Camera, Color, director, assetManager, SceneAsset,
    input, Input, EventTouch,
} from 'cc';
import {
    groveAttachCanvas, groveBoot, grovePointer, groveRender, groveSetExitHook, groveTick,
} from './GroveRuntime';

const { ccclass } = _decorator;

/** 原型的世界尺寸，必须和 GroveRuntime 里的 W/H 一致 */
const W = 960;
const H = 600;

/** Home 场景的资产 uuid（取自 Home.scene.meta），"收工"回主界面用 */
const HOME_UUID = 'ce855542-8bb9-44de-8e9d-20c436ed206f';

@ccclass('GroveBattle')
export class GroveBattle extends Component {
    private _cv: HTMLCanvasElement | null = null;
    private _img: ImageAsset | null = null;
    private _tex: Texture2D | null = null;
    private _screen: Node | null = null;

    /** 当前画面缩放（屏幕比 16:10 窄时按宽度缩，别把左右裁掉） */
    private _scale = 1;
    /** uploadData 是否可用；不可用就退回"重建 ImageAsset"（慢但能跑） */
    private _canUpload = true;
    /** 是否已经成功接管（没接管时 update 直接返回，别空转） */
    private _ready = false;

    onLoad(): void {
        if (typeof document === 'undefined' || !document.createElement) {
            console.error(
                '[GroveBattle] 当前平台没有离屏 canvas（原生平台无 DOM）。\n' +
                '推球目前只接了 Web 路径，请在浏览器里预览。',
            );
            return;
        }

        this._buildCamera();

        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;

        if (!this._buildScreen(cv)) return;

        this._cv = cv;

        /* 先绑画布再开局：绘制要 ctx，beginRun 会立刻画一帧。 */
        groveAttachCanvas(cv);
        groveSetExitHook(() => this._backHome());
        groveBoot();

        this._bindTouch();
        this._fit(true);
        this._ready = true;

        console.log(
            '[GroveBattle] 推球已接管战斗场景 —— ' +
            '←→ 移动 / 空格 跳 / J 喷裹 / K 撞飞 / 走进球里顶它推球 / Shift 看预测线 / Esc 收工',
        );
    }

    update(dt: number): void {
        if (!this._ready || !this._cv) return;

        // 和原型 frame() 同一个上限：切标签页回来不要一次跳半秒
        groveTick(Math.min(dt, 0.034));
        groveRender();
        this._upload();
        this._fit(false);
    }

    /* ------------------------------------------------------------------ 骨架 */

    /** 正交相机，视野高度 = 600 世界单位 → 画布 1 像素 = 1 世界单位 */
    private _buildCamera(): void {
        const camNode = new Node('GroveCamera');
        this.node.addChild(camNode);
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.orthoHeight = H / 2;
        cam.near = 1;
        cam.far = 2000;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        // 深墨绿：留边时读作画框，而不是"没画满"
        cam.clearColor = new Color(14, 24, 18, 255);
        camNode.setPosition(0, 0, 1000);
    }

    /** 全屏 Sprite，纹理源就是那块离屏画布。成功返回 true。 */
    private _buildScreen(cv: HTMLCanvasElement): boolean {
        const img = new ImageAsset({
            _data: cv,
            width: W,
            height: H,
            format: Texture2D.PixelFormat.RGBA8888,
            _compressed: false,
        } as unknown as any);

        const tex = new Texture2D();
        tex.image = img;
        tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        // 动态纹理绝不能进合图：进了之后每帧上传画的是合图里的旧图
        (tex as unknown as { packable: boolean }).packable = false;

        const sf = new SpriteFrame();
        sf.texture = tex;

        const node = new Node('GroveScreen');
        this.node.addChild(node);
        const ut = node.addComponent(UITransform);
        ut.setContentSize(W, H);

        const sp = node.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.trim = false;
        sp.spriteFrame = sf;

        this._img = img;
        this._tex = tex;
        this._screen = node;
        return true;
    }

    /* ------------------------------------------------------------------ 每帧 */

    /**
     * 把画布内容推上 GPU。
     *
     * 首选 Texture2D.uploadData(canvas)：直接 texSubImage2D，不重建资源。
     * 万一某个后端不支持，退回 ImageAsset.reset(v) + texture.image = img
     * —— 会重建一次 GPU 纹理，慢，但画面不会停。
     */
    private _upload(): void {
        const cv = this._cv;
        const tex = this._tex;
        if (!cv || !tex) return;

        if (this._canUpload) {
            try {
                (tex as unknown as { uploadData: (s: unknown, l: number, i: number) => void })
                    .uploadData(cv, 0, 0);
                return;
            } catch (e) {
                this._canUpload = false;
                console.warn('[GroveBattle] uploadData 不可用，降级为重建 ImageAsset', e);
            }
        }

        const img = this._img;
        if (!img) return;
        (img as unknown as { reset: (v: unknown) => void }).reset(cv);
        tex.image = img;
    }

    /**
     * 适配屏幕。
     *
     * 相机视野高度固定 600，所以：
     *   可见宽度 = 600 * (屏宽/屏高)   世界单位
     * 画布要完整落在里面：960*s ≤ 600*va 且 600*s ≤ 600
     *   → s = min(1, 0.625 * va)
     * 16:10 及以上 s=1 铺满高度；更窄的窗口按宽度缩、上下留边。
     */
    private _fit(force: boolean): void {
        const node = this._screen;
        if (!node) return;

        const vw = typeof window !== 'undefined' ? window.innerWidth : W;
        const vh = typeof window !== 'undefined' ? window.innerHeight : H;
        const va = vw / Math.max(1, vh);
        const s = Math.min(1, (H / W) * va);

        if (!force && Math.abs(s - this._scale) < 0.001) return;
        this._scale = s;
        node.setScale(s, s, 1);
    }

    /* ------------------------------------------------------------------ 输入 */

    /**
     * 键盘由 GroveRuntime 自己在 window 上监听（和原型同一份代码，手感一致）。
     * 这里只补触摸：原型的"点结算面板 / 点选人"走的是 canvas 鼠标事件，
     * 离屏画布收不到，得把 Cocos 的触点换算回 960x600 画布坐标再转发。
     */
    private _bindTouch(): void {
        const toCanvas = (ev: EventTouch): { x: number; y: number } | null => {
            const vw = typeof window !== 'undefined' ? window.innerWidth : W;
            const vh = typeof window !== 'undefined' ? window.innerHeight : H;
            const p = ev.getLocation();                 // 屏幕像素，左下原点
            const halfH = H / 2;                        // 可见高度世界单位 / 2
            const wx = (p.x / Math.max(1, vw) - 0.5) * (H * vw / Math.max(1, vh));
            const wy = (p.y / Math.max(1, vh) - 0.5) * H;
            const s = this._scale || 1;
            return { x: W / 2 + wx / s, y: halfH - wy / s };
        };

        input.on(Input.EventType.TOUCH_START, (ev: EventTouch) => {
            const p = toCanvas(ev);
            if (p) grovePointer('down', p.x, p.y);
        }, this);

        input.on(Input.EventType.TOUCH_MOVE, (ev: EventTouch) => {
            const p = toCanvas(ev);
            if (p) grovePointer('move', p.x, p.y);
        }, this);
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
        // 按 target 一次性解绑，省得为两个 handler 存字段
        (input as unknown as { targetOff: (t: unknown) => void }).targetOff(this);
        if (this._tex) { this._tex.destroy(); this._tex = null; }
        if (this._img) { this._img.destroy(); this._img = null; }
    }
}
