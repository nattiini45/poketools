/**
 * A match that completed BEFORE a substitution and is reverted AFTER it: its logged `match_completed` ops name the player who
 * left, whose items now belong to the substitute (`format_substitute_seat` moved them and logged `seat_moved`). The revert must
 * take the units back from the seat's current holder (`revokesToCurrentHolders`), and fail visibly (a false hook result, the
 * caller's `format_revert_failed`) when the log cannot place a seat move.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYERS, SEED, giftDef, stateFor } from './helpers';

vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/fire', () => ({ fireEvent: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/checks-server', () => ({ openChecks: vi.fn(), resolveCheck: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/team-audit-server', () => ({ auditMatchTeams: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-table', () => ({ loadStageTable: vi.fn(), playerRowsOf: vi.fn(() => ({})) }));
vi.mock('@/lib/supabase/queries/match-outcomes', () => ({ getMatchOutcome: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundById: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormat: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ checkStageEnd: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/phase-complete', () => ({ completePhaseAtStageEnd: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/format-runtime')>()),
  fireFormatEvent: vi.fn(),
  getFormatRuntime: vi.fn(),
}));

import { loadFreshKitContext, type KitContext } from '../load';
import { fireFormatEvent, getFormatRuntime } from '@/lib/supabase/queries/format-runtime';
import { fireEvent } from '../fire';
import { openChecks } from '../checks-server';
import { getMatchOutcome } from '@/lib/supabase/queries/match-outcomes';
import { onMatchCompleted, onMatchReverted, onMatchUnresolved } from '../hooks';
import { newHookReport } from '../stale';

const def = giftDef();
const stage = def.stages[0];
const TOURNAMENT = { id: 't-1', season_id: 's-1', season_format_type: 'custom' as const };
const input = { tournament: TOURNAMENT, matchId: 'm-1' };

const context = (): KitContext => ({
  seasonId: 's-1',
  seed: SEED,
  revision: 9,
  def,
  state: stateFor(def, { firedEventKeys: ['match_completed:m-1'] }),
  tunableIssues: [],
  phases: [{ id: 't-1', stage, members: PLAYERS }],
});

const completed = (firedAt: string, ops: unknown[]) => ({
  event_key: 'match_completed:m-1',
  event: 'match_completed',
  fired_at: firedAt,
  payload: {},
  ops,
});
const grant = { op: 'grant_item', resource: 'picks', player_id: 'out', item_id: 'garchomp', amount: 1, exclusive: false, source: 'event', source_ref: null };
const points = { op: 'adjust_points', stage: 'main', player_id: 'out', points: 3, reason: 'win' };
const seatMoved = (from: string, to: string, firedAt: string) => ({
  event_key: `seat_moved:${from}:${to}`,
  event: 'seat_moved',
  fired_at: firedAt,
  payload: { from, to, rows: {} },
  ops: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadFreshKitContext).mockResolvedValue(context());
  vi.mocked(fireFormatEvent).mockResolvedValue(true);
});

describe('a revert after a substitution', () => {
  it("takes the units back from the substitute, who inherited the departed player's items", async () => {
    vi.mocked(getFormatRuntime).mockResolvedValue({
      eventLog: [
        completed('2026-11-08T10:00:00.250000+00:00', [grant, points]),
        seatMoved('out', 'in', '2026-11-08T11:00:00.000000+00:00'),
      ],
    } as never);

    await expect(onMatchReverted(input)).resolves.toBe(true);

    expect(fireFormatEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'match_reverted:m-1:1',
        revision: 9,
        ops: [
          // The units follow the seat; the points adjustment stays with the player it was written for (history).
          { op: 'revoke_item', resource: 'picks', player_id: 'in', item_id: 'garchomp', amount: 1, source: 'event', source_ref: null },
          { op: 'adjust_points', stage: 'main', player_id: 'out', points: -3, reason: 'reverted: win' },
        ],
      }),
    );
  });

  it('follows two substitutions of the same seat to the last holder', async () => {
    vi.mocked(getFormatRuntime).mockResolvedValue({
      eventLog: [
        completed('2026-11-08T10:00:00+00:00', [grant]),
        seatMoved('out', 'in', '2026-11-08T11:00:00+00:00'),
        seatMoved('in', 'third', '2026-11-08T12:00:00+00:00'),
      ],
    } as never);

    await onMatchReverted(input);

    expect(fireFormatEvent).toHaveBeenCalledWith(
      expect.objectContaining({ ops: [expect.objectContaining({ op: 'revoke_item', player_id: 'third' })] }),
    );
  });

  it('leaves a revert alone when the seat moved BEFORE the match completed (the grant went to the substitute already)', async () => {
    vi.mocked(getFormatRuntime).mockResolvedValue({
      eventLog: [
        seatMoved('out', 'in', '2026-11-08T09:00:00+00:00'),
        completed('2026-11-08T10:00:00+00:00', [{ ...grant, player_id: 'in' }]),
      ],
    } as never);

    await onMatchReverted(input);

    expect(fireFormatEvent).toHaveBeenCalledWith(
      expect.objectContaining({ ops: [expect.objectContaining({ op: 'revoke_item', player_id: 'in' })] }),
    );
  });

  it('is unchanged in a league whose seats never moved', async () => {
    vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [completed('2026-11-08T10:00:00+00:00', [grant])] } as never);

    await onMatchReverted(input);

    expect(fireFormatEvent).toHaveBeenCalledWith(
      expect.objectContaining({ ops: [expect.objectContaining({ op: 'revoke_item', player_id: 'out' })] }),
    );
  });

  it('fails visibly, writing nothing, when a seat move of the log cannot be read', async () => {
    vi.mocked(getFormatRuntime).mockResolvedValue({
      eventLog: [completed('2026-11-08T10:00:00+00:00', [grant]), { ...seatMoved('out', 'in', 'not a time'), payload: { from: 'out', to: 'in' } }],
    } as never);
    const report = newHookReport();

    await expect(onMatchReverted({ ...input, report })).resolves.toBe(false);

    expect(report.failed).toBe(true);
    expect(fireFormatEvent).not.toHaveBeenCalled();
  });
});

describe('a match completed after a substitution that left the player who left on its row', () => {
  // The substitution skipped this match (it has games), so its row still names `out`; the seat belongs to `in`.
  const completedInput = { tournament: TOURNAMENT, matchId: 'm-2', roundId: 'r-1', player1Id: 'out', player2Id: 'p2', winnerId: 'out' };
  const seatedContext = (): KitContext => ({
    ...context(),
    state: stateFor(def, { firedEventKeys: ['seat_moved:out:in'] }),
  });

  beforeEach(() => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(seatedContext());
    vi.mocked(fireEvent).mockResolvedValue({ issues: [] } as never);
    vi.mocked(getMatchOutcome).mockResolvedValue(null as never);
    vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [seatMoved('out', 'in', '2026-11-08T11:00:00+00:00')] } as never);
  });

  it('plans the effects for the holder of the seat: the event players and the track steps, with the winner read from the row', async () => {
    await onMatchCompleted(completedInput);

    expect(fireEvent).toHaveBeenCalledTimes(1);
    const [, event, , options] = vi.mocked(fireEvent).mock.calls[0];
    expect(event).toMatchObject({ event: 'match_completed', match_id: 'm-2', players: ['in', 'p2'] });
    expect(options?.ops).toEqual([{ op: 'set_track', track: 'milestones', player_id: 'in', step: 1 }]);
  });

  it('follows a chain of substitutions to the last holder', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...context(), state: stateFor(def, { firedEventKeys: ['seat_moved:out:in', 'seat_moved:in:third'] }) });
    vi.mocked(getFormatRuntime).mockResolvedValue({
      eventLog: [seatMoved('out', 'in', '2026-11-08T11:00:00+00:00'), seatMoved('in', 'third', '2026-11-08T12:00:00+00:00')],
    } as never);

    await onMatchCompleted(completedInput);

    expect(vi.mocked(fireEvent).mock.calls[0][1]).toMatchObject({ players: ['third', 'p2'] });
  });

  it('puts the holder, not the player who left, on the unresolved-outcome check', async () => {
    const withCheck = {
      ...def,
      rules: [...def.rules, { kind: 'check.assisted' as const, id: 'tie', source: { kind: 'unresolved_outcome' as const } }],
    };
    vi.mocked(loadFreshKitContext).mockResolvedValue({ ...seatedContext(), def: withCheck });

    await onMatchUnresolved({ tournament: TOURNAMENT, matchId: 'm-2', player1Id: 'out', player2Id: 'p2' });

    expect(openChecks).toHaveBeenCalledWith('s-1', [expect.objectContaining({ subject: { match_id: 'm-2', players: ['in', 'p2'] } })], 9);
  });

  it('reads no event log and changes nothing in a league whose seats never moved', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(context());

    await onMatchCompleted({ ...completedInput, player1Id: 'p1', winnerId: 'p1' });

    expect(getFormatRuntime).not.toHaveBeenCalled();
    expect(vi.mocked(fireEvent).mock.calls[0][1]).toMatchObject({ players: ['p1', 'p2'] });
  });

  it('fails visibly when a seat move of the log cannot be read: nothing is fired for the wrong player', async () => {
    vi.mocked(getFormatRuntime).mockResolvedValue({ eventLog: [{ ...seatMoved('out', 'in', 'not a time'), payload: { from: 'out' } }] } as never);
    const report = newHookReport();

    await expect(onMatchCompleted({ ...completedInput, report })).resolves.toBe(false);

    expect(report.failed).toBe(true);
    expect(fireEvent).not.toHaveBeenCalled();
  });
});
