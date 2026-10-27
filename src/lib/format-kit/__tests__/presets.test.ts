import { describe, expect, it } from 'vitest';
import { collectLTexts } from '../engine/checks-structure';
import { SLUG_PATTERN } from '@/lib/studio-core/keys';
import { PRESETS } from '../presets';
import { describePrimitive } from '../registry/describe';
import type { PrimitiveKind } from '../registry/kinds';
import type { FormatDefinition } from '../types';

// Double-encoding markers written as escapes so the repository's mojibake guard does not match this file.
const MOJIBAKE = /\u00c3|\u00c2|\u00e2\u20ac|\uFFFD/;
const UMLAUT = /[äöüßÄÖÜ]/;

/** Every node of a definition that has a primitive kind, paired with that kind. */
function nodesOf(def: FormatDefinition): [PrimitiveKind, unknown][] {
  const out: [PrimitiveKind, unknown][] = [];
  for (const stage of def.stages) {
    out.push(['stage.define', stage], ['series.rule', stage.series], ['team.ruleset', stage.ruleset], ['score.match', stage.scoring]);
    out.push([`pairing.${stage.pairing.kind}` as PrimitiveKind, stage.pairing]);
    if (stage.groups) out.push(['group.form', stage.groups]);
    for (const step of stage.rank) out.push([`rank.${step.kind === 'metric' ? 'metric' : step.kind}` as PrimitiveKind, step]);
  }
  for (const edge of def.edges) {
    out.push(['advance.rule', edge]);
    for (const select of edge.select) out.push([`advance.${select.kind}` as PrimitiveKind, select]);
  }
  for (const view of def.views) out.push(['standings.view', view]);
  for (const rule of def.rules) out.push(['rule.custom', rule]);
  for (const section of def.text.sections) out.push(['text.rules', section]);
  out.push(['theme.hint', def.theme]);
  for (const legacy of def.modules) out.push(['module.legacy', legacy]);
  return out;
}

describe('presets', () => {
  it('has unique, slug-valid ids', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).toEqual(['classic-league', 'cup', 'swiss-top-cut']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(SLUG_PATTERN.test(id), id).toBe(true);
  });

  it.each(PRESETS.map((p) => [p.id, p.definition] as const))('%s has English and German text for every LText', (_id, def) => {
    const texts = collectLTexts(def);
    expect(texts.length).toBeGreaterThan(4);
    for (const { pointer, text } of texts) {
      expect(text.base, pointer).toBe('en');
      expect(text.en?.v.length, `${pointer} en`).toBeGreaterThan(0);
      expect(text.de?.v.length, `${pointer} de`).toBeGreaterThan(0);
      expect(text.en?.s, pointer).toBe('human');
      expect(text.de?.s, pointer).toBe('human');
    }
  });

  it.each(PRESETS.map((p) => [p.id, p.definition] as const))('%s has real umlauts in its German texts and no mojibake', (_id, def) => {
    const german = collectLTexts(def).map(({ text }) => text.de?.v ?? '');
    expect(german.some((v) => UMLAUT.test(v))).toBe(true);
    for (const value of [...german, ...collectLTexts(def).map(({ text }) => text.en?.v ?? '')]) expect(value).not.toMatch(MOJIBAKE);
  });

  it.each(PRESETS.map((p) => [p.id, p.definition] as const))('describes every node of %s in both languages', (_id, def) => {
    const nodes = nodesOf(def);
    expect(nodes.length).toBeGreaterThan(8);
    for (const [kind, node] of nodes) {
      for (const locale of ['en', 'de'] as const) {
        const text = describePrimitive(kind, node, locale);
        expect(text.length, `${kind} ${locale}`).toBeGreaterThan(3);
        expect(text, `${kind} ${locale}`).not.toMatch(/\{[A-Za-z0-9_]+\}/);
        expect(text, `${kind} ${locale}`).not.toContain('undefined');
        expect(text, `${kind} ${locale}`).not.toMatch(MOJIBAKE);
      }
    }
  });

  it('describes the nodes as sentences about the right thing', () => {
    const classic = PRESETS[0].definition;
    expect(describePrimitive('series.rule', classic.stages[0].series, 'en')).toContain('best of 1');
    expect(describePrimitive('advance.top_n', classic.edges[0].select[0], 'en')).toContain('4');
  });
});
