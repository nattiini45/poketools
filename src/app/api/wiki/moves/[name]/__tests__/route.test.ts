import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getMoveNatDex: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  getApprovedNotes: vi.fn(),
}));

import { GET } from '../route';
import { getMoveNatDex } from '@/lib/pkmn/dex';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

type MockMove = {
  name: string;
  type: string;
  category: string;
  basePower: number;
  accuracy: number | true;
  pp: number;
  priority: number;
  desc?: string;
  shortDesc?: string;
  flags?: Record<string, number>;
  gen?: number;
};

function resolved(move: MockMove) {
  const gen = move.gen ?? 9;
  return { entity: move, resolvedGen: gen, earliestGen: gen };
}

// ── Fixtures ───────────────────────────────────────────────────────────

const MOCK_MOVE = {
  name: 'Earthquake',
  type: 'Ground',
  category: 'Physical',
  basePower: 100,
  accuracy: 100,
  pp: 10,
  priority: 0,
  desc: 'Damages all adjacent Pokemon. Double power on Dig.',
  shortDesc: 'Hits adjacent Pokemon. Double damage on Dig.',
  flags: { protect: 1, mirror: 1, nonsky: 1 },
  gen: 1,
};

const MOCK_MOVE_ALWAYS_HITS: MockMove = {
  name: 'Swift',
  type: 'Normal',
  category: 'Special',
  basePower: 60,
  accuracy: true,
  pp: 20,
  priority: 0,
  desc: 'This move does not check accuracy.',
  shortDesc: 'This move does not check accuracy.',
  flags: { protect: 1, mirror: 1 },
  gen: 1,
};

const MOCK_NOTE = {
  id: 'note-1',
  entity_type: 'move' as const,
  entity_name: 'Earthquake',
  content: 'One of the most common moves in competitive play.',
  author_id: 'p1',
  scope_type: 'global' as const,
  scope_id: null,
  approved: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/wiki/moves/[name]', () => {
  // Public: no auth required
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Not found ──────────────────────────────────────────────────────

  it('returns 404 when move is not found', async () => {
    vi.mocked(getMoveNatDex).mockReturnValue(null);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'FakeMove' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Move not found');
    expect(body.code).toBe('wiki_move_not_found');
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it('returns move data with notes', async () => {
    vi.mocked(getMoveNatDex).mockReturnValue(resolved(MOCK_MOVE) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([MOCK_NOTE] as never);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Earthquake' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.move.name).toBe('Earthquake');
    expect(body.data.move.type).toBe('Ground');
    expect(body.data.move.category).toBe('Physical');
    expect(body.data.move.basePower).toBe(100);
    expect(body.data.move.accuracy).toBe(100);
    expect(body.data.move.pp).toBe(10);
    expect(body.data.move.priority).toBe(0);
    expect(body.data.move.description).toBe(MOCK_MOVE.desc);
    expect(body.data.move.shortDesc).toBe(MOCK_MOVE.shortDesc);
    expect(body.data.move.flags).toEqual(['protect', 'mirror', 'nonsky']);
    expect(body.data.move.generation).toBe(1);
    expect(body.data.notes).toHaveLength(1);
    expect(getMoveNatDex).toHaveBeenCalledWith('Earthquake');
    expect(getApprovedNotes).toHaveBeenCalledWith('move', 'Earthquake');
  });

  it('converts accuracy=true to null for always-hit moves', async () => {
    vi.mocked(getMoveNatDex).mockReturnValue(resolved(MOCK_MOVE_ALWAYS_HITS) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Swift' }) });
    const body = await res.json();

    expect(body.data.move.accuracy).toBeNull();
  });

  it('decodes URL-encoded move names', async () => {
    vi.mocked(getMoveNatDex).mockReturnValue(resolved(MOCK_MOVE) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Ice%20Beam' }) });

    expect(getMoveNatDex).toHaveBeenCalledWith('Ice Beam');
  });

  it('continues without notes when getApprovedNotes throws', async () => {
    vi.mocked(getMoveNatDex).mockReturnValue(resolved(MOCK_MOVE) as never);
    vi.mocked(getApprovedNotes).mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Earthquake' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.notes).toEqual([]);
  });

  it('sets cache headers on successful response', async () => {
    vi.mocked(getMoveNatDex).mockReturnValue(resolved(MOCK_MOVE) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Earthquake' }) });

    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });

  it('handles move with empty flags', async () => {
    vi.mocked(getMoveNatDex).mockReturnValue(
      resolved({ ...MOCK_MOVE, flags: {} }) as never,
    );
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Earthquake' }) });
    const body = await res.json();

    expect(body.data.move.flags).toEqual([]);
  });

  it('resolves NatDex-only moves with the resolved gen', async () => {
    const mockMoveGen7: MockMove = {
      name: 'Hidden Power',
      type: 'Normal',
      category: 'Special',
      basePower: 60,
      accuracy: 100,
      pp: 15,
      priority: 0,
      desc: 'Power and type depend on the user.',
      shortDesc: 'Power and type depend on the user.',
      flags: { protect: 1 },
      gen: 2,
    };
    vi.mocked(getMoveNatDex).mockReturnValue({
      entity: mockMoveGen7 as never,
      resolvedGen: 7,
      earliestGen: 2,
    });
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Hidden Power' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.move.name).toBe('Hidden Power');
    expect(body.data.move.generation).toBe(2);
  });

  it('falls back to resolvedGen when move has no intrinsic gen field', async () => {
    vi.mocked(getMoveNatDex).mockReturnValue({
      entity: {
        name: 'Mystery',
        type: 'Normal',
        category: 'Status',
        basePower: 0,
        accuracy: 100,
        pp: 10,
        priority: 0,
      } as never,
      resolvedGen: 4,
      earliestGen: 4,
    });
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Mystery' }) });
    const body = await res.json();

    expect(body.data.move.description).toBe('');
    expect(body.data.move.shortDesc).toBe('');
    expect(body.data.move.flags).toEqual([]);
    expect(body.data.move.generation).toBe(4);
  });
});
