'use client';

import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useFormatter, useT } from '@/i18n/client';
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import type { SaveState } from '@/lib/format-studio/editor/state';
import type { FormatVisibility } from '@/lib/format-studio/library-types';

interface EditorToolbarProps {
  /** The format's name in the viewer's language. */
  name: string;
  save: SaveState;
  dirty: boolean;
  counts: { errors: number; warnings: number; notes: number };
  visibility: FormatVisibility;
  /** The newest published version, or null when nothing is published. */
  publishedVersion: number | null;
  /** The viewer may delete the format and it has no published version. */
  canDelete: boolean;
  backHref: string;
  readOnlyHref: string;
  onSave: () => void;
  onPublish: () => void;
  onShare: () => void;
  onFork: () => void;
  onDelete: () => void;
}

const LINK = 'inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0';
const BUTTON = 'min-h-11 sm:min-h-0';

/**
 * The bar above the editor: the format's name, a status chip that says in words whether the draft is saved,
 * the issue counts as text, and the actions. Buttons wrap on narrow screens and keep a 44px touch target.
 */
export default function EditorToolbar({
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
  const t = useT(formatStudioEditorMessages);
  const format = useFormatter();

  const status = (() => {
    if (save.status === 'saving') return t('toolbar.saving');
    if (save.status === 'conflict') return t('toolbar.conflict');
    if (dirty) return t('toolbar.unsaved');
    if (save.status === 'saved') return t('toolbar.savedAt', { time: format.instant(save.at, 'time') });
    return t('toolbar.saved');
  })();
  const none = counts.errors + counts.warnings + counts.notes === 0;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href={backHref} className={LINK}>
          {t('toolbar.back')}
        </Link>
        <Link href={readOnlyHref} className={LINK}>
          {t('toolbar.readOnly')}
        </Link>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 break-words font-heading text-lg font-bold text-poke-text-primary">{name}</p>
        <Badge variant={dirty || save.status === 'conflict' ? 'yellow' : 'green'} role="status" aria-live="polite" data-save-status={save.status}>
          {status}
        </Badge>
        <Badge variant="gray">{t(`toolbar.visibility.${visibility}`)}</Badge>
        <Badge variant="gray">{publishedVersion === null ? t('toolbar.draftOnly') : t('toolbar.version', { n: publishedVersion })}</Badge>
        {counts.errors > 0 && <Badge variant="red">{t('toolbar.issues.errors', { count: counts.errors })}</Badge>}
        {counts.warnings > 0 && <Badge variant="yellow">{t('toolbar.issues.warnings', { count: counts.warnings })}</Badge>}
        {counts.notes > 0 && <Badge variant="blue">{t('toolbar.issues.notes', { count: counts.notes })}</Badge>}
        {none && <Badge variant="green">{t('toolbar.noIssues')}</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('toolbar.actions')}>
        <Button type="button" variant="primary" size="sm" className={BUTTON} loading={save.status === 'saving'} onClick={onSave}>
          {t('toolbar.save')}
        </Button>
        <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={onPublish}>
          {t('toolbar.publish')}
        </Button>
        <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={onShare}>
          {t('toolbar.share')}
        </Button>
        <Button type="button" variant="secondary" size="sm" className={BUTTON} onClick={onFork}>
          {t('toolbar.fork')}
        </Button>
        {canDelete && (
          <Button type="button" variant="danger" size="sm" className={BUTTON} onClick={onDelete}>
            {t('toolbar.delete')}
          </Button>
        )}
      </div>
    </div>
  );
}
