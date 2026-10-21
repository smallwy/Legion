import { HERO } from '../config/BattleConfig';

/** 槽位世界坐标（调用方复用同一对象，避免每帧分配） */
export interface SlotPoint {
    x: number;
    y: number;
}

/** 队形槽位（局部坐标）：`[沿前进方向, 向右偏移]`，负值 f = 在主角身后 */
export type Slot = readonly [number, number];

/**
 * 队伍队形：把「主角位置 + 队伍朝向」映射成 N 个槽位的世界坐标（CR-014）。
 *
 * 为什么单独拆一个类：队形是**纯几何**，与英雄的施法状态机、索敌完全解耦。
 * 试玩后想换菱形阵列 / 楔形 / 横排，只改角色表里的槽位，不用碰 `HeroSquad`。
 *
 * ⚠️ 槽位由调用方传进来，不再从常量表里按索引取。
 *    原来是 `HERO_SLOTS[i % HERO_SLOTS.length]`，隐含"槽位数 = 队伍人数"这条约定；
 *    队伍人数改成随解锁变化后，这条约定必然被打破（1 只时它会被夹到左后槽位上，
 *    读成"站偏了"）。现在槽位跟着角色走，人数与位置不可能对不上。
 *
 * 朝向策略（两个都是踩过的坑）：
 *  1. **只在你真的移动时更新朝向**（`turnDeadzone` 以下不动）。站着不动时若仍按
 *     速度方向算角度，浮点噪声会把朝向推得左右乱翻，三个跟班会不停抽搐。
 *  2. **用角速度限制，不用直接赋值**。瞬转会让跟班在一帧内跳到你的对侧，
 *     观感上像"闪现"，非常刺眼。
 */
export class Formation {
    private _angle = 0;
    private _ax = 0;
    private _ay = 0;

    /** 队伍朝向（弧度，0 = 朝 +X） */
    get angle(): number {
        return this._angle;
    }

    /**
     * @param dt 帧时长
     * @param x,y 主角位置（队伍锚点）
     * @param vx,vy 主角速度（世界单位/秒）
     */
    update(dt: number, x: number, y: number, vx: number, vy: number): void {
        this._ax = x;
        this._ay = y;

        const sp = Math.hypot(vx, vy);
        if (sp < HERO.turnDeadzone) {
            return;
        }

        const target = Math.atan2(vy, vx);
        let d = target - this._angle;
        // 归一化到 (-π, π]，保证走最短弧（否则从 179° 转到 -179° 会绕一整圈）
        while (d > Math.PI) {
            d -= Math.PI * 2;
        }
        while (d <= -Math.PI) {
            d += Math.PI * 2;
        }

        const maxTurn = HERO.turnRate * dt;
        if (d > maxTurn) {
            d = maxTurn;
        } else if (d < -maxTurn) {
            d = -maxTurn;
        }
        this._angle += d;
    }

    /**
     * 取某个槽位的世界坐标（写入 out）。
     *
     * 局部坐标 `[f, r]`：f 沿**前进方向**，r 沿**右手方向**。
     * forward = (cos a, sin a)；right = (sin a, -cos a)（前进方向顺时针 90°）。
     *
     * @param slot 该槽位的局部坐标（由 `Roster.rolesFor()` 给出）
     */
    slotTarget(slot: Slot, out: SlotPoint): SlotPoint {
        const f = slot[0];
        const r = slot[1];
        const c = Math.cos(this._angle);
        const sn = Math.sin(this._angle);
        out.x = this._ax + c * f + sn * r;
        out.y = this._ay + sn * f - c * r;
        return out;
    }

    reset(x: number, y: number): void {
        this._ax = x;
        this._ay = y;
        this._angle = 0;
    }
}
