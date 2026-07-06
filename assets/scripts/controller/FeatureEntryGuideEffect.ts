/**
 * FeatureEntryGuideEffect — Hiệu ứng nữ thần "dẫn dắt" vào Feature.
 *
 * ★ FEATURE ENTRY LOGIC ADDED (Concept & System Design v260610, trang 19–20)
 *
 * Khi Force Feature Entry (Sticky < 6 nhưng trúng xác suất vào Feature), nhân vật
 * nữ thần xuất hiện dẫn người chơi vào Feature theo timeline 3 phase:
 *   • Appear (0.0 ~ 0.8s):  làm tối reel/nền (vignette) + spotlight + backlight/halo,
 *                            nhân vật hiện với scale-up (kèm freeze 0.2~0.4s trước).
 *   • Hold   (0.9 ~ 2.6s):  idle motion (thở, tóc, váy) + highlight lướt trên trang sức.
 *   • Exit   (2.7 ~ 3.0s):  light burst white-out — quầng sáng bùng phủ màn hình rồi tắt,
 *                            lúc này reel screen đã sẵn sàng ở dưới.
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo Node "FeatureEntryGuide" (full-screen, trên cùng z-order), active=false.
 *   2. Gắn component này vào node đó.
 *   3. Kéo node overlay tối (đen mờ full màn hình) vào `dimNode`.
 *   4. Kéo node nhân vật vào `characterNode` (hoặc gắn Spine → `characterSpine`).
 *      - Nếu dùng Spine: đặt tên animation `Appear`, `Idle`, `Exit` (tùy chỉnh bên dưới).
 *   5. Kéo node "flash trắng" full màn hình vào `whiteFlashNode`.
 *   6. (Optional) Kéo AudioClip vào `sfxAppear`.
 *
 * Component tự lắng nghe FEATURE_ENTRY_GUIDE_SHOW và emit FEATURE_ENTRY_GUIDE_DONE khi xong.
 */

import {
    _decorator, Component, Node, sp, tween, Tween, Vec3, UIOpacity, AudioClip,
} from 'cc';
import { EventBus }     from '../core/EventBus';
import { GameEvents }   from '../core/GameEvents';
import { Log }          from '../core/Logger';
import { SoundManager } from '../manager/SoundManager';

const { ccclass, property } = _decorator;

@ccclass('FeatureEntryGuideEffect')
export class FeatureEntryGuideEffect extends Component {

    @property({ type: Node, tooltip: 'Overlay tối (vignette) full màn hình — fade in khi Appear.' })
    dimNode: Node | null = null;

    @property({ type: Node, tooltip: 'Node nhân vật nữ thần (dùng khi KHÔNG có Spine).' })
    characterNode: Node | null = null;

    @property({ type: sp.Skeleton, tooltip: 'Spine nhân vật (ưu tiên hơn characterNode nếu có).' })
    characterSpine: sp.Skeleton | null = null;

    @property({ type: Node, tooltip: 'Node flash trắng full màn hình — light burst white-out khi Exit.' })
    whiteFlashNode: Node | null = null;

    @property({ type: AudioClip, tooltip: 'SFX khi nhân vật xuất hiện (optional).' })
    sfxAppear: AudioClip | null = null;

    // ─── Spine animation names ───
    @property({ tooltip: 'Tên animation Spine lúc xuất hiện.' })
    animAppear: string = 'Appear';
    @property({ tooltip: 'Tên animation Spine lúc hold (loop).' })
    animIdle: string = 'Idle';
    @property({ tooltip: 'Tên animation Spine lúc thoát.' })
    animExit: string = 'Exit';

    // ─── Timeline (giây) ───
    @property({ tooltip: 'Thời lượng phase Appear.' })
    appearDuration: number = 0.8;
    @property({ tooltip: 'Thời lượng phase Hold.' })
    holdDuration: number = 1.8;
    @property({ tooltip: 'Thời lượng phase Exit (light burst).' })
    exitDuration: number = 0.4;

    private _playing: boolean = false;

    onLoad(): void {
        EventBus.instance.on(GameEvents.FEATURE_ENTRY_GUIDE_SHOW, this._play, this);
        this._hideAll();
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    private _hideAll(): void {
        this.node.active = false;
        this._setOpacity(this.dimNode, 0);
        this._setOpacity(this.whiteFlashNode, 0);
        if (this.whiteFlashNode) this.whiteFlashNode.active = false;
        if (this.characterNode) this.characterNode.active = false;
    }

    private _play(): void {
        if (this._playing) return;
        this._playing = true;
        this.node.active = true;

        SoundManager.instance?.playSFX(this.sfxAppear);
        this._phaseAppear();
    }

    // ─── PHASE 1: APPEAR (spotlight + backlight + scale-up) ───
    private _phaseAppear(): void {
        // Vignette tối dần
        if (this.dimNode) {
            this.dimNode.active = true;
            this._setOpacity(this.dimNode, 0);
            const op = this.dimNode.getComponent(UIOpacity);
            if (op) tween(op).to(this.appearDuration * 0.6, { opacity: 200 }).start();
        }

        if (this.characterSpine) {
            this.characterSpine.node.active = true;
            this.characterSpine.setAnimation(0, this.animAppear, false);
            this.characterSpine.setCompleteListener(() => {
                this.characterSpine!.setCompleteListener(null);
                this.characterSpine!.setAnimation(0, this.animIdle, true);
            });
            this.scheduleOnce(() => this._phaseExit(), this.appearDuration + this.holdDuration);
            return;
        }

        // Fallback không Spine: scale-up + fade-in nhân vật
        if (this.characterNode) {
            this.characterNode.active = true;
            this.characterNode.setScale(0.7, 0.7, 1);
            this._setOpacity(this.characterNode, 0);
            const cop = this.characterNode.getComponent(UIOpacity);
            if (cop) tween(cop).to(this.appearDuration, { opacity: 255 }).start();
            tween(this.characterNode)
                .to(this.appearDuration, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                // Hold: idle "thở" nhẹ
                .repeatForever(
                    tween<Node>()
                        .to(this.holdDuration * 0.5, { scale: new Vec3(1.02, 1.02, 1) })
                        .to(this.holdDuration * 0.5, { scale: new Vec3(1, 1, 1) })
                )
                .start();
        }
        this.scheduleOnce(() => this._phaseExit(), this.appearDuration + this.holdDuration);
    }

    // ─── PHASE 3: EXIT (light burst white-out) ───
    private _phaseExit(): void {
        if (this.characterSpine) {
            this.characterSpine.setAnimation(0, this.animExit, false);
        }
        if (this.characterNode) {
            Tween.stopAllByTarget(this.characterNode);
        }

        if (this.whiteFlashNode) {
            this.whiteFlashNode.active = true;
            this._setOpacity(this.whiteFlashNode, 0);
            const op = this.whiteFlashNode.getComponent(UIOpacity) ?? this.whiteFlashNode.addComponent(UIOpacity);
            tween(op)
                .to(this.exitDuration * 0.5, { opacity: 255 })
                .call(() => { this._finish(); })
                .to(this.exitDuration * 0.5, { opacity: 0 })
                .call(() => { this._hideAll(); })
                .start();
        } else {
            this._finish();
            this._hideAll();
        }
    }

    /** Reel screen đã được swap ở dưới lúc flash che kín → emit DONE. */
    private _finish(): void {
        if (!this._playing) return;
        this._playing = false;
        Log.d('[FeatureEntryGuide] done — emit FEATURE_ENTRY_GUIDE_DONE');
        EventBus.instance.emit(GameEvents.FEATURE_ENTRY_GUIDE_DONE);
    }

    private _setOpacity(node: Node | null, value: number): void {
        if (!node) return;
        const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        op.opacity = value;
    }
}
