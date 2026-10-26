/**
 * `AttachPreviewList` and `EngineGapList` (renderToStaticMarkup, no DOM): what an attach would create, and the parts of
 * a format the engine does not run yet, in plain words. The previews are built by `previewAttach` from the shipped
 * example formats; the gap sentences are pinned for every gap code in both languages.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import type { Locale } from '@/i18n/config';
import { PRESETS } from '@/lib/format-kit/client';
import { previewAttach, type AttachPreview } from '@/lib/format-studio/editor/attach-preview';
import type { EngineGap, EngineGapCode } from '@/lib/format-studio/library-types';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AttachPreviewList, { EngineGapList } from '../../attach/AttachPreviewList';

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

function expectNoLeftovers(html: string) {
  expect(html).not.toMatch(/undefined|\[object|NaN/);
  expect(html).not.toMatch(/\{[a-z_]+\}/);
  expect(html).not.toMatch(/Ã|Â|�/);
}

function previewOf(presetId: string, language: Locale = 'en', rulesetId: string | null = 'ruleset-1'): AttachPreview {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`no preset ${presetId}`);
  return previewAttach({ spec: preset.definition, seasonRulesetId: rulesetId, seasonLanguage: language, specHash: 'hash-1' });
}

function render(ui: ReactNode, locale: Locale = 'en') {
  return renderWithI18n(<>{ui}</>, { locale });
}

describe('AttachPreviewList: Showdown formats', () => {
  it.each(['en', 'de'] as const)('names the Showdown format of a phase instead of a ruleset (%s)', (locale) => {
    const preset = PRESETS.find((p) => p.id === 'classic-league');
    if (!preset) throw new Error('no preset');
    const spec = structuredClone(preset.definition);
    spec.stages[0] = { ...spec.stages[0], ruleset: { kind: 'showdown', format: 'gen9vgc' }, doubles: true };
    const preview = previewAttach({ spec, seasonRulesetId: null, seasonLanguage: locale, specHash: 'hash-1' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.leagueRulesetMissing).toBe(1);
    const html = render(<AttachPreviewList preview={preview} />, locale);
    const t = createTranslator(formatStudioAttachMessages, locale);
    expect(html).toContain(esc(t('preview.rulesetShowdown', { format: 'Gen 9 VGC' })));
    expect(html).toContain(esc(t('preview.rulesetLeague')));
    expectNoLeftovers(html);
  });
});

describe('AttachPreviewList: the shipped examples', () => {
  it.each(PRESETS.map((p) => p.id))('%s: every phase in order, with its bracket word and best of', (presetId) => {
    for (const locale of ['en', 'de'] as const) {
      const preview = previewOf(presetId, locale);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const html = render(<AttachPreviewList preview={preview} />, locale);
      const t = createTranslator(formatStudioAttachMessages, locale);
      const tWords = createTranslator(formatStudioPrimitivesMessages, locale);

      expect(html).toContain(esc(t('preview.heading')));
      expect(preview.stages.length).toBeGreaterThan(0);
      let last = -1;
      preview.stages.forEach((stage, index) => {
        expect(stage.order).toBe(index + 1);
        const at = html.indexOf(`data-attach-stage="${stage.key}"`);
        expect(at, stage.key).toBeGreaterThan(last);
        last = at;
        expect(html).toContain(esc(stage.name));
        expect(html).toContain(esc(t('preview.phase', { order: stage.order })));
        expect(html).toContain(esc(tWords.dynamic(`label.pairing_${stage.bracketType}`)));
        expect(html).toContain(esc(t('preview.bestOf', { n: stage.bestOf })));
      });
      expectNoLeftovers(html);
    }
  });

  it('names the ruleset of each phase in words', () => {
    const preview = previewOf('classic-league');
    if (!preview.ok) throw new Error('preview should be valid');
    const league = { ...preview, stages: preview.stages.map((s, i) => ({ ...s, ruleset: i === 0 ? ('named' as const) : ('league' as const) })) };
    const html = render(<AttachPreviewList preview={league} />);
    expect(html.match(/Own ruleset/g)).toHaveLength(1);
    expect(html.match(/League ruleset/g)).toHaveLength(league.stages.length - 1);
  });

  it('a doubles phase carries a Doubles badge, a singles phase does not', () => {
    const preview = previewOf('cup');
    if (!preview.ok) throw new Error('preview should be valid');
    const singles = render(<AttachPreviewList preview={{ ...preview, stages: preview.stages.map((s) => ({ ...s, doubles: false })) }} />);
    const doubles = render(<AttachPreviewList preview={{ ...preview, stages: preview.stages.map((s) => ({ ...s, doubles: true })) }} />);
    expect(singles).not.toContain('Doubles');
    expect(doubles.match(/Doubles/g)).toHaveLength(preview.stages.length);
  });

  it('no gap list when the engine runs everything', () => {
    const preview = previewOf('classic-league');
    if (!preview.ok) throw new Error('preview should be valid');
    const html = render(<AttachPreviewList preview={{ ...preview, warnings: [] }} />);
    expect(html).not.toContain('data-engine-gaps');
  });

  it('shows the gaps the attach reports for a format that has some', () => {
    // Whatever a preset reports, the list shows exactly one sentence per gap.
    for (const preset of PRESETS) {
      const preview = previewOf(preset.id);
      if (!preview.ok) continue;
      const html = render(<AttachPreviewList preview={preview} />);
      const gapSection = html.includes('data-engine-gaps') ? html.slice(html.indexOf('data-engine-gaps')) : '';
      expect(gapSection.match(/<li /g)?.length ?? 0).toBe(preview.warnings.length);
    }
  });
});

describe('AttachPreviewList: an invalid version', () => {
  const invalid: AttachPreview = { ok: false, reason: 'invalid', firstError: 'schema_refine' };

  it.each(['en', 'de'] as const)('says it cannot be attached and links to the format (%s)', (locale) => {
    const html = render(<AttachPreviewList preview={invalid} formatHref="/admin/formats/f1" />, locale);
    const t = createTranslator(formatStudioAttachMessages, locale);
    expect(html).toContain(esc(t('preview.invalid')));
    expect(html).toContain('href="/admin/formats/f1"');
    expect(html).toContain(esc(t('preview.openFormat')));
    expect(html).not.toContain('<ol');
    expectNoLeftovers(html);
  });

  it('English wording', () => {
    expect(render(<AttachPreviewList preview={invalid} />)).toContain(
      'This version cannot be attached: it has errors. Open it in the editor to see them.',
    );
  });

  it('no link without a page to open', () => {
    expect(render(<AttachPreviewList preview={invalid} />)).not.toContain('<a ');
  });

  it('the first error code is not worded here', () => {
    expect(render(<AttachPreviewList preview={invalid} />)).not.toContain('schema_refine');
  });
});

describe('EngineGapList: one sentence per gap code', () => {
  const stageNames = { group: 'Group stage', finals: 'Finals' };
  const GAPS: Record<EngineGapCode, { gap: EngineGap; en: string; de: string }> = {
    override_unmapped: {
      gap: { code: 'override_unmapped', stage: 'finals', params: { round: 3, from: 'end', best_of: 5 } },
      en: 'Phase “Finals”: the best-of-5 exception for round 3 cannot be matched to a round of the phase and is ignored.',
      de: 'Phase „Finals“: Die Best-of-5-Ausnahme für Runde 3 passt zu keiner Runde der Phase und wird ignoriert.',
    },
    rr_legs_not_run: {
      gap: { code: 'rr_legs_not_run', stage: 'group', params: { legs: 2 } },
      en: 'Phase “Group stage”: only one round-robin leg is played (2 planned).',
      de: 'Phase „Group stage“: Es wird nur ein Durchgang der Jeder-gegen-jeden-Runde gespielt (2 geplant).',
    },
    third_place_not_run: {
      gap: { code: 'third_place_not_run', stage: 'finals', params: {} },
      en: 'Phase “Finals”: the third-place match is not played.',
      de: 'Phase „Finals“: Das Spiel um Platz 3 wird nicht gespielt.',
    },
    edge_select_not_run: {
      gap: { code: 'edge_select_not_run', stage: 'group', edge: 'to_finals', params: { kind: 'wildcard' } },
      en: 'Advancement “to_finals”: the selection “wildcards” is not run. An admin moves the players by hand.',
      de: 'Aufstieg „to_finals“: Die Auswahl „Wildcards“ wird nicht ausgeführt. Ein Admin verschiebt die Spieler von Hand.',
    },
    groups_not_created: {
      gap: { code: 'groups_not_created', stage: 'group', params: { count: 4, method: 'serpentine' } },
      en: 'Phase “Group stage”: the 4 groups are not created automatically.',
      de: 'Phase „Group stage“: Die 4 Gruppen werden nicht automatisch angelegt.',
    },
  };

  it.each(Object.entries(GAPS))('%s in English and German', (_code, { gap, en, de }) => {
    const htmlEn = render(<EngineGapList gaps={[gap]} stageNames={stageNames} />, 'en');
    const htmlDe = render(<EngineGapList gaps={[gap]} stageNames={stageNames} />, 'de');
    expect(htmlEn).toContain(esc(en));
    expect(htmlDe).toContain(esc(de));
    expect(htmlEn).toContain('Not run by the engine yet');
    expect(htmlDe).toContain('Von der Engine noch nicht umgesetzt');
    expectNoLeftovers(htmlEn);
    expectNoLeftovers(htmlDe);
  });

  it('a threshold selection is named a condition, a bottom-N selection by its words', () => {
    const base = { code: 'edge_select_not_run', stage: 'group', edge: 'e1' } as const;
    const html = render(
      <EngineGapList
        gaps={[
          { ...base, params: { kind: 'threshold' } },
          { ...base, params: { kind: 'bottom_n' } },
        ]}
        stageNames={stageNames}
      />,
    );
    expect(html).toContain('“condition”');
    expect(html).toContain('“bottom N”');
  });

  it('a phase the caller does not know is named by its key', () => {
    const html = render(<EngineGapList gaps={[GAPS.third_place_not_run.gap]} stageNames={{}} />);
    expect(html).toContain('Phase “finals”');
  });

  it('nothing at all without a gap', () => {
    expect(render(<EngineGapList gaps={[]} stageNames={{}} />)).toBe('');
  });
});
