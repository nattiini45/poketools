/**
 * DELETE /api/seasons/[id]/phases/[phaseId]: the confirmation body (empty,
 * malformed, confirmed) and the derived-data rebuild after the committed
 * delete, which is reported in the response (`rebuild_warning`) instead of
 * only in the server log and the audit record (L-MATCH round 3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  expireTournamentReads: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  updateTournament: vi.fn(),
  deleteTournament: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/tournament/league-phase', () => ({
  buildLeaguePhase: vi.fn(),
  assertPhaseEditable: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterTournamentDelete: vi.fn(),
}));

import { DELETE } from '../route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { logAuditEvent } from '@/lib/audit/log';
import { deleteTournament, getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { rebuildAfterTournamentDelete } from '@/lib/reconcile/entity-delete-rebuild';
import { UserFacingError } from '@/lib/api/user-facing-error';

const SEASON_ID = '0d8a1a96-a0af-49df-8b1d-c58c2f5cec01';
const PHASE_ID = 'd403b67d-0d81-45d9-87eb-9f931fc1c829';
const args = () => ({ params: Promise.resolve({ id: SEASON_ID, phaseId: PHASE_ID }) });

function request(body?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/seasons/${SEASON_ID}/phases/${PHASE_ID}`, {
    method: 'DELETE',
    ...(body !== undefined ? { body } : {}),
  });
}

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
  vi.mocked(getTournamentById).mockResolvedValue({ id: PHASE_ID, season_id: SEASON_ID, name: 'Groups' } as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
  vi.mocked(deleteTournament).mockResolvedValue(undefined as never);
  vi.mocked(rebuildAfterTournamentDelete).mockResolvedValue({ scope: 'tournament' } as never);
});

describe('DELETE /api/seasons/[id]/phases/[phaseId]', () => {
  it('deletes a phase without rounds and reports no rebuild warning', async () => {
    const response = await DELETE(request(), args());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true, data: { rebuild_warning: null } });
    expect(rebuildAfterTournamentDelete).toHaveBeenCalledWith({
      tournamentId: PHASE_ID,
      seasonId: SEASON_ID,
      playerIds: ['p1', 'p2'],
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'phase.delete', metadata: expect.objectContaining({ rebuild_error: null }) })
    );
  });

  it('asks for confirmation when the phase has rounds and the body is empty', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r1' }] as never);

    const response = await DELETE(request(), args());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('PHASE_DELETE_CONFIRM_REQUIRED');
    expect(deleteTournament).not.toHaveBeenCalled();
  });

  it('answers a malformed body with 400 invalid_json, not 500', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r1' }] as never);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await DELETE(request('{"confirm": tru'), args());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe('invalid_json');
    expect(deleteTournament).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('deletes a phase with rounds when confirmed', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r1' }] as never);

    const response = await DELETE(request(JSON.stringify({ confirm: true })), args());

    expect(response.status).toBe(200);
    expect(deleteTournament).toHaveBeenCalledWith(PHASE_ID);
  });

  it('reports a failed rebuild as rebuild_warning with the generic code (the delete committed)', async () => {
    vi.mocked(rebuildAfterTournamentDelete).mockRejectedValue(new Error('aggregate rebuild timed out'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await DELETE(request(), args());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.rebuild_warning).toEqual({
      code: 'derived_data_rebuild_failed',
      error: expect.stringContaining('rebuilding the derived data'),
    });
    expect(JSON.stringify(json)).not.toContain('timed out');
    expect(logged).toHaveBeenCalledWith('phase delete derived-data rebuild failed:', expect.any(Error));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ rebuild_error: 'derived_data_rebuild_failed' }) })
    );
    logged.mockRestore();
  });

  it('keeps a refused rating rebuild distinct (rating_history_incomplete with its params)', async () => {
    vi.mocked(rebuildAfterTournamentDelete).mockRejectedValue(
      new UserFacingError('Rating history has gaps that no rebuild order can fill', {
        code: 'rating_history_incomplete',
        params: { count: 2, players: 'Alice, Bob' },
        status: 409,
      })
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await DELETE(request(), args());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.rebuild_warning).toEqual({
      code: 'rating_history_incomplete',
      error: 'Rating history has gaps that no rebuild order can fill',
      params: { count: 2, players: 'Alice, Bob' },
    });
    logged.mockRestore();
  });
});
