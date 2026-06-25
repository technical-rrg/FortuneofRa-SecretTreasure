/**
 * LocalizationManager - Quản lý đa ngôn ngữ cho SuperNova.
 *
 * ★ CÁCH DÙNG:
 *   import { L } from '../core/LocalizationManager';
 *   label.string = L('good_luck');                        // → "GOOD LUCK!"
 *   label.string = L('free_spin_count', { count: 10 });   // → "10 FREE SPINS"
 *   label.string = L('win_amount', { amount: '500.00' }); // → "WIN $500.00"
 *
 * ★ CHUYỂN NGÔN NGỮ:
 *   LocalizationManager.instance.setLanguage('ko');        // Korean
 *   LocalizationManager.instance.setLanguage('en');        // English (default)
 *
 * ★ SUPPORTED LANGUAGES:
 *   en    — English (default)
 *   ko    — Korean (한국어)
 *   zh-cn — Simplified Chinese (简体中文)
 *   zh-tw — Traditional Chinese (繁體中文)
 *   fil   — Filipino (Tagalog)
 *   ja    — Japanese (日本語)
 *   th    — Thai (ภาษาไทย)
 *
 * ★ 2 CHẾ ĐỘ HOẠT ĐỘNG:
 *   LOCAL:  Dùng file .ts build sẵn trong game (mặc định, offline-safe).
 *   ONLINE: Fetch JSON từ server CDN rồi merge vào local → luôn cập nhật mới nhất.
 *           Gọi loadOnlineLocales(url) khi game start (sau login).
 *           Nếu fetch thất bại → fallback dùng local.
 *
 * ★ THÊM / CẬP NHẬT NGÔN NGỮ:
 *   1. Đối tác gửi file Excel mới
 *   2. Chạy: node tools/convert-localization-xlsx.js <path-to-xlsx>
 *      → Tự sinh tất cả .ts files + locale-online.json
 *   3. Upload locale-online.json lên CDN (cho online mode)
 *
 * ★ Event khi đổi ngôn ngữ:
 *   EventBus.instance.on(GameEvents.LANGUAGE_CHANGED, (code: string) => { ... });
 */

import { EventBus } from './EventBus';
import { GameEvents } from './GameEvents';
import { DEV_FORCE_LANG } from '../data/ServerConfig';

// ─── Language data imports ───
import { LocaleData } from '../data/locales/LocaleTypes';
import { LOCALE_EN } from '../data/locales/en';
import { LOCALE_KO } from '../data/locales/ko';
import { LOCALE_ZH_CN } from '../data/locales/zh-cn';
import { LOCALE_ZH_TW } from '../data/locales/zh-tw';
import { LOCALE_FIL } from '../data/locales/fil';
import { LOCALE_JA } from '../data/locales/ja';
import { LOCALE_TH } from '../data/locales/th';
import { Log } from './Logger';

// ─── Types ───

export type LanguageCode = 'en' | 'ko' | 'zh-cn' | 'zh-tw' | 'fil' | 'ja' | 'th';

// Re-export for backward compatibility
export type { LocaleData };

// ─── Locale registry ───

const LOCALE_MODULES: Record<LanguageCode, LocaleData> = {
    'en':    LOCALE_EN,
    'ko':    LOCALE_KO,
    'zh-cn': LOCALE_ZH_CN,
    'zh-tw': LOCALE_ZH_TW,
    'fil':   LOCALE_FIL,
    'ja':    LOCALE_JA,
    'th':    LOCALE_TH,
};

/**
 * Supported languages list — dùng cho Settings UI dropdown.
 */
export const SUPPORTED_LANGUAGES: { code: LanguageCode; name: string; nativeName: string }[] = [
    { code: 'en',    name: 'English',              nativeName: 'English' },
    { code: 'ko',    name: 'Korean',               nativeName: '한국어' },
    { code: 'zh-cn', name: 'Simplified Chinese',   nativeName: '简体中文' },
    { code: 'zh-tw', name: 'Traditional Chinese',  nativeName: '繁體中文' },
    { code: 'fil',   name: 'Filipino',             nativeName: 'Filipino' },
    { code: 'ja',    name: 'Japanese',             nativeName: '日本語' },
    { code: 'th',    name: 'Thai',                 nativeName: 'ภาษาไทย' },
];

// ═══════════════════════════════════════════════════════════
//  SINGLETON
// ═══════════════════════════════════════════════════════════

export class LocalizationManager {
    private static _instance: LocalizationManager;

    private _currentLang: LanguageCode = 'en'; // ← TEST: đổi lại 'en' khi xong
    private _currentData: LocaleData = LOCALE_EN;
    private _fallbackData: LocaleData = LOCALE_EN;

    /**
     * Bật/tắt tự động phát hiện ngôn ngữ từ thiết bị/trình duyệt.
     * - `true`  → Khi không có ngôn ngữ đã lưu, tự detect từ browser/device.
     * - `false` → Luôn mặc định English nếu không có ngôn ngữ đã lưu (default).
     */
    public autoDetectLanguage: boolean = true;

    /** Online overrides — merge vào local data (online keys ưu tiên hơn local) */
    private _onlineData: Record<string, LocaleData> = {};
    /** Đã load online data thành công chưa */
    private _onlineLoaded: boolean = false;

    static get instance(): LocalizationManager {
        if (!this._instance) {
            this._instance = new LocalizationManager();
        }
        return this._instance;
    }

    /** Ngôn ngữ hiện tại */
    get currentLanguage(): LanguageCode {
        return this._currentLang;
    }

    /** Đã load online locales chưa */
    get isOnlineLoaded(): boolean {
        return this._onlineLoaded;
    }

    /**
     * Trả về số ký tự logic của ký hiệu tiền tệ cho ngôn ngữ hiện tại (hoặc ngôn ngữ chỉ định).
     *
     * Dùng để canh size khung node chứa số tiền:
     *   - 'zh-tw' → 3  (vì ký hiệu là "NT$" — 3 ký tự)
     *   - tất cả còn lại → 1  (ký hiệu là "$", "₩", "¥", "฿", "₱" — 1 ký tự)
     *
     * Ví dụ:
     *   // Tính chiều rộng tối đa cần thiết cho label số tiền:
     *   const charCount = LocalizationManager.instance.getCurrencyCharCount();
     *   const extraWidth = (charCount - 1) * digitWidth;  // padding thêm so với mặc định 1 ký tự
     *
     * @param lang  (Tuỳ chọn) Ngôn ngữ cần kiểm tra. Mặc định là ngôn ngữ hiện tại.
     */
    getCurrencyCharCount(lang?: LanguageCode): number {
        const code = lang ?? this._currentLang;
        if (code === 'zh-tw') return 3;  // NT$ — 3 ký tự
        return 1;
    }

    /**
     * Trả về true nếu ngôn ngữ hiện tại (hoặc ngôn ngữ chỉ định) dùng ký hiệu tiền tệ nhiều ký tự.
     * Tiện cho các điều kiện phân nhánh đơn giản.
     *
     * @param lang  (Tuỳ chọn) Ngôn ngữ cần kiểm tra. Mặc định là ngôn ngữ hiện tại.
     */
    hasMultiCharCurrency(lang?: LanguageCode): boolean {
        return this.getCurrencyCharCount(lang) > 1;
    }

    /**
     * Chuyển ngôn ngữ. Tất cả component đang listen LANGUAGE_CHANGED sẽ tự cập nhật.
     */
    setLanguage(code: LanguageCode): void {
        if (!LOCALE_MODULES[code]) {
            Log.w(`[i18n] Unknown language: ${code}, fallback to 'en'`);
            code = 'en';
        }
        this._currentLang = code;
        this._currentData = this._buildMergedData(code);
        // Persist (Cocos Creator localStorage)
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('supernova_lang', code);
        }
        EventBus.instance.emit(GameEvents.LANGUAGE_CHANGED, code);
    }

    /**
     * Load ngôn ngữ khi game start.
     *
     * Quy tắc:
     * 1. DEV_FORCE_LANG override (dev only)
     * 2. URL query string `gl` parameter takes priority
     * 3. Nếu `gl` không có → default "en"
     * Không đọc Lang từ gp token, không dùng browser language.
     */
    loadSavedLanguage(): void {
        // DEV override — set by Language Switcher extension (Extensions → 🌐 Language Switcher)
        if (DEV_FORCE_LANG !== null && LOCALE_MODULES[DEV_FORCE_LANG as LanguageCode]) {
            this.setLanguage(DEV_FORCE_LANG as LanguageCode);
            return;
        }
        // Rule 1: URL `gl` parameter takes priority; Rule 3: default to "en" if missing
        this.setLanguage(this._detectFromUrlGl());
    }

    /**
     * Detect ngôn ngữ từ URL `gl` hoặc hint được truyền vào.
     * Nếu không có → default "en".
     */
    detectLanguage(langHint?: string): void {
        if (langHint) {
            const normalized = this._normalizeLangCode(langHint);
            if (LOCALE_MODULES[normalized]) {
                this.setLanguage(normalized);
                return;
            }
        }
        // Fallback: URL gl parameter, then default to English
        this.setLanguage(this._detectFromUrlGl());
    }

    /**
     * Lấy text đã dịch theo key.
     * Hỗ trợ placeholder: {count}, {amount}, {name}, ...
     *
     * @param key     Localization key (e.g. 'good_luck', 'win_amount')
     * @param params  Placeholder values (e.g. { count: 10, amount: '500.00' })
     * @returns       Translated string (fallback English nếu thiếu)
     */
    getText(key: string, params?: Record<string, string | number>): string {
        let text = this._currentData[key] ?? this._fallbackData[key] ?? `[${key}]`;
        if (params) {
            for (const k in params) {
                text = text.split(`{${k}}`).join(String(params[k]));
            }
        }
        return text;
    }

    // ═══════════════════════════════════════════════════════════
    //  ONLINE MODE — Fetch locale JSON từ server CDN
    // ═══════════════════════════════════════════════════════════

    /**
     * Fetch locale data từ remote URL và merge vào local data.
     *
     * ★ Gọi khi game start (sau login hoặc trong loading screen).
     * ★ Nếu fetch thất bại → tiếp tục dùng local data (không block game).
     * ★ Sau khi load xong → tự emit LANGUAGE_CHANGED để UI refresh.
     *
     * @param url  URL tới file locale-online.json (hoặc API endpoint).
     *             Format: { "en": { key: value, ... }, "ko": { ... }, ... }
     *
     * Ví dụ:
     *   await LocalizationManager.instance.loadOnlineLocales(
     *     'https://cdn.example.com/supernova/locale-online.json'
     *   );
     */
    async loadOnlineLocales(url: string): Promise<boolean> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                Log.w(`[i18n] Online locale fetch failed: ${response.status}`);
                return false;
            }
            const json = await response.json();
            if (typeof json !== 'object' || json === null) {
                Log.w('[i18n] Online locale data invalid format');
                return false;
            }

            // Validate & store per-language data
            for (const lang of Object.keys(json)) {
                if (typeof json[lang] === 'object' && json[lang] !== null) {
                    this._onlineData[lang] = json[lang] as LocaleData;
                }
            }

            this._onlineLoaded = true;

            // Rebuild current data with online overrides
            this._currentData = this._buildMergedData(this._currentLang);
            this._fallbackData = this._buildMergedData('en');

            // Emit event để tất cả UI component refresh text
            EventBus.instance.emit(GameEvents.LANGUAGE_CHANGED, this._currentLang);

            const onlineLangs = Object.keys(this._onlineData);
            Log.d(`[i18n] Online locales loaded: ${onlineLangs.join(', ')}`);
            return true;
        } catch (err) {
            Log.w('[i18n] Online locale fetch error:', err);
            return false;
        }
    }

    /**
     * Load online data từ raw JSON object (dùng khi server trả locale trong Enter response
     * hoặc khi embed JSON trực tiếp).
     */
    loadOnlineLocalesFromData(data: Record<string, LocaleData>): void {
        for (const lang of Object.keys(data)) {
            if (typeof data[lang] === 'object' && data[lang] !== null) {
                this._onlineData[lang] = data[lang];
            }
        }
        this._onlineLoaded = true;
        this._currentData = this._buildMergedData(this._currentLang);
        this._fallbackData = this._buildMergedData('en');
        EventBus.instance.emit(GameEvents.LANGUAGE_CHANGED, this._currentLang);
    }

    // ─── Private ───

    /**
     * Merge local + online data cho 1 ngôn ngữ.
     * Local là base, online override (ưu tiên cao hơn).
     */
    private _buildMergedData(code: LanguageCode): LocaleData {
        const local = LOCALE_MODULES[code] || LOCALE_EN;
        const online = this._onlineData[code];
        if (!online) return local;
        // Merge: local base + online override
        return { ...local, ...online };
    }

    /**
     * Đọc `gl` từ URL query string và trả về LanguageCode.
     * Nếu không có hoặc không nhận ra → trả về 'en'.
     */
    private _detectFromUrlGl(): LanguageCode {
        if (typeof window !== 'undefined' && window.location && window.location.search) {
            const urlParams = new URLSearchParams(window.location.search);
            const gl = urlParams.get('gl');
            if (gl) {
                const normalized = this._normalizeLangCode(gl);
                Log.d(`[i18n] gl="${gl}" → language: ${normalized}`);
                return normalized;
            }
        }
        return 'en';
    }

    /**
     * Chuẩn hoá language code theo spec:
     *   zh-s, zh-c  → zh-cn  (Simplified Chinese / zh-Hans)
     *   zh-t        → zh-tw  (Traditional Chinese / zh-Hant)
     *   tl          → fil    (Filipino / fil-PH)
     *   Others      → as-is mapping (ko, en, ja, th, fil, ...)
     */
    private _normalizeLangCode(input: string): LanguageCode {
        const lower = input.toLowerCase().trim();

        // Special conversions per spec
        if (lower === 'zh-s' || lower === 'zh-c') return 'zh-cn'; // zh-Hans
        if (lower === 'zh-t') return 'zh-tw';                       // zh-Hant
        if (lower === 'tl') return 'fil';                           // fil-PH

        // General Chinese variants
        if (lower.startsWith('zh')) {
            if (lower.includes('tw') || lower.includes('hant') || lower.includes('hk')) {
                return 'zh-tw';
            }
            return 'zh-cn';
        }

        if (lower.startsWith('ko')) return 'ko';
        if (lower.startsWith('ja')) return 'ja';
        if (lower.startsWith('th')) return 'th';
        if (lower.startsWith('fil')) return 'fil';
        if (lower.startsWith('en')) return 'en';
        return 'en';
    }
}

// ═══════════════════════════════════════════════════════════
//  SHORTCUT FUNCTION — import { L } from '...'
// ═══════════════════════════════════════════════════════════

/**
 * Shortcut: L('key') hoặc L('key', { count: 5 }).
 * Viết tắt cho LocalizationManager.instance.getText().
 */
export function L(key: string, params?: Record<string, string | number>): string {
    return LocalizationManager.instance.getText(key, params);
}
