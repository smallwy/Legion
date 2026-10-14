import { Graphics, Node, UITransform } from 'cc';
import { ENEMIES, NEST, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';
import { TAU } from '../core/MathUtil';
import { ENEMY_DEATH_TIME } from '../battle/EnemyManager';
import type { Enemy } from '../battle/EnemyManager';
import type { Nest } from '../battle/MonsterNest';
import type { Orb } from '../battle/OrbManager';
import type { Pet } from '../battle/PetSquad';
import type { Projectile } from '../battle/ProjectileManager';

// 预创建颜色：渲染热路径零分配（Graphics 赋值时会拷贝，可安全复用同一批 Color）
const C_WALKER = hexColor(ENEMIES.walker.color);
const C_FLYER = hexColor(ENEMIES.flyer.color);
const C_TANK = hexColor(ENEMIES.tank.color);
const C_HIT = hexColor(0xffffff);
const C_EYE = hexColor(PALETTE.uiDeep);
const C_RING_DANGER = hexColor(PALETTE.danger, 220);
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
const C_PET_BODY = hexColor(0xffb6c1);
const C_PET_SNOUT = hexColor(0xf291a8);
const C_PET_EYE_W = hexColor(0xffffff);

/**
 * 全场实体批量渲染器：所有敌人/子弹/经验珠/怪窝/前摇圈画在同一个 Graphics 里。
 * 依据 3.8 源码：同组件多次 fill/stroke 合并为同一 mesh → 整个动态场只占 1 个 DrawCall
 * （对比每实体一个 Graphics：28 敌人就要 28+ DrawCall，直接爆 20 的验收线）。
 *
 * 有贴图的实体由自身节点上的 Sprite 渲染（同图集自动合批），这里只补画：
 *  - 无贴图实体的程序化兜底身体
 *  - 前摇/读条 telegraph 圈（美术指引 §4：状态全靠特效层，不画新帧）
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

    redraw(pets: Pet[], enemies: Enemy[], nests: Nest[], projectiles: Projectile[], orbs: Orb[]): void {
        const g = this._g;
        g.clear();
        this.drawNests(nests);
        this.drawEnemyBodies(enemies);
        this.drawTelegraphs(enemies);
        this.drawProjectiles(projectiles);
        this.drawOrbs(orbs);
        this.drawPetBodies(pets);
        this.drawPetRings(pets);
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

        // 受击白闪：与节点 scale 脉冲同步的反馈
        n = 0;
        g.fillColor = C_HIT;
        for (const e of enemies) {
            if (!this.needProcBody(e) || e.hitPunch < 0.5) continue;
            this.bodyPolygon(g, e, e.type === 'flyer' ? 4 : (e.type === 'tank' ? 8 : 6));
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

    /** 正多边形身体：边数区分剪影（步行虫 6 / 飞虫 4 / 甲虫 8，美术指引 §5.6） */
    private bodyPolygon(g: Graphics, e: Enemy, sides: number): void {
        const r = e.def.radius * this.bodyScale(e);
        const rot = e.phase;
        for (let i = 0; i < sides; i++) {
            const a = rot + (i / sides) * TAU;
            const px = e.x + Math.cos(a) * r;
            const py = e.y + Math.sin(a) * r;
            if (i === 0) {
                g.moveTo(px, py);
            } else {
                g.lineTo(px, py);
            }
        }
        g.close();
    }

    // ---------------- 前摇 / 读条圈 ----------------

    private drawTelegraphs(enemies: Enemy[]): void {
        const g = this._g;

        // 近战前摇：攻击半径圈（红色，玩家可走开）
        let n = 0;
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

    // ---------------- 宠物（程序化兜底 + 前摇金环） ----------------

    private drawPetBodies(pets: Pet[]): void {
        const g = this._g;
        let n = 0;
        g.fillColor = C_PET_BODY;
        for (const p of pets) {
            if (p.hasSprite) continue;
            g.circle(p.x, p.y, 16);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_PET_SNOUT;
        for (const p of pets) {
            if (p.hasSprite) continue;
            g.ellipse(p.x + 9, p.y - 2, 5.5, 4.5);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_PET_EYE_W;
        for (const p of pets) {
            if (p.hasSprite) continue;
            // 耳朵（两个三角）
            g.moveTo(p.x - 11, p.y + 8);
            g.lineTo(p.x - 6, p.y + 20);
            g.lineTo(p.x - 2, p.y + 9);
            g.moveTo(p.x + 2, p.y + 9);
            g.lineTo(p.x + 6, p.y + 20);
            g.lineTo(p.x + 11, p.y + 8);
            // 眼睛（白底）
            g.circle(p.x + 6, p.y + 3, 3.5);
            g.circle(p.x - 2, p.y + 3, 3.5);
            n++;
        }
        if (n > 0) g.fill();

        n = 0;
        g.fillColor = C_EYE;
        for (const p of pets) {
            if (p.hasSprite) continue;
            g.circle(p.x + 6.5, p.y + 3, 1.8);
            g.circle(p.x - 1.5, p.y + 3, 1.8);
            n++;
        }
        if (n > 0) g.fill();
    }

    private drawPetRings(pets: Pet[]): void {
        const g = this._g;
        let n = 0;
        g.strokeColor = C_RING_GOLD;
        g.lineWidth = 2;
        for (const p of pets) {
            if (p.state !== 'telegraph') continue;
            g.circle(p.x, p.y, 26);
            n++;
        }
        if (n > 0) g.stroke();
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
