'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import { useFormatter, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsMatches } from '@/i18n/messages/errors';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import { matchMessages } from '@/i18n/messages/match';
import type { ApiResult } from '@/types/api';
import type { MatchProposalWithPlayers } from '@/types/match-proposal';
import type { MatchWithPlayers } from '@/types/match';

interface MatchSchedulingPanelProps {
  matchId: string;
  status: string;
  currentPlayerId: string | null;
  canManage: boolean;
  scheduledAt: string | null;
  roundDeadline: string | null;
  initialProposals: MatchProposalWithPlayers[];
}

/** A panel error: a client-side state (by key) or an API failure. Translated at render. */
type PanelError =
  | { kind: 'proposalFailed' }
  | { kind: 'updateFailed' }
  | { kind: 'networkError' }
  | { kind: 'api'; error: ApiErrorLike };

type PanelSuccess = 'proposalSent' | 'proposalAccepted' | 'proposalRejected';

function toDateTimeLocalValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string) {
  return new Date(value).toISOString();
}

function proposalStatusVariant(status: string): 'green' | 'yellow' | 'blue' | 'gray' | 'red' {
  switch (status) {
    case 'accepted': return 'green';
    case 'rejected': return 'red';
    case 'expired':
    case 'cancelled': return 'gray';
    default: return 'yellow';
  }
}

export default function MatchSchedulingPanel({
  matchId,
  status,
  currentPlayerId,
  canManage,
  scheduledAt,
  roundDeadline,
  initialProposals,
}: MatchSchedulingPanelProps) {
  const router = useRouter();
  const t = useT(matchFormsMessages);
  const tCommon = useT(commonMessages);
  const tEnum = useT(enumMessages);
  const tMatch = useT(matchMessages);
  const formatter = useFormatter();
  const apiErrorText = useApiErrorText(errorsMatches);
  const [proposals, setProposals] = useState(initialProposals);
  const [currentScheduledAt, setCurrentScheduledAt] = useState(scheduledAt);
  const [proposedAt, setProposedAt] = useState(toDateTimeLocalValue(scheduledAt));
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [successKey, setSuccessKey] = useState<PanelSuccess | null>(null);

  const canPropose = canManage && status !== 'completed' && status !== 'disputed';
  const pendingProposal = proposals.find((proposal) => proposal.status === 'pending') ?? null;

  function dateTime(value: string | null): string {
    return value ? formatter.instant(value, 'dateTime') : tCommon('states.notScheduled');
  }

  function apiFailure(json: unknown, fallback: 'proposalFailed' | 'updateFailed'): PanelError {
    const apiError = toApiErrorLike(json);
    return apiError.error || apiError.code ? { kind: 'api', error: apiError } : { kind: fallback };
  }

  function errorMessage(e: PanelError): string {
    switch (e.kind) {
      case 'proposalFailed':
      case 'updateFailed':
      case 'networkError':
        return t(`scheduling.${e.kind}`);
      case 'api':
        return apiErrorText(e.error);
    }
  }

  async function refreshProposals() {
    const res = await fetch(`/api/matches/${matchId}/proposals`);
    const json: ApiResult<MatchProposalWithPlayers[]> = await res.json();
    if (json.success && json.data) {
      setProposals(json.data);
    }
  }

  async function handleCreateProposal() {
    setLoading('create');
    setError(null);
    setSuccessKey(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposed_at: fromDateTimeLocalValue(proposedAt),
          message: message.trim() || undefined,
        }),
      });
      const json: ApiResult<MatchProposalWithPlayers> = await res.json();
      if (!json.success) {
        setError(apiFailure(json, 'proposalFailed'));
        return;
      }
      setMessage('');
      setSuccessKey('proposalSent');
      await refreshProposals();
      router.refresh();
    } catch {
      setError({ kind: 'networkError' });
    } finally {
      setLoading(null);
    }
  }

  async function handleResponse(proposalId: string, action: 'accept' | 'reject') {
    setLoading(`${action}:${proposalId}`);
    setError(null);
    setSuccessKey(null);
    try {
      const res = await fetch(`/api/match-proposals/${proposalId}/${action}`, { method: 'POST' });
      const json: ApiResult<MatchProposalWithPlayers | { proposal: MatchProposalWithPlayers; match: MatchWithPlayers }> = await res.json();
      if (!json.success) {
        setError(apiFailure(json, 'updateFailed'));
        return;
      }
      if (action === 'accept' && json.data && 'match' in json.data) {
        setCurrentScheduledAt(json.data.match.scheduled_at);
      }
      setSuccessKey(action === 'accept' ? 'proposalAccepted' : 'proposalRejected');
      await refreshProposals();
      router.refresh();
    } catch {
      setError({ kind: 'networkError' });
    } finally {
      setLoading(null);
    }
  }

  return (
    <Section title={t('scheduling.title')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-poke-md border border-poke-border bg-poke-surface p-3">
          <p className="text-xs font-heading uppercase tracking-wide text-poke-text-muted">{t('scheduling.scheduled')}</p>
          <p className="mt-1 text-sm font-heading font-semibold text-poke-text-primary">{dateTime(currentScheduledAt)}</p>
        </div>
        <div className="rounded-poke-md border border-poke-border bg-poke-surface p-3">
          <p className="text-xs font-heading uppercase tracking-wide text-poke-text-muted">{t('scheduling.deadline')}</p>
          <p className="mt-1 text-sm font-heading font-semibold text-poke-text-primary">{dateTime(roundDeadline)}</p>
        </div>
      </div>

      {canManage && proposals.length > 0 && (
        <div className="space-y-2 mb-4">
          {proposals.map((proposal) => {
            const canRespond = proposal.status === 'pending' && proposal.responder_id === currentPlayerId;
            return (
              <div key={proposal.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-poke-md border border-poke-border bg-poke-elevated p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-heading font-semibold text-poke-text-primary truncate">
                      {dateTime(proposal.proposed_at)}
                    </p>
                    <Badge variant={proposalStatusVariant(proposal.status)} size="sm">
                      {enumLabel(tEnum, 'matchProposalStatus', proposal.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-poke-text-muted mt-1">
                    {proposal.proposer_name ?? tMatch('shared.unknownPlayer')} &rarr;{' '}
                    {proposal.responder_name ?? tMatch('shared.unknownPlayer')}
                  </p>
                  {proposal.message && <p className="text-sm text-poke-text-secondary mt-2 break-words">{proposal.message}</p>}
                </div>
                {canRespond && (
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="success"
                      loading={loading === `accept:${proposal.id}`}
                      onClick={() => handleResponse(proposal.id, 'accept')}
                    >
                      {t('scheduling.accept')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={loading === `reject:${proposal.id}`}
                      onClick={() => handleResponse(proposal.id, 'reject')}
                    >
                      {t('scheduling.reject')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {canPropose && !pendingProposal && (
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-3 items-end">
          <Input
            label={t('scheduling.time')}
            type="datetime-local"
            value={proposedAt}
            onChange={(event) => setProposedAt(event.target.value)}
          />
          <div>
            <label htmlFor="schedule-message" className="block text-sm font-heading font-semibold text-poke-text-primary mb-1.5">
              {t('scheduling.message')}
            </label>
            <textarea
              id="schedule-message"
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={1000}
              className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md text-sm placeholder:text-poke-text-muted focus:outline-none focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20"
            />
          </div>
          <Button onClick={handleCreateProposal} loading={loading === 'create'} disabled={!proposedAt}>
            {t('scheduling.propose')}
          </Button>
        </div>
      )}

      {error && <Alert variant="error" className="mt-4">{errorMessage(error)}</Alert>}
      {successKey && <Alert variant="success" className="mt-4">{t(`scheduling.${successKey}`)}</Alert>}
    </Section>
  );
}
