import { Graphics, Node, UITransform } from 'cc';
import { BOSS, ENEMIES, NEST, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { TAU } from '../core/MathUtil';
import { ENEMY_DEATH_TIME } from '../battle/EnemyManager';
import type { Boss } from '../battle/BossController';
import type { Nest } from '../battle/EncounterManager';
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
const C_RING_GOLD = hexColor(PALETTE.gold, 220);
const C_BULLET = hexColor(0xffe9a8);
const C_SPELL = hexColor(PALETTE.foxPurple);
const C_SPELL_CORE = hexColor(PALETTE.uiText);
const C_ORB = hexColor(PALETTE.safe);
const C_NEST_DORMANT = hexColor(PALETTE.wood, 90);
const C_NEST_ACTIVE = hexColor(PALETTE.excite, 150);
const C_NEST_CLEARED = hexColor(0x9a9a9a, 60);
const C_NEST_DOT_DORMANT = hexColor(PALETTE.wood);
const C_NEST_DOT_ACTIVE = hexColor(PALETTE.excite);
const C_NEST_DOT_CLEARED = hexColor(0x9a9a9a);
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
        nests: Nest[],
        projectiles: Projectile[],
        orbs: Orb[],
        boss: Boss | null,
    ): void {
        const g = this._g;
        g.clear();
        this.drawNests(nests);
        this.drawEnemyBodies(enemies);
        this.drawHitFlash(enemies);
        this.drawTelegraphs(enemies);
        this.drawProjectiles(projectiles);
        this.drawOrbs(orbs);
        this.drawHeroBodies(heroes);
        this.drawHeroRings(heroes);
        // BOSS 最后画：它体积最大，且 AOE 区域必须盖在杂兵之上才不会看漏
        this.drawBoss(boss);
    }

    // ---------------- 怪窝标记 ----------------

    private drawNests(nests: Nest[]): void {
        const g = this._g;
        g.lineWidth = 2;

        // 触发圈：三种状态各一次 stroke
        let n = 0;
        g.strokeColor = C_NEST_DORMANT;
        for (const nest of nests) {
            if (nest.state !== 'dormant') continue;
            g.circle(nest.x, nest.y, NEST.triggerRange);
            n++;
        }
        if (n > 0) g.stroke();

        n = 0;
        g.strokeColor = C_NEST_ACTIVE;
        for (const nest of nests) {
            if (nest.state !== 'active') continue;
            // 活跃圈脉冲（提示玩家"这窝活了"）
            g.circle(nest.x, nest.y, NEST.triggerRange + Math.sin(nest.pulse * 3) * 8);
            n++;
        }
        if (n > 0) g.stroke();

        n = 0;
        g.strokeColor = C_NEST_CLEARED;
        for (const nest of nests) {
            if (nest.state !== 'cleared') continue;
            g.circle(nest.x, nest.y, NEST.triggerRange);
            n++;
        }
        if (n > 0) g.stroke();

        // 窝心点：三种状态各一次 fill
        n = 0;
        g.fillColor = C_NEST_DOT_DORMANT;
        for (const nest of nests) {
            if (nest.state !== 'dormant') continue;
            this.diamond(g, nest.x, nest.y, 6);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_NEST_DOT_ACTIVE;
        for (const nest of nests) {
            if (nest.state !== 'active') continue;
            this.diamond(g, nest.x, nest.y, 8);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_NEST_DOT_CLEARED;
        for (const nest of nests) {
            if (nest.state !== 'cleared') continue;
            this.diamond(g, nest.x, nest.y, 6);
            n++;
        }
        if (n > 0) g.fill();
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
        let n = 0;
        g.fillColor = C_ORB;
        for (const o of orbs) {
            if (!o.active) continue;
            const bob = Math.sin(this._t * 6 + o.x * 0.1) * 1.5;
            this.diamond(g, o.x, o.y + bob, 4);
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

    private drawHeroRings(heroes: Hero[]): void {
        const g = this._g;
        let n = 0;
        g.strokeColor = C_RING_GOLD;
        g.lineWidth = 2;
        for (const h of heroes) {
            if (h.state !== 'telegraph') continue;
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
