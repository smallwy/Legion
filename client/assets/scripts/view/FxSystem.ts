import { Color, Graphics, Node, UITransform } from 'cc';
import { ENEMIES, FX, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';

/**
 * 表现层一次性特效（CR-016）。
 *
 * 设计前提：**零美术**。像素风下"打击感"的绝大部分不是画质，而是信息反馈的密度与时机：
 *  - 顿帧（hitStop）  ← 让"打到了"这件事被身体感知
 *  - 碎屑（particle） ← 让"打碎了"这件事有物质感
 *  - 飘字（floatText）← 让"打掉了多少"可读
 * 三者加起来不到 300 行，比再加一个新玩法的收益高，且不改任何美术预算。
 *
 * 性能约束（这是本文件存在的理由）：
 *  - 全部特效画在**同一个 Graphics** 里 → 整层只有 **1 个 DrawCall**。
 *    反面做法是"每个粒子一个 Graphics 节点"，200 颗粒子就是 200 DC，直接爆验收线。
 *  - 粒子/飘字全部池化，`tick` 里不 new 任何对象（割草游戏每秒几十次命中，GC 会抖）。
 *  - 颜色按 (色号 × 透明度档) 预先建表：Graphics 赋值会拷贝 Color，热路径零分配。
 *
 * 绘制顺序：碎屑（最底）→ 扩散圈 → 飘字（最上）。都在实体层之上、HUD 之下。
 */

/** 特效调色板（索引进下面的颜色表；加新颜色要同时改 COLOR_HEX 与 FxColor） */
export type FxColor = 'walker' | 'flyer' | 'tank' | 'gold' | 'danger' | 'white' | 'safe' | 'meat';

const COLOR_HEX: readonly number[] = [
    ENEMIES.walker.color,
    ENEMIES.flyer.color,
    ENEMIES.tank.color,
    PALETTE.gold,
    PALETTE.danger,
    0xffffff,
    PALETTE.safe,
    0xD9534F,   // 肉块红（与经验珠绿、飘字白金在色相上完全分开）
];
const COLOR_IDX: { readonly [k in FxColor]: number } = {
    walker: 0, flyer: 1, tank: 2, gold: 3, danger: 4, white: 5, safe: 6, meat: 7,
};
const NC = COLOR_HEX.length;

/** 透明度分档：0 = 不透明 … 3 = 快消失。分档而不是逐粒子设 alpha，是为了合批 */
const ALPHA_STEPS = [255, 200, 140, 70];
const ALPHA_N = ALPHA_STEPS.length;

/** 预建颜色表 [色号 * ALPHA_N + 档位]，热路径直接取用，不新建对象 */
const C_ALPHA: Color[] = (() => {
    const out: Color[] = [];
    for (let ci = 0; ci < NC; ci++) {
        for (let a = 0; a < ALPHA_N; a++) {
            out.push(hexColor(COLOR_HEX[ci], ALPHA_STEPS[a]));
        }
    }
    return out;
})();

// ---------------------------------------------------------------- 3×5 像素字模
// 每行 3 bit（左 → 右），数组从上到下 5 行。横排连着的像素在绘制时合并成一个矩形，
// 一个数字约 5~7 个 rect —— 比"逐像素画"省 3 倍顶点。
const G_DIGITS: readonly (readonly number[])[] = [
    [7, 5, 5, 5, 7], // 0
    [2, 6, 2, 2, 7], // 1
    [7, 1, 7, 4, 7], // 2
    [7, 1, 7, 1, 7], // 3
    [5, 5, 7, 1, 1], // 4
    [7, 4, 7, 1, 7], // 5
    [7, 4, 7, 5, 7], // 6
    [7, 1, 1, 1, 1], // 7
    [7, 5, 7, 5, 7], // 8
    [7, 5, 7, 1, 7], // 9
];
const G_PLUS = [0, 2, 7, 2, 0];
const G_TIMES = [0, 5, 2, 5, 0];
const G_BANG = [2, 2, 2, 0, 2];
const G_L = [4, 4, 4, 4, 7];
const G_V = [5, 5, 5, 5, 2];
const G_DOT = [0, 0, 0, 0, 2];

const GLYPHS: readonly (readonly number[])[] = [
    ...G_DIGITS, G_PLUS, G_TIMES, G_BANG, G_L, G_V, G_DOT,
];
const GLYPH_INDEX: { readonly [ch: string]: number } = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    '+': 10, 'x': 11, 'X': 11, '!': 12, 'L': 13, 'V': 14, '.': 15,
};

// ---------------------------------------------------------------- 数据体

interface Particle {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    ci: number;
    ab: number;
    drag: number;
    gravity: number;
}

interface FloatText {
    active: boolean;
    x: number;
    y: number;
    vy: number;
    life: number;
    maxLife: number;
    glyphs: number[];
    ci: number;
    ab: number;
    scale: number;
}

interface Ring {
    active: boolean;
    x: number;
    y: number;
    t: number;
    dur: number;
    r1: number;
    ci: number;
    width: number;
}

export class FxSystem {
    private _g: Graphics;
    private _ps: Particle[] = [];
    private _texts: FloatText[] = [];
    private _rings: Ring[] = [];
    /** GC 计时：0.5 秒一次回收失效项 */
    private _gcT = 0;

    constructor(parent: Node) {
        const node = new Node('FxLayer');
        parent.addChild(node);
        node.addComponent(UITransform);
        this._g = node.addComponent(Graphics);
        // 2D 层序：EntityRenderer(z=1) → Fx(z=2)。HUD 挂在相机树下，天然在最后
        node.setPosition(0, 0, 2);
    }

    // ============================================================ 对外接口

    /**
     * 命中火花：沿受击方向扇形溅出 3 颗小方点。
     * @param dirX/dirY 受击方向（弹道速度方向），用来决定溅射朝向
     */
    hit(x: number, y: number, dirX: number, dirY: number, color: FxColor): void {
        const len = Math.hypot(dirX, dirY) || 1;
        const bx = dirX / len;
        const by = dirY / len;
        for (let i = 0; i < 3; i++) {
            const a = (Math.random() - 0.5) * 1.5;   // ±43° 扇形
            const c = Math.cos(a);
            const s = Math.sin(a);
            const sp = 110 + Math.random() * 110;
            this.addParticle(
                x, y,
                (bx * c - by * s) * sp,
                (bx * s + by * c) * sp,
                0.11 + Math.random() * 0.09,
                2 + Math.random() * 2,
                color, 6, 0,
            );
        }
    }

    /**
     * 死亡爆散：按敌人自身体色炸成一把碎屑，带重力，落地前消失。
     * 步兵/飞虫 10 颗，甲虫 14 颗（体量越大碎得越多）。
     */
    burst(x: number, y: number, color: FxColor, count: number, power = 1): void {
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = (55 + Math.random() * 135) * power;
            this.addParticle(
                x, y,
                Math.cos(a) * sp,
                Math.sin(a) * sp + 60,          // 上抛一点，看起来"炸开"而不是"摊开"
                0.32 + Math.random() * 0.28,
                2 + Math.random() * 3,          // 2~5px 方块
                color, 3.2, 320,
            );
        }
    }

    /** 扩散圈：喂食/升级/BOSS 死亡的地面脉冲 */
    ring(x: number, y: number, color: FxColor, r1: number, dur: number, width = 3): void {
        const r = this.takeRing();
        if (r === null) {
            return;
        }
        r.active = true;
        r.x = x;
        r.y = y;
        r.t = 0;
        r.dur = dur;
        r.r1 = r1;
        r.ci = COLOR_IDX[color];
        r.width = width;
    }

    /** 飘字：只认 0-9 + x L V . !（3×5 像素字模，没有中文） */
    text(x: number, y: number, str: string, color: FxColor, scale = 3): void {
        const t = this.takeText();
        if (t === null) {
            return;
        }
        t.glyphs.length = 0;
        for (let i = 0; i < str.length; i++) {
            const gi = GLYPH_INDEX[str.charAt(i)];
            if (gi !== undefined) {
                t.glyphs.push(gi);
            }
        }
        if (t.glyphs.length === 0) {
            t.active = false;
            return;
        }
        t.active = true;
        t.x = x;
        t.y = y;
        t.vy = 34;
        t.life = 0.72;
        t.maxLife = 0.72;
        t.ci = COLOR_IDX[color];
        t.ab = 0;
        t.scale = scale;
    }

    // ============================================================ 生命周期

    /** 用**真实 dt** 推进（顿帧时特效继续动 —— 画面越静止、碎屑越飞，冲击感越强） */
    tick(dt: number): void {
        for (const p of this._ps) {
            if (!p.active) continue;
            p.life -= dt;
            if (p.life <= 0) {
                p.active = false;
                continue;
            }
            const k = Math.exp(-p.drag * dt);
            p.vx *= k;
            p.vy = p.vy * k + p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.ab = alphaBucket(p.life / p.maxLife);
        }

        for (const t of this._texts) {
            if (!t.active) continue;
            t.life -= dt;
            if (t.life <= 0) {
                t.active = false;
                continue;
            }
            t.y += t.vy * dt;
            t.vy *= Math.exp(-2.4 * dt);   // 上浮逐渐停住，不会一直飘出屏幕
            t.ab = alphaBucket(t.life / t.maxLife);
        }

        for (const r of this._rings) {
            if (!r.active) continue;
            r.t += dt;
            if (r.t >= r.dur) r.active = false;
        }

        // 回收：**不每帧做**。filter 会重建数组（每帧新建 3 个数组 = 每秒 180 次分配），
        // 而失效项留着只是多跑几次 `if (!active) continue`，代价远低于 GC 抖动。
        // 0.5 秒清一次，同屏最多残留几十个死项。
        this._gcT += dt;
        if (this._gcT >= 0.5) {
            this._gcT = 0;
            this._ps = this._ps.filter((p) => p.active);
            this._texts = this._texts.filter((t) => t.active);
            this._rings = this._rings.filter((r) => r.active);
        }
    }

    /** 每帧重画（Graphics 是全量重建的，没有"增量绘制"这种东西） */
    redraw(): void {
        const g = this._g;
        g.clear();
        this.drawParticles();
        this.drawRings();
        this.drawTexts();
    }

    clear(): void {
        this._ps.length = 0;
        this._texts.length = 0;
        this._rings.length = 0;
        this._g.clear();
    }

    // ============================================================ 绘制

    private drawParticles(): void {
        const g = this._g;
        // 每个粒子 1 个 rect（1 个矩形 = 4 顶点，比菱形少一半）
        for (let ab = 0; ab < ALPHA_N; ab++) {
            for (let ci = 0; ci < NC; ci++) {
                let n = 0;
                for (const p of this._ps) {
                    if (!p.active || p.ab !== ab || p.ci !== ci) continue;
                    const s = p.size;
                    // 落点取整：像素画面的碎屑落在半个像素上会出现"糊边"
                    g.rect(Math.round(p.x - s * 0.5), Math.round(p.y - s * 0.5), s, s);
                    n++;
                }
                if (n > 0) {
                    g.fillColor = C_ALPHA[ci * ALPHA_N + ab];
                    g.fill();
                }
            }
        }
    }

    private drawRings(): void {
        const g = this._g;
        for (let ab = 0; ab < ALPHA_N; ab++) {
            for (let ci = 0; ci < NC; ci++) {
                let n = 0;
                for (const r of this._rings) {
                    if (!r.active || r.ci !== ci) continue;
                    if (alphaBucket(1 - r.t / r.dur) !== ab) continue;
                    const k = r.t / r.dur;
                    // 半径用 sqrt 缓出：一开始快、末尾慢，像波纹而不是匀速膨胀
                    const rad = r.r1 * Math.sqrt(k);
                    g.lineWidth = r.width * (1 - k * 0.6);
                    g.circle(r.x, r.y, rad);
                    n++;
                }
                if (n > 0) {
                    g.strokeColor = C_ALPHA[ci * ALPHA_N + ab];
                    g.stroke();
                }
            }
        }
    }

    private drawTexts(): void {
        const g = this._g;
        for (let ab = 0; ab < ALPHA_N; ab++) {
            for (let ci = 0; ci < NC; ci++) {
                let n = 0;
                for (const t of this._texts) {
                    if (!t.active || t.ab !== ab || t.ci !== ci) continue;
                    this.drawString(t);
                    n++;
                }
                if (n > 0) {
                    g.fillColor = C_ALPHA[ci * ALPHA_N + ab];
                    g.fill();
                }
            }
        }
    }

    /** 画一串 3×5 字模（居中于 t.x）。横向连续的像素合并成 1 个 rect */
    private drawString(t: FloatText): void {
        const g = this._g;
        const s = t.scale;
        const n = t.glyphs.length;
        const totalW = (n * 4 - 1) * s;            // 每字 3 格 + 1 格间距
        const x0 = t.x - totalW * 0.5;
        // 飘字位置取整，保证字形落在整数格上（否则字模会糊）
        const by = Math.round(t.y);

        for (let i = 0; i < n; i++) {
            const rows = GLYPHS[t.glyphs[i]];
            const gx = Math.round(x0 + i * 4 * s);
            for (let r = 0; r < 5; r++) {
                const bits = rows[r];
                if (bits === 0) continue;
                let c = 0;
                while (c < 3) {
                    if (((bits >> (2 - c)) & 1) === 0) {
                        c++;
                        continue;
                    }
                    let c2 = c;
                    while (c2 < 3 && ((bits >> (2 - c2)) & 1) === 1) {
                        c2++;
                    }
                    // 字模行 0 在最上 → 屏幕 y 要翻过来
                    g.rect(gx + c * s, by + (4 - r) * s, (c2 - c) * s, s);
                    c = c2;
                }
            }
        }
    }

    // ============================================================ 内部

    /**
     * 取一个粒子槽位。
     *
     * ⚠️ 这里不能用 `if (list.length >= max) return` —— 失效项是每 0.5 秒才回收的，
     * 一波清完 200 颗之后数组长度仍是 200，但**实际全是死项**，
     * 于是接下来半秒里新击杀一颗碎屑都放不出来（密集战斗时最需要反馈的时刻反而没有）。
     * 所以先找空槽复用，真的没有空槽才丢弃。
     */
    private addParticle(
        x: number, y: number, vx: number, vy: number,
        life: number, size: number, color: FxColor,
        drag: number, gravity: number,
    ): void {
        const p = this.takeParticle();
        if (p === null) {
            return;
        }
        p.active = true;
        p.x = x;
        p.y = y;
        p.vx = vx;
        p.vy = vy;
        p.life = life;
        p.maxLife = life;
        p.size = size;
        p.ci = COLOR_IDX[color];
        p.ab = 0;
        p.drag = drag;
        p.gravity = gravity;
    }

    private takeParticle(): Particle | null {
        for (const p of this._ps) {
            if (!p.active) return p;
        }
        if (this._ps.length >= FX.maxParticles) {
            return null;
        }
        const p: Particle = {
            active: true, x: 0, y: 0, vx: 0, vy: 0,
            life: 0, maxLife: 1, size: 2, ci: 5, ab: 0, drag: 4, gravity: 0,
        };
        this._ps.push(p);
        return p;
    }

    private takeText(): FloatText | null {
        for (const t of this._texts) {
            if (!t.active) return t;
        }
        if (this._texts.length >= FX.maxTexts) {
            return null;
        }
        const t: FloatText = {
            active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1,
            glyphs: [], ci: 5, ab: 0, scale: 3,
        };
        this._texts.push(t);
        return t;
    }

    private takeRing(): Ring | null {
        for (const r of this._rings) {
            if (!r.active) return r;
        }
        if (this._rings.length >= FX.maxRings) {
            return null;
        }
        const r: Ring = { active: false, x: 0, y: 0, t: 0, dur: 1, r1: 0, ci: 3, width: 3 };
        this._rings.push(r);
        return r;
    }
}

/** 寿命比 → 透明度档位（1 = 刚生成，0 = 即将消失） */
function alphaBucket(ratio: number): number {
    if (ratio > 0.62) return 0;
    if (ratio > 0.36) return 1;
    if (ratio > 0.16) return 2;
    return 3;
}
