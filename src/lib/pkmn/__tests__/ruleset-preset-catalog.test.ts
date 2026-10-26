/** The rule preset catalog view: listing, lookup, search and grouping. */
import { describe, expect, it } from 'vitest';
import { FORMAT_SUMMARIES, GENERATIONS, PRESETS as CATALOG } from '../format-catalog';
import { KEY_PATTERN } from '@/lib/studio-core/keys';
import {
  DEFAULT_RULESET_PRESET,
  filterRulesetPresets,
  getRulesetPreset,
  groupRulesetPresets,
  isRulesetPresetId,
  listRulesetPresets,
} from '../ruleset-preset-catalog';

const idsOf = (query: string) => filterRulesetPresets(query).map((entry) => entry.id);

describe('the rule preset list', () => {
  it('holds every preset of the catalog, the Smogon drafts included, and not the ruleset builder blank template', () => {
    const catalogIds = Object.keys(FORMAT_SUMMARIES).filter((id) => id !== 'blank');
    expect(listRulesetPresets().map((entry) => entry.id).sort()).toEqual(catalogIds.sort());
    expect(listRulesetPresets().map((entry) => entry.id).sort()).toEqual(CATALOG.map((preset) => preset.id).sort());
    expect(isRulesetPresetId('blank')).toBe(false);
    expect(getRulesetPreset('blank')).toBeUndefined();
    expect(isRulesetPresetId('gen9natdexdraft')).toBe(true);
  });

  it('uses valid kit keys, the catalog name, the catalog doubles flag and the catalog source', () => {
    for (const entry of listRulesetPresets()) {
      expect(entry.id, entry.id).toMatch(KEY_PATTERN);
      const summary = FORMAT_SUMMARIES[entry.id];
      expect(entry.name).toBe(summary.name);
      expect(entry.doubles).toBe(summary.is_doubles);
      expect(entry.gen).toBe(summary.gen);
    }
    expect(getRulesetPreset('gen9doublesou')).toMatchObject({ doubles: true, tierLabel: 'Doubles OU', source: 'showdown' });
    expect(getRulesetPreset('gen9vgc')).toMatchObject({ doubles: true, tier: 'vgc' });
    expect(getRulesetPreset('gen9ou')).toMatchObject({ doubles: false, name: 'Gen 9 OU', genLabel: 'Gen 9 (SV)' });
    expect(getRulesetPreset('gen96v6doublesdraft')).toBeUndefined();
    expect(getRulesetPreset('gen9doublesdraft')).toMatchObject({ doubles: true, source: 'smogon-draft', name: 'Gen 9 6v6 Doubles Draft' });
  });

  it('lists the Showdown formats first, then the Smogon drafts, newest generation first in each', () => {
    const entries = listRulesetPresets();
    const firstDraft = entries.findIndex((entry) => entry.source === 'smogon-draft');
    expect(firstDraft).toBeGreaterThan(0);
    expect(entries.slice(0, firstDraft).every((entry) => entry.source === 'showdown')).toBe(true);
    expect(entries.slice(firstDraft).every((entry) => entry.source === 'smogon-draft')).toBe(true);
    const showdownGens = entries.slice(0, firstDraft).map((entry) => entry.gen);
    expect(showdownGens).toEqual([...showdownGens].sort((a, b) => b - a));
    const draftGens = entries.slice(firstDraft).map((entry) => entry.gen);
    expect(draftGens).toEqual([...draftGens].sort((a, b) => b - a));
    expect(DEFAULT_RULESET_PRESET).toBe('gen9ou');
    expect(entries[0].id).toBe(DEFAULT_RULESET_PRESET);
  });

  it('keeps the catalog tier order inside a generation of the Showdown ladder', () => {
    const gen3 = listRulesetPresets().filter((entry) => entry.source === 'showdown' && entry.gen === 3);
    expect(gen3.map((entry) => entry.tier)).toEqual(GENERATIONS.find((g) => g.num === 3)?.tiers.filter((tier) => gen3.some((entry) => entry.tier === tier)));
  });

  it('rejects anything that is not a catalog id', () => {
    for (const id of ['', 'GEN9OU', 'gen99xx', 'gen9', undefined, null, 5, {}, '__proto__', 'constructor']) {
      expect(isRulesetPresetId(id), String(id)).toBe(false);
    }
  });
});

describe('filterRulesetPresets', () => {
  it('keeps everything for a blank query', () => {
    expect(filterRulesetPresets('')).toBe(listRulesetPresets());
    expect(filterRulesetPresets('   ')).toBe(listRulesetPresets());
  });

  it('needs every word, in any case, to start a word of the name, id, tier, generation, family or source', () => {
    // "ou" starts the word OU, not the word "doubles" or "monotype".
    expect(idsOf('gen 9 ou')).toEqual(['gen9ou', 'gen9doublesou']);
    expect(idsOf('gen 9 ubers')).toEqual(['gen9ubers', 'gen9doublesubers', 'gen9nationaldexubers', 'gen9nationaldexdoublesubers']);
    expect(idsOf('GEN9OU')).toEqual(['gen9ou']);
    expect(idsOf('doubles ou')).toEqual(expect.arrayContaining(['gen9doublesou', 'gen4doublesou']));
    expect(idsOf('doubles ou').every((id) => id.endsWith('doublesou'))).toBe(true);
    expect(idsOf('vgc').every((id) => id.endsWith('vgc'))).toBe(true);
    // The generation label ('Gen 9 (SV)') is searched too.
    expect(idsOf('sv ubers')).toEqual(['gen9ubers', 'gen9doublesubers', 'gen9nationaldexubers', 'gen9nationaldexdoublesubers']);
  });

  it('finds the drafts by their name, family or source words', () => {
    expect(idsOf('draft').every((id) => id.includes('draft'))).toBe(true);
    expect(idsOf('draft')).toHaveLength(17);
    expect(idsOf('smogon')).toHaveLength(17);
    expect(idsOf('natdex draft')).toEqual(expect.arrayContaining(['gen9natdexdraft', 'gen8natdexdraft', 'gen9natdexlcdraft']));
    expect(idsOf('champions')).toEqual(['gen9championsdraft', 'gen9championsnatdexdraft', 'gen9champions4doublesdraft']);
    expect(idsOf('6v6')).toEqual(expect.arrayContaining(['gen9doublesdraft']));
    expect(idsOf('showdown').some((id) => id.includes('draft'))).toBe(false);
  });

  it('answers an empty list for nonsense', () => {
    expect(filterRulesetPresets('zzzz')).toEqual([]);
  });
});

describe('groupRulesetPresets', () => {
  it('groups by source, generation (newest first) and family, in the order of the entries', () => {
    const groups = groupRulesetPresets(listRulesetPresets());
    const keys = groups.map((group) => group.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('showdown:9:singles');
    expect(groups.flatMap((group) => group.presets.map((preset) => preset.id))).toEqual(listRulesetPresets().map((entry) => entry.id));
    for (const group of groups) {
      expect(group.presets.every((p) => p.source === group.source && p.gen === group.gen && p.family === group.family)).toBe(true);
    }
    expect(groups.some((group) => group.key === 'smogon-draft:9:draft-champions')).toBe(true);
  });

  it('drops the groups a search leaves empty', () => {
    const groups = groupRulesetPresets(filterRulesetPresets('vgc'));
    expect(groups.map((group) => group.gen)).toEqual([9, 8, 7, 6]);
    expect(groupRulesetPresets(filterRulesetPresets('zzzz'))).toEqual([]);
  });
});
