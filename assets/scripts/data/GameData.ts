/**
 * GameData - Singleton chứa toàn bộ data runtime của game.
 * ★ Gold of Fortune (3×5 Ways Pay).
 */

import { Log } from '../core/Logger';
import {
    PlayerData,
    SlotConfig,
    SpinResponse,
    SymbolId,
    ServerSession,
    StickyCell,
} from './SlotTypes';

// ═══════════════════════════════════════════════════════════
//  DEFAULT REEL STRIPS — 5 reels × 30 ô
// ═══════════════════════════════════════════════════════════
//
// Quy ước:
//   - Wild Trail chỉ xuất hiện trên reel 1, 2, 3 (theo design Jin Ji Bao Xi).
//   - Sticky Red xuất hiện đều ở mọi reel (mật độ thấp).
//   - Sticky Yellow/Green KHÔNG xuất hiện trên Normal strip (chỉ Free Spin / Re-Spin strips).
//   - +1 Spin chỉ xuất hiện trên Re-Spin strip.
//
// Tỉ lệ symbol (Normal Spin):
//   Minor (Q/K/A) chiếm ~40%, Major chiếm ~45%, Wild ~5% (reel 1/2/3 only),
//   Sticky Red ~7%, còn lại blank/no-special.
//
const Q = SymbolId.MINOR_Q;
const K = SymbolId.MINOR_K;
const A = SymbolId.MINOR_A;
const C = SymbolId.MAJOR_COIN;
const I = SymbolId.MAJOR_INGOT;
const S = SymbolId.MAJOR_SHIP;
const T = SymbolId.MAJOR_TURTLE;
const P = SymbolId.MAJOR_PHOENIX;
const W = SymbolId.WILD;
const R = SymbolId.STICKY_RED;
const Y = SymbolId.STICKY_YELLOW;
const G = SymbolId.STICKY_GREEN;
const X = SymbolId.PLUS_ONE_SPIN;

/** Normal Spin: 5 reels × 30 ô. Reel 0 và 4 không có Wild. Red xuất hiện rải rác (2–3 per reel). */
const DEFAULT_REEL_STRIPS: number[][] = [
    // Reel 0 (no Wild, Red pair ở index 4-5, thêm 11, 23)
    [Q, K, A, C, R, R, Q, T, S, K, A, R, C, P, Q, I, T, K, A, S, Q, C, P, R, K, I, A, T, S, Q],
    // Reel 1 (Wild Trail: 1 Wild ở index 5, Red pair ở index 7-8, thêm 14, 27)
    [A, P, I, C, K, W, T, R, R, C, A, K, P, C, R, Q, T, S, K, A, P, C, K, I, K, Q, T, R, S, A],
    // Reel 2 (Wild Trail: 1 Wild ở index 8, Red pair ở index 3-4, thêm 14, 20)
    [P, T, C, R, R, S, I, K, W, P, C, K, K, A, R, S, I, P, K, C, R, K, A, T, C, S, P, I, K, Q],
    // Reel 3 (Wild Trail: 1 Wild ở index 9, Red pair ở index 3-4, thêm 15, 25)
    [T, A, P, R, R, K, I, K, C, W, P, K, C, A, T, R, S, P, K, C, A, K, Q, T, C, R, P, S, K, A],
    // Reel 4 (no Wild, Red pair ở index 6-7, thêm 3, 19)
    [K, P, A, R, C, I, R, R, P, K, A, Q, T, S, I, P, K, K, A, R, T, S, C, P, I, K, A, T, S, P],
];

/**
 * Free Spin strips: thay Wild → Yellow Sticky trên reel 1/2/3.
 * Khi spin, server (mock) sẽ random nhét Yellow vào để accumulator hoạt động.
 */
const DEFAULT_FREE_SPIN_REEL_STRIPS: number[][] = [
    // Reel 0 (giống Normal)
    [Q, K, A, C, I, P, Q, T, S, K, A, R, C, P, Q, I, T, K, A, S, Q, C, P, R, K, I, A, T, S, Q],
    // Reel 1 (Wild → Yellow)
    [A, P, I, Y, K, Q, T, R, S, C, A, K, P, Y, I, Q, T, S, K, A, P, C, R, I, K, Q, T, Y, S, A],
    // Reel 2 (Wild → Yellow)
    [P, T, Y, A, K, S, I, R, Q, P, C, Y, K, A, T, S, I, P, K, Y, Q, R, A, T, C, S, P, I, K, Q],
    // Reel 3 (Wild → Yellow)
    [T, A, P, Y, S, K, I, R, C, Q, P, K, Y, A, T, I, S, P, K, Y, A, R, Q, T, C, I, P, S, K, A],
    // Reel 4
    [K, P, A, T, C, I, S, R, P, K, A, Q, T, S, I, P, R, K, A, Q, T, S, C, P, I, K, A, T, S, P],
];

/**
 * Re-Spin strips: chỉ Sticky symbols + +1 Spin.
 * Chỉ áp dụng cho ô trống (ô có Red đã sticky thì giữ nguyên).
 */
const DEFAULT_RESPIN_REEL_STRIPS: number[][] = [
    [R, R, R, R, R, R, R, Y, Y, G, X, R, R, R, R, R, R, Y, R, R, R, G, R, R, R, R, R, Y, R, R],
    [R, R, Y, R, R, G, R, R, X, R, R, Y, R, R, R, R, G, R, R, Y, R, R, R, R, R, R, R, R, X, R],
    [R, Y, R, R, R, R, G, R, R, R, R, R, R, R, Y, R, R, X, R, R, G, R, R, Y, R, R, R, R, R, R],
    [R, R, R, X, R, Y, R, R, R, G, R, R, R, R, R, R, R, Y, R, R, R, R, G, R, R, R, X, R, Y, R],
    [R, R, R, R, R, R, R, Y, R, R, R, R, R, R, G, R, R, R, R, R, X, Y, R, R, R, R, G, R, R, R],
];

// ═══════════════════════════════════════════════════════════
//  WAYS PAYTABLE — multiplier × totalBet × ways
// ═══════════════════════════════════════════════════════════
//
// Format: SymbolId → [3-of-kind, 4-of-kind, 5-of-kind] multiplier
// Multiplier áp dụng cho mỗi "way":
//   payout = multiplier × totalBet × ways
//
const DEFAULT_WAYS_PAYTABLE: Record<number, [number, number, number]> = {
    // Minors
    [SymbolId.MINOR_Q]:       [0.2, 0.5, 1.5],
    [SymbolId.MINOR_K]:       [0.3, 0.7, 2.0],
    [SymbolId.MINOR_A]:       [0.4, 1.0, 2.5],
    // Majors
    [SymbolId.MAJOR_COIN]:    [0.8, 2.0, 5.0],
    [SymbolId.MAJOR_INGOT]:   [1.0, 2.5, 6.0],
    [SymbolId.MAJOR_SHIP]:    [1.5, 4.0, 10.0],
    [SymbolId.MAJOR_TURTLE]:  [2.0, 5.0, 15.0],
    [SymbolId.MAJOR_PHOENIX]: [3.0, 8.0, 25.0],
};

const DEFAULT_JACKPOT_MULTIPLIERS = {
    GRAND: 1000,   // × totalBet
    MAJOR: 200,
    MINOR: 50,
    MINI:  10,
};

const DEFAULT_SLOT_CONFIG: SlotConfig = {
    reelStrips: DEFAULT_REEL_STRIPS,
    freeSpinReelStrips: DEFAULT_FREE_SPIN_REEL_STRIPS,
    respinReelStrips: DEFAULT_RESPIN_REEL_STRIPS,
    purchaseReelStrips: DEFAULT_REEL_STRIPS, // legacy alias
    betOptions: [1, 2, 3, 5, 10, 20, 50, 100],
    coinValues: [0.01, 0.02, 0.05, 0.10, 0.20, 0.50, 1.00],
    reelCount: 5,
    rowCount: 3,
    totalWays: 243,
    bigWinThreshold:     25,
    megaWinThreshold:    50,
    majorWinThreshold:   100,
    superWinThreshold:   200,
    epicWinThreshold:    400,
    ultraWinThreshold:   800,
    monsterWinThreshold: 1500,
    maxWinThreshold:     3000,
    waysPayTable: DEFAULT_WAYS_PAYTABLE,
    jackpotMultipliers: DEFAULT_JACKPOT_MULTIPLIERS,

    potLevelThresholds: [1, 11, 31, 51, 81, 101],   // ★ 6 ngưỡng cho level 1→6 (level 0 = trống)
    paylines: [], // deprecated
};

// ─── GAME DATA SINGLETON ───

export class GameData {
    private static _instance: GameData;

    player: PlayerData = {
        balance: 10000,
        betIndex: 0,
        coinValue: 0.01,
    };

    config: SlotConfig = { ...DEFAULT_SLOT_CONFIG };

    /** Response hiện tại từ server/mock */
    lastSpinResponse: SpinResponse | null = null;

    /**
     * Raw LastSpinResponse từ Enter API (chưa convert sang SpinResponse).
     * Dùng để detect Free Spin resume khi mở lại game.
     * Field names có thể là camelCase (stageType) hoặc PascalCase (NextStage) tuỳ server version.
     */
    rawEnterLastSpinResponse: any = null;

    /** Free spin state */
    freeSpinRemaining: number = 0;
    freeSpinTotalWin: number = 0;
    /**
     * Flag: freeSpinTotalWin được restore từ FeatureSpinTotalWin của server khi resume.
     */
    freeSpinTotalWinRestoredFromServer: boolean = false;

    // ═══════════════════════════════════════════════════════════
    //  ★ NEW — Gold of Fortune runtime state
    // ═══════════════════════════════════════════════════════════

    /** Re-Spin (Top Up) state */
    respinRemaining: number = 0;
    respinTotalWin: number = 0;
    /** Last value rendered in TopUp EachWin/NextWin UI, used for end-result diagnostics. */
    topUpDisplayedEachWin: number = 0;
    /** Base credit Σ Red khi bắt đầu Re-Spin / Free Spin (cho EACH WINS display). */
    featureBaseCredit: number = 0;

    /**
     * Sticky cells hiện đang khoá trên grid (Re-Spin / Free Spin).
     * Key = `${reel}-${row}` để lookup O(1) khi reel resolve.
     */
    stickyCells: Map<string, StickyCell> = new Map();

    /** Pot Level (0..6) — trực tiếp từ server qua PotVisualLevel (1..6). Level 0 = chưa có Pot. */
    potLevel: number = 0;
    /** Counter Wild Trail tích lũy từ đầu phiên chơi. */
    wildTrailCount: number = 0;

    /** Pick Game state hiện tại (active khi `gameStage = PICK_GAME`). */
    pickGameState: import('./SlotTypes').PickGameState | null = null;

    /** Pick Game win amount (jackpot prize) — dùng cho ProgressiveWin check sau khi Pick Game đóng */
    pickGameWinAmount: number = 0;

    /** Feature mode đang active để Mock API biết generate strip nào. */
    currentMode: 'normal' | 'respin' | 'freespin' | 'freespin_gold' = 'normal';

    // ─── FreeSpin Gold state ───────────────────────────────────────────────────
    /** Số lượt quay FreeSpin Gold còn lại. */
    freeSpinGoldRemaining: number = 0;
    /** Tổng credit tích lũy từ đồng xu vàng trong FreeSpin Gold. */
    freeSpinGoldTotalWin: number = 0;

    // ═══════════════════════════════════════════════════════════
    //  SERVER SESSION DATA (chỉ populated khi USE_REAL_API = true)
    // ═══════════════════════════════════════════════════════════
    /** Session nhận được sau Login */
    serverSession: ServerSession | null = null;
    /**
     * Chênh lệch đồng hồ giữa server và client (ms).
     * = serverTime - localTime tại thời điểm Login.
     * Dùng để tính timeLeft chính xác: Date.now() + clockOffsetMs.
     */
    clockOffsetMs: number = 0;
    /** Sequence number hiện tại — tăng dần sau mỗi SeqRequest thành công */
    currentSeq: number = 0;
    /** Đã login thành công chưa */
    isLoggedIn: boolean = false;
    /** Đã Enter game thành công chưa */
    isEntered: boolean = false;
    /** Last win message ID (cho Jackpot polling) — string để tránh mất precision số lớn */
    lastWinMsgId: string = '0';
    /**
     * WinGrade trả về từ ClaimResponse (sau khi kết thúc Free Spin).
     * Dùng bởi _onFreeSpinEndPopupClosed() khi USE_REAL_API = true.
     * Reset về undefined sau khi đã dùng.
     */
    lastClaimWinGrade: string | undefined = undefined;
    /** Jackpot values hiện tại [mini, minor, major, grand] */
    jackpotValues: number[] = [0, 0, 0, 0];
    /** Raw PS reel strips (PS IDs gốc từ server — để verify mapping trong spin log) */
    rawPsStrips: number[][] = [];
    /** Raw FreeSpin PS reel strips (PS IDs gốc từ FreeSpinReel.Strips) */
    rawPsFreeSpinStrips: number[][] = [];
    /** Raw Purchase PS reel strips (PS IDs gốc từ PurchaseReel.Strips) */
    rawPsPurchaseReelStrips: number[][] = [];
    /** Active feature item đang bật: dùng PurchaseReel cho normal spin đến khi cancel. */
    isPurchaseReelActive: boolean = false;
    /** Dynamic PS ID → Client SymbolId mapping, được build từ PS JSON symbol ID fields khi Enter */
    psToClientMap: Record<number, number> = {};
    /**
     * Named PS symbol IDs từ ParSheet — dùng để match matchedSymbols (raw PS IDs) → win type.
     * Server gửi PS IDs trong matchedSymbols; compare với các field này để xác định loại thắng.
     * Default -1 = chưa có PS (mock mode) → PayOutDisplay dùng client SymbolId so sánh thay thế.
     */
    psWinTypeIds = {
        oneSeven:    -1 as number,   // OneSevenSymbolID
        doubleSeven: -1 as number,   // DoubleSevenSymbolID
        tripleSeven: -1 as number,   // TripleSevenSymbolID
        anySeven:    -1 as number,   // AnySevenGroupID
        oneBar:      -1 as number,   // OneBarSymbolID
        doubleBar:   -1 as number,   // DoubleBarSymbolID
        anyBar:      -1 as number,   // AnyBarGroupID
        tripleWild:  -1 as number,   // TripleWildSymbolID
        redWild:     -1 as number,   // RedWildSymbolID
        blueWild:    -1 as number,   // BlueWildSymbolID
        anyWild:     -1 as number,   // AnyWildGroupID
    };
    /**
     * Flag: game được vào từ loading.scene (two-scene mode).
     * Set bởi LoadingController trước khi gọi director.loadScene().
     * GameManager dùng để tự detect, không cần isGameScene trong Inspector.
     */
    isFromLoadingScene: boolean = false;
    /**
     * Flag: đang resume Free Spin bị gián đoạn (tắt game giữa chừng).
     * Set bởi GameManager khi _pendingResume có stage FreeSpin.
     * GameEntryController dùng để bỏ qua màn hình guide và vào game ngay.
     */
    isResumingFreeSpin: boolean = false;
    /**
     * Jackpot symbol PS IDs từ ParSheet — dùng để detect jackpot từ rawPsStrips.
     * Server dùng các ID này thay vì winGrade để biểu thị jackpot trên reel.
     * Default = PS.json SuperNova values (nếu chưa có PS → dùng giá trị này).
     */
    jackpotPsIds: { MINI: number; MINOR: number; MAJOR: number; GRAND: number } = {
        MINI: 48, MINOR: 49, MAJOR: 51, GRAND: 52,
    };
    /**
     * Payline index của jackpot thắng gần nhất (0-based).
     * Set bởi GameManager._detectJackpot() khi phát hiện jackpot.
     * -1 = không có jackpot trong vòng quay hiện tại.
     */
    jackpotPaylineIndex: number = -1;
    /**
     * Payout multipliers từ PS.Symbols (API v1.0.3+).
     * Key = PS symbol ID, Value = payout multiplier (e.g. TripleSevenID → 200).
     * Empty khi chưa nhận PS (mock mode) → PayOutDisplay dùng Inspector fallback.
     */
    symbolPayouts: Record<number, number> = {};

    static get instance(): GameData {
        if (!this._instance) {
            this._instance = new GameData();
        }
        return this._instance;
    }

    /** Tổng bet = betOptions[betIndex] * coinValue (không nhân paylines) */
    get totalBet(): number {
        const bet = this.config.betOptions[this.player.betIndex] ?? 1;
        return bet * this.player.coinValue;
    }

    /**
     * Lấy 3 symbol hiển thị (top, mid, bot) cho 1 reel dựa trên center index.
     * Wrap-around khi vượt ngoài strip.
     * ★ Nếu có sticky cell → sticky override symbol từ strip.
     */
    getVisibleSymbols(reelIndex: number, centerIndex: number, isFreeSpin: boolean = false, stripIndex?: number, applyStickyOverride: boolean = true): number[] {
        const strips = this.getReelStrips(isFreeSpin, stripIndex);
        const strip = strips[reelIndex] ?? strips[0] ?? this.config.reelStrips[reelIndex] ?? [];
        const len = strip.length;
        if (len === 0) return [-1, -1, -1];
        const center = ((centerIndex % len) + len) % len;
        const top = strip[((center - 1) % len + len) % len];
        const mid = strip[center];
        const bot = strip[(center + 1) % len];
        const result = [top, mid, bot];
        // Sticky override (Re-Spin / Free Spin)
        if (applyStickyOverride && this.stickyCells.size > 0) {
            for (let r = 0; r < 3; r++) {
                const cell = this.stickyCells.get(`${reelIndex}-${r}`);
                if (cell) result[r] = cell.symbolId;
            }
        }
        return result;
    }

    /**
     * ★ Lấy toàn bộ grid 5×3 (reel × row) cho 1 spin response.
     * grid[reel][row] = symbolId.
     */
    getGrid(rands: number[], isFreeSpin: boolean = false, stripIndex?: number, applyStickyOverride: boolean = true): number[][] {
        const grid: number[][] = [];
        const reels = this.config.reelCount;
        for (let r = 0; r < reels; r++) {
            grid.push(this.getVisibleSymbols(r, rands[r] ?? 0, isFreeSpin, stripIndex, applyStickyOverride));
        }
        return grid;
    }

    /** Lấy grid trực tiếp từ reel strip/rands, không áp sticky override. Dùng để so với visual reel thật. */
    getBaseGrid(rands: number[], isFreeSpin: boolean = false, stripIndex?: number): number[][] {
        return this.getGrid(rands, isFreeSpin, stripIndex, false);
    }

    /** Chọn đúng bộ strip theo mode: 0=Normal, 1=FreeSpin, 2=Purchase(legacy), 3=Re-Spin. */
    getReelStrips(isFreeSpin: boolean = false, stripIndex?: number): number[][] {
        let result: number[][];
        let source: string;
        if (stripIndex != null) {
            if (stripIndex === 3 || (stripIndex === 2 && this.currentMode === 'respin')) {
                result = this.config.respinReelStrips;
                source = `respinReelStrips (stripIndex=${stripIndex})`;
            } else if (stripIndex === 2) {
                result = this.config.purchaseReelStrips;
                source = 'purchaseReelStrips (stripIndex=2)';
            } else if (stripIndex === 1) {
                result = this.config.freeSpinReelStrips;
                source = 'freeSpinReelStrips (stripIndex=1)';
            } else if (stripIndex === 0 && this.isPurchaseReelActive) {
                result = this.config.purchaseReelStrips;
                source = 'purchaseReelStrips (stripIndex=0 OVERRIDE)';
            } else if (stripIndex === 0 && (this.currentMode === 'freespin_gold' || this.currentMode === 'freespin')) {
                // Server gửi reelIndex=0 nhưng đang trong FreeSpin/FreeSpin Gold → dùng freeSpinReelStrips
                result = this.config.freeSpinReelStrips;
                source = `freeSpinReelStrips (stripIndex=0 override currentMode=${this.currentMode})`;
            } else {
                result = this.config.reelStrips;
                source = `reelStrips (stripIndex=${stripIndex})`;
            }
        } else {
            // ★ NEW: ưu tiên Re-Spin nếu đang trong mode đó
            if (this.currentMode === 'respin') {
                result = this.config.respinReelStrips;
                source = 'respinReelStrips (currentMode=respin)';
            } else if (!isFreeSpin && this.isPurchaseReelActive) {
                result = this.config.purchaseReelStrips;
                source = 'purchaseReelStrips (isPurchaseReelActive)';
            } else if (isFreeSpin || this.currentMode === 'freespin' || this.currentMode === 'freespin_gold') {
                result = this.config.freeSpinReelStrips;
                source = `freeSpinReelStrips (currentMode=${this.currentMode})`;
            } else {
                result = this.config.reelStrips;
                source = 'reelStrips (default)';
            }
        }
        return result;
    }

    /** Raw PS strips cùng mode với getReelStrips(), dùng cho payout/jackpot debug chính xác. */
    getRawPsStrips(isFreeSpin: boolean = false, stripIndex?: number): number[][] {
        if (stripIndex != null) {   // != catches both null and undefined
            if (stripIndex === 3 || (stripIndex === 2 && this.currentMode === 'respin')) return this.rawPsPurchaseReelStrips.length > 0 ? this.rawPsPurchaseReelStrips : this.rawPsStrips;
            if (stripIndex === 2) return this.rawPsPurchaseReelStrips.length > 0 ? this.rawPsPurchaseReelStrips : this.rawPsStrips;
            if (stripIndex === 1) return this.rawPsFreeSpinStrips.length > 0 ? this.rawPsFreeSpinStrips : this.rawPsStrips;
            // BUG FIX: same as getReelStrips — khi stripIndex=0 nhưng isPurchaseReelActive=true
            if (stripIndex === 0 && this.isPurchaseReelActive) {
                return this.rawPsPurchaseReelStrips.length > 0 ? this.rawPsPurchaseReelStrips : this.rawPsStrips;
            }
            // FreeSpin Gold/FreeSpin: force freeSpinStrips khi server gửi reelIndex=0
            if (stripIndex === 0 && (this.currentMode === 'freespin_gold' || this.currentMode === 'freespin')) {
                return this.rawPsFreeSpinStrips.length > 0 ? this.rawPsFreeSpinStrips : this.rawPsStrips;
            }
            return this.rawPsStrips;
        }
        if (!isFreeSpin && this.isPurchaseReelActive) return this.rawPsPurchaseReelStrips.length > 0 ? this.rawPsPurchaseReelStrips : this.rawPsStrips;
        if (isFreeSpin || this.currentMode === 'freespin_gold') return this.rawPsFreeSpinStrips.length > 0 ? this.rawPsFreeSpinStrips : this.rawPsStrips;
        return this.rawPsStrips;
    }

    /** Convert server/logical row to display row after vertical reel reversal. */
    toDisplayRow(row: number): number {
        return row >= 0 && row <= 2 ? 2 - row : row;
    }

    /** Visible symbols in the same top/mid/bot order as the client renders them. */
    getDisplayVisibleSymbols(reelIndex: number, centerIndex: number, isFreeSpin: boolean = false, stripIndex?: number): number[] {
        const symbols = this.getVisibleSymbols(reelIndex, centerIndex, isFreeSpin, stripIndex);
        return [symbols[2], symbols[1], symbols[0]];
    }

    /** Xác định Win Tier dựa trên totalWin / totalBet.
     *  Thứ tự check: MAX → MONSTER → ULTRA → EPIC → SUPER → MAJOR → MEGA → BIG (từ cao → thấp).
     *  Chỉ check tier nếu threshold > 0 (đã được server ghi đè). */
    getWinTier(totalWin: number): number {
        const ratio = totalWin / this.totalBet;
        if (this.config.maxWinThreshold     > 0 && ratio >= this.config.maxWinThreshold)     return 9; // MAX_WIN
        if (this.config.monsterWinThreshold > 0 && ratio >= this.config.monsterWinThreshold) return 8; // MONSTER_WIN
        if (this.config.ultraWinThreshold   > 0 && ratio >= this.config.ultraWinThreshold)   return 7; // ULTRA_WIN
        if (this.config.epicWinThreshold    > 0 && ratio >= this.config.epicWinThreshold)    return 6; // EPIC_WIN
        if (this.config.superWinThreshold   > 0 && ratio >= this.config.superWinThreshold)   return 5; // SUPER_WIN
        if (this.config.majorWinThreshold   > 0 && ratio >= this.config.majorWinThreshold)   return 4; // MAJOR_WIN
        if (this.config.megaWinThreshold    > 0 && ratio >= this.config.megaWinThreshold)    return 3; // MEGA_WIN
        if (this.config.bigWinThreshold     > 0 && ratio >= this.config.bigWinThreshold)     return 2; // BIG_WIN
        if (totalWin > 0) return 1;                                                                       // NORMAL
        return 0;                                                                                        // NONE
    }

    reset(): void {
        this.lastSpinResponse = null;
        this.freeSpinRemaining = 0;
        this.freeSpinTotalWin = 0;
        this.freeSpinTotalWinRestoredFromServer = false;
        // ★ NEW
        this.respinRemaining = 0;
        this.respinTotalWin = 0;
        this.topUpDisplayedEachWin = 0;
        this.featureBaseCredit = 0;
        this.stickyCells.clear();
        this.pickGameState = null;
        this.pickGameWinAmount = 0;
        this.currentMode = 'normal';
        this.freeSpinGoldRemaining = 0;
        this.freeSpinGoldTotalWin = 0;
    }

    /** Reset server session (khi logout hoặc reconnect) */
    resetSession(): void {
        this.serverSession = null;
        this.currentSeq = 0;
        this.isLoggedIn = false;
        this.isEntered = false;
        this.lastWinMsgId = '0';
        this.jackpotValues = [0, 0, 0, 0];
    }

    /** Cập nhật session sau login thành công */
    setServerSession(session: ServerSession): void {
        this.serverSession = session;
        this.currentSeq = session.seq;
        this.isLoggedIn = true;
        // Balance từ server
        this.player.balance = session.cash;
    }

    /** Cập nhật SEQ từ server response (dùng cho SeqRequest APIs) */
    updateSeq(newSeq: number): void {
        this.currentSeq = newSeq;
    }
}
