/**
 * CoinPickButton — Script gắn trên mỗi coin node trong Pick Game.
 *
 * Tự động wire index → PickGamePopup.pickCoin(index) khi player tap.
 * Không cần kéo tay Button onClick trong Editor.
 *
 * ── SETUP ──
 *   1. Gắn CoinPickButton lên mỗi CoinNode (Coin0..Coin11).
 *   2. Điền đúng `coinIndex` trong Inspector (0..11).
 *   3. Đảm bảo CoinNode có Button component (hoặc thêm vào).
 *   4. Kéo PickGamePopup component vào `pickGamePopup`.
 *      (Hoặc để null → tự tìm qua EventBus — dùng cách kéo nếu có thể).
 */

import { _decorator, Component, Button } from 'cc';
import { PickGamePopup } from './PickGamePopup';

const { ccclass, property } = _decorator;

@ccclass('CoinPickButton')
export class CoinPickButton extends Component {

    @property({ tooltip: 'Index của coin này trong grid (0..11).' })
    coinIndex: number = 0;

    @property({
        type: PickGamePopup,
        tooltip: 'Kéo PickGamePopup component vào đây.\n'
               + 'CoinPickButton sẽ gọi pickCoin(coinIndex) khi bị tap.',
    })
    pickGamePopup: PickGamePopup | null = null;

    onLoad(): void {
        const btn = this.getComponent(Button);
        if (btn) {
            this.node.on(Button.EventType.CLICK, this._onClick, this);
        } else {
            // Thêm Button tự động nếu chưa có
            this.node.addComponent(Button);
            this.node.on(Button.EventType.CLICK, this._onClick, this);
        }
    }

    onDestroy(): void {
        this.node.off(Button.EventType.CLICK, this._onClick, this);
    }

    private _onClick(): void {
        if (this.pickGamePopup) {
            this.pickGamePopup.pickCoin(this.coinIndex);
        }
    }
}
