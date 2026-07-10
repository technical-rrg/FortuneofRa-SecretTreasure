/**
 * SlotMachineController - Điều phối 5 ReelController.
 *
 * FLOW 2 PHA:
 *   Phase 1: REELS_START_SPIN → reel quay ngay lập tức (trước khi chờ server)
 *   Phase 2: SPIN_RESPONSE    → ra lệnh dừng reel tại đúng vị trí (rands)
 *
 * LONG SPIN VFX:
 *   Khi LONG_SPIN_TRIGGERED: Cột cuối (reel 5) delay thêm 2.5–3s.
 *   Ngay khi Cột áp chót dừng xong → bật longSpinVFXNode + emit LONG_SPIN_VFX_START (audio anticipation).
 *   Khi Cột cuối dừng hẳn     → tắt longSpinVFXNode + emit LONG_SPIN_VFX_END (audio thud).
 *
 * SETUP LONG SPIN VFX TRONG EDITOR:
 *   1. Tạo 1 Node con "LongSpinVFX" đặt bên trong / đè lên Cột cuối.
 *   2. Gắn component Sprite vào Node đó.
 *   3. Kéo Node vào slot "longSpinVFXNode" bên dưới.
 *   4. Kéo danh sách SpriteFrame (các frame hoạt ảnh) vào mảng "vfxFrames".
 *   5. Điều chỉnh "vfxFPS" (tốc độ frame mặc định 12 fps).
 */

import { _decorator, Component, Node, Sprite, SpriteFrame, screen, Prefab, instantiate, Vec3 } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { SpinResponse, SymbolId } from '../data/SlotTypes';
import { GameData } from '../data/GameData';
import { ReelController } from './ReelController';
import { SymbolView } from './SymbolView';
import { WaysPayDisplay } from './WaysPayDisplay';
import { SymbolHighlighter } from './SymbolHighlighter';
import { AutoSpinManager, SpeedMode } from '../manager/AutoSpinManager';
import { Log } from '../core/Logger';
import { SpriteNumber } from '../core/SpriteNumber';

const { ccclass, property } = _decorator;

// ─── PER-MODE SPEED CONFIGURATION ───────────────────────────────────────────
/**
 * Holds all tunable speed parameters for one SpeedMode (NORMAL / QUICK / TURBO).
 * Drag the three instances (normalModeSettings, quickModeSettings, turboModeSettings)
 * from the SlotMachineController Inspector to adjust without touching code.
 */
@ccclass('SpeedModeSettings')
class SpeedModeSettings {
    @property({
        tooltip: [
            'Reel scroll speed while spinning (pixels / sec).',
            'Higher value = faster visual scroll.',
            'Recommended → Normal: 7000 | Quick: 7000 | Turbo: 10000',
        ].join('\n'),
    })
    spinSpeed: number = 7000;

    @property({
        tooltip: [
            'Minimum time the reel must keep spinning before it is allowed to stop — Normal Spin (seconds).',
            'Prevents the reel from stopping too early when the server response arrives quickly.',
            'Recommended → Normal: 0.25 | Quick: 0.2 | Turbo: 0.125',
        ].join('\n'),
    })
    minSpinDuration: number = 0.25;

    @property({
        tooltip: [
            'Same as minSpinDuration but applied when Free Spin is active (seconds).',
            'Free Spin usually feels better with a slightly longer minimum.',
            'Recommended → Normal: 0.5 | Quick: 0.3 | Turbo: 0.2',
        ].join('\n'),
    })
    minSpinDurationFreeSpin: number = 0.5;

    @property({
        tooltip: [
            'How long the reel takes to decelerate from full speed to a stop — Normal Spin (seconds).',
            'Shorter = snappier stop. Longer = more dramatic slowdown.',
            'Recommended → Normal: 0.15 | Quick: 0.15 | Turbo: 0.05',
        ].join('\n'),
    })
    decelDuration: number = 0.15;

    @property({
        tooltip: [
            'Deceleration duration when Free Spin is active (seconds).',
            'Recommended → Normal: 0.27 | Quick: 0.27 | Turbo: 0.09',
        ].join('\n'),
    })
    decelDurationFreeSpin: number = 0.27;

    @property({
        tooltip: [
            'Extra wait time added before last reel begins decelerating when a Long Spin is triggered (seconds).',
            'Creates the anticipation window before the big reveal.',
            'Recommended → Normal: 2 | Quick: 0.8 | Turbo: 1',
        ].join('\n'),
    })
    longSpinDelay: number = 2;

    @property({
        tooltip: [
            'Reel scroll speed during Long Spin (pixels / sec). 0 = use spinSpeed.',
            'Higher than spinSpeed → more rotations within the same anticipation window.',
            'Recommended → Normal: 10000 | Quick: 10000 | Turbo: 14000',
        ].join('\n'),
    })
    longSpinSpeed: number = 10000;

    @property({
        tooltip: [
            'Skip the upward bounce animation that plays at the very start of each spin.',
            'Enable for QUICK and TURBO so reels begin scrolling instantly.',
            'Recommended → Normal: false | Quick: true | Turbo: true',
        ].join('\n'),
    })
    skipLaunchBounce: boolean = false;

    @property({
        tooltip: [
            'When enabled, all reels start decelerating simultaneously (stopDelay = 0).',
            'When disabled, each reel waits reelIndex × stopInterval seconds before stopping (stagger effect).',
            'Enable for QUICK and TURBO. Leave off for NORMAL.',
            'Recommended → Normal: false | Quick: true | Turbo: true',
        ].join('\n'),
    })
    noStopDelay: boolean = false;
}

@ccclass('SlotMachineController')
export class SlotMachineController extends Component {

    @property({ type: [ReelController], tooltip: 'Kéo các ReelController (cột 0..4) vào đây' })
    reels: ReelController[] = [];

    @property({
        type: Prefab,
        tooltip: 'Prefab SpriteNumber cho Sticky Red symbol.\n'
               + 'Tạo 1 Prefab chứa Node có SpriteNumber component.\n'
               + 'SlotMachineController tự instantiate và inject vào mọi SymbolView.\n'
               + 'Để null → SpriteNumber disabled (không hiện giá trị trên sticky red).',
    })
    creditLabelPrefab: Prefab | null = null;

    @property({
        type: [SpriteFrame],
        tooltip: 'SpriteFrame cho từng Symbol — kéo 1 lần, áp dụng cho mọi SymbolView.\n[0]=minor_9 [1]=minor_10 [2]=minor_j [3]=minor_q [4]=minor_k [5]=minor_a [6]=major_horus [7]=major_anubis [8]=major_sobek [9]=major_ramses [10]=major_cleopatra [11]=wild_trail [12]=sticky_red [13]=sticky_yellow [14]=sticky_green [15]=plus_one_spin',
    })
    symbolFrames: SpriteFrame[] = [];

    @property({
        type: [SpriteFrame],
        tooltip: 'SpriteFrame BLUR tương ứng — kéo 1 lần, áp dụng cho mọi SymbolView.\nIndex = SymbolId (giống symbolFrames). Chỉ cần blur cho symbol 0..8 (xuất hiện trên reel).',
    })
    blurFrames: SpriteFrame[] = [];

    @property({
        type: Node,
        tooltip: 'Node template Spine cho highlight ô thắng (Ways Pay).\n'
               + 'Đặt 1 Node inactive trong scene, gắn sp.Skeleton với SkeletonData đúng.\n'
               + 'WaysPayDisplay sẽ instantiate node này thành pool khi start().',
    })
    highlightSpinePrefab: Node | null = null;

    @property({ tooltip: 'Tên animation Spine phát khi highlight (mặc định: "animation")' })
    highlightSpineAnim: string = 'animation';

    @property({
        type: WaysPayDisplay,
        tooltip: 'WaysPayDisplay component — gắn vào node nào đó trên scene, kéo vào đây.\nSlotMachineController sẽ tự gọi init() với highlightSpinePrefab + reels.',
    })
    waysPayDisplay: WaysPayDisplay | null = null;

    @property({ type: Node, tooltip: 'Slot machine background node (animated background quanh reels)' })
    slotBackgroundNode: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'Slot background sprite - Normal Spin' })
    normalSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'Slot background sprite - Free Spin' })
    freeSpinSprite: SpriteFrame | null = null;

    @property({ tooltip: 'Delay giữa việc bắt đầu quay mỗi reel (seconds)' })
    startStaggerDelay: number = 0.3;

    @property({ tooltip: 'Delay giữa việc dừng mỗi reel (seconds)' })
    stopInterval: number = 0.3;

    @property({ tooltip: 'Thời gian giảm tốc của Reel cuối khi Long Spin — ngắn hơn để dừng dứt khoát (seconds)' })
    longSpinDecelDuration: number = 0.5;

    @property({ tooltip: 'Chiều cao nhảy lên khi bắt đầu spin (nhân với symbolHeight). VD: 0.5 = nhảy lên 50% chiều cao symbol.' })
    launchBounceHeightRatio: number = 0.5;

    @property({ tooltip: 'Thời gian nhảy lên trong launch bounce (giây).' })
    launchBounceUpDuration: number = 0.12;

    @property({ tooltip: 'Thời gian rơi xuống trong launch bounce (giây).' })
    launchBounceDownDuration: number = 0.25;

    @property({ tooltip: 'Chiều cao hạ thêm xuống khi reel dừng (nhân với symbolHeight). VD: 0.08 = hạ thêm 8% chiều cao symbol rồi snap về.' })
    stopBounceOvershootRatio: number = 0.08;

    @property({ tooltip: 'Thời gian snap lui về vị trí đích khi reel dừng (giây).' })
    stopBounceSettleDuration: number = 0.12;

    @property({ tooltip: 'Delay (giây) giữa khi một longspin reel dừng và khi reel longspin tiếp theo bắt đầu quay' })
    longSpinNextReelDelay: number = 0.5;

    @property({ tooltip: 'Nếu true mới diễn longSpin khi đủ 3 symbol đỏ; false thì bỏ qua.' })
    isLongSpin: boolean = true;

    @property({
        tooltip: 'Center index khởi tạo cho mỗi reel (trước lần spin đầu tiên).\nLấy từ vị trí strip 1,2,3 của Parsheet (0-based: 0,1,2).',
    })
    initialCenterIndices: number[] = [0, 1, 2];

    // ─── SPEED MODE SETTINGS ───
    @property({
        type: SpeedModeSettings,
        tooltip: [
            '[NORMAL mode] Speed parameters used during standard spin.',
            'stopDelay is derived from reelIndex × stopInterval (set above).',
            'Default values → spinSpeed:7000 | minSpin:0.25/0.5fs | decel:0.15/0.27fs | longSpinDelay:2 | bounce:on | stagger:on',
        ].join('\n'),
    })
    normalModeSettings: SpeedModeSettings = new SpeedModeSettings();

    @property({
        type: SpeedModeSettings,
        tooltip: [
            '[QUICK mode] Faster spin with stagger between reels (like Normal) but no launch bounce.',
            'Default values → spinSpeed:7000 | minSpin:0.2/0.3fs | decel:0.15/0.27fs | longSpinDelay:1.5 | bounce:off | stagger:on',
        ].join('\n'),
    })
    quickModeSettings: SpeedModeSettings = (() => {
        const s = new SpeedModeSettings();
        s.spinSpeed              = 7000;
        s.minSpinDuration        = 0.2;
        s.minSpinDurationFreeSpin = 0.3;
        s.decelDuration          = 0.15;
        s.decelDurationFreeSpin  = 0.27;
        s.longSpinDelay          = 1.5;
        s.longSpinSpeed          = 10000;
        s.skipLaunchBounce       = true;
        s.noStopDelay            = false;
        return s;
    })();

    @property({
        type: SpeedModeSettings,
        tooltip: [
            '[TURBO mode] Maximum speed — instant start, instant stop, no stagger.',
            'Default values → spinSpeed:10000 | minSpin:0.125/0.2fs | decel:0.05/0.09fs | longSpinDelay:1 | bounce:off | stagger:off',
        ].join('\n'),
    })
    turboModeSettings: SpeedModeSettings = (() => {
        const s = new SpeedModeSettings();
        s.spinSpeed              = 10000;
        s.minSpinDuration        = 0.125;
        s.minSpinDurationFreeSpin = 0.2;
        s.decelDuration          = 0.05;
        s.decelDurationFreeSpin  = 0.09;
        s.longSpinDelay          = 1.5;
        s.longSpinSpeed          = 14000;
        s.skipLaunchBounce       = true;
        s.noStopDelay            = true;
        return s;
    })();

    /** Set các reel index cần long spin (được tính progressive từ redReels) */
    private _longSpinReelSet: Set<number> = new Set();
    /** Flag tích cực: true suốt từ khi LONG_SPIN_TRIGGERED đến khi longspin reel cuối dừng */
    private _isLongSpinActive: boolean = false;
    private _stoppedCount: number = 0;
    /** True khi tất cả reel đã dừng hẳn (bounce xong) — guard cho spin tiếp theo */
    private _allReelsStopped: boolean = true;
    private _stoppedReelSet: Set<number> = new Set();
    private _pendingOutOfOrderStops: Set<number> = new Set();
    private _longSpinBoundary: number = -1;
    private _pendingReelStarts: { reel: ReelController; triggerTime: number }[] = [];
    /**
     * Hàng đợi các reel đang tiếp tục quay (loop) và chờ đến lượt dừng.
     * Mỗi reel sau longspin boundary sẽ KHÔNG bị freeze — chúng tiếp tục spin bình thường.
     * stopAt() chỉ được gọi khi reel ngay trước nó đã dừng xong.
     */
    private _waitingReels: { reelIndex: number; centerIndex: number; isLong: boolean }[] = [];

    // ─── LONG SPIN VFX ───
    /**
     * Node hiệu ứng VFX bao quanh Cột 3 khi long spin.
     *
     * EDITOR SETUP:
     *   - Tạo Node con "LongSpinVFX" đặt chồng lên Cột 3 (z-order cao hơn).
     *   - Gắn Sprite component vào Node đó.
     *   - Kéo Node vào slot này.
     *   - Bắt đầu active = false.
     */
    @property({ type: Node, tooltip: 'Node VFX quanh Cột cuối khi long spin (phải inactive ban đầu)\n→ Tạo Node con, gắn Sprite, kéo vào đây' })
    longSpinVFXNode: Node | null = null;

    /**
     * Mảng SpriteFrame cho animation VFX (loop).
     *
     * EDITOR SETUP:
     *   - Kéo lần lượt các frame ảnh vào mảng này theo thứ tự.
     *   - Tạm thời dùng sprite thường; sau thay bằng Spine.
     */
    @property({ type: [SpriteFrame], tooltip: 'Danh sách SpriteFrame cho animation VFX loop\n→ Kéo lần lượt các frame vào đây' })
    vfxFrames: SpriteFrame[] = [];

    @property({ tooltip: 'Tốc độ chạy frame VFX (frames/giây)' })
    vfxFPS: number = 12;

    private _vfxSprite: Sprite | null = null;
    private _vfxFrameIdx: number = 0;
    private _vfxCb: (() => void) | null = null;
    private _isFreeSpin: boolean = false;
    /** TopUp mode: reel dùng normal strips (không dùng freeSpinReelStrips), StickyOverlayController lo hiển thị coin */
    private _isTopUp: boolean = false;
    /** PickGame mode: đổi slot background giống FreeSpin/TopUp */
    private _isPickGame: boolean = false;
    /** Danh sách {reelIndex, rowIndex} cần show hint khi long spin bắt đầu */
    private _hintPositions: { reelIndex: number; rowIndex: number }[] = [];
    private _hintBounceCb: (() => void) | null = null;

    // ─── LIFECYCLE ───

    onLoad(): void {
        const bus = EventBus.instance;
        bus.on(GameEvents.REELS_START_SPIN, this._onReelsStartSpin, this);
        bus.on(GameEvents.SPIN_RESPONSE, this._onSpinResponse, this);
        bus.on(GameEvents.LONG_SPIN_TRIGGERED, this._onLongSpin, this);
        bus.on(GameEvents.LONG_SPIN_SYMBOL_HINT, this._onLongSpinHint, this);
        bus.on(GameEvents.ENTER_SUCCESS, this._onEnterSuccess, this);
        bus.on(GameEvents.FREE_SPIN_START, this._onFreeSpinStart, this);
        bus.on(GameEvents.FREE_SPIN_END, this._onFreeSpinEnd, this);
        bus.on(GameEvents.TOPUP_START, this._onTopUpStart, this);
        bus.on(GameEvents.TOPUP_END, this._onTopUpEnd, this);
        bus.on(GameEvents.PICK_GAME_OPEN, this._onPickGameOpen, this);
        bus.on(GameEvents.PICK_GAME_CLOSE, this._onPickGameClose, this);
        bus.on(GameEvents.REELS_QUICK_STOP, this._onQuickStop, this);
        bus.on(GameEvents.RESUME_NORMAL_SPIN, this._onResumeNormalSpin, this);
        bus.on(GameEvents.RESUME_FREE_SPIN_REELS, this._onResumeFreeSpinReels, this);
        bus.on(GameEvents.BET_CHANGED, this._onBetChanged, this);

        // Khởi tạo AutoSpinManager sớm
        AutoSpinManager.instance;

        // Gán stopDelay tăng dần cho từng reel
        for (let i = 0; i < this.reels.length; i++) {
            this.reels[i].reelIndex = i;
            this.reels[i].stopDelay = i * this.stopInterval;
        }

        // Cache Sprite component trên VFX node
        if (this.longSpinVFXNode) {
            this._vfxSprite = this.longSpinVFXNode.getComponent(Sprite);
            this.longSpinVFXNode.active = false;
        }

        // Phân phối symbolFrames sớm trong onLoad() — trước khi bất kỳ event nào
        // (ENTER_SUCCESS, RESUME_NORMAL_SPIN) fire và gọi setSymbols() trên reels.
        this._distributeFramesToSymbolViews();
    }

    start(): void {

        // Khởi tạo WaysPayDisplay với highlightSpinePrefab + reels
        if (this.waysPayDisplay) {
            this.waysPayDisplay.init(this.reels, this.highlightSpinePrefab, this.highlightSpineAnim);
            SymbolView.landBounceParent = this.waysPayDisplay.node;
        }

        // Auto-wire paylineManagerNode cho SymbolHighlighter nếu chưa gán trong Editor
        const symHighlighter = this.node.getComponent(SymbolHighlighter)
            ?? this.node.getComponentInChildren(SymbolHighlighter);
        if (symHighlighter && !symHighlighter.paylineManagerNode && this.waysPayDisplay) {
            symHighlighter.paylineManagerNode = this.waysPayDisplay.node;
        }

        // Hiển thị symbol cố định từ vị trí strip ban đầu
        const reelCount = this.reels.length;
        // SAFE fallback: [0,1,0,0,...] tránh các vị trí red trong DEFAULT_REEL_STRIPS
        const safeFallback = Array.from({ length: reelCount }, (_, i) => i <= 1 ? i : 0);
        const indices = this.initialCenterIndices.length >= reelCount
            ? this.initialCenterIndices
            : safeFallback;
        // Log removed for performance
        this.setInitialSymbols(indices);

        // Gọi trực tiếp _onEnterSuccess() — real data đã có trong GameData nếu ENTER_SUCCESS đã fire.
        // Lần áp dứt khoát được đảm bảo bởi applyInitialSymbols() gọi từ _onLoadingComplete().
        this._onEnterSuccess();
    }

    /**
     * Gọi từ GameEntryController._onLoadingComplete() — đảm bảo symbols có hình đúng
     * TRƯỚC KHI GuideView hiện ra. ENTER_SUCCESS luôn fire trước LOADING_COMPLETE nên
     * GameData đã có real strips tại thời điểm này.
     */
    public applyInitialSymbols(): void {
        this._onEnterSuccess();
        // Log removed for performance
    }

    /**
     * Instantiate CreditLabel cho SymbolView chưa có (lazy / on-demand).
     * Không gọi lúc load — _distributeFramesToSymbolViews cũng tạo khi cần.
     */
    public ensureCreditLabels(): void {
        if (!this.creditLabelPrefab) return;
        for (const reel of this.reels) {
            for (const node of reel.symbolNodes) {
                const view = node.getComponent(SymbolView);
                if (view && !view.SpriteNumber) {
                    const snNode = instantiate(this.creditLabelPrefab);
                    node.addChild(snNode);
                    view.SpriteNumber = snNode.getComponent(SpriteNumber)
                        ?? snNode.getComponentInChildren(SpriteNumber);
                    if (view.SpriteNumber) {
                        view.SpriteNumber.node.active = false;
                        view.SpriteNumber.joltEnabled = false;
                    }
                }
            }
        }
    }

    /** Ghi symbolFrames + blurFrames vào từng SymbolView trên mọi reel.
     *  Nếu có creditLabelPrefab, instantiate và inject vào view.creditLabel.
     */
    private _distributeFramesToSymbolViews(): void {
        if (this.symbolFrames.length === 0) {
            // Log removed for performance
            return;
        }
        for (const reel of this.reels) {
            for (let ni = 0; ni < reel.symbolNodes.length; ni++) {
                const node = reel.symbolNodes[ni];
                const view = node.getComponent(SymbolView);
                if (view) {
                    view.symbolFrames = this.symbolFrames;
                    view.blurFrames   = this.blurFrames;
                    // Gán vị trí reel/row để setSymbol() tra cứu stickyCells
                    // Visible nodes: ni=1 (top/row2), ni=2 (mid/row1), ni=3 (bot/row0)
                    // Off-screen:    ni=0 (trên) và ni=4 (dưới) → rowIndex=-1
                    view.reelIndex = reel.reelIndex;
                    view.rowIndex  = (ni >= 1 && ni <= 3) ? (3 - ni) : -1;

                    // Inject SpriteNumber từ prefab (chỉ tạo nếu chưa có)
                    if (this.creditLabelPrefab && !view.SpriteNumber) {
                        const snNode = instantiate(this.creditLabelPrefab);
                        node.addChild(snNode);
                        view.SpriteNumber = snNode.getComponent(SpriteNumber)
                            ?? snNode.getComponentInChildren(SpriteNumber);
                        if (view.SpriteNumber) {
                            view.SpriteNumber.node.active = false;
                            // Tắt jolt — credit label phải tĩnh hoàn toàn
                            view.SpriteNumber.joltEnabled = false;
                        } else {
                            // Log removed for performance
                        }
                    }
                }
            }
        }
    }

    onDestroy(): void {
        this._pendingReelStarts = [];
        EventBus.instance.offTarget(this);
    }

    get areAllReelsStopped(): boolean {
        return this._allReelsStopped && this.reels.every((reel) => reel?.isIdle ?? true);
    }

    get areReelsVisuallyIdle(): boolean {
        return this.reels.every((reel) => reel?.isIdle ?? true);
    }

    get debugStateSummary(): string {
        const reelStates = this.reels.map((reel, i) => `R${i}:${reel?.debugState ?? 'null'}`).join(' ');
        return `all=${this._allReelsStopped} visualIdle=${this.areReelsVisuallyIdle} stopped=${this._stoppedCount}/${this.reels.length} stoppedSet=[${Array.from(this._stoppedReelSet).join(',')}] pendingOut=[${Array.from(this._pendingOutOfOrderStops).join(',')}] topUp=${this._isTopUp} free=${this._isFreeSpin} longActive=${this._isLongSpinActive} longBoundary=${this._longSpinBoundary} waiting=[${this._waitingReels.map(r => r.reelIndex).join(',')}] pendingStarts=${this._pendingReelStarts.length} ${reelStates}`;
    }

    tryRecoverReelsStopped(): boolean {
        if (this._isTopUp) return false;
        if (!this.areReelsVisuallyIdle) return false;

        if (!this._allReelsStopped) {
            this._stoppedCount = this.reels.length;
            this._allReelsStopped = true;
            this._waitingReels = [];
            this._pendingOutOfOrderStops.clear();
            this._stopLongSpinVFX(false);
        }
        Log.e(`[SPIN-STATE][SlotMC] recover/resent REELS_STOPPED | ${this.debugStateSummary}`);
        EventBus.instance.emit(GameEvents.REELS_STOPPED);
        return true;
    }

    canRunPerReelEffects(reelIndex: number): boolean {
        if (this._longSpinBoundary < 0) return true;
        if (reelIndex <= this._longSpinBoundary) return true;
        for (let i = this._longSpinBoundary; i < reelIndex; i++) {
            if (!this._stoppedReelSet.has(i)) return false;
        }
        return true;
    }

    update(): void {
        const len = this._pendingReelStarts.length;
        if (len === 0) return;

        const now = Date.now();
        let writeIdx = 0;

        for (let i = 0; i < len; i++) {
            const pending = this._pendingReelStarts[i];
            if (now >= pending.triggerTime) {
                // ★ Tối ưu: tránh tìm index bằng linear search mỗi lần
                // Dùng reelIndex được lưu sẵn nếu có, hoặc skip log nếu không quan trọng
                pending.reel.startSpin();
            } else {
                // Giữ lại - in-place filter
                this._pendingReelStarts[writeIdx++] = pending;
            }
        }

        // Truncate array
        this._pendingReelStarts.length = writeIdx;
    }

    // ─── SLOT BACKGROUND SPRITE (NORMAL/FREE SPIN) ───

    /**
     * Cập nhật sprite cho slot machine background theo Free Spin mode.
     * Normal Spin: normalSprite
     * Free Spin: freeSpinSprite
     */
    private _updateSlotBackgroundSprite(): void {
        if (!this.slotBackgroundNode) return;

        const spriteComponent = this.slotBackgroundNode.getComponent(Sprite);
        if (!spriteComponent) return;

        const isFeature = this._isFreeSpin || this._isTopUp || this._isPickGame;
        const sprite = isFeature ? this.freeSpinSprite : this.normalSprite;
        if (sprite) {
            spriteComponent.spriteFrame = sprite;
        }
    }

    /** FREE_SPIN_START event → cập nhật slot background sprite sang FreeSpin */
    private _onFreeSpinStart(): void {
        this._isFreeSpin = true;
        this._updateSlotBackgroundSprite();
    }

    /** FREE_SPIN_END event → cập nhật slot background sprite về Normal */
    private _onFreeSpinEnd(): void {
        this._isFreeSpin = false;
        this._updateSlotBackgroundSprite();
        // Defer refreshSymbols sang frame tiếp theo để đảm bảo SymbolHighlighter/WaysPayDisplay
        // đã cleanup xong trước khi emit symbol-changed.
        this.scheduleOnce(() => {
            for (const reel of this.reels) {
                if (reel) reel.refreshSymbols();
            }
        }, 0);
    }

    private _onTopUpStart(): void {
        // KHÔNG set _isFreeSpin = true — TopUp dùng normal reel strips để reel không hiện coin symbols.
        // StickyOverlayController hiển thị coin overlay độc lập (layer trên reel).
        // _isTopUp dùng để:
        //   1. Áp dụng freespin speed settings (minSpinDurationFreeSpin, decelDurationFreeSpin)
        //   2. Bỏ qua response.reelIndex khi set strip index → reel dùng normal strips khi dừng
        this._isTopUp = true;
        this._updateSlotBackgroundSprite();
    }

    private _onTopUpEnd(): void {
        this._isTopUp = false;
        this._updateSlotBackgroundSprite();
        // Defer refreshSymbols sang frame tiếp theo để đảm bảo SymbolHighlighter/WaysPayDisplay
        // đã cleanup xong trước khi emit symbol-changed.
        this.scheduleOnce(() => {
            for (const reel of this.reels) {
                if (reel) reel.refreshSymbols();
            }
        }, 0);
    }

    private _onPickGameOpen(): void {
        this._isPickGame = true;
        this._updateSlotBackgroundSprite();
    }

    private _onPickGameClose(): void {
        this._isPickGame = false;
        this._updateSlotBackgroundSprite();
    }

    /** Quick stop — người chơi nhấn Spin lại khi reel đang quay → decel ngay lập tức.
     *  Chỉ hoạt động trong normal spin, không áp dụng cho FreeSpin/TopUp/PickGame. */
    private _onQuickStop(): void {
        Log.e(`[SPIN-STATE][SlotMC] QUICK_STOP received | ${this.debugStateSummary}`);
        if (this._isFreeSpin || this._isTopUp || this._isPickGame) return;
        for (const reel of this.reels) {
            reel.forceQuickStop();
        }
        Log.e(`[SPIN-STATE][SlotMC] QUICK_STOP applied | ${this.debugStateSummary}`);
    }

    /**
     * Resume Normal Spin bị gián đoạn: snap reel về vị trí kết quả cuối,
     * đợi một frame để render xong rồi emit REELS_STOPPED kích hoạt win flow.
     */
    private _onResumeNormalSpin(rands: number[]): void {
        // Log removed for performance
        this.setInitialSymbols(rands);
        this.scheduleOnce(() => {
            EventBus.instance.emit(GameEvents.REELS_STOPPED);
        }, 0.2);
    }

    /**
     * Resume Free Spin: chỉ vẽ lại reel tĩnh từ rands, KHÔNG emit REELS_STOPPED.
     * Tránh trigger win flow của ván trước; auto-spin sẽ bắt đầu ngay sau đó.
     */
    private _onResumeFreeSpinReels(rands: number[]): void {
        // Log removed for performance
        this.setInitialSymbols(rands);
    }

    /**
     * Sau khi Enter thành công và PS được apply, gán symbol đúng từ strip.
     * Dùng center=1 (index 1 của strip sau snap) cho mỗi reel.
     */
    private _onEnterSuccess(): void {
        const data = GameData.instance;
        // FIX: dùng getReelStrips() thay vì trực tiếp data.config.reelStrips
        // để đúng khi isPurchaseReelActive=true (edge case: resume sau khi đã activate)
        const strips = data.getReelStrips(false);
        if (!strips || strips.length < this.reels.length) return;

        // ── Tính startIdx cho mỗi reel ──
        const startIdxs: number[] = [];
        for (let i = 0; i < this.reels.length; i++) {
            const strip = strips[i];
            let idx = 0;
            for (let j = 0; j < strip.length; j++) {
                if (strip[j] >= 0) { idx = j; break; }
            }
            startIdxs.push(idx);
        }

        // ── GoF: pre-populate stickyCells cho Trail Coins tại vị trí init ──
        // Phải làm TRƯỚC setSymbols() để SymbolView.setSymbol() thấy stickyCells ngay.
        //
        // Nguồn chính: rawEnterLastSpinResponse.NoramlSpinLinkReel (server typo — KHÔNG có chữ 'm' ở Normal)
        // Mỗi slot {Type, Win}: Type=1=RED, Type=2=YELLOW, Type=3=GREEN | Win = giá trị tiền tuyệt đối
        // Layout 15 slot = 3 row × 5 reel: index 0-4=row TOP(0), 5-9=row MID(1), 10-14=row BOT(2)
        const rawEnter = data.rawEnterLastSpinResponse;
        const nextStage = rawEnter?.NextStage ?? rawEnter?.nextStage ?? 0;
        // Logs removed for performance
        const linkReel = rawEnter?.NoramlSpinLinkReel ?? rawEnter?.NormalSpinLinkReel
            ?? rawEnter?.TopupReel ?? null;

        if (Array.isArray(linkReel) && linkReel.length > 0) {
            // Ưu tiên 1: Đọc trực tiếp từ NoramlSpinLinkReel / TopupReel (credit đúng từ server)
            data.stickyCells.clear();
            for (let i = 0; i < Math.min(15, linkReel.length); i++) {
                const slot = linkReel[i];
                const type = typeof slot === 'number' ? slot : (slot?.Type ?? slot?.type ?? 0);
                const win  = typeof slot === 'object' && slot !== null ? (slot.Win ?? slot.win ?? 0) : 0;
                if (type === 0) continue;

                const apiRow = Math.floor(i / 5); // 0=top-of-API 1=mid 2=bot
                const reel   = i % 5;
                // NoramlSpinLinkReel: slot 0-4=top row(apiRow=0), 5-9=mid(apiRow=1), 10-14=bot(apiRow=2)
                const row    = apiRow; // row 0=top, 1=mid, 2=bot (client convention)
                let symbolId = SymbolId.STICKY_RED;
                if (type === 2) symbolId = SymbolId.STICKY_YELLOW;
                else if (type === 3) symbolId = SymbolId.STICKY_GREEN;

                const cell: any = { reel, row, symbolId, credit: win };
                data.stickyCells.set(`${reel}-${row}`, cell);
                // Log removed for performance
            }
            // Log removed for performance
        } else if (nextStage > 0) {
            // Ưu tiên 2: Có feature đang dang dở nhưng không có LinkReel data
            // → fallback tính từ rawPsStrips + symbolPayouts
            const rawStrips = data.rawPsStrips;
            const payouts   = data.symbolPayouts;
            const hasPayouts = rawStrips.length > 0 && Object.keys(payouts).length > 0;
            // Log removed for performance
            if (hasPayouts) {
                data.stickyCells.clear();
                for (let i = 0; i < this.reels.length; i++) {
                    const rawStrip = rawStrips[i];
                    if (!rawStrip || rawStrip.length === 0) continue;
                    const len = rawStrip.length;
                    const center = startIdxs[i];
                    for (let offset = -1; offset <= 1; offset++) {
                        const sIdx = ((center + offset) % len + len) % len;
                        const psId = rawStrip[sIdx];
                        const clientId = data.psToClientMap[psId] ?? -1;
                        const isSticky = clientId === SymbolId.STICKY_RED
                            || clientId === SymbolId.STICKY_YELLOW
                            || clientId === SymbolId.STICKY_GREEN;
                        const rate = payouts[psId] ?? 0;
                        if (!isSticky && rate <= 0) continue;
                        const row = offset + 1; // -1→0(top), 0→1(mid), +1→2(bot)
                        const finalId = isSticky ? clientId : (data.psToClientMap[psId] ?? SymbolId.STICKY_RED);
                        const credit = this._toStickyCreditFromRate(rate);
                        const cell: any = { reel: i, row, symbolId: finalId, credit, _rate: rate };
                        data.stickyCells.set(`${i}-${row}`, cell);
                        // Log removed for performance
                    }
                }
            }
        } else {
            // NextStage=0: kết thúc spin bình thường, không có feature — xóa stickyCells
            // Log removed for performance
            data.stickyCells.clear();
        }

        // ── Render reel symbols (stickyCells đã sẵn sàng) ──
        for (let i = 0; i < this.reels.length; i++) {
            this.reels[i].setSymbols(startIdxs[i]);
            // Log removed for performance
        }
    }

    private _toStickyCreditFromRate(rate: number): number {
        if (rate <= 0) return 0;
        return rate < 1 ? rate * 2500 : rate;
    }

    // ─── PHASE 1: BẮT ĐẦU QUAY (ngay khi nhấn Spin, trước khi chờ server) ───

    private _onReelsStartSpin(): void {
        if (this._isTopUp) return; // TopUp mode: SlotMachineController không quay

        // Guard: reel chưa dừng hẳn từ spin trước → defer 0.2s rồi thử lại
        if (!this.areAllReelsStopped) {
            Log.e(`[SPIN-STATE][SlotMC] REELS_START_SPIN deferred | ${this.debugStateSummary}`);
            this.scheduleOnce(() => this._onReelsStartSpin(), 0.2);
            return;
        }
        this._allReelsStopped = false;

        this._stoppedCount = 0;
        this._stoppedReelSet.clear();
        this._pendingOutOfOrderStops.clear();
        this._longSpinBoundary = -1;
        this._isLongSpinActive = false;
        this._longSpinReelSet.clear();
        this._pendingReelStarts = [];
        this._waitingReels = [];
        this._hintPositions = [];
        this._stopHintBounce();
        this._resetVFX();
        Log.e(`[SPIN-STATE][SlotMC] REELS_START_SPIN accepted | ${this.debugStateSummary}`);
        // Log removed for performance

        // Áp dụng speed mode trước khi spin
        this._applySpeedMode();

        const mode = AutoSpinManager.instance.speedMode;
        const noStagger = mode === SpeedMode.TURBO;
        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            const delay = noStagger ? 0 : i * this.startStaggerDelay;
            this._scheduleReelStart(reel, delay);
        }
    }

    /**
     * Apply speed settings from the Inspector-configurable SpeedModeSettings objects
     * (normalModeSettings / quickModeSettings / turboModeSettings) to each ReelController.
     * Edit those objects in the Editor instead of touching this code.
     * 
     * CONSTRAINT: QUICK và TURBO mode phải có noStopDelay = true (tất cả reel dừng cùng lúc)
     */
    private _applySpeedMode(): void {
        const mode = AutoSpinManager.instance.speedMode;
        // TopUp dùng freespin speed settings (minSpinDurationFreeSpin, decelDurationFreeSpin)
        const fs   = this._isFreeSpin || this._isTopUp;

        let cfg: SpeedModeSettings;
        switch (mode) {
            case SpeedMode.QUICK:  cfg = this.quickModeSettings;  break;
            case SpeedMode.TURBO:  cfg = this.turboModeSettings;  break;
            default:               cfg = this.normalModeSettings; break;
        }

        // Validate constraint: TURBO phải có noStopDelay = true
        if (mode === SpeedMode.TURBO && !cfg.noStopDelay) {
            // Log removed for performance
            cfg.noStopDelay = true; // Force it
        }

        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            reel.spinSpeed        = cfg.spinSpeed;
            reel.minSpinDuration  = fs ? cfg.minSpinDurationFreeSpin : cfg.minSpinDuration;
            reel.decelDuration    = fs ? cfg.decelDurationFreeSpin   : cfg.decelDuration;
            reel.stopDelay        = cfg.noStopDelay ? 0 : i * this.stopInterval;
            reel.skipLaunchBounce       = cfg.skipLaunchBounce;
            reel.longSpinDelay            = cfg.longSpinDelay;
            reel.longSpinSpeed            = cfg.longSpinSpeed;
            reel.launchBounceHeightRatio  = this.launchBounceHeightRatio;
            reel.launchBounceUpDuration   = this.launchBounceUpDuration;
            reel.launchBounceDownDuration = this.launchBounceDownDuration;
            reel.stopBounceOvershootRatio = this.stopBounceOvershootRatio;
            reel.stopBounceSettleDuration = this.stopBounceSettleDuration;
        }
    }
    private _scheduleReelStart(reel: ReelController, delay: number): void {
        // QUAN TRỌNG: LUÔN queue qua _pendingReelStarts, KHÔNG gọi startSpin() đồng bộ dù delay=0.
        //
        // Lý do: khi REELS_START_SPIN emit, SlotMachineController và SymbolHighlighter đều lắng nghe.
        // Nếu SlotMachineController xử lý trước → startSpin() tạo launch-bounce tween trên symbolNodes.
        // SymbolHighlighter xử lý sau → _resetHighlights() → Tween.stopAllByTarget(zoomedNode) →
        // kill launch tween của Reel 0 → Reel 0 kẹt ở LAUNCHING mãi mãi → không bao giờ decel →
        // REELS_STOPPED không bao giờ emit → game đơ.
        //
        // Giải pháp: defer startSpin() sang frame tiếp theo (update loop) để SymbolHighlighter
        // đã dọn sạch zoom tweens trước khi launch tween được tạo.
        this._pendingReelStarts.push({
            reel,
            triggerTime: Date.now() + delay * 1000,
        });
    }

    // ─── PHASE 2: NHẬN KẾT QUẢ → RA LỆNH DỪNG ───

    private _onSpinResponse(response: SpinResponse): void {
        if (this._isTopUp) return; // TopUp mode: SlotMachineController không dừng reels

        const data = GameData.instance;
        const isFS = data.freeSpinRemaining > 0;
        Log.e(`[SPIN-STATE][SlotMC] SPIN_RESPONSE received | rands=${response.rands?.join(',')} reelIndex=${response.reelIndex} | ${this.debugStateSummary}`);

        // ═══ GRID COMPARE LOG: Server rands ↔ Client visual grid ═══
        {
            const clientName = (id: number): string =>
                id < 0 ? '---' : (SymbolId[id] ?? `?${id}`);

            const reelIndex  = response.reelIndex ?? 0;
            const stripSrc   = reelIndex === 1 ? 'FreeSpin'
                             : reelIndex === 2 ? 'Purchase'
                             : reelIndex === 3 ? 'ReSpin' : 'Normal';

            // Raw PS strips (PS IDs từ server) — dùng để hiện số PS ID thô
            const rawStrips    = data.getRawPsStrips(isFS, reelIndex);
            // Client strips (đã map PS→clientId) — dùng để hiện tên symbol vẽ ra
            const clientStrips = data.getReelStrips(isFS, reelIndex);

            // ReelController._getSymbols5: visual TOP = center+1, MID = center, BOT = center-1
            const serverRows: { rand: number; rawTop: number; rawMid: number; rawBot: number }[] = [];
            const clientRows: { top: number; mid: number; bot: number }[]                       = [];

            for (let c = 0; c < clientStrips.length; c++) {
                const rand   = response.rands[c] ?? 0;
                const raw    = rawStrips[c]    ?? [];
                const client = clientStrips[c] ?? [];
                const RL = raw.length;
                const CL = client.length;

                const rc = RL > 0 ? ((rand % RL) + RL) % RL : 0;
                const cc = CL > 0 ? ((rand % CL) + CL) % CL : 0;

                serverRows.push({
                    rand,
                    rawTop: RL > 0 ? raw[((rc + 1) % RL + RL) % RL] : -1,
                    rawMid: RL > 0 ? raw[rc]                         : -1,
                    rawBot: RL > 0 ? raw[((rc - 1) % RL + RL) % RL] : -1,
                });
                clientRows.push({
                    top: CL > 0 ? client[((cc + 1) % CL + CL) % CL] : -1,
                    mid: CL > 0 ? client[cc]                         : -1,
                    bot: CL > 0 ? client[((cc - 1) % CL + CL) % CL] : -1,
                });
            }

            const W = 22;
            const pad = (s: string | number) => String(s).padEnd(W);

            // PS ID + tên symbol đã map, ví dụ: "13 (MAJOR_SOBEK)"
            const fmtServer = (psId: number, clientId: number): string => {
                const name = clientId < 0 ? '---' : (SymbolId[clientId] ?? `?${clientId}`);
                return pad(`${psId} (${name})`);
            };

            const header = `════ SPIN RESULT  rands=${JSON.stringify(response.rands)}  strip=${stripSrc} ════`;
            const divider = '─'.repeat(header.length);

            const serverBlock = [
                `  ┌── SERVER (PS ID từ strip → tên symbol sau mapping) `,
                `  │  Reel   : ${serverRows.map((_, i) => pad(`Reel${i}`)).join('')}`,
                `  │  TOP r+1: ${serverRows.map((r, i) => fmtServer(r.rawTop, clientRows[i].top)).join('')}`,
                `  │  MID r  : ${serverRows.map((r, i) => fmtServer(r.rawMid, clientRows[i].mid)).join('')}  ← rand trỏ đây`,
                `  │  BOT r-1: ${serverRows.map((r, i) => fmtServer(r.rawBot, clientRows[i].bot)).join('')}`,
                `  └──`,
            ].join('\n');

            const clientBlock = [
                `  ┌── CLIENT (SymbolId client → gì vẽ lên màn hình) `,
                `  │  Reel   : ${clientRows.map((_, i) => pad(`Reel${i}`)).join('')}`,
                `  │  TOP r+1: ${clientRows.map(r => pad(clientName(r.top))).join('')}  ← hàng trên cùng`,
                `  │  MID r  : ${clientRows.map(r => pad(clientName(r.mid))).join('')}  ← hàng giữa`,
                `  │  BOT r-1: ${clientRows.map(r => pad(clientName(r.bot))).join('')}  ← hàng dưới cùng`,
                `  └──`,
            ].join('\n');

            // Log.d dùng pre-override console.log (Cocos-patched) → hiện trong Preview in-editor.
            // 'SPIN RESULT' có trong LOG_WHITELIST → pass filter.
            // Log removed for performance
        }
        // ★ Progressive Long Spin: tính toán reel nào cần long spin dựa trên tổng red SYMBOLS
        if (this._isLongSpinActive) {
            // Đếm số red symbols trên mỗi reel từ stickyCells
            const stickyCells = response.stickyCells ?? [];
            const redCountPerReel: number[] = new Array(this.reels.length).fill(0);
            for (const cell of stickyCells) {
                if (cell.symbolId === SymbolId.STICKY_RED && cell.reel >= 0 && cell.reel < this.reels.length) {
                    redCountPerReel[cell.reel]++;
                }
            }

            this._longSpinReelSet.clear();
            for (let ri = 2; ri < this.reels.length; ri++) {
                // Đếm TỔNG SỐ red symbols trên các reel [0..ri-1]
                let totalRedsBefore = 0;
                for (let r = 0; r < ri; r++) {
                    totalRedsBefore += redCountPerReel[r];
                }
                if (totalRedsBefore >= 3) {
                    this._longSpinReelSet.add(ri);
                }
            }
            // Log removed for performance
        }

        // ─── Sequential longspin: reels sau boundary tiếp tục quay, stopAt() trì hoãn ──
        // Các reel có index > boundary VẪN QUAY BÌNH THƯỜNG (loop animation).
        // stopAt() của chúng chỉ được gọi khi reel ngay trước dừng xong.
        const longSpinBoundary = (this._isLongSpinActive && this._longSpinReelSet.size > 0)
            ? Math.min(...Array.from(this._longSpinReelSet))
            : -1;
        this._longSpinBoundary = longSpinBoundary;
        Log.e(`[SPIN-STATE][SlotMC] longspin boundary resolved | boundary=${longSpinBoundary} longSet=[${Array.from(this._longSpinReelSet).join(',')}] | ${this.debugStateSummary}`);

        // ═══ TOPUP REEL DEBUG ═══
        if (this._isTopUp) {
            const data = GameData.instance;
            const respinStrip = data.config.respinReelStrips;
            const normalStrip = data.config.reelStrips;
            const SN = (id: number) => id < 0 ? '???' : (SymbolId[id] ?? `id${id}`);

            // Logs removed for performance
            if (response.stickyCells) {
                for (const c of response.stickyCells) {
                    // Log removed for performance
                }
            }

            // Tính tường minh ô nào visual reel sẽ vẽ khi dừng (dùng respinReelStrips)
            // Log removed for performance
            for (let ri = 0; ri < this.reels.length; ri++) {
                const strip = respinStrip[ri] ?? [];
                const rand  = response.rands[ri] ?? 0;
                const len   = strip.length || 1;
                const c     = ((rand % len) + len) % len;
                // ReelController visual: TOP = center+1, MID = center, BOT = center-1
                const top = strip[((c + 1) % len + len) % len];
                const mid = strip[c];
                const bot = strip[((c - 1) % len + len) % len];
                // Log removed for performance

                // Cảnh báo nếu rand trùng nhau
                if (ri > 0 && response.rands[ri] === response.rands[ri - 1]) {
                    // Log removed for performance
                }
            }

            // Kiểm tra Yellow/Green nào đang ở trong respinStrip
            const yellowInStrip: string[] = [];
            const greenInStrip:  string[] = [];
            for (let ri = 0; ri < respinStrip.length; ri++) {
                for (let si = 0; si < (respinStrip[ri] ?? []).length; si++) {
                    const sym = respinStrip[ri][si];
                    if (sym === SymbolId.STICKY_YELLOW) yellowInStrip.push(`Reel${ri}[${si}]`);
                    if (sym === SymbolId.STICKY_GREEN)  greenInStrip.push(`Reel${ri}[${si}]`);
                }
            }
            // Logs removed for performance
        }
        // ═══ END TOPUP REEL DEBUG ═══

        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            const centerIndex = response.rands[i];
            const isLong = this._longSpinReelSet.has(i);
            const reelIdx = i; // capture for closure

            // TopUp: không dùng freespin strip index — reel hiển thị normal symbols,
            // StickyOverlayController lo phần overlay coin. Truyền undefined → normal strips.
            reel.setResultStripIndex(this._isTopUp ? undefined : response.reelIndex);

            // Reel 3 long spin: kéo dài thời gian giảm tốc để tạo cảm giác hồi hộp
            if (isLong) {
                reel.decelDuration = this.longSpinDecelDuration;
            }

            reel.onSnapComplete = () => {
                this._onReelSnapped(reelIdx);
            };

            // onSymbolsSettled: tất cả symbolNodes đã có đúng symId (sau _finishDecel).
            // Dùng để emit LONG_SPIN_HINT_SHOW — tránh trường hợp onSnapComplete bắn sớm
            // (spineTriggerDistance) khiến node visual-bottom chưa có symbol đúng.
            reel.onSymbolsSettled = () => {
                this._onReelSymbolsSettled(reelIdx);
            };

            reel.onBounceStart = () => {
                EventBus.instance.emit(GameEvents.REEL_SNAPPED, reelIdx);
            };

            reel.onDecelStart = (decelDuration: number) => {
                if (isLong) EventBus.instance.emit(GameEvents.REEL_DECEL_START, { reelIndex: reelIdx, decelDuration });
            };

            reel.onStopComplete = () => {
                this._onReelStopped(reelIdx);
            };

            if (longSpinBoundary >= 0 && i > longSpinBoundary) {
                // Reel tiếp tục quay loop — lưu kết quả vào queue.
                // stopAt() sẽ được gọi khi reel ngay trước (i-1) dừng xong.
                this._waitingReels.push({ reelIndex: i, centerIndex, isLong });
                // Log removed for performance
            } else {
                // Log removed for performance
                reel.stopAt(centerIndex, isLong);
            }
        }

    }

    /**
     * Gọi ngay khi reel snap về rest (trước bounce).
     * KHÔNG còn emit LONG_SPIN_HINT_SHOW ở đây — đã chuyển sang _onReelSymbolsSettled
     * để đảm bảo tất cả symbolNodes đã có đúng symId trước khi SymbolHighlighter tìm kiếm.
     */
    private _onReelSnapped(_reelIndex: number): void {
        // Nothing to do here — REEL_SNAPPED emitted from onBounceStart
    }

    /**
     * Gọi từ onSymbolsSettled — SAU _finishDecel đã gán đúng symbol cho tất cả nodes.
     * Đây là nơi an toàn để emit LONG_SPIN_HINT_SHOW: node visual-bottom đã có symId đúng.
     */
    private _onReelSymbolsSettled(reelIndex: number): void {
        if (this._isLongSpinActive) {
            const hintPos = this._hintPositions.find(p => p.reelIndex === reelIndex);
            if (hintPos) {
                EventBus.instance.emit(GameEvents.LONG_SPIN_HINT_SHOW, [hintPos]);
            }
        }
    }

    private _canAcceptLongSpinStop(reelIndex: number): boolean {
        if (this._longSpinBoundary < 0) return true;
        if (reelIndex <= this._longSpinBoundary) return true;
        return this._stoppedReelSet.has(reelIndex - 1);
    }

    private _flushPendingLongSpinStops(): void {
        let flushed = true;
        while (flushed) {
            flushed = false;
            const pending = Array.from(this._pendingOutOfOrderStops).sort((a, b) => a - b);
            for (const reelIndex of pending) {
                if (!this._canAcceptLongSpinStop(reelIndex)) continue;
                this._pendingOutOfOrderStops.delete(reelIndex);
                Log.e(`[SPIN-STATE][SlotMC] flush pending out-of-order REEL_STOPPED reel=${reelIndex} | ${this.debugStateSummary}`);
                this._processReelStopped(reelIndex);
                flushed = true;
                break;
            }
        }
    }

    private _onReelStopped(reelIndex: number): void {
        if (this._stoppedReelSet.has(reelIndex)) {
            Log.e(`[SPIN-STATE][SlotMC] duplicate REEL_STOPPED ignored reel=${reelIndex} | ${this.debugStateSummary}`);
            return;
        }
        if (!this._canAcceptLongSpinStop(reelIndex)) {
            this._pendingOutOfOrderStops.add(reelIndex);
            Log.e(`[SPIN-STATE][SlotMC] out-of-order REEL_STOPPED held reel=${reelIndex} | ${this.debugStateSummary}`);
            return;
        }
        this._processReelStopped(reelIndex);
    }

    private _processReelStopped(reelIndex: number): void {
        this._stoppedReelSet.add(reelIndex);
        this._stoppedCount++;
        Log.e(`[GOLD-FLY][SlotMC._onReelStopped] reel=${reelIndex} _stoppedCount=${this._stoppedCount}/${this.reels.length}`);
        Log.e(`[SPIN-STATE][SlotMC] REEL_STOPPED reel=${reelIndex} | ${this.debugStateSummary}`);
        EventBus.instance.emit(GameEvents.REEL_STOPPED, reelIndex);

        // ★ Hiện credit label ngay khi reel dừng (per-reel) — chỉ cho STICKY_RED
        this._showCreditsForReel(reelIndex);

        // ★ Sequential longspin: khi reel dừng, báo cho reel đang-quay-chờ tiếp theo dừng.
        // Reel trong queue đang spin loop — chỉ cần gọi stopAt() khi đến lượt.
        // Nếu reel vừa dừng là longspin reel → thêm delay trước khi gọi stopAt() cho reel tiếp.
        if (this._waitingReels.length > 0) {
            const next = this._waitingReels[0];
            if (reelIndex === next.reelIndex - 1) {
                this._waitingReels.shift();
                const delay = this._longSpinReelSet.has(reelIndex) ? this.longSpinNextReelDelay : 0;
                // Log removed for performance
                if (this._pendingOutOfOrderStops.has(next.reelIndex)) {
                    Log.e(`[SPIN-STATE][SlotMC] skip stopAt for pending out-of-order reel=${next.reelIndex} | ${this.debugStateSummary}`);
                } else if (delay > 0) {
                    this.scheduleOnce(() => {
                        if (this._pendingOutOfOrderStops.has(next.reelIndex) || this._stoppedReelSet.has(next.reelIndex)) {
                            Log.e(`[SPIN-STATE][SlotMC] scheduled stopAt skipped for already pending/stopped reel=${next.reelIndex} | ${this.debugStateSummary}`);
                            return;
                        }
                        this.reels[next.reelIndex].stopAt(next.centerIndex, next.isLong);
                    }, delay);
                } else {
                    this.reels[next.reelIndex].stopAt(next.centerIndex, next.isLong);
                }
            }
        }

        // ★ Progressive Long Spin VFX:
        // Nếu reel hiện tại là longspin reel → VFX đang hiển thị trên nó → tắt VFX
        const nextReelIdx = reelIndex + 1;
        if (this._longSpinReelSet.has(reelIndex) && this.longSpinVFXNode?.active) {
            // keepActive = true chỉ khi reel tiếp theo cũng là longspin (sẽ bật VFX ngay sau)
            const keepActive = nextReelIdx < this.reels.length && this._longSpinReelSet.has(nextReelIdx);
            this._stopLongSpinVFX(keepActive);
        }

        // Nếu reel tiếp theo là longspin reel → bật VFX trên reel tiếp theo
        if (nextReelIdx < this.reels.length && this._longSpinReelSet.has(nextReelIdx) && this._isLongSpinActive) {
            this._moveVFXToReel(nextReelIdx);
            this._tryStartLongSpinVFX();
        }

        // Safety: nếu reel cuối dừng mà VFX vẫn active → tắt hoàn toàn
        const lastReelIdx = this.reels.length - 1;
        if (reelIndex === lastReelIdx && this._isLongSpinActive) {
            this._stopLongSpinVFX(false);
        }

        this._flushPendingLongSpinStops();

        if (this._stoppedCount === this.reels.length && !this._allReelsStopped) {
            this._allReelsStopped = true;
            Log.e(`[GOLD-FLY][SlotMC] EMIT REELS_STOPPED _stoppedCount=${this._stoppedCount}`);
            Log.e(`[SPIN-STATE][SlotMC] EMIT REELS_STOPPED | ${this.debugStateSummary}`);
            EventBus.instance.emit(GameEvents.REELS_STOPPED);
        }
    }

    /**
     * #1 Sticky Red Credit Display (per-reel):
     * Khi một reel dừng, tìm các ô STICKY_RED trên reel đó trong stickyCells
     * và gọi showCredit() NGAY LẬP TỨC — không chờ tất cả reel dừng.
     *
     * CHỈ hiện credit trên symbol thực sự là STICKY_RED (kiểm tra symbolId trên SymbolView).
     *
     * Mapping GameData row → ReelController symbolNode index:
     *   row 0 → symbolNodes[3] (visual Bot)
     *   row 1 → symbolNodes[2] (visual Mid)
     *   row 2 → symbolNodes[1] (visual Top)
     * Formula: nodeIndex = 3 - row
     */
    private _showCreditsForReel(reelIndex: number): void {
        // TopUp mode: credit label chỉ hiện trên StickyOverlay, không hiện trên background reel
        if (GameData.instance.currentMode === 'respin') return;
        const cells = GameData.instance.stickyCells;
        if (cells.size === 0) return;

        const reel = this.reels[reelIndex];
        if (!reel) return;

        let hasNewRed = false;
        for (const [key, cell] of cells) {
            if (cell.reel !== reelIndex) continue;
            // ★ Hiện credit cho STICKY_RED, STICKY_YELLOW và STICKY_GREEN
            const isStickyCoin = cell.symbolId === SymbolId.STICKY_RED
                || cell.symbolId === SymbolId.STICKY_YELLOW
                || cell.symbolId === SymbolId.STICKY_GREEN;
            if (!isStickyCoin) continue;

            const nodeIndex = 3 - cell.row;
            const node = reel.symbolNodes[nodeIndex];
            if (!node) continue;

            const view = node.getComponent(SymbolView);
            if (!view) continue;

            // Double-check: symbol visual hiện tại PHẢI là cùng loại sticky coin
            if (view.symbolId !== cell.symbolId) continue;

            view.showCredit(cell.credit);
            if (cell.symbolId === SymbolId.STICKY_RED) hasNewRed = true;
        }

        // Emit tổng Red credit hiện tại (running total) cho EachWin display
        if (hasNewRed) {
            let totalRedCredit = 0;
            let redCount = 0;
            for (const [, c] of cells) {
                if (c.symbolId === SymbolId.STICKY_RED) {
                    totalRedCredit += c.credit;
                    redCount++;
                }
            }
            EventBus.instance.emit(GameEvents.RED_CREDIT_UPDATED, { totalRedCredit, redCount, reelIndex });
        }
    }

    /**
     * Khi mức cược thay đổi: cập nhật lại credit trong stickyCells và refresh label trên reel.
     * Credit = _rate × newTotalBet.
     */
    private _onBetChanged(): void {
        const data = GameData.instance;
        const cells = data.stickyCells;
        if (cells.size === 0) return;

        // Recalculate credit dựa trên _rate đã lưu sẵn
        for (const [, cell] of cells) {
            if (cell.symbolId !== SymbolId.STICKY_RED) continue;
            if ((cell as any)._rate != null) {
                cell.credit = this._toStickyCreditFromRate((cell as any)._rate);
            }
        }

        // Refresh visible credit labels trên mọi reel
        for (let i = 0; i < this.reels.length; i++) {
            this._showCreditsForReel(i);
        }
    }

    // ─── LONG SPIN VFX ────────────────────────────────────────────────────────

    private _onLongSpin(): void {
        if (this._isTopUp) return; // TopUp mode: không cho phép longSpin
        if (!this.isLongSpin) {
            // Log removed for performance
            return;
        }
        this._isLongSpinActive = true;
        // Log removed for performance
    }

    /**
     * Gọi sau khi Cột 2 dừng và Cột 3 đang trong long spin.
     * Bật VFX node + emit event để SoundManager phát anticipation sound.
     */
    private _tryStartLongSpinVFX(): void {
        if (!this.longSpinVFXNode) {
            // Log removed for performance
            return;
        }
        if (!this._isLongSpinActive) {
            // Log removed for performance
            return;
        }
        if (this._stoppedCount >= this.reels.length) {
            // Log removed for performance
            return;
        }

        // Log removed for performance
        this.longSpinVFXNode.active = true;
        this._vfxFrameIdx = 0;
        this._startVFXLoop();
        EventBus.instance.emit(GameEvents.LONG_SPIN_VFX_START);
    }

    /** Bắt đầu loop sprite frame cho VFX */
    private _startVFXLoop(): void {
        this._stopVFXLoop();
        if (this.vfxFrames.length === 0) return;

        this._vfxCb = () => {
            if (!this.longSpinVFXNode?.active) {
                this._stopVFXLoop();
                return;
            }
            if (this._vfxSprite && this.vfxFrames.length > 0) {
                this._vfxSprite.spriteFrame = this.vfxFrames[this._vfxFrameIdx % this.vfxFrames.length];
                this._vfxFrameIdx++;
            }
        };
        this.schedule(this._vfxCb, 1 / this.vfxFPS);
    }

    /** Dừng VFX sprite loop */
    private _stopVFXLoop(): void {
        if (this._vfxCb) {
            this.unschedule(this._vfxCb);
            this._vfxCb = null;
        }
    }

    /**
     * Tắt VFX khi longspin reel dừng.
     * @param keepActive true = còn longspin reel tiếp theo (không reset _isLongSpinActive)
     */
    private _stopLongSpinVFX(keepActive: boolean = false): void {
        const wasActive = this._isLongSpinActive && this.longSpinVFXNode?.active;
        if (!keepActive) {
            this._isLongSpinActive = false;
        }
        this._stopVFXLoop();
        this._stopHintBounce();
        if (this.longSpinVFXNode) {
            this.longSpinVFXNode.active = false;
        }
        // Chỉ emit thud nếu VFX đã bật (long spin thật sự) VÀ thực sự kết thúc (không chuyển sang reel khác)
        if (wasActive && !keepActive) {
            EventBus.instance.emit(GameEvents.LONG_SPIN_VFX_END);
        }
    }

    /** Di chuyển VFX node đến vị trí của reel target */
    private _moveVFXToReel(reelIndex: number): void {
        if (!this.longSpinVFXNode) return;
        const targetReel = this.reels[reelIndex];
        if (!targetReel) return;

        const vfxParent = this.longSpinVFXNode.parent;
        if (!vfxParent) return;

        // Chuyển world X của reel sang local space của VFX parent
        const reelWorldPos = targetReel.node.worldPosition;
        const localPos = new Vec3();
        vfxParent.inverseTransformPoint(localPos, reelWorldPos);

        const pos = this.longSpinVFXNode.position.clone();
        pos.x = localPos.x;
        this.longSpinVFXNode.setPosition(pos);
    }

    /** Reset hoàn toàn khi spin mới bắt đầu */
    private _resetVFX(): void {
        this._stopVFXLoop();
        this._stopHintBounce();
        if (this.longSpinVFXNode) this.longSpinVFXNode.active = false;
    }

    // ─── LONG SPIN SYMBOL BOUNCE HINT ─────────────────────────────────────────

    /**
     * Nhận payload từ GameManager: danh sách {reelIndex, rowIndex} cần bounce.
     * Lưu lại — sẽ bắt đầu bounce khi _tryStartLongSpinVFX() được gọi (cột 2 dừng).
     */
    private _onLongSpinHint(positions: { reelIndex: number; rowIndex: number }[]): void {
        this._hintPositions = positions;
    }

    /**
     * Thông báo cho SymbolHighlighter bắt đầu spine effect trên các hint symbols.
     * Không còn dùng — hint được emit per-reel trong _onReelStopped.
     */
    private _startHintBounce(): void {
        this._hintBounceCb = () => {};
    }

    private _stopHintBounce(): void {
        this._hintBounceCb = null;
    }

    /**
     * Set hiển thị tĩnh (dùng cho init).
     */
    setInitialSymbols(centerIndices: number[]): void {
        for (let i = 0; i < this.reels.length && i < centerIndices.length; i++) {
            this.reels[i].setSymbols(centerIndices[i]);
        }
    }
}
