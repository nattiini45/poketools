import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { POST } from '../route';
import { POST as REPAIR } from '../../repair-bracket/route';
import { POST as REGENERATE } from '../../regenerate-bracket/route';

const m = vi.hoisted(() => ({
  actor: vi.fn(), allowed: vi.fn(), mode: vi.fn(), season: vi.fn(), phase: vi.fn(),
  participants: vi.fn(), rounds: vi.fn(), rpc: vi.fn(), startRound: vi.fn(), updateSeason: vi.fn(),
  expire: vi.fn(), audit: vi.fn(), discord: vi.fn(), social: vi.fn(), formatAttached: vi.fn(),
  kitPhase: vi.fn(), kitContext: vi.fn(), stageStart: vi.fn(), fireEvent: vi.fn(),
  phaseMatches: vi.fn(), phaseMatch: vi.fn(), resetMatch: vi.fn(), invalidateMatch: vi.fn(),
  legacy: vi.fn(() => { throw new Error('Legacy persistence must not run'); }),
}));
vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: m.actor,
  AuthError: class extends Error {
    constructor(message: string, readonly statusCode: number, readonly code: string) { super(message); }
  },
}));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: m.allowed }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: m.mode }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: m.rpc } }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: m.season, updateSeason: m.updateSeason }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: m.phase, getPhaseParticipants: m.participants }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getMatchesByPhase: m.phaseMatches, getPhaseMatchById: m.phaseMatch }));
vi.mock('@/lib/supabase/queries/phase-rounds', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/phase-rounds')>(),
  getRoundsByPhase: m.rounds, updatePhaseRoundStatus: m.startRound,
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: m.legacy, getParticipants: m.legacy }));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: m.legacy, writeBracket: m.legacy, updateRoundStatus: m.legacy,
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: m.legacy, getMatchesByTournament: m.legacy, createMatch: m.legacy,
}));
vi.mock('@/lib/pkmn/game-pipeline', () => ({ resetMatch: m.legacy }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: m.expire, revalidatePhaseMatchPages: m.invalidateMatch }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: m.audit }));
vi.mock('@/lib/discord/notify', () => ({ emitPhaseDiscordEvent: m.discord, emitDiscordEvent: m.legacy }));
vi.mock('@/lib/social/notify', () => ({ emitPhaseSocialEvent: m.social, emitSocialEvent: m.legacy }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: m.formatAttached }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: m.kitPhase }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({
  onNativePhaseStatusChanged: m.stageStart, onRoundGenerated: m.legacy,
}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: m.fireEvent }));
vi.mock('../../rounds/_lib/effects', () => ({ nativeRoundServices: () => ({ matches: { kit: nativeKit, resetMatch: m.resetMatch } }) }));

const id = '10000000-0000-4000-8000-0000000000a1';
const phaseId = '20000000-0000-4000-8000-0000000000b2';
const other = '30000000-0000-4000-8000-0000000000c3';
const actor = { playerId: 'player-admin', name: 'Test Admin', isAdmin: false };
const phase = {
  id: phaseId, season_id: id, name: 'Playoffs', bracket_type: 'single_elim', status: 'upcoming',
  current_round: 0, best_of_default: 3, bo_overrides: { Finals: 5 }, third_place_enabled: true,
  updated_at: '2026-11-17T10:00:00Z',
};
const players = ['Alpha', 'Bravo', 'Charlie'].map((name, index) => ({
  id: `player-${index + 1}`, name, seed: index + 1, starting_bracket: 'winners',
}));
const nativeKit = { storage: {}, eventPort: { load: m.kitContext }, statusPort: {} };
const ctx = (path = { id: id.toUpperCase(), phaseId: phaseId.toUpperCase() }) => ({ params: Promise.resolve(path) });
const request = (body?: unknown, query = '') => new NextRequest(`http://localhost/${query}`, {
  method: 'POST', body: JSON.stringify(body),
});

function kitLeague() {
  m.season.mockResolvedValue({ id, status: 'active', format_type: 'custom' });
  const stage = { key: 'playoffs' };
  m.kitPhase.mockResolvedValue({ engine: 'kit', revision: 4, stage });
  const context = {
    revision: 4, def: { rules: [] }, state: {
      links: [],
      checks: [{ source: 'deadline_missed', status: 'open', subject: { applies: 'action' } }],
    },
    phases: [{ id: phaseId, stage, members: players.map(player => player.id) }],
  };
  m.kitContext.mockResolvedValue(context);
  m.stageStart.mockResolvedValue({ applied: true });
  return context;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue(actor);
  m.allowed.mockResolvedValue(true);
  m.mode.mockResolvedValue('phase');
  m.season.mockResolvedValue({ id, status: 'upcoming', format_type: 'singles' });
  m.phase.mockResolvedValue(phase);
  m.participants.mockResolvedValue(players);
  m.rounds.mockResolvedValue([]);
  m.rpc.mockResolvedValue({ data: null, error: null });
  m.phaseMatches.mockResolvedValue([]);
});

it('repairs a missing native final from its completed feeder without rewriting the feeder', async () => {
  m.phase.mockResolvedValue({ ...phase, status: 'active' });
  m.rounds.mockResolvedValue([
    { id: 'semis', round_number: 1, bracket_side: 'winners', status: 'completed' },
    { id: 'final', round_number: 2, bracket_side: 'winners', status: 'pending' },
  ]);
  m.phaseMatches.mockResolvedValue([{
    id: 'played', round_id: 'semis', bracket_side: 'winners', bracket_pos: 1, status: 'completed', updated_at: phase.updated_at,
    player_1_id: 'player-2', player_2_id: 'player-3', winner_id: 'player-2', games: [{ id: 'played-game' }],
  }]);
  m.rpc.mockResolvedValueOnce({ data: { slots_materialized: 1, slots_updated: 0 }, error: null });
  const response = await REPAIR(request(), ctx());
  expect(response.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('phase_bracket_repair', expect.objectContaining({
    p_season_id: id, p_phase_id: phaseId, p_expected_matches: [{ id: 'played', updated_at: phase.updated_at, has_games: true }],
    p_slots: [expect.objectContaining({ match_id: null, round_id: 'final', player_1_id: 'player-1', player_2_id: 'player-2' })],
  }));
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(m.legacy).not.toHaveBeenCalled();
});

it('requires explicit cascade before undoing a played native bracket and invalidates an attempted reset', async () => {
  m.phase.mockResolvedValue({ ...phase, status: 'active' });
  m.rounds.mockResolvedValue([{ id: 'semis', round_number: 1, bracket_side: 'winners', status: 'completed' }]);
  const played = { id: 'played', phase_id: phaseId, status: 'completed', games: [{ id: 'game' }] };
  m.phaseMatches.mockResolvedValue([played]);
  m.phaseMatch.mockResolvedValue(played);
  m.resetMatch.mockResolvedValue({ format_revert_failed: true });
  const preview = await REGENERATE(request({ cascade: false }), ctx());
  expect(preview.status).toBe(409);
  expect(await preview.json()).toMatchObject({ code: 'REGENERATE_PLAYED', params: { count: 1 } });
  expect(m.resetMatch).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
  const response = await REGENERATE(request({ cascade: true }), ctx());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { format_revert_failed: true } });
  expect(m.resetMatch).toHaveBeenCalledExactlyOnceWith('played', actor.playerId, true);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('phase_bracket_write_guarded', expect.objectContaining({
    p_phase_id: phaseId, p_expected_status: 'active', p_replace: true,
  }));
  expect(m.rpc).toHaveBeenCalledAfter(m.resetMatch);
  expect(m.invalidateMatch).toHaveBeenCalledExactlyOnceWith(phaseId, 'played', id);
  expect(m.legacy).not.toHaveBeenCalled();
});

it('refuses legacy mode and a phase belonging to a different league before any maintenance', async () => {
  m.mode.mockResolvedValueOnce('legacy');
  expect((await REPAIR(request(), ctx())).status).toBe(404);
  m.phase.mockResolvedValueOnce({ ...phase, season_id: other });
  expect((await REGENERATE(request({ cascade: true }), ctx())).status).toBe(404);
  expect(m.phaseMatches).not.toHaveBeenCalled();
  expect(m.resetMatch).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});

it.each([false, true])('preflights every match before resetting any results when a scheduled match has games (cascade=%s)', async cascade => {
  m.phase.mockResolvedValue({ ...phase, status: 'active' });
  m.rounds.mockResolvedValue([{ id: 'semis', round_number: 1 }]);
  m.phaseMatches.mockResolvedValue([
    { id: 'completed-match', status: 'completed', games: [{ id: 'completed-game' }] },
    { id: 'scheduled-match', status: 'scheduled', games: [{ id: 'unsettled-game' }] },
  ]);
  const response = await REGENERATE(request({ cascade }), ctx());
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'phase_bracket_regenerate_scheduled_games' });
  expect(m.phaseMatch).not.toHaveBeenCalled();
  expect(m.resetMatch).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it('refuses a scheduled game observed on the reload before calling the reset pipeline', async () => {
  m.phase.mockResolvedValue({ ...phase, status: 'active' });
  m.rounds.mockResolvedValue([{ id: 'semis', round_number: 1 }]);
  const original = { id: 'changed-match', phase_id: phaseId, status: 'completed', games: [{ id: 'game' }] };
  m.phaseMatches.mockResolvedValue([original]);
  m.phaseMatch.mockResolvedValue({ ...original, status: 'scheduled' });
  const response = await REGENERATE(request({ cascade: true }), ctx());
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'phase_bracket_regenerate_scheduled_games' });
  expect(m.phaseMatch).toHaveBeenCalledExactlyOnceWith(original.id);
  expect(m.resetMatch).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});

it('plans a single-elimination bracket with a bye, writes one native RPC, and emits native effects', async () => {
  const response = await POST(request(), ctx());
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ success: true, data: { rounds_created: 2, matches_materialized: 1 } });
  expect(m.allowed).toHaveBeenCalledExactlyOnceWith(actor, phaseId);
  expect(m.participants).toHaveBeenCalledExactlyOnceWith(phaseId);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('phase_bracket_write_guarded', {
    p_phase_id: phaseId, p_expected_status: 'upcoming', p_replace: false, p_current_round: 1,
    p_expected_updated_at: phase.updated_at,
    p_expected_seeds: players.map(({ id: player_id, seed, starting_bracket }) => ({ player_id, seed, starting_bracket })),
    p_rounds: [
      expect.objectContaining({ round_number: 1, name: 'Semifinals', best_of: 3, bracket_side: 'winners' }),
      expect.objectContaining({ round_number: 2, name: 'Finals', best_of: 5, bracket_side: 'winners' }),
    ],
    p_matches: [expect.objectContaining({ player_1_id: 'player-2', player_2_id: 'player-3', bracket_side: 'winners' })],
  });
  expect(m.startRound).not.toHaveBeenCalled();
  expect(m.formatAttached).not.toHaveBeenCalled();
  expect(m.updateSeason).toHaveBeenCalledExactlyOnceWith(id, { status: 'active' }, { from: 'upcoming' });
  expect(m.updateSeason).toHaveBeenCalledAfter(m.rpc);
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(m.expire).toHaveBeenCalledAfter(m.updateSeason);
  expect(m.audit).toHaveBeenCalledExactlyOnceWith({
    actor_id: actor.playerId, actor_name: actor.name, action: 'bracket.generate',
    resource_type: 'phase', resource_id: phaseId, resource_name: phase.name,
    metadata: { rounds_created: 2, matches_materialized: 1, started: false },
  });
  const event = {
    version: 1, owner: { kind: 'phase', phase_id: phaseId, season_id: id }, event_type: 'round_generated',
    data: { kind: 'round_generated', phase_name: phase.name, round_name: 'Full bracket', pairings: [] },
  };
  expect(m.discord).toHaveBeenCalledExactlyOnceWith(event);
  expect(m.social).toHaveBeenCalledExactlyOnceWith(event);
  expect(m.legacy).not.toHaveBeenCalled();
});

it('uses double-elimination seed placement and starts only the first round after the write when requested', async () => {
  m.phase.mockResolvedValue({ ...phase, status: 'active', bracket_type: 'double_elim', bracket_reset_enabled: true });
  m.participants.mockResolvedValue([
    ...players, { id: 'player-4', name: 'Delta', seed: 4, starting_bracket: 'losers' },
    { id: 'player-5', name: 'Echo', seed: 5, starting_bracket: 'losers' },
  ]);
  const response = await POST(request({ start_round: true }), ctx());
  expect(response.status).toBe(201);
  const input = m.rpc.mock.calls[0][1];
  expect(input).toMatchObject({
    p_expected_status: 'active', p_replace: false,
    p_rounds: expect.arrayContaining([expect.objectContaining({ bracket_side: 'grand_finals', name: 'Grand Finals' })]),
    p_matches: expect.arrayContaining([expect.objectContaining({
      bracket_side: 'losers', player_1_id: 'player-4', player_2_id: 'player-5',
    })]),
  });
  const first = input.p_rounds[0].id;
  expect(m.startRound).toHaveBeenCalledExactlyOnceWith(first, 'active', 'pending');
  expect(m.startRound).toHaveBeenCalledAfter(m.rpc);
  expect(await response.json()).toEqual({
    success: true, data: {
      rounds_created: input.p_rounds.length, matches_materialized: input.p_matches.length, started_round_id: first,
    },
  });
});

it('returns 201 without a started-round id when the requested round start fails', async () => {
  m.startRound.mockRejectedValueOnce(new Error('Round moved'));
  const response = await POST(request({ start_round: true }), ctx());
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ success: true, data: { rounds_created: 2, matches_materialized: 1 } });
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
});

it('requires a live phase admin and verifies both IDs, storage mode, and ownership', async () => {
  m.actor.mockRejectedValueOnce(new UserFacingError('Authentication required', { code: 'unauthenticated', status: 401 }));
  expect((await POST(request(), ctx())).status).toBe(401);
  expect(m.mode).not.toHaveBeenCalled();
  for (const [path, code] of [
    [{ id: 'bad', phaseId }, 'INVALID_SEASON_ID'],
    [{ id, phaseId: 'bad' }, 'INVALID_PHASE_ID'],
  ] as const) {
    expect(await (await POST(request(), ctx(path))).json()).toMatchObject({ code });
  }
  expect(m.mode).not.toHaveBeenCalled();
  m.mode.mockResolvedValueOnce('legacy').mockRejectedValueOnce(new UserFacingError('Unavailable', {
    code: 'phase_storage_unavailable', status: 503,
  }));
  expect((await POST(request(), ctx())).status).toBe(404);
  expect((await POST(request(), ctx())).status).toBe(503);
  expect(m.season).not.toHaveBeenCalled();
  m.season.mockResolvedValueOnce(null);
  expect(await (await POST(request(), ctx())).json()).toMatchObject({ code: 'season_not_found' });
  m.phase.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...phase, season_id: other });
  for (let i = 0; i < 2; i++) {
    expect(await (await POST(request(), ctx())).json()).toMatchObject({ code: 'PHASE_NOT_FOUND' });
  }
  expect(m.allowed).not.toHaveBeenCalled();
  m.allowed.mockResolvedValueOnce(false);
  expect((await POST(request(), ctx())).status).toBe(403);
  expect(m.participants).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.legacy).not.toHaveBeenCalled();
});

it('refuses invalid flags, non-elimination, completed, undersized, and already generated brackets', async () => {
  expect(await (await POST(request({ start_round: 'true' }), ctx())).json()).toMatchObject({ code: 'validation_failed' });
  expect(await (await POST(request({ cascade: true }), ctx())).json()).toMatchObject({ code: 'validation_failed' });
  m.phase.mockResolvedValueOnce({ ...phase, bracket_type: 'swiss' }).mockResolvedValueOnce({ ...phase, status: 'completed' });
  const nonElim = await POST(request(), ctx());
  expect(nonElim.status).toBe(400);
  expect(await nonElim.json()).toMatchObject({ code: 'bracket_generate_elim_only' });
  const completed = await POST(request(), ctx());
  expect(completed.status).toBe(400);
  expect(await completed.json()).toMatchObject({ code: 'tournament_already_completed' });
  m.participants.mockResolvedValueOnce(players.slice(0, 1));
  expect(await (await POST(request(), ctx())).json()).toMatchObject({ code: 'tournament_participants_too_few' });
  m.rounds.mockResolvedValueOnce([{ id: 'existing' }]);
  const existing = await POST(request(), ctx());
  expect(existing.status).toBe(409);
  expect(await existing.json()).toMatchObject({ code: 'bracket_already_generated' });
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it.each([
  ['tournament_status_changed', 'tournament_status_changed', 409],
  ['bracket_already_generated', 'bracket_already_generated', 409],
  ['phase_bracket_inputs_changed', 'phase_bracket_inputs_changed', 409],
  ['format_context_stale', 'format_context_stale', 409],
  ['PHASE_GROUPS_STALE', 'PHASE_GROUPS_STALE', 409],
  ['phase_storage_not_ready', 'phase_storage_unavailable', 503],
])('preserves the %s RPC refusal with no start, invalidation, audit or fallback', async (message, code, status) => {
  m.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message } });
  const response = await POST(request({ start_round: true }), ctx());
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code });
  expect(m.rpc).toHaveBeenCalledOnce();
  for (const effect of [m.startRound, m.updateSeason, m.expire, m.audit, m.discord, m.social, m.legacy]) {
    expect(effect).not.toHaveBeenCalled();
  }
});

it('invalidates a committed bracket even when the shared league start fails', async () => {
  m.updateSeason.mockRejectedValueOnce(new Error('League write failed'));
  expect((await POST(request(), ctx())).status).toBe(500);
  expect(m.rpc).toHaveBeenCalledOnce();
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
});

it('requires the custom league to have a format and honours the native first-round readiness gate', async () => {
  kitLeague();
  m.formatAttached.mockRejectedValueOnce(new UserFacingError('Attach a league format first', {
    code: 'format_not_attached', status: 409,
  }));
  expect(await (await POST(request(), ctx())).json()).toMatchObject({ code: 'format_not_attached' });
  const refused = await POST(request(), ctx());
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: 'format_not_ready', params: { reasons: 'action_incomplete' } });
  expect(m.kitPhase).toHaveBeenCalledExactlyOnceWith(id, phaseId, nativeKit.storage);
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
  expect(m.stageStart).not.toHaveBeenCalled();
});

it('audits a force only after success and fires native stage and round start for a pending first round', async () => {
  const context = kitLeague();
  m.rounds.mockResolvedValueOnce([]).mockResolvedValueOnce([{ round_number: 1 }, { round_number: 2 }]);
  const response = await POST(request(undefined, '?force=true'), ctx());
  expect(response.status).toBe(201);
  expect(m.rpc).toHaveBeenCalledWith('phase_bracket_write_guarded', expect.objectContaining({ p_expected_revision: 4 }));
  expect(m.startRound).not.toHaveBeenCalled();
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'season.format.round.force_start', resource_type: 'phase', resource_id: phaseId,
    metadata: { season_id: id, reasons: ['action_incomplete'], relations: [], open_checks: 1 },
  }));
  expect(m.audit).toHaveBeenCalledAfter(m.rpc);
  expect(m.stageStart).toHaveBeenCalledExactlyOnceWith({ phase, from: 'upcoming', to: 'active' }, nativeKit.statusPort);
  expect(m.fireEvent).toHaveBeenCalledExactlyOnceWith(id, { event: 'round_start', stage: 'playoffs', round: 1 }, null, {
    context, port: nativeKit.eventPort,
  });
  expect(m.fireEvent).toHaveBeenCalledAfter(m.stageStart);
});

it('refuses a stale kit context before writing and skips effects if it goes stale after committing', async () => {
  const context = kitLeague();
  m.kitContext.mockResolvedValueOnce({ ...context, revision: 5 });
  const refused = await POST(request(undefined, '?force=true'), ctx());
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: 'format_context_stale' });
  expect(m.rpc).not.toHaveBeenCalled();

  m.kitContext.mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, revision: 5 });
  m.rounds.mockResolvedValueOnce([]).mockResolvedValueOnce([{ round_number: 1 }]);
  expect((await POST(request(undefined, '?force=true'), ctx())).status).toBe(201);
  expect(m.rpc).toHaveBeenCalledOnce();
  expect(m.stageStart).not.toHaveBeenCalled();
  expect(m.fireEvent).not.toHaveBeenCalled();
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
});
