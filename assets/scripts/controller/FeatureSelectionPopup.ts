/**
 * FeatureSelectionPopup — Popup chọn bonus khi 6+ Red sticky xuất hiện.
 *
 * Secret Treasure: 6 lựa chọn = TopUp + 5 tier Free Spin (ReelIndex 0 / 2–6).
 *
 * ── SETUP TRONG EDITOR ──
 *   btnTopUp          → TopUp Bonus (ReelIndex 0, NextStage 12)
 *   btnFreeSpinTiers  → 5 nút tier FS (Highest→Lowest, ReelIndex 2–6)
 */

import {
    _decorator, Component, Node, Button, BlockInputEvents, Label,
} from 'cc';
import { sp } from 'cc';
import { EventBus }       from '../core/EventBus';
import { GameEvents }     from '../core/GameEvents';
import {
    StickyCell, SymbolId, FeatureSelectOption,
    buildDefaultFeatureSelectOptions, FeatureSelectChoiceId,
    SECRET_TREASURE_FREE_SPIN_TIERS,
} from '../data/SlotTypes';
import { SpriteNumber }   from '../core/SpriteNumber';
import { Log }            from '../core/Logger';
import { SoundManager }   from '../manager/SoundManager';
import { L }              from '../core/LocalizationManager';

const { ccclass, property } = _decorator;

export interface FeatureSelectPayload {
    sumCredit: number;
    stickyCells: StickyCell[];
    options?: FeatureSelectOption[];
}

export interface FeatureSelectChoicePayload {
    option: FeatureSelectOption;
    onAccepted?: (onClosed?: () => void) => void;
    onRejected?: () => void;
}

@ccclass('FeatureSelectionPopup')
export class FeatureSelectionPopup extends Component {

    @property({ type: sp.Skeleton, tooltip: 'Spine animation cho popup feature selection.' })
    spine: sp.Skeleton | null = null;

    @property({ type: SpriteNumber, tooltip: 'SpriteNumber hiển thị tổng credit — count-up từ 0 đến sumCredit.' })
    sumCreditSpriteNumber: SpriteNumber | null = null;

    @property({ type: Button, tooltip: 'Nút TOP UP BONUS (Re-Spin).' })
    btnTopUp: Button | null = null;

    /** 5 nút Free Spin tier — thứ tự: Highest, High, Middle, Low, Lowest (ReelIndex 2–6). */
    @property({ type: [Button], tooltip: '5 nút Free Spin tier (Highest → Lowest).' })
    btnFreeSpinTiers: Button[] = [];

    /** Label tùy chọn cho từng tier (cùng thứ tự với btnFreeSpinTiers). */
    @property({ type: [Label], tooltip: 'Label text cho 5 tier Free Spin (optional).' })
    labelFreeSpinTiers: Label[] = [];

    private _isOpen: boolean = false;
    private _payload: FeatureSelectPayload | null = null;
    private _choosing: boolean = false;
    private _options: FeatureSelectOption[] = buildDefaultFeatureSelectOptions();
    /** Nút FS đã resolve (Inspector hoặc FreeGame1–5). */
    private _freeSpinButtons: Button[] = [];
    private _baseNode: Node | null = null;
    /** Layer preview tĩnh — ẩn khi spine chạy để không chặn touch. */
    private _demoNode: Node | null = null;
    private _choiceFallbackEmit: (() => void) | null = null;

    onLoad(): void {
        if (!this.node.getComponent(BlockInputEvents)) {
            this.node.addComponent(BlockInputEvents);
        }

        this._baseNode = this.node.getChildByName('Base');
        this._demoNode = this._baseNode?.getChildByName('Demo') ?? null;

        EventBus.instance.on(GameEvents.FEATURE_SELECT_OPEN, this._onOpen, this);
        this._bindButtons();

        this.node.active = false;
        if (this.spine) this.spine.node.active = false;
        if (this.sumCreditSpriteNumber) this.sumCreditSpriteNumber.node.active = false;
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    private _onOpen(payload: FeatureSelectPayload): void {
        if (this._isOpen) return;
        this._isOpen  = true;
        this._payload = payload;
        this._options = payload.options?.length
            ? payload.options
            : buildDefaultFeatureSelectOptions();

        const sumCredit = payload.stickyCells.reduce((sum, cell) =>
            cell.symbolId === SymbolId.STICKY_RED ? sum + (cell.credit ?? 0) : sum, 0);
        Log.e(`[FeatureSelectPopup] open sumCredit=${sumCredit} cells=${payload.stickyCells.length} options=${this._options.length}`);

        if (this.sumCreditSpriteNumber) {
            this.sumCreditSpriteNumber.setData(sumCredit);
        }

        this._bindButtons();
        this._applyOptionLabels();
        this._show();
    }

    /** Resolve 5 nút Free Spin — ưu tiên Inspector, fallback FreeGame1–5 trong Base. */
    private _resolveFreeSpinButtons(): Button[] {
        const fromInspector = this.btnFreeSpinTiers.filter(Boolean);
        if (fromInspector.length >= SECRET_TREASURE_FREE_SPIN_TIERS.length) {
            return fromInspector.slice(0, SECRET_TREASURE_FREE_SPIN_TIERS.length);
        }

        const resolved: Button[] = [...fromInspector];
        for (let i = 1; i <= SECRET_TREASURE_FREE_SPIN_TIERS.length; i++) {
            const idx = i - 1;
            if (resolved[idx]) continue;
            const node = this._baseNode?.getChildByName(`FreeGame${i}`);
            const btn = node?.getComponent(Button);
            if (btn) resolved[idx] = btn;
        }
        return resolved;
    }

    private _bindButtons(): void {
        this._freeSpinButtons = this._resolveFreeSpinButtons();
        Log.d(`[FeatureSelectionPopup] bind buttons topUp=${!!this.btnTopUp} freeSpin=${this._freeSpinButtons.length}`);

        if (this.btnTopUp) {
            this.btnTopUp.node.off(Button.EventType.CLICK);
            this.btnTopUp.node.on(Button.EventType.CLICK, () => this._onChooseOption(FeatureSelectChoiceId.TOPUP), this);
        }

        for (let i = 0; i < SECRET_TREASURE_FREE_SPIN_TIERS.length; i++) {
            const tierDef = SECRET_TREASURE_FREE_SPIN_TIERS[i];
            const btn = this._freeSpinButtons[i];
            if (!btn) {
                Log.e(`[FeatureSelectionPopup] Missing FreeSpin button index=${i} (${tierDef.shortLabel})`);
                continue;
            }
            btn.node.off(Button.EventType.CLICK);
            btn.node.on(Button.EventType.CLICK, () => this._onChooseOption(tierDef.id), this);
        }
    }

    /** Đưa nút lên trên spine / Demo để nhận touch. */
    private _raiseButtonsAboveContent(): void {
        const base = this._baseNode;
        if (!base) return;

        const touchables: Node[] = [];
        for (const btn of this._freeSpinButtons) {
            if (btn?.node) touchables.push(btn.node);
        }
        if (this.btnTopUp?.node) touchables.push(this.btnTopUp.node);

        let nextIndex = base.children.length;
        for (const node of touchables) {
            node.setSiblingIndex(nextIndex++);
        }
    }

    private _applyOptionLabels(): void {
        const topUpOpt = this._options.find(o => o.id === FeatureSelectChoiceId.TOPUP);
        if (this.btnTopUp) {
            this.btnTopUp.interactable = topUpOpt?.enabled ?? true;
        }

        for (let i = 0; i < SECRET_TREASURE_FREE_SPIN_TIERS.length; i++) {
            const tierDef = SECRET_TREASURE_FREE_SPIN_TIERS[i];
            const opt = this._options.find(o => o.id === tierDef.id);
            const enabled = opt?.enabled ?? true;
            const labelKey = opt?.labelKey ?? tierDef.labelKey;
            const text = L(labelKey) || tierDef.shortLabel;

            const btn = this._freeSpinButtons[i];
            if (btn) {
                btn.interactable = enabled;
            }
            if (this.labelFreeSpinTiers[i]) {
                this.labelFreeSpinTiers[i].string = text;
            }
        }
    }

    private _onChooseOption(choiceId: FeatureSelectChoiceId): void {
        if (!this._isOpen || this._choosing) return;
        const option = this._options.find(o => o.id === choiceId);
        if (!option || !option.enabled) return;

        this._choosing = true;
        Log.d(`[FeatureSelectionPopup] Chọn ${choiceId} → NextStage=${option.nextStage} ReelIndex=${option.reelIndex}`);
        this._setButtonsInteractable(false);
        SoundManager.instance?.playSFX(SoundManager.instance?.sxFeatureSelect);
        SoundManager.instance?.playFeatureSelectMusic();

        let choiceEmitted = false;
        const emitChoice = () => {
            if (choiceEmitted) return;
            choiceEmitted = true;
            this._clearChoiceFallback();
            EventBus.instance.emit(GameEvents.FEATURE_SELECT_CHOICE, {
                option,
                onAccepted: (onClosed?: () => void) => this._close(onClosed),
                onRejected: () => { this._choosing = false; this._setButtonsInteractable(true); },
            } satisfies FeatureSelectChoicePayload);
        };

        if (this.spine) {
            const anim = choiceId === FeatureSelectChoiceId.TOPUP ? 'Choose-topupbonus' : 'Choose-freegames';
            const fallbackSec = (choiceId === FeatureSelectChoiceId.TOPUP ? 2.5 : 4.5) / (this.spine.timeScale || 1);
            this._clearChoiceFallback();
            this._choiceFallbackEmit = () => {
                Log.e(`[FeatureSelectionPopup] spine complete fallback → ${choiceId}`);
                this.spine?.setCompleteListener(null);
                emitChoice();
            };
            this.scheduleOnce(this._choiceFallbackEmit, fallbackSec);

            this.spine.setCompleteListener(() => {
                this.spine!.setCompleteListener(null);
                emitChoice();
            });
            this.spine.setAnimation(0, anim, false);
        } else {
            emitChoice();
        }
    }

    private _clearChoiceFallback(): void {
        if (this._choiceFallbackEmit) {
            this.unschedule(this._choiceFallbackEmit);
            this._choiceFallbackEmit = null;
        }
    }

    private _show(): void {
        this.node.active = true;
        this._setButtonsInteractable(false);
        if (this.sumCreditSpriteNumber) this.sumCreditSpriteNumber.node.active = true;

        if (this._demoNode) {
            this._demoNode.active = !this.spine;
        }
        this._raiseButtonsAboveContent();

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
        this._clearChoiceFallback();

        if (this.spine) {
            this.spine.setCompleteListener(null);
        }

        if (this._demoNode) {
            this._demoNode.active = true;
        }

        this.node.active = false;
        if (this.spine) this.spine.node.active = false;
        if (this.sumCreditSpriteNumber) this.sumCreditSpriteNumber.node.active = false;

        this._payload = null;
        EventBus.instance.emit(GameEvents.FEATURE_SELECT_CLOSE);
        onDone?.();
    }

    private _setButtonsInteractable(value: boolean): void {
        if (this.btnTopUp) {
            const topUpOpt = this._options.find(o => o.id === FeatureSelectChoiceId.TOPUP);
            this.btnTopUp.interactable = value && (topUpOpt?.enabled ?? true);
        }
        for (let i = 0; i < SECRET_TREASURE_FREE_SPIN_TIERS.length; i++) {
            const tierDef = SECRET_TREASURE_FREE_SPIN_TIERS[i];
            const opt = tierDef ? this._options.find(o => o.id === tierDef.id) : undefined;
            const btn = this._freeSpinButtons[i];
            if (btn) {
                btn.interactable = value && (opt?.enabled ?? true);
            }
        }
    }
}
