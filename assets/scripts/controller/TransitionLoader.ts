/**
 * TransitionLoader — Lazy-load Transition prefab từ MainBundle.
 *
 * ── MỤC ĐÍCH ──
 *   Transition tách khỏi Base.prefab — chỉ load khi boot shell sẵn sàng.
 *   Instance được chèn ngay SAU GameRoot (sibling index cao hơn → render trên GameRoot).
 *
 * ── FLOW ──
 *   LOADING_COMPLETE → preload nền
 *   LOADING_BAR_100  → ensureLoaded (Guide sắp hiện / skipIntro sắp fire)
 *   GUIDE_COMPLETE   → wire target Pot + fallback trigger nếu load muộn
 */

import { _decorator, Component, Node, Prefab, instantiate, assetManager } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { Log } from '../core/Logger';
import { TransitionController } from './TransitionController';
import { PotController } from './PotController';

const { ccclass, property } = _decorator;

const BUNDLE_NAME = 'MainBundle';
const DEFAULT_PREFAB_PATH = 'Transition';

@ccclass('TransitionLoader')
export class TransitionLoader extends Component {

    @property({
        type: Node,
        tooltip: 'Node cha gắn Transition (thường là Base root). Null = node của loader.',
    })
    shellParent: Node | null = null;

    @property({
        type: Node,
        tooltip: 'GameRoot — dùng tìm Pot target + xác định sibling index.',
    })
    gameRoot: Node | null = null;

    @property({
        tooltip: 'Path Prefab trong MainBundle (không extension).',
    })
    prefabPath: string = DEFAULT_PREFAB_PATH;

    private _instance: Node | null = null;
    private _controller: TransitionController | null = null;
    private _loading: Promise<TransitionController | null> | null = null;
    private _cachedPrefab: Prefab | null = null;

    /** Gọi từ GameEntryController sau khi wire gameRoot. */
    init(shellParent: Node, gameRoot: Node | null): void {
        this.shellParent = shellParent;
        this.gameRoot = gameRoot;
    }

    onLoad(): void {
        EventBus.instance.on(GameEvents.LOADING_COMPLETE, this._onPreload, this);
        EventBus.instance.on(GameEvents.LOADING_BAR_100, this._onBar100, this);
        EventBus.instance.on(GameEvents.GUIDE_COMPLETE, this._onGuideComplete, this);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    get controller(): TransitionController | null {
        return this._controller?.isValid ? this._controller : null;
    }

    /** Preload nền — không block boot. */
    preload(): void {
        void this.ensureLoaded();
    }

    ensureLoaded(): Promise<TransitionController | null> {
        if (this._controller?.isValid && this._instance?.isValid) {
            this._wireTarget();
            return Promise.resolve(this._controller);
        }
        if (this._loading) return this._loading;

        this._loading = this._loadAndInstantiate().finally(() => {
            this._loading = null;
        });
        return this._loading;
    }

    private _onPreload(): void {
        this.preload();
    }

    private _onBar100(): void {
        void this.ensureLoaded();
    }

    private _onGuideComplete(): void {
        void this.ensureLoaded().then((ctrl) => {
            if (!ctrl) return;
            this._wireTarget();
            ctrl.triggerGuideTransition();
        });
    }

    private _loadAndInstantiate(): Promise<TransitionController | null> {
        return new Promise((resolve) => {
            const finish = (prefab: Prefab | null) => {
                if (!prefab || !this.isValid) {
                    resolve(null);
                    return;
                }

                this._cachedPrefab = prefab;
                const parent = this.shellParent ?? this.node;
                const gameRoot = this.gameRoot;

                const instance = instantiate(prefab);
                instance.name = 'Transition';
                instance.active = false;

                if (gameRoot?.isValid && parent.isValid) {
                    const idx = parent.children.indexOf(gameRoot);
                    if (idx >= 0) {
                        parent.insertChild(instance, idx + 1);
                    } else {
                        parent.addChild(instance);
                    }
                } else {
                    parent.addChild(instance);
                }

                const ctrl = instance.getComponent(TransitionController)
                    ?? instance.getComponentInChildren(TransitionController);
                if (!ctrl) {
                    Log.e('[TransitionLoader] Prefab thiếu TransitionController');
                    instance.destroy();
                    resolve(null);
                    return;
                }

                this._instance = instance;
                this._controller = ctrl;
                this._wireTarget();
                instance.active = true;

                Log.d('[TransitionLoader] instantiated Transition (above GameRoot)');
                resolve(ctrl);
            };

            if (this._cachedPrefab) {
                finish(this._cachedPrefab);
                return;
            }

            const bundle = assetManager.getBundle(BUNDLE_NAME);
            if (!bundle) {
                Log.e(`[TransitionLoader] Bundle '${BUNDLE_NAME}' chưa load`);
                resolve(null);
                return;
            }

            const path = (this.prefabPath || DEFAULT_PREFAB_PATH).trim();
            bundle.load(path, Prefab, (err: Error | null, prefab: Prefab) => {
                if (err || !prefab) {
                    Log.e(`[TransitionLoader] Load failed: ${path}`, err);
                    resolve(null);
                    return;
                }
                Log.d(`[TransitionLoader] Prefab loaded: ${path}`);
                finish(prefab);
            });
        });
    }

    private _wireTarget(): void {
        const ctrl = this._controller;
        const root = this.gameRoot;
        if (!ctrl?.isValid || !root?.isValid) return;

        const pot = root.getComponentInChildren(PotController);
        const target = pot?.getTransitionTargetNode() ?? null;
        if (target) {
            ctrl.targetNode = target;
        } else {
            Log.w('[TransitionLoader] Không tìm thấy Pot/Animation target trong GameRoot');
        }
    }

    /**
     * Resume FreeSpin: không có GUIDE_COMPLETE fly — handoff chest từ Transition sang Pot.
     * Gọi trước GAME_READY để Pot có spine khi vào game.
     */
    async handoffChestForResume(): Promise<void> {
        const ctrl = await this.ensureLoaded();
        const pot = this.gameRoot?.getComponentInChildren(PotController);
        if (!ctrl || !pot?.isValid) {
            Log.w('[TransitionLoader] handoffChestForResume — thiếu Transition hoặc PotController');
            return;
        }
        ctrl.handoffChestToPot(pot);
        EventBus.instance.emit(GameEvents.TRANSITION_DONE);
        Log.d('[TransitionLoader] handoffChestForResume done');
    }
}
