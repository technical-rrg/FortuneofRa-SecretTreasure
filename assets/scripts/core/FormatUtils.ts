/**
 * FormatUtils - Các hàm tiện ích định dạng hiển thị.
 */

/**
 * Định dạng số thành chuỗi tiền tệ chuẩn Mỹ.
 * - >= 100K: tự động áp dụng KMBT notation
 * - < 100K: dấu phẩy phân cách hàng nghìn, dấu chấm cho phần thập phân (tối đa 3 chữ số)
 * - Số nguyên < 100K: không hiển thị phần thập phân
 *
 * Ví dụ:
 *   formatCurrency(1234567.891)  → '1234.5K'
 *   formatCurrency(1000)         → '1,000'
 *   formatCurrency(0.5)          → '0.500'
 *   formatCurrency(9.1)          → '9.100'
 *   formatCurrency(150500)       → '150.5K'
 * 
 */
export function formatCurrency(value: number): string {
    // >= 100K: dùng KMBT notation
    //if (value >= 1e5) return formatKMBT(value);

    // Loại bỏ floating-point noise (e.g. 0.8999999... → 0.9, 449.9999... → 450)
    const clean = Math.round(value * 1e9) / 1e9;
    const isInteger = Number.isInteger(clean) || Math.abs(clean - Math.round(clean)) < 0.0005;
    if (isInteger) {
        return Math.round(clean).toLocaleString('en-US');
    }
    const fixed9 = clean.toFixed(9);
    const [rawInt, rawDec = ''] = fixed9.split('.');
    const fixed = `${rawInt}.${rawDec.padEnd(3, '0').slice(0, 3)}`;
    const [intPart, decPart] = fixed.split('.');
    const formattedInt = parseInt(intPart, 10).toLocaleString('en-US');
    return `${formattedInt}.${decPart}`;
}

/**
 * LUÔN hiển thị đúng 2 chữ số thập phân (dùng cho BetSettingsPopup).
 * Ví dụ:
 *   formatCurrency2(1)    → '1.00'
 *   formatCurrency2(9)    → '9.00'
 *   formatCurrency2(0.5)  → '0.50'
 *   formatCurrency2(1234.5) → '1,234.50'
 */
export function formatCurrency2(value: number): string {
    const clean = Math.round(value * 1e9) / 1e9;
    const fixed = clean.toFixed(2);
    const [intPart, decPart] = fixed.split('.');
    const formattedInt = parseInt(intPart, 10).toLocaleString('en-US');
    return `${formattedInt}.${decPart}`;
}

/**
 * Giống formatCurrency nhưng LUÔN hiển thị đủ 3 chữ số thập phân khi < 100K.
 * >= 100K: tự động áp dụng KMBT notation.
 * Ví dụ:
 *   formatCurrencyFixed(1000)    → '1,000.000'
 *   formatCurrencyFixed(9.1)     → '9.100'
 *   formatCurrencyFixed(0)       → '0.000'
 *   formatCurrencyFixed(150500)  → '150.5K'
 */
export function formatCurrencyFixed(value: number): string {
    // >= 100K: dùng KMBT notation
  //  if (value >= 1e5) return formatKMBT(value);

    const clean = Math.round(value * 1e9) / 1e9;
    const fixed9 = clean.toFixed(9);
    const [rawInt, rawDec = ''] = fixed9.split('.');
    const fixed = `${rawInt}.${rawDec.padEnd(3, '0').slice(0, 3)}`;
    const [intPart, decPart] = fixed.split('.');
    const formattedInt = parseInt(intPart, 10).toLocaleString('en-US');
    return `${formattedInt}.${decPart}`;
}

/**
 * Format số thành chuỗi K/M/B/T theo KMBT USAGE RULES.
 * - Bắt đầu dùng KMBT từ 100K trở lên.
 * - Tối đa 1 chữ số thập phân; >= 100 đơn vị thì hiển thị nguyên.
 *
 * Thresholds:
 *   K: 100,000+      (chia 1,000)     — 1 decimal; luôn cho phép
 *   M: 10,000,000+   (chia 1,000,000) — 1 decimal nếu < 100M, nguyên nếu >= 100M
 *   B: 10,000,000,000+ (chia 1e9)     — 1 decimal nếu < 100B, nguyên nếu >= 100B
 *   T: 10,000,000,000,000+ (chia 1e12) — 1 decimal nếu < 100T, nguyên nếu >= 100T
 *
 * Ví dụ:
 *   formatKMBT(99999)          → '99,999'
 *   formatKMBT(100000)         → '100K'
 *   formatKMBT(150500)         → '150.5K'
 *   formatKMBT(1000000)        → '1000K'
 *   formatKMBT(10000000)       → '10M'
 *   formatKMBT(15500000)       → '15.5M'
 *   formatKMBT(100000000)      → '100M'
 *   formatKMBT(1300000000)     → '1300M'
 *   formatKMBT(10000000000)    → '10B'
 *   formatKMBT(100000000000)   → '100B'
 *   formatKMBT(10000000000000) → '10T'
 *   formatKMBT(100000000000000)→ '100T'
 */
export function formatKMBT(value: number): string {
    if (value < 1e5) {
        // Dưới 100K: hiển thị bình thường có dấu phẩy
        return Math.floor(value).toLocaleString('en-US');
    }

    // T: >= 10 nghìn tỷ (1e13)
    if (value >= 1e13) {
        const t = Math.floor(value / 1e12);
        if (value >= 1e14) return t + 'T'; // >= 100T: nguyên
        const t1 = Math.floor(value / 1e11) / 10;
        return (t1 % 1 === 0 ? t1.toFixed(0) : t1.toFixed(1)) + 'T';
    }

    // B: >= 10 tỷ (1e10)
    if (value >= 1e10) {
        const b = Math.floor(value / 1e9);
        if (value >= 1e11) return b + 'B'; // >= 100B: nguyên
        const b1 = Math.floor(value / 1e8) / 10;
        return (b1 % 1 === 0 ? b1.toFixed(0) : b1.toFixed(1)) + 'B';
    }

    // M: >= 10 triệu (1e7)
    if (value >= 1e7) {
        const m = Math.floor(value / 1e6);
        if (value >= 1e8) return m + 'M'; // >= 100M: nguyên
        const m1 = Math.floor(value / 1e5) / 10;
        return (m1 % 1 === 0 ? m1.toFixed(0) : m1.toFixed(1)) + 'M';
    }

    // K: >= 100 nghìn (1e5)
    const k1 = Math.floor(value / 100) / 10;
    return (k1 % 1 === 0 ? k1.toFixed(0) : k1.toFixed(1)) + 'K';
}
