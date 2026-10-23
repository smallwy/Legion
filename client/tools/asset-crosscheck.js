/**
 * asset-crosscheck.js —— 回答「assets 下这张图到底还有没有用」
 *
 * 为什么单写一个：`art-inventory.py` 判断的是「有没有字符串/uuid 命中」，
 * 它答不了**命中者自己是否还活着**。2026-10-23 就吃了这个亏 ——
 * `assets/resources/art/` 那 4 张占位图被 `SpriteAssets.ts` 引用，
 * 一眼看是"在用"，但整条链是：
 *
 *     resources/art/*.png ← SpriteAssets.ts ← GameBootstrap.ts
 *                                            ← BattleBoot.ts（仅 MODE === 'mow'）
 *
 * 而 `BattleBoot.MODE` 写死 `'grove'`，GameBootstrap 永远不会被 addComponent，
 * `SpriteAssets.load()` 一次都不会被调用 → 4 张图运行时 100% 不会被加载。
 *
 * 所以这里多做一步：**模块级可达性**。从"真的会跑起来的入口"出发走 import 图，
 * 碰到冻结入口就不再往下走。落在冻结子图里的引用一律标 ★。
 *
 * 三条引用通道（缺一条都会误判成"没用"）：
 *   1. 场景/预制体 —— 按 uuid
 *   2. 代码路径加载 —— `resources.load('a/b')`，**含拼接前缀** `'grove/pet-' + id`
 *   3. 生成器输入 —— tools/*.py|js 里出现文件名/相对路径（生成器产出的图才是运行时用的那张）
 *
 * 用法：
 *   node tools/asset-crosscheck.js          只看 assets/
 *   node tools/asset-crosscheck.js --dead   只列「无任何引用」（给清理用）
 *   node tools/asset-crosscheck.js --json   给下游脚本消费
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

/** 冻结入口：module 文件名 → 为什么它进不来 */
const FROZEN = new Map([
    ['GameBootstrap.ts', "BattleBoot.MODE 写死 'grove'，该组件不会被 addComponent"],
]);

const argv = process.argv.slice(2);
const ONLY_DEAD = argv.includes('--dead');
const AS_JSON = argv.includes('--json');

/* ------------------------------------------------------------------ 工具 */

function walk(dir, pred, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full, pred, out);
        else if (pred(name)) out.push(full);
    }
    return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/* ------------------------------------------------- 1. 资源：png → uuid */

const uuidOf = new Map();   // png 相对路径 → uuid
for (const meta of walk(ASSETS, (n) => n.endsWith('.png.meta'))) {
    try {
        const d = JSON.parse(fs.readFileSync(meta, 'utf8'));
        if (d.uuid) uuidOf.set(rel(meta.slice(0, -5)), d.uuid);
    } catch (e) { /* 坏 meta 跳过，下面会显示成无 uuid */ }
}

/* ------------------------------------------------- 2. 场景 uuid 引用 */

const sceneBlob = {};
for (const sc of walk(ASSETS, (n) => n.endsWith('.scene') || n.endsWith('.prefab'))) {
    sceneBlob[rel(sc)] = fs.readFileSync(sc, 'utf8');
}
const allScenes = Object.values(sceneBlob).join('\n');

/* ------------------------------------- 3. 代码：完整路径 + 拼接前缀 */

const tsFiles = walk(ASSETS, (n) => n.endsWith('.ts'));
const tsSrc = new Map();    // 'scripts/x/Y.ts' → 源码
for (const f of tsFiles) tsSrc.set(rel(f), fs.readFileSync(f, 'utf8'));

/** resources.load('grove/pet') 这种完整字面量 */
const fullPaths = new Set();
/** 'grove/pet-' + id 这种前缀拼接 —— 只取引号内以 - 或 / 结尾的部分 */
const prefixPaths = new Set();

for (const src of tsSrc.values()) {
    // 单/双引号字符串字面量里像资源路径的（含 / 且不含空格）
    for (const m of src.matchAll(/['"]([a-zA-Z0-9_\-/]{3,}?)['"]/g)) {
        const s = m[1];
        if (!s.includes('/')) continue;
        if (/^https?:|^\.\.?\//.test(s)) continue;
        fullPaths.add(s);
    }
    // 前缀拼接：'xxx/' + ...  或  'xxx-' + ...
    // 长度下限 6：`'grove/'` 这种过短前缀会把整棵子树全吞掉，
    // 它确实"可能加载到 grove 下任何一张图"，但那对清理没有分辨力。
    for (const m of src.matchAll(/['"]([a-zA-Z0-9_\-/]{5,}[/\-])['"]\s*\+/g)) {
        prefixPaths.add(m[1]);
    }
}

/* ------------------------------------- 4. 生成器输入（tools/ 里的引用） */

const toolsDir = path.join(ROOT, 'tools');
const SELF = path.basename(__filename);
const toolSrc = new Map();
for (const f of fs.readdirSync(toolsDir)) {
    if (!/\.(py|js)$/.test(f)) continue;
    if (f === SELF || /^(_|reorg-art|art-inventory|scene-art-audit|asset-crosscheck)/.test(f)) continue;
    toolSrc.set(f, fs.readFileSync(path.join(toolsDir, f), 'utf8'));
}

/* ------------------------------------------- 5. import 图 + 可达性 */

/** 'scripts/x/A.ts' → ['scripts/y/B.ts', ...]（只看相对 import） */
const graph = new Map();
for (const [file, src] of tsSrc) {
    const deps = [];
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        let p = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
        if (!p.endsWith('.ts')) p += '.ts';
        if (tsSrc.has(p)) deps.push(p);
    }
    graph.set(file, deps);
}

const frozenFiles = new Set();
for (const name of FROZEN.keys()) {
    for (const k of tsSrc.keys()) {
        if (path.posix.basename(k) === name) frozenFiles.add(k);
    }
}

/** 从这些模块出发算"真的会执行到" —— 场景挂的组件 + 顶层自启动脚本 */
const ROOTS = [];
for (const name of ['HomeRuntime.ts', 'BattleBoot.ts']) {
    for (const k of tsSrc.keys()) {
        if (path.posix.basename(k) === name) ROOTS.push(k);
    }
}
const active = new Set();
const queue = [...ROOTS];
while (queue.length) {
    const cur = queue.shift();
    if (active.has(cur) || frozenFiles.has(cur)) continue;   // 冻结入口不进入
    if (!tsSrc.has(cur)) continue;
    active.add(cur);
    for (const d of graph.get(cur) || []) queue.push(d);
}

/* ------------------------------------------------------- 6. 汇总 */

const rows = [];
for (const png of [...uuidOf.keys()].sort()) {
    const u = uuidOf.get(png);
    const inScene = allScenes.split(u).length - 1;

    const relNoExt = png.replace(/^assets\/(resources|ui)\//, '').replace(/^assets\//, '').replace(/\.png$/, '');
    // 生成器通道才用裸文件名：生成器源码写的是 `os.path.join(SRC, 'home', art + '.png')`，
    // 完整相对路径压根不出现，只有 basename 能匹配上。
    const baseNoExt = path.posix.basename(relNoExt);

    // 通道 2：代码
    // ⚠ 只认**完整相对路径**，不认裸文件名。'cat' / 'ox' / 'coin' 这些既是资源名
    //   又是宠物 id、图标名，拿裸名匹配会把整个 Roster 依赖网全算成引用者
    //   （实测 33 个文件全中，结论正好反过来）。
    const codeHits = [];
    for (const [file, src] of tsSrc) {
        let hit = false;
        for (const p of fullPaths) {
            if (p !== relNoExt) continue;
            if (src.includes("'" + p + "'") || src.includes('"' + p + '"')) { hit = true; break; }
        }
        if (!hit) {
            for (const pre of prefixPaths) {
                // 两个条件都要：图路径以该前缀开头 **且** 这个文件真的写了这个前缀。
                // 少了后半句，全局前缀集合会对每个文件都算命中。
                if (!relNoExt.startsWith(pre)) continue;
                if (!src.includes("'" + pre + "'") && !src.includes('"' + pre + '"')) continue;
                hit = true;
                break;
            }
        }
        if (hit) codeHits.push(file);
    }

    // 通道 3：生成器
    const genHits = [];
    for (const [tool, src] of toolSrc) {
        if (src.includes(baseNoExt) || src.includes(relNoExt)) genHits.push(tool);
    }

    let kind, detail;
    if (inScene > 0) {
        kind = 'scene'; detail = '场景 x' + inScene;
    } else if (codeHits.length) {
        const live = codeHits.filter((f) => active.has(f));
        kind = live.length ? 'code' : 'frozen';
        const show = codeHits.slice(0, 4).map((f) =>
            path.posix.basename(f) + (active.has(f) ? '' : '(冻结)'));
        detail = show.join(', ') + (codeHits.length > 4 ? ` …等 ${codeHits.length} 个` : '');
    } else if (genHits.length) {
        kind = 'generator'; detail = genHits.slice(0, 2).join(', ');
    } else {
        kind = 'dead'; detail = '无任何引用';
    }
    rows.push({ png, uuid: u, inScene, codeHits, genHits, kind, detail });
}

/* ------------------------------------------------------- 7. 输出 */

if (AS_JSON) {
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
}

const group = (k) => rows.filter((r) => r.kind === k);
if (!ONLY_DEAD) {
    const NAMES = {
        scene: '① 场景直接绑定（uuid）',
        code: '② 运行时路径加载（可达）',
        frozen: '★ 仅被冻结分支引用 —— 当前玩法永远读不到',
        generator: '③ 生成器输入（产出的才是运行时那张）',
    };
    for (const k of ['scene', 'code', 'frozen', 'generator']) {
        const g = group(k);
        if (!g.length) continue;
        let size = 0;
        for (const r of g) size += fs.statSync(path.join(ROOT, r.png)).size;
        console.log(`\n=== ${NAMES[k]}：${g.length} 张，${(size / 1024).toFixed(1)} KB ===`);
        for (const r of g) console.log('  ' + r.png.replace(/^assets\//, '').padEnd(46) + r.detail);
    }
}

const dead = group('dead');
console.log(`\n=== ④ 无任何引用：${dead.length} 张 ===`);
for (const r of dead) console.log('  ' + r.png);

const frozen = group('frozen');
if (frozen.length && !ONLY_DEAD) {
    console.log('\n=== 冻结入口明细 ===');
    for (const [f, why] of FROZEN) console.log(`  ${f}: ${why}`);
    console.log('  要恢复这些引用，先让入口重新可达（改 MODE 或删掉冻结分支）。');
}

process.exit(dead.length ? 3 : 0);
