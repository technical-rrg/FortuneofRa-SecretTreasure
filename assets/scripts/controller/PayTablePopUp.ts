/**
 * PayTablePopUp - Popup bảng trả thưởng (Pay Table) gồm 7 trang.
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo Node "PayTablePopUp" con của Canvas, đặt trên cùng Hierarchy.
 *   2. Gắn component PayTablePopUp vào Node đó.
 *   3. Kéo popupNode vào slot (đặt active=false ban đầu).
 *   4. Kéo các Node/Label/Button vào đúng slot bên dưới.
 *
 * ── CẤU TRÚC POPUP (gợi ý hierarchy) ──
 *   PayTablePopUp (Node + component)
 *   └── PopupRoot (popupNode, active=false)
 *       ├── BtnClose (Button: closeButton)
 *       ├── BtnLeft  (Button: btnLeft)
 *       ├── BtnRight (Button: btnRight)
 *       │
 *       ├── Page1 (Node: page1Node)     1 title + 1 content
 *       │   ├── TitleLabel      → page1TitleLabel
 *       │   └── ContentLabel1   → page1Content1Label
 *       │
 *       ├── Page2 (Node: page2Node)     2 titles + 2 contents
 *       │   ├── TitleLabel1     → page2Title1Label
 *       │   ├── TitleLabel2     → page2Title2Label
 *       │   ├── ContentLabel1   → page2Content1Label
 *       │   └── ContentLabel2   → page2Content2Label
 *       │
 *       ├── Page3 (Node: page3Node)     1 title + 1 content
 *       │   ├── TitleLabel1     → page3Title1Label
 *       │   └── ContentLabel1   → page3Content1Label
 *       │
 *       ├── Page4 (Node: page4Node)     1 title + 1 content
 *       │   ├── TitleLabel1     → page4Title1Label
 *       │   └── ContentLabel1   → page4Content1Label
 *       │
 *       ├── Page5 (Node: page5Node)     1 title + 1 content
 *       │   ├── TitleLabel1     → page5Title1Label
 *       │   └── ContentLabel1   → page5Content1Label
 *       │
 *       ├── Page6 (Node: page6Node)     1 title + 1 content
 *       │   ├── TitleLabel1     → page6Title1Label
 *       │   └── ContentLabel1   → page6Content1Label
 *       │
 *       └── Page7 (Node: page7Node)     1 title + 1 content
 *           ├── TitleLabel1     → page7Title1Label
 *           └── ContentLabel1   → page7Content1Label
 *
 * ── LOCALIZATION KEYS ──
 *   Mỗi Label đi kèm một property key (string), dùng để gọi L(key) từ LocalizationManager.
 *   Ví dụ: page1TitleKey = "paytable_page1_title"
 *
 * ── MỞ POPUP ──
 *   EventBus.instance.emit(GameEvents.PAY_TABLE_OPEN);
 *   hoặc gọi trực tiếp: PayTablePopUp.instance?.open();
 */

import { _decorator, Component, Node, Label, Button, RichText, Widget, UITransform, view, screen, tween, Vec3, director } from 'cc';
import { EventBus } from '../core/EventBus';
import { GameEvents } from '../core/GameEvents';
import { L } from '../core/LocalizationManager';
import { Log } from '../core/Logger';

const { ccclass, property } = _decorator;

@ccclass('PayTablePopUp')
export class PayTablePopUp extends Component {

    // ─── SINGLETON ───
    private static _instance: PayTablePopUp | null = null;
    static get instance(): PayTablePopUp | null { return PayTablePopUp._instance; }

    // ─── POPUP ROOT ───

    @property({ type: Node, tooltip: 'Node bọc toàn bộ popup (đặt active=false ban đầu)' })
    popupNode: Node | null = null;

    // ─── BUTTONS ───

    @property({ type: Button, tooltip: 'Nút đóng popup' })
    closeButton: Button | null = null;

    @property({ type: Button, tooltip: 'Nút chuyển sang trang trước (Left)' })
    btnLeft: Button | null = null;

    @property({ type: Button, tooltip: 'Nút chuyển sang trang kế (Right)' })
    btnRight: Button | null = null;

    @property({ type: Label, tooltip: 'Label hiển thị số trang hiện tại (vd: 1/7)' })
    pageIndicatorLabel: Label | null = null;

    // ─── PAGE NODES ───

    @property({ type: Node, tooltip: 'Node chứa nội dung Trang 1' })
    page1Node: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa nội dung Trang 2' })
    page2Node: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa nội dung Trang 3' })
    page3Node: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa nội dung Trang 4' })
    page4Node: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa nội dung Trang 5' })
    page5Node: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa nội dung Trang 6' })
    page6Node: Node | null = null;

    @property({ type: Node, tooltip: 'Node chứa nội dung Trang 7' })
    page7Node: Node | null = null;

    // ─── PAGE 1 LABELS ───

    @property({ type: RichText, tooltip: 'Label tiêu đề Trang 1' })
    page1TitleLabel: RichText | null = null;

    @property({ tooltip: 'Localization key cho tiêu đề Trang 1' })
    Page1Title: string = '';

    @property({ type: RichText, tooltip: 'Label nội dung 1 Trang 1' })
    page1Content1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho nội dung 1 Trang 1' })
    Page1Content1: string = '';

    // ─── PAGE 2 LABELS ───

    @property({ type: RichText, tooltip: 'Label tiêu đề 1 Trang 2' })
    page2Title1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho tiêu đề 1 Trang 2' })
    Page2Title1: string = '';

    @property({ type: RichText, tooltip: 'Label tiêu đề 2 Trang 2' })
    page2Title2Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho tiêu đề 2 Trang 2' })
    Page2Title2: string = '';

    @property({ type: RichText, tooltip: 'Label nội dung 1 Trang 2' })
    page2Content1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho nội dung 1 Trang 2' })
    Page2Content1: string = '';

    @property({ type: RichText, tooltip: 'Label nội dung 2 Trang 2' })
    page2Content2Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho nội dung 2 Trang 2' })
    Page2Content2: string = '';

    // ─── PAGE 3 LABELS ───

    @property({ type: RichText, tooltip: 'Label tiêu đề 1 Trang 3' })
    page3Title1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho tiêu đề 1 Trang 3' })
    Page3Title1: string = '';

    @property({ type: RichText, tooltip: 'Label nội dung 1 Trang 3' })
    page3Content1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho nội dung 1 Trang 3' })
    Page3Content1: string = '';

    // ─── PAGE 4 LABELS ───

    @property({ type: RichText, tooltip: 'Label tiêu đề 1 Trang 4' })
    page4Title1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho tiêu đề 1 Trang 4' })
    Page4Title1: string = '';

    @property({ type: RichText, tooltip: 'Label nội dung 1 Trang 4' })
    page4Content1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho nội dung 1 Trang 4' })
    Page4Content1: string = '';

    // ─── PAGE 5 LABELS ───

    @property({ type: RichText, tooltip: 'Label tiêu đề 1 Trang 5' })
    page5Title1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho tiêu đề 1 Trang 5' })
    Page5Title1: string = '';

    @property({ type: RichText, tooltip: 'Label nội dung 1 Trang 5' })
    page5Content1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho nội dung 1 Trang 5' })
    Page5Content1: string = '';

    // ─── PAGE 6 LABELS ───

    @property({ type: RichText, tooltip: 'Label tiêu đề 1 Trang 6' })
    page6Title1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho tiêu đề 1 Trang 6' })
    Page6Title1: string = '';

    @property({ type: RichText, tooltip: 'Label nội dung 1 Trang 6' })
    page6Content1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho nội dung 1 Trang 6' })
    Page6Content1: string = '';

    // ─── PAGE 7 LABELS ───

    @property({ type: RichText, tooltip: 'Label tiêu đề 1 Trang 7' })
    page7Title1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho tiêu đề 1 Trang 7' })
    Page7Title1: string = '';

    @property({ type: RichText, tooltip: 'Label nội dung 1 Trang 7' })
    page7Content1Label: RichText | null = null;

    @property({ tooltip: 'Localization key cho nội dung 1 Trang 7' })
    Page7Content1: string = '';

    // ─── ANIMATION ───

    private readonly _ARROW_OFFSET: number = 8;   // px nhún sang mỗi bên
    private readonly _ARROW_DURATION: number = 0.35; // giây mỗi pha
    private _btnLeftOriginPos: Vec3 = new Vec3(0, 0, 0);   // lưu vị trí gốc btnLeft
    private _btnRightOriginPos: Vec3 = new Vec3(0, 0, 0);  // lưu vị trí gốc btnRight

    // ─── STATE ───

    private _currentPage: number = 1;
    private readonly _totalPages: number = 7;
    private _isOpen: boolean = false;

    // ─── LIFECYCLE ───

    onLoad(): void {
        PayTablePopUp._instance = this;

        // Ẩn toàn bộ popup khi khởi tạo
        this.node.active = false;

        this.closeButton?.node.on('click', this._onClose, this);
        this.btnLeft?.node.on('click', this._onLeft, this);
        this.btnRight?.node.on('click', this._onRight, this);

        EventBus.instance.on(GameEvents.PAY_TABLE_OPEN, this.open, this);

        // Khi xoay màn hình, Widget recalculate xong sau 1 frame → restart arrow anim
        view.on('canvas-resize', this._onCanvasResize, this);
    }

    onDestroy(): void {
        if (PayTablePopUp._instance === this) PayTablePopUp._instance = null;

        this.closeButton?.node?.off('click', this._onClose, this);
        this.btnLeft?.node?.off('click', this._onLeft, this);
        this.btnRight?.node?.off('click', this._onRight, this);

        view.off('canvas-resize', this._onCanvasResize, this);
        EventBus.instance?.off(GameEvents.PAY_TABLE_OPEN, this.open, this);
    }

    // ─── PUBLIC API ───

    open(): void {
        if (this._isOpen) return;
        this._isOpen = true;
        EventBus.instance.emit(GameEvents.POPUP_OPENED);

        // ── DIAGNOSTIC ──
        const ws = screen.windowSize;
        const ds = view.getDesignResolutionSize();
        Log.w(`[PayTable][open] windowSize=${ws.width}x${ws.height} | designSize=${ds.width}x${ds.height}`);

        this._currentPage = 1;
        this._refreshLocalization();
        this._showPage(this._currentPage);

        this.node.active = true;

        // Force tất cả Widget bên trong recalculate sau khi active
        this.scheduleOnce(() => {
            this.node.getComponentsInChildren(Widget).forEach(w => w.updateAlignment());
            // Lưu vị trí gốc trước khi start animation
            this._captureOriginPositions();
            this._restartArrowAnimations();
        }, 0);
    }

    close(): void {
        if (!this._isOpen) return;
        this._isOpen = false;
        EventBus.instance.emit(GameEvents.POPUP_CLOSED);
        this.node.active = false;
    }

    // ─── NAVIGATION ───

    private _onLeft(): void {
        this._currentPage--;
        if (this._currentPage < 1) this._currentPage = this._totalPages;
        this._showPage(this._currentPage);
    }

    private _onRight(): void {
        this._currentPage++;
        if (this._currentPage > this._totalPages) this._currentPage = 1;
        this._showPage(this._currentPage);
    }

    private _showPage(page: number): void {
        if (this.page1Node) this.page1Node.active = page === 1;
        if (this.page2Node) this.page2Node.active = page === 2;
        if (this.page3Node) this.page3Node.active = page === 3;
        if (this.page4Node) this.page4Node.active = page === 4;
        if (this.page5Node) this.page5Node.active = page === 5;
        if (this.page6Node) this.page6Node.active = page === 6;
        if (this.page7Node) this.page7Node.active = page === 7;

        if (this.pageIndicatorLabel) {
            this.pageIndicatorLabel.string = `${page} / ${this._totalPages}`;
        }

        // Restart arrow animations theo visibility mới — delay 1 frame để Widget kịp recalculate
        this.scheduleOnce(() => {
            // Reset vị trí button về gốc trước khi restart animation
            this._resetButtonPositions();
            this._restartArrowAnimations();
        }, 0);
    }

    /** Restart arrow animations với origin gốc đã lưu. */
    private _restartArrowAnimations(): void {
        this._playArrowAnimation(this.btnLeft?.node ?? null, -this._ARROW_OFFSET, this._btnLeftOriginPos);
        this._playArrowAnimation(this.btnRight?.node ?? null, this._ARROW_OFFSET, this._btnRightOriginPos);
    }

    /** Khi canvas resize (xoay màn hình): Widget cần 1 frame để recalculate → restart anim sau đó. */
    private _onCanvasResize(): void {
        if (!this._isOpen) return;
        this._stopArrowAnimations();
        this.scheduleOnce(() => {
            this.node.getComponentsInChildren(Widget).forEach(w => w.updateAlignment());
            // Cập nhật lại vị trí gốc sau khi canvas resize
            this._captureOriginPositions();
            this._restartArrowAnimations();
        }, 0);
    }

    /** Lưu vị trí gốc ban đầu của btnLeft và btnRight. */
    private _captureOriginPositions(): void {
        if (this.btnLeft?.node) {
            this._btnLeftOriginPos = this.btnLeft.node.position.clone();
        }
        if (this.btnRight?.node) {
            this._btnRightOriginPos = this.btnRight.node.position.clone();
        }
    }

    /** Reset vị trí button về gốc để tránh drift. */
    private _resetButtonPositions(): void {
        if (this.btnLeft?.node) {
            this.btnLeft.node.position = this._btnLeftOriginPos.clone();
        }
        if (this.btnRight?.node) {
            this.btnRight.node.position = this._btnRightOriginPos.clone();
        }
    }

    /**
     * Phát animation nhún lặp vô hạn cho nút mũi tên.
     * @param node   - Node của nút (null = bỏ qua)
     * @param offsetX - dương → nhún phải, âm → nhún trái
     * @param originPos - vị trí gốc để tính offset (không bị drift)
     */
    private _playArrowAnimation(node: Node | null, offsetX: number, originPos: Vec3): void {
        if (!node) return;
        tween(node).stop(); // dừng tween cũ nếu có
        if (!node.active) return; // không chạy khi ẩn

        const shifted = new Vec3(originPos.x + offsetX, originPos.y, originPos.z);

        tween(node)
            .to(this._ARROW_DURATION, { position: shifted }, { easing: 'sineOut' })
            .to(this._ARROW_DURATION, { position: originPos.clone() },  { easing: 'sineIn'  })
            .union()
            .repeatForever()
            .start();
    }

    /** Dừng toàn bộ arrow animation (khi đóng popup). */
    private _stopArrowAnimations(): void {
        if (this.btnLeft?.node)  tween(this.btnLeft.node).stop();
        if (this.btnRight?.node) tween(this.btnRight.node).stop();
    }

    /** In trạng thái Widget + world position của btnLeft và btnRight để debug layout. */
    private _logBtnWidgets(tag: string): void {
        const ds = view.getDesignResolutionSize();
        const ws = screen.windowSize;
        Log.w(`[PayTable][${tag}] designSize=${ds.width}x${ds.height} | windowSize=${ws.width}x${ws.height}`);

        // Log kích thước popupNode (parent của các btn)
        if (this.popupNode) {
            const ut = this.popupNode.getComponent(UITransform);
            const pw = this.popupNode.getWorldPosition();
            Log.w(`  popupNode: worldPos=(${pw.x.toFixed(1)}, ${pw.y.toFixed(1)})` +
                (ut ? ` | size=${ut.width}x${ut.height} | anchor=(${ut.anchorX},${ut.anchorY})` : ' | NO UITransform'));
        }

        for (const [name, btn] of [['btnLeft', this.btnLeft], ['btnRight', this.btnRight]] as [string, Button | null][]) {
            if (!btn) { Log.w(`  ${name}: NULL`); continue; }
            const n = btn.node;
            const widget = n.getComponent(Widget);
            const ut = n.getComponent(UITransform);
            const wp = n.getWorldPosition();
            const lp = n.position;
            const parentUt = n.parent?.getComponent(UITransform);
            Log.w(
                `  ${name}: active=${n.active}` +
                ` | localPos=(${lp.x.toFixed(1)}, ${lp.y.toFixed(1)})` +
                ` | worldPos=(${wp.x.toFixed(1)}, ${wp.y.toFixed(1)})` +
                (ut ? ` | selfSize=${ut.width}x${ut.height}` : '') +
                (parentUt ? ` | parentSize=${parentUt.width}x${parentUt.height}` : ' | parent NO UITransform') +
                (widget
                    ? ` | widget.enabled=${widget.enabled}` +
                      ` | target=${widget.target ? widget.target.name : 'null(=parent)'}` +
                      ` | isAlignLeft=${widget.isAlignLeft}(${widget.left})` +
                      ` | isAlignRight=${widget.isAlignRight}(${widget.right})` +
                      ` | isAlignHCenter=${widget.isAlignHorizontalCenter}(${widget.horizontalCenter})`
                    : ' | NO Widget component')
            );
        }
    }

    // ─── CLOSE ───

    private _onClose(): void {
        this._stopArrowAnimations();
        this.close();
    }

    // ─── LOCALIZATION ───

    private _refreshLocalization(): void {
        this._setRichText(this.page1TitleLabel,    this.Page1Title);
        this._setRichText(this.page1Content1Label, this.Page1Content1);

        this._setRichText(this.page2Title1Label,   this.Page2Title1);
        this._setRichText(this.page2Title2Label,   this.Page2Title2);
        this._setRichText(this.page2Content1Label, this.Page2Content1);
        this._setRichText(this.page2Content2Label, this.Page2Content2);

        this._setRichText(this.page3Title1Label,   this.Page3Title1);
        this._setRichText(this.page3Content1Label, this.Page3Content1);

        this._setRichText(this.page4Title1Label,   this.Page4Title1);
        this._setRichText(this.page4Content1Label, this.Page4Content1);

        this._setRichText(this.page5Title1Label,   this.Page5Title1);
        this._setRichText(this.page5Content1Label, this.Page5Content1);

        this._setRichText(this.page6Title1Label,   this.Page6Title1);
        this._setRichText(this.page6Content1Label, this.Page6Content1);

        this._setRichText(this.page7Title1Label,   this.Page7Title1);
        this._setRichText(this.page7Content1Label, this.Page7Content1);
    }

    private _setLabel(label: Label | null, key: string): void {
        if (!label || !key) return;
        label.string = L(key);
    }

    private _setRichText(label: RichText | null, key: string): void {
        if (!label || !key) return;
        label.string = L(key);
    }
}
