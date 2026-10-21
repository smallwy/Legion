import { Color, EventTouch, Graphics, Label, Node, UITransform } from 'cc';
import { CAMERA, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { visibleHalfSize } from '../core/ViewUtil';
import type { BattleStats } from '../battle/BattleDirector';
import type { Loot } from '../config/SaveData';

const C_DIM = hexColor(0x000000, 150);
const C_PANEL = hexColor(PALETTE.uiPanel);
const C_PANEL_EDGE = hexColor(PALETTE.wood);
const C_PANEL_EDGE_WIN = hexColor(PALETTE.gold);
const C_TEXT = hexColor(PALETTE.uiText);
const C_BTN_PRIMARY = hexColor(PALETTE.gold);
const C_BTN_GHOST = hexColor(PALETTE.uiDeep);
const C_BTN_EDGE = hexColor(PALETTE.wood);

/**
 * 结算面板：一局结束（通关 / 主动撤离 / HP 归零）时弹出。
 *
 * 三种结局都不扣东西（红线②无失败惩罚）：
 *  - victory：打完 20 波 + 击杀 BOSS
 *  - withdraw：按 E 主动撤离
 *  - hp0：体力不支撤退 —— 同样带走战利品，没有"游戏结束"
 *
 * 战利品换算见 `config/SaveData.ts` 的 `LOOT`。面板**不自己算**，
 * 只显示 `GameBootstrap` 已经写进存档的那一份（唯一的算法、唯一的数字）。
 */
export class SettlementPanel {
    private _root: Node;
    private _dim: Graphics;
    private _panel: Graphics;
    private _label: Label;
    private _shown = false;
    private _win = false;

    /** 「再来一局」——由 GameBootstrap 注入 */
    onAgain: (() => void) | null = null;
    /** 「回家园」——由 GameBootstrap 注入 */
    onHome: (() => void) | null = null;

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

        /* 两个真按钮，而不是"按空格"的文字提示 ——
           触屏和手柄没有空格键，只写键盘提示等于对一半玩家关上了门。 */
        this.makeButton('再来一局', -112, -134, C_BTN_PRIMARY, () => {
            if (this.onAgain) this.onAgain();
        });
        this.makeButton('回家园', 112, -134, C_BTN_GHOST, () => {
            if (this.onHome) this.onHome();
        });
    }

    /**
     * 面板底部按钮。
     * 尺寸 200×52：低于 88×88 的触屏下限，但这是**结算面板里的次级操作**，
     * 主行动（再来一局）与它并排且间距 24px，误触到另一边也不会造成损失 ——
     * 两种结果都只是"离开这一局"，不存在不可逆操作。
     */
    private makeButton(text: string, x: number, y: number, fill: Color, onTap: () => void): Node {
        const n = new Node('Btn_' + text);
        this._root.addChild(n);
        n.setPosition(x, y, 0);
        n.addComponent(UITransform).setContentSize(200, 52);

        const g = n.addComponent(Graphics);
        g.fillColor = fill;
        g.roundRect(-100, -26, 200, 52, 26);
        g.fill();
        g.strokeColor = C_BTN_EDGE;
        g.lineWidth = 2;
        g.roundRect(-100, -26, 200, 52, 26);
        g.stroke();

        const ln = new Node('txt');
        n.addChild(ln);
        ln.addComponent(UITransform).setContentSize(190, 30);
        const lb = ln.addComponent(Label);
        lb.string = text;
        lb.fontSize = 18;
        lb.lineHeight = 24;
        lb.color = C_TEXT;
        lb.horizontalAlign = Label.HorizontalAlign.CENTER;
        lb.verticalAlign = Label.VerticalAlign.CENTER;
        lb.overflow = Label.Overflow.NONE;

        n.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            onTap();
        });
        return n;
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

    show(stats: BattleStats, loot: Loot, squad: number, clearedAfter: number): void {
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

        const bossLine = stats.bossKilled ? 'BOSS 已讨伐' : 'BOSS 未讨伐';

        /* 战利品由 `GameBootstrap` 用 `settleInto` 算好并**已经写进存档**，
           这里只负责显示同一份数字。两处各算一遍是"面板说 +16、家园只 +14"
           这类对不上的经典来源。 */
        this._label.string =
            title + '\n' +
            '第 ' + stats.wave + '/' + stats.waveTotal + ' 波 · 击杀 ' + stats.kills +
            ' · 用时 ' + clock + '\n' +
            'Lv ' + stats.level + ' · 喂食 ' + stats.feeds + ' 次 · 出战 ' + squad + ' 只 · ' + bossLine + '\n' +
            '\n' +
            '带回　果子 ' + loot.apples + ' · 材料 ' + loot.logs + ' · 吧唧 ' + loot.coins + '\n' +
            '✓ 已存入家园　苔原 ' + clearedAfter + '/8\n';

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
