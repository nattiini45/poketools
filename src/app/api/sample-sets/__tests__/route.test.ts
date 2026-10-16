import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/sample-sets', () => ({
  getSampleSets: vi.fn(),
}));

vi.mock('@/lib/pkmn/set-resolver', () => ({
  resolveMoveset: vi.fn(),
}));

import { GET } from '../route';
import { getSampleSets } from '@/lib/supabase/queries/sample-sets';
import { resolveMoveset } from '@/lib/pkmn/set-resolver';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

// ── Fixtures ───────────────────────────────────────────────────────────

const SAMPLE_ROW = {
  id: 'ss-1',
  set_name: 'Offensive',
  format: 'gen9ou',
  pokemon_name: 'Garchomp',
  moveset: { moves: ['Earthquake', 'Dragon Claw'] },
  generation: 9,
  description: 'Standard offensive set',
  outdated: false, last_imported: '2024-01-01T00:00:00Z',
};

const RESOLVED_SET = {
  name: 'Garchomp',
  species: 'Garchomp',
  gender: '',
  ability: 'Rough Skin',
  item: 'Rocky Helmet',
  evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Jolly',
  level: 100,
  moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Scale Shot'],
};

describe('GET /api/sample-sets', () => {
  // Public: no auth required
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Validation ─────────────────────────────────────────────────────

  it('returns 400 when pokemon param is missing', async () => {
    const res = await GET(makeRequest(undefined, {}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('pokemon query param is required');
    expect(body.code).toBe('sample_sets_pokemon_required');
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it('returns resolved sample sets for a pokemon', async () => {
    vi.mocked(getSampleSets).mockResolvedValue([SAMPLE_ROW] as never);
    vi.mocked(resolveMoveset).mockReturnValue(RESOLVED_SET);

    const res = await GET(makeRequest(undefined, { pokemon: 'Garchomp' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.pokemon_name).toBe('Garchomp');
    expect(body.data.generation).toBe(9);
    expect(body.data.sets).toHaveLength(1);
    expect(body.data.sets[0].set_name).toBe('Offensive');
    expect(body.data.sets[0].pokemon_set).toEqual(RESOLVED_SET);
    expect(body.data.sets[0].raw_moveset).toEqual(SAMPLE_ROW.moveset);
    expect(getSampleSets).toHaveBeenCalledWith('Garchomp', {
      generation: undefined,
      format: undefined,
      includeOutdated: false,
    });
  });

  it('maps full format slugs to bare tiers for the query', async () => {
    vi.mocked(getSampleSets).mockResolvedValue([]);

    const res = await GET(
      makeRequest(undefined, { pokemon: 'Garchomp', generation: '8', format: 'gen8ou' }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.generation).toBe(8);
    // The sets table stores bare tiers ('ou'), not full slugs ('gen8ou')
    expect(getSampleSets).toHaveBeenCalledWith('Garchomp', {
      generation: 8,
      format: 'ou',
      includeOutdated: false,
    });
  });

  it('derives the generation from a full format slug when not passed explicitly', async () => {
    vi.mocked(getSampleSets).mockResolvedValue([]);

    const res = await GET(
      makeRequest(undefined, { pokemon: 'Skarmory', format: 'gen3ou' }),
    );
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.generation).toBe(3);
    expect(getSampleSets).toHaveBeenCalledWith('Skarmory', {
      generation: 3,
      format: 'ou',
      includeOutdated: false,
    });
  });

  it('maps VGC year slugs to the shared vgc set pool', async () => {
    vi.mocked(getSampleSets).mockResolvedValue([]);

    await GET(
      makeRequest(undefined, { pokemon: 'Incineroar', format: 'gen9vgc2025' }),
    );

    expect(getSampleSets).toHaveBeenCalledWith('Incineroar', {
      generation: 9,
      format: 'vgc',
      includeOutdated: false,
    });
  });

  it('passes plain tier formats through unchanged', async () => {
    vi.mocked(getSampleSets).mockResolvedValue([]);

    await GET(
      makeRequest(undefined, { pokemon: 'Garchomp', generation: '9', format: 'ou' }),
    );

    expect(getSampleSets).toHaveBeenCalledWith('Garchomp', {
      generation: 9,
      format: 'ou',
      includeOutdated: false,
    });
  });

  it('passes includeOutdated flag when set to true', async () => {
    vi.mocked(getSampleSets).mockResolvedValue([]);

    await GET(
      makeRequest(undefined, { pokemon: 'Garchomp', include_outdated: 'true' }),
    );

    expect(getSampleSets).toHaveBeenCalledWith('Garchomp', {
      generation: undefined,
      format: undefined,
      includeOutdated: true,
    });
  });

  it('defaults generation to 9 when not specified', async () => {
    vi.mocked(getSampleSets).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, { pokemon: 'Garchomp' }));
    const body = await res.json();

    expect(body.data.generation).toBe(9);
  });

  it('returns empty sets array when no rows found', async () => {
    vi.mocked(getSampleSets).mockResolvedValue([]);

    const res = await GET(makeRequest(undefined, { pokemon: 'FakeMon' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.sets).toEqual([]);
  });

  // ── Error path ─────────────────────────────────────────────────────

  it('returns 500 when getSampleSets throws', async () => {
    vi.mocked(getSampleSets).mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest(undefined, { pokemon: 'Garchomp' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch sample sets');
  });
});
