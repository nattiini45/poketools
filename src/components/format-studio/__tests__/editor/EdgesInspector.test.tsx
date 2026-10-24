/**
 * The advancement inspector (static markup): the list of rules with stages picked by name, the selections with
 * their numbers, the read-only threshold, the limits and the empty states.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { MAX_EDGES, MAX_SELECTS, printExpr, type Edge, type Expr } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { addEdge, addSelect, removeStage, updateEdge } from '@/lib/format-studio/editor/ops';
import EdgesInspector from '../../editor/inspectors/EdgesInspector';
import { compiled, esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds, presetDoc, stageNameOf } from './test-helpers';

function render(doc: DraftDocument, locale: Locale = 'en') {
  return renderWithI18n(<EdgesInspector doc={doc} diagnostics={compiled(doc).diagnostics} onChange={() => undefined} />, { locale });
}

/** The Add rule button, disabled (an icon, then the label). */
const ADD_DISABLED = /<button[^>]*disabled=""[^>]*>(?:<svg[\s\S]*?<\/svg>)?Add advancement rule/;

const THRESHOLD: Expr = { k: 'cmp', op: '>=', a: { k: 'ref', name: 'points', t: 'number' }, b: { k: 'num', v: 6 } };

describe('EdgesInspector', () => {
  it.each(['en', 'de'] as const)('lists the rule with its stages by name, not by key (%s)', (locale) => {
    const doc = presetDoc();
    const html = render(doc, locale);
    expect(html).toContain(esc(`${stageNameOf(doc, 0, locale)} → ${stageNameOf(doc, 1, locale)}`));
    expect(html).toContain(`<option value="${doc.stages[0].key}" selected="">${esc(stageNameOf(doc, 0, locale))}</option>`);
    expect(html).toContain(`<option value="${doc.stages[1].key}" selected="">${esc(stageNameOf(doc, 1, locale))}</option>`);
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('shows the selection number, the seeding and the gate', () => {
    const html = render(presetDoc());
    expect(html).toContain('value="4"');
    expect(html).toContain('Top players advance');
    expect(html).toContain('By rank');
    expect(html).toContain('Admin confirms');
  });

  it('names the reorder and remove buttons after the rule', () => {
    const doc = presetDoc();
    const title = `${stageNameOf(doc, 0, 'en')} → ${stageNameOf(doc, 1, 'en')}`;
    const html = render(doc);
    expect(html).toContain(`aria-label="${esc(`Remove ${title}`)}"`);
    expect(html).toContain(`aria-label="${esc(`Move ${title} up`)}"`);
  });

  it('shows a threshold selection read-only as its printed condition, with the note and a Remove button', () => {
    const base = presetDoc();
    const doc = updateEdge(base, 0, (e: Edge) => ({ ...e, select: [...e.select, { kind: 'threshold', when: THRESHOLD }] }));
    const html = render(doc);
    expect(html).toContain(esc(printExpr(THRESHOLD)));
    expect(html).toContain('edited with the builder that comes later');
    expect(html).toContain('Remove selection 2');
    // Only the first selection (a top-N) has a kind select and a number field.
    expect((html.match(/id="ff-edges-0-select-\d+-kind"/g) ?? []).length).toBe(1);
  });

  it('disables Add selection at four selections and says why', () => {
    let doc = presetDoc();
    while (doc.edges[0].select.length < MAX_SELECTS) doc = updateEdge(doc, 0, (e) => addSelect(e, 'wildcard'));
    const html = render(doc);
    expect(html).toContain(`A rule can have at most ${MAX_SELECTS} selections.`);
    expect(html).toMatch(/aria-describedby="fe-limit-selections-0"[^>]*disabled|disabled[^>]*aria-describedby="fe-limit-selections-0"/);
  });

  it('disables Add rule at the limit and says why', () => {
    let doc = presetDoc();
    while (doc.edges.length < MAX_EDGES) {
      const next = addEdge(doc, { from: doc.stages[0].key, to: doc.stages[1].key });
      if (next.index < 0) break;
      doc = next.doc;
    }
    expect(doc.edges).toHaveLength(MAX_EDGES);
    const html = render(doc);
    expect(html).toContain(`A format can have at most ${MAX_EDGES} advancement rules.`);
    expect(html).toMatch(/aria-describedby="fe-limit-edges"[^>]*disabled|disabled[^>]*aria-describedby="fe-limit-edges"/);
  });

  it('with one stage it explains why there is nothing to connect, and Add is disabled', () => {
    const { doc } = removeStage(presetDoc(), 1);
    const html = render(doc);
    expect(html).toContain('Advancement connects two stages. Add a second stage first.');
    expect(html).toMatch(ADD_DISABLED);
    const german = render(doc, 'de');
    expect(german).toContain('Weiterkommen verbindet zwei Phasen.');
  });

  it('with two stages and no rule it says so', () => {
    const doc: DraftDocument = { ...presetDoc(), edges: [] };
    const html = render(doc);
    expect(html).toContain('No advancement rules yet.');
    expect(html).not.toMatch(ADD_DISABLED);
  });
});
