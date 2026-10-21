import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real German description maps (descriptions.server.ts) are used; only data access is mocked.
vi.mock('@/lib/supabase/queries/usage-hybrid', () => ({
  getHybridPokemonDetail: vi.fn(),
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getSpeciesTypeInfo: vi.fn(),
  getBaseStats: vi.fn(),
  getMove: vi.fn(),
}));

vi.mock('@/lib/pkmn/formats', () => ({
  getFallbackFormats: vi.fn().mockReturnValue([]),
}));

import { GET } from '../route';
import { getHybridPokemonDetail } from '@/lib/supabase/queries/usage-hybrid';
import { getSpeciesTypeInfo, getBaseStats, getMove } from '@/lib/pkmn/dex';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

const ENGLISH_UTURN = 'User switches out after damaging the target.';

const detail = {
  pokemon: 'Landorus-Therian',
  format: 'gen9ou',
  usage_pct: 25.5,
  moves: { 'U-turn': 80 },
  items: {},
  abilities: {},
  spreads: {},
  teammates: {},
  checks_and_counters: {},
};

async function shortDescFor(query: Record<string, string>): Promise<string | undefined> {
  const req = makeRequest(undefined, { format: 'gen9ou', ...query });
  const res = await GET(req, { params: makeParams({ pokemon: 'Landorus-Therian' }) });
  const json = await res.json();
  expect(res.status).toBe(200);
  return json.data.enriched_moves[0].shortDesc;
}

describe('GET /api/usage-stats/[pokemon] move descriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHybridPokemonDetail).mockResolvedValue(detail as never);
    vi.mocked(getSpeciesTypeInfo).mockReturnValue({ types: ['Ground', 'Flying'] } as never);
    vi.mocked(getBaseStats).mockReturnValue({ baseStats: { hp: 89, atk: 145, def: 90, spa: 105, spd: 80, spe: 91 } } as never);
    vi.mocked(getMove).mockReturnValue({
      name: 'U-turn',
      type: 'Bug',
      category: 'Physical',
      basePower: 70,
      shortDesc: ENGLISH_UTURN,
    } as never);
  });

  it('keeps the English shortDesc without ?lang', async () => {
    expect(await shortDescFor({})).toBe(ENGLISH_UTURN);
  });

  it('keeps the English shortDesc for an unknown lang', async () => {
    expect(await shortDescFor({ lang: 'fr' })).toBe(ENGLISH_UTURN);
  });

  it('?lang=de returns the German game text', async () => {
    const german = await shortDescFor({ lang: 'de' });
    expect(german).toBeTruthy();
    expect(german).not.toBe(ENGLISH_UTURN);
  });
});
