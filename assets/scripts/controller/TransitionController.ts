/**
 * TransitionController - Hiệu ứng transition giữa các màn hình.
 *
 * Setup trong Editor:
 *   1. Tạo Node "TransitionOverlay" (overlay toàn màn hình, ban đầu inactive).
 *   2. Gắn component này vào node đó.
 *   3. Node phải có UIOpacity component (để fade in/out).
 *   4. Đặt node này trên cùng hierarchy (order cao nhất).
 *   5. iconNode: Spine với animation Idle_LV6 và LV6_transition_LV0.
 *   6. effectNode: Particle active khi bắt đầu (Idle_LV6).
 *   7. effectNode2: Particle active khi icon bay tới đích.
 *
 * Flow:
 *   GUIDE_COMPLETE → phát hiệu ứng transition → fade in/out → biến mất
 */

import { _decorator, Component, UIOpacity, tween, Node, Vec3, ParticleSystem, easing, sp } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';
import { SoundManager } from '../manager/SoundManager';

const { ccclass, property } = _decorator;

@ccclass('TransitionController')
export class TransitionController extends Component {

    @property({ type: UIOpacity, tooltip: 'UIOpacity của TransitionOverlay để fade in/out' })
    uiOpacity: UIOpacity | null = null;

    @property({ type: Node, tooltip: 'Icon node để hiển thị hiệu ứng bay' })
    iconNode: Node | null = null;

    @property({ type: Node, tooltip: 'Target node - nơi icon bay vào' })
    targetNode: Node | null = null;

    @property({ type: Node, tooltip: 'Effect node (chứa nhiều particle con) - hiển thị khi iconNode zoom tới max (mặc định inactive)' })
    effectNode: Node | null = null;

    @property({ type: Node, tooltip: 'Effect node 2 - hiển thị particle khi icon bay tới đích (mặc định inactive)' })
    effectNode2: Node | null = null;

    @property({ tooltip: 'Thời gian zoom in của icon (giây)' })
    iconZoomInDuration: number = 0.3;

    @property({ tooltip: 'Độ trễ trước khi icon bay đi (giây)' })
    iconFlyDelay: number = 1.0;

    @property({ tooltip: 'Thời gian icon bay vào target (giây)' })
    iconFlyDuration: number = 0.8;

    @property({ tooltip: 'Thời gian zoom out của icon (giây)' })
    iconZoomOutDuration: number = 0.3;

    @property({ tooltip: 'Thời gian fade in nhanh (giây)' })
    fadeInDuration: number = 0.2;

    @property({ tooltip: 'Thời gian giữ màn chắn (giây)' })
    holdDuration: number = 1.0;

    @property({ tooltip: 'Thời gian fade out nhanh (giây)' })
    fadeOutDuration: number = 0.2;

    @property({ type: Node, tooltip: 'Flash node' })
    flashNode: Node | null = null;

    private _isPlaying: boolean = false;
    private _finishCb: (() => void) | null = null;

    // ─── LIFECYCLE ───

    onLoad(): void {
        this.node.active = false; // ẩn cho đến khi event trigger
        EventBus.instance.on(GameEvents.GUIDE_COMPLETE, this._onGuideComplete, this);
    }

    onDestroy(): void {
        this._cleanupRunningTweens();
        EventBus.instance.offTarget(this);
    }

    // ─── TRANSITION EFFECT ───

    private _onGuideComplete(): void {
        if (this._isPlaying) return;
        this._isPlaying = true;
        this.node.active = true;
        SoundManager.instance?.playNormalIntro();
        this.playIconFlyAnimation();
    }

    /**
     * Flow:
     *   - Bắt đầu: play Idle_LV6 loop trên icon spine + effectNode particle
     *   - delay → zoom 0→1.3→1 (bounce) → giữ
     *   - Bắt đầu bay: stop effectNode + play LV6_transition_LV0
     *   - Bay vào target: effectNode2 particle → targetNode hiện
     */
    playIconFlyAnimation(): void {
        if (!this.iconNode || !this.targetNode) {
            this._isPlaying = false;
            return;
        }
        this._cleanupRunningTweens();

        // targetNode ẩn đi, iconNode active nhưng scale=0 để ẩn (tween cần node active mới chạy)
        this.targetNode.active = false;
        this.iconNode.active = true;
        this.iconNode.setScale(new Vec3(0, 0, 0));

        // 1. Mới vào: play loop Idle_LV6 trên icon spine
        const skel = this.iconNode.getComponent(sp.Skeleton);
        if (skel) {
            skel.setAnimation(0, 'Idle_LV6', true);
        }

        // 2. Mới vào: play particle effectNode
        if (this.effectNode) {
            this.effectNode.active = true;
            for (const ps of this.effectNode.getComponentsInChildren(ParticleSystem)) {
                ps.stop(); ps.play();
            }
        }

        const uiOpacity = this.iconNode.getComponent(UIOpacity);
        if (uiOpacity) uiOpacity.opacity = 255;

        // Tính vị trí target trong local space của parent iconNode
        const targetWorldPos = this.targetNode.getWorldPosition();
        const targetLocalPos = new Vec3();
        if (this.iconNode.parent) {
            this.iconNode.parent.inverseTransformPoint(targetLocalPos, targetWorldPos);
        } else {
            Vec3.copy(targetLocalPos, targetWorldPos);
        }

        // Tính scale target theo world scale (tránh parent scale != 1)
        const targetWorldScale = new Vec3();
        this.targetNode.getWorldScale(targetWorldScale);
        const iconParentWorldScale = new Vec3(1, 1, 1);
        if (this.iconNode.parent) {
            this.iconNode.parent.getWorldScale(iconParentWorldScale);
        }
        const targetLocalScale = new Vec3(
            targetWorldScale.x / iconParentWorldScale.x,
            targetWorldScale.y / iconParentWorldScale.y,
            targetWorldScale.z / iconParentWorldScale.z,
        );

        tween(this.iconNode)
            // Delay 1 giây trước khi xuất hiện (scale=0 trong thời gian này)

            // Zoom nhanh ra 0 → 1.3
            .to(this.iconZoomInDuration, { scale: new Vec3(1.3, 1.3, 1.3) })
            // Bounce nhẹ nhảy về 1
            .to(this.iconZoomOutDuration, { scale: new Vec3(1, 1, 1) })
            // Giữ yên 1 giây
            .delay(this.iconFlyDelay)
            // Vừa bắt đầu bay: stop effectNode + play LV6_transition_LV{potLevel}
            .call(() => {
                if (this.effectNode) {
                    for (const ps of this.effectNode.getComponentsInChildren(ParticleSystem)) ps.stop();
                    this.effectNode.active = false;
                }
                if (this.flashNode) this.flashNode.active = false;
                if (skel) {
                    const potLevel = GameData.instance.potLevel;
                    skel.setAnimation(0, `LV6_trainsition_LV${potLevel}`, false);
                }
            })
            // Thu nhỏ về scale thực sự của targetNode và bay vào target
            .to(this.iconFlyDuration,
                {
                    scale: targetLocalScale,
                    position: targetLocalPos,
                },
                { easing: easing.cubicInOut }
            )
            .call(() => {
                // Đến đích: play effectNode2 particle
                if (this.effectNode2 && this.targetNode) {
                    this.effectNode2.setWorldPosition(this.targetNode.getWorldPosition());
                    this.effectNode2.active = true;
                    for (const ps of this.effectNode2.getComponentsInChildren(ParticleSystem)) {
                        ps.stop(); ps.play();
                    }
                }
                this.targetNode!.active = true;
                // Giữ iconNode hiển thị ở vị trí đích cho đến khi node chính ẩn
                // Delay ẩn icon + overlay để hiệu ứng kịp hiển thị
                this._finishCb = () => {
                    this._finishCb = null;
                    this.iconNode!.active = false;
                    this.node.active = false;
                    this._isPlaying = false;
                    // Emit TRANSITION_DONE sau khi transition mất hẳn — PotController mới bật spine
                    EventBus.instance.emit(GameEvents.TRANSITION_DONE);
                };
                this.scheduleOnce(this._finishCb, 1.5);
            })
            .start();

        // Mờ dần khi bay (bắt đầu từ lúc zoom in + bounce + hold delay)
        if (uiOpacity) {
            tween(uiOpacity)
                .delay(1.0 + this.iconZoomInDuration + this.iconZoomOutDuration + this.iconFlyDelay)
                .to(this.iconFlyDuration, { opacity: 0 })
                .start();
        }
    }

    private _cleanupRunningTweens(): void {
        if (this._finishCb) {
            this.unschedule(this._finishCb);
            this._finishCb = null;
        }
        if (this.iconNode) tween(this.iconNode).stop();
        const uiOpacity = this.iconNode?.getComponent(UIOpacity);
        if (uiOpacity) tween(uiOpacity).stop();
        for (const fx of [this.effectNode, this.effectNode2]) {
            if (!fx) continue;
            for (const ps of fx.getComponentsInChildren(ParticleSystem)) {
                ps.stop();
            }
            fx.active = false;
        }
    }
}
