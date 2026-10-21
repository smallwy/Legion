/**
 * BattleBoot —— 战斗场景的挂载入口（Cocos Creator 3.8.8）
 * ============================================================================
 *
 * 为什么不把组件直接挂进 .scene：
 * 场景里引用自定义脚本要写**压缩 uuid**，手写格式错了就是 `Open scene failed`，
 * 而且编辑器一保存就会重排。这里沿用主界面那条已经验证过的路子 ——
 * 脚本被 `prerequisite-imports` 全量 import，顶层代码自行接管，
 * 场景文件里只留一个纯 `cc.Node`，**不出现任何非 cc.* 类型**。
 *
 * ⚠ 编辑器守卫：
 * Cocos 编辑器为了注册 ccclass 也会 import 全部脚本。不挡住的话，
 * 顶层的 tryBoot 会在编辑器进程里给场景 addComponent，
 * 编辑器随后把内存里的场景写回磁盘 —— 主界面已经被这个坑污染过一次。
 */
import { director, Director, Node } from 'cc';
import { EDITOR } from 'cc/env';
import { GameBootstrap } from './GameBootstrap';
import { GroveBattle } from './grove/GroveBattle';

/**
 * 出发进战斗跑哪套玩法。
 *
 *   'grove' —— 推球（雪人兄弟式）。当前交付的玩法，
 *              场景里只建一台相机 + 一块离屏画布，玩法在 GroveRuntime 里跑。
 *   'mow'   —— 割草自动战斗垂直切片（CR-015 甲方案）。留作对照，不再迭代。
 *
 * 改这一行就切玩法，两套代码都还在，谁也没被删掉。
 */
const MODE: 'grove' | 'mow' = 'grove';

let bootedScene: Node | null = null;

function tryBoot() {
    const sc = director.getScene();
    if (!sc) return;
    if (bootedScene === (sc as unknown as Node)) return;

    /* 认结构不认名字：战斗场景的标识是存在 BattleRoot 节点。 */
    const root = sc.getChildByName('BattleRoot');
    if (!root) return;

    if (MODE === 'grove') {
        if (root.getComponent(GroveBattle)) return;
        bootedScene = sc as unknown as Node;
        root.addComponent(GroveBattle);
        console.log('[BattleBoot] 战斗场景已接管（GroveBattle · 推球）');
        return;
    }

    if (root.getComponent(GameBootstrap)) return;
    bootedScene = sc as unknown as Node;
    root.addComponent(GameBootstrap);
    console.log('[BattleBoot] 战斗场景已接管（GameBootstrap · 割草切片）');
}

if (!EDITOR) {
    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, tryBoot);
    director.on(Director.EVENT_BEFORE_UPDATE, () => {
        if (!bootedScene) tryBoot();
    });
    tryBoot();
}
