/**
 * PetWander —— 家园里宠物的自主走动（Cocos Creator 3.8）
 *
 * 为什么需要这个组件：静态场景里的宠物是「贴纸」。网页原型用 requestAnimationFrame
 * 做位移+踏步，Cocos 侧没有等价的现成能力，必须挂脚本。
 *
 * 用法：
 *   1. 选中 Pets 下任意一只宠物节点（锚点 0.5, 0 = 脚底中心）；
 *   2. 添加组件 → 自定义脚本 → PetWander；
 *   3. 把 roamLeft / roamRight 填成该宠物的领地（见下表，设计坐标 0~1280）；
 *   4. 其余参数保持默认即可。
 *
 * 领地（从 game.src.html 的 PETS.roam 直接搬，别自己算）：
 *   砂糖  136 ~ 192      年糕  288 ~ 358      雪团  472 ~ 532
 *   团子  676 ~ 746      豆奶  862 ~ 932      星屑 1106 ~ 1162
 *
 * ⚠ 两只宠物的领地不许重叠。重叠了就必然出现「走两步贴在一起」——
 *   这不是脚本的问题，是 roam 的值没按 game.src.html 配。
 */
import { _decorator, Component, UITransform, Tween, tween, Vec3 } from 'cc';
const { ccclass, property, requireComponent } = _decorator;

@ccclass('PetWander')
@requireComponent(UITransform)
export class PetWander extends Component {
    @property({ tooltip: '领地左边界（设计坐标 x，0~1280）' })
    roamLeft = 136;

    @property({ tooltip: '领地右边界（设计坐标 x）' })
    roamRight = 192;

    @property({ tooltip: '单次走动距离下限（像素）' })
    stepMin = 42;

    @property({ tooltip: '单次走动距离上限（像素）' })
    stepMax = 138;

    @property({ tooltip: '每像素耗时（秒）。0.016 ≈ 62 px/s，与网页版同一速度' })
    secPerPx = 0.016;

    @property({ tooltip: '走到位后停顿下限（秒）' })
    idleMin = 0.9;

    @property({ tooltip: '走到位后停顿上限（秒）' })
    idleMax = 2.6;

    @property({ tooltip: '首次启动延迟上限（秒）。各只随机错开，否则六只会同时迈步' })
    firstDelayMax = 2.5;

    /** Canvas 的设计坐标原点在屏幕中心，所以 设计 x = 本地 x + 640 */
    private readonly DESIGN_CX = 640;

    private _baseY = 0;
    private _alive = false;

    onLoad() {
        this._baseY = this.node.position.y;
        this._alive = true;
    }

    start() {
        this.scheduleOnce(() => this.step(), 0.5 + Math.random() * this.firstDelayMax);
    }

    onDestroy() {
        this._alive = false;
        Tween.stopAllByTarget(this.node);
    }

    /** 走一步：挑距离与方向 → 夹进领地 → 缓动过去 → 停顿 → 再走 */
    private step() {
        if (!this._alive) return;

        const p = this.node.position;
        const cur = p.x + this.DESIGN_CX;                  // 当前设计坐标 x
        const dist = this.stepMin + Math.random() * (this.stepMax - this.stepMin);
        const dir = Math.random() < 0.5 ? -1 : 1;

        let to = cur + dist * dir;

        /* 贴边处理：剩余空间不足 20px 时反向走。
           不做这一步的话，宠物会卡在边界上「原地抖」直到超时 —— 看起来像卡死。 */
        if (to < this.roamLeft || to > this.roamRight) {
            const room = dir > 0 ? this.roamRight - cur : cur - this.roamLeft;
            to = room < 20 ? cur - dir * dist : cur + dir * room;
        }
        to = Math.min(this.roamRight, Math.max(this.roamLeft, to));

        const d = Math.abs(to - cur);
        if (d < 12) {
            this.scheduleOnce(() => this.step(), 0.4);
            return;
        }

        const dur = Math.max(0.35, d * this.secPerPx);
        const target = new Vec3(to - this.DESIGN_CX, this._baseY, p.z);

        /* quadInOut 而不是线性：线性起步/落停像传送带，缓动才有「迈步→停住」的重量。
           网页版同一条曲线（easeInOutQuad）。 */
        tween(this.node)
            .to(dur, { position: target }, { easing: 'quadInOut' })
            .delay(this.idleMin + Math.random() * (this.idleMax - this.idleMin))
            .call(() => this.step())
            .start();
    }
}
