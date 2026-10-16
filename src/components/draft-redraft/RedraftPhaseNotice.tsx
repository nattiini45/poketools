'use client';

/**
 * The draft room's redraft notice (draft-frontend §3.1, §6.1): shown above
 * the read-only finder while the redraft collects its secret drops. A client
 * leaf so the server page can render it (it reads the language through hooks
 * and shows the deadline with `<LocalTime zone="both">`).
 */
import Link from 'next/link';
import { useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { draftRedraftMessages } from '@/i18n/messages/draft/redraft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftSnapshotRedraft } from '@/types/draft-queue';

export interface RedraftPhaseNoticeProps {
  phase: DraftSnapshotRedraft['phase'];
  /** ISO UTC; null when no deadline is set yet. */
  deadlineAt: string | null;
  links: { redraft: string };
}

export default function RedraftPhaseNotice({ phase, deadlineAt, links }: RedraftPhaseNoticeProps) {
  const t = useT(draftRedraftMessages);
  const tGlossary = useT(glossaryMessages);
  if (phase !== 'submissions' && phase !== 'locked') return null;

  return (
    <div role="status" className="mb-4 flex flex-col gap-1 rounded-lg border border-poke-border bg-poke-card p-3 text-sm">
      <p>{phase === 'submissions' ? t('notice.submissions') : t('notice.locked')}</p>
      {phase === 'submissions' && deadlineAt ? (
        <p className="text-poke-text-secondary">
          <span className="font-semibold">{tGlossary('draft.deadline')}: </span>
          <LocalTime value={deadlineAt} preset="weekdayDateTime" zone="both" />
        </p>
      ) : null}
      <Link href={links.redraft} className="text-poke-blue hover:underline">
        {t('notice.link')}
      </Link>
    </div>
  );
}
