/**
 * BattleSwitch —— 战斗场景里"两套玩法互相换手"的唯一出口
 * ============================================================================
 *
 * 为什么需要这个文件
 * ------------------
 * 2026-10-30 之前的链路是：主界面「出发」→ Battle.scene → BattleBoot 按
 * `DEFAULT_MODE` 挂**一个**玩法组件，然后就没有然后了。出征页那三扇门
 * （苔原古道 / 深巢 / 雪原推球）在 Cocos 里根本走不到 —— 玩家点「出发」
 * 直接掉进推球，另外两个玩法连门都没有。
 *
 * 要做的事：出征页当入口，点哪扇门挂哪套玩法。于是 BattleRoot 上会发生
 * 「GroveBattle 销毁 → SnowlabBattle 挂上」这种换手，反过来也一样。
 *
 * 为什么不让两个组件直接互相 import
 * ---------------------------------
 * `GroveBattle` 要切到 `SnowlabBattle`，`SnowlabBattle` 要切回 `GroveBattle`，
 * 直接互相 import 就是 ES 模块的循环依赖。这种循环在"只在函数体里用"时
 * 通常是能跑的，但**能跑不等于可诊断**：一旦哪天有人在其中一个的顶层
 * 加一句求值（比如模块级 `const X = new Y()`），报错会变成
 * "Cannot access before initialization"，栈里指的是另一个文件，
 * 排查方向从一开始就是错的。这个项目已经被"看起来对、坏在别处"坑过。
 *
 * 所以：两个组件只依赖本文件（单向），由 `BattleBoot` 在启动时
 * 把各自的"怎么挂到节点上"注册进来。本文件不认识任何一个具体组件。
 *
 * 换手为什么要等一帧
 * ------------------
 * `Component.destroy()` 在 Cocos 3.x 里是**延迟销毁**（标记 invalid，
 * 真正的 onDestroy 在帧末）。同一帧里"销毁旧的 + 挂上新的"会让两个组件
 * 同时存活：
 *   · 两个组件各建一台 ClearCamera → 渲染器拿到两台同参数相机；
 *   · 两个组件各铺一块 `z-index:10` 的 DOM 层 → 一块压住另一块，
 *     而画在上面的那块可能是被销毁的那个（顺序不确定）。
 * 症状不是崩溃，是"画面卡住不动 / 按键没反应"——最难查的那种。
 * 所以这里先 destroy，再用宏任务轮询 `isValid`，确认死透了才挂新的。
 */

import { Component, Node } from 'cc';

export type BattleKind = 'grove' | 'snowlab';

/** 把一个玩法挂到节点上。由 `BattleBoot` 注册，本文件不 import 具体组件。 */
type Adder = (node: Node) => Component | null;

const adders: Partial<Record<BattleKind, Adder>> = {};

/** 当前活着的那个组件。null = 正在换手，或者一个都没挂上 */
let curComp: Component | null = null;
/** 当前玩法名。换手过渡期是 null */
let cur: BattleKind | null = null;
/** 换手进行中。挡住连点两扇门这种重复请求 */
let switching = false;

/** 换手失败时的兜底节点：只在 `curComp` 已经被销毁、拿不到 node 时用 */
let host: Node | null = null;

/**
 * 换手时要带给目标组件的"入场参数"。
 *
 * **为什么放在这里，不让两个组件互相 import。** 出征页现在有两扇门进的是
 * 同一个玩法（主线 48 关 / 深巢无尽），区别只有 `mode` 一个参数。GroveBattle
 * 要把这个参数交给 SnowlabBattle，而它们之间**只能通过本文件说话** ——
 * 互相 import 会在 Cocos 里绕出循环依赖，编译期不一定报，运行时是
 * undefined 组件，症状和"门坏了"一模一样。
 *
 * 只在换手这一瞬间有值，取走就清空 —— 留着的话下次从别的路径进推球，
 * 会莫名其妙掉进无尽模式。
 */
let entryMode: string | null = null;

export function battleSetEntryMode(m: string | null): void {
    entryMode = m || null;
}

/** 取走（并清空）入场参数。没设置过就是 null。 */
export function battleTakeEntryMode(): string | null {
    const m = entryMode;
    entryMode = null;
    return m;
}

export function battleRegister(kind: BattleKind, add: Adder): void {
    adders[kind] = add;
}

export function battleCurrent(): BattleKind | null {
    return cur;
}

export function battleSwitching(): boolean {
    return switching;
}

/**
 * 组件在哪次 `onLoad` 里登记自己。
 *
 * **只能由组件自己调**：换手的起点是"当前活着的那一个"，这个信息只有
 * 组件自己知道。让外部去 `node.getComponent()` 逐个试，等于把
 * "有哪些玩法"又抄了一份到本文件里 —— 加第三套玩法时必然漏改。
 */
export function battleSetCurrent(kind: BattleKind, comp: Component): void {
    host = comp.node;
    cur = kind;
    curComp = comp;
    switching = false;
}

/**
 * 换到另一套玩法。
 *
 * 返回 false 的三种情况都**不是错误**，是"这次不用换"：
 *   · 已经在目标玩法上（连点同一扇门）；
 *   · 上一次换手还没完成；
 *   · 目标没注册（只有一个玩法被打进包时）。
 */
export function battleSwitch(kind: BattleKind): boolean {
    if (switching) return false;
    if (cur === kind) return false;

    const add = adders[kind];
    if (!add) {
        console.warn('[BattleSwitch] 没有注册这个玩法，忽略切换：' + kind);
        return false;
    }

    const node = (curComp && curComp.isValid) ? curComp.node : host;
    if (!node || !node.isValid) {
        console.warn('[BattleSwitch] 找不到承载节点，忽略切换：' + kind);
        return false;
    }

    switching = true;
    const old = curComp;
    curComp = null;
    cur = null;

    if (old && old.isValid) old.destroy();

    /* 每 16ms 看一次旧组件死没死，最多 8 次（约 130ms）。
       超时也照样挂 —— 宁可冒两台相机的风险，也不要"点了没反应"。 */
    let tries = 0;
    const pump = (): void => {
        if (!node.isValid) { switching = false; return; }
        if (old && old.isValid && tries < 8) {
            tries++;
            setTimeout(pump, 16);
            return;
        }
        switching = false;
        add(node);
    };
    setTimeout(pump, 0);
    return true;
}
