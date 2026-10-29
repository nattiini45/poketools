/**
 * The read-back of every Go-live binding (`verify`): confirmed, absent, ambiguous and unknown, by the id the route answered
 * with and by what the write leaves behind. The query modules are mocked; nothing here reaches a database, and no read-back
 * ever calls a route. The bindings against the real routes and the real executor are in `ops-golive.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({ listRulesetVersions: vi.fn(), getPinTargetStates: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));

import { harnessError, mapRouteResponse, type Outcome, type VerifyCall, type VerifyContext } from '@/lib/ai/admin-agent/dispatch';
import { uid } from '@/lib/ai/admin-agent/plans/__tests__/fixtures';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getPinTargetStates, listRulesetVersions } from '@/lib/supabase/queries/ruleset-definitions';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { CLOCK_SKEW_MS } from '../_ops/g/shared';
import { generateBracket } from '../_ops/g/generate-bracket';
import { movePin } from '../_ops/g/move-pin';
import { publishRuleset } from '../_ops/g/publish-ruleset';
import { startPhase } from '../_ops/g/start-phase';

const RULESET = uid(9001);
const VERSION_2 = uid(9102);
const VERSION_3 = uid(9103);
const SEASON = uid(7001);
const PHASE = uid(7101);
const TOURNAMENT = uid(7201);
const ROUND = uid(7301);
const ADMIN = uid(1);
const APPROVED_AT = '2026-10-27T12:00:00.000Z';
const AFTER = '2026-10-27T12:00:03.000Z';
const EARLY = new Date(Date.parse(APPROVED_AT) - CLOCK_SKEW_MS - 1000).toISOString();

const ctx = (overrides: Partial<VerifyContext> = {}): VerifyContext => ({ adminId: ADMIN, isSiteAdmin: true, approvedAt: APPROVED_AT, ...overrides });
const call = (op: string, body: unknown, params: Record<string, string>): VerifyCall => ({ step: { key: op, op, entity_type: 'x', targets: [] }, params, query: {}, body });
const created = (data: unknown): Outcome => mapRouteResponse({ status: 201, body: { success: true, data } }, { write: true });
const answered = (data: unknown): Outcome => mapRouteResponse({ status: 200, body: { success: true, data } }, { write: true });
/** A write whose answer never came back: a masked 500 on a POST, and a step timeout. */
const unknownWrite = (): Outcome => mapRouteResponse({ status: 500, body: { success: false, error: 'Failed' } }, { write: true });
const timedOut = (): Outcome => harnessError('step_timeout', { write: true, ran: true });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('publish_ruleset', () => {
  const version = (no: number, id: string, overrides: Record<string, unknown> = {}) => ({ id, version_no: no, created_at: AFTER, created_by: ADMIN, ...overrides });
  const verify = (outcome: Outcome, over: Partial<VerifyContext> = {}) => publishRuleset.verify!(call('publish_ruleset', { draft_rev: 3 }, { id: RULESET }), outcome, ctx(over));
  const published = (id = VERSION_3) => created({ version: { id, version_no: 3 }, definition: { id: RULESET } });
  const listed = (...versions: unknown[]) => vi.mocked(listRulesetVersions).mockResolvedValue(versions as never);

  it('confirms by the version id the route answered with, whatever its age, and reads the definition\'s own versions only', async () => {
    listed(version(3, VERSION_3, { created_at: EARLY }), version(2, VERSION_2, { created_at: EARLY }));
    expect(await verify(published())).toEqual({ status: 'confirmed', detail: { id: VERSION_3, version_no: 3 } });
    expect(listRulesetVersions).toHaveBeenCalledWith(RULESET, 100);
  });

  it('is absent when the version it was told about is not in the list', async () => {
    listed(version(2, VERSION_2, { created_at: EARLY }));
    expect(await verify(published())).toEqual({ status: 'absent' });
  });

  it('finds the new head by what a publish leaves behind after a masked 500 or a timeout', async () => {
    listed(version(3, VERSION_3), version(2, VERSION_2, { created_at: EARLY }));
    for (const outcome of [unknownWrite(), timedOut(), created(null)]) {
      expect(await verify(outcome)).toEqual({ status: 'confirmed', detail: { id: VERSION_3, version_no: 3 } });
    }
  });

  it('accepts a clock a little behind the approval, and a version without a recorded author', async () => {
    const skewed = new Date(Date.parse(APPROVED_AT) - CLOCK_SKEW_MS + 1000).toISOString();
    listed(version(3, VERSION_3, { created_at: skewed, created_by: null }));
    expect((await verify(unknownWrite())).status).toBe('confirmed');
  });

  it('is absent when nothing was published since the approval, or the only new version is somebody else\'s', async () => {
    listed(version(2, VERSION_2, { created_at: EARLY }));
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
    listed(version(3, VERSION_3, { created_by: uid(2) }), version(2, VERSION_2, { created_at: EARLY }));
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
    listed();
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
  });

  it('is ambiguous when two versions are new, and unknown when the new one is not the head', async () => {
    listed(version(3, VERSION_3), version(2, VERSION_2));
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { ambiguous: true, matches: 2 } });
    listed(version(4, uid(9104), { created_at: EARLY }), version(3, VERSION_3));
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { id: VERSION_3, version_no: 3, head_version_no: 4 } });
  });

  it('cannot look for it without the approval time', async () => {
    listed(version(3, VERSION_3));
    expect(await verify(unknownWrite(), { approvedAt: undefined })).toEqual({ status: 'unknown' });
  });

  it('declares no reversal, class G, and the effects of the tool', () => {
    expect(publishRuleset.reversal).toEqual({ kind: 'none' });
    expect(publishRuleset.class).toBe('G');
  });
});

describe('move_pin', () => {
  const targets = [
    { kind: 'season', id: SEASON },
    { kind: 'tournament', id: PHASE },
  ];
  const body = { to_version_no: 3, targets, confirm_started: [SEASON] };
  const verify = (outcome: Outcome = answered({ version_id: VERSION_3, version_no: 3, moved: [] })) => movePin.verify!(call('move_pin', body, { id: RULESET }), outcome, ctx());
  const versions = () => vi.mocked(listRulesetVersions).mockResolvedValue([{ id: VERSION_3, version_no: 3 }, { id: VERSION_2, version_no: 2 }] as never);
  const pins = (season: string | null, phase: string | null) =>
    vi.mocked(getPinTargetStates).mockResolvedValue([
      { kind: 'season', id: SEASON, name: 'League', status: 'active', season_id: null, ruleset_id: season },
      { kind: 'tournament', id: PHASE, name: 'Phase', status: 'active', season_id: SEASON, ruleset_id: phase },
    ]);

  it('confirms when every target pins the version, with the version id for the ledger', async () => {
    versions();
    pins(VERSION_3, VERSION_3);
    expect(await verify()).toEqual({ status: 'confirmed', detail: { id: VERSION_3, version_no: 3, moved: 2, expected: 2 } });
    expect(getPinTargetStates).toHaveBeenCalledWith([SEASON], [PHASE]);
    expect(listRulesetVersions).toHaveBeenCalledWith(RULESET, 100);
  });

  it('is absent when none moved, and unknown with the counts when only some did', async () => {
    versions();
    pins(VERSION_2, VERSION_2);
    expect(await verify(unknownWrite())).toEqual({ status: 'absent', detail: { moved: 0, expected: 2 } });
    pins(VERSION_3, VERSION_2);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { moved: 1, expected: 2 } });
    pins(VERSION_2, VERSION_3);
    expect(await verify(timedOut())).toEqual({ status: 'unknown', detail: { moved: 1, expected: 2 } });
  });

  it('counts a target the read cannot find as not moved, and compares ids in lower case', async () => {
    versions();
    vi.mocked(getPinTargetStates).mockResolvedValue([{ kind: 'season', id: SEASON.toUpperCase(), name: 'League', status: 'active', season_id: null, ruleset_id: VERSION_3.toUpperCase() }] as never);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { moved: 1, expected: 2 } });
  });

  it('is unknown, not absent, when the version cannot be found or the body does not parse', async () => {
    vi.mocked(listRulesetVersions).mockResolvedValue([{ id: VERSION_2, version_no: 2 }] as never);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown' });
    expect(getPinTargetStates).not.toHaveBeenCalled();
    versions();
    expect(await movePin.verify!(call('move_pin', { ...body, extra: 1 }, { id: RULESET }), unknownWrite(), ctx())).toEqual({ status: 'unknown' });
  });

  it('reads one kind only when the call names one kind', async () => {
    versions();
    vi.mocked(getPinTargetStates).mockResolvedValue([{ kind: 'season', id: SEASON, name: 'League', status: 'active', season_id: null, ruleset_id: VERSION_3 }] as never);
    const only = { to_version_no: 3, targets: [{ kind: 'season', id: SEASON }] };
    expect(await movePin.verify!(call('move_pin', only, { id: RULESET }), unknownWrite(), ctx())).toMatchObject({ status: 'confirmed', detail: { moved: 1, expected: 1 } });
    expect(getPinTargetStates).toHaveBeenCalledWith([SEASON], []);
  });

  it('declares no reversal: undoing a move is a later move_pin proposal', () => {
    expect(movePin.reversal).toEqual({ kind: 'none' });
  });
});

describe('start_phase', () => {
  const round = (overrides: Record<string, unknown> = {}) => ({ id: ROUND, tournament_id: TOURNAMENT, round_number: 1, status: 'pending', created_at: AFTER, ...overrides });
  const verify = (outcome: Outcome, body: unknown = {}, over: Partial<VerifyContext> = {}) => startPhase.verify!(call('start_phase', body, { tid: TOURNAMENT }), outcome, ctx(over));
  const tournament = (currentRound: number) => vi.mocked(getTournamentById).mockResolvedValue({ id: TOURNAMENT, current_round: currentRound, status: currentRound > 0 ? 'active' : 'upcoming' } as never);

  it('confirms by the round id the route answered with, with the start state of the round', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([round({ status: 'active' })] as never);
    tournament(1);
    expect(await verify(created(round({ status: 'active' })), { start_round: true })).toEqual({ status: 'confirmed', detail: { id: ROUND, round_number: 1, started: true } });
    expect(getRoundsByTournament).toHaveBeenCalledWith(TOURNAMENT);
  });

  it('still confirms a round that is pending: the data is written, `started` says it was not opened', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([round()] as never);
    tournament(1);
    expect(await verify(created(round()), { start_round: true })).toEqual({ status: 'confirmed', detail: { id: ROUND, round_number: 1, started: false } });
    expect(await verify(created(round()))).toEqual({ status: 'confirmed', detail: { id: ROUND, round_number: 1, started: false } });
  });

  it('finds round 1 by what the write leaves behind after a masked 500 or a timeout', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([round({ id: uid(7302), round_number: 2, created_at: AFTER }), round()] as never);
    tournament(1);
    for (const outcome of [unknownWrite(), timedOut()]) {
      expect(await verify(outcome)).toEqual({ status: 'confirmed', detail: { id: ROUND, round_number: 1, started: false } });
    }
  });

  it('is absent when there is no round 1, or round 1 is older than the approval; it cannot look without the approval time', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
    vi.mocked(getRoundsByTournament).mockResolvedValue([round({ created_at: EARLY })] as never);
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
    vi.mocked(getRoundsByTournament).mockResolvedValue([round()] as never);
    expect(await verify(unknownWrite(), {}, { approvedAt: undefined })).toEqual({ status: 'unknown' });
    // The route named a round the read cannot find.
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    expect(await verify(created(round()))).toEqual({ status: 'absent' });
  });

  it('is ambiguous when two rounds carry the number', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([round(), round({ id: uid(7303) })] as never);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { ambiguous: true, matches: 2 } });
  });

  it('does not adopt a half-done start: a round while the tournament has not moved is unknown and incomplete', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([round()] as never);
    tournament(0);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { id: ROUND, round_number: 1, incomplete: true } });
    vi.mocked(getTournamentById).mockResolvedValue(null);
    expect((await verify(unknownWrite())).status).toBe('unknown');
  });

  it('declares no reversal and the effects of the tool, including the two posts', () => {
    expect(startPhase.reversal).toEqual({ kind: 'none' });
    expect(startPhase.outwardEffects).toContainEqual({ group: 'round_generated', events: ['round_generated'] });
    expect(startPhase.outwardEffects).toContainEqual({ group: 'tournament_started', events: ['tournament_started'] });
  });
});

describe('generate_bracket', () => {
  const rounds = (count: number, createdAt = AFTER) => Array.from({ length: count }, (_, index) => ({ id: uid(7400 + index), tournament_id: TOURNAMENT, round_number: index + 1, status: 'pending', created_at: createdAt }));
  const verify = (outcome: Outcome = created({ rounds_created: 3, matches_materialized: 2 }), over: Partial<VerifyContext> = {}) =>
    generateBracket.verify!(call('generate_bracket', {}, { id: TOURNAMENT }), outcome, ctx(over));
  const tournament = (currentRound: number) => vi.mocked(getTournamentById).mockResolvedValue({ id: TOURNAMENT, current_round: currentRound } as never);

  it('confirms when the rounds exist since the approval and the tournament moved, with the tournament id for the ledger', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue(rounds(3) as never);
    tournament(1);
    expect(await verify()).toEqual({ status: 'confirmed', detail: { id: TOURNAMENT, rounds: 3 } });
    for (const outcome of [unknownWrite(), timedOut()]) expect(await verify(outcome)).toEqual({ status: 'confirmed', detail: { id: TOURNAMENT, rounds: 3 } });
  });

  it('is absent when there are no rounds, or all of them are older than the approval', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
    vi.mocked(getRoundsByTournament).mockResolvedValue(rounds(3, EARLY) as never);
    expect(await verify(unknownWrite())).toEqual({ status: 'absent' });
  });

  it('is unknown when the rounds are of mixed ages, when a bracket is half written, and without the approval time', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([...rounds(2), ...rounds(1, EARLY).map((round) => ({ ...round, id: uid(7499) }))] as never);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { rounds: 3, created: 2 } });
    vi.mocked(getRoundsByTournament).mockResolvedValue(rounds(3) as never);
    tournament(0);
    expect(await verify(unknownWrite())).toEqual({ status: 'unknown', detail: { id: TOURNAMENT, rounds: 3, incomplete: true } });
    expect(await verify(unknownWrite(), { approvedAt: undefined })).toEqual({ status: 'unknown' });
  });

  it('declares no reversal and names the round post and the frozen enrollment', () => {
    expect(generateBracket.reversal).toEqual({ kind: 'none' });
    expect(generateBracket.outwardEffects?.map((effect) => effect.group)).toEqual(['round_generated', 'enrollment_frozen']);
  });
});
