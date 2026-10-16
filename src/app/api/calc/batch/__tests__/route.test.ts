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

describe('POST /api/calc/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPokemon.mockReturnValue({ maxHP: () => 300 });
    mockMove.mockReturnValue({});
    mockField.mockReturnValue({});
    mockCalculate.mockReturnValue(makeCalcResult());
  });

  it('calculates moves against multiple defenders', async () => {
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp', moves: ['Earthquake', 'Dragon Claw'] },
      defenders: [
        { species: 'Charizard' },
        { species: 'Pikachu' },
      ],
      moves: ['Earthquake'],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.results).toHaveLength(2);
    expect(json.data.results[0].defender).toBe('Charizard');
    expect(json.data.results[1].defender).toBe('Pikachu');
    expect(json.data.results[0].move_results).toHaveLength(1);
    // Structured KO info next to the English ko_chance (pkmn-l10n §3.7); the mock has no n/chance.
    expect(json.data.results[0].move_results[0].ko).toEqual({ n: 0, chance: null, conditional: false });
    expect(json.data.results[0].move_results[0].ko_chance).toBe('2HKO');
  });

  it('returns 400 when more than 20 defenders are provided', async () => {
    const defenders = Array.from({ length: 21 }, (_, i) => ({
      species: `Mon${i}`,
    }));

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defenders,
      moves: ['Earthquake'],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Max 20 defenders');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: 'Max 20 defenders per batch' });
  });

  it('accepts exactly 20 defenders', async () => {
    const defenders = Array.from({ length: 20 }, (_, i) => ({
      species: `Mon${i}`,
    }));

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defenders,
      moves: ['Earthquake'],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.results).toHaveLength(20);
  });

  it('falls back to attacker.moves when body.moves is not provided', async () => {
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp', moves: ['Earthquake', 'Dragon Claw'] },
      defenders: [{ species: 'Charizard' }],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.results[0].move_results).toHaveLength(2);
    expect(json.data.results[0].move_results[0].move).toBe('Earthquake');
    expect(json.data.results[0].move_results[1].move).toBe('Dragon Claw');
  });

  it('includes field conditions when provided', async () => {
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defenders: [{ species: 'Charizard' }],
      moves: ['Earthquake'],
      field: { weather: 'Rain', terrain: 'Electric' },
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(mockField).toHaveBeenCalledWith(
      expect.objectContaining({ weather: 'Rain', terrain: 'Electric' })
    );
  });

  it('returns 500 when request body is invalid', async () => {
    const req = { json: vi.fn().mockRejectedValue(new Error('Bad JSON')) } as unknown as Request;

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
  });

  it('handles per-move calculation errors gracefully', async () => {
    mockCalculate.mockImplementation(() => {
      throw new Error('Unknown move');
    });

    const body = {
      generation: 9,
      attacker: { species: 'Garchomp' },
      defenders: [{ species: 'Charizard' }],
      moves: ['FakeMove'],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.results[0].move_results[0].damage.min).toBe(0);
    expect(json.data.results[0].move_results[0].ko).toBeNull();
    expect(json.data.results[0].move_results[0].description).toContain('Could not calculate');
  });

  it('filters empty move strings from attacker.moves fallback', async () => {
    const body = {
      generation: 9,
      attacker: { species: 'Garchomp', moves: ['Earthquake', '', 'Dragon Claw', ''] },
      defenders: [{ species: 'Charizard' }],
    };

    const res = await POST(makeRequest(body));
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.results[0].move_results).toHaveLength(2);
  });
});
