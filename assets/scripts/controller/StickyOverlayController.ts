/**
 * StickyOverlayController — Overlay hiển thị đồng xu sticky cố định trong chế độ Top Up.
 *
 * ── MỤC ĐÍCH ──
 *   Khi reel đang SPINNING, tất cả symbolNodes trong ReelController đều scroll xuống.
 *   Các đồng xu sticky (Red/Yellow/Green) thuộc layer này sẽ ở LỚP TRÊN fillback,
 *   KHÔNG liên quan đến scroll — luôn cố định ở đúng vị trí grid 5×3.
 *
 * ── LAYER ORDER TRONG SCENE ──
 *   [0] ReelContainer  (symbolNodes — cuộn khi spin)
 *   [1] FillbackFrame  (khung trang trí)
 *   [2] StickyOverlay  ← component này — trên fillback, tĩnh tuyệt đối
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo Node "StickyOverlay" con của Canvas, z-order trên FillbackFrame.
 *   2. Gắn component StickyOverlayController vào node đó.
 *   3. Tạo 15 child node (hoặc dùng prefab) — đặt tên CoinSlot_R{reel}_Row{row}.
 *      Mỗi CoinSlot cần:
 *        - Sprite component        → hình đồng xu (Red/Yellow/Green/Grand)
 *        - UIOpacity component     → dùng để fade in khi coin mới xuất hiện
 *        - Child node "CreditLabel" (optional) → SpriteNumber hiển thị credit
 *   4. Kéo 15 node đó vào mảng coinSlots theo thứ tự:
 *        index = reel * 3 + row  (row: 0=Bottom, 1=Mid, 2=Top visual)
 *        [0]=R0_Bot [1]=R0_Mid [2]=R0_Top  [3]=R1_Bot ... [14]=R4_Top
 *   5. Kéo 3 SpriteFrame vào coinFrames: [0]=Red [1]=Yellow [2]=Green  (không cần Grand nếu không có art)
 *   6. Node StickyOverlay bắt đầu với active=false — script tự bật khi TOPUP_START.
 *
 * ── ROW CONVENTION ──
 *   Theo GameData / stickyCells key `${reel}-${row}`:
 *     row 0 = visual Bottom  (symbolNodes[4])
 *     row 1 = visual Middle  (symbolNodes[3])
 *     row 2 = visual Top     (symbolNodes[2])
 */

import {
    _decorator, Component, Node, Sprite, SpriteFrame, UIOpacity, tween, Vec3, Tween,
} from 'cc';
import { EventBus }     from '../core/EventBus';
import { GameEvents }   from '../core/GameEvents';
import { GameData }     from '../data/GameData';
import { SymbolId }     from '../data/SlotTypes';
import { SpriteNumber } from '../core/SpriteNumber';
import { Log }          from '../core/Logger';
import { SoundManager } from '../manager/SoundManager';
import { SlotMachineController } from './SlotMachineController';
import { TopUpManager } from './TopUpManager';

const { ccclass, property } = _decorator;

const TOPUP_ABSORB_COIN_SCALE = 1.15;

@ccclass('StickyOverlayController')
export class StickyOverlayController extends Component {

    // ── INSPECTOR ──────────────────────────────────────────────────────────────

    @property({
        type: [Node],
        tooltip:
            '15 CoinSlot nodes theo thứ tự: index = reel * 3 + row\n' +
            '(row: 0=Bottom, 1=Mid, 2=Top visual)\n' +
            '[0]=R0_Bot [1]=R0_Mid [2]=R0_Top  [3]=R1_Bot ... [14]=R4_Top\n' +
            'Mỗi node cần Sprite component (coin image) + optional child "CreditLabel" (SpriteNumber).',
    })
    coinSlots: Node[] = [];

    @property({
        type: [SpriteFrame],
        tooltip: 'Coin sprite frames:\n[0]=Red  [1]=Yellow  [2]=Green\n(Grand có thể thêm vào [3] nếu có art)',
    })
    coinFrames: SpriteFrame[] = [];

    @property({ tooltip: 'Thời gian fade-in khi coin mới xuất hiện (giây). 0 = không fade.' })
    coinFadeInDuration: number = 0.2;

    @property({ tooltip: 'Bounce scale khi coin mới xuất hiện (1.0 = no bounce, 1.12 = 12% bigger).' })
    coinBounceScale: number = 1.12;

    @property({
        type: SlotMachineController,
        tooltip: 'Tham chiếu SlotMachineController để lấy reels → symbolNodes.',
    })
    slotMachine: SlotMachineController | null = null;


    // ── STATE ──────────────────────────────────────────────────────────────────

    /** Track which slots were active before update — to detect NEW coins */
    private _previouslyActiveSlots: Set<string> = new Set();

    /** Track last applied credit per slotNode — to avoid redundant setData() calls causing flicker */
    private _slotCreditMap: Map<Node, number> = new Map();

    /** Slots that are only a temporary +1 visual, not real stickyCells. */
    private _tempPlusOneKeys: Set<string> = new Set();

    private _coinSlotOriginalParents: Map<Node, { parent: Node | null; siblingIndex: number; spinCounter: number }> = new Map();

    private _topUpSpinCounter: number = 0;

    // ── LIFECYCLE ──────────────────────────────────────────────────────────────

    onLoad(): void {
        this.node.active = false;
        this._hideAll();

        EventBus.instance.on(GameEvents.TOPUP_START,         this._onTopUpStart,   this);
        EventBus.instance.on(GameEvents.TOPUP_TOTAL_UPDATED, this._onTopUpUpdated, this);
        EventBus.instance.on(GameEvents.TOPUP_END,           this._onTopUpEnd,     this);
        EventBus.instance.on(GameEvents.FREE_SPIN_GOLD_END, this._onTopUpEnd,     this);
        EventBus.instance.on(GameEvents.FREE_SPIN_END,       this._onTopUpEnd,     this);
        EventBus.instance.on(GameEvents.REELS_START_SPIN,   this._onReelsStartSpin, this);
    }

    onDestroy(): void {
        EventBus.instance.off(GameEvents.TOPUP_START,         this._onTopUpStart,   this);
        EventBus.instance.off(GameEvents.TOPUP_TOTAL_UPDATED, this._onTopUpUpdated, this);
        EventBus.instance.off(GameEvents.TOPUP_END,           this._onTopUpEnd,     this);
        EventBus.instance.off(GameEvents.FREE_SPIN_GOLD_END, this._onTopUpEnd,     this);
        EventBus.instance.off(GameEvents.FREE_SPIN_END,       this._onTopUpEnd,     this);
        EventBus.instance.off(GameEvents.REELS_START_SPIN,   this._onReelsStartSpin, this);
    }

    // ── EVENT HANDLERS ─────────────────────────────────────────────────────────

    private _onTopUpStart(): void {
        this.node.active = true;
        this._topUpSpinCounter = 0;
        this.clearTempPlusOne('topup-start');
        this.alignPositionsFromTopUpManager();
        this._previouslyActiveSlots.clear();
        this._refreshAll(false /* first show — fade in tất cả */);
    }

    private _onTopUpUpdated(): void {
        // Gọi sau mỗi spin Topup kết thúc — stickyCells đã được cập nhật bởi GameManager
        this._refreshAll(true /* chỉ fade in coin MỚI */);
    }

    private _onReelsStartSpin(): void {
        // ★ Khi bắt đầu spin tiếp theo: PLUS_ONE_SPIN đã bị xóa khỏi stickyCells
        // Refresh overlay để ẩn ngay các slot +1 Spin (và giữ lại coin thật)
        if (this.node.active) {
            this._topUpSpinCounter++;
            this._restoreCoinSlotParents(this._topUpSpinCounter);
            this.clearTempPlusOne('reels-start-spin');
            this._refreshAll(true /* chỉ fade in coin MỚI, coin cũ giữ nguyên */);
        }
    }

    private _onTopUpEnd(): void {
        this.clearTempPlusOne('topup-end');
        this._restoreCoinSlotParents();
        this._hideAll();
        this._previouslyActiveSlots.clear();
        this._slotCreditMap.clear();
        this._coinSlotOriginalParents.clear();
        this._topUpSpinCounter = 0;
        this.node.active = false;
    }

    // ── CORE LOGIC ─────────────────────────────────────────────────────────────

    /**
     * Refresh toàn bộ 15 ô overlay từ GameData.stickyCells.
     * @param fadeOnlyNew  true  = chỉ fade-in slot vừa được bật (slot cũ giữ nguyên)
     *                     false = ẩn hết rồi show tất cả cùng lúc (lần đầu vào Topup)
     */
    private _refreshAll(fadeOnlyNew: boolean): void {
        const cells = GameData.instance.stickyCells;
        const newActiveSlots = new Set<string>();

        // ═══ TOPUP OVERLAY DEBUG ═══
        Log.e(`[SOC-DEBUG] _refreshAll(fadeOnlyNew=${fadeOnlyNew}) — stickyCells.size=${cells.size} coinSlots.length=${this.coinSlots.length} node.active=${this.node.active}`);
        Log.e(`[SOC-DEBUG] stickyCells: ${cells.size === 0 ? '(empty)' : Array.from(cells.entries()).map(([k, c]) => `${k}=${c.symbolId === 14 ? 'YELLOW' : c.symbolId === 15 ? 'GREEN' : c.symbolId === 13 ? 'RED' : c.symbolId}($${c.credit})`).join(', ')}`);
        // ═══ END DEBUG ═══

        for (let reel = 0; reel < 5; reel++) {
            for (let row = 0; row < 3; row++) {
                const key      = `${reel}-${row}`;
                const idx      = reel * 3 + row;
                const slotNode = this.coinSlots[idx];
                if (!slotNode) continue;

                const cell = cells.get(key);

                if (!cell) {
                    if (idx < 3) {
                        Log.e(`[TOPUP-ENTER-CHECK][OVERLAY] idx=${idx} node=${slotNode.name} key=${key} cell=empty activeBefore=${slotNode.active}`);
                    }
                    // Không có coin → ẩn slot
                    Tween.stopAllByTarget(slotNode);
                    const emptyOpacity = slotNode.getComponent(UIOpacity);
                    if (emptyOpacity) {
                        Tween.stopAllByTarget(emptyOpacity);
                        emptyOpacity.opacity = 255;
                    }
                    const emptyLabel = slotNode.getChildByName('CreditLabel');
                    if (emptyLabel) {
                        Tween.stopAllByTarget(emptyLabel);
                        emptyLabel.active = false;
                        emptyLabel.setScale(1, 1, 1);
                    }
                    this._slotCreditMap.delete(slotNode);
                    this._tempPlusOneKeys.delete(key);
                    slotNode.setScale(1, 1, 1);
                    slotNode.active = false;
                    continue;
                }

                this._tempPlusOneKeys.delete(key);

                // Track active slots
                newActiveSlots.add(key);

                // Detect if this is a NEW coin (wasn't in previous set)
                const isNewCoin = !this._previouslyActiveSlots.has(key);
                const isAbsorbTarget = isNewCoin && (
                    cell.symbolId === SymbolId.STICKY_YELLOW ||
                    cell.symbolId === SymbolId.STICKY_GREEN
                );
                const creditToShow = isAbsorbTarget ? 0 : (cell.credit ?? 0);
                if (idx < 3 || cell.symbolId !== SymbolId.STICKY_RED) {
                    Log.e(
                        `[TOPUP-ENTER-CHECK][OVERLAY] idx=${idx} node=${slotNode.name} key=${key}` +
                        ` sym=${SymbolId[cell.symbolId] ?? cell.symbolId} credit=${cell.credit ?? 0}` +
                        ` fadeOnlyNew=${fadeOnlyNew} isNew=${isNewCoin}`
                    );
                }
                Log.e(`[SOC-DEBUG]   slot[${key}] idx=${idx} isNew=${isNewCoin} absorb=${isAbsorbTarget} sym=${cell.symbolId} credit=${cell.credit} showCredit=${creditToShow}`);

                // Áp dụng sprite + credit
                // NEW Yellow/Green: KHÔNG set credit — TopUpAbsorbEffect sẽ count-up
                // Existing coins hoặc Red: hiển thị credit bình thường
                this._applyCoin(slotNode, cell.symbolId, creditToShow);
                slotNode.active = true;
                if (isNewCoin) {
                    this._reparentToStickyOverlay(slotNode);
                }


                // Fade in + Bounce: chỉ cho coin MỚI hoặc lần đầu mở (fadeOnlyNew=false)
                if (!fadeOnlyNew || isNewCoin) {
                    // Fade in
                    if (this.coinFadeInDuration > 0) {
                        const op = slotNode.getComponent(UIOpacity);
                        if (op) {
                            op.opacity = 0;
                            tween(op).to(this.coinFadeInDuration, { opacity: 255 }).start();
                        }
                    }
                    // Bounce nhẹ cho coin mới (bao gồm Yellow/Green) để pop-in mượt
                    this._playCoinBounce(slotNode, cell.symbolId);
                }
            }
        }
        this._applyStickySymbolOrder();

        const prevSize = this._previouslyActiveSlots.size;
        // Update previous active slots for next refresh
        this._previouslyActiveSlots = newActiveSlots;

        const newCount = Array.from(newActiveSlots).filter(k => !Array.from({length: prevSize}).some(() => false)).length;
        Log.e(`[SOC-DEBUG] refreshAll DONE — activeSlots=${newActiveSlots.size} prevSlots=${prevSize} cells rendered on overlay`);
        Log.d(`[StickyOverlay] refreshAll(fadeOnlyNew=${fadeOnlyNew}) — stickyCells=${cells.size}/15`);
    }

    /** Ẩn tất cả 15 slot (không destroy, chỉ inactive) */
    private _hideAll(): void {
        for (const slot of this.coinSlots) {
            if (!slot) continue;
            Tween.stopAllByTarget(slot);
            const op = slot.getComponent(UIOpacity);
            if (op) {
                Tween.stopAllByTarget(op);
                op.opacity = 255;
            }
            slot.setScale(1, 1, 1);
            const labelNode = slot.getChildByName('CreditLabel');
            if (labelNode) {
                Tween.stopAllByTarget(labelNode);
                labelNode.active = false;
                labelNode.setScale(1, 1, 1);
            }
            this._slotCreditMap.delete(slot);
            slot.active = false;
        }
    }

    private _reparentToStickyOverlay(slotNode: Node): void {
        if (!slotNode || !slotNode.isValid || slotNode.parent === this.node) return;
        const existing = this._coinSlotOriginalParents.get(slotNode);
        if (!existing) {
            this._coinSlotOriginalParents.set(slotNode, {
                parent: slotNode.parent,
                siblingIndex: slotNode.getSiblingIndex(),
                spinCounter: this._topUpSpinCounter,
            });
        } else {
            existing.spinCounter = this._topUpSpinCounter;
        }
        slotNode.setParent(this.node, true);
        slotNode.setSiblingIndex(this.node.children.length - 1);
    }

    private _restoreCoinSlotParents(maxSpinCounter?: number): void {
        const toRemove: Node[] = [];
        for (const [slotNode, data] of this._coinSlotOriginalParents) {
            if (!slotNode || !slotNode.isValid) {
                toRemove.push(slotNode);
                continue;
            }
            if (maxSpinCounter != null && data.spinCounter >= maxSpinCounter) continue;
            if (data.parent && data.parent.isValid) {
                if (slotNode.parent !== data.parent) {
                    slotNode.setParent(data.parent, true);
                }
                slotNode.setSiblingIndex(data.parent.children.length - 1);
            }
            toRemove.push(slotNode);
        }
        for (const slotNode of toRemove) {
            this._coinSlotOriginalParents.delete(slotNode);
        }
    }

    private _applyStickySymbolOrder(): void {
        const sortable = this.coinSlots
            .map((node, idx) => {
                const reel = Math.floor(idx / 3);
                const row = idx % 3;
                const cell = GameData.instance.stickyCells.get(`${reel}-${row}`);
                return { node, idx, symbolId: cell?.symbolId ?? -1 };
            })
            .filter(item => item.node && item.node.active && this._stickySymbolLayerPriority(item.symbolId) >= 0);

        sortable.sort((a, b) => {
            const priorityDiff = this._stickySymbolLayerPriority(a.symbolId) - this._stickySymbolLayerPriority(b.symbolId);
            if (priorityDiff !== 0) return priorityDiff;
            return a.idx - b.idx;
        });

        for (const item of sortable) {
            item.node.setSiblingIndex(item.node.parent!.children.length - 1);
        }
    }

    private _stickySymbolLayerPriority(symbolId: number): number {
        switch (symbolId) {
            case SymbolId.STICKY_RED: return 0;
            case SymbolId.STICKY_YELLOW: return 1;
            case SymbolId.STICKY_GREEN: return 2;
            default: return -1;
        }
    }

    /**
     * Hiển thị tạm một coin slot (dùng cho +1 Spin hoặc effect đặc biệt).
     * Trả về node slot để caller dùng làm điểm xuất phát effect.
     * Gọi hideTempCoin() sau khi xong.
     */
    showTempCoin(reel: number, row: number, symbolId: number, allowPlusOne: boolean = false): Node | null {
        const idx      = reel * 3 + row;
        const slotNode = this.coinSlots[idx];
        if (!slotNode) return null;
        const key = `${reel}-${row}`;
        if (symbolId === SymbolId.PLUS_ONE_SPIN && !allowPlusOne) {
            Log.e(`[TOPUP-PLUS] BLOCK showTempCoin +1 key=${key} idx=${idx} reason=missingAllowToken`);
            return null;
        }

        const frameIdx = this._symbolToFrameIndex(symbolId);
        const sprite   = slotNode.getComponent(Sprite);
        if (sprite && frameIdx >= 0 && this.coinFrames[frameIdx]) {
            sprite.spriteFrame = this.coinFrames[frameIdx];
        }
        Tween.stopAllByTarget(slotNode);
        const op = slotNode.getComponent(UIOpacity);
        if (op) {
            Tween.stopAllByTarget(op);
            op.opacity = 255;
        }
        slotNode.setScale(1, 1, 1);
        slotNode.active = true;

        // Ẩn CreditLabel cho slot tạm thời
        const labelNode = slotNode.getChildByName('CreditLabel');
        if (labelNode) {
            Tween.stopAllByTarget(labelNode);
            labelNode.active = false;
            labelNode.setScale(1, 1, 1);
        }
        this._slotCreditMap.delete(slotNode);
        if (symbolId === SymbolId.PLUS_ONE_SPIN) {
            this._tempPlusOneKeys.add(key);
            Log.e(`[TOPUP-PLUS] showTempCoin key=${key} idx=${idx} node=${slotNode.name}`);
        }

        return slotNode;
    }

    /** Ẩn slot tạm thời sau khi effect xong (nếu không có coin sticky thật tại vị trí đó). */
    hideTempCoin(reel: number, row: number): void {
        const key = `${reel}-${row}`;
        this._tempPlusOneKeys.delete(key);
        // Chỉ ẩn nếu không có sticky coin thật tại vị trí này
        if (!GameData.instance.stickyCells.has(key)) {
            const idx      = reel * 3 + row;
            const slotNode = this.coinSlots[idx];
            if (slotNode) this._hideTempSlot(slotNode);
        }
    }

    /**
     * Clear every temporary +1 visual that is not backed by a real sticky coin.
     * This prevents a +1 from a previous spin from looking like a new server result.
     */
    public clearTempPlusOne(reason: string = 'manual'): void {
        if (this._tempPlusOneKeys.size === 0) return;
        const keys = Array.from(this._tempPlusOneKeys);
        for (const key of keys) {
            const realCell = GameData.instance.stickyCells.get(key);
            if (realCell && realCell.symbolId !== SymbolId.PLUS_ONE_SPIN) {
                const [reelStr, rowStr] = key.split('-');
                const reel = Number(reelStr);
                const row = Number(rowStr);
                const idx = reel * 3 + row;
                const slotNode = this.coinSlots[idx];
                if (slotNode) {
                    this._applyCoin(slotNode, realCell.symbolId, realCell.credit ?? 0);
                    this._applyBaseScale(slotNode, realCell.symbolId);
                    slotNode.active = true;
                    Log.e(`[TOPUP-PLUS] restore real sticky after temp +1 key=${key} symbol=${SymbolId[realCell.symbolId] ?? realCell.symbolId}`);
                }
                this._tempPlusOneKeys.delete(key);
                continue;
            }
            const [reelStr, rowStr] = key.split('-');
            const reel = Number(reelStr);
            const row = Number(rowStr);
            const idx = reel * 3 + row;
            const slotNode = this.coinSlots[idx];
            if (slotNode) this._hideTempSlot(slotNode);
            this._tempPlusOneKeys.delete(key);
        }
        Log.e(`[TOPUP-PLUS] clearTempPlusOne reason=${reason} keys=${keys.join('|') || 'none'}`);
    }

    private _hideTempSlot(slotNode: Node): void {
        Tween.stopAllByTarget(slotNode);
        const op = slotNode.getComponent(UIOpacity);
        if (op) {
            Tween.stopAllByTarget(op);
            op.opacity = 255;
        }
        const labelNode = slotNode.getChildByName('CreditLabel');
        if (labelNode) {
            Tween.stopAllByTarget(labelNode);
            labelNode.active = false;
            labelNode.setScale(1, 1, 1);
        }
        this._slotCreditMap.delete(slotNode);
        slotNode.setScale(1, 1, 1);
        slotNode.active = false;
    }

    /**
     * Áp dụng loại coin + credit value lên 1 slotNode.
     * @param symbolId  SymbolId.STICKY_RED / YELLOW / GREEN
     * @param credit    Giá trị credit (>= 0, luôn hiển thị CreditLabel)
     */
    private _applyCoin(slotNode: Node, symbolId: number, credit: number): void {
        const lastCredit = this._slotCreditMap.get(slotNode) ?? -1;
        const creditChanged = credit !== lastCredit;

        // ── Sprite ──
        const frameIdx = this._symbolToFrameIndex(symbolId);
        const sprite   = slotNode.getComponent(Sprite);
        if (sprite && frameIdx >= 0 && this.coinFrames[frameIdx]) {
            sprite.spriteFrame = this.coinFrames[frameIdx];
        }

        // ★ Giữ nguyên scale cho coin đã có (existing) — new coin set base scale qua _playCoinBounce.

        // ── Credit label (SpriteNumber trên child "CreditLabel") ──
        // TopUp Yellow/Green bắt đầu credit = 0 → ẩn label, chỉ hiện khi được hút tiền vào.
        // Giữ hiển thị nếu đã từng có credit > 0 (tránh GameData chưa cập nhật làm ẩn label sau absorb).
        const displayCredit = credit > 0 ? credit : lastCredit;
        const shouldActive  = displayCredit > 0;
        const labelNode = slotNode.getChildByName('CreditLabel');
        if (labelNode) {
            const sn = labelNode.getComponent(SpriteNumber);
            if (sn) {
                if (creditChanged || (credit === 0 && lastCredit > 0)) {
                    Log.e(`[STICKY-LABEL] _applyCoin ${slotNode.name} setData(${displayCredit}) sn=${sn ? 'OK' : 'MISS'}`);
                    sn.setData(displayCredit);
                    Log.d(`[StickyOverlay] apply ${slotNode.name} symbol=${symbolId} credit=${displayCredit}`);
                }
            } else {
                Log.e(`[StickyOverlay] Missing SpriteNumber on ${slotNode.name}/CreditLabel`);
            }
            if (creditChanged) {
                labelNode.setRotationFromEuler(0, 0, 0);
            }
            Log.e(`[STICKY-LABEL] _applyCoin ${slotNode.name} credit=${credit} lastCredit=${lastCredit} active→${shouldActive} (was=${labelNode.active})`);
            labelNode.active = shouldActive;
        } else {
            Log.e(`[StickyOverlay] Missing CreditLabel on ${slotNode.name}`);
        }

        this._slotCreditMap.set(slotNode, displayCredit);
    }

    /**
     * Map SymbolId → coinFrames index.
     * RED=0, YELLOW=1, GREEN=2. Trả -1 nếu không map được.
     */
    private _symbolToFrameIndex(symbolId: number): number {
        switch (symbolId) {
            case SymbolId.STICKY_RED:    return 0;
            case SymbolId.STICKY_YELLOW: return 1;
            case SymbolId.STICKY_GREEN:  return 2;
            case SymbolId.PLUS_ONE_SPIN: return 3; // coinFrames[3] = +1 Spin sprite
            default:                     return -1;
        }
    }

    private _getBaseScale(symbolId: number): number {
        return (symbolId === SymbolId.STICKY_YELLOW || symbolId === SymbolId.STICKY_GREEN)
            ? TOPUP_ABSORB_COIN_SCALE
            : 1;
    }

    private _applyBaseScale(slotNode: Node, symbolId: number): void {
        const scale = this._getBaseScale(symbolId);
        slotNode.setScale(scale, scale, 1);
    }

    /**
     * Canh tọa độ 15 coin slot khớp chính xác với 15 symbol trên reels.
     * Thứ tự: 0,1,2 = Top,Mid,Bot của Reel1; 3,4,5 = Reel2; ... 12,13,14 = Reel5.
     */
    alignCoinPositions(): void {
        if (!this.slotMachine) {
            Log.e('[StickyOverlay] alignCoinPositions: slotMachine chưa được gán.');
            return;
        }
        for (let reelIdx = 0; reelIdx < 5; reelIdx++) {
            const reel = this.slotMachine.reels[reelIdx];
            if (!reel) continue;

            const symbolNodeIndices = [2, 3, 4]; // Top, Mid, Bot
            for (let row = 0; row < 3; row++) {
                const coinIdx = reelIdx * 3 + row;
                const slotNode = this.coinSlots[coinIdx];
                if (!slotNode) continue;

                const symbolNode = reel.symbolNodes[symbolNodeIndices[row]];
                if (!symbolNode) continue;

                slotNode.setWorldPosition(symbolNode.worldPosition);
            }
        }
    }

    /**
     * Canh 15 coin slot theo 15 reel trong TopUpManager.
     * Mỗi reel TopUp là một ô (cell); node Mid (symbolNodes[1]) là tâm ô.
     * Giả định mảng coinSlots và TopUpManager.reels cùng thứ tự:
     *   index = reel * 3 + row  (row 0 = Bottom, 1 = Mid, 2 = Top visual).
     */
    alignPositionsFromTopUpManager(): void {
        const topUpMgrs = this.node.scene?.getComponentsInChildren(TopUpManager) ?? [];
        if (topUpMgrs.length === 0) {
            Log.e('[StickyOverlay] alignPositionsFromTopUpManager: TopUpManager not found.');
            return;
        }

        const topUpMgr = topUpMgrs[0];
        if (topUpMgr.reels.length !== 15) {
            Log.w(`[StickyOverlay] alignPositionsFromTopUpManager: reels.length=${topUpMgr.reels.length} (expected 15).`);
        }

        const count = Math.min(topUpMgr.reels.length, this.coinSlots.length);
        for (let i = 0; i < count; i++) {
            const reel = topUpMgr.reels[i];
            const slotNode = this.coinSlots[i];
            if (!reel || !slotNode) continue;

            const symbolNode = reel.symbolNodes[1]; // Mid node = tâm ô
            if (!symbolNode) continue;

            slotNode.setWorldPosition(symbolNode.worldPosition);
        }

        Log.d(`[StickyOverlay] alignPositionsFromTopUpManager — synced ${count} slots.`);
    }

    /**
     * Cập nhật credit value cho slot sau khi absorb xong.
     * Giữ label active và cập nhật _slotCreditMap để _refreshAll sau không ẩn label.
     */
    setSlotCredit(slotNode: Node, credit: number): void {
        this._slotCreditMap.set(slotNode, credit);
        const labelNode = slotNode.getChildByName('CreditLabel');
        if (labelNode) {
            const sn = labelNode.getComponent(SpriteNumber);
            if (sn) {
                sn.setData(credit);
            }
            labelNode.active = credit > 0;
        }
    }

    /**
     * Bounce animation when a new coin lands — same as SymbolView._playLandBounce.
     * Scale up → overshoot nhỏ → về lại base scale.
     */
    private _playCoinBounce(slotNode: Node, symbolId: number): void {
        const baseScale = this._getBaseScale(symbolId);
        const bounceScale = baseScale * Math.min(this.coinBounceScale, 1.12);
        Tween.stopAllByTarget(slotNode);
        slotNode.setScale(baseScale, baseScale, 1);

        // In TopUp mode, play gold-land sound when yellow/green coins pop onto StickyOverlay
        if (GameData.instance.currentMode === 'respin' &&
            (symbolId === SymbolId.STICKY_YELLOW || symbolId === SymbolId.STICKY_GREEN)) {
            SoundManager.instance?.playSFX(SoundManager.instance?.sxBonusStickyGoldLand);
        }

        tween(slotNode)
            .to(0.1, { scale: new Vec3(bounceScale, bounceScale, 1) })
            .to(0.1, { scale: new Vec3(baseScale, baseScale, 1) })
            .start();
    }

}
