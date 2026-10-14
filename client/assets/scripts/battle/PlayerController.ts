import { Camera, Graphics, KeyCode, Node, UITransform } from 'cc';
import { CAMERA, FIELD, PALETTE, PLAYER } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { clamp } from '../core/MathUtil';
import { currentAspect } from '../core/ViewUtil';

export type MoveDir = 'up' | 'down' | 'left' | 'right';

const C_RING = hexColor(PALETTE.gold, 200);
const C_DOT = hexColor(PALETTE.gold);

/**
 * 玩家 = WASD 只控的"中心点"（CR-007：百炼英雄式走位，宠物环绕自动施法）。
 * 同时持有相机：2D 正交、固定 zoom、指数平滑跟随 + 视野钳制（§5.5）。
 */
export class PlayerController {
    readonly node: Node;
    x = 0;
    y = 0;
    hp = PLAYER.hp;

    private _cameraNode: Node;
    private _camX = 0;
    private _camY = 0;
    private _invT = 0;
    private _blinkT = 0;
    private _keys: { [k in MoveDir]: boolean } = { up: false, down: false, left: false, right: false };

    /**
     * @param parent 玩家中心点的父节点（实体树 Field 下）
     * @param cameraParent 相机的父节点（与实体树分开：3.x Batcher2D 按 children
     *        遍历序决定绘制优先级，相机树必须整体排在实体树之后，HUD 才不会被子机盖住）
     */
    constructor(parent: Node, cameraParent: Node) {
        // ---- 相机（唯一相机，渲染所有 2D 内容；HUD 也挂在它下面实现屏幕固定）----
        this._cameraNode = new Node('MainCamera');
        cameraParent.addChild(this._cameraNode);
        const cam = this._cameraNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.orthoHeight = CAMERA.viewHeight / 2;
        cam.near = CAMERA.near;
        cam.far = CAMERA.far;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        cam.clearColor = hexColor(0x233A28);
        this._cameraNode.setPosition(0, 0, CAMERA.camZ);

        // ---- 玩家中心点：金环 + 金点（与遗留 Web 原型一致的指挥官标记）----
        this.node = new Node('PlayerCenter');
        parent.addChild(this.node);
        this.node.addComponent(UITransform);
        const g = this.node.addComponent(Graphics);
        g.lineWidth = 2;
        g.strokeColor = C_RING;
        g.circle(0, 0, 16);
        g.stroke();
        g.fillColor = C_DOT;
        g.circle(0, 0, 4);
        g.fill();
        this.node.setPosition(0, 0, 3);
    }

    get cameraNode(): Node {
        return this._cameraNode;
    }

    setMoveKey(dir: MoveDir, down: boolean): void {
        this._keys[dir] = down;
    }

    /** @param keyCode Cocos KeyCode */
    applyKey(keyCode: number, down: boolean): boolean {
        switch (keyCode) {
            case KeyCode.KEY_W:
            case KeyCode.ARROW_UP:
                this._keys.up = down;
                return true;
            case KeyCode.KEY_S:
            case KeyCode.ARROW_DOWN:
                this._keys.down = down;
                return true;
            case KeyCode.KEY_A:
            case KeyCode.ARROW_LEFT:
                this._keys.left = down;
                return true;
            case KeyCode.KEY_D:
            case KeyCode.ARROW_RIGHT:
                this._keys.right = down;
                return true;
            default:
                return false;
        }
    }

    update(dt: number): void {
        let dx = 0;
        let dy = 0;
        if (this._keys.up) dy += 1;
        if (this._keys.down) dy -= 1;
        if (this._keys.left) dx -= 1;
        if (this._keys.right) dx += 1;
        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            this.x += (dx / len) * PLAYER.speed * dt;
            this.y += (dy / len) * PLAYER.speed * dt;
        }

        const hw = FIELD.width / 2 - PLAYER.radius;
        const hh = FIELD.height / 2 - PLAYER.radius;
        this.x = clamp(this.x, -hw, hw);
        this.y = clamp(this.y, -hh, hh);
        this.node.setPosition(this.x, this.y, 3);

        // 受击无敌帧：闪烁提示
        if (this._invT > 0) {
            this._invT -= dt;
            this._blinkT -= dt;
            if (this._blinkT <= 0) {
                this._blinkT = 0.1;
                this.node.active = !this.node.active;
            }
            if (this._invT <= 0) {
                this.node.active = true;
            }
        }
    }

    takeDamage(n: number): boolean {
        if (this._invT > 0 || this.hp <= 0) {
            return false;
        }
        this.hp -= n;
        this._invT = PLAYER.invincibleAfterHit;
        this._blinkT = 0;
        return true;
    }

    /** 相机跟随放在 lateUpdate：实体全部移动完再算，画面不与逻辑错位 */
    lateUpdate(dt: number): void {
        const k = 1 - Math.exp(-CAMERA.followLerp * dt);
        this._camX += (this.x - this._camX) * k;
        this._camY += (this.y - this._camY) * k;

        // 视野钳制：不露出战场外；视野比战场大时居中
        const halfH = CAMERA.viewHeight / 2;
        const halfW = halfH * currentAspect();
        let cx = this._camX;
        let cy = this._camY;
        if (FIELD.width > halfW * 2) {
            cx = clamp(cx, -FIELD.width / 2 + halfW, FIELD.width / 2 - halfW);
        } else {
            cx = 0;
        }
        if (FIELD.height > halfH * 2) {
            cy = clamp(cy, -FIELD.height / 2 + halfH, FIELD.height / 2 - halfH);
        } else {
            cy = 0;
        }
        this._cameraNode.setPosition(cx, cy, CAMERA.camZ);
    }

    snapCamera(): void {
        this._camX = this.x;
        this._camY = this.y;
    }

    reset(): void {
        this.x = 0;
        this.y = 0;
        this.hp = PLAYER.hp;
        this._invT = 0;
        this._keys.up = false;
        this._keys.down = false;
        this._keys.left = false;
        this._keys.right = false;
        this.node.active = true;
        this.node.setPosition(0, 0, 3);
        this.snapCamera();
    }
}
