/**
 * CreditFlyInEffect — Animation bay SpriteNumber node (credit label) từ symbol Đỏ vào EachWin.
 *
 * ── FLOW ──
 *   1. GameManager emit CREDIT_FLY_IN_START { stickyCells, sumCredit }
 *   2. Sort cells: trái→phải (reel 0→4), trên→dưới visual (row 2→0)
 *   3. Lần lượt với stagger delay:
 *      a. Lấy SpriteNumber.node của SymbolView tương ứng (đã visible trên reel)
 *      b. Re-parent node đó lên this.node — giữ nguyên world position (setParent worldStays=true)
 *      c. Tween bay về eachWinNode + thu nhỏ scale → 0.15
 *      d. Khi đến nơi: cộng credit vào eachWinSpriteNumber (+ pulse), destroy node
 *   4. Sau tất cả bay xong → emit CREDIT_FLY_IN_DONE
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo Node "CreditFlyLayer" con của Canvas, position=(0,0).
 *      Gắn UITransform cùng kích thước Canvas. Gắn component này.
 *   2. Kéo "eachWinNode"          — Node đích (EachWin hiển thị tổng).
 *   3. Kéo "eachWinSpriteNumber"  — SpriteNumber trên EachWin node.
 *   4. Kéo "slotMachine"          — SlotMachineController.
 *
 * ── ROW MAPPING ──
 *   row 0 = visual Bot = symbolNodes[3]
 *   row 1 = visual Mid = symbolNodes[2]
 *   row 2 = visual Top = symbolNodes[1]   (nodeIndex = 3 - row)
 *   Visual top-to-bottom = sort row DESC (2→1→0)
 */

import {
    _decorator, Component, Node, tween, Vec3, Tween, UITransform, isValid,
    NodePool, instantiate, ParticleSystem,
} from 'cc';
import { EventBus }              from '../core/EventBus';
import { GameEvents }            from '../core/GameEvents';
import { StickyCell, SymbolId }  from '../data/SlotTypes';
import { Log }                   from '../core/Logger';
import { SlotMachineController } from './SlotMachineController';
import { SymbolView }            from './SymbolView';
import { SpriteNumber }          from '../core/SpriteNumber';
import { AutoSpinManager }       from '../manager/AutoSpinManager';
import { SoundManager }          from '../manager/SoundManager';

const { ccclass, property } = _decorator;

/** Payload cho CREDIT_FLY_IN_START */
export interface CreditFlyInPayload {
    stickyCells: StickyCell[];
    sumCredit: number;
}

@ccclass('CreditFlyInEffect')
export class CreditFlyInEffect extends Component {

    // ── INSPECTOR ──────────────────────────────────────────────────────────────

    @property({
        type: Node,
        tooltip: 'Node đích mà credit bay vào (EachWin node trên UI).',
    })
    eachWinNode: Node | null = null;

    @property({
        type: SpriteNumber,
        tooltip: 'SpriteNumber hiển thị tổng credit tích lũy trên EachWin.\nMỗi khi 1 credit bay đến sẽ cộng thêm vào đây.',
    })
    eachWinSpriteNumber: SpriteNumber | null = null;

    @property({
        type: SlotMachineController,
        tooltip: 'Tham chiếu SlotMachineController để lấy reels → symbolNodes.',
    })
    slotMachine: SlotMachineController | null = null;

    @property({
        type: Node,
        tooltip: 'Node particle effect phát khi credit đến EachWin (có thể null).',
    })
    eachWinParticle: Node | null = null;

    @property({ tooltip: 'Delay giữa mỗi credit bắt đầu bay (giây).' })
    flyStagger: number = 1;

    @property({ tooltip: 'Thời gian tween bay 1 label từ symbol đến EachWin (giây).' })
    flyDuration: number = 1;

    @property({
        type: Node,
        tooltip: 'Node mẫu (active=false) chứa ParticleSystem2D — sẽ được clone ra khi cần, dùng pool tái sử dụng.',
    })
    symbolHitParticleTemplate: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Layer hiển thị particle effect (nằm trên symbol đồ trong canvas). Nếu để trống sẽ dùng node của component này.',
    })
    particleLayer: Node | null = null;

    // ── STATE ──────────────────────────────────────────────────────────────────

    private _runningTotal: number = 0;
    private _isPlaying: boolean = false;
    private _eachWinBaseScale: Vec3 = new Vec3(1, 1, 1);
    private _particlePool: NodePool = new NodePool();

    /** Hệ số tốc độ dựa trên speed mode (NORMAL=1, QUICK=0.5, TURBO=0.33) */
    private get _tm(): number {
        return AutoSpinManager.instance.getTimingMultiplier();
    }

    /** Track các symbolNode bị reparent sang topNode để restore khi tween bị interrupt */
    private _pendingSymbolReparents: Map<Node, { origParent: Node | null; origSibling: number }> = new Map();
    /** Track các creditNode bị reparent sang CreditFlyLayer để restore khi tween bị interrupt */
    private _pendingCreditReparents: Map<Node, { origParent: Node | null; origLocalPos: Vec3 }> = new Map();

    // ── LIFECYCLE ──────────────────────────────────────────────────────────────

    onLoad(): void {
        EventBus.instance.on(GameEvents.CREDIT_FLY_IN_START, this._onFlyInStart, this);
        // Khi reel bắt đầu spin → force-restore toàn bộ node bị reparent để tránh kẹt sai parent
        EventBus.instance.on(GameEvents.REELS_START_SPIN, this._onReelsStartSpin, this);
        EventBus.instance.on(GameEvents.TOPUP_START, this._onFeatureModeChanged, this);
        EventBus.instance.on(GameEvents.TOPUP_END, this._onFeatureModeChanged, this);
        EventBus.instance.on(GameEvents.FREE_SPIN_START, this._onFeatureModeChanged, this);
        EventBus.instance.on(GameEvents.FREE_SPIN_END, this._onFeatureModeChanged, this);
        EventBus.instance.on(GameEvents.FREE_SPIN_GOLD_START, this._onFeatureModeChanged, this);
        EventBus.instance.on(GameEvents.FREE_SPIN_GOLD_END, this._onFeatureModeChanged, this);
        // Ẩn mặc định — chỉ hiện khi fly effect đang chạy
        this.node.active = false;
        if (this.eachWinNode) this.eachWinNode.active = false;
    }

    onDestroy(): void {
        this._cancelActiveFly();
        EventBus.instance.offTarget(this);
    }

    // ── EVENT HANDLER ──────────────────────────────────────────────────────────

    /** Khi reel bắt đầu spin → force-restore toàn bộ symbol/credit node bị reparent để tránh kẹt sai parent */
    private _onReelsStartSpin(): void {
        this._cancelActiveFly();
    }

    private _onFeatureModeChanged(): void {
        this._cancelActiveFly();
    }

    private _cancelActiveFly(): void {
        this.unscheduleAllCallbacks();
        this._isPlaying = false;

        for (const [node, data] of this._pendingSymbolReparents) {
            if (isValid(node) && data.origParent && data.origParent.isValid && node.parent !== data.origParent) {
                Tween.stopAllByTarget(node);
                node.setParent(data.origParent, true);
                SymbolView.placeOnTopInParent(node, data.origParent);
                node.setScale(1, 1, 1);
            }
        }
        this._pendingSymbolReparents.clear();

        for (const [node, data] of this._pendingCreditReparents) {
            if (isValid(node) && data.origParent && data.origParent.isValid && node.parent !== data.origParent) {
                Tween.stopAllByTarget(node);
                node.setParent(data.origParent);
                node.setPosition(data.origLocalPos);
                node.setScale(1, 1, 1);
                node.active = false;
            }
        }
        this._pendingCreditReparents.clear();

        if (this.eachWinSpriteNumber?.node) {
            Tween.stopAllByTarget(this.eachWinSpriteNumber.node);
        }
        if (this.eachWinNode) this.eachWinNode.active = false;
        this.node.active = false;
    }

    private _onFlyInStart(payload: CreditFlyInPayload): void {
        if (this._isPlaying) return;
        this._isPlaying = true;
        this.scheduleOnce(() => this._startFlyIn(payload), 0);
    }

    private _startFlyIn(payload: CreditFlyInPayload): void {
        this._runningTotal = 0;

        // Hiện CreditFlyLayer khi bắt đầu animation
        this.node.active = true;

        if (this.eachWinSpriteNumber) {
            // Capture base scale once (may differ from 1 if set in editor)
            this._eachWinBaseScale = this.eachWinSpriteNumber.node.scale.clone();
            this.eachWinSpriteNumber.setData(0);
            this.eachWinSpriteNumber.node.active = true;
        }
        if (this.eachWinNode) this.eachWinNode.active = true;

        const payloadReds = payload.stickyCells
            .filter(c => c.symbolId === SymbolId.STICKY_RED)
            .sort((a, b) => {
                if (a.reel !== b.reel) return a.reel - b.reel;
                return b.row - a.row;
            });

        const reds = this._collectVisibleFlyReds(payloadReds);

        if (reds.length === 0) {
            this._finish();
            return;
        }

        Log.d(`[CreditFlyInEffect] Start — payloadReds=${payloadReds.length}, flyReds=${reds.length}, stagger=${this.flyStagger}s: ${reds.map(c => `r${c.reel}row${c.row}`).join(', ')}`);

        for (let i = 0; i < reds.length; i++) {
            const cell   = reds[i];
            const isLast = i === reds.length - 1;
            this.scheduleOnce(() => this._flyOneCredit(cell, isLast), i * this.flyStagger * this._tm);
        }
    }

    // ── FLY ONE CREDIT ────────────────────────────────────────────────────────

    private _flyOneCredit(cell: StickyCell, isLast: boolean): void {
        const onFail = () => {
            this._runningTotal += cell.credit;
            if (this.eachWinSpriteNumber) this.eachWinSpriteNumber.setData(this._runningTotal);
            if (isLast) this.scheduleOnce(() => this._finish(), 0.3 * this._tm);
        };

        if (!this.slotMachine || !this.eachWinNode) { onFail(); return; }

        const target = this._getFlyTarget(cell);
        if (!target) { onFail(); return; }

        const { symbolNode, view } = target;

        // Spawn particle hit ngay khi xác nhận có red symbol hợp lệ trên reel
        // — trước khi check creditNode để không bị bỏ qua trong edge case credit chưa active
        Log.d(`[CreditFly] _flyOneCredit r${cell.reel}row${cell.row} → calling _spawnHitParticle, template=${this.symbolHitParticleTemplate?.name ?? 'null'}`);
        this._spawnHitParticle(symbolNode.worldPosition);

        const creditNode = view.SpriteNumber?.node ?? null;

        if (!creditNode || !creditNode.active) {
            onFail();
            return;
        }


        // Zoom effect on the symbol node when credit departs — reparent sang top node để vẽ chồng lên tất cả
        const symScale = symbolNode.scale.clone();
        Tween.stopAllByTarget(symbolNode);
        const topNode = SymbolView.landBounceParent;
        let symOrigParent: Node | null = null;
        let symOrigSibling = 0;
        if (topNode && topNode.isValid && symbolNode.parent !== topNode) {
            symOrigParent = symbolNode.parent;
            symOrigSibling = symbolNode.getSiblingIndex();
            this._pendingSymbolReparents.set(symbolNode, { origParent: symOrigParent, origSibling: symOrigSibling });
            symbolNode.setParent(topNode, true);
            symbolNode.setSiblingIndex(topNode.children.length - 1);
        } else if (topNode && topNode.isValid && symbolNode.parent === topNode) {
            symbolNode.setSiblingIndex(topNode.children.length - 1);
        }
        tween(symbolNode)
            .to(0.08 * this._tm, { scale: new Vec3(symScale.x * 1.12, symScale.y * 1.12, symScale.z) })
            .delay(0.5 * this._tm)
            .to(0.5 * this._tm, { scale: symScale }, { easing: 'sineOut' })
            .call(() => {
                if (isValid(symbolNode) && symOrigParent && symOrigParent.isValid) {
                    if (symbolNode.parent !== symOrigParent) {
                        symbolNode.setParent(symOrigParent, true);
                    }
                    SymbolView.placeOnTopInParent(symbolNode, symOrigParent);
                }
                this._pendingSymbolReparents.delete(symbolNode);
            })
            .start();

        // Ghi nhớ parent gốc để re-parent sau khi tween xong (tránh destroy node của SymbolView)
        const originalParent = creditNode.parent;
        const originalLocalPos = creditNode.position.clone();
        this._pendingCreditReparents.set(creditNode, { origParent: originalParent, origLocalPos: originalLocalPos.clone() });

        creditNode.setParent(this.node, true);

        const dstWorldPos = this.eachWinNode.worldPosition.clone();
        const dstLocal    = this._worldToLocal(dstWorldPos);

        Tween.stopAllByTarget(creditNode);
        creditNode.setScale(1, 1, 1);

        // Phase 1: bay đến đích, giữ nguyên scale
        // Phase 2: đến nơi mới thu nhỏ về 0.15
        const flyTime    = this.flyDuration * 0.9 * this._tm;
        const shrinkTime = this.flyDuration * 0.1 * this._tm;
        tween(creditNode)
            .to(flyTime, {
                position: new Vec3(dstLocal.x, dstLocal.y, 0),
            }, { easing: 'sineIn' })
            .to(shrinkTime, {
                scale: new Vec3(0.15, 0.15, 1),
            }, { easing: 'sineIn' })
            .call(() => {
                this._runningTotal += cell.credit;
                SoundManager.instance?.playBonusTrail();
                if (this.eachWinSpriteNumber) {
                    this.eachWinSpriteNumber.setData(this._runningTotal);
                    const sn  = this.eachWinSpriteNumber.node;
                    const bs  = sn.scale.clone(); // scale hiện tại sau shrinkToFit, không cứng về 1
                    const bp  = sn.position.clone();
                    Tween.stopAllByTarget(sn);
                    sn.setScale(bs.x, bs.y, bs.z);
                    sn.setPosition(bp);
                    tween(sn)
                        .to(0.14 * this._tm, { scale: new Vec3(bs.x * 0.7, bs.y * 0.7, bs.z) })
                        .to(0.08 * this._tm, { scale: bs.clone() }, { easing: 'backOut' })
                        .start();
                }
                // Play particle if assigned
                if (this.eachWinParticle) {
                    this.eachWinParticle.active = true;
                    for (const ps of this.eachWinParticle.getComponentsInChildren(ParticleSystem)) {
                        ps.stop();
                        ps.play();
                    }
                }
                // Không destroy node của SymbolView — re-parent về chỗ cũ và ẩn đi
                Tween.stopAllByTarget(creditNode);
                if (isValid(originalParent)) {
                    creditNode.setParent(originalParent);
                    creditNode.setPosition(originalLocalPos);
                    creditNode.setScale(1, 1, 1);
                }
                creditNode.active = false;
                this._pendingCreditReparents.delete(creditNode);
                if (isLast) {
                    this.scheduleOnce(() => this._finish(), 0.35 * this._tm);
                }
            })
            .start();
    }

    // ── HELPERS ───────────────────────────────────────────────────────────────

    private _worldToLocal(worldPos: Vec3): Vec3 {
        const tf = this.node.getComponent(UITransform);
        if (tf) return tf.convertToNodeSpaceAR(worldPos);
        return worldPos.clone();
    }

    private _collectVisibleFlyReds(cells: StickyCell[]): StickyCell[] {
        const visible: StickyCell[] = [];
        const skipped: string[] = [];

        for (const cell of cells) {
            const target = this._getFlyTarget(cell);
            if (!target) {
                skipped.push(`r${cell.reel}row${cell.row}:no-target`);
                continue;
            }

            const { view } = target;
            if (view.symbolId !== SymbolId.STICKY_RED) {
                skipped.push(`r${cell.reel}row${cell.row}:visual=${SymbolId[view.symbolId] ?? view.symbolId}`);
                continue;
            }
            if (!view.SpriteNumber) {
                skipped.push(`r${cell.reel}row${cell.row}:no-credit-label`);
                continue;
            }
            if (!view.SpriteNumber.node.active) {
                view.showCredit(cell.credit);
            }
            visible.push(cell);
        }

        if (skipped.length > 0) {
            Log.w(`[CreditFlyInEffect] Skip non-visible/mismatched red cells (${skipped.length}): ${skipped.join(', ')}`);
        }
        return visible;
    }

    private _getFlyTarget(cell: StickyCell): { symbolNode: Node; view: SymbolView } | null {
        if (!this.slotMachine) return null;
        const reel = this.slotMachine.reels[cell.reel];
        if (!reel) return null;

        const nodeIndex = 3 - cell.row;
        const symbolNode = reel.symbolNodes[nodeIndex];
        if (!symbolNode) return null;

        const view = symbolNode.getComponent(SymbolView);
        if (!view) return null;
        return { symbolNode, view };
    }

    // ── PARTICLE HIT POOL ──────────────────────────────────────────────────────

    /**
     * Spawn particle hit effect tai worldPos.
     * Node lay tu pool (hoac instantiate moi), dat vi tri, resetSystem de play,
     * sau duration thi tra lai pool.
     */
    private _spawnHitParticle(worldPos: Vec3): void {
        if (!this.symbolHitParticleTemplate) {
            Log.w('[CreditFly] _spawnHitParticle SKIP: symbolHitParticleTemplate is null');
            return;
        }
        if (!isValid(this.node)) {
            Log.w('[CreditFly] _spawnHitParticle SKIP: this.node invalid');
            return;
        }

        // Layer đặt particle: uu tien particleLayer, fallback this.node
        const layer = (this.particleLayer && isValid(this.particleLayer))
            ? this.particleLayer
            : this.node;

        const layerUT = layer.getComponent(UITransform)
            ?? layer.addComponent(UITransform);

        // Moi symbol duoc cap 1 node rieng tu pool (khong dung chung)
        let fxNode: Node;
        const pooled = this._particlePool.get();
        if (pooled && isValid(pooled)) {
            fxNode = pooled;
            Log.d(`[CreditFly] _spawnHitParticle: reuse from pool, pool size after get=${this._particlePool.size()}`);
        } else {
            fxNode = instantiate(this.symbolHitParticleTemplate);
            Log.d(`[CreditFly] _spawnHitParticle: instantiate new node from template "${this.symbolHitParticleTemplate.name}"`);
        }

        fxNode.setParent(layer);
        fxNode.active = true;

        const localPos = layerUT.convertToNodeSpaceAR(worldPos);
        fxNode.setPosition(localPos.x, localPos.y, 0);
        Log.d(`[CreditFly] _spawnHitParticle: worldPos=(${worldPos.x.toFixed(1)},${worldPos.y.toFixed(1)}) → localPos=(${localPos.x.toFixed(1)},${localPos.y.toFixed(1)}) layer="${layer.name}"`);

        const ps = fxNode.getComponent(ParticleSystem);
        if (!ps) {
            Log.w(`[CreditFly] _spawnHitParticle: NO ParticleSystem on node "${fxNode.name}" — returning to pool`);
            fxNode.active = false;
            this._particlePool.put(fxNode);
            return;
        }

        ps.stop();
        ps.play();
        Log.d(`[CreditFly] _spawnHitParticle: ps.play() — duration=${ps.duration}, capacity=${ps.capacity}`);

        // Tra lai pool sau khi particle chay xong (duration + buffer)
        const returnDelay = (ps.duration > 0 ? ps.duration : 1.0) + 0.2;
        this.scheduleOnce(() => {
            if (isValid(fxNode)) {
                ps.stop();
                fxNode.active = false;
                this._particlePool.put(fxNode);
                Log.d(`[CreditFly] _spawnHitParticle: returned to pool after ${returnDelay.toFixed(2)}s, pool size=${this._particlePool.size()}`);
            }
        }, returnDelay);
    }

    private _finish(): void {
        this._isPlaying = false;
        // Ẩn lại CreditFlyLayer và eachWinNode sau khi fly xong
        if (this.eachWinNode) this.eachWinNode.active = false;
        this.node.active = false;
        Log.e(`[CreditFlyInEffect] Done — runningTotal=${this._runningTotal}`);
        EventBus.instance.emit(GameEvents.CREDIT_FLY_IN_DONE, { sumCredit: this._runningTotal });
    }
}
