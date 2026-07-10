/**
 * SymbolHighlighter — Highlight symbol thắng bằng fillBlack overlay per reel.
 *
 * Thay vì vẽ đường payline, component này dim các symbol KHÔNG thắng bằng cách:
 *   1. Mỗi reel có 1 node "fillBlack" (màu đen, mặc định alpha=0, nằm NGOÀI reel parent).
 *   2. Sau khi reel dừng và có kết quả:
 *      - Reparent fillBlack VÀO cùng parent với symbolNodes[1..3].
 *      - setSiblingIndex để:  non-winning → fillBlack (alpha=0.7) → winning symbols
 *      - Winning symbols nằm TRÊN fillBlack → nổi bật.
 *      - Non-winning symbols nằm DƯỚI fillBlack → bị tối.
 *   3. Khi spin mới bắt đầu: reset fillBlack alpha về 0.
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Gắn SymbolHighlighter vào 1 Node nào đó (ví dụ cùng node với SlotMachineController).
 *   2. Kéo ReelController vào mảng "reels".
 *   3. Tạo fillBlack nodes (Sprite màu đen) → kéo vào "fillBlackNodes".
 *   4. Spine effect: TẠO Prefab riêng trong MainBundle (VD: SymbolSpine/0 … SymbolSpine/12).
 *      Điền path vào "spineEffectPrefabPaths" (index = SymbolId).
 *      KHÔNG kéo Prefab/Node vào Base — lazy bundle.load khi highlight lần đầu.
 *
 * ── NODE LAYOUT ReelController ──
 *   symbolNodes[0] = ExtraTop1  (buffer/clip)
 *   symbolNodes[1] = Top        (row 0, visible)
 *   symbolNodes[2] = Mid        (row 1, visible)
 *   symbolNodes[3] = Bot        (row 2, visible)
 *   symbolNodes[4] = ExtraBot1  (buffer/clip)
 *
 *   Tất cả là con của cùng 1 parent (reel scroll container).
 *
 * ── SIBLING ORDER SAU KHI ÁP DỤNG ──
 *   [idx 0] ExtraTop1 (giữ nguyên, dưới fillBlack)
 *   [idx 1..] non-winning visible symbols
 *   [idx ..] ExtraBot1 (đặt tường minh dưới fillBlack — tránh highlight ngoài mask)
 *   [idx ..] fillBlack (alpha ≈ 179 = 0.7 × 255)
 *   [idx ..] winning visible symbols (nổi bật trên fillBlack)
 */

import { _decorator, Component, Node, Prefab, UIOpacity, tween, Tween, Vec3, sp, instantiate, Color, Sprite, isValid, assetManager } from 'cc';
import { SpriteNumber } from '../core/SpriteNumber';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';
import { MatchedLinePay, PS_TO_CLIENT, SymbolId, WaysPayWin } from '../data/SlotTypes';
import { SoundManager } from '../manager/SoundManager';
import { AutoSpinManager, SpeedMode } from '../manager/AutoSpinManager';
import { ReelController } from './ReelController';
import { PaylineIndicatorManager } from './PaylineIndicatorManager';
import { SymbolView } from './SymbolView';
import { Log } from '../core/Logger';

const { ccclass, property } = _decorator;

/** DEBUG flag - tắt trong production để tối ưu performance */
const DEBUG = false;

/** Tạm tắt spine win highlight — dùng sprite bounce cho tới khi có asset spine symbol mới */
const USE_SPINE_WIN_HIGHLIGHT = false;

/** Bundle chứa prefab spine symbol (đã load sẵn bởi LoadingController). */
const SPINE_BUNDLE = 'MainBundle';

/**
 * Path mặc định trong MainBundle theo SymbolId.
 * Prefab name = path (không extension). Override bằng spineEffectPrefabPaths trong Inspector.
 * Chỉ các id có asset mới được map — id khác = không có spine.
 */
const DEFAULT_SPINE_PREFAB_PATHS: Readonly<Record<number, string>> = {
    [SymbolId.MINOR_9]:         'SymbolSpine/0',
    [SymbolId.MINOR_10]:        'SymbolSpine/1',
    [SymbolId.MINOR_J]:         'SymbolSpine/2',
    [SymbolId.MINOR_Q]:         'SymbolSpine/3',
    [SymbolId.MINOR_K]:         'SymbolSpine/4',
    [SymbolId.MINOR_A]:         'SymbolSpine/5',
    [SymbolId.MAJOR_HORUS]:     'SymbolSpine/6',
    [SymbolId.MAJOR_ANUBIS]:    'SymbolSpine/7',
    [SymbolId.MAJOR_CLEOPATRA]: 'SymbolSpine/10',
    [SymbolId.STICKY_RED]:      'SymbolSpine/12',
};

/** Dữ liệu theo dõi 1 spine node đang active (instantiate từ prefab) */
interface ActiveSpineEntry {
    spineNode:    Node;
    skel:         sp.Skeleton | null;
    view:         SymbolView  | null;
    symId:        number;              // SymbolId — dùng để tra cứu per-symbol timescale
    symbolNode:   Node;               // node cần lắng nghe 'symbol-changed'
    _onSymChanged: (() => void) | null; // bound listener để off() sau
    loop:         boolean;            // spine animation có loop hay không
    gen:          number;
    spriteBounce?: boolean;           // true = highlight bằng sprite bounce, không dùng spine
}

interface CellPos { col: number; row: number; }

@ccclass('SymbolHighlighter')
export class SymbolHighlighter extends Component {

    // ── EDITOR PROPERTIES ────────────────────────────────────────────────────

    @property({
        type: [ReelController],
        tooltip: '3 ReelController theo thứ tự cột 0, 1, 2',
    })
    reels: ReelController[] = [];

    @property({
        type: [Node],
        tooltip: '1 fillBlack node per reel (5 nodes cho 5 reel).\n'
               + 'Đặt NGOÀI reel parent ban đầu (ví dụ con của Canvas).\n'
               + 'Mỗi node cần UIOpacity component, opacity = 0 ban đầu.',
    })
    fillBlackNodes: Node[] = [];

    @property({ tooltip: 'Opacity của fillBlack khi active (0–255). Mặc định ≈ 210' })
    fillAlpha: number = 210;

    @property({ tooltip: 'Thời gian fade IN fillBlack (giây)' })
    fadeDuration: number = 0.15;

    @property({ tooltip: 'Scale zoom symbol thắng (1 = không zoom)' })
    cellZoomScale: number = 1.15;

    @property({ tooltip: 'Thời gian mỗi nhịp zoom in/out (giây)' })
    cellZoomDuration: number = 0.18;

    @property({ type: PaylineIndicatorManager, tooltip: 'PaylineIndicatorManager để highlight ô số đường thắng' })
    paylineIndicator: PaylineIndicatorManager | null = null;

    @property({
        type: Node,
        tooltip: 'Node PaylineManager (chứa WaysPayDisplay) để parent spine effect vào.\n'
               + 'Giúp spine nằm trên cùng, tách biệt với các Reel.',
    })
    paylineManagerNode: Node | null = null;

    @property({
        type: [String],
        tooltip: 'Path Prefab Spine trong MainBundle, index = SymbolId.\n'
               + 'Để trống slot = dùng DEFAULT_SPINE_PREFAB_PATHS hoặc không có spine.\n'
               + 'VD: SymbolSpine/0 … SymbolSpine/12.\n'
               + 'KHÔNG reference Prefab trực tiếp — lazy bundle.load khi highlight lần đầu.',
    })
    spineEffectPrefabPaths: string[] = [];

    @property({
        type: [Number],
        tooltip: 'Local position X cho mỗi spine effect node, index = SymbolId.\n'
               + 'Y mặc định = 0, chỉ cần thiết lập X.',
    })
    spineLocalPosX: number[] = [];

    @property({
        type: [Number],
        tooltip: 'Local position Y cho mỗi spine effect node, index = SymbolId.\n'
               + 'Dùng khi cần lệch Y so với symbol node.',
    })
    spineLocalPosY: number[] = [];

    @property({
        type: [Number],
        tooltip: 'TimeScale cố định cho mỗi spine effect node, index = SymbolId.\n'
               + '0 hoặc không set = tự tính từ highlightDuration (hành vi cũ).',
    })
    spineTimeScales: number[] = [];

    @property({ tooltip: 'Tên animation Spine phát khi highlight (default: "animation")' })
    spineAnimName: string = 'animation';

    @property({ tooltip: 'TimeScale spine khi Normal mode (0 = tự tính từ highlightDuration).' })
    spineTimeScaleNormal: number = 0;

    @property({ tooltip: 'TimeScale spine khi Quick mode (0 = tự tính từ highlightDuration).' })
    spineTimeScaleQuick: number = 0;

    @property({ tooltip: 'TimeScale spine khi Turbo mode (0 = tự tính từ highlightDuration).' })
    spineTimeScaleTurbo: number = 0;

    @property({ tooltip: 'Thời gian 1 vòng animation spine ở timeScale=1 (giây). Dùng khi spineTimeScales[symId] = 0.' })
    spineAnimDuration: number = 1.0;

    @property({ tooltip: 'Thời gian "show all" highlight — phải khớp WinPresenter.spinEnableDelay (giây)' })
    showAllHighlightDuration: number = 2;

    @property({ tooltip: 'Thời gian mỗi chu kỳ line cycling — phải khớp WinPresenter.lineCycleDuration (giây)' })
    lineCycleHighlightDuration: number = 2.0;

    // ── INTERNAL STATE ────────────────────────────────────────────────────────

    private _zoomedNodes: Node[] = [];
    /** Tất cả spine đang active, mỗi entry tự quản lý lifecycle qua setCompleteListener */
    private _activeSpines: ActiveSpineEntry[] = [];    /** Entries đã deactivate spine nhưng vẫn chờ 'symbol-changed' để restore sprite */
    private _pendingListeners: ActiveSpineEntry[] = [];    /** Tăng mỗi lần highlight cycle mới — callback cũ sẽ tự bỏ qua nếu gen lệch */
    private _spineGen: number = 0;
    /** Đang chờ tất cả spine từ "show all" hoàn tất để emit WIN_HIGHLIGHT_ANIM_DONE */
    private _watchingHighlightDone: boolean = false;

    /** Cells của lần jackpot reveal gần nhất — dùng để loop highlight sau popup */
    private _jackpotCells: CellPos[] = [];
    /** Callback schedule lặp highlight jackpot */
    private _jackpotCycleCallback: (() => void) | null = null;
    /** Counter tăng mỗi lần REELS_START_SPIN — dùng để tương quan debug logs */
    private _spinCount: number = 0;
    /** Nodes đang được green tint (#77FF42) trong FreeSpin — cần restore về white sau highlight */
    private _greenTintedNodes: Node[] = [];
    /** Vị trí gốc của symbol node trước khi bounce highlight (restore khi cleanup) */
    private _bounceOrigPos: Map<Node, Vec3> = new Map();
    /** CreditLabel đã reparent tạm sang paylineManagerNode: lưu parent, sibling & active gốc để restore */
    private _creditLabelRestoreData: Map<Node, { origParent: Node | null; origSibling: number; origActive: boolean }> = new Map();
    /** FreeMode STICKY_YELLOW: clone node đang hiển thị trên paylineManagerNode (symbolNode gốc -> clone) */
    private _yellowClones: Map<Node, Node> = new Map();
    private _yellowCloneTweens: Map<Node, Tween> = new Map();
    private _currentLineWinCount: number = 0;

    /** Prefab đã lazy-load theo SymbolId — không serialize trên Base. */
    private _spinePrefabCache: Map<number, Prefab> = new Map();
    /** In-flight load promises theo path — tránh double bundle.load. */
    private _spinePrefabLoading: Map<string, Promise<Prefab | null>> = new Map();

    // ── LIFECYCLE ────────────────────────────────────────────────────────────

    onLoad(): void {
        // Đảm bảo tất cả fillBlack bắt đầu với opacity = 0
        for (const fb of this.fillBlackNodes) {
            if (fb) this._setOpacity(fb, 0);
        }

        const bus = EventBus.instance;
        bus.on(GameEvents.UI_UPDATE_WIN_LABEL,    this._onLineHighlight,     this);
        bus.on(GameEvents.WIN_SHOW_ALL_LINES,      this._onShowAllLines,     this);
        bus.on(GameEvents.WIN_SHOW_ALL_WAYS,       this._onShowAllWays,      this);
        bus.on(GameEvents.WIN_CYCLE_ONE_WAY,       this._onCycleOneWay,      this);
        bus.on(GameEvents.JACKPOT_END,         this._onJackpotEndHighlight, this);
        bus.on(GameEvents.REELS_START_SPIN,    this._onReelsStartSpin, this);
        // Cập nhật highlight frame mode khi vào/thoát Feature game
        bus.on(GameEvents.FREE_SPIN_START,      this._onFeatureGameStart, this);
        bus.on(GameEvents.FREE_SPIN_GOLD_START, this._onFeatureGameStart, this);
        bus.on(GameEvents.TOPUP_START,           this._onFeatureGameStart, this);
        bus.on(GameEvents.FREE_SPIN_END,         this._onFeatureGameEnd,   this);
        bus.on(GameEvents.FREE_SPIN_GOLD_END,    this._onFeatureGameEnd,   this);
        bus.on(GameEvents.TOPUP_END,             this._onFeatureGameEnd,   this);
        // Long spin hint: spine effect trên 2 symbol ở reel1+reel2 tương tự highlight
        bus.on(GameEvents.LONG_SPIN_HINT_SHOW,     this._onLongSpinHintShow,     this);
        // Jackpot reveal: play spine cả 3 symbol cùng lúc trước khi popup hiện (mọi loại jackpot)
        bus.on(GameEvents.LONG_SPIN_JACKPOT_REVEAL, this._onLongSpinJackpotReveal, this);
        // Bonus reveal: highlight symbol Bonus trước khi FreeSpinPopup hiện
        bus.on(GameEvents.FREE_SPIN_BONUS_REVEAL, this._onBonusReveal, this);
        // Feature Select popup hiện → cleanup spine/credit labels ngay (sớm hơn FREE_SPIN_START)
        bus.on(GameEvents.FEATURE_SELECT_OPEN, this._onFeatureSelectOpen, this);
        bus.on(GameEvents.CREDIT_FLY_IN_START, this._onFeatureSelectOpen, this);
        // FeatureEntryGuide xuất hiện → tắt highlight symbol ngay trước khi guide chạy
        bus.on(GameEvents.FORCE_FEATURE_ENTRY_START, this._onFeatureSelectOpen, this);
        bus.on(GameEvents.PICK_GAME_OPEN, this._onPickGameBoundary, this);
        bus.on(GameEvents.PICK_GAME_CLOSE, this._onPickGameBoundary, this);
        // Red symbol bounce trước khi fly-in (6+ Red → feature)
        bus.on(GameEvents.RED_SYMBOL_BOUNCE, this._onRedSymbolBounce, this);
    }

    onDestroy(): void {
        this._deactivateAllSpines();
        EventBus.instance.offTarget(this);
    }

    // ── EVENT HANDLERS ────────────────────────────────────────────────────────

    /** Cycling từng line một → chỉ highlight cells của line đó */
    private _onLineHighlight(linePay: MatchedLinePay): void {
        const cells = this._getWinningCells(linePay);
        Log.e(`[SymbolHighlighter][CYCLE-DEBUG] _onLineHighlight: line#${linePay.payLineIndex} cells=[${cells.map(c=>`(${c.col},${c.row})`).join(',')}]`);
        if (DEBUG) console.log(
            `%c[HighlightDebug] _onLineHighlight line#${linePay.payLineIndex} cells=[${cells.map(c=>`(${c.col},${c.row})`).join(',')}]`,
            'color:#ff0;font-weight:bold'
        );
        // Force-clean toàn bộ spine cũ trước khi activate line mới — tránh orphan spine nodes
        // (entries có thể đã bị xóa khỏi active/pending nhưng spineNode vẫn còn trên PaylineManager)
        this._deactivateAllSpines();
        this._applyHighlight(cells);
        this._zoomCells(cells);
        this._activateSpinesForCells(cells, this.lineCycleHighlightDuration);
        this.paylineIndicator?.showWinLine(linePay.payLineIndex);
        this._playSymbolMatchSound(linePay.matchedSymbols);
    }

    /** Phát sound tương ứng với loại symbol thắng của line: Wild > Major
     *  matchedSymbols chứa raw PS IDs từ server — cần convert qua psToClientMap trước khi so sánh. */
    private _playSymbolMatchSound(syms: number[]): void {
        const snd = SoundManager.instance;
        if (!snd || syms.length === 0) return;
        // Convert raw PS IDs → client SymbolIds; fallback to raw value when map empty (mock mode)
        const clientSyms = this._normalizeSymbols(syms);
        const isWild = clientSyms.includes(SymbolId.WILD);
        const isCleopatra = clientSyms.includes(SymbolId.MAJOR_CLEOPATRA);
        if (isCleopatra) {
            snd.playGirlSymbolAnim();
        }
        if (isWild) {
            snd.playSymbolMatchWild();
        }
    }

    /** Hiện tất cả winning lines cùng lúc → highlight union của mọi cell thắng */
    private _normalizeSymbols(syms: number[]): number[] {
        const map = GameData.instance.psToClientMap ?? {};
        return syms.map(symId => {
            if (map[symId] !== undefined) return map[symId];
            if (PS_TO_CLIENT[symId] !== undefined) return PS_TO_CLIENT[symId];
            return symId;
        });
    }

    private _onShowAllLines(lines: MatchedLinePay[], duration?: number): void {
        Log.e(`[SymbolHighlighter][CYCLE-DEBUG] _onShowAllLines: lines=${lines?.length ?? 0} duration=${duration ?? 'undefined'}`);
        this._currentLineWinCount = lines?.length ?? 0;
        // ── DEBUG: log toàn bộ kết quả spin ──────────────────────────────────────
        // {
        //     const totalWin = lines.reduce((s, l) => s + (l.winAmount ?? 0), 0);
        //     const paylines = GameData.instance.config.paylines;
        //     Log.e(
        //         `[HighlightDebug #${this._spinCount}] ═══ WIN RESULT: ${lines.length} line(s), totalWin≈${totalWin.toFixed(2)} ═══\n` +
        //         lines.map((l, i) => {
        //             const pl = paylines[l.payLineIndex];
        //             const plStr = pl ? pl.map((r, c) => `(col${c},row${r})`).join(',') : 'N/A';
        //             const si = l.matchedSymbolsIndices;
        //             const siStr = si && si.length > 0
        //                 ? si.map(s => `(col${s.Item1},row${s.Item2})`).join(',')
        //                 : 'none';
        //             return `  [line${i}] payLine#${l.payLineIndex} win=${(l.winAmount ?? 0).toFixed(2)}` +
        //                    ` | SERVER=[${siStr}] | PAYLINEDEF=[${plStr}]`;
        //         }).join('\n')
        //     );
        // }
        // ─────────────────────────────────────────────────────────────────────────
        const allCells: CellPos[] = [];
        for (const line of lines) {
            for (const c of this._getWinningCells(line)) {
                if (!allCells.some(x => x.col === c.col && x.row === c.row)) {
                    allCells.push(c);
                }
            }
        }
        // Log.e(
        //     `[HighlightDebug #${this._spinCount}] SHOW_ALL_LINES` +
        //     ` unionCells=[${allCells.map(c => `col${c.col}row${c.row}`).join(',')}]`
        // );
        // Bonus symbol (cột 2) được xử lý riêng qua FREE_SPIN_BONUS_REVEAL —
        // KHÔNG đưa vào allCells để tránh fillBlack highlight cho nó.
        this._applyHighlight(allCells);
        // Zoom cho gold coin được xử lý trong _applyGreenTint (gọi từ _activateSpinesForCells)
        // Dùng duration từ WinPresenter.spinEnableDelay nếu được truyền vào,
        // fallback sang property showAllHighlightDuration nếu không
        // Nếu chỉ có 1 line win duy nhất → loop spine animation thay vì play once
        const loopSpine = lines.length === 1;
        this.paylineIndicator?.showMultipleWinLines(lines.map(l => l.payLineIndex));

        // Phát sound nếu có wild trong bất kỳ line nào
        const allSyms = lines.flatMap(l => l.matchedSymbols ?? []);
        if (allSyms.length > 0) this._playSymbolMatchSound(allSyms);

        // Chờ lazy-load + spawn xong rồi mới quyết định WIN_HIGHLIGHT_ANIM_DONE
        // (tránh emit sớm khi prefab chưa load).
        void this._activateSpinesForCells(allCells, duration ?? this.showAllHighlightDuration, loopSpine)
            .then(() => this._finishShowAllHighlightWatch(loopSpine));
    }

    // ── WAYS PAY HIGHLIGHT ────────────────────────────────────────────────────

    /**
     * Hiện fillBlack cho TẤT CẢ Ways Pay wins cùng lúc (union của mọi winning cell).
     * Được gọi khi WinPresenter emit WIN_SHOW_ALL_WAYS.
     */
    private _onShowAllWays(ways: WaysPayWin[], duration?: number): void {
        Log.e(`[SymbolHighlighter][CYCLE-DEBUG] _onShowAllWays: ways=${ways?.length ?? 0} duration=${duration ?? 'undefined'}`);
        const allCells: CellPos[] = [];
        for (const way of ways) {
            for (const { reel, row } of way.cells) {
                // grid row (0=center-1=visual Bot, 2=center+1=visual Top): displayRow = 2 - gridRow
                const displayRow = 2 - row;
                if (!allCells.some(x => x.col === reel && x.row === displayRow)) {
                    allCells.push({ col: reel, row: displayRow });
                }
            }
        }

        // ══ DEBUG LOG ══
        const _SYM = (id: number) => `${id}(${['9','10','J','Q','K','A','Horus','Anubis','Sobek','Ramses','Cleo','Wild','StkR','StkY','StkG','+1','JP0','JPMini','JPMinor','JPMaj','JPGrand'][id]??'?'})`;
        const _vGrid = this.reels.map((reel, col) => {
            const ids = [reel.symbolNodes[1], reel.symbolNodes[2], reel.symbolNodes[3]]
                .map(n => n?.getComponent(SymbolView)?.symbolId ?? -1);
            return `R${col}[T=${_SYM(ids[0])} M=${_SYM(ids[1])} B=${_SYM(ids[2])}]`;
        });
        if (DEBUG) {
            const _reelIdx = this.reels.map(r => (r as any).reelIndex ?? '?');
            console.log(
                `%c[SymHighlight] _onShowAllWays: ${ways.length} way(s)`,
                'color:#0ff;font-weight:bold'
            );
        }
        // ══════════════

        // ══ WILD MISMATCH DEBUG LOG ══
        const SYM_W = (id: number) => `${id}(${['9','10','J','Q','K','A','Horus','Anubis','Sobek','Ramses','Cleo','Wild','StkR','StkY','StkG','+1','JP0','JPMini','JPMinor','JPMaj','JPGrand'][id]??'?'})`;
        for (const way of ways) {
            const wayCells = way.cells.map(({ reel, row }) => ({ col: reel, row: 2 - row }));
            const cellDetails = wayCells.map(({ col, row }) => {
                const reel = this.reels[col];
                const node = reel?.symbolNodes[row + 1];
                const actualSymId = node?.getComponent(SymbolView)?.symbolId ?? -1;
                const expectedSymId = way.symbolId;
                const isMatch = actualSymId === expectedSymId || (way.containsWild && actualSymId === SymbolId.WILD);
                return `    col${col}:row${row} actual=${SYM_W(actualSymId)} expected=${SYM_W(expectedSymId)} ${isMatch ? '✅' : '❌ MISMATCH'}`;
            }).join('\n');
            Log.e(
                `[WILD-DEBUG][ShowAllWays] Way symbol=${SYM_W(way.symbolId)} reelCount=${way.reelCount} ways=${way.ways} containsWild=${way.containsWild}\n` +
                `  cells:\n${cellDetails}`
            );
        }
        // ══════════════

        this._applyHighlight(allCells);
        // Zoom cho gold coin được xử lý trong _applyGreenTint (gọi từ _activateSpinesForCells)
        // Nếu chỉ có 1 way win duy nhất → loop spine animation thay vì play once
        const loopSpine = ways.length === 1;

        // Play sound if Cleopatra/Wild in any way
        const waySyms = ways.map(w => w.symbolId);
        if (waySyms.length > 0) this._playSymbolMatchSound(waySyms);

        // Chờ lazy-load + spawn xong rồi mới quyết định WIN_HIGHLIGHT_ANIM_DONE
        void this._activateSpinesForCells(allCells, duration ?? this.showAllHighlightDuration, loopSpine)
            .then(() => this._finishShowAllHighlightWatch(loopSpine));
    }

    /**
     * Sau khi spine đã spawn (kể cả sau lazy-load): quyết định emit WIN_HIGHLIGHT_ANIM_DONE ngay
     * hay chờ setCompleteListener. Loop / chỉ Wild → emit ngay.
     */
    private _finishShowAllHighlightWatch(loopSpine: boolean): void {
        Log.e(`[HighlightDebug] showAll spawn done active=${this._activeSpines.length} pending=${this._pendingListeners.length} entries=[${this._activeSpines.map(e=>`sym${e.symId}(${e.symbolNode.name})`).join(',')}]`);
        // Wild / loop không tự complete — emit ngay. Còn lại chờ setCompleteListener / bounce complete.
        const nonWildActive = this._activeSpines.filter(e => e.symId !== SymbolId.WILD);
        if (loopSpine || nonWildActive.length === 0) {
            EventBus.instance.emit(GameEvents.WIN_HIGHLIGHT_ANIM_DONE);
        } else {
            this._watchingHighlightDone = true;
        }
    }

    /**
     * Hiện fillBlack cho 1 Way cụ thể trong vòng lặp cycling.
     * Được gọi khi WinPresenter emit WIN_CYCLE_ONE_WAY.
     */
    private _onCycleOneWay(way: WaysPayWin): void {
        Log.e(`[SymbolHighlighter][CYCLE-DEBUG] _onCycleOneWay: symbolId=${way.symbolId} reelCount=${way.reelCount} ways=${way.ways} cells=[${way.cells.map(c=>`(${c.reel},${c.row})`).join(',')}]`);
        // grid row ngược với visual row: displayRow = 2 - gridRow
        const cells: CellPos[] = way.cells.map(({ reel, row }) => ({ col: reel, row: 2 - row }));

        // ══ DEBUG LOG: Calculator data vs Visual display ══
        // In ra symbol ID mà calculator tính (way.cells) và symbol ID thực tế trên screen
        const SYM = (id: number) => `${id}(${['9','10','J','Q','K','A','Horus','Anubis','Sobek','Ramses','Cleo','Wild','StkR','StkY','StkG','+1','JP0','JPMini','JPMinor','JPMaj','JPGrand'][id] ?? '?'})`;
        const visualGrid = this.reels.map((reel, col) => {
            const nodes = [reel.symbolNodes[1], reel.symbolNodes[2], reel.symbolNodes[3]];
            const ids   = nodes.map(n => n?.getComponent(SymbolView)?.symbolId ?? -1);
            return `R${col}[Top=${SYM(ids[0])} Mid=${SYM(ids[1])} Bot=${SYM(ids[2])}]`;
        });
        if (DEBUG) console.log(`[SymHighlight] _onCycleOneWay: sym=${way.symbolId} reels=${way.reelCount}`);
        // ══════════════
        if (way.containsWild || way.symbolId === SymbolId.WILD) {
            for (const c of cells) {
                const reel = this.reels[c.col];
                const node = reel?.symbolNodes[c.row + 1];
                const actual = node?.getComponent(SymbolView)?.symbolId ?? -1;
                if (actual !== SymbolId.WILD && actual !== way.symbolId) {
                    Log.e(`[WILD-MISMATCH][CycleOneWay] col=${c.col} row=${c.row} actual=${SYM(actual)} expectedWild or ${SYM(way.symbolId)}`);
                }
            }
        }

        // Deactivate spine cho symbol không còn trong way mới (cả active + pending)
        // Freemode: giữ STICKY_YELLOW entries (loop spine) — không deactivate khi cycle sang way khác
        const isFreeMode = GameData.instance.currentMode === 'freespin' || GameData.instance.currentMode === 'freespin_gold';
        const nodeSet = new Set(cells.map(c => this.reels[c.col]?.symbolNodes[c.row + 1]).filter((n): n is Node => !!n));
        for (const entry of [...this._activeSpines, ...this._pendingListeners]) {
            if (!nodeSet.has(entry.symbolNode)) {
                // Freemode: STICKY_YELLOW giữ nguyên trên PaylineManager suốt toàn bộ cycle
                if (isFreeMode && entry.symId === SymbolId.STICKY_YELLOW) continue;
                this._deactivateEntry(entry);
            }
        }
        // Cleanup orphan spine nodes trên PaylineManager (không còn entry nào track).
        // ★ KHÔNG đụng highlight của WaysPayDisplay — chúng cũng là sp.Skeleton children
        //   của cùng PaylineManager. Chỉ dọn orphan khi dùng spine win highlight của highlighter.
        if (USE_SPINE_WIN_HIGHLIGHT && this.paylineManagerNode) {
            const trackedSpines = new Set([...this._activeSpines, ...this._pendingListeners].map(e => e.spineNode));
            const orphans = this.paylineManagerNode.children.filter(
                child => child.getComponent(sp.Skeleton) && !trackedSpines.has(child),
            );
            for (const child of orphans) {
                this._destroySpineNode(child);
            }
        }

        this._applyHighlight(cells);
        this._zoomCells(cells);
        this._activateSpinesForCells(cells, this.lineCycleHighlightDuration);
    }

    /**
     * Khi reel mới bắt đầu: force-clear TOÀN BỘ spine + reset fillBlack + zoom + sibling order.
     *
     * BUG CŨ: Chỉ gọi _resetHighlights() mà không clear spines → trong Quick/Turbo mode,
     * 'symbol-changed' có thể không fire nếu node không scroll đủ (reel dừng nhanh),
     * khiến spine effect của lần thắng trước kẹt lại trên symbol nodes → highlight sai symbol.
     *
     * FIX: Gọi _deactivateAllSpines() trước _resetHighlights() để đảm bảo sạch hoàn toàn.
     * Longspin hint/bonus reveal đều thuộc spin VỪA KẾT THÚC → safe to clear khi spin mới bắt đầu.
     */
    private _onReelsStartSpin(): void {
        this._spinCount++;
        this._currentLineWinCount = 0;
        if (DEBUG) console.log(`[HighlightDebug] _onReelsStartSpin #${this._spinCount}`);
        this._resetGreenTint();
        this._watchingHighlightDone = false;
        this._stopJackpotCycle();
        // Xóa jackpot cells của lần quay trước để không merge vào highlight của lần quay mới.
        this._jackpotCells = [];
        // Tăng gen để vô hiệu hóa các callback highlight cũ còn treo.
        this._spineGen++;
        // Hard-reset toàn bộ spine (active + pending) để đảm bảo sạch hoàn toàn
        // khi bắt đầu lượt quay mới — ngăn các spine giữ frame cuối còn tồn tại trên màn hình.
        this._deactivateAllSpines();
        this._resetHighlights();
        this._restoreReparentedSymbolNodes();
        this._restoreCreditLabels();
        SymbolView.restoreAllLandBounces();
        //Log.e(`[HighlightDebug #${this._spinCount}] ═══ REELS_START_SPIN — kept ${this._pendingListeners.length} pending spine(s) for scroll-out cleanup ═══`);
    }

    /** Reset về trạng thái trung tính: fillBlack alpha=0, zoom trả về defaultScale, restore sibling order */
    private _resetHighlights(): void {
        this.paylineIndicator?.resetAllIndicators();
        this._resetGreenTint();
        // Spine không bị deactivate ở đây — chỉ symbol-changed mới được restore sprite
        // Dừng zoom và reset scale về defaultScale (không hardcode 1)
        for (const n of this._zoomedNodes) {
            Tween.stopAllByTarget(n);
            const baseScale = this._getDefaultScale(n);
            n.setScale(baseScale, baseScale, 1);
        }
        this._zoomedNodes = [];

        // Ẩn fillBlack trên tất cả reels
        for (let col = 0; col < this.fillBlackNodes.length; col++) {
            const fb = this.fillBlackNodes[col];
            if (!fb) continue;
            this._setOpacity(fb, 0);
            fb.active = false;
        }
    }

    // ── SPINE HIGHLIGHT (Prefab instantiate on demand) ───────────────────────

    /**
     * Hard-reset: deactivate tất cả spine và restore sprite ngay lập tức.
     * Chỉ gọi khi cần force-clean (onDestroy, hoặc reset cứng).
     * Trong gameplay bình thường: spine tự deactivate qua symbol-changed.
     */
    private _deactivateAllSpines(): void {
        this._spineGen++;
        const all = [...this._activeSpines, ...this._pendingListeners];
        this._activeSpines = [];
        this._pendingListeners = [];
        for (const entry of all) {
            if (entry._onSymChanged) {
                entry.symbolNode.off('symbol-changed', entry._onSymChanged);
                entry._onSymChanged = null;
            }
            if (entry.spriteBounce) {
                this._stopSpriteBounce(entry);
                if (entry.view) entry.view.setSpriteVisible(true);
                continue;
            }
            if (entry.skel && entry.spineNode.active) entry.skel.setCompleteListener(null);
            // Destroy clone STICKY_YELLOW (freemode) thay vì restore reparent
            const clone = this._yellowClones.get(entry.symbolNode);
            if (clone && isValid(clone)) {
                Tween.stopAllByTarget(clone);
                clone.destroy();
                Log.e(`[FreeYellow] _deactivateAll DESTROY clone for ${entry.symbolNode.name}`);
            }
            this._yellowClones.delete(entry.symbolNode);
            this._yellowCloneTweens.delete(entry.symbolNode);
            if (entry.view) entry.view.setSpriteVisible(true);
            this._destroySpineNode(entry.spineNode);
        }
    }

    /** Path prefab trong MainBundle cho SymbolId (Inspector override → default map → null). */
    private _getSpinePrefabPath(symId: number): string | null {
        const override = this.spineEffectPrefabPaths[symId];
        if (typeof override === 'string' && override.trim().length > 0) {
            return override.trim();
        }
        return DEFAULT_SPINE_PREFAB_PATHS[symId] ?? null;
    }

    /** Lazy-load 1 prefab spine theo SymbolId; cache sau lần đầu. */
    private _ensureSpinePrefab(symId: number): Promise<Prefab | null> {
        const cached = this._spinePrefabCache.get(symId);
        if (cached) return Promise.resolve(cached);

        const path = this._getSpinePrefabPath(symId);
        if (!path) return Promise.resolve(null);

        const inflight = this._spinePrefabLoading.get(path);
        if (inflight) {
            return inflight.then((prefab) => {
                if (prefab) this._spinePrefabCache.set(symId, prefab);
                return prefab;
            });
        }

        const promise = new Promise<Prefab | null>((resolve) => {
            const bundle = assetManager.getBundle(SPINE_BUNDLE);
            if (!bundle) {
                Log.w(`[SymbolHighlighter] Bundle '${SPINE_BUNDLE}' missing — cannot lazy-load ${path}`);
                resolve(null);
                return;
            }
            bundle.load(path, Prefab, (err: Error | null, prefab: Prefab) => {
                this._spinePrefabLoading.delete(path);
                if (err || !prefab) {
                    Log.w(`[SymbolHighlighter] Lazy load failed: ${path}`, err);
                    resolve(null);
                    return;
                }
                this._spinePrefabCache.set(symId, prefab);
                Log.d(`[SymbolHighlighter] Lazy-loaded spine prefab: ${path}`);
                resolve(prefab);
            });
        });
        this._spinePrefabLoading.set(path, promise);
        return promise;
    }

    /** Đảm bảo tất cả prefab cho danh sách SymbolId đã có trong cache. */
    private async _ensureSpinePrefabs(symIds: number[]): Promise<void> {
        const unique = [...new Set(symIds.filter((id) => id >= 0 && this._getSpinePrefabPath(id)))];
        if (unique.length === 0) return;
        await Promise.all(unique.map((id) => this._ensureSpinePrefab(id)));
    }

    /** Instantiate spine effect từ prefab đã cache theo SymbolId. */
    private _spawnSpineFromPrefab(symId: number): Node | null {
        const prefab = this._spinePrefabCache.get(symId);
        if (!prefab) return null;
        const spineNode = instantiate(prefab);
        spineNode.active = false;
        return spineNode;
    }

    /** Destroy spine node đã instantiate từ prefab. */
    private _destroySpineNode(spineNode: Node | null | undefined): void {
        if (!spineNode || !spineNode.isValid) return;
        const skel = spineNode.getComponent(sp.Skeleton);
        if (skel) skel.setCompleteListener(null);
        spineNode.active = false;
        spineNode.destroy();
    }

    /**
     * Ưu tiên:
     *   1. Mode-based timescale (spineTimeScaleNormal/Quick/Turbo) nếu > 0
     *   2. Per-symbol timescale (spineTimeScales[symId]) nếu > 0
     *   3. Tự tính từ highlightDuration để animation vừa khít 1 cycle
     */
    private _getTimeScaleForSym(symId: number, highlightDuration: number): number {
        const mode = AutoSpinManager.instance.speedMode;
        let modeScale = 0;
        if (mode === SpeedMode.NORMAL) modeScale = this.spineTimeScaleNormal;
        else if (mode === SpeedMode.QUICK) modeScale = this.spineTimeScaleQuick;
        else if (mode === SpeedMode.TURBO) modeScale = this.spineTimeScaleTurbo;
        if (modeScale > 0) return modeScale;

        const custom = this.spineTimeScales[symId] ?? 0;
        if (custom > 0) return custom;

        const BUFFER     = 0.05;
        const playWindow = Math.max(highlightDuration - BUFFER, 0.1);
        return Math.min(Math.max(this.spineAnimDuration / playWindow, 1.0), 10);
    }

    /**
     * Với mỗi winning cell:
     *   - Nếu USE_SPINE_WIN_HIGHLIGHT=false → giữ sprite, nhún nhẹ (bounce) thay spine.
     *   - Nếu node đã có spine active (từ lần highlight trước) → replay animation.
     *   - Nếu chưa có → lazy-load prefab (lần đầu) rồi instantiate.
     *   - Animation xong: move sang _pendingListeners, spine GIỮ frame cuối trên node.
     *   - symbol-changed: điều kiện DUY NHẤT để destroy spine + restore sprite.
     *
     * @returns Promise resolve khi spawn sync đã chạy xong (sau lazy-load nếu cần).
     */
    private _activateSpinesForCells(cells: CellPos[], highlightDuration: number, loopSpine: boolean = false): Promise<void> {
        if (!USE_SPINE_WIN_HIGHLIGHT) {
            this._activateSpinesForCellsSync(cells, highlightDuration, loopSpine);
            return Promise.resolve();
        }

        // Collect SymbolIds cần load trước khi spawn (tránh hitch giữa các cell)
        const neededIds: number[] = [];
        for (const { col, row } of cells) {
            const reel = this.reels[col];
            const symbolNode = reel?.symbolNodes[row + 1];
            if (!symbolNode) continue;
            if (this._findEntryOnNode(symbolNode)) continue; // replay — đã có instance
            const symId = symbolNode.getComponent(SymbolView)?.symbolId ?? -1;
            if (symId >= 0 && this._getSpinePrefabPath(symId) && !this._spinePrefabCache.has(symId)) {
                neededIds.push(symId);
            }
        }

        if (neededIds.length === 0) {
            this._activateSpinesForCellsSync(cells, highlightDuration, loopSpine);
            return Promise.resolve();
        }

        const gen = this._spineGen;
        return this._ensureSpinePrefabs(neededIds).then(() => {
            if (gen !== this._spineGen) return; // spin/highlight mới đã hủy request này
            if (!this.isValid) return;
            this._activateSpinesForCellsSync(cells, highlightDuration, loopSpine);
        });
    }

    /** Phần sync sau khi prefab đã sẵn sàng (hoặc sprite-bounce mode). */
    private _activateSpinesForCellsSync(cells: CellPos[], highlightDuration: number, loopSpine: boolean = false): void {
        // KHÔNG gọi _deactivateAllSpines — spine từ cycle trước vẫn tiếp tục giữ frame cuối
        if (DEBUG) console.log(`[HighlightDebug] _activateSpinesForCells cells=[${cells.map(c=>`(${c.col},${c.row})`).join(',')}]`);

        for (const { col, row } of cells) {
            const reel = this.reels[col];
            if (!reel) continue;
            const symbolNode = reel.symbolNodes[row + 1];
            if (!symbolNode) continue;

            const view  = symbolNode.getComponent(SymbolView);
            const symId = view?.symbolId ?? -1;

            const existing = this._findEntryOnNode(symbolNode);

            // FreeSpin: STICKY_YELLOW (đồng xu vàng tính như wild) → green tint thay vì spine
            if (this._shouldUseGreenTint(symId)) {
                if (existing) {
                    this._deactivateEntry(existing);
                }
                this._applyGreenTint(symbolNode);
                continue;
            }

            if (!USE_SPINE_WIN_HIGHLIGHT) {
                this._activateSpriteBounceForCell(symbolNode, view, symId, highlightDuration, loopSpine, existing);
                continue;
            }

            if (existing) {
                if (DEBUG) console.log(`[HighlightDebug] cell(${col},${row}) EXISTING → REPLAY`);
                const ts = this._getTimeScaleForSym(existing.symId, highlightDuration);
                this._replayEntry(existing, ts);
                // Freemode + STICKY_YELLOW: clone symbolNode cho paylineManagerNode
                const isFreeYellowExisting = existing.symId === SymbolId.STICKY_YELLOW
                    && (GameData.instance.currentMode === 'freespin' || GameData.instance.currentMode === 'freespin_gold');
                if (isFreeYellowExisting && this.paylineManagerNode) {
                    let clone = this._yellowClones.get(symbolNode);
                    if (!clone || !isValid(clone)) {
                        clone = instantiate(symbolNode);
                        this._yellowClones.set(symbolNode, clone);
                        Log.e(`[FreeYellow] REPLAY clone col=${col} row=${row}`);
                    }
                    const sv = symbolNode.getComponent(SymbolView);
                    const symScale = sv?.defaultScale ?? 1;
                    clone.setScale(symScale, symScale, 1);
                    clone.setParent(this.paylineManagerNode, true);
                    clone.setWorldPosition(symbolNode.getWorldPosition());
                    clone.setSiblingIndex(this.paylineManagerNode.children.length - 1);
                    clone.active = true;
                    // Nhún zoom nhẹ lên xuống loop trên clone
                    const oldTween2 = this._yellowCloneTweens.get(symbolNode);
                    if (oldTween2) { oldTween2.stop(); this._yellowCloneTweens.delete(symbolNode); }
                    const t2 = tween(clone)
                        .to(0.35, { scale: new Vec3(symScale * 1.08, symScale * 1.08, 1) }, { easing: 'sineOut' })
                        .to(0.35, { scale: new Vec3(symScale, symScale, 1) }, { easing: 'sineIn' })
                        .union()
                        .repeatForever()
                        .start();
                    this._yellowCloneTweens.set(symbolNode, t2);
                }
                continue;
            }

            // Nếu WildTrailController đang chạy spine (Impact/trail chưa xong) → để nó tự kết thúc,
            // không xóa. SymbolHighlighter sẽ spawn spine highlight của riêng mình lên trên.
            // Chỉ destroy nếu spine đó không còn active (đã freeze ở frame cuối).
            const wildTrailSpine = this._findSpineNodeOnNode(symbolNode);
            if (wildTrailSpine && !wildTrailSpine.active) {
                wildTrailSpine.destroy();
                if (view) view.setSpriteVisible(true);
            }

            if (symId < 0) {
                if (DEBUG) console.log(`[HighlightDebug] cell(${col},${row}) SKIP invalid symId`);
                continue;
            }

            const spineNode = this._spawnSpineFromPrefab(symId);
            if (!spineNode) {
                if (DEBUG) console.log(`[HighlightDebug] cell(${col},${row}) SKIP no prefab for symId=${symId}`);
                // Prefab chưa có / load fail → fallback bounce để vẫn có feedback
                this._activateSpriteBounceForCell(symbolNode, view, symId, highlightDuration, loopSpine, null);
                continue;
            }

            // Freemode + STICKY_YELLOW: giữ sprite visible, reparent symbolNode lên paylineManagerNode
            // để nằm trên spine effect highlight (sibling index cao hơn).
            // Các symbol khác: ẩn sprite — spine thay thế hoàn toàn.
            const isFreeYellow = symId === SymbolId.STICKY_YELLOW
                && (GameData.instance.currentMode === 'freespin' || GameData.instance.currentMode === 'freespin_gold');
            if (!isFreeYellow) {
                if (view) view.setSpriteVisible(false);
            }

            const posX = this.spineLocalPosX[symId] ?? 0;
            const posY = this.spineLocalPosY[symId] ?? 0;

            if (this.paylineManagerNode) {
                // Parent vào PaylineManager để nằm trên cùng, tách biệt reel
                spineNode.setParent(this.paylineManagerNode, false);
                spineNode.setWorldPosition(symbolNode.getWorldPosition());
                // Chỉ Wild được đẩy lên sibling index cao nhất; các symbol khác giữ mặc định append
                if (symId === SymbolId.WILD) {
                    spineNode.setSiblingIndex(this.paylineManagerNode.children.length - 1);
                }
                if (posX !== 0 || posY !== 0) {
                    spineNode.setPosition(spineNode.position.x + posX, spineNode.position.y + posY, spineNode.position.z);
                }
                // Freemode + STICKY_YELLOW: clone symbolNode cho paylineManagerNode,
                // sibling index cao hơn spine effect để clone nằm trên effect highlight.
                if (isFreeYellow) {
                    let clone = this._yellowClones.get(symbolNode);
                    if (!clone || !isValid(clone)) {
                        clone = instantiate(symbolNode);
                        this._yellowClones.set(symbolNode, clone);
                        Log.e(`[FreeYellow] NEW clone col=${col} row=${row}`);
                    }
                    const symScale = view?.defaultScale ?? 1;
                    clone.setScale(symScale, symScale, 1);
                    clone.setParent(this.paylineManagerNode, true);
                    clone.setWorldPosition(symbolNode.getWorldPosition());
                    clone.setSiblingIndex(this.paylineManagerNode.children.length - 1);
                    clone.active = true;
                    // Nhún zoom nhẹ lên xuống loop trên clone
                    const oldTween2 = this._yellowCloneTweens.get(symbolNode);
                    if (oldTween2) { oldTween2.stop(); this._yellowCloneTweens.delete(symbolNode); }
                    const t2 = tween(clone)
                        .to(0.35, { scale: new Vec3(symScale * 1.08, symScale * 1.08, 1) }, { easing: 'sineOut' })
                        .to(0.35, { scale: new Vec3(symScale, symScale, 1) }, { easing: 'sineIn' })
                        .union()
                        .repeatForever()
                        .start();
                    this._yellowCloneTweens.set(symbolNode, t2);
                    Log.e(`[FreeYellow] NEW DONE col=${col} row=${row} cloneSib=${clone.getSiblingIndex()} total=${this.paylineManagerNode.children.length}`);
                } else if (symId === SymbolId.STICKY_YELLOW) {
                    // Base game: reparent CreditLabel lên paylineManagerNode
                    this._reparentCreditLabel(symbolNode);
                }
            } else {
                spineNode.setParent(symbolNode, false);
                spineNode.setSiblingIndex(0);
                spineNode.setPosition(posX, posY, 0);
            }
            spineNode.active = true;
            if (DEBUG) console.log(`[HighlightDebug] cell(${col},${row}) CREATE spine from prefab symId=${symId}`);

            const skel = spineNode.getComponent(sp.Skeleton);
            const entry: ActiveSpineEntry = {
                spineNode,
                skel:         skel ?? null,
                view:         view ?? null,
                symId,
                symbolNode,
                _onSymChanged: null,
                loop:         false,
                gen:          this._spineGen,
            };
            this._activeSpines.push(entry);

            // Wild: loop trong suốt thời gian highlight (chỉ deactivate khi _deactivateEntry/_deactivateAllSpines)
            // Các symbol khác: loop nếu loopSpine=true, STICKY_YELLOW luôn loop
            const shouldLoop = symId === SymbolId.WILD || (symId !== SymbolId.WILD && loopSpine) || symId === SymbolId.STICKY_YELLOW;
            entry.loop = shouldLoop;
            const timeScale = this._getTimeScaleForSym(symId, highlightDuration);
            if (skel) {
                skel.timeScale = timeScale;
                skel.clearTrack(0);
                skel.setAnimation(0, this._getSpineAnimName(symId), shouldLoop); // STICKY_YELLOW luôn loop

                if (!shouldLoop) {
                    // Animation xong: clear listener, GIỮ frame cuối, chuyển sang pending
                    const completeGen = entry.gen;
                    skel.setCompleteListener(() => {
                        this._onSpineComplete(entry, completeGen);
                    });
                }
            }

            const onSymChanged = () => this._onEntrySymbolChanged(entry);
            entry._onSymChanged = onSymChanged;
            symbolNode.on('symbol-changed', onSymChanged);
        }

        // Đẩy tất cả Wild spine lên sibling index cao nhất trong paylineManagerNode
        // để đảm bảo Wild luôn nằm trên cùng so với mọi spine khác bất kể thứ tự thêm.
        if (this.paylineManagerNode) {
            const allEntries = [...this._activeSpines, ...this._pendingListeners];
            for (const entry of allEntries) {
                if (entry.symId === SymbolId.WILD && entry.spineNode.isValid && entry.spineNode.parent === this.paylineManagerNode) {
                    entry.spineNode.setSiblingIndex(this.paylineManagerNode.children.length - 1);
                }
            }
            // Đẩy tất cả STICKY_YELLOW clones lên TRÊN CÙNG (sau Wild)
            // — do vòng lặp xử lý từng cell tuần tự, spine của cell sau sẽ đè lên clone của cell trước.
            // Pass thứ 2 này đảm bảo tất cả clone đều nằm trên tất cả spine effects.
            for (const [, clone] of this._yellowClones) {
                if (isValid(clone) && clone.parent === this.paylineManagerNode) {
                    clone.setSiblingIndex(this.paylineManagerNode.children.length - 1);
                }
            }
        }
    }

    /** Sprite bounce thay spine khi USE_SPINE_WIN_HIGHLIGHT=false. */
    private _activateSpriteBounceForCell(
        symbolNode: Node,
        view: SymbolView | null,
        symId: number,
        highlightDuration: number,
        loopSpine: boolean,
        existing: ActiveSpineEntry | null,
    ): void {
        const shouldLoop = symId === SymbolId.WILD || loopSpine || symId === SymbolId.STICKY_YELLOW;

        if (existing) {
            if (!existing.spriteBounce) {
                this._deactivateEntry(existing);
                existing = null;
            } else {
                existing.loop = shouldLoop;
                existing.gen = this._spineGen;
                this._startSpriteBounce(existing, highlightDuration);
                const pendIdx = this._pendingListeners.indexOf(existing);
                if (pendIdx >= 0) {
                    this._pendingListeners.splice(pendIdx, 1);
                    this._activeSpines.push(existing);
                }
                return;
            }
        }

        if (symId < 0) return;
        view?.setSpriteVisible(true);

        const entry: ActiveSpineEntry = {
            spineNode:  symbolNode,
            skel:       null,
            view,
            symId,
            symbolNode,
            _onSymChanged: null,
            loop:       shouldLoop,
            gen:        this._spineGen,
            spriteBounce: true,
        };
        this._activeSpines.push(entry);
        this._startSpriteBounce(entry, highlightDuration);

        const onSymChanged = () => this._onEntrySymbolChanged(entry);
        entry._onSymChanged = onSymChanged;
        symbolNode.on('symbol-changed', onSymChanged);
    }

    private _startSpriteBounce(entry: ActiveSpineEntry, highlightDuration: number): void {
        const node = entry.symbolNode;
        if (!node?.isValid) return;

        Tween.stopAllByTarget(node);
        const baseScale = entry.view?.defaultScale ?? this._getDefaultScale(node);
        node.setScale(baseScale, baseScale, 1);

        if (!this._bounceOrigPos.has(node)) {
            this._bounceOrigPos.set(node, node.position.clone());
        }
        const origPos = this._bounceOrigPos.get(node)!;
        node.setPosition(origPos);

        const dur = Math.max(0.18, Math.min(0.32, highlightDuration * 0.12));
        const liftY = 10;
        const bounceOnce = tween(node)
            .to(dur, {
                position: new Vec3(origPos.x, origPos.y + liftY, origPos.z),
                scale: new Vec3(baseScale * 1.05, baseScale * 1.05, 1),
            }, { easing: 'sineOut' })
            .to(dur, {
                position: origPos,
                scale: new Vec3(baseScale, baseScale, 1),
            }, { easing: 'sineIn' });

        if (entry.loop) {
            bounceOnce.union().repeatForever().start();
            return;
        }

        const completeGen = entry.gen;
        bounceOnce.call(() => this._onSpriteBounceComplete(entry, completeGen)).start();
    }

    private _stopSpriteBounce(entry: ActiveSpineEntry): void {
        const node = entry.symbolNode;
        if (!node?.isValid) return;
        Tween.stopAllByTarget(node);
        const origPos = this._bounceOrigPos.get(node);
        if (origPos) {
            node.setPosition(origPos);
            this._bounceOrigPos.delete(node);
        }
        const baseScale = entry.view?.defaultScale ?? this._getDefaultScale(node);
        node.setScale(baseScale, baseScale, 1);
    }

    private _onSpriteBounceComplete(entry: ActiveSpineEntry, gen: number): void {
        if (gen !== this._spineGen) return;

        const idx = this._activeSpines.indexOf(entry);
        if (idx < 0) return;

        this._activeSpines.splice(idx, 1);
        if (entry._onSymChanged && !this._pendingListeners.includes(entry)) {
            this._pendingListeners.push(entry);
        }

        const nonWildActive = this._activeSpines.filter(e => e.symId !== SymbolId.WILD);
        if (this._watchingHighlightDone && nonWildActive.length === 0) {
            this._watchingHighlightDone = false;
            EventBus.instance.emit(GameEvents.WIN_HIGHLIGHT_ANIM_DONE);
        }
    }

    /** Tìm entry đang giữ spine trên symbolNode (active hoặc pending). */
    private _findEntryOnNode(symbolNode: Node): ActiveSpineEntry | null {
        return this._activeSpines.find(e => e.symbolNode === symbolNode)
            ?? this._pendingListeners.find(e => e.symbolNode === symbolNode)
            ?? null;
    }

    /** Trả về tên animation spine cho symbol — WILD dùng "win" khi highlight, các symbol khác dùng spineAnimName. */
    private _getSpineAnimName(symId: number): string {
        return symId === SymbolId.WILD ? 'Win' : this.spineAnimName;
    }

    /**
     * Play lại animation trên entry đã có (không tạo spine mới).
     * Đưa entry về _activeSpines nếu đang ở _pendingListeners.
     */
    private _replayEntry(entry: ActiveSpineEntry, timeScale: number): void {
        const skel = entry.skel;
        if (DEBUG) console.log(`[HighlightDebug] _replayEntry symId=${entry.symId}`);
        if (!skel) return;

        // Đảm bảo spine vẫn active (pending entries đã bị deactivate chưa? Không nữa)
        if (!entry.spineNode.active) entry.spineNode.active = true;

        // Wild: luôn loop khi highlight (nhất quán với logic tạo mới)
        const shouldLoop = entry.symId === SymbolId.WILD || (entry.symId !== SymbolId.WILD && entry.loop) || entry.symId === SymbolId.STICKY_YELLOW;
        entry.gen = this._spineGen;
        skel.timeScale = timeScale;
        skel.clearTrack(0);
        skel.setAnimation(0, this._getSpineAnimName(entry.symId), shouldLoop);

        // Đặt lại setCompleteListener (chỉ nếu không loop)
        if (!shouldLoop) {
            const completeGen = entry.gen;
            skel.setCompleteListener(() => {
                this._onSpineComplete(entry, completeGen);
            });
        }

        // Move từ pending → active nếu cần
        const pendIdx = this._pendingListeners.indexOf(entry);
        if (pendIdx >= 0) {
            this._pendingListeners.splice(pendIdx, 1);
            this._activeSpines.push(entry);
        }
    }

    private _onSpineComplete(entry: ActiveSpineEntry, gen: number): void {
        if (gen !== this._spineGen) return;
        if (entry.skel && entry.spineNode.active) entry.skel.setCompleteListener(null);

        const idx = this._activeSpines.indexOf(entry);
        if (idx < 0) return;

        this._activeSpines.splice(idx, 1);
        if (entry._onSymChanged && !this._pendingListeners.includes(entry)) {
            this._pendingListeners.push(entry);
        }

        // Wild loop mãi nên không bao giờ fire complete — chỉ đếm non-Wild entries khi quyết định done.
        const nonWildActive = this._activeSpines.filter(e => e.symId !== SymbolId.WILD);
        if (this._watchingHighlightDone && nonWildActive.length === 0) {
            this._watchingHighlightDone = false;
            EventBus.instance.emit(GameEvents.WIN_HIGHLIGHT_ANIM_DONE);
        }
    }

    /**
     * Callback từ 'symbol-changed' trên symbolNode.
     * Node đã scroll ra ngoài vùng mask và được wrap lên đầu với symbol mới.
     * Đây là điều kiện DUY NHẤT để restore sprite và deactivate spine.
     * Không có gen check — luôn thực hiện bất kể cycle hiện tại là gì.
     */
    private _onEntrySymbolChanged(entry: ActiveSpineEntry): void {
        if (DEBUG) console.log(`[HighlightDebug] _onEntrySymbolChanged symId=${entry.symId}`);
        // Reset green tint nếu node đang tinted
        this._resetGreenTintForNode(entry.symbolNode);

        // Gỡ listener
        if (entry._onSymChanged) {
            entry.symbolNode.off('symbol-changed', entry._onSymChanged);
            entry._onSymChanged = null;
        }
        if (entry.skel && entry.spineNode.active) entry.skel.setCompleteListener(null);

        // Destroy clone STICKY_YELLOW (freemode) thay vì restore reparent
        const clone = this._yellowClones.get(entry.symbolNode);
        if (clone && isValid(clone)) {
            Tween.stopAllByTarget(clone);
            clone.destroy();
        }
        this._yellowClones.delete(entry.symbolNode);
        this._yellowCloneTweens.delete(entry.symbolNode);

        // Restore sprite
        if (entry.view) entry.view.setSpriteVisible(true);

        if (entry.spriteBounce) {
            this._stopSpriteBounce(entry);
            let idx = this._activeSpines.indexOf(entry);
            if (idx >= 0) this._activeSpines.splice(idx, 1);
            idx = this._pendingListeners.indexOf(entry);
            if (idx >= 0) this._pendingListeners.splice(idx, 1);
            return;
        }

        this._destroySpineNode(entry.spineNode);

        // Xóa khỏi cả 2 danh sách
        let idx = this._activeSpines.indexOf(entry);
        if (idx >= 0) this._activeSpines.splice(idx, 1);
        idx = this._pendingListeners.indexOf(entry);
        if (idx >= 0) this._pendingListeners.splice(idx, 1);
    }

    // ── FREE SPIN GREEN TINT HELPERS ─────────────────────────────────────────

    private _shouldUseGreenTint(symId: number): boolean {
        return false;
    }

    private _applyGreenTint(symbolNode: Node): void {
        const spr = symbolNode.getComponent(Sprite) ?? symbolNode.getComponentInChildren(Sprite);
        if (!spr) return;
        spr.color = new Color(0x77, 0xFF, 0x42, 255);
        // Chỉ zoom tween LẦN ĐẦU tiên trong spin — nếu node đã tinted rồi thì giữ scale hiện tại
        if (this._greenTintedNodes.includes(symbolNode)) return;
        this._greenTintedNodes.push(symbolNode);
        // Zoom up cho coin vàng — scale lên 1.15 và GIỮ NGUYÊN cho tới lượt tiếp theo
        const view = symbolNode.getComponent(SymbolView);
        const baseScale = view?.defaultScale ?? 1;
        const s = 1.15; // hardcode zoom scale cho gold coin, không phụ thuộc inspector
        const d = this.cellZoomDuration;
        Tween.stopAllByTarget(symbolNode);
        symbolNode.setScale(baseScale, baseScale, 1);
        tween(symbolNode)
            .to(d, { scale: new Vec3(s * baseScale, s * baseScale, 1) }, { easing: 'backOut' })
            .start();
    }

    private _resetGreenTintForNode(node: Node): void {
        const idx = this._greenTintedNodes.indexOf(node);
        if (idx < 0) return;
        this._greenTintedNodes.splice(idx, 1);
        if (!node.isValid) return;
        const spr = node.getComponent(Sprite) ?? node.getComponentInChildren(Sprite);
        if (spr) spr.color = Color.WHITE.clone();
        // Không reset scale — coin giữ nguyên zoom 1.15 cho tới lượt tiếp theo
        Tween.stopAllByTarget(node);
    }

    private _resetGreenTint(): void {
        for (const node of this._greenTintedNodes) {
            if (!node.isValid) continue;
            const spr = node.getComponent(Sprite) ?? node.getComponentInChildren(Sprite);
            if (spr) spr.color = Color.WHITE.clone();
            // Không reset scale — coin giữ nguyên zoom 1.15 cho tới lượt tiếp theo
            Tween.stopAllByTarget(node);
        }
        this._greenTintedNodes = [];
    }

    private _deactivateEntry(entry: ActiveSpineEntry): void {
        if (entry._onSymChanged) {
            entry.symbolNode.off('symbol-changed', entry._onSymChanged);
            entry._onSymChanged = null;
        }
        if (entry.spriteBounce) {
            this._stopSpriteBounce(entry);
            if (entry.view) entry.view.setSpriteVisible(true);
            let idx = this._activeSpines.indexOf(entry);
            if (idx >= 0) this._activeSpines.splice(idx, 1);
            idx = this._pendingListeners.indexOf(entry);
            if (idx >= 0) this._pendingListeners.splice(idx, 1);
            return;
        }
        if (entry.skel && entry.spineNode.active) entry.skel.setCompleteListener(null);
        // Destroy clone STICKY_YELLOW (freemode) thay vì restore reparent
        const clone = this._yellowClones.get(entry.symbolNode);
        if (clone && isValid(clone)) {
            Tween.stopAllByTarget(clone);
            clone.destroy();
        }
        this._yellowClones.delete(entry.symbolNode);
        this._yellowCloneTweens.delete(entry.symbolNode);
        if (entry.view) entry.view.setSpriteVisible(true);
        Log.e(`[HighlightDebug] _deactivateEntry sym=${entry.symId} spineNode=${entry.spineNode.name}`);
        this._destroySpineNode(entry.spineNode);
        let idx = this._activeSpines.indexOf(entry);
        if (idx >= 0) this._activeSpines.splice(idx, 1);
        idx = this._pendingListeners.indexOf(entry);
        if (idx >= 0) this._pendingListeners.splice(idx, 1);
    }

    // ── CORE HIGHLIGHT LOGIC ─────────────────────────────────────────────────

    /**
     * Reset fillBlack và sibling order cho 1 reel cụ thể.
     * Dùng khi reel đó không có symbol nào thắng trong cycle hiện tại
     * (tránh lưu lại fillBlack state từ cycle/lần quay trước).
     */
    private _resetReelHighlight(col: number): void {
        const fb = this.fillBlackNodes[col];
        if (!fb) return;
        this._setOpacity(fb, 0);
        fb.active = false;
    }

    private _applyHighlight(winningCells: CellPos[]): void {
        if (DEBUG) console.log(`[SymHighlight] _applyHighlight: cells=[${winningCells.map(c => `col${c.col}:row${c.row}`).join(',')}]`);

        // Jackpot được xử lý như 1 line thường qua WinPresenter cycling —
        // KHÔNG merge _jackpotCells vào mọi lần highlight. Mỗi line cycle chỉ
        // highlight đúng cells của line đó; jackpot symbols sẽ bị dim khi line
        // khác đang được cycle (giống behavior các line thường).
        for (let col = 0; col < this.fillBlackNodes.length; col++) {
            const fillBlack = this.fillBlackNodes[col];
            if (!fillBlack) continue;

            fillBlack.active = true;

            // Chỉ fade in lần đầu tiên (khi alpha đang = 0).
            const currentAlpha = this._getUIOpacity(fillBlack).opacity;
            if (currentAlpha < this.fillAlpha) {
                this._fadeOpacity(fillBlack, currentAlpha, this.fillAlpha, this.fadeDuration);
            }
        }
    }

    // ── ZOOM ANIMATION ────────────────────────────────────────────────────────

    private _zoomCells(cells: CellPos[]): void {
        if (DEBUG) console.log(`[HighlightDebug] _zoomCells cells=[${cells.map(c=>`(${c.col},${c.row})`).join(',')}]`);
        for (const { col, row } of cells) {
            const reel = this.reels[col];
            const node = reel?.symbolNodes[row + 1] as Node | undefined;
            // zooming
        }
        // Dừng zoom cũ — reset về defaultScale
        for (const n of this._zoomedNodes) {
            Tween.stopAllByTarget(n);
            const baseScale = this._getDefaultScale(n);
            n.setScale(baseScale, baseScale, 1);
        }
        this._zoomedNodes = [];

        const s = this.cellZoomScale;
        const d = this.cellZoomDuration;

        for (const { col, row } of cells) {
            const reel = this.reels[col];
            if (!reel) continue;
            const node = reel.symbolNodes[row + 1] as Node | undefined;
            if (!node) continue;

            this._zoomedNodes.push(node);
            const baseScale = this._getDefaultScale(node);
            node.setScale(baseScale, baseScale, 1);
            tween(node)
                .to(d, { scale: new Vec3(s * baseScale, s * baseScale, 1) }, { easing: 'backOut' })
                .to(d, { scale: new Vec3(baseScale, baseScale, 1) }, { easing: 'sineOut' })
                .call(() => {
                    node.setScale(baseScale, baseScale, 1);
                })
                .start();
        }
    }

    // ── FEATURE GAME MODE HANDLERS ────────────────────────────────────────────

    /** Vào Feature/Free Bonus game → cập nhật indicator highlight frame và cleanup spine/highlight cũ */
    private _onFeatureGameStart(): void {
        this.paylineIndicator?.setFeatureGameMode(true);
        // Cleanup toàn bộ spine và highlight còn sót từ base game —
        // đảm bảo khi vào feature mode không còn Wild spine effect nào dính lại.
        this._deactivateAllSpines();
        this._resetHighlights();
        this._restoreReparentedSymbolNodes();
        this._restoreCreditLabels();
        this._jackpotCells = [];
    }

    /** Thoát Feature/Free Bonus game → quay lại Base Game frame */
    private _onFeatureGameEnd(): void {
        this.paylineIndicator?.setFeatureGameMode(false);
        // Cleanup toàn bộ spine và highlight còn sót từ feature —
        // đảm bảo reel normal mode không còn đồng tiền vàng highlight dính trên màn hình.
        this._deactivateAllSpines();
        this._resetHighlights();
        this._restoreReparentedSymbolNodes();
        this._restoreCreditLabels();
        SymbolView.restoreAllLandBounces();
        this._jackpotCells = [];
    }

    /** Popup Select Feature hiện lên → cleanup spine/credit labels ngay (sớm hơn FREE_SPIN_START) */
    private _onFeatureSelectOpen(): void {
        this._deactivateAllSpines();
        this._resetHighlights();
        this._restoreReparentedSymbolNodes();
        this._restoreCreditLabels();
        SymbolView.restoreAllLandBounces();
        this._jackpotCells = [];
    }

    /** PickGame can interrupt normal win cycling; clear all line highlight runtime state. */
    private _onPickGameBoundary(): void {
        this._watchingHighlightDone = false;
        this._stopJackpotCycle();
        this._deactivateAllSpines();
        this._resetHighlights();
        this._restoreReparentedSymbolNodes();
        this._restoreCreditLabels();
        SymbolView.restoreAllLandBounces();
        this._jackpotCells = [];
    }

    // ── RED SYMBOL BOUNCE (trước khi vào feature) ─────────────────────────────

    /**
     * Tất cả STICKY_RED symbol trên màn hình nhún nhẹ lên cùng lúc.
     * Gọi khi đủ >= 6 Red → trước khi fly-in animation bắt đầu.
     */
    private _onRedSymbolBounce(): void {
        const bounceScale = 1.18;
        const dur = 0.15;

        for (const reel of this.reels) {
            // symbolNodes[1]=Top, [2]=Mid, [3]=Bot (visible rows)
            for (let ni = 1; ni <= 3; ni++) {
                const node = reel.symbolNodes[ni] as Node | undefined;
                if (!node) continue;
                const view = node.getComponent(SymbolView);
                if (!view || view.symbolId !== SymbolId.STICKY_RED) continue;

                const base = this._getDefaultScale(node);
                Tween.stopAllByTarget(node);
                node.setScale(base, base, 1);
                tween(node)
                    .to(dur, { scale: new Vec3(bounceScale * base, bounceScale * base, 1) }, { easing: 'backOut' })
                    .to(dur, { scale: new Vec3(base, base, 1) }, { easing: 'sineOut' })
                    .call(() => node.setScale(base, base, 1))
                    .start();
            }
        }
    }

    // ── LONG SPIN HINT ────────────────────────────────────────────────────────

    /**
     * Khi 1 reel hint dừng: phát spine effect 1 lần (dừng ở frame cuối).
     * payload: [{reelIndex, rowIndex}] (luôn là 1 phần tử — emit per-reel)
     */
    private _onLongSpinHintShow(positions: { reelIndex: number; rowIndex: number }[]): void {
        const cells: CellPos[] = positions.map(p => ({ col: p.reelIndex, row: this._toDisplayRow(p.rowIndex) }));
        if (cells.length === 0) return;
        // duration=10 → timeScale=1.0 (tốc độ animation bình thường)
        this._activateSpinesForCells(cells, 10.0);
    }

    /**
     * Jackpot xác nhận: replay spine trên 3 symbol cùng lúc.
     * Được emit cho mọi loại jackpot (long spin hoặc không) để đảm bảo spines luôn active.
     * payload: [{reel0}, {reel1}, {reel2}]
     */
    private _onLongSpinJackpotReveal(positions: { reelIndex: number; rowIndex: number }[], _jackpot?: number): void {
        const cells: CellPos[] = positions.map(p => ({ col: p.reelIndex, row: this._toDisplayRow(p.rowIndex) }));
        // Lưu lại cells để dùng khi loop sau popup đóng
        this._jackpotCells = cells;
        if (cells.length === 0) return;
        this._applyHighlight(cells);
        this._activateSpinesForCells(cells, 10.0);
    }

    /**
     * Sau jackpot popup đóng: nhường hoàn toàn cho WinPresenter cycling.
     * WinPresenter._onJackpotEndForCycle() đã được gọi TRƯỚC (đăng ký trước) —
     * đã emit WIN_SHOW_ALL_LINES và schedule _startLineCycle cho tất cả lines (kể cả jackpot line).
     * Handler này chỉ emit JACKPOT_LOOP_START (cho PayOutDisplay/các component khác) rồi return;
     * không chạy loop jackpot riêng để tránh xung đột với WinPresenter cycling.
     */
    private _onJackpotEndHighlight(): void {
        if (this._jackpotCells.length === 0) return;
        this._stopJackpotCycle();

        // Báo cho PayOutDisplay và các component khác xóa hiệu ứng jackpot
        EventBus.instance.emit(GameEvents.JACKPOT_LOOP_START);

        // WinPresenter hoàn toàn kiểm soát cycling (bao gồm cả jackpot line).
        // Không reset highlight và không loop riêng ở đây.
    }

    private _stopJackpotCycle(): void {
        if (this._jackpotCycleCallback) {
            this.unschedule(this._jackpotCycleCallback);
            this._jackpotCycleCallback = null;
        }
    }

    /**
     * Bonus trigger: phát spine highlight trên symbol Bonus (col 2) trước FreeSpinPopup.
     * Reset fillBlack/highlight win trước — để bonus animation hiển thị rõ không bị che.
     */
    private _onBonusReveal(positions: { reelIndex: number; rowIndex: number }[]): void {
        const cells: CellPos[] = positions.map(p => ({ col: p.reelIndex, row: this._toDisplayRow(p.rowIndex) }));
        if (cells.length === 0) return;
        // Xóa highlight win (fillBlack) trước để bonus symbol không bị dim bởi các reel khác
        this._resetHighlights();
        this._activateSpinesForCells(cells, 2.0);
    }

    // ── HELPERS ──────────────────────────────────────────────────────────────

    /**
     * Lấy danh sách {col, row} của các ô thắng trong 1 payline.
     * Ưu tiên matchedSymbolsIndices từ server, fallback sang payline definition.
     */
    private _getWinningCells(linePay: MatchedLinePay): CellPos[] {
        const serverIdx = linePay.matchedSymbolsIndices;
        if (serverIdx && serverIdx.length >= 3) {
            // Validate: col phải trong [0, reels.length-1], row phải trong [0, 2]
            const maxCol = this.reels.length - 1;
            const valid = serverIdx.every(s =>
                s.Item1 >= 0 && s.Item1 <= maxCol &&
                s.Item2 >= 0 && s.Item2 <= 2
            );
            if (valid) {
                const cells = serverIdx.map(s => ({ col: s.Item1, row: this._toDisplayRow(s.Item2) }));
                if (DEBUG) console.log(`[HighlightDebug] Line#${linePay.payLineIndex} from server`);
                return cells;
            }
            // Indices out-of-range → log và dùng fallback payline
            if (DEBUG) console.warn(`[SymbolHighlighter] payLine#${linePay.payLineIndex} OUT OF RANGE`);
        }
        // Fallback: tính từ client payline config
        const paylines = GameData.instance.config.paylines;
        const payline  = paylines[linePay.payLineIndex];
        if (!payline) {
            if (DEBUG) console.warn(`[SymbolHighlighter] payLine#${linePay.payLineIndex} not found`);
            return [];
        }
        const cells = payline.map((row, col) => ({ col, row: this._toDisplayRow(row) }));
        if (DEBUG) console.log(`[HighlightDebug] Line#${linePay.payLineIndex} from payline def`);
        return cells;
    }

    private _toDisplayRow(row: number): number {
        return GameData.instance.toDisplayRow(row);
    }

    /** Set opacity ngay lập tức (dừng tween đang chạy nếu có) */
    private _setOpacity(node: Node, opacity: number): void {
        const uiOp = this._getUIOpacity(node);
        Tween.stopAllByTarget(uiOp);
        uiOp.opacity = opacity;
    }

    /** Tween opacity từ `from` → `to` trong `duration` giây */
    private _fadeOpacity(node: Node, from: number, to: number, duration: number): void {
        const uiOp = this._getUIOpacity(node);
        Tween.stopAllByTarget(uiOp);
        uiOp.opacity = from;
        tween(uiOp)
            .to(duration, { opacity: to }, { easing: 'sineOut' })
            .start();
    }

    /** Lấy hoặc tạo UIOpacity component cho node */
    private _getUIOpacity(node: Node): UIOpacity {
        return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
    }

    /** Reparent CreditLabel của symbolNode lên paylineManagerNode (nằm trên spine) */
    private _reparentCreditLabel(symbolNode: Node): void {
        if (!this.paylineManagerNode) return;
        // Tìm CreditLabel bằng component SpriteNumber (không hardcode tên node)
        const creditLabel = symbolNode.getComponentInChildren(SpriteNumber)?.node ?? null;
        if (!creditLabel) return;
        if (this._creditLabelRestoreData.has(creditLabel)) return; // đã reparent rồi
        this._creditLabelRestoreData.set(creditLabel, {
            origParent: creditLabel.parent,
            origSibling: creditLabel.getSiblingIndex(),
            origActive: creditLabel.active,
        });
        // Giữ world position khi reparent sang paylineManagerNode
        creditLabel.setParent(this.paylineManagerNode, true);
        creditLabel.active = true;
        // Đảm bảo tất cả children (các sprite số tiền) cũng active
        for (const child of creditLabel.children) {
            child.active = true;
        }
        // Bật lại Sprite components — bị tắt bởi setSpriteVisible(false) trước đó
        const sprites = creditLabel.getComponentsInChildren(Sprite);
        for (const spr of sprites) {
            spr.enabled = true;
        }
        // Append vào cuối → nằm trên cùng, phía trên spine effect
    }

    /** Restore tất cả CreditLabel đã reparent về parent, sibling gốc — reset nếu symbol không còn là sticky coin */
    private _restoreCreditLabels(): void {
        for (const [labelNode, restoreData] of this._creditLabelRestoreData) {
            if (!isValid(labelNode)) continue;
            const { origParent, origSibling } = restoreData;
            if (origParent && labelNode.parent !== origParent) {
                labelNode.setParent(origParent, true); // giữ world position
                labelNode.setSiblingIndex(origSibling);
            }
            // Tìm SymbolView trong parent chain để biết symbol hiện tại
            let symbolNode: Node | null = origParent;
            let symbolView: SymbolView | null = null;
            while (symbolNode) {
                symbolView = symbolNode.getComponent(SymbolView);
                if (symbolView) break;
                symbolNode = symbolNode.parent;
            }
            const isSticky = symbolView && (
                symbolView.symbolId === SymbolId.STICKY_RED ||
                symbolView.symbolId === SymbolId.STICKY_YELLOW ||
                symbolView.symbolId === SymbolId.STICKY_GREEN
            );
            if (!isSticky) {
                // Symbol thường → ẩn CreditLabel hoàn toàn, reset children & sprite
                labelNode.active = false;
                for (const child of labelNode.children) {
                    child.active = false;
                }
                for (const spr of labelNode.getComponentsInChildren(Sprite)) {
                    spr.enabled = false;
                }
            }
            // Nếu là sticky coin → giữ nguyên active state gốc, showCredit() sẽ bật nếu cần
        }
        this._creditLabelRestoreData.clear();
    }

    /** Destroy tất cả clone STICKY_YELLOW trên paylineManagerNode (freemode) */
    private _restoreReparentedSymbolNodes(): void {
        if (this._yellowClones.size > 0) {
            Log.e(`[FreeYellow] _restoreReparentedSymbolNodes: destroy ${this._yellowClones.size} clones`);
        }
        for (const [symNode, clone] of this._yellowClones) {
            if (isValid(clone)) {
                Tween.stopAllByTarget(clone);
                clone.destroy();
                Log.e(`[FreeYellow] DESTROY clone for ${symNode.name}`);
            }
        }
        this._yellowClones.clear();
        this._yellowCloneTweens.clear();
    }

    /** Lấy defaultScale từ SymbolView component của symbol node. Mặc định = 1 nếu không tìm thấy. */
    private _getDefaultScale(symbolNode: Node): number {
        const view = symbolNode.getComponent(SymbolView);
        return view?.defaultScale ?? 1;
    }

    /**
     * Tìm spine node (có sp.Skeleton) trong descendant của symbol node.
     * Trả về node đó hoặc null. Dùng để replay animation khi WildTrailController đã spawn spine.
     */
    private _findSpineNodeOnNode(node: Node): Node | null {
        if (node.getComponent(sp.Skeleton)) return node;
        for (const child of node.children) {
            const found = this._findSpineNodeOnNode(child);
            if (found) return found;
        }
        return null;
    }
}
