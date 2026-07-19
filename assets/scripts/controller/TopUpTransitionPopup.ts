import { _decorator, Component, Node, tween, UIOpacity, BlockInputEvents, Tween, sp, Sprite, Color } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';

const { ccclass, property } = _decorator;

export enum TransitionMode {
    FreeSpin = 0,
    TopUp = 1,
    PickGame = 2,
}

@ccclass('TopUpTransitionPopup')
export class TopUpTransitionPopup extends Component {

    @property({ type: Node, tooltip: 'Fill đen phủ toàn màn hình — fade in/out bằng UIOpacity (không fade alpha content).' })
    overlayNode: Node | null = null;

    @property({ type: Node, tooltip: 'Node effect transition trước khi vào Top Up UI.' })
    effectNode: Node | null = null;

    @property({ type: Node, tooltip: 'Nội dung transition cho chế độ FreeSpin.' })
    freeSpinModeNode: Node | null = null;

    @property({ type: Node, tooltip: 'Nội dung transition cho chế độ TopUp.' })
    topUpModeNode: Node | null = null;

    @property({ type: Node, tooltip: 'Nội dung transition cho chế độ PickGame.' })
    pickGameModeNode: Node | null = null;

    @property({ type: sp.Skeleton, tooltip: 'Spine animation node - play animation "animtion" khi hiện popup.' })
    spineAnimation: sp.Skeleton | null = null;

    @property({ tooltip: 'Thời gian giữ effect ở giữa SAU khi fade-in xong (giây).' })
    duration: number = 1.0;

    @property({ tooltip: 'Fade in/out duration của fill đen (giây).' })
    fadeDuration: number = 0.35;

    private _closed: boolean = false;
    private _readyEmitted: boolean = false;
    private _currentMode: TransitionMode = TransitionMode.TopUp;

    onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }
        EventBus.instance.on(GameEvents.TOPUP_TRANSITION_SHOW, this._show, this);
        this.node.active = false;
        if (this.overlayNode) this.overlayNode.active = false;
        if (this.effectNode) this.effectNode.active = false;
        this._setMode(TransitionMode.TopUp);
    }

    onDestroy(): void {
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

    private _forceClose(): void {
        if (this._closed) return;
        this._closed = true;
        this.unscheduleAllCallbacks();
        this._stopFadeTweens();

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

    private _setMode(mode: TransitionMode): void {
        this._currentMode = mode;
        if (this.freeSpinModeNode) this.freeSpinModeNode.active = mode === TransitionMode.FreeSpin;
        if (this.topUpModeNode) this.topUpModeNode.active = mode === TransitionMode.TopUp;
        if (this.pickGameModeNode) this.pickGameModeNode.active = mode === TransitionMode.PickGame;
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
        this.unscheduleAllCallbacks();
        this._stopFadeTweens();
        this._setMode(mode);

        const fadeIn = Math.max(0.05, this.fadeDuration);
        const holdTime = Math.max(0.15, this.duration);

        this.node.active = true;

        // Effect hiện full opacity — không fade alpha content
        const target = this.effectNode;
        if (target) {
            target.active = true;
            const targetOp = this._ensureOpacity(target);
            targetOp.opacity = 255;
        }

        if (this.spineAnimation) {
            this.spineAnimation.clearTrack(0);
            this.spineAnimation.setAnimation(0, 'animation', false);
        }

        // Chỉ fade fill đen
        if (this.overlayNode) {
            this.overlayNode.active = true;
            // Overlay dưới effect để effect/spine vẫn thấy trên nền đen
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
            // Không có overlay → READY ngay
            this._emitReady();
            this.scheduleOnce(() => this._fadeOutAndClose(), holdTime);
        }

        // Safety: nếu tween bị cắt vẫn emit READY
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
            // Ẩn effect khi bắt đầu fade-out đen (không tween alpha content)
            if (this.effectNode) this.effectNode.active = false;
        } else {
            this._forceClose();
        }
    }
}
