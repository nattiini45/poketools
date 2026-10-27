/**
 * The point-buy battle ruleset (FA-4): built from the active format pack (the example pack in
 * the public test project), non-custom, and ensured once (an existing usable ruleset is reused;
 * clearing its bans publishes a new version).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ruleset } from '@/types/ruleset';

vi.mock('@/lib/supabase/queries/rulesets', () => ({ findHeadRulesetsByName: vi.fn() }));
vi.mock('@/lib/ruleset-studio/legacy-bridge', () => ({ createLegacyRuleset: vi.fn(), updateLegacyRuleset: vi.fn() }));

import { findHeadRulesetsByName } from '@/lib/supabase/queries/rulesets';
import { createLegacyRuleset, updateLegacyRuleset } from '@/lib/ruleset-studio/legacy-bridge';
import { formatPack } from '@/lib/format-pack';
import { ensurePointBuyBattleRuleset, pointBuyBattleRulesetInput } from '../point-buy-battle-ruleset';
import { makeRuleset as buildRuleset } from '@/test/ruleset-fixtures';

function row(overrides: Partial<Ruleset> = {}): Ruleset {
  return buildRuleset({
    id: 'rs-1',
    name: 'Evolution Point Buy',
    base_format: 'gen9',
    is_doubles: false,
    clauses: ['Item Clause'],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    created_by: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  });
}

describe('pointBuyBattleRulesetInput', () => {
  it('derives a Gen 9 singles, non-custom ruleset from the active pack', () => {
    const input = pointBuyBattleRulesetInput();

    expect(input.name).toBe(formatPack.messages.en.leagueAdmin.form.battleRulesetName);
    expect(input.base_format).toBe('gen9');
    expect(input.is_doubles).toBe(false);
    expect(input.clauses).toEqual(['Item Clause']);
    // Bans come from the season's format_rules only; the shared row carries none.
    expect(input.banned_pokemon).toEqual([]);
    expect(input.banned_moves).toEqual([]);
    expect(input.banned_items).toEqual([]);
    expect(input.banned_abilities).toEqual([]);
    expect(input.added_pokemon).toEqual([]);
    expect(input.custom_rules_string).toBe('');
    expect(input.team_constraints).toBeNull();
  });

  it('stays non-custom: no team constraints, custom rules or added Pokémon', () => {
    const input = pointBuyBattleRulesetInput();
    expect(input.team_constraints).toBeNull();
    expect(input.custom_rules_string.trim()).toBe('');
    expect(input.added_pokemon).toEqual([]);
  });
});

describe('ensurePointBuyBattleRuleset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the ruleset once when none exists', async () => {
    vi.mocked(findHeadRulesetsByName).mockResolvedValue([]);
    vi.mocked(createLegacyRuleset).mockResolvedValue(row({ id: 'new' }));

    const result = await ensurePointBuyBattleRuleset('admin-1');

    expect(result).toEqual({ ruleset: row({ id: 'new' }), created: true, bansCleared: false });
    expect(findHeadRulesetsByName).toHaveBeenCalledWith(pointBuyBattleRulesetInput().name);
    expect(createLegacyRuleset).toHaveBeenCalledTimes(1);
    expect(createLegacyRuleset).toHaveBeenCalledWith('admin-1', pointBuyBattleRulesetInput());
  });

  it('reuses the oldest usable ruleset instead of creating another (idempotent)', async () => {
    vi.mocked(findHeadRulesetsByName).mockResolvedValue([row({ id: 'old' }), row({ id: 'newer' })]);

    const result = await ensurePointBuyBattleRuleset('admin-1');

    expect(result).toEqual({ ruleset: row({ id: 'old' }), created: false, bansCleared: false });
    expect(createLegacyRuleset).not.toHaveBeenCalled();
    expect(updateLegacyRuleset).not.toHaveBeenCalled();
  });

  it('clears bans on a reused ruleset (a new version) so they cannot outlive a format_rules edit', async () => {
    const banned = row({
      id: 'old',
      bans: { pokemon: [], moves: ['Last Respects'], items: ['Bright Powder'], abilities: [] },
    });
    vi.mocked(findHeadRulesetsByName).mockResolvedValue([banned]);
    vi.mocked(updateLegacyRuleset).mockResolvedValue(row({ id: 'old' }));

    const result = await ensurePointBuyBattleRuleset('admin-1');

    expect(updateLegacyRuleset).toHaveBeenCalledTimes(1);
    expect(updateLegacyRuleset).toHaveBeenCalledWith('admin-1', 'old', {
      banned_pokemon: [],
      banned_moves: [],
      banned_items: [],
      banned_abilities: [],
    });
    expect(result).toEqual({ ruleset: row({ id: 'old' }), created: false, bansCleared: true });
    expect(createLegacyRuleset).not.toHaveBeenCalled();
  });

  it('propagates a failed ban clear', async () => {
    vi.mocked(findHeadRulesetsByName).mockResolvedValue([
      row({ id: 'old', bans: { pokemon: ['Koraidon'], moves: [], items: [], abilities: [] } }),
    ]);
    vi.mocked(updateLegacyRuleset).mockRejectedValue(new Error('update failed'));

    await expect(ensurePointBuyBattleRuleset('admin-1')).rejects.toThrow('update failed');
  });

  it('skips same-named rulesets that are doubles, another format, or custom', async () => {
    vi.mocked(findHeadRulesetsByName).mockResolvedValue([
      row({ id: 'doubles', is_doubles: true }),
      row({ id: 'tier', base_format: 'gen9ru' }),
      row({ id: 'custom', custom_rules_string: 'Species Clause' }),
    ]);
    vi.mocked(createLegacyRuleset).mockResolvedValue(row({ id: 'new' }));

    const result = await ensurePointBuyBattleRuleset(null);

    expect(result.created).toBe(true);
    expect(result.ruleset.id).toBe('new');
  });

  it('propagates a failed read without creating', async () => {
    vi.mocked(findHeadRulesetsByName).mockRejectedValue(new Error('read failed'));

    await expect(ensurePointBuyBattleRuleset('admin-1')).rejects.toThrow('read failed');
    expect(createLegacyRuleset).not.toHaveBeenCalled();
  });
});
