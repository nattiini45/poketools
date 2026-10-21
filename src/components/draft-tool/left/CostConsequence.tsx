'use client';

/**
 * Price and the budget left after the pick, then the server's verdict as a
 * sentence (draft-frontend §5.5, SPEC:402-421). The verdict is never decided
 * here (FR-3): it is the snapshot's `ReasonDTO`, rendered through
 * `draft/shared.reasons`. A negative remainder uses the warning ink (red is
 * reserved for drafted lines).
 */
import { useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { reasonText, type ReasonNameSource } from '@/lib/draft-ui/reasons';
import type { ReasonDTO } from '@/lib/draft-ui/snapshot-types';

export interface CostConsequenceProps {
  price: number;
  remainingAfter: number | null;
  reason: ReasonDTO | null;
  vm: ReasonNameSource;
  spectator: boolean;
  /** id for `aria-describedby` on the DRAFT button. */
  reasonId?: string;
}

export default function CostConsequence({ price, remainingAfter, reason, vm, spectator, reasonId }: CostConsequenceProps) {
  const t = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);

  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-2xl font-extrabold">{tShared('points', { n: price })}</span>
        {!spectator && remainingAfter !== null ? (
          <span className={`text-sm font-semibold ${remainingAfter < 0 ? 'text-[var(--draft-warn-ink)]' : 'text-[var(--draft-ink-2)]'}`}>
            {t('cost.remaining', { n: remainingAfter })}
          </span>
        ) : null}
      </p>
      {reason ? (
        <p id={reasonId} className="text-sm text-[var(--draft-ink-2)]">
          {reasonText(tShared, reason, vm)}
        </p>
      ) : null}
    </div>
  );
}
