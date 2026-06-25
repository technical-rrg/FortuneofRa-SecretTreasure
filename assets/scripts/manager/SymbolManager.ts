/**
 * SymbolManager — ★ Gold of Fortune mapping (3×5, Ways Pay).
 *
 * Hỗ trợ 2 hệ thống ID:
 *   - Client SymbolId (0–17): dùng bởi SymbolView, GameData mock strips
 *   - PS Symbol ID:           dùng bởi server API (legacy, sẽ dần loại bỏ)
 *
 * Quy ước đặt tên file hình (đặt trong `assets/bundle/textures/symbol/`):
 *   minor_q, minor_k, minor_a                      (id 0/1/2)
 *   major_coin, major_ingot, major_ship, major_turtle, major_phoenix  (id 3..7)
 *   wild_trail                                     (id 8)
 *   sticky_red, sticky_yellow, sticky_green        (id 9/10/11)
 *   plus_one_spin                                  (id 12)
 *   jp_idle, jp_mini, jp_minor, jp_major, jp_grand (id 13..17, chỉ dùng cho Pick Game)
 *
 * Legacy aliases (id 90..98) map về safe default để code cũ không crash.
 */

import { SpriteFrame, resources } from 'cc';
import { SymbolId } from '../data/SlotTypes';
import { Log } from '../core/Logger';
import { GameData } from '../data/GameData';

// ═══════════════════════════════════════════════════════════
//  CLIENT SYMBOL ID → SPRITE NAME MAPPING
// ═══════════════════════════════════════════════════════════

export const CLIENT_SPRITE_MAP: Record<number, string> = {
    // ─── Minor (low pay) ───
    [SymbolId.MINOR_Q]:        'minor_q',
    [SymbolId.MINOR_K]:        'minor_k',
    [SymbolId.MINOR_A]:        'minor_a',
    // ─── Major (high pay) ───
    [SymbolId.MAJOR_COIN]:     'major_coin',
    [SymbolId.MAJOR_INGOT]:    'major_ingot',
    [SymbolId.MAJOR_SHIP]:     'major_ship',
    [SymbolId.MAJOR_TURTLE]:   'major_turtle',
    [SymbolId.MAJOR_PHOENIX]:  'major_phoenix',
    // ─── Wild Trail (reel 1/2/3) ───
    [SymbolId.WILD]:           'wild_trail',
    // ─── Sticky symbols (Feature) ───
    [SymbolId.STICKY_RED]:     'sticky_red',
    [SymbolId.STICKY_YELLOW]:  'sticky_yellow',
    [SymbolId.STICKY_GREEN]:   'sticky_green',
    [SymbolId.PLUS_ONE_SPIN]:  'plus_one_spin',
    // ─── Jackpot icons (Pick Game) ───
    [SymbolId.JP_IDLE]:        'jp_idle',
    [SymbolId.JP_MINI]:        'jp_mini',
    [SymbolId.JP_MINOR]:       'jp_minor',
    [SymbolId.JP_MAJOR]:       'jp_major',
    [SymbolId.JP_GRAND]:       'jp_grand',
};
/**
 * PS Symbol ID → tên file sprite (dùng psToClientMap từ GameData).
 * Fallback 'minor_q' nếu chưa có mapping.
 */
export function getPSSpriteNameById(psId: number): string {
    const clientId = GameData.instance.psToClientMap[psId];
    if (clientId !== undefined && clientId >= 0) {
        return CLIENT_SPRITE_MAP[clientId] ?? 'minor_q';
    }
    return 'minor_q';
}

// ═══════════════════════════════════════════════════════════
//  SYMBOL MANAGER
// ═══════════════════════════════════════════════════════════

export class SymbolManager {
    private static _instance: SymbolManager;
    /** Cache SpriteFrame đã load (key = client SymbolId 0-8) */
    private _spriteCache: Map<number, SpriteFrame> = new Map();

    static get instance(): SymbolManager {
        if (!this._instance) {
            this._instance = new SymbolManager();
        }
        return this._instance;
    }

    /**
     * Lấy tên sprite cho Client SymbolId (0-8).
     */
    getSpriteName(clientSymbolId: number): string {
        return CLIENT_SPRITE_MAP[clientSymbolId] ?? 'minor_q';
    }

    /**
     * Lấy tên sprite cho PS Symbol ID — dùng dynamic psToClientMap từ GameData.
     */
    getSpriteNameByPSId(psId: number): string {
        const clientId = GameData.instance.psToClientMap[psId];
        if (clientId !== undefined && clientId >= 0) {
            return CLIENT_SPRITE_MAP[clientId] ?? 'minor_q';
        }
        return 'minor_q';
    }

    /**
     * Lấy SpriteFrame cho Client SymbolId (0-8), async + cache.
     * Load từ resources/textures/symbol/{spriteName}/spriteFrame
     */
    async getSpriteFrame(clientSymbolId: number): Promise<SpriteFrame | null> {
        const cached = this._spriteCache.get(clientSymbolId);
        if (cached) return cached;

        const spriteName = this.getSpriteName(clientSymbolId);
        const path = `textures/symbol/${spriteName}/spriteFrame`;

        return new Promise((resolve) => {
            resources.load(path, SpriteFrame, (err, spriteFrame) => {
                if (err) {
                    Log.w(`[SymbolManager] Failed to load sprite for ClientID ${clientSymbolId}: ${path}`, err);
                    resolve(null);
                    return;
                }
                this._spriteCache.set(clientSymbolId, spriteFrame);
                resolve(spriteFrame);
            });
        });
    }

    /**
     * Lấy SpriteFrame cho PS Symbol ID — dùng dynamic psToClientMap.
     */
    async getSpriteFrameByPSId(psId: number): Promise<SpriteFrame | null> {
        const clientId = GameData.instance.psToClientMap[psId];
        if (clientId !== undefined && clientId >= 0) {
            return this.getSpriteFrame(clientId);
        }
        // Unknown PS ID → return null (will show fallback)
        return null;
    }

    /** Preload tất cả symbol xuất hiện trên reel (0..12 — bỏ JP icon vì chỉ dùng Pick Game). */
    async preloadReelSymbols(): Promise<void> {
        const ids = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        const promises = ids.map((id) => this.getSpriteFrame(id));
        await Promise.all(promises);
    }

    /** Xóa cache (khi chuyển scene hoặc hot reload) */
    clearCache(): void {
        this._spriteCache.clear();
    }
}
