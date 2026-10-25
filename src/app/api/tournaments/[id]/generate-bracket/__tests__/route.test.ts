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

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  updateSeason: vi.fn(),
}));

vi.mock('@/lib/tournament/bracket-generate', () => ({
  generateEliminationBracket: vi.fn(),
}));

vi.mock('@/lib/format-studio/attach', () => ({
  assertSeasonFormatAttached: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));

import { POST } from '@/app/api/tournaments/[id]/generate-bracket/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { logAuditEvent } from '@/lib/audit/log';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import { generateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { assertSeasonFormatAttached } from '@/lib/format-studio/attach';
import { FormatStudioError } from '@/lib/format-studio/errors';

const tournamentId = '00000000-0000-4000-8000-000000000001';
const params = { params: Promise.resolve({ id: tournamentId }) };

function request(): NextRequest {
  return {} as NextRequest;
}

function bodyRequest(body: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

const elimTournament = {
  id: tournamentId,
  name: 'Spring Open',
  bracket_type: 'single_elim',
  status: 'upcoming',
  season_id: null,
};

describe('POST /api/tournaments/[id]/generate-bracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
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

  it('answers a non-elimination format with bracket_generate_elim_only', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: tournamentId,
      bracket_type: 'swiss',
      status: 'upcoming',
    } as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Full bracket generation only applies to elimination formats');
    expect(payload.code).toBe('bracket_generate_elim_only');
    expect(generateEliminationBracket).not.toHaveBeenCalled();
  });

  it('answers a completed tournament with tournament_already_completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: tournamentId,
      bracket_type: 'single_elim',
      status: 'completed',
    } as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Tournament is already completed');
    expect(payload.code).toBe('tournament_already_completed');
    expect(generateEliminationBracket).not.toHaveBeenCalled();
  });

  describe('generating', () => {
    const eightPlayers = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, seed: i + 1 }));

    beforeEach(() => {
      vi.mocked(getTournamentById).mockResolvedValue(elimTournament as never);
      vi.mocked(getParticipants).mockResolvedValue(eightPlayers as never);
      vi.mocked(generateEliminationBracket).mockResolvedValue({ rounds_created: 3, matches_materialized: 4 });
    });

    it('answers fewer than 2 participants with tournament_participants_too_few (400, not a generic 500)', async () => {
      vi.mocked(getParticipants).mockResolvedValue([eightPlayers[0]] as never);

      const response = await POST(request(), params);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toBe('Need at least 2 participants');
      expect(payload.code).toBe('tournament_participants_too_few');
      expect(generateEliminationBracket).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('passes the typed bracket_already_generated (409) of the library through', async () => {
      vi.mocked(generateEliminationBracket).mockRejectedValue(
        new UserFacingError('Bracket already generated', { code: 'bracket_already_generated', status: 409 }),
      );

      const response = await POST(request(), params);
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload.error).toBe('Bracket already generated');
      expect(payload.code).toBe('bracket_already_generated');
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('generates with every round pending by default and returns the unchanged result shape', async () => {
      const response = await POST(request(), params);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(generateEliminationBracket).toHaveBeenCalledWith(elimTournament, eightPlayers, { startFirstRound: false });
      expect(payload.data).toEqual({ rounds_created: 3, matches_materialized: 4 });
    });

    it('start_round asks the library to start the first round and returns started_round_id', async () => {
      vi.mocked(generateEliminationBracket).mockResolvedValue({
        rounds_created: 3,
        matches_materialized: 4,
        started_round_id: 'round-1',
      });

      const response = await POST(bodyRequest({ start_round: true }), params);
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(generateEliminationBracket).toHaveBeenCalledWith(elimTournament, eightPlayers, { startFirstRound: true });
      expect(payload.data.started_round_id).toBe('round-1');
    });

    it('rejects a malformed body with 400 validation_failed before anything is read or written', async () => {
      const response = await POST(bodyRequest({ start_round: 'yes' }), params);
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.code).toBe('validation_failed');
      expect(getTournamentById).not.toHaveBeenCalled();
      expect(generateEliminationBracket).not.toHaveBeenCalled();
    });

    it('records one bracket.generate event after the write', async () => {
      const response = await POST(request(), params);

      expect(response.status).toBe(201);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith({
        actor_id: 'admin-1',
        actor_name: 'Admin',
        action: 'bracket.generate',
        resource_type: 'tournament',
        resource_id: tournamentId,
        resource_name: 'Spring Open',
        metadata: { rounds_created: 3, matches_materialized: 4, started: false },
      });
    });

    it('marks the event as started when the first round was started', async () => {
      vi.mocked(generateEliminationBracket).mockResolvedValue({
        rounds_created: 3,
        matches_materialized: 4,
        started_round_id: 'round-1',
      });

      await POST(bodyRequest({ start_round: true }), params);

      expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ started: true });
    });
  });

  describe('league type and the format check', () => {
    const twoPlayers = [
      { id: 'p1', name: 'Player 1', seed: 1 },
      { id: 'p2', name: 'Player 2', seed: 2 },
    ];
    const seasonId = '00000000-0000-4000-8000-0000000000aa';
    const tournamentOf = (seasonFormatType: string | undefined) =>
      ({
        id: tournamentId,
        bracket_type: 'single_elim',
        status: 'upcoming',
        season_id: seasonId,
        season_format_type: seasonFormatType,
      }) as never;

    it('refuses a custom league without an attached format with 409 format_not_attached, before any write', async () => {
      vi.mocked(getTournamentById).mockResolvedValue(tournamentOf('custom'));
      vi.mocked(assertSeasonFormatAttached).mockRejectedValue(new FormatStudioError('format_not_attached'));

      const response = await POST(request(), params);
      const payload = await response.json();

      expect(response.status).toBe(409);
      expect(payload.code).toBe('format_not_attached');
      expect(assertSeasonFormatAttached).toHaveBeenCalledWith(seasonId);
      expect(getParticipants).not.toHaveBeenCalled();
      expect(generateEliminationBracket).not.toHaveBeenCalled();
      expect(updateSeason).not.toHaveBeenCalled();
    });

    it('generates the bracket of a custom league whose format is attached', async () => {
      vi.mocked(getTournamentById).mockResolvedValue(tournamentOf('custom'));
      vi.mocked(assertSeasonFormatAttached).mockResolvedValue(undefined);
      vi.mocked(getParticipants).mockResolvedValue(twoPlayers as never);
      vi.mocked(generateEliminationBracket).mockResolvedValue({ rounds: 3 } as never);
      vi.mocked(getSeasonById).mockResolvedValue({ id: seasonId, status: 'active' } as never);

      const response = await POST(request(), params);

      expect(response.status).toBe(201);
      expect(generateEliminationBracket).toHaveBeenCalledTimes(1);
    });

    it.each(['singles', 'doubles', 'draft', 'evolution_point_buy', undefined])(
      'does not look at the format of a %s league',
      async (formatType) => {
        vi.mocked(getTournamentById).mockResolvedValue(tournamentOf(formatType));
        vi.mocked(getParticipants).mockResolvedValue(twoPlayers as never);
        vi.mocked(generateEliminationBracket).mockResolvedValue({ rounds: 3 } as never);
        vi.mocked(getSeasonById).mockResolvedValue({ id: seasonId, status: 'active' } as never);

        const response = await POST(request(), params);

        expect(response.status).toBe(201);
        expect(assertSeasonFormatAttached).not.toHaveBeenCalled();
      },
    );

    it('does not check a stand-alone tournament', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({ id: tournamentId, bracket_type: 'single_elim', status: 'upcoming', season_id: null } as never);
      vi.mocked(getParticipants).mockResolvedValue(twoPlayers as never);
      vi.mocked(generateEliminationBracket).mockResolvedValue({ rounds: 3 } as never);

      const response = await POST(request(), params);

      expect(response.status).toBe(201);
      expect(assertSeasonFormatAttached).not.toHaveBeenCalled();
    });
  });
});
