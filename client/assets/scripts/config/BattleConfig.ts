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

/** 玩家：WASD 只控主角（CR-007）★ HP 6 / 移速 190 */
export const PLAYER = {
    hp: 6,
    speed: 190,
    radius: 12,
    invincibleAfterHit: 0.8,   // △ 受击无敌帧，防止 6 点 HP 被瞬间融化
} as const;

/**
 * 队伍队形槽位（CR-014：**环绕 → 列队跟随**）
 *
 * 局部坐标 `[f, r]`：f = 沿队伍前进方向的距离（负值 = 在主角身后），r = 向右的偏移。
 * 主角固定占 f=0 / r=0（队伍最前方），英雄依次排在身后 —— 这才是「佣兵团」的观感：
 * 你带头往前冲，几个小跟班在身后列队跟着。
 *
 * ⚠️ 槽位数量必须 = HERO.count。
 */
export const HERO_SLOTS: ReadonlyArray<readonly [number, number]> = [
    [-28, -24],   // 左后
    [-28, 24],    // 右后
    [-52, 0],     // 正后（最远，视觉上拉出一条纵列）
];

/** 英雄（原「宠物」）：CR-009 三段施法链路 + CR-014 列队跟随
 *  ★ 前摇 0.25 + 施法 0.1 + 后摇 0.3 = 0.65s/轮 = **1.54 次/秒**（CR-011 定案，原「2.2 次/秒」作废）。 */
export const HERO = {
    count: 3,              // 队伍人数（不含主角）；改这里必须同步 HERO_SLOTS
    // 跟随参数按「跟得上但不僵硬」调：稳态落后距离 ≈ 移速 × damping / stiffness
    // = 190 × 24 / 220 ≈ 21px（不到半个身位）。调硬会像贴在身上，调软队形会被甩散。
    followStiffness: 220,  // 弹性跟随刚度
    followDamping: 24,     // 弹性跟随阻尼（ζ ≈ 0.81，轻微过冲但收敛快）
    turnRate: 8,           // 队形朝向角速度 rad/s（限速，防止瞬转抽帧）
    turnDeadzone: 12,      // 移速低于此值不更新朝向（防静止时抖动）
    acquireRange: 340,     // 自动索敌半径 △
    damage: 10,            // ★ 基础火力 10 dmg/次
    telegraph: 0.25,       // ★ 前摇
    cast: 0.1,             // ★ 施法
    recovery: 0.3,         // ★ 后摇
    displaySize: 64,       // 显示宽度 = 贴图 32px × 2（★ 像素风必须整数倍）
    powerMultiplier: 1,    // 「半饿最强」挂钩点（半饿 1.5 / 满饱 1.0 / 全饿 0.6）
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

/** 首版 3 种敌人（美术指引 §5.6：步行虫/飞虫/甲虫，换色复用）
 *  ⚠️ 像素风铁律（美术指引 §1）：displaySize 必须是工作分辨率的整数倍，否则
 *  非整数缩放 + 线性采样会糊掉颗粒感。当前占位贴图 32/32/32/32px，全部 ×2 → 64。
 *  ⚠️ 体型差异靠造型表达（甲壳更宽 / 翅膀更开），不要用非整数 displaySize 硬拉。 */
export const ENEMIES: { [k in EnemyType]: EnemyDef } = {
    walker: { hp: 20, speed: 70, radius: 15, displaySize: 64, aggroRange: 300, attackRange: 60, castRange: 0, windup: 0.3, attackCd: 1.0, damage: 1, projectileSpeed: 0, color: 0x6B8E23, weight: 0.6 },
    flyer: { hp: 12, speed: 120, radius: 12, displaySize: 64, aggroRange: 320, attackRange: 0, castRange: 140, windup: 0.8, attackCd: 2.2, damage: 1, projectileSpeed: 260, color: 0xC0392B, weight: 0.25 },
    tank: { hp: 60, speed: 38, radius: 21, displaySize: 64, aggroRange: 260, attackRange: 60, castRange: 0, windup: 0.45, attackCd: 1.4, damage: 1, projectileSpeed: 0, color: 0x34495E, weight: 0.15 },
};

/** 怪窝（CR-008：玩家抵达地点后成批生成，非追踪刷新）★ 10 只/窝
 *  CR-014：**清完即永久 cleared，不再冷却重刷** —— 一局目标是「把窝清完 → 打 BOSS」，
 *  不是「在刷怪场里活满 N 分钟」。原来那句 `respawnDelay: 18` 已删除。 */
export const NEST = {
    count: 4,
    positions: [[620, 340], [-700, 300], [220, -520], [-760, -360]] as number[][],
    triggerRange: 240,   // 玩家进圈才激活
    batch: 10,           // ★ 每窝一批
    spawnInterval: 0.12, // 一批内的生成间隔 △
    settleDelay: 0.6,    // 最后一只死亡到判定"清空"的缓冲（等死亡动画播完）△
    roamRadius: 220,     // 怪物活动范围（不必然追玩家）
} as const;

/** 最终 BOSS（CR-014 新增）：全部怪窝清空后，在**最后清空的那一窝**召唤。
 *  AOE 是它的主要威胁 —— 必须给足读条窗口，玩家靠走位离开红圈。
 *  displaySize = 32px 贴图 × 4（像素风整数倍铁律） */
export const BOSS = {
    name: '腐甲巨虫',
    hp: 620,
    speed: 54,
    radius: 40,
    displaySize: 128,      // 32 × 4
    aoeRadius: 155,
    aoeWindup: 1.2,        // 读条窗口：1.2s 足够从圈心走到圈外
    aoeCd: 4.2,            // 两次 AOE 的间隔
    aoeDamage: 2,
    touchRange: 88,        // 贴身推挤
    touchDamage: 1,
    touchCd: 1.6,
    triggerDelay: 0.8,     // 登场停顿（给玩家反应与拉开距离）
    deathTime: 0.8,        // 死亡缩小消失时长
} as const;

/** 弹道 */
export const PROJECTILE = {
    petSpeed: 420,
    petRadius: 5,
    petLife: 1.2,
    enemyRadius: 7,
    enemyLife: 3,
} as const;

/** 经验珠（战利品） */
export const ORB = {
    magnetRange: 140,
    collectRange: 22,
    maxSpeed: 620,
} as const;

/** 战斗节奏 ★ 远征参考时长 3 分钟
 *  CR-014：**不再是硬结束条件**。结束条件改为：清完所有窝 + 击杀 BOSS（通关）、
 *  HP 归零（撤退）、或玩家主动撤离（红线②：无失败惩罚）。此值只用于 HUD 显示。 */
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
