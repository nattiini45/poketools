import { describe, expect, it } from 'vitest';
import fixture from './fixtures/example-list.json';
import { applyLeagueOverrides } from '../league-overrides';
import { effectiveThresholds } from '../line-catalog-data';

function entry(lineId: string) {
  const found = fixture.entries.find((e) => e.line_id === lineId);
  if (!found) throw new Error(`fixture has no ${lineId}`);
  return found;
}

describe('effectiveThresholds', () => {
  it('gives the overridden line 5 / 10 cumulative (example pack 5 / +5) from the raw sheet row and from an already-overridden entry', () => {
    const raw = entry('dratini--dragonite');
    expect(effectiveThresholds(raw)).toEqual({ line_id: 'dratini--dragonite', stage2_kos: 5, stage3_kos: 10 });
    expect(effectiveThresholds(applyLeagueOverrides(raw))).toEqual({
      line_id: 'dratini--dragonite',
      stage2_kos: 5,
      stage3_kos: 10,
    });
  });

  it('keeps branch-specific thresholds (Ralts 1/11 vs 4/9)', () => {
    expect(effectiveThresholds(entry('ralts--gardevoir'))).toMatchObject({ stage2_kos: 1, stage3_kos: 11 });
    expect(effectiveThresholds(entry('ralts--gallade'))).toMatchObject({ stage2_kos: 4, stage3_kos: 9 });
  });

  it('computes the line id when the entry has none, and handles a two-stage line', () => {
    expect(
      effectiveThresholds({
        base_pokemon: 'Pawniard',
        stage2_pokemon: 'Bisharp',
        stage3_pokemon: null,
        kills_to_stage2: 5,
        additional_kills_to_stage3: null,
      }),
    ).toEqual({ line_id: 'pawniard--bisharp', stage2_kos: 5, stage3_kos: null });
  });
});
