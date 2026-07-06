/**
 * SlotTypes - Định nghĩa tất cả Type, Enum, Interface cho game slot.
 * ★ Gold of Fortune (3×5 Ways Pay) — rewrite từ Shangri-La (3×3 Payline).
 */

// ─── ENUMS ───

/**
 * Stage type — mở rộng cho các feature mới của Gold of Fortune.
 * Giữ nguyên giá trị Free Spin / Buy Free Spin cũ để compatible với server SuperNova schema.
 */
export enum SlotStageType {
    SPIN = 0,
    POT = 1,                    // POT stage (server API 7.1)
    RE_SPIN = 2,                // Re-spin stage (server API 7.1)
    FREE_SPIN_START = 3,
    FREE_SPIN = 4,
    FREE_SPIN_RE_TRIGGER = 5,
    PICK_START = 6,             // Pick game start (server API 7.1)
    PICK = 7,                   // Pick game in progress (server API 7.1)
    BUY_FREE_SPIN_START = 8,
    BUY_FREE_SPIN = 9,
    LINK_SPIN_START = 10,       // Link spin start (server API 7.1)
    LINK_SPIN = 11,             // Link spin in progress (server API 7.1)
    TOPUP_SPIN_START = 12,      // Top-up spin start (server API 7.1)
    TOPUP_SPIN = 13,            // Top-up spin in progress (server API 7.1)
    HIDDEN_FREE_SPIN_START = 14, // Hidden free spin start (server API 7.1)
    HIDDEN_FREE_SPIN = 15,      // Hidden free spin in progress (server API 7.1)
    NEED_CLAIM = 100,
    FREE_SPIN_END = 101,
    PICK_END = 102,             // Pick game end (server API 7.1)
    COIN_FLIP = 103,            // Coin flip (server API 7.1)
    COIN_WHEEL = 104,           // Coin wheel (server API 7.1)
    COIN_FREE_SPIN = 105,       // Coin free spin (server API 7.1)
    COIN_END = 106,             // Coin event end (server API 7.1)
    BUY_FREE_SPIN_END = 107,
    FEATURE_SELECT = 108,       // Feature select (server API 7.1)
    HIDDEN_FREE_SPIN_END = 109, // Hidden free spin end (server API 7.1)
    DIRECT_PAY_START = 1000,    // Direct pay start (server API 7.1)
    DIRECT_PAY = 1001,          // Direct pay in progress (server API 7.1)
    LINK_SPIN_END = 1002,       // Link spin end (server API 7.1)
    TOPUP_SPIN_END = 1003,      // Top-up spin end (server API 7.1)
    DOUBLE_LINK_SPIN_START = 1004, // Double link spin start (server API 7.1)
    // ★ Gold of Fortune custom stages (client-side only)
    FEATURE_SELECT_START = 200,   // 6+ Red → hiển thị popup chọn Re-Spin / Free Spin
    RESPIN_START = 210,           // Vào chuỗi Re-Spin (Top Up)
    RESPIN = 211,                 // Đang Re-Spin
    RESPIN_END = 212,             // Re-Spin kết thúc → claim
    POT_WIN = 220,                // Wild trail trigger Pot Win → vào Pick Game
    PICK_GAME = 221,              // Đang chơi Pick Game
    PICK_GAME_END = 222,          // Pick Game kết thúc → claim jackpot
    BUY_RESPIN_START = 230,       // Mua Re-Spin
    BUY_RESPIN_END = 231,
}

/**
 * ★ Secret Treasure symbol set (0–20).
 *
 * Minors  (0–5):   9, 10, J, Q, K, A — payout thấp
 * Majors  (6–10):  Horus (Ra), Anubis, Sobek, Ramses, Cleopatra — payout cao
 * Special (11–15): Wild Trail, Sticky Red/Yellow/Green, +1 Re-Spin
 * Jackpot (16–20): chỉ dùng trong Pick Game, không xuất hiện trên reel strip
 */
export enum SymbolId {
    // ── Minor symbols (Secret Treasure: 6 minors) ──
    MINOR_9 = 0,
    MINOR_10 = 1,
    MINOR_J = 2,
    MINOR_Q = 3,
    MINOR_K = 4,
    MINOR_A = 5,
    // ── Major symbols (PS 11→15, payout thấp → cao) ──
    MAJOR_HORUS = 6,      // Horus (Ra)
    MAJOR_ANUBIS = 7,
    MAJOR_SOBEK = 8,
    MAJOR_RAMSES = 9,
    MAJOR_CLEOPATRA = 10,
    // ── Special symbols ──
    WILD = 11,           // Wild Trail — chỉ xuất hiện trên reel 1/2/3 (index 1,2,3)
    STICKY_RED = 12,     // Red sticky — xuất hiện Normal/Re-Spin/Free Spin, mang credit
    STICKY_YELLOW = 13,  // Yellow sticky — Re-Spin / Free Spin Wild
    STICKY_GREEN = 14,   // Green sticky — Re-Spin VIP
    PLUS_ONE_SPIN = 15,  // +1 Re-Spin
    // ── Jackpot (chỉ trong Pick Game) ──
    JP_IDLE = 16,
    JP_MINI = 17,
    JP_MINOR = 18,
    JP_MAJOR = 19,
    JP_GRAND = 20,

}

/** Helper: kiểm tra symbol là Major (6–10) */
export function isMajor(s: number): boolean { return s >= SymbolId.MAJOR_HORUS && s <= SymbolId.MAJOR_CLEOPATRA; }
/** Helper: kiểm tra symbol là Minor (0–5) */
export function isMinor(s: number): boolean { return s >= SymbolId.MINOR_9 && s <= SymbolId.MINOR_A; }
/** Helper: kiểm tra symbol là Sticky (Red/Yellow/Green) */
export function isSticky(s: number): boolean { return s === SymbolId.STICKY_RED || s === SymbolId.STICKY_YELLOW || s === SymbolId.STICKY_GREEN; }
/** Helper: Wild có thay thế được cho symbol s không?
 * Wild thay tất cả Minor + Major. KHÔNG thay Sticky, +1 Spin, Jackpot.
 */
export function wildSubstitutes(s: number): boolean { return isMinor(s) || isMajor(s); }

// ═══════════════════════════════════════════════════════════
//  PS ↔ CLIENT SYMBOL ID MAPPING — Secret Treasure (SlotId 18)
// ═══════════════════════════════════════════════════════════

/**
 * PS ID → Client SymbolId — Secret Treasure (SlotId 18).
 *
 * Normal symbols (Way Pay): 1=9, 2=10, 3=J, 4=Q, 5=K, 6=A, 11=Horus, 12=Anubis, 13=Sobek, 14=Ramses, 15=Cleopatra
 * Wild: 21 (Base Game only)
 * Red Coins Trail: 41–46 (STICKY_RED + credit text)
 * Yellow Coin (Free Spin): 47 | Yellow Coin (Top Up): 48
 * Green Coin: 49 | +1 Spin: 50
 * Pick Game: 81=Idle, 82=Grand, 83=Major, 84=Minor, 85=Mini
 */
export const PS_TO_CLIENT: Record<number, number> = {
    // ─── Normal symbols (Way Pay wins) ───
    1:  SymbolId.MINOR_9,
    2:  SymbolId.MINOR_10,
    3:  SymbolId.MINOR_J,
    4:  SymbolId.MINOR_Q,
    5:  SymbolId.MINOR_K,
    6:  SymbolId.MINOR_A,
    11: SymbolId.MAJOR_HORUS,      // Horus (Ra)
    12: SymbolId.MAJOR_ANUBIS,
    13: SymbolId.MAJOR_SOBEK,
    14: SymbolId.MAJOR_RAMSES,
    15: SymbolId.MAJOR_CLEOPATRA, // highest payout
    // ─── Wild ───
    21: SymbolId.WILD,           // Wild Trail (Bat + Peach, Base Game only)
    // ─── Red Coins Trail (41–46) — tất cả hiển thị cùng 1 hình STICKY_RED ───
    // Credit value của mỗi loại coin được lấy từ SymbolRates[id] và render dưới dạng text
    41: SymbolId.STICKY_RED,     // Trail01 Red Coin (giá trị nhỏ nhất)
    42: SymbolId.STICKY_RED,     // Trail02 Red Coin
    43: SymbolId.STICKY_RED,     // Trail03 Red Coin
    44: SymbolId.STICKY_RED,     // Trail04 Red Coin
    45: SymbolId.STICKY_RED,     // Trail05 Red Coin
    46: SymbolId.STICKY_RED,     // Trail06 Red Coin (giá trị lớn nhất)
    // ─── Feature special symbols ───
    47: SymbolId.STICKY_YELLOW,  // Yellow Coin — Free Spin (Wild + instant pay)
    48: SymbolId.STICKY_YELLOW,  // Yellow Coin — Top Up (hút tiền các đồng Đỏ)
    49: SymbolId.STICKY_GREEN,   // Green Coin — Top Up VIP (hút toàn bộ tiền)
    50: SymbolId.PLUS_ONE_SPIN,  // +1 Spin (Top Up Bonus)
    // ─── Pick Game symbols (lưới 3×4 = 12 thẻ) ───
    81: SymbolId.JP_IDLE,        // Pick Idle (thẻ úp)
    82: SymbolId.JP_GRAND,       // GRAND Jackpot (Rồng Đỏ)
    83: SymbolId.JP_MAJOR,       // MAJOR Jackpot (Thỏi Vàng/Bạc)
    84: SymbolId.JP_MINOR,       // MINOR Bonus (Quả Đào)
    85: SymbolId.JP_MINI,        // MINI Bonus (Quả Cam)
    // ─── Empty ───
    99: -1,
};

/** Client SymbolId → PS ID (normal symbols only — Trail/special là 1-to-many). */
export const CLIENT_TO_PS: Record<number, number> = {
    [SymbolId.MINOR_9]:      1,
    [SymbolId.MINOR_10]:     2,
    [SymbolId.MINOR_J]:      3,
    [SymbolId.MINOR_Q]:      4,
    [SymbolId.MINOR_K]:      5,
    [SymbolId.MINOR_A]:      6,
    [SymbolId.MAJOR_HORUS]:     11,
    [SymbolId.MAJOR_ANUBIS]:    12,
    [SymbolId.MAJOR_SOBEK]:     13,
    [SymbolId.MAJOR_RAMSES]:    14,
    [SymbolId.MAJOR_CLEOPATRA]: 15,
    [SymbolId.WILD]:         21,
    [SymbolId.STICKY_RED]:   41,  // representative Trail01
    [SymbolId.STICKY_YELLOW]:47,  // representative Yellow
    [SymbolId.STICKY_GREEN]: 49,
    [SymbolId.PLUS_ONE_SPIN]:50,
    [SymbolId.JP_IDLE]:      81,
    [SymbolId.JP_GRAND]:     82,
    [SymbolId.JP_MAJOR]:     83,
    [SymbolId.JP_MINOR]:     84,
    [SymbolId.JP_MINI]:      85,
};

export function psToClientSymbol(psId: number): number {
    return PS_TO_CLIENT[psId] ?? -1;
}

export function convertPSStrips(psStrips: number[][]): number[][] {
    return psStrips.map((strip) =>
        strip.map((psId) => PS_TO_CLIENT[psId] ?? SymbolId.MINOR_9)
    );
}

export enum JackpotType {
    NONE = 0,
    MINI = 1,
    MINOR = 2,
    MAJOR = 3,
    GRAND = 4,
}

export enum TopupReelType {
    NONE = 0,
    RED = 1,
    YELLOW = 2,
    GREEN = 3,
    GRAND = 4,
}

export enum WinTier {
    NONE = 0,
    NORMAL = 1,
    BIG_WIN = 2,
    MEGA_WIN = 3,
    MAJOR_WIN = 4,
    SUPER_WIN = 5,
    EPIC_WIN = 6,
    ULTRA_WIN = 7,
    MONSTER_WIN = 8,
    MAX_WIN = 9,
}

/** State machine — trạng thái hiện tại của vòng spin */
export enum GameState {
    IDLE = 'idle',
    SPINNING = 'spinning',
    RESULT = 'result',
    FREE_SPIN = 'freespin',
    POPUP = 'popup',
    // ★ NEW
    FEATURE_SELECT = 'feature_select',  // Đang hiển thị popup chọn Re-Spin / Free Spin
    RESPIN = 'respin',                  // Đang trong chuỗi Re-Spin
    POT_WIN = 'pot_win',                // Pot Trail đã trigger, chuẩn bị Pick Game
    PICK_GAME = 'pick_game',            // Đang chơi Pick Game
}

// ─── INTERFACES ───

/**
 * 1 win theo Ways Pay — thay thế MatchedLinePay (payline).
 * Server (nếu có) cũng có thể trả về structure này khi schema cập nhật.
 */
export interface WaysPayWin {
    /** Symbol thắng (đã resolve Wild → ID symbol gốc). */
    symbolId: number;
    /** Số reel liên tiếp từ trái match (3..5). */
    reelCount: number;
    /** Số "ways" = tích số instance trên mỗi reel. */
    ways: number;
    /** Payout = symbolPayout × ways × totalBet (đã tính sẵn). */
    payout: number;
    /** Có chứa Wild không (để khoá animation Wild zoom riêng). */
    containsWild: boolean;
    /** Danh sách vị trí (reel, row) tất cả ô tham gia win — dùng cho highlight. */
    cells: Array<{ reel: number; row: number }>;
    /**
     * Mỗi phần tử là 1 combination cụ thể (1 path từ reel 0 → reelCount-1).
     * combinations.length === ways.
     * Dùng để cycle từng path riêng biệt giống payline cycling.
     */
    combinations: Array<Array<{ reel: number; row: number }>>;
}

/**
 * @deprecated dùng `WaysPayWin` cho Gold of Fortune.
 * Giữ alias để code legacy compile (sẽ remove cùng PaylineDisplay).
 */
export interface MatchedLinePay {
    payLineIndex: number;
    payout: number;
    matchedSymbols: number[];
    containsWild: boolean;
    reelCnt: number;
    matchedSymbolsIndices: Array<{ Item1: number; Item2: number }> | null;
}

/** Sticky cell state — dùng trong Re-Spin / Free Spin. */
export interface StickyCell {
    reel: number;        // 0..4
    row: number;         // 0..2
    symbolId: number;    // STICKY_RED / STICKY_YELLOW / STICKY_GREEN
    credit: number;      // giá trị nhúng trên symbol (đơn vị = chip, đã nhân totalBet)
}

/** Pick Game state — Pick coin reveal sequence. */
export interface PickGameState {
    /** Grid 3×4 = 12 ô. Mỗi ô lưu symbolId thật (JP_GRAND/MAJOR/MINOR/MINI) — chưa lộ cho người chơi. */
    grid: number[];
    /** Ô đã lật (index 0..11). */
    revealed: number[];
    /** Tier thắng (sau khi match 3 cùng tier). undefined = chưa thắng. */
    wonTier?: 'GRAND' | 'MAJOR' | 'MINOR' | 'MINI';
}

export interface TopupReelSlot {
    type: TopupReelType;
    win: number;
    index: number;
}

export interface SelectFeatureResponse {
    nextStage: number;
    remainFeatureSpinCount: number;
}

/** Spin response — mở rộng đầy đủ cho Gold of Fortune. */
export interface SpinResponse {
    /** Center strip index của 5 reel. */
    rands: number[];
    /** ★ NEW: Wins theo Ways Pay. */
    waysPayWins: WaysPayWin[];
    /** @deprecated giữ field cho code legacy. */
    matchedLinePays: MatchedLinePay[];
    totalBet: number;
    totalWin: number;
    updateCash: boolean;
    nextStage: number;
    reelIndex?: number;
    featureMultiple?: number;
    remainCash?: number;
    remainFreeSpinCount?: number;
    winGrade?: string;
    featureSpinTotalWin?: number;

    // ★ NEW Gold of Fortune fields ─────────────────────────────
    /** Số Red sticky xuất hiện trong vòng spin này (để detect Feature Select / Long Spin). */
    redCount?: number;
    /** Danh sách reel có Red sticky (dùng cho Long Spin trigger: 3+ reel trong [0..3]). */
    redReels?: number[];
    /** Danh sách sticky cells (kèm credit) — non-empty khi Re-Spin / Free Spin. */
    stickyCells?: StickyCell[];
    /** Số ô Wild Trail xuất hiện trong spin này (để Pot Level tích lũy). */
    wildTrailCount?: number;
    /** Pot Visual Level trực tiếp từ server (1..6). Dùng để set Pot level UI. */
    potVisualLevel?: number;
    /** Server trigger Pot Win (= bước vào Pick Game). */
    triggerPotWin?: boolean;
    /** Pick game data (chỉ có khi triggerPotWin = true). */
    pickGame?: PickGameState;
    /** Số Re-Spin còn lại (Re-Spin mode). */
    remainRespinCount?: number;
    /** Topup game link reel state: 15 grid cells + 1 Grand slot. */
    topupReel?: TopupReelSlot[];
}

export interface PlayerData {
    balance: number;
    betIndex: number;
    coinValue: number;
}

/** Config cố định từ Parsheet (★ Gold of Fortune — 5 reels, Ways Pay). */
export interface SlotConfig {
    /** 5 reel strips Normal Spin. Mỗi strip = mảng SymbolId. */
    reelStrips: number[][];
    /** 5 reel strips Free Spin (yellow wild trên reel 1/2/3 ⇒ strip khác). */
    freeSpinReelStrips: number[][];
    /** 5 reel strips Re-Spin (chỉ ô trống được quay; strip nhiều +1 spin / Yellow / Green). */
    respinReelStrips: number[][];
    /** Hỗ trợ legacy: nếu user bật BuyBonus cũ ⇒ dùng tạm strips này. */
    purchaseReelStrips: number[][];

    /** Bet & Coin options. */
    betOptions: number[];
    coinValues: number[];

    /** Số reel cố định = 5 (đặt thành biến để code adapter dễ thay đổi). */
    reelCount: number;
    /** Số row visible = 3. */
    rowCount: number;
    /** Tổng số ways = rowCount ^ reelCount = 3^5 = 243. */
    totalWays: number;

    /** Ngưỡng WinTier (×totalBet). */
    bigWinThreshold: number;
    megaWinThreshold: number;
    majorWinThreshold: number;
    superWinThreshold: number;
    epicWinThreshold: number;
    ultraWinThreshold: number;
    monsterWinThreshold: number;
    maxWinThreshold: number;

    /**
     * Paytable theo Ways Pay: payout multiplier × totalBet × ways
     * Key = SymbolId. Value = mảng [3-of-a-kind, 4-of-a-kind, 5-of-a-kind] multiplier.
     * Lưu ý: multiplier áp dụng **không nhân với totalBet** vì server schema mới
     * dùng công thức (multiplier × ways × totalBet). Xem `WaysPayCalculator`.
     */
    waysPayTable: Record<number, [number, number, number]>;

    /** Jackpot tier payout multipliers (× totalBet) — Pick Game reward. */
    jackpotMultipliers?: {
        GRAND: number;
        MAJOR: number;
        MINOR: number;
        MINI: number;
    };

    /** Pot Level thresholds (số Wild Trail tích luỹ để lên level). 6 ngưỡng cho level 1→6. */
    potLevelThresholds: number[]; // e.g. [1, 3, 5, 7, 9, 12]

    // ─── @deprecated — giữ field cho code legacy. Không dùng trong code mới. ───
    /** @deprecated dùng Ways Pay; không còn paylines. */
    paylines: number[][];
}

// ═══════════════════════════════════════════════════════════
//  SERVER API TYPES (dùng khi USE_REAL_API = true)
// ═══════════════════════════════════════════════════════════

/** Session data nhận được sau khi Login thành công */
export interface ServerSession {
    nick: string;
    serverTime: string;
    clientIp: string;
    sessionKey: bigint;       // Int64 — dùng làm SKEY cho mọi request sau (dùng BigInt để tránh mất precision)
    sessionUpdateSec: number;
    memberIdx: number;        // Int64 — dùng làm MIDX (giá trị thực tế nhỏ, number là đủ)
    seq: number;              // Sequence number khởi đầu
    uid: string;
    cash: number;             // Balance thực từ server
    aky: string;              // AES-256 key cho mọi request sau login
    currency: string;
    country: string;
    isNewAccount: boolean;
    useBroadcast: boolean;
    isPractice?: boolean;
    smm: ServerMaintenanceMessage | null;
}

/** Enter response — data game khởi tạo */
export interface ServerEnterResponse {
    cash: number;
    slotName: string;
    ps: string;               // Base64 par sheet data
    betIndex: number;
    coinValueIndex: number;
    lastSpinResponse: any;    // ISpinResponse từ server
    isPractice: boolean;
    memberIdx: number;
    smm: ServerMaintenanceMessage | null;
}

/** Spin response từ server (AckSpin) — ALL PascalCase theo actual API */
export interface ServerSpinResponse {
    RemainCash: number;
    Res: {
        Rands: number[];
        MatchedLinePays: ServerMatchedLinePay[];
        UpdateCash: boolean;
        TotalBet: number;
        TotalWin: number;
        NextStage: number;
        WinGrade: string | null;
        FeatureSpinTotalWin: number;
        FeatureSpinWin: number;
        RemainFreeSpinCount: number;
        RemainFeatureSpinCount?: number;
        ReelIndex: number;
        FeatureMultiple?: number;
        MysteryMultiple?: number;
        FreeSpinMultiplier?: number;
        MatchedBonus?: any;
        CollectWin?: number;
        AddSpinCount?: number;
        InitReel?: any;
        // ★ Gold of Fortune specific fields
        RedCount?: number;
        StickyRedCount?: number;
        RedReels?: number[];
        StickyCells?: any[];
        StickyList?: any[];
        CollectSymbols?: any[];
        WildTrailCount?: number;
        WildCount?: number;
        PotVisualLevel?: number;
        TriggerPotWin?: boolean;
        IsPotWin?: boolean;
        PickGame?: any;
        PickGameState?: any;
        RemainReSpinCount?: number;
        RemainRespinCount?: number;
        TopupReel?: any[];
        NormalSpinLinkReel?: any[];
        NoramlSpinLinkReel?: any[];
    };
    SpinID: number;                    // Int64
    Before: Record<string, number>;    // Jackpot values trước spin
    After: Record<string, number>;     // Jackpot values sau spin
    SMM: ServerMaintenanceMessage | null;
}

/** Server MatchedLinePay format — ALL PascalCase theo actual API */
export interface ServerMatchedLinePay {
    Feature: string | null;
    FeatureParam: number;
    MatchedSymbols: number[];
    MatchedSymbolsCount: number;
    PayLineIndex: number;
    Payout: number;
    ReelCnt: number;
    ContainsWild: boolean;
    MatchedSymbolsIndices: any[];
}

/**
 * Pick response từ server (AckPick → GFPickResponse).
 * IsJackpot=true khi đã match 3 hình giống nhau.
 * JackpotIndex: 0=Mini, 1=Minor, 2=Major, 3=Grand.
 * NextStage=102 (PICK_END) khi kết thúc → client phải gọi /Claim.
 *
 * Theo API spec: Server trả về {RemainCash, Res: {GFPickResponse}}
 * GFPickResponse structure:
 *   PickGame: array<int> - Current pick grid state (12 items)
 *   PickResults: int - Result value of this pick
 *   PickStage: int - Current pick stage (1-9)
 *   PickWin: number - Accumulated pick win amount
 *   IsJackpot: boolean - Whether 3 matches resulted in jackpot
 *   JackpotIndex: int - Jackpot type (0=Mini, 1=Minor, 2=Major, 3=Grand, -1=no win)
 *   NextStage: int - Next stage
 */
export interface ServerPickResponse {
    PickGame: number[];          // Grid state (12 items, server symbol IDs: 81=Idle, 82=Grand, 83=Major, 84=Minor, 85=Mini)
    PickResults?: number;        // Result value of this pick
    PickStage?: number;          // Current pick stage (1-9)
    PickWin?: number;           // Accumulated pick win amount
    IsJackpot: boolean;
    JackpotIndex: number;       // 0=Mini 1=Minor 2=Major 3=Grand -1=no win
    NextStage: number;
}

/** Claim response từ server (AckClaimFeature) — PascalCase theo tài liệu */
export interface ServerClaimResponse {
    ClaimResponse: {
        TotalWin: number;
        FeatureName: string;
        NextStage: number;
        WinGrade: string;
        StartRands: number[];
    };
    WinCash: number;           // Tiền thắng trong feature spin
    Cash: number;
}

/** BalanceGet response từ server (AckBalanceGet) — 4.11 /Slot/{SlotId}/BalanceGet */
export interface ServerBalanceGetResponse {
    Balance: number;     // Current balance
    Currency: string;    // Currency code (e.g. "KRW")
}

/** FeatureItem từ server — AckFeatureItemGet.Items[n] (theo API doc) */
export interface ServerFeatureItem {
    Id: number;              // ID của gói
    Name: string;            // Tên gói
    Title: string;           // Tiêu đề hiển thị
    Desc: string;            // Mô tả chi tiết
    PriceRatio: number;      // Bội số so với totalBet (không phải giá tuyệt đối)
    EffectType: number;      // 1=Ticket, 2=ExchangeReel, 3=ProvideSymbol, 4=AddSpins
    EffectReels: number[];   // Reel áp dụng (nếu có)
    EffectSymbols: any[];    // Symbol áp dụng (nếu có)
    AddSpinValue: number | null;
    TicketFeature: number;
    Order: number;
    ImgUrl: string;          // URL thumbnail
}

/** FeatureItemGet response từ server (AckFeatureItemGet) */
export interface ServerFeatureItemGetResponse {
    Cash: number;
    Items: ServerFeatureItem[];
    SMM: any | null;
}

/** FeatureItemBuy response từ server (AckPurchaseItemBuy) */
export interface ServerFeatureItemBuyResponse {
    IsSuccess: boolean;
    Res: any | null;       // ISpinResponse — spin result kèm theo khi mua
    RemainCash: number;
    ExReel: any;           // Có thể là string (AES encrypted), array, object, hoặc null
}

/** Client-side FeatureItem (camelCase) */
export interface FeatureItem {
    itemId: number;
    name: string;
    title: string;
    desc: string;
    priceRatio: number;      // PriceRatio từ server (bội số × totalBet)
    effectType: number;      // 1=Ticket, 2=ExchangeReel, 3=ProvideSymbol, 4=AddSpins
    imgUrl: string;
    addSpinValue?: number | null;
}

// ═══════════════════════════════════════════════════════════
//  BUY BONUS SYSTEM — IBonusItem
// ═══════════════════════════════════════════════════════════

/** Loại áp dụng của BonusItem (mapping từ SlotPurchaseItemEffectType) */
export type BonusApplyType = 'onceuse' | 'activate';

/**
 * IBonusItem — Dữ liệu item bonus từ Server (SlotFeatureItemInfo).
 * - "onceuse": Mua đứt 1 lần → gọi API FeatureItemBuy (EffectType=1 Ticket / 4 AddSpins).
 * - "activate": Bật/Tắt → dùng OnOff trong FeatureItemBuy (EffectType=2 ExchangeReel / 3 ProvideSymbol).
 * - Price hiển thị = currentTotalBet × valueRatio (PriceRatio từ server).
 */
export interface IBonusItem {
    uniqueID: string;            // ← SlotFeatureItemInfo.Id (Int32 → string)
    itemName: string;            // ← SlotFeatureItemInfo.Name
    itemInfo: string;            // ← SlotFeatureItemInfo.Desc
    applyType: BonusApplyType;   // ← suy ra từ EffectType: "onceuse" hoặc "activate"
    valueRatio: number;          // ← SlotFeatureItemInfo.PriceRatio
    thumbnailImage: string;      // ← SlotFeatureItemInfo.ImgUrl
}

/** Jackpot polling response (AckJackpotInfo) — PascalCase theo tài liệu */
export interface ServerJackpotResponse {
    Wins: number[];                  // [mini, minor, major, grand] — array theo actual API
    WinMsgs: ServerWinBroadcast[];
    ReqRace: boolean;
    CR: NwCashRaceSimpleForUser | null;
    UTC: string;
    SMM?: ServerMaintenanceMessage | null;  // "Most responses include SMM" (doc section 6)
}

// ─── Cash Race types (theo API doc) ──────────────────────────────────────────

/** NwCashRaceSimpleForUser — trả về trong Jackpot polling */
export interface NwCashRaceSimpleForUser {
    MyRank: number;           // hạng hiện tại của tôi (0 nếu chưa có hạng)
    MyPrizePercent: number;   // % prize có thể nhận
    Race: NwCashRaceInfoSimple;
}

/** NwCashRaceInfoSimple — thông tin race rút gọn (trong Jackpot CR) */
export interface NwCashRaceInfoSimple {
    RaceId: number;
    Rule: number;     // CashRaceRule: 0=WIN, 1=BET, 2=LOSE
    State: number;    // CashRaceState: 0=none,1=wait,2=notice,3=running,4=closing,5=closed
    NT: string;       // notice start time (ISO UTC)
    ST: string;       // race start time (ISO UTC)
    CT: string;       // race end / settlement start time (ISO UTC)
    ET: string;       // settlement end time (ISO UTC)
    DT: string;       // display time (ISO UTC)
    TotalPrize: number;
}

/** NwCashRaceInfoDetail — thông tin race đầy đủ (trong CashRaceMyRankGetFirst) */
export interface NwCashRaceInfoDetail {
    RaceId: number;
    Title: string;
    Rule: number;     // CashRaceRule: 0=WIN, 1=BET, 2=LOSE
    State: number;    // CashRaceState
    NT: string;
    ST: string;
    CT: string;
    ET: string;
    Desc: string;
    TotalPrize: number;
    WinnerCount: number;  // số người nhận thưởng
    BasePrize: number;
    PrizeRatio: number;
}

/** NwCashRaceRankerSimple — 1 dòng trong bảng xếp hạng */
export interface NwCashRaceRankerSimple {
    Rank: number;
    Nick: string;
    Score: number;
    Prize: number;
    B_Rank: number;   // hạng trước đó
}

/** Response của CashRaceMyRankGetFirst */
export interface CashRaceMyRankGetFirstResponse {
    Race: NwCashRaceInfoDetail;
    MyRank: NwCashRaceRankerSimple | null;
    TopRanks: NwCashRaceRankerSimple[];
    BottomRanks: NwCashRaceRankerSimple[];
    PrizeRangePercent: number;
}

/** Win broadcast message */
export interface ServerWinBroadcast {
    Seq: string;                 // ID dạng số lớn (19 chữ số) — giữ dạng string tránh mất precision
    Slot: string;
    MX: number;
    Nick: string;                // Server vẫn gửi field "Nick" (hiện đang chứa UUID)
    DisplayName?: string;        // Tên hiển thị (nếu server bổ sung sau)
    WinPopupUrl: string;
    Feature: string;
    LangID: string;
    SlotIcon: string;
    CountryFlagIcon: string;
    CTime: string;
}

/** Server Maintenance Message */
export interface ServerMaintenanceMessage {
    ServerUtc: string;
    ShutdownUtc: string;
    Title: string;
    Line1: string;
    Line2: string;
    RemainMinutes: number;
    DurationMinutes: number;
    Step: number;
}
