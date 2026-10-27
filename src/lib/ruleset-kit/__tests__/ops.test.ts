import { describe, expect, it } from 'vitest';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { compileRuleset } from '../compile';
import { categoryCounts, documentCounts, listChanges } from '../changes';
import { computeEffective, diffResolved } from '../effective';
import { entryState, isLegalState, presetRulesOut, unbanIsRedundant } from '../entry-state';
import { MAX_IDS_PER_LIST } from '../limits';
import {
  allowEntries,
  banEntries,
  blankBaseOf,
  rebase,
  resetCategory,
  resetEntries,
  setClause,
  setLegal,
  setMode,
  toggleEntries,
} from '../ops';
import { RULESET_CATEGORIES, type RulesetCategory, type RulesetDocument } from '../types';

const PRESET: PresetRules = {
  id: 'gen9ou',
  name: 'Gen 9 OU',
  gen: 9,
  mod: 'gen9',
  universe: 'standard',
  doubles: false,
  source: 'showdown',
  clauses: ['speciesclause', 'sleepclausemod'],
  pokemon: { mode: 'block', ids: ['koraidon', 'miraidon'] },
  moves: { mode: 'block', ids: ['lastrespects'] },
  items: { mode: 'block', ids: [] },
  abilities: { mode: 'block', ids: ['moody'] },
  facts: {} as PresetRules['facts'],
  combination_bans: [],
  catalog_version: 'test',
};

const ROSTER: PresetRules = { ...PRESET, id: 'gen9championsdraft', mod: 'champions', pokemon: { mode: 'allow', ids: ['charizard', 'garchomp', 'pikachu'] } };

const doc = (preset = 'gen9ou'): RulesetDocument => newRulesetDocument('Test', 'en', preset);
const blank = (): RulesetDocument => newRulesetDocument('Test', 'en');

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('entryState', () => {
  it('names the state of an entry under a block-list preset', () => {
    const rules = { ban: ['garchomp'], unban: ['koraidon'], allow: null };
    expect(entryState(rules, PRESET.pokemon, 'miraidon')).toBe('preset_banned');
    expect(entryState(rules, PRESET.pokemon, 'koraidon')).toBe('you_unbanned');
    expect(entryState(rules, PRESET.pokemon, 'garchomp')).toBe('you_banned');
    expect(entryState(rules, PRESET.pokemon, 'pikachu')).toBe('legal');
  });

  it('a roster preset rules out everything that is not on its list', () => {
    expect(presetRulesOut(ROSTER.pokemon, 'mewtwo')).toBe(true);
    expect(presetRulesOut(ROSTER.pokemon, 'pikachu')).toBe(false);
    expect(entryState({ ban: ['pikachu'], unban: ['mewtwo'], allow: null }, ROSTER.pokemon, 'pikachu')).toBe('you_banned');
    expect(entryState({ ban: ['pikachu'], unban: ['mewtwo'], allow: null }, ROSTER.pokemon, 'mewtwo')).toBe('you_unbanned');
  });

  it('a redundant unban (the preset does not rule the id out) shows the preset answer, not a change of the document', () => {
    expect(entryState({ ban: [], unban: ['pikachu'], allow: null }, PRESET.pokemon, 'pikachu')).toBe('legal');
    expect(entryState({ ban: [], unban: ['pikachu'], allow: null }, ROSTER.pokemon, 'pikachu')).toBe('legal');
    expect(unbanIsRedundant(PRESET.pokemon, 'pikachu')).toBe(true);
    expect(unbanIsRedundant(PRESET.pokemon, 'koraidon')).toBe(false);
    expect(unbanIsRedundant(ROSTER.pokemon, 'mewtwo')).toBe(false);
    expect(unbanIsRedundant(null, 'pikachu')).toBe(false);
    expect(entryState({ ban: [], unban: ['pikachu'], allow: null }, null, 'pikachu')).toBe('you_unbanned');
  });

  it('allowlist mode only knows allowed and not allowed', () => {
    const rules = { ban: [], unban: [], allow: ['pikachu'] };
    expect(entryState(rules, PRESET.pokemon, 'pikachu')).toBe('allowed');
    expect(entryState(rules, PRESET.pokemon, 'koraidon')).toBe('not_allowed');
    expect(isLegalState('allowed')).toBe(true);
    expect(isLegalState('not_allowed')).toBe(false);
  });
});

describe('ban, unban and reset', () => {
  it('bans an entry the preset leaves legal, and lists the change', () => {
    const result = banEntries(doc(), 'pokemon', ['garchomp'], PRESET.pokemon);
    expect(result.doc.pokemon).toEqual({ ban: ['garchomp'], unban: [], allow: null });
    expect(result.changes).toEqual([{ category: 'pokemon', id: 'garchomp', from: 'legal', to: 'you_banned' }]);
  });

  it('unbanning a preset ban lists it in unban; banning it again drops the unban instead of adding a redundant ban', () => {
    const unbanned = allowEntries(doc(), 'pokemon', ['koraidon'], PRESET.pokemon);
    expect(unbanned.doc.pokemon.unban).toEqual(['koraidon']);
    expect(unbanned.changes[0]).toMatchObject({ from: 'preset_banned', to: 'you_unbanned' });
    const back = banEntries(unbanned.doc, 'pokemon', ['koraidon'], PRESET.pokemon);
    expect(back.doc.pokemon).toEqual({ ban: [], unban: [], allow: null });
    expect(back.changes[0]).toMatchObject({ from: 'you_unbanned', to: 'preset_banned' });
  });

  it('asking for the state an entry already has changes nothing and returns the same document', () => {
    const d = doc();
    expect(banEntries(d, 'pokemon', ['koraidon'], PRESET.pokemon).doc).toBe(d);
    expect(allowEntries(d, 'pokemon', ['pikachu'], PRESET.pokemon).doc).toBe(d);
    expect(banEntries(d, 'pokemon', [], PRESET.pokemon)).toEqual({ doc: d, changes: [], capped: false });
  });

  it('works against a roster preset: banning a roster member lists it, allowing an outsider unbans it', () => {
    const banned = banEntries(doc('gen9championsdraft'), 'pokemon', ['pikachu'], ROSTER.pokemon);
    expect(banned.doc.pokemon.ban).toEqual(['pikachu']);
    const added = allowEntries(banned.doc, 'pokemon', ['mewtwo'], ROSTER.pokemon);
    expect(added.doc.pokemon).toEqual({ ban: ['pikachu'], unban: ['mewtwo'], allow: null });
    expect(computeEffective(added.doc, ROSTER).pokemon).toEqual({ mode: 'allow', ids: ['charizard', 'garchomp', 'mewtwo'] });
  });

  it('on a blank base a ban is a plain ban', () => {
    const banned = banEntries(blank(), 'moves', ['spore'], null);
    expect(banned.doc.moves.ban).toEqual(['spore']);
    expect(allowEntries(banned.doc, 'moves', ['spore'], null).doc.moves).toEqual({ ban: [], unban: [], allow: null });
  });

  it('toggle decides a mixed selection by its first entry', () => {
    const d = banEntries(doc(), 'pokemon', ['garchomp'], PRESET.pokemon).doc;
    // garchomp is banned, so the toggle makes both legal.
    const toggled = toggleEntries(d, 'pokemon', ['garchomp', 'pikachu'], PRESET.pokemon);
    expect(toggled.doc.pokemon).toEqual({ ban: [], unban: [], allow: null });
    // pikachu is legal first, so the toggle bans both.
    const other = toggleEntries(d, 'pokemon', ['pikachu', 'garchomp'], PRESET.pokemon);
    expect(other.doc.pokemon.ban).toEqual(['garchomp', 'pikachu']);
  });

  it('reset drops only the author changes of the given entries', () => {
    let d = banEntries(doc(), 'pokemon', ['garchomp', 'pikachu'], PRESET.pokemon).doc;
    d = allowEntries(d, 'pokemon', ['koraidon'], PRESET.pokemon).doc;
    const reset = resetEntries(d, 'pokemon', ['garchomp', 'koraidon'], PRESET.pokemon);
    expect(reset.doc.pokemon).toEqual({ ban: ['pikachu'], unban: [], allow: null });
    expect(reset.changes.map((c) => c.id).sort()).toEqual(['garchomp', 'koraidon']);
    expect(resetCategory(d, 'pokemon', PRESET.pokemon).doc.pokemon).toEqual({ ban: [], unban: [], allow: null });
    expect(resetEntries(d, 'pokemon', ['bulbasaur'], PRESET.pokemon).doc).toBe(d);
  });

  it('ignores ids that cannot be stored', () => {
    const d = doc();
    expect(banEntries(d, 'pokemon', ['', 'Not An Id', 'x'.repeat(65)], PRESET.pokemon).doc).toBe(d);
  });

  it('stops at the list limit and says so', () => {
    const ids = Array.from({ length: MAX_IDS_PER_LIST + 5 }, (_, i) => `mon${i}`);
    const result = banEntries(blank(), 'pokemon', ids, null);
    expect(result.doc.pokemon.ban).toHaveLength(MAX_IDS_PER_LIST);
    expect(result.capped).toBe(true);
    expect(result.changes).toHaveLength(MAX_IDS_PER_LIST);
  });
});

describe('allowlist mode', () => {
  it('switching to an allowlist empties ban and unban and starts from the seed', () => {
    const d = banEntries(doc(), 'pokemon', ['garchomp'], PRESET.pokemon).doc;
    const allow = setMode(d, 'pokemon', 'allow', ['pikachu', 'charizard', 'pikachu']);
    expect(allow.pokemon).toEqual({ ban: [], unban: [], allow: ['charizard', 'pikachu'] });
    expect(setMode(allow, 'pokemon', 'allow', ['x'])).toBe(allow);
    const back = setMode(allow, 'pokemon', 'block');
    expect(back.pokemon).toEqual({ ban: [], unban: [], allow: null });
    expect(setMode(back, 'pokemon', 'block')).toBe(back);
  });

  it('allowing and banning edit the allowlist itself', () => {
    const d = setMode(doc(), 'items', 'allow');
    const added = allowEntries(d, 'items', ['leftovers', 'choiceband'], null);
    expect(added.doc.items.allow).toEqual(['choiceband', 'leftovers']);
    expect(added.changes[0]).toMatchObject({ from: 'not_allowed', to: 'allowed' });
    const removed = banEntries(added.doc, 'items', ['leftovers'], null);
    expect(removed.doc.items.allow).toEqual(['choiceband']);
    expect(resetEntries(removed.doc, 'items', ['choiceband'], null).doc).toBe(removed.doc);
  });
});

describe('clauses', () => {
  it('switches a clause relative to the preset', () => {
    const off = setClause(doc(), 'sleepclausemod', false, PRESET.clauses);
    expect(off.clauses).toEqual({ add: [], remove: ['sleepclausemod'] });
    expect(setClause(off, 'sleepclausemod', true, PRESET.clauses).clauses).toEqual({ add: [], remove: [] });
    const on = setClause(doc(), 'ohkoclause', true, PRESET.clauses);
    expect(on.clauses).toEqual({ add: ['ohkoclause'], remove: [] });
    expect(setClause(on, 'ohkoclause', false, PRESET.clauses).clauses).toEqual({ add: [], remove: [] });
  });

  it('switching to the state a clause already has returns the same document', () => {
    const d = doc();
    expect(setClause(d, 'speciesclause', true, PRESET.clauses)).toBe(d);
    expect(setClause(d, 'ohkoclause', false, PRESET.clauses)).toBe(d);
    expect(setClause(d, 'Not An Id', true, PRESET.clauses)).toBe(d);
  });
});

describe('rebase', () => {
  const UU: PresetRules = { ...PRESET, id: 'gen9uu', pokemon: { mode: 'block', ids: ['koraidon', 'miraidon', 'garchomp'] }, clauses: ['speciesclause'] };

  it('keeps what is enforced and rewrites it against the new preset', () => {
    let d = banEntries(doc(), 'pokemon', ['pikachu'], PRESET.pokemon).doc;
    d = allowEntries(d, 'pokemon', ['koraidon'], PRESET.pokemon).doc;
    d = setClause(d, 'sleepclausemod', false, PRESET.clauses);
    const before = computeEffective(d, PRESET);
    const result = rebase(d, PRESET, { base: { kind: 'preset', preset: 'gen9uu' }, preset: UU });
    expect(result.lossy).toEqual([]);
    expect(result.doc.base).toEqual({ kind: 'preset', preset: 'gen9uu' });
    const after = computeEffective(result.doc, UU);
    expect(after.pokemon).toEqual(before.pokemon);
    expect(after.clauses).toEqual(before.clauses);
    // garchomp is banned by UU but not by OU, so it is an unban; pikachu stays an own ban.
    expect(result.doc.pokemon.unban).toContain('garchomp');
    expect(result.doc.pokemon.ban).toContain('pikachu');
    expect(diffResolved(before, after).clausesAdded).toEqual([]);
  });

  it('a preset becomes a blank base with the same enforcement', () => {
    const d = banEntries(doc(), 'moves', ['spore'], PRESET.moves).doc;
    const result = rebase(d, PRESET, { base: blankBaseOf(PRESET), preset: null });
    expect(result.doc.base).toEqual({ kind: 'blank', gen: 9, doubles: false, universe: 'standard' });
    expect(result.doc.identity.based_on).toBe('gen9ou');
    const before = computeEffective(d, PRESET);
    const after = computeEffective(result.doc, null);
    expect(diffResolved({ ...before, format_key: 'x' }, { ...after, format_key: 'x' }).moves).toEqual({ modeChanged: false, added: [], removed: [] });
    expect(after.moves.ids).toEqual(['lastrespects', 'spore']);
  });

  it('an allowlist stays an allowlist; a block list cannot be written against a roster and is reported', () => {
    const allow = setMode(doc(), 'items', 'allow', ['leftovers']);
    expect(rebase(allow, PRESET, { base: { kind: 'preset', preset: 'gen9uu' }, preset: UU }).doc.items.allow).toEqual(['leftovers']);
    const roster = rebase(banEntries(doc(), 'pokemon', ['pikachu'], PRESET.pokemon).doc, PRESET, {
      base: { kind: 'preset', preset: 'gen9championsdraft' },
      preset: ROSTER,
    });
    expect(roster.lossy).toContain('pokemon');
    expect(roster.doc.pokemon).toEqual({ ban: [], unban: [], allow: null });
  });

  it('does nothing when the current preset is not resolved', () => {
    const d = doc();
    expect(rebase(d, null, { base: { kind: 'preset', preset: 'gen9uu' }, preset: UU }).doc).toBe(d);
  });
});

describe('counts and change list', () => {
  it('counts what the author changed against the base', () => {
    let d = banEntries(doc(), 'pokemon', ['garchomp', 'pikachu'], PRESET.pokemon).doc;
    d = allowEntries(d, 'pokemon', ['koraidon'], PRESET.pokemon).doc;
    d = setClause(d, 'ohkoclause', true, PRESET.clauses);
    const counts = documentCounts(d, PRESET);
    expect(counts).toMatchObject({ youBanned: 2, youUnbanned: 1, clausesAdded: 1, clausesRemoved: 0, total: 4 });
    expect(counts.perCategory.pokemon).toMatchObject({ baseMode: 'block', baseCount: 2 });
    expect(categoryCounts({ ban: [], unban: [], allow: ['a', 'b'] }, null).allowed).toBe(2);
    expect(listChanges(d).map((c) => `${c.category}:${c.kind}:${c.id}`)).toEqual(['pokemon:ban:garchomp', 'pokemon:ban:pikachu', 'pokemon:unban:koraidon']);
  });
});

// ── Fuzz ─────────────────────────────────────────────────────────────────────────

/** A small seeded generator (mulberry32) so a failure reproduces. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = ['koraidon', 'miraidon', 'garchomp', 'pikachu', 'charizard', 'lastrespects', 'spore', 'moody', 'leftovers', 'choiceband', 'x', 'y'];

describe('fuzz: 500 random edits keep the document valid', () => {
  it.each([1, 2, 3])('seed %i', (seed) => {
    const next = rng(seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
    let current = deepFreeze(doc());
    let base: PresetRules | null = PRESET;
    for (let step = 0; step < 500; step += 1) {
      const category = pick<RulesetCategory>(RULESET_CATEGORIES);
      const ids = Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(POOL));
      const list = base?.[category] ?? null;
      const roll = next();
      let result = current;
      if (roll < 0.3) result = banEntries(current, category, ids, list).doc;
      else if (roll < 0.55) result = allowEntries(current, category, ids, list).doc;
      else if (roll < 0.65) result = toggleEntries(current, category, ids, list).doc;
      else if (roll < 0.75) result = resetEntries(current, category, ids, list).doc;
      else if (roll < 0.82) result = setMode(current, category, next() < 0.5 ? 'allow' : 'block', next() < 0.5 ? ids : []);
      else if (roll < 0.9) result = setClause(current, pick(['speciesclause', 'sleepclausemod', 'ohkoclause', 'itemclause']), next() < 0.5, base?.clauses ?? []);
      else {
        const target = next() < 0.5 ? { base: blankBaseOf(PRESET), preset: null } : { base: { kind: 'preset', preset: 'gen9ou' } as const, preset: PRESET };
        const from = current.base.kind === 'preset' ? PRESET : null;
        result = rebase(current, from, target).doc;
        base = target.preset;
      }
      current = deepFreeze(result);
      for (const c of RULESET_CATEGORIES) {
        const rules = current[c];
        for (const part of [rules.ban, rules.unban, rules.allow ?? []]) {
          expect(new Set(part).size).toBe(part.length);
          expect([...part].sort()).toEqual([...part]);
        }
        expect(rules.ban.filter((id) => rules.unban.includes(id))).toEqual([]);
        if (rules.allow !== null) expect([rules.ban.length, rules.unban.length]).toEqual([0, 0]);
      }
    }
    // The result is a document the compile accepts (an empty allowlist aside).
    const compiled = compileRuleset(current, { preset: current.base.kind === 'preset' ? PRESET : null });
    const errors = compiled.diagnostics.filter((d) => d.severity === 'error' && d.code !== 'allowlist_empty');
    expect(errors).toEqual([]);
  });

  it('setLegal makes any entry legal or illegal as asked', () => {
    const next = rng(9);
    for (let i = 0; i < 300; i += 1) {
      const category = RULESET_CATEGORIES[Math.floor(next() * 4)];
      const id = POOL[Math.floor(next() * POOL.length)];
      const legal = next() < 0.5;
      const start = next() < 0.3 ? setMode(doc(), category, 'allow', [id]) : doc();
      const list = PRESET[category];
      const after = setLegal(start, category, [id], legal, list).doc;
      expect(isLegalState(entryState(after[category], list, id))).toBe(legal);
    }
  });
});
