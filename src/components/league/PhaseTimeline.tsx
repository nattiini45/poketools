'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LeaguePhase } from '@/types/season';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import type { ApiResult } from '@/types/api';
import type { PhaseFormData } from '@/components/league/PhaseForm';
import PhaseForm, { PhaseSaveError } from '@/components/league/PhaseForm';
import Button from '@/components/ui/Button';
import ItemIcon from '@/components/ui/ItemIcon';
import Modal from '@/components/ui/Modal';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Select from '@/components/ui/Select';
import { getButtonClasses } from '@/components/ui/Button';
import { deleteRebuildWarning } from '@/components/shared/DeleteResourceButton';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { enumLabel } from '@/i18n/content/enum-label';
import { useApiErrorText } from '@/i18n/use-api-error';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { leaguePhasesMessages } from '@/i18n/messages/league-phases';
import { isTournamentUnstarted } from '@/lib/tournament/tournament-state';
import {
  phaseAnchorOptions,
  phaseNumbers,
  resolveInsertAt,
  type PhaseInsertMode,
} from '@/lib/league-admin/phase-controls';

interface PhaseTimelineProps {
  seasonId: string;
  rulesets: readonly RulesetOption[];
  canDelete?: boolean;
  /** The league's default ruleset, preselected in the new-phase form. */
  defaultRulesetId?: string | null;
  /**
   * The viewer is a site admin: a delete whose derived-data rebuild failed
   * then links the admin data tools (site-admin tools). Others see the
   * warning text, which names a site admin for the repair.
   */
  isSiteAdmin?: boolean;
}

/** A committed phase delete whose derived-data rebuild reported a problem. */
interface DeleteWarning {
  phaseName: string;
  warning: ApiErrorLike;
}

/** An API refusal (shown by its code), or a request that got no answer. */
type TimelineError =
  | { api: ApiErrorLike }
  | { key: 'loadFailed' | 'deleteFailed' | 'reorderFailed' };

/** A `{ success: true }` API body (the phase DELETE answers `data.rebuild_warning`). */
function isSuccessBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { success?: unknown }).success === true;
}

/**
 * The phase card's action row (status, reorder arrows, Manage, Delete). It wraps and may shrink,
 * so on a narrow screen the buttons drop to a second line inside the card instead of poking out.
 */
export const PHASE_ACTIONS_CLASS = 'flex items-center gap-2 flex-wrap min-w-0 max-w-full';

function statusTone(status: string): SkewChipTone {
  if (status === 'active') return 'live';
  if (status === 'upcoming') return 'accent';
  return 'neutral';
}

export default function PhaseTimeline({
  seasonId,
  rulesets,
  canDelete = false,
  defaultRulesetId = null,
  isSiteAdmin = false,
}: PhaseTimelineProps) {
  const router = useRouter();
  const t = useT(leaguePhasesMessages);
  const tEnum = useT(enumMessages);
  const tCommon = useT(commonMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsAdmin);
  const [phases, setPhases] = useState<LeaguePhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TimelineError | null>(null);
  const [deleteWarning, setDeleteWarning] = useState<DeleteWarning | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  /** Where the new phase goes: the end of the league, or next to the phase `insertAnchor`. */
  const [insertMode, setInsertMode] = useState<PhaseInsertMode>('end');
  const [insertAnchor, setInsertAnchor] = useState<string | null>(null);
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

  function resetPosition() {
    setInsertMode('end');
    setInsertAnchor(null);
  }

  function changeInsertMode(mode: PhaseInsertMode) {
    setInsertMode(mode);
    // Preselect the first position the API accepts, so "before" and "after" never silently append.
    const first = mode === 'end' ? undefined : phaseAnchorOptions(mode, phases).find((o) => !o.disabled);
    setInsertAnchor(first?.phaseId ?? null);
  }

  async function handleCreate(data: PhaseFormData) {
    const insertAt = resolveInsertAt(insertMode, insertAnchor, phases);
    const res = await fetch(`/api/seasons/${seasonId}/phases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(insertAt === undefined ? data : { ...data, insert_at: insertAt }),
    });
    const result: ApiResult<LeaguePhase> = await res.json();
    if (!result.success) {
      throw new PhaseSaveError(toApiErrorLike(result));
    }
    setShowCreate(false);
    resetPosition();
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
    setDeleteWarning(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/phases/${phase.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hasRounds ? { confirm: true } : {}),
      });
      const result: unknown = await res.json();
      if (!isSuccessBody(result)) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setPhases((prev) => prev.filter((p) => p.id !== phase.id));
      // Deleted, but the rebuild after it needs a site admin (data tools):
      // say so instead of an empty success.
      const warning = deleteRebuildWarning(result);
      if (warning) setDeleteWarning({ phaseName: phase.name, warning });
    } catch {
      setError({ key: 'deleteFailed' });
    } finally {
      setDeletingId(null);
    }
  }

  async function movePhase(phaseId: string, direction: 'up' | 'down') {
    const upcoming = phases.filter((p) => isTournamentUnstarted(p.status));
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

  const numbers = phaseNumbers(phases);
  const numberOf = (phaseId: string) => numbers.get(phaseId) ?? 0;

  if (loading) return <p className="text-body text-fg-muted">{t('timeline.loading')}</p>;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="error">
          {'api' in error ? errorText(error.api) : t(`timeline.errors.${error.key}`)}
        </Alert>
      )}
      {deleteWarning && (
        <Alert variant="warning">
          <span className="block">
            {t('timeline.deletedWithWarning', { name: deleteWarning.phaseName })} {errorText(deleteWarning.warning)}
          </span>
          {isSiteAdmin && (
            <Link href="/admin/data" className={`${getButtonClasses('ghost', 'sm')} mt-2`}>
              {t('timeline.openDataTools')}
            </Link>
          )}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-subtitle font-[550] text-fg">{t('timeline.heading', { count: phases.length })}</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setShowCreate(!showCreate);
            resetPosition();
          }}
        >
          {showCreate ? t('timeline.cancel') : t('timeline.create')}
        </Button>
      </div>

      {phases.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-poke-md border border-dashed border-hairline-strong px-4 py-8 text-center">
          <ItemIcon item="metronome" size={48} />
          <p className="text-body text-fg-muted">{t('timeline.empty')}</p>
        </div>
      )}

      <ol className="flex flex-col gap-2">
        {phases.map((phase, i) => (
          <li key={phase.id}>
            {i > 0 && phases[i - 1].advancement_rule && (
              <div className="flex justify-center pb-2">
                <SkewChip tone="accent">
                  {t(
                    phases[i - 1].advancement_rule!.per_group ? 'timeline.advancesTopPerGroup' : 'timeline.advancesTop',
                    { count: phases[i - 1].advancement_rule!.count },
                  )}
                </SkewChip>
              </div>
            )}
            <Card variant="muted" padding="sm">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 items-center gap-3">
                  <SkewChip tone={phase.status === 'active' ? 'tier-1' : 'neutral'} className="shrink-0 font-heading text-body">
                    {numberOf(phase.id)}
                  </SkewChip>
                  <div className="min-w-0">
                    <p className="break-words text-subtitle font-[550] text-fg">{phase.name}</p>
                    <p className="text-caption text-fg-muted">
                      {enumLabel(tEnum, 'bracketType', phase.bracket_type)}
                      {' · '}{tCommon('bestOf', { count: phase.best_of_default })}
                      {' · '}{t('timeline.enrolled', { count: phase.participant_count })}
                      {' · '}
                      {t('timeline.rounds', { done: phase.rounds_completed, total: phase.rounds_total })}
                    </p>
                  </div>
                </div>
                <div className={PHASE_ACTIONS_CLASS}>
                  <SkewChip tone={statusTone(phase.status)}>{enumLabel(tEnum, 'tournamentStatus', phase.status)}</SkewChip>
                  {isTournamentUnstarted(phase.status) && (
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
                    className="inline-flex min-h-11 items-center rounded-poke-sm px-1 text-body font-[550] text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] sm:min-h-0"
                  >
                    {t('timeline.manage')}
                  </Link>
                  {canDelete && isTournamentUnstarted(phase.status) && (
                    <Button variant="danger" size="sm" onClick={() => handleDelete(phase)} loading={deletingId === phase.id}>
                      {t('timeline.delete')}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          resetPosition();
        }}
        title={t('timeline.newPhaseTitle')}
      >
        <div className="flex flex-col gap-4">
          <p className="text-caption text-fg-muted">{t('timeline.newPhaseHint')}</p>
          {phases.length > 0 && (
            <div className="flex max-w-lg flex-col gap-3">
              <Select
                label={t('timeline.position.label')}
                value={insertMode}
                onChange={(e) => changeInsertMode(e.target.value as PhaseInsertMode)}
              >
                <option value="end">{t('timeline.position.end')}</option>
                <option value="before" disabled={!phaseAnchorOptions('before', phases).some((o) => !o.disabled)}>
                  {t('timeline.position.before')}
                </option>
                <option value="after">{t('timeline.position.after')}</option>
              </Select>
              {insertMode !== 'end' && (
                <div className="space-y-1.5">
                  <Select
                    label={t('timeline.position.phase')}
                    value={insertAnchor ?? ''}
                    onChange={(e) => setInsertAnchor(e.target.value || null)}
                    aria-describedby="phase-position-hint"
                  >
                    {phaseAnchorOptions(insertMode, phases).map((option) => {
                      const phase = phases.find((p) => p.id === option.phaseId);
                      if (!phase) return null;
                      const params = { order: numberOf(phase.id), name: phase.name };
                      return (
                        <option key={phase.id} value={phase.id} disabled={option.disabled}>
                          {t(option.disabled ? 'timeline.position.optionLocked' : 'timeline.position.option', params)}
                        </option>
                      );
                    })}
                  </Select>
                  <p id="phase-position-hint" className="text-caption text-fg-muted">
                    {t('timeline.position.hint')}
                  </p>
                </div>
              )}
            </div>
          )}
          <PhaseForm
            rulesets={rulesets}
            defaultRulesetId={defaultRulesetId}
            onSubmit={handleCreate}
            submitLabel={t('timeline.createSubmit')}
          />
        </div>
      </Modal>
    </div>
  );
}
