import { describe, expect, it } from 'vitest';
// The public suite runs on the example pack (utility keys hazards / hazard_control / recovery / pivot / priority).
import { buildChips } from '../chips';
import { EMPTY_FILTERS, type FinderFilters } from '../filter-types';

const withUtility = (utility: FinderFilters['utility']): FinderFilters => ({ ...EMPTY_FILTERS, utility });

describe('buildChips: utility', () => {
  it('a category without members is one category chip', () => {
    const chips = buildChips(withUtility([{ key: 'recovery', members: [] }]));
    expect(chips).toEqual([{ id: 'utility:recovery', kind: 'utility', labelParts: { kind: 'utility', key: 'recovery' } }]);
  });

  it('a category with members is only its member chips, never the category beside them', () => {
    const chips = buildChips(
      withUtility([{ key: 'hazards', members: ['stealthrock', 'spikes'] }]),
      { moveName: (id) => ({ stealthrock: 'Stealth Rock', spikes: 'Spikes' })[id], abilityName: () => undefined },
    );
    expect(chips.map((c) => c.id)).toEqual(['utility:hazards:stealthrock', 'utility:hazards:spikes']);
    expect(chips.map((c) => c.kind)).toEqual(['utilityMember', 'utilityMember']);
    expect(chips[0].labelParts).toEqual({ kind: 'utilityMember', key: 'hazards', memberKind: 'move', memberId: 'stealthrock', name: 'Stealth Rock' });
  });

  it('keeps the panel order across categories with and without members', () => {
    const chips = buildChips(
      withUtility([
        { key: 'pivot', members: ['uturn'] },
        { key: 'recovery', members: [] },
      ]),
    );
    expect(chips.map((c) => c.id)).toEqual(['utility:pivot:uturn', 'utility:recovery']);
  });

  it('falls back to the id for a member name the index does not know yet', () => {
    const [chip] = buildChips(withUtility([{ key: 'hazards', members: ['spikes'] }]));
    expect(chip.labelParts).toMatchObject({ kind: 'utilityMember', name: 'spikes' });
  });
});
