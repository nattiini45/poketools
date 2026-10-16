import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockCalculate = vi.fn();
const mockPokemon = vi.fn();
const mockMove = vi.fn();
const mockField = vi.fn();

vi.mock('@smogon/calc/dist/adaptable', () => ({
  calculate: (...args: unknown[]) => mockCalculate(...args),
  Pokemon: class {
    constructor(...args: unknown[]) {
      const inst = mockPokemon(...args);
      Object.assign(this, inst);
      return this;
    }
  },
  Move: class {
    constructor(...args: unknown[]) {
      const inst = mockMove(...args);
      Object.assign(this, inst);
      return this;
    }
  },
  Field: class {
    constructor(...args: unknown[]) {
      const inst = mockField(...args);
      Object.assign(this, inst);
      return this;
    }
  },
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getGeneration: vi.fn().mockReturnValue({ num: 9 }),
}));

import { POST } from '../route';

// ── Helpers ────────────────────────────────────────────────────────────

function makeCalcResult(overrides: Record<string, unknown> = {}) {
  return {
    range: () => [50, 60],
    kochance: () => ({ text: '2HKO' }),
    desc: () => 'Some description',
    damage: [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65],
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as Request;
}

describe('POST /api/calc/batch-incoming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPokemon.mockReturnValue({ maxHP: () => 300 });
    mockMove.mockReturnValue({});
    mockField.mockReturnValue({});
    mockCalculate.mockReturnValue(makeCalcResult());
  });

  it('calculates incoming damage from multiple attackers', async () => {
    const body = {
      generation: 9,
      defender: { species: 'Ferrothorn' },
      attackers: [
        { species: 'Charizard', moves: ['Flamethrower'] },
        { species: 'Pikachu', moves: ['Thunderbolt'] },
      ],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.results).toHaveLength(2);
    expect(json.data.results[0].attacker).toBe('Charizard');
    expect(json.data.results[1].attacker).toBe('Pikachu');
    expect(json.data.results[0].move_results).toHaveLength(1);
    expect(json.data.results[0].move_results[0].move).toBe('Flamethrower');
    // Structured KO info next to the English ko_chance (pkmn-l10n §3.7); the mock has no n/chance.
    expect(json.data.results[0].move_results[0].ko).toEqual({ n: 0, chance: null, conditional: false });
    expect(json.data.results[0].move_results[0].ko_chance).toBe('2HKO');
  });

  it('returns 400 when more than 20 attackers', async () => {
    const attackers = Array.from({ length: 21 }, (_, i) => ({
      species: `Mon${i}`,
      moves: ['Tackle'],
    }));

    const body = {
      generation: 9,
      defender: { species: 'Ferrothorn' },
      attackers,
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Max 20 attackers');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: 'Max 20 attackers per batch' });
  });

  it('accepts exactly 20 attackers', async () => {
    const attackers = Array.from({ length: 20 }, (_, i) => ({
      species: `Mon${i}`,
      moves: ['Tackle'],
    }));

    const body = {
      generation: 9,
      defender: { species: 'Ferrothorn' },
      attackers,
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.results).toHaveLength(20);
  });

  it('includes field conditions when provided', async () => {
    const body = {
      generation: 9,
      defender: { species: 'Ferrothorn' },
      attackers: [{ species: 'Charizard', moves: ['Flamethrower'] }],
      field: {
        gameType: 'Singles',
        weather: 'Sun',
        terrain: 'Grassy',
        attackerSide: { isReflect: true },
        defenderSide: { isLightScreen: true },
      },
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    // Field swaps attacker/defender sides for incoming calcs
    expect(mockField).toHaveBeenCalledWith(
      expect.objectContaining({
        weather: 'Sun',
        terrain: 'Grassy',
        attackerSide: { isLightScreen: true },   // swapped: defenderSide -> attackerSide
        defenderSide: { isReflect: true },         // swapped: attackerSide -> defenderSide
      }),
    );
  });

  it('handles attackers with no moves gracefully', async () => {
    const body = {
      generation: 9,
      defender: { species: 'Ferrothorn' },
      attackers: [{ species: 'Charizard' }],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.results[0].move_results).toHaveLength(0);
  });

  it('filters empty move strings', async () => {
    const body = {
      generation: 9,
      defender: { species: 'Ferrothorn' },
      attackers: [{ species: 'Charizard', moves: ['Flamethrower', '', 'Air Slash', ''] }],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.results[0].move_results).toHaveLength(2);
  });

  it('handles per-move calculation errors gracefully', async () => {
    mockCalculate.mockImplementation(() => {
      throw new Error('Unknown move');
    });

    const body = {
      generation: 9,
      defender: { species: 'Ferrothorn' },
      attackers: [{ species: 'Charizard', moves: ['FakeMove'] }],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.results[0].move_results[0].damage.min).toBe(0);
    expect(json.data.results[0].move_results[0].ko_chance).toBe('N/A');
    expect(json.data.results[0].move_results[0].ko).toBeNull();
    expect(json.data.results[0].move_results[0].description).toContain('Could not calculate');
  });

  it('returns 500 on invalid request body', async () => {
    const req = { json: vi.fn().mockRejectedValue(new Error('Bad JSON')) } as unknown as Request;

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
  });

  it('computes correct damage percentage', async () => {
    mockPokemon.mockReturnValue({ maxHP: () => 200 });
    mockCalculate.mockReturnValue({
      range: () => [50, 100],
      kochance: () => ({ text: '3HKO' }),
      desc: () => 'Calc description',
      damage: [50, 60, 70, 80, 90, 100],
    });

    const body = {
      generation: 9,
      defender: { species: 'Ferrothorn' },
      attackers: [{ species: 'Charizard', moves: ['Flamethrower'] }],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    const result = json.data.results[0].move_results[0];
    expect(result.damage.min).toBe(50);
    expect(result.damage.max).toBe(100);
    expect(result.damage.min_pct).toBe(25); // 50/200 * 100 = 25
    expect(result.damage.max_pct).toBe(50); // 100/200 * 100 = 50
    expect(result.ko_chance).toBe('3HKO');
  });
});
