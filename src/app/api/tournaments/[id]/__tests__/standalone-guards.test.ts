/**
 * PATCH /api/tournaments/[id]: the locks of a started standalone tournament
 * (bracket type, ruleset, doubles), the rename guard of a league phase and the
 * widened tournament.update audit diff. The generic PATCH behaviour is in
 * route.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  updateTournament: vi.fn(),
  deleteTournament: vi.fn(),
  getParticipants: vi.fn(),
  getStagesBySeasonId: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterTournamentDelete: vi.fn(),
}));

vi.mock('@/lib/tournament/bracket-propagation', () => ({
  syncBracketResetSetting: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: (
    changes: Record<string, { before: unknown; after: unknown }>,
    field: string,
    before: unknown,
    after: unknown
  ) => {
    if (before !== after) changes[field] = { before, after };
  },
}));

import { PATCH } from '@/app/api/tournaments/[id]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import {
  getTournamentById,
  updateTournament,
  getStagesBySeasonId,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { logAuditEvent } from '@/lib/audit/log';

const ID = '22222222-2222-4222-8222-222222222222';
const RULESET = '00000000-0000-4000-8000-000000000001';
const OTHER_RULESET = '00000000-0000-4000-8000-000000000002';

const standalone = {
  id: ID,
  name: 'Open Cup',
  description: 'A private blurb that must not reach the log',
  season_id: null,
  status: 'upcoming' as const,
  bracket_type: 'swiss' as const,
  ruleset_id: RULESET,
  best_of_default: 3,
  bo_overrides: { '2': 5, '1': 1 } as Record<string, number>,
  is_doubles: false,
  team_visibility: 'hidden_until_match' as const,
  bracket_reset_enabled: true,
  stage_order: 0,
  archived: false,
};

const patch = (body: unknown) =>
  PATCH({ json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest, {
    params: Promise.resolve({ id: ID }),
  });

const round = { id: 'r1' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({
    playerId: 'p-1',
    name: 'Tournament Admin',
    isAdmin: false,
    isResourceAdmin: true,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  });
  vi.mocked(getTournamentById).mockResolvedValue(standalone as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getStagesBySeasonId).mockResolvedValue([]);
  vi.mocked(updateTournament).mockImplementation(
    async (_id, input) => ({ ...standalone, ...input }) as never
  );
});

describe('PATCH /api/tournaments/[id]: standalone locks', () => {
  const changes = [
    ['bracket_type', { bracket_type: 'single_elim' }, 'tournament_bracket_locked'],
    ['ruleset_id', { ruleset_id: OTHER_RULESET }, 'tournament_ruleset_locked'],
    ['is_doubles', { is_doubles: true }, 'tournament_doubles_locked'],
  ] as const;

  it.each(changes)('refuses a changed %s on an active tournament with 400, nothing written', async (_f, body, code) => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...standalone, status: 'active' } as never);

    const response = await patch(body);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ success: false, code });
    expect(updateTournament).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each(changes)('lets a changed %s through while upcoming with no rounds', async (_f, body) => {
    const response = await patch(body);

    expect(response.status).toBe(200);
    expect(getRoundsByTournament).toHaveBeenCalledWith(ID);
    expect(updateTournament).toHaveBeenCalledWith(ID, body);
  });

  it.each(changes)('refuses a changed %s on an upcoming tournament that already has a round', async (_f, body, code) => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([round] as never);

    const response = await patch(body);

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(code);
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('refuses a locked change on a completed tournament too', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...standalone, status: 'completed' } as never);

    const response = await patch({ is_doubles: true });

    expect((await response.json()).code).toBe('tournament_doubles_locked');
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('lets name, best-of, overrides, visibility and the reset toggle change on an active tournament', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...standalone, status: 'active' } as never);

    const body = {
      name: 'Open Cup 2',
      best_of_default: 5,
      bo_overrides: { '3': 7 },
      team_visibility: 'always_public',
      bracket_reset_enabled: false,
    };
    const response = await patch(body);

    expect(response.status).toBe(200);
    expect(updateTournament).toHaveBeenCalledWith(ID, body);
  });

  it('does not lock a completed standalone tournament\'s name (no phase lock)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...standalone, status: 'completed' } as never);

    const response = await patch({ name: 'Open Cup, final results' });

    expect(response.status).toBe(200);
    expect(updateTournament).toHaveBeenCalledTimes(1);
  });

  it('reads no rounds when no locked field changes, even if the stored values are resent', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ ...standalone, status: 'active' } as never);

    const response = await patch({
      name: 'Renamed',
      bracket_type: 'swiss',
      ruleset_id: RULESET,
      is_doubles: false,
    });

    expect(response.status).toBe(200);
    expect(getRoundsByTournament).not.toHaveBeenCalled();
  });

  it('refuses an even best-of with 400 validation_failed', async () => {
    const response = await patch({ best_of_default: 2 });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('refuses an even override value with 400 validation_failed', async () => {
    const response = await patch({ bo_overrides: { '2': 4 } });

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(updateTournament).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tournaments/[id]: tournament.update audit', () => {
  it('records the settings diffs and never the description', async () => {
    const response = await patch({
      name: 'Open Cup 2',
      description: 'Another private blurb',
      bracket_type: 'single_elim',
      ruleset_id: OTHER_RULESET,
      best_of_default: 5,
      is_doubles: true,
      team_visibility: 'always_public',
      bo_overrides: { '3': 7 },
    });

    expect(response.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry).toMatchObject({ action: 'tournament.update', resource_id: ID, resource_name: 'Open Cup 2' });
    expect(entry.changes).toEqual({
      name: { before: 'Open Cup', after: 'Open Cup 2' },
      bracket_type: { before: 'swiss', after: 'single_elim' },
      ruleset_id: { before: RULESET, after: OTHER_RULESET },
      best_of_default: { before: 3, after: 5 },
      is_doubles: { before: false, after: true },
      team_visibility: { before: 'hidden_until_match', after: 'always_public' },
      bo_overrides: { before: { '2': 5, '1': 1 }, after: { '3': 7 } },
    });
    expect(JSON.stringify(entry)).not.toContain('private blurb');
  });

  it('records a cleared override map', async () => {
    await patch({ bo_overrides: {} });

    expect(vi.mocked(logAuditEvent).mock.calls[0][0].changes).toEqual({
      bo_overrides: { before: { '2': 5, '1': 1 }, after: {} },
    });
  });

  it('does not record overrides that only differ in key order', async () => {
    await patch({ name: 'Open Cup 2', bo_overrides: { '1': 1, '2': 5 } });

    expect(vi.mocked(logAuditEvent).mock.calls[0][0].changes).toEqual({
      name: { before: 'Open Cup', after: 'Open Cup 2' },
    });
  });

  it('writes no audit row when nothing audited changed', async () => {
    await patch({ description: 'Only the description' });

    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tournaments/[id]: league phase rename', () => {
  const phase = { ...standalone, season_id: 's-1', name: 'Hinrunde' };

  beforeEach(() => {
    vi.mocked(getTournamentById).mockResolvedValue(phase as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { id: ID, name: 'Hinrunde' },
      { id: 'other', name: 'Playoffs' },
    ] as never);
  });

  it('refuses a name another phase of the league has with 409 PHASE_NAME_TAKEN', async () => {
    const response = await patch({ name: ' playoffs ' });
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.code).toBe('PHASE_NAME_TAKEN');
    expect(getStagesBySeasonId).toHaveBeenCalledWith('s-1');
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('lets a free name and the unchanged name through', async () => {
    expect((await patch({ name: 'Rückrunde' })).status).toBe(200);

    vi.mocked(getStagesBySeasonId).mockClear();
    expect((await patch({ name: 'Hinrunde' })).status).toBe(200);
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
  });

  it('does not apply the standalone lock to a league phase (its own guards decide)', async () => {
    const response = await patch({ is_doubles: true });

    expect(response.status).toBe(200);
    expect(getRoundsByTournament).not.toHaveBeenCalled();
  });
});
