import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RulesetFormData } from '@/types/ruleset';

// ── Supabase mock builder (same shape as rulesets-resolver.test.ts) ──
const mockBuilder = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['from', 'select', 'insert', 'update', 'eq', 'order', 'limit'];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  return mb;
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import { createRuleset, updateRuleset } from '../rulesets';

const ROW = {
  id: 'rs-1',
  name: 'Spring OU',
  base_format: 'gen9ou',
  is_doubles: false,
  clauses: [],
  banned_pokemon: [],
  banned_moves: [],
  banned_items: [],
  banned_abilities: [],
  added_pokemon: [],
  custom_rules_string: '',
  min_shared_type_pct: 0,
  team_constraints: null,
  created_by: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

function form(overrides: Partial<RulesetFormData> = {}): RulesetFormData {
  return {
    name: 'Spring OU',
    base_format: 'gen9ou',
    is_doubles: false,
    clauses: [],
    banned_pokemon: [],
    banned_moves: [],
    banned_items: [],
    banned_abilities: [],
    added_pokemon: [],
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    ...overrides,
  };
}

function insertedRow(): Record<string, unknown> {
  return vi.mocked(mockBuilder.insert).mock.calls[0][0] as Record<string, unknown>;
}

function updatedRow(): Record<string, unknown> {
  return vi.mocked(mockBuilder.update).mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mockBuilder.single).mockResolvedValue({ data: ROW, error: null });
});

describe('createRuleset team_constraints', () => {
  it('stores null for an empty object', async () => {
    await createRuleset(form({ team_constraints: {} }), null);
    expect(insertedRow().team_constraints).toBeNull();
  });

  it('stores null for an all-undefined object and for undefined', async () => {
    await createRuleset(form({ team_constraints: { tera_match: undefined } }), null);
    expect(insertedRow().team_constraints).toBeNull();

    vi.mocked(mockBuilder.insert).mockClear();
    await createRuleset({ ...form(), team_constraints: undefined } as unknown as RulesetFormData, null);
    expect(insertedRow().team_constraints).toBeNull();
  });

  it('passes real constraints through', async () => {
    await createRuleset(form({ team_constraints: { tera_match: 'player_core' } }), 'player-1');
    const row = insertedRow();
    expect(row.team_constraints).toEqual({ tera_match: 'player_core' });
    expect(row.created_by).toBe('player-1');
  });
});

describe('updateRuleset team_constraints', () => {
  it('leaves a stored empty object untouched (no normalisation)', async () => {
    await updateRuleset('rs-1', { team_constraints: {} });
    expect(updatedRow()).toEqual({ team_constraints: {} });
  });

  it('writes null when the constraints are switched off', async () => {
    await updateRuleset('rs-1', { team_constraints: null });
    expect(updatedRow()).toEqual({ team_constraints: null });
  });

  it('omits the key when undefined', async () => {
    await updateRuleset('rs-1', { name: 'Renamed' });
    const row = updatedRow();
    expect(row).toEqual({ name: 'Renamed' });
    expect(row).not.toHaveProperty('team_constraints');
  });
});
