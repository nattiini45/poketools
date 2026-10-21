import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real @smogon/calc and dex; only the Postgres limiter's database call is mocked.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { POST } from '../route';

const ALLOWED = { data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null };

function makeRequest(body: unknown): Request {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  } as unknown as Request;
}

const DEFENDER = { species: 'Heatran' };
const GARCHOMP = { species: 'Garchomp', nature: 'Adamant', evs: { atk: 252 }, moves: ['Earthquake'] };
const PIKACHU = { species: 'Pikachu', moves: ['Thunderbolt', '', 'Iron Tail'] };

describe('POST /api/calc/batch-incoming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue(ALLOWED);
  });

  it('calculates incoming damage from multiple attackers (blank moves dropped)', async () => {
    const res = await POST(makeRequest({ generation: 9, attackers: [GARCHOMP, PIKACHU], defender: DEFENDER }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.results.map((r: { attacker: string }) => r.attacker)).toEqual(['Garchomp', 'Pikachu']);
    expect(json.data.results[0].move_results[0].ko?.n).toBe(1);
    expect(json.data.results[1].move_results.map((r: { move: string }) => r.move)).toEqual(['Thunderbolt', 'Iron Tail']);
  });

  it('handles attackers with no moves', async () => {
    const res = await POST(makeRequest({ attackers: [{ species: 'Garchomp' }], defender: DEFENDER }));
    expect((await res.json()).data.results[0].move_results).toEqual([]);
  });

  it('gives every move of an unknown attacker an explicit error; an unknown defender is a 400', async () => {
    const res = await POST(makeRequest({ attackers: [{ species: 'Fakemon', moves: ['Tackle'] }, GARCHOMP], defender: DEFENDER }));
    const json = await res.json();
    expect(json.data.results[0].move_results).toEqual([
      { move: 'Tackle', error: { code: 'unknown_species', message: 'Unknown species: Fakemon', params: { pokemon: 'Fakemon' } } },
    ]);
    expect(json.data.results[1].move_results[0].damage.max).toBeGreaterThan(0);

    const bad = await POST(makeRequest({ attackers: [GARCHOMP], defender: { species: 'Fakemon' } }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      error: 'defender: Unknown species: Fakemon',
      code: 'unknown_species',
      params: { pokemon: 'Fakemon' },
    });
  });

  it('swaps the sides: the request attacker side (the user) defends against incoming hits', async () => {
    const plain = await POST(makeRequest({ attackers: [GARCHOMP], defender: { species: 'Pikachu' } }));
    const userReflect = await POST(
      makeRequest({ attackers: [GARCHOMP], defender: { species: 'Pikachu' }, field: { attackerSide: { reflect: true } } }),
    );
    const plainMax = (await plain.json()).data.results[0].move_results[0].damage.max;
    const reflectMax = (await userReflect.json()).data.results[0].move_results[0].damage.max;

    expect(reflectMax).toBeLessThan(plainMax);
  });

  it('returns 400 for more than 20 attackers, more than 80 calcs, or a missing attackers array', async () => {
    const many = Array.from({ length: 21 }, () => GARCHOMP);
    const res21 = await POST(makeRequest({ attackers: many, defender: DEFENDER }));
    expect(res21.status).toBe(400);
    expect((await res21.json()).error).toContain('Max 20 attackers per batch');

    const heavy = Array.from({ length: 9 }, () => ({ species: 'Garchomp', moves: Array.from({ length: 10 }, () => 'Earthquake') }));
    const resHeavy = await POST(makeRequest({ attackers: heavy, defender: DEFENDER }));
    expect(resHeavy.status).toBe(400);
    expect((await resHeavy.json()).error).toContain('At most 80 calculations');

    const resMissing = await POST(makeRequest({ defender: DEFENDER }));
    expect(resMissing.status).toBe(400);
  });

  it('accepts exactly 20 attackers', async () => {
    const res = await POST(makeRequest({ attackers: Array.from({ length: 20 }, () => GARCHOMP), defender: DEFENDER }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.results).toHaveLength(20);
  });

  it('returns 429 when the client IP is over the calc limit', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, hits: 200, retry_after_seconds: 5 }], error: null });
    const res = await POST(makeRequest({ attackers: [GARCHOMP], defender: DEFENDER }));
    expect(res.status).toBe(429);
  });
});
