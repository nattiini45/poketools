import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';
import type { BattleStat } from '@/types/game';
import type { Json } from '@/types/database';
import { insertAsSchemaOwner } from '@/test/local-schema-owner';

vi.mock('@/lib/revalidation', () => ({
  expireSeasonReads: vi.fn(), revalidateMatchPages: vi.fn(), revalidatePublicPath: vi.fn(),
}));

const optedIn = localStackOptIn('LOCAL_PHASE_AGGREGATES');
const runId = randomUUID();
const prefix = `NativeAggregate${runId}`;
const ids = { season: randomUUID(), phase: randomUUID(), tournament: randomUUID(),
  round: randomUUID(), match: randomUUID(), legacyRound: randomUUID(), legacyMatch: randomUUID(),
  ruleset: randomUUID(), players: [randomUUID(), randomUUID()] };

describe.skipIf(!optedIn)('native aggregate atomicity on the disposable CI database', () => {
  let db: typeof import('@/lib/supabase/client')['supabase'];
  let aggregate: typeof import('@/lib/supabase/queries/aggregates');
  let native: typeof import('../phase-aggregate-storage');
  let rebuild: typeof import('@/lib/match/aggregate-rebuild');
  let gameNumber = 0;

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
    ({ supabase: db } = await import('@/lib/supabase/client'));
    const mode = await db.from('phase_storage_state').select('mode').single();
    expect(mode.error).toBeNull();
    expect(mode.data?.mode).toBe('phase');
    aggregate = await import('@/lib/supabase/queries/aggregates');
    native = await import('../phase-aggregate-storage');
    rebuild = await import('@/lib/match/aggregate-rebuild');
    await ok(db.from('players').insert(ids.players.map((id, i) => ({ id, name: `Aggregate fixture ${runId}-${i}`, is_guest: true }))));
    await ok(insertLocalRuleset(db, { id: ids.ruleset, name: `Aggregate fixture ${runId}` }));
    await ok(db.from('seasons').insert({ id: ids.season, name: 'Aggregate fixture league', format_type: 'singles', ruleset_id: ids.ruleset }));
    await ok(db.from('league_phases').insert({ id: ids.phase, season_id: ids.season, name: 'Aggregate fixture phase', bracket_type: 'swiss', ruleset_id: ids.ruleset }));
    await ok(db.from('phase_rounds').insert({ id: ids.round, phase_id: ids.phase, name: 'Round 1', round_number: 1, best_of: 3 }));
    await ok(db.from('phase_matches').insert({ id: ids.match, phase_id: ids.phase, round_id: ids.round, player_1_id: ids.players[0], player_2_id: ids.players[1], status: 'in_progress' }));
    await insertAsSchemaOwner('tournaments', [{ id: ids.tournament, season_id: ids.season, name: 'Legacy aggregate fixture', bracket_type: 'swiss', ruleset_id: ids.ruleset }]);
    await ok(db.from('rounds').insert({ id: ids.legacyRound, tournament_id: ids.tournament, name: 'Round 1', round_number: 1, best_of: 3 }));
    await ok(db.from('matches').insert({ id: ids.legacyMatch, tournament_id: ids.tournament, round_id: ids.legacyRound, player_1_id: ids.players[0], player_2_id: ids.players[1], status: 'in_progress' }));
  });

  afterAll(async () => {
    if (!db) return;
    for (const table of ['aggregates', 'player_aggregates', 'phase_aggregates', 'phase_player_aggregates'] as const) {
      await ok(db.from(table).delete().like('pokemon_name', `${prefix}%`));
    }
    const trash = await db.rpc('league_trash_delete', { p_season_id: ids.season, p_actor: ids.players[0], p_retention_days: 90 });
    if (trash.error) throw trash.error;
    const value = trash.data;
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.trash_id !== 'string') throw new Error('Missing trash id');
    await ok(db.rpc('league_trash_rebuild_done', { p_trash_id: value.trash_id }));
    await ok(db.from('league_trash').update({ deleted_at: new Date(Date.now() - 2 * 86400000).toISOString(), purge_after: new Date(Date.now() - 60000).toISOString() }).eq('id', value.trash_id));
    await ok(db.rpc('league_trash_expire', { p_now: new Date().toISOString(), p_limit: 20 }));
    await ok(db.from('players').delete().in('id', ids.players));
    await ok(deleteLocalRuleset(db, ids.ruleset));
  });

  async function ok(result: PromiseLike<{ error: unknown }>) {
    const { error } = await result;
    if (error) throw error;
  }

  async function seed(label: string, options: { legacy?: boolean; id?: string; exclude?: boolean } = {}) {
    const id = options.id ?? randomUUID();
    const table = options.legacy ? 'games' : 'phase_games';
    const statTable = options.legacy ? 'battle_stats' : 'phase_battle_stats';
    await ok(db.from(table).insert({ id, match_id: options.legacy ? ids.legacyMatch : ids.match,
      game_number: ++gameNumber, source: 'manual', winner_id: ids.players[0], exclude_all_time: options.exclude ?? false }));
    const stats: BattleStat[] = [{ id: randomUUID(), game_id: id, player_id: ids.players[0], pokemon_name: `${prefix}${label}`,
      was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false, moves_used: ['Thunderbolt'],
      turns_active: 2, match_won: true, created_at: new Date().toISOString() }];
    await ok(db.from(statTable).insert(stats));
    const deltas = options.legacy ? aggregate.buildGameAggregateDeltas(stats, ids.tournament, ids.season, { excludeAllTime: options.exclude })
      : aggregate.buildGameAggregateDeltas(stats, { kind: 'phase', phase_id: ids.phase, season_id: ids.season }, { excludeAllTime: options.exclude });
    return { id, stats, deltas };
  }

  async function claim(gameId: string) {
    const job = await db.rpc('enqueue_phase_aggregate_job', { p_game_id: gameId, p_phase_id: ids.phase, p_season_id: ids.season, p_processing: true });
    if (job.error) throw job.error;
    return job.data;
  }

  async function marker(gameId: string) {
    const result = await db.from('phase_games').select('aggregate_applied_at').eq('id', gameId).single();
    if (result.error) throw result.error;
    return result.data.aggregate_applied_at;
  }

  it('counts duplicate/retried jobs exactly once across native and shared projections', async () => {
    const game = await seed('Idempotent');
    const first = await claim(game.id);
    expect(await native.applyPhaseAggregateJob(first, game.id, game.deltas)).toBe('applied');
    expect(await native.applyPhaseAggregateJob(first, game.id, game.deltas)).toBe('job_not_processing');
    const duplicate = await claim(game.id);
    expect(await native.applyPhaseAggregateJob(duplicate, game.id, game.deltas)).toBe('already_applied');
    expect(await marker(game.id)).not.toBeNull();
    const phase = await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'phase', ids.phase);
    const league = await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'league', ids.season);
    const allTime = await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'all_time', null);
    expect([phase?.total_appearances, league?.total_appearances, allTime?.total_appearances]).toEqual([1, 1, 1]);
    expect((await db.from('aggregates').select('id').eq('scope_id', ids.phase)).data).toEqual([]);
  });

  it('rolls back all effects after a player delta failure and refuses cross-family scopes', async () => {
    const game = await seed('Failure');
    const job = await claim(game.id);
    const invalid = { ...game.deltas, playerDeltas: game.deltas.playerDeltas.map((d) => ({ ...d, player_id: randomUUID() })) };
    await expect(native.applyPhaseAggregateJob(job, game.id, invalid)).rejects.toBeDefined();
    expect(await marker(game.id)).toBeNull();
    expect(await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'phase', ids.phase)).toBeNull();
    expect(await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'league', ids.season)).toBeNull();
    const status = await db.from('phase_aggregate_jobs').select('status').eq('id', job).single();
    expect(status.data?.status).toBe('processing');
    const wrong = aggregate.buildGameAggregateDeltas(game.stats, ids.tournament, ids.season);
    await expect(native.applyPhaseAggregateJob(job, game.id, wrong)).rejects.toMatchObject({ code: '22023' });
    expect(await native.applyPhaseAggregateJob(job, game.id, game.deltas)).toBe('applied');
    const appliedAt = (await marker(game.id))!;
    const failedRollback = await db.rpc('rollback_phase_game_aggregates', {
      p_game_id: game.id, p_expected_applied_at: appliedAt,
      p_aggregate_deltas: game.deltas.aggregateDeltas as unknown as Json,
      p_player_deltas: game.deltas.playerDeltas.map((d) => ({ ...d, kos_dealt: 'invalid-integer' })) as unknown as Json,
    });
    expect(failedRollback.error?.code).toBe('22P02');
    expect(await marker(game.id)).toBe(appliedAt);
    expect((await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'phase', ids.phase))?.total_appearances).toBe(1);
    expect((await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'league', ids.season))?.total_appearances).toBe(1);
  });

  it('preserves the marker fence through edit, cancel-before-rollback and fenced deletion', async () => {
    const game = await seed('Edited', { exclude: true });
    await native.applyPhaseGameAggregatesNow(game.id, { kind: 'phase', phase_id: ids.phase, season_id: ids.season }, game.deltas);
    const old = await marker(game.id);
    expect(old).not.toBeNull();
    expect(await native.rollbackPhaseGameAggregates(game.id, '2000-01-01T00:00:00Z', game.deltas)).toBe('marker_changed');
    await native.enqueuePhaseAggregateJob(game.id, { kind: 'phase', phase_id: ids.phase, season_id: ids.season });
    expect(await native.cancelPhaseAggregateJobsForGame(game.id)).toBe(1);
    expect(await native.rollbackPhaseGameAggregates(game.id, old!, game.deltas)).toBe('rolled_back');
    expect(await native.rollbackPhaseGameAggregates(game.id, old!, game.deltas)).toBe('not_applied');
    const changedStats = game.stats.map((s) => ({ ...s, kos_dealt: 5 }));
    await ok(db.from('phase_battle_stats').update({ kos_dealt: 5 }).eq('game_id', game.id));
    const deltas = aggregate.buildGameAggregateDeltas(changedStats, { kind: 'phase', phase_id: ids.phase, season_id: ids.season }, { excludeAllTime: true });
    await native.applyPhaseGameAggregatesNow(game.id, { kind: 'phase', phase_id: ids.phase, season_id: ids.season }, deltas);
    expect((await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'phase', ids.phase))?.total_kos_dealt).toBe(5);
    expect(await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'all_time', null)).toBeNull();
    const blocked = await db.from('phase_games').delete({ count: 'exact' }).eq('id', game.id).is('aggregate_applied_at', null);
    expect(blocked.count).toBe(0);
    expect(await native.rollbackPhaseGameAggregates(game.id, (await marker(game.id))!, deltas)).toBe('rolled_back');
    await ok(db.from('phase_games').delete().eq('id', game.id).is('aggregate_applied_at', null));
    expect((await db.from('phase_aggregate_jobs').select('id').eq('game_id', game.id)).data).toEqual([]);
  });

  it('reclaims exhausted jobs, cancels claims and retries failed increments', async () => {
    const game = await seed('Reclaimed');
    const job = await claim(game.id);
    const stale = new Date(Date.now() - 20 * 60000).toISOString();
    await ok(db.from('phase_aggregate_jobs').update({ attempts: 3, updated_at: stale }).eq('id', job));
    expect((await native.getPhaseAggregateJobHealth()).staleProcessing).toBeGreaterThanOrEqual(1);
    await ok(db.rpc('reclaim_stale_phase_aggregate_jobs'));
    expect(await native.countFailedPhaseIncrementJobsForSeason(ids.season)).toBe(1);
    expect(await native.requeueFailedPhaseIncrementJobsForSeason(ids.season)).toBe(1);
    const claimed = await db.rpc('claim_phase_aggregate_jobs', { p_limit: 100 });
    if (claimed.error) throw claimed.error;
    expect(claimed.data.some((j) => j.id === job && j.status === 'processing' && j.attempts === 1)).toBe(true);
    expect(await native.cancelPhaseAggregateJobsForGame(game.id)).toBe(1);
    expect(await native.applyPhaseAggregateJob(job, game.id, game.deltas)).toBe('job_not_processing');
  });

  it('serializes duplicate rollbacks and preserves relative decrements of shared species rows', async () => {
    const first = await seed('RollbackRace');
    const second = await seed('RollbackRace');
    await Promise.all([first, second].map(async (game) => native.applyPhaseAggregateJob(await claim(game.id), game.id, game.deltas)));
    const firstMarker = (await marker(first.id))!;
    const outcomes = await Promise.all([0, 1].map(() => native.rollbackPhaseGameAggregates(first.id, firstMarker, first.deltas)));
    expect(outcomes.sort()).toEqual(['not_applied', 'rolled_back']);
    expect((await aggregate.getAggregateForPokemon(first.stats[0].pokemon_name, 'phase', ids.phase))?.total_appearances).toBe(1);
    expect(await native.rollbackPhaseGameAggregates(second.id, (await marker(second.id))!, second.deltas)).toBe('rolled_back');
    expect(await aggregate.getAggregateForPokemon(first.stats[0].pokemon_name, 'phase', ids.phase)).toBeNull();
    expect(await aggregate.getAggregateForPokemon(first.stats[0].pokemon_name, 'league', ids.season)).toBeNull();
  });

  it('rebuilds league scope from both streams once and fences live jobs and preserved IDs', async () => {
    const normal = await seed('Mixed');
    await native.applyPhaseGameAggregatesNow(normal.id, { kind: 'phase', phase_id: ids.phase, season_id: ids.season }, normal.deltas);
    const preserved = await seed('Mixed', { legacy: true, id: normal.id });
    await ok(db.from('games').update({ aggregate_applied_at: await marker(normal.id) }).eq('id', preserved.id));
    const legacy = await seed('Legacy', { legacy: true });
    const live = await seed('Live');
    await native.enqueuePhaseAggregateJob(live.id, { kind: 'phase', phase_id: ids.phase, season_id: ids.season });
    await native.enqueuePhaseAggregateJob(live.id, { kind: 'phase', phase_id: ids.phase, season_id: ids.season });
    await rebuild.rebuildMixedAggregatesForScope('league', ids.season);
    expect((await aggregate.getAggregateForPokemon(normal.stats[0].pokemon_name, 'league', ids.season))?.total_appearances).toBe(1);
    expect((await aggregate.getAggregateForPokemon(legacy.stats[0].pokemon_name, 'league', ids.season))?.total_appearances).toBe(1);
    expect(await aggregate.getAggregateForPokemon(live.stats[0].pokemon_name, 'league', ids.season)).toBeNull();
    await native.processPhaseAggregateJobs(100);
    expect((await aggregate.getAggregateForPokemon(live.stats[0].pokemon_name, 'league', ids.season))?.total_appearances).toBe(1);
    await rebuild.rebuildMixedAggregatesForScope('league', ids.season);
    expect((await aggregate.getAggregateForPokemon(live.stats[0].pokemon_name, 'league', ids.season))?.total_appearances).toBe(1);
    const countedAt = await marker(normal.id);
    await rebuild.rebuildMixedAggregatesForScope('phase', ids.phase);
    expect((await aggregate.getAggregateForPokemon(normal.stats[0].pokemon_name, 'phase', ids.phase))?.total_appearances).toBe(1);
    expect(await marker(normal.id)).toBe(countedAt);
    const phaseGames = await db.from('phase_games').select('id', { count: 'exact', head: true }).eq('match_id', ids.match);
    const legacyGames = await db.from('games').select('id', { count: 'exact', head: true }).eq('match_id', ids.legacyMatch);
    expect(await aggregate.getTotalGamesInMixedScope('league', ids.season)).toBe(phaseGames.count! + legacyGames.count! - 1);
  });

  async function holdApply(jobId: string, game: Awaited<ReturnType<typeof seed>>) {
    const args = { job: jobId, game: game.id, aggregates: JSON.stringify(game.deltas.aggregateDeltas), players: JSON.stringify(game.deltas.playerDeltas) };
    const child = spawn('docker', ['exec', '-i', 'supabase_db_poketools', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt',
      '-v', 'ON_ERROR_STOP=1', ...Object.entries(args).flatMap(([key, value]) => ['-v', `${key}=${value}`])], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const closed = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Local psql failed: ${stderr}`)));
    });
    const ready = new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Local psql lock was not reached')); }, 10000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('HELD')) { clearTimeout(timer); resolve(); }
      });
      void closed.catch((error: unknown) => { clearTimeout(timer); reject(error); });
    });
    child.stdin.write(`BEGIN;
SELECT public.apply_phase_aggregate_job(:'job'::uuid, :'game'::uuid, :'aggregates'::jsonb, :'players'::jsonb);
\\echo HELD
`);
    await ready;
    return async () => { child.stdin.end('COMMIT;\n'); await closed; };
  }

  it('serializes duplicate applies and cancel behind the same open apply transaction', async () => {
    const game = await seed('Contention');
    const first = await claim(game.id);
    const second = await claim(game.id);
    const release = await holdApply(first, game);
    let duplicateDone = false;
    let cancelDone = false;
    const duplicate = native.applyPhaseAggregateJob(second, game.id, game.deltas).then((value) => { duplicateDone = true; return value; });
    const cancel = db.rpc('cancel_phase_aggregate_jobs_for_game', { p_game_id: game.id }).then((result) => { cancelDone = true; return result; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(duplicateDone).toBe(false);
      expect(cancelDone).toBe(false);
    } finally {
      await release();
    }
    const result = await duplicate;
    expect(['already_applied', 'job_not_processing']).toContain(result);
    expect((await cancel).error).toBeNull();
    expect(await marker(game.id)).not.toBeNull();
    expect((await aggregate.getAggregateForPokemon(game.stats[0].pokemon_name, 'phase', ids.phase))?.total_appearances).toBe(1);
  });
});
