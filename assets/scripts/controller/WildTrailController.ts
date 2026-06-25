/**
 * WildTrailController — Hiệu ứng Wild (Bat) symbol khi land trên reel.
 *
 * FLOW (mỗi spin có wildTrailCount > 0):
 *   1. GameManager emit WILD_TRAIL_START { positions, count }
 *   2. Với mỗi vị trí bat:
 *      a. Zoom nhẹ symbol node (scale 1→1.25→1, duration = zoomDuration)
 *      b. Tạo 1 "particle" node bay từ vị trí bat → potNode (duration = flyDuration)
 *   3. Sau khi TẤT CẢ particle đến nơi → emit WILD_TRAIL_FLY_DONE
 *
 * SETUP TRONG EDITOR:
 *   1. Tạo Node trống "WildTrailController" trong scene.
 *   2. Gắn component WildTrailController vào Node đó.
 *   3. Kéo 5 ReelController vào mảng "reels" theo thứ tự 0→4.
 *   4. Kéo Node hũ Pot vào slot "potNode".
 *   5. (Tuỳ chọn) kéo 1 Node sprite dùng làm template particle vào "particleTemplate".
 *      Nếu để trống → dùng hình chữ nhật vàng 20×20 tự tạo.
 *
 * LƯU Ý:
 *   - symbolNodes[2+(2-gridRow)] = node tương ứng gridRow (vì displayRow = 2 - gridRow,
 *     nodeIndex = 2 + displayRow = 2 + (2 - gridRow) = 4 - gridRow).
 *   - Sau này: thay zoom bằng spine animation trên symbol node.
 *   - Sau này: thay particle node bằng particle system / spine hiệu ứng bay.
 */

import {
    _decorator, Component, Node, Vec3, tween, Tween,
    UITransform, Color, Graphics, instantiate, sp,
    ParticleSystem,
} from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { ReelController } from './ReelController';
import { SymbolView } from './SymbolView';
import { Log } from '../core/Logger';
import { AutoSpinManager, SpeedMode } from '../manager/AutoSpinManager';
import { SymbolHighlighter } from './SymbolHighlighter';
import { SymbolId } from '../data/SlotTypes';

const { ccclass, property } = _decorator;

export interface WildTrailPayload {
    positions: Array<{ reel: number; row: number }>;
    count: number;
}

@ccclass('WildTrailController')
export class WildTrailController extends Component {

    /** Danh sách spine nodes đang active — dùng để cleanup khi spin mới.
     *  Mỗi entry lưu cả spineNode và symbolNode gốc (để restore sprite khi spine được reparent ra ngoài reel). */
    private _spawnedSpineNodes: Array<{ spineNode: Node; symbolNode: Node }> = [];

    /** Pool spine nodes */
    private _spinePool: Node[] = [];
    private readonly _spinePoolSize: number = 5;

    /** Số particle đang bay — khi về 0 emit WILD_TRAIL_FLY_DONE */
    private _flyingCount: number = 0;

    /** Tham chiếu tới SymbolHighlighter để lấy offset Y cho Wild spine (spineLocalPosY[WILD]). */
    private _symbolHighlighter: SymbolHighlighter | null = null;

    // ─── INSPECTOR PROPERTIES ──────────────────────────────────────────────

    @property({
        type: [ReelController],
        tooltip: '5 ReelController theo thứ tự reel 0→4\n(kéo từ SlotMachine node trong Hierarchy)',
    })
    reels: ReelController[] = [];

    @property({
        type: Node,
        tooltip: 'Node đại diện cho hũ Pot — particle sẽ bay đến WorldPosition của node này.\n'
               + 'Có thể là node trung tâm của PotController.',
    })
    potNode: Node | null = null;

    @property({
        type: Node,
        tooltip: '(Tuỳ chọn) Template node cho particle bay.\n'
               + 'Nếu để trống → tạo hình vuông vàng 20×20 bằng Graphics.\n'
               + 'Template nên là Node inactive với Sprite component sẵn.',
    })
    particleTemplate: Node | null = null;

    @property({ tooltip: 'Thời gian zoom symbol bat: scale 1→1.25→1 (giây)' })
    zoomDuration: number = 0.15;

    @property({ tooltip: 'Thời gian particle bay từ bat đến hũ (giây)' })
    flyDuration: number = 0.85;

    @property({ tooltip: 'Tên Spine animation phát khi wild trail bay ra (mặc định: Impact).' })
    wildTrailAnimName: string = 'Impact';

    @property({
        type: Node,
        tooltip: 'Spine prefab để clone vào symbol node khi wild trail bay ra.\n'
               + 'Node inactive với sp.Skeleton component gắn sẵn.',
    })
    spinePrefab: Node | null = null;

    @property({
        tooltip: 'Độ cong đường bay Bezier (tỉ lệ so với khoảng cách).\n'
               + 'Giá trị 0.3–0.5 tạo arc nhẹ, 0.6–1.0 cong rõ rệt.\n'
               + 'Số dương: bay cong sang phải/lên. Số âm: cong trái/xuống.',
        range: [-1.5, 1.5, 0.05],
    })
    flyCurvature: number = 0.45;

    // ─── LIFECYCLE ─────────────────────────────────────────────────────────

    onLoad(): void {
        const bus = EventBus.instance;
        bus.on(GameEvents.WILD_TRAIL_ONE, this._onWildTrailOne, this);
        bus.on(GameEvents.REELS_START_SPIN, this._onReelsStartSpin, this);
        // Cleanup spine khi vào feature mode / feature select — đảm bảo Wild effect không còn hiển thị
        bus.on(GameEvents.FREE_SPIN_START,      this._onFeatureGameStart, this);
        bus.on(GameEvents.FREE_SPIN_GOLD_START, this._onFeatureGameStart, this);
        bus.on(GameEvents.TOPUP_START,           this._onFeatureGameStart, this);
        bus.on(GameEvents.FEATURE_SELECT_OPEN, this._onFeatureGameStart, this);
        bus.on(GameEvents.CREDIT_FLY_IN_START,  this._onFeatureGameStart, this);
        this._buildSpinePool();

        // Tìm SymbolHighlighter trong scene (nếu có) để dùng chung offset Y cho Wild
        try {
            this._symbolHighlighter = this.node.scene?.getComponentInChildren(SymbolHighlighter) ?? null;
        } catch (_e) {
            this._symbolHighlighter = null;
        }
    }

    /** Vào Feature Mode → return toàn bộ spine nodes về pool ngay lập tức */
    private _onFeatureGameStart(): void {
        this._returnAllSpawnedSpines();
    }

    private _buildSpinePool(): void {
        if (!this.spinePrefab || this._spinePool.length > 0) return;
        for (let i = 0; i < this._spinePoolSize; i++) {
            const n = instantiate(this.spinePrefab);
            n.name = `WildSpine_${i}`;
            n.active = false;
            n.setParent(this.node);
            this._spinePool.push(n);
        }
    }

    private _borrowSpine(): Node | null {
        while (this._spinePool.length > 0) {
            const n = this._spinePool.pop()!;
            if (n.isValid) return n;
        }
        if (this.spinePrefab) {
            Log.w('[WildTrail] spinePool exhausted — instantiate fallback');
            return instantiate(this.spinePrefab);
        }
        Log.w('[WildTrail] spinePool exhausted & no prefab');
        return null;
    }

    /** Tốc độ bay theo AutoSpin speed mode — Quick/Turbo nhanh hơn */
    private _getSpeedMultiplier(): number {
        switch (AutoSpinManager.instance.speedMode) {
            case SpeedMode.TURBO: return 0.5;
            case SpeedMode.QUICK: return 0.75;
            default:              return 1.0;
        }
    }

    private _returnSpine(n: Node): void {
        if (!n || !n.isValid) return;
        Tween.stopAllByTarget(n);
        const skel = n.getComponent(sp.Skeleton);
        if (skel) {
            skel.setCompleteListener(null);
            skel.clearTracks();
            skel.timeScale = 1;
        }
        n.active = false;
        n.setParent(this.node);
        n.setPosition(0, 0, 0);
        n.setScale(1, 1, 1);
        n.setRotationFromEuler(0, 0, 0);
        if (!this._spinePool.includes(n)) {
            this._spinePool.push(n);
        }
    }

    private _playParticlesFromStart(root: Node): void {
        const particles = root.getComponentsInChildren(ParticleSystem);
        for (const ps of particles) {
            ps.stop();
            const maybeClear = (ps as unknown as { clear?: () => void }).clear;
            if (maybeClear) maybeClear.call(ps);
            ps.play();
        }
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
        this._returnAllSpawnedSpines();
    }

    /** Spin mới bắt đầu → return tất cả spine nodes về pool */
    private _onReelsStartSpin(): void {
        this._flyingCount = 0;
        this._returnAllSpawnedSpines();
    }

    /** Return toàn bộ spine nodes đang active về pool */
    private _returnAllSpawnedSpines(): void {
        for (const entry of this._spawnedSpineNodes) {
            if (!entry) continue;
            const { spineNode, symbolNode } = entry;
            if (spineNode && spineNode.isValid) {
                if (symbolNode && symbolNode.isValid) {
                    const view = symbolNode.getComponent(SymbolView);
                    if (view) view.setSpriteVisible(true);
                }
                this._returnSpine(spineNode);
            }
        }
        this._spawnedSpineNodes.length = 0;
    }

    /** Return spine nodes clone cũ trên 1 symbolNode về pool trước khi spawn mới */
    private _cleanupSpineOnNode(symbolNode: Node): void {
        for (let i = this._spawnedSpineNodes.length - 1; i >= 0; i--) {
            const entry = this._spawnedSpineNodes[i];
            if (!entry) {
                this._spawnedSpineNodes.splice(i, 1);
                continue;
            }
            const { spineNode, symbolNode: origSym } = entry;
            if (!spineNode || !spineNode.isValid) {
                this._spawnedSpineNodes.splice(i, 1);
                continue;
            }
            if (origSym === symbolNode) {
                const view = symbolNode.getComponent(SymbolView);
                if (view) view.setSpriteVisible(true);
                this._returnSpine(spineNode);
                this._spawnedSpineNodes.splice(i, 1);
            }
        }
    }

    // ─── EVENT HANDLERS ──────────────────────────────────────────────────────────────────────

    /**
     * WILD_TRAIL_ONE: một reel dừng với Wild → bay con dơi đó vào hũ ngay lập tức.
     * Tăng _flyingCount, khi particle đến nơi giảm lại; nếu về 0 emit WILD_TRAIL_FLY_DONE.
     */
    private _releaseSpawnedSpine(spineNode: Node, symbolNode: Node): void {
        const idx = this._spawnedSpineNodes.findIndex(e => e?.spineNode === spineNode);
        if (idx >= 0) this._spawnedSpineNodes.splice(idx, 1);

        if (symbolNode?.isValid) {
            const view = symbolNode.getComponent(SymbolView);
            if (view) view.setSpriteVisible(true);
        }

        this._returnSpine(spineNode);
    }

    private _onWildTrailOne(payload: { reel: number; row: number }): void {
        const { reel, row } = payload;
        const nodeIdx    = 4 - row; // displayRow = 2 - gridRow, nodeIndex = 2 + displayRow
        const symbolNode = this.reels[reel]?.symbolNodes[nodeIdx];
        if (!symbolNode) return;

        const tryStart = () => {
            this._flyingCount++;
            // Hit & fly-done are now handled internally at particle landing time
            this._animateOne(symbolNode, () => { /* no-op: kept for cleanup sync */ });
        };

        // Nếu reel chưa settled (đang decel/bounce), đợi 'reel-settled' rồi mới bắn trail.
        // Giảm hiện tượng thấy effect bay ra khi reel còn đang quay nhanh (đặc biệt Turbo).
        const reelCtrl = this.reels[reel];
        const isIdle = !!reelCtrl && (reelCtrl as any).isIdle === true;
        if (!isIdle) {
            symbolNode.once('reel-settled', () => {
                if (symbolNode && symbolNode.isValid) tryStart();
            });
        } else {
            tryStart();
        }
    }

    // ─── PRIVATE ───────────────────────────────────────────────────────────

    /**
     * Zoom nhẹ symbol node rồi spawn particle bay đến potNode.
     * Gọi onDone() khi cả Impact spine và particle đều đã xong.
     * Impact là one-shot: animation xong phải return spine về pool và bật lại sprite Wild.
     */
    private _animateOne(symbolNode: Node, onDone: () => void): void {
        let impactDone = !this.spinePrefab;
        let flyDone = false;
        let done = false;
        const tryDone = () => {
            if (done || !impactDone || !flyDone) return;
            done = true;
            onDone();
        };
        // Emit hit immediately at particle landing (do not wait for impact animation)
        const onLand = () => {
            EventBus.instance.emit(GameEvents.WILD_TRAIL_ONE_HIT);
            this._flyingCount--;
            if (this._flyingCount <= 0) {
                this._flyingCount = 0;
                EventBus.instance.emit(GameEvents.WILD_TRAIL_FLY_DONE);
            }
        };
        // 1. Clone spine prefab vào symbol node, play animation one-shot.
        if (this.spinePrefab) {
            const view = symbolNode.getComponent(SymbolView);
            if (view) view.setSpriteVisible(false);

            // Xóa spine cũ trên cùng symbol trước khi spawn mới
            this._cleanupSpineOnNode(symbolNode);

            const spineNode = this._borrowSpine();
            if (!spineNode) {
                if (view) view.setSpriteVisible(true);
                impactDone = true;
            }
            if (spineNode) {
                // Anchor Impact spine trực tiếp vào symbolNode để giữ trong mask của reel,
                // tránh cảm giác "bay ra sớm" khi các reel khác còn đang quay (đặc biệt ở Turbo).
                // Đặt sibling index cao nhất trong symbolNode để nằm trên sprite symbol.
                spineNode.setParent(symbolNode, false);
                spineNode.setSiblingIndex(symbolNode.children.length - 1);
                // Áp dụng offset Y giống SymbolHighlighter.spineLocalPosY cho Wild (nếu có set)
                let yOffset = 0;
                const hi = this._symbolHighlighter;
                if (hi && Array.isArray(hi.spineLocalPosY)) {
                    const v = hi.spineLocalPosY[SymbolId.WILD];
                    if (typeof v === 'number' && isFinite(v)) yOffset = v;
                }
                spineNode.setPosition(0, yOffset, 0);
                spineNode.active = true;
                this._spawnedSpineNodes.push({ spineNode, symbolNode });

                const skel = spineNode.getComponent(sp.Skeleton);
                if (skel) {
                    skel.timeScale = 1;
                    skel.clearTrack(0);
                    skel.setCompleteListener(null);
                    skel.setAnimation(0, this.wildTrailAnimName, false);
                    skel.setCompleteListener(() => {
                        if (!spineNode.isValid) return;
                        skel.setCompleteListener(null);
                        this._releaseSpawnedSpine(spineNode, symbolNode);
                        impactDone = true;
                        tryDone();
                    });
                } else {
                    // Không có skeleton → return pool, bật sprite lại
                    this._returnSpine(spineNode);
                    const idx = this._spawnedSpineNodes.findIndex(e => e?.spineNode === spineNode);
                    if (idx >= 0) this._spawnedSpineNodes.splice(idx, 1);
                    if (view) view.setSpriteVisible(true);
                    impactDone = true;
                }
            }
        } else {
            Log.w(`[WildTrail] spinePrefab chưa set — fallback to scale bounce on ${symbolNode.name}`);
            // Fallback: scale bounce nếu không có spine prefab
            const mul = this._getSpeedMultiplier();
            const baseScale = symbolNode.scale.clone();
            const s = baseScale.x;
            Tween.stopAllByTarget(symbolNode);
            tween(symbolNode)
                .to(0.25 * mul, { scale: new Vec3(s * 1.12, s * 1.12, 1) }, { easing: 'backOut' })
                .to(0.20 * mul, { scale: new Vec3(s * 0.95, s * 0.95, 1) }, { easing: 'sineInOut' })
                .to(0.15 * mul, { scale: baseScale },                       { easing: 'sineOut' })
                .call(() => {
                    impactDone = true;
                    tryDone();
                })
                .start();
        }

        // 2. Tạo particle và bay đến pot
        const speedMul = this._getSpeedMultiplier();
        if (!this.potNode) {
            // Không có potNode → chỉ zoom, coi như xong sau zoom
            this.scheduleOnce(() => {
                flyDone = true;
                // Consider as landed even without pot to keep flow consistent
                onLand();
                tryDone();
            }, 0.65 * speedMul);
            return;
        }

        const particle = this._spawnParticle();
        if (!particle) {
            this.scheduleOnce(() => {
                flyDone = true;
                onLand();
                tryDone();
            }, 0.65 * speedMul);
            return;
        }

        // Đặt particle vào cùng layer với WildTrailController (phải nằm dưới Canvas để render)
        this.node.addChild(particle);
        particle.active = true;
        this._playParticlesFromStart(particle);

        // Vị trí bắt đầu = world pos của symbol node
        const startWorld = new Vec3();
        symbolNode.getWorldPosition(startWorld);
        particle.setWorldPosition(startWorld);

        // Vị trí đích = world pos của potNode
        const endWorld = new Vec3();
        this.potNode.getWorldPosition(endWorld);

        // ── Bezier curve: tính control point tạo đường cong ──
        const midX = (startWorld.x + endWorld.x) * 0.5;
        const midY = (startWorld.y + endWorld.y) * 0.5;
        const dx = endWorld.x - startWorld.x;
        const dy = endWorld.y - startWorld.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / dist;
        const ny =  dx / dist;
        const offset = dist * this.flyCurvature;
        const cpX = midX + nx * offset;
        const cpY = midY + ny * offset;

        // Custom easing: nhanh ra từ nguồn → giảm tốc nhẹ về giữa (vẫn > 0) → tăng tốc về đích
        // position(t) = t + a*sin(2πt)/(2π)  →  v(t) = 1 + a*cos(2πt)
        // v(0)=v(1)=1+a, v(0.5)=1-a. Chọn a=0.45 để giảm tốc rõ nhưng không dừng hẳn.
        const a = 0.45;
        const easeOutIn = (t: number): number => t + a * Math.sin(2 * Math.PI * t) / (2 * Math.PI);

        const proxy = { t: 0 };
        const updateParticlePos = (t: number) => {
            if (!particle || !particle.isValid) return;
            const inv = 1 - t;
            const bx = inv * inv * startWorld.x + 2 * inv * t * cpX + t * t * endWorld.x;
            const by = inv * inv * startWorld.y + 2 * inv * t * cpY + t * t * endWorld.y;
            particle.setWorldPosition(new Vec3(bx, by, 0));
            particle.setScale(1 - t * 0.4, 1 - t * 0.4, 1);
        };

        const flyDur = this.flyDuration * this._getSpeedMultiplier();
        tween(proxy)
            .to(flyDur, { t: 1 }, { easing: easeOutIn,
                onUpdate: () => updateParticlePos(proxy.t),
            })
            .call(() => {
                particle.destroy();
                flyDone = true;
                onLand();
                tryDone();
            })
            .start();
    }

    /**
     * Tạo particle node:
     *   - Nếu có template → clone nó.
     *   - Nếu không → tạo node với Graphics vẽ hình tròn vàng (placeholder).
     */
    private _spawnParticle(): Node | null {
        if (this.particleTemplate) {
            const clone = instantiate(this.particleTemplate);
            clone.active = false;
            return clone;
        }

        // Placeholder: hình tròn vàng 18px radius bằng Graphics
        const node = new Node('WildParticle');
        const tf   = node.addComponent(UITransform);
        tf.setContentSize(36, 36);

        const g = node.addComponent(Graphics);
        g.fillColor = new Color(255, 220, 0, 230);
        g.circle(0, 0, 14);
        g.fill();

        // Viền nhỏ
        g.strokeColor = new Color(255, 255, 255, 180);
        g.lineWidth = 2;
        g.circle(0, 0, 14);
        g.stroke();

        return node;
    }

    /**
     * Kiểm tra xem node hoặc bất kỳ descendant nào còn sp.Skeleton active không.
     * Dùng để quyết định có bật sprite lại sau khi wild trail animation xong.
     */
    private _hasSpineOnNode(node: Node): boolean {
        if (node.getComponent(sp.Skeleton)) return true;
        for (const child of node.children) {
            if (this._hasSpineOnNode(child)) return true;
        }
        return false;
    }
}
