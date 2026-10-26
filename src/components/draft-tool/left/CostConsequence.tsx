'use client';

/**
 * What the pick does, directly above the DRAFT button (draft-frontend §5.5,
 * SPEC:402-421): the budget left after it and the server's line-level verdict
 * as a sentence. The price is not repeated here: the info box title is the one
 * place it shows. The verdict is never decided here (FR-3): it is the
 * snapshot's `ReasonDTO`, rendered through `draft/shared.reasons`. A negative
 * remainder uses the warning ink (red is reserved for drafted lines).
 *
 * `RemainingAfterPick` is the figure alone; the phone bottom bar renders it
 * too, so from 768 px down the dock hides its copy (`.dockRemaining`). When an
 * admin picks for the player on the clock the figure is that player's budget
 * and says so by name.
 */
import { useT } from '@/i18n/client';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { reasonText, type ReasonNameSource } from '@/lib/draft-ui/reasons';
import type { ReasonDTO } from '@/lib/draft-ui/snapshot-types';
import styles from '../draft-tool.module.css';

export interface RemainingAfterPickProps {
  /** Budget left after the pick; negative reads in the warning ink. */
  remaining: number;
  /** The player whose budget it is, when that is not the viewer (admin override). */
  forPlayer?: string | null;
}

export function RemainingAfterPick({ remaining, forPlayer = null }: RemainingAfterPickProps) {
  const t = useT(draftScreenMessages);
  const ink = remaining < 0 ? 'text-[var(--draft-warn-ink)]' : 'text-[var(--draft-ink-2)]';
  return (
    <span className={ink}>
      {forPlayer ? t('cost.remainingFor', { player: forPlayer, n: remaining }) : t('cost.remaining', { n: remaining })}
    </span>
  );
}

export interface CostConsequenceProps {
  /** Budget left after the pick; null for spectators and while nothing is priced. */
  remainingAfter: number | null;
  forPlayer?: string | null;
  /** The line-level verdict (for example "Already drafted by Misty."). */
  reason: ReasonDTO | null;
  vm: ReasonNameSource;
}

export default function CostConsequence({ remainingAfter, forPlayer, reason, vm }: CostConsequenceProps) {
  const tShared = useT(draftSharedMessages);
  if (remainingAfter === null && reason === null) return null;

  return (
    <div className="flex flex-col gap-1">
      {remainingAfter !== null ? (
        <p className={`${styles.dockRemaining} text-sm font-semibold`}>
          <RemainingAfterPick remaining={remainingAfter} forPlayer={forPlayer} />
        </p>
      ) : null}
      {reason ? <p className="text-sm text-[var(--draft-ink-2)]">{reasonText(tShared, reason, vm)}</p> : null}
    </div>
  );
}
