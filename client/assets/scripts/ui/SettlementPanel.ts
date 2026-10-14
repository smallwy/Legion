import { Graphics, Label, Node, UITransform } from 'cc';
import { CAMERA, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { visibleHalfSize } from '../core/ViewUtil';
import type { BattleStats } from '../battle/BattleDirector';

const C_DIM = hexColor(0x000000, 150);
const C_PANEL = hexColor(PALETTE.uiPanel);
const C_PANEL_EDGE = hexColor(PALETTE.wood);
const C_TEXT = hexColor(PALETTE.uiText);

/**
 * 结算面板：远征结束（时间到 / 主动撤离 / HP 归零）时弹出。
 * 红线②（无失败惩罚）：HP 归零也只是"体力不支撤退"，照常结算战利品。
 * 资源映射为暂定值（Day 3 接入家园资源池后回写）：
 *   食物 = 经验珠数，材料 = floor(击杀/2)，特殊 = 0。
 */
export class SettlementPanel {
    private _root: Node;
    private _dim: Graphics;
    private _panel: Graphics;
    private _label: Label;
    private _shown = false;

    constructor(cameraNode: Node) {
        this._root = new Node('Settlement');
        cameraNode.addChild(this._root);
        this._root.setPosition(0, 0, -CAMERA.camZ + 101);
        this._root.active = false;

        const dimNode = new Node('Settlement_Dim');
        this._root.addChild(dimNode);
        dimNode.addComponent(UITransform);
        this._dim = dimNode.addComponent(Graphics);

        const panelNode = new Node('Settlement_Panel');
        this._root.addChild(panelNode);
        panelNode.addComponent(UITransform);
        this._panel = panelNode.addComponent(Graphics);

        const labelNode = new Node('Settlement_Text');
        this._root.addChild(labelNode);
        labelNode.addComponent(UITransform);
        this._label = labelNode.addComponent(Label);
        this._label.fontSize = 16;
        this._label.lineHeight = 26;
        this._label.color = C_TEXT;
        this._label.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._label.verticalAlign = Label.VerticalAlign.CENTER;
        this._label.overflow = Label.Overflow.NONE;
    }

    get shown(): boolean {
        return this._shown;
    }

    /** 每帧调用（仅在显示时）：按当前窗口尺寸重排 */
    layout(): void {
        if (!this._shown) return;
        const half = visibleHalfSize();

        const d = this._dim;
        d.clear();
        d.fillColor = C_DIM;
        d.rect(-half.halfW, -half.halfH, half.halfW * 2, half.halfH * 2);
        d.fill();

        const p = this._panel;
        p.clear();
        p.fillColor = C_PANEL;
        p.roundRect(-280, -170, 560, 340, 14);
        p.fill();
        p.strokeColor = C_PANEL_EDGE;
        p.lineWidth = 3;
        p.roundRect(-280, -170, 560, 340, 14);
        p.stroke();
    }

    show(stats: BattleStats): void {
        const sec = Math.floor(stats.timeMs / 1000);
        const mm = Math.floor(sec / 60);
        const ss = sec - mm * 60;
        const reason = stats.endReason === 'hp0' ? '体力不支，带着食物回家' : '主动撤离';
        const food = stats.orbs;
        const material = Math.floor(stats.kills / 2);

        this._label.string =
            '—— 远征结束（' + reason + '）——\n' +
            '击杀 ' + stats.kills + ' · 经验珠 ' + stats.orbs + ' · 用时 ' + mm + ':' + (ss < 10 ? '0' : '') + ss + '\n' +
            '预估带回：食物 ' + food + ' · 材料 ' + material + '\n' +
            '（资源入池在家园场景接线，Day 3）\n' +
            '空格 / 点击鼠标 · 再次远征';

        this._shown = true;
        this._root.active = true;
        this.layout();
    }

    hide(): void {
        this._shown = false;
        this._root.active = false;
    }
}
