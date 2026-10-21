import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getAbilityNatDex: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/wiki-notes', () => ({
  getApprovedNotes: vi.fn(),
}));

import { GET } from '../route';
import { getAbilityNatDex } from '@/lib/pkmn/dex';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

type MockAbility = {
  name: string;
  desc?: string;
  shortDesc?: string;
  gen?: number;
  rating?: number;
};

function resolved(ability: MockAbility) {
  const gen = ability.gen ?? 9;
  return { entity: ability, resolvedGen: gen, earliestGen: gen };
}

// ── Fixtures ───────────────────────────────────────────────────────────

const MOCK_ABILITY = {
  name: 'Intimidate',
  desc: 'On switch-in, this Pokemon lowers the Attack of adjacent opposing Pokemon by 1 stage.',
  shortDesc: 'On switch-in, this Pokemon lowers the Attack of adjacent foes by 1.',
  gen: 3,
  rating: 3.5,
};

const MOCK_NOTE = {
  id: 'note-1',
  entity_type: 'ability' as const,
  entity_name: 'Intimidate',
  content: 'Very popular in VGC.',
  author_id: 'p1',
  scope_type: 'global' as const,
  scope_id: null,
  approved: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/wiki/abilities/[name]', () => {
  // Public: no auth required
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Not found ──────────────────────────────────────────────────────

  it('returns 404 when ability is not found', async () => {
    vi.mocked(getAbilityNatDex).mockReturnValue(null);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'FakeAbility' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Ability not found');
    expect(body.code).toBe('wiki_ability_not_found');
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it('returns ability data with notes', async () => {
    vi.mocked(getAbilityNatDex).mockReturnValue(resolved(MOCK_ABILITY) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([MOCK_NOTE] as never);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Intimidate' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.ability.name).toBe('Intimidate');
    expect(body.data.ability.description).toBe(MOCK_ABILITY.desc);
    expect(body.data.ability.shortDesc).toBe(MOCK_ABILITY.shortDesc);
    expect(body.data.ability.generation).toBe(3);
    expect(body.data.ability.rating).toBe(3.5);
    expect(body.data.notes).toHaveLength(1);
    expect(getAbilityNatDex).toHaveBeenCalledWith('Intimidate');
    expect(getApprovedNotes).toHaveBeenCalledWith('ability', 'Intimidate');
  });

  it('decodes URL-encoded ability names', async () => {
    vi.mocked(getAbilityNatDex).mockReturnValue(resolved(MOCK_ABILITY) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Sand%20Veil' }) });

    expect(getAbilityNatDex).toHaveBeenCalledWith('Sand Veil');
  });

  it('continues without notes when getApprovedNotes throws', async () => {
    vi.mocked(getAbilityNatDex).mockReturnValue(resolved(MOCK_ABILITY) as never);
    vi.mocked(getApprovedNotes).mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Intimidate' }) });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.notes).toEqual([]);
  });

  it('sets cache headers on successful response', async () => {
    vi.mocked(getAbilityNatDex).mockReturnValue(resolved(MOCK_ABILITY) as never);
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Intimidate' }) });

    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });

  it('falls back to resolvedGen when ability has no intrinsic gen field', async () => {
    vi.mocked(getAbilityNatDex).mockReturnValue({
      entity: { name: 'Mystery' } as never,
      resolvedGen: 5,
      earliestGen: 5,
    });
    vi.mocked(getApprovedNotes).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, {}), { params: makeParams({ name: 'Mystery' }) });
    const body = await res.json();

    expect(body.data.ability.description).toBe('');
    expect(body.data.ability.shortDesc).toBe('');
    expect(body.data.ability.generation).toBe(5);
    expect(body.data.ability.rating).toBe(0);
  });
});
