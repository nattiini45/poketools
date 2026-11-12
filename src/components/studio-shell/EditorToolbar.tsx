'use client';

import Link from 'next/link';
import { PanelRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';
import { useFormatter } from '@/i18n/client';
import type { StudioVisibility } from '@/lib/studio-core/access';
import type { SaveState } from '@/lib/studio-core/editor-state';
import { usePreviewDrawer } from './EditorLayout';
import type { ShellText } from './text';

export interface EditorToolbarProps {
  /** The studio's words (`useShellText`). */
  text: ShellText;
  /** The definition's name in the viewer's language. */
  name: string;
  save: SaveState;
  dirty: boolean;
  counts: { errors: number; warnings: number; notes: number };
  visibility: StudioVisibility;
  /** The newest published version, or null when nothing is published. */
  publishedVersion: number | null;
  /** The viewer may delete the definition and it has no published version. */
  canDelete: boolean;
  backHref: string;
  readOnlyHref: string;
  onSave: () => void;
  onPublish: () => void;
  onShare: () => void;
  onFork: () => void;
  onDelete: () => void;
}

const LINK = 'inline-flex min-h-11 items-center text-sm font-medium text-accent-ink hover:underline sm:min-h-0';
const BUTTON = 'min-h-11 sm:min-h-0';

/**
 * The bar above a studio editor, sticky under the admin top bar: the definition's name, a status plate that says in words
 * whether the draft is saved, the issue counts as text, and the actions (Save draft with Ctrl/Cmd+S, Publish, then the
 * quieter ones). Everything wraps on narrow screens and keeps a 44px touch target.
 */
export default function EditorToolbar({
  text,
  name,
  save,
  dirty,
  counts,
  visibility,
  publishedVersion,
  canDelete,
  backHref,
  readOnlyHref,
  onSave,
  onPublish,
  onShare,
  onFork,
  onDelete,
}: EditorToolbarProps) {
  const format = useFormatter();
  const drawer = usePreviewDrawer();

  const status = (() => {
    if (save.status === 'saving') return text('toolbar.saving');
    if (save.status === 'conflict') return text('toolbar.conflict');
    if (dirty) return text('toolbar.unsaved');
    if (save.status === 'saved') return text('toolbar.savedAt', { time: format.instant(save.at, 'time') });
    return text('toolbar.saved');
  })();
  const none = counts.errors + counts.warnings + counts.notes === 0;

  return (
    <div className="sticky top-14 z-20 -mx-1 min-w-0 space-y-2 border-b border-hairline bg-page px-1 pb-3 pt-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={backHref} className={LINK}>
          {text('toolbar.back')}
        </Link>
        <Link href={readOnlyHref} className={LINK}>
          {text('toolbar.readOnly')}
        </Link>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 break-words font-heading text-title text-fg">{name}</p>
          <span role="status" aria-live="polite" data-save-status={save.status}>
            <SkewChip tone={dirty || save.status === 'conflict' ? 'accent' : 'win'}>{status}</SkewChip>
          </span>
          <SkewChip>{text(`toolbar.visibility.${visibility}`)}</SkewChip>
          <SkewChip>{publishedVersion === null ? text('toolbar.draftOnly') : text('toolbar.version', { n: publishedVersion })}</SkewChip>
          {counts.errors > 0 && <SkewChip tone="loss">{text('toolbar.issues.errors', { count: counts.errors })}</SkewChip>}
          {counts.warnings > 0 && <SkewChip tone="accent">{text('toolbar.issues.warnings', { count: counts.warnings })}</SkewChip>}
          {counts.notes > 0 && <SkewChip>{text('toolbar.issues.notes', { count: counts.notes })}</SkewChip>}
          {none && <SkewChip tone="win">{text('toolbar.noIssues')}</SkewChip>}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={text('toolbar.actions')}>
          <Button type="button" variant="primary" size="sm" className={BUTTON} loading={save.status === 'saving'} aria-keyshortcuts="Control+S Meta+S" onClick={onSave}>
            {text('toolbar.save')}
          </Button>
          <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={onPublish}>
            {text('toolbar.publish')}
          </Button>
          <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={onShare}>
            {text('toolbar.share')}
          </Button>
          <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={onFork}>
            {text('toolbar.fork')}
          </Button>
          {drawer !== null && (
            <Button
              id={drawer.toggleId}
              type="button"
              variant="secondary"
              size="sm"
              className={BUTTON}
              aria-expanded={drawer.open}
              aria-controls={drawer.drawerId}
              onClick={drawer.toggle}
            >
              <PanelRight className="h-4 w-4" aria-hidden="true" />
              {drawer.label}
            </Button>
          )}
          {canDelete && (
            <Button type="button" variant="danger" size="sm" className={BUTTON} onClick={onDelete}>
              {text('toolbar.delete')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
