'use client';

import { useState } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLocale, useT } from '@/i18n/client';
import { RelativeTime } from '@/i18n/LocalTime';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import { withdrawChallengeRequest } from '@/lib/format-engine/runtime/client-api';
import type { ChallengeView } from '@/lib/format-engine/runtime/view-types';
import type { LText } from '@/lib/studio-core/ltext';
import { BUTTON_TOUCH, labelText } from './admin-shared';
import { useAdminRequest } from './useAdminRequest';
import { useStatusFocus } from './useStatusFocus';

export interface AdminLadderPhase {
  id: string;
  label: LText | null;
}

export interface AdminLaddersProps {
  seasonId: string;
  /** The phases that run a challenge ladder. */
  phases: readonly AdminLadderPhase[];
  /** The league's open challenges (state `open`), read by the server page. */
  challenges: readonly ChallengeView[];
}

/**
 * The open challenges of each challenge ladder, with Withdraw (the admin form of the withdraw route). A challenge that
 * is past its accept window (`lapsed`) is shown as expired and has no button: the cron marks it. An accepted challenge
 * leaves this list; its match is handled in the match admin.
 */
export default function AdminLadders({ seasonId, phases, challenges }: AdminLaddersProps) {
  const t = useT(formatRuntimeAdminMessages);
  const locale = useLocale();
  const { pending, errorMessage, run, refresh, clearError } = useAdminRequest();
  const [target, setTarget] = useState<ChallengeView | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const { statusRef, focusOnClose, onCloseAutoFocus } = useStatusFocus();

  async function withdraw() {
    if (target === null) return;
    // The earlier success line goes first: a failure must not sit next to a stale "withdrawn", and an identical second
    // message would not be announced (the live region sees no change).
    setWithdrawn(false);
    const out = await run(() => withdrawChallengeRequest(seasonId, target.id, 'admin'));
    if (!out.ok) {
      // The failure is shown under the list; the page was already read again for a stale-view failure.
      setTarget(null);
      return;
    }
    // The challenge's row (and its Withdraw button) leaves the list: focus goes to the status line.
    focusOnClose();
    setTarget(null);
    setWithdrawn(true);
    refresh();
  }

  if (phases.length === 0) {
    return <p className="text-sm text-poke-text-muted">{t('challenges.noLadders')}</p>;
  }

  return (
    <div className="space-y-4" data-live-challenges>
      <p className="text-sm text-poke-text-secondary">{t('challenges.intro')}</p>
      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm text-poke-green focus:outline-2 focus:outline-offset-2 focus:outline-transparent">
        {withdrawn ? t('challenges.withdrawn') : ''}
      </div>
      {errorMessage !== null && <Alert variant="error">{errorMessage}</Alert>}
      {phases.map((phase) => {
        const rows = challenges.filter((challenge) => challenge.phase_id === phase.id);
        return (
          <div key={phase.id} className="space-y-2" data-ladder-phase={phase.id}>
            <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{labelText(phase.label, locale, phase.id)}</h3>
            {rows.length === 0 ? (
              <p className="text-sm text-poke-text-muted">{t('challenges.none')}</p>
            ) : (
              <div className="overflow-x-auto rounded-poke-md border border-poke-border">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <caption className="sr-only">{t('challenges.caption', { phase: labelText(phase.label, locale, phase.id) })}</caption>
                  <thead className="bg-poke-muted text-xs font-heading text-poke-text-secondary">
                    <tr>
                      <th scope="col" className="px-3 py-2">{t('challenges.columns.challenger')}</th>
                      <th scope="col" className="px-3 py-2">{t('challenges.columns.defender')}</th>
                      <th scope="col" className="px-3 py-2">{t('challenges.columns.round')}</th>
                      <th scope="col" className="px-3 py-2">{t('challenges.columns.expires')}</th>
                      <th scope="col" className="px-3 py-2">
                        <span className="sr-only">{t('challenges.columns.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-poke-border">
                    {rows.map((challenge) => (
                      <tr key={challenge.id} className="align-middle">
                        <td className="px-3 py-2 text-poke-text-primary">{challenge.challenger.name ?? t('formerPlayer')}</td>
                        <td className="px-3 py-2 text-poke-text-primary">{challenge.defender.name ?? t('formerPlayer')}</td>
                        <td className="px-3 py-2 text-poke-text-secondary">{challenge.round}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-poke-text-secondary">
                          {challenge.lapsed ? <Badge variant="gray">{t('challenges.expired')}</Badge> : <RelativeTime value={challenge.expires_at} />}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {challenge.state === 'open' && !challenge.lapsed && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className={BUTTON_TOUCH}
                              disabled={pending}
                              aria-label={t('challenges.withdrawAria', {
                                challenger: challenge.challenger.name ?? t('formerPlayer'),
                                defender: challenge.defender.name ?? t('formerPlayer'),
                              })}
                              onClick={() => {
                                clearError();
                                setTarget(challenge);
                              }}
                            >
                              {t('challenges.withdraw')}
                            </Button>
                          )}
                          {challenge.match_id !== null && (
                            <Link
                              href={`/admin/matches/${encodeURIComponent(challenge.match_id)}`}
                              className={`inline-flex items-center font-medium text-poke-blue hover:underline ${BUTTON_TOUCH}`}
                            >
                              {t('challenges.openMatch')}
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-poke-text-muted">{t('challenges.matchNote')}</p>

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => void withdraw()}
        title={t('challenges.withdrawTitle')}
        message={t('challenges.withdrawBody')}
        confirmLabel={t('challenges.withdraw')}
        confirmVariant="danger"
        loading={pending}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </div>
  );
}
