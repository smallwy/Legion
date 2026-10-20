/**
 * 一键跑 FxSystem 冒烟：编译（tsc）→ 断言。
 *
 * 用法：node tools/fx-smoke/run.js
 * 若找不到 TypeScript，用环境变量指定：TSC=/path/to/tsc node tools/fx-smoke/run.js
 *
 * 为什么不用 `npx`：本机沙箱里 `cmd.exe` 被拦，npx 起不来；
 * 直接 spawn `node tsc.js` 是最稳的一条路。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');          // client/
const OUT = path.join(__dirname, 'build');

function findTsc() {
    if (process.env.TSC) return process.env.TSC;
    const cands = [
        // 沙箱隔离环境的 TypeScript（本机已装）
        'C:/Users/yu.wang/.workbuddy/binaries/node/workspace/node_modules/typescript/bin/tsc',
        path.join(ROOT, 'node_modules/typescript/bin/tsc'),
    ];
    for (const c of cands) {
        if (fs.existsSync(c)) return c;
    }
    console.error('找不到 tsc。请装 typescript，或设置 TSC=<path/to/tsc>');
    process.exit(2);
}

const tsc = findTsc();
const args = [
    tsc,
    'assets/scripts/view/FxSystem.ts',
    'assets/scripts/core/ColorUtil.ts',
    'assets/scripts/config/BattleConfig.ts',
    'tools/cc-stub.d.ts',
    '--rootDir', 'assets/scripts',
    '--outDir', 'tools/fx-smoke/build',
    '--module', 'commonjs',
    '--target', 'ES2017',
    '--skipLibCheck',
];

console.log('[1/2] 编译 FxSystem …');
const build = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
if (build.status !== 0) {
    console.error(build.stdout || '');
    console.error(build.stderr || '');
    console.error('编译失败');
    process.exit(1);
}

console.log('[2/2] 跑断言 …');
const test = spawnSync(process.execPath, [path.join(__dirname, 'test.js')], {
    cwd: ROOT, stdio: 'inherit',
});
process.exit(test.status === null ? 1 : test.status);
