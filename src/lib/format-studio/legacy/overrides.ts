/**
 * Legacy `bo_overrides` to kit series overrides. A phase stores its per-round match lengths under the English
 * round names the bracket generators write ("Finals", "Semifinals", "Quarterfinals", "Round 3", "Winners Round 2",
 * "Grand Finals"). The kit counts rounds by number, from the start or from the end of the stage, so only the names
 * that mean exactly one such round are mapped:
 *
 * - single elimination: "Finals" is the last round, "Semifinals" the second to last, "Quarterfinals" the third to
 *   last (`getRoundName` in `src/lib/tournament/single-elim.ts` names a round by its distance from the end);
 * - round robin, Swiss and single elimination: "Round N" is round N from the start (N 1..64).
 *
 * Everything else (every double-elimination name, unknown names, a round number out of range, entries beyond the
 * kit's limit) is returned as `unmapped`, so the descriptor keeps it as a text section instead of dropping it.
 */
import { MAX_BEST_OF, MAX_OVERRIDE_ROUND, MAX_OVERRIDES, type SeriesOverride } from '@/lib/format-kit/client';
import type { LegacyStageInput } from './types';

export interface MappedOverrides {
  overrides: SeriesOverride[];
  /** Entries the kit cannot express, in name order. */
  unmapped: { name: string; bestOf: number }[];
}

const FROM_END: Readonly<Record<string, number>> = { Finals: 1, Semifinals: 2, Quarterfinals: 3 };
const ROUND_NAME = /^Round ([1-9][0-9]{0,2})$/;

function clampBestOf(value: number): number {
  return Math.min(MAX_BEST_OF, Math.max(1, value));
}

function mapName(bracket: LegacyStageInput['bracketType'], name: string): Pick<SeriesOverride, 'round' | 'from'> | null {
  if (bracket === 'single_elim' && Object.prototype.hasOwnProperty.call(FROM_END, name)) {
    return { round: FROM_END[name], from: 'end' };
  }
  if (bracket === 'double_elim') return null;
  const match = ROUND_NAME.exec(name);
  if (match === null) return null;
  const round = Number(match[1]);
  return round >= 1 && round <= MAX_OVERRIDE_ROUND ? { round, from: 'start' } : null;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function mapOverrides(bracket: LegacyStageInput['bracketType'], stored: Readonly<Record<string, number>>): MappedOverrides {
  const mapped: SeriesOverride[] = [];
  const unmapped: { name: string; bestOf: number }[] = [];
  const names = Object.keys(stored ?? {}).sort(compareText);
  for (const name of names) {
    const raw = stored[name];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) continue;
    const bestOf = Math.trunc(raw);
    const target = mapName(bracket, name);
    if (target === null) unmapped.push({ name, bestOf });
    else mapped.push({ ...target, best_of: clampBestOf(bestOf) });
  }
  // Round first, then the rounds counted from the start before those counted from the end.
  mapped.sort((a, b) => a.round - b.round || (a.from === b.from ? 0 : a.from === 'start' ? -1 : 1));
  const overflow = mapped.splice(MAX_OVERRIDES);
  for (const entry of overflow) {
    const name = entry.from === 'end' ? Object.keys(FROM_END).find((n) => FROM_END[n] === entry.round) : `Round ${entry.round}`;
    unmapped.push({ name: name ?? `Round ${entry.round}`, bestOf: entry.best_of });
  }
  unmapped.sort((a, b) => compareText(a.name, b.name));
  return { overrides: mapped, unmapped };
}
