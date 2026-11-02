import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { EvolutionTier } from '@/types/evolution';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getTierList: vi.fn(),
  getWildcards: vi.fn(),
  getAllTiers: vi.fn(),
  createTier: vi.fn(),
  bulkCreateTiers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({
  createPoolEntry: vi.fn(),
  bulkCreatePoolEntries: vi.fn(),
  getPoolEntries: vi.fn(),
}));

import { GET, POST } from '@/app/api/evolutions/route';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { toID } from '@/lib/pkmn/i18n/id';
import { requireAuth, requireResourceAdmin } from '@/lib/auth/helpers';
import {
  getTierList,
  getWildcards,
  getAllTiers,
  createTier,
  bulkCreateTiers,
} from '@/lib/supabase/queries/evolutions';
import {
  createPoolEntry,
  bulkCreatePoolEntries,
  getPoolEntries,
} from '@/lib/supabase/queries/draft-pool-entries';

/* ── GET ──────────────────────────────────────────────────── */

describe('GET /api/evolutions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when season_id is missing', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);

    const request = {
      url: 'http://localhost:3000/api/evolutions',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('season_id is required');
    expect(payload.code).toBe('draft_season_id_required');
  });

  it('returns all tiers by default', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);
    vi.mocked(getAllTiers).mockResolvedValue([
      { id: 'tier-1', base_pokemon: 'Pichu' },
    ] as never);

    const request = {
      url: 'http://localhost:3000/api/evolutions?season_id=season-a',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toHaveLength(1);
    expect(vi.mocked(getAllTiers)).toHaveBeenCalledWith('season-a');
  });

  it('returns only tiers when type=tiers', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);
    vi.mocked(getTierList).mockResolvedValue([{ id: 'tier-1' }] as never);

    const request = {
      url: 'http://localhost:3000/api/evolutions?season_id=season-a&type=tiers',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(vi.mocked(getTierList)).toHaveBeenCalledWith('season-a');
  });

  it('returns only wildcards when type=wildcards', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);
    vi.mocked(getWildcards).mockResolvedValue([{ id: 'wc-1' }] as never);

    const request = {
      url: 'http://localhost:3000/api/evolutions?season_id=season-a&type=wildcards',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(vi.mocked(getWildcards)).toHaveBeenCalledWith('season-a');
  });
});

/* ── POST ─────────────────────────────────────────────────── */

describe('POST /api/evolutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects mixed-season bulk tier payloads', async () => {
    const request = {
      json: vi.fn().mockResolvedValue([
        {
          season_id: '00000000-0000-4000-a000-000000000001',
          base_pokemon: 'Pichu',
          stage2_pokemon: 'Pikachu',
          stage2_kos: 3,
        },
        {
          season_id: '00000000-0000-4000-b000-000000000002',
          base_pokemon: 'Eevee',
          stage2_pokemon: 'Vaporeon',
          stage2_kos: 3,
        },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string; code?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('share the same season_id');
    expect(payload.code).toBe('evolution_tiers_mixed_season');
    expect(vi.mocked(requireResourceAdmin)).not.toHaveBeenCalled();
    expect(vi.mocked(bulkCreateTiers)).not.toHaveBeenCalled();
  });

  it('allows same-season bulk tiers after auth', async () => {
    const created: EvolutionTier[] = [
      {
        id: 'tier-1',
        season_id: '00000000-0000-4000-a000-000000000001',
        player_id: 'player-1',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
        stage3_pokemon: null,
        stage3_kos: null,
        power_tier: 'C',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    vi.mocked(bulkCreateTiers).mockResolvedValue(created);

    const request = {
      json: vi.fn().mockResolvedValue([
        {
          season_id: '00000000-0000-4000-a000-000000000001',
          player_id: 'player-1',
          base_pokemon: 'Pichu',
          stage2_pokemon: 'Pikachu',
          stage2_kos: 3,
        },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; data: EvolutionTier[] };

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(created);
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('season', '00000000-0000-4000-a000-000000000001');
    expect(vi.mocked(bulkCreateTiers)).toHaveBeenCalledTimes(1);
  });

  it('bulk create auto-syncs non-wildcard tiers to pool entries', async () => {
    vi.mocked(bulkCreateTiers).mockResolvedValue([
      { id: 'tier-1', season_id: '00000000-0000-4000-a000-000000000001', base_pokemon: 'Pichu' },
    ] as never);
    vi.mocked(getPoolEntries).mockResolvedValue([] as never);
    vi.mocked(bulkCreatePoolEntries).mockResolvedValue([] as never);

    const request = {
      json: vi.fn().mockResolvedValue([
        {
          season_id: '00000000-0000-4000-a000-000000000001',
          base_pokemon: 'Pichu',
          stage2_pokemon: 'Pikachu',
          stage2_kos: 3,
          // No player_id => not a wildcard
        },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(201);

    expect(vi.mocked(bulkCreatePoolEntries)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pokemon_name: 'Pichu' }),
      ]),
    );
  });

  describe('bulk auto-sync under concurrent writers', () => {
    const SEASON = '00000000-0000-4000-a000-000000000001';
    const duplicate = (name: string) =>
      new UserFacingError(`${name} is already in the draft pool`, { code: 'pool_entry_duplicate_name', status: 409 });
    const tier = (base_pokemon: string) => ({
      season_id: SEASON,
      base_pokemon,
      stage2_pokemon: 'X',
      stage2_kos: 3,
    });
    const post = (...bases: string[]) =>
      POST({ json: vi.fn().mockResolvedValue(bases.map(tier)) } as unknown as NextRequest);

    // The pool list as the database keeps it: one row per folded name, a batch insert all-or-nothing, and a
    // `racers` queue of other writers that list a Pokémon just before the nth write reaches the database.
    let pool: string[];
    let racers: Array<{ before: number; name: string }>;
    let writes: number;
    const listed = (name: string) => pool.some((p) => toID(p) === toID(name));
    const arrive = () => {
      writes += 1;
      for (const racer of racers.filter((r) => r.before === writes)) if (!listed(racer.name)) pool.push(racer.name);
    };

    beforeEach(() => {
      pool = [];
      racers = [];
      writes = 0;
      vi.mocked(bulkCreateTiers).mockResolvedValue([{ id: 'tier-1' }] as never);
      vi.mocked(getPoolEntries).mockImplementation((async () =>
        pool.map((pokemon_name, i) => ({ id: `e${i}`, pokemon_name }))) as never);
      vi.mocked(bulkCreatePoolEntries).mockImplementation((async (entries: Array<{ pokemon_name: string }>) => {
        arrive();
        const clash = entries.find((e) => listed(e.pokemon_name));
        if (clash) throw duplicate(clash.pokemon_name);
        pool.push(...entries.map((e) => e.pokemon_name));
        return [];
      }) as never);
      vi.mocked(createPoolEntry).mockImplementation((async (entry: { pokemon_name: string }) => {
        arrive();
        if (listed(entry.pokemon_name)) throw duplicate(entry.pokemon_name);
        pool.push(entry.pokemon_name);
        return {};
      }) as never);
    });

    it('lists every committed tier when one writer lists a Pokémon first, and the entries still missing are written', async () => {
      racers = [{ before: 1, name: 'pichu' }];

      const response = await post('Pichu', 'Eevee');

      expect(response.status).toBe(201);
      expect(pool.map(toID).sort()).toEqual(['eevee', 'pichu']);
    });

    it('lists every committed tier when a second writer collides with another entry that is still missing', async () => {
      // Writer 1 lists A before the batch; writer 2 lists B after the first retry read. C is the one nobody listed.
      racers = [
        { before: 1, name: 'Aipom' },
        { before: 2, name: 'bulbasaur' },
      ];

      const response = await post('Aipom', 'Bulbasaur', 'Charmander');
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.success).toBe(true);
      expect(pool.map(toID).sort()).toEqual(['aipom', 'bulbasaur', 'charmander']);
      expect(bulkCreateTiers).toHaveBeenCalledTimes(1);
    });

    it('reports the entries it could not list instead of answering 201, with the tiers already saved', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      racers = [{ before: 1, name: 'Aipom' }];
      const failure = new Error('connection reset');
      vi.mocked(createPoolEntry).mockImplementation((async (entry: { pokemon_name: string }) => {
        arrive();
        if (entry.pokemon_name === 'Charmander') throw failure;
        pool.push(entry.pokemon_name);
        return {};
      }) as never);

      const response = await post('Aipom', 'Bulbasaur', 'Charmander');
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload.success).toBe(false);
      expect(payload.code).toBe('evolution_pool_sync_incomplete');
      expect(payload.params).toEqual({ pokemon: 'Charmander', count: 1 });
      expect(payload.error).toContain('Charmander');
      expect(bulkCreateTiers).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('pool entry'), failure);
      error.mockRestore();
    });

    it('names every unresolved entry, and treats an entry that is gone again at the final read as unresolved', async () => {
      racers = [{ before: 1, name: 'Aipom' }];
      vi.mocked(createPoolEntry).mockImplementation((async (entry: { pokemon_name: string }) => {
        arrive();
        // Answers success, but another writer removes the row before the final read.
        if (entry.pokemon_name !== 'Bulbasaur') pool.push(entry.pokemon_name);
        return {};
      }) as never);

      const response = await post('Aipom', 'Bulbasaur', 'Charmander');
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload.code).toBe('evolution_pool_sync_incomplete');
      expect(payload.params).toEqual({ pokemon: 'Bulbasaur', count: 1 });
    });

    it('does not retry per entry when the whole batch is written', async () => {
      const response = await post('Aipom', 'Bulbasaur');

      expect(response.status).toBe(201);
      expect(bulkCreatePoolEntries).toHaveBeenCalledTimes(1);
      expect(createPoolEntry).not.toHaveBeenCalled();
    });

    it('lets a failure of the first batch that is not a duplicate propagate as it did', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(bulkCreatePoolEntries).mockRejectedValue(new Error('statement timeout'));

      const response = await post('Aipom');

      expect(response.status).toBe(500);
      expect(createPoolEntry).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  it('single create answers 201 when a concurrent writer lists the Pokémon between the read and the write', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(createTier).mockResolvedValue({ id: 'tier-1' } as never);
    vi.mocked(getPoolEntries).mockResolvedValue([] as never);
    vi.mocked(createPoolEntry).mockRejectedValue(
      new UserFacingError('Pichu is already in the draft pool', { code: 'pool_entry_duplicate_name', status: 409 }),
    );

    const response = await POST({
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
      }),
    } as unknown as NextRequest);

    expect(response.status).toBe(201);
  });

  it('bulk create skips pool-entry sync for wildcards (player_id present)', async () => {
    vi.mocked(bulkCreateTiers).mockResolvedValue([
      { id: 'tier-1', season_id: '00000000-0000-4000-a000-000000000001', base_pokemon: 'Pichu', player_id: 'player-1' },
    ] as never);

    const request = {
      json: vi.fn().mockResolvedValue([
        {
          season_id: '00000000-0000-4000-a000-000000000001',
          player_id: 'player-1',
          base_pokemon: 'Pichu',
          stage2_pokemon: 'Pikachu',
          stage2_kos: 3,
        },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(201);

    // No pool entry sync for wildcards
    expect(vi.mocked(getPoolEntries)).not.toHaveBeenCalled();
  });

  it('returns 400 for single create with missing fields', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        base_pokemon: 'Pichu',
        // Missing stage2_pokemon and stage2_kos
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('stage2_pokemon');
    expect(payload.code).toBe('evolution_stage2_required');
  });

  it('creates a single tier and auto-syncs pool entry', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    const created: EvolutionTier = {
      id: 'tier-1',
      season_id: '00000000-0000-4000-a000-000000000001',
      player_id: null,
      base_pokemon: 'Pichu',
      stage2_pokemon: 'Pikachu',
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: 'C',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(createTier).mockResolvedValue(created);
    vi.mocked(getPoolEntries).mockResolvedValue([]);
    vi.mocked(createPoolEntry).mockResolvedValue({} as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
        power_tier: 'C',
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(created);
    expect(vi.mocked(createPoolEntry)).toHaveBeenCalledWith(
      expect.objectContaining({
        season_id: '00000000-0000-4000-a000-000000000001',
        pokemon_name: 'Pichu',
        power_tier: 'C',
      }),
    );
  });

  it('skips pool entry sync for single wildcard tier', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(createTier).mockResolvedValue({
      id: 'tier-1',
      season_id: '00000000-0000-4000-a000-000000000001',
      player_id: 'player-1',
      base_pokemon: 'Pichu',
      stage2_pokemon: 'Pikachu',
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: null as never as never,
      created_at: '',
    });

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        player_id: 'player-1',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(vi.mocked(getPoolEntries)).not.toHaveBeenCalled();
    expect(vi.mocked(createPoolEntry)).not.toHaveBeenCalled();
  });

  it('skips pool entry sync when entry already exists', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(createTier).mockResolvedValue({
      id: 'tier-1',
      season_id: '00000000-0000-4000-a000-000000000001',
      player_id: null,
      base_pokemon: 'Pichu',
      stage2_pokemon: 'Pikachu',
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: null as never as never,
      created_at: '',
    });
    // Listed under another spelling: one Pokémon by id, so no second entry is created.
    vi.mocked(getPoolEntries).mockResolvedValue([{ id: 'existing-entry', pokemon_name: 'pichu' }] as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(vi.mocked(getPoolEntries)).toHaveBeenCalledWith('00000000-0000-4000-a000-000000000001');
    expect(vi.mocked(createPoolEntry)).not.toHaveBeenCalled();
  });
});
