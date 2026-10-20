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
    /**
     * 「半饿最强」倍率（CR-015：已真正接线）。
     * 这里是**初始值**，运行时由 `HeroSquad` 按饱食度档位逐帧赋给每只英雄的 `powerMul`；
     * 升级项「暴食体质」会在此基础上再乘一次。
     */
    powerMultiplier: 1,
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

/** 波次怪潮（CR-015：主干回到「割草 + 宠物状态」，替换 CR-008/CR-014 的清窝推进）
 *
 *  ⚠️ **这是甲方案的心脏**。清窝（CR-008/014）把一局压到 57 秒、每窝 5.2 秒，
 *  慢热型系统（饱食度衰减、升级、喂食决策）在其中没有任何展开空间。
 *  波次怪潮给出 8 分钟的连续压力，这些系统才活得下来。
 *
 *  节奏：波次间隔 3s 喘息 → 本波敌人从玩家周围 spawnRadius 外环生成 → 清空后进入下一波。
 *  第 20 波为 BOSS 波（BOSS + 一波护卫）。
 */
export const WAVE = {
    total: 20,
    firstDelay: 1.6,      // 开局给玩家认路的时间 △
    interval: 3.0,        // 波间喘息（捡珠/喂食的窗口）△
    spawnRadius: 600,     // 生成半径：略大于视野半对角（540/2×√2≈382），保证在屏幕外 △
    spawnJitter: 90,      // 半径抖动，避免"一圈同心圆"的机械感 △
    baseCount: 6,         // 第 1 波数量
    countPerWave: 1.1,    // 每波递增（第 19 波 ≈ 26 只）
    maxAlive: 32,         // 同屏上限（性能预算；超出则本波排队，敌人死了再补）△
    bossWave: 20,         // 第 20 波 = BOSS 波
} as const;

/**
 * 饱食度与喂食（CR-015 / 原 CR-010 数值口径，进战斗后重新标定）
 *
 * ★ 本作的**唯一创新点**：宠物不是子弹，是有状态的活物。
 *   档位倍率让「饿着打」成为一种主动的战术选择，而不是被系统惩罚。
 *
 * ⚠️ 衰减速度比计划书 §2.7 的 0.12/秒 快 4 倍 —— 那个值是按「家园挂机 20 分钟」定的，
 *   在一局 8 分钟的战斗里，0.12 只能掉 58 点，永远掉不到半饿区，整个系统等于不存在。
 *   现在 0.5/秒：满饱 → 全饿 200 秒，一局需要喂 2~3 次，正好是"每 2~3 波喂一次"。
 */
export const SATIETY = {
    max: 100,
    start: 100,
    decayPerSec: 0.5,      // △ 200s 从满到空
    feedAmount: 35,        // 一次喂食回复量（100→需 3 次喂满）
    feedMeatCost: 1,       // 消耗肉块数（食物是打出来的，不是白给的）
    feedStun: 0.4,         // 喂食硬直：主角减速而非定身（定身会粘手）△
    feedStunSpeedMul: 0.35,
    feedCd: 0.8,           // 连喂保护，防手滑连按把肉块烧光 △

    // ---- 档位（CR-010：半饿最强）----
    fullLine: 70,          // ≥70 = 满饱
    hungryLine: 30,        // 30~70 = 半饿；<30 = 全饿
    mulFull: 1.0,
    mulHungry: 1.5,        // ★ 最强的状态是"有点饿"
    mulStarving: 0.6,
} as const;

/** 肉块掉落（食物唯一来源）
 *  ⚠️ 掉落率刻意偏高（一局 302 杀 ≈ 36 块，实际只需 ~5 块）：喂食的代价是
 *  **时机 + 0.4 秒减速**，不是资源稀缺。把资源做成硬约束会重演计划书 §9 引用的
 *  "27 只猫"差评 —— 资源不可控 → 焦虑 → cozy 崩掉。 */
export const MEAT = {
    dropChance: 0.12,      // 每只杂兵掉落概率 △
    bossDrop: 6,           // BOSS 必掉（结算好看）△
    orbSpeed: 0.6,         // 肉块初速 = 经验珠的 0.6 倍（更沉，不会飞太远）△
} as const;

/** 敌人通用 AI 参数（原挂在 NEST 上；清窝系统已被 CR-015 移除，留下这一条给游荡用） */
export const ENEMY_AI = {
    roamRadius: 220,       // 非猎手怪的游荡半径（相对生成锚点）
} as const;

/** 局内等级曲线（甲方案的"变强"节奏，20 波约升到 9~11 级） */
export const LEVEL = {
    baseExp: 12,           // 升到 2 级所需经验 △
    expGrowth: 1.32,       // 每级所需经验倍率 △
    maxLevel: 15,
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

/** 战斗全局
 *  CR-015：一局 = 20 波怪潮（第 20 波 BOSS），约 8~10 分钟。
 *  结束条件：打完第 20 波（通关）、HP 归零（体力不支撤退）、或玩家主动撤离（红线②：无失败惩罚）。
 *  `durationMs` 只用于 HUD 参考，不是硬倒计时。 */
export const BATTLE = {
    durationMs: 480000,  // 8 分钟（20 波 × ~24s）△
    maxAlive: 32,        // 同屏敌人上限（性能预算，与 WAVE.maxAlive 必须一致）△
} as const;

/**
 * 表现层特效（CR-016）—— **零美术**，全部程序化绘制。
 *
 * 为什么这批优先做：像素风下"打击感"几乎全靠信息反馈，而不是画质。
 * 三个最便宜的手段（顿帧 / 碎屑 / 飘字）加起来不到 300 行，收益比加新玩法大得多。
 *
 * DrawCall 预算：整层共用一个 Graphics = **+1 DC**（不是每个粒子一个 DC）。
 */
export const FX = {
    maxParticles: 200,     // 同屏碎屑上限（超出后新粒子被丢弃，不排队）
    maxTexts: 12,          // 同屏飘字上限（满屏数字会把前摇圈糊掉）
    maxRings: 8,           // 同屏扩散圈上限

    /**
     * 伤害数字开关：
     *  - `'off'` 完全不显示
     *  - `'kill'`（默认）**只显示击杀最后一击、暴击、以及对 BOSS 的伤害**
     *  - `'all'`  每次命中都显示
     *
     * 默认不选 `'all'`：本作同屏 3 英雄齐射 + 32 只怪，`'all'` 会变成"数字墙"，
     * 反而盖住真正要读的信息（前摇圈、AOE 圈）。这是刻意的取舍，不是没做完。
     */
    damageText: 'kill' as 'off' | 'kill' | 'all',

    /** 顿帧：命中/受击时把逻辑时间压到几乎静止，几十毫秒后再放开 */
    hitStop: {
        kill: 0.045,       // 普通击杀
        bossHit: 0.018,    // BOSS 挨打（每次，但很短）
        bossDie: 0.42,     // BOSS 死亡：最长的一次，让"赢了"有分量
        playerHit: 0.075,  // 玩家受伤
        timeScale: 0.06,   // 顿帧期间逻辑时间倍率（不清零：留一点位移，否则像卡死）
    },

    /** 屏幕震动：像素单位，指数衰减 */
    shake: {
        playerHit: 7,
        feed: 2.5,         // 喂食：轻微一下，表示"喂到了"，但不能被误读成挨打
        bossHit: 2.2,      // 只给 BOSS 暴击用
        bossDie: 12,
        decay: 11,         // 每秒衰减系数（越大恢复越快）
        min: 0.15,         // 低于此值直接归零，避免永不停止的微抖
    },
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
