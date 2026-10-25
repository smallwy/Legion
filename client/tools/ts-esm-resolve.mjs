/**
 * ts-esm-resolve —— `ts-esm-hook.mjs` 注册的解析钩子（单独一个文件是因为
 * `register()` 的第二个参数要一个真实路径，合成一个字符串会踩 Windows 反斜杠）。
 *
 * 只补扩展名，不补别名、不做路径映射（工程里没有配 paths，见 tsconfig）。
 */

import { existsSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTS = ['.ts', '.mts', '.cts', '.tsx'];

/** 已经带扩展名（或根本不是相对路径）就不插手，交给 node 自己解析 */
function looksBare(specifier) {
    return !specifier.startsWith('.') || EXTS.some((e) => specifier.endsWith(e));
}

function tryDir(base) {
    for (const e of EXTS) {
        const idx = pathResolve(base, 'index' + e);
        if (existsSync(idx)) return pathToFileURL(idx).href;
    }
    return null;
}

export async function resolve(specifier, context, nextResolve) {
    if (!looksBare(specifier)) {
        const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
        const base = pathResolve(dirname(parent), specifier);
        for (const e of EXTS) {
            if (existsSync(base + e)) {
                return { url: pathToFileURL(base + e).href, shortCircuit: true };
            }
        }
        const dir = tryDir(base);
        if (dir) return { url: dir, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
