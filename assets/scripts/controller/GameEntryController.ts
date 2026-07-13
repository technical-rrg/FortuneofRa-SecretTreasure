/**
 * GameEntryController - Điều phối luồng vào game.
 *
 * Setup trong Editor:
 *   1. Gắn component này vào bất kỳ node nào trong game prefab.
 *   2. Kéo GameGuide node vào slot gameGuide (để active=false trong Editor).
 *   3. Kéo GameRoot node vào slot gameRoot (để active=false trong Editor).
 *      - Gắn UIOpacity vào cả hai node.
 *
 * Flow (SkipIntro OFF) — tối ưu load:
 *   LOADING_BAR_100 → GuideView active + warm GameRoot (opacity=0) + prefetch BG
 *   → User click Continue → GUIDE_COMPLETE → GameRoot fade in (BG đã sẵn)
 *
 * Flow (SkipIntro ON / Resume):
 *   → GameRoot active ngay (không qua Guide)
 */

import { _decorator, Component, Node, UIOpacity, tween } from 'cc';
import { EventBus }                from '../core/EventBus';
import { GameEvents }              from '../core/GameEvents';
import { GameData }                from '../data/GameData';
import { Log }                     from '../core/Logger';
import { SlotMachineController }   from './SlotMachineController';
import { TransitionLoader }        from './TransitionLoader';
import { BroadcastPopupLoader }    from './BroadcastPopupLoader';
import { DebbugManagerLoader }     from './DebbugManagerLoader';
import { GameManager }             from '../manager/GameManager';

const { ccclass, property } = _decorator;

@ccclass('GameEntryController')
export class GameEntryController extends Component {

    @property({ type: Node, tooltip: 'Node màn hình Guide (có GuideController)' })
    gameGuide: Node | null = null;

    @property({ type: Node, tooltip: 'Node GameRoot chứa toàn bộ game — inactive đến GUIDE_COMPLETE' })
    gameRoot: Node | null = null;

    @property({ type: Node, tooltip: 'Node dùng chung giữa GuideView và GameRoot. Mặc định là con của GuideView, sẽ được chuyển sang GameRoot khi GuideView active=false.' })
    sharedNode: Node | null = null;

    @property({ tooltip: 'Thời gian fade GameRoot xuất hiện (giây). 0 = hiện ngay.' })
    fadeDuration: number = 0;

    @property({
        tooltip: 'Sau khi Guide hiện, đợi N giây rồi warm-init GameRoot (opacity=0) nền.\n' +
                 '0 = tắt warm (chỉ init khi Continue). Mặc định 0.5s.',
    })
    warmGameRootDelay: number = 0;

    private _rootOpacity: UIOpacity | null = null;
    /** Guard: chỉ xử lý LOADING_COMPLETE lần đầu tiên — GameManager có thể emit lại */
    private _loadingHandled: boolean = false;
    /** Guard: chỉ xử lý GUIDE_COMPLETE lần đầu tiên */
    private _guideHandled: boolean = false;
    /** State lưu từ _onLoadingComplete() để _onBarReached100() xử lý khi bar thực sự 100% */
    private _pendingState: { isResuming: boolean; skipIntro: boolean } | null = null;
    /** GameRoot đã được warm (active + opacity 0) trong lúc Guide đang hiện */
    private _gameRootWarmed: boolean = false;

    private _transitionLoader: TransitionLoader | null = null;

    // ─── LIFECYCLE ───

    onLoad(): void {
        if (this.gameGuide) this.gameGuide.active = false;
        this._deactivateGameRoot();
        this._initOverlayLoaders();

        EventBus.instance.on(GameEvents.LOADING_COMPLETE, this._onLoadingComplete, this);
        EventBus.instance.on(GameEvents.LOADING_BAR_100,  this._onBarReached100,  this);
        EventBus.instance.on(GameEvents.GUIDE_CONTINUE,  this._onGuideContinue,  this);
        EventBus.instance.on(GameEvents.GUIDE_COMPLETE,  this._onGuideComplete,  this);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ─── HANDLERS ───

    private _onLoadingComplete(): void {
        if (this._loadingHandled) {
            Log.w('[GameEntryController] LOADING_COMPLETE fired again — ignored (already handled by LoadingController)');
            return;
        }
        this._loadingHandled = true;
        Log.d('[GameEntryController] LOADING_COMPLETE → handling (first time)');

        // Không activate GameRoot ở đây — chờ Guide / resume / skipIntro.

        const isResuming = GameData.instance.isResumingFreeSpin;
        Log.d(`[RESUME-DEBUG] GameEntryController._onLoadingComplete — isResumingFreeSpin=${isResuming}`);

        let skipIntro = false;
        try {
            const saved = localStorage.getItem('setting_intro_on');
            if (saved !== null) skipIntro = saved === 'false';
        } catch (_) {}

        this._pendingState = { isResuming, skipIntro };
        Log.d('[GameEntryController] State saved — waiting for LOADING_BAR_100');
    }

    /** Chỉ gọi khi loading bar VISUALLY đạt 100% — đảm bảo GuideView/GameRoot không hiện sớm */
    private _onBarReached100(): void {
        if (!this._pendingState) {
            this.scheduleOnce(() => this._onBarReached100(), 0);
            return;
        }

        const { isResuming, skipIntro } = this._pendingState;
        this._pendingState = null;
        Log.d(`[GameEntryController] LOADING_BAR_100 → processing: isResuming=${isResuming}, skipIntro=${skipIntro}`);

        if (isResuming) {
            Log.d('[RESUME-DEBUG] GameEntryController → resume path: _showGameRoot() → GAME_READY sau fadeDuration+0.15s');
            this._guideHandled = true;
            GameData.instance.isGuideCompleted = true;
            GameData.instance.isGuideShowing = false;
            this._reparentSharedNode();
            this._showGameRoot();
            this.scheduleOnce(() => {
                void this._transitionLoader?.handoffChestForResume().then(() => {
                    Log.d('[RESUME-DEBUG] GameEntryController resume → emit GAME_READY');
                    EventBus.instance.emit(GameEvents.GAME_READY);
                });
            }, 0);
            return;
        }

        if (skipIntro) {
            Log.d('[GameEntryController] skipIntro=true → await Transition → emit GUIDE_COMPLETE');
            void this._emitGuideCompleteWhenTransitionReady();
        } else {
            Log.d('[GameEntryController] skipIntro=false → gameGuide.active = true');
            GameData.instance.isGuideShowing = true;
            this._deactivateGameRoot();
            if (this.gameGuide) this.gameGuide.active = true;
            // Warm GameRoot nền + prefetch BG ngay — tránh khựng frame khi Continue
            this._warmGameRootBackground();
            this._prefetchGameBackground();
        }
    }

    /** Tắt GameRoot + opacity 0 — gọi mỗi lần vào Guide để chắc chắn không bị bật sớm. */
    private _deactivateGameRoot(): void {
        if (!this.gameRoot) {
            Log.w('[GameEntryController] gameRoot slot null — không thể tắt GameRoot');
            return;
        }
        if (this.gameRoot.active) {
            Log.d('[GameEntryController] GameRoot was active — forcing inactive during Guide');
        }
        this.gameRoot.active = false;
        this._rootOpacity = this.gameRoot.getComponent(UIOpacity) ?? this._rootOpacity;
        if (this._rootOpacity) this._rootOpacity.opacity = 0;
    }

    /**
     * Init GameRoot nền (opacity=0) trong lúc Guide — chạy GameManager + prefetch BG.
     */
    private _warmGameRootBackground(): void {
        if (this._guideHandled || this._gameRootWarmed) return;
        if (!this.gameRoot || this.gameRoot.active) return;
        if (!GameData.instance.isGuideShowing) return;

        Log.d('[GameEntryController] Warm GameRoot in background (opacity=0) while Guide showing');
        this._gameRootWarmed = true;
        this.gameRoot.active = true;
        const opacity = this.gameRoot.getComponent(UIOpacity) ?? this._rootOpacity;
        if (opacity) opacity.opacity = 0;

        // Đợi 1 frame — ReelController.onLoad phải chạy xong trước applyInitialSymbols
        this.scheduleOnce(() => this._applySymbolsSafe(), 0);
    }

    /** Gọi GameManager.prefetchBackground sau warm — gán BG trong lúc xem Guide. */
    private _prefetchGameBackground(): void {
        if (!this.gameRoot) return;
        const gm = this.gameRoot.getComponent(GameManager);
        if (gm) {
            gm.prefetchBackground();
            return;
        }
        // onLoad GameManager chạy sync khi active=true; fallback 1 frame nếu chưa gắn
        this.scheduleOnce(() => {
            this.gameRoot?.getComponent(GameManager)?.prefetchBackground();
        }, 0);
    }

    private _onGuideContinue(): void {
        if (this.sharedNode) this.sharedNode.active = false;
        Log.d('[GameEntryController] GUIDE_CONTINUE → sharedNode.active = false');
    }

    private _onGuideComplete(): void {
        if (this._guideHandled) {
            Log.w('[GameEntryController] GUIDE_COMPLETE fired again — ignored');
            return;
        }
        this._guideHandled = true;
        GameData.instance.isGuideCompleted = true;
        GameData.instance.isGuideShowing = false;
        Log.d('[GameEntryController] GUIDE_COMPLETE → gameGuide.active=false → _showGameRoot()');
        if (this.gameGuide) this.gameGuide.active = false;
        this._reparentSharedNode();
        this._showGameRoot();
        // SoundManager.onLoad chạy khi GameRoot active (nếu chưa warm)
        EventBus.instance.emit(GameEvents.GAME_ENTRY_EFFECT);
    }

    private _showGameRoot(): void {
        if (!this.gameRoot) return;
        const wasInactive = !this.gameRoot.active;
        this.gameRoot.active = true;
        this._gameRootWarmed = true;

        if (wasInactive) {
            // Đợi 1 frame — ReelController.onLoad phải chạy xong trước applyInitialSymbols
            this.scheduleOnce(() => this._applySymbolsSafe(), 0);
        }

        const opacity = this.gameRoot.getComponent(UIOpacity);
        if (opacity) {
            if (this.fadeDuration <= 0) {
                opacity.opacity = 255;
                if (this.sharedNode) {
                    this.sharedNode.active = true;
                }
            } else {
                opacity.opacity = 0;
                tween(opacity)
                    .to(this.fadeDuration, { opacity: 255 })
                    .call(() => {
                        if (this.sharedNode) {
                            this.sharedNode.active = true;
                            Log.d('[GameEntryController] fade complete → sharedNode.active = true');
                        }
                    })
                    .start();
            }
        } else {
            if (this.sharedNode) this.sharedNode.active = true;
        }
    }

    private _applySymbolsSafe(): void {
        if (!this.gameRoot?.isValid || !this.gameRoot.active) return;
        const smc = this.gameRoot.getComponentInChildren(SlotMachineController);
        if (smc) {
            smc.applyInitialSymbols();
            Log.d('[GameEntryController] applyInitialSymbols after GameRoot active');
        }
    }

    /** Gắn lazy-load Transition / Broadcast / Debug trên Base root (tách khỏi Base.prefab). */
    private _initOverlayLoaders(): void {
        const shell = this.node;

        let transition = shell.getComponent(TransitionLoader);
        if (!transition) transition = shell.addComponent(TransitionLoader);
        transition.init(shell, this.gameRoot);
        this._transitionLoader = transition;

        let broadcast = shell.getComponent(BroadcastPopupLoader);
        if (!broadcast) broadcast = shell.addComponent(BroadcastPopupLoader);
        broadcast.init(shell);

        let debug = shell.getComponent(DebbugManagerLoader);
        if (!debug) debug = shell.addComponent(DebbugManagerLoader);
        debug.init(shell, this.gameRoot);
    }

    /** skipIntro: Transition phải sẵn sàng trước GUIDE_COMPLETE (TransitionController lắng nghe event đó). */
    private async _emitGuideCompleteWhenTransitionReady(): Promise<void> {
        const loader = this._transitionLoader;
        if (loader) {
            await loader.ensureLoaded();
        }
        EventBus.instance.emit(GameEvents.GUIDE_COMPLETE);
    }

    /** Chuyển sharedNode từ GuideView sang GameRoot (gọi sau khi GuideView active=false). */
    private _reparentSharedNode(): void {
        if (!this.sharedNode || !this.gameRoot) return;
        this.sharedNode.setParent(this.gameRoot, false);
        this.sharedNode.setSiblingIndex(1);
        Log.d('[GameEntryController] sharedNode đã được chuyển sang GameRoot (vẫn inactive cho đến khi fade xong)');
    }
}
