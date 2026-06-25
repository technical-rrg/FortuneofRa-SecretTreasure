import { _decorator, Component, Node, tween, Vec3, UIOpacity, BlockInputEvents, Tween, sp } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';

const { ccclass, property } = _decorator;

@ccclass('TopUpTransitionPopup')
export class TopUpTransitionPopup extends Component {

    @property({ type: Node, tooltip: 'Overlay tối phủ toàn màn hình — active=false ban đầu, hiện ngay trước effectNode.' })
    overlayNode: Node | null = null;

    @property({ type: Node, tooltip: 'Node effect transition trước khi vào Top Up UI.' })
    effectNode: Node | null = null;

    @property({ type: sp.Skeleton, tooltip: 'Spine animation node - play animation "animtion" khi hiện popup.' })
    spineAnimation: sp.Skeleton | null = null;

    @property({ tooltip: 'Thời gian effect transition (giây).' })
    duration: number = 1.0;

    @property({ tooltip: 'Fade in/out duration (giây).' })
    fadeDuration: number = 0.15;

    private _closed: boolean = false;

    onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }
        EventBus.instance.on(GameEvents.TOPUP_TRANSITION_SHOW, this._show, this);
        this.node.active = false;
        if (this.overlayNode) this.overlayNode.active = false;
        if (this.effectNode) this.effectNode.active = false;
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    private _forceClose(): void {
        if (this._closed) return;
        this._closed = true;
        this.unscheduleAllCallbacks();
        const target = this.effectNode ?? this.node;
        Tween.stopAllByTarget(target);
        const opacity = target.getComponent(UIOpacity);
        if (opacity) Tween.stopAllByTarget(opacity);
        target.active = false;
        if (this.overlayNode) this.overlayNode.active = false;
        this.node.active = false;
        EventBus.instance.emit(GameEvents.TOPUP_TRANSITION_DONE);
    }

    private _show(): void {
        this._closed = false;
        const target = this.effectNode ?? this.node;
        this.node.active = true;

        if (this.overlayNode) {
            this.overlayNode.active = true;
        }

        target.active = true;

        if (this.spineAnimation) {
            this.spineAnimation.clearTrack(0);
            this.spineAnimation.setAnimation(0, 'animation', false);
        }

        this.scheduleOnce(() => this._forceClose(), this.duration);
    }
}