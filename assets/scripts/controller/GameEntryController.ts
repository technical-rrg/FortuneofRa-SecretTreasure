/**
 * GameEntryController - Điều phối luồng vào game.
 *
 * Setup trong Editor:
 *   1. Gắn component này vào bất kỳ node nào trong game prefab.
 *   2. Kéo GameGuide node vào slot gameGuide (để active=false trong Editor).
 *   3. Kéo GameRoot node vào slot gameRoot (để active=false trong Editor).
 *      - Gắn UIOpacity vào cả hai node.
 *
 * Flow (SkipIntro OFF):
 *   LOADING_COMPLETE
 *   → [FadeOut GuideView: 0→255]  (GuideController.onEnable handles this)
 *   → User click Continue
 *   → [FadeIn GuideView: 255→0]   (GuideController._onContinue handles this)
 *   → GUIDE_COMPLETE
 *   → [FadeOut GameRoot: 0→255]
 *
 * Flow (SkipIntro ON):
 *   LOADING_COMPLETE → [FadeOut GameRoot: 0→255] ngay
 *
 * Lưu ý: Tại mọi thời điểm chỉ 1 fade animation chạy.
 *         Node chưa tới lượt phải active=false.
 */

import { _decorator, Component, Node, UIOpacity, tween } from 'cc';
import { EventBus }                from '../core/EventBus';
import { GameEvents }              from '../core/GameEvents';
import { GameData }                from '../data/GameData';
import { Log }                     from '../core/Logger';

const { ccclass, property } = _decorator;

@ccclass('GameEntryController')
export class GameEntryController extends Component {

    @property({ type: Node, tooltip: 'Node màn hình Guide (có GuideController)' })
    gameGuide: Node | null = null;

    @property({ type: Node, tooltip: 'Node GameRoot chứa toàn bộ game — luôn active=true, opacity=0 ban đầu' })
    gameRoot: Node | null = null;

    @property({ type: Node, tooltip: 'Node dùng chung giữa GuideView và GameRoot. Mặc định là con của GuideView, sẽ được chuyển sang GameRoot khi GuideView active=false.' })
    sharedNode: Node | null = null;

    @property({ tooltip: 'Thời gian fade GameRoot xuất hiện (giây)' })
    fadeDuration: number = 0.4;

    private _rootOpacity: UIOpacity | null = null;
    /** Guard: chỉ xử lý LOADING_COMPLETE lần đầu tiên — GameManager có thể emit lại */
    private _loadingHandled: boolean = false;
    /** Guard: chỉ xử lý GUIDE_COMPLETE lần đầu tiên */
    private _guideHandled: boolean = false;
    /** State lưu từ _onLoadingComplete() để _onBarReached100() xử lý khi bar thực sự 100% */
    private _pendingState: { isResuming: boolean; skipIntro: boolean } | null = null;

    // ─── LIFECYCLE ───

    onLoad(): void {
        if (this.gameGuide) this.gameGuide.active = false;

        // gameRoot luôn active=true, ẩn visual bằng opacity=0.
        // Việc này đảm bảo onLoad()/start() của TẤT CẢ component bên trong
        // (SMC, SymbolView, ReelController, SoundManager...) chạy NGAY KHI prefab load —
        // không chờ đến lúc GameView hiện ra mới init.
        // Khi _showGameRoot() được gọi → chỉ cần tween opacity 0→255, không cần set active.
        if (this.gameRoot) {
            this.gameRoot.active = true;
            this._rootOpacity = this.gameRoot.getComponent(UIOpacity);
            if (this._rootOpacity) this._rootOpacity.opacity = 0;
        }

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

        // ── Bước 1: Đảm bảo gameRoot active sớm nhất có thể ──────────────────────────────────
        // Nếu onLoad() đã activate rồi thì đây là no-op. Nếu chưa (edge case) → activate ngay.
        // Việc này đảm bảo tất cả component.onLoad() (SMC, SymbolView, ...) đã chạy
        // → _sprite của SymbolView đã có giá trị → có thể gán spriteFrame ngay.
        if (this.gameRoot && !this.gameRoot.active) {
            this.gameRoot.active = true;
            this._rootOpacity = this.gameRoot.getComponent(UIOpacity);
            if (this._rootOpacity) this._rootOpacity.opacity = 0;
            Log.d('[GameEntryController] gameRoot activated early in _onLoadingComplete');
        }

        // ── Bước 2: không prebuild pool lúc load — pool tự tạo khi dùng ──

        const isResuming = GameData.instance.isResumingFreeSpin;
        Log.d(`[RESUME-DEBUG] GameEntryController._onLoadingComplete — isResumingFreeSpin=${isResuming}`);

        let skipIntro = false;
        try {
            const saved = localStorage.getItem('setting_intro_on');
            if (saved !== null) skipIntro = saved === 'false';
        } catch (_) {}

        // Lưu state để _onBarReached100() xử lý khi loading bar thực sự đạt 100%
        this._pendingState = { isResuming, skipIntro };
        Log.d('[GameEntryController] State saved — waiting for LOADING_BAR_100');
    }

    /** Chỉ gọi khi loading bar VISUALLY đạt 100% — đảm bảo GuideView/GameRoot không hiện sớm */
    private _onBarReached100(): void {
        if (!this._pendingState) {
            // Race condition: LOADING_BAR_100 có thể fire trước LOADING_COMPLETE
            // → đợi thêm để _pendingState được set
            this.scheduleOnce(() => this._onBarReached100(), 0.05);
            return;
        }

        const { isResuming, skipIntro } = this._pendingState;
        this._pendingState = null;
        Log.d(`[GameEntryController] LOADING_BAR_100 → processing: isResuming=${isResuming}, skipIntro=${skipIntro}`);

        if (isResuming) {
            Log.d('[RESUME-DEBUG] GameEntryController → resume path: _showGameRoot() → GAME_READY sau fadeDuration+0.15s');
            this._guideHandled = true;
            this._reparentSharedNode();
            this._showGameRoot();
            this.scheduleOnce(() => {
                Log.d('[RESUME-DEBUG] GameEntryController resume → emit GAME_READY');
                EventBus.instance.emit(GameEvents.GAME_READY);
            }, this.fadeDuration + 0.15);
            return;
        }

        if (skipIntro) {
            Log.d('[GameEntryController] skipIntro=true → emit GUIDE_COMPLETE');
            EventBus.instance.emit(GameEvents.GUIDE_COMPLETE);
        } else {
            Log.d('[GameEntryController] skipIntro=false → gameGuide.active = true');
            if (this.gameGuide) this.gameGuide.active = true;
        }
    }

    private _onGuideContinue(): void {
        // User vừa click Continue → ẩn sharedNode ngay lập tức (trước khi GuideView fade out)
        if (this.sharedNode) this.sharedNode.active = false;
        Log.d('[GameEntryController] GUIDE_CONTINUE → sharedNode.active = false');
    }

    private _onGuideComplete(): void {
        if (this._guideHandled) {
            Log.w('[GameEntryController] GUIDE_COMPLETE fired again — ignored');
            return;
        }
        this._guideHandled = true;
        Log.d('[GameEntryController] GUIDE_COMPLETE → gameGuide.active=false → _showGameRoot()');
        // Đảm bảo GuideView ẩn hoàn toàn trước khi GameRoot hiện ra.
        if (this.gameGuide) this.gameGuide.active = false;
        // Chuyển sharedNode sang GameRoot trước khi hiện
        this._reparentSharedNode();
        // Tại đây nền đen đang hiển thị → FadeOut GameRoot (0→255)
        this._showGameRoot();
        // gameRoot.active=true was set synchronously inside _showGameRoot() above.
        // SoundManager.onLoad() has now run and registered its event listeners.
        // Emit GAME_ENTRY_EFFECT HERE so SoundManager is guaranteed to receive it.
        EventBus.instance.emit(GameEvents.GAME_ENTRY_EFFECT);
    }

    private _showGameRoot(): void {
        // gameRoot đã active=true từ onLoad() — chỉ cần tween opacity 0→255
        if (!this.gameRoot) return;
        this.gameRoot.active = true; // guard (no-op nếu đã active)
        const opacity = this.gameRoot.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity)
                .to(this.fadeDuration, { opacity: 255 })
                .call(() => {
                    // Fade GameRoot hoàn tất → bật lại sharedNode
                    if (this.sharedNode) {
                        this.sharedNode.active = true;
                        Log.d('[GameEntryController] fade complete → sharedNode.active = true');
                    }
                })
                .start();
        } else {
            // Không có opacity component → bật ngay
            if (this.sharedNode) this.sharedNode.active = true;
        }
    }

    /** Chuyển sharedNode từ GuideView sang GameRoot (gọi sau khi GuideView active=false). */
    private _reparentSharedNode(): void {
        if (!this.sharedNode || !this.gameRoot) return;
        // sharedNode đang inactive (bị ẩn từ GUIDE_CONTINUE) — giữ nguyên, chỉ reparent
        this.sharedNode.setParent(this.gameRoot, false);
        this.sharedNode.setSiblingIndex(1); // Đảm bảo sharedNode nằm dưới cùng (dưới guide/gameplay) để không che UI
        Log.d('[GameEntryController] sharedNode đã được chuyển sang GameRoot (vẫn inactive cho đến khi fade xong)');
    }
}
