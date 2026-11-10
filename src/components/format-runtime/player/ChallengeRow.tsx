'use client';

import Link from 'next/link';
import { useRef } from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { RelativeTime } from '@/i18n/LocalTime';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import { answerChallengeRequest, withdrawChallengeRequest } from '@/lib/format-engine/runtime/client-api';
import type { ChallengeState, ChallengeView } from '@/lib/format-engine/runtime/view-types';
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

const STATE_VARIANT = {
  open: 'yellow',
  accepted: 'green',
  declined: 'gray',
  expired: 'gray',
  cancelled: 'gray',
} as const satisfies Record<ChallengeState, 'yellow' | 'green' | 'gray'>;

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
  const answerable = state === 'open' && !closed;

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
      className="space-y-2 rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 focus:outline-2 focus:outline-offset-2 focus:outline-transparent focus-visible:ring-2 focus-visible:ring-poke-border-focus"
      data-challenge={challenge.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-poke-text-primary">
            {outgoing ? t('ladder.outgoing', { name: otherName }) : t('ladder.incoming', { name: otherName })}
          </p>
          <p className="text-xs text-poke-text-secondary">
            {t('ladder.round', { round: challenge.round })}
            {state === 'open' && (
              <>
                {' · '}
                {t('ladder.expires')} <RelativeTime value={challenge.expires_at} />
              </>
            )}
          </p>
        </div>
        <Badge variant={STATE_VARIANT[state]}>{t(`ladder.state.${state}`)}</Badge>
      </div>

      {state === 'accepted' && challenge.match_id !== null && (
        <Link
          href={`/tournaments/${encodeURIComponent(challenge.phase_id)}/matches/${encodeURIComponent(challenge.match_id)}`}
          className={`inline-flex items-center text-sm font-medium text-poke-blue hover:underline ${TOUCH}`}
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
