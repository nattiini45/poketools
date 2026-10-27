/**
 * The publish dialog body (static markup, not the Radix portal): what a publish will do, the block on errors,
 * warnings that do not block, "nothing changed", the changelog fields and the success state.
 */
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { PublishDialogBody as ShellPublishDialogBody, changelogText } from '@/components/studio-shell/dialogs/PublishDialog';
import { useShellText } from '@/components/studio-shell/text';
import type { Locale } from '@/i18n/config';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { renderDiagnostic, type CompileResult } from '@/lib/format-kit/client';
import type { DraftDocument } from '@/lib/format-studio/editor/document';
import { setBestOf, setScoreValue, updateStage } from '@/lib/format-studio/editor/ops';
import { publishGate } from '@/lib/format-studio/editor/preview';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import PublishSummary from '../../editor/dialogs/PublishSummary';
import { compiled, esc, expectLabelledControls, expectNoLeftovers, presetDoc } from './test-helpers';

/** The shared dialog body with the Format Studio's words, ids and compile summary. */
function PublishDialogBody({
  doc,
  result,
  ...rest
}: { doc: DraftDocument; result: CompileResult } & Omit<ComponentProps<typeof ShellPublishDialogBody>, 'text' | 'idPrefix' | 'summary' | 'errorCount'>) {
  return (
    <ShellPublishDialogBody
      text={useShellText(formatStudioEditorMessages)}
      idPrefix="fe"
      summary={<PublishSummary doc={doc} result={result} />}
      errorCount={result.diagnostics.filter((d) => d.severity === 'error').length}
      {...rest}
    />
  );
}

interface Over {
  doc?: DraftDocument;
  publishedHash?: string | null;
  publishedVersion?: number | null;
  dirty?: boolean;
  busy?: boolean;
  doneVersion?: number | null;
  error?: { code: string; params?: Record<string, string | number> } | null;
  locale?: Locale;
}

function render(over: Over = {}) {
  const doc = over.doc ?? presetDoc();
  const result = compiled(doc);
  const gate = publishGate(result, over.publishedHash ?? null);
  const html = renderWithI18n(
    <PublishDialogBody
      doc={doc}
      result={result}
      gate={gate}
      dirty={over.dirty ?? false}
      nextVersion={(over.publishedVersion ?? 0) + 1}
      publishedVersion={over.publishedVersion ?? null}
      changelog={{ en: '', de: '' }}
      onChangelog={() => undefined}
      busy={over.busy ?? false}
      error={over.error ?? null}
      doneVersion={over.doneVersion ?? null}
      readOnlyHref="/admin/formats/abc"
      onPublish={() => undefined}
      onClose={() => undefined}
    />,
    { locale: over.locale ?? 'en' },
  );
  return { html, result, gate, doc };
}

describe('PublishDialogBody', () => {
  it('a clean draft can be published: version number, coverage, an enabled Publish button', () => {
    const { html, gate } = render();
    expect(gate.allowed).toBe(true);
    expect(html).toContain('This creates version 1.');
    expect(html).toContain('automated');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Publish</);
    expect(html).not.toContain('fe-publish-reason');
    expectNoLeftovers(html);
  });

  it('a draft with errors lists them as sentences and blocks Publish with a described reason', () => {
    const doc = updateStage(presetDoc(), 1, (s) => setBestOf(s, 2));
    const { html, result, gate } = render({ doc });
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(gate).toEqual({ allowed: false, reason: 'errors' });
    for (const error of errors) expect(html).toContain(esc(renderDiagnostic(error, 'en', doc)));
    expect(html).toMatch(/<button[^>]*aria-describedby="fe-publish-reason"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-describedby="fe-publish-reason"/);
    expect(html).toContain('id="fe-publish-reason"');
    expect(html).toContain(errors.length === 1 ? 'Fix 1 error before publishing.' : `Fix ${errors.length} errors before publishing.`);
    expect(render({ doc, locale: 'de' }).html).toContain('vor dem Veröffentlichen');
  });

  it('warnings are listed and do not block', () => {
    const doc = updateStage(presetDoc(), 0, (s) => setScoreValue(s, 'win', 0));
    const { html, result, gate } = render({ doc });
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    expect(gate).toEqual({ allowed: true, reason: null });
    for (const warning of warnings) expect(html).toContain(esc(renderDiagnostic(warning, 'en', doc)));
    expect(html).not.toContain('fe-publish-reason');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Publish</);
  });

  it('a draft equal to the published version says nothing changed and blocks Publish', () => {
    const first = render();
    const { html, gate } = render({ publishedHash: first.result.hash, publishedVersion: 3 });
    expect(gate).toEqual({ allowed: false, reason: 'nothing_new' });
    expect(html).toContain('Nothing changed since version 3.');
    expect(html).toContain('This creates version 4.');
    expect(html).toMatch(/disabled=""/);
  });

  it('says unsaved changes are saved first, only when there are some', () => {
    expect(render({ dirty: true }).html).toContain('Your unsaved changes are saved first.');
    expect(render({ dirty: false }).html).not.toContain('saved first');
    expect(render({ dirty: true, locale: 'de' }).html).toContain('werden zuerst gespeichert');
  });

  it.each(['en', 'de'] as const)('has an English and a German changelog field, both labelled (%s)', (locale) => {
    const { html } = render({ locale });
    expect(html).toContain('id="fe-changelog-en"');
    expect(html).toContain('id="fe-changelog-de"');
    expect(html).toContain('maxLength="4000"');
    expectLabelledControls(html);
  });

  it('shows the error of a failed publish in an alert, in the viewer language', () => {
    const en = render({ error: { code: 'format_publish_invalid', params: { count: 2 } } }).html;
    expect(en).toContain('role="alert"');
    expect(en).toMatch(/2 errors/);
    const de = render({ error: { code: 'rate_limited', params: { seconds: 30 } }, locale: 'de' }).html;
    expect(de).toContain('role="alert"');
    expect(de).toContain('30');
  });

  it('the success state names the version, links to the read-only view and points to Share', () => {
    const { html } = render({ doneVersion: 2 });
    expect(html).toContain('Published version 2.');
    expect(html).toContain('href="/admin/formats/abc"');
    expect(html).toContain('Share it with other admins from Share….');
    expect(html).not.toContain('fe-changelog-en');
  });
});

describe('changelogText', () => {
  it('sends nothing for two empty fields', () => {
    expect(changelogText({ en: ' ', de: '' }, 'en')).toBeUndefined();
  });

  it('sends only the languages with text, based on the author language when it has some', () => {
    expect(changelogText({ en: 'Fixed', de: '' }, 'en')).toEqual({ base: 'en', en: { v: 'Fixed', s: 'human' } });
    expect(changelogText({ en: 'Fixed', de: 'Behoben' }, 'de')).toEqual({
      base: 'de',
      en: { v: 'Fixed', s: 'human' },
      de: { v: 'Behoben', s: 'human' },
    });
  });

  it('falls back to the other language as the base when the author language is empty', () => {
    expect(changelogText({ en: '', de: 'Behoben' }, 'en')).toEqual({ base: 'de', de: { v: 'Behoben', s: 'human' } });
    expect(changelogText({ en: 'Fixed', de: '' }, 'de')).toEqual({ base: 'en', en: { v: 'Fixed', s: 'human' } });
  });
});
