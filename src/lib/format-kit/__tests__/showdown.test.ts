import { describe, expect, it } from 'vitest';
import { FORMAT_SUMMARIES, GENERATIONS } from '@/lib/pkmn/format-catalog';
import { compile as compileServer } from '../compile';
import { compile as compileBrowser } from '../compile.browser';
import { CURRENT_ENV } from '../engine/env';
import { KEY_PATTERN } from '../keys';
import { resolveLText } from '../ltext';
import { PRESETS } from '../presets';
import {
  SHOWDOWN_DEFAULT_FORMAT,
  SHOWDOWN_GENERATIONS,
  SHOWDOWN_PLAYERS_PER_MATCH,
  SHOWDOWN_VGC_BEST_OF,
  applyShowdownFormat,
  filterShowdownGenerations,
  getShowdownFormat,
  isShowdownFormatId,
  listShowdownFormats,
  showdownFormatsOf,
  withShowdownFormat,
} from '../showdown';
import { validateFormatDefinition as validateBrowser } from '../validate.browser';
import { validateFormatDefinition as validateServer } from '../validate';
import type { FormatDefinition, Stage } from '../types';

const preset = (id: string): FormatDefinition => {
  const found = PRESETS.find((p) => p.id === id);
  if (found === undefined) throw new Error(`no preset ${id}`);
  return found.definition;
};
const errors = (def: FormatDefinition) => compileServer(def, CURRENT_ENV).diagnostics.filter((d) => d.severity === 'error');

describe('the Showdown format list', () => {
  it('holds every format of the catalog except the ruleset builder blank template', () => {
    const catalogIds = Object.keys(FORMAT_SUMMARIES).filter((id) => id !== 'blank');
    expect(listShowdownFormats().map((f) => f.id).sort()).toEqual(catalogIds.sort());
    expect(isShowdownFormatId('blank')).toBe(false);
    expect(getShowdownFormat('blank')).toBeUndefined();
  });

  it('uses valid kit keys, the catalog name and the catalog doubles flag', () => {
    for (const format of listShowdownFormats()) {
      expect(format.id, format.id).toMatch(KEY_PATTERN);
      const summary = FORMAT_SUMMARIES[format.id];
      expect(format.name).toBe(summary.name);
      expect(format.doubles).toBe(summary.is_doubles);
      expect(format.gen).toBe(summary.gen);
    }
    expect(getShowdownFormat('gen9doublesou')).toMatchObject({ doubles: true, tierLabel: 'Doubles OU' });
    expect(getShowdownFormat('gen9vgc')).toMatchObject({ doubles: true, tier: 'vgc' });
    expect(getShowdownFormat('gen9ou')).toMatchObject({ doubles: false, name: 'Gen 9 OU', genLabel: 'Gen 9 (SV)' });
  });

  it('groups by generation, newest first, in the catalog tier order', () => {
    expect(SHOWDOWN_GENERATIONS.map((g) => g.gen)).toEqual(GENERATIONS.map((g) => g.num).sort((a, b) => b - a));
    const gen3 = SHOWDOWN_GENERATIONS.find((g) => g.gen === 3);
    expect(gen3?.formats.map((f) => f.tier)).toEqual(GENERATIONS.find((g) => g.num === 3)?.tiers);
    expect(SHOWDOWN_DEFAULT_FORMAT).toBe('gen9ou');
  });

  it('rejects anything that is not a catalog id', () => {
    for (const id of ['', 'GEN9OU', 'gen99xx', 'gen9', undefined, null, 5, {}, '__proto__', 'constructor']) {
      expect(isShowdownFormatId(id), String(id)).toBe(false);
    }
  });
});

describe('filterShowdownGenerations', () => {
  it('keeps everything for a blank query', () => {
    expect(filterShowdownGenerations('')).toBe(SHOWDOWN_GENERATIONS);
    expect(filterShowdownGenerations('   ')).toBe(SHOWDOWN_GENERATIONS);
  });

  it('needs every word, in any case, in the name, tier label or generation label', () => {
    const ids = (query: string) => filterShowdownGenerations(query).flatMap((g) => g.formats.map((f) => f.id));
    // Every word must occur, so "gen 9 ou" finds OU and Doubles OU of generation 9 and nothing else.
    expect(ids('gen 9 ou')).toEqual(['gen9ou', 'gen9doublesou']);
    expect(ids('gen 9 ubers')).toEqual(['gen9ubers']);
    expect(ids('GEN9OU')).toEqual([]);
    expect(ids('doubles ou')).toEqual(expect.arrayContaining(['gen9doublesou', 'gen4doublesou']));
    expect(ids('doubles ou').every((id) => id.endsWith('doublesou'))).toBe(true);
    expect(ids('vgc').every((id) => id.endsWith('vgc'))).toBe(true);
    // The generation label ('Gen 9 (SV)') is searched too.
    expect(ids('sv ubers')).toEqual(['gen9ubers']);
  });

  it('drops a generation without a match and answers an empty list for nonsense', () => {
    const groups = filterShowdownGenerations('vgc');
    expect(groups.map((g) => g.gen)).toEqual([9, 8, 7, 6]);
    expect(filterShowdownGenerations('zzzz')).toEqual([]);
  });
});

describe('withShowdownFormat (one stage)', () => {
  const stage = (): Stage => structuredClone(preset('classic-league').stages[0]);

  it('sets the ruleset, the doubles flag and two players, and leaves the series alone', () => {
    const before = stage();
    const next = withShowdownFormat(before, 'gen9doublesou');
    expect(next.ruleset).toEqual({ kind: 'showdown', format: 'gen9doublesou' });
    expect(next.doubles).toBe(true);
    expect(next.players_per_match).toBe(SHOWDOWN_PLAYERS_PER_MATCH);
    expect(next.series).toBe(before.series);
    expect(before.ruleset).toEqual({ kind: 'season_default' });
  });

  it('also clears the doubles flag when the format is a singles format', () => {
    const doubles = { ...stage(), doubles: true };
    expect(withShowdownFormat(doubles, 'gen9ou').doubles).toBe(false);
  });

  it('returns the very same object when the stage already has the settings, and for an unknown id', () => {
    const picked = withShowdownFormat(stage(), 'gen9vgc');
    expect(withShowdownFormat(picked, 'gen9vgc')).toBe(picked);
    const before = stage();
    expect(withShowdownFormat(before, 'gen99xx')).toBe(before);
  });
});

describe('applyShowdownFormat', () => {
  it.each(PRESETS.map((p) => [p.id, p.definition] as const))('pre-picks every stage of the %s preset', (_id, definition) => {
    const snapshot = structuredClone(definition);
    const result = applyShowdownFormat(definition, 'gen9ou');
    expect(definition).toEqual(snapshot);
    expect(result.stages).toHaveLength(definition.stages.length);
    result.stages.forEach((stage, i) => {
      expect(stage.ruleset).toEqual({ kind: 'showdown', format: 'gen9ou' });
      expect(stage.doubles).toBe(false);
      expect(stage.players_per_match).toBe(2);
      // Not VGC: the structure keeps its series length and its exceptions.
      expect(stage.series).toEqual(definition.stages[i].series);
      // Nothing else of the structure moves.
      expect({ ...stage, ruleset: null, doubles: null, players_per_match: null }).toEqual({
        ...definition.stages[i],
        ruleset: null,
        doubles: null,
        players_per_match: null,
      });
    });
    expect(result.edges).toBe(definition.edges);
    expect(result.rules).toBe(definition.rules);
  });

  it('sets best of 3 on every stage for VGC and keeps the exceptions', () => {
    const base = preset('classic-league');
    const result = applyShowdownFormat(base, 'gen9vgc');
    expect(result.stages.map((s) => s.series.best_of)).toEqual([SHOWDOWN_VGC_BEST_OF, SHOWDOWN_VGC_BEST_OF]);
    expect(result.stages.every((s) => s.doubles)).toBe(true);
    expect(result.stages[1].series.overrides).toEqual(base.stages[1].series.overrides);
    expect(base.stages[0].series.best_of).toBe(1);
  });

  it('keeps the structure series length for every other tier, doubles included', () => {
    const result = applyShowdownFormat(preset('classic-league'), 'gen9doublesou');
    expect(result.stages.map((s) => s.series.best_of)).toEqual([1, 3]);
    expect(result.stages.every((s) => s.doubles)).toBe(true);
  });

  it('keeps the author name by default and appends the format name to it, in every language, when asked to retitle', () => {
    const base = preset('cup');
    expect(applyShowdownFormat(base, 'gen9ou').identity.name).toBe(base.identity.name);
    const retitled = applyShowdownFormat(base, 'gen9ou', { retitle: true });
    expect(resolveLText(retitled.identity.name, { viewer: 'en' })?.value).toBe(`${resolveLText(base.identity.name, { viewer: 'en' })?.value} (Gen 9 OU)`);
    expect(resolveLText(retitled.identity.name, { viewer: 'de' })?.value).toMatch(/ \(Gen 9 OU\)$/);
    expect(retitled.identity.summary).toBe(base.identity.summary);
    expect(base.identity.name.en?.v).not.toContain('Gen 9');
  });

  it('leaves the definition as it is for an id the catalog does not know', () => {
    const base = preset('cup');
    expect(applyShowdownFormat(base, 'gen99xx', { retitle: true })).toBe(base);
  });

  it('gives a document that compiles without an error for every example and every format', () => {
    for (const { id, definition } of PRESETS) {
      for (const format of listShowdownFormats()) {
        const result = applyShowdownFormat(definition, format.id, { retitle: true });
        expect(errors(result).map((d) => d.code), `${id} ${format.id}`).toEqual([]);
      }
    }
  });
});

describe('showdownFormatsOf', () => {
  it('lists the distinct formats in stage order and ignores the other kinds', () => {
    const def = structuredClone(preset('swiss-top-cut'));
    expect(showdownFormatsOf(def)).toEqual([]);
    def.stages[0].ruleset = { kind: 'showdown', format: 'gen9vgc' };
    expect(showdownFormatsOf(def)).toEqual(['gen9vgc']);
    def.stages[1].ruleset = { kind: 'showdown', format: 'gen9ou' };
    expect(showdownFormatsOf(def)).toEqual(['gen9vgc', 'gen9ou']);
    def.stages[1].ruleset = { kind: 'showdown', format: 'gen9vgc' };
    expect(showdownFormatsOf(def)).toEqual(['gen9vgc']);
  });
});

describe('a Showdown ruleset in a document', () => {
  const withRuleset = (ruleset: unknown) => {
    const doc = structuredClone(preset('cup')) as unknown as { stages: { ruleset: unknown }[] };
    doc.stages[0].ruleset = ruleset;
    return doc;
  };

  it('is accepted by both validators and compiles cleanly', () => {
    const doc = withRuleset({ kind: 'showdown', format: 'gen9ou' });
    expect(validateServer(doc).ok).toBe(true);
    expect(validateBrowser(doc).ok).toBe(true);
    expect(compileServer(doc).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(compileBrowser(doc).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it.each([
    ['no format', { kind: 'showdown' }],
    ['a format that is not a key', { kind: 'showdown', format: 'Gen 9 OU' }],
    ['a format that is not text', { kind: 'showdown', format: 9 }],
    ['an unknown member', { kind: 'showdown', format: 'gen9ou', id: 'x' }],
  ])('is refused by both validators with %s', (_name, ruleset) => {
    const doc = withRuleset(ruleset);
    expect(validateServer(doc).ok).toBe(false);
    expect(validateBrowser(doc).ok).toBe(false);
  });

  it('keeps a format the catalog does not know loadable and reports it as an error with a fix', () => {
    const doc = withRuleset({ kind: 'showdown', format: 'gen99xx' });
    expect(validateServer(doc).ok).toBe(true);
    const found = compileServer(doc).diagnostics.find((d) => d.code === 'showdown_format_unknown');
    expect(found).toMatchObject({ severity: 'error', json_pointer: '/stages/0/ruleset/format', params: { stage: 'groups', format: 'gen99xx' } });
    expect(found?.fixes.map((f) => f.id)).toEqual(['use_season_ruleset']);
    expect(compileBrowser(doc).diagnostics.find((d) => d.code === 'showdown_format_unknown')).toEqual(found);
  });
});
