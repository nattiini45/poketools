import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { POST } from '../route';
import { POST as POST_BATCH } from '../../generate-all/route';

const m = vi.hoisted(() => ({
  actor: vi.fn(), allowed: vi.fn(), mode: vi.fn(), season: vi.fn(), phase: vi.fn(), rounds: vi.fn(), matches: vi.fn(),
  participants: vi.fn(), groups: vi.fn(), leagueGroups: vi.fn(), write: vi.fn(), writeBatch: vi.fn(), start: vi.fn(), startSeason: vi.fn(),
  expire: vi.fn(), discord: vi.fn(), social: vi.fn(), audit: vi.fn(), forecast: vi.fn(), standings: vi.fn(),
  kitHead: vi.fn(), loadPhase: vi.fn(), loadContext: vi.fn(), attached: vi.fn(), event: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: m.actor,
  AuthError: class extends Error {
    constructor(message: string, readonly statusCode: number, readonly code: string) { super(message); }
  },
}));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: m.allowed }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: m.mode }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: m.season }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: m.phase, getPhaseParticipants: m.participants }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: m.leagueGroups }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupsByPhase: m.groups }));
vi.mock('@/lib/supabase/queries/phase-format-runtime', () => ({ getNativeKitMatchFacts: m.matches }));
vi.mock('@/lib/supabase/queries/phase-rounds', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/phase-rounds')>(),
  getRoundsByPhase: m.rounds, writeGeneratedPhaseRound: m.write, writeGeneratedPhaseRoundBatch: m.writeBatch, updatePhaseRoundStatus: m.start,
}));
vi.mock('@/lib/league-phase/standings-context', () => ({ loadNativeSeasonStandingsContext: m.standings }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: m.expire, expireTournamentReads: vi.fn() }));
vi.mock('@/lib/season/start-season', () => ({ startSeasonIfUpcoming: m.startSeason }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: m.audit }));
vi.mock('@/lib/discord/notify', () => ({ emitPhaseDiscordEvent: m.discord }));
vi.mock('@/lib/social/notify', () => ({ emitPhaseSocialEvent: m.social }));
vi.mock('@/lib/feature-flags', () => ({ ENABLE_KALE_CABBAGE: true }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: m.attached }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: m.loadPhase }));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: m.event }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({}));
vi.mock('../../_lib/effects', () => ({
  nativeRoundServices: () => ({
    matches: { kit: { storage: { head: m.kitHead }, eventPort: { load: m.loadContext }, statusPort: {} } },
    triggerReport: m.forecast,
  }),
}));

const leagueId = '10000000-0000-4000-8000-0000000000a1';
const phaseId = '20000000-0000-4000-8000-0000000000b2';
const phase = {
  id: phaseId, season_id: leagueId, name: 'Table', status: 'upcoming', bracket_type: 'swiss', current_round: 0,
  best_of_default: 1, bo_overrides: { 'Round 1': 3 }, updated_at: '2026-11-18T00:00:00Z',
};
const season = { id: leagueId, format_type: 'standard', start_date: '2026-11-18' };
const actor = { playerId: 'native-admin', name: 'Test Admin' };
const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ id, name: `Trainer ${id}`, seed: index + 1 }));
const run = (body?: unknown) => POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) }), {
  params: Promise.resolve({ id: leagueId.toUpperCase(), phaseId: phaseId.toUpperCase() }),
});
const runBatch = (body?: unknown) => POST_BATCH(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) }), {
  params: Promise.resolve({ id: leagueId, phaseId }),
});
const round = (number: number, byes: string[] = [], status = 'completed') => ({
  id: `r${number}`, round_number: number, name: `Round ${number}`, status, bye_player_ids: byes, pairings_generated: true,
});
const match = (number: number, a: string, b: string, status = 'completed') => ({
  id: `m${number}-${a}${b}`, round_id: `r${number}`, player_1_id: a, player_2_id: b, status,
  winner_id: status === 'completed' ? a : null,
});

beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue(actor);
  m.mode.mockResolvedValue('phase');
  m.allowed.mockResolvedValue(true);
  m.season.mockResolvedValue(season);
  m.phase.mockResolvedValue(phase);
  m.rounds.mockResolvedValue([]);
  m.matches.mockResolvedValue([]);
  m.groups.mockResolvedValue([]);
  m.leagueGroups.mockResolvedValue([]);
  m.participants.mockResolvedValue(players.slice(0, 5));
  m.write.mockImplementation(async ({ round_number: number, bye_player_ids: byes }) => round(number, byes, 'pending'));
  m.writeBatch.mockImplementation(async (_scope, plans: { round_number: number; bye_player_ids: string[] }[]) =>
    plans.map(plan => round(plan.round_number, plan.bye_player_ids, 'pending')));
  m.start.mockResolvedValue(round(1, [], 'active'));
});

it('writes a full round-robin batch atomically and starts only its first round after commit', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'round_robin' });
  const response = await runBatch({ start_round: true });
  expect(response.status).toBe(201);
  expect((await response.json()).data.map((saved: { status: string }) => saved.status))
    .toEqual(['active', 'pending', 'pending', 'pending', 'pending']);
  expect(m.write).not.toHaveBeenCalled();
  expect(m.writeBatch).toHaveBeenCalledTimes(1);
  const [scope, plans] = m.writeBatch.mock.calls[0];
  expect(scope).toMatchObject({ phase_id: phaseId, season_id: leagueId, expected_updated_at: phase.updated_at });
  expect(plans.map((plan: { round_number: number }) => plan.round_number)).toEqual([1, 2, 3, 4, 5]);
  expect(plans[0]).toMatchObject({ best_of: 3, bye_player_ids: ['a'] });
  expect(m.start).toHaveBeenCalledExactlyOnceWith('r1', 'active', 'pending');
  expect(m.start.mock.invocationCallOrder[0]).toBeGreaterThan(m.writeBatch.mock.invocationCallOrder[0]);
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, leagueId);
  expect(m.discord).not.toHaveBeenCalled();
  expect(m.forecast).not.toHaveBeenCalled();
});

it('never reads or writes a native batch with disabled storage, wrong league, or Swiss format', async () => {
  m.mode.mockResolvedValueOnce('legacy');
  expect((await runBatch()).status).toBe(404);
  expect(m.season).not.toHaveBeenCalled();
  m.phase.mockResolvedValueOnce({ ...phase, season_id: 'other-league' });
  expect((await runBatch()).status).toBe(404);
  const swiss = await runBatch();
  expect(swiss.status).toBe(400);
  expect(await swiss.json()).toMatchObject({ code: 'rounds_round_robin_only' });
  expect(m.rounds).not.toHaveBeenCalled();
  expect(m.writeBatch).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it('writes only the ready weeks before the first standings-dependent placement', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'round_robin' });
  m.participants.mockResolvedValue(players);
  m.leagueGroups.mockResolvedValue([
    { id: 'group-y', name: 'Group Y', sort_order: 1, player_ids: ['a', 'c', 'e'] },
    { id: 'group-x', name: 'Group X', sort_order: 2, player_ids: ['b', 'd', 'f'] },
  ]);
  const response = await runBatch();
  expect(response.status).toBe(201);
  expect((await response.json()).data.map((saved: { round_number: number }) => saved.round_number)).toEqual([1, 2]);
  expect(m.writeBatch).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ replacement_groups: expect.arrayContaining([expect.objectContaining({ season_group_id: 'group-y' })]) }),
    [expect.objectContaining({ bye_player_ids: [] }), expect.objectContaining({ bye_player_ids: [] })],
  );
  expect(m.standings).not.toHaveBeenCalled();
});

it('requires live admin access and native storage before reading pairing data', async () => {
  m.actor.mockRejectedValueOnce(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
  expect((await run()).status).toBe(403);
  expect(m.mode).not.toHaveBeenCalled();
  m.mode.mockResolvedValueOnce('legacy');
  expect((await run()).status).toBe(404);
  m.phase.mockResolvedValueOnce({ ...phase, season_id: 'other-league' });
  expect((await run()).status).toBe(404);
  m.allowed.mockResolvedValueOnce(false);
  expect((await run()).status).toBe(403);
  expect(m.allowed).toHaveBeenCalledWith(actor, phaseId);
  expect(m.rounds).not.toHaveBeenCalled();
  expect(m.write).not.toHaveBeenCalled();
});

it('uses the round override, keeps the bye and starts and announces only after the native commit', async () => {
  const response = await run({ start_round: true });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ data: { status: 'active' } });
  expect(m.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    phase_id: phaseId, season_id: leagueId, expected_updated_at: phase.updated_at, best_of: 3,
    matches: expect.arrayContaining([expect.objectContaining({ player_1_id: expect.any(String) })]),
    bye_player_ids: ['e'],
  }));
  expect(m.start).toHaveBeenCalledWith('r1', 'active', 'pending');
  expect(m.startSeason).toHaveBeenCalledWith(leagueId);
  expect(m.discord.mock.calls.map(([payload]) => payload.event_type)).toEqual(['round_generated', 'phase_started']);
  expect(m.social.mock.calls).toEqual(m.discord.mock.calls);
  expect(m.forecast).toHaveBeenCalledWith(phaseId, 'r1', 'round_forecast');
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, leagueId);
});

it('preserves both earlier Swiss byes and records unfinished pairings without scoring them', async () => {
  m.phase.mockResolvedValue({ ...phase, status: 'active', current_round: 2 });
  m.rounds.mockResolvedValue([round(1, ['e']), round(2, ['d'])]);
  const played = [match(1, 'a', 'b'), match(1, 'c', 'd'), match(2, 'a', 'e'), match(2, 'b', 'c', 'disputed')];
  m.matches.mockResolvedValue(played);
  expect((await run()).status).toBe(201);
  const [write] = m.write.mock.calls[0];
  expect(write.round_number).toBe(3);
  expect(write.bye_player_ids).toHaveLength(1);
  expect(['d', 'e']).not.toContain(write.bye_player_ids[0]);
  for (const { player_1_id: a, player_2_id: b } of write.matches) {
    expect(played.some(before => [before.player_1_id, before.player_2_id].includes(a) && [before.player_1_id, before.player_2_id].includes(b))).toBe(false);
  }
  expect(write.inputs.matches).toEqual(played);
});

it('continues a flat single-elimination bracket with the ordered winners and no league group mirror', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'single_elim', status: 'active', current_round: 1, bo_overrides: { Finals: 5 } });
  m.rounds.mockResolvedValue([{ ...round(1), bracket_side: null }]);
  m.participants.mockResolvedValue(players.slice(0, 4).map(player => ({ ...player, starting_bracket: 'winners' })));
  m.leagueGroups.mockResolvedValue([{ id: 'league-group', name: 'Group A', sort_order: 1, player_ids: ['a', 'b'] }]);
  const previous = [match(1, 'c', 'd'), match(1, 'a', 'b')];
  m.matches.mockResolvedValue(previous);
  expect((await run()).status).toBe(201);
  expect(m.matches).toHaveBeenCalledExactlyOnceWith(phaseId, true);
  expect(m.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    round_number: 2, name: 'Finals', best_of: 5, bye_player_ids: [],
    replacement_groups: undefined, matches: [{ player_1_id: 'c', player_2_id: 'a' }],
    inputs: expect.objectContaining({ matches: [...previous].reverse(), participants: expect.arrayContaining([
      expect.objectContaining({ id: 'a', starting_bracket: 'winners' }),
    ]) }),
  }));
  expect(m.start).not.toHaveBeenCalled();
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, leagueId);
});

it('respects nominal losers-bracket starts in an existing flat double-elimination phase', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'double_elim', status: 'active', current_round: 1 });
  m.rounds.mockResolvedValue([{ ...round(1), bracket_side: null }]);
  m.participants.mockResolvedValue(players.slice(0, 3).map(player => ({
    ...player, starting_bracket: player.id === 'c' ? 'losers' : 'winners',
  })));
  m.matches.mockResolvedValue([match(1, 'a', 'b')]);
  expect((await run()).status).toBe(201);
  expect(m.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    bye_player_ids: [], matches: [{ player_1_id: 'b', player_2_id: 'c' }],
  }));
});

it('uses winners across stale groups when flat elimination history shows cross-group play', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'single_elim', status: 'active', current_round: 1 });
  m.rounds.mockResolvedValue([{ ...round(1), bracket_side: null }]);
  m.participants.mockResolvedValue(players.slice(0, 4).map(player => ({ ...player, starting_bracket: 'winners' })));
  const storedGroups = [['a', 'b'], ['c', 'd']].map((ids, index) => ({
    id: `group-${index}`, name: `Group ${index}`, group_number: index + 1, season_group_id: null,
    members: ids.map((id, seed) => ({ player_id: id, seed: seed + 1 })),
  }));
  m.groups.mockResolvedValue(storedGroups);
  m.matches.mockResolvedValue([match(1, 'a', 'c'), match(1, 'b', 'd')]);
  expect((await run()).status).toBe(201);
  expect(m.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    name: 'Finals', matches: [{ player_1_id: 'a', player_2_id: 'b' }],
    inputs: expect.objectContaining({ groups: storedGroups }),
  }));
});

it('preserves independent flat group finals and uses the legacy numbered best-of override', async () => {
  m.phase.mockResolvedValue({
    ...phase, bracket_type: 'single_elim', status: 'active', current_round: 1,
    bo_overrides: { 'Round 2': 3, Finals: 5 },
  });
  m.rounds.mockResolvedValue([{ ...round(1), bracket_side: null }]);
  const cohorts = [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']];
  m.participants.mockResolvedValue(cohorts.flat().map((id, index) => ({
    id, name: `Trainer ${id}`, seed: index + 1, starting_bracket: 'winners',
  })));
  m.groups.mockResolvedValue(cohorts.map((ids, index) => ({
    id: `group-${index}`, name: `Group ${index}`, group_number: index + 1, season_group_id: null,
    members: ids.map((id, seed) => ({ player_id: id, seed: seed + 1 })),
  })));
  m.matches.mockResolvedValue([match(1, 'a', 'b'), match(1, 'c', 'd'), match(1, 'e', 'f'), match(1, 'g', 'h')]);
  expect((await run()).status).toBe(201);
  expect(m.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    name: 'Round 2', best_of: 3, matches: [{ player_1_id: 'a', player_2_id: 'c' }, { player_1_id: 'e', player_2_id: 'g' }],
  }));
});

it('does not lose an enrolled flat elimination bye to incomplete stored groups', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'single_elim', status: 'active', current_round: 2 });
  m.rounds.mockResolvedValue([{ ...round(1), bracket_side: null }, { ...round(2), bracket_side: null }]);
  m.participants.mockResolvedValue(players.slice(0, 5).map(player => ({ ...player, starting_bracket: 'winners' })));
  m.groups.mockResolvedValue([{
    id: 'group-a', name: 'Group A', group_number: 1, season_group_id: null,
    members: ['a', 'b', 'c', 'd'].map((id, seed) => ({ player_id: id, seed: seed + 1 })),
  }]);
  m.matches.mockResolvedValue([match(1, 'a', 'b'), match(1, 'c', 'd'), match(2, 'a', 'c')]);
  expect((await run()).status).toBe(201);
  expect(m.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    matches: [{ player_1_id: 'a', player_2_id: 'e' }], bye_player_ids: [],
  }));
});

it('refuses a new, managed or unsettled flat elimination bracket without a write', async () => {
  const elimination = { ...phase, bracket_type: 'single_elim' };
  m.phase.mockResolvedValueOnce(elimination);
  expect(await (await run()).json()).toMatchObject({ code: 'BRACKET_V2_REQUIRED' });
  m.phase.mockResolvedValue({ ...elimination, status: 'active', current_round: 1 });
  m.rounds.mockResolvedValueOnce([{ ...round(1), bracket_side: 'winners' }]);
  expect(await (await run()).json()).toMatchObject({ code: 'BRACKET_V2_MANAGED' });
  expect(m.matches).not.toHaveBeenCalled();
  m.rounds.mockResolvedValue([{ ...round(1), bracket_side: null }]);
  m.matches.mockResolvedValue([match(1, 'a', 'b', 'scheduled')]);
  const unsettled = await run();
  expect(unsettled.status).toBe(409);
  expect(await unsettled.json()).toMatchObject({ code: 'rounds_previous_matches_unfinished', params: { round: 'Round 1', count: 1 } });
  expect(m.write).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it('refuses a reset earlier flat match even when the latest round is settled', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'single_elim', status: 'active', current_round: 2 });
  m.rounds.mockResolvedValue([
    { ...round(1, [], 'pending'), bracket_side: null }, { ...round(2), bracket_side: null },
  ]);
  m.matches.mockResolvedValue([match(1, 'a', 'c', 'scheduled'), match(2, 'a', 'b')]);
  const response = await run();
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: 'rounds_previous_matches_unfinished', params: { round: 'Round 1', count: 1 },
  });
  expect(m.write).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it('plans the league mirror in group and enrollment order and sends it with the fixtures in one write', async () => {
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'round_robin' });
  m.participants.mockResolvedValue(players);
  m.leagueGroups.mockResolvedValue([
    { id: 'group-y', name: 'Group Y', sort_order: 1, player_ids: ['e', 'a', 'c'] },
    { id: 'group-x', name: 'Group X', sort_order: 2, player_ids: ['f', 'd', 'b'] },
  ]);
  expect((await run()).status).toBe(201);
  expect(m.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    round_number: 1, bye_player_ids: [],
    replacement_groups: [
      { season_group_id: 'group-y', name: 'Group Y', group_number: 1, members: ['a', 'c', 'e'].map((player_id, i) => ({ player_id, seed: i + 1 })) },
      { season_group_id: 'group-x', name: 'Group X', group_number: 2, members: ['b', 'd', 'f'].map((player_id, i) => ({ player_id, seed: i + 1 })) },
    ],
    matches: expect.arrayContaining([expect.objectContaining({ player_1_id: expect.any(String) })]),
  }));
});

it('writes the next grouped week across rounds two and three without rebuilding the ordered mirror', async () => {
  const groupLayout = [
    { id: 'phase-y', name: 'Group Y', group_number: 1, season_group_id: 'group-y', members: ['a', 'c', 'e'] },
    { id: 'phase-x', name: 'Group X', group_number: 2, season_group_id: 'group-x', members: ['b', 'd', 'f'] },
  ];
  m.groups.mockResolvedValue(groupLayout.map(group => ({
    ...group, members: group.members.map((player_id, index) => ({ player_id, seed: index + 1 })),
  })));
  m.leagueGroups.mockResolvedValue(groupLayout.map(group => ({
    id: group.season_group_id, name: group.name, sort_order: group.group_number, player_ids: group.members,
  })));
  m.participants.mockResolvedValue(players);
  m.standings.mockResolvedValue({ formatType: 'standard' });
  const rounds: ReturnType<typeof round>[] = [];
  const matches: ReturnType<typeof match>[] = [];
  for (let number = 1; number <= 3; number++) {
    m.phase.mockResolvedValue({ ...phase, status: 'active', bracket_type: 'round_robin', current_round: number - 1 });
    m.rounds.mockResolvedValue([...rounds]);
    m.matches.mockResolvedValue([...matches]);
    expect((await run()).status).toBe(201);
    const [write] = m.write.mock.calls.at(-1)!;
    expect(write.round_number).toBe(number);
    expect(write.bye_player_ids).toEqual([]);
    expect(write.replacement_groups).toBeUndefined();
    expect(write.inputs.rounds).toHaveLength(number - 1);
    expect(write.inputs.matches).toHaveLength(matches.length);
    rounds.push(round(number));
    for (const { player_1_id: a, player_2_id: b } of write.matches) matches.push(match(number, a, b));
  }
  expect(m.standings).toHaveBeenCalledWith(leagueId);
});

it('does not advance a round-robin circle that would repeat a prior native pairing', async () => {
  m.phase.mockResolvedValue({ ...phase, status: 'active', bracket_type: 'round_robin', current_round: 2 });
  m.participants.mockResolvedValue(players.slice(0, 4));
  m.rounds.mockResolvedValue([round(1), round(2)]);
  m.matches.mockResolvedValue([match(1, 'a', 'b', 'scheduled')]);
  expect(await (await run()).json()).toMatchObject({ code: 'round_robin_schedule_drift' });
  expect(m.write).not.toHaveBeenCalled();
});

it('refuses an incomplete group mirror or unfinished current Swiss round without a write', async () => {
  m.leagueGroups.mockResolvedValueOnce([{ id: 'group-y', name: 'Group Y', sort_order: 1, player_ids: ['a', 'b'] }]);
  expect(await (await run()).json()).toMatchObject({ code: 'PHASE_PLAYER_WITHOUT_LEAGUE_GROUP', params: { count: 3 } });
  m.phase.mockResolvedValueOnce({ ...phase, status: 'active', current_round: 1 });
  m.rounds.mockResolvedValueOnce([round(1, [], 'active')]);
  expect(await (await run()).json()).toMatchObject({ code: 'tournament_current_round_incomplete' });
  expect(m.write).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it('does not publish on a refused write, and returns the pending round when best-effort start fails', async () => {
  m.write.mockRejectedValueOnce(new UserFacingError('Stale format', { code: 'format_context_stale', status: 409 }));
  expect((await run()).status).toBe(409);
  expect(m.expire).not.toHaveBeenCalled();
  expect(m.discord).not.toHaveBeenCalled();
  m.start.mockRejectedValueOnce(new Error('round changed'));
  expect(await (await run({ start_round: true })).json()).toMatchObject({ data: { status: 'pending' } });
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, leagueId);
});

it('applies kit readiness, the revision and calendar, and native start effects', async () => {
  m.season.mockResolvedValue({ ...season, format_type: 'custom' });
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'round_robin', season_format_type: 'custom' });
  const stage = {
    key: 'table', pairing: { kind: 'round_robin', legs: 1, mirror_legs: false },
    calendar: { start: { kind: 'season_start' }, cadence: 'weekly', every: 1, time: '18:00', round_window_hours: 24 },
  };
  m.kitHead.mockResolvedValue({ engine: 'kit', revision: 7, clockShiftSeconds: 0 });
  m.loadPhase.mockResolvedValue({ engine: 'kit', revision: 7, stage, seed: 'test', tableExtras: {}, outcomes: {} });
  const context = {
    revision: 7, def: { rules: [] }, state: { checks: [], links: [], firedEventKeys: [] },
    phases: [{ id: phaseId, stage, members: [] }],
  };
  m.loadContext.mockResolvedValueOnce({ ...context, state: { ...context.state, checks: [{
    source: 'deadline_missed', status: 'open', subject: { applies: 'action' },
  }] } }).mockResolvedValue(context);
  expect(await (await run()).json()).toMatchObject({ code: 'format_not_ready' });
  expect(m.write).not.toHaveBeenCalled();
  expect((await run()).status).toBe(201);
  expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ expected_revision: 7, deadline: '2026-11-19T17:00:00.000Z' }));
  expect(m.event.mock.calls.map(([, event]) => event)).toEqual([
    { event: 'stage_start', stage: 'table' }, { event: 'round_start', stage: 'table', round: 1 },
  ]);
  const { port } = m.event.mock.calls[1][3];
  expect(await port.load(leagueId)).toBe(context);
  m.loadContext.mockResolvedValueOnce({ ...context, revision: 8 });
  expect(await port.load(leagueId)).toBeNull();
});

it('keeps kit legs, deadlines and the round cap, firing stage start only once per batch', async () => {
  m.season.mockResolvedValue({ ...season, format_type: 'custom' });
  m.phase.mockResolvedValue({ ...phase, bracket_type: 'round_robin', season_format_type: 'custom' });
  m.participants.mockResolvedValue(players.slice(0, 2));
  const stage = {
    key: 'table', pairing: { kind: 'round_robin', legs: 3, mirror_legs: true }, end_when: { kind: 'rounds', rounds: 2 },
    calendar: { start: { kind: 'season_start' }, cadence: 'weekly', every: 1, time: '18:00', round_window_hours: 24 },
  };
  m.kitHead.mockResolvedValue({ engine: 'kit', revision: 7, clockShiftSeconds: 0 });
  m.loadPhase.mockResolvedValue({ engine: 'kit', revision: 7, stage, seed: 'test', tableExtras: {}, outcomes: {} });
  m.loadContext.mockResolvedValue({
    revision: 7, def: { rules: [] }, state: { checks: [], links: [], firedEventKeys: [] },
    phases: [{ id: phaseId, stage, members: [] }],
  });
  expect((await runBatch()).status).toBe(201);
  expect(m.writeBatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expected_revision: 7 }), [
    expect.objectContaining({ round_number: 1, deadline: '2026-11-19T17:00:00.000Z', matches: [{ player_1_id: 'a', player_2_id: 'b' }] }),
    expect.objectContaining({ round_number: 2, deadline: '2026-11-26T17:00:00.000Z', matches: [{ player_1_id: 'b', player_2_id: 'a' }] }),
  ]);
  expect(m.event.mock.calls.map(([, event]) => event)).toEqual([
    { event: 'stage_start', stage: 'table' }, { event: 'round_start', stage: 'table', round: 1 },
    { event: 'round_start', stage: 'table', round: 2 },
  ]);
});
