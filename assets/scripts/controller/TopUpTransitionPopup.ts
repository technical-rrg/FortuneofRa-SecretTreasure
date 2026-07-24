import { _decorator, Component, Node, tween, UIOpacity, BlockInputEvents, Tween, sp, Sprite, Color, screen, assetManager } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { Log } from '../core/Logger';

const { ccclass, property } = _decorator;

const BUNDLE_NAME = 'MainBundle';

export enum TransitionMode {
    FreeSpin = 0,
    TopUp = 1,
    PickGame = 2,
}

@ccclass('TopUpTransitionPopup')
export class TopUpTransitionPopup extends Component {

    @property({ type: Node, tooltip: 'Fill đen phủ toàn màn hình — fade in/out bằng UIOpacity (không fade alpha content).' })
    overlayNode: Node | null = null;

    @property({ type: Node, tooltip: 'Node effect transition (chứa spine) — hiện full opacity, không fade alpha.' })
    effectNode: Node | null = null;

    @property({ type: sp.Skeleton, tooltip: 'Spine màn NGANG — để trống skeletonData, lazy-load khi show.' })
    spineLandscape: sp.Skeleton | null = null;

    @property({ type: sp.Skeleton, tooltip: 'Spine màn DỌC — để trống skeletonData, lazy-load khi show.' })
    spinePortrait: sp.Skeleton | null = null;

    @property({ tooltip: 'Path SkeletonData landscape trong MainBundle (không extension).' })
    skeletonPathLandscape: string = 'newAnimations/Anim-Transition-Feature/TransitionFeature-Lanscape';

    @property({ tooltip: 'Path SkeletonData portrait trong MainBundle (không extension).' })
    skeletonPathPortrait: string = 'newAnimations/Anim-Transition-Feature/TransitionFeature-Portrait';

    @property({ group: { name: 'Anim Landscape', id: 'anim-l' }, tooltip: 'Tên anim PickGame — màn ngang.' })
    animPickGameLandscape: string = 'Pickgame';

    @property({ group: { name: 'Anim Landscape', id: 'anim-l' }, tooltip: 'Tên anim FreeSpin — màn ngang.' })
    animFreeSpinLandscape: string = 'freespins';

    @property({ group: { name: 'Anim Landscape', id: 'anim-l' }, tooltip: 'Tên anim TopUp — màn ngang.' })
    animTopUpLandscape: string = 'Topupbonus';

    @property({ group: { name: 'Anim Portrait', id: 'anim-p' }, tooltip: 'Tên anim PickGame — màn dọc.' })
    animPickGamePortrait: string = 'Pickgame';

    @property({ group: { name: 'Anim Portrait', id: 'anim-p' }, tooltip: 'Tên anim FreeSpin — màn dọc.' })
    animFreeSpinPortrait: string = 'Freespins';

    @property({ group: { name: 'Anim Portrait', id: 'anim-p' }, tooltip: 'Tên anim TopUp — màn dọc.' })
    animTopUpPortrait: string = 'Topupbonus';

    @property({ tooltip: 'Thời gian giữ effect ở giữa SAU khi fade-in xong (giây).' })
    duration: number = 1.0;

    @property({ tooltip: 'Fade in/out duration của fill đen (giây).' })
    fadeDuration: number = 0.35;

    private _closed: boolean = false;
    private _readyEmitted: boolean = false;
    private _currentMode: TransitionMode = TransitionMode.TopUp;
    private _showGen: number = 0;
    /** Orientation đang dùng cho spine hiện tại — null khi popup đóng. */
    private _activeIsLandscape: boolean | null = null;

    private _skelDataLandscape: sp.SkeletonData | null = null;
    private _skelDataPortrait: sp.SkeletonData | null = null;
    private _loadingLandscape: Promise<sp.SkeletonData | null> | null = null;
    private _loadingPortrait: Promise<sp.SkeletonData | null> | null = null;

    onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }
        EventBus.instance.on(GameEvents.TOPUP_TRANSITION_SHOW, this._show, this);
        screen.on('window-resize', this._onOrientationChange, this);
        screen.on('orientation-change', this._onOrientationChange, this);
        this.node.active = false;
        if (this.overlayNode) this.overlayNode.active = false;
        if (this.effectNode) this.effectNode.active = false;
        this._hideAllSpines();
        this._currentMode = TransitionMode.TopUp;
    }

    onDestroy(): void {
        screen.off('window-resize', this._onOrientationChange, this);
        screen.off('orientation-change', this._onOrientationChange, this);
        EventBus.instance.offTarget(this);
    }

    private _ensureOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    }

    /** Sprite fill đen đặc (a=255) — fade chỉ qua UIOpacity, không đụng color.a. */
    private _prepareBlackFill(node: Node): UIOpacity {
        const spr = node.getComponent(Sprite);
        if (spr) spr.color = new Color(0, 0, 0, 255);
        return this._ensureOpacity(node);
    }

    private _stopFadeTweens(): void {
        if (this.overlayNode) {
            Tween.stopAllByTarget(this.overlayNode);
            const overlayOp = this.overlayNode.getComponent(UIOpacity);
            if (overlayOp) Tween.stopAllByTarget(overlayOp);
        }
        if (this.effectNode) {
            Tween.stopAllByTarget(this.effectNode);
            const effectOp = this.effectNode.getComponent(UIOpacity);
            if (effectOp) Tween.stopAllByTarget(effectOp);
        }
    }

    private _isLandscape(): boolean {
        const size = screen.windowSize;
        return size.width >= size.height;
    }

    private _hideAllSpines(): void {
        if (this.spineLandscape) {
            this.spineLandscape.clearTracks();
            this.spineLandscape.node.active = false;
        }
        if (this.spinePortrait) {
            this.spinePortrait.clearTracks();
            this.spinePortrait.node.active = false;
        }
    }

    private _getAnimName(mode: TransitionMode, isLandscape: boolean): string {
        if (isLandscape) {
            switch (mode) {
                case TransitionMode.PickGame: return (this.animPickGameLandscape || '').trim();
                case TransitionMode.FreeSpin: return (this.animFreeSpinLandscape || '').trim();
                default: return (this.animTopUpLandscape || '').trim();
            }
        }
        switch (mode) {
            case TransitionMode.PickGame: return (this.animPickGamePortrait || '').trim();
            case TransitionMode.FreeSpin: return (this.animFreeSpinPortrait || '').trim();
            default: return (this.animTopUpPortrait || '').trim();
        }
    }

    private _ensureSkeletonData(isLandscape: boolean): Promise<sp.SkeletonData | null> {
        const cached = isLandscape ? this._skelDataLandscape : this._skelDataPortrait;
        if (cached) return Promise.resolve(cached);

        const inflight = isLandscape ? this._loadingLandscape : this._loadingPortrait;
        if (inflight) return inflight;

        const path = (isLandscape ? this.skeletonPathLandscape : this.skeletonPathPortrait || '').trim();
        if (!path) {
            Log.w(`[TopUpTransitionPopup] Empty skeleton path (${isLandscape ? 'landscape' : 'portrait'})`);
            return Promise.resolve(null);
        }

        const bundle = assetManager.getBundle(BUNDLE_NAME);
        if (!bundle) {
            Log.w(`[TopUpTransitionPopup] Bundle '${BUNDLE_NAME}' missing — cannot lazy-load ${path}`);
            return Promise.resolve(null);
        }

        const promise = new Promise<sp.SkeletonData | null>((resolve) => {
            bundle.load(path, sp.SkeletonData, (err, data) => {
                if (isLandscape) this._loadingLandscape = null;
                else this._loadingPortrait = null;

                if (err || !data) {
                    Log.w(`[TopUpTransitionPopup] SkeletonData load failed: ${path}`, err);
                    resolve(null);
                    return;
                }
                if (isLandscape) this._skelDataLandscape = data;
                else this._skelDataPortrait = data;
                Log.d(`[TopUpTransitionPopup] Lazy-loaded SkeletonData: ${path}`);
                resolve(data);
            });
        });

        if (isLandscape) this._loadingLandscape = promise;
        else this._loadingPortrait = promise;
        return promise;
    }

    /** Xoay màn khi popup đang mở → đổi spine ngang/dọc, giữ tiến độ anim nếu có. */
    private _onOrientationChange(): void {
        if (this._closed || !this.node.active) return;
        const isLandscape = this._isLandscape();
        if (this._activeIsLandscape === isLandscape) return;
        void this._playSpineForMode(this._currentMode, this._showGen, true);
    }

    private _readActiveTrackTime(): number {
        const current = this._activeIsLandscape === true
            ? this.spineLandscape
            : this._activeIsLandscape === false
                ? this.spinePortrait
                : null;
        const track = current?.getCurrent(0);
        return track?.trackTime ?? 0;
    }

    /**
     * @param preserveProgress true khi đổi orientation giữa chừng — seek anim tới cùng thời điểm.
     */
    private async _playSpineForMode(
        mode: TransitionMode,
        showGen: number,
        preserveProgress: boolean = false,
    ): Promise<void> {
        const isLandscape = this._isLandscape();
        const active = isLandscape ? this.spineLandscape : this.spinePortrait;
        const inactive = isLandscape ? this.spinePortrait : this.spineLandscape;
        const resumeAt = preserveProgress ? this._readActiveTrackTime() : 0;

        if (inactive) {
            inactive.clearTracks();
            inactive.node.active = false;
        }

        if (!active) {
            Log.w(`[TopUpTransitionPopup] Missing spine (${isLandscape ? 'landscape' : 'portrait'})`);
            return;
        }

        // Đã có data trên component (gán sẵn trong Editor) → dùng luôn, không load lại
        let data = active.skeletonData
            ?? (isLandscape ? this._skelDataLandscape : this._skelDataPortrait);

        if (!data) {
            data = await this._ensureSkeletonData(isLandscape);
        }

        // Orientation có thể đổi lại trong lúc await — chỉ apply nếu vẫn khớp
        if (this._closed || showGen !== this._showGen || !active.isValid) return;
        if (this._isLandscape() !== isLandscape) return;

        if (data && active.skeletonData !== data) {
            active.skeletonData = data;
        }
        if (!active.skeletonData) {
            Log.w(`[TopUpTransitionPopup] No skeletonData for ${isLandscape ? 'landscape' : 'portrait'}`);
            return;
        }

        const animName = this._getAnimName(mode, isLandscape);
        active.node.active = true;
        active.clearTrack(0);

        if (animName && active.findAnimation(animName)) {
            const entry = active.setAnimation(0, animName, false);
            if (entry && resumeAt > 0) {
                const duration = (entry.animation as { duration?: number } | null)?.duration ?? 0;
                entry.trackTime = duration > 0 ? Math.min(resumeAt, Math.max(0, duration - 0.001)) : resumeAt;
            }
            this._activeIsLandscape = isLandscape;
        } else {
            Log.w(`[TopUpTransitionPopup] Missing anim "${animName}" on ${isLandscape ? 'landscape' : 'portrait'} spine`);
        }
    }

    private _forceClose(): void {
        if (this._closed) return;
        this._closed = true;
        this._activeIsLandscape = null;
        this.unscheduleAllCallbacks();
        this._stopFadeTweens();
        this._hideAllSpines();

        if (this.effectNode) {
            this.effectNode.active = false;
            const effectOp = this.effectNode.getComponent(UIOpacity);
            if (effectOp) effectOp.opacity = 255;
        }

        if (this.overlayNode) {
            this.overlayNode.active = false;
            const overlayOp = this.overlayNode.getComponent(UIOpacity);
            if (overlayOp) overlayOp.opacity = 255;
        }

        this.node.active = false;
        EventBus.instance.emit(GameEvents.TOPUP_TRANSITION_DONE);
    }

    /** Overlay đã phủ kín — cho phép đổi UI mode bên dưới. */
    private _emitReady(): void {
        if (this._closed || this._readyEmitted) return;
        this._readyEmitted = true;
        EventBus.instance.emit(GameEvents.TOPUP_TRANSITION_READY, this._currentMode);
    }

    private _show(mode: TransitionMode = TransitionMode.TopUp): void {
        this._closed = false;
        this._readyEmitted = false;
        this._activeIsLandscape = null;
        this._showGen++;
        const showGen = this._showGen;
        this.unscheduleAllCallbacks();
        this._stopFadeTweens();
        this._currentMode = mode;

        const fadeIn = Math.max(0.05, this.fadeDuration);
        const holdTime = Math.max(0.15, this.duration);

        this.node.active = true;

        const target = this.effectNode;
        if (target) {
            target.active = true;
            const targetOp = this._ensureOpacity(target);
            targetOp.opacity = 255;
        }

        // Lazy-load + play spine theo orientation / mode (song song với fade overlay)
        void this._playSpineForMode(mode, showGen);

        if (this.overlayNode) {
            this.overlayNode.active = true;
            this.overlayNode.setSiblingIndex(0);
            if (target) target.setSiblingIndex(this.node.children.length - 1);

            const overlayOp = this._prepareBlackFill(this.overlayNode);
            overlayOp.opacity = 0;
            tween(overlayOp)
                .to(fadeIn, { opacity: 255 }, { easing: 'sineOut' })
                .call(() => {
                    this._emitReady();
                    this.scheduleOnce(() => this._fadeOutAndClose(), holdTime);
                })
                .start();
        } else {
            this._emitReady();
            this.scheduleOnce(() => this._fadeOutAndClose(), holdTime);
        }

        this.scheduleOnce(() => this._emitReady(), fadeIn + 0.05);
    }

    private _fadeOutAndClose(): void {
        if (this._closed) return;

        const fadeOut = Math.max(0.05, this.fadeDuration);

        if (this.overlayNode?.active) {
            const overlayOp = this._prepareBlackFill(this.overlayNode);
            tween(overlayOp)
                .to(fadeOut, { opacity: 0 }, { easing: 'sineIn' })
                .call(() => this._forceClose())
                .start();
            if (this.effectNode) this.effectNode.active = false;
            this._hideAllSpines();
        } else {
            this._forceClose();
        }
    }
}
