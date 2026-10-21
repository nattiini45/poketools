import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getItemNatDex: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  getApprovedNotes: vi.fn(),
}));

import { GET } from '../route';
import { getItemNatDex } from '@/lib/pkmn/dex';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

type MockItem = {
  name: string;
  desc?: string;
  shortDesc?: string;
  gen?: number;
  fpierce?: boolean;
};

function resolved(item: MockItem) {
  const gen = item.gen ?? 9;
  return { entity: item, resolvedGen: gen, earliestGen: gen };
}

// ── Fixtures ───────────────────────────────────────────────────────────

const MOCK_ITEM = {
  name: 'Choice Band',
  desc: "Holder's Attack is 1.5x, but it can only select the first move it executes.",
  shortDesc: "Holder's Attack is 1.5x, but it can only use the first move it selects.",
  gen: 3,
  fpierce: false,
};

const MOCK_NOTE = {
  id: 'note-1',
  entity_type: 'item' as const,
  entity_name: 'Choice Band',
  content: 'Core item for physical wallbreakers.',
  author_id: 'p1',
  scope_type: 'global' as const,
  scope_id: null,
  approved: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/wiki/items/[name]', () => {
  // Public: no auth required
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Not found ──────────────────────────────────────────────────────

  it('returns 404 when item is not found', async () => {
    vi.mocked(getItemNatDex).mockReturnValue(null);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'FakeItem' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Item not found');
    expect(body.code).toBe('wiki_item_not_found');
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it('returns item data with notes', async () => {
    vi.mocked(getItemNatDex).mockReturnValue(resolved(MOCK_ITEM) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([MOCK_NOTE] as never);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Choice Band' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.item.name).toBe('Choice Band');
    expect(body.data.item.description).toBe(MOCK_ITEM.desc);
    expect(body.data.item.shortDesc).toBe(MOCK_ITEM.shortDesc);
    expect(body.data.item.generation).toBe(3);
    expect(body.data.item.fpierce).toBe(false);
    expect(body.data.notes).toHaveLength(1);
    expect(getItemNatDex).toHaveBeenCalledWith('Choice Band');
    expect(getApprovedNotes).toHaveBeenCalledWith('item', 'Choice Band');
  });

  it('decodes URL-encoded item names', async () => {
    vi.mocked(getItemNatDex).mockReturnValue(resolved(MOCK_ITEM) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Choice%20Band' }) });

    expect(getItemNatDex).toHaveBeenCalledWith('Choice Band');
  });

  it('continues without notes when getApprovedNotes throws', async () => {
    vi.mocked(getItemNatDex).mockReturnValue(resolved(MOCK_ITEM) as never);
    vi.mocked(getApprovedNotes).mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Choice Band' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.notes).toEqual([]);
  });

  it('sets cache headers on successful response', async () => {
    vi.mocked(getItemNatDex).mockReturnValue(resolved(MOCK_ITEM) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Choice Band' }) });

    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });

  it('falls back to resolvedGen when item has no intrinsic gen field', async () => {
    vi.mocked(getItemNatDex).mockReturnValue({
      entity: { name: 'Mystery Item' } as never,
      resolvedGen: 6,
      earliestGen: 6,
    });
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Mystery Item' }) });
    const body = await res.json();

    expect(body.data.item.description).toBe('');
    expect(body.data.item.shortDesc).toBe('');
    expect(body.data.item.generation).toBe(6);
  });
});
