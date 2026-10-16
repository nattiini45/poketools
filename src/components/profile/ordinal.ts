/** The English ordinal suffix of `n` (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st…); keys of `profile.ordinal`. */
export type OrdinalSuffix = 'st' | 'nd' | 'rd' | 'th';

export function ordinalSuffix(n: number): OrdinalSuffix {
  const v = Math.abs(n) % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (v % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
