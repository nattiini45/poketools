import type { Formatter } from '@/i18n/format';

/**
 * Number formats of the stats tables, in the viewer's locale. They keep the
 * fixed decimals the tables always showed (`toFixed`): `12.5` -> `12.5%` |
 * `12,5 %`, efficiency `1.5` -> `1.50` | `1,50`.
 */
export function fixedPercent(f: Formatter, value100: number, digits = 1): string {
  return f.number(value100 / 100, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fixedNumber(f: Formatter, value: number, digits: number): string {
  return f.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
