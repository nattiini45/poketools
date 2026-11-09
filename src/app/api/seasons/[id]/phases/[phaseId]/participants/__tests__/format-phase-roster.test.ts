/**
 * The roster of a phase the league's attached format created is not edited here once the phase has started: the draw, the
 * groups and the one-shot grants of its stage start were made for the roster it started with (409 format_phase_owned).
 * An upcoming format phase and a phase the format does not own stay editable. An admin can force the change with
 * `force: true` and a reason: it is made, and written to the audit log with the reason (add, remove, seeds, sync and
 * seed-by-rating alike).
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
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/supabase/queries/ratings', () => ({ getPlayerRatingsBatch: vi.fn() }));

import { DELETE, PATCH, POST } from '../route';
import { POST as SYNC } from '../sync-standings/route';
import { POST as SEED_BY_RATING } from '../seed-by-rating/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { addParticipant, getParticipants, getTournamentById, removeParticipant, updateParticipantSeeds } from '@/lib/supabase/queries/tournaments';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { logAuditEvent } from '@/lib/audit/log';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';

const SEASON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHASE = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const args = { params: Promise.resolve({ id: SEASON, phaseId: PHASE }) };
const req = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;

const phase = (status: 'upcoming' | 'active' | 'completed') => ({ id: PHASE, season_id: SEASON, status, name: 'Groups' }) as never;
const formatOwns = () => vi.mocked(getKitPhases).mockResolvedValue([{ id: PHASE, format_stage_key: 'groups', stage_order: 1, stage_spec: null }]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'a', name: 'A', isAdmin: true } as never);
  vi.mocked(getKitPhases).mockResolvedValue([]);
  vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: PLAYER }] as never);
  vi.mocked(getParticipants).mockResolvedValue([{ id: PLAYER }] as never);
  vi.mocked(getPlayerRatingsBatch).mockResolvedValue(new Map());
  vi.mocked(syncStandingsEnrollment).mockResolvedValue({ enrolled_count: 1, enrollment_source: {}, source_phase_name: null } as never);
});

describe('roster writes on a started phase of the attached format', () => {
  it('refuses add, remove, seeds, sync and seed-by-rating with 409 format_phase_owned and writes nothing', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(phase('active'));
    formatOwns();

    for (const response of [
      await POST(req({ player_id: PLAYER }), args),
      await DELETE(req({ player_id: PLAYER }), args),
      await PATCH(req({ seeds: [{ player_id: PLAYER, seed: 1 }] }), args),
      await SYNC(req({}), args),
      await SEED_BY_RATING(req({}), args),
    ]) {
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('format_phase_owned');
    }
    expect(addParticipant).not.toHaveBeenCalled();
    expect(removeParticipant).not.toHaveBeenCalled();
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('seed-by-rating without a body is refused too (the plain call has none)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(phase('active'));
    formatOwns();
    const bodyless = {
      json: async () => {
        throw new SyntaxError('no body');
      },
      headers: new Headers({ 'content-length': '0' }),
    } as unknown as NextRequest;

    const response = await SEED_BY_RATING(bodyless, args);

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_phase_owned');
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
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

describe('forcing a roster change on a started phase of the attached format', () => {
  const REASON = 'The player was added by mistake, take them out';

  beforeEach(() => {
    vi.mocked(getTournamentById).mockResolvedValue(phase('active'));
    formatOwns();
  });

  const audited = (change: string, extra: Record<string, unknown> = {}) =>
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'phase.roster.force',
        actor_id: 'a',
        resource_type: 'phase',
        resource_id: PHASE,
        metadata: expect.objectContaining({ season_id: SEASON, change, reason: REASON, ...extra }),
      }),
    );

  it('adds a player with force and a reason, and audits it with the reason', async () => {
    const response = await POST(req({ player_id: PLAYER, force: true, reason: REASON }), args);

    expect(response.status).toBe(201);
    expect(addParticipant).toHaveBeenCalledWith(PHASE, PLAYER);
    audited('add', { player_id: PLAYER });
  });

  it('bulk adds with force, and audits the players that got in even when a later insert fails', async () => {
    const OTHER = '44444444-4444-4444-8444-444444444444';
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: PLAYER }, { id: OTHER }] as never);
    vi.mocked(getParticipants).mockResolvedValue([] as never);
    vi.mocked(addParticipant).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('insert failed'));

    const response = await POST(req({ player_ids: [PLAYER, OTHER], force: true, reason: REASON }), args);

    expect(response.status).toBe(500);
    expect(addParticipant).toHaveBeenCalledTimes(2);
    audited('add', { added: 1 });
  });

  it('removes a player with force and a reason', async () => {
    const response = await DELETE(req({ player_id: PLAYER, force: true, reason: REASON }), args);

    expect(response.status).toBe(200);
    expect(removeParticipant).toHaveBeenCalledWith(PHASE, PLAYER);
    audited('remove', { player_id: PLAYER });
  });

  it('re-seeds with force and a reason', async () => {
    const response = await PATCH(req({ seeds: [{ player_id: PLAYER, seed: 1 }], force: true, reason: REASON }), args);

    expect(response.status).toBe(200);
    expect(updateParticipantSeeds).toHaveBeenCalledWith(PHASE, [{ player_id: PLAYER, seed: 1 }]);
    audited('seeds', { seeded: 1 });
  });

  it('seeds by rating with force and a reason', async () => {
    const response = await SEED_BY_RATING(req({ force: true, reason: REASON }), args);

    expect(response.status).toBe(200);
    expect(updateParticipantSeeds).toHaveBeenCalledWith(PHASE, [{ player_id: PLAYER, seed: 1 }]);
    audited('seed_by_rating', { seeded: 1 });
  });

  it('syncs the standings with force and a reason, next to the sync audit entry', async () => {
    const response = await SYNC(req({ force: true, reason: REASON }), args);

    expect(response.status).toBe(200);
    expect(syncStandingsEnrollment).toHaveBeenCalledWith(SEASON, PHASE, expect.objectContaining({ force: true }));
    audited('sync', { enrolled_count: 1 });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'phase.enrollment.sync' }));
  });

  it('refuses force without a reason, with a blank one, and with one over 500 characters (400, nothing written)', async () => {
    for (const reason of [undefined, '', '   ', 'x'.repeat(501), 7]) {
      for (const response of [
        await POST(req({ player_id: PLAYER, force: true, reason }), args),
        await DELETE(req({ player_id: PLAYER, force: true, reason }), args),
        await PATCH(req({ seeds: [{ player_id: PLAYER, seed: 1 }], force: true, reason }), args),
        await SYNC(req({ force: true, reason }), args),
        await SEED_BY_RATING(req({ force: true, reason }), args),
      ]) {
        expect(response.status, String(reason)).toBe(400);
        expect((await response.json()).code).toBe('PHASE_ROSTER_REASON_REQUIRED');
      }
    }
    expect(addParticipant).not.toHaveBeenCalled();
    expect(removeParticipant).not.toHaveBeenCalled();
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('honours only a boolean true: a reason alone, force "true" or force false stay refused with 409', async () => {
    for (const body of [{ reason: REASON }, { force: 'true', reason: REASON }, { force: false, reason: REASON }, { force: 1, reason: REASON }]) {
      const response = await POST(req({ player_id: PLAYER, ...body }), args);
      expect(response.status, JSON.stringify(body)).toBe(409);
      expect((await response.json()).code).toBe('format_phase_owned');
    }
    expect(addParticipant).not.toHaveBeenCalled();
  });

  it('does not lift the lock of a completed phase', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(phase('completed'));

    const response = await POST(req({ player_id: PLAYER, force: true, reason: REASON }), args);

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('PHASE_PARTICIPANTS_LOCKED');
    expect(addParticipant).not.toHaveBeenCalled();
  });

  it('writes no override audit entry when nothing was overridden (upcoming phase, or a phase the format does not own)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(phase('upcoming'));
    expect((await POST(req({ player_id: PLAYER, force: true, reason: REASON }), args)).status).toBe(201);

    vi.mocked(getTournamentById).mockResolvedValue(phase('active'));
    vi.mocked(getKitPhases).mockResolvedValue([]);
    expect((await DELETE(req({ player_id: PLAYER, force: true, reason: REASON }), args)).status).toBe(200);

    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
