/**
 * `FormatDetail` (renderToStaticMarkup, no DOM): the read-only view of one format. The view is built the way the
 * loader builds it (descriptor or preset, compiled, `toFormatView`); the expectations come from the same pure
 * renderer the component calls, so a copy change in the catalogs does not break them, while a lost section does.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import type { Locale } from '@/i18n/config';
import {
  PRESETS,
  compile,
  describeDefinition,
  renderDiagnostic,
  renderSeverity,
  resolveLText,
  type FormatDefinition,
} from '@/lib/format-kit/client';
import { describeLegacy } from '@/lib/format-studio/legacy/describe-legacy';
import { legacyCompileEnv, toFormatView, type FormatView } from '@/lib/format-studio/view';
import { FIXTURE_LEAGUES } from '@/lib/format-studio/__tests__/fixtures/leagues';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import FormatDetail from '../FormatDetail';

/** What React writes for a text child. */
const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const classic = PRESETS.find((p) => p.id === 'classic-league')!.definition;

function presetView(definition: FormatDefinition = classic): FormatView {
  return toFormatView(compile(definition));
}

function legacyView(name: string): FormatView {
  const input = FIXTURE_LEAGUES[name];
  return toFormatView(compile(describeLegacy(input), legacyCompileEnv(input.season.participantCount)));
}

function opts(view: FormatView) {
  return { plan: view.plan ?? undefined, order: view.order, rulesets: view.rulesets };
}

function render(view: FormatView, locale: Locale = 'en', props: { example?: boolean; variant?: 'page' | 'tab'; editorLinks?: Record<string, string> } = {}) {
  return renderWithI18n(<FormatDetail view={view} variant={props.variant ?? 'page'} example={props.example} editorLinks={props.editorLinks} />, {
    locale,
  });
}

const stageNames = (definition: FormatDefinition, locale: Locale) =>
  definition.stages.map((s) => resolveLText(s.name, { viewer: locale })?.value ?? s.key);

describe('FormatDetail: a preset', () => {
  it.each(['en', 'de'] as const)('shows every stage name, the rules text and the coverage line in %s', (locale) => {
    const view = presetView();
    const html = render(view, locale);
    for (const name of stageNames(classic, locale)) expect(html).toContain(esc(name));
    const doc = describeDefinition(view.definition!, locale, opts(view));
    expect(html).toContain(esc(doc.overview));
    expect(html).toContain(esc(doc.coverageLine));
    expect(html).not.toMatch(/undefined|\[object|\{[a-z_]+\}/);
  });

  it('starts the rules text in the viewer language and marks that button pressed', () => {
    const en = render(presetView(), 'en');
    expect(en).toMatch(/aria-pressed="true"[^>]*>English</);
    expect(en).toMatch(/aria-pressed="false"[^>]*>Deutsch</);
    const de = render(presetView(), 'de');
    expect(de).toMatch(/aria-pressed="false"[^>]*>English</);
    expect(de).toMatch(/aria-pressed="true"[^>]*>Deutsch</);
    expect(de).toContain(esc(describeDefinition(presetView().definition!, 'de', opts(presetView())).overview));
    expect(de).not.toContain(esc(describeDefinition(presetView().definition!, 'en', opts(presetView())).overview));
  });

  it('gives the toggle exactly two buttons with aria-pressed, in a labelled group', () => {
    const html = render(presetView());
    expect(html.match(/aria-pressed=/g)).toHaveLength(2);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Language of the rules text"');
  });

  it('shows the example label and the read-only note only for an example', () => {
    expect(render(presetView(), 'en', { example: true })).toContain('>Example<');
    expect(render(presetView(), 'en', { example: true })).toContain('Examples are read-only.');
    expect(render(presetView(), 'en', { example: true })).not.toContain('Change anything');
    expect(render(presetView(), 'en')).not.toContain('>Example<');
    expect(render(presetView(), 'de', { example: true })).toContain('>Beispiel<');
    expect(render(presetView(), 'de', { example: true })).not.toContain('Ändere alles');
    expect(render(presetView(), 'de')).not.toContain('>Beispiel<');
  });

  it('says plainly that there are no problems when the format is clean', () => {
    const clean = legacyView('draft_double_elim');
    expect(clean.diagnostics).toEqual([]);
    expect(render(clean, 'en')).toContain('No problems found.');
    expect(render(clean, 'de')).toContain('Keine Probleme gefunden.');
  });

  it('has headings for the sections in both languages', () => {
    const en = render(presetView(), 'en');
    for (const heading of ['Stages', 'Rules text', 'Checks', 'Coverage']) expect(en).toContain(`>${heading}<`);
    const de = render(presetView(), 'de');
    for (const heading of ['Stages', 'Regeltext', 'Prüfungen', 'Abdeckung']) expect(de).toContain(`>${heading}<`);
  });

  it('puts the advancement sentences between the stage cards', () => {
    const view = presetView();
    const doc = describeDefinition(view.definition!, 'en', opts(view));
    const outgoing = doc.stages.flatMap((s) => s.outgoing);
    expect(outgoing.length).toBeGreaterThan(0);
    for (const sentence of outgoing) expect(render(view)).toContain(esc(sentence));
  });
});

describe('FormatDetail: diagnostics', () => {
  function evenBestOf(): FormatView {
    const def = structuredClone(classic);
    def.stages[0].series.best_of = 2;
    return presetView(def);
  }

  it.each(['en', 'de'] as const)('writes each finding as a sentence with its severity word in %s', (locale) => {
    const view = evenBestOf();
    const errors = view.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    const html = render(view, locale);
    for (const d of view.diagnostics) {
      expect(html).toContain(esc(renderDiagnostic(d, locale, view.definition!)));
      expect(html).toContain(esc(renderSeverity(d.severity, locale)));
    }
    expect(html).not.toContain('No problems found.');
    expect(html).not.toContain('Keine Probleme gefunden.');
  });

  it('counts the findings in words, not only colour', () => {
    const html = render(evenBestOf(), 'en');
    expect(html).toMatch(/1 error/);
    expect(render(evenBestOf(), 'de')).toMatch(/1 Fehler/);
  });

  it('offers no fix: nothing is editable', () => {
    const view = evenBestOf();
    expect(view.diagnostics.some((d) => d.fixes.length > 0)).toBe(true);
    const html = render(view);
    expect(html).not.toMatch(/<form|type="submit"/);
    expect(html.match(/<button/g)).toHaveLength(2); // the language toggle only
  });
});

describe('FormatDetail: legacy modules', () => {
  const links = { epb: '/admin/leagues/league-1?tab=rules' };

  it('shows the module facts as a read-only table and links to where they are edited', () => {
    const view = legacyView('epb_two_stage');
    const doc = describeDefinition(view.definition!, 'en', opts(view));
    expect(doc.modules.length).toBeGreaterThan(0);
    const html = render(view, 'en', { editorLinks: links });
    expect(html).toContain('<table');
    expect(html).toContain('overflow-x-auto');
    for (const fact of doc.modules[0].facts) {
      expect(html).toContain(esc(fact.label));
    }
    expect(html).toContain('href="/admin/leagues/league-1?tab=rules"');
    expect(html).toContain('Open in the league admin');
    expect(html).toContain('Change them in the league admin');
  });

  it('shows the note without a link when the adapter has none', () => {
    const html = render(legacyView('epb_two_stage'), 'en');
    expect(html).toContain('Change them in the league admin');
    expect(html).not.toContain('Open in the league admin');
  });

  it('is in German too', () => {
    const html = render(legacyView('epb_two_stage'), 'de', { editorLinks: links });
    expect(html).toContain('Im Liga-Admin öffnen');
    expect(html).toContain('Aus der Liga gelesene Einstellungen');
  });

  it('has no module section for a league without modules', () => {
    expect(render(presetView())).not.toContain('<table');
  });
});

describe('FormatDetail: no definition', () => {
  const broken = toFormatView(compile({ schema_version: 1 }));

  it('shows the alert and the diagnostics only', () => {
    expect(broken.definition).toBeNull();
    expect(broken.diagnostics.length).toBeGreaterThan(0);
    const html = render(broken, 'en');
    expect(html).toContain('role="alert"');
    expect(html).toContain('This format could not be shown');
    for (const d of broken.diagnostics) expect(html).toContain(esc(renderDiagnostic(d, 'en')));
    expect(html).not.toContain('Rules text');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('<ol');
  });

  it('is in German too', () => {
    expect(render(broken, 'de')).toContain('Dieses Format konnte nicht angezeigt werden');
  });
});

describe('FormatDetail: layout', () => {
  it('has no horizontal overflow on the wrapper and no fixed dark slab', () => {
    const html = render(legacyView('epb_two_stage'), 'en', { editorLinks: {} });
    const wrapper = /^<div class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(wrapper).not.toMatch(/overflow-x|w-screen|min-w-\[|w-\[/);
    expect(html).not.toMatch(/bg-(black|gray-9|slate-9|zinc-9|neutral-9)/);
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('wraps the module table in a scroll container so a wide table never widens the page', () => {
    const html = render(legacyView('epb_two_stage'));
    expect(html).toMatch(/<div class="overflow-x-auto"><table/);
  });

  it('names the format in the tab and leaves that to the page title on a page', () => {
    const view = presetView();
    const title = describeDefinition(view.definition!, 'en', opts(view)).title;
    expect(render(view, 'en', { variant: 'tab' })).toContain(`<h3 class="break-words font-heading text-lg font-bold text-poke-text-primary">${esc(title)}</h3>`);
    expect(render(view, 'en', { variant: 'page' })).not.toContain(`text-poke-text-primary">${esc(title)}</h3>`);
  });
});

/** The heading levels in document order. */
const headingLevels = (html: string) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

/** True when no heading jumps down more than one level below the one before it (and the first is `first`). */
function isContinuous(levels: number[], first: number): boolean {
  return levels.length > 0 && levels[0] === first && levels.every((level, i) => i === 0 || level <= levels[i - 1] + 1);
}

describe('FormatDetail: heading levels', () => {
  const views: [string, () => FormatView][] = [
    ['a preset', () => presetView()],
    ['a legacy league with settings', () => legacyView('epb_two_stage')],
  ];

  it.each(views)('page variant under the page title (%s): blocks are h2, what they hold is h3, nothing skips', (_name, make) => {
    const html = render(make(), 'en', { variant: 'page', editorLinks: {} });
    const levels = headingLevels(html);
    expect(isContinuous(levels, 2)).toBe(true);
    expect(levels).toContain(2);
    expect(levels).toContain(3);
    expect(levels.every((level) => level === 2 || level === 3)).toBe(true);
  });

  it.each(views)('tab variant under the tab section (%s): the format name and blocks are h3, what they hold is h4', (_name, make) => {
    const html = render(make(), 'en', { variant: 'tab', editorLinks: {} });
    const levels = headingLevels(html);
    expect(isContinuous(levels, 3)).toBe(true);
    expect(levels).toContain(4);
    expect(levels.every((level) => level === 3 || level === 4)).toBe(true);
  });

  it('renders the stage cards, the rules text sections and the module cards one level below their block', () => {
    const view = legacyView('epb_two_stage');
    const doc = describeDefinition(view.definition!, 'en', opts(view));
    const stageName = esc(doc.stages[0].name);
    const moduleLabel = esc(doc.modules[0].label);
    const page = render(view, 'en', { variant: 'page', editorLinks: {} });
    const tab = render(view, 'en', { variant: 'tab', editorLinks: {} });
    expect(page).toMatch(new RegExp(`<h3[^>]*>(?:<span[^>]*>[^<]*</span>)*<span[^>]*>${stageName}</span></h3>`));
    expect(page).toMatch(new RegExp(`<h3 class="font-heading font-semibold text-poke-text-primary">${moduleLabel}</h3>`));
    expect(page).toContain('<h3 class="font-heading font-semibold">Stages</h3>');
    expect(tab).toMatch(new RegExp(`<h4[^>]*>(?:<span[^>]*>[^<]*</span>)*<span[^>]*>${stageName}</span></h4>`));
    expect(tab).toContain(`<h4 class="font-heading font-semibold text-poke-text-primary">${moduleLabel}</h4>`);
    expect(tab).toContain('<h4 class="font-heading font-semibold">Stages</h4>');
  });

  it('keeps the diagnostics-only view continuous too', () => {
    const broken = toFormatView(compile({ schema_version: 1 }));
    expect(isContinuous(headingLevels(render(broken, 'en', { variant: 'page' })), 2)).toBe(true);
    expect(isContinuous(headingLevels(render(broken, 'en', { variant: 'tab' })), 3)).toBe(true);
  });
});

describe('FormatDetail: language of the rules text', () => {
  /** The opening tag of the element carrying `lang`, and everything before it. */
  const langTags = (html: string) => [...html.matchAll(/<[a-z0-9]+[^>]*\slang="([a-z]+)"[^>]*>/g)];

  it.each([
    ['en', 'en'],
    ['de', 'de'],
  ] as const)('puts lang only on the text container, with the selected language (viewer %s)', (viewer, expected) => {
    const view = presetView();
    const html = render(view, viewer);
    const tags = langTags(html);
    expect(tags).toHaveLength(1);
    expect(tags[0][1]).toBe(expected);
    const at = html.indexOf(tags[0][0]);
    const overview = esc(describeDefinition(view.definition!, expected, opts(view)).overview);
    // The container holds the generated text and its headings; the toggle and the block heading sit before it.
    expect(html.indexOf(overview)).toBeGreaterThan(at);
    expect(html.indexOf('role="group"')).toBeLessThan(at);
    expect(html.indexOf('>Rules text<') === -1 ? html.indexOf('>Regeltext<') : html.indexOf('>Rules text<')).toBeLessThan(at);
    expect(tags[0][0]).not.toContain('role="group"');
    expect(tags[0][0]).not.toContain('aria-pressed');
  });

  it('leaves the toggle, its buttons and the headings outside the text container without lang', () => {
    const html = render(presetView(), 'de');
    const group = /<div role="group"[^>]*>/.exec(html)?.[0] ?? '';
    expect(group).not.toBe('');
    expect(group).not.toContain('lang=');
    for (const button of html.match(/<button[^>]*>/g) ?? []) expect(button).not.toContain('lang=');
    // The wrapper that holds toggle and text carries no lang either.
    expect(html).not.toMatch(/<div class="space-y-3" lang=/);
  });

  it('announces a language switch politely through a status line that is empty until a button is pressed', () => {
    const html = render(presetView(), 'en');
    expect(html).toContain('<p role="status" aria-live="polite" class="sr-only"></p>');
    expect(langTags(html.replace(/<p role="status"[^>]*>.*?<\/p>/, ''))).toHaveLength(1);
  });

  it('has the announcements in English and German', () => {
    expect(formatStudioAdminMessages.en.detail.rulesShownEn).toBe('Rules text shown in English.');
    expect(formatStudioAdminMessages.en.detail.rulesShownDe).toBe('Rules text shown in German.');
    expect(formatStudioAdminMessages.de.detail.rulesShownEn).toBe('Regeltext wird auf Englisch angezeigt.');
    expect(formatStudioAdminMessages.de.detail.rulesShownDe).toBe('Regeltext wird auf Deutsch angezeigt.');
  });
});
