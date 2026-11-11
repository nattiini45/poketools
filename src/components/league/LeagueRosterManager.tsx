'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeasonParticipant, SeasonWithDetails } from '@/types/season';
import type { LeaguePhase } from '@/types/season';
import type { PublicTournamentParticipant } from '@/lib/players/public-player';
import {
  PLAYER_SEARCH_MIN_QUERY,
  PLAYER_SEARCH_NETWORK_ERROR,
  parsePlayerSearch,
  playerSearchUrl,
  searchTruncation,
  unavailableForAdd,
  unavailableForLink,
  unavailableForSubstitute,
  type PlayerSearchHit,
  type RosterUnavailable,
} from '@/lib/players/player-search';
import { POKEMON_TYPES } from '@/types/season';
import type { Player } from '@/types/player';
import type { ApiResult } from '@/types/api';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Combobox, { type ComboboxOption } from '@/components/ui/Combobox';
import Input from '@/components/ui/Input';
import ItemIcon from '@/components/ui/ItemIcon';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import SkewChip from '@/components/ui/SkewChip';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import GuestBadge from '@/components/shared/GuestBadge';
import TypeSprite from '@/components/shared/TypeSprite';
import SubstituteDialog from '@/components/league/SubstituteDialog';
import { useDataLocale, useT } from '@/i18n/client';
import { createTranslator, type Translator } from '@/i18n/core';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { errorsPlayers } from '@/i18n/messages/errors/players';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueRosterMessages } from '@/i18n/messages/league-roster';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { isSeasonClosed } from '@/lib/season/season-state';
import { cn } from '@/lib/utils/cn';

interface LeagueRosterManagerProps {
  seasonId: string;
  /**
   * Show the gym-leader type dropdown per participant. Gated by the
   * participantTypeAssignment format capability (hidden for EPB).
   */
  showTypeSelector?: boolean;
  /**
   * The league's status and archive flag, from the page that already read the
   * season row: they decide whether substitutions are closed, so the manager
   * does not fetch `GET /api/seasons/[id]` again.
   */
  leagueState: Pick<SeasonWithDetails, 'status' | 'archived'>;
}

/** The player a substitution replaces, and whether they are on the league roster. */
export interface SubstituteOutPlayer {
  id: string;
  name: string;
  /**
   * False for a reserve promoted into a phase by a phase-scope substitution:
   * enrolled there, not on the roster. Such a player is replaced per phase.
   */
  onRoster: boolean;
}

/** A translator for the `league-roster` namespace. */
export type LeagueRosterT = Translator<(typeof leagueRosterMessages)['en']>;

/** English labels for the pure helpers when no translator is passed (tests, logs). */
const EN_ROSTER_T: LeagueRosterT = createTranslator(leagueRosterMessages, 'en');

/** An API refusal (shown by its code), or a request that got no answer (a message key). */
type RosterError =
  | { api: ApiErrorLike }
  | { key: 'loadFailed' | 'addFailed' | 'guestFailed' | 'removeFailed' | 'typeFailed' | 'linkFailed' };

/** Each active phase's enrolled players (ids and names), by phase id. */
export type PhaseEnrollment = Record<string, ReadonlyArray<{ id: string; name: string }>>;

/**
 * A completed or archived league keeps the roster that played it: the server
 * rejects a substitution there (`SEASON_CLOSED`), and the control is hidden.
 */
export function isSubstitutionClosed(
  season: Pick<SeasonWithDetails, 'status' | 'archived'> | null,
): boolean {
  return season !== null && isSeasonClosed(season);
}

/**
 * The scopes a substitution of `out` can take: the whole league for a roster
 * player, and each active phase they are enrolled in. A phase whose
 * enrollment did not load is offered as before (the server checks it).
 */
export function substituteScopeOptions(
  out: SubstituteOutPlayer,
  activePhases: ReadonlyArray<Pick<LeaguePhase, 'id' | 'name'>>,
  enrollment: PhaseEnrollment,
  t: LeagueRosterT = EN_ROSTER_T,
): Array<{ value: string; label: string }> {
  const phases = activePhases
    .filter((phase) => {
      const enrolled = enrollment[phase.id];
      return enrolled === undefined ? out.onRoster : enrolled.some((player) => player.id === out.id);
    })
    .map((phase) => ({ value: phase.id, label: t('substitute.scopePhaseOnly', { phase: phase.name }) }));
  return out.onRoster
    ? [{ value: 'league', label: t('substitute.scopeLeague') }, ...phases]
    : phases;
}

/**
 * Players enrolled in an active phase without being on the roster (reserves
 * promoted by a phase-scope substitution), with the phases they play in, in
 * phase order.
 */
export function phaseOnlyPlayers(
  activePhases: ReadonlyArray<Pick<LeaguePhase, 'id' | 'name'>>,
  enrollment: PhaseEnrollment,
  rosterIds: ReadonlySet<string>,
): Array<{ id: string; name: string; phases: string[] }> {
  const byId = new Map<string, { id: string; name: string; phases: string[] }>();
  for (const phase of activePhases) {
    for (const player of enrollment[phase.id] ?? []) {
      if (rosterIds.has(player.id)) continue;
      const entry = byId.get(player.id) ?? { id: player.id, name: player.name, phases: [] };
      entry.phases.push(phase.name);
      byId.set(player.id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The reads the roster manager makes on load (before the per-phase enrollment
 * reads): roster and phases. The league row is not among them; it arrives as
 * the `leagueState` prop. There is no player directory read: the pickers
 * search the server as the admin types (`playerSearchUrl`), because a preloaded
 * page of players misses everyone past it and is site-admin only.
 */
export function rosterLoadPaths(seasonId: string): [string, string] {
  return [`/api/seasons/${seasonId}/participants`, `/api/seasons/${seasonId}/phases`];
}

/** A text action in a roster row: 44 px tall on a phone, a compact line from sm up. The colour comes with it. */
const ROW_ACTION =
  'inline-flex min-h-11 items-center rounded-poke-sm px-1 text-caption font-[550] hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] sm:min-h-0';

const UNAVAILABLE_KEY = {
  onRoster: 'roster.alreadyOnRoster',
  selected: 'roster.alreadySelected',
  inPhase: 'substitute.alreadyInPhase',
  outgoing: 'substitute.isOutgoing',
  guest: 'link.notRegistered',
} as const satisfies Record<RosterUnavailable, string>;

/**
 * Server-side player search for one picker. Hands `Combobox` its `fetchUrl`
 * and `transformResults`, keeps the hits it has seen (to turn a picked id back
 * into a name) and surfaces what `Combobox` cannot: an API refusal, and a
 * truncated result page. A request that gets no JSON answer at all (network
 * failure, an HTML 502) reaches it through `onFetchError` and shows as a
 * network error, not as "no results". A hit the picker cannot take
 * (`unavailable`) stays in the list, greyed out with the reason, so the admin
 * sees why a player cannot be chosen instead of finding them missing.
 */
export function usePlayerSearch(
  seasonId: string,
  unavailable: (hit: PlayerSearchHit) => RosterUnavailable | null,
  options?: { registeredOnly?: boolean },
) {
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [more, setMore] = useState<{ shown: number; total: number } | null>(null);
  const seen = useRef(new Map<string, PlayerSearchHit>());

  const transformResults = useCallback(
    (json: unknown): ComboboxOption[] => {
      const outcome = parsePlayerSearch(json);
      if (!outcome.ok) {
        setError(outcome.error);
        setMore(null);
        return [];
      }
      setError(null);
      setMore(searchTruncation(outcome));
      for (const hit of outcome.hits) seen.current.set(hit.id, hit);
      return outcome.hits.map((hit) => {
        const reason = unavailable(hit);
        return { label: hit.name, value: hit.id, disabled: reason !== null, meta: { is_guest: hit.is_guest, unavailable: reason } };
      });
    },
    [unavailable],
  );

  const onFetchError = useCallback(() => {
    setError(PLAYER_SEARCH_NETWORK_ERROR);
    setMore(null);
  }, []);

  /** The hit for a picked id, only while the picker would still accept it. */
  const pick = (id: string): PlayerSearchHit | null => {
    const hit = seen.current.get(id);
    return hit && unavailable(hit) === null ? hit : null;
  };

  return {
    fetchUrl: playerSearchUrl({ seasonId }, options),
    transformResults,
    onFetchError,
    minQueryLength: PLAYER_SEARCH_MIN_QUERY,
    error,
    more,
    pick,
    /**
     * The selection a single-pick input holds after a change: a cleared input or a
     * refused hit selects nobody, so the input and the action it enables agree.
     */
    select: (id: string): PlayerSearchHit | null => (id ? pick(id) : null),
    reset: () => {
      setError(null);
      setMore(null);
    },
  };
}

/** The search's refusal (shown by its code) and the "more matches than shown" hint, under a picker. */
function PlayerSearchNotes({
  search,
  errorText,
  t,
}: {
  search: { error: ApiErrorLike | null; more: { shown: number; total: number } | null };
  errorText: (error: ApiErrorLike) => string;
  t: LeagueRosterT;
}) {
  return (
    <>
      {search.error && <Alert variant="error">{errorText(search.error)}</Alert>}
      {search.more && (
        <p className="text-caption text-fg-muted">
          {t('roster.searchTruncated', { shown: search.more.shown, total: search.more.total })}
        </p>
      )}
    </>
  );
}

export default function LeagueRosterManager({
  seasonId,
  showTypeSelector = true,
  leagueState,
}: LeagueRosterManagerProps) {
  const t = useT(leagueRosterMessages);
  const dataLocale = useDataLocale();
  // errorsDraft: the league-group refusals of adding and removing a trainer (SEASON_GROUPS_SCHEDULED,
  // SEASON_GROUP_LOCKED, SEASON_GROUP_TOO_SMALL), of a substitution mid-draft (SEASON_GROUP_SUBSTITUTION_LOCKED) and
  // of any roster change while a legacy draft is in progress (SEASON_DRAFT_LOCKED).
  const errorText = useApiErrorText(errorsSeasons, errorsPlayers, errorsDraft);
  const [participants, setParticipants] = useState<SeasonParticipant[]>([]);
  const [phases, setPhases] = useState<LeaguePhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<RosterError | null>(null);

  const [pending, setPending] = useState<PlayerSearchHit[]>([]);
  const [bulkAdding, setBulkAdding] = useState(false);

  const [guestName, setGuestName] = useState('');
  const [creatingGuest, setCreatingGuest] = useState(false);
  const [showGuestForm, setShowGuestForm] = useState(false);

  const [phaseEnrollment, setPhaseEnrollment] = useState<PhaseEnrollment>({});
  const [substituteOut, setSubstituteOut] = useState<SubstituteOutPlayer | null>(null);
  const [substituteIn, setSubstituteIn] = useState<PlayerSearchHit | null>(null);
  const [substituteScope, setSubstituteScope] = useState<'league' | string>('league');
  const [substituteOpen, setSubstituteOpen] = useState(false);

  const [linkGuest, setLinkGuest] = useState<SeasonParticipant | null>(null);
  const [linkSource, setLinkSource] = useState<PlayerSearchHit | null>(null);
  const [linking, setLinking] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [partRes, phaseRes] = await Promise.all(
        rosterLoadPaths(seasonId).map((path) => fetch(path).then((r) => r.json())),
      );

      const partResult = partRes as ApiResult<SeasonParticipant[]>;
      const phaseResult = phaseRes as ApiResult<LeaguePhase[]>;

      if (partResult.success) setParticipants(partResult.data);
      if (phaseResult.success) setPhases(phaseResult.data);

      // Who is enrolled in each active phase: the substitution scopes a
      // player can take, and the promoted reserves (enrolled, not on the
      // roster) who can be replaced in turn. A phase that fails to load is
      // left out (its scope is still offered; the server checks it).
      const active = phaseResult.success
        ? phaseResult.data.filter((p) => p.status === 'upcoming' || p.status === 'active')
        : [];
      const enrollments = await Promise.all(
        active.map(async (phase) => {
          try {
            const res = await fetch(`/api/seasons/${seasonId}/phases/${phase.id}/participants`);
            const result: ApiResult<PublicTournamentParticipant[]> = await res.json();
            return result.success
              ? ([phase.id, result.data.map((p) => ({ id: p.id, name: p.name }))] as const)
              : null;
          } catch {
            return null;
          }
        }),
      );
      setPhaseEnrollment(
        Object.fromEntries(enrollments.filter((entry) => entry !== null)) as PhaseEnrollment,
      );
    } catch {
      setError({ key: 'loadFailed' });
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const participantIds = useMemo(
    () => new Set(participants.map((p) => p.id)),
    [participants],
  );

  const activePhases = useMemo(
    () => phases.filter((p) => p.status === 'upcoming' || p.status === 'active'),
    [phases],
  );

  const substitutionClosed = isSubstitutionClosed(leagueState);

  const reserves = useMemo(
    () => phaseOnlyPlayers(activePhases, phaseEnrollment, participantIds),
    [activePhases, phaseEnrollment, participantIds],
  );

  const scopeOptions = useMemo(
    () => (substituteOut ? substituteScopeOptions(substituteOut, activePhases, phaseEnrollment, t) : []),
    [substituteOut, activePhases, phaseEnrollment, t],
  );

  const pendingIds = useMemo(() => pending.map((p) => p.id), [pending]);
  const pendingIdSet = useMemo(() => new Set(pendingIds), [pendingIds]);

  // Add picker: anyone not already on the roster or staged.
  const addSearch = usePlayerSearch(seasonId, (hit) => unavailableForAdd(hit, participantIds, pendingIdSet));

  // Replacements come from outside the roster; for one phase, not from
  // players already enrolled there.
  const enrolledInScope = useMemo(
    () => new Set((substituteScope === 'league' ? [] : phaseEnrollment[substituteScope] ?? []).map((p) => p.id)),
    [phaseEnrollment, substituteScope],
  );
  const substituteSearch = usePlayerSearch(seasonId, (hit) =>
    unavailableForSubstitute(hit, substituteOut?.id, participantIds, enrolledInScope),
  );

  // Link candidates: a registered (non-guest, with a Discord or email login),
  // active account other than the guest itself. The server filters on the login
  // and status columns (`registered=1`), which never reach the client: the claim
  // refuses a banned or suspended source (SOURCE_NOT_ACTIVE), so such an account
  // is not offered. The claim route still checks that the account is fresh and
  // empty (SOURCE_HAS_ACTIVITY).
  const linkSearch = usePlayerSearch(seasonId, (hit) => unavailableForLink(hit, linkGuest?.id), {
    registeredOnly: true,
  });

  function renderPlayerOption(option: ComboboxOption) {
    const reason = option.meta?.unavailable as RosterUnavailable | null | undefined;
    return (
      <span className={reason ? 'flex items-center gap-2 text-fg-muted opacity-60' : 'flex items-center gap-2'}>
        <span>{option.label}</span>
        {option.meta?.is_guest ? <GuestBadge /> : null}
        {reason ? <span className="text-caption">{t(UNAVAILABLE_KEY[reason])}</span> : null}
      </span>
    );
  }

  function stagePlayer(hit: PlayerSearchHit) {
    if (participantIds.has(hit.id) || pendingIdSet.has(hit.id)) return;
    setPending((prev) => [...prev, hit]);
  }

  function unstagePlayer(playerId: string) {
    setPending((prev) => prev.filter((p) => p.id !== playerId));
  }

  async function bulkAddPlayers() {
    if (pendingIds.length === 0) return;
    setBulkAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_ids: pendingIds }),
      });
      const json: ApiResult<{ added: number }> = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }
      setPending([]);
      await loadData();
    } catch {
      setError({ key: 'addFailed' });
    } finally {
      setBulkAdding(false);
    }
  }

  async function createGuest() {
    const name = guestName.trim();
    if (!name) return;
    setCreatingGuest(true);
    setError(null);
    try {
      const res = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, is_guest: true }),
      });
      const json: ApiResult<Player> = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }
      setGuestName('');
      setShowGuestForm(false);
      stagePlayer({ id: json.data.id, name: json.data.name, is_guest: true });
    } catch {
      setError({ key: 'guestFailed' });
    } finally {
      setCreatingGuest(false);
    }
  }

  async function removePlayer(playerId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/participants`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        return;
      }
      setParticipants((prev) => prev.filter((p) => p.id !== playerId));
    } catch {
      setError({ key: 'removeFailed' });
    }
  }

  async function setGymType(playerId: string, gymType: string | null) {
    setError(null);
    setParticipants((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, gym_type: gymType } : p)),
    );
    try {
      const res = await fetch(`/api/seasons/${seasonId}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, gym_type: gymType }),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError({ api: toApiErrorLike(result) });
        const partRes = await fetch(`/api/seasons/${seasonId}/participants`).then((r) => r.json());
        if (partRes.success) setParticipants(partRes.data);
      }
    } catch {
      setError({ key: 'typeFailed' });
    }
  }

  function openSubstitute(player: SubstituteOutPlayer) {
    setSubstituteOut(player);
    setSubstituteIn(null);
    substituteSearch.reset();
    setSubstituteScope(substituteScopeOptions(player, activePhases, phaseEnrollment, t)[0]?.value ?? 'league');
    setSubstituteOpen(false);
  }

  async function linkAccount() {
    if (!linkGuest || !linkSource) return;
    setLinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/players/${linkGuest.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_player_id: linkSource.id }),
      });
      const json: ApiResult<Player> = await res.json();
      if (!json.success) {
        setError({ api: toApiErrorLike(json) });
        return;
      }
      setLinkGuest(null);
      setLinkSource(null);
      await loadData();
    } catch {
      setError({ key: 'linkFailed' });
    } finally {
      setLinking(false);
    }
  }

  // The scope decides who is already enrolled: a replacement picked under one
  // scope is dropped when the scope changes and the pick is no longer valid.
  const substituteInPlayer = substituteIn && substituteSearch.pick(substituteIn.id) ? substituteIn : null;

  if (loading) return <p className="text-body text-fg-muted">{t('roster.loading')}</p>;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="error">
          {'api' in error ? errorText(error.api) : t(`roster.errors.${error.key}`)}
        </Alert>
      )}

      <div>
        <h3 className="mb-3 text-subtitle font-[550] text-fg">{t('roster.heading', { count: participants.length })}</h3>
        {substitutionClosed && (
          <p className="mb-3 text-caption text-fg-muted">
            {leagueState.archived ? t('roster.closedArchived') : t('roster.closedCompleted')}
          </p>
        )}
        {participants.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-poke-md border border-dashed border-hairline-strong px-4 py-8 text-center">
            <ItemIcon item="lucky-egg" size={48} />
            <p className="text-body text-fg-muted">{t('roster.empty')}</p>
            <a href="#league-roster-add" className={cn(ROW_ACTION, 'text-accent-ink')}>
              {t('roster.addHeading')}
            </a>
          </div>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-poke-md border border-hairline bg-surface">
            {participants.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 text-body text-fg motion-safe:transition-colors motion-safe:duration-80 hover:bg-hover"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <PlayerAvatar avatarUrl={p.avatar_url} name={p.name} size={24} />
                  <span className="min-w-0 truncate">{p.name}</span>
                  {p.is_guest && <GuestBadge />}
                  {p.is_test_account && <SkewChip tone="tier-1">{t('roster.testBadge')}</SkewChip>}
                </div>
                <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-1">
                  {showTypeSelector && (
                    <>
                      <div className="w-36 shrink-0">
                        <Select
                          value={p.gym_type ?? ''}
                          onChange={(e) => setGymType(p.id, e.target.value || null)}
                          className="h-11 py-1 text-caption sm:h-9"
                          title={t('roster.gymTypeTitle')}
                          aria-label={t('roster.gymTypeTitle')}
                        >
                          <option value="">{t('roster.noType')}</option>
                          {POKEMON_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {localizeType(type, dataLocale)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {p.gym_type && <TypeSprite type={p.gym_type} size={16} />}
                    </>
                  )}
                  {p.is_guest && (
                    <button
                      type="button"
                      onClick={() => {
                        setLinkGuest(p);
                        setLinkSource(null);
                        linkSearch.reset();
                      }}
                      className={cn(ROW_ACTION, 'text-accent-ink')}
                    >
                      {t('roster.linkAccount')}
                    </button>
                  )}
                  {!substitutionClosed && (
                    <button
                      type="button"
                      onClick={() => openSubstitute({ id: p.id, name: p.name, onRoster: true })}
                      className={cn(ROW_ACTION, 'text-accent-ink')}
                    >
                      {t('roster.substitute')}
                    </button>
                  )}
                  <button type="button" onClick={() => removePlayer(p.id)} className={cn(ROW_ACTION, 'text-loss')}>
                    {t('roster.remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {reserves.length > 0 && (
        <div>
          <h3 className="mb-1 text-subtitle font-[550] text-fg">{t('roster.reservesHeading', { count: reserves.length })}</h3>
          <p className="mb-3 text-caption text-fg-muted">{t('roster.reservesHint')}</p>
          <ul className="divide-y divide-hairline overflow-hidden rounded-poke-md border border-hairline bg-surface">
            {reserves.map((reserve) => (
              <li key={reserve.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-body text-fg">
                <span className="min-w-0 truncate">
                  {reserve.name} <span className="text-caption text-fg-muted">({reserve.phases.join(', ')})</span>
                </span>
                {!substitutionClosed && (
                  <button
                    type="button"
                    onClick={() => openSubstitute({ id: reserve.id, name: reserve.name, onRoster: false })}
                    className={cn(ROW_ACTION, 'shrink-0 text-accent-ink')}
                  >
                    {t('roster.substitute')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div id="league-roster-add" className="flex scroll-mt-4 flex-col gap-3 border-t border-hairline pt-5">
        <h3 className="text-subtitle font-[550] text-fg">{t('roster.addHeading')}</h3>
        <Combobox
          mode="async"
          label={t('roster.searchLabel')}
          value=""
          onChange={(id) => {
            const hit = addSearch.pick(id);
            if (hit) stagePlayer(hit);
          }}
          placeholder={t('roster.searchPlaceholder')}
          fetchUrl={addSearch.fetchUrl}
          transformResults={addSearch.transformResults}
          onFetchError={addSearch.onFetchError}
          minQueryLength={addSearch.minQueryLength}
          renderOption={renderPlayerOption}
        />
        <PlayerSearchNotes search={addSearch} errorText={errorText} t={t} />

        {pending.length > 0 && (
          <div className="flex flex-col gap-3 rounded-poke-md border border-accent-ink bg-selected p-3">
            <p className="text-caption text-fg-muted">{t('roster.selected', { count: pending.length })}</p>
            <div className="flex flex-wrap gap-2">
              {pending.map((player) => (
                <span
                  key={player.id}
                  className="inline-flex items-center gap-1 rounded-poke-md border border-hairline-strong bg-surface py-1 pl-2.5 pr-1 text-caption text-fg"
                >
                  {player.name}
                  <button
                    type="button"
                    onClick={() => unstagePlayer(player.id)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-poke-sm text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]"
                    aria-label={t('roster.removeAria', { name: player.name })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div>
              <Button variant="primary" size="sm" onClick={bulkAddPlayers} disabled={bulkAdding}>
                {bulkAdding ? t('roster.adding') : t('roster.addCount', { count: pending.length })}
              </Button>
            </div>
          </div>
        )}

        <div>
          {!showGuestForm ? (
            <Button variant="ghost" size="sm" onClick={() => setShowGuestForm(true)}>
              {t('roster.createGuest')}
            </Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Input
                label={t('roster.guestName')}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder={t('roster.guestPlaceholder')}
                className="max-w-xs"
              />
              <Button variant="primary" size="sm" onClick={createGuest} disabled={creatingGuest || !guestName.trim()}>
                {creatingGuest ? t('roster.creating') : t('roster.create')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowGuestForm(false)}>
                {t('roster.cancel')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {substituteOut && (
        <Modal
          open
          onClose={() => setSubstituteOut(null)}
          title={t('substitute.title', { name: substituteOut.name })}
          size="md"
        >
          <div className="space-y-4">
            <div className="space-y-1">
              <Combobox
                mode="async"
                label={t('substitute.replacement')}
                value={substituteIn?.name ?? ''}
                onChange={(id) => setSubstituteIn(substituteSearch.select(id))}
                placeholder={t('substitute.selectPlayer')}
                fetchUrl={substituteSearch.fetchUrl}
                transformResults={substituteSearch.transformResults}
                onFetchError={substituteSearch.onFetchError}
                minQueryLength={substituteSearch.minQueryLength}
                renderOption={renderPlayerOption}
              />
              <PlayerSearchNotes search={substituteSearch} errorText={errorText} t={t} />
            </div>

            <div>
              <Select
                label={t('substitute.scope')}
                value={substituteScope}
                onChange={(e) => {
                  setSubstituteScope(e.target.value);
                  setSubstituteIn(null);
                }}
                options={scopeOptions}
              />
              {scopeOptions.length === 0 && (
                <p className="mt-1 text-caption text-fg-muted">
                  {t('substitute.noScope', { name: substituteOut.name })}
                </p>
              )}
              {substituteScope !== 'league' && (
                <p className="mt-1 text-caption text-fg-muted">
                  {t('substitute.phaseOnlyHint')}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSubstituteOut(null)}>
                {t('roster.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!substituteInPlayer || scopeOptions.length === 0}
                onClick={() => setSubstituteOpen(true)}
              >
                {t('substitute.previewConfirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {substituteOut && substituteInPlayer && (
        <SubstituteDialog
          seasonId={seasonId}
          outPlayerId={substituteOut.id}
          outPlayerName={substituteOut.name}
          inPlayerId={substituteInPlayer.id}
          inPlayerName={substituteInPlayer.name}
          scope={substituteScope}
          open={substituteOpen}
          onClose={() => {
            setSubstituteOpen(false);
            setSubstituteOut(null);
          }}
          onSuccess={loadData}
        />
      )}

      {linkGuest && (
        <Modal
          open
          onClose={() => setLinkGuest(null)}
          title={t('link.title', { name: linkGuest.name })}
        >
          <div className="space-y-4">
            <p className="text-body text-fg-muted">{t('link.hint')}</p>
            <div className="space-y-1">
              <Combobox
                mode="async"
                value={linkSource?.name ?? ''}
                onChange={(id) => setLinkSource(linkSearch.select(id))}
                placeholder={t('link.selectAccount')}
                fetchUrl={linkSearch.fetchUrl}
                transformResults={linkSearch.transformResults}
                onFetchError={linkSearch.onFetchError}
                minQueryLength={linkSearch.minQueryLength}
                renderOption={renderPlayerOption}
              />
              <PlayerSearchNotes search={linkSearch} errorText={errorText} t={t} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setLinkGuest(null)}>
                {t('roster.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!linkSource || linking}
                onClick={linkAccount}
              >
                {linking ? t('link.linking') : t('link.submit')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
