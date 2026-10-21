import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real @smogon/calc and dex (the old fully mocked calc could not see kochance()
// throwing on 0 damage). Only the Postgres limiter's database call is mocked.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { POST } from '../route';
import { rateLimitKey } from '@/lib/utils/rate-limit';
import { CALC_RATE_LIMIT } from '@/lib/pkmn/calc-route';

const ALLOWED = { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null };

function makeRequest(body: unknown, ip = '203.0.113.9'): Request {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ 'x-forwarded-for': ip }),
  } as unknown as Request;
}

const GARCHOMP = { species: 'Garchomp', nature: 'Jolly', evs: { atk: 252, spe: 252 }, moves: ['Earthquake', 'Dragon Claw'] };

describe('POST /api/calc/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue(ALLOWED);
  });

  it('calculates moves against multiple defenders with real numbers and structured KO info', async () => {
    const res = await POST(
      makeRequest({
        generation: 9,
        attacker: GARCHOMP,
        defenders: [{ species: 'Heatran' }, { species: 'Pikachu' }],
        moves: ['Earthquake'],
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.results.map((r: { defender: string }) => r.defender)).toEqual(['Heatran', 'Pikachu']);
    const eq = json.data.results[0].move_results[0];
    expect(eq.move).toBe('Earthquake');
    expect(eq.damage.min_pct).toBeGreaterThan(50);
    expect(eq.ko).toEqual({ n: 1, chance: 1, conditional: false });
    expect(eq.ko_chance).toContain('OHKO');
    expect(eq.rolls.length).toBe(16);
    expect(eq.error).toBeUndefined();
  });

  it('reports a type immunity as a real 0-damage result (no fabricated error text)', async () => {
    const res = await POST(
      makeRequest({ attacker: GARCHOMP, defenders: [{ species: 'Corviknight' }], moves: ['Earthquake'] }),
    );
    const r = (await res.json()).data.results[0].move_results[0];

    expect(r.damage).toEqual({ min: 0, max: 0, min_pct: 0, max_pct: 0 });
    expect(r.ko).toBeNull();
    expect(r.ko_chance).toBe('N/A');
    expect(r.description).toBe('Garchomp Earthquake vs. Corviknight: 0-0 (0 - 0%)');
    expect(r.error).toBeUndefined();
  });

  it('gives an unknown move an explicit error and no damage numbers', async () => {
    const res = await POST(
      makeRequest({ attacker: GARCHOMP, defenders: [{ species: 'Heatran' }], moves: ['FakeMove'] }),
    );
    const r = (await res.json()).data.results[0].move_results[0];

    expect(r).toEqual({ move: 'FakeMove', error: { code: 'unknown_move', message: 'Unknown move: FakeMove', params: { move: 'FakeMove' } } });
  });

  it('gives every move against an unknown defender an error, without failing the batch', async () => {
    const res = await POST(
      makeRequest({
        attacker: GARCHOMP,
        defenders: [{ species: 'Fakemon' }, { species: 'Heatran' }],
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.results[0].move_results).toEqual([
      { move: 'Earthquake', error: { code: 'unknown_species', message: 'Unknown species: Fakemon', params: { pokemon: 'Fakemon' } } },
      { move: 'Dragon Claw', error: { code: 'unknown_species', message: 'Unknown species: Fakemon', params: { pokemon: 'Fakemon' } } },
    ]);
    expect(json.data.results[1].move_results[0].damage.max).toBeGreaterThan(0);
  });

  it('rejects an unknown attacker item with 400 instead of silently ignoring it', async () => {
    const res = await POST(
      makeRequest({ attacker: { ...GARCHOMP, item: 'Choice Bandd' }, defenders: [{ species: 'Heatran' }] }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      success: false,
      error: 'attacker: Unknown item: Choice Bandd',
      code: 'unknown_item',
      params: { item: 'Choice Bandd' },
    });
  });

  it('treats usage-stats placeholders ("Nothing", "Other") as no item', async () => {
    const res = await POST(
      makeRequest({ attacker: GARCHOMP, defenders: [{ species: 'Heatran', item: 'Nothing', ability: 'Other' }] }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.results[0].move_results[0].damage.max).toBeGreaterThan(0);
  });

  it('returns 400 for a missing defenders array (was a 500 TypeError)', async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toContain('attacker');
    expect(json.error).toContain('defenders');
  });

  it('returns 400 when more than 20 defenders are provided', async () => {
    const defenders = Array.from({ length: 21 }, () => ({ species: 'Heatran' }));

    const res = await POST(makeRequest({ attacker: GARCHOMP, defenders, moves: ['Earthquake'] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toContain('Max 20 defenders per batch');
  });

  it('accepts exactly 20 defenders × 4 moves (80 calcs)', async () => {
    const defenders = Array.from({ length: 20 }, () => ({ species: 'Heatran' }));

    const res = await POST(
      makeRequest({ attacker: GARCHOMP, defenders, moves: ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Fire Fang'] }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).data.results).toHaveLength(20);
  });

  it('rejects more than 80 calcs per request (defenders × moves)', async () => {
    const defenders = Array.from({ length: 17 }, () => ({ species: 'Heatran' }));
    const moves = ['Earthquake', 'Dragon Claw', 'Stone Edge', 'Fire Fang', 'Swords Dance'];

    const res = await POST(makeRequest({ attacker: GARCHOMP, defenders, moves }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At most 80 calculations');
  });

  it('rejects out-of-range numbers and unknown keys (strict schema)', async () => {
    for (const attacker of [
      { ...GARCHOMP, evs: { atk: 9999 } },
      { ...GARCHOMP, ivs: { atk: 252 } },
      { ...GARCHOMP, level: 0 },
      { ...GARCHOMP, boosts: { atk: 7 } },
      { ...GARCHOMP, species: 'x'.repeat(65) },
      { ...GARCHOMP, hacked: true },
    ]) {
      const res = await POST(makeRequest({ attacker, defenders: [{ species: 'Heatran' }] }));
      expect(res.status).toBe(400);
    }
  });

  it('falls back to attacker.moves without blanks when body.moves is not provided', async () => {
    const res = await POST(
      makeRequest({
        attacker: { ...GARCHOMP, moves: ['Earthquake', '', 'Dragon Claw', ''] },
        defenders: [{ species: 'Heatran' }],
      }),
    );
    const moves = (await res.json()).data.results[0].move_results.map((r: { move: string }) => r.move);

    expect(moves).toEqual(['Earthquake', 'Dragon Claw']);
  });

  it('applies snake_case side conditions (Reflect on the defender side lowers damage)', async () => {
    const plain = await POST(makeRequest({ attacker: GARCHOMP, defenders: [{ species: 'Pikachu' }], moves: ['Earthquake'] }));
    const screened = await POST(
      makeRequest({
        attacker: GARCHOMP,
        defenders: [{ species: 'Pikachu' }],
        moves: ['Earthquake'],
        field: { weather: 'Rain', defenderSide: { reflect: true } },
      }),
    );
    const plainMax = (await plain.json()).data.results[0].move_results[0].damage.max;
    const screenedMax = (await screened.json()).data.results[0].move_results[0].damage.max;

    expect(screenedMax).toBeLessThan(plainMax);
  });

  it('returns 400 invalid_json for an unparsable body (was a 500)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = {
      json: vi.fn().mockRejectedValue(new SyntaxError('Bad JSON')),
      headers: new Headers(),
    } as unknown as Request;

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ success: false, error: 'Invalid JSON body', code: 'invalid_json' });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  describe('rate limit (Postgres store)', () => {
    it('counts the request per client IP in the shared calc bucket', async () => {
      await POST(makeRequest({ attacker: GARCHOMP, defenders: [] }, '198.51.100.7'));

      expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
        p_key: rateLimitKey('calc', '198.51.100.7'),
        p_window_seconds: CALC_RATE_LIMIT.windowSeconds,
        p_max: CALC_RATE_LIMIT.limit,
      });
    });

    it('answers 429 with Retry-After before parsing the body when the IP is over the limit', async () => {
      rpc.mockResolvedValueOnce({ data: [{ allowed: false, hits: 121, retry_after_seconds: 30 }], error: null });
      const req = makeRequest({ attacker: GARCHOMP, defenders: [] });

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('30');
      expect(json.code).toBe('rate_limited');
      expect(req.json).not.toHaveBeenCalled();
    });

    it('fails open when the limiter is down (logged, request served)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });

      const res = await POST(makeRequest({ attacker: GARCHOMP, defenders: [{ species: 'Heatran' }] }));

      expect(res.status).toBe(200);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
