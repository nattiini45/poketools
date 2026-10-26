/**
 * PATCH /api/seasons/[id]/phases/[phaseId]: the rename guard (names are unique
 * per league), the completed-phase lock and the reopen path (status 'active'
 * writes the status column and nothing else).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  expireTournamentReads: vi.fn(),
}));

vi.mock('@/lib/ruleset-studio/pin-change', () => ({
  assertRulesetChangeAllowed: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  updateTournament: vi.fn(),
  deleteTournament: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterTournamentDelete: vi.fn(),
}));

import { PATCH } from '../route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import * as tournamentQueries from '@/lib/supabase/queries/tournaments';
import * as roundQueries from '@/lib/supabase/queries/rounds';
import { rebuildAfterTournamentDelete } from '@/lib/reconcile/entity-delete-rebuild';
import { assertRulesetChangeAllowed } from '@/lib/ruleset-studio/pin-change';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';

const {
  getTournamentById,
  getTournamentWithDetails,
  getStagesBySeasonId,
  updateTournament,
  deleteTournament,
} = vi.mocked(tournamentQueries);
const { getRoundsByTournament } = vi.mocked(roundQueries);

const SEASON_ID = '0d8a1a96-a0af-49df-8b1d-c58c2f5cec01';
const PHASE_ID = 'd403b67d-0d81-45d9-87eb-9f931fc1c829';
const OTHER_PHASE_ID = '7f1ab8a8-8f41-4a3c-9ba2-0e0b0f0e6a11';
const args = () => ({ params: Promise.resolve({ id: SEASON_ID, phaseId: PHASE_ID }) });

function request(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/seasons/${SEASON_ID}/phases/${PHASE_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

const phaseRow = (status: 'upcoming' | 'active' | 'completed') =>
  ({ id: PHASE_ID, season_id: SEASON_ID, name: 'Hinrunde', status, bracket_type: 'swiss' }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({
    playerId: 'admin-1',
    name: 'Admin',
    isAdmin: true,
    isResourceAdmin: true,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  });
  getTournamentById.mockResolvedValue(phaseRow('upcoming'));
  getStagesBySeasonId.mockResolvedValue([
    { id: PHASE_ID, name: 'Hinrunde', stage_order: 1 },
    { id: OTHER_PHASE_ID, name: 'Playoffs', stage_order: 2 },
  ] as never);
  updateTournament.mockResolvedValue({ id: PHASE_ID, name: 'Hinrunde', status: 'upcoming', bracket_type: 'swiss' } as never);
  getTournamentWithDetails.mockResolvedValue({ id: PHASE_ID, season_id: SEASON_ID } as never);
  getRoundsByTournament.mockResolvedValue([]);
});

describe('PATCH /api/seasons/[id]/phases/[phaseId]: rename', () => {
  it('refuses another phase\'s name with 409 PHASE_NAME_TAKEN, nothing written', async () => {
    const response = await PATCH(request({ name: 'playoffs' }), args());
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toMatchObject({ success: false, code: 'PHASE_NAME_TAKEN' });
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('lets a rename to a free name through', async () => {
    const response = await PATCH(request({ name: 'Rückrunde' }), args());

    expect(response.status).toBe(200);
    expect(getStagesBySeasonId).toHaveBeenCalledWith(SEASON_ID);
    expect(updateTournament).toHaveBeenCalledWith(PHASE_ID, { name: 'Rückrunde' });
  });

  it('lets the unchanged name through without reading the league\'s phases (legacy duplicates stay editable)', async () => {
    const response = await PATCH(request({ name: 'Hinrunde', best_of_default: 3 }), args());

    expect(response.status).toBe(200);
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
    expect(updateTournament).toHaveBeenCalledWith(PHASE_ID, { name: 'Hinrunde', best_of_default: 3 });
  });

  it('lets a case-only change of its own name through', async () => {
    const response = await PATCH(request({ name: 'HINRUNDE' }), args());

    expect(response.status).toBe(200);
    expect(updateTournament).toHaveBeenCalledTimes(1);
  });

  it('refuses an even best-of with validation_failed', async () => {
    const response = await PATCH(request({ best_of_default: 2 }), args());

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(updateTournament).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id]/phases/[phaseId]: legacy even best-of', () => {
  beforeEach(() => {
    getTournamentById.mockResolvedValue({
      ...(phaseRow('upcoming') as object),
      best_of_default: 2,
      bo_overrides: { '1': 4 },
    } as never);
  });

  it('saves the stored even values sent back unchanged with a rename', async () => {
    const body = { name: 'Rückrunde', best_of_default: 2, bo_overrides: { '1': 4 } };
    const response = await PATCH(request(body), args());

    expect(response.status).toBe(200);
    expect(updateTournament).toHaveBeenCalledWith(PHASE_ID, body);
  });

  it('refuses a different even default with validation_failed', async () => {
    const response = await PATCH(request({ best_of_default: 4 }), args());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ code: 'validation_failed', error: 'best_of_default: best of must be an odd number' });
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('refuses a new even override but lets the stored one stay', async () => {
    const response = await PATCH(request({ bo_overrides: { '1': 4, '2': 6 } }), args());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('bo_overrides.2: best of must be an odd number');
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('lets an odd replacement through', async () => {
    const response = await PATCH(request({ best_of_default: 3, bo_overrides: { '1': 5 } }), args());

    expect(response.status).toBe(200);
  });
});

describe('PATCH /api/seasons/[id]/phases/[phaseId]: completed phase', () => {
  beforeEach(() => {
    getTournamentById.mockResolvedValue(phaseRow('completed'));
  });

  it('reopens with { status: active }: one status-only write, no result or round function touched', async () => {
    updateTournament.mockResolvedValue({ id: PHASE_ID, name: 'Hinrunde', status: 'active', bracket_type: 'swiss' } as never);

    const response = await PATCH(request({ status: 'active' }), args());

    expect(response.status).toBe(200);
    expect(updateTournament).toHaveBeenCalledTimes(1);
    expect(updateTournament).toHaveBeenCalledWith(PHASE_ID, { status: 'active' });
    // The module mocks expose only reads for rounds; the writers a reopen must never call are absent.
    expect(Object.keys(roundQueries)).toEqual(['getRoundsByTournament']);
    expect(getRoundsByTournament).toHaveBeenCalledTimes(1);
    expect(deleteTournament).not.toHaveBeenCalled();
    expect(rebuildAfterTournamentDelete).not.toHaveBeenCalled();
    expect(Object.keys(tournamentQueries).sort()).toEqual(
      [
        'deleteTournament',
        'getParticipants',
        'getStagesBySeasonId',
        'getTournamentById',
        'getTournamentWithDetails',
        'updateTournament',
      ].sort()
    );
  });

  it('refuses a rename on a completed phase with PHASE_COMPLETED_LOCKED', async () => {
    const response = await PATCH(request({ name: 'Rückrunde' }), args());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('PHASE_COMPLETED_LOCKED');
    expect(updateTournament).not.toHaveBeenCalled();
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id]/phases/[phaseId]: ruleset pin', () => {
  const RULESET_A = '00000000-0000-4000-8000-0000000000a1';
  const RULESET_B = '00000000-0000-4000-8000-0000000000b2';

  it('asks the pin guard with the stored pin, the requested one and whether the phase has started', async () => {
    getTournamentById.mockResolvedValue({ ...(phaseRow('active') as object), ruleset_id: RULESET_A } as never);
    vi.mocked(assertRulesetChangeAllowed).mockResolvedValue(undefined);

    const response = await PATCH(request({ ruleset_id: RULESET_B }), args());

    expect(response.status).toBe(200);
    expect(assertRulesetChangeAllowed).toHaveBeenCalledWith({
      player: expect.objectContaining({ playerId: 'admin-1' }),
      current: RULESET_A,
      requested: RULESET_B,
      started: true,
    });
  });

  it('a refused change (a ruleset the caller may not use, or a started phase) writes nothing', async () => {
    getTournamentById.mockResolvedValue({ ...(phaseRow('active') as object), ruleset_id: RULESET_A } as never);
    vi.mocked(assertRulesetChangeAllowed).mockRejectedValue(new RulesetStudioError('ruleset_pin_started'));

    const response = await PATCH(request({ ruleset_id: RULESET_B }), args());

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ruleset_pin_started');
    expect(updateTournament).not.toHaveBeenCalled();
  });
});
