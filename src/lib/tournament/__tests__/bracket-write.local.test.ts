import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';
import { assertLoopbackUrl, localStackOptIn } from '@/test/local-stack';
import type { ParticipantWithSeed, Tournament } from '@/types/tournament';

// LIVE-LOCAL proof of the locked bracket writer (supabase/migrations/20261109210000_bracket_write.sql): a bracket is
// written or replaced in one transaction under the phase row lock, only while the status is still the one the caller
// read, so a completion that races a regenerate (an admin's guarded status write, the format's stage end) is never
// overwritten and never ends up holding a freshly generated bracket. It runs the real generate and regenerate against a
// LOCAL Supabase stack. Opt-in only, never in CI without LOCAL_STACK_CI=1, and it never loads `.env`.
//
//   LOCAL_BRACKET_WRITE=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/tournament/__tests__/bracket-write.local.test.ts
//
// (`npm run test:db` passes all three from `supabase status`.)
const optIn = localStackOptIn('LOCAL_BRACKET_WRITE');

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error('[bracket-write.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY');
  }
}

type ClientMod = typeof import('@/lib/supabase/client');
type GenerateMod = typeof import('@/lib/tournament/bracket-generate');
type TournamentsMod = typeof import('@/lib/supabase/queries/tournaments');
type RoundsMod = typeof import('@/lib/supabase/queries/rounds');

let client: ClientMod['supabase'];
let bracket: GenerateMod;
let tournaments: TournamentsMod;
let rounds: RoundsMod;

const RUN = randomUUID().slice(0, 8);
const rulesetId = randomUUID();
const playerIds = Array.from({ length: 4 }, () => randomUUID());
const tournamentIds: string[] = [];

function participants(): ParticipantWithSeed[] {
  return playerIds.map((id, index) => ({
    id,
    name: `Bracket ${RUN} ${index + 1}`,
    seed: index + 1,
    starting_bracket: 'winners',
    discord_id: null,
    auth_user_id: null,
    ps_username: '',
    champions_username: '',
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: null,
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
}

async function must<T extends { error: unknown }>(label: string, op: PromiseLike<T>): Promise<T> {
  const result = await op;
  if (result.error) throw new Error(`[bracket-write.local ${label}] ${JSON.stringify(result.error)}`);
  return result;
}

/**
 * An active single-elimination phase that already has a bracket: one round, and `withMatch` a scheduled match in it (a
 * phase whose round holds no match counts as settled for the stage end). Returns the tournament as a route reads it.
 */
async function seedActiveBracket(label: string, withMatch: boolean): Promise<{ tournament: Tournament; oldRoundId: string }> {
  const id = randomUUID();
  tournamentIds.push(id);
  await must(
    'tournament',
    client.from('tournaments').insert({
      id,
      name: `Bracket ${RUN} ${label}`,
      bracket_type: 'single_elim',
      ruleset_id: rulesetId,
      status: 'active',
      current_round: 1,
    }),
  );
  const oldRoundId = randomUUID();
  await must('round', client.from('rounds').insert({ id: oldRoundId, tournament_id: id, name: 'Old Finals', round_number: 1, best_of: 3 }));
  if (withMatch) {
    await must(
      'match',
      client.from('matches').insert({ round_id: oldRoundId, tournament_id: id, player_1_id: playerIds[0], player_2_id: playerIds[1] }),
    );
  }
  const tournament = await tournaments.getTournamentById(id);
  if (!tournament) throw new Error('[bracket-write.local] seeded tournament not found');
  return { tournament, oldRoundId };
}

async function state(id: string): Promise<{ status: string; roundIds: string[]; matches: number }> {
  const { data: row } = await must('status', client.from('tournaments').select('status').eq('id', id).single());
  const { data: roundRows } = await must('rounds', client.from('rounds').select('id').eq('tournament_id', id));
  const { count } = await must('matches', client.from('matches').select('id', { count: 'exact', head: true }).eq('tournament_id', id));
  return { status: row?.status ?? 'missing', roundIds: (roundRows ?? []).map((round) => round.id), matches: count ?? 0 };
}

describe.skipIf(!optIn)('bracket_write: the locked bracket writer (local stack)', () => {
  beforeAll(async () => {
    ({ supabase: client } = await import('@/lib/supabase/client'));
    bracket = await import('@/lib/tournament/bracket-generate');
    tournaments = await import('@/lib/supabase/queries/tournaments');
    rounds = await import('@/lib/supabase/queries/rounds');
    await must('ruleset', insertLocalRuleset(client, { id: rulesetId, name: `Bracket ${RUN} Ruleset` }));
    await must(
      'players',
      client.from('players').insert(
        playerIds.map((id, index) => ({ id, name: `Bracket ${RUN} ${index + 1}`, discord_id: `bracket-${RUN}-${index}` })),
        { defaultToNull: false },
      ),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    if (tournamentIds.length > 0) {
      await del('matches', client.from('matches').delete().in('tournament_id', tournamentIds));
      await del('rounds', client.from('rounds').delete().in('tournament_id', tournamentIds));
      await del('tournaments', client.from('tournaments').delete().in('id', tournamentIds));
    }
    await del('ruleset', deleteLocalRuleset(client, rulesetId));
    await del('players', client.from('players').delete().in('id', playerIds));
    if (failures.length > 0) throw new Error(`[bracket-write.local] cleanup left fixture rows behind: ${failures.join('; ')}`);
  }, 60000);

  it('a first generate writes the rounds, the matches and the start in one call; a second one is refused', async () => {
    const id = randomUUID();
    tournamentIds.push(id);
    await must('tournament', client.from('tournaments').insert({ id, name: `Bracket ${RUN} fresh`, bracket_type: 'single_elim', ruleset_id: rulesetId }));
    const tournament = await tournaments.getTournamentById(id);
    if (!tournament) throw new Error('missing');

    const result = await bracket.generateEliminationBracket(tournament, participants());

    expect(result).toEqual({ rounds_created: 2, matches_materialized: 2 });
    const after = await state(id);
    expect(after).toMatchObject({ status: 'active', matches: 2 });
    expect(after.roundIds).toHaveLength(2);
    const { data: row } = await must('current_round', client.from('tournaments').select('current_round').eq('id', id).single());
    expect(row?.current_round).toBe(1);

    await expect(
      rounds.writeBracket({ tournament_id: id, expected_status: 'active', replace: false, rounds: [{ id: randomUUID(), name: 'X', round_number: 1, best_of: 1, bracket_side: null }], matches: [], current_round: 1 }),
    ).rejects.toMatchObject({ code: 'bracket_already_generated' });
    expect((await state(id)).roundIds.sort()).toEqual([...after.roundIds].sort());
  });

  it('a completion that commits between the regenerate\'s read and its write stands; the old bracket stays', async () => {
    const { tournament, oldRoundId } = await seedActiveBracket('read-then-complete', true);

    await tournaments.updateTournament(tournament.id, { status: 'completed' }, { from: 'active' });

    await expect(bracket.regenerateEliminationBracket(tournament, participants())).rejects.toMatchObject({
      code: 'tournament_status_changed',
    });
    expect(await state(tournament.id)).toEqual({ status: 'completed', roundIds: [oldRoundId], matches: 1 });
  });

  it('an admin completion racing the regenerate is never overwritten, in either order', async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { tournament, oldRoundId } = await seedActiveBracket(`admin-race-${attempt}`, true);

      const [regenerate, completion] = await Promise.allSettled([
        bracket.regenerateEliminationBracket(tournament, participants()),
        tournaments.updateTournament(tournament.id, { status: 'completed' }, { from: 'active' }),
      ]);

      // The guarded completion always applies (before the write it finds active, after it the new bracket's active).
      expect(completion.status).toBe('fulfilled');
      const after = await state(tournament.id);
      expect(after.status).toBe('completed');
      if (regenerate.status === 'rejected') {
        expect(regenerate.reason).toMatchObject({ code: 'tournament_status_changed' });
        expect(after.roundIds).toEqual([oldRoundId]);
      } else {
        expect(after.roundIds).not.toContain(oldRoundId);
      }
    }
  }, 60000);

  it('a stage end racing the regenerate either completes the old bracket or finds the new one unsettled', async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { tournament, oldRoundId } = await seedActiveBracket(`stage-end-race-${attempt}`, false);

      const [regenerate, stageEnd] = await Promise.allSettled([
        bracket.regenerateEliminationBracket(tournament, participants()),
        client.rpc('phase_complete_at_stage_end', { p_phase_id: tournament.id, p_known_unfinished: [] }),
      ]);

      expect(stageEnd.status).toBe('fulfilled');
      const outcome = stageEnd.status === 'fulfilled' ? (stageEnd.value.data as { outcome: string } | null)?.outcome : null;
      const after = await state(tournament.id);
      if (outcome === 'completed') {
        expect(regenerate.status).toBe('rejected');
        expect(after).toEqual({ status: 'completed', roundIds: [oldRoundId], matches: 0 });
      } else {
        expect(outcome).toBe('unsettled');
        expect(regenerate.status).toBe('fulfilled');
        expect(after.status).toBe('active');
        expect(after.roundIds).not.toContain(oldRoundId);
        expect(after.matches).toBe(2);
      }
    }
  }, 60000);

  it('a replace refuses while a match is played (reported since the resets) and deletes nothing', async () => {
    const { tournament, oldRoundId } = await seedActiveBracket('played', true);
    await must('in_progress', client.from('matches').update({ status: 'in_progress' }).eq('tournament_id', tournament.id));

    await expect(
      rounds.writeBracket({ tournament_id: tournament.id, expected_status: 'active', replace: true, rounds: [{ id: randomUUID(), name: 'X', round_number: 1, best_of: 1, bracket_side: null }], matches: [], current_round: 1 }),
    ).rejects.toMatchObject({ code: 'REGENERATE_PLAYED', params: { count: 1 } });
    expect(await state(tournament.id)).toEqual({ status: 'active', roundIds: [oldRoundId], matches: 1 });
  });
});
