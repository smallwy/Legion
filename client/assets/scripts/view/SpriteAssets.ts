import { resources, SpriteFrame, Texture2D } from 'cc';

export interface SpriteEntry {
    frame: SpriteFrame;
    width: number;   // 贴图原始宽高（用于换算显示缩放）
    height: number;
}

const ART_PATHS = {
    pet: 'art/pet',
    walker: 'art/enemy-walker',
    flyer: 'art/enemy-flyer',
    tank: 'art/enemy-tank',
};

/**
 * 占位精灵加载（原型期 CR-007：早期就能看到形象美术）。
 *
 * ⚠ 2026-10-23：`assets/resources/art/` 那 4 张贴图**已删除**。
 *   它们唯一的消费者是本类，而本类只被 `GameBootstrap` 使用，
 *   `GameBootstrap` 只在 `BattleBoot` 的 `MODE === 'mow'` 分支挂载 ——
 *   当前写死 `'grove'`，所以这 4 张图运行时永远不会被 `resources.load` 到。
 *   留着只会占包体、并让人误判"这套美术还在用"。
 *
 *   要恢复：
 *     `python tools/preprocess_sprites.py`（源图在仓库根 `assets/placeholder/`）
 *     或 `python tools/pixelart_gen.py`（纯代码画，不依赖源图）
 *   两条都会重新写出 `assets/resources/art/{pet,enemy-walker,enemy-flyer,enemy-tank}.png`。
 *
 *   删图不影响运行：下面走容错分支 —— 加载失败 → warn → null → 绘制侧程序化兜底。
 *   所以哪怕把 MODE 切回 'mow'，这套仍然能跑，只是实体没有形象美术。
 *
 * 容错策略：任何一张加载失败，只让对应实体走程序化兜底，不影响其他实体与 demo 运行。
 */
export class SpriteAssets {
    pet: SpriteEntry | null = null;
    walker: SpriteEntry | null = null;
    flyer: SpriteEntry | null = null;
    tank: SpriteEntry | null = null;

    load(onDone: () => void): void {
        let remaining = 4;
        const step = () => {
            remaining--;
            if (remaining === 0) {
                onDone();
            }
        };
        this.loadOne(ART_PATHS.pet, (e) => { this.pet = e; }, step);
        this.loadOne(ART_PATHS.walker, (e) => { this.walker = e; }, step);
        this.loadOne(ART_PATHS.flyer, (e) => { this.flyer = e; }, step);
        this.loadOne(ART_PATHS.tank, (e) => { this.tank = e; }, step);
    }

    /** 是否全部缺失（全兜底层） */
    get allMissing(): boolean {
        return !this.pet && !this.walker && !this.flyer && !this.tank;
    }

    private loadOne(path: string, onOk: (e: SpriteEntry) => void, onNext: () => void): void {
        // 编辑器导入图片时默认类型可能是 sprite-frame 或 texture，两种都试
        resources.load(path, SpriteFrame, (err, sf) => {
            if (!err && sf) {
                const tex = sf.texture;
                if (tex) {
                    onOk({ frame: sf, width: tex.width, height: tex.height });
                    onNext();
                    return;
                }
            }
            resources.load(path, Texture2D, (err2, tex) => {
                if (!err2 && tex) {
                    const frame = new SpriteFrame();
                    try {
                        frame.texture = tex;
                        onOk({ frame: frame, width: tex.width, height: tex.height });
                    } catch (e) {
                        console.warn('[SpriteAssets] ' + path + ' SpriteFrame 创建失败，走程序化兜底', e);
                    }
                } else {
                    console.warn('[SpriteAssets] ' + path + ' 加载失败，走程序化兜底');
                }
                onNext();
            });
        });
    }
}
