import { Graphics, Label, Node, UITransform } from 'cc';
import { BOSS, CAMERA, PALETTE, PLAYER, SATIETY } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { visibleHalfSize } from '../core/ViewUtil';
import type { BattleDirector } from '../battle/BattleDirector';
import type { BossController } from '../battle/BossController';
import type { SatietyTier } from '../battle/HeroSquad';

const C_HEART = hexColor(PALETTE.danger);
const C_HEART_LOST = hexColor(PALETTE.uiPanel);
const C_TEXT = hexColor(PALETTE.uiText);
const C_BOSS_BAR_BG = hexColor(PALETTE.uiDeep, 220);
const C_BOSS_BAR = hexColor(PALETTE.danger);
const C_BOSS_BAR_EDGE = hexColor(PALETTE.gold);

const C_BAR_BG = hexColor(PALETTE.uiDeep, 210);
const C_BAR_EDGE = hexColor(PALETTE.wood, 200);
const C_SATIETY_FULL = hexColor(PALETTE.safe);
const C_SATIETY_HUNGRY = hexColor(PALETTE.gold);
const C_SATIETY_STARVING = hexColor(PALETTE.danger);
// 半饿区间（30~70）的极淡底衬：它是"最强状态"，必须一眼看出自己在不在里面
const C_SATIETY_SWEET = hexColor(PALETTE.gold, 38);
const C_EXP_BAR = hexColor(PALETTE.safe);
const C_TICK = hexColor(0x000000, 90);

const BOSS_BAR_W = 420;
const BOSS_BAR_H = 14;
const BAR_W = 210;
const SATIETY_H = 12;

/** HUD 每帧需要的全部状态（参数打包，避免 10 个位置的签名） */
export interface HudState {
    hp: number;
    level: number;
    /** 0..1 经验进度 */
    exp: number;
    /** 0..SATIETY.max */
    satiety: number;
    tier: SatietyTier;
    meat: number;
    canFeed: boolean;
    boss: BossController | null;
    hint: string;
}

/**
 * 战斗 HUD：血量 + **饱食度** + 等级经验 + 波次/肉块 + BOSS 血条。
 * 挂在相机节点下实现屏幕固定；世界 z=100 在相机 near/far 之内。
 * 字号 ≥13px：遵守"正文至少 12px"铁律。
 * 文字刷新节流 10Hz：避免每帧改 Label.string 产生字符串垃圾。
 *
 * 饱食度条是本作最重要的 HUD 元素 —— 它同时表达三件事：
 * 现在多饿（填充长度）、在哪个档位（颜色）、离"最强"还差多少（半饿区间底衬）。
 */
export class BattleHud {
    private _root: Node;
    private _label: Label;
    private _hearts: Graphics;
    private _heartsNode: Node;
    private _bars: Graphics;
    private _barsNode: Node;
    private _bossBar: Graphics;
    private _bossBarNode: Node;
    private _bossLabel: Label;
    private _refreshT = 0;
    private _lastHp = -1;
    private _lastSatiety = -2;
    private _lastExpRaw = -1;
    private _lastMeat = -1;
    private _lastFeedable = false;
    private _lastLevel = -1;
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

        // 饱食度 + 经验条（同一 Graphics → 1 DrawCall）
        this._barsNode = new Node('HUD_Bars');
        this._root.addChild(this._barsNode);
        this._barsNode.addComponent(UITransform);
        this._bars = this._barsNode.addComponent(Graphics);

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

    update(dt: number, director: BattleDirector, s: HudState): void {
        const half = visibleHalfSize();
        const leftX = -half.halfW + 24;

        // 布局：血量 → 饱食度条 → 经验条 → 文字（左对齐纵列）
        this._heartsNode.setPosition(leftX, half.halfH - 24, 0);
        this._barsNode.setPosition(leftX, half.halfH - 58, 0);
        this._label.node.setPosition(leftX - 2, half.halfH - 92, 0);

        const satietyChanged = Math.abs(s.satiety - this._lastSatiety) > 0.05;
        if (s.hp !== this._lastHp) {
            this._lastHp = s.hp;
            this.drawHearts(s.hp);
        }
        if (satietyChanged || s.level !== this._lastLevel || Math.abs(s.exp - this._lastExpRaw) > 0.01) {
            this._lastSatiety = s.satiety;
            this._lastLevel = s.level;
            this._lastExpRaw = s.exp;
            this.drawBars(s.satiety, s.tier, s.exp);
        }

        // BOSS 血条：只在 BOSS 在场时显示
        const showBoss = s.boss !== null && s.boss.alive;
        if (showBoss !== this._bossBarNode.active) {
            this._bossBarNode.active = showBoss;
            this._bossLabel.node.active = showBoss;
            this._lastBossHp = -1;
        }
        if (showBoss && s.boss) {
            this._bossBarNode.setPosition(0, half.halfH - 62, 0);
            this._bossLabel.node.setPosition(0, half.halfH - 38, 0);
            if (s.boss.hp !== this._lastBossHp) {
                this._lastBossHp = s.boss.hp;
                this.drawBossBar(s.boss.hp, s.boss.maxHp);
            }
        }

        this._refreshT -= dt;
        if (this._refreshT <= 0) {
            this._refreshT = 0.1;
            const st = director.stats;
            const sec = Math.floor(st.timeMs / 1000);
            const mm = Math.floor(sec / 60);
            const ss = sec - mm * 60;
            const clock = mm + ':' + (ss < 10 ? '0' : '') + ss;

            const waveLine = director.phase === 'boss'
                ? '第 ' + st.waveTotal + '/' + st.waveTotal + ' 波 · BOSS 讨伐'
                : '第 ' + Math.max(1, st.wave) + '/' + st.waveTotal + ' 波';

            const feedLine = s.canFeed
                ? '肉块 ' + s.meat + ' · F 喂食'
                : (s.meat <= 0 ? '肉块 0 · 打怪掉肉' : '肉块 ' + s.meat + ' · 喂食冷却');

            this._label.string =
                waveLine + ' · 击杀 ' + st.kills + ' · ' + clock + '\n' +
                'Lv ' + s.level + ' · ' + feedLine + '\n' +
                s.hint;
            if (showBoss && this._bossLabel.string !== BOSS.name) {
                this._bossLabel.string = BOSS.name;
            }
        }

        // 肉块/可喂状态变化时给个视觉提示（条本身不变，靠颜色微调）
        if (s.meat !== this._lastMeat || s.canFeed !== this._lastFeedable) {
            this._lastMeat = s.meat;
            this._lastFeedable = s.canFeed;
            this.drawBars(s.satiety, s.tier, s.exp);
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

    /**
     * 饱食度条（宽 210）：
     *  - 底条 + 半饿区间底衬（30~70 段淡金）
     *  - 填充色随档位：满饱绿 / 半饿金 / 全饿红
     *  - 两条刻度线标出 30 与 70 的边界
     *  - 下方细经验条（宽 210，高 5）
     */
    private drawBars(satiety: number, tier: SatietyTier, exp: number): void {
        const g = this._bars;
        g.clear();

        const x0 = 0;
        const y0 = 0;
        const k = Math.max(0, Math.min(1, satiety / SATIETY.max));

        // 底
        g.fillColor = C_BAR_BG;
        g.roundRect(x0, y0, BAR_W, SATIETY_H, 4);
        g.fill();

        // 半饿区间底衬（最强区，值得被看见）
        const lowK = SATIETY.hungryLine / SATIETY.max;
        const highK = SATIETY.fullLine / SATIETY.max;
        g.fillColor = C_SATIETY_SWEET;
        g.rect(x0 + BAR_W * lowK, y0, BAR_W * (highK - lowK), SATIETY_H);
        g.fill();

        // 填充
        if (k > 0) {
            g.fillColor = tier === 'full' ? C_SATIETY_FULL : (tier === 'hungry' ? C_SATIETY_HUNGRY : C_SATIETY_STARVING);
            g.roundRect(x0, y0, BAR_W * k, SATIETY_H, 4);
            g.fill();
        }

        // 边界刻度
        g.fillColor = C_TICK;
        g.rect(x0 + BAR_W * lowK - 1, y0 - 2, 2, SATIETY_H + 4);
        g.fill();
        g.rect(x0 + BAR_W * highK - 1, y0 - 2, 2, SATIETY_H + 4);
        g.fill();

        // 边框
        g.strokeColor = C_BAR_EDGE;
        g.lineWidth = 1;
        g.roundRect(x0, y0, BAR_W, SATIETY_H, 4);
        g.stroke();

        // 经验条（在饱食度条下方 6px）
        const ey = y0 - 12;
        const EH = 5;
        g.fillColor = C_BAR_BG;
        g.roundRect(x0, ey, BAR_W, EH, 2);
        g.fill();
        const ek = Math.max(0, Math.min(1, exp));
        if (ek > 0) {
            g.fillColor = C_EXP_BAR;
            g.roundRect(x0, ey, BAR_W * ek, EH, 2);
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
