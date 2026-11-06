/**
 * POST /api/tournaments/[id]/rounds/manual on a phase of a kit league: the round is written like a generated one. A
 * stage that reached its end takes no round, the stage calendar gives the round its deadline, and the format reacts
 * (`stage_start` for the first round of the phase, `round_start`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn(), AuthError: class AuthError extends Error {} }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  updateTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn(), createRound: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ createMatchBatch: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ seasonHasGroups: vi.fn() }));
vi.mock('@/lib/tournament/group-rounds', () => ({ ensurePhaseGroupsFromLeague: vi.fn() }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));
vi.mock('@/lib/format-engine/load', () => ({ loadKitPhase: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onRoundGenerated: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/load')>()),
  loadFreshKitContext: vi.fn(),
}));
vi.mock('@/lib/format-engine/runtime/calendar-server', () => ({ fillRoundDeadline: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/stage-end-server', () => ({ assertStageNotEnded: vi.fn() }));
vi.mock('@/lib/format-engine/pairing-server', () => ({ openForbiddenPairingCheck: vi.fn() }));

import { POST } from '@/app/api/tournaments/[id]/rounds/manual/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getParticipants, getTournamentById, updateTournament } from '@/lib/supabase/queries/tournaments';
import { createRound, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { createMatchBatch } from '@/lib/supabase/queries/matches';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { assertSeasonFormatAttached } from '@/lib/format-studio/attach';
import { loadKitPhase, type KitPhase } from '@/lib/format-engine/load';
import { onRoundGenerated } from '@/lib/format-engine/runtime/hooks';
import { loadFreshKitContext } from '@/lib/format-engine/runtime/load';
import { logAuditEvent } from '@/lib/audit/log';
import { fillRoundDeadline } from '@/lib/format-engine/runtime/calendar-server';
import { assertStageNotEnded } from '@/lib/format-engine/runtime/stage-end-server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Pairing, Stage } from '@/lib/format-kit/types';

const ID = 'a5cb20ac-a127-482d-855d-d802e29185bc';
const P1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const P2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';
const routeParams = { params: Promise.resolve({ id: ID }) };
const forced = () =>
  ({ url: 'https://example.test/api/tournaments/x/rounds/manual?force=true', json: () => Promise.resolve({ pairings: [{ player_1_id: P1, player_2_id: P2 }] }) }) as unknown as NextRequest;

/** A league whose action runs via the `santa` relation, drawn or not, with the checks the admin left open. */
function santaContext(opts: { drawn?: boolean; openChecks?: number } = {}) {
  const links = opts.drawn === true ? ['p1', 'p2', 'p3', 'p4'].map((from, i, all) => ({ relation: 'santa', from, to: all[(i + 1) % all.length], revealed: false })) : [];
  const checks = Array.from({ length: opts.openChecks ?? 0 }, (_, i) => ({
    id: `c-${i}`,
    source: 'deadline_missed',
    rule_id: 'deadline:cup:0',
    dedupe_key: `deadline:cup:0:choose_gifts:p${i}`,
    subject: { applies: 'action', action: 'choose_gifts', player_id: `p${i}` },
    status: 'open',
    note: null,
  }));
  return {
    def: { rules: [{ kind: 'player.action', id: 'choose_gifts', via: 'santa' }] },
    state: { links, checks },
    phases: [{ id: 'ph-1', stage: { key: 'cup' }, members: ['p1', 'p2', 'p3', 'p4'] }],
  } as never;
}
const body = () => ({ json: () => Promise.resolve({ pairings: [{ player_1_id: P1, player_2_id: P2 }] }) }) as unknown as NextRequest;

function phase(engine: KitPhase['engine'] = 'kit'): KitPhase {
  const pairing: Pairing = { kind: 'manual' };
  const stage: Stage = {
    key: 'ladder',
    name: { en: { v: 'Ladder', s: 'human' }, base: 'en' },
    participants: { from: 'roster', seeding: 'signup' },
    pairing,
    series: { best_of: 1, allow_draw: false, overrides: [] },
    ruleset: { kind: 'season_default' },
    doubles: false,
    players_per_match: 2,
    scoring: { win: 3, loss: 0, bye: 0 },
    rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
    columns: [],
  };
  return { engine, seed: 'seed-0123456789', stage, outcomes: {}, tableExtras: {} };
}

const tournament = (over: Record<string, unknown> = {}) =>
  ({
    id: ID,
    bracket_type: 'swiss',
    status: 'upcoming',
    current_round: 0,
    season_id: 's-1',
    season_format_type: 'custom',
    best_of_default: 1,
    bo_overrides: {},
    ...over,
  }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  vi.mocked(loadFreshKitContext).mockResolvedValue(null);
  vi.mocked(getTournamentById).mockResolvedValue(tournament());
  vi.mocked(getParticipants).mockResolvedValue([{ id: P1 }, { id: P2 }] as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(seasonHasGroups).mockResolvedValue(false);
  vi.mocked(updateTournament).mockResolvedValue(undefined as never);
  vi.mocked(createMatchBatch).mockResolvedValue([] as never);
  vi.mocked(loadKitPhase).mockResolvedValue(phase());
  vi.mocked(createRound).mockImplementation(async (input) => ({ id: 'r-1', deadline: null, ...input }) as never);
  vi.mocked(fillRoundDeadline).mockImplementation(async ({ round }) => ({ ...round, deadline: '2026-12-01T00:00:00Z' }) as never);
});

describe('manual round on a kit phase', () => {
  it('starts the phase with the first round, fills its deadline and returns the filled round', async () => {
    const res = await POST(body(), routeParams);

    expect(res.status).toBe(201);
    expect((await res.json()).data.deadline).toBe('2026-12-01T00:00:00Z');
    expect(fillRoundDeadline).toHaveBeenCalledWith(expect.objectContaining({ seasonId: 's-1', round: expect.objectContaining({ round_number: 1 }) }));
    expect(onRoundGenerated).toHaveBeenCalledWith({
      tournament: expect.objectContaining({ id: ID }),
      roundNumber: 1,
      rematches: 0,
      startsPhase: true,
    });
  });

  it('fires round_start only for a phase that already started', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament({ status: 'active', current_round: 2 }));
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 2, status: 'completed' }] as never);

    await POST(body(), routeParams);

    expect(onRoundGenerated).toHaveBeenCalledWith(expect.objectContaining({ roundNumber: 3, startsPhase: false }));
  });

  it('refuses a stage that reached its end before any round is written', async () => {
    vi.mocked(assertStageNotEnded).mockRejectedValue(
      new UserFacingError('This phase has reached its end condition.', { code: 'rounds_stage_ended', status: 409 }),
    );

    const res = await POST(body(), routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('rounds_stage_ended');
    expect(createRound).not.toHaveBeenCalled();
    expect(onRoundGenerated).not.toHaveBeenCalled();
  });

  it('refuses a custom league without an attached format', async () => {
    vi.mocked(assertSeasonFormatAttached).mockRejectedValue(
      new UserFacingError('Attach a format first.', { code: 'format_nothing_attached', status: 404 }),
    );

    const res = await POST(body(), routeParams);

    expect(res.status).toBe(404);
    expect(createRound).not.toHaveBeenCalled();
  });

  it('writes a plain round for a phase that is not on the kit engine', async () => {
    vi.mocked(loadKitPhase).mockResolvedValue(phase('shadow'));

    const res = await POST(body(), routeParams);

    expect(res.status).toBe(201);
    expect(onRoundGenerated).not.toHaveBeenCalled();
    expect(fillRoundDeadline).not.toHaveBeenCalled();
    expect(assertStageNotEnded).not.toHaveBeenCalled();
  });

  it('writes a plain round for a tournament outside a custom league', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament({ season_id: null, season_format_type: null }));

    const res = await POST(body(), routeParams);

    expect(res.status).toBe(201);
    expect(loadKitPhase).not.toHaveBeenCalled();
    expect(onRoundGenerated).not.toHaveBeenCalled();
  });
});

describe('manual round: the first round of a kit phase waits for the format set-up', () => {
  it('refuses with 409 format_not_ready while the relation is undrawn, before any round is written', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext({ openChecks: 3 }));

    const res = await POST(body(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('format_not_ready');
    expect(json.params).toMatchObject({ reasons: 'relation_undrawn,action_incomplete', open_checks: 3 });
    expect(createRound).not.toHaveBeenCalled();
    expect(onRoundGenerated).not.toHaveBeenCalled();
  });

  it('writes the round once the relation is drawn', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext({ drawn: true }));

    expect((await POST(body(), routeParams)).status).toBe(201);
  });

  it('lets an admin start anyway with ?force=true and audits it', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext());

    expect((await POST(forced(), routeParams)).status).toBe(201);

    expect(vi.mocked(logAuditEvent).mock.calls.find((call) => call[0].action === 'season.format.round.force_start')?.[0]).toMatchObject({
      actor_id: 'admin-1',
      resource_id: ID,
      metadata: { reasons: ['relation_undrawn'], relations: ['santa'] },
    });
  });

  it('does not look at a phase that already has a round', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(tournament({ status: 'active', current_round: 2 }));
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 2, status: 'completed' }] as never);
    vi.mocked(loadFreshKitContext).mockResolvedValue(santaContext());

    expect((await POST(body(), routeParams)).status).toBe(201);
    expect(loadFreshKitContext).not.toHaveBeenCalled();
  });
});
