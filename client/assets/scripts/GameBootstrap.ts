import { _decorator, Component, Node, input, Input, EventKeyboard, KeyCode } from 'cc';
import { BattleDirector } from './battle/BattleDirector';
import { BossController } from './battle/BossController';
import { EncounterManager } from './battle/EncounterManager';
import { EnemyManager } from './battle/EnemyManager';
import { HeroSquad } from './battle/HeroSquad';
import { OrbManager } from './battle/OrbManager';
import { PlayerController } from './battle/PlayerController';
import { ProjectileManager } from './battle/ProjectileManager';
import { BOSS, FIELD } from './config/BattleConfig';
import { clamp } from './core/MathUtil';
import { SpriteAssets } from './view/SpriteAssets';
import { BackgroundRenderer } from './view/BackgroundRenderer';
import { EntityRenderer } from './view/EntityRenderer';
import { BattleHud } from './ui/BattleHud';
import { SettlementPanel } from './ui/SettlementPanel';

const { ccclass } = _decorator;

/** BOSS 登场时与玩家的最小距离（别贴脸刷出来，那是"不公平"而不是"难"） */
const BOSS_MIN_SPAWN_DIST = 300;

/**
 * ★ 入口组件（本 demo 唯一需要挂到场景节点的脚本）★
 * 用法：新建空场景 → 建一个空节点 → 挂本组件 → 运行。
 * 世界全部由代码搭建（相机/主角/英雄小队/敌人/BOSS/渲染器/HUD），不依赖任何编辑器内
 * 手动摆放，方便整包迁移与参数复现。
 *
 * 一局流程（CR-014）：
 *   走过去踩怪窝 → 清空全部 4 窝 → BOSS 在最后一窝登场 → 击杀通关
 *   任何时刻：E 主动撤离 / HP 归零撤退 —— 都不算失败（红线②）。
 *
 * 挂载顺序即绘制顺序：实体树（背景 → 实体场 → 英雄 → 主角）→ 相机树（HUD/结算在最上）。
 */
@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
    private _sprites = new SpriteAssets();

    private _player: PlayerController | null = null;
    private _director: BattleDirector | null = null;
    private _heroes: HeroSquad | null = null;
    private _enemies: EnemyManager | null = null;
    private _encounters: EncounterManager | null = null;
    private _boss: BossController | null = null;
    private _projectiles: ProjectileManager | null = null;
    private _orbs: OrbManager | null = null;
    private _bg: BackgroundRenderer | null = null;
    private _entityRenderer: EntityRenderer | null = null;
    private _hud: BattleHud | null = null;
    private _panel: SettlementPanel | null = null;
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

        const heroes = new HeroSquad(root, player, enemies, projectiles, this._sprites.pet);
        const encounters = new EncounterManager(enemies, player);
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
            // 击杀弹经验珠：30% 概率双珠（战利品，不是局内升级）
            orbs.spawn(e.x, e.y, Math.random() < 0.3 ? 2 : 1);
        };
        orbs.onCollect = (n) => director.addOrbs(n);

        // 清完所有窝 → 进入 BOSS 阶段
        encounters.onAllCleared = () => director.notifyAllCleared();
        director.onBossPhase = () => {
            const spot = encounters.lastCleared || { x: 0, y: 0 };
            let bx = spot.x;
            let by = spot.y;
            const dx = bx - player.x;
            const dy = by - player.y;
            const d = Math.hypot(dx, dy);
            // 最后一窝往往就在玩家脚下 —— 往外推一段再登场，给玩家拉开距离的机会
            if (d < BOSS_MIN_SPAWN_DIST) {
                if (d < 1) {
                    bx = player.x + BOSS_MIN_SPAWN_DIST;
                    by = player.y;
                } else {
                    bx = player.x + (dx / d) * BOSS_MIN_SPAWN_DIST;
                    by = player.y + (dy / d) * BOSS_MIN_SPAWN_DIST;
                }
            }
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

        // 7) 输入
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);

        this._director = director;
        this._heroes = heroes;
        this._enemies = enemies;
        this._encounters = encounters;
        this._boss = boss;
        this._projectiles = projectiles;
        this._orbs = orbs;
        this._bg = bg;
        this._entityRenderer = entityRenderer;
        this._hud = hud;
        this._panel = panel;
        this._ready = true;

        console.log('[GameBootstrap] 世界构建完成 · 占位精灵 ' +
            (this._sprites.allMissing ? '全部缺失（程序化兜底层）' : '已加载') +
            ' · 3 英雄列队 · 目标：清完 4 窝 + 击杀 BOSS · 操作：WASD/方向键移动 · E 撤离');
    }

    update(dt: number): void {
        if (!this._ready) {
            return;
        }
        const director = this._director as BattleDirector;
        director.update(dt);
        if (director.phase === 'settlement') {
            return;
        }

        const player = this._player as PlayerController;
        const encounters = this._encounters as EncounterManager;

        // 顺序有讲究：主角先动 → 队形与敌人 AI 才能拿到本帧位置
        player.update(dt);
        (this._heroes as HeroSquad).update(dt);
        encounters.update(dt);
        (this._enemies as EnemyManager).update(dt);
        (this._boss as BossController).update(dt);
        (this._projectiles as ProjectileManager).update(dt);
        (this._orbs as OrbManager).update(dt);

        director.syncProgress(encounters.clearedCount, encounters.total);
    }

    lateUpdate(dt: number): void {
        if (!this._ready) {
            return;
        }
        const player = this._player as PlayerController;
        const director = this._director as BattleDirector;
        const encounters = this._encounters as EncounterManager;
        const boss = this._boss as BossController;

        // 相机跟随放在实体移动之后
        player.lateUpdate(dt);

        if (director.phase !== 'settlement') {
            const renderer = this._entityRenderer as EntityRenderer;
            renderer.tick(dt);
            renderer.redraw(
                (this._heroes as HeroSquad).list,
                (this._enemies as EnemyManager).list,
                encounters.list,
                (this._projectiles as ProjectileManager).list,
                (this._orbs as OrbManager).list,
                // 用 active 而不是 alive：alive 在死亡瞬间就变 false，
                // 那样 0.8s 的缩小消失动画会被直接跳过（BOSS 凭空消失）
                boss.boss.active ? boss.boss : null,
            );
            const hint = director.phase === 'boss'
                ? 'BOSS 出现！躲开红圈 · E 撤离'
                : 'WASD 移动 · 走进怪窝清剿 · E 撤离';
            (this._hud as BattleHud).update(
                dt, director, player.hp,
                encounters.clearedCount, encounters.total,
                boss.alive ? boss : null,
                hint,
            );
        } else {
            (this._hud as BattleHud).update(dt, director, player.hp, encounters.clearedCount, encounters.total, null, '');
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

        if (player.applyKey(e.keyCode, true)) {
            return;
        }

        switch (e.keyCode) {
            case KeyCode.KEY_E:
            case KeyCode.ESC:
                director.withdraw();
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

    private restartBattle(): void {
        (this._director as BattleDirector).restart();
        (this._player as PlayerController).reset();
        (this._enemies as EnemyManager).clear();
        (this._projectiles as ProjectileManager).clear();
        (this._orbs as OrbManager).clear();
        (this._encounters as EncounterManager).reset();
        (this._boss as BossController).hide();
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
