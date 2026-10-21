/**
 * Whether a league group can create its Initial draft, as the admin Draft tab tells it (pure, server side).
 *
 * The seat bounds are `draft__validate_seats` / `draft_start`'s (`DRAFT_CONFIG_LIMITS.participant_order`). The
 * completability check is the TS twin of the check `draft_start` runs (LEAGUE_NOT_COMPLETABLE): every member starts
 * with the same budget and roster size, nobody holds a line of this group yet (a group's lines are its own), and
 * nothing is restricted, so the free lines are the whole list. The SQL stays authoritative: this only warns before
 * a draft is created that could never start.
 */
import { poolCompletability, type PoolLine, type PoolTotals } from '@/lib/draft/completability';

export type GroupDraftGate =
  | { kind: 'empty' }
  | { kind: 'tooFew'; count: number }
  | { kind: 'tooMany'; count: number }
  | { kind: 'notCompletable'; totals: PoolTotals }
  | { kind: 'undecided' }
  | { kind: 'ready' };

export interface GroupDraftGateInput {
  memberCount: number;
  /** One entry per line of the bound list (line id and price). */
  lines: readonly PoolLine[];
  budget: number;
  rosterSize: number;
  minSeats: number;
  maxSeats: number;
}

export function groupDraftGate(input: GroupDraftGateInput): GroupDraftGate {
  const { memberCount, lines, budget, rosterSize, minSeats, maxSeats } = input;
  if (memberCount === 0) return { kind: 'empty' };
  if (memberCount < minSeats) return { kind: 'tooFew', count: memberCount };
  if (memberCount > maxSeats) return { kind: 'tooMany', count: memberCount };
  const result = poolCompletability({
    lines,
    participants: Array.from({ length: memberCount }, (_, index) => ({
      playerId: `seat-${index + 1}`,
      openSlots: rosterSize,
      budget,
    })),
  });
  if (result.status === 'not_completable') return { kind: 'notCompletable', totals: result.totals };
  if (result.status === 'undecided') return { kind: 'undecided' };
  return { kind: 'ready' };
}
