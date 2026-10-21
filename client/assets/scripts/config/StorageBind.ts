/**
 * StorageBind —— 把 Cocos 的 `sys.localStorage` 交给 `SaveData`
 * ============================================================================
 *
 * 为什么单独一个文件（而不是在 `SaveData.ts` 里 `import { sys } from 'cc'`）：
 * `SaveData` 要能被**离线验证器**直接 require（`tools/verify-roster.js` 的 61 项断言），
 * 一旦它顶层依赖 `cc`，那套断言就跑不起来 —— 而那套断言恰好是这次改动最关键的把关手段。
 *
 * 所以依赖反转：本文件是唯一接触 `cc` 的那一层，引擎侧在启动时把 `sys.localStorage`
 * 推进去，`SaveData` 自己不往外拉。离线环境不会 import 本文件，于是两边都活。
 *
 * 生效方式：Cocos 预览/构建会把 `assets/scripts` 下所有 .ts 通过
 * `cce:/internal/x/prerequisite-imports` 全部 import，所以这个顶层调用**一定**会执行，
 * 且早于任何 `loadSave()`。
 *
 * ⚠️ 用 `sys.localStorage` 而不是全局 `localStorage`：后者只在 web 上存在，
 *    原生 / 小游戏平台要靠 `sys` 桥到平台自己的存储 API。
 *    只靠全局 `localStorage` 的代码在原生包上会"静默不存档" —— 不报错，只是每次重开都归零。
 */

import { sys } from 'cc';
import { setStore } from './SaveData';
import type { Store } from './SaveData';

/* `sys.localStorage` 的类型就是 Storage 那三个方法；显式断言一下，
   免得 cc.d.ts 版本差异导致 strict 检查报错。 */
const ls = sys.localStorage as unknown as Store | null;
setStore(ls && typeof ls.getItem === 'function' ? ls : null);
