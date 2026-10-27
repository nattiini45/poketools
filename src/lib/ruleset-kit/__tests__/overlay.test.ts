import { describe, expect, it } from 'vitest';
import type { PresetList, PresetRules, TourOverlayRules } from '@/lib/pkmn/preset-rules';
import { computeEffective } from '../effective';
import { applyTourOverlay } from '../overlay';
import type { RulesetDocument } from '../types';
import { compileRuleset } from '../compile';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';

const block = (...ids: string[]): PresetList => ({ mode: 'block', ids });
const allow = (...ids: string[]): PresetList => ({ mode: 'allow', ids });

const PRESET: PresetRules = {
  id: 'gen9natdexdraft',
  name: 'Gen 9 NatDex Draft',
  gen: 9,
  mod: 'gen9',
  universe: 'national',
  doubles: false,
  source: 'smogon-draft',
  clauses: ['speciesclause', 'sleepclause'],
  pokemon: block(),
  moves: block('lastrespects'),
  items: block('quickclaw'),
  abilities: block(),
  facts: {} as PresetRules['facts'],
  combination_bans: [],
  catalog_version: 'test',
};

const OVERLAY: TourOverlayRules = {
  preset: PRESET.id,
  clausesAdd: ['speciesclause', 'batonpassclause'],
  clausesRemove: ['itemclause', 'sleepclause'],
  moves: ['hiddenpower', 'lastrespects', 'shedtail'],
  items: ['kingsrock', 'quickclaw'],
  abilities: ['moody'],
  sources: ['https://example.test/thread'],
  skipped: [],
  unresolved: [],
  catalog_version: 'test',
};

const fresh = (): RulesetDocument => newRulesetDocument('Tour', 'en', PRESET.id);

describe('applyTourOverlay', () => {
  it('adds the extras as ordinary bans and clauses, in sorted order', () => {
    const { document, applied } = applyTourOverlay(fresh(), OVERLAY, PRESET);
    expect(document.clauses).toEqual({ add: ['batonpassclause'], remove: ['sleepclause'] });
    expect(document.moves.ban).toEqual(['hiddenpower', 'shedtail']);
    expect(document.items.ban).toEqual(['kingsrock']);
    expect(document.abilities.ban).toEqual(['moody']);
    expect(document.pokemon.ban).toEqual([]);
    expect(applied).toEqual({
      clausesAdded: ['batonpassclause'],
      clausesRemoved: ['sleepclause'],
      banned: { moves: ['hiddenpower', 'shedtail'], items: ['kingsrock'], abilities: ['moody'] },
    });
  });

  it('leaves out what the preset already has: banned ids, present clauses, removals of clauses it lacks', () => {
    const { document } = applyTourOverlay(fresh(), OVERLAY, PRESET);
    expect(document.moves.ban).not.toContain('lastrespects');
    expect(document.items.ban).not.toContain('quickclaw');
    expect(document.clauses.add).not.toContain('speciesclause');
    expect(document.clauses.remove).not.toContain('itemclause');
  });

  it('the effective rules have every extra, and the compile has no redundancy warning', () => {
    const { document } = applyTourOverlay(fresh(), OVERLAY, PRESET);
    const effective = computeEffective(document, PRESET);
    expect(effective.moves.ids).toEqual(['hiddenpower', 'lastrespects', 'shedtail']);
    expect(effective.items.ids).toEqual(['kingsrock', 'quickclaw']);
    expect(effective.clauses).toEqual(['batonpassclause', 'speciesclause']);
    const result = compileRuleset(document, { preset: PRESET });
    expect(result.diagnostics.map((d) => d.code)).not.toContain('ban_redundant');
  });

  it('does not touch its input and is idempotent', () => {
    const input = fresh();
    const snapshot = structuredClone(input);
    const once = applyTourOverlay(input, OVERLAY, PRESET).document;
    expect(input).toEqual(snapshot);
    const twice = applyTourOverlay(once, OVERLAY, PRESET).document;
    expect(twice).toEqual(once);
  });

  it('skips a category the document switched to an allowlist (bans and an allowlist are exclusive)', () => {
    const doc = fresh();
    doc.items = { ban: [], unban: [], allow: ['leftovers'] };
    const { document, applied } = applyTourOverlay(doc, OVERLAY, PRESET);
    expect(document.items).toEqual({ ban: [], unban: [], allow: ['leftovers'] });
    expect(applied.banned.items).toEqual([]);
    expect(document.moves.ban).toEqual(['hiddenpower', 'shedtail']);
  });

  it('against an allowlist-mode preset list only bans what the roster allows', () => {
    const roster: PresetRules = { ...PRESET, moves: allow('hiddenpower', 'tackle') };
    const { document } = applyTourOverlay(fresh(), OVERLAY, roster);
    expect(document.moves.ban).toEqual(['hiddenpower']);
  });

  it('keeps entries the author already added and does not repeat them', () => {
    const doc = fresh();
    doc.moves.ban = ['shedtail'];
    doc.clauses.add = ['batonpassclause'];
    const { document } = applyTourOverlay(doc, OVERLAY, PRESET);
    expect(document.moves.ban).toEqual(['shedtail', 'hiddenpower']);
    expect(document.clauses.add).toEqual(['batonpassclause']);
  });
});
