import { Graphics, Node, UITransform } from 'cc';
import { BOSS, ENEMIES, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { TAU } from '../core/MathUtil';
import { ENEMY_DEATH_TIME } from '../battle/EnemyManager';
import type { Boss } from '../battle/BossController';
import type { AbilityFx } from '../battle/AbilitySystem';
import type { Enemy } from '../battle/EnemyManager';
import type { Hero } from '../battle/HeroSquad';
import type { Orb } from '../battle/OrbManager';
import type { Projectile } from '../battle/ProjectileManager';

// 预创建颜色：渲染热路径零分配（Graphics 赋值时会拷贝，可安全复用同一批 Color）
const C_WALKER = hexColor(ENEMIES.walker.color);
const C_FLYER = hexColor(ENEMIES.flyer.color);
const C_TANK = hexColor(ENEMIES.tank.color);
const C_FLASH_STRONG = hexColor(0xffffff, 235);
const C_FLASH_SOFT = hexColor(0xffffff, 110);
const C_EYE = hexColor(PALETTE.uiDeep);
const C_RING_DANGER = hexColor(PALETTE.danger, 220);
// 前摇"剩余时间"填充：从圈心涨到攻击半径，涨满即落地。
// alpha 刻意低（42）：混战时同屏十几只怪同时读条，深填充会把草地和怪全糊掉。
const C_RING_DANGER_FILL = hexColor(PALETTE.danger, 42);
const C_RING_CAST = hexColor(PALETTE.excite, 220);
const C_BULLET = hexColor(0xffe9a8);
const C_SPELL = hexColor(PALETTE.foxPurple);
const C_SPELL_CORE = hexColor(PALETTE.uiText);
const C_ORB = hexColor(PALETTE.safe);
const C_MEAT = hexColor(0xD9534F);
// 英雄前摇环：按饱食档位上色 —— 红环 = 全饿在打（伤害 ×0.6），玩家一眼看得见"该喂了"
const C_RING_HUNGRY = hexColor(PALETTE.gold, 230);
const C_RING_FULL = hexColor(PALETTE.gold, 110);
const C_RING_STARVING = hexColor(PALETTE.danger, 210);
const C_HERO_BODY = hexColor(0xffb6c1);
const C_HERO_SNOUT = hexColor(0xf291a8);
const C_HERO_EYE_W = hexColor(0xffffff);
// BOSS：AOE 填充刻意压到 alpha 60 —— 满半径 155px 的实心红会整片盖住 BOSS 本体，
// 读条看得见但"是谁在读条"看不见。淡填充 + 满圈粗边界，两个信息都要。
const C_BOSS_AOE = hexColor(PALETTE.danger, 60);
const C_BOSS_AOE_EDGE = hexColor(PALETTE.danger, 240);
const C_BOSS_AOE_BURST = hexColor(PALETTE.danger, 150);
const C_BOSS_BODY = hexColor(ENEMIES.tank.color);
const C_BOSS_FLASH = hexColor(0xffffff, 235);

// ---- 英雄技能（CR-017）----
// 淡出用「4 档预建色」而不是每帧 hexColor()：Graphics 的 fillColor 是拷贝语义，
// 但 hexColor 每次都会 new 一个 Color —— 3 个技能 × 60 帧 = 每秒 180 个临时对象。
const BEAM_FADE = [
    hexColor(0xfff6d0, 235),
    hexColor(0xfff6d0, 170),
    hexColor(0xfff6d0, 105),
    hexColor(0xfff6d0, 45),
];
const BEAM_CORE = [
    hexColor(0xffffff, 250),
    hexColor(0xffffff, 200),
    hexColor(0xffffff, 130),
    hexColor(0xffffff, 60),
];
// 落雷预警：低 alpha 的实心 + 亮边界（与敌人的红/橙前摇区分开，这是"我方技能"）
const C_BOLT_WARN_FILL = [hexColor(PALETTE.gold, 46), hexColor(PALETTE.gold, 34), hexColor(PALETTE.gold, 22), hexColor(PALETTE.gold, 12)];
const C_BOLT_WARN_EDGE = hexColor(PALETTE.gold, 210);
const C_BOLT_BURST = [
    hexColor(0xfff0a8, 240),
    hexColor(0xfff0a8, 175),
    hexColor(0xfff0a8, 110),
    hexColor(0xfff0a8, 45),
];
const C_NOVA = [
    hexColor(PALETTE.excite, 215),
    hexColor(PALETTE.excite, 155),
    hexColor(PALETTE.excite, 95),
    hexColor(PALETTE.excite, 38),
];
const C_BEAM_CRIT = hexColor(PALETTE.gold, 250);

/** 淡出档位：0 = 刚出现，3 = 快消失 */
function fadeStep(p: number): number {
    const i = Math.floor(p * 4);
    return i < 0 ? 0 : (i > 3 ? 3 : i);
}

/**
 * 全场实体批量渲染器：所有敌人/子弹/经验珠/怪窝/前摇圈/BOSS 特效画在同一个 Graphics 里。
 * 依据 3.8 源码：同组件多次 fill/stroke 合并为同一 mesh → 整个动态场只占 1 个 DrawCall
 * （对比每实体一个 Graphics：28 敌人就要 28+ DrawCall，直接爆 20 的验收线）。
 *
 * 有贴图的实体由自身节点上的 Sprite 渲染（同图集自动合批），这里只补画：
 *  - 无贴图实体的程序化兜底身体
 *  - 前摇/读条 telegraph 圈、BOSS 的 AOE 区域、受击白闪（美术指引 §4：状态全靠特效层，不画新帧）
 */
export class EntityRenderer {
    private _g: Graphics;
    private _t = 0;

    constructor(parent: Node) {
        const node = new Node('EntityRenderer');
        parent.addChild(node);
        node.addComponent(UITransform);
        this._g = node.addComponent(Graphics);
        node.setPosition(0, 0, 1);
    }

    tick(dt: number): void {
        this._t += dt;
    }

    redraw(
        heroes: Hero[],
        enemies: Enemy[],
        projectiles: Projectile[],
        orbs: Orb[],
        boss: Boss | null,
        abilities: readonly AbilityFx[] = [],
    ): void {
        const g = this._g;
        g.clear();
        this.drawEnemyBodies(enemies);
        this.drawHitFlash(enemies);
        this.drawTelegraphs(enemies);
        this.drawProjectiles(projectiles);
        this.drawAbilities(abilities);
        this.drawOrbs(orbs);
        this.drawHeroBodies(heroes);
        this.drawHeroRings(heroes);
        // BOSS 最后画：它体积最大，且 AOE 区域必须盖在杂兵之上才不会看漏
        this.drawBoss(boss);
    }

    // ---------------- 英雄技能（CR-017） ----------------

    /**
     * 三种技能的表现。全部画在同一个 Graphics 里，**不增加 DrawCall**。
     *
     * 表现设计原则（像素风下"技能感"靠形状，不靠光效）：
     *  - 贯穿 = **一条会消失的线**（锥形收窄），不画飞行物 —— 瞬发才有"斩"的意味；
     *  - 落雷 = **先圈后爆**（0.32s 预警里半径由大到小收缩，收缩到底就炸），
     *    与敌人前摇"由小涨到大"方向相反，玩家一眼能分清敌我；
     *  - 冲击 = **从脚下向外推的环**，环是余波，判定在炸开瞬间。
     */
    private drawAbilities(list: readonly AbilityFx[]): void {
        const g = this._g;

        // ---- 落雷预警（画在最底层：它是地面标记）----
        for (const fx of list) {
            if (fx.kind !== 'bolt' || fx.fired) continue;
            const p = Math.max(0, Math.min(1, fx.t / fx.warn));
            g.fillColor = C_BOLT_WARN_FILL[fadeStep(p * 0.6)];
            g.circle(fx.x, fx.y, fx.radius);
            g.fill();
        }

        // ---- 冲击波：从英雄脚下扩散的环 ----
        for (const fx of list) {
            if (fx.kind !== 'nova') continue;
            const p = Math.min(1, fx.t / fx.life);
            const r = fx.radius * (0.25 + 0.75 * p);
            g.strokeColor = C_NOVA[fadeStep(p)];
            g.lineWidth = Math.max(1, 5 - 4 * p);
            g.circle(fx.x, fx.y, r);
            g.stroke();
        }

        // ---- 贯穿：锥形收窄的光束（外层 + 内芯两层）----
        for (const fx of list) {
            if (fx.kind !== 'beam') continue;
            const p = Math.min(1, fx.t / fx.life);
            const step = fadeStep(p);
            let ux = fx.ex - fx.x;
            let uy = fx.ey - fx.y;
            const len = Math.hypot(ux, uy) || 1;
            ux /= len;
            uy /= len;
            const nx = -uy;
            const ny = ux;
            const hw = fx.halfWidth;
            const tipW = 2;

            // 外层：起点宽 hw → 终点宽 tipW
            g.fillColor = BEAM_FADE[step];
            g.moveTo(fx.x + nx * hw, fx.y + ny * hw);
            g.lineTo(fx.ex + nx * tipW, fx.ey + ny * tipW);
            g.lineTo(fx.ex - nx * tipW, fx.ey - ny * tipW);
            g.lineTo(fx.x - nx * hw, fx.y - ny * hw);
            g.close();
            g.fill();

            // 内芯：白色细线，让光束有"过曝"的中心
            const cw = hw * 0.38;
            g.fillColor = fx.crit ? C_BEAM_CRIT : BEAM_CORE[step];
            g.moveTo(fx.x + nx * cw, fx.y + ny * cw);
            g.lineTo(fx.ex + nx * 0.5, fx.ey + ny * 0.5);
            g.lineTo(fx.ex - nx * 0.5, fx.ey - ny * 0.5);
            g.lineTo(fx.x - nx * cw, fx.y - ny * cw);
            g.close();
            g.fill();
        }

        // ---- 落雷爆发（画在最上层：一闪而过的强反馈）----
        for (const fx of list) {
            if (fx.kind !== 'bolt' || !fx.fired) continue;
            const p = Math.min(1, (fx.t - fx.warn) / fx.life);
            const step = fadeStep(p);
            const r = fx.radius * (0.55 + 0.65 * p);

            g.fillColor = C_BOLT_BURST[step];
            // 中心闪光：四角星（两个扁菱形叠成），比纯圆更有"炸"的感觉
            this.diamond(g, fx.x, fx.y, fx.radius * 0.5 * (1 - p * 0.6));
            g.fill();
            this.diamond(g, fx.x, fx.y, fx.radius * 0.28 * (1 - p * 0.8));
            g.fill();

            g.strokeColor = C_BOLT_WARN_EDGE;
            g.lineWidth = Math.max(1, 4 - 3 * p);
            g.circle(fx.x, fx.y, r);
            g.stroke();
        }
    }

    // ---------------- 敌人身体（程序化兜底） ----------------

    private drawEnemyBodies(enemies: Enemy[]): void {
        const g = this._g;

        // 每种颜色一次 fill：内部多子路径合并，仍只算 1 个 DrawCall
        let n = 0;
        g.fillColor = C_WALKER;
        for (const e of enemies) {
            if (!this.needProcBody(e) || e.type !== 'walker') continue;
            this.bodyPolygon(g, e, 6);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_FLYER;
        for (const e of enemies) {
            if (!this.needProcBody(e) || e.type !== 'flyer') continue;
            this.bodyPolygon(g, e, 4);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_TANK;
        for (const e of enemies) {
            if (!this.needProcBody(e) || e.type !== 'tank') continue;
            this.bodyPolygon(g, e, 8);
            n++;
        }
        if (n > 0) g.fill();

        // 眼睛（暗色小方点，一次 fill 画完所有）
        n = 0;
        g.fillColor = C_EYE;
        for (const e of enemies) {
            if (!this.needProcBody(e)) continue;
            const r = e.def.radius * this.bodyScale(e);
            const rot = e.phase;
            this.diamond(g, e.x + Math.cos(rot) * r * 0.35 - Math.sin(rot) * r * 0.3, e.y + Math.sin(rot) * r * 0.35 + Math.cos(rot) * r * 0.3, 2);
            this.diamond(g, e.x + Math.cos(rot) * r * 0.35 + Math.sin(rot) * r * 0.3, e.y + Math.sin(rot) * r * 0.35 - Math.cos(rot) * r * 0.3, 2);
            n++;
        }
        if (n > 0) g.fill();
    }

    private needProcBody(e: Enemy): boolean {
        return e.active && !e.hasSprite;
    }

    /** 与 EnemyManager 里节点 scale 保持一致的缩放（死亡缩小 + 受击/前摇脉冲） */
    private bodyScale(e: Enemy): number {
        let k = 1;
        if (e.dying > 0) {
            k *= e.dying / ENEMY_DEATH_TIME;
        }
        if (e.hitPunch > 0) {
            k *= 1 + 0.3 * e.hitPunch;
        }
        if (e.state === 'windup' || e.state === 'castwindup') {
            k *= 1.12;
        }
        return k;
    }

    /** 程序化兜底身体的半径基准 = 碰撞半径 × 当前视觉缩放 */
    private bodyPolygon(g: Graphics, e: Enemy, sides: number): void {
        this.polygonAt(g, e.x, e.y, e.def.radius * this.bodyScale(e), sides, e.phase);
    }

    /** 通用正多边形（世界坐标 + 半径 + 边数 + 起始相位），供程序化身体与白闪复用 */
    private polygonAt(g: Graphics, x: number, y: number, r: number, sides: number, rot: number): void {
        for (let i = 0; i < sides; i++) {
            const a = rot + (i / sides) * TAU;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (i === 0) {
                g.moveTo(px, py);
            } else {
                g.lineTo(px, py);
            }
        }
        g.close();
    }

    // ---------------- 受击白闪 ----------------

    /**
     * 受击白闪（贴着图也必须闪）。
     *
     * 🐞 原实现的判据是 `needProcBody(e)`，而 `needProcBody = active && !hasSprite`——
     * 精灵一旦加载成功，这段白闪整段被跳过，敌人挨打只剩 30% 缩放脉冲（而缩放在
     * Point 采样下还会让像素颗粒抖动）。现在独立成层，判据只看 hitPunch，与贴图无关。
     *
     * 半径取贴图显示宽度的 0.72（略小于本体），让贴图自带的 1px 墨色描边露在白闪外侧：
     * 观感是「整只怪闪白但轮廓仍在」，而不是「变成一个白多边形」。
     */
    private drawHitFlash(enemies: Enemy[]): void {
        const g = this._g;
        // 强闪 / 余晖两档各一次 fill，仍合并进同一 mesh（= 1 DrawCall）
        for (let pass = 0; pass < 2; pass++) {
            const strong = pass === 0;
            let n = 0;
            g.fillColor = strong ? C_FLASH_STRONG : C_FLASH_SOFT;
            for (const e of enemies) {
                if (!e.active || e.dying > 0) continue;
                if (strong) {
                    if (e.hitPunch <= 0.55) continue;
                } else if (e.hitPunch <= 0.15 || e.hitPunch > 0.55) {
                    continue;
                }
                const r = e.def.displaySize * 0.5 * 0.72;
                const sides = e.type === 'flyer' ? 4 : (e.type === 'tank' ? 8 : 6);
                this.polygonAt(g, e.x, e.y, r, sides, e.phase);
                n++;
            }
            if (n > 0) g.fill();
        }
    }

    // ---------------- 前摇 / 读条圈 ----------------

    private drawTelegraphs(enemies: Enemy[]): void {
        const g = this._g;

        // 近战前摇：外圈 = 攻击半径（危险边界），内填充 = 剩余时间（涨满即落地）
        // 只画外圈时玩家只能看到"它要打"，看不到"还有多久"，走位就变成猜。
        let n = 0;
        g.fillColor = C_RING_DANGER_FILL;
        for (const e of enemies) {
            if (!e.active || e.dying > 0 || e.state !== 'windup') continue;
            const prog = 1 - Math.max(0, e.stateT) / e.def.windup;
            const r = Math.max(4, e.def.attackRange * prog);
            g.circle(e.x, e.y, r);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.strokeColor = C_RING_DANGER;
        g.lineWidth = 2;
        for (const e of enemies) {
            if (!e.active || e.dying > 0 || e.state !== 'windup') continue;
            g.circle(e.x, e.y, e.def.attackRange);
            n++;
        }
        if (n > 0) g.stroke();

        // 施法读条：半径渐涨的圈（橙色，CR-008 反应窗口）
        n = 0;
        g.strokeColor = C_RING_CAST;
        g.lineWidth = 3;
        for (const e of enemies) {
            if (!e.active || e.dying > 0 || e.state !== 'castwindup') continue;
            const prog = 1 - e.stateT / e.def.windup;
            g.circle(e.x, e.y, 18 + prog * 72);
            n++;
        }
        if (n > 0) g.stroke();
    }

    // ---------------- 弹道 / 经验珠 ----------------

    private drawProjectiles(projectiles: Projectile[]): void {
        const g = this._g;

        let n = 0;
        g.fillColor = C_BULLET;
        for (const p of projectiles) {
            if (!p.active || !p.fromPet) continue;
            this.diamond(g, p.x, p.y, p.r + 2);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_SPELL;
        for (const p of projectiles) {
            if (!p.active || p.fromPet) continue;
            this.diamond(g, p.x, p.y, p.r);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_SPELL_CORE;
        for (const p of projectiles) {
            if (!p.active || p.fromPet) continue;
            this.diamond(g, p.x, p.y, p.r * 0.45);
            n++;
        }
        if (n > 0) g.fill();
    }

    private drawOrbs(orbs: Orb[]): void {
        const g = this._g;

        // 经验珠：菱形 + 绿色
        let n = 0;
        g.fillColor = C_ORB;
        for (const o of orbs) {
            if (!o.active || o.kind !== 'exp') continue;
            const bob = Math.sin(this._t * 6 + o.x * 0.1) * 1.5;
            this.diamond(g, o.x, o.y + bob, 4);
            n++;
        }
        if (n > 0) g.fill();

        // 肉块：方块 + 红色 —— 形状与颜色同时区分（色弱玩家靠形状也读得出）
        n = 0;
        g.fillColor = C_MEAT;
        for (const o of orbs) {
            if (!o.active || o.kind !== 'meat') continue;
            const bob = Math.sin(this._t * 5 + o.x * 0.13) * 1.2;
            g.rect(o.x - 3.5, o.y + bob - 3.5, 7, 7);
            n++;
        }
        if (n > 0) g.fill();
    }

    // ---------------- 英雄（程序化兜底 + 前摇金环） ----------------

    private drawHeroBodies(heroes: Hero[]): void {
        const g = this._g;
        let n = 0;
        g.fillColor = C_HERO_BODY;
        for (const h of heroes) {
            if (h.hasSprite) continue;
            g.circle(h.x, h.y, 16);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_HERO_SNOUT;
        for (const h of heroes) {
            if (h.hasSprite) continue;
            g.ellipse(h.x + 9, h.y - 2, 5.5, 4.5);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_HERO_EYE_W;
        for (const h of heroes) {
            if (h.hasSprite) continue;
            // 耳朵（两个三角）
            g.moveTo(h.x - 11, h.y + 8);
            g.lineTo(h.x - 6, h.y + 20);
            g.lineTo(h.x - 2, h.y + 9);
            g.moveTo(h.x + 2, h.y + 9);
            g.lineTo(h.x + 6, h.y + 20);
            g.lineTo(h.x + 11, h.y + 8);
            // 眼睛（白底）
            g.circle(h.x + 6, h.y + 3, 3.5);
            g.circle(h.x - 2, h.y + 3, 3.5);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_EYE;
        for (const h of heroes) {
            if (h.hasSprite) continue;
            g.circle(h.x + 6.5, h.y + 3, 1.8);
            g.circle(h.x - 1.5, h.y + 3, 1.8);
            n++;
        }
        if (n > 0) g.fill();
    }

    /**
     * 英雄前摇环，颜色 = 饱食档位：
     *   金实（powerMul ≥1.4）= 半饿，火力 ×1.5（最强状态）
     *   金淡（1.0~1.4）      = 满饱，×1.0
     *   红  （<1.0）          = 全饿，×0.6 —— 红环一出现就是"该喂了"的信号
     * 三段各一次 stroke，仍在同一个 Graphics 内 → DrawCall 不涨。
     */
    private drawHeroRings(heroes: Hero[]): void {
        const g = this._g;
        g.lineWidth = 2;

        let n = 0;
        g.strokeColor = C_RING_HUNGRY;
        for (const h of heroes) {
            if (h.state !== 'telegraph' || h.powerMul < 1.4) continue;
            g.circle(h.x, h.y, 26);
            n++;
        }
        if (n > 0) g.stroke();

        n = 0;
        g.strokeColor = C_RING_FULL;
        for (const h of heroes) {
            if (h.state !== 'telegraph' || h.powerMul >= 1.4 || h.powerMul < 1.0) continue;
            g.circle(h.x, h.y, 26);
            n++;
        }
        if (n > 0) g.stroke();

        n = 0;
        g.strokeColor = C_RING_STARVING;
        for (const h of heroes) {
            if (h.state !== 'telegraph' || h.powerMul >= 1.0) continue;
            g.circle(h.x, h.y, 26);
            n++;
        }
        if (n > 0) g.stroke();
    }

    // ---------------- BOSS ----------------

    /**
     * BOSS：AOE 读条 + 兜底本体 + 落下爆闪 + 受击白闪。
     *
     * 读条用「淡红圆从中心扩散到满半径」表达剩余时间 —— 这是本作唯一需要玩家反应的东西，
     * 所以它必须是**屏幕上一眼就能读到**的：扩散 = 还剩多少，满圈 = 现在落下。
     */
    private drawBoss(boss: Boss | null): void {
        if (!boss || !boss.active) {
            return;
        }
        const g = this._g;

        // 1) 读条：扩散填充（alpha 60，不遮住本体）+ 满圈粗边界（危险区在哪）
        if (boss.state === 'aoeWindup') {
            const prog = 1 - Math.max(0, boss.stateT) / BOSS.aoeWindup;
            const r = Math.max(8, BOSS.aoeRadius * prog);
            g.fillColor = C_BOSS_AOE;
            g.circle(boss.x, boss.y, r);
            g.fill();

            g.strokeColor = C_BOSS_AOE_EDGE;
            g.lineWidth = 3;
            g.circle(boss.x, boss.y, BOSS.aoeRadius);
            g.stroke();
        }

        // 2) 程序化兜底本体（有贴图时不画，交给 Sprite 节点）
        if (!boss.hasSprite) {
            g.fillColor = C_BOSS_BODY;
            g.circle(boss.x, boss.y, BOSS.radius);
            g.fill();
        }

        // 3) 落下爆闪：一帧高亮，不靠动画
        if (boss.state === 'aoeStrike') {
            g.fillColor = C_BOSS_AOE_BURST;
            g.circle(boss.x, boss.y, BOSS.aoeRadius);
            g.fill();
        }

        // 4) 受击白闪
        if (boss.hitPunch > 0) {
            g.fillColor = C_BOSS_FLASH;
            g.circle(boss.x, boss.y, BOSS.displaySize * 0.5 * 0.72);
            g.fill();
        }
    }

    // ---------------- 基础图形 ----------------

    /** 菱形（4 子路径）：子弹/珠子/窝心点用，便于合并进同一次 fill */
    private diamond(g: Graphics, x: number, y: number, r: number): void {
        g.moveTo(x, y - r);
        g.lineTo(x + r, y);
        g.lineTo(x, y + r);
        g.lineTo(x - r, y);
        g.close();
    }
}
