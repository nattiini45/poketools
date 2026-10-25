/**
 * The scoring rules a standings table follows, resolved in one place (pure, client-safe).
 *
 * Evolution Point Buy tables rank by the season's stored tiebreaker order (`format_rules.tiebreaker_order`, edited
 * on the league's Rules tab) and score the format pack's match points (`epb.matchPoints`). Every caller that picks a
 * chain or the points of a table asks this module, so no surface ranks by a different rule than another.
 *
 * Every other league type keeps the numbers it always had: round robin 3 points a win and 0 a draw, Swiss the
 * generic 1 and a half.
 */
import { epbPack } from '@/lib/format-pack';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import type { TiebreakerStep } from '@/types/format-rules';

/** The pack section the helpers read; tests pass their own. */
export type StandingsPack = Pick<typeof epbPack, 'matchPoints' | 'tiebreakerChain'>;

/**
 * The steps the standings engine knows. A ranking step compares two rows; `decision_match` is the flag that marks
 * a complete tie and ranks nothing (`evolution-standings.ts`).
 */
const RANKING_STEPS: ReadonlySet<string> = new Set<TiebreakerStep>([
  'match_points',
  'evolution_points',
  'kill_difference',
  'head_to_head',
]);
const DECISION_MATCH: TiebreakerStep = 'decision_match';

/**
 * Whether `value` is a chain the standings can rank by: a non-empty list of known steps, none twice, at least one
 * of them a ranking step, and `decision_match` (a flag, not a comparison) only as the last step. This is what the
 * format rules editor and the pack schema enforce on a save; the check here also guards a row written some other
 * way (an import, a hand edit, an older release).
 */
export function isUsableTiebreakerChain(value: unknown): value is TiebreakerStep[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (new Set(value).size !== value.length) return false;
  let rankingSteps = 0;
  for (let i = 0; i < value.length; i++) {
    const step: unknown = value[i];
    if (step === DECISION_MATCH) {
      if (i !== value.length - 1) return false;
    } else if (typeof step === 'string' && RANKING_STEPS.has(step)) {
      rankingSteps++;
    } else {
      return false;
    }
  }
  return rankingSteps > 0;
}

/**
 * The chain an Evolution Point Buy table ranks by: the season's stored `tiebreaker_order` when it is usable
 * (`isUsableTiebreakerChain`), else the pack's chain. A missing row, an empty list, an unknown step, a repeated
 * step or a misplaced `decision_match` fall back to the pack and never throw.
 *
 * `rules` takes anything that may carry the order (a `FormatRules` row, the `{ tiebreaker_order }` slice of a
 * standings context, a raw row), so every surface passes what it holds.
 */
export function effectiveTiebreakerChain(
  rules: { tiebreaker_order?: unknown } | null | undefined,
  pack: Pick<StandingsPack, 'tiebreakerChain'> = epbPack,
): TiebreakerStep[] {
  const stored = rules?.tiebreaker_order;
  return isUsableTiebreakerChain(stored) ? [...stored] : [...pack.tiebreakerChain];
}

/** The match points a table scores. A field left out means the table's own default. */
export interface MatchPoints {
  pointsPerWin?: number;
  pointsPerDraw?: number;
}

/** Round robin tables score 3 points a win and 0 a draw (every league type except Evolution Point Buy). */
export const ROUND_ROBIN_MATCH_POINTS: Required<MatchPoints> = { pointsPerWin: 3, pointsPerDraw: 0 };

/**
 * The match points a table of `formatType` scores. An Evolution Point Buy table scores the pack's points, whatever
 * the caller asked for, for round robin and Swiss alike; the hard-coded round robin 3/0 of the other league types
 * never reaches it. Every other format (and a standalone tournament, `null`) gets `requested` back unchanged, so
 * its numbers are exactly what its caller chose. The bracket type does not change the answer: a stage table and
 * a season-wide table of the same Evolution Point Buy league score the same points.
 */
export function effectiveMatchPoints(
  formatType: string | null | undefined,
  requested: MatchPoints = {},
  pack: Pick<StandingsPack, 'matchPoints'> = epbPack,
): MatchPoints {
  if (formatType && isEvolutionPointBuy(formatType)) {
    return { pointsPerWin: pack.matchPoints.win, pointsPerDraw: pack.matchPoints.draw };
  }
  return requested;
}

/**
 * The points of a round robin table of `formatType`: the pack's for Evolution Point Buy, 3 a win and 0 a draw for
 * every other format.
 */
export function roundRobinMatchPoints(
  formatType: string | null | undefined,
  pack: Pick<StandingsPack, 'matchPoints'> = epbPack,
): MatchPoints {
  return effectiveMatchPoints(formatType, ROUND_ROBIN_MATCH_POINTS, pack);
}
