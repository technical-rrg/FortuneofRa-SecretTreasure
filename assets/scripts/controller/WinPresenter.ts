/**
 * WinPresenter - Trình diễn kết quả thắng.
 *
 * FLOW MỚI:
 *   1. Khi reel dừng (WIN_PRESENT_START):
 *      - Hiện TẤT CẢ winning lines cùng 1 lúc (WIN_SHOW_ALL_LINES)
 *      - Show BigWin popup nếu cần
 *   2. Sau 1 giây: emit WIN_PRESENT_END → GameManager bật nút Spin
 *   3. Đồng thời bắt đầu vòng lặp cycling: line1 → (1s) → line2 → ... → loop
 *   4. Khi REELS_START_SPIN: hủy cycling, reset hoàn toàn
 */

import { _decorator, Component, Label } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';
import { SpinResponse, SlotStageType, WinTier, WaysPayWin } from '../data/SlotTypes';
import { AutoSpinManager, SpeedMode } from '../manager/AutoSpinManager';
import { L } from '../core/LocalizationManager';
import { Log } from '../core/Logger';

const { ccclass, property } = _decorator;

@ccclass('WinPresenter')
export class WinPresenter extends Component {

    @property({ tooltip: 'Label hiển thị tiền thắng (không bắt buộc)' })
    winLabel: Label | null = null;

    @property({ tooltip: 'Delay trước khi bật Spin sau khi Normal spin kết thúc (giây)' })
    spinEnableDelayNormal: number = 1.0;

    @property({ tooltip: 'Delay trước khi bật Spin sau khi AutoSpin kết thúc (giây)' })
    spinEnableDelayAuto: number = 1.2;

    @property({ tooltip: 'Delay trước khi bật Spin sau khi Free Spin kết thúc (giây)' })
    spinEnableDelayFreeSpin: number = 0.3;

    @property({ tooltip: 'Thời gian hiển thị "show all" highlight trước khi chuyển sang cycling từng line (giây).' })
    showAllHighlightDuration: number = 1.5;

    @property({ tooltip: 'AutoSpin win delay — Normal mode (giây)' })
    autoSpinFixedWinDelayNormal: number = 1.5;

    @property({ tooltip: 'AutoSpin win delay — Quick mode (giây)' })
    autoSpinFixedWinDelayQuick: number = 1.0;

    @property({ tooltip: 'AutoSpin win delay — Turbo mode (giây)' })
    autoSpinFixedWinDelayTurbo: number = 0.8;

    @property({ tooltip: 'Thời gian mỗi line trong vòng lặp cycling (giây)' })
    lineCycleDuration: number = 2.0;

    /** Tăng mỗi round mới — callback từ round cũ bỏ qua nếu lỗi thời */
    private _generation: number = 0;
    private _isPresenting: boolean = false;
    /** Reference đến cycling callback đang chạy (dùng để unschedule chính xác) */
    private _cycleCallback: (() => void) | null = null;
    /** Đang trong chế độ free spin — bỏ qua các ghi winLabel khi đúng */
    private _isFreeSpinMode: boolean = false;
    /** Đang trong chế độ auto spin */
    private _isAutoSpinMode: boolean = false;
    /** PickGame đang active: không replay jackpot/line cycle của normal spin cũ. */
    private _isPickGameMode: boolean = false;
    /** Tất cả spine highlight đã hoàn tất animation (do SymbolHighlighter báo) */
    private _highlightAnimDone: boolean = false;
    /** Gen đang chờ WIN_HIGHLIGHT_ANIM_DONE để emit WIN_PRESENT_END; -1 = không chờ */
    private _pendingPresentEndGen: number = -1;
    /** Danh sách line thắng của vòng quay gần nhất (dùng để cycle sau jackpot popup) */
    private _lastMatchedLines: SpinResponse['matchedLinePays'] = [];
    /** Danh sách WaysPayWin của vòng quay gần nhất (Ways Pay) */
    private _lastWaysPayWins: WaysPayWin[] = [];
    /** Wild trail đang diễn animation → delay highlight */
    private _isWildTrailAnimating: boolean = false;
    /** Response đang chờ wild trail xong để emit highlight */
    private _pendingWinResponse: SpinResponse | null = null;
    private _pendingWinGen: number = -1;
    /** Gen đã nhận WILD_TRAIL_FLY_DONE (để biết wild trail của vòng hiện tại đã xong) */
    private _wildTrailFlyDoneGen: number = -1;

    // ─── LIFECYCLE ───

    onLoad(): void {
        EventBus.instance.on(GameEvents.WIN_PRESENT_START, this._onWinStart, this);
        EventBus.instance.on(GameEvents.REELS_START_SPIN,  this._onReelsStartSpin, this);
        EventBus.instance.on(GameEvents.WIN_HIGHLIGHT_ANIM_DONE, this._onHighlightAnimDone, this);
        EventBus.instance.on(GameEvents.WIN_HIGHLIGHT_CLEAR, this._onWinHighlightClear, this);
        EventBus.instance.on(GameEvents.JACKPOT_END, this._onJackpotEndForCycle, this);
        EventBus.instance.on(GameEvents.AUTO_SPIN_CHANGED, this._onAutoSpinChanged, this);
        EventBus.instance.on(GameEvents.WILD_TRAIL_START, this._onWildTrailStart, this);
        EventBus.instance.on(GameEvents.WILD_TRAIL_FLY_DONE, this._onWildTrailFlyDone, this);
        EventBus.instance.on(GameEvents.CREDIT_FLY_IN_START, this._onCreditFlyInStart, this);
        EventBus.instance.on(GameEvents.PICK_GAME_OPEN, this._onPickGameOpen, this);
        EventBus.instance.on(GameEvents.PICK_GAME_CLOSE, this._onPickGameClose, this);
        EventBus.instance.on(GameEvents.FREE_SPIN_COUNT_UPDATED, (remaining: number) => {
            this._isFreeSpinMode = remaining > 0;
        }, this);
        EventBus.instance.on(GameEvents.FREE_SPIN_END, () => {
            this._isFreeSpinMode = false;
            // ★ CRITICAL: invalidate mọi scheduled callback còn sót từ lần quay free spin cuối
            // — tránh highlight/spine effect hiện lại sau khi về normal mode.
            this._generation++;
            this._stopCycling();
            this.unscheduleAllCallbacks();
            this._isPresenting = false;
            this._highlightAnimDone = false;
            this._pendingPresentEndGen = -1;
            this._wildTrailFlyDoneGen = -1;
            this._isWildTrailAnimating = false;
            this._pendingWinResponse = null;
            this._pendingWinGen = -1;
            this._lastMatchedLines = [];
            this._lastWaysPayWins = [];
        }, this);
        EventBus.instance.on(GameEvents.TOPUP_END, () => {
            // Tương tự FREE_SPIN_END — invalidate callback còn sót từ TopUp mode
            this._generation++;
            this._stopCycling();
            this.unscheduleAllCallbacks();
            this._isPresenting = false;
            this._highlightAnimDone = false;
            this._pendingPresentEndGen = -1;
            this._wildTrailFlyDoneGen = -1;
            this._isWildTrailAnimating = false;
            this._pendingWinResponse = null;
            this._pendingWinGen = -1;
            this._lastMatchedLines = [];
            this._lastWaysPayWins = [];
        }, this);
    }

    onDestroy(): void {
        this.unscheduleAllCallbacks();
        EventBus.instance.offTarget(this);
    }

    // ─── RESET KHI SPIN MỚI BẮT ĐẦU ───

    private _onReelsStartSpin(): void {
        this._generation++;
        this._stopCycling();
        this.unscheduleAllCallbacks();
        this._isPresenting = false;
        this._highlightAnimDone = false;
        this._pendingPresentEndGen = -1;
        this._wildTrailFlyDoneGen = -1;
        this._isWildTrailAnimating = false;
        this._pendingWinResponse = null;
        this._pendingWinGen = -1;
        // Reset để vòng quay mới không dùng lines của vòng quay trước (đặc biệt quan trọng
        // khi jackpot path không emit WIN_PRESENT_START → _lastMatchedLines không được cập nhật).
        this._lastMatchedLines = [];
        // Trong free spin: UIController quản lý winLabel — không ghi đè ở đây
        if (!this._isFreeSpinMode && this.winLabel) {
            this.winLabel.string = L('good_luck');
        }
    }

    // ─── XỬ LÝ KẾT QUẢ ─────────────────────────────────────────────

    private _onWinStart(response: SpinResponse): void {
        this._generation++;
        const myGen = this._generation;
        this._stopCycling();
        this.unscheduleAllCallbacks();
        this._isPresenting = false;
        this._highlightAnimDone = false;
        this._pendingPresentEndGen = -1;
        // Log.d(`[WinPresenter] WIN_PRESENT_START`);
        // Lưu lại lines để dùng sau jackpot popup
        this._lastMatchedLines  = response.matchedLinePays;
        this._lastWaysPayWins   = response.waysPayWins ?? [];
        // Không có tiền thắng → kết thúc ngay để GameManager mở Spin
        if (response.totalWin <= 0) {
            if (!this._isFreeSpinMode && this.winLabel) this.winLabel.string = L('no_win');
            this._finishPresentation(myGen);
            return;
        }

        // Nếu response có wild trail (normal spin) và chưa nhận FLY_DONE cho gen này → chờ
        const hasWildTrail = !this._isFreeSpinMode && response.wildTrailCount && response.wildTrailCount > 0;
        Log.d(`[WinPresenter] _onWinStart check: _isFreeSpinMode=${this._isFreeSpinMode}, wildTrailCount=${response.wildTrailCount}, _isWildTrailAnimating=${this._isWildTrailAnimating}, hasWildTrail=${hasWildTrail}, _wildTrailFlyDoneGen=${this._wildTrailFlyDoneGen}, myGen=${myGen}`);
        if ((this._isWildTrailAnimating || hasWildTrail) && this._wildTrailFlyDoneGen !== myGen) {
            this._pendingWinResponse = response;
            this._pendingWinGen = myGen;
            Log.d(`[WinPresenter] Wild trail đang diễn — delay highlight cho đến khi xong`);
            return;
        }

        this._emitHighlights(response, myGen);
    }

    /**
     * Emit highlight events, win popup, và setup cycling timers.
     * Dùng từ _onWinStart hoặc _onWildTrailFlyDone khi wild trail xong.
     */
    private _emitHighlights(response: SpinResponse, myGen: number): void {
        this._isPresenting = true;

        // Cập nhật win label ngay khi có kết quả (chỉ ngoài free spin)
        if (!this._isFreeSpinMode && this.winLabel) {
            this.winLabel.string = L('win_amount', { amount: response.totalWin.toFixed(3) });
        }

        // 1) Hiện TẤT CẢ winning cells cùng 1 lúc
        const ways = response.waysPayWins ?? [];
        const hasWin = (response.matchedLinePays.length > 0) || (ways.length > 0);
        const isAutoSpinWithWin = this._isAutoSpinMode && hasWin;
        let showAllDuration = this.showAllHighlightDuration;
        if (isAutoSpinWithWin) {
            const mode = AutoSpinManager.instance.speedMode;
            showAllDuration = this.autoSpinFixedWinDelayNormal;
            if (mode === SpeedMode.QUICK) showAllDuration = this.autoSpinFixedWinDelayQuick;
            else if (mode === SpeedMode.TURBO) showAllDuration = this.autoSpinFixedWinDelayTurbo;
        }
        if (ways.length > 0) {
            // ★ Gold of Fortune: Ways Pay — emit WIN_SHOW_ALL_WAYS
            EventBus.instance.emit(GameEvents.WIN_SHOW_ALL_WAYS, ways, showAllDuration);
        } else if (response.matchedLinePays.length > 0) {
            // Legacy payline game fallback
            EventBus.instance.emit(GameEvents.WIN_SHOW_ALL_LINES, response.matchedLinePays, showAllDuration);
        }

        // 2) Show Big/Mega/Super Win popup nếu cần
        const winTier = GameData.instance.getWinTier(response.totalWin);
        if (winTier >= WinTier.BIG_WIN) {
            EventBus.instance.emit(GameEvents.WIN_POPUP, winTier, response.totalWin);
        }

        // 3) Free Spin multiplier thông báo
        if (response.featureMultiple && response.featureMultiple > 1) {
            EventBus.instance.emit(GameEvents.FREE_SPIN_MULTIPLIER, response.featureMultiple);
        }

        const willAutoSpin = response.nextStage === SlotStageType.FREE_SPIN
            || response.nextStage === SlotStageType.FREE_SPIN_START
            || response.nextStage === SlotStageType.FREE_SPIN_RE_TRIGGER;

        // Trong AutoSpin mode khi có win: dùng thời gian cố định (autoSpinFixedWinDelay)
        // tính từ lúc bắt đầu highlight all, không phân biệt Normal/Quick/Turbo.
        if (isAutoSpinWithWin) {
            // AutoSpin + có win: delay cố định tùy theo speed mode
            this.scheduleOnce(() => {
                if (this._generation !== myGen) return;
                this._isPresenting = false;
                EventBus.instance.emit(GameEvents.WIN_COUNTUP_DONE, response.totalWin);
                EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
            }, showAllDuration);
        } else {
            // Các trường hợp khác: dùng logic cũ (spinEnableDelay / showAllHighlightDuration)
            const presentEndDelay = Math.max(this._getSpinEnableDelay(), this.showAllHighlightDuration);
            this.scheduleOnce(() => {
                if (this._generation !== myGen) return;

                this._isPresenting = false;
                EventBus.instance.emit(GameEvents.WIN_COUNTUP_DONE, response.totalWin);
                EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
            }, presentEndDelay);
        }

        // 5) Sau showAllHighlightDuration: bắt đầu cycling từng way/line
        // Không cycling khi auto-spin: next spin bắt đầu ngay sau WIN_PRESENT_END,
        // cycling chạy đồng thời sẽ emit line lẻ ngay lập tức trước khi bị _stopCycling.
        const shouldCycle = !willAutoSpin && !this._isAutoSpinMode;
        const waysForCycle = response.waysPayWins ?? [];
        Log.e(
            `[WinPresenter][CYCLE-DEBUG] _emitHighlights: shouldCycle=${shouldCycle} ` +
            `willAutoSpin=${willAutoSpin} _isAutoSpinMode=${this._isAutoSpinMode} ` +
            `waysForCycle.length=${waysForCycle.length} matchedLinePays.length=${response.matchedLinePays?.length ?? 0} ` +
            `myGen=${myGen} showAllDuration=${showAllDuration}`
        );
        if (shouldCycle && waysForCycle.length > 1) {
            Log.e(`[WinPresenter][CYCLE-DEBUG] Scheduling _startWaysCycle in ${showAllDuration}s`);
            this.scheduleOnce(() => {
                if (this._generation !== myGen) {
                    Log.e(`[WinPresenter][CYCLE-DEBUG] Ways cycle callback skipped: gen changed ${myGen}→${this._generation}`);
                    return;
                }
                this._startWaysCycle(waysForCycle, myGen);
            }, showAllDuration);
        } else if (shouldCycle && response.matchedLinePays.length > 1) {
            Log.e(`[WinPresenter][CYCLE-DEBUG] Scheduling _startLineCycle in ${showAllDuration}s`);
            this.scheduleOnce(() => {
                if (this._generation !== myGen) {
                    Log.e(`[WinPresenter][CYCLE-DEBUG] Line cycle callback skipped: gen changed ${myGen}→${this._generation}`);
                    return;
                }
                this._startLineCycle(response.matchedLinePays, myGen);
            }, showAllDuration);
        } else {
            Log.e(`[WinPresenter][CYCLE-DEBUG] NO cycling scheduled`);
        }
    }

    // ─── CYCLING LOOP (lặp lại vô hạn đến khi spin mới) ─────────────

    /**
     * Cycling từng combination của WaysPayWin — emit WIN_CYCLE_ONE_WAY mỗi `lineCycleDuration` giây.
     * Mỗi combination là 1 path cụ thể (1 row per reel), giống payline cycling.
     * Dùng cho Gold of Fortune (Ways Pay 243).
     * Chỉ cycle khi có ≥ 2 combo — 1 combo giữ nguyên highlight show-all.
     */
    private _startWaysCycle(ways: WaysPayWin[], gen: number): void {
        this._stopCycling();

        // Flatten tất cả combinations của mọi WaysPayWin → list các WaysPayWin giả (cells = combo)
        const allCombos: WaysPayWin[] = [];
        for (const way of ways) {
            const combos = way.combinations && way.combinations.length > 0
                ? way.combinations
                : [way.cells]; // fallback nếu combinations chưa được tính
            for (const combo of combos) {
                allCombos.push({ ...way, cells: combo });
            }
        }
        Log.e(`[WinPresenter][CYCLE-DEBUG] _startWaysCycle: ways=${ways.length} allCombos=${allCombos.length} gen=${gen}`);
        if (allCombos.length < 2) {
            Log.e(`[WinPresenter][CYCLE-DEBUG] _startWaysCycle: skip cycle (need ≥2 combos)`);
            return;
        }

        let idx = 0;

        // Emit combination đầu tiên ngay lập tức
        Log.e(`[WinPresenter][CYCLE-DEBUG] _startWaysCycle: emit WIN_CYCLE_ONE_WAY idx=${idx} comboCells=${allCombos[idx].cells.map(c=>`(${c.reel},${c.row})`).join(',')}`);
        EventBus.instance.emit(GameEvents.WIN_CYCLE_ONE_WAY, allCombos[idx]);
        idx = (idx + 1) % allCombos.length;

        this._cycleCallback = () => {
            if (this._generation !== gen) {
                Log.e(`[WinPresenter][CYCLE-DEBUG] Ways cycle tick skipped: gen changed ${gen}→${this._generation}`);
                this._stopCycling();
                return;
            }
            Log.e(`[WinPresenter][CYCLE-DEBUG] Ways cycle tick: emit WIN_CYCLE_ONE_WAY idx=${idx} comboCells=${allCombos[idx].cells.map(c=>`(${c.reel},${c.row})`).join(',')}`);
            EventBus.instance.emit(GameEvents.WIN_CYCLE_ONE_WAY, allCombos[idx]);
            idx = (idx + 1) % allCombos.length;
        };
        this.schedule(this._cycleCallback, this.lineCycleDuration);
    }

    private _startLineCycle(lines: SpinResponse['matchedLinePays'], gen: number): void {
        this._stopCycling();
        if (lines.length < 2) return;
        console.log(
            `%c[HighlightDebug][WinPresenter] _startLineCycle lines=${lines.length} gen=${gen}`,
            'color:#fa0;font-weight:bold'
        );

        let lineIdx = 0;

        // Emit line đầu tiên ngay lập tức
        EventBus.instance.emit(GameEvents.UI_UPDATE_WIN_LABEL, lines[lineIdx]);
        lineIdx = (lineIdx + 1) % lines.length;

        // Dùng schedule (repeating interval) thay vì đệ qui scheduleOnce
        // để tránh vấn đề dedup của scheduler Cocos Creator
        this._cycleCallback = () => {
            if (this._generation !== gen) {
                this._stopCycling();
                return;
            }
            const line = lines[lineIdx];
            console.log(
                `%c[HighlightDebug][WinPresenter] _cycleCallback line#${line.payLineIndex} idx=${lineIdx}`,
                'color:#fa0'
            );
            EventBus.instance.emit(GameEvents.UI_UPDATE_WIN_LABEL, line);
            lineIdx = (lineIdx + 1) % lines.length;
        };
        this.schedule(this._cycleCallback, this.lineCycleDuration);
    }

    private _stopCycling(): void {
        if (this._cycleCallback) {
            this.unschedule(this._cycleCallback);
            this._cycleCallback = null;
        }
    }

    /**
     * Sau jackpot popup đóng (Normal spin): WIN_PRESENT_START không được emit trong jackpot path,
     * nên cycling chưa bao giờ chạy. Khởi động lại cycling tại đây nếu có line thắng.
     * Jackpot được coi như 1 line thường — thêm vào đầu danh sách để cycle đầu tiên.
     * Flow giống normal win: show all lines → sau showAllHighlightDuration → cycle từng line.
     * Bỏ qua trong free spin (free spin tự auto-spin tiếp).
     */
    private _onJackpotEndForCycle(): void {
        if (this._isPickGameJackpotFlow()) return;
        if (this._isFreeSpinMode) return;

        const resp = GameData.instance.lastSpinResponse;
        // Luôn lấy từ resp của vòng quay HIỆN TẠI — KHÔNG dùng _lastMatchedLines vì jackpot
        // path không emit WIN_PRESENT_START, nên _lastMatchedLines có thể chứa data của spin trước.
        let allLines = [...(resp?.matchedLinePays ?? [])];

        // Nếu jackpot payline chưa có trong matchedLinePays (jackpot-only, server không gửi
        // line entry riêng), thêm synthetic entry để cycle hiển thị đúng.
        const jackpotPaylineIdx = GameData.instance.jackpotPaylineIndex;
        if (jackpotPaylineIdx >= 0 && !allLines.some(l => l.payLineIndex === jackpotPaylineIdx)) {
            allLines.unshift({
                payLineIndex: jackpotPaylineIdx,
                payout: 0,
                matchedSymbols: [],
                containsWild: false,
                reelCnt: 3,
                matchedSymbolsIndices: null,
            } as any);
        }

        if (allLines.length < 1) return;

        this._generation++;
        const myGen = this._generation;
        this._stopCycling();
        this.unscheduleAllCallbacks();

        // 1. Hiện TẤT CẢ winning lines cùng 1 lúc (giống normal win flow)
        EventBus.instance.emit(GameEvents.WIN_SHOW_ALL_LINES, allLines, this.showAllHighlightDuration);

        // 2. Sau showAllHighlightDuration: bắt đầu cycling từng line lẻ
        this.scheduleOnce(() => {
            if (this._generation !== myGen) return;
            this._startLineCycle(allLines, myGen);
        }, this.showAllHighlightDuration);
    }

    // ─── FINISH ───

    /** Callback khi SymbolHighlighter báo tất cả spine animation đã hoàn tất */
    private _onHighlightAnimDone(): void {
        this._highlightAnimDone = true;
        if (this._pendingPresentEndGen >= 0 && this._pendingPresentEndGen === this._generation) {
            this._pendingPresentEndGen = -1;
            this._isPresenting = false;
            const resp = GameData.instance.lastSpinResponse;
            if (resp) EventBus.instance.emit(GameEvents.WIN_COUNTUP_DONE, resp.totalWin);
            EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
        }
    }

    private _finishPresentation(gen: number): void {
        if (this._generation !== gen) return;
        this._stopCycling();
        this.unscheduleAllCallbacks();
        this._isPresenting = false;
        // Log.d(`[WinPresenter] WIN_PRESENT_END`);
        EventBus.instance.emit(GameEvents.WIN_PRESENT_END);
    }

    // ─── HELPERS ───

    /** Cập nhật trạng thái auto spin từ AutoSpinManager */
    private _onAutoSpinChanged(count: number): void {
        // FIX: dùng isAutoSpinActive thay vì count > 0 — count > 0 không có nghĩa auto đang chạy
        // (có thể còn dư từ localStorage hoặc user chưa confirm trong setting popup)
        this._isAutoSpinMode = count > 0 && AutoSpinManager.instance.isAutoSpinActive;
    }

    /** Lấy delay phù hợp dựa vào mode hiện tại (Normal / Auto / Free) */
    private _getSpinEnableDelay(): number {
        if (this._isFreeSpinMode) {
            return this.spinEnableDelayFreeSpin;
        } else if (this._isAutoSpinMode) {
            return this.spinEnableDelayAuto;
        } else {
            return this.spinEnableDelayNormal;
        }
    }

    private _onWildTrailStart(): void {
        this._isWildTrailAnimating = true;
        Log.d(`[WinPresenter] Wild trail bắt đầu — block highlight`);
    }

    private _onCreditFlyInStart(): void {
        this._stopCycling();
    }

    /** Feature select: tắt cycling trước khi red bounce / credit fly. */
    private _onWinHighlightClear(): void {
        this._generation++;
        this._stopCycling();
        this.unscheduleAllCallbacks();
        this._isPresenting = false;
        this._highlightAnimDone = false;
        this._pendingPresentEndGen = -1;
    }

    private _onPickGameOpen(): void {
        this._isPickGameMode = true;
        this._pausePresentationRuntime();
    }

    private _onPickGameClose(): void {
        this._isPickGameMode = false;
        this._pausePresentationRuntime();

        const myGen = this._generation;
        this.scheduleOnce(() => {
            if (this._generation !== myGen) return;
            this._resumePickGameWinHighlight(myGen);
        }, 0);
    }

    private _pausePresentationRuntime(): void {
        this._generation++;
        this._stopCycling();
        this.unscheduleAllCallbacks();
        this._isPresenting = false;
        this._highlightAnimDone = false;
        this._pendingPresentEndGen = -1;
        this._wildTrailFlyDoneGen = -1;
        this._isWildTrailAnimating = false;
        this._pendingWinResponse = null;
        this._pendingWinGen = -1;
    }

    private _resumePickGameWinHighlight(gen: number): void {
        const resp = GameData.instance.lastSpinResponse;
        if (!resp || resp.totalWin <= 0) return;

        const ways = resp.waysPayWins ?? [];
        const lines = resp.matchedLinePays ?? [];
        if (ways.length === 0 && lines.length === 0) return;

        if (ways.length > 0) {
            EventBus.instance.emit(GameEvents.WIN_SHOW_ALL_WAYS, ways, this.showAllHighlightDuration);
            this.scheduleOnce(() => {
                if (this._generation !== gen || this._isAutoSpinMode) return;
                if (ways.length > 1) this._startWaysCycle(ways, gen);
            }, this.showAllHighlightDuration);
        } else {
            EventBus.instance.emit(GameEvents.WIN_SHOW_ALL_LINES, lines, this.showAllHighlightDuration);
            this.scheduleOnce(() => {
                if (this._generation !== gen || this._isAutoSpinMode) return;
                if (lines.length > 1) this._startLineCycle(lines, gen);
            }, this.showAllHighlightDuration);
        }
    }

    private _isPickGameJackpotFlow(): boolean {
        const resp = GameData.instance.lastSpinResponse as (SpinResponse & { triggerPotWin?: boolean }) | null;
        const nextStage = resp?.nextStage as SlotStageType | undefined;
        return this._isPickGameMode
            || !!resp?.triggerPotWin
            || !!resp?.pickGame
            || nextStage === SlotStageType.PICK_START
            || nextStage === SlotStageType.PICK
            || nextStage === SlotStageType.PICK_END
            || nextStage === SlotStageType.POT_WIN
            || nextStage === SlotStageType.PICK_GAME
            || nextStage === SlotStageType.PICK_GAME_END;
    }

    private _onWildTrailFlyDone(): void {
        this._isWildTrailAnimating = false;
        this._wildTrailFlyDoneGen = this._generation;
        Log.d(`[WinPresenter] Wild trail xong — kiểm tra pending highlight`);

        // Nếu có win response đang chờ → emit highlight ngay
        if (this._pendingWinResponse && this._pendingWinGen === this._generation) {
            const response = this._pendingWinResponse;
            const myGen = this._pendingWinGen;
            this._pendingWinResponse = null;
            this._pendingWinGen = -1;

            this._emitHighlights(response, myGen);
        }
    }
}
