#!/usr/bin/env node
/**
 * check-resources.js —— 断言 GroveBattle.ts 的 ART_MANIFEST 里每个 resources 路径都真的落地了。
 *
 * 为什么需要它
 * ------------
 * resources.load 的路径写错**不会抛错**：GroveBattle._loadArt 只 console.warn，
 * 绘制侧再退回代码图形。表现是"画面变丑了但游戏照跑"，
 * 而且缩图换代、改名、拆目录这几件事经常同时发生 —— 靠肉眼看是看不出来的。
 *
 * 判定规则
 * --------
 * · `'grove/pet/' + id` 这种拼接：当成**目录**检查，要求目录存在且有 png
 * · `'grove/foe/bug'` 这种完整路径：要求 `assets/resources/<path>.png` 存在
 *
 * 用法：node tools/check-resources.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets/scripts/grove/GroveBattle.ts');
const RES = path.join(ROOT, 'assets/resources');

const src = fs.readFileSync(SRC, 'utf8');

/* 只从 ART_MANIFEST 那一段里取，避免把注释里的例子也算进来 */
const start = src.indexOf('const ART_MANIFEST');
const end = src.indexOf('];', start);
if (start < 0 || end < 0) {
    console.error('找不到 ART_MANIFEST，脚本结构变了，需要同步更新');
    process.exit(1);
}
const block = src.slice(start, end);

const lits = new Set();
const re = /'(\/?[\w./-]+)'/g;
let m;
while ((m = re.exec(block)) !== null) {
    const s = m[1];
    if (s.startsWith('grove/')) lits.add(s);
}

const errors = [];
const dirs = [];
const files = [];

for (const s of [...lits].sort()) {
    const isDir = s.endsWith('/');
    const abs = path.join(RES, s);
    if (isDir) {
        if (!fs.existsSync(abs)) {
            errors.push(`缺目录：${s}  ->  ${path.relative(ROOT, abs)}`);
            continue;
        }
        const pngs = fs.readdirSync(abs).filter((f) => f.endsWith('.png'));
        if (!pngs.length) {
            errors.push(`目录是空的：${s}`);
            continue;
        }
        dirs.push(`${s}  ${pngs.length} 张`);
    } else {
        const f = abs + '.png';
        if (!fs.existsSync(f)) {
            errors.push(`缺文件：${s}.png  ->  ${path.relative(ROOT, f)}`);
            continue;
        }
        files.push(s + '.png');
    }
}

console.log('=== ART_MANIFEST 资源落盘检查 ===');
for (const d of dirs) console.log('  目录 OK  ' + d);
console.log(`  单文件 OK  ${files.length} 项`);

/* 反向查：resources/grove 下有没有谁没被清单引用（占体积又不进画面） */
const used = new Set(files.map((f) => f.replace(/\.png$/, '')));
/* 目录型条目（'grove/pet/'）要把目录里每张图都算进 used，否则它们全被判成孤儿 */
for (const s of lits) {
    if (!s.endsWith('/')) continue;
    const abs = path.join(RES, s);
    for (const fn of fs.readdirSync(abs)) {
        if (fn.endsWith('.png')) used.add(s + fn.replace(/\.png$/, ''));
    }
}
const orphans = [];
(function walk(d) {
    for (const fn of fs.readdirSync(d)) {
        const full = path.join(d, fn);
        if (fs.statSync(full).isDirectory()) {
            walk(full);
            continue;
        }
        if (!fn.endsWith('.png')) continue;
        const rel = path.relative(RES, full).replace(/\\/g, '/').replace(/\.png$/, '');
        if (!used.has(rel)) orphans.push(rel);
    }
})(path.join(RES, 'grove'));

if (orphans.length) {
    console.log('\n  清单外的图（可能是旧版残留，确认后删）');
    for (const o of orphans) console.log('    ' + o);
}

if (errors.length) {
    console.error('\n!! ' + errors.length + ' 条错误');
    for (const e of errors) console.error('   ' + e);
    process.exit(1);
}
console.log('\n全部 ' + (dirs.length + files.length) + ' 项通过。');
