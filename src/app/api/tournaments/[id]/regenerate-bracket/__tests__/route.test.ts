import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => ({
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
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/tournament/bracket-generate', () => ({
  regenerateEliminationBracket: vi.fn(),
}));

vi.mock('@/lib/format-engine/route-guards', () => ({
  loadKitPhaseOfTournament: vi.fn(),
  assertPhaseReadyForFirstRound: vi.fn(),
  announceKitRound: vi.fn(),
  wantsForcedStart: vi.fn(),
  isKitEnginePhase: (phase: { engine?: string } | null) => phase?.engine === 'kit',
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireTournamentReads: vi.fn(), revalidateMatchPages: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { POST } from '@/app/api/tournaments/[id]/regenerate-bracket/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { regenerateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { FormatStudioError } from '@/lib/format-studio/errors';
import { announceKitRound, assertPhaseReadyForFirstRound, loadKitPhaseOfTournament, wantsForcedStart } from '@/lib/format-engine/route-guards';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { expireTournamentReads, revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';

const tournamentId = '00000000-0000-4000-8000-000000000001';
const params = { params: Promise.resolve({ id: tournamentId }) };

function request(body: unknown = {}): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('POST /api/tournaments/[id]/regenerate-bracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(loadKitPhaseOfTournament).mockResolvedValue(null);
    vi.mocked(assertPhaseReadyForFirstRound).mockResolvedValue(null);
    vi.mocked(wantsForcedStart).mockReturnValue(false);
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);
  });

  it('requires tournament resource admin first', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const response = await POST(request(), params);
    expect(requireResourceAdmin).toHaveBeenCalledWith('tournament', tournamentId);
    expect(response.status).toBe(403);
    expect(getTournamentById).not.toHaveBeenCalled();
  });

  it('answers a missing tournament with tournament_not_found', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Tournament not found');
    expect(payload.code).toBe('tournament_not_found');
  });

  it('answers a non-elimination format with bracket_regenerate_elim_only', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: tournamentId, bracket_type: 'round_robin' } as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Bracket regeneration only applies to elimination formats');
    expect(payload.code).toBe('bracket_regenerate_elim_only');
    expect(regenerateEliminationBracket).not.toHaveBeenCalled();
  });

  it('answers an invalid body with validation_failed and the issues as its param', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: tournamentId, bracket_type: 'single_elim' } as never);

    const response = await POST(request({ cascade: 'yes' }), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
    expect(regenerateEliminationBracket).not.toHaveBeenCalled();
  });

  it('passes the REGENERATE_PLAYED engine error through with its code and params', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: tournamentId,
      bracket_type: 'double_elim',
      season_id: null,
    } as never);
    vi.mocked(getParticipants).mockResolvedValue([] as never);
    vi.mocked(regenerateEliminationBracket).mockRejectedValue(
      new UserFacingError('3 played matches will be reset and all results rolled back.', {
        code: 'REGENERATE_PLAYED',
        params: { count: 3 },
        status: 409,
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('REGENERATE_PLAYED');
    expect(payload.params).toEqual({ count: 3 });
  });
  describe('the destructive write leaves a trace and expires what it rolled back', () => {
    const elim = { id: tournamentId, name: 'Finals', bracket_type: 'single_elim', status: 'active', season_id: 's-1', current_round: 2 };

    beforeEach(() => {
      vi.mocked(getTournamentById).mockResolvedValue(elim as never);
      vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
    });

    it('audits a cascade that wiped played results, expires the match pages and the tournament reads', async () => {
      vi.mocked(regenerateEliminationBracket).mockResolvedValue({ rounds_created: 2, matches_materialized: 1 });

      const response = await POST(request({ cascade: true }), params);

      expect(response.status).toBe(200);
      expect(revalidateMatchPages).toHaveBeenCalledWith(tournamentId);
      expect(expireTournamentReads).toHaveBeenCalledWith(tournamentId, 's-1');
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith({
        actor_id: 'admin-1',
        actor_name: 'Admin',
        action: 'bracket.generate',
        resource_type: 'tournament',
        resource_id: tournamentId,
        resource_name: 'Finals',
        metadata: { regenerated: true, cascade: true, completed: true, rounds_created: 2, matches_materialized: 1 },
      });
    });

    it('still expires and audits a cascade that failed part-way (matches were already reset), marked as not completed', async () => {
      vi.mocked(regenerateEliminationBracket).mockRejectedValue(new Error('delete failed'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await POST(request({ cascade: true }), params);

      expect(response.status).toBe(500);
      expect(revalidateMatchPages).toHaveBeenCalledWith(tournamentId);
      expect(expireTournamentReads).toHaveBeenCalledWith(tournamentId, 's-1');
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'bracket.generate', metadata: { regenerated: true, cascade: true, completed: false } }));
    });

    it('does not let a failing page expiry hide the result', async () => {
      vi.mocked(regenerateEliminationBracket).mockResolvedValue({ rounds_created: 2, matches_materialized: 1 });
      vi.mocked(revalidateMatchPages).mockRejectedValue(new Error('tournament read failed'));

      const response = await POST(request({ cascade: true }), params);

      expect(response.status).toBe(200);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
    });

    it('audits a plain regenerate once it succeeded, and nothing for one the engine refused', async () => {
      vi.mocked(regenerateEliminationBracket).mockResolvedValue({ rounds_created: 2, matches_materialized: 1 });
      await POST(request({}), params);
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ regenerated: true, cascade: false, completed: true }) }));
      expect(revalidateMatchPages).not.toHaveBeenCalled();

      vi.mocked(logAuditEvent).mockClear();
      vi.mocked(regenerateEliminationBracket).mockRejectedValue(new UserFacingError('played', { code: 'REGENERATE_PLAYED', status: 409 }));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const refused = await POST(request({}), params);
      expect(refused.status).toBe(409);
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('a bracket stage of a kit league', () => {
    const kitTournament = {
      id: tournamentId,
      name: 'Finals',
      bracket_type: 'single_elim',
      status: 'upcoming',
      season_id: 's-1',
      season_format_type: 'custom',
      current_round: 0,
    } as never;
    const kitPhase = { engine: 'kit', stage: { key: 'finals' }, revision: 4 } as never;

    beforeEach(() => {
      vi.mocked(getTournamentById).mockResolvedValue(kitTournament);
      vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
      vi.mocked(loadKitPhaseOfTournament).mockResolvedValue(kitPhase);
      vi.mocked(regenerateEliminationBracket).mockResolvedValue({ rounds_created: 2, matches_materialized: 1 });
      vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r1', round_number: 1 }] as never);
    });

    it('refuses a custom league without an attached format before anything is written (a hand-made bracket phase cannot start it)', async () => {
      vi.mocked(loadKitPhaseOfTournament).mockRejectedValue(new FormatStudioError('format_not_attached'));

      const response = await POST(request({}), params);

      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('format_not_attached');
      expect(regenerateEliminationBracket).not.toHaveBeenCalled();
      expect(announceKitRound).not.toHaveBeenCalled();
    });

    it('applies the first-round gate before it writes, and writes nothing when the league is not ready', async () => {
      vi.mocked(assertPhaseReadyForFirstRound).mockRejectedValue(new UserFacingError('not ready', { code: 'format_not_ready', status: 409 }));

      const response = await POST(request({}), params);

      expect(response.status).toBe(409);
      expect(regenerateEliminationBracket).not.toHaveBeenCalled();
    });

    it('announces the first round after the write, with the forced start to audit', async () => {
      const forced = { tournamentId } as never;
      vi.mocked(assertPhaseReadyForFirstRound).mockResolvedValue(forced);
      vi.mocked(wantsForcedStart).mockReturnValue(true);

      const response = await POST(request({}), params);

      expect(response.status).toBe(200);
      expect(assertPhaseReadyForFirstRound).toHaveBeenCalledWith(kitTournament, kitPhase, { force: true, actor: { id: 'admin-1', name: 'Admin' } });
      expect(announceKitRound).toHaveBeenCalledWith(kitTournament, kitPhase, { roundNumber: 1 }, true, forced);
    });

    it('announces nothing for a league that is not on the kit engine', async () => {
      vi.mocked(loadKitPhaseOfTournament).mockResolvedValue(null);

      await POST(request({}), params);

      expect(announceKitRound).not.toHaveBeenCalled();
      expect(getRoundsByTournament).not.toHaveBeenCalled();
    });
  });
});
