/**
 * USDT locale (usdt) — USD₮
 *
 * Dùng chung text English; chỉ khác ký hiệu tiền tệ.
 * Không cần font riêng (dùng default Latin font).
 */
import { LocaleData } from './LocaleTypes';
import { LOCALE_EN } from './en';

export const LOCALE_USDT: LocaleData = {
    ...LOCALE_EN,
    currency_symbol: 'USD₮',
    CLIENT_CURRENENCY_SYMBOL: 'USD₮',
};
