/**
 * The stage inspector (static markup): every section for every pairing kind, the disabled draw and forfeit rows,
 * an even best-of tied to its message, the rank chain limit and its named buttons, an unknown ruleset id.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import { MAX_RANK_STEPS, renderDiagnostic } from '@/lib/format-kit/client';
import { PAIRING_KINDS } from '@/lib/format-studio/editor/catalog';
import {
  addRankStep,
  setBestOf,
  setGroups,
  setPairingKind,
  setRuleset,
  setShowdownFormat,
  updateStage,
} from '@/lib/format-studio/editor/ops';
import { errorId, fieldId } from '@/lib/format-studio/editor/targets';
import StageInspector from '../../editor/inspectors/StageInspector';
import { compiled, esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds, presetDoc, stageNameOf } from './test-helpers';

const RULESETS = [{ id: 'rs-ou', name: 'OU Singles' }];

function render(doc = presetDoc(), index = 0, locale: Locale = 'en', rulesets = RULESETS) {
  return renderWithI18n(
    <StageInspector doc={doc} index={index} diagnostics={compiled(doc).diagnostics} rulesets={rulesets} authorBase={locale} onChange={() => undefined} />,
    { locale },
  );
}

const words = (locale: Locale) => ({
  p: createTranslator(formatStudioPrimitivesMessages, locale),
  e: createTranslator(formatStudioEditorMessages, locale),
});

describe('StageInspector: sections', () => {
  it.each(['en', 'de'] as const)('shows every section in %s, with the stage name as the heading', (locale) => {
    const doc = presetDoc();
    const html = render(doc, 0, locale);
    const { p, e } = words(locale);
    expect(html).toContain(esc(stageNameOf(doc, 0, locale)));
    for (const legend of [
      e('inspector.stage.name'),
      e('inspector.stage.participants'),
      p('field.groups'),
      p('field.pairing'),
      p('field.series'),
      p('field.ruleset'),
      p('field.scoring'),
      p('field.rank'),
    ]) {
      expect(html).toContain(`<legend`);
      expect(html).toContain(esc(legend));
    }
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it.each(PAIRING_KINDS.map((kind) => [kind]))('the %s pairing shows its own fields and nobody else\'s', (kind) => {
    const doc = updateStage(presetDoc(), 0, (s) => setPairingKind(s, kind));
    const html = render(doc);
    const has = (text: string) => html.includes(`>${text}<`);
    expect(has('Legs')).toBe(kind === 'round_robin');
    expect(has('Mirror legs')).toBe(kind === 'round_robin');
    expect(has('Avoid repeat pairings')).toBe(kind === 'swiss');
    expect(has('Third-place match')).toBe(kind === 'single_elim');
    expect(has('Bracket reset')).toBe(kind === 'double_elim');
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('says in the rank section that elimination stages ignore the chain', () => {
    const elimination = render(updateStage(presetDoc(), 0, (s) => setPairingKind(s, 'single_elim')));
    expect(elimination).toContain('The ranking chain is not used by elimination stages.');
    expect(render(presetDoc())).not.toContain('The ranking chain is not used by elimination stages.');
  });

  it('shows the group fields only for a stage that is split into groups', () => {
    const plain = render(presetDoc());
    expect(plain).not.toContain('Number of groups');
    const grouped = render(updateStage(presetDoc(), 0, (s) => setGroups(s, { count: 3, method: 'serpentine' })));
    expect(grouped).toContain('Number of groups');
    expect(grouped).toContain('How players are assigned');
  });

  it('keeps the key behind an Advanced disclosure, with the help text', () => {
    const doc = presetDoc();
    const html = render(doc);
    expect(html).toContain('<details');
    expect(html).toContain('Advanced');
    expect(html).toContain(esc(doc.stages[0].key));
    expect(html).toContain('Edit key');
    expect(html).toContain('The key identifies the phase when the format is attached to a league.');
  });
});

describe('StageInspector: scoring', () => {
  it.each(['en', 'de'] as const)('shows draw and forfeit disabled with the reason (%s)', (locale) => {
    const html = render(presetDoc(), 0, locale);
    const { p, e } = words(locale);
    for (const [pointerId, label, reason] of [
      ['ff-stages-0-scoring-draw', p('field.draw'), e('inspector.stage.drawDisabled')],
      ['ff-stages-0-scoring-forfeit', p('field.forfeit'), e('inspector.stage.forfeitDisabled')],
    ]) {
      const input = new RegExp(`<input[^>]*id="${pointerId}"[^>]*>`).exec(html)?.[0] ?? '';
      expect(input, label).toContain('disabled');
      expect(input).toContain(`aria-describedby="${pointerId}-why"`);
      expect(html).toContain(`id="${pointerId}-why"`);
      expect(html).toContain(esc(reason));
    }
  });

  it('shows a draw value that came with an import, still disabled, and the finding with its fix is in the Issues tab', () => {
    const doc = updateStage(presetDoc(), 0, (s) => ({ ...s, scoring: { ...s.scoring, draw: 1 } }));
    const html = render(doc);
    const input = /<input[^>]*id="ff-stages-0-scoring-draw"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).toContain('value="1"');
    expect(input).toContain('disabled');
    expect(input).toContain('aria-invalid="true"');
  });
});

describe('StageInspector: findings next to their fields', () => {
  it('an even best-of is tied to its sentence by aria-describedby and aria-invalid', () => {
    const doc = updateStage(presetDoc(), 0, (s) => setBestOf(s, 2));
    const result = compiled(doc);
    const finding = result.diagnostics.find((d) => d.code === 'series_even_best_of');
    expect(finding).toBeDefined();
    const html = render(doc);
    const pointer = '/stages/0/series/best_of';
    const input = /<input[^>]*id="ff-stages-0-series-best_of"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain(`aria-describedby="${errorId(pointer)}"`);
    expect(html).toContain(`id="${errorId(pointer)}"`);
    expect(html).toContain(esc(renderDiagnostic(finding!, 'en', doc)));
  });

  it('a valid document has no aria-invalid control', () => {
    expect(render(presetDoc())).not.toContain('aria-invalid');
  });
});

describe('StageInspector: rank chain', () => {
  function fullChain() {
    let doc = presetDoc();
    for (let i = doc.stages[0].rank.length; i < MAX_RANK_STEPS; i += 1) {
      doc = updateStage(doc, 0, (s) => addRankStep(s, 'coin_flip'));
    }
    return doc;
  }

  it('names the move buttons by position', () => {
    const doc = presetDoc();
    expect(doc.stages[0].rank.length).toBeGreaterThanOrEqual(2);
    const html = render(doc);
    expect(html).toContain('aria-label="Move step 2 up"');
    expect(html).toContain('aria-label="Move step 1 down"');
    expect(html).toContain('aria-label="Remove step 1"');
    // The first step cannot go up, the last cannot go down.
    expect(html).toMatch(/aria-label="Move step 1 up"[^>]*disabled/);
    const german = render(doc, 0, 'de');
    expect(german).toContain('aria-label="Schritt 2 nach oben schieben"');
  });

  it('disables Add at the limit and says why', () => {
    const doc = fullChain();
    expect(doc.stages[0].rank).toHaveLength(MAX_RANK_STEPS);
    const html = render(doc);
    expect(html).toMatch(/<button[^>]*aria-describedby="fe-limit-rank"[^>]*disabled|<button[^>]*disabled[^>]*aria-describedby="fe-limit-rank"/);
    expect(html).toContain(`A ranking chain can have at most ${MAX_RANK_STEPS} steps.`);
    expect(render(presetDoc())).not.toContain('at most 12 steps');
  });
});

describe('StageInspector: ruleset', () => {
  it('lists the known rulesets and the league default', () => {
    const doc = updateStage(presetDoc(), 0, (s) => setRuleset(s, { kind: 'ruleset', id: 'rs-ou' }));
    const html = render(doc);
    expect(html).toContain('<option value="" >League default</option>'.replace(' >', '>'));
    expect(html).toContain('<option value="rs-ou" selected="">OU Singles</option>');
    expect(html).not.toContain('Unknown ruleset');
  });

  it('shows a ruleset id that is not in the list as an unknown ruleset, selected, so it can be kept', () => {
    const doc = updateStage(presetDoc(), 0, (s) => setRuleset(s, { kind: 'ruleset', id: 'rs-gone' }));
    const html = render(doc);
    expect(html).toContain('<option value="rs-gone" selected="">Unknown ruleset</option>');
    const german = render(doc, 0, 'de');
    expect(german).toContain('Unbekanntes Regelwerk');
  });
});

describe('StageInspector: Showdown format', () => {
  const showdownDoc = (format = 'gen9doublesou') => updateStage(presetDoc(), 0, (s) => setShowdownFormat(s, format));

  it.each(['en', 'de'] as const)('offers the Showdown kind next to the league default and the stored rulesets (%s)', (locale) => {
    const { e } = words(locale);
    const html = render(presetDoc(), 0, locale);
    expect(html).toContain(`<option value="showdown">${esc(e('inspector.stage.rulesetShowdown'))}</option>`);
    // Not picked: no format picker.
    expect(html).not.toContain(`id="${fieldId('/stages/0/ruleset/format')}"`);
  });

  it.each(['en', 'de'] as const)('shows the picker with the chosen format selected, grouped by generation (%s)', (locale) => {
    const { e } = words(locale);
    const html = render(showdownDoc(), 0, locale);
    expect(html).toContain('<option value="showdown" selected="">');
    expect(html).toContain(`id="${fieldId('/stages/0/ruleset/format')}"`);
    expect(html).toContain('<option value="gen9doublesou" selected="">Gen 9 Doubles OU</option>');
    expect(html).toContain('<optgroup label="Gen 9 (SV)">');
    expect(html).toContain('<optgroup label="Gen 1 (RBY)">');
    expect(html).toContain(esc(e('fields.showdownSearch')));
    expect(html).toContain(esc(e('inspector.stage.showdownHelp')));
    expectLabelledControls(html);
    expectNoLeftovers(html);
    expectUniqueIds(html);
  });

  it('shows a format the catalog does not know as unknown, selected, so it can be replaced', () => {
    const doc = updateStage(presetDoc(), 0, (s) => ({ ...s, ruleset: { kind: 'showdown' as const, format: 'gen99xx' } }));
    const html = render(doc);
    expect(html).toContain('<option value="gen99xx" selected="">Unknown format (gen99xx)</option>');
    // The compiler's finding is tied to the select.
    const diagnostic = compiled(doc).diagnostics.find((d) => d.code === 'showdown_format_unknown');
    expect(diagnostic?.json_pointer).toBe('/stages/0/ruleset/format');
    expect(html).toContain(`aria-describedby="${errorId('/stages/0/ruleset/format')}"`);
    expect(html).toContain('aria-invalid="true"');
  });
});

describe('StageInspector: a missing stage', () => {
  it('renders nothing for an index past the end', () => {
    expect(render(presetDoc(), 99)).toBe('');
  });
});
