'use client';

import Link from 'next/link';
import { useRef } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';
import { cn } from '@/lib/utils/cn';
import { RelativeTime } from '@/i18n/LocalTime';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import { formatChallengeMachine } from '@/lib/format-engine/runtime/challenge-state';
import { answerChallengeRequest, withdrawChallengeRequest } from '@/lib/format-engine/runtime/client-api';
import type { ChallengeState, ChallengeView } from '@/lib/format-engine/runtime/view-types';
import { FOCUS_TARGET, TrainerTile } from './parts';
import { usePlayerName } from './useLabels';
import { useRuntimeAction } from './useRuntimeAction';

const TOUCH = 'min-h-11 sm:min-h-0';

/** What the page's live region announces about a ladder action once the view was read again. */
export type LadderStatus = 'challengeSent' | 'challengeAccepted' | 'challengeDeclined' | 'challengeWithdrawn';

export interface ChallengeRowProps {
  seasonId: string;
  challenge: ChallengeView;
  viewerId: string;
  /** The league is completed or archived: no buttons. */
  closed: boolean;
  /** The page's single reload path. */
  onReload: () => Promise<void>;
  /** Announces the outcome of an answer or a withdraw (the page's polite live region). */
  onStatus?: (status: LadderStatus) => void;
}

const STATE_TONE = {
  open: 'accent',
  accepted: 'win',
  declined: 'neutral',
  expired: 'neutral',
  cancelled: 'neutral',
} as const satisfies Record<ChallengeState, 'accent' | 'win' | 'neutral'>;

/**
 * One of the viewer's challenges. The challenger can withdraw an open one, the defender can accept or decline it; a
 * challenge past its accept window (`lapsed`) is shown as expired with no buttons, and an accepted one links to its
 * match. A refused request shows its error under the row; a stale one reloads the view first. The button that was
 * pressed is gone once the row leaves `open`, so focus moves to the row and the outcome is announced.
 */
export default function ChallengeRow({ seasonId, challenge, viewerId, closed, onReload, onStatus }: ChallengeRowProps) {
  const t = useT(formatRuntimePlayerMessages);
  const nameOf = usePlayerName();
  const errorText = useApiErrorText(errorsSeasons, errorsCommon);
  const { run, pending, error } = useRuntimeAction(onReload);
  const rowRef = useRef<HTMLLIElement>(null);

  const outgoing = challenge.challenger.id === viewerId;
  const other = outgoing ? challenge.defender : challenge.challenger;
  const otherName = nameOf(other);
  const state: ChallengeState = challenge.lapsed ? 'expired' : challenge.state;
  const answerable = !closed && formatChallengeMachine.transitionsFrom(state, outgoing ? 'challenger' : 'defender').length > 0;

  async function answer(accept: boolean) {
    const outcome = await run(() => answerChallengeRequest(seasonId, challenge.id, accept));
    if (outcome?.ok) {
      await onReload();
      rowRef.current?.focus();
      onStatus?.(accept ? 'challengeAccepted' : 'challengeDeclined');
    }
  }

  async function withdraw() {
    const outcome = await run(() => withdrawChallengeRequest(seasonId, challenge.id, 'self'));
    if (outcome?.ok) {
      await onReload();
      rowRef.current?.focus();
      onStatus?.('challengeWithdrawn');
    }
  }

  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className={cn('flex flex-col gap-2 rounded-poke-md border border-hairline bg-elevated px-3 py-2', FOCUS_TARGET)}
      data-challenge={challenge.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TrainerTile name={otherName} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-body font-[550] text-fg">
              {outgoing ? t('ladder.outgoing', { name: otherName }) : t('ladder.incoming', { name: otherName })}
            </p>
            <p className="text-caption text-fg-muted">
              {t('ladder.round', { round: challenge.round })}
              {state === 'open' && (
                <>
                  {' · '}
                  {t('ladder.expires')} <RelativeTime value={challenge.expires_at} />
                </>
              )}
            </p>
          </div>
        </div>
        <SkewChip tone={STATE_TONE[state]}>{t(`ladder.state.${state}`)}</SkewChip>
      </div>

      {state === 'accepted' && challenge.match_id !== null && (
        <Link
          href={`/tournaments/${encodeURIComponent(challenge.phase_id)}/matches/${encodeURIComponent(challenge.match_id)}`}
          className={cn('inline-flex items-center self-start text-body font-[550] text-accent-ink underline-offset-4 hover:underline', TOUCH)}
        >
          {t('ladder.matchLink')}
        </Link>
      )}

      {answerable && (
        <div className="flex flex-wrap gap-2">
          {outgoing ? (
            <Button
              variant="secondary"
              size="sm"
              className={TOUCH}
              onClick={() => void withdraw()}
              disabled={pending}
              aria-label={t('ladder.withdrawAria', { name: otherName })}
            >
              {t('ladder.withdraw')}
            </Button>
          ) : (
            <>
              <Button size="sm" className={TOUCH} onClick={() => void answer(true)} disabled={pending} aria-label={t('ladder.acceptAria', { name: otherName })}>
                {t('ladder.accept')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className={TOUCH}
                onClick={() => void answer(false)}
                disabled={pending}
                aria-label={t('ladder.declineAria', { name: otherName })}
              >
                {t('ladder.decline')}
              </Button>
            </>
          )}
        </div>
      )}

      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}
    </li>
  );
}
