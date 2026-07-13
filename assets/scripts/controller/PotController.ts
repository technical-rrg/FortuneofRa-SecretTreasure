/**
 * PotController — Quản lý hiển thị hũ Pot (Gold of Fortune) bằng Spine Animation.
 *
 * HŨ CÓ 7 TRẠNG THÁI (Level 0→6) dựa trên PotVisualLevel từ server:
 *   Level 0 : PotVisualLevel = 0 hoặc undefined (mới vào game, chưa có Pot) → idle_LV0
 *   Level 1 : PotVisualLevel = 1            → idle_LV1
 *   Level 2 : PotVisualLevel = 2            → idle_LV2
 *   Level 3 : PotVisualLevel = 3            → idle_LV3
 *   Level 4 : PotVisualLevel = 4            → idle_LV4
 *   Level 5 : PotVisualLevel = 5            → idle_LV5
 *   Level 6 : PotVisualLevel = 6            → idle_LV6
 *
 * SETUP TRONG EDITOR:
 *   1. Tạo Node "Pot" trong scene.
 *   2. Gắn PotController vào Node đó.
 *   3. Node con "Animation" + sp.Skeleton → kéo vào potSpine (KHÔNG gán skeletonData — tránh load Chest 2 lần).
 *      Chest spine thật được Transition handoff vào node Animation sau intro.
 *   4. potSpine vẫn dùng xuyên suốt code (idle, transition, impact…).
 *
 * FLOW:
 *   - WILD_TRAIL_FLY_DONE  → _onFlyDone()   → đọc GameData.potLevel → animate transition
 *   - POT_LEVEL_CHANGED    → _onLevelChanged → transition nếu level khác
 *   - POT_WIN_INTRO        → _onPotWinIntro()→ particle + emit POT_WIN_DONE (level do server)
 *   - Nổ hũ xong (reset)   → level về 0, chạy LV{old}_transition_LV0 → idle_LV0
 *
 * Node gốc PotController = potNode cho WildTrailController.
 * jackpotEffectNode = particle khi nổ hũ.
 */

import {
    _decorator, Component, sp, Node, NodePool, ParticleSystem, instantiate,
} from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { GameData } from '../data/GameData';
import { Log } from '../core/Logger';
import { SoundManager } from '../manager/SoundManager';

const { ccclass, property } = _decorator;

@ccclass('PotController')
export class PotController extends Component {

    // ─── INSPECTOR PROPERTIES ──────────────────────────────────────────────

    @property({
        type: sp.Skeleton,
        tooltip: 'Spine Pot trên node Animation. Prefab để trống skeletonData — Transition handoff chest vào đây.',
    })
    potSpine: sp.Skeleton | null = null;

    @property({ type: Node, tooltip: 'Particle effect node khi Pot win (nổ hũ) — active + play khi POT_WIN_INTRO' })
    jackpotEffectNode: Node | null = null;

    @property({ type: Node, tooltip: 'Node particle effect để clone khi Wild particle trúng Pot — mỗi lần WILD_TRAIL_ONE_HIT sẽ instantiate 1 bản sao' })
    hitParticleNode: Node | null = null;

    @property({ type: Node, tooltip: 'Node particle effect thay thế (10%) khi Wild particle trúng Pot — sẽ instantiate 1 bản sao' })
    hitParticleNode2: Node | null = null;

    @property({ tooltip: 'Delay trước khi emit POT_WIN_DONE sau pot win intro (giây)' })
    winIntroExtraDelay: number = 0.5;

    // ─── INTERNAL ──────────────────────────────────────────────────────────

    private _currentLevel: number = 0;
    private _isTransitioning: boolean = false;
    private _pendingLevel: number | null = null;
    private _gameReady: boolean = false;
    private _wasActiveBeforePickGame: boolean = true;
    /** Chờ TransitionPopup xong rồi mới ẩn Pot */
    private _pendingPickGameHide: boolean = false;
    private _hitParticlePool: NodePool | null = null;
    private _hitParticlePool2: NodePool | null = null;
    private readonly MAX_HIT_POOL_SIZE = 5;
    /** Node "Animation" trên Pot — giữ ref sau khi potSpine trỏ sang chest con. */
    private _animationNode: Node | null = null;

    // ─── LIFECYCLE ─────────────────────────────────────────────────────────

    onLoad(): void {
        const bus = EventBus.instance;
        bus.on(GameEvents.WILD_TRAIL_FLY_DONE,  this._onFlyDone,      this);
        bus.on(GameEvents.WILD_TRAIL_ONE_HIT,   this._onOneHit,        this);
        bus.on(GameEvents.POT_LEVEL_CHANGED,    this._onLevelChanged,  this);
        bus.on(GameEvents.POT_WIN_INTRO,        this._onPotWinIntro,   this);
        bus.on(GameEvents.TRANSITION_DONE,     this._onTransitionDone, this);
        bus.on(GameEvents.FREE_SPIN_END,         this._onFreeSpinEnd,      this);
        bus.on(GameEvents.GAME_READY,            () => { this._gameReady = true; }, this);
        bus.on(GameEvents.PICK_GAME_OPEN,        this._onPickGameOpen,    this);
        bus.on(GameEvents.PICK_GAME_ENTRY_DONE,  this._onPickGameEntryDone, this);
        bus.on(GameEvents.PICK_GAME_CLOSE,       this._onPickGameClose,   this);
        bus.on(GameEvents.TOPUP_TRANSITION_DONE, this._onTopUpTransitionDone, this);
        if (this.potSpine?.node) {
            this._animationNode = this.potSpine.node;
        }
        this._prepareEmptyPotSpine();
        // Tạo pool cho hit particle để tránh instantiate/destroy liên tục
        this._initHitPool(this.hitParticleNode, (pool) => { this._hitParticlePool = pool; });
        this._initHitPool(this.hitParticleNode2, (pool) => { this._hitParticlePool2 = pool; });
    }

    private _initHitPool(prefab: Node | null, setPool: (pool: NodePool) => void): void {
        if (!prefab) return;
        const pool = new NodePool();
        const n = instantiate(prefab);
        n.active = false;
        pool.put(n);
        setPool(pool);
    }

    start(): void {
        const data = GameData.instance;
        this._currentLevel = this._normalizeLevel(data.potLevel);
        // Chỉ _showLevel nếu pot spine đã active (sau TRANSITION_DONE)
        const spine = this._getPotSpine();
        if (spine?.node?.active) {
            this._showLevel(this._currentLevel, false);
        }
        Log.d(`[PotController] start() — visualLevel=${this._currentLevel}, data.potLevel=${data.potLevel}, wildTrailCount=${data.wildTrailCount}`);
    }

    onEnable(): void {
        if (!this._gameReady) return;
        this._activateAnimationNode();
        const spine = this._getPotSpine();
        if (spine?.node && !spine.node.active) {
            spine.node.active = true;
            this._showLevel(this._currentLevel, false);
            Log.d('[PotController] Shown onEnable');
        }
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
        this._clearHitPool(this._hitParticlePool);
        this._clearHitPool(this._hitParticlePool2);
        this._hitParticlePool = null;
        this._hitParticlePool2 = null;
    }

    private _clearHitPool(pool: NodePool | null): void {
        if (!pool) return;
        while (pool.size() > 0) {
            const n = pool.get();
            if (n && n.isValid) n.destroy();
        }
        pool.clear();
    }

    // ─── EVENT HANDLERS ────────────────────────────────────────────────────

    /** WILD_TRAIL_FLY_DONE: tất cả particle đã bay vào hũ → apply pending level */
    private _onFlyDone(): void {
        Log.d(`[PotController] _onFlyDone — _currentLevel=${this._currentLevel}, pending=${this._pendingLevel}`);
        this.unschedule(this._applyPendingLevel);
        if (this._pendingLevel !== null && this._pendingLevel !== this._currentLevel) {
            this._transitionToLevel(this._pendingLevel);
            this._pendingLevel = null;
        }
    }

    /** WILD_TRAIL_ONE_HIT: một particle vừa đến hũ → lấy từ pool + play hit particle + pot impact */
    private _onOneHit(): void {
        const useRare = this.hitParticleNode2 && Math.random() < 0.1;
        const pool = useRare ? this._hitParticlePool2 : this._hitParticlePool;
        const prefab = useRare ? this.hitParticleNode2 : this.hitParticleNode;
        Log.d(`[PotController] _onOneHit — useRare=${useRare}, prefab=${prefab ? 'SET' : 'NULL'}, pool=${pool ? 'SET' : 'NULL'}`);
        if (!prefab || !pool) {
            Log.w('[PotController] hitParticleNode or pool is null — no hit effect');
            return;
        }
        const hitNode = pool.size() > 0 ? pool.get()! : instantiate(prefab);
        Log.d(`[PotController] _onOneHit — got hitNode from pool, isValid=${hitNode?.isValid}`);
        hitNode.setParent(this.node);
        hitNode.setPosition(0, 0, 0);
        hitNode.active = true;
        this._playAllChildParticles(hitNode);
        // Trả về pool sau 1 giây (particle đã chạy xong). Giới hạn pool size = MAX_HIT_POOL_SIZE.
        this.scheduleOnce(() => {
            if (!hitNode.isValid) return;
            hitNode.active = false;
            hitNode.removeFromParent();
            for (const ps of hitNode.getComponentsInChildren(ParticleSystem)) {
                ps.stop();
            }
            if (pool.size() >= this.MAX_HIT_POOL_SIZE) {
                hitNode.destroy();
            } else {
                pool.put(hitNode);
            }
        }, 3.0);

        // ★ Play impact animation trên pot spine theo level hiện tại
        this._playImpact();
    }

    /** Play impact animation Idle_LV{level}_impact rồi quay lại idle */
    private _playImpact(): void {
        const potSpine = this._getPotSpine();
        if (!potSpine || !potSpine.node?.active) return;
        if (this._isTransitioning) return; // đang transition thì skip
        const level = this._currentLevel;
        if (level <= 0) return; // LV0 không có impact
        const animName = `LV${level}_Impact`;
        Log.d(`[PotController] _playImpact — ${animName}`);
        potSpine.setCompleteListener(() => {
            if (this.potSpine) this.potSpine.setCompleteListener(null);
            this._playIdle(this._currentLevel);
        });
        potSpine.timeScale = 1;
        potSpine.setAnimation(0, animName, false);
    }

    /** POT_LEVEL_CHANGED: queue pending level — chờ WILD_TRAIL_FLY_DONE mới transition */
    private _onLevelChanged(payload: { level: number; total: number }): void {
        const newLevel = this._normalizeLevel(payload.level);
        Log.d(`[PotController] _onLevelChanged — visualLevel: ${this._currentLevel} → ${newLevel}, total=${payload.total}`);
        if (newLevel !== this._currentLevel) {
            this._pendingLevel = newLevel;
            Log.d(`[PotController] level ${this._currentLevel} → ${newLevel} queued, waiting for FLY_DONE`);
            // Safety: nếu không có WILD (không có FLY_DONE), apply sau 0.7s
            this.unschedule(this._applyPendingLevel);
            this.scheduleOnce(this._applyPendingLevel, 0.7);
        }
    }

    /** Safety callback: apply pending level nếu FLY_DONE không bao giờ đến (no-WILD case) */
    private _applyPendingLevel(): void {
        if (this._pendingLevel !== null && this._pendingLevel !== this._currentLevel) {
            this._transitionToLevel(this._pendingLevel);
        }
        this._pendingLevel = null;
    }

    /** Node Animation trên Pot — Transition bay chest tới đây. */
    getTransitionTargetNode(): Node | null {
        return this._animationNode ?? this.potSpine?.node ?? null;
    }

    /**
     * Nhận chest spine từ Transition (iconNode) → gán vào potSpine, thay shell rỗng trên Pot.
     */
    adoptChestFromTransition(chestNode: Node): void {
        const anchor = this._animationNode ?? this.potSpine?.node;
        if (!anchor?.isValid || !chestNode?.isValid) {
            Log.w('[PotController] adoptChestFromTransition — thiếu anchor hoặc chestNode');
            return;
        }

        const newSkel = chestNode.getComponent(sp.Skeleton);
        if (!newSkel) {
            Log.w('[PotController] adoptChestFromTransition — chestNode không có sp.Skeleton');
            return;
        }

        // Gỡ shell sp.Skeleton rỗng trên node Animation (không load Chest)
        if (this.potSpine?.isValid && this.potSpine !== newSkel && this.potSpine.node === anchor) {
            this.potSpine.destroy();
        }

        chestNode.setParent(anchor, true);
        chestNode.active = true;
        anchor.active = true;
        this.potSpine = newSkel;

        Log.d('[PotController] adoptChestFromTransition — potSpine wired, Animation active');
    }

    /** TRANSITION_DONE: chest đã handoff → bật Animation + play idle */
    private _onTransitionDone(): void {
        this._activateAnimationNode();
        const spine = this._getPotSpine();
        if (spine?.node) {
            spine.node.active = true;
            this._showLevel(this._currentLevel, false);
        }
        Log.d('[PotController] _onTransitionDone — potSpine ready');
    }

    /** FREE_SPIN_END: feature kết thúc → hiện Pot lại nếu đang ẩn */
    private _onFreeSpinEnd(): void {
        this._activateAnimationNode();
        const spine = this._getPotSpine();
        if (GameData.instance.currentMode === 'normal' && spine?.node && !spine.node.active) {
            spine.node.active = true;
            this._showLevel(this._currentLevel, false);
            Log.d('[PotController] Shown after FreeSpinEnd');
        }
    }

    /** PICK_GAME_OPEN: đánh dấu chờ ẩn Pot sau TransitionPopup */
    private _onPickGameOpen(): void {
        this._wasActiveBeforePickGame = this.node.active;
        this._pendingPickGameHide = true;
        Log.d('[PotController] Pick Game open — Pot hide deferred until transition done');
    }

    /** TOPUP_TRANSITION_DONE: ẩn Pot khi transition Pick Game kết thúc */
    private _onTopUpTransitionDone(): void {
        this._hidePotForPickGameIfPending();
    }

    /** Fallback khi bỏ qua transition (useTopUpTransition=false) */
    private _onPickGameEntryDone(): void {
        this._hidePotForPickGameIfPending();
    }

    private _hidePotForPickGameIfPending(): void {
        if (!this._pendingPickGameHide) return;
        this._pendingPickGameHide = false;
        if (this.node.active) {
            this.node.active = false;
            Log.d('[PotController] Hidden — Pick Game transition done');
        }
    }

    /** PICK_GAME_CLOSE: Pick Game kết thúc → hiện Pot lại */
    private _onPickGameClose(): void {
        this._pendingPickGameHide = false;
        if (this._wasActiveBeforePickGame && !this.node.active) {
            this.node.active = true;
            Log.d('[PotController] Shown — Pick Game close');
        }
    }

    /** POT_WIN_INTRO: server trigger pot win — particle + emit POT_WIN_DONE (không ép LV6, level do server quyết định) */
    private _onPotWinIntro(): void {
        // Không ép animation LV6 — Pot level đã được cập nhật từ server qua POT_LEVEL_CHANGED
        // Active + play jackpot particle effect
        if (this.jackpotEffectNode) {
            this.jackpotEffectNode.active = true;
            for (const ps of this.jackpotEffectNode.getComponentsInChildren(ParticleSystem)) {
                ps.stop(); ps.play();
            }
        }
        this.scheduleOnce(() => {
            // Stop particle trước khi chuyển sang popup
            if (this.jackpotEffectNode) {
                for (const ps of this.jackpotEffectNode.getComponentsInChildren(ParticleSystem)) ps.stop();
                this.jackpotEffectNode.active = false;
            }
            EventBus.instance.emit(GameEvents.POT_WIN_DONE);
        }, this.winIntroExtraDelay);
    }

    // ─── CHEST SPINE (shared from Transition) ───────────────────────────────

    /** Ẩn shell Animation cho đến khi Transition handoff chest. */
    private _prepareEmptyPotSpine(): void {
        const node = this._animationNode ?? this.potSpine?.node;
        if (!node?.isValid) return;
        node.active = false;
    }

    /** Bật node Animation sau Transition / resume. */
    private _activateAnimationNode(): void {
        if (this._animationNode?.isValid) {
            this._animationNode.active = true;
        }
    }

    private _getPotSpine(): sp.Skeleton | null {
        if (this.potSpine?.isValid && this.potSpine.skeletonData) {
            return this.potSpine;
        }
        // Fallback: tìm spine con handoff từ Transition (dưới node Animation)
        const anchor = this._animationNode ?? this.potSpine?.node;
        if (anchor?.isValid) {
            for (const child of anchor.children) {
                const sk = child.getComponent(sp.Skeleton);
                if (sk?.skeletonData) {
                    this.potSpine = sk;
                    return sk;
                }
            }
        }
        return this.potSpine?.isValid ? this.potSpine : null;
    }

    // ─── PRIVATE ───────────────────────────────────────────────────────────

    /**
     * Clamp visual level trong range 0..6.
     * GameManager đã map PotVisualLevel trực tiếp từ server, nên data.potLevel đã là visual level.
     */
    private _normalizeLevel(level: number): number {
        if (level == null || level < 0) return 0;
        return Math.min(6, level);
    }

    /**
     * Transition giữa các level bằng Spine animation.
     *   - Tăng level: chạy "LV{old}_transition_LV{new}" rồi loop idle_LV{new}
     *   - Reset sau nổ hũ (về 0): chạy "LV4_transition_LV0" rồi idle_LV0
     *   - Các trường hợp khác: set idle trực tiếp
     */
    private _transitionToLevel(newLevel: number): void {
        Log.d(`[PotController] _transitionToLevel: ${this._currentLevel} → ${newLevel}`);

        const oldLevel = this._currentLevel;
        const levelChanged = newLevel !== oldLevel;

        if (!this._getPotSpine()) {
            if (levelChanged && newLevel > oldLevel) this._playPotLevelUpSound(newLevel);
            this._currentLevel = newLevel;
            EventBus.instance.emit(GameEvents.POT_TRANSITION_END);
            return;
        }

        const potSpine = this._getPotSpine()!;

        if (!potSpine.node?.active) {
            if (levelChanged && newLevel > oldLevel) this._playPotLevelUpSound(newLevel);
            this._currentLevel = newLevel;
            Log.d(`[PotController] potSpine inactive → skip transition, queued level=${newLevel}`);
            EventBus.instance.emit(GameEvents.POT_TRANSITION_END);
            return;
        }

        if (newLevel > oldLevel) {
            this._playPotLevelUpSound(newLevel);
            const animName = `LV${oldLevel}_trainsition_LV${newLevel}`;
            Log.d(`[PotController] Play transition: ${animName}`);
            this._isTransitioning = true;
            potSpine.setCompleteListener(() => {
                if (this.potSpine) this.potSpine.setCompleteListener(null);
                this._isTransitioning = false;
                this._playIdle(newLevel);
                EventBus.instance.emit(GameEvents.POT_TRANSITION_END);
            });
            potSpine.timeScale = 1;
            potSpine.setAnimation(0, animName, false);
        } else if (newLevel < oldLevel) {
            if (oldLevel > 0 && newLevel === 0) {
                const resetAnim = `LV${oldLevel}_trainsition_LV0`;
                Log.d(`[PotController] Play reset transition: ${resetAnim}`);
                this._isTransitioning = true;
                potSpine.setCompleteListener(() => {
                    if (this.potSpine) this.potSpine.setCompleteListener(null);
                    this._isTransitioning = false;
                    this._playIdle(0);
                    EventBus.instance.emit(GameEvents.POT_TRANSITION_END);
                });
                potSpine.timeScale = 1;
                potSpine.setAnimation(0, resetAnim, false);
            } else {
                this._playIdle(newLevel);
                EventBus.instance.emit(GameEvents.POT_TRANSITION_END);
            }
        } else {
            EventBus.instance.emit(GameEvents.POT_TRANSITION_END);
        }

        this._currentLevel = newLevel;
    }

    /** Play idle animation cho level hiện tại (loop) */
    private _playIdle(level: number): void {
        const potSpine = this._getPotSpine();
        if (!potSpine || !potSpine.node?.active) return;
        const animName = `Idle_LV${level}`;
        potSpine.timeScale = 1;
        potSpine.setAnimation(0, animName, true);
    }

    /** Play pot level-up sound effect synced with the transition animation */
    private _playPotLevelUpSound(level: number): void {
        const snd = SoundManager.instance;
        if (!snd) return;
        if (level === 1 || level === 2) {
            snd.playSfxByName('sxPotEffectLvl2');
        } else if (level === 3) {
            snd.playSfxByName('sxPotEffectLvl3');
        } else if (level === 4) {
            snd.playSfxByName('sxPotEffectLvl4');
        } else if (level === 5) {
            snd.playSfxByName('sxPotEffectLvl5');
        } else if (level >= 6) {
            snd.playSfxByName('sxPotEffectLvl6');
        }
    }

    /** Hiển thị đúng level mà không animate transition (dùng khi init) */
    private _showLevel(level: number, _animate: boolean): void {
        const potSpine = this._getPotSpine();
        if (!potSpine || !potSpine.node?.active) return;
        this._playIdle(level);
    }

    /** Kích hoạt và play lại toàn bộ ParticleSystem trong các node con (kể cả inactive) */
    private _playAllChildParticles(root: Node): void {
        const walk = (node: Node) => {
            const pss = node.getComponents(ParticleSystem);
            if (pss.length > 0) {
                node.active = true;
            }
            for (const ps of pss) {
                ps.stop();
                ps.clear();
                ps.play();
            }
            for (const child of node.children) {
                walk(child);
            }
        };
        walk(root);
    }

}

