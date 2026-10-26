import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ createRuleset: vi.fn(), deleteRuleset: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getExistingRulesetIds: vi.fn() }));

import { listShowdownFormats } from '@/lib/format-kit/showdown';
import { getFormatDefaults } from '@/lib/pkmn/formats';
import { createRuleset, deleteRuleset } from '@/lib/supabase/queries/rulesets';
import { getExistingRulesetIds } from '@/lib/supabase/queries/season-formats';
import { discardRulesets, ensureShowdownRulesets, showdownRulesetForm, showdownRulesetName } from '../showdown-rulesets';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const RECORDED_OU = '00000000-0000-4000-8000-0000000000a1';

let created = 0;
beforeEach(() => {
  vi.resetAllMocks();
  created = 0;
  vi.mocked(getExistingRulesetIds).mockResolvedValue(new Set());
  vi.mocked(createRuleset).mockImplementation(async (input) => ({ id: `00000000-0000-4000-8000-00000000010${created++}`, name: input.name }) as Awaited<ReturnType<typeof createRuleset>>);
  vi.mocked(deleteRuleset).mockResolvedValue(undefined);
});

describe('showdownRulesetName', () => {
  it('puts the league first and cuts to the ruleset name limit', () => {
    expect(showdownRulesetName(' Spring League ', 'Gen 9 OU')).toBe('Spring League · Gen 9 OU');
    expect(showdownRulesetName('x'.repeat(300), 'Gen 9 OU')).toHaveLength(100);
  });
});

describe('showdownRulesetForm', () => {
  it('is the ruleset builder pre-fill: the format defaults on an empty form', () => {
    for (const id of ['gen9ou', 'gen9vgc', 'gen9doublesou', 'gen4ubers', 'gen9lc']) {
      const defaults = getFormatDefaults(id);
      expect(showdownRulesetForm(id, 'League').name, id).toBe('League');
      expect(showdownRulesetForm(id, 'League'), id).toEqual({
        name: 'League',
        base_format: id,
        is_doubles: defaults.is_doubles,
        clauses: defaults.clauses,
        banned_pokemon: defaults.banned_pokemon,
        banned_moves: defaults.banned_moves,
        banned_items: defaults.banned_items,
        banned_abilities: [],
        added_pokemon: [],
        custom_rules_string: '',
        min_shared_type_pct: 0,
        team_constraints: null,
      });
    }
  });

  it('copies the lists, so editing the new ruleset never edits the cached defaults', () => {
    const form = showdownRulesetForm('gen9ou', 'League');
    expect(form.clauses).not.toBe(getFormatDefaults('gen9ou').clauses);
    expect(form.banned_pokemon).not.toBe(getFormatDefaults('gen9ou').banned_pokemon);
  });

  it('builds a form for every Showdown format the catalog has', () => {
    for (const format of listShowdownFormats()) {
      const form = showdownRulesetForm(format.id, 'League');
      expect(form.base_format).toBe(format.id);
      expect(form.is_doubles).toBe(format.doubles);
    }
  });
});

describe('ensureShowdownRulesets', () => {
  const input = (over: Partial<Parameters<typeof ensureShowdownRulesets>[0]> = {}) => ({
    formats: ['gen9ou', 'gen9vgc'],
    leagueName: 'Spring League',
    actorId: ACTOR,
    recorded: {},
    ...over,
  });

  it('creates one ruleset per format, named after the league and the format, for the acting admin', async () => {
    const result = await ensureShowdownRulesets(input());
    expect(vi.mocked(createRuleset).mock.calls.map(([form, by]) => [form.name, form.base_format, by])).toEqual([
      ['Spring League · Gen 9 OU', 'gen9ou', ACTOR],
      ['Spring League · Gen 9 VGC', 'gen9vgc', ACTOR],
    ]);
    expect([...result.rulesetIds.entries()]).toEqual([
      ['gen9ou', '00000000-0000-4000-8000-000000000100'],
      ['gen9vgc', '00000000-0000-4000-8000-000000000101'],
    ]);
    expect(result.created).toEqual([...result.rulesetIds.values()]);
  });

  it('reuses a recorded ruleset that still exists and creates the rest', async () => {
    vi.mocked(getExistingRulesetIds).mockResolvedValue(new Set([RECORDED_OU]));
    const result = await ensureShowdownRulesets(input({ recorded: { gen9ou: RECORDED_OU } }));
    expect(getExistingRulesetIds).toHaveBeenCalledWith([RECORDED_OU]);
    expect(vi.mocked(createRuleset).mock.calls.map(([form]) => form.base_format)).toEqual(['gen9vgc']);
    expect(result.rulesetIds.get('gen9ou')).toBe(RECORDED_OU);
    expect(result.created).toHaveLength(1);
  });

  it('creates a new ruleset when the recorded one was deleted by hand', async () => {
    const result = await ensureShowdownRulesets(input({ formats: ['gen9ou'], recorded: { gen9ou: RECORDED_OU } }));
    expect(createRuleset).toHaveBeenCalledTimes(1);
    expect(result.rulesetIds.get('gen9ou')).not.toBe(RECORDED_OU);
  });

  it('makes no request at all for a spec without a Showdown stage', async () => {
    const result = await ensureShowdownRulesets(input({ formats: [] }));
    expect(result.rulesetIds.size).toBe(0);
    expect(result.created).toEqual([]);
    expect(getExistingRulesetIds).not.toHaveBeenCalled();
    expect(createRuleset).not.toHaveBeenCalled();
  });

  it('discards the rows it already created when a later one fails, then rethrows', async () => {
    const boom = new Error('insert failed');
    vi.mocked(createRuleset)
      .mockImplementationOnce(async (form) => ({ id: RECORDED_OU, name: form.name }) as Awaited<ReturnType<typeof createRuleset>>)
      .mockRejectedValueOnce(boom);
    await expect(ensureShowdownRulesets(input())).rejects.toBe(boom);
    expect(deleteRuleset).toHaveBeenCalledTimes(1);
    expect(deleteRuleset).toHaveBeenCalledWith(RECORDED_OU);
  });

  it('refuses a format the catalog does not know before it creates anything', async () => {
    await expect(ensureShowdownRulesets(input({ formats: ['gen99xx'] }))).rejects.toThrow(/unknown Showdown format/);
    expect(createRuleset).not.toHaveBeenCalled();
  });
});

describe('discardRulesets', () => {
  it('tries every id and never throws, so the original error stays the one the caller sees', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(deleteRuleset).mockRejectedValueOnce(new Error('gone')).mockResolvedValueOnce(undefined);
    await expect(discardRulesets(['a', 'b'])).resolves.toBeUndefined();
    expect(deleteRuleset).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
