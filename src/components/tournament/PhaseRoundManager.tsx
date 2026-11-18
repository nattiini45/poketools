'use client';

import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertDialog, AlertDialogBackdrop, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from '@ui-sdk/react/alert-dialog';
import { Button as ActionButton } from '@ui-sdk/react/button';
import { isoToLocalInput, localInputToIso } from '@/components/draft-admin/admin-view';
import Alert from '@/components/ui/Alert';
import Button, { getButtonClasses } from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import ItemIcon from '@/components/ui/ItemIcon';
import Select from '@/components/ui/Select';
import { useLocale, useT } from '@/i18n/client';
import { useMinuteClock } from '@/i18n/LocalTime';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { commonMessages } from '@/i18n/messages/common';
import { errorsMatches, errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { uiMessages } from '@/i18n/messages/ui';
import { useApiErrorText } from '@/i18n/use-api-error';
import { phaseRoundMachine } from '@/lib/league-phase/phase-round-state';
import { phaseMatchHref, type LeaguePhaseAddress } from '@/lib/league-phase/paths';
import { gameChangeWarnings } from '@/lib/match/game-change-outcome';
import { bestOfChoices } from '@/lib/tournament/best-of';
import type { ApiError, ApiResult, ApiWarning } from '@/types/api';
import type { Phase, PhaseParticipant, PhaseRound } from '@/types/league-phase';
import ManualRoundForm from './ManualRoundForm';
import { ROUND_MATCHES_LOAD_FAILED, ROUND_ROW_ACTIONS_CLASS, ROUND_ROW_HEADER_CLASS, RoundByeNotice, RoundDeadlineRow, RoundDisclosure, RoundMatchesPanel } from './RoundManager';
import { phaseRoundRequests, type PhaseRoundDetail, type PhaseRoundEdit } from './phase-round-requests';
import { apiFailure, type UiError } from './ui-error';

interface PhaseRoundManagerProps {
  address: LeaguePhaseAddress;
  phase: Pick<Phase, 'status' | 'archived' | 'bracket_type' | 'current_round' | 'best_of_default'>;
  rounds: PhaseRound[];
  participants: Pick<PhaseParticipant, 'id' | 'name' | 'seed'>[];
  leagueHasGroups: boolean;
  phaseAllowsDeletion: boolean;
}

type WriteErrorKey = `rounds.errors.${keyof typeof tournamentsAdminMessages.en.rounds.errors}`;
type LoadedDetail = { round: PhaseRound; attempt: number; result: ApiResult<PhaseRoundDetail> };

export default function PhaseRoundManager({ address, phase, rounds, participants, leagueHasGroups, phaseAllowsDeletion }: PhaseRoundManagerProps) {
  const t = useT(tournamentsAdminMessages);
  const tCommon = useT(commonMessages);
  const tPhase = useT(leagueAdminMessages);
  const tUi = useT(uiMessages);
  const locale = useLocale();
  const errorText = useApiErrorText(errorsTournaments, errorsSeasons, errorsMatches);
  const now = useMinuteClock();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const { season_id, phase_id } = address;
  const requests = useMemo(() => phaseRoundRequests({ season_id, phase_id }), [season_id, phase_id]);
  const prefix = useId();
  const region = useRef<HTMLDivElement>(null);
  const manualTrigger = useRef<HTMLButtonElement>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [writing, setWriting] = useState<WriteErrorKey | null>(null);
  const [error, setError] = useState<UiError<WriteErrorKey> | null>(null);
  const [warnings, setWarnings] = useState<ApiWarning[]>([]);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [cascadeNotice, setCascadeNotice] = useState<ApiError | null>(null);
  const [reset, setReset] = useState<{ roundId: string; cascade: boolean } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  const [deadline, setDeadline] = useState<{ id: string; value: string } | null>(null);
  const [bestOfDraft, setBestOfDraft] = useState<{ id: string; value: number } | null>(null);
  const editable = !phase.archived && phase.status !== 'completed';
  const busy = writing !== null || refreshing;
  const current = rounds.find(round => round.round_number === phase.current_round);
  const selected = rounds.find(round => round.id === expandedId);
  const detail = selected && loaded?.round === selected && loaded.attempt === attempt ? loaded.result : null;
  const matches = detail?.success ? detail.data.matches : undefined;
  const openCount = matches?.filter(match => match.status !== 'completed').length;
  const names = Object.fromEntries(participants.map(({ id, name }) => [id, name]));
  const isElimination = phase.bracket_type === 'single_elim' || phase.bracket_type === 'double_elim';
  const hasStructure = rounds.some(round => round.bracket_side !== null);
  const swissBlocked = phase.bracket_type === 'swiss' && current !== undefined && current.status !== 'completed';
  const groupedManualBlocked = phase.bracket_type === 'round_robin' && leagueHasGroups;
  const canGenerateNext = !isElimination && !hasStructure;
  const canGenerateAll = canGenerateNext && phase.bracket_type === 'round_robin';
  const canGenerateBracket = isElimination && rounds.length === 0;
  const canRepairBracket = isElimination && hasStructure;
  const canRegenerateBracket = isElimination && rounds.length > 0;
  const canCreateManual = !isElimination && !hasStructure && !groupedManualBlocked;
  const latest = Math.max(0, ...rounds.map(round => round.round_number));

  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    void requests.read(selected.id, abort.signal)
      .then(result => {
        if (!abort.signal.aborted) setLoaded({ round: selected, attempt, result });
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setLoaded({ round: selected, attempt, result: { success: false, error: ROUND_MATCHES_LOAD_FAILED } });
        }
      });
    return () => abort.abort();
  }, [selected, attempt, requests]);

  async function write(
    request: () => Promise<ApiResult<unknown>>, fallback: WriteErrorKey, onSuccess?: () => void,
    onRefusal?: (error: ApiError) => boolean, allowed = editable,
  ) {
    if (busy || manualOpen || !allowed) return;
    setWriting(fallback);
    setError(null);
    setWarnings([]);
    try {
      const result = await request();
      if (!result.success) {
        if (!onRefusal?.(result)) setError(apiFailure(result));
      }
      else {
        setWarnings(result.warnings ?? []);
        onSuccess?.();
      }
    } catch {
      setError({ key: fallback });
    } finally {
      startRefresh(() => router.refresh());
      setWriting(null);
    }
  }

  function resetRound(roundId: string, cascade: boolean) {
    return write(async () => {
      const result = await requests.reset(roundId, cascade);
      if (!result.success) return result;
      return {
        ...result,
        warnings: gameChangeWarnings(result.data).flatMap((warning): ApiWarning[] => {
          if (warning.code === 'admin_game_format_revert_failed') return [{ code: 'round_format_revert_failed' }];
          if (warning.code === 'admin_game_evolution_recheck_failed') return [{ code: 'phase_round_reset_evolution_recheck_failed' }];
          return warning.code ? [{ code: warning.code, ...(warning.params ? { params: warning.params } : {}) }] : [];
        }),
      };
    }, 'rounds.errors.resetRound', () => {
      setAttempt(n => n + 1);
      region.current?.focus();
    }, refusal => {
      if (cascade || refusal.code !== 'DOWNSTREAM_PLAYED') return false;
      setReset({ roundId, cascade: true });
      return true;
    }, !phase.archived);
  }

  function regenerateBracket() {
    const cascade = cascadeNotice !== null;
    setCascadeNotice(null);
    return write(async () => {
      const result = await requests.regenerateBracket(cascade);
      if (result.success && result.data.format_revert_failed) {
        return { ...result, warnings: [{ code: 'round_format_revert_failed' }] };
      }
      return result;
    }, 'rounds.errors.regenerateBracket', () => setExpandedId(null), refusal => {
      if (cascade || refusal.code !== 'REGENERATE_PLAYED') return false;
      setCascadeNotice(refusal);
      setRegenerateOpen(true);
      return true;
    });
  }

  function edit(roundId: string, change: PhaseRoundEdit) {
    const fallback = 'deadline' in change ? 'rounds.errors.updateDeadline'
      : 'best_of' in change ? 'rounds.errors.updateBestOf' : 'rounds.errors.updateStatus';
    return write(() => requests.update(roundId, change), fallback, () => {
      if ('deadline' in change) setDeadline(null);
      if ('best_of' in change || 'status' in change) setBestOfDraft(null);
    });
  }

  function closeManual() {
    setManualOpen(false);
    region.current?.focus();
  }

  return (
    <div ref={region} tabIndex={-1} className="space-y-4">
      {!editable && <Alert variant="info">{tPhase(phase.archived ? 'phasePage.roundsReadOnly' : 'phasePage.completedRoundsReadOnly')}</Alert>}
      {error && <Alert variant="error">{'api' in error ? errorText(error.api) : t(error.key)}</Alert>}
      {warnings.map(warning => <Alert key={warning.code} variant="warning">{errorText(warning)}</Alert>)}
      {editable && (canGenerateBracket || canGenerateNext || canCreateManual || canRegenerateBracket) && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-poke-lg border border-hairline bg-elevated p-3">
            {canGenerateBracket && (
              <Button type="button" size="sm" disabled={busy || participants.length < 2} loading={writing === 'rounds.errors.generateBracket'}
                onClick={() => void write(requests.generateBracket, 'rounds.errors.generateBracket')}>
                {t('rounds.generateBracket')}
              </Button>
            )}
            {canRepairBracket && (
              <ActionButton type="button" className={getButtonClasses('secondary', 'sm')} disabled={busy}
                onClick={() => write(requests.repairBracket, 'rounds.errors.repairBracket')}>
                {t('rounds.repairBracket')}
              </ActionButton>
            )}
            {canRegenerateBracket && (
              <AlertDialog open={regenerateOpen} onOpenChange={(open, details) => {
                setRegenerateOpen(open);
                if (!open) {
                  if (details.returnValue === 'confirm') void regenerateBracket();
                  else setCascadeNotice(null);
                }
              }}>
                <AlertDialogTrigger disabled={busy || participants.length < 2}
                  render={<Button type="button" variant="secondary" size="sm" />}>
                  {t('rounds.regenerateBracket')}
                </AlertDialogTrigger>
                <AlertDialogBackdrop className="fixed inset-0 z-50 backdrop-blur-xs" />
                <AlertDialogContent className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-poke-xl border border-poke-border bg-poke-surface p-6 shadow-poke-lg">
                  <AlertDialogTitle className="text-lg font-heading font-bold text-poke-text-primary">
                    {t(cascadeNotice ? 'rounds.regenerateDialog.cascadeTitle' : 'rounds.regenerateDialog.title')}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="my-4 text-sm text-poke-text-secondary">
                    {cascadeNotice
                      ? t('rounds.regenerateDialog.cascadeMessage', { cascade: errorText(cascadeNotice) })
                      : t('rounds.regenerateDialog.message')}
                  </AlertDialogDescription>
                  <div className="flex justify-end gap-3">
                    <AlertDialogClose render={<Button type="button" variant="ghost" size="sm" />}>{tUi('confirmDialog.cancel')}</AlertDialogClose>
                    <AlertDialogClose value="confirm" disabled={busy}
                      data-agent-confirm={cascadeNotice ? errorText(cascadeNotice) : t('rounds.regenerateDialog.message')}
                      render={<Button type="button" variant="danger" size="sm" className={cascadeNotice ? 'order-first' : undefined} />}>
                      {t(cascadeNotice ? 'rounds.regenerateDialog.cascadeConfirm' : 'rounds.regenerateDialog.confirm')}
                    </AlertDialogClose>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {canGenerateNext && (
              <Button type="button" size="sm" disabled={busy || manualOpen || participants.length < 2 || swissBlocked} loading={writing === 'rounds.errors.generateRound'}
                onClick={() => void write(requests.generate, 'rounds.errors.generateRound')}>
                {t('rounds.generateNext')}
              </Button>
            )}
            {canGenerateAll && (
              <ActionButton type="button" className={getButtonClasses('secondary', 'sm')}
                disabled={busy || manualOpen || participants.length < 2}
                onClick={() => write(requests.generateAll, 'rounds.errors.generateAll')}>
                {t('rounds.generateAll')}
              </ActionButton>
            )}
            {canCreateManual && (
              <Button type="button" ref={manualTrigger} variant="secondary" size="sm" disabled={busy || manualOpen || participants.length < 2 || swissBlocked}
                onClick={() => { setDeadline(null); setManualOpen(true); }}>
                {t('rounds.createManual')}
              </Button>
            )}
          </div>
          {participants.length < 2 && (
            <p className="text-caption text-fg-muted">{errorText({ code: 'tournament_participants_too_few' })}</p>
          )}
          {swissBlocked && (
            <p className="text-caption text-fg-muted">
              {errorText({ code: 'tournament_current_round_incomplete', params: { round: translateEngineLabel('round', current.name, locale) } })}
            </p>
          )}
          {groupedManualBlocked && (
            <p className="text-caption text-fg-muted">{errorText({ code: 'rounds_manual_league_grouped' })}</p>
          )}
        </>
      )}
      {manualOpen && canCreateManual && editable && (
        <ManualRoundForm phase={address} participants={participants} bestOfDefault={phase.best_of_default}
          onRoundCreated={() => {
            closeManual();
            setError(null);
            setWarnings([]);
            startRefresh(() => router.refresh());
          }}
          onCancel={() => {
            setManualOpen(false);
            requestAnimationFrame(() => manualTrigger.current?.focus());
          }} />
      )}

      {rounds.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-poke-md border border-dashed border-hairline-strong px-4 py-8 text-center">
          <ItemIcon item="vs-seeker" size={48} />
          <p className="text-body text-fg-muted">{editable ? t('rounds.empty') : tPhase('phasePage.noRounds')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rounds.map(round => {
            const panelId = `${prefix}-${round.id}`;
            const expanded = selected?.id === round.id;
            const canEdit = editable && !manualOpen;
            const transitions = phaseRoundMachine.transitionsFrom(round.status, 'admin');
            const canStart = canEdit && transitions.some(transition => transition.event === 'start');
            const canComplete = canEdit && transitions.some(transition => transition.event === 'complete');
            const resetDialog = reset?.roundId === round.id ? reset : null;
            const canReset = !phase.archived && !manualOpen && expanded && detail?.success
              && detail.data.updated_at === round.updated_at
              && (transitions.some(transition => transition.event === 'reset')
                || detail.data.matches.some(match => match.status !== 'scheduled'));
            const bestOf = bestOfDraft?.id === round.id ? bestOfDraft.value : round.best_of;
            const canDelete = canEdit && !hasStructure && phaseAllowsDeletion
              && round.status !== 'completed' && round.round_number === latest && detail?.success && expanded
              && detail.data.status !== 'completed' && detail.data.updated_at === round.updated_at
              && detail.data.matches.every(match => match.status === 'scheduled' && !match.winner_id && !match.date_played
                && !match.scheduled_at && !match.social_image_url && match.bracket_side === null && match.bracket_pos === null
                && match.games.length === 0);

            return (
              <Card key={round.id} variant="muted" padding="none" className="overflow-hidden">
                <div className={ROUND_ROW_HEADER_CLASS}>
                  <RoundDisclosure heading="h3" round={round} panelId={panelId} expanded={expanded} onToggle={() => {
                    setExpandedId(expanded ? null : round.id);
                    setAttempt(n => n + 1);
                  }} />
                  <div className={ROUND_ROW_ACTIONS_CLASS}>
                    {canEdit && round.status === 'pending' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="w-24 shrink-0">
                          <Select value={bestOf} disabled={busy}
                            aria-label={t('rounds.bestOfLabel', { name: translateEngineLabel('round', round.name, locale) })}
                            onChange={event => {
                              setDeadline(null);
                              setBestOfDraft({ id: round.id, value: Number(event.target.value) });
                            }}
                            className="h-11 py-1 text-caption sm:h-8">
                            {bestOfChoices(round.best_of).map(bo => <option key={bo} value={bo}>{tCommon('bestOf', { count: bo })}</option>)}
                          </Select>
                        </div>
                        {bestOf !== round.best_of && (
                          <>
                            <Button type="button" size="sm" disabled={busy}
                              onClick={() => void edit(round.id, { best_of: bestOf })}>{t('rounds.deadline.save')}</Button>
                            <Button type="button" size="sm" variant="ghost" disabled={busy}
                              onClick={() => setBestOfDraft(null)}>{t('rounds.deadline.cancel')}</Button>
                          </>
                        )}
                      </div>
                    )}
                    {canStart && <Button type="button" variant="secondary" size="sm" disabled={busy}
                      onClick={() => void edit(round.id, { status: 'active' })}>{t('rounds.start')}</Button>}
                  </div>
                </div>

                <div className="space-y-1 px-3 pb-3">
                  <RoundByeNotice playerIds={round.bye_player_ids} names={names} settled />
                  <RoundDeadlineRow round={round} now={now} editing={deadline?.id === round.id && canEdit}
                    draft={deadline?.value ?? ''} saving={busy}
                    onEdit={canEdit ? () => {
                      setBestOfDraft(null);
                      setDeadline({ id: round.id, value: isoToLocalInput(round.deadline) });
                    } : undefined}
                    onDraftChange={value => setDeadline({ id: round.id, value })}
                    onSave={() => {
                      const value = localInputToIso(deadline?.value ?? '');
                      if (value !== null) void edit(round.id, { deadline: value });
                    }}
                    onClear={() => void edit(round.id, { deadline: null })}
                    onCancel={() => setDeadline(null)} />
                </div>

                <div id={panelId} hidden={!expanded} className="space-y-2 border-t border-hairline bg-surface px-3 py-3">
                  {expanded && (
                    <>
                      <RoundMatchesPanel loading={!detail} matches={matches}
                        error={detail && !detail.success ? detail.error : null}
                        errorCode={detail && !detail.success ? detail.code : null}
                        errorParams={detail && !detail.success ? detail.params : undefined}
                        matchHref={id => phaseMatchHref(address, id)}
                        onRetry={() => setAttempt(n => n + 1)} />
                      {canComplete && openCount !== undefined && (openCount === 0 ? (
                        <Button type="button" size="sm" disabled={busy} onClick={() => void edit(round.id, { status: 'completed' })}>{t('rounds.complete')}</Button>
                      ) : (
                        <p className="text-caption text-fg-muted">{t('rounds.completeBlocked', { count: openCount })}</p>
                      ))}
                      {(canReset || (!phase.archived && resetDialog)) && (
                        <AlertDialog open={resetDialog !== null} onOpenChange={(open, details) => {
                          if (open) setReset({ roundId: round.id, cascade: false });
                          else {
                            setReset(null);
                            if (details.returnValue === 'confirm') void resetRound(round.id, resetDialog?.cascade === true);
                          }
                        }}>
                          <AlertDialogTrigger disabled={busy || !canReset}
                            render={<Button type="button" variant="ghost" size="sm" className="text-loss" />}>
                            {t('rounds.reset')}
                          </AlertDialogTrigger>
                          <AlertDialogBackdrop className="fixed inset-0 z-50 backdrop-blur-xs" />
                          <AlertDialogContent className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-poke-xl border border-poke-border bg-poke-surface p-6 shadow-poke-lg">
                            <AlertDialogTitle className="text-lg font-heading font-bold text-poke-text-primary">
                              {t(resetDialog?.cascade ? 'rounds.resetDialog.cascadeTitle' : 'rounds.resetDialog.title')}
                            </AlertDialogTitle>
                            <AlertDialogDescription className="my-4 text-sm text-poke-text-secondary">
                              {t(resetDialog?.cascade ? 'rounds.resetDialog.cascadeMessage' : 'rounds.resetDialog.message')}
                            </AlertDialogDescription>
                            <div className="flex flex-wrap justify-end gap-3">
                              <AlertDialogClose render={<Button type="button" variant="ghost" size="sm" />}>{tUi('confirmDialog.cancel')}</AlertDialogClose>
                              <AlertDialogClose value="confirm" disabled={busy}
                                data-agent-confirm={t(resetDialog?.cascade ? 'rounds.resetDialog.cascadeMessage' : 'rounds.resetDialog.message')}
                                render={<Button type="button" variant="danger" size="sm" className={resetDialog?.cascade ? 'order-first' : undefined} />}>
                                {t(resetDialog?.cascade ? 'rounds.resetDialog.cascadeConfirm' : 'rounds.resetDialog.confirm')}
                              </AlertDialogClose>
                            </div>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                      {canDelete && (
                        <AlertDialog onOpenChange={(open, details) => {
                          if (!open && details.returnValue === 'confirm') {
                            void write(() => requests.remove(round.id), 'rounds.errors.deleteRound', () => {
                              setExpandedId(null);
                              region.current?.focus();
                            });
                          }
                        }}>
                          <AlertDialogTrigger disabled={busy} render={<Button type="button" variant="ghost" size="sm" className="text-loss" />}>
                            {t('rounds.delete')}
                          </AlertDialogTrigger>
                          <AlertDialogBackdrop className="fixed inset-0 z-50 backdrop-blur-xs" />
                          <AlertDialogContent className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-poke-xl border border-poke-border bg-poke-surface p-6 shadow-poke-lg">
                            <AlertDialogTitle className="text-lg font-heading font-bold text-poke-text-primary">{t('rounds.deleteDialog.title')}</AlertDialogTitle>
                            <AlertDialogDescription className="my-4 text-sm text-poke-text-secondary">{tPhase('phasePage.deleteRoundWarning')}</AlertDialogDescription>
                            <div className="flex justify-end gap-3">
                              <AlertDialogClose render={<Button type="button" variant="ghost" size="sm" />}>{tUi('confirmDialog.cancel')}</AlertDialogClose>
                              <AlertDialogClose value="confirm" data-agent-confirm={tPhase('phasePage.deleteRoundWarning')}
                                render={<Button type="button" variant="danger" size="sm" />}>{t('rounds.deleteDialog.confirm')}</AlertDialogClose>
                            </div>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
