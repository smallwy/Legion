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
import { SnowlabBattle } from './snowlab/SnowlabBattle';
import { battleRegister } from './BattleSwitch';

/**
 * 出发进战斗先挂哪套玩法。
 *
 *   'grove'   —— **当前默认**。挂 GroveBattle，但**一进来是出征页**，
 *                不是直接开打：`groveBoot(..., fromHome = true)` → `openGates()`。
 *                三扇门各自的分工见下面的 `battleRegister`。
 *                为什么默认回落到它：出征页是"选玩法"的地方，主界面「出发」
 *                只该负责"出门"，不该替玩家决定玩哪套。2026-10-30 之前
 *                默认是 snowlab，于是苔原古道和深巢在 Cocos 里一次都进不去。
 *   'snowlab' —— 直连推球，**跳过出征页**。只给调试用（`?mode=snowlab`）：
 *                改关卡内容时不想每次点一遍门。
 *   'mow'     —— 割草自动战斗垂直切片（CR-015 甲方案）。留作对照，不再迭代。
 *
 * 两种切法，按场合选用：
 *   ① 改下面这一行的字面量（要长期换主线时用这个）；
 *   ② 预览/构建的地址后面加 `?mode=snowlab`（临时对比用这个，不用改代码、
 *      不用等编辑器重编，刷新一下就是另一套）。
 * 三套代码都还在，谁也没被删掉。
 */
const DEFAULT_MODE: 'grove' | 'snowlab' | 'mow' = 'grove';

/**
 * 从地址栏读 `?mode=`，认不出来就回落默认。
 * **只认这三个值**：写错一个字母不该静默跑成别的玩法 —— 那会让人
 * 以为是"新玩法没生效"，而真相是拼写错了。
 */
function pickMode(): 'grove' | 'snowlab' | 'mow' {
    try {
        if (typeof location !== 'undefined' && location.search) {
            const m = /[?&]mode=([a-z]+)/.exec(location.search);
            if (m && (m[1] === 'grove' || m[1] === 'snowlab' || m[1] === 'mow')) {
                return m[1];
            }
        }
    } catch (e) {
        /* 某些平台没有 location（原生/小游戏）。不是错误，回落默认即可。 */
    }
    return DEFAULT_MODE;
}

const MODE = pickMode();

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

    if (MODE === 'snowlab') {
        if (root.getComponent(SnowlabBattle)) return;
        bootedScene = sc as unknown as Node;
        root.addComponent(SnowlabBattle);
        console.log('[BattleBoot] 战斗场景已接管（SnowlabBattle · 雪人关卡）');
        return;
    }

    if (root.getComponent(GameBootstrap)) return;
    bootedScene = sc as unknown as Node;
    root.addComponent(GameBootstrap);
    console.log('[BattleBoot] 战斗场景已接管（GameBootstrap · 割草切片）');
}

if (!EDITOR) {
    /* **出征页 → 各玩法的接线。**
     *
     * 注册而不是直接 import：GroveBattle 要切到 SnowlabBattle，SnowlabBattle
     * 又切回 GroveBattle，互相 import 就是循环依赖（理由见 BattleSwitch 文件头）。
     * 这里两边都认识，正好由它充当唯一的"谁都能挂"的地方。
     *
     * 放在 `if (!EDITOR)` 里面：编辑器为注册 ccclass 也会 import 全部脚本，
     * 顶层注册会在编辑器进程里也生效 —— 和 tryBoot 那条守卫同一个理由。 */
    battleRegister('grove', (node) => node.addComponent(GroveBattle));
    battleRegister('snowlab', (node) => node.addComponent(SnowlabBattle));

    director.on(Director.EVENT_AFTER_SCENE_LAUNCH, tryBoot);
    director.on(Director.EVENT_BEFORE_UPDATE, () => {
        if (!bootedScene) tryBoot();
    });
    tryBoot();
}
