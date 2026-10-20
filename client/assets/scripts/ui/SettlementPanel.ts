import { Graphics, Label, Node, UITransform } from 'cc';
import { CAMERA, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { visibleHalfSize } from '../core/ViewUtil';
import type { BattleStats } from '../battle/BattleDirector';

const C_DIM = hexColor(0x000000, 150);
const C_PANEL = hexColor(PALETTE.uiPanel);
const C_PANEL_EDGE = hexColor(PALETTE.wood);
const C_PANEL_EDGE_WIN = hexColor(PALETTE.gold);
const C_TEXT = hexColor(PALETTE.uiText);

/**
 * 结算面板：一局结束（通关 / 主动撤离 / HP 归零）时弹出。
 *
 * 三种结局都不扣东西（红线②无失败惩罚）：
 *  - victory：打完 20 波 + 击杀 BOSS
 *  - withdraw：按 E 主动撤离
 *  - hp0：体力不支撤退 —— 同样带走战利品，没有"游戏结束"
 *
 * 资源映射为暂定值（M2 接入家园资源池后回写）：
 *   食物 = 经验珠数，材料 = floor(击杀/2)。
 */
export class SettlementPanel {
    private _root: Node;
    private _dim: Graphics;
    private _panel: Graphics;
    private _label: Label;
    private _shown = false;
    private _win = false;

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
        if (!this._shown) {
            return;
        }
        const half = visibleHalfSize();

        const d = this._dim;
        d.clear();
        d.fillColor = C_DIM;
        d.rect(-half.halfW, -half.halfH, half.halfW * 2, half.halfH * 2);
        d.fill();

        const p = this._panel;
        p.clear();
        p.fillColor = C_PANEL;
        p.roundRect(-290, -180, 580, 360, 14);
        p.fill();
        p.strokeColor = this._win ? C_PANEL_EDGE_WIN : C_PANEL_EDGE;
        p.lineWidth = 3;
        p.roundRect(-290, -180, 580, 360, 14);
        p.stroke();
    }

    show(stats: BattleStats): void {
        const sec = Math.floor(stats.timeMs / 1000);
        const mm = Math.floor(sec / 60);
        const ss = sec - mm * 60;
        const clock = mm + ':' + (ss < 10 ? '0' : '') + ss;

        let title = '—— 主动撤离 ——';
        if (stats.endReason === 'victory') {
            title = '—— 讨伐成功 ——';
        } else if (stats.endReason === 'hp0') {
            title = '—— 体力不支，带着战利品回家 ——';
        }

        const food = stats.orbs;
        const material = Math.floor(stats.kills / 2);
        const bossLine = stats.bossKilled ? 'BOSS 已讨伐' : 'BOSS 未讨伐';

        this._label.string =
            title + '\n' +
            '第 ' + stats.wave + '/' + stats.waveTotal + ' 波 · ' + bossLine + '\n' +
            '击杀 ' + stats.kills + ' · 经验 ' + stats.orbs + ' · 用时 ' + clock + '\n' +
            'Lv ' + stats.level + ' · 喂食 ' + stats.feeds + ' 次\n' +
            '预估带回：食物 ' + food + ' · 材料 ' + material + '\n' +
            '（资源入池在家园场景接线，M2）\n' +
            '空格 / 点击鼠标 · 再次出征';

        this._win = stats.endReason === 'victory';
        this._shown = true;
        this._root.active = true;
        this.layout();
    }

    hide(): void {
        this._shown = false;
        this._root.active = false;
    }
}
