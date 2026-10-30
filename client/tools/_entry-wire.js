/* ============================================================================
   _entry-wire.js —— 出征页第三扇门的"接线"断言
   ----------------------------------------------------------------------------
   验的是**耦合点**，不是画面：

     原型里这扇门 = `location.href = "snowlab.html?from=grove"`（真跳页）。
     Cocos 里没有那个 html，所以 GroveBattle 会在 onLoad 里用
     `setSnowlabEntry(fn)` 把它换成"切组件"。

   这条链有三个容易坏、且**出图看不出来**的地方：
     ① 换了之后还跳页 —— 打包后白页，控制台一声不响；
     ② 组件销毁时没有还原（传 null 被静默忽略）—— 下次进来点门，
        调的是上一个场景里那个已经销毁的组件，表现是"点了没反应"；
     ③ 前两扇门（古道 / 深巢）被顺手改坏 —— 它们和雪原的出口是不同机制。

   运行：node client/tools/_entry-wire.js
   ========================================================================== */

'use strict';

const { boot } = require('./grove-env');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, extra) {
    if (cond) { pass++; console.log('  \u2713 ' + label); }
    else { fail++; fails.push(label + (extra ? '  [' + extra + ']' : '')); console.log('  \u2717 ' + label + (extra ? '  [' + extra + ']' : '')); }
}

const sb = boot();
const GROVE = sb.GROVE;

/* 沙箱里本来没有 location（`typeof location !== "undefined"` 为假，跳页那段
   静默跳过）。**注一个假的进去**，否则"默认跳页"这条测不了 ——
   而它正是"换了也没生效"的对照组。 */
const loc = { href: 'about:blank' };
/* **不能给 ''。** `snowEntryDefault` 里写的是 `location.href` 为真才跳 ——
   空串是 falsy，于是"默认跳页"这条永远测不到赋值，看起来像"跳页坏了"。
   给个假的当前地址，才验得出"被改写成 snowlab"。 */
sb.location = loc;

const SNOW = GROVE.GATES.findIndex(g => g.id === 'snow');
ok(SNOW >= 0, '出征页里有第三扇门（id = snow）');
ok(SNOW === 2, '第三扇门在最后一个槽位（索引 2）', '实际 ' + SNOW);
ok(GROVE.GATES[SNOW].open === true, '第三扇门是开着的（没开门的话这条链根本走不到）');

console.log('\n① 默认实现：点门 = 真跳页');

loc.href = 'about:blank';
GROVE.enterGate(SNOW);
ok(loc.href === 'snowlab.html?from=grove', '默认跳到 snowlab.html', '实际 ' + JSON.stringify(loc.href));
/* `?from=grove` 不是装饰：snowlab 靠它显示返回按钮 + 接着存档那一关打。
   少了它，原型里点进门会从第 1 关开始。 */
ok(loc.href.indexOf('from=grove') > 0, '跳转地址带 ?from=grove（返回按钮 + 接存档关号）');

console.log('\n② 换掉出口：点门 = 调回调，不再跳页');

let hits = 0;
const before = loc.href;
GROVE.setSnowlabEntry(() => { hits++; });
GROVE.enterGate(SNOW);
ok(hits === 1, '自定义出口被调用一次', '实际 ' + hits);
ok(loc.href === before, '**没有跳页**（这正是 Cocos 里要的：跳了就是白页）', '实际 ' + JSON.stringify(loc.href));

console.log('\n③ 传 null = 还原默认（组件销毁时走这条）');

GROVE.setSnowlabEntry(null);
loc.href = 'about:blank';
GROVE.enterGate(SNOW);
ok(hits === 1, '还原之后不再调旧回调', '实际 ' + hits);
ok(loc.href === 'snowlab.html?from=grove', '还原之后重新跳页', '实际 ' + JSON.stringify(loc.href));

console.log('\n④ 前两扇门不受影响（不同机制，别一起改坏）');

const S = GROVE.S;
/* 古道：切 phase 进战斗，**绝不能**碰 snowEntry */
let hits2 = 0;
GROVE.setSnowlabEntry(() => { hits2++; });
GROVE.enterGate(0);
ok(hits2 === 0, '点「苔原古道」不触发推球出口', '实际 ' + hits2);
ok(S.phase !== 'portals', '点「苔原古道」离开出征页（phase 变了）', '实际 ' + S.phase);

GROVE.setSnowlabEntry(null);

console.log('\n' + '='.repeat(56));
if (fail) {
    console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    for (const f of fails) console.log('  ✗ ' + f);
    process.exit(1);
}
console.log('通过 ' + pass + ' 项，失败 0 项');
console.log('✓ 第三扇门的接线成立（默认跳页 / 可替换 / 可还原 / 不串门）');
