import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const results: { data: unknown; error: unknown }[] = [];
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(results.shift() ?? { data: null, error: null });
    },
  };
  return { calls, results, client };
});

vi.mock('../../client', () => ({ supabase: h.client }));

import { addMatchesToRound, createRoundWithMatches } from '../rounds';

const roundRow = {
  id: 'r-2',
  tournament_id: 't-1',
  name: 'Round 2',
  round_number: 2,
  best_of: 3,
  status: 'pending',
  pairings_generated: true,
  bye_player_ids: ['p-9'],
};

const matches = [
  { player_1_id: 'p-1', player_2_id: 'p-2' },
  { player_1_id: 'p-3', player_2_id: 'p-4' },
];

const signal = (message: string) => ({ code: 'P0001', message, details: null, hint: null });

describe('createRoundWithMatches', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.results.length = 0;
  });

  it('writes the round and its matches in one database call (round_write), without a round id', async () => {
    h.results.push({ data: { round: roundRow, matches: 2 }, error: null });

    const round = await createRoundWithMatches({
      tournament_id: 't-1',
      name: 'Round 2',
      round_number: 2,
      best_of: 3,
      bye_player_ids: ['p-9'],
      matches,
    });

    expect(round).toMatchObject({ id: 'r-2', name: 'Round 2', round_number: 2, bye_player_ids: ['p-9'] });
    expect(h.calls).toEqual([
      {
        fn: 'round_write',
        args: {
          p_tournament_id: 't-1',
          p_round_id: null,
          p_name: 'Round 2',
          p_round_number: 2,
          p_best_of: 3,
          p_bye_player_ids: ['p-9'],
          p_matches: matches,
        },
      },
    ]);
  });

  it('sends only the two players of a match, and an empty bye list when the round has none', async () => {
    h.results.push({ data: { round: roundRow, matches: 1 }, error: null });

    await createRoundWithMatches({
      tournament_id: 't-1',
      name: 'Round 2',
      round_number: 2,
      best_of: 3,
      matches: [{ player_1_id: 'p-1', player_2_id: 'p-2', round_id: 'x', tournament_id: 'y' } as never],
    });

    expect(h.calls[0].args.p_matches).toEqual([{ player_1_id: 'p-1', player_2_id: 'p-2' }]);
    expect(h.calls[0].args.p_bye_player_ids).toEqual([]);
  });

  it('maps a phase that completed first to 409 rounds_phase_completed (nothing was written)', async () => {
    h.results.push({ data: null, error: signal('rounds_phase_completed') });

    await expect(
      createRoundWithMatches({ tournament_id: 't-1', name: 'Round 2', round_number: 2, best_of: 3, matches }),
    ).rejects.toMatchObject({ code: 'rounds_phase_completed', statusCode: 409 });
  });

  it('maps a tournament that is gone to 404 tournament_not_found', async () => {
    h.results.push({ data: null, error: signal('tournament_not_found') });

    await expect(
      createRoundWithMatches({ tournament_id: 't-1', name: 'Round 2', round_number: 2, best_of: 3, matches }),
    ).rejects.toMatchObject({ code: 'tournament_not_found', statusCode: 404 });
  });

  it('keeps the other refusals of a round insert: the round number unique violation and the stale phase groups', async () => {
    h.results.push({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "rounds_tournament_round_number_key"',
        details: 'Key (tournament_id, round_number)=(t-1, 2) already exists.',
        hint: null,
      },
    });
    await expect(
      createRoundWithMatches({ tournament_id: 't-1', name: 'Round 2', round_number: 2, best_of: 3, matches }),
    ).rejects.toMatchObject({ code: 'rounds_round_already_written', statusCode: 409, params: { round: 'Round 2' } });

    h.results.push({ data: null, error: signal('PHASE_GROUPS_STALE') });
    await expect(
      createRoundWithMatches({ tournament_id: 't-1', name: 'Round 1', round_number: 1, best_of: 3, matches }),
    ).rejects.toMatchObject({ code: 'PHASE_GROUPS_STALE', statusCode: 409 });
  });

  it('rethrows an error it does not know, unchanged', async () => {
    const other = { code: '40001', message: 'could not serialize access', details: null, hint: null };
    h.results.push({ data: null, error: other });

    await expect(
      createRoundWithMatches({ tournament_id: 't-1', name: 'Round 2', round_number: 2, best_of: 3, matches }),
    ).rejects.toBe(other);
  });

  it('fails loudly on a result without a round', async () => {
    h.results.push({ data: { matches: 0 }, error: null });

    await expect(
      createRoundWithMatches({ tournament_id: 't-1', name: 'Round 2', round_number: 2, best_of: 3, matches }),
    ).rejects.toThrow('round_write returned an unexpected result');
  });
});

describe('addMatchesToRound', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.results.length = 0;
  });

  const round = { id: 'r-2', name: 'Round 2', tournament_id: 't-1' };

  it('adds the matches to the round that exists, through the same function and its phase lock', async () => {
    h.results.push({ data: { round: roundRow, matches: 2 }, error: null });

    await addMatchesToRound(round, matches);

    expect(h.calls).toEqual([
      {
        fn: 'round_write',
        args: {
          p_tournament_id: 't-1',
          p_round_id: 'r-2',
          p_name: null,
          p_round_number: null,
          p_best_of: null,
          p_bye_player_ids: null,
          p_matches: matches,
        },
      },
    ]);
  });

  it('writes nothing for an empty list without byes', async () => {
    await addMatchesToRound(round, []);

    expect(h.calls).toEqual([]);
  });

  it('hands new byes to the same write, so they roll back with a refused one', async () => {
    h.results.push({ data: { round: roundRow, matches: 2 }, error: null });

    await addMatchesToRound(round, matches, ['p-9']);

    expect(h.calls).toEqual([
      {
        fn: 'round_write',
        args: {
          p_tournament_id: 't-1',
          p_round_id: 'r-2',
          p_name: null,
          p_round_number: null,
          p_best_of: null,
          p_bye_player_ids: ['p-9'],
          p_matches: matches,
        },
      },
    ]);
  });

  it('writes a round of byes only (no matches) through the write when byes are given, an empty bye list included', async () => {
    h.results.push({ data: { round: roundRow, matches: 0 }, error: null });
    h.results.push({ data: { round: roundRow, matches: 0 }, error: null });

    await addMatchesToRound(round, [], ['p-9']);
    await addMatchesToRound(round, [], []);

    expect(h.calls.map((call) => call.fn)).toEqual(['round_write', 'round_write']);
    expect(h.calls.map((call) => (call.args as { p_bye_player_ids: unknown }).p_bye_player_ids)).toEqual([['p-9'], []]);
    expect(h.calls.map((call) => (call.args as { p_matches: unknown }).p_matches)).toEqual([[], []]);
  });

  it('maps a phase that completed first to 409 when the write carried byes', async () => {
    h.results.push({ data: null, error: signal('rounds_phase_completed') });

    await expect(addMatchesToRound(round, matches, ['p-9'])).rejects.toMatchObject({ code: 'rounds_phase_completed', statusCode: 409 });
  });

  it('maps a phase that completed first to 409 rounds_phase_completed', async () => {
    h.results.push({ data: null, error: signal('rounds_phase_completed') });

    await expect(addMatchesToRound(round, matches)).rejects.toMatchObject({ code: 'rounds_phase_completed', statusCode: 409 });
  });

  it('does not word a refusal of the round that is gone as a phase refusal', async () => {
    const gone = signal('round_not_found');
    h.results.push({ data: null, error: gone });

    await expect(addMatchesToRound(round, matches)).rejects.toBe(gone);
  });
});
