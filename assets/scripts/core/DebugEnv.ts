/**
 * DebugEnv — kiểm tra môi trường cho debug panel / shortcuts.
 *
 * Editor preview + Web preview (browser) + debug build → enabled.
 * Production release build → disabled (trừ khi bật ENABLE_DEBUG_TOOLS thủ công).
 */

import { DEBUG, DEV, EDITOR, PREVIEW } from 'cc/env';
import { ENABLE_DEBUG_TOOLS } from '../data/ServerConfig';

/** Debug panel + keyboard shortcuts có được phép không. */
export function isDebugToolsEnabled(): boolean {
    if (!ENABLE_DEBUG_TOOLS) return false;
    return EDITOR || PREVIEW || DEV || DEBUG;
}
