/**
 * The rules inspector (static markup): honor rule cards with their scope and verification, rules text sections,
 * the limits and the coverage line.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import { MAX_RULES, MAX_TEXT_SECTIONS, computeCoverage, describeCoverage } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { addRuleCard, addTextSection, updateRuleCard } from '@/lib/format-studio/editor/ops';
import RulesInspector, { type RulesPart } from '../../editor/inspectors/RulesInspector';
import { compiled, esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds, presetDoc, stageNameOf } from './test-helpers';

function render(doc: DraftDocument, locale: Locale = 'en', part?: RulesPart) {
  return renderWithI18n(<RulesInspector doc={doc} diagnostics={compiled(doc).diagnostics} authorBase={locale} part={part} onChange={() => undefined} />, {
    locale,
  });
}

describe('RulesInspector', () => {
  it.each(['en', 'de'] as const)('shows the card, the section and the coverage line (%s)', (locale) => {
    const doc = presetDoc();
    const html = render(doc, locale);
    expect(html).toContain(esc(doc.rules[0].text[locale]?.v ?? ''));
    expect(html).toContain(esc(doc.text.sections[0].title[locale]?.v ?? ''));
    expect(html).toContain(esc(describeCoverage(computeCoverage(doc), locale)));
    expect(html).toContain(esc(createTranslator(formatStudioPrimitivesMessages, locale)('level.honor')));
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('marks every card with a text badge, not only a colour', () => {
    const doc = addRuleCard(presetDoc(), 'en').doc;
    const html = render(doc, 'en', 'rules');
    expect((html.match(/>Honor system</g) ?? []).length).toBe(doc.rules.length);
  });

  it('the part prop shows one list at a time', () => {
    const doc = presetDoc();
    const rules = render(doc, 'en', 'rules');
    expect(rules).toContain('Honor rule cards');
    expect(rules).not.toContain('Rules text sections');
    const text = render(doc, 'en', 'text');
    expect(text).toContain('Rules text sections');
    expect(text).not.toContain('Honor rule cards');
    expect(text).toContain(esc(describeCoverage(computeCoverage(doc), 'en')));
  });

  it('shows the stage a scoped card belongs to by name', () => {
    const doc = updateRuleCard(presetDoc(), 0, (c) => ({ ...c, scope: { kind: 'stage', stage: presetDoc().stages[1].key } }));
    const html = render(doc, 'en', 'rules');
    expect(html).toContain(`selected="">${esc(stageNameOf(doc, 1, 'en'))}</option>`);
    expect(html).toContain('One stage');
    expect(html).toContain('id="ff-rules-0-scope-stage"');
  });

  it('keeps the applies and visible options under a More options disclosure', () => {
    const html = render(presetDoc(), 'en', 'rules');
    const details = /<details[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
    expect(details).toContain('More options');
    expect(details).toContain('Every matchday');
    expect(details).toContain('Visible to players');
  });

  it('disables Add honor rule at the limit and says why', () => {
    let doc = presetDoc();
    while (doc.rules.length < MAX_RULES) doc = addRuleCard(doc, 'en').doc;
    const html = render(doc, 'en', 'rules');
    expect(html).toContain(`A format can have at most ${MAX_RULES} honor rules.`);
    expect(html).toMatch(/aria-describedby="fe-limit-cards"[^>]*disabled|disabled[^>]*aria-describedby="fe-limit-cards"/);
  });

  it('disables Add section at the limit and says why', () => {
    let doc = presetDoc();
    while (doc.text.sections.length < MAX_TEXT_SECTIONS) doc = addTextSection(doc, 'en').doc;
    const html = render(doc, 'en', 'text');
    expect(html).toContain(`A format can have at most ${MAX_TEXT_SECTIONS} rules text sections.`);
    expect(html).toMatch(/aria-describedby="fe-limit-sections"[^>]*disabled|disabled[^>]*aria-describedby="fe-limit-sections"/);
  });

  it('empty lists say so', () => {
    const doc: DraftDocument = { ...presetDoc(), rules: [], text: { sections: [] } };
    const html = render(doc);
    expect(html).toContain('No honor rules yet.');
    expect(html).toContain('No rules text sections yet.');
  });
});
