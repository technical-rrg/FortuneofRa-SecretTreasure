/**
 * WaysPayDisplay — Highlight ô symbol thắng cho Gold of Fortune (Ways Pay 243).
 *
 * Dùng Spine skeleton loop chạy trên overlay nodes được pool trước từ 1 Node template trong scene.
 * Pool được tạo 1 lần trong init(), nodes được mượn/trả khi show/hide — không bao giờ clone runtime.
 *
 * FLOW:
 *   1. WIN_SHOW_ALL_WAYS  → hiện TOÀN BỘ ô thắng (union của mọi WaysPayWin) — mượn từ pool
 *   2. WIN_CYCLE_ONE_WAY  → trả hết về pool, mượn lại chỉ ô của way đang cycle
 *   3. REELS_START_SPIN   → trả tất cả về pool
 *
 * SETUP:
 *   1. Tạo 1 Node "HighlightSpine" trong scene: gắn sp.Skeleton, SkeletonData đúng, đặt inactive.
 *   2. Gắn component WaysPayDisplay vào cùng Node với SlotMachineController (hoặc node khác).
 *   3. Kéo Node WaysPayDisplay vào slot "waysPayDisplay" trong SlotMachineController.
 *   4. Kéo Node "HighlightSpine" vào "highlightSpinePrefab" trong SlotMachineController.
 *   5. Điều chỉnh "highlightSpineAnim" nếu tên animation khác "animation".
 *   6. SlotMachineController.start() sẽ tự gọi WaysPayDisplay.init().
 *
 * NODE LAYOUT (mỗi reel):
 *   symbolNodes[0] = ExtraTop2  (buffer)
 *   symbolNodes[1] = ExtraTop1  (buffer)
 *   symbolNodes[2] = Top  ← visible row 0
 *   symbolNodes[3] = Mid  ← visible row 1
 *   symbolNodes[4] = Bot  ← visible row 2
 *   symbolNodes[5] = ExtraBot1  (buffer)
 *   symbolNodes[6] = ExtraBot2  (buffer)
 */

import { _decorator, Component, Node, sp, instantiate } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { SymbolId, WaysPayWin } from '../data/SlotTypes';
import { GameData } from '../data/GameData';
import { ReelController } from './ReelController';
import { SymbolView } from './SymbolView';

const { ccclass, property } = _decorator;

/** Index bắt đầu của visible rows trong symbolNodes (sau ExtraTop2 + ExtraTop1) */
const VISIBLE_ROW_OFFSET = 2;
/** Số visible rows mỗi reel */
const VISIBLE_ROWS = 3;

@ccclass('WaysPayDisplay')
export class WaysPayDisplay extends Component {

    // ─── SET BỞI SlotMachineController.init() ─────────────────────────────

    /** Tham chiếu tới mảng ReelController (gán từ SlotMachineController) */
    reels: ReelController[] = [];

    /**
     * Node template inactive trong scene — instantiate() từ đây để fill pool.
     * Gán từ SlotMachineController.highlightSpinePrefab.
     * Cũng có thể kéo trực tiếp vào Inspector để prebuildPool() hoạt động sớm.
     */
    @property({
        type: Node,
        tooltip: 'Node template Spine cho highlight (inactive). Kéo vào đây để pool được build sớm trước khi vào game.',
    })
    highlightSpinePrefab: Node | null = null;

    /** Tên animation Spine phát khi highlight (mặc định: "animation") */
    highlightSpineAnim: string = 'animation';

    @property({
        tooltip: 'Số node cần build trước trong pool (reels × visibleRows). Mặc định 15 = 5 reels × 3 rows.',
    })
    prebuildPoolSize: number = 15;

    // ─── INTERNAL ──────────────────────────────────────────────────────────

    /**
     * Pool các node idle (inactive, parented to this.node).
     * Được fill 1 lần trong init() — không bao giờ instantiate thêm sau đó.
     */
    private _pool: Node[] = [];

    /**
     * _overlays[col][row] = node đang active tại ô (col, row), null nếu ô đó đang tắt.
     * Node được parented vào symbolNode tương ứng khi đang hiện.
     */
    private _overlays: Array<Array<Node | null>> = [];

    /** Flag: đã init xong */
    private _ready: boolean = false;

    // ─── LIFECYCLE ─────────────────────────────────────────────────────────

    onLoad(): void {
        const bus = EventBus.instance;
        bus.on(GameEvents.WIN_SHOW_ALL_WAYS,  this._onShowAllWays,  this);
        bus.on(GameEvents.WIN_CYCLE_ONE_WAY,  this._onCycleOneWay,  this);
        bus.on(GameEvents.REELS_START_SPIN,   this._onSpinStart,    this);
        bus.on(GameEvents.FREE_SPIN_START,    this._onFeatureStart, this);
        bus.on(GameEvents.FREE_SPIN_GOLD_START, this._onFeatureStart, this);
        bus.on(GameEvents.TOPUP_START,         this._onFeatureStart, this);
        bus.on(GameEvents.CREDIT_FLY_IN_START, this._onFeatureStart, this);
        bus.on(GameEvents.FREE_SPIN_END,       this._onFeatureEnd,   this);
        bus.on(GameEvents.FREE_SPIN_GOLD_END, this._onFeatureEnd,   this);
        bus.on(GameEvents.TOPUP_END,          this._onFeatureEnd,   this);
        bus.on(GameEvents.PICK_GAME_OPEN,     this._onFeatureEnd,   this);
        bus.on(GameEvents.PICK_GAME_CLOSE,    this._onFeatureEnd,   this);
    }

    onDestroy(): void {
        this._returnAll();
        for (const n of this._pool) { if (n?.isValid) n.destroy(); }
        this._pool = [];
        EventBus.instance.offTarget(this);
    }

    // ─── PUBLIC API ────────────────────────────────────────────────────────

    /**
     * Gọi từ GameEntryController khi LOADING_COMPLETE — build pool sớm trước khi GameRoot active.
     * Dùng prebuildPoolSize thay vì reels.length (reels chưa được set lúc này).
     * init() sẽ rebuild pool với đúng count khi SlotMachineController.start() chạy.
     */
    public prebuildPool(): void {
        // log removed

        if (!this.highlightSpinePrefab) return;
        if (this._pool.length >= this.prebuildPoolSize) {
            // log removed
            return; // đã build rồi
        }

        for (let i = this._pool.length; i < this.prebuildPoolSize; i++) {
            const node = instantiate(this.highlightSpinePrefab);
            node.active = false;
            this.node.addChild(node);
            this._pool.push(node);
        }

        // log removed
    }

    /**
     * Khởi tạo pool. Gọi từ SlotMachineController.start() SAU khi reels đã setup xong.
     * @param reels        Mảng 5 ReelController
     * @param templateNode Node template inactive trong scene (có sp.Skeleton gắn sẵn)
     * @param animName     Tên animation phát loop (mặc định "animation")
     */
    init(reels: ReelController[], templateNode: Node | null, animName: string = 'animation'): void {
        // log removed

        this.reels               = reels;
        this.highlightSpinePrefab = templateNode;
        this.highlightSpineAnim  = animName;
        this._buildPool();
        // Khởi tạo _overlays tracking
        this._overlays = reels.map(() => new Array<Node | null>(VISIBLE_ROWS).fill(null));
        this._ready = true;

        // log removed
    }

    // ─── EVENT HANDLERS ────────────────────────────────────────────────────

    /**
     * Hiện toàn bộ ô thắng (union của mọi WaysPayWin) + bắt đầu frame animation.
     * @param ways     Mảng WaysPayWin từ SpinResponse
     * @param duration (không dùng trực tiếp — WinPresenter quản lý timer)
     */
    private _onShowAllWays(ways: WaysPayWin[], _duration?: number): void {
        if (!this._ready) return;
        this._returnAll();

        const shown = new Set<string>();
        for (const way of ways) {
            for (const { reel, row } of way.cells) {
                // grid row (0=center-1, 2=center+1) ngược với visual row (0=Top=center+1).
                // Conversion: displayRow = 2 - gridRow
                const displayRow = 2 - row;
                const key = `${reel},${displayRow}`;
                if (!shown.has(key)) {
                    shown.add(key);
                    this._showOverlay(reel, displayRow);
                }
            }
        }
    }

    /**
     * Cycle từng way riêng lẻ: ẩn hết, hiện lại chỉ ô của way này.
     * @param way  1 WaysPayWin đang được cycle
     */
    private _onCycleOneWay(way: WaysPayWin): void {
        if (!this._ready) return;
        this._returnAll();
        for (const { reel, row } of way.cells) {
            // grid row ngược với visual row: displayRow = 2 - gridRow
            const displayRow = 2 - row;
            this._showOverlay(reel, displayRow);
        }
    }

    /** Reset khi spin mới bắt đầu */
    private _onSpinStart(): void {
        this._returnAll();

        // Đảm bảo sprite của tất cả visible symbols được bật lại —
        // tránh trường hợp spine/highlight effect trước đó đã ẩn sprite
        // và chưa kịp restore khi lượt quay mới bắt đầu.
        for (const reel of this.reels) {
            if (!reel) continue;
            for (let i = VISIBLE_ROW_OFFSET; i < VISIBLE_ROW_OFFSET + VISIBLE_ROWS; i++) {
                const symNode = reel.symbolNodes[i];
                if (!symNode) continue;
                const view = symNode.getComponent(SymbolView);
                if (view) view.setSpriteVisible(true);
            }
        }
    }

    /** Cleanup khi bắt đầu feature game (FreeSpin, FreeSpin Gold, TopUp) — trả overlay về pool trước khi vào màn hình Select Feature */
    private _onFeatureStart(): void {
        this._returnAll();
        for (const reel of this.reels) {
            if (!reel) continue;
            for (let i = VISIBLE_ROW_OFFSET; i < VISIBLE_ROW_OFFSET + VISIBLE_ROWS; i++) {
                const symNode = reel.symbolNodes[i];
                if (!symNode) continue;
                const view = symNode.getComponent(SymbolView);
                if (view) view.setSpriteVisible(true);
            }
        }
    }

    /** Cleanup khi kết thúc feature game (FreeSpin, FreeSpin Gold, TopUp) */
    private _onFeatureEnd(): void {
        this._returnAll();
        for (const reel of this.reels) {
            if (!reel) continue;
            for (let i = VISIBLE_ROW_OFFSET; i < VISIBLE_ROW_OFFSET + VISIBLE_ROWS; i++) {
                const symNode = reel.symbolNodes[i];
                if (!symNode) continue;
                const view = symNode.getComponent(SymbolView);
                if (view) view.setSpriteVisible(true);
            }
        }
    }

    // ─── INTERNAL ──────────────────────────────────────────────────────────

    /**
     * Pre-fill pool: instantiate (reels × VISIBLE_ROWS) nodes từ prefab 1 lần duy nhất.
     * Tất cả inactive, parented to this.node (node chứa WaysPayDisplay component).
     */
    private _buildPool(): void {
        if (!this.highlightSpinePrefab) return;

        const count = this.reels.length * VISIBLE_ROWS;
        // log removed

        // Chỉ add thêm node còn thiếu — không bao giờ destroy node đã prebuild
        // Check nếu pool đã đủ từ prebuildPool() thì không build thêm
        if (this._pool.length >= count) {
            // log removed
            return;
        }

        // log removed
        for (let i = this._pool.length; i < count; i++) {
            const node = instantiate(this.highlightSpinePrefab);
            node.active = false;
            this.node.addChild(node);
            this._pool.push(node);
        }

        // log removed
    }

    // ─── POOL BORROW / RETURN ───────────────────────────────────────────

    /**
     * Hiện overlay tại (col, row): mượn node từ pool, parent vào symbolNode,
     * đặt position (0,0,0), bật Spine loop.
     * Nếu ô đó đang có node rồi → không làm gì thêm.
     */
    private _showOverlay(col: number, row: number): void {
        if (this._overlays[col]?.[row]) return; // đang hiện rồi

        const symNode = this.reels[col]?.symbolNodes[row + VISIBLE_ROW_OFFSET];
        if (!symNode) return;

        // FreeSpin: STICKY_YELLOW → green tint thay vì spine overlay
        const view = symNode.getComponent(SymbolView);
        if (this._shouldUseGreenTint(view?.symbolId ?? -1)) return;

        const node = this._pool.pop();
        if (!node) return; // pool cạn (không nên xảy ra với pool size = cols×rows)

        // Đặt node vào đúng vị trí world của symbol,
        // sibling = 0 để highlight nằm dưới symbol spine trong PaylineManager
        node.setWorldPosition(symNode.getWorldPosition());
        node.setSiblingIndex(0);
        node.active = true;

        const skel = node.getComponent(sp.Skeleton);
        if (skel) skel.setAnimation(0, this.highlightSpineAnim, true);

        this._overlays[col][row] = node;
    }

    /**
     * Trả node tại (col, row) về pool:
     * dừng Spine, inactive, reparent về this.node.
     */
    private _shouldUseGreenTint(symId: number): boolean {
        const mode = GameData.instance.currentMode;
        const isFreeSpin = mode === 'freespin' || mode === 'freespin_gold';
        return isFreeSpin && symId === SymbolId.STICKY_YELLOW;
    }

    private _returnOverlay(col: number, row: number): void {
        const node = this._overlays[col]?.[row];
        if (!node || !node.isValid) {
            if (this._overlays[col]) this._overlays[col][row] = null;
            return;
        }

        const skel = node.getComponent(sp.Skeleton);
        if (skel) skel.clearTracks();

        node.active = false;
        if (this.node?.isValid) {
            node.setParent(this.node, false);
            this._pool.push(node);
        }
        this._overlays[col][row] = null;
    }

    /** Trả tất cả node đang active về pool */
    private _returnAll(): void {
        for (let col = 0; col < this._overlays.length; col++) {
            for (let row = 0; row < this._overlays[col].length; row++) {
                this._returnOverlay(col, row);
            }
        }
    }
}
