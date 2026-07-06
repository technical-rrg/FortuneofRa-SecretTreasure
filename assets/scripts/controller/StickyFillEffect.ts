/**
 * StickyFillEffect — Hiệu ứng "đổ" Sticky đủ 6 khi Force Feature Entry.
 *
 * ★ FEATURE ENTRY LOGIC ADDED (Concept & System Design v260610, trang 21–26)
 *
 * Phase 1 – Pot charge
 * → Phase 2 orb bay từ Pot (lần lượt từng quả)
 * → Phase 3 impact tại ô đích
 * → Phase 4 convert symbol tại ô đó thành Sticky đỏ + nhún land
 * → lặp cho từng fillCell → Phase 5 emit STICKY_FILL_DONE.
 *
 * Doc: mỗi orb bay → chạm → 1 symbol đổi thành Sticky (không đổ hàng loạt cùng lúc).
 */

import {
    _decorator, Component, Node, instantiate, tween, Tween, Vec3, NodePool, AudioClip,
} from 'cc';
import { EventBus }               from '../core/EventBus';
import { GameEvents }             from '../core/GameEvents';
import { Log }                    from '../core/Logger';
import { SoundManager }           from '../manager/SoundManager';
import { StickyCell, ForceFeatureEntryData } from '../data/SlotTypes';
import { SlotMachineController }  from './SlotMachineController';
import { SymbolView }             from './SymbolView';

const { ccclass, property } = _decorator;

@ccclass('StickyFillEffect')
export class StickyFillEffect extends Component {

    @property({ type: SlotMachineController, tooltip: 'SlotMachineController — lấy symbolNodes trên reel.' })
    slotMachine: SlotMachineController | null = null;

    @property({ type: Node, tooltip: 'Node Pot — điểm xuất phát orb.' })
    potNode: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Node mẫu light orb trên scene (active=false). Runtime clone/pool, xong trả pool.',
    })
    orbTemplate: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Node mẫu hiệu ứng chạm đất (optional, active=false). Clone/pool giống orb.',
    })
    landEffectTemplate: Node | null = null;

    @property({ type: Node, tooltip: 'Node rung màn hình khi orb chạm (optional).' })
    screenShakeNode: Node | null = null;

    @property({ type: AudioClip, tooltip: 'SFX Pot charge (Phase 1).' })
    sfxCharge: AudioClip | null = null;
    @property({ type: AudioClip, tooltip: 'SFX phóng orb (Phase 2).' })
    sfxLaunch: AudioClip | null = null;
    @property({ type: AudioClip, tooltip: 'SFX orb chạm đất (Phase 3).' })
    sfxLand: AudioClip | null = null;
    @property({ type: AudioClip, tooltip: 'SFX convert thành Sticky (Phase 4).' })
    sfxConvert: AudioClip | null = null;

    @property({ tooltip: 'Thời lượng Pot charge (Phase 1).' })
    chargeDuration: number = 0.5;
    @property({ tooltip: 'Thời gian rơi của mỗi orb (Phase 2).' })
    orbFallDuration: number = 0.55;
    @property({ tooltip: 'Khoảng cách giữa 2 orb liên tiếp (giây, sau khi orb trước chạm đích).' })
    orbLaunchInterval: number = 0.25;
    @property({ tooltip: 'Thời gian giữ land FX trước khi trả pool (giây).' })
    landFxDuration: number = 1.0;

    private _busy: boolean = false;
    private _orbPool: NodePool = new NodePool();
    private _landFxPool: NodePool = new NodePool();
    /** Orb đang bay — dọn khi cancel/destroy. */
    private _activeOrbs: Node[] = [];

    onLoad(): void {
        EventBus.instance.on(GameEvents.STICKY_FILL_START, this._onStart, this);
        this.node.active = false;
        if (this.orbTemplate) this.orbTemplate.active = false;
        if (this.landEffectTemplate) this.landEffectTemplate.active = false;
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
        this._releaseAllActiveOrbs();
        this._drainPool(this._orbPool);
        this._drainPool(this._landFxPool);
    }

    private _onStart(data: ForceFeatureEntryData): void {
        if (this._busy) return;
        const fillCells = data?.fillCells ?? [];
        if (fillCells.length === 0) {
            Log.w('[StickyFillEffect] fillCells rỗng → done ngay');
            this._finish();
            return;
        }
        this._busy = true;
        this.node.active = true;
        this._releaseAllActiveOrbs();
        Log.d(`[StickyFillEffect] start — fill ${fillCells.length} cells (sequential)`);
        this._phaseCharge(fillCells);
    }

    // ─── PHASE 1: POT CHARGE ────────────────────────────────────────────────

    private _phaseCharge(fillCells: StickyCell[]): void {
        SoundManager.instance?.playSFX(this.sfxCharge);
        if (this.potNode) {
            Tween.stopAllByTarget(this.potNode);
            tween(this.potNode)
                .to(this.chargeDuration * 0.6, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'sineOut' })
                .to(this.chargeDuration * 0.4, { scale: new Vec3(1, 1, 1) }, { easing: 'sineIn' })
                .start();
        }
        this.scheduleOnce(() => this._launchNextOrb(fillCells, 0), this.chargeDuration);
    }

    // ─── PHASE 2–4: LAUNCH → IMPACT → CONVERT (từng ô một) ─────────────────

    private _launchNextOrb(fillCells: StickyCell[], index: number): void {
        if (index >= fillCells.length) {
            this.scheduleOnce(() => this._finish(), 0.35);
            return;
        }

        const cell = fillCells[index];
        const target = this._cellWorldPos(cell);

        if (!target) {
            Log.w(`[StickyFillEffect] no target r${cell.reel}row${cell.row} → convert skip orb`);
            this._convertCell(cell);
            this.scheduleOnce(() => this._launchNextOrb(fillCells, index + 1), this.orbLaunchInterval);
            return;
        }

        if (!this.orbTemplate) {
            Log.w('[StickyFillEffect] orbTemplate chưa gán — convert không có orb bay');
            this._onOrbLand(target);
            this._convertCell(cell);
            this.scheduleOnce(() => this._launchNextOrb(fillCells, index + 1), this.orbLaunchInterval);
            return;
        }

        SoundManager.instance?.playSFX(this.sfxLaunch);
        const potPos = this.potNode?.worldPosition.clone() ?? new Vec3();
        const orb = this._acquireOrb();
        if (!orb) {
            this._onOrbLand(target);
            this._convertCell(cell);
            this.scheduleOnce(() => this._launchNextOrb(fillCells, index + 1), this.orbLaunchInterval);
            return;
        }

        orb.setWorldPosition(potPos);
        this._activeOrbs.push(orb);

        Log.d(`[StickyFillEffect] orb ${index + 1}/${fillCells.length} → r${cell.reel}row${cell.row}`);
        tween(orb)
            .to(0.1, { worldPosition: new Vec3(potPos.x, potPos.y + 60, potPos.z) })
            .to(this.orbFallDuration, { worldPosition: target }, { easing: 'quadIn' })
            .call(() => {
                this._onOrbLand(target);
                this._releaseOrb(orb);
                this._convertCell(cell);
                this.scheduleOnce(() => this._launchNextOrb(fillCells, index + 1), this.orbLaunchInterval);
            })
            .start();
    }

    private _convertCell(cell: StickyCell): void {
        SoundManager.instance?.playSFX(this.sfxConvert);
        const view = this._getSymbolView(cell);
        if (!view) {
            Log.w(`[StickyFillEffect] no SymbolView r${cell.reel}row${cell.row}`);
            return;
        }
        view.applyStickyRedFill(cell.credit ?? 0);
    }

    private _onOrbLand(worldPos: Vec3): void {
        SoundManager.instance?.playSFX(this.sfxLand);
        this._spawnLandFx(worldPos);
        this._shakeScreen();
    }

    // ─── PHASE 5: HANDOFF ───────────────────────────────────────────────────

    private _finish(): void {
        this._busy = false;
        Log.d('[StickyFillEffect] done — emit STICKY_FILL_DONE');
        EventBus.instance.emit(GameEvents.STICKY_FILL_DONE);
    }

    // ─── ORB / LAND FX POOL ─────────────────────────────────────────────────

    private _acquireOrb(): Node | null {
        if (!this.orbTemplate) return null;
        let orb = this._orbPool.get();
        if (!orb || !orb.isValid) {
            orb = instantiate(this.orbTemplate);
        }
        Tween.stopAllByTarget(orb);
        orb.setParent(this.node);
        orb.active = true;
        orb.setScale(1, 1, 1);
        return orb;
    }

    private _releaseOrb(orb: Node): void {
        if (!orb || !orb.isValid) return;
        Tween.stopAllByTarget(orb);
        orb.removeFromParent();
        orb.active = false;
        this._orbPool.put(orb);
        const idx = this._activeOrbs.indexOf(orb);
        if (idx >= 0) this._activeOrbs.splice(idx, 1);
    }

    private _releaseAllActiveOrbs(): void {
        for (const orb of [...this._activeOrbs]) {
            this._releaseOrb(orb);
        }
        this._activeOrbs.length = 0;
    }

    private _spawnLandFx(worldPos: Vec3): void {
        if (!this.landEffectTemplate) return;
        let fx = this._landFxPool.get();
        if (!fx || !fx.isValid) {
            fx = instantiate(this.landEffectTemplate);
        }
        fx.setParent(this.node);
        fx.setWorldPosition(worldPos);
        fx.active = true;
        this.scheduleOnce(() => {
            if (!fx.isValid) return;
            fx.removeFromParent();
            fx.active = false;
            this._landFxPool.put(fx);
        }, this.landFxDuration);
    }

    private _drainPool(pool: NodePool): void {
        while (pool.size() > 0) {
            const n = pool.get();
            if (n?.isValid) n.destroy();
        }
    }

    // ─── REEL CELL HELPERS ──────────────────────────────────────────────────

    /**
     * row convention (stickyCells / CreditFlyIn):
     *   row 0 = Bot → symbolNodes[4], row 1 = Mid → [3], row 2 = Top → [2].
     */
    private _symbolNodeIndex(cell: StickyCell): number {
        return 4 - cell.row;
    }

    private _getSymbolView(cell: StickyCell): SymbolView | null {
        if (!this.slotMachine) return null;
        const reel = this.slotMachine.reels[cell.reel];
        if (!reel) return null;
        const symbolNode = reel.symbolNodes[this._symbolNodeIndex(cell)];
        return symbolNode?.getComponent(SymbolView) ?? null;
    }

    private _cellWorldPos(cell: StickyCell): Vec3 | null {
        if (!this.slotMachine) return null;
        const reel = this.slotMachine.reels[cell.reel];
        if (!reel) return null;
        const symbolNode = reel.symbolNodes[this._symbolNodeIndex(cell)];
        if (!symbolNode) return null;
        return symbolNode.worldPosition.clone();
    }

    private _shakeScreen(): void {
        if (!this.screenShakeNode || !this.screenShakeNode.isValid) return;
        const base = this.screenShakeNode.position.clone();
        Tween.stopAllByTarget(this.screenShakeNode);
        tween(this.screenShakeNode)
            .to(0.04, { position: new Vec3(base.x + 4, base.y - 4, base.z) })
            .to(0.04, { position: new Vec3(base.x - 4, base.y + 2, base.z) })
            .to(0.04, { position: base })
            .start();
    }
}
