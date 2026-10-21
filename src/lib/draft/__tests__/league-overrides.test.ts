import { describe, expect, it } from 'vitest';
import fixture from './fixtures/example-list.json';
import { epbPack } from '@/lib/format-pack';
import { applyLeagueOverrides, LEAGUE_LINE_OVERRIDES, overrideFor } from '../league-overrides';

// Example pack (src/format-packs/example/epb.ts): one override, the participation line
// dratini--dragonite at 5 / +5; the example fixture's sheet row says 3 / +8.
const entries = fixture.entries;
const overriddenIds = new Set(epbPack.lineOverrides.map((o) => o.line_id));
const overriddenLines = entries.filter((e) => overriddenIds.has(e.line_id));

describe('league overrides (format pack epb.lineOverrides)', () => {
  it('are the pack overrides, thresholds only', () => {
    expect(LEAGUE_LINE_OVERRIDES).toEqual(epbPack.lineOverrides);
    expect(LEAGUE_LINE_OVERRIDES.map((o) => o.line_id)).toEqual(['dratini--dragonite']);
    for (const o of LEAGUE_LINE_OVERRIDES) {
      expect(Object.keys(o).sort()).toEqual([
        'additional_kills_to_stage3',
        'kills_to_stage2',
        'line_id',
        'reason',
        'source',
      ]);
      expect(o.reason.en).toBeTruthy();
      expect(o.reason.de).toBeTruthy();
    }
  });

  it('overrideFor finds the override by line id, null otherwise', () => {
    expect(overrideFor('dratini--dragonite')?.kills_to_stage2).toBe(5);
    expect(overrideFor('pichu--raichu')).toBeNull();
  });

  it('applies 5 / +5 to the overridden line and records the sheet values 3 / 8', () => {
    expect(overriddenLines.map((e) => e.line_id)).toEqual(['dratini--dragonite']);
    for (const e of overriddenLines) {
      const applied = applyLeagueOverrides(e);
      const reason = overrideFor(e.line_id)?.reason;
      expect(applied.kills_to_stage2).toBe(5);
      expect(applied.additional_kills_to_stage3).toBe(5);
      expect(applied.overrides).toEqual([
        { field: 'kills_to_stage2', sheet_value: 3, applied_value: 5, reason },
        { field: 'additional_kills_to_stage3', sheet_value: 8, applied_value: 5, reason },
      ]);
    }
  });

  it('adds no flag: the overridden row keeps its stored flags, unchanged', () => {
    for (const e of overriddenLines) {
      expect(e.special_rules).toEqual({ cosmog: true, no_redraft: true });
      expect(applyLeagueOverrides(e).special_rules).toEqual({ cosmog: true, no_redraft: true });
    }
  });

  it('leaves every other line untouched (overrides: [])', () => {
    for (const e of entries.filter((x) => !overriddenIds.has(x.line_id))) {
      const applied = applyLeagueOverrides(e);
      expect(applied.overrides).toEqual([]);
      expect(applied.kills_to_stage2).toBe(e.kills_to_stage2);
      expect(applied.additional_kills_to_stage3).toBe(e.additional_kills_to_stage3);
    }
  });

  it('lists no field whose sheet value already equals the override', () => {
    const e = { ...overriddenLines[0], kills_to_stage2: 5 };
    expect(applyLeagueOverrides(e).overrides.map((o) => o.field)).toEqual(['additional_kills_to_stage3']);
  });

  it('is idempotent and does not mutate its input', () => {
    const e = overriddenLines[0];
    const once = applyLeagueOverrides(e);
    const twice = applyLeagueOverrides(once);
    expect(twice.kills_to_stage2).toBe(5);
    expect(twice.additional_kills_to_stage3).toBe(5);
    // The record of the first pass (sheet 3 / 8) survives a second pass.
    expect(twice.overrides).toEqual(once.overrides);
    expect(twice.overrides).toHaveLength(2);
    expect(e.kills_to_stage2).toBe(3);
  });
});
