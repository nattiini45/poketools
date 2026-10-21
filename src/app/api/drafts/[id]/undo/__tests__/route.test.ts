import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({
  undoLastPick: vi.fn(),
  getDraftPoolById: vi.fn(),
}));

vi.mock('@/lib/draft/evolution-engine', () => ({
  isEvoLeague: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  deleteTrackerById: vi.fn(),
  deleteTrackerByLine: vi.fn(),
  getPlayerTrackers: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/drafts/[id]/undo/route';
import { requireDraftAdmin, AuthError } from '@/lib/auth/helpers';
import { undoLastPick, getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { isEvoLeague } from '@/lib/draft/evolution-engine';
import { deleteTrackerById, deleteTrackerByLine, getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { revalidateTag } from 'next/cache';

// ─── Helpers ────────────────────────────────────────────────────────

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const routeParams = { params: Promise.resolve({ id: POOL_ID }) };

const mockPool = {
  id: POOL_ID,
  season_id: 'season-1',
  draft_type: 'snake',
  status: 'in_progress',
};

const tracker = (base: string, lineId: string | null, createdAt: string) => ({
  id: `t-${base}-${lineId ?? 'none'}`,
  season_id: 'season-1',
  player_id: 'p1',
  base_pokemon: base,
  line_id: lineId,
  created_at: createdAt,
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/drafts/[id]/undo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not draft admin', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('answers 400 validation_failed for a malformed pool id and never reads the pool (L10)', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);

    const res = await POST({} as NextRequest, { params: Promise.resolve({ id: 'pool-1' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(getDraftPoolById).not.toHaveBeenCalled();
    expect(undoLastPick).not.toHaveBeenCalled();
  });

  it('a legacy pick without a line id and no tracker on its base deletes nothing', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(undoLastPick).mockResolvedValue({ player_id: 'p1', pokemon_name: 'Gible', line_id: null });
    vi.mocked(isEvoLeague).mockResolvedValue(true);
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('Pichu', 'pichu--raichu', '2026-10-01T12:00:00Z')] as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(deleteTrackerById).not.toHaveBeenCalled();
    expect(deleteTrackerByLine).not.toHaveBeenCalled();
  });

  it('returns 404 when pool not found', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(null);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Draft pool not found');
    expect(json.code).toBe('POOL_NOT_FOUND');
  });

  it('returns 400 when draft not in progress', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, status: 'pending' } as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('only undo picks in an active draft');
    expect(json.code).toBe('UNDO_NOT_ACTIVE');
  });

  it('answers 409 USE_VOID_PICK for a queue-engine pool and changes nothing', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'queue' } as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('USE_VOID_PICK');
    expect(undoLastPick).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('undoes last pick successfully', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(undoLastPick).mockResolvedValue({
      player_id: 'p1',
      pokemon_name: 'Pikachu',
      line_id: null,
    });
    vi.mocked(isEvoLeague).mockResolvedValue(false);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(undoLastPick).toHaveBeenCalledWith(POOL_ID);
    expect(revalidateTag).toHaveBeenCalledWith('season:season-1', { expire: 0 });
  });

  it('cleans up evolution tracker for evo-league', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(undoLastPick).mockResolvedValue({
      player_id: 'p1',
      pokemon_name: 'Charmander',
      line_id: null,
    });
    vi.mocked(isEvoLeague).mockResolvedValue(true);
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('Charmander', null, '2026-10-01T00:00:00Z')] as never);
    vi.mocked(deleteTrackerById).mockResolvedValue(undefined as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // A legacy tracker without a line id goes by its own id, never base-keyed.
    expect(deleteTrackerById).toHaveBeenCalledWith('t-Charmander-none');
    expect(deleteTrackerByLine).not.toHaveBeenCalled();
  });

  it('undoing one branch deletes only that line tracker (the pick carries its line id)', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(undoLastPick).mockResolvedValue({
      player_id: 'p1',
      pokemon_name: 'Teddiursa',
      line_id: 'teddiursa--ursalunabloodmoon',
    });
    vi.mocked(isEvoLeague).mockResolvedValue(true);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(deleteTrackerByLine).toHaveBeenCalledWith('season-1', 'p1', 'teddiursa--ursalunabloodmoon');
    expect(deleteTrackerById).not.toHaveBeenCalled();
    expect(getPlayerTrackers).not.toHaveBeenCalled();
  });

  it('a legacy pick without a line id keeps the other branch: only the newest tracker on the base goes', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(undoLastPick).mockResolvedValue({ player_id: 'p1', pokemon_name: 'Teddiursa', line_id: null });
    vi.mocked(isEvoLeague).mockResolvedValue(true);
    vi.mocked(getPlayerTrackers).mockResolvedValue([
      tracker('Teddiursa', 'teddiursa--ursaring', '2026-10-01T10:00:00Z'),
      tracker('Teddiursa', 'teddiursa--ursalunabloodmoon', '2026-10-01T11:00:00Z'),
      tracker('Pichu', 'pichu--raichu', '2026-10-01T12:00:00Z'),
    ] as never);

    const res = await POST({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(deleteTrackerById).toHaveBeenCalledTimes(1);
    expect(deleteTrackerById).toHaveBeenCalledWith('t-Teddiursa-teddiursa--ursalunabloodmoon');
    expect(deleteTrackerByLine).not.toHaveBeenCalled();
  });

  it('returns safe fallback from undoLastPick failure', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(undoLastPick).mockRejectedValue(new Error('No picks to undo'));

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    // safeErrorResponse returns 500 + safe fallback (no longer leaks internal message)
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to undo pick');
  });
});
