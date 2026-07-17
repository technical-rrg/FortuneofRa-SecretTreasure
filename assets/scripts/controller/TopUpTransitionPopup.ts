import { _decorator, Component, Node, tween, UIOpacity, BlockInputEvents, Tween, sp } from 'cc';
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

    @property({ type: Node, tooltip: 'Overlay tối phủ toàn màn hình — active=false ban đầu, hiện ngay trước effectNode.' })
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

    @property({ tooltip: 'Fade in/out duration (giây).' })
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

    private _stopFadeTweens(): void {
        const target = this.effectNode ?? this.node;
        Tween.stopAllByTarget(target);
        const targetOp = target.getComponent(UIOpacity);
        if (targetOp) Tween.stopAllByTarget(targetOp);
        if (this.overlayNode) {
            Tween.stopAllByTarget(this.overlayNode);
            const overlayOp = this.overlayNode.getComponent(UIOpacity);
            if (overlayOp) Tween.stopAllByTarget(overlayOp);
        }
    }

    private _forceClose(): void {
        if (this._closed) return;
        this._closed = true;
        this.unscheduleAllCallbacks();
        this._stopFadeTweens();

        const target = this.effectNode ?? this.node;
        target.active = false;
        const targetOp = target.getComponent(UIOpacity);
        if (targetOp) targetOp.opacity = 255;

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

        const target = this.effectNode ?? this.node;
        const fadeIn = Math.max(0.05, this.fadeDuration);
        const holdTime = Math.max(0.15, this.duration);

        this.node.active = true;

        if (this.overlayNode) {
            this.overlayNode.active = true;
            const overlayOp = this._ensureOpacity(this.overlayNode);
            overlayOp.opacity = 0;
            tween(overlayOp).to(fadeIn, { opacity: 255 }, { easing: 'sineOut' }).start();
        }

        target.active = true;
        const targetOp = this._ensureOpacity(target);
        targetOp.opacity = 0;

        // Fade-in xong → READY (đổi UI) → hold → fade-out → DONE
        tween(targetOp)
            .to(fadeIn, { opacity: 255 }, { easing: 'sineOut' })
            .call(() => {
                this._emitReady();
                this.scheduleOnce(() => this._fadeOutAndClose(), holdTime);
            })
            .start();

        if (this.spineAnimation) {
            this.spineAnimation.clearTrack(0);
            this.spineAnimation.setAnimation(0, 'animation', false);
        }

        // Safety: nếu tween bị cắt vẫn emit READY
        this.scheduleOnce(() => this._emitReady(), fadeIn + 0.05);
    }

    private _fadeOutAndClose(): void {
        if (this._closed) return;

        const target = this.effectNode ?? this.node;
        const fadeOut = Math.max(0.05, this.fadeDuration);
        const targetOp = this._ensureOpacity(target);

        tween(targetOp)
            .to(fadeOut, { opacity: 0 }, { easing: 'sineIn' })
            .call(() => this._forceClose())
            .start();

        if (this.overlayNode?.active) {
            const overlayOp = this._ensureOpacity(this.overlayNode);
            tween(overlayOp).to(fadeOut, { opacity: 0 }, { easing: 'sineIn' }).start();
        }
    }
}
