import { Graphics, Node, UITransform } from 'cc';
import { FIELD, PALETTE } from '../config/BattleConfig';
import { hexColor } from '../core/ColorUtil';

const C_GRASS = hexColor(PALETTE.grass);
const C_GRASS_DARK = hexColor(0x2E7A3C);
const C_FLOWER = hexColor(PALETTE.cream);
const C_BORDER = hexColor(PALETTE.uiDeep);

/**
 * 背景渲染器：静态场景（草地 + 草丛 + 小花 + 战场边界），只在初始化画一次。
 * 整场 3D 内容共用 1 个 Graphics 组件 = 1 个 DrawCall（3.8 源码已验证：
 * 同组件内多次 fill/stroke 会合并进同一 mesh，65535 顶点内不拆分）。
 * 草丛用确定性伪随机，保证每次运行画面一致（方便对比调参）。
 */
export class BackgroundRenderer {
    private _g: Graphics;

    constructor(parent: Node) {
        const node = new Node('Background');
        parent.addChild(node);
        // ★ 强制置底：3.x 的 2D 绘制优先级 = children 遍历序（Batcher2D.walk 源码已核实），
        //   而本渲染器是在 EnemyManager/PetSquad 之后才构造的，不置底的话这块实心草地
        //   会盖住玩家、敌人和宠物（z 值不参与 2D 排序，别指望 setPosition 的 z 能救）。
        node.setSiblingIndex(0);
        node.addComponent(UITransform);
        this._g = node.addComponent(Graphics);
    }

    render(): void {
        const g = this._g;
        g.clear();

        const w = FIELD.width;
        const h = FIELD.height;
        const hw = w / 2;
        const hh = h / 2;

        // 草地底
        g.fillColor = C_GRASS;
        g.rect(-hw, -hh, w, h);
        g.fill();

        // 草丛（一次 stroke 合并所有子路径）
        let seed = 20261014;
        const rnd = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };
        g.strokeColor = C_GRASS_DARK;
        g.lineWidth = 2;
        for (let i = 0; i < 220; i++) {
            const x = (rnd() - 0.5) * w;
            const y = (rnd() - 0.5) * h;
            g.moveTo(x, y);
            g.lineTo(x + 3, y - 8);
        }
        g.stroke();

        // 小花（矩形点，一次 fill）
        g.fillColor = C_FLOWER;
        for (let i = 0; i < 40; i++) {
            const x = (rnd() - 0.5) * w;
            const y = (rnd() - 0.5) * h;
            g.rect(x, y, 3, 3);
        }
        g.fill();

        // 战场边界
        g.strokeColor = C_BORDER;
        g.lineWidth = 4;
        g.rect(-hw, -hh, w, h);
        g.stroke();
    }
}
