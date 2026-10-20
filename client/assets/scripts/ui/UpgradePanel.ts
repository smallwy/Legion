import { Color, Graphics, Label, Node, UITransform } from 'cc';
import { CAMERA, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { visibleHalfSize } from '../core/ViewUtil';
import type { UpgradeDef, UpgradeId, UpgradeSystem } from '../battle/UpgradeSystem';

const C_DIM = hexColor(0x000000, 130);
const C_CARD = hexColor(PALETTE.uiPanel);
const C_CARD_EDGE = hexColor(PALETTE.wood);
const C_TEXT = hexColor(PALETTE.uiText);
const C_DIM_TEXT = hexColor(PALETTE.uiText, 150);
const C_KEY_BG = hexColor(PALETTE.uiDeep);

const CARD_W = 190;
const CARD_H = 210;
const CARD_GAP = 18;

/**
 * 三选一强化面板（CR-015）。
 *
 * 用键盘 1/2/3 选择 —— 不做点击的理由：一局要弹 9~11 次，鼠标玩家在 WASD 上，
 * 中途切鼠标会打断走位手感；键盘三键是零位移的选择方式。
 *
 * 面板打开期间 `BattleDirector.paused = true`，世界冻结。
 */
export class UpgradePanel {
    /** 玩家选定后回调（把 id 交回 Bootstrap → UpgradeSystem.choose） */
    onPick: ((id: UpgradeId) => void) | null = null;

    private _root: Node;
    private _dim: Graphics;
    private _title: Label;
    private _cards: {
        node: Node;
        g: Graphics;
        key: Label;
        name: Label;
        desc: Label;
        stack: Label;
    }[] = [];
    private _choices: UpgradeDef[] = [];
    private _level = 1;
    private _shown = false;

    constructor(cameraNode: Node) {
        this._root = new Node('UpgradePick');
        cameraNode.addChild(this._root);
        // 比结算面板低一层（z 小 1）：万一同时出现，结算是终点
        this._root.setPosition(0, 0, -CAMERA.camZ + 102);
        this._root.active = false;

        const dimNode = new Node('Upgrade_Dim');
        this._root.addChild(dimNode);
        dimNode.addComponent(UITransform);
        this._dim = dimNode.addComponent(Graphics);

        const titleNode = new Node('Upgrade_Title');
        this._root.addChild(titleNode);
        titleNode.addComponent(UITransform);
        this._title = titleNode.addComponent(Label);
        this._title.fontSize = 20;
        this._title.lineHeight = 26;
        this._title.color = C_TEXT;
        this._title.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._title.verticalAlign = Label.VerticalAlign.CENTER;
        this._title.overflow = Label.Overflow.NONE;
        this._title.string = '';

        for (let i = 0; i < 3; i++) {
            const node = new Node('Upgrade_Card' + i);
            this._root.addChild(node);
            node.addComponent(UITransform);
            const g = node.addComponent(Graphics);

            const key = this.makeLabel(node, 16, C_DIM_TEXT, 0, CARD_H / 2 - 26);
            key.string = String(i + 1);

            const name = this.makeLabel(node, 18, C_TEXT, 0, CARD_H / 2 - 62);
            name.string = '';

            const desc = this.makeLabel(node, 14, C_DIM_TEXT, 0, 6);
            desc.node.getComponent(UITransform)?.setContentSize(CARD_W - 26, 70);
            desc.overflow = Label.Overflow.RESIZE_HEIGHT;
            desc.string = '';

            const stack = this.makeLabel(node, 13, C_DIM_TEXT, 0, -CARD_H / 2 + 24);
            stack.string = '';

            this._cards.push({ node, g, key, name, desc, stack });
        }
    }

    get shown(): boolean {
        return this._shown;
    }

    /** 面板打开（choices 通常 3 个，卡池耗尽时可能更少） */
    show(choices: UpgradeDef[], up: UpgradeSystem): void {
        this._choices = choices;
        this._level = up.level;
        this._shown = true;
        this._root.active = true;

        for (let i = 0; i < this._cards.length; i++) {
            const c = this._cards[i];
            const def = choices[i];
            if (!def) {
                c.node.active = false;
                continue;
            }
            c.node.active = true;
            c.key.string = String(i + 1);
            c.name.string = def.name;
            c.desc.string = def.desc;
            const cur = up.stackOf(def.id);
            c.stack.string = cur > 0 ? (cur + '/' + def.maxStack + ' · 已强化') : ('可强化至 ' + def.maxStack);
        }
        this._title.string = '吃饱了，长本事 · Lv ' + up.level + '　按 1 / 2 / 3 选择';
        this.layout();
    }

    hide(): void {
        this._shown = false;
        this._root.active = false;
        this._choices = [];
    }

    /** 键盘选择；返回是否被消费 */
    pickByIndex(i: number): boolean {
        if (!this._shown) return false;
        const def = this._choices[i];
        if (!def) return false;
        if (this.onPick) {
            this.onPick(def.id);
        }
        return true;
    }

    /** 每帧调用（仅在显示时）：按当前窗口尺寸重排 */
    layout(): void {
        if (!this._shown) {
            return;
        }
        const half = visibleHalfSize();

        const d = this._dim;
        d.clear();
        d.fillColor = C_DIM;
        d.rect(-half.halfW, -half.halfH, half.halfW * 2, half.halfH * 2);
        d.fill();

        const total = this._cards.length * CARD_W + (this._cards.length - 1) * CARD_GAP;
        const startX = -total / 2 + CARD_W / 2;

        this._title.node.setPosition(0, CARD_H / 2 + 56, 0);

        for (let i = 0; i < this._cards.length; i++) {
            const c = this._cards[i];
            const def = this._choices[i];
            if (!def) continue;
            const x = startX + i * (CARD_W + CARD_GAP);
            c.node.setPosition(x, 0, 0);

            const g = c.g;
            g.clear();
            g.fillColor = C_CARD;
            g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10);
            g.fill();
            g.strokeColor = hexColor(def.color, 220);
            g.lineWidth = 2.5;
            g.roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10);
            g.stroke();

            // 左上角键位底块（让"按 1"这件事在卡上就有落点）
            g.fillColor = C_KEY_BG;
            g.roundRect(-CARD_W / 2 + 10, CARD_H / 2 - 40, 26, 26, 6);
            g.fill();
        }
    }

    private makeLabel(parent: Node, size: number, color: Color, x: number, y: number): Label {
        const node = new Node('L');
        parent.addChild(node);
        node.addComponent(UITransform);
        const l = node.addComponent(Label);
        l.fontSize = size;
        l.lineHeight = Math.round(size * 1.45);
        l.color = color;
        l.horizontalAlign = Label.HorizontalAlign.CENTER;
        l.verticalAlign = Label.VerticalAlign.CENTER;
        l.overflow = Label.Overflow.NONE;
        l.string = '';
        node.setPosition(x, y, 0);
        return l;
    }
}
