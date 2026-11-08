/**
 * The roster of a phase the league's attached format created is not edited here once the phase has started: the draw, the
 * groups and the one-shot grants of its stage start were made for the roster it started with (409 format_phase_owned).
 * An upcoming format phase and a phase the format does not own stay editable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
  addParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  updateParticipantSeeds: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getKitPhases: vi.fn(), getSeasonKitHead: vi.fn() }));
vi.mock('@/lib/tournament/enrollment-sync', () => ({ syncStandingsEnrollment: vi.fn() }));

import { DELETE, PATCH, POST } from '../route';
import { POST as SYNC } from '../sync-standings/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { addParticipant, getParticipants, getTournamentById, removeParticipant, updateParticipantSeeds } from '@/lib/supabase/queries/tournaments';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';

const SEASON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHASE = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const args = { params: Promise.resolve({ id: SEASON, phaseId: PHASE }) };
const req = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;

const phase = (status: 'upcoming' | 'active') => ({ id: PHASE, season_id: SEASON, status }) as never;
const formatOwns = () => vi.mocked(getKitPhases).mockResolvedValue([{ id: PHASE, format_stage_key: 'groups', stage_order: 1, stage_spec: null }]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'a', name: 'A', isAdmin: true } as never);
  vi.mocked(getKitPhases).mockResolvedValue([]);
  vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: PLAYER }] as never);
  vi.mocked(getParticipants).mockResolvedValue([{ id: PLAYER }] as never);
});

describe('roster writes on a started phase of the attached format', () => {
  it('refuses add, remove, seeds and sync with 409 format_phase_owned and writes nothing', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(phase('active'));
    formatOwns();

    for (const response of [
      await POST(req({ player_id: PLAYER }), args),
      await DELETE(req({ player_id: PLAYER }), args),
      await PATCH(req({ seeds: [{ player_id: PLAYER, seed: 1 }] }), args),
      await SYNC(req({}), args),
    ]) {
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('format_phase_owned');
    }
    expect(addParticipant).not.toHaveBeenCalled();
    expect(removeParticipant).not.toHaveBeenCalled();
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
  });

  it('still edits a format phase that has not started', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(phase('upcoming'));
    formatOwns();
    expect((await POST(req({ player_id: PLAYER }), args)).status).toBe(201);
    expect(addParticipant).toHaveBeenCalledWith(PHASE, PLAYER);
  });

  it('still edits a started phase the format does not own', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(phase('active'));
    expect((await DELETE(req({ player_id: PLAYER }), args)).status).toBe(200);
    expect(removeParticipant).toHaveBeenCalledWith(PHASE, PLAYER);
  });
});
