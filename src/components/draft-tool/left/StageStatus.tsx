'use client';

/**
 * The left stage's status strip: one slim row above the info box for the two
 * states that are not about the pinned line, a lost connection (the screen
 * shows the last known state) and spectating (a guest, or a signed-in viewer
 * who is not in this league). Icon plus small text, no boxes, so the line
 * stays the first thing in the pane. Renders nothing when neither applies.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Eye, WifiOff } from 'lucide-react';
import { useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import styles from '../draft-tool.module.css';

export interface StageStatusProps {
  /** The last poll failed. */
  stale: boolean;
  /** Why the viewer cannot pick: signed out (or the poll was refused), or not part of this league. */
  spectator: 'guest' | 'nonParticipant' | null;
}

export default function StageStatus({ stale, spectator }: StageStatusProps) {
  const t = useT(draftScreenMessages);
  const pathname = usePathname();
  if (!stale && spectator === null) return null;

  const signInHref = pathname ? `/auth/signin?callbackUrl=${encodeURIComponent(pathname)}` : '/auth/signin';
  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--draft-ink-2)]">
      {stale ? (
        <p role="status" className="flex items-center gap-1.5">
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('stale')}
        </p>
      ) : null}
      {spectator ? (
        <p className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {spectator === 'guest' ? t('spectator.guest') : t('spectator.nonParticipant')}
            {spectator === 'guest' ? (
              <>
                {' '}
                <Link href={signInHref} className={`${styles.focusable} rounded font-semibold text-[var(--draft-ink)] underline`}>
                  {t('spectator.signIn')}
                </Link>
              </>
            ) : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}
