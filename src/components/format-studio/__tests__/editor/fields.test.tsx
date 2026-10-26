/**
 * The shared fields of the editor: the number parser, and the markup of the number, text, select and reorder
 * controls (labels, ARIA wiring between a control and its message, the missing-language line).
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { renderDiagnostic } from '@/lib/format-kit/client';
import { setBestOf, updateStage } from '@/lib/format-studio/editor/ops';
import { errorId, fieldId } from '@/lib/format-studio/editor/targets';
import { FieldIssuesProvider } from '../../editor/fields/FieldMessage';
import LTextField from '../../editor/fields/LTextField';
import NumberField, { keyboardFor, parseNumberInput } from '../../editor/fields/NumberField';
import ReorderControls from '../../editor/fields/ReorderControls';
import SelectField from '../../editor/fields/SelectField';
import { compiled, esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds, presetDoc } from './test-helpers';

const whole = { integer: true, min: 1, max: 100 };

describe('parseNumberInput', () => {
  it.each([
    ['', { ok: false, reason: 'empty' }],
    ['   ', { ok: false, reason: 'empty' }],
    ['1e3', { ok: false, reason: 'syntax' }],
    ['0x10', { ok: false, reason: 'syntax' }],
    ['２', { ok: false, reason: 'syntax' }],
    ['1,5', { ok: false, reason: 'syntax' }],
    ['1,000', { ok: false, reason: 'syntax' }],
    ['+3', { ok: false, reason: 'syntax' }],
    ['abc', { ok: false, reason: 'syntax' }],
    ['5.5', { ok: false, reason: 'integer' }],
    ['0', { ok: false, reason: 'range' }],
    ['101', { ok: false, reason: 'range' }],
    ['99999999999999999999', { ok: false, reason: 'range' }],
    [' 7 ', { ok: true, value: 7 }],
    ['100', { ok: true, value: 100 }],
  ])('%j with 1..100 as whole numbers', (text, expected) => {
    expect(parseNumberInput(text, whole)).toEqual(expected);
  });

  it('refuses a decimal for a whole-number field and a non-integer range of 1000.5', () => {
    expect(parseNumberInput('1000.5', { integer: true, min: 1, max: 2000 })).toEqual({ ok: false, reason: 'integer' });
  });

  it('allows one decimal point when the field takes decimals, and reads -0 as 0', () => {
    const decimals = { integer: false, min: -1000, max: 1000 };
    expect(parseNumberInput('2.5', decimals)).toEqual({ ok: true, value: 2.5 });
    expect(parseNumberInput('-1.25', decimals)).toEqual({ ok: true, value: -1.25 });
    const zero = parseNumberInput('-0', decimals);
    expect(zero.ok && Object.is(zero.value, 0)).toBe(true);
  });

  it.each([
    ['0,5', { ok: true, value: 0.5 }],
    [' 2,25 ', { ok: true, value: 2.25 }],
    ['-1,5', { ok: true, value: -1.5 }],
    ['1,5.2', { ok: false, reason: 'syntax' }],
    ['1,2,3', { ok: false, reason: 'syntax' }],
    [',5', { ok: false, reason: 'syntax' }],
    ['5,', { ok: false, reason: 'syntax' }],
    ['2000,5', { ok: false, reason: 'range' }],
  ])('reads a single decimal comma in a field that takes decimals: %j', (text, expected) => {
    expect(parseNumberInput(text, { integer: false, min: -1000, max: 1000 })).toEqual(expected);
  });
});

describe('NumberField', () => {
  it.each(['en', 'de'] as const)('has a label, a numeric keyboard and the document value (%s)', (locale) => {
    const html = renderWithI18n(<NumberField pointer="/stages/0/pairing/legs" label="Legs" value={2} min={1} max={4} onCommit={() => undefined} />, { locale });
    expect(html).toContain('<label');
    expect(html).toContain('for="ff-stages-0-pairing-legs"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('value="2"');
    expectLabelledControls(html);
    expectNoLeftovers(html);
  });

  it('uses a decimal keyboard for a field that takes decimals', () => {
    const html = renderWithI18n(
      <NumberField pointer="/stages/0/scoring/win" label="Win" value={3} integer={false} min={0} max={1000} onCommit={() => undefined} />,
    );
    expect(html).toContain('inputMode="decimal"');
  });

  it('names both decimal separators in the hint, in each language', () => {
    expect(createTranslator(formatStudioEditorMessages, 'en')('fields.numberHint')).toContain('2.5 or 2,5');
    expect(createTranslator(formatStudioEditorMessages, 'de')('fields.numberHint')).toContain('2,5 oder 2.5');
    // A text that is no number at all (here the text of NaN) shows that hint in the viewer language.
    const props = { pointer: '/stages/0/scoring/win', label: 'Win', value: Number.NaN, integer: false, min: 0, max: 10, onCommit: () => undefined } as const;
    expect(renderWithI18n(<NumberField {...props} />)).toContain('for example 2.5 or 2,5.');
    expect(renderWithI18n(<NumberField {...props} />, { locale: 'de' })).toContain('zum Beispiel 2,5 oder 2.5.');
  });

  it('shows the full keyboard when a negative number is allowed, since the number pads have no minus key', () => {
    const html = renderWithI18n(
      <NumberField pointer="/stages/0/scoring/win" label="Win" value={-2} integer={false} min={-1000} max={1000} onCommit={() => undefined} />,
    );
    expect(html).toContain('inputMode="text"');
    expect(html).not.toContain('inputMode="decimal"');
    expect(keyboardFor({ integer: true, min: -5, max: 5 })).toBe('text');
    expect(keyboardFor({ integer: true, min: 0, max: 5 })).toBe('numeric');
    expect(keyboardFor({ integer: false, min: 0, max: 5 })).toBe('decimal');
  });

  it('ties a finding at its pointer to the control with aria-describedby and aria-invalid', () => {
    const doc = updateStage(presetDoc(), 0, (s) => setBestOf(s, 2));
    const result = compiled(doc);
    const html = renderWithI18n(
      <FieldIssuesProvider diagnostics={result.diagnostics} definition={doc}>
        <NumberField pointer="/stages/0/series/best_of" label="Best of" value={2} min={1} max={15} onCommit={() => undefined} />
      </FieldIssuesProvider>,
    );
    const pointer = '/stages/0/series/best_of';
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`aria-describedby="${errorId(pointer)}"`);
    expect(html).toContain(`id="${errorId(pointer)}"`);
    const finding = result.diagnostics.find((d) => d.code === 'series_even_best_of')!;
    expect(html).toContain(esc(renderDiagnostic(finding, 'en', doc)));
  });

  it('a field without a finding or hint has no aria-describedby', () => {
    const html = renderWithI18n(<NumberField pointer="/stages/0/pairing/legs" label="Legs" value={2} min={1} max={4} onCommit={() => undefined} />);
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('aria-invalid');
  });

  it('shows the range hint for a value outside the range and marks the control invalid', () => {
    const html = renderWithI18n(<NumberField pointer="/stages/0/pairing/legs" label="Legs" value={9} min={1} max={4} onCommit={() => undefined} />);
    expect(html).toContain('Between 1 and 4.');
    expect(html).toContain('aria-invalid="true"');
  });

  it('an optional field with no value shows the not-set placeholder in the viewer language', () => {
    const en = renderWithI18n(<NumberField pointer="/x" label="Expected" value={undefined} min={2} max={9} optional onCommit={() => undefined} />);
    const de = renderWithI18n(<NumberField pointer="/x" label="Erwartet" value={undefined} min={2} max={9} optional onCommit={() => undefined} />, { locale: 'de' });
    expect(en).toContain('placeholder="Not set"');
    expect(de).toContain('placeholder="Nicht gesetzt"');
  });
});

describe('LTextField', () => {
  const both = { base: 'en' as const, en: { v: 'Cup', s: 'human' as const }, de: { v: 'Pokal', s: 'human' as const } };
  const onlyEnglish = { base: 'en' as const, en: { v: 'Cup', s: 'human' as const } };

  it('renders a labelled English and German pair; the English control owns the field id', () => {
    const html = renderWithI18n(<LTextField pointer="/identity/name" label="Format name" value={both} base="en" onChange={() => undefined} />);
    expect(html).toContain(`id="${fieldId('/identity/name')}"`);
    expect(html).toContain(`id="${fieldId('/identity/name/de')}"`);
    expect(html).toContain('>English<');
    expect(html).toContain('>Deutsch<');
    expect(html).toContain('value="Cup"');
    expect(html).toContain('value="Pokal"');
    expect(html).not.toContain('Missing in');
    expectLabelledControls(html);
    expectUniqueIds(html);
  });

  it.each([
    ['en', 'Missing in Deutsch.'],
    ['de', 'Fehlt auf Deutsch.'],
  ] as const)('names the language that has no text yet (%s)', (locale, expected) => {
    const html = renderWithI18n(<LTextField pointer="/identity/name" label="Name" value={onlyEnglish} base="en" onChange={() => undefined} />, { locale });
    expect(html).toContain(expected);
  });

  it('uses a textarea when asked and offers Remove only with a value and a handler', () => {
    const html = renderWithI18n(
      <LTextField pointer="/identity/summary" label="Summary" value={both} base="en" multiline removeLabel="Remove summary" onRemove={() => undefined} onChange={() => undefined} />,
    );
    expect(html).toContain('<textarea');
    expect(html).toContain('Remove summary');
    const without = renderWithI18n(
      <LTextField pointer="/identity/summary" label="Summary" value={undefined} base="en" multiline removeLabel="Remove summary" onRemove={() => undefined} onChange={() => undefined} />,
    );
    expect(without).not.toContain('Remove summary');
    expect(without).not.toContain('Missing in');
  });
});

describe('SelectField and ReorderControls', () => {
  it('a select has a label bound to its id and lists its options', () => {
    const html = renderWithI18n(
      <SelectField
        pointer="/stages/0/pairing/kind"
        label="Pairing"
        value="swiss"
        options={[
          { value: 'round_robin', label: 'Round robin' },
          { value: 'swiss', label: 'Swiss' },
        ]}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('for="ff-stages-0-pairing-kind"');
    expect(html).toContain('<option value="swiss" selected="">Swiss</option>');
    expectLabelledControls(html);
  });

  it('reorder buttons carry names, and the first row cannot go up while the last cannot go down', () => {
    const labels = { up: 'Move A up', down: 'Move A down', remove: 'Remove A', duplicate: 'Duplicate A' };
    const first = renderWithI18n(<ReorderControls index={0} count={3} labels={labels} onMove={() => undefined} onRemove={() => undefined} onDuplicate={() => undefined} />);
    expect(first).toMatch(/aria-label="Move A up"[^>]*disabled/);
    expect(first).not.toMatch(/aria-label="Move A down"[^>]*disabled/);
    expect(first).toContain('aria-label="Remove A"');
    expect(first).toContain('aria-label="Duplicate A"');
    const last = renderWithI18n(<ReorderControls index={2} count={3} labels={labels} onMove={() => undefined} />);
    expect(last).toMatch(/aria-label="Move A down"[^>]*disabled/);
    expect(last).not.toContain('Remove A');
  });
});
