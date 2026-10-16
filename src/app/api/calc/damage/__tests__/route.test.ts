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
    kochance: () => ({ text: '2HKO (99.8%)' }),
    desc: () => '252 Atk Garchomp Earthquake vs. 0 HP / 0 Def Charizard',
    damage: [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65],
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as Request;
}

describe('POST /api/calc/damage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPokemon.mockReturnValue({ maxHP: () => 297 });
    mockMove.mockReturnValue({});
    mockField.mockReturnValue({});
    mockCalculate.mockReturnValue(makeCalcResult());
  });

  it('returns calc results for a single move', async () => {
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp', moves: ['Earthquake'] },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.results).toHaveLength(1);
    expect(json.data.results[0].move).toBe('Earthquake');
    expect(json.data.results[0].damage.min).toBe(50);
    expect(json.data.results[0].damage.max).toBe(60);
    expect(json.data.results[0].ko_chance).toBe('2HKO (99.8%)');
  });

  it('adds the structured ko field and keeps the English ko_chance', async () => {
    mockCalculate.mockReturnValue(
      makeCalcResult({ kochance: () => ({ chance: 0.375, n: 2, text: '37.5% chance to 2HKO' }) }),
    );
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
    };

    const json = await (await POST(makeRequest(body))).json();

    expect(json.data.results[0].ko).toEqual({ n: 2, chance: 0.375, conditional: false });
    expect(json.data.results[0].ko_chance).toBe('37.5% chance to 2HKO');
  });

  it('marks a KO that needs hazards or end-of-turn damage as conditional', async () => {
    mockCalculate.mockReturnValue(
      makeCalcResult({
        kochance: () => ({ chance: 1, n: 2, text: 'guaranteed 2HKO after Stealth Rock' }),
      }),
    );
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
    };

    const json = await (await POST(makeRequest(body))).json();

    expect(json.data.results[0].ko).toEqual({ n: 2, chance: 1, conditional: true });
  });

  it('sets ko to null when a move cannot be calculated', async () => {
    mockCalculate.mockImplementation(() => {
      throw new Error('Unknown move');
    });
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'FakeMove',
    };

    const json = await (await POST(makeRequest(body))).json();

    expect(json.data.results[0].ko).toBeNull();
    expect(json.data.results[0].ko_chance).toBe('N/A');
  });

  it('returns results for all moves when allMoves is true', async () => {
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp', moves: ['Earthquake', 'Dragon Claw', ''] },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
      allMoves: true,
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    // Empty string in moves is filtered out
    expect(json.data.results).toHaveLength(2);
    expect(json.data.results[0].move).toBe('Earthquake');
    expect(json.data.results[1].move).toBe('Dragon Claw');
  });

  it('includes field conditions when provided', async () => {
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
      field: {
        gameType: 'Singles',
        weather: 'Sun',
        terrain: 'Grassy',
      },
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(mockField).toHaveBeenCalledWith(
      expect.objectContaining({
        gameType: 'Singles',
        weather: 'Sun',
        terrain: 'Grassy',
      })
    );
  });

  it('handles calculation errors gracefully per-move', async () => {
    mockCalculate.mockImplementation(() => {
      throw new Error('Unknown move');
    });

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'FakeMove',
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.results[0].damage.min).toBe(0);
    expect(json.data.results[0].damage.max).toBe(0);
    expect(json.data.results[0].ko_chance).toBe('N/A');
    expect(json.data.results[0].description).toContain('Could not calculate');
  });

  it('returns 500 when request body is invalid', async () => {
    const req = { json: vi.fn().mockRejectedValue(new Error('Bad JSON')) } as unknown as Request;

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to compute damage');
  });

  it('computes percentage damage relative to defender maxHP', async () => {
    mockPokemon.mockReturnValue({ maxHP: () => 200 });
    mockCalculate.mockReturnValue(makeCalcResult({ range: () => [100, 150] }));

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    // 100/200 = 50%, 150/200 = 75%
    expect(json.data.results[0].damage.min_pct).toBe(50);
    expect(json.data.results[0].damage.max_pct).toBe(75);
  });

  it('handles zero maxHP without dividing by zero', async () => {
    mockPokemon.mockReturnValue({ maxHP: () => 0 });

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Shedinja' },
      move: 'Earthquake',
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.data.results[0].damage.min_pct).toBe(0);
    expect(json.data.results[0].damage.max_pct).toBe(0);
  });

  it('handles null ko chance', async () => {
    mockCalculate.mockReturnValue(makeCalcResult({ kochance: () => null }));

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.data.results[0].ko_chance).toBe('N/A');
    expect(json.data.results[0].ko).toBeNull();
  });

  it('flattens damage array into rolls', async () => {
    mockCalculate.mockReturnValue(
      makeCalcResult({ damage: [[50, 51], [52, 53]] })
    );

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.data.results[0].rolls).toEqual([50, 51, 52, 53]);
  });

  it('wraps scalar damage in an array', async () => {
    mockCalculate.mockReturnValue(
      makeCalcResult({ damage: 42 })
    );

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defender: { species: 'Charizard' },
      move: 'Earthquake',
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.data.results[0].rolls).toEqual([42]);
  });
});
