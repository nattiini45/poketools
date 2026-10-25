'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Section from '@/components/ui/Section';
import ReasonDialog from '@/components/admin/ReasonDialog';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { adminMatchMessages } from '@/i18n/messages/admin-match';
import { errorsMatches } from '@/i18n/messages/errors';
import { canReopenMatch } from '@/lib/tournament/match-state';
import { errorNeedsRefresh } from './AdminMatchActions';
import type { MatchStatus } from '@/types/match';

interface MatchReopenSectionProps {
  matchId: string;
  status: MatchStatus;
}

/** An API failure (translated by its code) or the local failure; never translated text. */
type ReopenError = { api: ApiErrorLike } | { local: 'failed' };

/** What the section reports once it is no longer reopenable: a clean reopen, or one whose follow-up steps failed. */
type ReopenOutcome = 'reopened' | { incomplete: ApiErrorLike };

/**
 * How a failed reopen is handled: `incomplete` (the status change is committed,
 * only follow-up steps failed), `stale` (the match moved on; reload the page and
 * keep the message in the dialog) or `error` (nothing changed).
 */
export function reopenFailureKind(code: string | null | undefined): 'incomplete' | 'stale' | 'error' {
  if (code === 'match_reopen_incomplete') return 'incomplete';
  return errorNeedsRefresh(code) ? 'stale' : 'error';
}

/** Takes a completed, awaiting or disputed match back to in progress without resetting it. */
export default function MatchReopenSection({ matchId, status }: MatchReopenSectionProps) {
  const router = useRouter();
  const t = useT(adminMatchMessages);
  const errorText = useApiErrorText(errorsMatches);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ReopenError | null>(null);
  const [outcome, setOutcome] = useState<ReopenOutcome | null>(null);

  async function handleReopen(reason: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (json.success) {
        setOpen(false);
        setOutcome('reopened');
        router.refresh();
      } else if (reopenFailureKind(json.code) === 'incomplete') {
        // The status change is committed; only follow-up steps failed. Show the
        // page as it is now and keep the warning where the controls were.
        setOpen(false);
        setOutcome({ incomplete: toApiErrorLike(json) });
        router.refresh();
      } else {
        if (reopenFailureKind(json.code) === 'stale') router.refresh();
        setError({ api: toApiErrorLike(json) });
      }
    } catch {
      setError({ local: 'failed' });
    } finally {
      setLoading(false);
    }
  }

  if (!canReopenMatch(status)) {
    // After a reopen the page refreshes to in progress: keep the outcome, drop the controls.
    if (!outcome) return null;
    return (
      <Section title={t('reopen.title')}>
        {outcome === 'reopened' ? (
          <Alert variant="success">{t('reopen.success')}</Alert>
        ) : (
          <Alert variant="warning">{errorText(outcome.incomplete)}</Alert>
        )}
      </Section>
    );
  }

  const effects = status === 'completed' ? 'completed' : status === 'disputed' ? 'disputed' : 'pending';

  return (
    <Section title={t('reopen.title')}>
      <div className="space-y-3 text-sm text-poke-text-secondary">
        <p>{t('reopen.intro')}</p>
        <p>{t('reopen.finishHint')}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {t('reopen.button')}
        </Button>
      </div>

      <ReasonDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleReopen}
        title={t('reopen.dialogTitle')}
        message={t('reopen.dialogMessage')}
        confirmLabel={t('reopen.confirm')}
        confirmVariant="primary"
        loading={loading}
        reasonLabel={t('reopen.reasonLabel')}
        reasonPlaceholder={t('reopen.reasonPlaceholder')}
        error={
          error && <Alert variant="error">{'api' in error ? errorText(error.api) : t('reopen.failed')}</Alert>
        }
      >
        <p>{t('reopen.keepsGames')}</p>
        <p>{t(`reopen.effects.${effects}`)}</p>
        {status === 'completed' && <p>{t('reopen.notUndone')}</p>}
      </ReasonDialog>
    </Section>
  );
}
