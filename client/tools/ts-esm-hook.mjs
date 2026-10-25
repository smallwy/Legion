/**
 * ts-esm-hook —— 让 `node --experimental-strip-types` 能跑本工程的 TS 工具
 * ============================================================================
 *
 * 用法（离线纯函数测试）：
 *   node --experimental-strip-types --import ./client/tools/ts-esm-hook.mjs \
 *        client/tools/home-biz-check.mts
 *
 * 为什么需要它
 * ------------
 * 工程里的 TS 全部用**无扩展名** import（`import { X } from './Roster'`）——
 * 这是 Cocos Creator 3.8 的 tsconfig（`moduleResolution: node`）要求的写法，
 * 给它们加 `.ts` 扩展名会触发 TS5097，编辑器直接报错。
 *
 * 而 node 的 ESM 解析器**不吃这一套**：`--experimental-strip-types` 只负责
 * 把类型擦掉，解析仍然按 ES 模块规范走 —— 找不到 `./Roster` 这个文件就
 * ERR_MODULE_NOT_FOUND。于是「同一份代码」在编辑器里能跑、在 node 里跑不了，
 * 离线测试就得把整份代码复制一遍改扩展名 —— 那就是第二份真值，必然漂移
 * （MEMORY 教训 2）。
 *
 * 这个 hook 只做一件事：**解析失败时补 `.ts` / `.mts` / `.tsx` 再试一次**。
 * 不改任何源码、不改任何编译配置。
 *
 * 为什么不在 hook 里做类型擦除：node 自己就会（`--experimental-strip-types`），
 * 这里重复造一遍只会更慢、更容易和 node 的行为不一致。
 */

import { register } from 'node:module';

register('./ts-esm-resolve.mjs', import.meta.url);
