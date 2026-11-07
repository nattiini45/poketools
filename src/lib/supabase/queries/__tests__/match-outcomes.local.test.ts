import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';

// LIVE-LOCAL test for supabase/migrations/20261104090000_match_outcomes.sql. It runs the query module against a
// LOCAL Supabase stack to prove that `match_outcome_record` never lets a played (or unresolved) write replace an
// admin row, that an admin write always lands, that the kind and source checks hold, and that the row goes with its
// match. Opt-in only (`LOCAL_SUPABASE_MATCH_OUTCOMES=1` or `npm run test:db`), never loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_MATCH_OUTCOMES');

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

type ClientMod = typeof import('@/lib/supabase/client');
type OutcomesMod = typeof import('@/lib/supabase/queries/match-outcomes');

let client: ClientMod['supabase'];
let outcomes: OutcomesMod;

const RUN = randomUUID().slice(0, 8);
const ids = {
  ruleset: randomUUID(),
  p1: randomUUID(),
  p2: randomUUID(),
  tournament: randomUUID(),
  round: randomUUID(),
  match: randomUUID(),
  other: randomUUID(),
};

const played = (p1Faints: number, p2Faints: number) => ({
  matchId: ids.match,
  kind: 'played' as const,
  p1Faints,
  p2Faints,
  source: 'replay' as const,
  reason: null,
  setBy: null,
  force: false,
});

describe.skipIf(!optIn)('match_outcome_record (local stack)', () => {
  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    ({ supabase: client } = await import('@/lib/supabase/client'));
    outcomes = await import('@/lib/supabase/queries/match-outcomes');

    const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };
    await run('rulesets', insertLocalRuleset(client, { id: ids.ruleset, name: `Outcomes ${RUN} Ruleset` }));
    await run(
      'players',
      client.from('players').insert([
        { id: ids.p1, name: `Outcomes ${RUN} Ada`, discord_id: `outcomes-${RUN}-d1` },
        { id: ids.p2, name: `Outcomes ${RUN} Bram`, discord_id: `outcomes-${RUN}-d2` },
      ], { defaultToNull: false }),
    );
    await run(
      'tournaments',
      client.from('tournaments').insert({ id: ids.tournament, name: `Outcomes ${RUN} Open`, bracket_type: 'swiss', ruleset_id: ids.ruleset }),
    );
    await run(
      'rounds',
      client.from('rounds').insert({ id: ids.round, tournament_id: ids.tournament, name: 'Round 1', round_number: 1, best_of: 1 }),
    );
    await run(
      'matches',
      client.from('matches').insert([ids.match, ids.other].map((id) => ({
        id, round_id: ids.round, tournament_id: ids.tournament, player_1_id: ids.p1, player_2_id: ids.p2, status: 'in_progress' as const,
      }))),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    await del('matches', client.from('matches').delete().eq('tournament_id', ids.tournament));
    await del('rounds', client.from('rounds').delete().eq('id', ids.round));
    await del('tournaments', client.from('tournaments').delete().eq('id', ids.tournament));
    await del('rulesets', deleteLocalRuleset(client, ids.ruleset));
    await del('players', client.from('players').delete().in('id', [ids.p1, ids.p2]));
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
  }, 60000);

  it('writes and rewrites a played row without force', async () => {
    await expect(outcomes.recordMatchOutcome(played(2, 4))).resolves.toBe('written');
    await expect(outcomes.recordMatchOutcome(played(3, 4))).resolves.toBe('written');
    expect(await outcomes.getMatchOutcome(ids.match)).toMatchObject({ kind: 'played', p1_faints: 3, p2_faints: 4, source: 'replay' });
  });

  it('never replaces an admin row without force, and an admin write always lands', async () => {
    await expect(
      outcomes.recordMatchOutcome({
        matchId: ids.match, kind: 'forfeit', p1Faints: null, p2Faints: null, source: 'admin',
        reason: 'Bram did not show up', setBy: ids.p1, force: true,
      }),
    ).resolves.toBe('written');
    await expect(outcomes.recordMatchOutcome(played(1, 1))).resolves.toBe('kept');
    expect(await outcomes.getMatchOutcome(ids.match)).toMatchObject({
      kind: 'forfeit', p1_faints: null, p2_faints: null, source: 'admin', reason: 'Bram did not show up', set_by: ids.p1,
    });

    await expect(
      outcomes.recordMatchOutcome({
        matchId: ids.match, kind: 'no_show', p1Faints: null, p2Faints: null, source: 'admin',
        reason: 'Corrected: Bram never joined', setBy: ids.p2, force: true,
      }),
    ).resolves.toBe('written');
    expect(await outcomes.getMatchOutcome(ids.match)).toMatchObject({ kind: 'no_show', set_by: ids.p2 });
  });

  it('does not stage an open-only admin write over a completed match, and keeps its row', async () => {
    const staged = (kind: 'forfeit' | 'played', reason: string) => ({
      matchId: ids.other, kind, p1Faints: null, p2Faints: null, source: 'admin' as const,
      reason, setBy: ids.p1, force: true, openOnly: true,
    });
    // Open match: lands.
    await expect(outcomes.recordMatchOutcome(staged('forfeit', 'No show'))).resolves.toBe('written');

    const complete = await client.from('matches').update({ status: 'completed', winner_id: ids.p1 }).eq('id', ids.other);
    expect(complete.error).toBeNull();
    // The completing request's finalize step rewrites the row with faints (a plain forced write).
    await expect(
      outcomes.recordMatchOutcome({
        matchId: ids.other, kind: 'played', p1Faints: 3, p2Faints: 1, source: 'admin',
        reason: 'Agreed outside the app', setBy: ids.p1, force: true,
      }),
    ).resolves.toBe('written');

    // A loser staging after the completion is skipped and the finalized row is untouched.
    await expect(outcomes.recordMatchOutcome(staged('forfeit', 'Late duplicate'))).resolves.toBe('kept');
    expect(await outcomes.getMatchOutcome(ids.other)).toMatchObject({
      kind: 'played', p1_faints: 3, p2_faints: 1, reason: 'Agreed outside the app',
    });

    await outcomes.deleteMatchOutcome(ids.other);
    await client.from('matches').update({ status: 'in_progress', winner_id: null }).eq('id', ids.other);
  });

  it('open-only is a check inside its own call: a completion after it leaves the staged admin row for the caller to take back', async () => {
    // The share lock ends with the call, so it cannot make the staged row atomic with the caller's later status update.
    // This pins the contract the callers rely on (they discard their own staged row by set_at when their update loses).
    await expect(
      outcomes.recordMatchOutcome({
        matchId: ids.other, kind: 'forfeit', p1Faints: null, p2Faints: null, source: 'admin',
        reason: 'No show', setBy: ids.p1, force: true, openOnly: true,
      }),
    ).resolves.toBe('written');
    const staged = await outcomes.getMatchOutcome(ids.other);
    expect(staged).toMatchObject({ kind: 'forfeit', source: 'admin' });

    // A player's confirmation completes the match in between; its finalize write (not forced) cannot replace the admin row.
    const complete = await client.from('matches').update({ status: 'completed', winner_id: ids.p2 }).eq('id', ids.other);
    expect(complete.error).toBeNull();
    await expect(outcomes.recordMatchOutcome({ ...played(2, 3), matchId: ids.other })).resolves.toBe('kept');
    expect(await outcomes.getMatchOutcome(ids.other)).toMatchObject({ kind: 'forfeit', source: 'admin', set_at: staged?.set_at });

    // So the staging request takes its row back (by its set_at) and the played row can then be written.
    await expect(outcomes.deleteMatchOutcome(ids.other, { onlyIfSetAt: staged!.set_at })).resolves.toBe(1);
    await expect(outcomes.recordMatchOutcome({ ...played(2, 3), matchId: ids.other })).resolves.toBe('written');
    expect(await outcomes.getMatchOutcome(ids.other)).toMatchObject({ kind: 'played', p1_faints: 2, p2_faints: 3, source: 'replay' });

    await outcomes.deleteMatchOutcome(ids.other);
    await client.from('matches').update({ status: 'in_progress', winner_id: null }).eq('id', ids.other);
  });

  it('refuses an unknown kind or source', async () => {
    await expect(outcomes.recordMatchOutcome({ ...played(0, 0), matchId: ids.other, kind: 'draw' as never })).rejects.toBeTruthy();
    await expect(outcomes.recordMatchOutcome({ ...played(0, 0), matchId: ids.other, source: 'robot' as never })).rejects.toBeTruthy();
    expect(await outcomes.getMatchOutcome(ids.other)).toBeNull();
  });

  it('reads each match by id and deletes one row', async () => {
    await outcomes.recordMatchOutcome({
      matchId: ids.other, kind: 'unresolved', p1Faints: null, p2Faints: null, source: 'replay',
      reason: 'replay_engine_tie', setBy: null, force: false,
    });
    expect((await outcomes.getMatchOutcome(ids.match))?.match_id).toBe(ids.match);
    expect((await outcomes.getMatchOutcome(ids.other))?.match_id).toBe(ids.other);

    await expect(outcomes.deleteMatchOutcome(ids.other)).resolves.toBe(1);
    await expect(outcomes.deleteMatchOutcome(ids.other)).resolves.toBe(0);
  });

  it('goes with its match (ON DELETE CASCADE)', async () => {
    const { error } = await client.from('matches').delete().eq('id', ids.match);
    expect(error).toBeNull();
    expect(await outcomes.getMatchOutcome(ids.match)).toBeNull();
  });
});
