'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import type { Round, RoundStatus, RoundWithMatches } from '@/types/round';
import type { PublicMatch } from '@/lib/match/public-match';
import type { Tournament } from '@/types/tournament';
import type { ApiResult } from '@/types/api';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ManualRoundForm from './ManualRoundForm';
import { isLegacyElimBracketData } from '@/components/bracket/legacy';
import { useLocale, useT } from '@/i18n/client';
import { LocalTime, useMinuteClock } from '@/i18n/LocalTime';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { enumLabel } from '@/i18n/content/enum-label';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { commonMessages } from '@/i18n/messages/common';
import { contentMessages } from '@/i18n/messages/content';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsAdmin, errorsMatches, errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { isoToLocalInput, localInputToIso } from '@/components/draft-admin/admin-view';
import { buildStartupChecklist, nextRoundToStart } from '@/lib/tournament/startup-checklist';
import { apiFailure, type UiError } from './ui-error';
import type { ParticipantsSummary } from './participants-events';
import { StartupChecklistView, STARTUP_CHECKLIST_REGION_ID_PREFIX, type StartupChecklistLinks } from './StartupChecklist';
import { useParticipantsSummary } from './useParticipantsSummary';

const BEST_OF_OPTIONS = [1, 3, 5, 7] as const;

type RoundErrorKey = `rounds.errors.${keyof typeof tournamentsAdminMessages.en.rounds.errors}`;

interface RoundManagerProps {
  tournament: Tournament;
  initialRounds: Round[];
  /** The ruleset's name, for the start-up checklist. */
  rulesetName?: string | null;
  /** The phase pairs by league group (or its own groups), so the round-robin length is the server's call. */
  groupsInUse?: boolean;
  /** Player id → league group id for a phase that mirrors league groups; `null` otherwise. */
  leagueGroupOf?: Readonly<Record<string, string>> | null;
  /** Where the checklist's links point (anchors on the page or routes). */
  checklistLinks?: StartupChecklistLinks;
  /** Tests and server rendering only: the participant summary the checklist starts from. */
  initialParticipants?: ParticipantsSummary | null;
}

/**
 * The request init of a Generate call. Without "start right away" it is `undefined` (the caller sends a plain
 * body-less POST, exactly as before); with it, the optional `start_round` body the generate routes accept.
 */
export function generateRequestInit(startNow: boolean): RequestInit | undefined {
  if (!startNow) return undefined;
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_round: true }),
  };
}

export type RoundMatchesLoad =
  | { ok: true; matches: PublicMatch[] }
  | { ok: false; error: string; code?: string };

/**
 * The English message of a request that never produced an API body (offline,
 * non-JSON). `RoundMatchesPanel` shows it in the viewer's language.
 */
export const ROUND_MATCHES_LOAD_FAILED = 'Failed to load matches';

/**
 * Fetch one round's matches (`GET /api/tournaments/[id]/rounds/[rid]`). A
 * failed request comes back as an error, never as an empty list: "No matches
 * in this round." must mean the round has none.
 */
export async function fetchRoundMatches(
  tournamentId: string,
  roundId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RoundMatchesLoad> {
  try {
    const res = await fetchImpl(`/api/tournaments/${tournamentId}/rounds/${roundId}`);
    const result = (await res.json()) as ApiResult<RoundWithMatches>;
    if (!result.success) {
      return result.code ? { ok: false, error: result.error, code: result.code } : { ok: false, error: result.error };
    }
    return { ok: true, matches: result.data.matches };
  } catch {
    return { ok: false, error: ROUND_MATCHES_LOAD_FAILED };
  }
}

interface RoundMatchesPanelProps {
  loading: boolean;
  /** The failed load's message; matches are not shown while it is set. */
  error: string | null;
  /** The failed load's API error code, when the server sent one. */
  errorCode?: string | null;
  matches: PublicMatch[] | undefined;
  onRetry: () => void;
}

/** The expanded round's match list: loading, a failed load with retry, empty, or the matches. */
export function RoundMatchesPanel({ loading, error, errorCode, matches, onRetry }: RoundMatchesPanelProps) {
  const t = useT(tournamentsAdminMessages);
  const tEnum = useT(enumMessages);
  const errorText = useApiErrorText(errorsTournaments);
  if (loading) {
    return <p className="text-xs text-poke-text-muted">{t('rounds.loadingMatches')}</p>;
  }
  if (error) {
    const message =
      !errorCode && error === ROUND_MATCHES_LOAD_FAILED
        ? t('rounds.loadMatchesFailed')
        : errorText({ error, code: errorCode });
    return (
      <Alert variant="error" className="flex items-center justify-between gap-3">
        <span>{t('rounds.matchesError', { error: message })}</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('rounds.retry')}
        </Button>
      </Alert>
    );
  }
  if (!matches || matches.length === 0) {
    return <p className="text-xs text-poke-text-muted">{t('rounds.noMatches')}</p>;
  }
  return (
    <div className="space-y-1">
      {matches.map((m) => (
        <Link
          key={m.id}
          href={`/admin/matches/${m.id}`}
          className="flex items-center justify-between p-2 rounded-poke-md hover:bg-poke-elevated text-sm transition-colors"
        >
          <div className="flex items-center gap-2 text-poke-text-primary">
            <span className={m.winner_id === m.player_1_id ? 'font-semibold' : m.winner_id ? 'text-poke-text-muted' : ''}>
              {m.player_1_name}
            </span>
            <span className="text-poke-text-muted">{t('rounds.versus')}</span>
            <span className={m.winner_id === m.player_2_id ? 'font-semibold' : m.winner_id ? 'text-poke-text-muted' : ''}>
              {m.player_2_name}
            </span>
          </div>
          <Badge variant={m.winner_id ? 'green' : 'gray'} size="sm">
            {enumLabel(tEnum, 'matchStatus', m.winner_id ? 'completed' : m.status)}
          </Badge>
        </Link>
      ))}
    </div>
  );
}

/**
 * The tournament's participants as an id → name map
 * (`GET /api/tournaments/[id]/participants`, public). `null` when the request
 * fails, so a bye is never shown under a wrong or missing name.
 */
export async function fetchParticipantNames(
  tournamentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string> | null> {
  try {
    const res = await fetchImpl(`/api/tournaments/${tournamentId}/participants`);
    const result = (await res.json()) as ApiResult<{ id: string; name: string }[]>;
    if (!result.success) return null;
    const names: Record<string, string> = {};
    for (const participant of result.data) names[participant.id] = participant.name;
    return names;
  } catch {
    return null;
  }
}

interface RoundByeNoticeProps {
  playerIds: readonly string[];
  /** id → name; `null` while the participants load or when they could not be loaded. */
  names: Record<string, string> | null | undefined;
  /** True once the participant request has finished (an unnamed bye then shows a placeholder). */
  settled: boolean;
}

/** "Bye: <name>" for a round that gave one or more byes; nothing otherwise. */
/**
 * Round row header layout. On a phone the title takes its own full-width line
 * (basis-full) so the name and Bo label stay readable and the controls wrap
 * below it; from sm up the title shares the line with the controls again.
 */
export const ROUND_ROW_HEADER_CLASS = 'p-3 flex flex-wrap items-center justify-between gap-2';
export const ROUND_ROW_TITLE_CLASS = 'text-left min-w-0 basis-full sm:basis-0 sm:flex-1';
export const ROUND_ROW_HEADING_CLASS = 'font-heading font-medium text-sm text-poke-text-primary break-words';
export const ROUND_ROW_ACTIONS_CLASS = 'flex flex-wrap items-center gap-2 min-w-0 max-w-full';

export function RoundByeNotice({ playerIds, names, settled }: RoundByeNoticeProps) {
  const t = useT(tournamentsAdminMessages);
  if (playerIds.length === 0 || !settled) return null;
  const label = playerIds
    .map((id) => names?.[id] ?? t('rounds.byeUnknownPlayer'))
    .join(', ');
  return <p className="text-xs text-poke-text-secondary">{t('rounds.bye', { names: label })}</p>;
}

/** A round is overdue when its deadline has passed and it is not completed. */
export function isRoundOverdue(round: Pick<Round, 'deadline' | 'status'>, now: number): boolean {
  if (!round.deadline || round.status === 'completed') return false;
  const due = Date.parse(round.deadline);
  return !Number.isNaN(due) && due < now;
}

/**
 * Set (an ISO 8601 instant) or clear (`null`) a round's deadline through the
 * round update endpoint. The caller shows a thrown (offline) failure.
 */
export async function saveRoundDeadline(
  tournamentId: string,
  roundId: string,
  deadline: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<Round>> {
  const res = await fetchImpl(`/api/tournaments/${tournamentId}/rounds/${roundId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deadline }),
  });
  return (await res.json()) as ApiResult<Round>;
}

interface RoundDeadlineRowProps {
  round: Pick<Round, 'deadline' | 'status'>;
  /** Epoch ms the overdue check compares against. */
  now: number;
  editing: boolean;
  /** The `datetime-local` input's value while editing. */
  draft: string;
  saving: boolean;
  onEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onCancel: () => void;
}

/** One round's deadline: the instant in the viewer's zone, an overdue badge, and an inline editor. */
export function RoundDeadlineRow({
  round,
  now,
  editing,
  draft,
  saving,
  onEdit,
  onDraftChange,
  onSave,
  onClear,
  onCancel,
}: RoundDeadlineRowProps) {
  const t = useT(tournamentsAdminMessages);
  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <input
          type="datetime-local"
          aria-label={t('rounds.deadline.inputLabel')}
          value={draft}
          disabled={saving}
          onChange={(e) => onDraftChange(e.target.value)}
          className="border border-poke-border rounded-poke-md px-2 py-1 text-xs bg-poke-surface text-poke-text-primary"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={onSave}
          disabled={saving || localInputToIso(draft) === null}
          loading={saving}
        >
          {t('rounds.deadline.save')}
        </Button>
        {round.deadline && (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={saving}>
            {t('rounds.deadline.clear')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {t('rounds.deadline.cancel')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-poke-text-secondary">
      <span>{t('rounds.deadline.label')}:</span>
      {round.deadline ? (
        <LocalTime value={round.deadline} preset="dateTimeYear" className="text-poke-text-primary" />
      ) : (
        <span className="text-poke-text-muted">{t('rounds.deadline.none')}</span>
      )}
      {isRoundOverdue(round, now) && (
        <Badge variant="red" size="sm">
          {t('rounds.deadline.overdue')}
        </Badge>
      )}
      <Button variant="ghost" size="sm" onClick={onEdit}>
        {round.deadline ? t('rounds.deadline.edit') : t('rounds.deadline.set')}
      </Button>
    </div>
  );
}

export default function RoundManager({
  tournament,
  initialRounds,
  rulesetName = null,
  groupsInUse = false,
  leagueGroupOf = null,
  checklistLinks = {},
  initialParticipants = null,
}: RoundManagerProps) {
  const [rounds, setRounds] = useState<Round[]>(initialRounds);
  const [generating, setGenerating] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  // "Start the new round right away" on Generate. Off on every visit: starting is a deliberate step.
  const [startNow, setStartNow] = useState(false);
  const [startingRoundId, setStartingRoundId] = useState<string | null>(null);
  // Set when the server answered `rounds_all_generated` for this many rounds (grouped phases, unknown count).
  const [allGeneratedAtCount, setAllGeneratedAtCount] = useState<number | null>(null);
  const startNowHintId = useId();
  const participants = useParticipantsSummary(tournament.id, initialParticipants);
  const t = useT(tournamentsAdminMessages);
  const tCommon = useT(commonMessages);
  const tContent = useT(contentMessages);
  const tEnum = useT(enumMessages);
  const locale = useLocale();
  // errorsSeasons: a grouped league's phase refuses round generation with league-group codes
  // (PHASE_PLAYER_WITHOUT_LEAGUE_GROUP, PHASE_GROUPS_STALE; src/lib/tournament/group-rounds.ts, createRound).
  const errorText = useApiErrorText(errorsTournaments, errorsAdmin, errorsMatches, errorsSeasons);
  const [error, setError] = useState<UiError<RoundErrorKey> | null>(null);
  const [expandedRound, setExpandedRound] = useState<string | null>(null);
  const [matchesByRound, setMatchesByRound] = useState<Record<string, PublicMatch[]>>({});
  const [loadingMatches, setLoadingMatches] = useState<string | null>(null);
  const [matchErrors, setMatchErrors] = useState<Record<string, { error: string; code?: string }>>({});
  const [showManualForm, setShowManualForm] = useState(false);
  const [resetRoundId, setResetRoundId] = useState<string | null>(null);
  const [resettingRound, setResettingRound] = useState(false);
  const [deleteRoundId, setDeleteRoundId] = useState<string | null>(null);
  const [deletingRound, setDeletingRound] = useState(false);
  const [generatingBracket, setGeneratingBracket] = useState(false);
  const [regeneratingBracket, setRegeneratingBracket] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regenNeedsCascade, setRegenNeedsCascade] = useState(false);
  const [regenCascadeMessage, setRegenCascadeMessage] = useState<ApiErrorLike | null>(null);
  const [resetNeedsCascade, setResetNeedsCascade] = useState(false);
  const [repairingBracket, setRepairingBracket] = useState(false);
  /** Matches the last repair materialized; null hides the notice. */
  const [repairInfo, setRepairInfo] = useState<number | null>(null);
  const [bracketResetEnabled, setBracketResetEnabled] = useState(
    tournament.bracket_reset_enabled ?? true
  );
  const [savingResetToggle, setSavingResetToggle] = useState(false);
  const [resetToggleInfo, setResetToggleInfo] = useState<'enabled' | 'disabled' | null>(null);
  const [deadlineEditId, setDeadlineEditId] = useState<string | null>(null);
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [savingDeadlineId, setSavingDeadlineId] = useState<string | null>(null);
  // Bye names: the participants are fetched once, and only when a round has a bye.
  const [participantNames, setParticipantNames] = useState<Record<string, string> | null>(null);
  const [participantNamesSettled, setParticipantNamesSettled] = useState(false);
  // The request's time on the server and in the first client render (rule T4), then the shared
  // minute clock, so a deadline that passes while the page is open flips the overdue badge.
  const now = useMinuteClock();

  const hasByes = rounds.some((r) => (r.bye_player_ids ?? []).length > 0);
  useEffect(() => {
    if (!hasByes || participantNamesSettled) return;
    let cancelled = false;
    void fetchParticipantNames(tournament.id).then((names) => {
      if (cancelled) return;
      setParticipantNames(names);
      setParticipantNamesSettled(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hasByes, participantNamesSettled, tournament.id]);

  const isRoundRobin = tournament.bracket_type === 'round_robin';
  const isElimination =
    tournament.bracket_type === 'single_elim' ||
    tournament.bracket_type === 'double_elim';
  const isLegacyElim =
    isElimination && isLegacyElimBracketData(rounds);

  async function generateBracket() {
    setGeneratingBracket(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tournaments/${tournament.id}/generate-bracket`,
        generateRequestInit(startNow) ?? { method: 'POST' },
      );
      const result = await res.json();
      if (!result.success) {
        setError(apiFailure(result));
        return;
      }
      const roundsRes = await fetch(`/api/tournaments/${tournament.id}/rounds`);
      const roundsJson: ApiResult<Round[]> = await roundsRes.json();
      if (roundsJson.success) setRounds(roundsJson.data);
    } catch {
      setError({ key: 'rounds.errors.generateBracket' });
    } finally {
      setGeneratingBracket(false);
    }
  }

  async function handleRegenerateBracket() {
    setRegeneratingBracket(true);
    setError(null);
    setRepairInfo(null);
    try {
      const res = await fetch(`/api/tournaments/${tournament.id}/regenerate-bracket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cascade: regenNeedsCascade }),
      });
      const result = await res.json();
      if (!result.success) {
        if (result.code === 'REGENERATE_PLAYED' && !regenNeedsCascade) {
          setRegenNeedsCascade(true);
          setRegenCascadeMessage(toApiErrorLike(result));
          return;
        }
        setError(apiFailure(result));
        setConfirmRegenerate(false);
        setRegenNeedsCascade(false);
        setRegenCascadeMessage(null);
        return;
      }
      const roundsRes = await fetch(`/api/tournaments/${tournament.id}/rounds`);
      const roundsJson: ApiResult<Round[]> = await roundsRes.json();
      if (roundsJson.success) {
        setRounds(roundsJson.data);
        setMatchesByRound({});
        setExpandedRound(null);
      }
      setConfirmRegenerate(false);
      setRegenNeedsCascade(false);
      setRegenCascadeMessage(null);
    } catch {
      setError({ key: 'rounds.errors.regenerateBracket' });
      setConfirmRegenerate(false);
      setRegenNeedsCascade(false);
      setRegenCascadeMessage(null);
    } finally {
      setRegeneratingBracket(false);
    }
  }

  async function handleRepairBracket() {
    setRepairingBracket(true);
    setError(null);
    setRepairInfo(null);
    try {
      const res = await fetch(`/api/tournaments/${tournament.id}/repair-bracket`, {
        method: 'POST',
      });
      const result = await res.json();
      if (!result.success) {
        setError(apiFailure(result));
        return;
      }
      const materialized: number = result.data?.slots_materialized ?? 0;
      setRepairInfo(materialized);
      const roundsRes = await fetch(`/api/tournaments/${tournament.id}/rounds`);
      const roundsJson: ApiResult<Round[]> = await roundsRes.json();
      if (roundsJson.success) setRounds(roundsJson.data);
      setMatchesByRound({});
    } catch {
      setError({ key: 'rounds.errors.repairBracket' });
    } finally {
      setRepairingBracket(false);
    }
  }

  async function handleToggleBracketReset(enabled: boolean) {
    setSavingResetToggle(true);
    setError(null);
    setResetToggleInfo(null);
    try {
      const res = await fetch(`/api/tournaments/${tournament.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bracket_reset_enabled: enabled }),
      });
      const result = await res.json();
      if (!result.success) {
        setError(apiFailure(result));
        return;
      }
      setBracketResetEnabled(enabled);
      setMatchesByRound({});
      setResetToggleInfo(enabled ? 'enabled' : 'disabled');
    } catch {
      setError({ key: 'rounds.errors.toggleReset' });
    } finally {
      setSavingResetToggle(false);
    }
  }

  async function handleDeleteRound() {
    if (!deleteRoundId) return;
    setDeletingRound(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rounds/${deleteRoundId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.success) {
        setError(apiFailure(result));
        setDeleteRoundId(null);
        return;
      }
      setRounds((prev) => prev.filter((r) => r.id !== deleteRoundId));
      setMatchesByRound((prev) => {
        const next = { ...prev };
        delete next[deleteRoundId];
        return next;
      });
      setDeleteRoundId(null);
    } catch {
      setError({ key: 'rounds.errors.deleteRound' });
      setDeleteRoundId(null);
    } finally {
      setDeletingRound(false);
    }
  }

  async function generateNextRound() {
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/generate-round/${tournament.id}`,
        generateRequestInit(startNow) ?? { method: 'POST' },
      );
      const result: ApiResult<Round> = await res.json();

      if (!result.success) {
        if (isRoundRobin && result.code === 'rounds_all_generated') {
          setAllGeneratedAtCount(rounds.length);
          return;
        }
        setError(apiFailure(result));
        return;
      }

      setRounds((prev) => [...prev, result.data]);
    } catch {
      setError({ key: 'rounds.errors.generateRound' });
    } finally {
      setGenerating(false);
    }
  }

  async function generateAllRounds() {
    setGeneratingAll(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/tournaments/${tournament.id}/generate-all-rounds`,
        generateRequestInit(startNow) ?? { method: 'POST' },
      );
      const result: ApiResult<Round[]> = await res.json();

      if (!result.success) {
        if (isRoundRobin && result.code === 'rounds_all_generated') {
          setAllGeneratedAtCount(rounds.length);
          return;
        }
        setError(apiFailure(result));
        return;
      }

      setRounds((prev) => [...prev, ...result.data]);
    } catch {
      setError({ key: 'rounds.errors.generateAll' });
    } finally {
      setGeneratingAll(false);
    }
  }

  function handleManualRoundCreated(round: Round) {
    setRounds((prev) => [...prev, round]);
    setShowManualForm(false);
  }

  async function updateRoundBo(roundId: string, bestOf: number) {
    setError(null);
    try {
      const res = await fetch(
        `/api/tournaments/${tournament.id}/rounds/${roundId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ best_of: bestOf }),
        }
      );
      const result: ApiResult<Round> = await res.json();

      if (!result.success) {
        setError(apiFailure(result));
        return;
      }

      setRounds((prev) =>
        prev.map((r) => (r.id === roundId ? result.data : r))
      );
    } catch {
      setError({ key: 'rounds.errors.updateBestOf' });
    }
  }

  async function updateRoundDeadline(roundId: string, deadline: string | null) {
    setError(null);
    setSavingDeadlineId(roundId);
    try {
      const result = await saveRoundDeadline(tournament.id, roundId, deadline);

      if (!result.success) {
        setError(apiFailure(result));
        return;
      }

      setRounds((prev) =>
        prev.map((r) => (r.id === roundId ? result.data : r))
      );
      setDeadlineEditId(null);
    } catch {
      setError({ key: 'rounds.errors.updateDeadline' });
    } finally {
      setSavingDeadlineId(null);
    }
  }

  async function updateRoundStatus(roundId: string, status: RoundStatus) {
    setError(null);
    try {
      const res = await fetch(
        `/api/tournaments/${tournament.id}/rounds/${roundId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      );
      const result: ApiResult<Round> = await res.json();

      if (!result.success) {
        setError(apiFailure(result));
        return;
      }

      setRounds((prev) =>
        prev.map((r) => (r.id === roundId ? result.data : r))
      );
    } catch {
      setError({ key: 'rounds.errors.updateStatus' });
    }
  }

  /** Start a pending round: the card's Start button and the pending-round banner share it. */
  async function startRound(roundId: string) {
    setStartingRoundId(roundId);
    try {
      await updateRoundStatus(roundId, 'active');
    } finally {
      setStartingRoundId(null);
    }
  }

  async function toggleRoundMatches(roundId: string) {
    if (expandedRound === roundId) {
      setExpandedRound(null);
      return;
    }

    setExpandedRound(roundId);

    if (!matchesByRound[roundId]) {
      await loadRoundMatches(roundId);
    }
  }

  async function loadRoundMatches(roundId: string) {
    setLoadingMatches(roundId);
    setMatchErrors((prev) => {
      const next = { ...prev };
      delete next[roundId];
      return next;
    });
    const result = await fetchRoundMatches(tournament.id, roundId);
    if (result.ok) {
      setMatchesByRound((prev) => ({ ...prev, [roundId]: result.matches }));
    } else {
      // Shown in the expanded panel with a retry, not as an empty round.
      setMatchErrors((prev) => ({
        ...prev,
        [roundId]: result.code ? { error: result.error, code: result.code } : { error: result.error },
      }));
    }
    setLoadingMatches(null);
  }

  async function handleResetRound() {
    if (!resetRoundId) return;
    setResettingRound(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rounds/${resetRoundId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cascade: resetNeedsCascade }),
      });
      const result = await res.json();
      if (result.success) {
        // Update local state — round goes to pending, clear cached matches
        setRounds((prev) =>
          prev.map((r) =>
            r.id === resetRoundId ? { ...r, status: 'pending' as RoundStatus } : r
          )
        );
        setMatchesByRound((prev) => {
          const updated = { ...prev };
          delete updated[resetRoundId];
          return updated;
        });
        setExpandedRound(null);
        setResetRoundId(null);
        setResetNeedsCascade(false);
      } else if (result.code === 'DOWNSTREAM_PLAYED' && !resetNeedsCascade) {
        setResetNeedsCascade(true);
      } else {
        setError(apiFailure(result));
        setResetRoundId(null);
        setResetNeedsCascade(false);
      }
    } catch {
      setError({ key: 'rounds.errors.resetRound' });
      setResetRoundId(null);
      setResetNeedsCascade(false);
    } finally {
      setResettingRound(false);
    }
  }

  // Round Robin pairings are deterministic, so rounds can be generated
  // in advance without waiting for previous rounds to complete.
  const canGenerate =
    tournament.status !== 'completed' &&
    (rounds.length === 0 ||
      isRoundRobin ||
      rounds[rounds.length - 1].status === 'completed');

  const isBusy =
    generating || generatingAll || generatingBracket || regeneratingBracket || repairingBracket;
  const isStructureElim = isElimination && !isLegacyElim;

  const checklist = buildStartupChecklist({
    bracketType: tournament.bracket_type,
    tournamentStatus: tournament.status,
    rulesetSet: Boolean(tournament.ruleset_id),
    rulesetName,
    bestOfDefault: tournament.best_of_default,
    participants: participants.summary,
    rounds,
    groupsInUse,
    leagueGroupOf,
  });
  const regionId = `${STARTUP_CHECKLIST_REGION_ID_PREFIX}${tournament.id}`;

  // Round robin: every round exists. Known from the participant count, or from the server's refusal when the
  // count is unknown or the phase follows a league week plan; deleting a round clears the latch.
  const roundRobin = isRoundRobin ? checklist.roundRobin : null;
  const allGeneratedCount = roundRobin?.allGenerated
    ? roundRobin.total
    : isRoundRobin && allGeneratedAtCount !== null && allGeneratedAtCount === rounds.length
      ? rounds.length
      : null;
  const hideGenerate = allGeneratedCount !== null;
  // The muted line below says it, so the checklist does not repeat it.
  const checklistItems = checklist.items.filter(
    (item) => !(item.id === 'roundsRemaining' && item.state === 'blocked'),
  );
  const shownChecklist = { items: checklistItems, blocked: checklistItems.some((item) => item.state === 'blocked') };
  const showChecklist = checklistItems.length > 0;
  // Only a blocking item disables Generate, and the checklist is what explains why.
  const generateBlocked = checklist.blocked;
  const checklistDescribes = showChecklist && (generateBlocked || Boolean(roundRobin?.pastLast)) ? regionId : undefined;

  const showsGenerateBracket = isElimination && !isLegacyElim && rounds.length === 0;
  const showsGenerateNext = (!isElimination || isLegacyElim) && !hideGenerate;
  const showsGenerateAll = isRoundRobin && !hideGenerate;
  const nextToStart = tournament.status === 'completed' ? null : nextRoundToStart(rounds);

  return (
    <div className="space-y-4">
      {error &&<Alert variant="error">{'api' in error ? errorText(error.api) : t(error.key)}</Alert>}
      {repairInfo !== null && <Alert variant="success">{t('rounds.repaired', { count: repairInfo })}</Alert>}
      {resetToggleInfo && (
        <Alert variant="success">
          {resetToggleInfo === 'enabled' ? t('rounds.resetEnabled') : t('rounds.resetDisabled')}
        </Alert>
      )}

      {showChecklist && (
        <StartupChecklistView
          id={regionId}
          checklist={shownChecklist}
          links={checklistLinks}
          status={participants.status}
          onRetry={participants.reload}
        />
      )}

      <div className="flex items-center gap-4 flex-wrap">
        {showsGenerateBracket && (
          <Button
            variant="secondary"
            size="sm"
            onClick={generateBracket}
            disabled={showManualForm || isBusy || generateBlocked}
            aria-describedby={generateBlocked ? checklistDescribes : undefined}
            loading={generatingBracket}
          >
            {t('rounds.generateBracket')}
          </Button>
        )}
        {isStructureElim && rounds.length > 0 && (
          <>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setRegenNeedsCascade(false);
                setRegenCascadeMessage(null);
                setConfirmRegenerate(true);
              }}
              disabled={isBusy}
              loading={regeneratingBracket}
            >
              {t('rounds.regenerateBracket')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRepairBracket}
              disabled={isBusy}
              loading={repairingBracket}
            >
              {t('rounds.repairBracket')}
            </Button>
          </>
        )}
        {showsGenerateNext && (
          <Button
            variant="secondary"
            size="sm"
            onClick={generateNextRound}
            disabled={!canGenerate || showManualForm || isBusy || generateBlocked || Boolean(roundRobin?.pastLast)}
            aria-describedby={checklistDescribes}
            loading={generating}
          >
            {t('rounds.generateNext')}
          </Button>
        )}
        {showsGenerateAll && (
          <Button
            variant="secondary"
            size="sm"
            onClick={generateAllRounds}
            disabled={!canGenerate || showManualForm || isBusy || generateBlocked}
            aria-describedby={generateBlocked ? checklistDescribes : undefined}
            loading={generatingAll}
          >
            {t('rounds.generateAll')}
          </Button>
        )}
        {allGeneratedCount !== null && (
          <span className="text-sm text-poke-text-muted">
            {t('rounds.allGenerated', { count: allGeneratedCount })}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowManualForm((v) => !v)}
          disabled={!canGenerate || isBusy}
          className="border border-poke-border"
        >
          {showManualForm ? t('rounds.cancelManual') : t('rounds.createManual')}
        </Button>
        <span className="text-sm text-poke-text-secondary">
          {enumLabel(tEnum, 'bracketType', tournament.bracket_type)} &middot;{' '}
          {tCommon('bestOf', { count: tournament.best_of_default })}
        </span>
        {tournament.bracket_type === 'double_elim' && (
          <label className="flex items-center gap-2 text-sm text-poke-text-primary">
            <input
              type="checkbox"
              checked={bracketResetEnabled}
              disabled={savingResetToggle || isBusy}
              onChange={(e) => handleToggleBracketReset(e.target.checked)}
              className="rounded accent-poke-accent"
            />
            {tContent('slot.ifNecessary', { label: t('rounds.grandFinalsReset') })}
          </label>
        )}
      </div>

      {(showsGenerateBracket || showsGenerateNext || showsGenerateAll) && (
        <div className="space-y-0.5">
          <label className="flex items-center gap-2 text-sm text-poke-text-primary">
            <input
              type="checkbox"
              checked={startNow}
              disabled={isBusy}
              onChange={(e) => setStartNow(e.target.checked)}
              aria-describedby={startNowHintId}
              className="rounded accent-poke-accent"
            />
            {t('rounds.startNow.label')}
          </label>
          <p id={startNowHintId} className="pl-6 text-xs text-poke-text-muted">
            {t('rounds.startNow.hint')}
            {showsGenerateAll && ` ${t('rounds.startNow.hintAll')}`}
          </p>
        </div>
      )}

      {showManualForm && (
        <ManualRoundForm
          tournamentId={tournament.id}
          bestOfDefault={tournament.best_of_default}
          onRoundCreated={handleManualRoundCreated}
          onCancel={() => setShowManualForm(false)}
        />
      )}

      {nextToStart && (
        <Alert variant="info" role="status" className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">
              {t('rounds.pending.title', { round: translateEngineLabel('round', nextToStart.name, locale) })}
            </p>
            <p>{t('rounds.pending.body')}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void startRound(nextToStart.id)}
            loading={startingRoundId === nextToStart.id}
            disabled={startingRoundId !== null}
          >
            {t('rounds.pending.start', { round: translateEngineLabel('round', nextToStart.name, locale) })}
          </Button>
        </Alert>
      )}

      {rounds.length === 0 ? (
        <p className="text-sm text-poke-text-muted">
          {t('rounds.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {rounds.map((round) => {
            const isExpanded = expandedRound === round.id;
            const matches = matchesByRound[round.id];

            return (
              <Card key={round.id} variant="outlined" padding="none">
                <div className={ROUND_ROW_HEADER_CLASS}>
                  <button
                    type="button"
                    onClick={() => toggleRoundMatches(round.id)}
                    className={ROUND_ROW_TITLE_CLASS}
                  >
                    <h4 className={ROUND_ROW_HEADING_CLASS}>
                      <span className="mr-1.5 text-poke-text-muted">{isExpanded ? '▾' : '▸'}</span>
                      {translateEngineLabel('round', round.name, locale)}
                      <span className="ml-2 text-xs text-poke-text-muted font-normal">
                        {tCommon('bestOf', { count: round.best_of })}
                      </span>
                    </h4>
                    <Badge variant={getStatusVariant(round.status)} size="sm">
                      {enumLabel(tEnum, 'roundStatus', round.status)}
                    </Badge>
                  </button>
                  <div className={ROUND_ROW_ACTIONS_CLASS}>
                    {round.status === 'pending' && (
                      <select
                        value={round.best_of}
                        onChange={(e) => updateRoundBo(round.id, Number(e.target.value))}
                        className="border border-poke-border rounded-poke-md px-2 py-1 text-xs bg-poke-surface text-poke-text-primary"
                      >
                        {BEST_OF_OPTIONS.map((bo) => (
                          <option key={bo} value={bo}>
                            {tCommon('bestOf', { count: bo })}
                          </option>
                        ))}
                      </select>
                    )}
                    {round.status === 'pending' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void startRound(round.id)}
                        loading={startingRoundId === round.id}
                      >
                        {t('rounds.start')}
                      </Button>
                    )}
                    {round.status === 'active' && (
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() => updateRoundStatus(round.id, 'completed')}
                      >
                        {t('rounds.complete')}
                      </Button>
                    )}
                    {round.status !== 'pending' && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setResetNeedsCascade(false);
                          setResetRoundId(round.id);
                        }}
                      >
                        {t('rounds.reset')}
                      </Button>
                    )}
                    {!isStructureElim && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteRoundId(round.id)}
                        className="text-poke-danger"
                      >
                        {t('rounds.delete')}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="px-3 pb-2 space-y-1">
                  <RoundByeNotice
                    playerIds={round.bye_player_ids ?? []}
                    names={participantNames}
                    settled={participantNamesSettled}
                  />
                  <RoundDeadlineRow
                    round={round}
                    now={now}
                    editing={deadlineEditId === round.id}
                    draft={deadlineDraft}
                    saving={savingDeadlineId === round.id}
                    onEdit={() => {
                      setDeadlineDraft(isoToLocalInput(round.deadline));
                      setDeadlineEditId(round.id);
                    }}
                    onDraftChange={setDeadlineDraft}
                    onSave={() => void updateRoundDeadline(round.id, localInputToIso(deadlineDraft))}
                    onClear={() => void updateRoundDeadline(round.id, null)}
                    onCancel={() => setDeadlineEditId(null)}
                  />
                </div>

                {isExpanded && (
                  <div className="border-t border-poke-border px-3 py-2">
                    <RoundMatchesPanel
                      loading={loadingMatches === round.id}
                      error={matchErrors[round.id]?.error ?? null}
                      errorCode={matchErrors[round.id]?.code ?? null}
                      matches={matches}
                      onRetry={() => void loadRoundMatches(round.id)}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={confirmRegenerate}
        onClose={() => {
          setConfirmRegenerate(false);
          setRegenNeedsCascade(false);
          setRegenCascadeMessage(null);
        }}
        onConfirm={handleRegenerateBracket}
        title={regenNeedsCascade ? t('rounds.regenerateDialog.cascadeTitle') : t('rounds.regenerateDialog.title')}
        message={
          regenNeedsCascade
            ? t('rounds.regenerateDialog.cascadeMessage', {
                cascade: regenCascadeMessage
                  ? errorText(regenCascadeMessage)
                  : t('rounds.regenerateDialog.cascadeFallback'),
              })
            : t('rounds.regenerateDialog.message')
        }
        confirmLabel={
          regenNeedsCascade ? t('rounds.regenerateDialog.cascadeConfirm') : t('rounds.regenerateDialog.confirm')
        }
        loading={regeneratingBracket}
      />
      <ConfirmDialog
        open={deleteRoundId !== null}
        onClose={() => setDeleteRoundId(null)}
        onConfirm={handleDeleteRound}
        title={t('rounds.deleteDialog.title')}
        message={t('rounds.deleteDialog.message')}
        confirmLabel={t('rounds.deleteDialog.confirm')}
        loading={deletingRound}
      />
      <ConfirmDialog
        open={resetRoundId !== null}
        onClose={() => {
          setResetRoundId(null);
          setResetNeedsCascade(false);
        }}
        onConfirm={handleResetRound}
        title={resetNeedsCascade ? t('rounds.resetDialog.cascadeTitle') : t('rounds.resetDialog.title')}
        message={resetNeedsCascade ? t('rounds.resetDialog.cascadeMessage') : t('rounds.resetDialog.message')}
        confirmLabel={resetNeedsCascade ? t('rounds.resetDialog.cascadeConfirm') : t('rounds.resetDialog.confirm')}
        loading={resettingRound}
      />
    </div>
  );
}

function getStatusVariant(status: RoundStatus): 'gray' | 'blue' | 'green' {
  switch (status) {
    case 'pending':
      return 'gray';
    case 'active':
      return 'blue';
    case 'completed':
      return 'green';
  }
}
