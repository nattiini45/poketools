import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as postIdOnly } from '@/app/api/parse-replay/route';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { parseReplayLog } from '@/lib/pkmn/replay';
import { computeReplayHash } from '@/lib/pkmn/replay-identity';
import { publicTags } from '@/lib/revalidation';
import { POST } from '../route';

const h = vi.hoisted(() => ({
  auth: vi.fn(), admin: vi.fn(), limit: vi.fn(), mode: vi.fn(), owner: vi.fn(),
  standalone: vi.fn(), legacyOwner: vi.fn(), legacyMatch: vi.fn(), legacyAi: vi.fn(),
  phase: vi.fn(), match: vi.fn(), round: vi.fn(), getPlayer: vi.fn(), fetchReplay: vi.fn(),
  insertGame: vi.fn(), insertStats: vi.fn(), gameByHash: vi.fn(), transition: vi.fn(),
  outcome: vi.fn(), nextNumber: vi.fn(), winCounts: vi.fn(), stats: vi.fn(), enqueueRpc: vi.fn(),
  unexpectedDb: vi.fn(), tag: vi.fn(), path: vi.fn(), after: vi.fn(), audit: vi.fn(),
  discord: vi.fn(), social: vi.fn(),
}));

vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), after: h.after }));
vi.mock('next/cache', () => ({ revalidateTag: h.tag, revalidatePath: h.path }));
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: h.auth }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: h.unexpectedDb, rpc: h.enqueueRpc } }));
vi.mock('@/lib/supabase/queries/aggregate-rebuild-lock', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/aggregate-rebuild-lock')>(),
  assertNoAggregateRebuild: async () => {},
}));
vi.mock('@/lib/supabase/queries/phase-admins', () => ({ isPhaseAdminFor: h.admin }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: h.owner,
  findLegacyPhaseAliasOwner: h.legacyOwner,
  standaloneMatchAliasExists: h.standalone,
}));
vi.mock('@/lib/supabase/queries/phase-matches', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/phase-matches')>(),
  getPhaseMatchById: h.match, transitionPhaseMatchStatus: h.transition,
}));
vi.mock('@/lib/supabase/queries/phase-games', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/phase-games')>(),
  createPhaseGame: h.insertGame, createPhaseBattleStats: h.insertStats, getNextPhaseGameNumber: h.nextNumber,
  getPhaseGameWinCounts: h.winCounts, getPhaseBattleStatsByMatch: h.stats, findPhaseGameIdByReplayHash: h.gameByHash,
}));
vi.mock('@/lib/supabase/queries/phase-rounds', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/phase-rounds')>(), getPhaseRoundById: h.round,
}));
vi.mock('@/lib/supabase/queries/phase-match-outcomes', () => ({ recordPhaseMatchOutcome: h.outcome }));
vi.mock('@/lib/supabase/queries/league-phases', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/league-phases')>(), getPhaseById: h.phase,
}));
vi.mock('@/lib/supabase/queries/test-accounts', () => ({ shouldExcludeFromAllTime: async () => false }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: h.legacyMatch }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPlayerByPsUsername: h.getPlayer }));
vi.mock('@/lib/pkmn/replay', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/pkmn/replay')>();
  return { ...original, fetchReplay: h.fetchReplay, parseReplayLog: vi.fn(original.parseReplayLog) };
});
vi.mock('@/lib/utils/rate-limit', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/utils/rate-limit')>(), checkRateLimit: h.limit,
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.audit }));
vi.mock('@/lib/ai/trigger', () => ({ triggerMatchAnalysis: h.legacyAi }));
vi.mock('@/lib/discord/notify', () => ({ emitPhaseDiscordEvent: h.discord }));
vi.mock('@/lib/social/notify', () => ({ emitPhaseSocialEvent: h.social }));

const id = '10000000-0000-4000-8000-0000000000aa';
const phaseId = '20000000-0000-4000-8000-0000000000bb';
const matchId = '30000000-0000-4000-8000-0000000000cc';
const anotherId = '40000000-0000-4000-8000-0000000000dd';
const params = { id: id.toUpperCase(), phaseId: phaseId.toUpperCase(), matchId: matchId.toUpperCase() };
const owner = { kind: 'phase', phase_id: phaseId, season_id: id };
const replayUrl = 'https://replay.pokemonshowdown.com/gen9ou-120';
const body = { match_id: matchId.toUpperCase(), replay_url: replayUrl };
const p1 = 'player-one';
const p2 = 'player-two';
const organizer = 'organizer';
const names = { p1: 'fixture_one', p2: 'fixture_two' };
const log = [
  '|gen|9', `|player|p1|${names.p2}`, `|player|p2|${names.p1}`,
  '|switch|p1a: Pikachu|Pikachu|100/100', '|switch|p2a: Garchomp|Garchomp|100/100', '|turn|1',
];
const winLog = [...log, `|win|${names.p1}`].join('\n');
const match = {
  id: matchId, phase_id: phaseId, round_id: 'round', status: 'in_progress', games: [],
  player_1_id: p1, player_2_id: p2, player_1_name: 'Fixture One', player_2_name: 'Fixture Two',
};
const game = { id: 'game', game_number: 1, winner_id: p1, replay_url: replayUrl };

function request(input: unknown = body) {
  return new NextRequest('http://localhost', {
    method: 'POST', headers: { cookie: 'fixture=transport' },
    body: typeof input === 'string' ? input : JSON.stringify(input),
  });
}
const call = (input: unknown = body, path = params) => POST(request(input), { params: Promise.resolve(path) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected outbound request'); }));
  h.unexpectedDb.mockImplementation(() => { throw new Error('Unexpected database access'); });
  h.auth.mockResolvedValue({ playerId: p1, isAdmin: false });
  h.limit.mockResolvedValue({ allowed: true });
  h.mode.mockResolvedValue('phase');
  h.owner.mockResolvedValue(owner);
  h.phase.mockResolvedValue({ id: phaseId, season_id: id, name: 'Fixture Phase', season_format_type: 'evolution_point_buy' });
  h.round.mockResolvedValue({ id: 'round', phase_id: phaseId, name: 'Fixture Round', best_of: 1 });
  h.match.mockResolvedValue(match);
  h.getPlayer.mockImplementation((name: string) => name === names.p1 ? { id: p1 } : { id: p2 });
  h.fetchReplay.mockResolvedValue({ log: winLog });
  h.gameByHash.mockResolvedValue(null);
  h.nextNumber.mockResolvedValue(1);
  h.insertGame.mockImplementation(async () => {
    h.match.mockResolvedValue({ ...match, games: [game] });
    return game;
  });
  h.winCounts.mockResolvedValue({ player_1_wins: 1, player_2_wins: 0 });
  h.transition.mockResolvedValue({ ...match, status: 'pending_confirmation' });
  h.outcome.mockResolvedValue('written');
  h.stats.mockResolvedValue({});
  h.enqueueRpc.mockImplementation(async (rpc: string) => {
    if (rpc !== 'enqueue_phase_aggregate_job') throw new Error('Unexpected database RPC');
    return { data: 'job', error: null };
  });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(h.unexpectedDb).not.toHaveBeenCalled();
  expect(h.legacyMatch).not.toHaveBeenCalled();
  expect(h.legacyOwner).not.toHaveBeenCalled();
  expect(h.standalone).not.toHaveBeenCalled();
  expect(h.legacyAi).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['scoped', 'id-only'] as const)('records a bound game using native services through the %s transport', async transport => {
  const req = request();
  const readBody = vi.spyOn(req, 'json');
  const readHeaders = vi.spyOn(req.headers, 'get');
  const response = transport === 'scoped'
    ? await POST(req, { params: Promise.resolve(params) }) : await postIdOnly(req);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    success: true, data: { game_id: game.id, game_winner_id: p1, match_winner_id: p1,
      match_status: 'pending_confirmation', bo_reached: true, evolution_events: [] },
  });
  expect(h.limit).toHaveBeenCalledExactlyOnceWith('parse-replay', p1, { limit: 20, windowSeconds: 3600 });
  expect(readBody).toHaveBeenCalledOnce();
  expect(readHeaders).not.toHaveBeenCalledWith('cookie');
  expect(h.admin).not.toHaveBeenCalled();
  expect(h.owner).toHaveBeenCalledExactlyOnceWith(transport === 'scoped' ? { phaseId, matchId } : { matchId });
  expect(h.owner).toHaveBeenCalledBefore(h.fetchReplay);
  expect(h.fetchReplay).toHaveBeenCalledExactlyOnceWith(replayUrl);
  expect(parseReplayLog).toHaveBeenCalledExactlyOnceWith(winLog);
  expect(h.gameByHash).toHaveBeenCalledExactlyOnceWith(computeReplayHash(winLog));
  expect(h.insertGame).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    match_id: matchId, winner_id: p1, replay_url: replayUrl, replay_hash: computeReplayHash(winLog), source: 'ps_replay',
  }));
  expect(h.insertStats).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ game_id: game.id, player_id: p2, pokemon_name: 'Pikachu', match_won: false }),
    expect.objectContaining({ game_id: game.id, player_id: p1, pokemon_name: 'Garchomp', match_won: true }),
  ]);
  expect(h.enqueueRpc).toHaveBeenCalledExactlyOnceWith('enqueue_phase_aggregate_job', {
    p_game_id: game.id, p_phase_id: phaseId, p_season_id: id, p_processing: false,
  });
  expect(h.transition).toHaveBeenCalledWith(matchId, expect.objectContaining({ submitterId: p1 }), 'player');
  expect(h.tag).toHaveBeenCalledWith(publicTags.phase(phaseId), { expire: 0 });
  expect(h.path).toHaveBeenCalledWith(`/leagues/${id}/phases/${phaseId}/matches/${matchId}`);
  expect(h.after).toHaveBeenCalledOnce();
  const payload = expect.objectContaining({
    version: 1, owner, event_type: 'match_result_submitted',
    data: expect.objectContaining({ replay_url: replayUrl, winner_name: 'Fixture One' }),
  });
  expect(h.discord).toHaveBeenCalledExactlyOnceWith(payload);
  expect(h.social).toHaveBeenCalledExactlyOnceWith(payload);
});

it('denies an outsider before fetching, but passes live phase-admin authority through the pipeline', async () => {
  h.auth.mockResolvedValue({ playerId: organizer, isAdmin: false });
  h.admin.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const denied = await call();
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: 'match_submit_forbidden' });
  expect(h.fetchReplay).not.toHaveBeenCalled();
  expect((await call()).status).toBe(200);
  expect(h.admin).toHaveBeenLastCalledWith(organizer, phaseId);
  expect(h.admin).toHaveBeenCalledBefore(h.fetchReplay);
  expect(h.transition).toHaveBeenCalledWith(matchId, expect.objectContaining({ submitterId: organizer }), 'admin');
});

it.each([
  ['id', 'INVALID_SEASON_ID'], ['phaseId', 'INVALID_PHASE_ID'], ['matchId', 'INVALID_MATCH_ID'],
] as const)('rejects invalid %s without resolving ownership', async (key, code) => {
  const response = await call(body, { ...params, [key]: 'invalid' });
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code });
  expect(h.owner).not.toHaveBeenCalled();
  expect(h.fetchReplay).not.toHaveBeenCalled();
});

it.each([
  ['{', 'invalid_json'],
  [{ ...body, match_id: anotherId }, 'validation_failed'],
  [{ ...body, replay_url: 'https://example.invalid/gen9ou-120' }, 'replay_url_invalid'],
] as const)('rejects invalid replay bodies before ownership or fetch', async (input, code) => {
  const response = await call(input);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code });
  expect(h.owner).not.toHaveBeenCalled();
  expect(h.fetchReplay).not.toHaveBeenCalled();
});

it('blocks unauthenticated and rate-limited requests before ownership resolution', async () => {
  h.auth.mockRejectedValueOnce(new UserFacingError('Not authenticated', { status: 401 }));
  expect((await call()).status).toBe(401);
  expect(h.limit).not.toHaveBeenCalled();
  h.limit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 90 });
  const denied = await call();
  expect(denied.status).toBe(429);
  expect(denied.headers.get('Retry-After')).toBe('90');
  expect(h.mode).not.toHaveBeenCalled();
  expect(h.fetchReplay).not.toHaveBeenCalled();
});

it('rejects missing ownership, wrong league, wrong phase and a mismatched live match without a replay fetch', async () => {
  h.owner.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(404);
  expect((await call(body, { ...params, id: anotherId })).status).toBe(404);
  expect((await call(body, { ...params, phaseId: anotherId })).status).toBe(404);
  expect(h.match).not.toHaveBeenCalled();
  h.match.mockResolvedValueOnce({ ...match, phase_id: anotherId });
  expect((await call()).status).toBe(404);
  h.match.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(404);
  expect(h.admin).not.toHaveBeenCalled();
  expect(h.fetchReplay).not.toHaveBeenCalled();
  expect(h.insertGame).not.toHaveBeenCalled();
});

it.each([['legacy', 404], ['frozen_legacy', 503], ['frozen_phase', 503]])(
  'never falls back to legacy for the scoped route in %s mode', async (mode, status) => {
    h.mode.mockResolvedValue(mode);
    expect((await call()).status).toBe(status);
    expect(h.owner).not.toHaveBeenCalled();
    expect(h.fetchReplay).not.toHaveBeenCalled();
  },
);

it.each([
  [null, 'name_mismatch', { username: names.p2 }],
  [{ id: 'outsider', name: 'Fixture Outsider' }, 'replay_player_not_in_match', { username: names.p2, player: 'Fixture Outsider' }],
] as const)('preserves Showdown mapping errors and the fallback payload for %j', async (player, code, params) => {
  h.getPlayer.mockResolvedValueOnce(player);
  const response = await call();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code, params, ps_usernames: [names.p2, names.p1] });
  expect(h.insertGame).not.toHaveBeenCalled();
});

it('keeps duplicate replay refusal and does not write or announce', async () => {
  h.gameByHash.mockResolvedValueOnce('existing-game');
  const response = await call();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'replay_already_recorded' });
  expect(h.gameByHash).toHaveBeenCalledExactlyOnceWith(computeReplayHash(winLog));
  expect(h.insertGame).not.toHaveBeenCalled();
  expect(h.discord).not.toHaveBeenCalled();
});

it('refuses an already attached replay URL before checking its hash', async () => {
  h.match.mockResolvedValue({ ...match, games: [game] });
  const response = await call();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'duplicate_replay' });
  expect(h.gameByHash).not.toHaveBeenCalled();
  expect(h.insertGame).not.toHaveBeenCalled();
});

it('refuses two Showdown sides resolving to the same registered participant', async () => {
  h.getPlayer.mockResolvedValue({ id: p1 });
  const response = await call();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'replay_sides_not_distinct' });
  expect(h.insertGame).not.toHaveBeenCalled();
});

it('disputes an engine tie, invalidates the phase and returns the unresolved error without recording a game', async () => {
  h.fetchReplay.mockResolvedValueOnce({ log: [...log, '|tie'].join('\n') });
  const response = await call();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'match_replay_unresolved' });
  expect(h.transition).toHaveBeenCalledExactlyOnceWith(matchId, { expectedStatus: 'in_progress', status: 'disputed' }, 'system');
  expect(h.outcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    matchId, kind: 'unresolved', source: 'replay', reason: 'replay_engine_tie',
  }));
  expect(h.tag).toHaveBeenCalledWith(publicTags.phase(phaseId), { expire: 0 });
  expect(h.path).toHaveBeenCalledWith(`/leagues/${id}/phases/${phaseId}/matches/${matchId}`);
  expect(h.insertGame).not.toHaveBeenCalled();
  expect(h.enqueueRpc).not.toHaveBeenCalled();
  expect(h.discord).not.toHaveBeenCalled();
});

it('does not dispute a log with no winner or tie', async () => {
  h.fetchReplay.mockResolvedValueOnce({ log: log.join('\n') });
  const response = await call();
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'replay_winner_unknown' });
  expect(h.transition).not.toHaveBeenCalled();
  expect(h.insertGame).not.toHaveBeenCalled();
});
