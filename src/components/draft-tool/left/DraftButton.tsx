'use client';

/**
 * The violet DRAFT button (draft-frontend §5.5, SPEC:393-397). 56 px high,
 * full width, label in caps through CSS. Disabled = muted grey plus the
 * visible reason text, linked with `aria-describedby`; never red. The admin
 * variant is an outlined violet "Pick for {player} (admin)".
 *
 * Clicking only opens the confirmation dialog; nothing is committed here.
 */
import { forwardRef, useId } from 'react';
import { useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { glossaryMessages } from '@/i18n/messages/glossary';
import styles from '../draft-tool.module.css';

export interface DraftButtonProps {
  disabled: boolean;
  /** Already translated; shown under the button while disabled. */
  reasonText: string | null;
  /** The id of a reason rendered elsewhere (the phone bottom bar), used when `reasonText` is null. */
  describedBy?: string;
  onClick(): void;
  variant: 'player' | 'admin';
  targetName?: string;
  className?: string;
}

const DraftButton = forwardRef<HTMLButtonElement, DraftButtonProps>(function DraftButton(
  { disabled, reasonText, describedBy, onClick, variant, targetName, className },
  ref,
) {
  const t = useT(draftScreenMessages);
  const tGlossary = useT(glossaryMessages);
  const reasonId = useId();
  const showReason = disabled && reasonText !== null && reasonText !== '';
  const label = variant === 'admin' ? t('cta.adminPick', { player: targetName ?? '' }) : tGlossary('draft.draftCta');

  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-describedby={showReason ? reasonId : describedBy}
        className={`${styles.cta} ${variant === 'admin' ? styles.ctaAdmin : ''}`}
      >
        <span className={variant === 'player' ? styles.caps : undefined}>{label}</span>
      </button>
      {showReason ? (
        <p id={reasonId} className="text-sm text-[var(--draft-ink-2)]">
          {reasonText}
        </p>
      ) : null}
    </div>
  );
});

export default DraftButton;
