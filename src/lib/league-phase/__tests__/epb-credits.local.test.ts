import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import { insertAsSchemaOwner } from '@/test/local-schema-owner';

const optedIn = localStackOptIn('LOCAL_PHASE_EPB');
const ids = {
  season: randomUUID(), phase: randomUUID(), tournament: randomUUID(), ruleset: randomUUID(),
  round: randomUUID(), legacyRound: randomUUID(), match: randomUUID(), legacyMatch: randomUUID(),
  tracker: randomUUID(), players: [randomUUID(), randomUUID()],
};

describe.skipIf(!optedIn)('native EPB credits on the disposable CI database', () => {
  let db: typeof import('@/lib/supabase/client')['supabase'];
  let number = 0;

  async function ok(result: PromiseLike<{ error: unknown }>) {
    const { error } = await result;
    if (error) throw error;
  }

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
    ({ supabase: db } = await import('@/lib/supabase/client'));
    expect((await db.from('phase_storage_state').select('mode').single()).data?.mode).toBe('phase');
    await ok(insertLocalRuleset(db, { id: ids.ruleset, name: 'EPB fixture rules' }));
    await ok(db.from('players').insert(ids.players.map((id) => ({ id, name: 'EPB fixture player', is_guest: true }))));
    await ok(db.from('seasons').insert({ id: ids.season, name: 'EPB fixture league', format_type: 'singles', ruleset_id: ids.ruleset }));
    await ok(db.from('league_phases').insert({
      id: ids.phase, season_id: ids.season, name: 'EPB fixture phase', bracket_type: 'round_robin', ruleset_id: ids.ruleset,
    }));
    await insertAsSchemaOwner('tournaments', [{
      id: ids.tournament, season_id: ids.season, name: 'EPB legacy fixture', bracket_type: 'round_robin', ruleset_id: ids.ruleset,
    }]);
    await ok(db.from('phase_rounds').insert({
      id: ids.round, phase_id: ids.phase, name: 'Round 1', round_number: 1, best_of: 3,
    }));
    await ok(db.from('rounds').insert({
      id: ids.legacyRound, tournament_id: ids.tournament, name: 'Round 1', round_number: 1, best_of: 3,
    }));
    const players = { player_1_id: ids.players[0], player_2_id: ids.players[1], winner_id: ids.players[0], status: 'completed' as const };
    await ok(db.from('phase_matches').insert({ ...players, id: ids.match, phase_id: ids.phase, round_id: ids.round }));
    await ok(db.from('matches').insert({ ...players, id: ids.legacyMatch, tournament_id: ids.tournament, round_id: ids.legacyRound }));
    await ok(db.from('evolution_tracker').insert({
      id: ids.tracker, season_id: ids.season, player_id: ids.players[0], base_pokemon: 'Dreepy', current_form: 'Dreepy',
    }));
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await ok(db.from('league_phases').delete().eq('id', ids.phase));
    await ok(db.from('tournaments').delete().eq('id', ids.tournament));
    await ok(db.from('seasons').delete().eq('id', ids.season));
    await ok(db.from('players').delete().in('id', ids.players));
    await ok(deleteLocalRuleset(db, ids.ruleset));
  });

  async function game(legacy = false) {
    const id = randomUUID();
    await ok(db.from(legacy ? 'games' : 'phase_games').insert({
      id, match_id: legacy ? ids.legacyMatch : ids.match, game_number: ++number, source: 'manual',
    }));
    return id;
  }

  async function epoch() {
    const result = await db.rpc('epb_kill_credit_epoch', { p_season_id: ids.season });
    if (result.error) throw result.error;
    return Number(result.data);
  }

  async function marker(id: string, legacy = false) {
    const result = await db.from(legacy ? 'games' : 'phase_games')
      .select('evolution_applied_at, evolution_credits').eq('id', id).single();
    if (result.error) throw result.error;
    return result.data;
  }

  it('credits racing requests once, debits the recorded ledger, and preserves the marker fence', async () => {
    const id = await game();
    const credits = [{ tracker_id: ids.tracker, amount: 2 }];
    const outcomes = await Promise.all([1, 2].map(() => db.rpc('phase_epb_credit_game_kills', {
      p_game_id: id, p_credits: credits,
    })));
    expect(outcomes.every((result) => !result.error)).toBe(true);
    expect(outcomes.map((result) => result.data).sort()).toEqual(['already_applied', 'applied']);
    const applied = await marker(id);
    expect(applied.evolution_credits).toEqual(credits);
    const wrong = await db.rpc('phase_epb_uncredit_game_kills', {
      p_game_id: id, p_expected_applied_at: '2000-01-01T00:00:00Z', p_debits: [],
    });
    expect(wrong.data).toBe('marker_changed');
    const debits = await Promise.all([1, 2].map(() => db.rpc('phase_epb_uncredit_game_kills', {
      p_game_id: id, p_expected_applied_at: applied.evolution_applied_at!, p_debits: [],
    })));
    expect(debits.every((result) => !result.error)).toBe(true);
    expect(debits.map((result) => result.data).sort()).toEqual(['not_applied', 'rolled_back']);
    expect((await marker(id)).evolution_applied_at).toBeNull();
    const tracker = await db.from('evolution_tracker').select('real_kills').eq('id', ids.tracker).single();
    expect(tracker.data?.real_kills).toBe(0);
  });

  it('rolls back a partial credit when a later tracker is invalid', async () => {
    const id = await game();
    const before = await epoch();
    const result = await db.rpc('phase_epb_credit_game_kills', {
      p_game_id: id, p_credits: [
        { tracker_id: ids.tracker, amount: 2 }, { tracker_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', amount: 1 },
      ],
    });
    expect(result.error?.code).toBe('22023');
    expect((await marker(id)).evolution_applied_at).toBeNull();
    expect(await epoch()).toBe(before);
    const tracker = await db.from('evolution_tracker').select('real_kills').eq('id', ids.tracker).single();
    expect(tracker.data?.real_kills).toBe(0);
  });

  it('syncs both stores together and refuses either changed match without partially syncing the other', async () => {
    const legacy = await game(true);
    const native = await game();
    const before = await epoch();
    const args = {
      p_season_id: ids.season, p_expected_epoch: before,
      p_legacy_match_ids: [ids.legacyMatch], p_legacy_game_credits: {},
      p_phase_match_ids: [ids.match], p_phase_game_credits: {},
    };
    await ok(db.from('matches').update({ status: 'in_progress' }).eq('id', ids.legacyMatch));
    const legacyStale = await db.rpc('epb_sync_mixed_game_kill_credit', args);
    expect(legacyStale.error).toBeNull();
    expect(legacyStale.data).toEqual({ status: 'stale', reason: 'match_changed' });
    expect((await marker(native)).evolution_applied_at).toBeNull();
    expect(await epoch()).toBe(before);
    await ok(db.from('matches').update({ status: 'completed' }).eq('id', ids.legacyMatch));
    await ok(db.from('phase_matches').update({ status: 'in_progress' }).eq('id', ids.match));
    const stale = await db.rpc('epb_sync_mixed_game_kill_credit', args);
    expect(stale.error).toBeNull();
    expect(stale.data).toEqual({ status: 'stale', reason: 'match_changed' });
    expect(await epoch()).toBe(before);
    expect((await marker(legacy, true)).evolution_applied_at).toBeNull();
    await ok(db.from('phase_matches').update({ status: 'completed' }).eq('id', ids.match));
    const synced = await db.rpc('epb_sync_mixed_game_kill_credit', args);
    expect(synced.error).toBeNull();
    expect(synced.data).toMatchObject({ status: 'synced' });
    expect((await marker(legacy, true)).evolution_credits).toEqual([]);
    expect((await marker(native)).evolution_credits).toEqual([]);
    expect(await epoch()).toBe(before + 1);
    expect((await db.rpc('epb_sync_mixed_game_kill_credit', args)).data)
      .toEqual({ status: 'stale', reason: 'credit_changed' });
  });
});
