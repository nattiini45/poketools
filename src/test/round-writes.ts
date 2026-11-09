/**
 * Test helper for the route tests of the three round generators (generate-round, generate-all-rounds, rounds/manual).
 * They write a round and its matches through `createRoundWithMatches` (a new round) or `addMatchesToRound` (a round an
 * interrupted call left empty), both mocked in those tests; this reads what was handed to them.
 */
import type { RoundMatchInput } from '@/lib/supabase/queries/rounds';

interface MockCalls {
  mock: { calls: unknown[][]; invocationCallOrder: number[] };
}

/**
 * The non-empty batches of matches the routes wrote, in call order: the `matches` of every `createRoundWithMatches`
 * call and the matches argument of every `addMatchesToRound` call.
 */
export function writtenBatches(createRoundWithMatches: MockCalls, addMatchesToRound: MockCalls): RoundMatchInput[][] {
  const writes = [
    ...createRoundWithMatches.mock.calls.map((call, index) => ({
      order: createRoundWithMatches.mock.invocationCallOrder[index],
      matches: (call[0] as { matches: RoundMatchInput[] }).matches,
    })),
    ...addMatchesToRound.mock.calls.map((call, index) => ({
      order: addMatchesToRound.mock.invocationCallOrder[index],
      matches: call[1] as RoundMatchInput[],
    })),
  ];
  return writes.sort((a, b) => a.order - b.order).map((write) => write.matches).filter((matches) => matches.length > 0);
}
