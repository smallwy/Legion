import { _decorator, Component, Node, input, Input, EventKeyboard, KeyCode } from 'cc';
import { BattleDirector } from './battle/BattleDirector';
import { BossController } from './battle/BossController';
import { EnemyManager } from './battle/EnemyManager';
import { HeroSquad } from './battle/HeroSquad';
import { OrbManager } from './battle/OrbManager';
import { PlayerController } from './battle/PlayerController';
import { ProjectileManager } from './battle/ProjectileManager';
import { UpgradeSystem, expProgress } from './battle/UpgradeSystem';
import { WaveManager } from './battle/WaveManager';
import { BOSS, FIELD, PLAYER, SATIETY } from './config/BattleConfig';
import { clamp } from './core/MathUtil';
import { SpriteAssets } from './view/SpriteAssets';
import { BackgroundRenderer } from './view/BackgroundRenderer';
import { EntityRenderer } from './view/EntityRenderer';
import { BattleHud } from './ui/BattleHud';
import { SettlementPanel } from './ui/SettlementPanel';
import { UpgradePanel } from './ui/UpgradePanel';

const { ccclass } = _decorator;

/** BOSS 登场时与玩家的最小距离（别贴脸刷出来，那是"不公平"而不是"难"） */
const BOSS_MIN_SPAWN_DIST = 300;

/**
 * ★ 入口组件（本 demo 唯一需要挂到场景节点的脚本）★
 * 用法：新建空场景 → 建一个空节点 → 挂本组件 → 运行。
 * 世界全部由代码搭建（相机/主角/英雄小队/敌人/BOSS/渲染器/HUD），不依赖任何编辑器内
 * 手动摆放，方便整包迁移与参数复现。
 *
 * 一局流程（CR-015：甲方案「割草 + 宠物状态」）：
 *   20 波怪潮（第 19 波清完 BOSS 登场，即第 20 波）→ 击杀通关
 *   途中：捡经验升级三选一 / 按 F 喂食（半饿时火力最强）/ E 主动撤离
 *   HP 归零 = 体力不支撤退，照样结算（红线②：无失败惩罚）
 *
 * 挂载顺序即绘制顺序：实体树（背景 → 实体场 → 英雄 → 主角）→ 相机树（HUD/面板在最上）。
 */
@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
    private _sprites = new SpriteAssets();

    private _player: PlayerController | null = null;
    private _director: BattleDirector | null = null;
    private _heroes: HeroSquad | null = null;
    private _enemies: EnemyManager | null = null;
    private _waves: WaveManager | null = null;
    private _upgrades: UpgradeSystem | null = null;
    private _boss: BossController | null = null;
    private _projectiles: ProjectileManager | null = null;
    private _orbs: OrbManager | null = null;
    private _bg: BackgroundRenderer | null = null;
    private _entityRenderer: EntityRenderer | null = null;
    private _hud: BattleHud | null = null;
    private _panel: SettlementPanel | null = null;
    private _upgradePanel: UpgradePanel | null = null;
    private _ready = false;

    onLoad(): void {
        // 实体树整体挂在这里；相机树单独挂，排在实体树之后，保证 HUD/结算画在最上层
        // （3.x 绘制序 = children 遍历序，已核对 Batcher2D 源码）
        const field = new Node('Field');
        this.node.addChild(field);

        // ★ 实体容器：所有会**动态增减**的实体（主角/英雄/敌人/BOSS）都挂这里。
        //   敌人节点是对象池懒创建的（第一次 spawn 才 addChild），如果直接挂 field，
        //   它们会排在后面创建的 EntityRenderer 之后 —— 于是 AOE 圈、受击白闪、
        //   前摇圈这层"特效"全被实体贴图盖住，等于白做。
        //   挂进一个固定的容器，容器与特效层的相对顺序就永久稳定。
        const actors = new Node('Actors');
        field.addChild(actors);

        // 1) 相机 + 主角
        this._player = new PlayerController(actors, this.node);

        // 2) 异步加载占位精灵，回来后建世界（保证实体知道有没有贴图可走）
        this._sprites.load(() => this.buildWorld(field, actors));
    }

    private buildWorld(field: Node, actors: Node): void {
        // 所有动态实体一律挂在 actors 容器下
        const root = actors;
        const player = this._player as PlayerController;

        // 3) 管理器（互相引用的字段构造后接线，避免循环 import）
        const enemies = new EnemyManager(root, player, {
            walker: this._sprites.walker,
            flyer: this._sprites.flyer,
            tank: this._sprites.tank,
        });
        const projectiles = new ProjectileManager(player);
        projectiles.enemies = enemies;
        enemies.projectiles = projectiles;

        const upgrades = new UpgradeSystem();
        const heroes = new HeroSquad(root, player, enemies, projectiles, this._sprites.pet);
        heroes.upgrades = upgrades;

        const waves = new WaveManager(enemies, player);
        // BOSS 复用甲虫贴图放大 4 倍（128px）；换正式美术时只改 BOSS.displaySize 与贴图
        const boss = new BossController(root, player, this._sprites.tank);
        projectiles.boss = boss;
        // ★ 必须接：BOSS 不在 EnemyManager 里，英雄靠这条线才会对它开火
        heroes.boss = boss;

        const orbs = new OrbManager(player);
        const director = new BattleDirector(player);

        // 4) 事件接线
        enemies.onKill = (e) => {
            director.addKill();
            // 击杀弹经验珠：30% 概率双珠
            orbs.spawn(e.x, e.y, Math.random() < 0.3 ? 2 : 1);
            // 肉块 = 喂食资源，是本作唯一的"资源约束"
            orbs.rollMeat(e.x, e.y);
            // 「啃噬」：击杀回体力（唯一回血手段，红线②下不给主动治疗）
            if (upgrades.stats.leech > 0 && Math.random() < upgrades.stats.leech && player.hp < PLAYER.hp) {
                player.hp++;
            }
        };
        orbs.onCollect = (exp, meat) => {
            if (exp > 0) {
                director.addOrbs(exp);
                if (upgrades.addExp(exp)) {
                    this.openUpgrade();
                }
            }
            if (meat > 0) {
                director.addMeat(meat);
            }
        };

        // 第 19 波清完 → 进入 BOSS 阶段（BOSS 即第 20 波）
        waves.onPreBossWave = () => director.notifyPreBossWave();
        director.onBossPhase = () => {
            // 从离玩家最近的场地边缘方向登场，保证 BOSS_MIN_SPAWN_DIST
            const ang = Math.random() * Math.PI * 2;
            let bx = player.x + Math.cos(ang) * BOSS_MIN_SPAWN_DIST;
            let by = player.y + Math.sin(ang) * BOSS_MIN_SPAWN_DIST;
            bx = clamp(bx, -FIELD.width / 2 + BOSS.radius, FIELD.width / 2 - BOSS.radius);
            by = clamp(by, -FIELD.height / 2 + BOSS.radius, FIELD.height / 2 - BOSS.radius);
            boss.spawn(bx, by);
        };

        boss.onDefeated = () => director.notifyBossDefeated();
        director.onSettle = (stats) => {
            if (this._panel) this._panel.show(stats);
        };

        // 5) 渲染器（都挂 field，形成「背景 → 实体容器 → 特效层」三层）
        const bg = new BackgroundRenderer(field);
        bg.render();
        const entityRenderer = new EntityRenderer(field);

        // 6) UI（挂相机节点下 = 屏幕固定；相机树已在实体树之后，无需再调 sibling）
        const hud = new BattleHud(player.cameraNode);
        const panel = new SettlementPanel(player.cameraNode);
        const upgradePanel = new UpgradePanel(player.cameraNode);
        upgradePanel.onPick = (id) => {
            upgrades.choose(id);
            upgradePanel.hide();
            // 连升两级：继续弹下一张（不恢复世界）
            if (upgrades.pendingLevelUps > 0) {
                const next = upgrades.rollChoices();
                if (next.length > 0) {
                    upgradePanel.show(next, upgrades);
                    return;
                }
                upgrades.pendingLevelUps = 0;
            }
            if (director.phase !== 'settlement') {
                director.paused = false;
            }
        };

        // 7) 输入
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);

        this._director = director;
        this._heroes = heroes;
        this._enemies = enemies;
        this._waves = waves;
        this._upgrades = upgrades;
        this._boss = boss;
        this._projectiles = projectiles;
        this._orbs = orbs;
        this._bg = bg;
        this._entityRenderer = entityRenderer;
        this._hud = hud;
        this._panel = panel;
        this._upgradePanel = upgradePanel;
        this._ready = true;

        console.log('[GameBootstrap] 世界构建完成 · 占位精灵 ' +
            (this._sprites.allMissing ? '全部缺失（程序化兜底层）' : '已加载') +
            ' · 3 英雄列队 · 20 波怪潮 + BOSS · 操作：WASD 移动 / F 喂食 / E 撤离');
    }

    update(dt: number): void {
        if (!this._ready) {
            return;
        }
        const director = this._director as BattleDirector;
        director.update(dt);
        // 结算 or 升级选卡：冻结世界（选卡时怪不该继续打你）
        if (director.phase === 'settlement' || director.paused) {
            return;
        }

        const player = this._player as PlayerController;
        const waves = this._waves as WaveManager;
        const heroes = this._heroes as HeroSquad;
        const upgrades = this._upgrades as UpgradeSystem;

        // 顺序有讲究：主角先动 → 队形与敌人 AI 才能拿到本帧位置
        player.update(dt);
        heroes.update(dt);
        waves.update(dt);
        (this._enemies as EnemyManager).update(dt);
        (this._boss as BossController).update(dt);
        (this._projectiles as ProjectileManager).update(dt);
        (this._orbs as OrbManager).update(dt);

        director.syncProgress(waves.wave, waves.total);
        director.syncMeta(upgrades.level, heroes.feeds);
    }

    lateUpdate(dt: number): void {
        if (!this._ready) {
            return;
        }
        const player = this._player as PlayerController;
        const director = this._director as BattleDirector;
        const waves = this._waves as WaveManager;
        const heroes = this._heroes as HeroSquad;
        const upgrades = this._upgrades as UpgradeSystem;
        const boss = this._boss as BossController;

        // 相机跟随放在实体移动之后
        player.lateUpdate(dt);

        if (director.phase !== 'settlement') {
            const renderer = this._entityRenderer as EntityRenderer;
            renderer.tick(dt);
            renderer.redraw(
                heroes.list,
                (this._enemies as EnemyManager).list,
                (this._projectiles as ProjectileManager).list,
                (this._orbs as OrbManager).list,
                // 用 active 而不是 alive：alive 在死亡瞬间就变 false，
                // 那样 0.8s 的缩小消失动画会被直接跳过（BOSS 凭空消失）
                boss.boss.active ? boss.boss : null,
            );

            const hunt = waves.spawning;
            const hint = director.phase === 'boss'
                ? 'BOSS 出现！躲开红圈 · E 撤离'
                : (hunt ? '这一波正在涌来 · 拉开距离' : 'F 喂食（半饿火力 ×1.5）· E 撤离');

            (this._hud as BattleHud).update(dt, director, {
                hp: player.hp,
                level: upgrades.level,
                exp: expProgress(upgrades),
                satiety: heroes.satiety,
                tier: heroes.tier,
                meat: director.stats.meat,
                canFeed: heroes.canFeed(director.stats.meat),
                boss: boss.alive ? boss : null,
                hint,
            });
            (this._upgradePanel as UpgradePanel).layout();
        } else {
            (this._hud as BattleHud).update(dt, director, {
                hp: player.hp,
                level: upgrades.level,
                exp: expProgress(upgrades),
                satiety: heroes.satiety,
                tier: heroes.tier,
                meat: director.stats.meat,
                canFeed: false,
                boss: null,
                hint: '',
            });
            (this._panel as SettlementPanel).layout();
        }
    }

    // ---------------- 输入 ----------------

    private onKeyDown(e: EventKeyboard): void {
        if (!this._ready) {
            return;
        }
        const player = this._player as PlayerController;
        const director = this._director as BattleDirector;
        const upPanel = this._upgradePanel as UpgradePanel;

        // 选卡期间只认数字键，其他输入一律吞掉（防止一边选卡一边跑位）
        if (upPanel.shown) {
            switch (e.keyCode) {
                case KeyCode.DIGIT_1: upPanel.pickByIndex(0); break;
                case KeyCode.DIGIT_2: upPanel.pickByIndex(1); break;
                case KeyCode.DIGIT_3: upPanel.pickByIndex(2); break;
                default: break;
            }
            return;
        }

        if (player.applyKey(e.keyCode, true)) {
            return;
        }

        switch (e.keyCode) {
            case KeyCode.KEY_E:
            case KeyCode.ESC:
                director.withdraw();
                break;
            case KeyCode.KEY_F:
                this.tryFeed();
                break;
            case KeyCode.SPACE:
                if (director.phase === 'settlement') {
                    this.restartBattle();
                }
                break;
            default:
                break;
        }
    }

    private onKeyUp(e: EventKeyboard): void {
        if (!this._ready) {
            return;
        }
        (this._player as PlayerController).applyKey(e.keyCode, false);
    }

    private onMouseDown(): void {
        if (!this._ready) {
            return;
        }
        const director = this._director as BattleDirector;
        if (director.phase === 'settlement') {
            this.restartBattle();
        }
    }

    // ---------------- 玩法动作 ----------------

    /** F：喂食（消耗 1 肉块 + 0.4 秒减速，把"喂它"变成有代价的动作） */
    private tryFeed(): void {
        const director = this._director as BattleDirector;
        if (director.phase === 'settlement') {
            return;
        }
        const heroes = this._heroes as HeroSquad;
        // 先问能不能喂（内部会检查冷却/满饱/肉块），成功了才扣
        if (!heroes.feed(director.stats.meat)) {
            return;
        }
        director.spendMeat(SATIETY.feedMeatCost);
    }

    private openUpgrade(): void {
        const director = this._director as BattleDirector;
        const upgrades = this._upgrades as UpgradeSystem;
        const upPanel = this._upgradePanel as UpgradePanel;
        if (director.phase === 'settlement' || upPanel.shown) {
            return;
        }
        const choices = upgrades.rollChoices();
        if (choices.length === 0) {
            upgrades.pendingLevelUps = 0;
            return;
        }
        director.paused = true;
        upPanel.show(choices, upgrades);
    }

    private restartBattle(): void {
        (this._director as BattleDirector).restart();
        (this._player as PlayerController).reset();
        (this._enemies as EnemyManager).clear();
        (this._projectiles as ProjectileManager).clear();
        (this._orbs as OrbManager).clear();
        (this._waves as WaveManager).reset();
        (this._upgrades as UpgradeSystem).reset();
        (this._boss as BossController).hide();
        (this._upgradePanel as UpgradePanel).hide();
        // 放在 player.reset() 之后：队形锚点要用重置后的主角位置
        (this._heroes as HeroSquad).reset();
        (this._panel as SettlementPanel).hide();
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    }
}
