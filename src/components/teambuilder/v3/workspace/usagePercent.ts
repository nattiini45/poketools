import { INTL_TAG, type Locale } from '@/i18n/config';

const formats = new Map<string, Intl.NumberFormat>();

/**
 * A usage share (0–1) with a fixed number of decimals, so picker columns stay
 * aligned: `0.123` → "12.3%" (en) | "12,3 %" (de); `digits = 0` → "12%" | "12 %".
 * Same output as the former `(pct * 100).toFixed(digits) + '%'` in English.
 * Formats are cached per locale and precision.
 */
export function formatUsagePct(ratio: number, locale: Locale, digits = 1): string {
  const key = `${locale}:${digits}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(INTL_TAG[locale], {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formats.set(key, format);
  }
  return format.format(ratio);
}
