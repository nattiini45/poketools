/**
 * The read-back of every Build binding (`verify`) and the reversals they declare: confirmed, absent, ambiguous and unknown,
 * by id and by natural key. The query modules are mocked; nothing here reaches a database. The phase repair that goes through
 * a real route is in `ops-build.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ listSeasons: vi.fn(), listSeasonsByIds: vi.fn(), getSeasonParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonId: vi.fn(), getTournamentById: vi.fn(), listAllTournaments: vi.fn() }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));

import { harnessError, mapRouteResponse, type Outcome, type VerifyCall, type VerifyContext } from '@/lib/ai/admin-agent/dispatch';
import { uid } from '@/lib/ai/admin-agent/plans/__tests__/fixtures';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getSeasonParticipants, listSeasons, listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId, getTournamentById, listAllTournaments } from '@/lib/supabase/queries/tournaments';
import { CLOCK_SKEW_MS } from '../_ops/g/shared';
import { leagueArchive } from '../_ops/g/league-archive';
import { leagueCreate } from '../_ops/g/league-create';
import { phaseCreate } from '../_ops/g/phase-create';
import { rosterAdd } from '../_ops/g/roster-add';
import { rosterRemove } from '../_ops/g/roster-remove';
import { tournamentArchive } from '../_ops/g/tournament-archive';
import { tournamentCreate } from '../_ops/g/tournament-create';

const LEAGUE = uid(7001);
const RULESET = uid(9001);
const PHASE = uid(7101);
const TOURNAMENT = uid(7201);
const ADMIN = uid(1);
const PLAYERS = [uid(100), uid(101), uid(102)];
const APPROVED_AT = '2026-10-27T12:00:00.000Z';

const ctx = (overrides: Partial<VerifyContext> = {}): VerifyContext => ({ adminId: ADMIN, isSiteAdmin: true, approvedAt: APPROVED_AT, ...overrides });
const call = (op: string, body: unknown, params: Record<string, string> = {}): VerifyCall => ({ step: { key: 'k', op, entity_type: 'x', targets: [] }, params, query: {}, body });
const created = (data: unknown): Outcome => mapRouteResponse({ status: 201, body: { success: true, data } }, { write: true });
/** A write whose answer never came back: a masked 500 on a POST. */
const unknownWrite = (): Outcome => mapRouteResponse({ status: 500, body: { success: false, error: 'Failed to create league' } }, { write: true });
const timedOut = (): Outcome => harnessError('step_timeout', { write: true, ran: true });

const leagueBody = { name: 'Gen 9 OU League', format_type: 'singles', language: 'de', ruleset_id: RULESET };
const league = (overrides: Record<string, unknown> = {}) =>
  ({ id: LEAGUE, name: 'Gen 9 OU League', format_type: 'singles', ruleset_id: RULESET, archived: false, created_at: '2026-10-27T12:00:03.000Z', participant_count: 0, ...overrides }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('league_create', () => {
  const verify = (outcome: Outcome, over: Partial<VerifyContext> = {}, body: unknown = leagueBody) => leagueCreate.verify!(call('league_create', body), outcome, ctx(over));

  it('confirms by the id the route answered with, with the ruleset it pinned', async () => {
    vi.mocked(listSeasonsByIds).mockResolvedValue([league()]);
    expect(await verify(created({ id: LEAGUE }))).toEqual({ status: 'confirmed', detail: { id: LEAGUE, ruleset_id: RULESET } });
    expect(listSeasonsByIds).toHaveBeenCalledWith([LEAGUE]);
    expect(listSeasons).not.toHaveBeenCalled();
  });

  it('answers absent when the league it was told about cannot be read', async () => {
    vi.mocked(listSeasonsByIds).mockResolvedValue([]);
    expect(await verify(created({ id: LEAGUE }))).toEqual({ status: 'absent' });
  });

  it('finds the league by natural key after a masked 500 or a timeout', async () => {
    vi.mocked(listSeasons).mockResolvedValue([league(), league({ id: uid(1), name: 'Other league' })]);
    for (const outcome of [unknownWrite(), timedOut()]) {
      expect(await verify(outcome)).toEqual({ status: 'confirmed', detail: { id: LEAGUE, ruleset_id: RULESET } });
    }
    expect(listSeasons).toHaveBeenCalledWith({ includeTestSeasons: true });
  });

  it('reads a name the way the route does (trimmed, case-insensitive) and accepts a clock a little behind', async () => {
    const skewed = new Date(Date.parse(APPROVED_AT) - CLOCK_SKEW_MS + 1000).toISOString();
    vi.mocked(listSeasons).mockResolvedValue([league({ name: '  gen 9 ou LEAGUE ', created_at: skewed })]);
    expect((await verify(unknownWrite())).status).toBe('confirmed');
  });

  it('does not take a league created before the approval, an archived one, another format or another ruleset for its own', async () => {
    const early = new Date(Date.parse(APPROVED_AT) - CLOCK_SKEW_MS - 1000).toISOString();
    vi.mocked(listSeasons).mockResolvedValue([
      league({ created_at: early }),
      league({ id: uid(2), archived: true }),
      league({ id: uid(3), format_type: 'doubles' }),
      league({ id: uid(4), ruleset_id: uid(9999) }),
    ]);
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
  });

  it('is ambiguous when more than one league matches: nothing is adopted', async () => {
    vi.mocked(listSeasons).mockResolvedValue([league(), league({ id: uid(5) })]);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { ambiguous: true, matches: 2 } });
  });

  it('matches a league without an explicit ruleset on none, except a Point Buy league (it pins the shared battle ruleset)', async () => {
    const { ruleset_id: _unused, ...plain } = leagueBody;
    vi.mocked(listSeasons).mockResolvedValue([league({ ruleset_id: null })]);
    expect((await verify(unknownWrite(), {}, plain)).status).toBe('confirmed');
    vi.mocked(listSeasons).mockResolvedValue([league({ ruleset_id: uid(9777) })]);
    expect((await verify(unknownWrite(), {}, plain)).status).toBe('absent');
    vi.mocked(listSeasons).mockResolvedValue([league({ format_type: 'evolution_point_buy', ruleset_id: uid(9777) })]);
    expect((await verify(unknownWrite(), {}, { ...plain, format_type: 'evolution_point_buy' })).status).toBe('confirmed');
  });

  it('cannot look for it without the approval time, or with a body that does not parse', async () => {
    expect(await verify(unknownWrite(), { approvedAt: undefined })).toEqual({ status: 'unknown' });
    expect(await verify(unknownWrite(), {}, { ...leagueBody, extra: 1 })).toEqual({ status: 'unknown' });
    expect(listSeasons).not.toHaveBeenCalled();
  });

  it('declares the archive as its compensating call, built from the id the ledger kept', () => {
    expect(leagueCreate.reversal).toMatchObject({ kind: 'compensating', operation: 'league_archive' });
    const reversal = leagueCreate.reversal as Extract<NonNullable<typeof leagueCreate.reversal>, { kind: 'compensating' }>;
    expect(reversal.buildInput(call('league_create', leagueBody), { id: LEAGUE, ruleset_id: RULESET })).toEqual({ params: { id: LEAGUE }, body: { archived: true } });
    expect(() => reversal.buildInput(call('league_create', leagueBody), null)).toThrow(/no league id/);
  });
});

describe('roster_add', () => {
  const body = { player_ids: PLAYERS };
  const verify = () => rosterAdd.verify!(call('roster_add', body, { id: LEAGUE }), created({ added: 3 }), ctx());
  const roster = (...ids: string[]) => vi.mocked(getSeasonParticipants).mockResolvedValue(ids.map((id) => ({ id })) as never);

  it('confirms when every player of the body is on the roster', async () => {
    roster(...PLAYERS, uid(200));
    expect(await verify()).toEqual({ status: 'confirmed', detail: { present: 3, expected: 3 } });
    expect(getSeasonParticipants).toHaveBeenCalledWith(LEAGUE);
  });

  it('answers absent when none is, and unknown (never retried) when only some are', async () => {
    roster();
    expect(await verify()).toEqual({ status: 'absent', detail: { present: 0, expected: 3 } });
    roster(PLAYERS[0], uid(300));
    expect(await verify()).toEqual({ status: 'unknown', detail: { present: 1, expected: 3 } });
  });

  it('compares ids in lower case', async () => {
    roster(...PLAYERS.map((id) => id.toUpperCase()));
    expect((await verify()).status).toBe('confirmed');
  });

  it('declares the removal as its compensating call: one call per player of the body', () => {
    const reversal = rosterAdd.reversal as Extract<NonNullable<typeof rosterAdd.reversal>, { kind: 'compensating' }>;
    expect(reversal.operation).toBe('roster_remove');
    expect(reversal.buildInput(call('roster_add', body, { id: LEAGUE }), null)).toEqual(PLAYERS.map((player_id) => ({ params: { id: LEAGUE }, body: { player_id } })));
  });
});

describe('phase_create', () => {
  const body = { name: 'Regular season', bracket_type: 'round_robin', best_of_default: 1, is_doubles: false, team_visibility: 'hidden_until_match', ruleset_id: RULESET };
  const phase = (overrides: Record<string, unknown> = {}) =>
    ({ id: PHASE, name: 'Regular season', season_id: LEAGUE, enrollment_source: { type: 'roster', frozen: false }, participant_count: 12, ...overrides }) as never;
  const verify = (outcome: Outcome = created({ id: PHASE }), over: Partial<VerifyContext> = {}) => phaseCreate.verify!(call('phase_create', body, { id: LEAGUE }), outcome, ctx(over));

  it('confirms an enrolled phase by the id the route answered with, with its participant count and source', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([phase(), phase({ id: uid(7102), name: 'Playoffs' })]);
    expect(await verify()).toEqual({ status: 'confirmed', detail: { id: PHASE, participants: 12, enrollment: 'roster', resynced: false } });
  });

  it('finds it by (season, name), case-insensitively, when the route said nothing', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([phase({ name: 'REGULAR SEASON ' })]);
    expect((await verify(unknownWrite())).status).toBe('confirmed');
  });

  it('answers absent when there is no such phase, and ambiguous when two carry the name', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([]);
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
    vi.mocked(getStagesBySeasonId).mockResolvedValue([phase(), phase({ id: uid(7103) })]);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { ambiguous: true, matches: 2 } });
  });

  it('does not repair without the dispatch context: a phase with no enrollment source stays unknown', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([phase({ enrollment_source: null, participant_count: 0 })]);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { id: PHASE, enrollment: 'missing' } });
  });

  it('treats an empty phase of a league that has players as not enrolled, and an empty phase of an empty league as fine', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([phase({ participant_count: 0 })]);
    vi.mocked(listSeasonsByIds).mockResolvedValue([league({ participant_count: 12 })]);
    expect((await verify(unknownWrite())).status).toBe('unknown');
    vi.mocked(listSeasonsByIds).mockResolvedValue([league({ participant_count: 0 })]);
    expect(await verify(unknownWrite())).toMatchObject({ status: 'confirmed', detail: { participants: 0 } });
  });

  it('declares no reversal: a phase stays behind as residue of an archived league', () => {
    expect(phaseCreate.reversal).toEqual({ kind: 'none' });
  });
});

describe('tournament_create', () => {
  const body = { name: 'Summer Cup', bracket_type: 'single_elim', ruleset_id: RULESET, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' };
  const tournament = (overrides: Record<string, unknown> = {}) =>
    ({ id: TOURNAMENT, name: 'Summer Cup', season_id: null, archived: false, bracket_type: 'single_elim', ruleset_id: RULESET, created_at: '2026-10-27T12:00:03.000Z', ...overrides }) as never;
  const verify = (outcome: Outcome = created({ id: TOURNAMENT }), over: Partial<VerifyContext> = {}) => tournamentCreate.verify!(call('tournament_create', body), outcome, ctx(over));

  it('confirms by id for a site admin without asking for a grant', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament());
    expect(await verify()).toEqual({ status: 'confirmed', detail: { id: TOURNAMENT } });
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('confirms for a league admin who holds the creator grant', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament());
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
    expect(await verify(undefined, { isSiteAdmin: false })).toEqual({ status: 'confirmed', detail: { id: TOURNAMENT } });
    expect(isResourceAdminFor).toHaveBeenCalledWith(ADMIN, 'tournament', TOURNAMENT);
  });

  it('fails with created_but_unadministrable when the best-effort grant did not happen, and keeps the id', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament());
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
    expect(await verify(undefined, { isSiteAdmin: false })).toEqual({ status: 'failed', code: 'created_but_unadministrable', detail: { id: TOURNAMENT } });
  });

  it('answers absent when the tournament it was told about is not there', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null);
    expect(await verify()).toEqual({ status: 'absent' });
  });

  it('finds a standalone tournament by natural key, and never adopts a phase, an archived one or one from before the approval', async () => {
    const early = new Date(Date.parse(APPROVED_AT) - CLOCK_SKEW_MS - 1000).toISOString();
    vi.mocked(listAllTournaments).mockResolvedValue([
      tournament({ id: uid(1), season_id: LEAGUE }),
      tournament({ id: uid(2), archived: true }),
      tournament({ id: uid(3), created_at: early }),
      tournament({ id: uid(4), bracket_type: 'round_robin' }),
      tournament(),
    ]);
    expect(await verify(unknownWrite())).toEqual({ status: 'confirmed', detail: { id: TOURNAMENT } });
  });

  it('is ambiguous when two standalone tournaments match, and cannot look without the approval time', async () => {
    vi.mocked(listAllTournaments).mockResolvedValue([tournament(), tournament({ id: uid(9) })]);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { ambiguous: true, matches: 2 } });
    expect(await verify(unknownWrite(), { approvedAt: undefined })).toEqual({ status: 'unknown' });
  });

  it('declares the archive as its compensating call', () => {
    const reversal = tournamentCreate.reversal as Extract<NonNullable<typeof tournamentCreate.reversal>, { kind: 'compensating' }>;
    expect(reversal.operation).toBe('tournament_archive');
    expect(reversal.buildInput(call('tournament_create', body), { id: TOURNAMENT })).toEqual({ params: { id: TOURNAMENT }, body: { archived: true } });
  });
});

describe('the reversal bindings', () => {
  it('league_archive confirms an archived league and not a live one', async () => {
    const verify = () => leagueArchive.verify!(call('league_archive', { archived: true }, { id: LEAGUE }), created({}), ctx());
    vi.mocked(listSeasonsByIds).mockResolvedValue([league({ archived: true })]);
    expect(await verify()).toEqual({ status: 'confirmed', detail: { id: LEAGUE } });
    vi.mocked(listSeasonsByIds).mockResolvedValue([league()]);
    expect(await verify()).toEqual({ status: 'absent' });
    vi.mocked(listSeasonsByIds).mockResolvedValue([]);
    expect(await verify()).toEqual({ status: 'absent' });
  });

  it('tournament_archive confirms an archived tournament and not a live one', async () => {
    const verify = () => tournamentArchive.verify!(call('tournament_archive', { archived: true }, { id: TOURNAMENT }), created({}), ctx());
    vi.mocked(getTournamentById).mockResolvedValue({ id: TOURNAMENT, archived: true } as never);
    expect(await verify()).toEqual({ status: 'confirmed', detail: { id: TOURNAMENT } });
    vi.mocked(getTournamentById).mockResolvedValue({ id: TOURNAMENT, archived: false } as never);
    expect(await verify()).toEqual({ status: 'absent' });
  });

  it('roster_remove confirms a player who is no longer on the roster', async () => {
    const verify = () => rosterRemove.verify!(call('roster_remove', { player_id: PLAYERS[0] }, { id: LEAGUE }), created(null), ctx());
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: PLAYERS[1] }] as never);
    expect(await verify()).toEqual({ status: 'confirmed', detail: { removed: 1 } });
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: PLAYERS[0] }] as never);
    expect(await verify()).toEqual({ status: 'absent' });
  });
});
