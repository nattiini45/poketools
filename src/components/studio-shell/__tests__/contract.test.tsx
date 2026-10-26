/**
 * The shell contract (static markup): the toolbar, the dialog bodies and the banners render for BOTH studios from the
 * studio's own words: labelled controls, unique ids, a polite status, no placeholder left over, the studio's prefix on
 * its ids and its noun in the text. A third studio passes the same checks by supplying the same keys.
 */
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { expectLabelledControls, expectNoLeftovers, expectUniqueIds } from '@/test/markup';
import type { Locale } from '@/i18n/config';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { rulesetStudioEditorMessages } from '@/i18n/messages/ruleset-studio/editor';
import type { StudioActor } from '@/lib/studio-core/access';
import { ConflictDialogBody } from '../dialogs/ConflictDialog';
import { ForkDialogBody } from '../dialogs/ForkDialog';
import { PublishDialogBody } from '../dialogs/PublishDialog';
import { ShareDialogBody } from '../dialogs/ShareDialog';
import EditorToolbar from '../EditorToolbar';
import { SaveErrorAlert } from '../EditorLayout';
import { createShellText, type ShellText } from '../text';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

interface Studio {
  name: string;
  prefix: string;
  text: (locale: Locale) => ShellText;
  noun: Record<Locale, string>;
}

const STUDIOS: readonly Studio[] = [
  { name: 'format', prefix: 'fe', text: (locale) => createShellText(formatStudioEditorMessages, locale), noun: { en: 'format', de: 'Format' } },
  { name: 'ruleset', prefix: 're', text: (locale) => createShellText(rulesetStudioEditorMessages, locale), noun: { en: 'ruleset', de: 'Regelwerk' } },
];

const OWNER: StudioActor = { playerId: 'p1', isAdmin: false };
const DEFINITION = { kind: 'custom', owner_id: 'p1', visibility: 'private' } as const;

function toolbar(text: ShellText, over: Partial<ComponentProps<typeof EditorToolbar>> = {}) {
  return (
    <EditorToolbar
      text={text}
      name="My definition"
      save={{ status: 'idle' }}
      dirty={false}
      counts={{ errors: 0, warnings: 0, notes: 0 }}
      visibility="private"
      publishedVersion={null}
      canDelete
      backHref="/admin/things"
      readOnlyHref="/admin/things/abc"
      onSave={() => undefined}
      onPublish={() => undefined}
      onShare={() => undefined}
      onFork={() => undefined}
      onDelete={() => undefined}
      {...over}
    />
  );
}

describe.each(STUDIOS)('the shell in the $name studio', (studio) => {
  describe.each(['en', 'de'] as const)('(%s)', (locale) => {
    const text = studio.text(locale);
    const render = (ui: ReactNode) => renderWithI18n(<>{ui}</>, { locale });

    it('the toolbar says in words where the draft stands, with a polite status and a named action group', () => {
      const html = render(toolbar(text));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('data-save-status="idle"');
      expect(html).toContain(`aria-label="${text('toolbar.actions')}"`);
      expect(html).toContain(text('toolbar.back'));
      expect(html).toContain(text('toolbar.noIssues'));
      expect(html).toContain(text('toolbar.draftOnly'));
      expect(html).toContain(text('toolbar.delete'));
      expect(html.toLowerCase()).toContain(studio.noun[locale].toLowerCase());
      expectNoLeftovers(html);
    });

    it('the toolbar shows issue counts as text, the published version, and no Delete when not allowed', () => {
      const html = render(toolbar(text, { counts: { errors: 2, warnings: 1, notes: 0 }, publishedVersion: 4, canDelete: false, dirty: true }));
      expect(html).toContain(text('toolbar.issues.errors', { count: 2 }));
      expect(html).toContain(text('toolbar.issues.warnings', { count: 1 }));
      expect(html).toContain(text('toolbar.version', { n: 4 }));
      expect(html).toContain(text('toolbar.unsaved'));
      expect(html).not.toContain(`>${text('toolbar.delete')}<`);
      expect(html).not.toContain(text('toolbar.noIssues'));
    });

    it('the share dialog uses the studio\'s prefix on every id and labels every radio', () => {
      const html = render(
        <ShareDialogBody
          text={text}
          idPrefix={studio.prefix}
          actor={OWNER}
          definition={DEFINITION}
          hasPublished
          selected="private"
          onSelect={() => undefined}
          busy={false}
          error={null}
          onApply={() => undefined}
          onClose={() => undefined}
        />,
      );
      expect(html).toContain(`id="${studio.prefix}-share-private"`);
      expect(html).toContain(`id="${studio.prefix}-share-league"`);
      expect(html).not.toContain(`id="${studio.prefix}-share-gallery"`);
      expect(html).toContain(text('share.privateHelp'));
      expectLabelledControls(html);
      expectUniqueIds(html);
      expectNoLeftovers(html);
    });

    it('the publish dialog body takes the studio\'s summary and prefix, blocks on errors with a described reason', () => {
      const html = render(
        <PublishDialogBody
          text={text}
          idPrefix={studio.prefix}
          summary={<p>SUMMARY-SLOT</p>}
          gate={{ allowed: false, reason: 'errors' }}
          errorCount={2}
          dirty
          nextVersion={3}
          publishedVersion={2}
          changelog={{ en: '', de: '' }}
          onChangelog={() => undefined}
          busy={false}
          error={null}
          doneVersion={null}
          readOnlyHref="/admin/things/abc"
          onPublish={() => undefined}
          onClose={() => undefined}
        />,
      );
      expect(html).toContain('SUMMARY-SLOT');
      expect(html).toContain(text('publish.creates', { n: 3 }));
      expect(html).toContain(text('publish.blocked', { count: 2 }));
      expect(html).toContain(text('publish.savesFirst'));
      expect(html).toContain(`id="${studio.prefix}-publish-reason"`);
      expect(html).toContain(`aria-describedby="${studio.prefix}-publish-reason"`);
      expect(html).toContain(`id="${studio.prefix}-changelog-en"`);
      expectLabelledControls(html);
      expectUniqueIds(html);
      expectNoLeftovers(html);
    });

    it('the publish dialog success state links to the read-only view', () => {
      const html = render(
        <PublishDialogBody
          text={text}
          idPrefix={studio.prefix}
          summary={null}
          gate={{ allowed: true, reason: null }}
          errorCount={0}
          dirty={false}
          nextVersion={2}
          publishedVersion={1}
          changelog={{ en: '', de: '' }}
          onChangelog={() => undefined}
          busy={false}
          error={null}
          doneVersion={2}
          readOnlyHref="/admin/things/abc"
          onPublish={() => undefined}
          onClose={() => undefined}
        />,
      );
      expect(html).toContain(text('publish.done', { n: 2 }));
      expect(html).toContain('href="/admin/things/abc"');
      expect(html).not.toContain('changelog-en');
    });

    it('the conflict and fork dialog bodies name the revision and the actions', () => {
      const conflict = render(
        <ConflictDialogBody text={text} serverRev={7} dirty step="choose" busy={false} error={null} onReload={() => undefined} onConfirmReload={() => undefined} onKeepMine={() => undefined} onCancel={() => undefined} />,
      );
      expect(conflict).toContain(text('save.conflictBody', { rev: 7 }));
      expect(conflict).toContain(`>${text('save.keepMine')}<`);
      expectNoLeftovers(conflict);

      const fork = render(<ForkDialogBody text={text} busy={false} error={{ code: 'network_error' }} onConfirm={() => undefined} onClose={() => undefined} />);
      expect(fork).toContain(text('fork.body'));
      expect(fork).toContain(`>${text('fork.confirm')}<`);
      expect(fork).toContain('role="alert"');
    });

    it('the save error banner offers a retry, and renders nothing for any other save state', () => {
      const failed = render(<SaveErrorAlert text={text} save={{ status: 'error', error: { code: 'network_error' } }} onRetry={() => undefined} />);
      expect(failed).toContain(text('save.failed'));
      expect(failed).toContain(`>${text('save.retry')}<`);
      expect(render(<SaveErrorAlert text={text} save={{ status: 'saved', at: '2026-10-01T10:00:00Z' }} onRetry={() => undefined} />)).toBe('');
    });
  });
});
