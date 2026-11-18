import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import type { Database } from '@/types/database';

const optedIn = localStackOptIn('LOCAL_PHASE_MATCH_GAME');

function session() {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_poketools', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']);
  let output = '';
  let errors = '';
  let ended = false;
  child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { errors += data.toString(); });
  const done = new Promise<{ code: number | null; output: string; errors: string }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output, errors }));
  });
  return {
    send: (sql: string) => { if (!ended && !child.stdin.destroyed) child.stdin.write(`${sql}\n`); },
    finish: () => { if (!ended) { ended = true; child.stdin.end(); } return done; },
    waitFor: async (text: string) => {
      const until = Date.now() + 10_000;
      while (!output.includes(text)) {
        if (Date.now() >= until || child.exitCode !== null) throw new Error(`psql did not reach ${text}: ${errors}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

async function sql(text: string) {
  const connection = session();
  connection.send(text);
  return connection.finish();
}

describe.skipIf(!optedIn)('native match/game persistence on the CI disposable stack', () => {
  const seasonId = randomUUID();
  const rulesetId = randomUUID();
  const tournamentId = randomUUID();
  const phaseId = randomUUID();
  const legacyRound = randomUUID();
  const phaseRound = randomUUID();
  const legacyMatch = randomUUID();
  const phaseMatch = randomUUID();
  const players = [randomUUID(), randomUUID()];
  let admin: SupabaseClient<Database>;
  let games: typeof import('@/lib/supabase/queries/phase-games');
  let matches: typeof import('@/lib/supabase/queries/phase-matches');
  let outcomes: typeof import('@/lib/supabase/queries/phase-match-outcomes');
  let snapshots: typeof import('@/lib/supabase/queries/phase-match-snapshots');

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    expect((await admin.from('phase_storage_state').select('mode').single()).data?.mode).toBe('phase');
    expect((await insertLocalRuleset(admin, { id: rulesetId, name: 'Match game fixture' })).error).toBeNull();
    expect((await admin.from('players').insert(players.map((id) => ({ id, name: `Fixture ${id}`, is_guest: true })))).error).toBeNull();
    expect((await admin.from('seasons').insert({ id: seasonId, name: 'Persistence fixture', format_type: 'singles', ruleset_id: rulesetId })).error).toBeNull();
    expect((await admin.from('tournaments').insert({ id: tournamentId, name: 'Standalone fixture', bracket_type: 'round_robin', ruleset_id: rulesetId })).error).toBeNull();
    expect((await admin.from('league_phases').insert({ id: phaseId, season_id: seasonId, name: 'Phase fixture', bracket_type: 'round_robin', ruleset_id: rulesetId })).error).toBeNull();
    expect((await admin.from('rounds').insert({ id: legacyRound, tournament_id: tournamentId, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
    expect((await admin.from('phase_rounds').insert({ id: phaseRound, phase_id: phaseId, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
    expect((await admin.from('matches').insert({ id: legacyMatch, round_id: legacyRound, tournament_id: tournamentId, player_1_id: players[0], player_2_id: players[1] })).error).toBeNull();
    expect((await admin.from('phase_matches').insert({ id: phaseMatch, round_id: phaseRound, phase_id: phaseId, player_1_id: players[0], player_2_id: players[1] })).error).toBeNull();
    [games, matches, outcomes, snapshots] = await Promise.all([
      import('@/lib/supabase/queries/phase-games'), import('@/lib/supabase/queries/phase-matches'),
      import('@/lib/supabase/queries/phase-match-outcomes'), import('@/lib/supabase/queries/phase-match-snapshots'),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    expect((await admin.from('league_phases').delete().eq('id', phaseId)).error).toBeNull();
    expect((await admin.from('tournaments').delete().eq('id', tournamentId)).error).toBeNull();
    expect((await admin.from('seasons').delete().eq('id', seasonId)).error).toBeNull();
    expect((await admin.from('players').delete().in('id', players)).error).toBeNull();
    expect((await deleteLocalRuleset(admin, rulesetId)).error).toBeNull();
  });

  function insert(table: 'games' | 'phase_games', id: string, hash: string | null, number: number) {
    const matchId = table === 'games' ? legacyMatch : phaseMatch;
    return `INSERT INTO public.${table}(id,match_id,game_number,replay_hash) VALUES ('${id}','${matchId}',${number},${hash === null ? 'NULL' : `'${hash}'`});`;
  }

  async function schedulingMatch() {
    const id = randomUUID();
    expect((await admin.from('phase_matches').insert({
      id, round_id: phaseRound, phase_id: phaseId, player_1_id: players[0], player_2_id: players[1],
    })).error).toBeNull();
    return id;
  }

  it('serializes opposite native proposals and persists an expired answer without changing the match', async () => {
    const { createPhaseMatchProposal, respondToPhaseMatchProposal } = await import('@/lib/supabase/queries/match-proposals');
    const id = await schedulingMatch();
    const when = new Date(Date.now() + 86_400_000).toISOString();
    const attempts = await Promise.allSettled(players.map(player => createPhaseMatchProposal(phaseId, id, player, when)));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'match_proposal_pending_exists', statusCode: 409 },
    });
    const stored = await admin.from('phase_match_proposals').select('*').eq('match_id', id).single();
    expect(stored.error).toBeNull();
    const proposal = stored.data!;
    expect(proposal.status).toBe('pending');
    expect((await admin.from('phase_match_proposals').update({ expires_at: '2026-01-01T00:00:00Z' }).eq('id', proposal.id)).error).toBeNull();
    await expect(respondToPhaseMatchProposal(phaseId, id, proposal.id, proposal.responder_id, true))
      .rejects.toMatchObject({ code: 'match_proposal_expired', statusCode: 409 });
    const expired = await admin.from('phase_match_proposals').select('status, responded_at').eq('id', proposal.id).single();
    expect(expired.data).toMatchObject({ status: 'expired', responded_at: expect.any(String) });
    expect((await matches.getPhaseMatchById(id))?.scheduled_at).toBeNull();
    await expect(createPhaseMatchProposal(phaseId, id, proposal.responder_id, when)).resolves.toMatchObject({ status: 'pending' });
  });

  it('commits acceptance and schedule together, and gives a changing admin override priority', async () => {
    const { createPhaseMatchProposal, overridePhaseMatchSchedule, respondToPhaseMatchProposal } = await import('@/lib/supabase/queries/match-proposals');
    const playerTime = new Date(Date.now() + 86_400_000).toISOString();
    const adminTime = new Date(Date.now() + 172_800_000).toISOString();
    const id = await schedulingMatch();
    const proposal = await createPhaseMatchProposal(phaseId, id, players[0], playerTime);
    const race = await Promise.allSettled([
      respondToPhaseMatchProposal(phaseId, id, proposal.id, players[1], true),
      overridePhaseMatchSchedule(phaseId, id, adminTime),
    ]);
    expect(race[1]).toMatchObject({ status: 'fulfilled', value: { unchanged: false, proposals_cancel_failed: false } });
    const final = (await matches.getPhaseMatchById(id))?.scheduled_at;
    expect(Date.parse(final ?? '')).toBe(Date.parse(adminTime));
    const { data } = await admin.from('phase_match_proposals').select('status').eq('id', proposal.id).single();
    if (race[0].status === 'fulfilled') expect(data?.status).toBe('accepted');
    else {
      expect(race[0].reason).toMatchObject({ code: 'match_proposal_not_pending' });
      expect(data?.status).toBe('cancelled');
    }

    const clean = await schedulingMatch();
    const pending = await createPhaseMatchProposal(phaseId, clean, players[0], playerTime);
    await expect(respondToPhaseMatchProposal(phaseId, clean, pending.id, players[1], true)).resolves.toMatchObject({ status: 'accepted' });
    expect(Date.parse((await matches.getPhaseMatchById(clean))?.scheduled_at ?? '')).toBe(Date.parse(playerTime));
    const cleared = await overridePhaseMatchSchedule(phaseId, clean, null);
    expect(cleared).toMatchObject({ scheduled_at: null, unchanged: false });
    expect((await matches.getPhaseMatchById(clean))?.scheduled_at).toBeNull();
  });

  for (const first of ['games', 'phase_games'] as const) {
    const second = first === 'games' ? 'phase_games' : 'games';
    it(`serializes ${first} first, blocks ${second}, rejects after commit and permits retry after rollback`, async () => {
      for (const write of ['insert', 'update']) for (const commit of [true, false]) {
        const hash = createHash('sha256').update(randomUUID()).digest('hex');
        const firstId = randomUUID();
        const secondId = randomUUID();
        const writer = session();
        const contender = session();
        const name = `replay-${secondId}`;
        try {
          if (write === 'update') {
            expect((await sql(`${insert(first, firstId, null, 50)} ${insert(second, secondId, null, 51)}`)).code).toBe(0);
          }
          const firstWrite = write === 'insert' ? insert(first, firstId, hash, 50)
            : `UPDATE public.${first} SET replay_hash = '${hash}' WHERE id = '${firstId}';`;
          const secondWrite = write === 'insert' ? insert(second, secondId, hash, 51)
            : `UPDATE public.${second} SET replay_hash = '${hash}' WHERE id = '${secondId}';`;
          writer.send(`BEGIN; ${firstWrite} SELECT 'held';`);
          await writer.waitFor('held');
          contender.send(`SET application_name = '${name}'; ${secondWrite} SELECT 'inserted';`);
          const until = Date.now() + 10_000;
          let blocked = false;
          while (Date.now() < until) {
            const check = await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${name}' AND wait_event = 'advisory';`);
            if (check.output.trim() === '1') { blocked = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          expect(blocked).toBe(true);
          writer.send(commit ? 'COMMIT;' : 'ROLLBACK;');
          expect((await writer.finish()).code).toBe(0);
          const result = await contender.finish();
          if (commit) {
            expect(result.code).not.toBe(0);
            expect(result.errors).toContain('games_global_replay_hash_key');
            expect((await sql(`DELETE FROM public.${first} WHERE id = '${firstId}'; ${secondWrite}`)).code).toBe(0);
          } else {
            expect(result.code).toBe(0);
            expect(result.output).toContain('inserted');
          }
        } finally {
          writer.send('ROLLBACK;');
          await writer.finish();
          await contender.finish();
          expect((await sql(`DELETE FROM public.games WHERE id IN ('${firstId}','${secondId}'); DELETE FROM public.phase_games WHERE id IN ('${firstId}','${secondId}');`)).code).toBe(0);
        }
      }
    }, 60_000);

    it(`checks ${first} replay updates and same-ID transfer at commit`, async () => {
      const hash = createHash('sha256').update(randomUUID()).digest('hex');
      const id = randomUUID();
      const other = randomUUID();
      expect((await sql(insert(first, id, hash, 52))).code).toBe(0);
      try {
        const duplicate = await sql(`BEGIN; ${insert(second, id, hash, 53)} COMMIT;`);
        expect(duplicate.code).not.toBe(0);
        expect(duplicate.errors).toContain('games_global_replay_hash_key');
        expect((await sql(insert(second, other, null, 54))).code).toBe(0);
        const update = await sql(`UPDATE public.${second} SET replay_hash = '${hash}' WHERE id = '${other}';`);
        expect(update.code).not.toBe(0);
        expect(update.errors).toContain('games_global_replay_hash_key');
        expect((await sql(`BEGIN; ${insert(second, id, hash, 53)} DELETE FROM public.${first} WHERE id = '${id}'; COMMIT;`)).code).toBe(0);
      } finally {
        expect((await sql(`DELETE FROM public.games WHERE id IN ('${id}','${other}'); DELETE FROM public.phase_games WHERE id IN ('${id}','${other}');`)).code).toBe(0);
      }
    });
  }

  for (const mutation of ['started', 'new game'] as const) {
    it(`refuses the entire deletion batch after a concurrent ${mutation} commits`, async () => {
      const target = randomUUID();
      const untouched = randomUUID();
      const gameId = randomUUID();
      expect((await admin.from('phase_matches').insert([target, untouched].map((id) => ({
        id, phase_id: phaseId, round_id: phaseRound, player_1_id: players[0], player_2_id: players[1],
      })))).error).toBeNull();
      const writer = session();
      const deleter = session();
      const name = `delete-${target}`;
      try {
        const change = mutation === 'started'
          ? `UPDATE public.phase_matches SET status = 'in_progress' WHERE id = '${target}';`
          : `INSERT INTO public.phase_games(id,match_id,game_number) VALUES ('${gameId}','${target}',1);`;
        writer.send(`BEGIN; ${change} SELECT 'changed';`);
        await writer.waitFor('changed');
        deleter.send(`SET application_name = '${name}'; SELECT public.phase_matches_delete_scheduled(ARRAY['${target}'::uuid,'${untouched}'::uuid]);`);
        let blocked = false;
        const until = Date.now() + 10_000;
        while (Date.now() < until) {
          const check = await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${name}' AND wait_event_type = 'Lock';`);
          if (check.output.trim() === '1') { blocked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(blocked).toBe(true);
        writer.send('COMMIT;');
        expect((await writer.finish()).code).toBe(0);
        const result = await deleter.finish();
        expect(result.code).not.toBe(0);
        expect(result.errors).toContain('phase_match_delete_changed');
        const remaining = await admin.from('phase_matches').select('id,status').in('id', [target, untouched]);
        expect(remaining.error).toBeNull();
        expect(remaining.data).toHaveLength(2);
        if (mutation === 'started') expect(remaining.data?.find((row) => row.id === target)?.status).toBe('in_progress');
        if (mutation === 'new game') expect((await admin.from('phase_games').select('id').eq('id', gameId).single()).data?.id).toBe(gameId);
      } finally {
        writer.send('ROLLBACK;');
        await writer.finish();
        await deleter.finish();
        expect((await admin.from('phase_matches').delete().in('id', [target, untouched])).error).toBeNull();
      }
    }, 30_000);
  }

  it('deletes a scheduled game-free batch atomically and tolerates already missing ids', async () => {
    const target = randomUUID();
    expect((await admin.from('phase_matches').insert({ id: target, phase_id: phaseId, round_id: phaseRound, player_1_id: players[0], player_2_id: players[1] })).error).toBeNull();
    const result = await sql(`SELECT public.phase_matches_delete_scheduled(ARRAY['${target}'::uuid,'${randomUUID()}'::uuid]);`);
    expect(result.code).toBe(0);
    expect(result.output.trim()).toBe('1');
    expect((await admin.from('phase_matches').select('id').eq('id', target)).data).toEqual([]);
  });

  it('sums native evolution KOs through the real league join without another owner, player, form or legacy fallback', async () => {
    const otherSeason = randomUUID();
    const otherPhase = randomUUID();
    const otherRound = randomUUID();
    const otherMatch = randomUUID();
    const linkedTournament = randomUUID();
    const linkedRound = randomUUID();
    const linkedMatch = randomUUID();
    const nativeGame = randomUUID();
    const otherGame = randomUUID();
    const legacyGame = randomUUID();
    const standaloneGame = randomUUID();
    const { getPhaseSeasonKosForLine } = await import('@/lib/supabase/queries/phase-reconciliation');
    try {
      expect((await admin.from('seasons').insert({ id: otherSeason, name: 'Other evolution fixture', format_type: 'singles', ruleset_id: rulesetId })).error).toBeNull();
      expect((await admin.from('league_phases').insert({ id: otherPhase, season_id: otherSeason, name: 'Other evolution phase', bracket_type: 'round_robin', ruleset_id: rulesetId })).error).toBeNull();
      expect((await admin.from('phase_rounds').insert({ id: otherRound, phase_id: otherPhase, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
      expect((await admin.from('phase_matches').insert({ id: otherMatch, phase_id: otherPhase, round_id: otherRound, player_1_id: players[0], player_2_id: players[1] })).error).toBeNull();
      expect((await admin.from('phase_games').insert([
        { id: nativeGame, match_id: phaseMatch, game_number: 90 },
        { id: otherGame, match_id: otherMatch, game_number: 1 },
      ])).error).toBeNull();
      expect((await admin.from('phase_battle_stats').insert([
        { game_id: nativeGame, player_id: players[0], pokemon_name: 'Charmander', kos_dealt: 2 },
        { game_id: nativeGame, player_id: players[0], pokemon_name: 'Charmeleon', kos_dealt: 3 },
        { game_id: nativeGame, player_id: players[1], pokemon_name: 'Charmander', kos_dealt: 5 },
        { game_id: nativeGame, player_id: players[0], pokemon_name: 'Bulbasaur', kos_dealt: 7 },
        { game_id: otherGame, player_id: players[0], pokemon_name: 'Charmander', kos_dealt: 11 },
      ])).error).toBeNull();
      expect((await admin.from('tournaments').insert({ id: linkedTournament, season_id: seasonId, name: 'Legacy evolution owner', bracket_type: 'round_robin', ruleset_id: rulesetId })).error).toBeNull();
      expect((await admin.from('rounds').insert({ id: linkedRound, tournament_id: linkedTournament, name: 'Round 1', round_number: 1, best_of: 3 })).error).toBeNull();
      expect((await admin.from('matches').insert({ id: linkedMatch, tournament_id: linkedTournament, round_id: linkedRound, player_1_id: players[0], player_2_id: players[1] })).error).toBeNull();
      expect((await admin.from('games').insert([
        { id: legacyGame, match_id: linkedMatch, game_number: 1 },
        { id: standaloneGame, match_id: legacyMatch, game_number: 90 },
      ])).error).toBeNull();
      expect((await admin.from('battle_stats').insert([
        { game_id: legacyGame, player_id: players[0], pokemon_name: 'Charmander', kos_dealt: 17 },
        { game_id: legacyGame, player_id: players[0], pokemon_name: 'Eevee', kos_dealt: 19 },
        { game_id: standaloneGame, player_id: players[0], pokemon_name: 'Charmander', kos_dealt: 13 },
      ])).error).toBeNull();

      expect(await getPhaseSeasonKosForLine(seasonId, players[0], ['Charmander', 'Charmeleon'])).toBe(5);
      expect(await getPhaseSeasonKosForLine(otherSeason, players[0], ['Charmander'])).toBe(11);
      expect(await getPhaseSeasonKosForLine(seasonId, players[1], ['Charmander'])).toBe(5);
      expect(await getPhaseSeasonKosForLine(seasonId, players[0], ['Bulbasaur'])).toBe(7);
      expect(await getPhaseSeasonKosForLine(seasonId, players[0], ['Eevee'])).toBe(0);
    } finally {
      expect((await admin.from('phase_games').delete().eq('id', nativeGame)).error).toBeNull();
      expect((await admin.from('games').delete().eq('id', standaloneGame)).error).toBeNull();
      expect((await admin.from('tournaments').delete().eq('id', linkedTournament)).error).toBeNull();
      expect((await admin.from('league_phases').delete().eq('id', otherPhase)).error).toBeNull();
      expect((await admin.from('seasons').delete().eq('id', otherSeason)).error).toBeNull();
    }
  });

  it('preserves native identity, status CAS, outcome staging, leases and snapshots', async () => {
    expect(await matches.getPhaseMatchById(phaseMatch)).toMatchObject({ phase_id: phaseId, player_1_name: `Fixture ${players[0]}` });
    expect(await matches.getPhaseMatchById(phaseMatch)).not.toHaveProperty('tournament_id');
    const updates = await Promise.all([0, 1].map(() => matches.updatePhaseMatchStatus(phaseMatch, 'in_progress', undefined, players[0], undefined, 'scheduled', 'player')));
    expect(updates.filter(Boolean)).toHaveLength(1);
    expect(await outcomes.recordPhaseMatchOutcome({ matchId: phaseMatch, kind: 'forfeit', p1Faints: null, p2Faints: null, source: 'admin', reason: 'Fixture decision', setBy: players[0], force: true, openOnly: true })).toBe('written');
    const staged = await outcomes.getPhaseMatchOutcome(phaseMatch);
    expect(await outcomes.deletePhaseMatchOutcome(phaseMatch, { onlyIfSetAt: '2000-01-01T00:00:00Z' })).toBe(0);
    expect(await outcomes.deletePhaseMatchOutcome(phaseMatch, { onlyIfSetAt: staged!.set_at })).toBe(1);
    const game = await games.createPhaseGame({ match_id: phaseMatch, game_number: 1, winner_id: players[0], source: 'manual', exclude_all_time: false });
    expect((await games.updatePhaseGameWinner(game.id, players[1])).winner_id).toBe(players[1]);
    await games.createPhaseBattleStats([{ game_id: game.id, player_id: players[1], pokemon_name: 'Pikachu', kos_dealt: 1 }]);
    expect(await games.getPhaseBattleStatsByGame(game.id)).toHaveLength(1);
    await expect(games.createPhaseBattleStats([{ game_id: game.id, player_id: players[1], pokemon_name: 'Pikachu' }])).rejects.toMatchObject({ code: 'battle_stats_duplicate_pokemon' });
    await games.setPhaseGameStatsLocked(game.id);
    const current = await games.getPhaseGameById(game.id);
    const token = randomUUID();
    expect(await games.claimPhaseGameEditLease(game.id, current!.updated_at, token)).toBe('claimed');
    expect(await games.claimPhaseGameEditLease(game.id, current!.updated_at, randomUUID())).toBe('leased');
    expect(await games.releasePhaseGameEditLease(game.id, randomUUID())).toBe(false);
    expect(await games.releasePhaseGameEditLease(game.id, token)).toBe(true);
    expect(await games.claimPhaseGameEditLease(game.id, game.updated_at, token)).toBe('stale');
    const completed = await matches.updatePhaseMatchStatus(phaseMatch, 'completed', players[1], players[0], undefined, 'in_progress', 'admin');
    expect(completed?.confirmed_at).toBeTruthy();
    expect(await matches.markPhaseMatchFinalized(phaseMatch, undefined, { confirmedAt: '2000-01-01T00:00:00Z' })).toBe(false);
    expect(await matches.markPhaseMatchFinalized(phaseMatch, undefined, { confirmedAt: completed!.confirmed_at })).toBe(true);
    expect((await admin.from('phase_games').update({ aggregate_applied_at: new Date().toISOString() }).eq('id', game.id)).error).toBeNull();
    expect(await games.deleteUncountedPhaseGameRow(game.id)).toBe('counted');
    expect((await admin.from('phase_games').update({ aggregate_applied_at: null }).eq('id', game.id)).error).toBeNull();
    await snapshots.insertPhaseMatchSnapshots(phaseMatch, []);
    expect(await snapshots.getPhaseMatchSnapshots(phaseMatch)).toEqual([]);
    expect(await games.deleteUncountedPhaseGameRow(game.id)).toBe('deleted');
    expect(await games.deleteUncountedPhaseGameRow(game.id)).toBe('missing');
  });
});
