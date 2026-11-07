import { describe, expect, it } from 'vitest';
import { compile } from '../compile';
import { compile as compileBrowser } from '../compile.browser';
import { CURRENT_ENV } from '../engine/env';
import { computeCoverage, definitionToPlainText, describeDefinition } from '../engine/describe-definition';
import { AVAILABLE_KINDS } from '../registry/kinds';
import { manifestEntry } from '../registry/manifest';
import type { FormatDefinition } from '../types';
import { giftExchangeDoc, minimalDoc } from './fixtures/docs';

const PHASE_3 = AVAILABLE_KINDS.filter((kind) => manifestEntry(kind)?.phase === 3);

/** The kinds a definition uses: every section entry, every rule, every effect and every event. */
function kindsUsed(def: FormatDefinition): Set<string> {
  const kinds = new Set<string>();
  if ((def.attributes ?? []).length > 0) kinds.add('attr.define');
  if ((def.attributes ?? []).some((a) => a.assign !== undefined)) kinds.add('attr.assign');
  if ((def.domains ?? []).length > 0) kinds.add('domain.define');
  if ((def.relations ?? []).length > 0) kinds.add('relation.define');
  if ((def.resources ?? []).length > 0) kinds.add('resource.define');
  for (const metric of def.metrics ?? []) kinds.add(metric.kind);
  for (const rule of def.rules) {
    kinds.add(rule.kind);
    if (rule.kind === 'rule.on_event' && rule.effects.length > 0) kinds.add('effect.apply');
  }
  return kinds;
}

describe('the gift exchange fixture', () => {
  it('uses every Phase 3 kind', () => {
    const result = compile(giftExchangeDoc());
    expect(result.definition).not.toBeNull();
    const used = kindsUsed(result.definition as FormatDefinition);
    expect(PHASE_3.filter((kind) => !used.has(kind))).toEqual([]);
    expect(PHASE_3).toHaveLength(13);
  });

  it('compiles without errors or warnings', () => {
    const result = compile(giftExchangeDoc());
    expect(result.diagnostics.filter((d) => d.severity !== 'info').map((d) => JSON.stringify(d))).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('compiles to the same result in the zod and the browser validator', () => {
    const zod = compile(giftExchangeDoc());
    const browser = compileBrowser(giftExchangeDoc());
    expect(browser.ok).toBe(true);
    expect(browser.hash).toBe(zod.hash);
    expect(browser.diagnostics).toEqual(zod.diagnostics);
    expect(browser.definition).toEqual(zod.definition);
  });

  it('keeps every event and effect kind of the contract', () => {
    const def = compile(giftExchangeDoc()).definition as FormatDefinition;
    const events = new Set<string>();
    const effects = new Set<string>();
    for (const rule of def.rules) {
      if (rule.kind !== 'rule.on_event') continue;
      events.add(rule.on.event);
      for (const effect of rule.effects) effects.add(effect.effect);
    }
    expect([...events].sort()).toEqual(['match_completed', 'round_end', 'round_start', 'stage_end', 'stage_start', 'time']);
    expect([...effects].sort()).toEqual(
      [
        'adjust_points',
        'generate_relation',
        'grant_resource',
        'lock_action',
        'lock_domain',
        'notify',
        'open_action',
        'reveal_relation',
        'revoke_resource',
        'set_attr',
        'unlock_domain',
      ].sort(),
    );
  });

  it('applies the defaults of the new sections', () => {
    const def = compile(giftExchangeDoc()).definition as FormatDefinition;
    expect(def.domains?.[0]).toMatchObject({ initially: 'locked', visibility: 'when_unlocked' });
    expect(def.relations?.[0].visibility).toEqual({ from: 'hidden', to: 'own' });
    expect(def.resources?.[1]).toMatchObject({ visibility: 'all', exclusive: 'none' });
    expect(def.tunables?.[1]).toMatchObject({ editable_until: 'start', status: 'experimental' });
    const grant = def.rules.find((rule) => rule.kind === 'rule.on_event' && rule.id === 'kickoff');
    expect(grant?.kind === 'rule.on_event' && grant.effects[2]).toMatchObject({ effect: 'grant_resource', to: { who: 'all' }, amount: 3 });
    const action = def.rules.find((rule) => rule.kind === 'player.action');
    expect(action).toMatchObject({ review: true, lock: 'on_close' });
  });

  it('adds nothing to a document that does not use the new sections', () => {
    const def = compile(minimalDoc()).definition as FormatDefinition;
    for (const name of ['attributes', 'domains', 'relations', 'resources', 'metrics', 'tunables']) {
      expect(Object.prototype.hasOwnProperty.call(def, name), name).toBe(false);
    }
  });

  it('is read in both languages, with the new sections and the coverage by level', () => {
    const def = compile(giftExchangeDoc()).definition as FormatDefinition;
    const en = describeDefinition(def, 'en');
    const de = describeDefinition(def, 'de');
    expect(en.runtime).toHaveLength(7 + 1 + 1 + 2 + 3);
    expect(de.runtime).toHaveLength(en.runtime.length);
    expect(en.runtime[0]).toBe('Attribute House (choice) for players, assigned with a seeded random draw.');
    expect(de.runtime[0]).toBe('Attribut Haus (Auswahl) für Spieler, vergeben per Zufall mit festem Startwert.');
    expect(en.rules).toHaveLength(def.rules.length);
    expect(en.rules[6].text).toContain('Choose a gift');
    expect(en.rules[12].text).toBe('Manual rule: Be kind.');
    expect(definitionToPlainText(en)).toContain('Attributes, lists and relations');
    expect(definitionToPlainText(de)).toContain('Attribute, Listen und Beziehungen');
    for (const text of [...en.runtime, ...de.runtime, ...en.rules.map((r) => r.text), ...de.rules.map((r) => r.text)]) {
      expect(text).not.toMatch(/[{}]|undefined|NaN/);
    }
  });

  it('counts a unit by the level of its kind', () => {
    const def = compile(giftExchangeDoc()).definition as FormatDefinition;
    const coverage = computeCoverage(def);
    // Checked: 4 assisted checks and 1 manual adjustment; honor: the one rule card; the edge-free stage adds 4 + 2 rank steps.
    expect(coverage.checked).toBe(5);
    expect(coverage.honor).toBe(1);
    expect(coverage.legacy).toBe(0);
    expect(coverage.total).toBe(coverage.auto + coverage.checked + coverage.honor);
    expect(coverage.auto).toBeGreaterThan(20);
  });

  it('is accepted under the environment of the current engine', () => {
    expect(compile(giftExchangeDoc(), CURRENT_ENV).ok).toBe(true);
  });
});
