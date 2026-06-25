/**
 * TopUpUI — Hiển thị UI cho chế độ Top Up.
 *
 * Gắn component này lên node TopUpUI trong scene.
 * Lắng nghe các event TopUp để hiện/ẩn và cập nhật số tiền.
 *
 * ── PROPERTIES ──
 *   • spinsRemainingSpriteNumber   — Số lần quay còn lại trong Top Up.
 *   • totalCoinCreditSpriteNumber  — Tổng số coin đỏ/vàng/xanh đang xuất hiện trên grid.
 *   • topUpBaseCreditSpriteNumber  — Tổng tiền các đồng đỏ trước khi vào Top Up.
 *   • topUpAccumulatedSpriteNumber — Tổng tiền đang kiếm được trong Top Up.
 */

import { _decorator, Component } from 'cc';
import { EventBus }              from '../core/EventBus';
import { GameEvents }            from '../core/GameEvents';
import { GameData }              from '../data/GameData';
import { SymbolId }              from '../data/SlotTypes';
import { SpriteNumber }          from '../core/SpriteNumber';
import { Log }                   from '../core/Logger';

const { ccclass, property } = _decorator;

@ccclass('TopUpUI')
export class TopUpUI extends Component {

    // ── INSPECTOR ──────────────────────────────────────────────────────────────

    @property({
        type: SpriteNumber,
        tooltip: 'Topup UI: số lần quay còn lại.',
    })
    spinsRemainingSpriteNumber: SpriteNumber | null = null;

    @property({
        type: SpriteNumber,
        tooltip: 'Topup UI: tổng số đồng xu sticky (đỏ + vàng + xanh) đang hiển thị trên grid.',
    })
    totalCoinCreditSpriteNumber: SpriteNumber | null = null;

    @property({
        type: SpriteNumber,
        tooltip: 'Topup UI: tổng tiền các đồng đỏ trước khi vào Top Up.',
    })
    topUpBaseCreditSpriteNumber: SpriteNumber | null = null;

    @property({
        type: SpriteNumber,
        tooltip: 'Topup UI: tổng tiền đang kiếm được trong Top Up — cộng dồn sau mỗi đồng Vàng/Xanh hút xong.',
    })
    topUpAccumulatedSpriteNumber: SpriteNumber | null = null;

    // ── STATE ──────────────────────────────────────────────────────────────────

    /** Tổng credit đang hiển thị — cộng dồn qua từng coin absorb */
    private _accumulated: number = 0;

    // ── LIFECYCLE ──────────────────────────────────────────────────────────────

    onLoad(): void {
        EventBus.instance.on(GameEvents.TOPUP_START,         this._onTopUpStart,         this);
        EventBus.instance.on(GameEvents.TOPUP_COUNT_UPDATED, this._onTopUpCountUpdated,   this);
        EventBus.instance.on(GameEvents.TOPUP_TOTAL_UPDATED, this._onTopUpTotalUpdated,   this);
        EventBus.instance.on(GameEvents.TOPUP_ABSORB_CREDIT, this._onAbsorbCredit,        this);
        EventBus.instance.on(GameEvents.TOPUP_NEXT_WIN_UPDATED, this._onTopUpNextWinUpdated, this);
        EventBus.instance.on(GameEvents.TOPUP_END,           this._onTopUpEnd,            this);
    }

    onDestroy(): void {
        EventBus.instance.offTarget(this);
    }

    // ── EVENT HANDLERS ────────────────────────────────────────────────────────

    private _onTopUpStart(payload: { spinsRemaining: number; baseCredit: number; totalWin: number }): void {
        // EachWin/NextWin is the TopUp win amount; base red credit is displayed separately.
        this._accumulated = Math.max(0, payload.totalWin ?? 0);
        Log.e(`[TOPUP-CREDIT][UI] start spins=${payload.spinsRemaining} baseCredit=${payload.baseCredit} serverTotal=${payload.totalWin} display=${this._accumulated}`);
        this._showAccumulated();
        this._onTopUpCountUpdated(payload.spinsRemaining);
        if (this.topUpBaseCreditSpriteNumber) {
            this.topUpBaseCreditSpriteNumber.node.active = true;
            this.topUpBaseCreditSpriteNumber.setData(payload.baseCredit, -1, 0, true);
        }
        this._showTotalCoinCount();
    }

    private _onTopUpCountUpdated(count: number): void {
        Log.e(`[TOPUP-PLUS] UI count updated=${count}`);
        if (!this.spinsRemainingSpriteNumber) return;
        this.spinsRemainingSpriteNumber.node.active = true;
        this.spinsRemainingSpriteNumber.setData(count);
    }

    private _onTopUpTotalUpdated(payload: { baseCredit?: number; totalWin?: number; deferEachWin?: boolean }): void {
        const before = this._accumulated;
        if (this.topUpBaseCreditSpriteNumber && payload.baseCredit != null) {
            this.topUpBaseCreditSpriteNumber.node.active = true;
            this.topUpBaseCreditSpriteNumber.setData(payload.baseCredit, -1, 0, true);
        }
        if (payload.totalWin != null && !payload.deferEachWin) {
            this._accumulated = Math.max(0, payload.totalWin);
            this._showAccumulated();
        }
        Log.e(`[TOPUP-CREDIT][UI] totalUpdated baseCredit=${payload.baseCredit ?? 'n/a'} serverTotal=${payload.totalWin ?? 'n/a'} deferEachWin=${payload.deferEachWin ? 1 : 0} beforeDisplay=${before} afterDisplay=${this._accumulated}`);
        this._showTotalCoinCount();
    }

    /** Sau khi 1 dong Vang/Xanh hut xong → cong credit cua no vao tong */
    private _onAbsorbCredit(payload: { credit: number; visualCredit?: number; totalWin?: number }): void {
        const before = this._accumulated;
        if (payload.totalWin != null) {
            this._accumulated = Math.max(0, payload.totalWin);
        } else {
            this._accumulated += payload.credit;
        }
        Log.e(`[TOPUP-CREDIT][UI] absorbCredit serverDelta=${payload.credit} visualCredit=${payload.visualCredit ?? 'n/a'} serverTotal=${payload.totalWin ?? 'n/a'} beforeDisplay=${before} afterDisplay=${this._accumulated}`);
        this._showAccumulated();
        this._showTotalCoinCount();
        const stickyValues = Array.from(GameData.instance.stickyCells.values());
        const redSum = stickyValues
            .filter(c => c.symbolId === SymbolId.STICKY_RED)
            .reduce((sum, c) => sum + (c.credit ?? 0), 0);
        const yellowSum = stickyValues
            .filter(c => c.symbolId === SymbolId.STICKY_YELLOW)
            .reduce((sum, c) => sum + (c.credit ?? 0), 0);
        const greenSum = stickyValues
            .filter(c => c.symbolId === SymbolId.STICKY_GREEN)
            .reduce((sum, c) => sum + (c.credit ?? 0), 0);
        const coinTotal = redSum + yellowSum + greenSum;
        Log.e(`` +
            `[TOPUP-CREDIT][UI][SPIN_SUMMARY] ` +
            `deltaAbsorb=${payload.credit} visualCredit=${payload.visualCredit ?? 'n/a'} serverTotal=${payload.totalWin ?? 'n/a'} ` +
            `redSum=${redSum} yellowSum=${yellowSum} greenSum=${greenSum} coinTotal=${coinTotal}`);
        Log.e(`[TOPUP-CREDIT][UI][COINS_ON_SCREEN] ${stickyValues.map(c => `${c.reel}-${c.row}:${SymbolId[c.symbolId] ?? c.symbolId}=${c.credit ?? 0}`).join('|')}`);
    }

    private _onTopUpNextWinUpdated(_value: number): void {
        // NextWin/tiền thắng được hiển thị qua accumulated; totalCoin chỉ là số lượng coin.
    }

    private _showAccumulated(): void {
        GameData.instance.topUpDisplayedEachWin = this._accumulated;
        Log.e(`[TOPUP-CREDIT][UI] showEachWin display=${this._accumulated} gameDataEachWin=${GameData.instance.topUpDisplayedEachWin}`);
        if (!this.topUpAccumulatedSpriteNumber) return;
        this.topUpAccumulatedSpriteNumber.node.active = true;
        this.topUpAccumulatedSpriteNumber.setData(this._accumulated, -1, 0, true);
    }

    private _showTotalCoinCount(): void {
        if (!this.totalCoinCreditSpriteNumber) return;
        this.totalCoinCreditSpriteNumber.node.active = true;
        this.totalCoinCreditSpriteNumber.setData(this._getTopUpCoinCount(), -1, 0, true);
    }

    private _getTopUpCoinCount(): number {
        let count = 0;
        for (const cell of GameData.instance.stickyCells.values()) {
            if (
                cell.symbolId === SymbolId.STICKY_RED ||
                cell.symbolId === SymbolId.STICKY_YELLOW ||
                cell.symbolId === SymbolId.STICKY_GREEN
            ) {
                count++;
            }
        }
        return count;
    }

    private _onTopUpEnd(): void {
        if (this.spinsRemainingSpriteNumber)   this.spinsRemainingSpriteNumber.node.active = false;
        if (this.totalCoinCreditSpriteNumber)  this.totalCoinCreditSpriteNumber.node.active = false;
        if (this.topUpBaseCreditSpriteNumber)  this.topUpBaseCreditSpriteNumber.node.active = false;
        if (this.topUpAccumulatedSpriteNumber) this.topUpAccumulatedSpriteNumber.node.active = false;
        this._accumulated = 0;
        GameData.instance.topUpDisplayedEachWin = 0;
    }
}
