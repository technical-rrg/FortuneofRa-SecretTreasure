/**
 * SymbolView - Component gắn vào mỗi Symbol Node (ExtraTop1..ExtraBot1).
 *
 * ─── BINDING TRONG EDITOR ───
 * KHÔNG cần kéo ảnh vào từng SymbolView.
 * Chỉ kéo 1 lần vào SlotMachineController → symbolFrames / blurFrames.
 * SlotMachineController.start() tự phân phối xuống tất cả SymbolView.
 *
 * ─── TÊN FILE ẢNH (đặt trong assets/bundle/textures/symbol/) ───
 *   minor_9, minor_10, minor_j, minor_q, minor_k, minor_a          (id 0..5)
 *   major_horus, major_anubis, major_sobek, major_ramses, major_cleopatra (id 6..10)
 *   wild_trail                                                       (id 11)
 *   sticky_red, sticky_yellow, sticky_green                         (id 12/13/14)
 *   plus_one_spin                                                    (id 15)
 *   jp_idle, jp_mini, jp_minor, jp_major, jp_grand                  (id 16..20 — Pick Game)
 */

import { _decorator, Component, Sprite, SpriteFrame, Label, LabelOutline, Color, Node, Tween, tween, Vec3, UIOpacity } from 'cc';
import { SymbolId } from '../data/SlotTypes';
import { SpriteNumber } from '../core/SpriteNumber';
import { GameData } from '../data/GameData';
import { Log } from '../core/Logger';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { AutoSpinManager } from '../manager/AutoSpinManager';
import { SoundManager } from '../manager/SoundManager';

const { ccclass, property } = _decorator;

const SYMBOL_FRAME_KEYS: Record<number, string> = {
    [SymbolId.MINOR_9]: '0_minor_9',
    [SymbolId.MINOR_10]: '1_minor_10',
    [SymbolId.MINOR_J]: '2_minor_j',
    [SymbolId.MINOR_Q]: '3_minor_q',
    [SymbolId.MINOR_K]: '4_minor_k',
    [SymbolId.MINOR_A]: '5_minor_a',
    [SymbolId.MAJOR_HORUS]: '6_major_horus',
    [SymbolId.MAJOR_ANUBIS]: '7_major_anubis',
    [SymbolId.MAJOR_SOBEK]: '8_major_sobek',
    [SymbolId.MAJOR_RAMSES]: '9_major_ramses',
    [SymbolId.MAJOR_CLEOPATRA]: '10_major_cleopatra',
    [SymbolId.WILD]: '11_wild_trail',
    [SymbolId.STICKY_RED]: '12_sticky_red',
    [SymbolId.STICKY_YELLOW]: '13_sticky_yellow',
    [SymbolId.STICKY_GREEN]: '14_sticky_green',
    [SymbolId.PLUS_ONE_SPIN]: '15_plus_one_spin',
};

@ccclass('SymbolView')
export class SymbolView extends Component {

    // Được gán từ SlotMachineController._distributeFramesToSymbolViews() — KHÔNG kéo tay trong Editor.
    symbolFrames: SpriteFrame[] = [];
    blurFrames: SpriteFrame[] = [];

    @property({ tooltip: 'Scale mặc định của symbol (base scale). Dùng cho cả win zoom effect.' })
    defaultScale: number = 1;

    @property({
        tooltip: 'Tên debug (tự động cập nhật trong Editor khi symbolId thay đổi)',
        readonly: true,
    })
    currentSymbolName: string = '-';

    // SpriteNumber được inject từ SlotMachineController.creditLabelPrefab — KHÔNG kéo tay trong Editor.
    SpriteNumber: SpriteNumber | null = null;

    /** Gán bởi SlotMachineController — reel này thuộc cột nào (0-based). */
    reelIndex: number = -1;
    /** Gán bởi SlotMachineController — hàng logical (0=top, 1=mid, 2=bot). -1 = ngoài lưới. */
    rowIndex: number = -1;

    /** Node để reparent symbol trong lúc land bounce (WaysPayDisplay node) — vẽ chồng lên tất cả. */
    static landBounceParent: Node | null = null;
    /** Track các symbol node đang trong land bounce để restore khi bị interrupt */
    private static _pendingLandBounces: Map<Node, { origParent: Node | null; origLocalPos: Vec3 }> = new Map();
    /** Số Sticky đỏ đang zoom land-bounce — chờ về 0 mới highlight win. */
    private static _activeRedLandBounces: number = 0;
    private static _redLandBounceWaiters: Array<() => void> = [];

    /** Thời lượng 1 lần land bounce (grow + hold + shrink), đã nhân speed mode. */
    static getLandBounceDuration(): number {
        const m = AutoSpinManager.instance?.getTimingMultiplier?.() ?? 1;
        return (0.1 + 0.3 + 0.28) * m;
    }

    static hasActiveRedLandBounces(): boolean {
        return SymbolView._activeRedLandBounces > 0;
    }

    /** Gọi cb ngay nếu không còn red bounce; ngược lại chờ bounce xong hết. */
    static whenRedLandBouncesDone(cb: () => void): void {
        if (SymbolView._activeRedLandBounces <= 0) {
            cb();
            return;
        }
        SymbolView._redLandBounceWaiters.push(cb);
    }

    private static _beginRedLandBounce(): void {
        SymbolView._activeRedLandBounces++;
    }

    private static _endRedLandBounce(): void {
        SymbolView._activeRedLandBounces = Math.max(0, SymbolView._activeRedLandBounces - 1);
        if (SymbolView._activeRedLandBounces > 0) return;
        const waiters = SymbolView._redLandBounceWaiters.splice(0);
        for (const cb of waiters) cb();
        EventBus.instance.emit(GameEvents.STICKY_RED_LAND_BOUNCE_DONE);
    }

    // ─── INTERNAL ───

    private _sprite: Sprite | null = null;
    private _currentSymbolId: number = -1;
    private _isSpinning: boolean = false;
    private _debugLabel: Label | null = null;
    private _pendingLandBounce: boolean = false;
    private _landBouncePlayed: boolean = false;

    /** Đăng ký symbol node đang bị reparent sang top layer (dùng bởi effect ngoài SymbolView) */
    public static registerLandBounce(node: Node, origParent: Node | null, origLocalPos?: Vec3): void {
        SymbolView._pendingLandBounces.set(node, {
            origParent,
            origLocalPos: origLocalPos?.clone() ?? node.position.clone(),
        });
    }
    /** Hủy đăng ký khi symbol node đã tự restore về parent gốc */
    public static unregisterLandBounce(node: Node): void {
        SymbolView._pendingLandBounces.delete(node);
    }
    /** Force-restore tất cả symbol node đang trong land bounce về parent gốc */
    public static restoreAllLandBounces(): void {
        for (const [node, data] of SymbolView._pendingLandBounces) {
            if (node?.isValid && data.origParent && data.origParent.isValid) {
                Tween.stopAllByTarget(node);
                SymbolView.restoreToReelParent(node, data.origParent, data.origLocalPos);
                node.setScale(node.getComponent(SymbolView)?.defaultScale ?? 1, node.getComponent(SymbolView)?.defaultScale ?? 1, 1);
            }
        }
        SymbolView._pendingLandBounces.clear();
        SymbolView._activeRedLandBounces = 0;
        const waiters = SymbolView._redLandBounceWaiters.splice(0);
        for (const cb of waiters) cb();
    }

    /** Đặt node lên trên cùng trong parent — symbol bounce xong sau sẽ đè lên các symbol khác. */
    public static placeOnTopInParent(node: Node, parent: Node): void {
        if (!node?.isValid || !parent?.isValid || node.parent !== parent) return;
        node.setSiblingIndex(parent.children.length - 1);
    }

    /**
     * Restore symbol node về reel parent sau reparent zoom/bounce.
     * Snap localX=0, giữ localY/Z trước khi tách khỏi parent.
     */
    public static restoreToReelParent(node: Node, parent: Node, origLocalPos: Vec3): void {
        if (!node?.isValid || !parent?.isValid) return;
        if (node.parent !== parent) {
            node.setParent(parent, false);
        }
        node.setPosition(0, origLocalPos.y, origLocalPos.z);
        SymbolView.placeOnTopInParent(node, parent);
    }
    private _pendingPlusOneEffect: boolean = false;

    /** PS ID name helper — removed (GoF không dùng PS schema cũ) */

    // ─── LIFECYCLE ───

    onLoad(): void {
        this._sprite = this.getComponent(Sprite) ?? this.getComponentInChildren(Sprite);
       // this._createDebugLabel();

        // Áp dụng defaultScale
        this.node.setScale(this.defaultScale, this.defaultScale, 1);

        // Ẩn credit label ban đầu
        if (this.SpriteNumber) this.SpriteNumber.node.active = false;

        // Lắng nghe event từ ReelController
        this.node.on('symbol-changed', this._onSymbolChanged, this);
        this.node.on('spin-start', this._onSpinStart, this);
        this.node.on('spin-fast',  this._onSpinFast,  this);
        this.node.on('spin-stop',  this._onSpinStop,  this);
        this.node.on('reel-settled', this._onReelSettled, this);
        this.node.on('sticky-result-landed', this._onStickyResultLanded, this);
    }

    onDestroy(): void {
        this.node.off('symbol-changed', this._onSymbolChanged, this);
        this.node.off('spin-start', this._onSpinStart, this);
        this.node.off('spin-fast',  this._onSpinFast,  this);
        this.node.off('spin-stop',  this._onSpinStop,  this);
        this.node.off('reel-settled', this._onReelSettled, this);
        this.node.off('sticky-result-landed', this._onStickyResultLanded, this);
    }

    // ─── PUBLIC API ───

    /** Symbol ID hiện tại đang hiển thị (-1 = trống) */
    get symbolId(): number { return this._currentSymbolId; }

    /** Hiển thị symbol theo ID (0-8), hoặc -1 = ô trống (blank) */
    setSymbol(symbolId: number): void {
        this._currentSymbolId = symbolId;
        this._isSpinning = false;
        this._pendingLandBounce = false;
        this._landBouncePlayed = false;
        this._pendingPlusOneEffect = false;
        // Reset scale về default và dừng tween cũ — tránh scale dang dở khi đổi symbol
        Tween.stopAllByTarget(this.node);
        this.node.setScale(this.defaultScale, this.defaultScale, 1);
        // Reset rotation tuyệt đối để tránh bị nghiêng méo do kế thừa từ parent hoặc lần trước
        this.node.setRotationFromEuler(0, 0, 0);
        // Ẩn tất cả CreditLabel (SpriteNumber) trong symbol node — đảm bảo symbol thường ko lộ credit
        for (const sn of this.node.getComponentsInChildren(SpriteNumber)) {
            sn.node.active = false;
        }
        // Reset sprite visible khi symbol được recycle (ra khỏi mask rồi quay lại)
        this.setSpriteVisible(true);

        // [DIAG] Log mọi call cho visible cells - TẮT trong production để tối ưu
        // if (DEBUG && this.rowIndex >= 0 && this.reelIndex >= 0) {
        //     const frameName = (this.symbolFrames[symbolId] as any)?._uuid ?? this.symbolFrames[symbolId]?.name ?? 'null';
        //     Log.d(`[SV-CALL] r${this.reelIndex}row${this.rowIndex} id=${symbolId}(${SymbolId[symbolId] ?? '?'}) framesLen=${this.symbolFrames.length} frame=${frameName}`);
        // }

        // Nếu là sticky coin → luôn hiện credit label (active true) và gán đúng giá trị
        // ★ TopUp mode: background reel KHÔNG hiện credit/bounce — StickyOverlay đã xử lý
        if ((symbolId === SymbolId.STICKY_RED || symbolId === SymbolId.STICKY_YELLOW || symbolId === SymbolId.STICKY_GREEN) && this.reelIndex >= 0 && this.rowIndex >= 0
            && GameData.instance.currentMode !== 'respin') {
            const _key = `${this.reelIndex}-${this.rowIndex}`;
            const cell = GameData.instance.stickyCells.get(_key);
            // Luôn active true, gán credit từ cell hoặc 0 nếu chưa có data
            const creditValue = cell && cell.symbolId === symbolId ? cell.credit : 0;
            Log.e(`[STICKY-LABEL] SymbolView.setSymbol r${this.reelIndex}row${this.rowIndex} id=${symbolId} credit=${creditValue} mode=${GameData.instance.currentMode}`);
            this.showCredit(creditValue);
            this._pendingLandBounce = !this._landBouncePlayed;
        } else if (symbolId === SymbolId.PLUS_ONE_SPIN && this.reelIndex >= 0 && this.rowIndex >= 0
            && GameData.instance.currentMode !== 'respin') {
            // +1 Re-Spin symbol: đánh dấu pending để bounce khi reel settled
            this._pendingLandBounce = true;
            this._pendingPlusOneEffect = true;
            if (this.SpriteNumber) this.SpriteNumber.node.active = false;
        } else {
            // Không phải STICKY_RED → ẩn credit label
            if (this.SpriteNumber) this.SpriteNumber.node.active = false;
        }

        // Empty slot (-1): xóa sprite, ẩn ô đi
        if (symbolId < 0) {
            this._syncSymbolDebugName(symbolId);
            this._applySpriteFrame(null);
            this._updateDebugOverlay();
            return;
        }

        this._syncSymbolDebugName(symbolId);

        const frame = this._resolveSymbolFrame(symbolId);
        if (!frame) {
            // Log removed for performance
            // Xóa sprite cũ — tránh sprite từ symbol trước bị lộ (stale sprite)
            this._applySpriteFrame(null);
            return;
        }

        this._applySpriteFrame(frame);
        this._updateDebugOverlay();
    }

    /** Hiển thị blur tương ứng với symbolId hiện tại khi reel đang quay */
    showBlur(): void {
        this._isSpinning = true;
        if (!this._sprite) return;
        const blurFrame = this.blurFrames[this._currentSymbolId] ?? this.blurFrames[0] ?? null;
        if (blurFrame) {
            this._applySpriteFrame(blurFrame);
        }
    }

    private _resolveSymbolFrame(symbolId: number): SpriteFrame | null {
        const expectedKey = SYMBOL_FRAME_KEYS[symbolId];
        const indexedFrame = this.symbolFrames[symbolId] ?? null;
        if (!expectedKey) return indexedFrame;

        if (this._frameMatches(indexedFrame, expectedKey)) return indexedFrame;

        const fallbackFrame = this.symbolFrames.find(frame => this._frameMatches(frame, expectedKey)) ?? null;
        if (fallbackFrame) {
            const indexedName = indexedFrame?.name ?? 'null';
            // Log removed for performance
            return fallbackFrame;
        }

        if (indexedFrame) {
            // Log removed for performance
        }
        return indexedFrame;
    }

    private _frameMatches(frame: SpriteFrame | null, expectedKey: string): boolean {
        if (!frame) return false;
        return (frame.name ?? '').toLowerCase().includes(expectedKey);
    }

    private _applySpriteFrame(frame: SpriteFrame | null): void {
        if (!this._sprite) {
            // Log removed for performance
            return;
        }
        this._sprite.spriteFrame = frame;
    }

    public prefillStickyCredit(symbolId: number, targetRowIndex: number): void {
        const isSticky = symbolId === SymbolId.STICKY_RED
            || symbolId === SymbolId.STICKY_YELLOW
            || symbolId === SymbolId.STICKY_GREEN;
        if (!isSticky || this.reelIndex < 0 || targetRowIndex < 0 || GameData.instance.currentMode === 'respin') {
            this.clearCredit();
            return;
        }

        const key = `${this.reelIndex}-${targetRowIndex}`;
        const cell = GameData.instance.stickyCells.get(key);
        const creditValue = cell && cell.symbolId === symbolId ? cell.credit : 0;
        Log.e(`[STICKY-LABEL] SymbolView.prefill r${this.reelIndex}row${targetRowIndex} id=${symbolId} credit=${creditValue} mode=${GameData.instance.currentMode}`);
        this.showCredit(creditValue);
    }

    /**
     * Ẩn/hiện Sprite component (dùng khi spine effect đang phát để tránh chồng ảnh).
     * Chỉ toggle enabled — không xóa spriteFrame, restore ngay khi gọi lại true.
     */
    setSpriteVisible(visible: boolean): void {
        const sprites = this.node.getComponentsInChildren(Sprite);
        for (const spr of sprites) {
            spr.enabled = visible;
        }
    }

    // ─── CREDIT LABEL (Sticky Red) ────────────────────────────────────────────

    /**
     * #1 Hiển thị giá trị credit ở giữa symbol Sticky Red.
     * Dùng format KMBT (1500 → "1.5K"). Label pop-in nhỏ.
     * Gọi sau khi reel dừng và sticky cell đã được xác nhận.
     */
    showCredit(value: number): void {
        if (!this.SpriteNumber) {
            Log.e(`[STICKY-LABEL] SymbolView.showCredit r${this.reelIndex}row${this.rowIndex} SKIP: no SpriteNumber`);
            return;
        }
        const labelNode = this.SpriteNumber.node;
        Tween.stopAllByTarget(labelNode);
        const shouldActive = value > 0;
        Log.e(`[STICKY-LABEL] SymbolView.showCredit r${this.reelIndex}row${this.rowIndex} value=${value} active→${shouldActive} (was=${labelNode.active})`);
        this.SpriteNumber.setData(value);
        // Reset rotation của CreditLabel để tránh bị nghiêng méo (đặc biệt case row0 col0)
        labelNode.setRotationFromEuler(0, 0, 0);
        labelNode.active = shouldActive;
    }

    /**
     * Force Feature Entry — đổi symbol reel hiện tại thành Sticky đỏ + nhún land
     * (giống khi reel dừng trúng Red Coin).
     */
    public applyStickyRedFill(credit: number): void {
        this.setSymbol(SymbolId.STICKY_RED);
        if (credit > 0) {
            this.showCredit(credit);
        }
        this._landBouncePlayed = false;
        this._pendingLandBounce = false;
        this._playLandBounce();
    }

    /**
     * Bounce nhẹ khi symbol coin vừa land trên reel.
     * Trong lúc bounce, reparent node sang WaysPayDisplay node
     * (sibling index cuối cùng) để vẽ chồng lên tất cả.
     * Khi bounce xong, restore parent cũ và giữ nguyên vị trí.
     */
    private _playLandBounce(reparentToTop: boolean = true): void {
        const s = this.defaultScale;
        Tween.stopAllByTarget(this.node);

        // Play sound when a sticky yellow coin lands in FreeSpin Gold
        if (this._currentSymbolId === SymbolId.STICKY_YELLOW && GameData.instance.currentMode === 'freespin_gold') {
            SoundManager.instance?.playSfxByName('sxBonusStickyGoldLand');
        }

        const isRedSticky = this._currentSymbolId === SymbolId.STICKY_RED;
        if (isRedSticky) SymbolView._beginRedLandBounce();

        const origParent  = this.node.parent;
        const origLocalPos = this.node.position.clone();
        const topNode     = SymbolView.landBounceParent;
        const m = AutoSpinManager.instance?.getTimingMultiplier?.() ?? 1;

        if (reparentToTop && topNode && topNode.isValid && origParent && origParent.isValid) {
            SymbolView._pendingLandBounces.set(this.node, {
                origParent,
                origLocalPos: origLocalPos.clone(),
            });
            this.node.setParent(topNode, true);
            this.node.setSiblingIndex(topNode.children.length);
        }

        this.node.setScale(s, s, 1);
        const growDur = 0.1 * m;
        const holdDur = 0.3 * m;
        const shrinkDur = 0.28 * m;

        tween(this.node)
            .to(growDur, { scale: new Vec3(s * 1.12, s * 1.12, 1) }, { easing: 'sineOut' })
            .delay(holdDur)
            .to(shrinkDur, { scale: new Vec3(s, s, 1) }, { easing: 'sineOut' })
            .call(() => {
                SymbolView._pendingLandBounces.delete(this.node);
                if (isRedSticky) SymbolView._endRedLandBounce();
                if (!this.node || !this.node.isValid) return;
                if (reparentToTop && origParent && origParent.isValid) {
                    SymbolView.restoreToReelParent(this.node, origParent, origLocalPos);
                }
            })
            .start();
            
    }

    /**
     * Effect khi symbol +1 Re-Spin land trên reel (chế độ TopUp).
     * Symbol sẽ glow/pulse rồi fade out để cho thấy nó đã được "tiêu thụ"
     * và +1 spin được cộng vào respinRemaining.
     */
    private _playPlusOneSpinEffect(): void {
        if (!this._sprite) return;

        // Lấy hoặc tạo UIOpacity component
        let uiOpacity = this.node.getComponent(UIOpacity);
        if (!uiOpacity) {
            uiOpacity = this.node.addComponent(UIOpacity);
        }

        // Đảm bảo opacity đang là full
        uiOpacity.opacity = 255;

        // Pulse glow effect (tăng sáng lên rồi về lại) rồi fade out
        // Delay trước khi fade để người chơi thấy symbol
        tween(uiOpacity)
            .delay(0.8)  // Chờ cho bounce hoàn thành + người chơi nhìn thấy
            .to(0.3, { opacity: 0 })  // Fade out
            .call(() => {
                // Sau khi fade xong, reset opacity cho lần sau
                uiOpacity!.opacity = 255;
            })
            .start();

        // Log removed for performance
    }

    /**
     * Ẩn credit label. Gọi khi reel bắt đầu quay hoặc symbol bị reset.
     */
    clearCredit(): void {
        if (!this.SpriteNumber) return;
        const labelNode = this.SpriteNumber.node;
        Tween.stopAllByTarget(labelNode);
        labelNode.active = false;
    }

    /** Cập nhật tên node/debug cho khớp symbolId hiện tại (kể cả lúc đang quay). */
    private _syncSymbolDebugName(symbolId: number): void {
        if (symbolId < 0) {
            this.currentSymbolName = 'Empty';
            this.node.name = '[Empty]';
            return;
        }
        this.currentSymbolName = SymbolId[symbolId] ?? `Symbol_${symbolId}`;
        this.node.name = `[${this.currentSymbolName}]`;
    }

    // ─── EVENT HANDLERS (từ ReelController) ───

    private _onSymbolChanged(symbolId: number): void {
        // Nếu symbol đang là sticky coin và vẫn nhận cùng ID → giữ nguyên scale (không reset zoom)
        const isSticky = [SymbolId.STICKY_RED, SymbolId.STICKY_YELLOW, SymbolId.STICKY_GREEN].includes(symbolId);
        const sameSticky = isSticky && this._currentSymbolId === symbolId;
        const keepRunningLandBounce = sameSticky && this._landBouncePlayed;
        if (!keepRunningLandBounce) {
            Tween.stopAllByTarget(this.node);
        }
        if (!sameSticky) {
            this.node.setScale(this.defaultScale, this.defaultScale, 1);
        }

        // Khi đang spinning: đổi sprite theo symbol mới (blurFrames ≡ symbolFrames trong project này)
        if (this._isSpinning) {
            if (symbolId < 0) {
                this._currentSymbolId = symbolId;
                this._syncSymbolDebugName(symbolId);
                if (this._sprite) this._sprite.spriteFrame = null;
            } else {
                this._currentSymbolId = symbolId;
                this._syncSymbolDebugName(symbolId);
                const frame = this._resolveSymbolFrame(symbolId)
                    ?? this.blurFrames[symbolId]
                    ?? this.symbolFrames[symbolId]
                    ?? null;
                if (this._sprite && frame) {
                    this._sprite.spriteFrame = frame;
                }
                // ★ Bật credit label cho sticky coins ngay cả trong lúc quay
                if (isSticky && this.reelIndex >= 0 && this.rowIndex >= 0) {
                    const _key = `${this.reelIndex}-${this.rowIndex}`;
                    const cell = GameData.instance.stickyCells.get(_key);
                    const creditValue = cell && cell.symbolId === symbolId ? cell.credit : 0;
                    this.showCredit(creditValue);
                }
            }
            return;
        }
        if (sameSticky) {
            const frame = this._resolveSymbolFrame(symbolId);
            if (frame) this._applySpriteFrame(frame);
            if (this.rowIndex >= 0) {
                this.prefillStickyCredit(symbolId, this.rowIndex);
            }
            // Sticky coin giữ nguyên scale, sprite, credit — không cần reset
            // ★ Nhưng vẫn phải đánh dấu _pendingLandBounce để nhún khi reel-settled fire
            // Chỉ nhún cho visible nodes (rowIndex>=0), buffer nodes (rowIndex=-1) ngoài mask không nhún
            if (this.rowIndex >= 0) {
                this._pendingLandBounce = !this._landBouncePlayed;
            }
            return;
        }
        this.setSymbol(symbolId);
    }

    private _onSpinStart(): void {
        // Đánh dấu đang trong chu kỳ spin nhưng chưa hiện blur
        // (reel đang bounce lên, chưa vào tốc độ nhanh)
        this._isSpinning = true;
        this._landBouncePlayed = false;
        // KHÔNG ẩn credit label ở đây — symbol đỏ vẫn còn visible trong giai đoạn launch bounce.
        // Credit sẽ bị ẩn khi spin-fast fire (blur bắt đầu hiển, symbol đi ra khỏi view).
    }

    private _onSpinFast(): void {
        // Reel đã vào tốc độ nhanh → hiện blur
        // ★ Chỉ ẩn credit label cho non-sticky coins; sticky coins giữ credit hiển thị
        const isSticky = this._currentSymbolId === SymbolId.STICKY_RED
            || this._currentSymbolId === SymbolId.STICKY_YELLOW
            || this._currentSymbolId === SymbolId.STICKY_GREEN;
        if (!isSticky) {
            this.clearCredit();
        }
        this.showBlur();
    }

    private _onSpinStop(): void {
        // Clear flag — symbol-changed tiếp theo sẽ gọi setSymbol() → hiện ảnh thật
        this._isSpinning = false;
    }

    private _onStickyResultLanded(symbolId: number): void {
        if (GameData.instance.currentMode === 'respin') return;
        if (this.rowIndex < 0 || this._landBouncePlayed) return;

        this._isSpinning = false;
        this._currentSymbolId = symbolId;
        this._syncSymbolDebugName(symbolId);
        const frame = this._resolveSymbolFrame(symbolId);
        if (frame) this._applySpriteFrame(frame);
        this.prefillStickyCredit(symbolId, this.rowIndex);

        this._pendingLandBounce = true;
        this._landBouncePlayed = false;
    }

    private _onReelSettled(): void {
        if (this._pendingLandBounce && !this._landBouncePlayed && GameData.instance.currentMode !== 'respin') {
            this._pendingLandBounce = false;
            this._landBouncePlayed = true;
            this._playLandBounce();
        }
        if (this._pendingPlusOneEffect && GameData.instance.currentMode !== 'respin') {
            this._pendingPlusOneEffect = false;
            this._playPlusOneSpinEffect();
        }
    }

    // ─── DEBUG OVERLAY ───

    private _createDebugLabel(): void {
        // Tạo child node chứa Label để overlay PS ID lên symbol
        const labelNode = new Node('DebugLabel');
        this.node.addChild(labelNode);
        const label = labelNode.addComponent(Label);
        label.string = '';
        label.fontSize = 20;
        label.lineHeight = 22;
        label.color = new Color(255, 255, 0, 255);  // yellow
        label.isBold = true;
        // Outline for readability
        const outline = labelNode.addComponent(LabelOutline);
        outline.color = new Color(0, 0, 0, 255);
        outline.width = 2;
        this._debugLabel = label;
    }

    /**
     * Cập nhật debug overlay hiển thị PS ID + Client ID.
     * Gọi sau khi setSymbol() để hiển thị thông tin mapping.
     */
    private _updateDebugOverlay(): void {
        if (!this._debugLabel) return;
        const clientId = this._currentSymbolId;
        const clName = clientId < 0 ? 'Empty' : (SymbolId[clientId] ?? `cl${clientId}`);
        this._debugLabel.string = `CL:${clientId}(${clName})`;
    }
}
