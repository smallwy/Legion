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
const { PETS, MAX_SQUAD, unlockedPets, lockedPets, petGap, squadSize, rolesFor, powerScale } =
    require(path.join(BUILD, 'Roster.js'));
const { DEFAULT_SAVE, LOOT, REST_SATIETY, loadSave, saveSave, resetSave, lootOf, settleInto } =
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
ok(dirty.cleared === 8, '越界的关卡进度夹到 8', `cleared = ${dirty.cleared}`);
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
ok(r1.next.satiety === REST_SATIETY, '回家必吃一顿 → 饱食度回满', `satiety = ${r1.next.satiety}`);
ok(r1.next.active === before.active, '结算不改动出战宠物');

/* 关键：写进去了没有？读回来必须和返回值一致 —— 否则"战斗里说 +16、回家没变" */
const reread = loadSave();
ok(JSON.stringify(reread) === JSON.stringify(r1.next), '结算后确实落盘（再读一次一致）',
    JSON.stringify(reread));

/* 撤离 / HP 归零不推进关卡 */
const w1 = settleInto(before, Object.assign({}, FULL, { endReason: 'withdraw' }), 40);
ok(w1.next.cleared === before.cleared, '主动撤离不推进关卡', `cleared = ${w1.next.cleared}`);
const h1 = settleInto(before, Object.assign({}, FULL, { endReason: 'hp0' }), 0);
ok(h1.next.cleared === before.cleared, 'HP 归零不推进关卡（红线②没有游戏结束）');

/* 关卡上限：打十场也只到 8 */
let s = Object.assign({}, DEFAULT_SAVE);
for (let i = 0; i < 10; i++) s = settleInto(s, FULL, 100).next;
ok(s.cleared === 8, '关卡进度封顶在 8', `cleared = ${s.cleared}`);

/* 出战人数必须随结算自己长起来 —— 这是"打赢一场 → 多一只跟班"的完整链路 */
let t = Object.assign({}, DEFAULT_SAVE);
ok(squadSize(t.cleared) === 1, '开局出战 1 只');
t = settleInto(t, FULL, 100).next;
ok(squadSize(t.cleared) === 2, '打赢一场后出战变 2 只', `cleared = ${t.cleared}`);
t = settleInto(t, FULL, 100).next;
t = settleInto(t, FULL, 100).next;
ok(squadSize(t.cleared) === 3, '通关 3 场后满编 3 只', `cleared = ${t.cleared}`);

ok(rolesFor(squadSize(t.cleared)).length === 3, '满编后战斗真的会实例化 3 个角色');

delete globalThis.localStorage;

/* ---------- 汇总 ---------- */
console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
    console.log('\n失败项：');
    for (const f of fails) console.log('  · ' + f);
    process.exit(1);
}
console.log('全部通过。');
