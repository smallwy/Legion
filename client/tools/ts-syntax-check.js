/**
 * Cocos 组件的语法守门
 * ============================================================================
 *   node client/tools/ts-syntax-check.js
 *
 * 干什么：用 TypeScript 编译器把 assets/scripts 下的 TS 转译一遍，只报**语法错误**。
 *
 * 为什么不跑完整类型检查：工程里没有 node_modules/@types，`cc` 模块的声明只存在于
 * Cocos 编辑器内部。硬跑类型检查会被"找不到模块 cc"淹没，真正要看的东西反而看不见。
 * 而实际会让 Cocos 报错的，恰恰是语法（少个括号、装饰器写错、泛型写成 JS）——
 * 类型不匹配 Cocos 用的是 SWC 转译，压根不检查。
 *
 * 依赖：typescript 装在 WorkBuddy 隔离目录（不污染工程）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let ts;
try {
    ts = require('typescript');
} catch (e) {
    console.error('需要 typescript：');
    console.error('  cd "<隔离 workspace>" && npm install typescript');
    process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
    path.join(ROOT, 'assets', 'scripts', 'grove', 'GroveBattle.ts'),
    path.join(ROOT, 'assets', 'scripts', 'grove', 'GroveRuntime.ts'),
    path.join(ROOT, 'assets', 'scripts', 'BattleBoot.ts'),
    path.join(ROOT, 'assets', 'scripts', 'HomeRuntime.ts'),
];

const OPTS = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    experimentalDecorators: true,
    useDefineForClassFields: false,
};

let bad = 0;
let total = 0;

for (const f of TARGETS) {
    const rel = path.relative(ROOT, f);
    if (!fs.existsSync(f)) {
        console.log('  ? ' + rel + ' 不存在，跳过');
        continue;
    }
    total++;
    const src = fs.readFileSync(f, 'utf8');
    const out = ts.transpileModule(src, {
        compilerOptions: OPTS,
        reportDiagnostics: true,
        fileName: f,
    });
    const errs = (out.diagnostics || []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error,
    );
    if (!errs.length) {
        console.log('  ✓ ' + rel);
        continue;
    }
    bad++;
    console.log('  ✗ ' + rel);
    for (const d of errs) {
        const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
        const at = pos ? (pos.line + 1) + ':' + (pos.character + 1) + '  ' : '';
        console.log('      ' + at + ts.flattenDiagnosticMessageText(d.messageText, ' '));
    }
}

console.log('');
if (bad) {
    console.log('✗ ' + bad + '/' + total + ' 个文件有语法错误');
    process.exit(1);
}
console.log('✓ ' + total + ' 个文件语法通过');
