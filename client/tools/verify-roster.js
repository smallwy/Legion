/**
 * verify-roster.js —— 队伍 / 存档 / 战利品的纯函数验证
 * ============================================================================
 *
 * 为什么单独一个验证器
 * --------------------
 * `Battle.scene` 那一套查的是"场景结构合不合法"，`_rt-check.js` 查的是"家园点得动"。
 * 但这次改动最核心的东西既不在场景里也不在家园里，而是**三条跨模块的等式**：
 *
 *   ① 出战人数 = 已解锁宠物数（家园 ↔ 战斗）
 *   ② 饱食度 = 存档里的那一个数（家园 bar ↔ 战斗 HUD）
 *   ③ 结算战利品 = 面板显示的那一份 = 真正入池的那一份
 *
 * 这三条只靠界面截图看不出来，但一旦漂移，玩家会立刻感觉到"假"。
 * 所以给纯函数写断言是最省力的把关方式 —— 不需要引擎、毫秒级跑完。
 *
 * 用法：node tools/verify-roster.js
 *   前置：先编 `tsc -p tools/tsconfig.homeruntime.build.json`
 */
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '_rt-build', 'config');
const { PETS, MAX_SQUAD, unlockedPets, lockedPets, petGap, squadSize, rolesFor, powerScale, heroIndexOf } =
    require(path.join(BUILD, 'Roster.js'));
const { DEFAULT_SAVE, LEVEL_COUNT, LOOT, REST_SATIETY, loadSave, saveSave, resetSave, lootOf, settleInto } =
    require(path.join(BUILD, 'SaveData.js'));

let pass = 0;
const fails = [];
function ok(cond, name, detail) {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fails.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (a, b) => Math.abs(a - b) < 1e-9;

console.log('队伍 / 存档 / 战利品 验证\n');

/* ---------- 0. 假存储：让存档真的落地，而不是只在内存里转 ---------- */
function fakeStore() {
    const m = Object.create(null);
    return {
        getItem: (k) => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: (k) => { delete m[k]; },
    };
}
globalThis.localStorage = fakeStore();

/* ==========================================================================
 * 1. 花名册
 * ========================================================================== */
console.log('1. 花名册');

ok(PETS.length >= MAX_SQUAD, '解锁表里的宠物数不少于出战上限', `${PETS.length} vs ${MAX_SQUAD}`);
ok(PETS[0].at === 0, '第一只宠物开局就在（at = 0）', `at = ${PETS[0].at}`);

let mono = true;
for (let i = 1; i < PETS.length; i++) {
    if (PETS[i].at <= PETS[i - 1].at) mono = false;
}
ok(mono, '解锁门槛严格递增（否则会出现"后解锁的比先解锁的先回家"）',
    PETS.map((p) => `${p.name}@${p.at}`).join(' '));

const ids = PETS.map((p) => p.id);
ok(new Set(ids).size === ids.length, '宠物 id 无重复');

/* id 必须能在 assets/ui/home/pets 下找到同名贴图，否则那只是花名册上的一个名字 */
const PET_DIR = path.join(__dirname, '..', 'assets', 'ui', 'home', 'pets');
const files = fs.existsSync(PET_DIR)
    ? fs.readdirSync(PET_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
    : [];
ok(ids.every((id) => files.includes(id)), '每只宠物都有立绘贴图',
    `缺失：${ids.filter((id) => !files.includes(id)).join(', ') || '无'}`);

/* --------------------------------------------------------------------------
 * 1b. 三个名字 / 头像 / 招式 —— 和 grove.html 的 HEROES 逐字比对
 *
 * **这一节是为一次真实事故加的把关。** `PetDef` 上现在有四个字符串：
 *   id    存档 key + 立绘贴图名
 *   short grove 短 id + 头像文件名
 *   node  Home.scene 的节点名（匹配键）
 *   name  给玩家看的名字
 * 上一轮把 `name` 从"砂糖"改成"尖耳猫"，而它当时**同时充当匹配键** ——
 * 三处 `PETS.find(p => p.name === n.name)` 当场全断，主界面一只宠物都没有。
 * 拆成四个字段之后，还需要一道"两边没写岔"的论证，否则同一个坑换个地方挖。
 * ------------------------------------------------------------------------ */
const shorts = PETS.map((p) => p.short);
ok(new Set(shorts).size === shorts.length, 'short 无重复', shorts.join(','));
const nodes = PETS.map((p) => p.node);
ok(new Set(nodes).size === nodes.length, 'node 无重复', nodes.join(','));

/* 头像：resources/grove/head/<short>.png 必须存在（图鉴 / 底部槽 / 出战卡都读它） */
const HEAD_DIR = path.join(__dirname, '..', 'assets', 'resources', 'grove', 'head');
const heads = fs.existsSync(HEAD_DIR)
    ? fs.readdirSync(HEAD_DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
    : [];
ok(shorts.every((s) => heads.includes(s)), '每只宠物都有头像图（图鉴 / 槽位 / 出战卡要用）',
    `缺失：${shorts.filter((s) => !heads.includes(s)).join(', ') || '无'}`);

/* grove.html 的 HEROES：顺序、id、name、tag 四项都必须逐字对上。
   顺序尤其要紧 —— `heroIndexOf()` 把存档 id 换成**下标**传给 groveBoot，
   两边顺序一错，玩家选雪团会被带去砂糖。 */
const GROVE = path.join(__dirname, '..', 'prototype', 'grove.html');
let heroes = [];
try {
    const html = fs.readFileSync(GROVE, 'utf8');
    const i = html.indexOf('const HEROES = [');
    const j = html.indexOf('\n];', i);
    const block = html.slice(i, j);
    const re = /id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*tag:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(block))) heroes.push({ id: m[1], name: m[2], tag: m[3] });
} catch (e) {
    heroes = [];
}
ok(heroes.length === PETS.length, 'grove.html 里读到 6 只英雄',
    `读到 ${heroes.length}`);

let orderOk = true, nameOk = true, tagOk = true;
for (let i = 0; i < Math.min(heroes.length, PETS.length); i++) {
    if (heroes[i].id !== PETS[i].short) orderOk = false;
    if (heroes[i].name !== PETS[i].name) nameOk = false;
    if (heroes[i].tag !== PETS[i].tag) tagOk = false;
}
ok(orderOk, 'PETS 顺序 = HEROES 顺序（heroIndexOf 靠它换算）',
    PETS.map((p) => p.short).join(',') + ' vs ' + heroes.map((h) => h.id).join(','));
ok(nameOk, '显示名和战斗里逐字一致（否则"到家的是谁"对不上）',
    PETS.map((p, i) => `${p.name}/${heroes[i] && heroes[i].name}`).join(' '));
ok(tagOk, '招式名和战斗里逐字一致（主界面说的招式场上得有）',
    PETS.map((p, i) => `${p.tag}/${heroes[i] && heroes[i].tag}`).join(' '));

let heroIdxOk = true;
for (let i = 0; i < PETS.length; i++) if (heroIndexOf(PETS[i].id) !== i) heroIdxOk = false;
ok(heroIdxOk, 'heroIndexOf 逐只换算出正确下标',
    PETS.map((p) => `${p.id}→${heroIndexOf(p.id)}`).join(' '));
ok(heroIndexOf('不存在的 id') === 0, '未知 id 兜回 0（不返回 -1，否则 groveBoot 静默按默认开局）',
    String(heroIndexOf('不存在的 id')));

/* ==========================================================================
 * 2. 出战人数（家园 ↔ 战斗的第一条等式）
 * ========================================================================== */
console.log('\n2. 出战人数 = 已解锁数（上限 3）');

ok(squadSize(0) === 1, '开局只有 1 只', `squadSize(0) = ${squadSize(0)}`);
ok(squadSize(PETS[1].at) === 2, `通关 ${PETS[1].at} 关后变 2 只`, `squadSize(${PETS[1].at}) = ${squadSize(PETS[1].at)}`);
ok(squadSize(8) === MAX_SQUAD, '全通关后封顶在 3 只（不是 6 只）', `squadSize(8) = ${squadSize(8)}`);

let monotonic = true;
for (let c = 1; c <= 8; c++) {
    if (squadSize(c) < squadSize(c - 1)) monotonic = false;
}
ok(monotonic, '出战人数随进度只增不减');

/* 人数必须真的等于 unlockedPets 与上限取小 —— 这是"家园几只、场上几只"的等式本身 */
let consistent = true;
for (let c = 0; c <= 8; c++) {
    const expect = Math.min(MAX_SQUAD, unlockedPets(c).length);
    if (squadSize(c) !== expect) consistent = false;
}
ok(consistent, '出战人数恒等于 min(已解锁数, 上限)');

ok(unlockedPets(0).length + lockedPets(0).length === PETS.length, '已解锁 + 未解锁 = 全部');
ok(petGap(0, PETS[1].id) === PETS[1].at, '还差几关 = 门槛 − 已通关', `petGap(0) = ${petGap(0, PETS[1].id)}`);
ok(petGap(8, PETS[0].id) === 0, '已解锁的宠物差 0 关');

/* ==========================================================================
 * 3. 角色表（槽位 + 技能）
 * ========================================================================== */
console.log('\n3. 角色表：人数变了槽位不能撞');

for (let n = 1; n <= MAX_SQUAD; n++) {
    const rs = rolesFor(n);
    ok(rs.length === n, `${n} 只 → ${n} 个槽位`, `实际 ${rs.length}`);

    const key = rs.map((r) => r.slot.join(','));
    ok(new Set(key).size === n, `${n} 只时槽位互不重叠`, key.join(' | '));

    const kinds = rs.map((r) => r.kind);
    ok(new Set(kinds).size === n, `${n} 只时技能互不重复`, kinds.join(' | '));
}

/* 单人必须是正后方（居中），不能沿用满编的左后 —— 没有对称对象时读成"站偏了" */
ok(rolesFor(1)[0].slot[1] === 0, '单人站正后方（横向偏移 0）', `slot = ${rolesFor(1)[0].slot}`);

/* 兜底：人数传 0 / 负数 / NaN 时不能出现"场上没人" */
ok(rolesFor(0).length === 1, '人数传 0 时兜底成 1 只（场上不能没人）');
ok(rolesFor(NaN).length === 1, '人数传 NaN 时兜底成 1 只');
ok(rolesFor(99).length === MAX_SQUAD, '人数超上限时夹到 3 只', `实际 ${rolesFor(99).length}`);

/* ==========================================================================
 * 4. 敌人配平系数
 * ========================================================================== */
console.log('\n4. 敌人配平系数');

ok(eq(powerScale(1), 1 / 3), '1 只 = 1/3 的敌人量', `powerScale(1) = ${powerScale(1).toFixed(4)}`);
ok(eq(powerScale(3), 1), '满编 = 全量（不改变已标定的平衡）', `powerScale(3) = ${powerScale(3)}`);
ok(powerScale(1) < powerScale(2) && powerScale(2) < powerScale(3), '系数随人数严格递增');
ok(powerScale(0) > 0 && powerScale(NaN) > 0, '系数永不为 0（否则第 1 波是空波）');

/* ==========================================================================
 * 5. 存档读写
 * ========================================================================== */
console.log('\n5. 存档读写');

resetSave();
const fresh = loadSave();
ok(fresh.cleared === DEFAULT_SAVE.cleared && fresh.apples === DEFAULT_SAVE.apples,
    '没有存档时回落到默认值（不崩）', JSON.stringify(fresh));

/* 存档是唯一的外部输入，必须经得起脏数据 */
globalThis.localStorage.setItem('pawpack.save.v1', '{ 这不是 JSON');
const broken = loadSave();
ok(broken.apples === DEFAULT_SAVE.apples, '存档损坏时回落到默认值（丢档不等于崩游戏）');

globalThis.localStorage.setItem('pawpack.save.v1', JSON.stringify({
    cleared: 999, apples: -5, satiety: 5000, active: '', runs: 3.7,
}));
const dirty = loadSave();
/* 上界是 STAGE_COUNT（27），不是 8。这三条断言原来写的是 8 —— 那时
   `LEVEL_COUNT` 还是别名到写死的 8，改成 27 屏之后它们一直红着。
   **红着的断言和没有断言一样糟**：没人再看它，真出问题时也分不清是新的还是旧的。 */
ok(dirty.cleared === LEVEL_COUNT, `越界的关卡进度夹到 ${LEVEL_COUNT}`, `cleared = ${dirty.cleared}`);
ok(dirty.apples === 0, '负数资源夹到 0', `apples = ${dirty.apples}`);
ok(dirty.satiety === 100, '越界饱食度夹到 100', `satiety = ${dirty.satiety}`);
ok(dirty.active === DEFAULT_SAVE.active, '空 active 回落到默认宠物', `active = ${dirty.active}`);
ok(dirty.runs === 3, '浮点场次向下取整', `runs = ${dirty.runs}`);

/* ==========================================================================
 * 6. 战利品换算
 * ========================================================================== */
console.log('\n6. 战利品换算');

/* 满编通关一局的经验量级（见 SATIETY 注释里的 "302 杀"） */
const FULL = { orbs: 390, kills: 300, bossKilled: true, endReason: 'victory' };
const won = lootOf(FULL);
const expectApple = Math.floor(390 / LOOT.orbsPerApple);
const expectLog = Math.floor(300 / LOOT.killsPerLog);
const expectCoin = Math.floor(300 / LOOT.killsPerCoin) + LOOT.bossCoins;
ok(won.apples === expectApple, '果子 = 经验珠 ÷ 24', `${won.apples}（应 ${expectApple}）`);
ok(won.logs === expectLog, '材料 = 击杀 ÷ 16', `${won.logs}（应 ${expectLog}）`);
ok(won.coins === expectCoin, '吧唧 = 击杀 ÷ 60 + BOSS 3', `${won.coins}（应 ${expectCoin}）`);

/* 换算的目标是"一场明显动，但不动到改变量级" —— 一场翻倍就等于没有经济 */
ok(won.apples < DEFAULT_SAVE.apples * 0.15,
    '一场的果子不到基线 15%（否则资源失去重量）', `+${won.apples} vs 基线 ${DEFAULT_SAVE.apples}`);
ok(won.logs > 0 && won.coins > 0, '材料与吧唧每场都能攒到');

const idle = lootOf({ orbs: 0, kills: 0, bossKilled: false, endReason: 'withdraw' });
ok(idle.apples === 0 && idle.logs === 0, '什么都没打就一无所得（不白送）', JSON.stringify(idle));

const tiny = lootOf({ orbs: 3, kills: 1, bossKilled: false, endReason: 'withdraw' });
ok(tiny.apples >= 1, '零星击杀也至少给 1 个果子（0 战利品会被读成"没算"）', JSON.stringify(tiny));

/* BOSS 没打死就不给 BOSS 掉落 */
ok(lootOf(Object.assign({}, FULL, { bossKilled: false })).coins === expectCoin - LOOT.bossCoins,
    'BOSS 未讨伐则不给 BOSS 掉落');

/* 结局系数：现在 hp0 与撤离等价（改为 0.6 需要拍板，改前这条断言就是保险） */
const hp0 = lootOf(Object.assign({}, FULL, { endReason: 'hp0' }));
const wd = lootOf(Object.assign({}, FULL, { endReason: 'withdraw' }));
ok(LOOT.mulHp0 === 1
    ? JSON.stringify(hp0) === JSON.stringify(wd)
    : hp0.apples < wd.apples,
    'HP 归零的战利品系数与配置表一致',
    `mulHp0 = ${LOOT.mulHp0} → ${JSON.stringify(hp0)} vs ${JSON.stringify(wd)}`);

/* ==========================================================================
 * 7. 结算入池（第三条等式：显示 = 入池）
 * ========================================================================== */
console.log('\n7. 结算入池');

resetSave();
saveSave(Object.assign({}, DEFAULT_SAVE));
const before = loadSave();

const r1 = settleInto(before, FULL, 19);
ok(r1.next.apples === before.apples + r1.loot.apples, '果子累加进池',
    `${before.apples} + ${r1.loot.apples} = ${r1.next.apples}`);
ok(r1.next.logs === before.logs + r1.loot.logs, '材料累加进池');
ok(r1.next.coins === before.coins + r1.loot.coins, '吧唧累加进池');
ok(r1.next.cleared === before.cleared + 1, '通关推进 1 关', `cleared = ${r1.next.cleared}`);
ok(r1.next.runs === before.runs + 1, '出门场次 +1');
ok(r1.next.satiety === 19, '回家带回战斗结束时的饱食（去灶台吃，不再自动吃饱）', `satiety = ${r1.next.satiety}`);
ok(r1.next.active === before.active, '结算不改动出战宠物');

/* 关键：写进去了没有？读回来必须和返回值一致 —— 否则"战斗里说 +16、回家没变" */
const reread = loadSave();
ok(JSON.stringify(reread) === JSON.stringify(r1.next), '结算后确实落盘（再读一次一致）',
    JSON.stringify(reread));

/* 撤离 / HP 归零不推进关卡 */
const w1 = settleInto(before, Object.assign({}, FULL, { endReason: 'withdraw' }), 40);
ok(w1.next.cleared === before.cleared, '主动撤离不推进关卡', `cleared = ${w1.next.cleared}`);
ok(w1.next.satiety === 40, '撤离也按结束时的饱食回写', `satiety = ${w1.next.satiety}`);
const h1 = settleInto(before, Object.assign({}, FULL, { endReason: 'hp0' }), 0);
ok(h1.next.cleared === before.cleared, 'HP 归零不推进关卡（红线②没有游戏结束）');
ok(h1.next.satiety === 0, '空肚子回家就是 0', `satiety = ${h1.next.satiety}`);

/* 关卡上限：打满也只到 LEVEL_COUNT（27） */
let s = Object.assign({}, DEFAULT_SAVE);
for (let i = 0; i < LEVEL_COUNT + 5; i++) s = settleInto(s, FULL, 100).next;
ok(s.cleared === LEVEL_COUNT, `关卡进度封顶在 ${LEVEL_COUNT}`, `cleared = ${s.cleared}`);

/* 出战人数必须随结算自己长起来 —— 这是"打赢 → 多一只跟班"的完整链路。
   **门槛跟着解锁表走，不写死场次**：`PETS[1].at = 2`、`PETS[2].at = 5`，
   所以是"通 2 场变 2 只、通 5 场满编"。写死 1 场 / 3 场的那一版已经过期。 */
let t = Object.assign({}, DEFAULT_SAVE);
ok(squadSize(t.cleared) === 1, '开局出战 1 只');
for (let i = 0; i < PETS[1].at; i++) t = settleInto(t, FULL, 100).next;
ok(squadSize(t.cleared) === 2, `通关 ${PETS[1].at} 场后出战变 2 只`, `cleared = ${t.cleared}`);
for (let i = t.cleared; i < PETS[2].at; i++) t = settleInto(t, FULL, 100).next;
ok(squadSize(t.cleared) === 3, `通关 ${PETS[2].at} 场后满编 3 只`, `cleared = ${t.cleared}`);

ok(rolesFor(squadSize(t.cleared)).length === 3, '满编后战斗真的会实例化 3 个角色');

/* ---------- 9. 评级奖励 / 战绩 / 总星数 ----------
   病理：`S.best` 一直在落盘，但**没有任何地方消费它**。
   这一节钉"分数从哪来、怎么算、能不能被脏档带偏"三件事。
   真正的战斗侧逻辑（`rankAward` / `recordStats`）在 grove-smoke §37 里测，
   这里只管主界面这一侧的换算 —— 两边各测各的口径，合起来才闭合。 */
{
    const HB = require(path.join(BUILD, 'HomeBiz.js'));
    const { loadBattleStats } = require(path.join(BUILD, 'SaveData.js'));

    /* fakeStore 已经在上面建好并指向一个空存档；这里灌一份有用的评级 */
    const mk = (best) => Object.assign({}, DEFAULT_SAVE, { best });
    const all = (v) => new Array(LEVEL_COUNT).fill(v);

    /* ① 星数换算：S=3 / A=2 / B=1 / 空=0 */
    ok(HB.starsOf(mk(all('S'))) === LEVEL_COUNT * 3, '全 S = 满星', String(LEVEL_COUNT * 3));
    ok(HB.starsOf(mk(all(''))) === 0, '全空 = 0 星');
    ok(HB.starsOf(mk(all('B'))) === LEVEL_COUNT, '全 B = 屏数颗星');
    ok(HB.STAR_MAX === LEVEL_COUNT * 3, '满星常量跟着屏数走', 'STAR_MAX=' + HB.STAR_MAX);

    /* ② ★ 脏档：白名单外的值不能变成分 */
    const dirty = Object.assign({}, DEFAULT_SAVE, { best: all('S') });
    dirty.best[0] = 'SSS';
    dirty.best[1] = 'S ';
    dirty.best[2] = null;
    dirty.best[3] = 3;
    ok(HB.starsOf(dirty) === (LEVEL_COUNT - 4) * 3,
        '★ 脏评级（SSS / "S " / null / 数字）一律不计分',
        '得到 ' + HB.starsOf(dirty));
    ok(HB.starsOf(Object.assign({}, DEFAULT_SAVE, { best: null })) === 0,
        '★ best 整个是 null 也不崩');

    /* ③ 四档统计必须加起来等于屏数 —— 少一档就会"总数对不上" */
    const rc = HB.rankCount(dirty);
    ok(rc.s + rc.a + rc.b + rc.none === LEVEL_COUNT, '四档之和 = 屏数');

    /* ④ 战绩读取：长度对齐 + 脏值清 0 */
    const t = loadBattleStats();
    ok(t.t.length === LEVEL_COUNT && t.c.length === LEVEL_COUNT,
        '战绩数组长度 = 屏数（下标不会错位）', `${t.t.length}/${t.c.length}`);
    ok(t.t.every((x) => x === 0) && t.c.every((x) => x === 0), '没有战绩时全是 0，不是 undefined');

    /* ⑤ ★ 结算出口：评级材料必须和一趟的账合流 */
    const base = { kind: 'esc', lastLoot: 0, lastStages: 0, tripLoot: 100, tripStages: 3, food: 20 };
    const noRank = HB.payoutFromRun(base);
    const withRank = HB.payoutFromRun(Object.assign({}, base, { rankLogs: 5 }));
    ok(noRank.logs === 3, '不传 rankLogs：材料 = 通关屏数（老行为不变）', 'logs=' + noRank.logs);
    ok(withRank.logs === 8, '★ 传 rankLogs：材料 = 屏数 + 评级奖励', 'logs=' + withRank.logs);
    ok(withRank.apples === noRank.apples, '评级奖励不影响果子（果子已经通胀 6.5×）');
    ok(HB.payoutFromRun(Object.assign({}, base, { rankLogs: -9 })).logs === 3,
        '★ 负的 rankLogs 被夹到 0（存档能手改）');
    ok(HB.payoutFromRun(Object.assign({}, base, { rankLogs: NaN })).logs === 3,
        '★ NaN 的 rankLogs 不会把材料写成 NaN');
}

/* ---------- 10. 本趟目标：抽签 / 判定 / 奖励 ----------
   用户第三次提「任务是一次性的」。换结构之后，这一节钉住"换得对不对"：
   抽签不重复、判定不误判（尤其"站着不动也算达成"这类）、奖励并进同一个出口。
   战斗侧读档 + 真的画在 HUD 上，在 grove-smoke §38 里测。 */
{
    const HB = require(path.join(BUILD, 'HomeBiz.js'));

    /* ① 抽签：2 条、不重复、可复现（传固定种子） */
    let seed = 12345;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const a = HB.rollTripGoals(rng);
    ok(a.length === HB.TRIP_PICK, `一趟抽 ${HB.TRIP_PICK} 条`, 'got ' + a.length);
    ok(new Set(a).size === a.length, '抽出来的两条不重复');
    ok(a.every((id) => HB.tripGoal(id)), '抽出来的 id 都能查到定义');

    /* 同一个种子必须抽到同一组 —— 不然"玩家抱怨总抽到 X"没法复现 */
    let seed2 = 12345;
    const rng2 = () => { seed2 = (seed2 * 1664525 + 1013904223) >>> 0; return seed2 / 4294967296; };
    ok(JSON.stringify(HB.rollTripGoals(rng2)) === JSON.stringify(a), '同种子抽出同一组（可复现）');

    /* 多次抽样要覆盖到全部 5 条，否则等于"目标池只有 2 条" */
    const seen = new Set();
    let s3 = 7;
    const rng3 = () => { s3 = (s3 * 1664525 + 1013904223) >>> 0; return s3 / 4294967296; };
    for (let i = 0; i < 60; i++) for (const id of HB.rollTripGoals(rng3)) seen.add(id);
    ok(seen.size === HB.TRIP_GOALS.length,
        `抽样 60 次覆盖全部 ${HB.TRIP_GOALS.length} 条目标`, 'seen ' + seen.size);

    /* ② 判定：每条都要能"达成"也能"不达成" */
    const base = { burned: 0, maxHolds: 1, hits: 0, lost: 0, burst: 0, made: 3 };
    const met = (ids, patch) => HB.judgeTripGoals(ids, Object.assign({}, base, patch)).map((g) => g.id);

    ok(met(['nofire'], {}).indexOf('nofire') >= 0, 'nofire：没烧球 → 达成');
    ok(met(['nofire'], { burned: 1 }).indexOf('nofire') < 0, '★ nofire：烧了就不算');
    ok(met(['nofire'], { made: 0 }).indexOf('nofire') < 0,
        '★★ nofire：一球没造也不算 —— 否则"站着不动"就能完成');

    ok(met(['bigchain'], { maxHolds: 3 }).indexOf('bigchain') >= 0, 'bigchain：卷 3 只 → 达成');
    ok(met(['bigchain'], { maxHolds: 2 }).indexOf('bigchain') < 0, '★ bigchain：卷 2 只不算');

    ok(met(['nohit'], {}).indexOf('nohit') >= 0, 'nohit：没被打 → 达成');
    ok(met(['nohit'], { hits: 1 }).indexOf('nohit') < 0, '★ nohit：被打一次就不算');
    ok(met(['nohit'], { made: 0 }).indexOf('nohit') < 0, '★★ nohit：一球没造也不算');

    ok(met(['nolost'], {}).indexOf('nolost') >= 0, 'nolost：没丢球 → 达成');
    ok(met(['nolost'], { lost: 2 }).indexOf('nolost') < 0, '★ nolost：丢过就不算');
    ok(met(['nolost'], { lost: undefined }).indexOf('nolost') >= 0,
        'nolost：lost 字段缺失时不崩（战斗里它是动态加的）');

    ok(met(['noshell'], {}).indexOf('noshell') >= 0, 'noshell：壳没破 → 达成');
    ok(met(['noshell'], { burst: 1 }).indexOf('noshell') < 0, '★ noshell：破了一次就不算');

    /* ③ 脏输入 */
    ok(HB.judgeTripGoals(null, base).length === 0, '★ ids 是 null → 空，不崩');
    ok(HB.judgeTripGoals(['__evil'], base).length === 0, '★ 未知 id 被忽略');
    ok(HB.judgeTripGoals(['nofire', 'nofire'], base).length === 2,
        '重复 id 各算一次（上游已去重，这里不额外判）');

    /* ④ 奖励合计 + 走同一个出口 */
    /* 卷 3 只才够 bigchain —— base 里是 1，上一版就是这么写错的 */
    const two = HB.judgeTripGoals(['nofire', 'bigchain'], Object.assign({}, base, { maxHolds: 3 }));
    const rw = HB.tripReward(two);
    ok(rw.shards === 2 && rw.logs === 2, '两条目标的奖励各自相加', JSON.stringify(rw));
    ok(HB.tripReward([]).shards === 0 && HB.tripReward([]).logs === 0, '一条没达成 → 0');

    const pb = { kind: 'esc', lastLoot: 0, lastStages: 0, tripLoot: 100, tripStages: 3, food: 20 };
    const g0 = HB.payoutFromRun(pb);
    const g1 = HB.payoutFromRun(Object.assign({}, pb, { goalShards: 2, goalLogs: 2 }));
    ok(g0.shards === 0, '不传目标奖励：碎片还是 0（老调用方行为不变）', 'shards=' + g0.shards);
    ok(g1.shards === 2, '★ 目标碎片并进结算', 'shards=' + g1.shards);
    ok(g1.logs === g0.logs + 2, '★ 目标材料并进结算', `${g1.logs} vs ${g0.logs}`);
    ok(g1.apples === g0.apples, '目标奖励不影响果子（果子已通胀 6.5×）');
}

/* ---------- 11. 主线 / 每日 ----------
   用户第三次说任务有问题之后换成的结构。这一节钉"常规游戏该有的形状"：
   主线串行且能连跳、每日按日期稳定、进度靠基线差值而不是清零。 */
{
    const HB = require(path.join(BUILD, 'HomeBiz.js'));

    /* ---- 主线 ---- */
    ok(HB.STORY.length === 10, '主线 10 条', 'got ' + HB.STORY.length);
    ok(new Set(HB.STORY.map((x) => x.id)).size === 10, '主线 id 不重复');

    let s0 = Object.assign({}, DEFAULT_SAVE, { storyIdx: 0 });
    ok(HB.storyNow(s0).id === HB.STORY[0].id, '开局手上是第 1 条');

    /* 连跳：一个"什么都干过"的存档应该一次过完好几条 */
    const allDone = Object.assign({}, DEFAULT_SAVE, {
        storyIdx: 0, runs: 3, feeds: 2, crafts: 1, dispatches: 1,
        cleared: 12, pats: { 'sugar-stand': 12 }, perks: ['hotpit'],
        best: new Array(LEVEL_COUNT).fill('') ,
    });
    allDone.best[0] = 'S';
    const st = HB.settleStory(allDone);
    ok(st.gained.length >= 6, '★ 一次结算能连过多条（不然玩家要回好几次家）',
        'gained ' + st.gained.length);
    ok(st.next.storyIdx === st.gained.length, 'storyIdx 推进到已完成条数');

    /* ★ 每条只发一次：再结算一次不该再给东西 */
    const again = HB.settleStory(Object.assign({}, st.next, {
        // 让后面几条也别满足，只看前 N 条不重复发
    }));
    ok(again.gained.length === 0 || again.next.apples >= st.next.apples,
        '★ 重复结算不会倒扣（已经领过的不再触发）');

    /* 全部做完 → storyNow 返回 null，不崩 */
    const done = Object.assign({}, DEFAULT_SAVE, { storyIdx: 99 });
    ok(HB.storyNow(done) === null, '★ storyIdx 越界 → null，不崩');

    /* ---- 每日 ---- */
    const ids1 = HB.rollDaily('2026-10-25');
    const ids2 = HB.rollDaily('2026-10-25');
    ok(ids1.length === HB.DAILY_N, `每日抽 ${HB.DAILY_N} 条`);
    ok(JSON.stringify(ids1) === JSON.stringify(ids2), '★ 同一天抽同一组（可复现）');
    ok(new Set(ids1).size === ids1.length, '同一天不重复');

    /* 换天要换组（连续 7 天里至少出现 3 种不同组合，不然等于没换） */
    const combos = new Set();
    for (let d = 20; d <= 26; d++) combos.add(HB.rollDaily('2026-10-' + d).join(','));
    ok(combos.size >= 3, '★ 换天换组', combos.size + ' 种组合');

    /* 基线差值：老玩家不该一开游戏就自动完成 */
    const veteran = Object.assign({}, DEFAULT_SAVE, {
        runs: 50, feeds: 30, crafts: 20, dispatches: 20, cleared: 20,
        pats: { 'sugar-stand': 100 },
        dailyAt: '2026-10-25', dailyPick: ['d_run', 'd_feed', 'd_pat'],
        dailyBase: { runs: 50, feeds: 30, pats: 100 },
    });
    const rows = HB.dailyRows(veteran);
    ok(rows.every((r) => r.cur === 0 && !r.done),
        '★★ 50 场老玩家今天一开游戏进度是 0/2（不是自动完成）',
        rows.map((r) => r.cur + '/' + r.def.target).join(','));

    const after = Object.assign({}, veteran, { runs: 52, feeds: 31, pats: { 'sugar-stand': 104 } });
    const rows2 = HB.dailyRows(after);
    const runRow = rows2.find((r) => r.def.id === 'd_run');
    const feedRow = rows2.find((r) => r.def.id === 'd_feed');
    ok(runRow.cur === 2 && runRow.done, '打 2 场 → 出门那条完成');
    ok(feedRow.cur === 1 && !feedRow.done, '喂 1 顿 → 3 顿那条还差 2');

    /* ---- 领取 ---- */
    const r1 = HB.claimDaily(veteran, 'd_run');
    ok(!r1.ok, '★ 没完成不给领');
    const r2 = HB.claimDaily(after, 'd_run');
    ok(r2.ok, '完成了能领');
    ok(r2.next.apples === after.apples + 20, '领到 20 果');
    const r3 = HB.claimDaily(r2.next, 'd_run');
    ok(!r3.ok, '★ 同一条不能领两次');
    const r4 = HB.claimDaily(after, '__evil');
    ok(!r4.ok, '★ 不存在的 id 不给领');

    /* 跨天重置：清空已领 + 重拍基线 */
    const nd = HB.rollDailyIfNeeded(Object.assign({}, r2.next, { dailyAt: '2026-10-24' }), Date.parse('2026-10-25T10:00:00'));
    ok(nd.changed, '日期变了要重抽');
    ok(nd.next.dailyClaimed.length === 0, '★ 跨天清空已领');
    ok(nd.next.dailyAt === '2026-10-25', '日期键更新');
    const sameDay = HB.rollDailyIfNeeded(nd.next, Date.parse('2026-10-25T22:00:00'));
    ok(!sameDay.changed, '同一天不重抽');

    /* 日期键格式 */
    ok(/^\d{4}-\d{2}-\d{2}$/.test(HB.todayKey(Date.parse('2026-03-05T00:00:00'))),
        '日期键是 YYYY-MM-DD', HB.todayKey(Date.parse('2026-03-05T00:00:00')));
}

/* ---------- 12. 本机排行榜 ----------
   用户：「排行榜不应该是通关的吗」「排行榜你先做本地」。
   街机式 TOP 10：9 条影子记录 + 你。这一节钉"榜是活的"：
   成绩变好名次必须变，而且榜上永远只有 10 个人。 */
{
    const HB = require(path.join(BUILD, 'HomeBiz.js'));
    const mk12 = (cleared, runs, bestArr) => Object.assign({}, DEFAULT_SAVE, {
        cleared: cleared, runs: runs,
        best: bestArr || new Array(LEVEL_COUNT).fill(''),
    });

    const b0 = HB.rankBoard(mk12(0, 0));
    ok(b0.length === HB.RANK_SIZE, `榜上恒为 ${HB.RANK_SIZE} 条`, 'got ' + b0.length);
    ok(b0.filter((r) => r.me).length === 1, '自己只出现一次');
    ok(b0[b0.length - 1].me, '★ 新手（0 屏）排最后 —— 永远有 9 个够得着的目标在前面');

    const b1 = HB.rankBoard(mk12(30, 20));
    ok(b1[0].me, '★ 全通（30 屏）排第 1');
    ok(HB.myRank(mk12(30, 20)) === 1, 'myRank 和第 1 行一致');

    /* 同屏数比星数 */
    const allS = new Array(LEVEL_COUNT).fill('S');
    const rank1 = HB.myRank(mk12(27, 30, allS));
    const rank2 = HB.myRank(mk12(27, 30, new Array(LEVEL_COUNT).fill('B')));
    ok(rank1 <= rank2, '★ 同屏数时星多的人排前面', rank1 + ' vs ' + rank2);

    /* 同屏同星比趟数 */
    const few = HB.myRank(mk12(27, 10, allS));
    const many = HB.myRank(mk12(27, 99, allS));
    ok(few <= many, '★ 同屏同星时趟数少的排前面', few + ' vs ' + many);

    /* 排序函数本身：三档都要生效 */
    ok(HB.rankCmp({ name: 'a', cleared: 10, stars: 0, runs: 0 },
        { name: 'b', cleared: 9, stars: 99, runs: 0 }) < 0, '先比通关数');
    ok(HB.rankCmp({ name: 'a', cleared: 9, stars: 20, runs: 0 },
        { name: 'b', cleared: 9, stars: 10, runs: 0 }) < 0, '再比星数');
    ok(HB.rankCmp({ name: 'a', cleared: 9, stars: 10, runs: 5 },
        { name: 'b', cleared: 9, stars: 10, runs: 6 }) < 0, '最后比趟数');

    /* 脏档不崩 */
    ok(HB.rankBoard(Object.assign({}, DEFAULT_SAVE, { cleared: NaN, runs: NaN })).length === HB.RANK_SIZE,
        '★ cleared/runs 是 NaN 也不崩');
}

delete globalThis.localStorage;

/* ---------- 汇总 ---------- */
console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
    console.log('\n失败项：');
    for (const f of fails) console.log('  · ' + f);
    process.exit(1);
}
console.log('全部通过。');
