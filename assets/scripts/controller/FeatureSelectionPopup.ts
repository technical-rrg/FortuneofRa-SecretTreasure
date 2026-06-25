/**
 * FeatureSelectionPopup — Popup chọn bonus khi 6+ Red sticky xuất hiện.
 *
 * Feature F — Gold of Fortune:
 *   #25 Red counter detector   → GameManager detect 6 Red → emit FEATURE_SELECT_OPEN
 *   #26 Sum credit count-up    → Tổng credit Red count-up khi popup mở
 *   #27 Feature Selection UI   → TOP UP BONUS (Re-Spin) vs 8 FREE GAMES
 *   #28 EACH WINS KMBT format  → Từng sticky cell hiển thị credit theo K/M/B/T
 *
 * ── SETUP TRONG EDITOR ──
 *   1. Tạo Node "FeatureSelectionPopup" (inactive ban đầu, nằm top layer).
 *   2. Gắn component này vào node đó.
 *   3. Kéo các node vào đúng slot bên dưới.
 *
 * ── NODE STRUCTURE ──
 *   FeatureSelectionPopup (Node)
 *   └── popupNode          ← Node bọc toàn bộ popup (active=false ban đầu)
 *       ├── overlayNode    ← Node nền mờ full-screen
 *       ├── titleLabel     ← Label tiêu đề ("CHOOSE YOUR BONUS")
 *       ├── redCountLabel  ← Label số Red ("6 RED SYMBOLS")
 *       ├── eachWinsLabel  ← Label tiêu đề cột ("EACH WINS")
 *       ├── creditItemRoot ← Node cha chứa các item credit (mỗi item = 1 Label)
 *       │   └── [children] ← Dynamic — script sẽ set .string cho từng Label con
 *       ├── sumCreditLabel ← Label tổng credit (count-up)
 *       ├── btnTopUp       ← Button "TOP UP BONUS"
 *       │   └── labelTopUp ← Label text của button
 *       ├── btnFreeGames   ← Button "8 FREE GAMES"
 *       │   └── labelFreeGames ← Label text của button
 *       └── [labelTopUpDesc] / [labelFreeGamesDesc] ← phụ đề (tùy chọn)
 *
 * ── FLOW ──
 *   FEATURE_SELECT_OPEN({ sumCredit, stickyCells }) →
 *     Popup hiện, đếm từng credit item (EACH WINS KMBT), count-up tổng credit.
 *   Tap TOP UP BONUS →
 *     emit FEATURE_SELECT_RESPIN → GameManager bắt đầu Re-Spin mode.
 *   Tap 8 FREE GAMES →
 *     emit FEATURE_SELECT_FREESPIN → GameManager bắt đầu Free Spin mode.
 *   Popup đóng → emit FEATURE_SELECT_CLOSE.
 */

import {
    _decorator, Component, Node, Button, BlockInputEvents,
} from 'cc';
import { sp } from 'cc';
import { EventBus }       from '../core/EventBus';
import { GameEvents }     from '../core/GameEvents';
import { StickyCell, SymbolId } from '../data/SlotTypes';
import { SpriteNumber }   from '../core/SpriteNumber';
import { Log }            from '../core/Logger';
import { SoundManager }   from '../manager/SoundManager';

const { ccclass, property } = _decorator;

/** Payload nhận được khi FEATURE_SELECT_OPEN fire. */
export interface FeatureSelectPayload {
    sumCredit: number;
    stickyCells: StickyCell[];
}

@ccclass('FeatureSelectionPopup')
export class FeatureSelectionPopup extends Component {

    // ── INSPECTOR ─────────────────────────────────────────────────────────────

    @property({ type: sp.Skeleton, tooltip: 'Spine animation cho popup feature selection.' })
    spine: sp.Skeleton | null = null;

    @property({ type: SpriteNumber, tooltip: 'SpriteNumber hiển thị tổng credit — count-up từ 0 đến sumCredit.' })
    sumCreditSpriteNumber: SpriteNumber | null = null;

    @property({ type: Button, tooltip: 'Nút TOP UP BONUS (Re-Spin).' })
    btnTopUp: Button | null = null;

    @property({ type: Button, tooltip: 'Nút 8 FREE GAMES.' })
    btnFreeGames: Button | null = null;


    // ── STATE ──────────────────────────────────────────────────────────────────

    private _isOpen: boolean = false;
    private _payload: FeatureSelectPayload | null = null;
    private _choosing: boolean = false;

    // ── LIFECYCLE ──────────────────────────────────────────────────────────────

    onLoad(): void {
        // Block input xuyên qua popup khi mở
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }

        EventBus.instance.on(GameEvents.FEATURE_SELECT_OPEN, this._onOpen, this);

        if (this.btnTopUp) {
            this.btnTopUp.node.on('click', this._onChooseTopUp, this);
            this.btnTopUp.node.on(Node.EventType.MOUSE_ENTER, () => this._setOpacityFocus('top'), this);
            this.btnTopUp.node.on(Node.EventType.MOUSE_LEAVE, () => this._setOpacityFocus('none'), this);
        }
        if (this.btnFreeGames) {
            this.btnFreeGames.node.on('click', this._onChooseFreeGames, this);
            this.btnFreeGames.node.on(Node.EventType.MOUSE_ENTER, () => this._setOpacityFocus('free'), this);
            this.btnFreeGames.node.on(Node.EventType.MOUSE_LEAVE, () => this._setOpacityFocus('none'), this);
        }

        // Ẩn ban đầu
        this.node.active = false;
        if (this.spine) this.spine.node.active = false;
        if (this.sumCreditSpriteNumber) this.sumCreditSpriteNumber.node.active = false;
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ── EVENT HANDLER ──────────────────────────────────────────────────────────

    private _onOpen(payload: FeatureSelectPayload): void {
        if (this._isOpen) return;
        this._isOpen  = true;
        this._payload = payload;

        // Tổng credit duy nhất = sum tất cả STICKY_RED trong payload.stickyCells
        const sumCredit = payload.stickyCells.reduce((sum, cell) =>
            cell.symbolId === SymbolId.STICKY_RED ? sum + (cell.credit ?? 0) : sum, 0);
        Log.e(`[FeatureSelectPopup] open sumCredit=${sumCredit} cells=${payload.stickyCells.length}`);

        if (this.sumCreditSpriteNumber) {
            this.sumCreditSpriteNumber.setData(sumCredit);
        }

        this._show();
    }

    // ── BUTTON HANDLERS ────────────────────────────────────────────────────────

    private _onChooseTopUp(): void {
        if (!this._isOpen || this._choosing) return;
        this._choosing = true;
        Log.d('[FeatureSelectionPopup] Chọn TOP UP BONUS (Re-Spin)');
        this._setButtonsInteractable(false);
        SoundManager.instance?.playSFX(SoundManager.instance?.sxFeatureSelect);
        SoundManager.instance?.playFeatureSelectMusic();

        if (this.spine) {
            this.spine.setCompleteListener(() => {
                this.spine!.setCompleteListener(null);
                EventBus.instance.emit(GameEvents.FEATURE_SELECT_RESPIN, {
                    onAccepted: (onClosed?: () => void) => this._close(onClosed),
                    onRejected: () => { this._choosing = false; this._setButtonsInteractable(true); },
                });
            });
            this.spine.setAnimation(0, 'Choose-topupbonus', false);
        } else {
            EventBus.instance.emit(GameEvents.FEATURE_SELECT_RESPIN, {
                onAccepted: (onClosed?: () => void) => this._close(onClosed),
                onRejected: () => { this._choosing = false; this._setButtonsInteractable(true); },
            });
        }
    }

    private _onChooseFreeGames(): void {
        if (!this._isOpen || this._choosing) return;
        this._choosing = true;
        Log.d('[FeatureSelectionPopup] Chọn 8 FREE GAMES');
        this._setButtonsInteractable(false);
        SoundManager.instance?.playSFX(SoundManager.instance?.sxFeatureSelect);
        SoundManager.instance?.playFeatureSelectMusic();

        if (this.spine) {
            this.spine.setCompleteListener(() => {
                this.spine!.setCompleteListener(null);
                EventBus.instance.emit(GameEvents.FEATURE_SELECT_FREESPIN, {
                    onAccepted: (onClosed?: () => void) => this._close(onClosed),
                    onRejected: () => { this._choosing = false; this._setButtonsInteractable(true); },
                });
            });
            this.spine.setAnimation(0, 'Choose-freegames', false);
        } else {
            EventBus.instance.emit(GameEvents.FEATURE_SELECT_FREESPIN, {
                onAccepted: (onClosed?: () => void) => this._close(onClosed),
                onRejected: () => { this._choosing = false; this._setButtonsInteractable(true); },
            });
        }
    }

    // ── SHOW / HIDE ────────────────────────────────────────────────────────────

    private _show(): void {
        this.node.active = true;
        this._setButtonsInteractable(false);
        if (this.sumCreditSpriteNumber) this.sumCreditSpriteNumber.node.active = true;

        if (this.spine) {
            this.spine.node.active = true;
            this.spine.setCompleteListener(() => {
                this.spine!.setCompleteListener(null);
                this.spine!.setAnimation(0, 'Loop', true);
                this._setButtonsInteractable(true);
            });
            this.spine.setAnimation(0, 'In', false);
        } else {
            this._setButtonsInteractable(true);
        }
    }

    private _close(onDone?: () => void): void {
        if (!this._isOpen) return;
        this._isOpen = false;
        this._choosing = false;
        this._setButtonsInteractable(false);

        if (this.spine) {
            this.spine.setCompleteListener(null);
        }

        this.node.active = false;
        if (this.spine) this.spine.node.active = false;
        if (this.sumCreditSpriteNumber) this.sumCreditSpriteNumber.node.active = false;

        this._payload = null;
        EventBus.instance.emit(GameEvents.FEATURE_SELECT_CLOSE);
        onDone?.();
    }

    private _setButtonsInteractable(value: boolean): void {
        if (this.btnTopUp)     this.btnTopUp.interactable     = value;
        if (this.btnFreeGames) this.btnFreeGames.interactable = value;
    }

    private _setOpacityFocus(focused: 'top' | 'free' | 'none'): void {
        // Deprecated: spine handles visual focus states
    }
}
