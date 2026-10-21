/**
 * BattleBoot —— 战斗场景的挂载入口（Cocos Creator 3.8.8）
 * ============================================================================
 *
 * 为什么不把 GameBootstrap 直接挂进 .scene：
 * 场景里引用自定义脚本要写**压缩 uuid**，手写格式错了就是 `Open scene failed`，
 * 而且编辑器一保存就会重排。这里沿用主界面那条已经验证过的路子 ——
 * 脚本被 `prerequisite-imports` 全量 import，顶层代码自行接管，
 * 场景文件里只留一个纯 `cc.Node`，**不出现任何非 cc.* 类型**。
 *
 * 挂载契约（来自 GameBootstrap 自己的注释）：
 * 「世界全部由代码搭建（相机/主角/英雄小队/敌人/BOSS/渲染器/HUD），
 *   不依赖任何编辑器内手动摆放」
 * 所以场景只需要一个挂载点，其余它自己建。
 *
 * ⚠ 编辑器守卫：
 * Cocos 编辑器为了注册 ccclass 也会 import 全部脚本。不挡住的话，
 * 顶层的 tryBoot 会在编辑器进程里给场景 addComponent，
 * 编辑器随后把内存里的场景写回磁盘 —— 主界面已经被这个坑污染过一次。
 */
import { director, Director, Node } from 'cc';
import { EDITOR } from 'cc/env';
import { GameBootstrap } from './GameBootstrap';

let bootedScene: Node | null = null;

function tryBoot() {
    const sc = director.getScene();
    if (!sc) return;
    if (bootedScene === (sc as unknown as Node)) return;

    /* 认结构不认名字：战斗场景的标识是存在 BattleRoot 节点，
       且它身上还没有 GameBootstrap。 */
    const root = sc.getChildByName('BattleRoot');
    if (!root) return;
    if (root.getComponent(GameBootstrap)) return;

    bootedScene = sc as unknown as Node;
    root.addComponent(GameBootstrap);
    console.log('[BattleBoot] 战斗场景已接管（GameBootstrap 动态挂载）');
}

if (!EDITOR) {
    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, tryBoot);
    director.on(Director.EVENT_BEFORE_UPDATE, () => {
        if (!bootedScene) tryBoot();
    });
    tryBoot();
}
