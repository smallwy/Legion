/**
 * 吧唧军团 / Munch Legion · Day 1 原型数值配置
 * ------------------------------------------------------------------
 * 所有可调数值集中在本文件，对应《立项计划书_PAWPACK_v1.0》§2.7 数值骨架。
 * 标记约定：
 *   ★ = 计划书明确规定
 *   △ = 计划书未规定、按 Day 1 试玩定的值（验证后需回写 §2.7）
 * 调参只改这个文件，改完重启预览即可生效，无需动其他脚本。
 */

/** 战场尺寸（世界单位，1 单位 ≈ 1px @ zoom 1）△ */
export const FIELD = {
    width: 2400,
    height: 1350,
} as const;

/** 相机：正交投影。视野高 540（≈设计分辨率 960×540），固定 zoom（§5.5 禁抖动/漂移） */
export const CAMERA = {
    viewHeight: 540,
    camZ: 1000,        // 相机架在高处朝 -z 看；所有玩法节点在 z=0~100，均在 near/far 之内
    near: 1,
    far: 3000,
    followLerp: 8,     // 跟随平滑系数（越大越跟手；指数平滑，帧率无关）
} as const;

/** 玩家：WASD 只控中心点（CR-007）★ HP 6 / 移速 190 */
export const PLAYER = {
    hp: 6,
    speed: 190,
    radius: 12,
    invincibleAfterHit: 0.8,   // △ 受击无敌帧，防止 6 点 HP 被瞬间融化
} as const;

/** 宠物自动施法（CR-009 三段链路）★ 前摇 0.25 + 施法 0.1 + 后摇 0.3
 *  ⚠️ 已知矛盾：§2.7 同时声称"总攻速 2.2 次/秒（≈0.65s/轮）"，
 *  但 0.65s/轮实际只有 1.54 次/秒。此处按 CR-009 的三段时长实现；
 *  若要精确 2.2 次/秒，把 recovery 改为 0.1（总 0.45s/轮）。待拍板后回写计划书。 */
export const PET = {
    count: 1,            // Day 1 排期 = 1 只；Day 2 改 3（系统已支持 N 只，不用改代码）
    orbitDist: 48,       // 环绕半径（Day1 验收：稳定在 45-50px）
    orbitSpeed: 0.8,     // 环绕角速度 rad/s
    springStiffness: 90, // 弹性跟随刚度
    springDamping: 12,   // 弹性跟随阻尼
    acquireRange: 340,   // 自动索敌半径 △
    damage: 10,          // ★ 宠物基础火力 10 dmg/次
    telegraph: 0.25,     // ★ 前摇
    cast: 0.1,           // ★ 施法
    recovery: 0.3,       // ★ 后摇
    displaySize: 48,     // 显示宽度 △
    powerMultiplier: 1,  // Day 2「半饿最强」挂钩点（半饿 1.5 / 满饱 1.0 / 全饿 0.6）
} as const;

export type EnemyType = 'walker' | 'flyer' | 'tank';

export interface EnemyDef {
    hp: number;
    speed: number;
    radius: number;         // 碰撞/分离半径
    displaySize: number;    // 精灵显示宽度
    aggroRange: number;     // 玩家进入此范围才追/逼近（CR-008：不必然追玩家）
    attackRange: number;    // ★ 攻击半径 60px（0 = 无近战）
    castRange: number;      // ★ 施法半径 140px（0 = 无施法）
    windup: number;         // 攻击/施法前摇（给反应窗口）
    attackCd: number;       // 攻击/施法间隔
    damage: number;         // 对玩家伤害（玩家 HP 6）
    projectileSpeed: number;// 0 = 近战
    color: number;          // 程序化兜底层配色（美术指引 §5.6 锁定色）
    weight: number;         // 生成权重
}

/** 首版 3 种敌人（美术指引 §5.6：步行虫/飞虫/甲虫，换色复用） */
export const ENEMIES: { [k in EnemyType]: EnemyDef } = {
    walker: { hp: 20, speed: 70, radius: 15, displaySize: 46, aggroRange: 300, attackRange: 60, castRange: 0, windup: 0.3, attackCd: 1.0, damage: 1, projectileSpeed: 0, color: 0x6B8E23, weight: 0.6 },
    flyer: { hp: 12, speed: 120, radius: 12, displaySize: 40, aggroRange: 320, attackRange: 0, castRange: 140, windup: 0.8, attackCd: 2.2, damage: 1, projectileSpeed: 260, color: 0xC0392B, weight: 0.25 },
    tank: { hp: 60, speed: 38, radius: 21, displaySize: 56, aggroRange: 260, attackRange: 60, castRange: 0, windup: 0.45, attackCd: 1.4, damage: 1, projectileSpeed: 0, color: 0x34495E, weight: 0.15 },
};

/** 怪窝（CR-008：玩家抵达地点后成批生成，非追踪刷新）★ 12 只/窝 */
export const NEST = {
    count: 4,
    positions: [[620, 340], [-700, 300], [220, -520], [-760, -360]] as number[][],
    triggerRange: 240,   // 玩家进圈才激活
    batch: 12,           // ★ 每窝一批
    spawnInterval: 0.1,  // 一批内的生成间隔 △
    respawnDelay: 18,    // 清空后重新刷新的冷却 △（0 = 不刷新）
    roamRadius: 220,     // 怪物活动范围（不必然追玩家）
} as const;

/** 弹道 */
export const PROJECTILE = {
    petSpeed: 420,
    petRadius: 5,
    petLife: 1.2,
    enemyRadius: 7,
    enemyLife: 3,
} as const;

/** 经验珠 */
export const ORB = {
    magnetRange: 140,
    collectRange: 22,
    maxSpeed: 620,
} as const;

/** 战斗节奏 ★ 远征 3 分钟（可主动撤离） */
export const BATTLE = {
    durationMs: 180000,
    maxAlive: 28,        // 同屏敌人上限（性能预算）△
} as const;

/** 美术指引 §2 锁定色（原型期程序化兜底与特效用） */
export const PALETTE = {
    cream: 0xF4E4C1,
    wood: 0x8B5A2B,
    grass: 0x3FA34D,
    gold: 0xFFD700,       // 半饿/蓄力招牌色
    danger: 0xFF5252,     // 全饿/敌方近战前摇
    safe: 0x6BCB77,       // 饱食/经验珠
    excite: 0xFFB454,     // 兴奋/敌方施法前摇/活跃窝
    foxPurple: 0xB47CE0,  // 敌方弹道
    uiDeep: 0x2D2438,
    uiPanel: 0x3E3450,
    uiText: 0xF5F0E6,
} as const;
