import { Graphics, Label, Node, UITransform } from 'cc';
import { BOSS, CAMERA, PALETTE, PLAYER } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { visibleHalfSize } from '../core/ViewUtil';
import type { BattleDirector } from '../battle/BattleDirector';
import type { BossController } from '../battle/BossController';

const C_HEART = hexColor(PALETTE.danger);
const C_HEART_LOST = hexColor(PALETTE.uiPanel);
const C_TEXT = hexColor(PALETTE.uiText);
const C_BOSS_BAR_BG = hexColor(PALETTE.uiDeep, 220);
const C_BOSS_BAR = hexColor(PALETTE.danger);
const C_BOSS_BAR_EDGE = hexColor(PALETTE.gold);

const BOSS_BAR_W = 420;
const BOSS_BAR_H = 14;

/**
 * 战斗 HUD：血量（心形）+ 清窝进度 + BOSS 血条。
 * 挂在相机节点下实现屏幕固定；世界 z=100 在相机 near/far 之内。
 * 字号 15px：遵守"正文 ≥ 12px"铁律（三档字号切换留到 Day 2 UI 系统）。
 * 文字刷新节流 10Hz：避免每帧改 Label.string 产生字符串垃圾。
 */
export class BattleHud {
    private _root: Node;
    private _label: Label;
    private _hearts: Graphics;
    private _heartsNode: Node;
    private _bossBar: Graphics;
    private _bossBarNode: Node;
    private _bossLabel: Label;
    private _refreshT = 0;
    private _lastHp = -1;
    private _lastBossHp = -1;

    constructor(cameraNode: Node) {
        this._root = new Node('HUD');
        cameraNode.addChild(this._root);
        // 相机在 z=1000，局部 -900 => 世界 z=100
        this._root.setPosition(0, 0, -CAMERA.camZ + 100);

        // 统计文字（单 Label 多行 = 1 个 DrawCall）
        const labelNode = new Node('HUD_Stats');
        this._root.addChild(labelNode);
        labelNode.addComponent(UITransform);
        this._label = labelNode.addComponent(Label);
        this._label.fontSize = 15;
        this._label.lineHeight = 20;
        this._label.color = C_TEXT;
        this._label.horizontalAlign = Label.HorizontalAlign.LEFT;
        this._label.verticalAlign = Label.VerticalAlign.TOP;
        this._label.overflow = Label.Overflow.NONE;
        this._label.string = '';

        // 血量（Graphics 心形，血量变化才重画）
        this._heartsNode = new Node('HUD_Hearts');
        this._root.addChild(this._heartsNode);
        this._heartsNode.addComponent(UITransform);
        this._hearts = this._heartsNode.addComponent(Graphics);

        // BOSS 血条（顶部居中，仅 BOSS 阶段可见）
        this._bossBarNode = new Node('HUD_BossBar');
        this._root.addChild(this._bossBarNode);
        this._bossBarNode.addComponent(UITransform);
        this._bossBar = this._bossBarNode.addComponent(Graphics);
        this._bossBarNode.active = false;

        const bossLabelNode = new Node('HUD_BossName');
        this._root.addChild(bossLabelNode);
        bossLabelNode.addComponent(UITransform);
        this._bossLabel = bossLabelNode.addComponent(Label);
        this._bossLabel.fontSize = 14;
        this._bossLabel.lineHeight = 18;
        this._bossLabel.color = C_TEXT;
        this._bossLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this._bossLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this._bossLabel.overflow = Label.Overflow.NONE;
        this._bossLabel.string = '';
        bossLabelNode.active = false;
    }

    update(
        dt: number,
        director: BattleDirector,
        hp: number,
        nestsCleared: number,
        nestsTotal: number,
        boss: BossController | null,
        hint: string,
    ): void {
        const half = visibleHalfSize();

        // 布局：血量左上，统计在血量下一行（左对齐，不需要知道文本宽度）
        this._heartsNode.setPosition(-half.halfW + 24, half.halfH - 24, 0);
        this._label.node.setPosition(-half.halfW + 22, half.halfH - 48, 0);

        if (hp !== this._lastHp) {
            this._lastHp = hp;
            this.drawHearts(hp);
        }

        // BOSS 血条：只在 BOSS 在场时显示
        const showBoss = boss !== null && boss.alive;
        if (showBoss !== this._bossBarNode.active) {
            this._bossBarNode.active = showBoss;
            this._bossLabel.node.active = showBoss;
            this._lastBossHp = -1;
        }
        if (showBoss && boss) {
            this._bossBarNode.setPosition(0, half.halfH - 62, 0);
            this._bossLabel.node.setPosition(0, half.halfH - 38, 0);
            if (boss.hp !== this._lastBossHp) {
                this._lastBossHp = boss.hp;
                this.drawBossBar(boss.hp, boss.maxHp);
            }
        }

        this._refreshT -= dt;
        if (this._refreshT <= 0) {
            this._refreshT = 0.1;
            const s = director.stats;
            const sec = Math.floor(s.timeMs / 1000);
            const mm = Math.floor(sec / 60);
            const ss = sec - mm * 60;
            const clock = mm + ':' + (ss < 10 ? '0' : '') + ss;

            const line1 = director.phase === 'boss'
                ? 'BOSS 讨伐 · 击杀 ' + s.kills + ' · ' + clock
                : '清窝 ' + nestsCleared + '/' + nestsTotal + ' · 击杀 ' + s.kills + ' · ' + clock;

            this._label.string = line1 + '\n' + '拾取 ' + s.orbs + '\n' + hint;
            if (showBoss && this._bossLabel.string !== BOSS.name) {
                this._bossLabel.string = BOSS.name;
            }
        }
    }

    private drawHearts(hp: number): void {
        const g = this._hearts;
        g.clear();
        for (let i = 0; i < PLAYER.hp; i++) {
            const x = i * 20;
            const alive = i < hp;
            g.fillColor = alive ? C_HEART : C_HEART_LOST;
            // 心形 = 双圆 + 下尖三角（像素风足够可读）
            g.circle(x - 4, 2, 5);
            g.circle(x + 4, 2, 5);
            g.moveTo(x - 8.5, 3);
            g.lineTo(x + 8.5, 3);
            g.lineTo(x, 11);
            g.close();
            g.fill();
        }
    }

    /** BOSS 血条：左端为 0，向右填充（保留"还剩多少"的直觉读数） */
    private drawBossBar(hp: number, maxHp: number): void {
        const g = this._bossBar;
        g.clear();
        const x = -BOSS_BAR_W / 2;
        const y = -BOSS_BAR_H / 2;

        g.fillColor = C_BOSS_BAR_BG;
        g.rect(x, y, BOSS_BAR_W, BOSS_BAR_H);
        g.fill();

        const k = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
        if (k > 0) {
            g.fillColor = C_BOSS_BAR;
            g.rect(x, y, BOSS_BAR_W * k, BOSS_BAR_H);
            g.fill();
        }

        g.strokeColor = C_BOSS_BAR_EDGE;
        g.lineWidth = 2;
        g.rect(x, y, BOSS_BAR_W, BOSS_BAR_H);
        g.stroke();
    }
}
