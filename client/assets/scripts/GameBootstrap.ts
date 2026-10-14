import { _decorator, Component, Node, input, Input, EventKeyboard, KeyCode } from 'cc';
import { BattleDirector } from './battle/BattleDirector';
import { EnemyManager } from './battle/EnemyManager';
import { MonsterNestManager } from './battle/MonsterNest';
import { OrbManager } from './battle/OrbManager';
import { PetSquad } from './battle/PetSquad';
import { PlayerController } from './battle/PlayerController';
import { ProjectileManager } from './battle/ProjectileManager';
import { SpriteAssets } from './view/SpriteAssets';
import { BackgroundRenderer } from './view/BackgroundRenderer';
import { EntityRenderer } from './view/EntityRenderer';
import { BattleHud } from './ui/BattleHud';
import { SettlementPanel } from './ui/SettlementPanel';

const { ccclass } = _decorator;

/**
 * ★ 入口组件（本 demo 唯一需要挂到场景节点的脚本）★
 * 用法：新建空场景 → 建一个空节点 → 挂本组件 → 运行。
 * 世界全部由代码搭建（相机/玩家/宠物/敌人/渲染器/HUD），不依赖任何编辑器内
 * 手动摆放，方便整包迁移与参数复现。
 *
 * 挂载顺序即绘制顺序：背景 → 实体场 → 宠物 → 玩家 → 相机（HUD/结算在最上）。
 */
@ccclass('GameBootstrap')
export class GameBootstrap extends Component {
    private _sprites = new SpriteAssets();

    private _player: PlayerController | null = null;
    private _director: BattleDirector | null = null;
    private _pets: PetSquad | null = null;
    private _enemies: EnemyManager | null = null;
    private _nests: MonsterNestManager | null = null;
    private _projectiles: ProjectileManager | null = null;
    private _orbs: OrbManager | null = null;
    private _bg: BackgroundRenderer | null = null;
    private _entityRenderer: EntityRenderer | null = null;
    private _hud: BattleHud | null = null;
    private _panel: SettlementPanel | null = null;
    private _ready = false;

    onLoad(): void {
        // 实体树（背景/渲染器/宠物/玩家/敌人全部挂这里）；相机树单独挂，排在实体树之后，
        // 保证 HUD/结算画在最上层（3.x 绘制序 = children 遍历序，已核对 Batcher2D 源码）
        const field = new Node('Field');
        this.node.addChild(field);

        // 1) 相机 + 玩家中心点
        this._player = new PlayerController(field, this.node);

        // 2) 异步加载占位精灵，回来后建世界（保证实体知道有没有贴图可走）
        this._sprites.load(() => this.buildWorld(field));
    }

    private buildWorld(field: Node): void {
        const root = field;
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

        const pets = new PetSquad(root, player, enemies, projectiles, this._sprites.pet);
        const nests = new MonsterNestManager(enemies, player);
        const orbs = new OrbManager(player);
        const director = new BattleDirector(player);

        // 4) 事件接线
        enemies.onKill = (e) => {
            director.addKill();
            // 击杀弹经验珠：30% 概率双珠
            orbs.spawn(e.x, e.y, Math.random() < 0.3 ? 2 : 1);
        };
        orbs.onCollect = (n) => director.addOrbs(n);
        director.onSettle = (stats) => {
            if (this._panel) this._panel.show(stats);
        };

        // 5) 渲染器
        const bg = new BackgroundRenderer(root);
        bg.render();
        const entityRenderer = new EntityRenderer(root);

        // 6) UI（挂相机节点下 = 屏幕固定；相机树已在实体树之后，无需再调 sibling）
        const hud = new BattleHud(player.cameraNode);
        const panel = new SettlementPanel(player.cameraNode);

        // 7) 输入
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);

        this._director = director;
        this._pets = pets;
        this._enemies = enemies;
        this._nests = nests;
        this._projectiles = projectiles;
        this._orbs = orbs;
        this._bg = bg;
        this._entityRenderer = entityRenderer;
        this._hud = hud;
        this._panel = panel;
        this._ready = true;

        console.log('[GameBootstrap] 世界构建完成 · 占位精灵 ' +
            (this._sprites.allMissing ? '全部缺失（程序化兜底层）' : '已加载') +
            ' · 操作：WASD/方向键移动 · E 撤离');
    }

    update(dt: number): void {
        if (!this._ready) return;
        const director = this._director as BattleDirector;
        director.update(dt);
        if (director.phase !== 'battle') return;

        const player = this._player as PlayerController;
        player.update(dt);
        (this._pets as PetSquad).update(dt);
        (this._nests as MonsterNestManager).update(dt);
        (this._enemies as EnemyManager).update(dt);
        (this._projectiles as ProjectileManager).update(dt);
        (this._orbs as OrbManager).update(dt);
    }

    lateUpdate(dt: number): void {
        if (!this._ready) return;
        const player = this._player as PlayerController;
        const director = this._director as BattleDirector;

        // 相机跟随放在实体移动之后
        player.lateUpdate(dt);

        if (director.phase === 'battle') {
            (this._entityRenderer as EntityRenderer).tick(dt);
            (this._entityRenderer as EntityRenderer).redraw(
                (this._pets as PetSquad).list,
                (this._enemies as EnemyManager).list,
                (this._nests as MonsterNestManager).list,
                (this._projectiles as ProjectileManager).list,
                (this._orbs as OrbManager).list,
            );
            (this._hud as BattleHud).update(dt, director, player.hp, 'WASD 移动 · E 提前撤离');
        } else {
            (this._hud as BattleHud).update(dt, director, player.hp, '');
            (this._panel as SettlementPanel).layout();
        }
    }

    // ---------------- 输入 ----------------

    private onKeyDown(e: EventKeyboard): void {
        if (!this._ready) return;
        const player = this._player as PlayerController;
        const director = this._director as BattleDirector;

        if (player.applyKey(e.keyCode, true)) return;

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
        if (!this._ready) return;
        (this._player as PlayerController).applyKey(e.keyCode, false);
    }

    private onMouseDown(): void {
        if (!this._ready) return;
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
        (this._nests as MonsterNestManager).reset();
        (this._pets as PetSquad).reset();
        (this._panel as SettlementPanel).hide();
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
    }
}
