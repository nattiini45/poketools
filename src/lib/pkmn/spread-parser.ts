import type { StatSpread } from '@/types/team';

/**
 * Parse Smogon spread format "Jolly:0/252/4/0/0/252" into structured data.
 */
export function parseSpread(
  spreadKey: string
): { nature: string; evs: StatSpread } | null {
  const colonIdx = spreadKey.indexOf(':');
  if (colonIdx === -1) return null;

  const nature = spreadKey.slice(0, colonIdx);
  const evsStr = spreadKey.slice(colonIdx + 1);
  const parts = evsStr.split('/').map(Number);

  if (parts.length !== 6 || parts.some(isNaN)) return null;

  return {
    nature,
    evs: {
      hp: parts[0],
      atk: parts[1],
      def: parts[2],
      spa: parts[3],
      spd: parts[4],
      spe: parts[5],
    },
  };
}

/**
 * Get the most popular spread from a spreads record.
 */
export function getMostPopularSpread(
  spreads: Record<string, number>
): { nature: string; evs: StatSpread } | null {
  const entries = Object.entries(spreads);
  if (entries.length === 0) return null;

  entries.sort(([, a], [, b]) => b - a);
  return parseSpread(entries[0][0]);
}
