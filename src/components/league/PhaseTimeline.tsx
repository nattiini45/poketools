'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LeaguePhase } from '@/types/season';
import type { Ruleset } from '@/types/ruleset';
import type { ApiResult } from '@/types/api';
import type { PhaseFormData } from '@/components/league/PhaseForm';
import PhaseForm, { PhaseSaveError } from '@/components/league/PhaseForm';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { enumLabel } from '@/i18n/content/enum-label';
import { useApiErrorText } from '@/i18n/use-api-error';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';

interface PhaseTimelineProps {
  seasonId: string;
  rulesets: Ruleset[];
  canDelete?: boolean;
}

/** An API refusal (shown by its code), or a request that got no answer. */
type TimelineError =
  | { api: ApiErrorLike }
  | { key: 'loadFailed' | 'deleteFailed' | 'reorderFailed' };

function statusVariant(status: string): 'green' | 'accent' | 'gray' {
  if (status === 'active') return 'green';
  if (status === 'upcoming') return 'accent';
  if (status === 'completed') return 'gray';
  return 'gray';
}

export default function PhaseTimeline({ seasonId, rulesets, canDelete = false }: PhaseTimelineProps) {
  const router = useRouter();
  const t = useT(leaguePhasesMessages);
  const tEnum = useT(enumMessages);
  const tCommon = useT(commonMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [phases, setPhases] = useState<LeaguePhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TimelineError | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const fetchPhases = useCallback(async () => {
    try {
      const res = await fetch(`/api/seasons/${seasonId}/phases`);
      const result: ApiResult<LeaguePhase[]> = await res.json();
      if (result.success) {
        setPhases(result.data.sort((a, b) => a.stage_order - b.stage_order));
      } else {
        setError({ api: toApiErrorLike(result) });
      }
    } catch {
      setError({ key: 'loadFailed' });
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    void fetchPhases();
  }, [fetchPhases]);

  async function handleCreate(data: PhaseFormData) {
    const res = await fetch(`/api/seasons/${seasonId}/phases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result: ApiResult<LeaguePhase> = await res.json();
    if (!result.success) {
      throw new PhaseSaveError(toApiErrorLike(result));
    }
    setShowCreate(false);
    router.push(`/admin/leagues/${seasonId}/phases/${result.data.id}`);
  }

  async function handleDelete(phase: LeaguePhase) {
    const hasRounds = phase.rounds_total > 0;
    const confirmed = window.confirm(
      hasRounds
        ? t('timeline.confirmDeleteWithRounds', { name: phase.name })
        : t('timeline.confirmDelete', { name: phase.name })
    );
    if (!confirmed) return;

    setDeletingId(phase.id);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/phases/${phase.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hasRounds ? { confirm: true } : {}),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setPhases((prev) => prev.filter((p) => p.id !== phase.id));
    } catch {
      setError({ key: 'deleteFailed' });
    } finally {
      setDeletingId(null);
    }
  }

  async function movePhase(phaseId: string, direction: 'up' | 'down') {
    const upcoming = phases.filter((p) => p.status === 'upcoming');
    const idx = upcoming.findIndex((p) => p.id === phaseId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= upcoming.length) return;

    const next = [...upcoming];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];

    setReordering(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/phases/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase_ids: next.map((p) => p.id) }),
      });
      const result: ApiResult<{ phase_ids: string[] }> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      await fetchPhases();
    } catch {
      setError({ key: 'reorderFailed' });
    } finally {
      setReordering(false);
    }
  }

  if (loading) return <p className="text-sm text-poke-text-muted">{t('timeline.loading')}</p>;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="error">
          {'api' in error ? errorText(error.api) : t(`timeline.errors.${error.key}`)}
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-heading font-semibold text-poke-text-primary">
          {t('timeline.heading', { count: phases.length })}
        </h3>
        <Button variant="secondary" size="sm" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? t('timeline.cancel') : t('timeline.create')}
        </Button>
      </div>

      {phases.length === 0 && !showCreate && (
        <p className="text-sm text-poke-text-muted">
          {t('timeline.empty')}
        </p>
      )}

      <div className="space-y-2">
        {phases.map((phase, i) => (
          <div key={phase.id}>
            {i > 0 && phases[i - 1].advancement_rule && (
              <div className="flex justify-center py-1">
                <span className="text-xs text-poke-blue bg-poke-blue/10 px-2 py-0.5 rounded-full">
                  {t(
                    phases[i - 1].advancement_rule!.per_group
                      ? 'timeline.advancesTopPerGroup'
                      : 'timeline.advancesTop',
                    { count: phases[i - 1].advancement_rule!.count },
                  )}
                </span>
              </div>
            )}
            <Card variant="muted" padding="sm">
              <div className="flex items-center justify-between gap-2 text-sm flex-wrap">
                <div className="min-w-0">
                  <span className="font-heading font-medium text-poke-text-primary">
                    {phase.stage_order}. {phase.name}
                  </span>
                  <span className="ml-2 text-xs text-poke-text-secondary">
                    {enumLabel(tEnum, 'bracketType', phase.bracket_type)}
                    {' · '}{tCommon('bestOf', { count: phase.best_of_default })}
                    {' · '}{t('timeline.enrolled', { count: phase.participant_count })}
                    {' · '}
                    {t('timeline.rounds', { done: phase.rounds_completed, total: phase.rounds_total })}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant={statusVariant(phase.status)}>
                    {enumLabel(tEnum, 'tournamentStatus', phase.status)}
                  </Badge>
                  {phase.status === 'upcoming' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reordering}
                        onClick={() => movePhase(phase.id, 'up')}
                        aria-label={t('timeline.moveUp')}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reordering}
                        onClick={() => movePhase(phase.id, 'down')}
                        aria-label={t('timeline.moveDown')}
                      >
                        ↓
                      </Button>
                    </>
                  )}
                  <Link
                    href={`/admin/leagues/${seasonId}/phases/${phase.id}`}
                    className="text-xs text-poke-blue hover:underline"
                  >
                    {t('timeline.manage')}
                  </Link>
                  {canDelete && phase.status === 'upcoming' && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(phase)}
                      loading={deletingId === phase.id}
                    >
                      {t('timeline.delete')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        ))}
      </div>

      {showCreate && (
        <Card variant="outlined">
          <h4 className="text-sm font-heading font-semibold text-poke-text-primary mb-3">
            {t('timeline.newPhaseTitle')}
          </h4>
          <p className="text-xs text-poke-text-muted mb-4">
            {t('timeline.newPhaseHint')}
          </p>
          <PhaseForm
            rulesets={rulesets}
            onSubmit={handleCreate}
            submitLabel={t('timeline.createSubmit')}
          />
        </Card>
      )}
    </div>
  );
}
