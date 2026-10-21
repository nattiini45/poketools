import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real @smogon/calc and dex; only the Postgres limiter's database call is mocked.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { POST } from '../route';
import { rateLimitKey } from '@/lib/utils/rate-limit';

const ALLOWED = { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null };

function makeRequest(body: unknown): Request {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  } as unknown as Request;
}

const ATTACKER = { species: 'Garchomp', item: 'Choice Band', nature: 'Adamant', evs: { atk: 252 }, moves: ['Earthquake', 'Thunder Wave', ''] };
const DEFENDER = { species: 'Heatran', evs: { hp: 0, def: 0 } };

describe('POST /api/calc/damage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue(ALLOWED);
  });

  it('returns a real calc result with structured KO info and the English ko_chance', async () => {
    const res = await POST(makeRequest({ generation: 9, attacker: ATTACKER, defender: DEFENDER, move: 'earthquake' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    const [r] = json.data.results;
    expect(r.move).toBe('Earthquake'); // canonical dex name
    expect(r.damage.min_pct).toBeGreaterThan(100);
    expect(r.ko).toEqual({ n: 1, chance: 1, conditional: false });
    expect(r.ko_chance).toBe('guaranteed OHKO');
    expect(r.description).toContain('Garchomp Earthquake vs.');
    expect(r.rolls).toHaveLength(16);
  });

  it('marks a KO that needs hazards as conditional', async () => {
    const res = await POST(
      makeRequest({
        attacker: { species: 'Garchomp', nature: 'Adamant', evs: { atk: 252 } },
        defender: { species: 'Toxapex', item: 'Black Sludge', evs: { hp: 252, def: 252 } },
        move: 'Earthquake',
        field: { defenderSide: { stealth_rock: true, spikes: 1 } },
      }),
    );
    const [r] = (await res.json()).data.results;

    expect(r.ko?.conditional).toBe(true);
    expect(r.ko_chance).toContain('after');
  });

  it('calculates every listed move (without blanks) when allMoves is true; a status move is a 0-damage result', async () => {
    const res = await POST(makeRequest({ attacker: ATTACKER, defender: DEFENDER, allMoves: true }));
    const results = (await res.json()).data.results;

    expect(results.map((r: { move: string }) => r.move)).toEqual(['Earthquake', 'Thunder Wave']);
    expect(results[1]).toMatchObject({ damage: { min: 0, max: 0 }, ko: null, ko_chance: 'N/A' });
    expect(results[1].error).toBeUndefined();
  });

  it('gives an unknown move an explicit error instead of fabricated zeros', async () => {
    const res = await POST(makeRequest({ attacker: ATTACKER, defender: DEFENDER, move: 'Hidden Power Fire' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.results).toEqual([
      { move: 'Hidden Power Fire', error: { code: 'unknown_move', message: 'Unknown move: Hidden Power Fire', params: { move: 'Hidden Power Fire' } } },
    ]);
  });

  it('returns 400 for an unknown name on either mon (it would make every number wrong)', async () => {
    const badDefender = await POST(makeRequest({ attacker: ATTACKER, defender: { species: 'Fakemon' }, move: 'Earthquake' }));
    expect(badDefender.status).toBe(400);
    expect(await badDefender.json()).toEqual({
      success: false,
      error: 'defender: Unknown species: Fakemon',
      code: 'unknown_species',
      params: { pokemon: 'Fakemon' },
    });

    const badAbility = await POST(
      makeRequest({ attacker: { ...ATTACKER, ability: 'Bogus' }, defender: DEFENDER, move: 'Earthquake' }),
    );
    expect(badAbility.status).toBe(400);
    expect(await badAbility.json()).toMatchObject({ error: 'attacker: Unknown ability: Bogus', code: 'unknown_ability' });

    const badTera = await POST(
      makeRequest({ attacker: { ...ATTACKER, is_tera: true, tera_type: 'Cosmic' }, defender: DEFENDER, move: 'Earthquake' }),
    );
    expect(badTera.status).toBe(400);
    expect(await badTera.json()).toMatchObject({ error: 'attacker: Unknown Tera type: Cosmic', code: 'unknown_tera_type' });
  });

  it('applies Tera only when is_tera is set', async () => {
    const plain = await POST(makeRequest({ attacker: { ...ATTACKER, tera_type: 'Ground' }, defender: DEFENDER, move: 'Earthquake' }));
    const tera = await POST(
      makeRequest({ attacker: { ...ATTACKER, tera_type: 'Ground', is_tera: true }, defender: DEFENDER, move: 'Earthquake' }),
    );
    const plainMax = (await plain.json()).data.results[0].damage.max;
    const teraMax = (await tera.json()).data.results[0].damage.max;

    expect(teraMax).toBeGreaterThan(plainMax);
  });

  it('returns 400 (not 500) for a missing move, a missing attacker and bad field values', async () => {
    for (const body of [
      { attacker: ATTACKER, defender: DEFENDER },
      { defender: DEFENDER, move: 'Earthquake' },
      { attacker: ATTACKER, defender: DEFENDER, move: 'Earthquake', field: { weather: 'Fog' } },
      { attacker: ATTACKER, defender: DEFENDER, move: 'Earthquake', field: { defenderSide: { spikes: 4 } } },
      { attacker: ATTACKER, defender: DEFENDER, move: 'Earthquake', generation: 10 },
      { attacker: { ...ATTACKER, moves: Array.from({ length: 11 }, () => 'Earthquake') }, defender: DEFENDER, allMoves: true },
    ]) {
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
    }
  });

  it('returns 400 invalid_json for an unparsable body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = { json: vi.fn().mockRejectedValue(new SyntaxError('x')), headers: new Headers() } as unknown as Request;

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_json');
    errorSpy.mockRestore();
  });

  it('is rate limited per client IP in the shared calc bucket (429 before any calc)', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, hits: 200, retry_after_seconds: 12 }], error: null });

    const res = await POST(makeRequest({ attacker: ATTACKER, defender: DEFENDER, move: 'Earthquake' }));

    expect(res.status).toBe(429);
    expect((await res.json()).params).toEqual({ seconds: 12 });
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', expect.objectContaining({ p_key: rateLimitKey('calc', '203.0.113.9') }));
  });

  it('a request without a client IP is not limited on the in-memory store (local run, no shared "unknown" bucket)', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
    try {
      const req = { json: vi.fn().mockResolvedValue({ attacker: ATTACKER, defender: DEFENDER, move: 'Earthquake' }), headers: new Headers() } as unknown as Request;
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(rpc).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a request without a client IP shares the "unknown" bucket on the Postgres store, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const req = { json: vi.fn().mockResolvedValue({ attacker: ATTACKER, defender: DEFENDER, move: 'Earthquake' }), headers: new Headers() } as unknown as Request;
      await POST(req);
      expect(rpc).toHaveBeenCalledWith('rate_limit_hit', expect.objectContaining({ p_key: rateLimitKey('calc', 'unknown') }));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no client IP header'));
    } finally {
      warn.mockRestore();
    }
  });
});
