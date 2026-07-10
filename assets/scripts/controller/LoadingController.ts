/**
 * LoadingController - Màn hình tải game (Loading View).
 *
 * ★ PREFAB MODE (khuyến nghị cho super-html build — tránh mất font khi chuyển scene):
 *   1. Trong Cocos Editor, mở scene.scene → chọn tất cả children của Canvas
 *      (KHÔNG bao gồm Canvas node chính) → chuột phải → "Create Prefab from Selection"
 *      → lưu vào assets/prefabs/GameScene.prefab (trong assets folder để dùng resources.load)
 *   2. Điền "gamePrefabPath" = "prefabs/GameScene" (không cần .prefab extension)
 *   3. (Tuỳ chọn) Gắn Canvas node của loading.scene vào slot "Game Container"
 *   4. Bật handleServerLogin = true, xoá targetScene, tắt useScenePreload
 *   
 *   LỢI THẾ: Prefab KHÔNG được preload khi mở scene, chỉ load khi cần
 *           → tránh loading lâu ở lúc mở scene, và font không bị mất.
 *
 * ★ TWO-SCENE MODE (legacy):
 *   - Điền targetScene, bật useScenePreload, bật handleServerLogin
 *
 * Flow:
 *   start() → animate loading bar song song với Login+Enter server
 *   Khi bar ĐẦY và login xong → fade out → load + instantiate gamePrefab (prefab mode)
 *                                         HOẶC director.loadScene (two-scene mode)
 *                                         HOẶC emit LOADING_COMPLETE (single-scene mode)
 */

import { _decorator, Component, Node, ProgressBar, UIOpacity, tween, Tween, Vec3, Label, director, instantiate, assetManager, AssetManager, Prefab, game, UITransform, view } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { L } from '../core/LocalizationManager';
import { NetworkManager } from '../manager/NetworkManager';
import { WalletManager } from '../manager/WalletManager';
import { GameData } from '../data/GameData';
import { USE_REAL_API, ServerConfig } from '../data/ServerConfig';
import { CdnAssetManager } from '../core/CdnAssetManager';
import { LocalizationManager } from '../core/LocalizationManager';
import { FontManager } from '../manager/FontManager';
import { Log } from '../core/Logger';
import { SlotMachineController } from './SlotMachineController';

const { ccclass, property } = _decorator;

@ccclass('LoadingController')
export class LoadingController extends Component {

    @property({ type: Node, tooltip: 'Logo node của nhà phát triển (sẽ có hiệu ứng nhịp thở)' })
    logoNode: Node | null = null;

    @property({ type: ProgressBar, tooltip: 'Thanh loading bar (ProgressBar component)' })
    loadingBar: ProgressBar | null = null;

    @property({ type: UIOpacity, tooltip: 'UIOpacity của LoadingView để fade-out khi xong' })
    uiOpacity: UIOpacity | null = null;

    @property({ tooltip: 'Thời gian hiển thị 1% ban đầu (giây) — bar nhanh tới 1%, rồi tải prefab ngay' })
    loadingDuration: number = 0.05;

    @property({ type: Label, tooltip: 'Note' })
    noteLabel: Label | null = null;

    // ─── TWO-SCENE LOADING MODE ───

    @property({
        tooltip: '[Two-scene mode] Tên scene game sẽ preload và chuyển sang (vd: "game").\n' +
                 'Để trống = chế độ một scene (LoadingController chỉ fade-out rồi emit LOADING_COMPLETE).'
    })
    targetScene: string = '';

    @property({
        tooltip: '[Two-scene mode] Khi true: dùng director.preloadScene() thay vì fake timer.\n' +
                 'Thanh loading sẽ phản ánh tiến độ tải asset thực tế (0→90%).\n' +
                 'Yêu cầu targetScene được điền.'
    })
    useScenePreload: boolean = false;

    @property({
        tooltip: '[Two-scene mode] Khi true: LoadingController tự gọi Login+Enter ở đây,\n' +
                 'không cần GameManager. Kết quả được lưu vào GameData để game scene đọc.\n' +
                 'Dùng khi loading.scene không có GameManager component.'
    })
    handleServerLogin: boolean = false;

    // ─── PREFAB MODE ───

    @property({
        tooltip: '[Prefab mode] Tên AssetBundle chứa prefab (vd: "prefabs").\n' +
                 'Phải khớp với tên bundle được đánh dấu isBundle trong Cocos Editor.',
    })
    gameBundleName: string = 'prefabs';

    @property({
        tooltip: '[Prefab mode] Tên prefab bên trong bundle (vd: "GameScene", không cần .prefab extension).\n' +
                 'Nếu set, LoadingController load bundle rồi instantiate prefab vào cùng scene.\n' +
                 'Hoạt động ở cả editor preview lẫn web build.\n' +
                 'Font sẽ không bị mất khi game start.\n' +
                 'Ưu tiên cao hơn targetScene khi cả hai đều được set.',
    })
    gamePrefabPath: string = '';

    @property({
        type: Node,
        tooltip: '[Prefab mode] Node parent để gắn gamePrefab vào.\n' +
                 'Thường là Canvas của loading.scene.\n' +
                 'Để trống = dùng scene root (director.getScene()).'
    })
    gameContainer: Node | null = null;

    @property({
        tooltip: '[Prefab mode] Phần trăm (0-1) khi bắt đầu load prefab ngay (mặc định 0.01 = 1%).\n' +
                 'Ví dụ: 0.01 = 1%, 0.05 = 5%'
    })
    prefabLoadPercent: number = 0.01;

    @property({
        tooltip: '[Prefab mode] Phần trăm (0-1) khi bar bắt đầu animate mượt mà sau khi prefab load xong (mặc định 0.02 = 2%).\n' +
                 'Ví dụ: 0.02 = 2%, 0.05 = 5%'
    })
    barFillStartPercent: number = 0.02;

    // ─── THREE-PHASE LOADING ───

    @property({
        tooltip: '[Three-phase] Bar dừng tại đây sau khi Login + CDN xong. (0-1, mặc định 0.33 = 33%)'
    })
    phaseLoginEnd: number = 0.33;

    @property({
        tooltip: '[Three-phase] Bar dừng tại đây sau khi load AssetBundle xong. (0-1, mặc định 0.66 = 66%)'
    })
    phaseBundleEnd: number = 0.66;

    @property({
        tooltip: '[Three-phase] Bar crawl tới đây (0-1) TRƯỚC khi load Base prefab. Mặc định 0.99 = 99%'
    })
    prePrefabBarEnd: number = 1;

    @property({
        tooltip: '[Three-phase] Giây crawl tối đa mỗi phase (bar luôn nhúc nhích dù operation chậm). Mặc định 10s'
    })
    phaseCrawlSecs: number = 10;

    private _elapsed: number = 0;
    private _loadCb: (() => void) | null = null;
    /** Bar đã tới 1% (fake timer xong) - bắt đầu load prefab */
    private _barDone: boolean = false;
    /** Server đã trả ENTER_SUCCESS hoặc login done internally chưa */
    private _serverReady: boolean = false;
    /** 0→1%: Fake timer, 1%: Load prefab, 2→100%: Animate */
    private _preloadDone: boolean = false;
    /** Prefab đã load xong từ resources (prefab mode) */
    private _prefabReady: boolean = false;
    /** Prefab asset đã load — dùng để instantiate ngay lập tức khi bar 100% */
    private _loadedPrefab: any = null;
    /** Bar đã animate từ 2% tới 100% chưa */
    private _animatingToFull: boolean = false;
    /** Symbols đã apply và GPU đã xử lý xong textures */
    private _heavyInitDone: boolean = false;
    /** Đã gọi applyInitialSymbols — tránh double-apply từ ENTER_SUCCESS race */
    private _symbolsApplied: boolean = false;
    /** Node đã instantiate và ẩn sẵn — chỉ cần active=true khi bar 100% */
    private _instantiatedGameNode: Node | null = null;

    /** Promise load font sớm từ onLoad() — để _loadCdnAssets() await thay vì tải lại */
    private _earlyFontPromise: Promise<import('cc').TTFFont | null> | null = null;
    /** CDN kick-off sớm từ onLoad — không block bundle/prefab */
    private _cdnPromise: Promise<void> | null = null;
    /** Bundle kick-off sớm — chạy song song với login */
    private _bundlePromise: Promise<AssetManager.Bundle | null> | null = null;
    /** Guard: tránh fill bar 100% nhiều lần */
    private _fillStarted: boolean = false;

    /** Guard: _onLoadComplete đã chạy một lần rồi, không chạy lại */
    private _completed: boolean = false;

    /** HTML overlay sync: PNG bám node Logo, GIF bám node Logo2 trong loading.scene */
    private _htmlLogoNode: Node | null = null;
    private _htmlLogo2Node: Node | null = null;
    /** Flag: HTML overlay đã ẩn — ngăn _syncHtmlLoadingOverlay chạy lại */
    private _htmlOverlayHidden: boolean = false;
    /** ResizeObserver trên GameCanvas để sync overlay ngay khi canvas thay đổi kích thước */
    private _canvasResizeObserver: ResizeObserver | null = null;

    // ─── LIFECYCLE ───

    onLoad(): void {
        // ★ Khởi tạo ngôn ngữ sớm nhất có thể — trước khi bất kỳ Label nào render.
        //   Đọc DEV_FORCE_LANG (từ ServerConfig) hoặc localStorage 'supernova_lang'.
        LocalizationManager.instance.loadSavedLanguage();

        // ★ Bật log tag cho StickyAccumulated / StickyEarned debug — trước cả login/enter.
        Log.enable('featuregauge');

        // ★ Bắt đầu tải font + CDN + MainBundle ngay — song song với login ở start().
        this._earlyLoadFont();
        this._cdnPromise = this._loadCdnAssets().catch((err) => {
            Log.w('[LoadingController] Early CDN load failed (non-blocking):', err);
        });
        if (this.gameBundleName) {
            this._bundlePromise = this._loadBundleAsync().catch((err) => {
                Log.e('[LoadingController] Early bundle load failed:', err);
                return null;
            });
        }

        // Lắng nghe ENTER_SUCCESS từ server (hoặc mock) — điều kiện để unlock LOADING_COMPLETE
        EventBus.instance.on(GameEvents.ENTER_SUCCESS, this._onServerReady, this);
        if (this.noteLabel) {
          //  this.noteLabel.string = L('UI_START_LOADING_1');
        }

            if (typeof document !== 'undefined') {
                    document.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'hidden') {
                            // Resume ngay để engine không dừng game loop
                            game.resume();
                        }
                    });
                }
        view.on('canvas-resize', this._syncHtmlLoadingOverlay, this);

        // ★ ResizeObserver trên GameCanvas: phát hiện thay đổi kích thước DOM sớm hơn canvas-resize
        if (typeof document !== 'undefined' && typeof ResizeObserver !== 'undefined') {
            const canvas = document.getElementById('GameCanvas');
            if (canvas) {
                this._canvasResizeObserver = new ResizeObserver(() => {
                    this._syncHtmlLoadingOverlay();
                });
                this._canvasResizeObserver.observe(canvas);
            }
        }
    }

    start(): void {
        // Two-scene mode: nếu đã login xong ở loading.scene thì bỏ qua toàn bộ.
        // GameManager (isGameScene=true) sẽ emit LOADING_COMPLETE sau khi guide.
        if (GameData.instance.isEntered) {
            this.node.active = false;
            return;
        }

        if (this.loadingBar) this.loadingBar.progress = 0;
        if (this.uiOpacity) this.uiOpacity.opacity = 255;

        // Logo: hiệu ứng nhịp thở nhẹ
        if (this.logoNode) {
            tween(this.logoNode)
                .to(0.9, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'sineInOut' })
                .to(0.9, { scale: new Vec3(1.00, 1.00, 1) }, { easing: 'sineInOut' })
                .union()
                .repeatForever()
                .start();
        }

        this._resolveHtmlOverlayNodes();
        // ★ Defer sang frame tiếp theo để canvas kích thước ổn định (đặc biệt portrait mobile)
        this.scheduleOnce(() => this._syncHtmlLoadingOverlay(), 0);

        this._startLoadingBar();
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
        view.off('canvas-resize', this._syncHtmlLoadingOverlay, this);
        if (this._canvasResizeObserver) {
            this._canvasResizeObserver.disconnect();
            this._canvasResizeObserver = null;
        }
        if (this._loadCb) {
            this.unschedule(this._loadCb);
            this._loadCb = null;
        }
    }

    private _resolveHtmlOverlayNodes(): void {
        if (!this._htmlLogoNode?.isValid) {
            this._htmlLogoNode = this._findNodeByName(this.node, 'Logo');
        }
        if (!this._htmlLogo2Node?.isValid) {
            this._htmlLogo2Node = this._findNodeByName(this.node, 'Logo2');
        }
    }

    private _findNodeByName(root: Node | null, name: string): Node | null {
        if (!root) return null;
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = this._findNodeByName(child, name);
            if (found) return found;
        }
        return null;
    }

    private _syncHtmlLoadingOverlay(): void {
        if (this._htmlOverlayHidden) return;
        if (typeof document === 'undefined') return;
        const overlay = document.getElementById('sn-loading-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;

        this._resolveHtmlOverlayNodes();
        this._applyHtmlImageToNode('sn-loading-logo', this._htmlLogoNode);
        this._applyHtmlImageToNode('sn-loading-gif', this._htmlLogo2Node, 1.5);
    }

    private _applyHtmlImageToNode(elementId: string, targetNode: Node | null, scale: number = 1): void {
        if (typeof document === 'undefined' || !targetNode?.activeInHierarchy) return;

        const element = document.getElementById(elementId) as HTMLElement | null;
        const canvas = document.getElementById('GameCanvas') as HTMLCanvasElement | null;
        const transform = targetNode.getComponent(UITransform);
        if (!element || !canvas || !transform) return;

        const canvasRect = canvas.getBoundingClientRect();
        const visibleSize = view.getVisibleSize();
        if (canvasRect.width <= 0 || canvasRect.height <= 0 || visibleSize.width <= 0 || visibleSize.height <= 0) return;

        const worldRect = transform.getBoundingBoxToWorld();
        const centerX = worldRect.x + worldRect.width * 0.5;
        const centerY = worldRect.y + worldRect.height * 0.5;

        const cssLeft = canvasRect.left + centerX / visibleSize.width * canvasRect.width;
        const cssTop = canvasRect.top + (1 - centerY / visibleSize.height) * canvasRect.height;
        const cssWidth = worldRect.width / visibleSize.width * canvasRect.width * scale;
        const cssHeight = worldRect.height / visibleSize.height * canvasRect.height * scale;

        element.style.position = 'fixed';
        element.style.left = `${cssLeft}px`;
        element.style.top = `${cssTop}px`;
        element.style.width = `${cssWidth}px`;
        element.style.height = `${cssHeight}px`;
        element.style.maxWidth = 'none';
        element.style.maxHeight = 'none';
        element.style.transform = 'translate(-50%, -50%)';
        element.style.objectFit = 'contain';
        element.style.transition = 'opacity 0.3s ease';
        element.style.opacity = '1';
    }

    private _hideHtmlOverlay(): void {
        if (this._htmlOverlayHidden) return;
        this._htmlOverlayHidden = true;
        try { (window as any).snHideLoadingOverlay?.(); } catch (_) {}
        view.off('canvas-resize', this._syncHtmlLoadingOverlay, this);
    }

    // ─── SERVER READY (single-scene mode) ───

    private _onServerReady(): void {
        this._serverReady = true;
        // ENTER_SUCCESS đã fire → real data sẵn sàng → áp vào symbols ngay
        this._applySymbolsIfReady();
        if (this._barDone) {
            this._tryFillToFull();
        }
    }

    /**
     * Gọi applyInitialSymbols() khi CẢ prefab đã instantiate VÀ ENTER_SUCCESS đã fire.
     * Đánh dấu heavy init xong ngay frame sau (không chờ delay cứng).
     */
    private _applySymbolsIfReady(): void {
        if (!this._instantiatedGameNode || this._heavyInitDone || this._symbolsApplied || !this._serverReady) return;
        this._symbolsApplied = true;

        const smc = this._instantiatedGameNode.getComponentInChildren(SlotMachineController);
        if (smc) {
            smc.applyInitialSymbols();
            Log.d('[LoadingController] applyInitialSymbols() called with real data');
        }

        // 1 frame defer — đủ để GPU submit texture upload, không chờ 0.3s cứng
        this.scheduleOnce(() => {
            this._heavyInitDone = true;
            this._tryFillToFull();
            Log.d('[LoadingController] Heavy init done → bar allowed to reach 100%');
        }, 0);
    }

    // ─── LOADING BAR ───

    private _startLoadingBar(): void {
        // Prefab mode không cần preloadScene — prefab đã bundled trong main bundle
        if (this.useScenePreload && this.targetScene && !this.gamePrefabPath) {
            this._startScenePreload();
        } else if (this.handleServerLogin && this.gamePrefabPath) {
            // ★ THREE-PHASE MODE: crawl 0→99% (Login ∥ Bundle), rồi load Base → 100%
            this._runThreePhaseLoading();
        } else {
            this._startFakeTimer();
        }
    }

    // ─── SCENE PRELOAD (two-scene mode) ───

    private _startScenePreload(): void {
        director.preloadScene(
            this.targetScene,
            (finished: number, total: number) => {
                // Map preload progress → 0 to 85% (leave buffer for server + fill animation)
                const p = total > 0 ? (finished / total) * 0.85 : 0;
                if (this.loadingBar) {
                    this.loadingBar.progress = Math.max(this.loadingBar.progress, p);
                }
                this._syncHtmlLoadingOverlay();
            },
            (err) => {
                if (err) Log.e('[LoadingController] Preload scene error:', err);
                this._onPreloadComplete();
            }
        );
    }

    private _onPreloadComplete(): void {
        this._preloadDone = true;
        if (this.loadingBar) this.loadingBar.progress = 0.9;

        if (this.handleServerLogin) {
            // Two-scene: handle login ourselves, no GameManager in loading scene
            this._doServerLogin();
        } else {
            // Single-scene or GameManager present: emit gate event as usual
            EventBus.instance.emit(GameEvents.LOADING_GATE_REACHED);
            if (this._serverReady) {
                this._heavyInitDone = true; // Không có prefab → không cần heavy init
                this._fillToFull();
            } else {
                this._barDone = true;
            }
        }
    }

    // ─── SERVER LOGIN (two-scene mode, handleServerLogin = true) ───

    private async _doServerLogin(): Promise<void> {
        const net  = NetworkManager.instance;
        const data = GameData.instance;

        // CDN đã kick từ onLoad — không await ở đây (chạy song song với login)
        if (!this._cdnPromise) {
            this._cdnPromise = this._loadCdnAssets().catch((err) => {
                Log.w('[LoadingController] CDN load error (non-blocking):', err);
            });
        }

        try {
            if (USE_REAL_API) {
                const urlParams  = new (window.URLSearchParams)(window.location.search);
                const gpToken    = urlParams.get('gp');
                const loginParams = gpToken ? { gp: gpToken } : undefined;

                await net.login(loginParams);
                const enterResp = await net.enterGame();

                WalletManager.instance.balance = enterResp.cash;
                data.player.betIndex = enterResp.betIndex;

                net.startHeartBeat();
                net.startJackpotPolling();
            } else {
                // Mock: chạy login+enter thật (MockAdapter) để GameManager không gọi lại
                const session = await net.login();
                data.setServerSession(session);
                WalletManager.instance.balance = session.cash;

                const enterResp = await net.enterGame();
                WalletManager.instance.balance = enterResp.cash;
                data.player.betIndex = enterResp.betIndex;
                data.isLoggedIn = true;
                data.isEntered  = true;
            }
        } catch (err) {
            Log.e('[LoadingController] Server error during login:', err);
        }

        this._serverReady = true;
        this._tryFillToFull();
    }

    /** Đợi CDN xong (locale/font) trước khi cho phép hiện game UI */
    private async _awaitCdnReady(): Promise<void> {
        if (!this._cdnPromise) return;
        try {
            await this._cdnPromise;
        } catch (err) {
            Log.w('[LoadingController] CDN await error (non-blocking):', err);
        }
    }

    // ─── CDN ASSETS ───

    /**
     * Tải locale-online.json và font TTF từ CDN.
     * - Nếu CDN_BASE = null → bỏ qua, dùng local data.
     * - Nếu fetch lỗi → fallback local, không block game.
     */
    private async _loadCdnAssets(): Promise<void> {
        const cdnBase = ServerConfig.CDN_BASE;
        if (!cdnBase) {
            Log.d('[CDN] CDN_BASE không được set — dùng local bundled assets.');
            return;
        }

        Log.d(`[CDN] Bắt đầu tải từ: ${cdnBase}`);
        const cdn = CdnAssetManager.instance;
        cdn.init(cdnBase);

        // 1. Fetch manifest
        const manifest = await cdn.fetchManifest();
        if (!manifest) {
            Log.w('[CDN] Không lấy được manifest — thử load locale trực tiếp (không version check).');
        }

        // 2. Load locale + font song song
        //    Font: dùng promise đã kick off từ onLoad() (tránh download lại).
        const currentLang = LocalizationManager.instance.currentLanguage;
        const fontPromise = this._earlyFontPromise ?? cdn.loadFont(currentLang);
        this._earlyFontPromise = null;

        const localePromise = ServerConfig.USE_CDN_LOCALE ? cdn.loadLocale() : Promise.resolve(null);
        const [locale, font] = await Promise.all([
            localePromise,
            fontPromise,
        ]);

        // 3. Apply locale
        if (!ServerConfig.USE_CDN_LOCALE) {
            Log.d('[CDN] USE_CDN_LOCALE = false — dùng local bundled locale (.ts files).');
        } else if (locale) {
            LocalizationManager.instance.loadOnlineLocalesFromData(locale);
            const langCount   = Object.keys(locale).length;
            const sampleKey   = Object.keys(locale)[0];
            const keyCount    = sampleKey ? Object.keys(locale[sampleKey]).length : 0;
            Log.d(`[CDN] ✅ Locale loaded: ${langCount} ngôn ngữ, ~${keyCount} keys/lang`);
        } else {
            Log.d('[CDN] ⚠️ Locale không tải được — dùng local bundled locale.');
        }

        // 4. Apply font ngôn ngữ hiện tại
        if (font) {
            FontManager.instance?.applyRemoteFonts({ [currentLang]: font });
            Log.d(`[CDN] ✅ Font loaded: ${currentLang}`);
        } else {
            Log.d(`[CDN] ⚠️ Font "${currentLang}" không tải được — dùng font bundled trong build.`);
        }

        Log.d('[CDN] Hoàn tất.');
    }

    // ─── EARLY FONT LOAD ───

    /**
     * Kick off tải font ngay từ onLoad() — trước khi loading bar bắt đầu.
     * Nếu font đã có trong browser HTTP cache → trả về gần như ngay lập tức.
     * Kết quả được _loadCdnAssets() await sau, không cần download lại.
     */
    private _earlyLoadFont(): void {
        const cdnBase = ServerConfig.CDN_BASE;
        if (!cdnBase) return;

        const cdn = CdnAssetManager.instance;
        cdn.init(cdnBase);

        const lang = LocalizationManager.instance.currentLanguage;
        Log.d(`[CDN] Early font pre-load: ${lang}`);
        // Không await manifest — URL không có ?v= nhưng browser cache vẫn hoạt động.
        const promise = cdn.loadFont(lang);
        this._earlyFontPromise = promise;

        // Apply font NGAY khi promise resolve (không đợi login/CDN assets load).
        // Nếu font đã có trong browser HTTP cache → gần như tức thì, trước cả khi
        // loading bar bắt đầu chạy → noteLabel và tất cả labels đúng font ngay lập tức.
        promise.then((font) => {
            if (!font) return;
            const fm = FontManager.instance;
            if (fm) {
                fm.applyRemoteFonts({ [lang]: font });
                Log.d(`[CDN] Early font applied immediately: ${lang}`);
            } else {
                // FontManager chưa có (rare race) — lưu vào CDN cache, FontManager.onLoad()
                // sẽ tự re-apply qua hasCachedFonts khi nó khởi tạo.
                Log.d(`[CDN] Early font ready (FontManager not yet init): ${lang}`);
            }
        });
    }

    // ─── FAKE TIMER (single-scene mode, useScenePreload = false) ───

    private _startFakeTimer(): void {
        this._elapsed = 0;
        const interval = 1 / 30;
        // Nhanh tới prefabLoadPercent% để hiển thị loading ngay, rồi load prefab
        const BAR_GATE = this.prefabLoadPercent;

        this._loadCb = () => {
            this._elapsed += interval;
            const t = Math.min(this._elapsed / this.loadingDuration, 1);
            const eased = t * t * (3 - 2 * t);
            const progress = eased * BAR_GATE;
            if (this.loadingBar) this.loadingBar.progress = progress;
            this._syncHtmlLoadingOverlay();

            if (t >= 1.0) {
                this.unschedule(this._loadCb!);
                this._loadCb = null;
                this._onBarReachedLimit();
            }
        };

        this.schedule(this._loadCb, interval);
    }

    /** Bar đã tới 1% - bắt đầu load prefab ngay */
    private _onBarReachedLimit(): void {
        this._syncHtmlLoadingOverlay();
        if (this.handleServerLogin) {
            if (this.gamePrefabPath) {
                // Prefab mode: dừng bar ở 1%, load prefab ngay
                // Khi prefab xong → animate bar từ 2% → 100%
                this._startPrefabLoadAtOnce();
                // Server login chạy song song (background)
                this._doServerLogin();
            } else {
                this._barDone = true;
                this._doServerLogin();
            }
        } else {
            this._barDone = true;
            EventBus.instance.emit(GameEvents.LOADING_GATE_REACHED);
            if (this._serverReady) {
                this._heavyInitDone = true; // Không có prefab → không cần heavy init
                this._fillToFull();
            }
        }
    }

    /**
     * Load prefab ngay từ 1%, không cập nhật progress bar.
     * Khi prefab load xong → set bar = 2% rồi animate mượt từ 2% → 100%.
     */
    private _startPrefabLoadAtOnce(): void {
        Log.d(`[LoadingController] Loading prefab at 1%: ${this.gameBundleName}/${this.gamePrefabPath}`);

        const onBundleReady = (bundle: AssetManager.Bundle) => {
            bundle.load(
                this.gamePrefabPath,
                Prefab,
                (finished: number, total: number) => {
                    // Không cập nhật bar - giữ ở 1%
                },
                (err, prefab) => {
                    if (err) {
                        Log.e(`[LoadingController] Prefab load failed: ${this.gameBundleName}/${this.gamePrefabPath}`, err);
                    } else {
                        this._loadedPrefab = prefab;
                        // active=true NGAY ĐỂ LIFECYCLE CHẠY (onLoad/start của SMC, SymbolView...).
                        // Vô hình nhờ opacity=0 trong GameEntryController.onLoad().
                        const gameNode = instantiate(prefab);
                        gameNode.active = true;
                        const parent = this.gameContainer ?? director.getScene()!;
                        parent.addChild(gameNode);
                        this._instantiatedGameNode = gameNode;
                        Log.d(`[LoadingController] Prefab instantiated (active=true, opacity=0): ${this.gameBundleName}/${this.gamePrefabPath}`);
                    }
                    // Prefab đã instantiate — đánh dấu ready, nhưng CHỜ ENTER_SUCCESS + GPU
                    // _applySymbolsIfReady() sẽ chạy khi ENTER_SUCCESS fire (hoặc đã fire)
                    this._prefabReady = true;
                    this._barDone = true;
                    if (this.loadingBar) {
                        this.loadingBar.progress = this.barFillStartPercent;
                    }
                    this._syncHtmlLoadingOverlay();
                    this._applySymbolsIfReady();
                    this._tryFillToFull();
                }
            );
        };

        const existing = assetManager.getBundle(this.gameBundleName);
        if (existing) {
            onBundleReady(existing);
        } else {
            assetManager.loadBundle(this.gameBundleName, (err, bundle) => {
                if (err) {
                    Log.e(`[LoadingController] Bundle load failed: ${this.gameBundleName}`, err);
                    this._heavyInitDone = true;
                    this._prefabReady = true;
                    this._barDone = true;
                    if (this.loadingBar) {
                        this.loadingBar.progress = this.barFillStartPercent;
                    }
                    this._tryFillToFull();
                    return;
                }
                onBundleReady(bundle!);
            });
        }
    }

    /**
     * Gate kiểm tra cả server VÀ prefab VÀ heavy init (symbols + pools) đều sẵn sàng
     * trước khi fill 100%. Hàm này được gọi từ _doServerLogin(), _startPrefabLoad(),
     * và sau khi heavy init delay hoàn tất.
     */
    private _tryFillToFull(): void {
        if (this._fillStarted || this._animatingToFull) return;
        const prefabDone = !this.gamePrefabPath || this._prefabReady;
        const heavyDone  = !this.gamePrefabPath || this._heavyInitDone;
        // CDN không block bar 100% — locale/font apply nền khi xong
        if (this._serverReady && prefabDone && heavyDone) {
            this._fillStarted = true;
            this._fillToFull();
        }
    }

    // ─── THREE-PHASE LOADING ───

    /**
     * Bar crawl mượt 0→99% trong lúc Login ∥ Bundle (CDN nền).
     * Đạt 99% xong mới load Base — tránh khựng ở ~90% khi Base nặng.
     */
    private async _runThreePhaseLoading(): Promise<void> {
        if (this.loadingBar) this.loadingBar.progress = 0;

        if (!this._bundlePromise) {
            this._bundlePromise = this._loadBundleAsync().catch((err) => {
                Log.e('[LoadingController] Bundle load failed:', err);
                return null;
            });
        }
        if (!this._cdnPromise) {
            this._cdnPromise = this._loadCdnAssets().catch((err) => {
                Log.w('[LoadingController] CDN load error (non-blocking):', err);
            });
        }

        const barEnd = Math.min(0.995, Math.max(0.5, this.prePrefabBarEnd));

        Log.d(`[ThreePhase] Crawl 0→${(barEnd * 100).toFixed(0)}% (Login ∥ Bundle), then Base`);
        let bundle: AssetManager.Bundle | null = null;
        await this._phaseWithCrawl(0, barEnd, async () => {
            const [, b] = await Promise.all([
                this._doServerLogin(),
                this._bundlePromise!,
            ]);
            bundle = b;
        });

        if (this.loadingBar) {
            Tween.stopAllByTarget(this.loadingBar);
            this.loadingBar.progress = barEnd;
            this._syncHtmlLoadingOverlay();
        }

        Log.d('[ThreePhase] Load Base prefab at bar 99%');
        if (bundle && this.gamePrefabPath) {
            await this._loadAndInstantiatePrefab(bundle);
        } else if (!bundle) {
            Log.e('[LoadingController] No bundle — cannot instantiate prefab');
            this._prefabReady = true;
            this._heavyInitDone = true;
        }

        Log.d('[ThreePhase] Base done → fill bar to 100%');
        this._tryFillToFull();
    }

    /**
     * Bar crawl đều tới `to` trong khi operation chạy.
     * Operation xong → snap/fill tới `to`, rồi resolve.
     */
    private _phaseWithCrawl(from: number, to: number, operation: () => Promise<void>): Promise<void> {
        this._syncHtmlLoadingOverlay();
        return new Promise<void>((resolve) => {
            if (!this.loadingBar) {
                operation().then(resolve).catch((err) => {
                    Log.e('[PhaseWithCrawl] Operation error (no bar):', err);
                    resolve();
                });
                return;
            }

            let resolved = false;

            const finish = () => {
                if (resolved) return;
                resolved = true;
                Tween.stopAllByTarget(this.loadingBar!);
                const cur = this.loadingBar!.progress;
                const fillSecs = Math.max(0.1, (to - cur) * 0.5);
                tween(this.loadingBar!)
                    .to(fillSecs, { progress: to }, { easing: 'sineOut' })
                    .call(() => resolve())
                    .start();
            };

            const crawlSecs = Math.max(3, this.phaseCrawlSecs);
            tween(this.loadingBar)
                .to(crawlSecs, { progress: to }, { easing: 'sineOut' })
                .start();

            operation().then(finish).catch((err) => {
                Log.e('[PhaseWithCrawl] Operation error:', err);
                finish();
            });
        });
    }

    /** Wrap assetManager.loadBundle vào Promise */
    private _loadBundleAsync(): Promise<AssetManager.Bundle> {
        return new Promise<AssetManager.Bundle>((resolve, reject) => {
            const existing = assetManager.getBundle(this.gameBundleName);
            if (existing) {
                resolve(existing);
                return;
            }
            assetManager.loadBundle(this.gameBundleName, (err, bundle) => {
                if (err || !bundle) {
                    Log.e(`[LoadingController] Bundle load failed: ${this.gameBundleName}`, err);
                    reject(err ?? new Error('Bundle is null'));
                } else {
                    Log.d(`[LoadingController] Bundle loaded: ${this.gameBundleName}`);
                    resolve(bundle);
                }
            });
        });
    }

    /** Load prefab asset từ bundle rồi instantiate (ẩn), lưu vào _instantiatedGameNode */
    private _loadAndInstantiatePrefab(bundle: AssetManager.Bundle): Promise<void> {
        return new Promise<void>((resolve) => {
            bundle.load(this.gamePrefabPath, Prefab, (err: Error | null, prefab: Prefab) => {
                if (err || !prefab) {
                    Log.e(`[LoadingController] Prefab load failed: ${this.gamePrefabPath}`, err);
                } else {
                    const gameNode = instantiate(prefab);
                    gameNode.active = true;
                    const parent = this.gameContainer ?? director.getScene()!;
                    parent.addChild(gameNode);
                    this._instantiatedGameNode = gameNode;
                    Log.d(`[LoadingController] Prefab instantiated (active=true, opacity=0): ${this.gamePrefabPath}`);
                }
                this._prefabReady = true;
                this._applySymbolsIfReady();
                this._tryFillToFull();
                resolve();
            });
        });
    }

    /** Fill bar từ 2% → 100% rồi complete */
    private _fillToFull(): void {
        if (this._animatingToFull) return;
        this._animatingToFull = true;

        if (!this.loadingBar) {
            this._hideHtmlOverlay();
            this.node.active = false;
            this._onLoadComplete();
            return;
        }
        tween(this.loadingBar)
            .to(0.05, { progress: 1.0 })
            .call(() => {
                this._hideHtmlOverlay();
                this.node.active = false;
                EventBus.instance.emit(GameEvents.LOADING_BAR_100);
                this._onLoadComplete();
            })
            .start();
    }

    private _onLoadComplete(): void {
        // Guard: chỉ chạy 1 lần duy nhất — tránh GameManager re-emit ENTER_SUCCESS kích hoạt lại
        if (this._completed) {
            Log.w('[LoadingController] _onLoadComplete called again — ignored (already completed)');
            return;
        }

        // Prefab mode: đợi heavy init (symbols) xong trước khi emit LOADING_COMPLETE
        if (this.gamePrefabPath && !this._heavyInitDone) {
            this.scheduleOnce(() => this._onLoadComplete(), 0.05);
            return;
        }

        this._completed = true;
        // Hủy listener ENTER_SUCCESS ngay — GameManager sẽ re-emit nó cho SlotMachineController
        EventBus.instance.off(GameEvents.ENTER_SUCCESS, this._onServerReady, this);

        const doComplete = () => {
            // ★ Ẩn HTML overlay NGAY TRƯỚC khi emit LOADING_COMPLETE / chuyển scene
            // — tránh icons GIF/PNG hiện chồng lên GuideView / game scene.
            this._hideHtmlOverlay();

            if (this.gamePrefabPath) {
                // ★ PREFAB MODE
                // Bước 0 (USE_REAL_API only): Pre-detect resume state TRƯỚC KHI activate game node.
                // Lý do: _instantiatedGameNode.active = true kích hoạt GameEntryController.onLoad()
                // đồng bộ, và ngay sau đó LOADING_COMPLETE fire. Nếu isResumingFreeSpin chưa được
                // set lúc đó, GameEntryController sẽ show guide thay vì skip ngay vào game.
                if (USE_REAL_API) {
                    const rawLast = GameData.instance.rawEnterLastSpinResponse;
                    if (rawLast) {
                        const lastStage: number = rawLast.NextStage ?? rawLast.stageType ?? 0;
                        const remainFS: number  = rawLast.RemainFreeSpinCount ?? rawLast.remainFreeSpinCount ?? 0;

                        // ★ Log ALL cases
                        const stageNames = {
                            0: 'SPIN', 3: 'FREE_SPIN_START', 4: 'FREE_SPIN', 5: 'FREE_SPIN_RE_TRIGGER',
                            8: 'BUY_FREE_SPIN_START', 9: 'BUY_FREE_SPIN',
                            100: 'NEED_CLAIM', 101: 'FREE_SPIN_END', 107: 'BUY_FREE_SPIN_END'
                        };
                        const stageName = (stageNames as any)[lastStage] || `UNKNOWN(${lastStage})`;
                        Log.e(`[GAME-ENTER] LoadingController prefab mode → stage=${lastStage}(${stageName}), remainFS=${remainFS}`);

                        // FREE_SPIN stages: 3-9 (còn lượt), TOPUP stages: 12-13, NEED_CLAIM: >= 100
                        const isFreeSpin = (lastStage >= 3 && lastStage <= 9) && remainFS > 0;
                        const isTopUp = lastStage === 12 || lastStage === 13;
                        const isNeedClaim = lastStage >= 100;
                        if (isFreeSpin || isTopUp || isNeedClaim) {
                            GameData.instance.isResumingFreeSpin = true;
                            Log.e(`[RESUME-DEBUG] LoadingController → isResumingFreeSpin=true (stage=${stageName})`);
                        } else {
                            Log.e(`[GAME-ENTER] LoadingController → stage=${stageName} không cần resume`);
                        }
                    } else {
                        Log.e(`[GAME-ENTER] LoadingController → NO rawEnterLastSpinResponse`);
                    }
                }
                // Bước 1: Ẩn LoadingView (đã fade xong, nền đen hiện ra)
                GameData.instance.isFromLoadingScene = true;
                this.node.active = false;
                // Bước 2: gameNode đã active=true từ lúc instantiate (lifecycle đã chạy xong).
                // Dòng này là no-op (guard). LOADING_COMPLETE sẽ trigger GameEntryController.
                if (this._instantiatedGameNode) {
                    this._instantiatedGameNode.active = true;
                }
                // Bước 3: Emit LOADING_COMPLETE → GameEntryController xử lý toàn bộ heavy init
                //          đồng bộ (PRE-WARM gameRoot + GuideView activate).
                EventBus.instance.emit(GameEvents.LOADING_COMPLETE);
                if (!this._instantiatedGameNode) {
                    Log.e('[LoadingController] Prefab not available — game may not display correctly');
                }
            } else if (this.targetScene) {
                // TWO-SCENE MODE: chuyển sang scene khác
                GameData.instance.isFromLoadingScene = true;
                const doLoad = () => director.loadScene(this.targetScene!);
                if (typeof document !== 'undefined' && document.fonts?.ready) {
                    document.fonts.ready.then(doLoad);
                } else {
                    doLoad();
                }
            } else {
                // SINGLE-SCENE MODE: ẩn loading view, game view hiện ra trên cùng scene.
                this.node.active = false;
                EventBus.instance.emit(GameEvents.LOADING_COMPLETE);
            }
        };

        if (this.uiOpacity) {
            // HTML overlay đang che toàn bộ canvas → không cần fade Cocos loading screen,
            // gọi doComplete() ngay để game activate trước khi overlay ẩn.
            doComplete();
        } else {
            this.scheduleOnce(doComplete, 0);
        }
    }
}
