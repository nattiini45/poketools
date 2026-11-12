'use client';

import { useId, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import { TOUCH } from '@/components/admin/match-styles';
import { isoToLocalInput, localInputToIso } from '@/components/draft-admin/admin-view';
import { useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { adminMatchMessages } from '@/i18n/messages/admin-match';
import { errorsMatches } from '@/i18n/messages/errors';
import type { ScheduleResult } from '@/lib/admin/match-detail';
import type { MatchStatus } from '@/types/match';

interface MatchSchedulePanelProps {
  matchId: string;
  status: MatchStatus;
  scheduledAt: string | null;
  roundDeadline: string | null;
  /** Time proposals from the players that are still open (a schedule change cancels them). */
  pendingProposals: number;
}

type PanelOutcome = 'saved' | 'cleared' | 'unchanged';
/** An API failure (translated by its code) or the local failure; never translated text. */
type PanelError = { api: ApiErrorLike } | { local: 'failed' };

const noopSubscribe = () => () => {};

/** The chosen time lies after the round deadline (a hint, not a block). */
export function isAfterDeadline(chosenIso: string | null, deadlineIso: string | null): boolean {
  if (!chosenIso || !deadlineIso) return false;
  const chosen = Date.parse(chosenIso);
  const deadline = Date.parse(deadlineIso);
  return Number.isFinite(chosen) && Number.isFinite(deadline) && chosen > deadline;
}

/** What a schedule request answered, for the success notice. */
export function scheduleOutcome(result: Pick<ScheduleResult, 'scheduled_at' | 'unchanged'>): PanelOutcome {
  if (result.unchanged) return 'unchanged';
  return result.scheduled_at === null ? 'cleared' : 'saved';
}

/** Admin control for the match time. A completed match shows its time read-only. */
export default function MatchSchedulePanel({
  matchId,
  status,
  scheduledAt,
  roundDeadline,
  pendingProposals,
}: MatchSchedulePanelProps) {
  const router = useRouter();
  const t = useT(adminMatchMessages);
  const errorText = useApiErrorText(errorsMatches);
  const inputId = useId();
  // The field shows the viewer's local zone, which the server render does not know:
  // it renders empty and the client fills it after hydration (no SSR/CSR mismatch).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [edited, setEdited] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<PanelOutcome | null>(null);
  const [proposalsKept, setProposalsKept] = useState(false);
  const [error, setError] = useState<PanelError | null>(null);

  const stored = hydrated ? isoToLocalInput(scheduledAt) : '';
  const value = edited ?? stored;
  const iso = localInputToIso(value);
  const unchanged = value === stored;
  const canSave = hydrated && iso !== null && !unchanged && !saving;
  const afterDeadline = isAfterDeadline(iso, roundDeadline);

  async function send(scheduled: string | null) {
    setSaving(true);
    setError(null);
    setOutcome(null);
    setProposalsKept(false);
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_at: scheduled }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const result = json.data as ScheduleResult;
        setOutcome(scheduleOutcome(result));
        setProposalsKept(result.proposals_cancel_failed === true);
        setEdited(result.scheduled_at === null ? '' : value);
        router.refresh();
      } else {
        setError({ api: toApiErrorLike(json) });
      }
    } catch {
      setError({ local: 'failed' });
    } finally {
      setSaving(false);
    }
  }

  if (status === 'completed') {
    return (
      <Section title={t('schedule.title')} icon="metronome" collapsible keepMounted>
        <div className="flex flex-col gap-2 text-body text-fg">
          <p>
            <span className="text-fg-muted">{t('schedule.current')}:</span>{' '}
            {scheduledAt ? <LocalTime value={scheduledAt} preset="dateTimeYear" /> : t('header.notScheduled')}
          </p>
          <p className="text-caption text-fg-muted">{t('schedule.completedNote')}</p>
        </div>
      </Section>
    );
  }

  return (
    <Section title={t('schedule.title')} icon="metronome" collapsible keepMounted>
      <div className="flex flex-col gap-3">
        <p className="text-body text-fg-muted">{t('schedule.hint')}</p>
        <div>
          <Input
            id={inputId}
            type="datetime-local"
            label={t('schedule.inputLabel')}
            hint={t('schedule.browserZoneHint')}
            value={value}
            disabled={saving || !hydrated}
            onChange={(e) => setEdited(e.target.value)}
          />
          {iso && (
            <p className="mt-2 text-body text-fg">
              <span className="text-fg-muted">{t('schedule.instantLabel')}:</span>{' '}
              <LocalTime value={iso} preset="dateTimeYear" zone="both" />
            </p>
          )}
        </div>

        {afterDeadline && <Alert variant="warning">{t('schedule.afterDeadline')}</Alert>}
        {pendingProposals > 0 && (
          <Alert variant="warning">{t('schedule.pendingProposals', { count: pendingProposals })}</Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={saving} disabled={!canSave} onClick={() => send(iso)} className={TOUCH}>
            {t('schedule.save')}
          </Button>
          {scheduledAt && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => send(null)} className={TOUCH}>
              {t('schedule.clear')}
            </Button>
          )}
        </div>

        {outcome && <Alert variant="success">{t(`schedule.${outcome}`)}</Alert>}
        {proposalsKept && <Alert variant="warning">{t('schedule.proposalsNotCancelled')}</Alert>}
        {error && <Alert variant="error">{'api' in error ? errorText(error.api) : t('schedule.failed')}</Alert>}
      </div>
    </Section>
  );
}
