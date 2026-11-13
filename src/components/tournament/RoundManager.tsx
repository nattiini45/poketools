'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Round, RoundStatus, RoundWithMatches } from '@/types/round';
import { canRoundEvent } from '@/lib/tournament/round-state';
import type { PublicMatch } from '@/lib/match/public-match';
import type { Tournament } from '@/types/tournament';
import type { ApiResult, ApiWarning } from '@/types/api';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import ItemIcon from '@/components/ui/ItemIcon';
import Select from '@/components/ui/Select';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import Alert from '@/components/ui/Alert';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
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
import { bestOfChoices } from '@/lib/tournament/best-of';
import { cn } from '@/lib/utils/cn';
import { DANGER_OUTLINE, INFO_CALLOUT } from '@/components/admin/match-styles';
import { gameChangeWarnings } from '@/lib/match/game-change-outcome';
import { buildStartupChecklist, nextRoundToStart } from '@/lib/tournament/startup-checklist';
import { apiFailure, type UiError } from './ui-error';
import { formatNotReadyReasons, type FormatNotReadyReason } from './force-start';
import type { ParticipantsSummary } from './participants-events';
import { StartupChecklistView, STARTUP_CHECKLIST_REGION_ID_PREFIX, type StartupChecklistLinks } from './StartupChecklist';
import { useParticipantsSummary } from './useParticipantsSummary';

/** The reason's length limit on the round PATCH (`reasonSchema`). */
const FORCE_REASON_MAX_LENGTH = 500;

/**
 * Refusals that say the round list this view holds is out of date (another admin generated, deleted or completed a round, a
 * result came in, a phase ended): the list is read again, so the refusal text points at what is on screen.
 */
const ROUND_STATE_CODES: ReadonlySet<string> = new Set([
  'rounds_round_already_written',
  'rounds_round_completed',
  'rounds_phase_completed',
  'rounds_stage_ended',
  'rounds_end_when_round_open',
  'round_best_of_locked',
  'round_changed',
  'round_not_found',
  'tournament_not_found',
  'groups_forming_in_progress',
  'PHASE_GROUPS_STALE',
  'ENROLLMENT_SYNC_CONFLICT',
  'bracket_already_generated',
  'format_context_stale',
]);

/**
 * What a saved round delete, reset or bracket regenerate tells the admin: the league format could not take back the effects of a
 * result that no longer stands (`format_revert_failed` of the response; the matches may be gone, so nothing retries it), or the
 * reset took back a result in a phase whose stage had already ended (`stage_already_ended`: who advanced; the phase is not
 * reopened). The latter keeps its catalogue code, which `errorsMatches` words.
 */
function savedChangeWarnings(data: unknown): ApiWarning[] {
  return gameChangeWarnings(data).flatMap((warning): ApiWarning[] => {
    if (warning.code === 'admin_game_format_revert_failed') return [{ code: 'round_format_revert_failed' }];
    if (warning.code?.startsWith('admin_game_stage_already_ended')) {
      return [{ code: warning.code, ...(warning.params ? { params: warning.params } : {}) }];
    }
    return [];
  });
}

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

/** The generate routes a Generate call can reach. */
export type GenerateKind = 'next' | 'all';

/**
 * The URL of a Generate call. `force` adds `?force=true`, the league admin's audited override of the first-round guard
 * (`wantsForcedStart` in src/lib/format-engine/route-guards.ts): the routes read it from the query.
 */
export function generateEndpoint(tournamentId: string, kind: GenerateKind, force = false): string {
  const base = kind === 'next' ? `/api/generate-round/${tournamentId}` : `/api/tournaments/${tournamentId}/generate-all-rounds`;
  return force ? `${base}?force=true` : base;
}

export { formatNotReadyReasons, type FormatNotReadyReason } from './force-start';

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
    return <p className="text-caption text-fg-muted">{t('rounds.loadingMatches')}</p>;
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
    return <p className="text-caption text-fg-muted">{t('rounds.noMatches')}</p>;
  }
  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-poke-md border border-hairline">
      {matches.map((m) => (
        <li key={m.id}>
        <Link
          href={`/admin/matches/${m.id}`}
          className="flex min-h-11 items-center justify-between gap-3 bg-surface px-3 py-2 text-body motion-safe:transition-colors motion-safe:duration-80 hover:bg-hover sm:min-h-0"
        >
          <div className="flex items-center gap-2 text-fg">
            <span className={m.winner_id === m.player_1_id ? 'font-semibold' : m.winner_id ? 'text-fg-muted' : ''}>
              {m.player_1_name}
            </span>
            <span className="text-fg-muted">{t('rounds.versus')}</span>
            <span className={m.winner_id === m.player_2_id ? 'font-semibold' : m.winner_id ? 'text-fg-muted' : ''}>
              {m.player_2_name}
            </span>
          </div>
          <Badge variant={m.winner_id ? 'green' : 'gray'} size="sm">
            {enumLabel(tEnum, 'matchStatus', m.winner_id ? 'completed' : m.status)}
          </Badge>
        </Link>
        </li>
      ))}
    </ul>
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

/**
 * Round row header layout. On a phone the title takes its own full-width line
 * (basis-full) so the name and Bo label stay readable and the controls wrap
 * below it; from sm up the title shares the line with the controls again.
 */
export const ROUND_ROW_HEADER_CLASS = 'p-3 flex flex-wrap items-center justify-between gap-2';
export const ROUND_ROW_TITLE_CLASS = 'text-left min-w-0 basis-full sm:basis-0 sm:flex-1';
export const ROUND_ROW_HEADING_CLASS = 'text-subtitle font-[550] text-fg break-words';
export const ROUND_ROW_ACTIONS_CLASS = 'flex flex-wrap items-center gap-2 min-w-0 max-w-full';

/** "Bye: <name>" for a round that gave one or more byes; nothing otherwise. */
export function RoundByeNotice({ playerIds, names, settled }: RoundByeNoticeProps) {
  const t = useT(tournamentsAdminMessages);
  if (playerIds.length === 0 || !settled) return null;
  const label = playerIds
    .map((id) => names?.[id] ?? t('rounds.byeUnknownPlayer'))
    .join(', ');
  return <p className="text-caption text-fg-muted">{t('rounds.bye', { names: label })}</p>;
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
      <div className="flex items-center gap-2 flex-wrap text-caption">
        <input
          type="datetime-local"
          aria-label={t('rounds.deadline.inputLabel')}
          value={draft}
          disabled={saving}
          onChange={(e) => onDraftChange(e.target.value)}
          className="h-11 rounded-poke-md border border-hairline-strong bg-surface px-2 text-caption text-fg sm:h-8 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
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
    <div className="flex items-center gap-2 flex-wrap text-caption text-fg-muted">
      <span>{t('rounds.deadline.label')}:</span>
      {round.deadline ? (
        <LocalTime value={round.deadline} preset="dateTimeYear" className="text-fg" />
      ) : (
        <span className="text-fg-muted">{t('rounds.deadline.none')}</span>
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
  // Set when the server refused the first round with 409 `format_not_ready`: the dialog offers the audited force start.
  const [forceStart, setForceStart] = useState<{ kind: GenerateKind; reasons: FormatNotReadyReason[] } | null>(null);
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
  const [forceRoundId, setForceRoundId] = useState<string | null>(null);
  const [forceReason, setForceReason] = useState('');
  const [forcing, setForcing] = useState(false);
  // Rounds whose matches the open-match check already asked for, so a failed read is not retried in a loop.
  const checkedRounds = useRef(new Set<string>());
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
  /** Notices the last round generation returned (codes, worded at render). */
  const [generateWarnings, setGenerateWarnings] = useState<ApiWarning[]>([]);
  const [deadlineEditId, setDeadlineEditId] = useState<string | null>(null);
  const [deadlineDraft, setDeadlineDraft] = useState('');
  const [savingDeadlineId, setSavingDeadlineId] = useState<string | null>(null);
  /** The round whose best-of is being saved or was just saved (the select saves on change). */
  const [boFeedback, setBoFeedback] = useState<{ roundId: string; state: 'saving' | 'saved' } | null>(null);
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

  // The Complete control needs the open-match count of every active round, so their matches load up front.
  useEffect(() => {
    for (const round of rounds) {
      if (round.status !== 'active' || matchesByRound[round.id] || checkedRounds.current.has(round.id)) continue;
      checkedRounds.current.add(round.id);
      void fetchRoundMatches(tournament.id, round.id).then((result) => {
        if (!result.ok) return;
        setMatchesByRound((prev) => ({ ...prev, [round.id]: result.matches }));
      });
    }
  }, [rounds, matchesByRound, tournament.id]);

  /** Matches of a round that are not completed: the server's own rule for refusing to complete it. */
  function openMatchCount(roundId: string): number | null {
    const matches = matchesByRound[roundId];
    return matches ? matches.filter((m) => m.status !== 'completed').length : null;
  }

  const isRoundRobin = tournament.bracket_type === 'round_robin';
  const isElimination =
    tournament.bracket_type === 'single_elim' ||
    tournament.bracket_type === 'double_elim';
  const isLegacyElim =
    isElimination && isLegacyElimBracketData(rounds);

  /** Reads the round list again after a refusal that says it is stale (see `ROUND_STATE_CODES`). */
  async function reloadRoundsIfStale(result: { code?: string }) {
    if (result.code === undefined || !ROUND_STATE_CODES.has(result.code)) return;
    try {
      const res = await fetch(`/api/tournaments/${tournament.id}/rounds`);
      const json: ApiResult<Round[]> = await res.json();
      if (!json.success) return;
      setRounds(json.data);
      setMatchesByRound({});
      checkedRounds.current.clear();
    } catch {
      // The refusal text is already on screen; the next action reads again.
    }
  }

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
        await reloadRoundsIfStale(result);
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
    setGenerateWarnings([]);
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
        await reloadRoundsIfStale(result);
        setConfirmRegenerate(false);
        setRegenNeedsCascade(false);
        setRegenCascadeMessage(null);
        return;
      }
      // The round delete inside a regenerate can fail to take back the league format's effects of a played result.
      setGenerateWarnings(savedChangeWarnings(result.data));
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
    setGenerateWarnings([]);
    try {
      const res = await fetch(`/api/admin/rounds/${deleteRoundId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.success) {
        setError(apiFailure(result));
        await reloadRoundsIfStale(result);
        setDeleteRoundId(null);
        return;
      }
      // The round is gone either way; a result's format effects that could not be taken back are for the admin to know.
      setGenerateWarnings(savedChangeWarnings(result.data));
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

  /** `force`: start anyway after the admin confirmed a 409 `format_not_ready` (audited by the server). */
  async function generateNextRound(force = false) {
    setGenerating(true);
    setError(null);
    setGenerateWarnings([]);

    try {
      const res = await fetch(
        generateEndpoint(tournament.id, 'next', force),
        generateRequestInit(startNow) ?? { method: 'POST' },
      );
      const result: ApiResult<Round> = await res.json();

      if (!result.success) {
        if (isRoundRobin && result.code === 'rounds_all_generated') {
          setAllGeneratedAtCount(rounds.length);
          return;
        }
        const reasons = formatNotReadyReasons(result);
        if (reasons !== null && !force) setForceStart({ kind: 'next', reasons });
        setError(apiFailure(result));
        await reloadRoundsIfStale(result);
        return;
      }

      setRounds((prev) => [...prev, result.data]);
      setGenerateWarnings(result.warnings ?? []);
    } catch {
      setError({ key: 'rounds.errors.generateRound' });
    } finally {
      setGenerating(false);
    }
  }

  async function generateAllRounds(force = false) {
    setGeneratingAll(true);
    setError(null);

    try {
      const res = await fetch(
        generateEndpoint(tournament.id, 'all', force),
        generateRequestInit(startNow) ?? { method: 'POST' },
      );
      const result: ApiResult<Round[]> = await res.json();

      if (!result.success) {
        if (isRoundRobin && result.code === 'rounds_all_generated') {
          setAllGeneratedAtCount(rounds.length);
          return;
        }
        const reasons = formatNotReadyReasons(result);
        if (reasons !== null && !force) setForceStart({ kind: 'all', reasons });
        setError(apiFailure(result));
        await reloadRoundsIfStale(result);
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
    setBoFeedback({ roundId, state: 'saving' });
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
        setBoFeedback(null);
        setError(apiFailure(result));
        await reloadRoundsIfStale(result);
        return;
      }

      setRounds((prev) =>
        prev.map((r) => (r.id === roundId ? result.data : r))
      );
      setBoFeedback({ roundId, state: 'saved' });
    } catch {
      setBoFeedback(null);
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

  /** True when the server accepted the change. `forceReason` completes a round that still has open matches. */
  async function updateRoundStatus(roundId: string, status: RoundStatus, forceReason?: string): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(
        `/api/tournaments/${tournament.id}/rounds/${roundId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(forceReason === undefined ? { status } : { status, force: true, reason: forceReason }),
        }
      );
      const result: ApiResult<Round> = await res.json();

      if (!result.success) {
        setError(apiFailure(result));
        await reloadRoundsIfStale(result);
        if (result.code === 'round_matches_unfinished') {
          // The list this control was built on is out of date: read it again.
          checkedRounds.current.delete(roundId);
          setMatchesByRound((prev) => {
            const next = { ...prev };
            delete next[roundId];
            return next;
          });
        }
        return false;
      }

      checkedRounds.current.delete(roundId);
      setRounds((prev) =>
        prev.map((r) => (r.id === roundId ? result.data : r))
      );
      return true;
    } catch {
      setError({ key: 'rounds.errors.updateStatus' });
      return false;
    }
  }

  async function handleForceComplete() {
    if (!forceRoundId || !forceReason.trim()) return;
    setForcing(true);
    try {
      await updateRoundStatus(forceRoundId, 'completed', forceReason.trim());
      // A failure shows in the page's error alert, which the open dialog would cover.
      setForceRoundId(null);
      setForceReason('');
    } finally {
      setForcing(false);
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
    setGenerateWarnings([]);
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
        setGenerateWarnings(savedChangeWarnings(result.data));
      } else if (result.code === 'DOWNSTREAM_PLAYED' && !resetNeedsCascade) {
        setResetNeedsCascade(true);
      } else {
        setError(apiFailure(result));
        await reloadRoundsIfStale(result);
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
      {generateWarnings.map((warning) => (
        <Alert key={warning.code} variant="warning">
          {errorText({ code: warning.code, params: warning.params })}
        </Alert>
      ))}
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-poke-lg border border-hairline bg-elevated p-3">
        {showsGenerateBracket && (
          <Button
            variant="primary"
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
              variant="secondary"
              className={DANGER_OUTLINE}
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
            variant="primary"
            size="sm"
            onClick={() => void generateNextRound()}
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
            onClick={() => void generateAllRounds()}
            disabled={!canGenerate || showManualForm || isBusy || generateBlocked}
            aria-describedby={generateBlocked ? checklistDescribes : undefined}
            loading={generatingAll}
          >
            {t('rounds.generateAll')}
          </Button>
        )}
        {allGeneratedCount !== null && (
          <span className="text-body text-fg-muted">
            {t('rounds.allGenerated', { count: allGeneratedCount })}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowManualForm((v) => !v)}
          disabled={!canGenerate || isBusy || showsGenerateBracket}
        >
          {showManualForm ? t('rounds.cancelManual') : t('rounds.createManual')}
        </Button>
        <span className="text-body text-fg-muted sm:ml-auto">
          {enumLabel(tEnum, 'bracketType', tournament.bracket_type)} &middot;{' '}
          {tCommon('bestOf', { count: tournament.best_of_default })}
        </span>
        {tournament.bracket_type === 'double_elim' && (
          <label className="flex items-center gap-2 text-body text-fg">
            <input
              type="checkbox"
              checked={bracketResetEnabled}
              disabled={savingResetToggle || isBusy}
              onChange={(e) => handleToggleBracketReset(e.target.checked)}
              className="rounded accent-accent-fill"
            />
            {tContent('slot.ifNecessary', { label: t('rounds.grandFinalsReset') })}
          </label>
        )}
      </div>

      {(showsGenerateBracket || showsGenerateNext || showsGenerateAll) && (
        <div className="space-y-0.5">
          <label className="flex items-center gap-2 text-body text-fg">
            <input
              type="checkbox"
              checked={startNow}
              disabled={isBusy}
              onChange={(e) => setStartNow(e.target.checked)}
              aria-describedby={startNowHintId}
              className="rounded accent-accent-fill"
            />
            {t('rounds.startNow.label')}
          </label>
          <p id={startNowHintId} className="pl-6 text-caption text-fg-muted">
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
        <Alert variant="info" role="status" className={cn(INFO_CALLOUT, 'flex flex-wrap items-center justify-between gap-3')}>
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
        <div className="flex flex-col items-center gap-2 rounded-poke-md border border-dashed border-hairline-strong px-4 py-8 text-center">
          <ItemIcon item="vs-seeker" size={48} />
          <p className="text-body text-fg-muted">{t('rounds.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rounds.map((round) => {
            const isExpanded = expandedRound === round.id;
            const matches = matchesByRound[round.id];

            return (
              <Card key={round.id} variant="muted" padding="none" className="overflow-hidden">
                <div className={ROUND_ROW_HEADER_CLASS}>
                  <h4 className={ROUND_ROW_TITLE_CLASS}>
                    <button
                      type="button"
                      onClick={() => toggleRoundMatches(round.id)}
                      aria-expanded={isExpanded}
                      aria-controls={`${startNowHintId}-round-${round.id}`}
                      className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-poke-sm text-left max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          'h-4 w-4 shrink-0 text-fg-muted motion-safe:transition-transform motion-safe:duration-80',
                          isExpanded && 'rotate-90',
                        )}
                      />
                      <span className={ROUND_ROW_HEADING_CLASS}>{translateEngineLabel('round', round.name, locale)}</span>
                      <span className="text-caption font-normal text-fg-muted">
                        {tCommon('bestOf', { count: round.best_of })}
                      </span>
                      <SkewChip tone={roundTone(round.status)}>{enumLabel(tEnum, 'roundStatus', round.status)}</SkewChip>
                    </button>
                  </h4>
                  <div className={ROUND_ROW_ACTIONS_CLASS}>
                    {round.status === 'pending' && (
                      <>
                        <div className="w-24 shrink-0">
                          <Select
                            value={round.best_of}
                            onChange={(e) => updateRoundBo(round.id, Number(e.target.value))}
                            disabled={boFeedback?.roundId === round.id && boFeedback.state === 'saving'}
                            aria-label={t('rounds.bestOfLabel', { name: translateEngineLabel('round', round.name, locale) })}
                            className="h-11 py-1 text-caption sm:h-8"
                          >
                            {bestOfChoices(round.best_of).map((bo) => (
                              <option key={bo} value={bo}>
                                {tCommon('bestOf', { count: bo })}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <span role="status" aria-live="polite" className="text-caption text-fg-muted empty:hidden">
                          {boFeedback?.roundId === round.id
                            ? t(boFeedback.state === 'saving' ? 'rounds.bestOfSaving' : 'rounds.bestOfSaved')
                            : null}
                        </span>
                      </>
                    )}
                    {canRoundEvent(round.status, 'start', 'admin') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void startRound(round.id)}
                        loading={startingRoundId === round.id}
                      >
                        {t('rounds.start')}
                      </Button>
                    )}
                    {canRoundEvent(round.status, 'complete', 'admin') && (() => {
                      const open = openMatchCount(round.id);
                      const blocked = open !== null && open > 0;
                      const blockedId = `${startNowHintId}-open-${round.id}`;
                      return (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={blocked}
                            aria-describedby={blocked ? blockedId : undefined}
                            onClick={() => void updateRoundStatus(round.id, 'completed')}
                          >
                            {t('rounds.complete')}
                          </Button>
                          {blocked && (
                            <>
                              <span id={blockedId} className="text-caption text-fg-muted">
                                {t('rounds.completeBlocked', { count: open })}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-loss"
                                onClick={() => {
                                  setForceReason('');
                                  setForceRoundId(round.id);
                                }}
                              >
                                {t('rounds.forceComplete.open')}
                              </Button>
                            </>
                          )}
                        </>
                      );
                    })()}
                    {canRoundEvent(round.status, 'reset', 'admin') && (
                      <Button
                        variant="secondary"
                        className={DANGER_OUTLINE}
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
                        className="text-loss"
                      >
                        {t('rounds.delete')}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-1 px-3 pb-3">
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
                  <div id={`${startNowHintId}-round-${round.id}`} className="border-t border-hairline bg-surface px-3 py-3">
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
        open={forceStart !== null}
        onClose={() => setForceStart(null)}
        onConfirm={() => {
          const pending = forceStart;
          setForceStart(null);
          if (pending?.kind === 'all') void generateAllRounds(true);
          else if (pending !== null) void generateNextRound(true);
        }}
        title={t('rounds.forceStart.title')}
        message={t('rounds.forceStart.message', {
          reasons: (forceStart?.reasons ?? [])
            .map((reason) => (reason === 'relation_undrawn' ? t('rounds.forceStart.relationUndrawn') : t('rounds.forceStart.actionIncomplete')))
            .join(' '),
        })}
        confirmLabel={t('rounds.forceStart.confirm')}
        confirmVariant="primary"
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
      <Modal
        open={forceRoundId !== null}
        onClose={() => {
          if (!forcing) setForceRoundId(null);
        }}
        title={t('rounds.forceComplete.title')}
        size="sm"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleForceComplete();
          }}
        >
          <p className="text-body text-fg-muted">
            {t('rounds.forceComplete.message', { count: forceRoundId ? (openMatchCount(forceRoundId) ?? 0) : 0 })}
          </p>
          <Textarea
            id={`${startNowHintId}-force-reason`}
            label={t('rounds.forceComplete.reasonLabel')}
            hint={t('rounds.forceComplete.reasonHint')}
            value={forceReason}
            onChange={(e) => setForceReason(e.target.value)}
            maxLength={FORCE_REASON_MAX_LENGTH}
            required
          />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setForceRoundId(null)} disabled={forcing}>
              {t('rounds.forceComplete.cancel')}
            </Button>
            <Button type="submit" variant="danger" size="sm" loading={forcing} disabled={!forceReason.trim()}>
              {t('rounds.forceComplete.confirm')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function roundTone(status: RoundStatus): SkewChipTone {
  switch (status) {
    case 'pending':
      return 'neutral';
    case 'active':
      return 'live';
    case 'completed':
      return 'win';
  }
}
