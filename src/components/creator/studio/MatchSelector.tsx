'use client';

import { useState, useEffect, useRef } from 'react';
import { useCastStudio } from './CastStudioContext';
import { useLocale, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsBroadcast, errorsMatches, errorsTournaments } from '@/i18n/messages/errors';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import Select from '@/components/ui/Select';
import type { ApiResult } from '@/types/api';
import type { CastSessionPopulateResult } from '@/types/cast-session';
import type { CastSessionPhaseRef, PhaseCastPopulateResult } from '@/types/phase-cast-session';

// ─── Lightweight list shapes (only what we need for display) ───────

export interface SeasonOption { id: string; name: string }
interface CompetitionOption { id: string; name: string; season_id?: string }
interface RoundOption { id: string; name: string; round_number: number; best_of: number; phase_id?: string }
export interface MatchOption {
  id: string;
  player_1_name: string;
  player_2_name: string;
  status: string;
  phase_id?: string;
  round_id?: string;
}

// ─── League (season) options ───────────────────────────────────────

/**
 * The League select's source: the public `GET /api/seasons`, which lists test
 * leagues too (after the real ones), so a cast can be rehearsed on one.
 */
export const STUDIO_SEASONS_URL = '/api/seasons';

/** Fetch the League select's options; a failed request lists nothing. */
export async function fetchSeasonOptions(fetchImpl: typeof fetch = fetch): Promise<SeasonOption[]> {
  try {
    const res = await fetchImpl(STUDIO_SEASONS_URL);
    const json = (await res.json()) as
      | { success: true; data: SeasonOption[] }
      | { success: false; error: string };
    return json.success ? json.data : [];
  } catch {
    return [];
  }
}

// ─── Round → matches load ──────────────────────────────────────────

export type RoundMatchOptionsLoad =
  | { ok: true; matches: MatchOption[] }
  /**
   * `error` is the API's failure (English `error`, plus `code` / `params` when
   * the route sends them), or `{}` when no API answer arrived (offline, a
   * non-JSON body). It is translated at render time, never stored as text.
   */
  | { ok: false; error: ApiErrorLike };

/** One answered request: the round it was for (`roundMatchesKey`) and its result. */
export interface LoadedRoundMatches {
  key: string;
  result: RoundMatchOptionsLoad;
}

/** Identifies one round-matches request; a retry makes a new one. */
export function roundMatchesKey(tournamentId: string, roundId: string, attempt: number): string {
  return `${tournamentId}|${roundId}|${attempt}`;
}

/**
 * Fetch a round's matches (the round-detail endpoint returns
 * `{ ...round, matches }`). A failed request comes back as an error, never
 * as an empty list.
 */
export async function fetchRoundMatchOptions(
  tournamentId: string,
  roundId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RoundMatchOptionsLoad> {
  return fetchRoundMatchOptionsAt(`/api/tournaments/${tournamentId}/rounds/${roundId}`, fetchImpl);
}

async function fetchRoundMatchOptionsAt(
  url: string,
  fetchImpl: typeof fetch,
  scope?: { phaseId: string; roundId: string },
): Promise<RoundMatchOptionsLoad> {
  try {
    const res = await fetchImpl(url);
    const json = (await res.json()) as
      | { success: true; data: { id?: string; phase_id?: string; matches: MatchOption[] } }
      | { success: false; error: string; code?: string };
    if (!res.ok || !json.success) return { ok: false, error: toApiErrorLike(json) };
    if (scope && (json.data.id !== scope.roundId || json.data.phase_id !== scope.phaseId
      || json.data.matches.some((match) => match.round_id !== scope.roundId || match.phase_id !== scope.phaseId))) {
      return { ok: false, error: {} };
    }
    return { ok: true, matches: json.data.matches };
  } catch {
    return { ok: false, error: {} };
  }
}

function useScopedOptions<T>(url: string | null) {
  const [loaded, setLoaded] = useState<{ url: string; options: T[] } | null>(null);
  useEffect(() => {
    if (!url) return;
    let current = true;
    void (async () => {
      let options: T[] = [];
      try {
        const response = await fetch(url);
        const result: ApiResult<T[]> = await response.json();
        if (response.ok && result.success) options = result.data;
      } catch {
        options = [];
      }
      if (current) setLoaded({ url, options });
    })();
    return () => { current = false; };
  }, [url]);
  return { options: url !== null && loaded?.url === url ? loaded.options : [], loading: url !== null && loaded?.url !== url };
}

/**
 * What the Match select may offer for the round selected now (`key`, null
 * when no round is selected). Only a result for that same request counts:
 * while the selected round's request is in flight, or after it failed, the
 * select lists nothing, so another round's matches can never be picked and
 * populated into the session under this round.
 */
export function matchOptionsFor(
  loaded: LoadedRoundMatches | null,
  key: string | null,
): { matches: MatchOption[]; loading: boolean; error: ApiErrorLike | null } {
  if (key === null) return { matches: [], loading: false, error: null };
  if (loaded?.key !== key) return { matches: [], loading: true, error: null };
  if (!loaded.result.ok) return { matches: [], loading: false, error: loaded.result.error };
  return { matches: loaded.result.matches, loading: false, error: null };
}

// ─── Component ─────────────────────────────────────────────────────

export default function MatchSelector() {
  const { state, dispatch } = useCastStudio();
  const t = useT(creatorStudioMessages);
  const tEnum = useT(enumMessages);
  const locale = useLocale();
  const populateErrorText = useApiErrorText(errorsBroadcast, errorsMatches);
  const native = state.phaseMode && !state.tournamentId;

  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [loadedMatches, setLoadedMatches] = useState<LoadedRoundMatches | null>(null);
  const [matchesAttempt, setMatchesAttempt] = useState(0);

  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(state.seasonId ?? '');
  const [competitionId, setCompetitionId] = useState<string>(state.phaseRef?.phase_id ?? state.tournamentId ?? '');
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
  const [populating, setPopulating] = useState(false);
  const [populateError, setPopulateError] = useState<ApiErrorLike | null>(null);
  const selection = useRef(0);

  // Fetch seasons (test leagues included) on mount
  useEffect(() => {
    let current = true;
    void fetchSeasonOptions().then((options) => {
      if (current) setSeasons(options);
    });
    return () => {
      current = false;
    };
  }, []);

  const phaseRoot = `/api/seasons/${selectedSeasonId}/phases`;
  const competitions = useScopedOptions<CompetitionOption>(selectedSeasonId
    ? native ? phaseRoot : `/api/tournaments?season_id=${selectedSeasonId}`
    : null);
  const competitionOptions = native
    ? competitions.options.filter((option) => option.season_id === selectedSeasonId)
    : competitions.options;
  const roundsPath = competitionId && (!native || selectedSeasonId)
    ? native ? `${phaseRoot}/${competitionId}/rounds` : `/api/tournaments/${competitionId}/rounds`
    : null;
  const rounds = useScopedOptions<RoundOption>(roundsPath);
  const roundOptions = native ? rounds.options.filter((option) => option.phase_id === competitionId) : rounds.options;

  // Fetch matches when the round changes. The result is kept with the
  // request it answers, and a response for a round no longer selected is
  // dropped, so the select never lists a previous round's matches.
  const matchesPath = roundsPath && selectedRoundId ? `${roundsPath}/${selectedRoundId}` : null;
  const matchesKey = matchesPath ? roundMatchesKey(native ? `${phaseRoot}/${competitionId}` : competitionId, selectedRoundId, matchesAttempt) : null;
  useEffect(() => {
    if (!matchesKey || !matchesPath) return;
    let current = true;
    const scope = native ? { phaseId: competitionId, roundId: selectedRoundId } : undefined;
    void fetchRoundMatchOptionsAt(matchesPath, fetch, scope).then((result) => {
      if (current) setLoadedMatches({ key: matchesKey, result });
    });
    return () => {
      current = false;
    };
  }, [matchesKey, matchesPath, native, selectedRoundId, competitionId]);
  const matchOptions = matchOptionsFor(loadedMatches, matchesKey);

  useEffect(() => () => { selection.current++; }, [state.sessionId, native]);

  function invalidateSelection() {
    selection.current++;
    setPopulating(false);
    setPopulateError(null);
  }

  async function handleMatchSelect(matchId: string) {
    if (!matchOptions.matches.some((match) => match.id === matchId)) return;
    const version = ++selection.current;
    const phaseRef: CastSessionPhaseRef | undefined = native
      ? { season_id: selectedSeasonId, phase_id: competitionId, match_id: matchId } : undefined;
    setPopulating(true);
    setPopulateError(null);
    try {
      const res = await fetch(`/api/cast-sessions/${state.sessionId}/populate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(phaseRef ? { phase_ref: phaseRef } : { match_id: matchId }),
      });
      const json: ApiResult<CastSessionPopulateResult | PhaseCastPopulateResult> = await res.json();
      if (version !== selection.current) return;
      if (!res.ok || !json.success) {
        if (native) setPopulateError(toApiErrorLike(json));
        return;
      }
      const { match } = json.data;
      if (phaseRef && 'phase_id' in match && match.id === matchId
        && match.phase_id === phaseRef.phase_id && match.season_id === phaseRef.season_id) {
        dispatch({ type: 'populate_match', data: { ...json.data, match: { ...match, tournament_id: null } }, phaseRef });
      } else if (!phaseRef && 'tournament_id' in match && match.id === matchId && match.tournament_id === competitionId) {
        dispatch({ type: 'populate_match', data: { ...json.data, match } });
      } else if (native) {
        setPopulateError({});
      }
    } catch {
      if (native && version === selection.current) setPopulateError({});
    } finally {
      if (version === selection.current) setPopulating(false);
    }
  }

  return (
    <section className="space-y-3 rounded-poke-lg border border-hairline bg-surface p-4">
      <h2 className="font-heading text-title text-fg">{t('matchSelector.title')}</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Season */}
        <div>
          <Select
            label={t('matchSelector.season')}
            value={selectedSeasonId}
            onChange={(e) => {
              invalidateSelection();
              setSelectedSeasonId(e.target.value);
              setCompetitionId('');
              setSelectedRoundId('');
            }}
          >
            <option value="">{t('matchSelector.selectSeason')}</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>

        {/* Tournament */}
        <div>
          <Select
            label={native ? t('matchSelector.phase') : t('matchSelector.tournament')}
            value={competitionId}
            disabled={!selectedSeasonId}
            onChange={(e) => {
              invalidateSelection();
              setCompetitionId(e.target.value);
              setSelectedRoundId('');
            }}
          >
            <option value="">{native ? t('matchSelector.selectPhase') : t('matchSelector.selectTournament')}</option>
            {competitionOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </Select>
        </div>

        {/* Round */}
        <div>
          <Select
            label={t('matchSelector.round')}
            value={selectedRoundId}
            disabled={!competitionId}
            onChange={(e) => {
              invalidateSelection();
              setSelectedRoundId(e.target.value);
            }}
          >
            <option value="">{t('matchSelector.selectRound')}</option>
            {roundOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {t('matchSelector.roundOption', {
                  name: translateEngineLabel('round', r.name, locale),
                  bestOf: r.best_of,
                })}
              </option>
            ))}
          </Select>
        </div>

        {/* Match */}
        <div>
          <Select
            label={t('matchSelector.match')}
            value=""
            disabled={!selectedRoundId || populating || matchOptions.loading}
            onChange={(e) => {
              if (e.target.value) handleMatchSelect(e.target.value);
            }}
          >
            <option value="">{t('matchSelector.selectMatch')}</option>
            {matchOptions.matches.map((m) => (
              <option key={m.id} value={m.id}>
                {t('matchSelector.matchOption', {
                  player1: m.player_1_name,
                  player2: m.player_2_name,
                  status: enumLabel(tEnum, 'matchStatus', m.status),
                })}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {(competitions.loading || rounds.loading || matchOptions.loading) && (
        <p className="text-caption text-fg-muted animate-pulse">{t('matchSelector.loading')}</p>
      )}
      {matchOptions.error && (
        <MatchesLoadError
          error={matchOptions.error}
          onRetry={() => setMatchesAttempt((n) => n + 1)}
        />
      )}
      {populating && (
        <p className="text-caption text-accent-ink animate-pulse">{t('matchSelector.populating')}</p>
      )}
      {populateError && (
        <p role="alert" className="text-caption text-loss">
          {populateError.error || populateError.code ? populateErrorText(populateError) : t('matchSelector.populateFailed')}
        </p>
      )}
    </section>
  );
}

/**
 * A failed round-matches load: what failed, and a retry. `error` is the
 * API's failure, or `{}` when no answer arrived ("Failed to load matches").
 */
export function MatchesLoadError({ error, onRetry }: { error: ApiErrorLike; onRetry: () => void }) {
  const t = useT(creatorStudioMessages);
  const errorText = useApiErrorText(errorsTournaments);
  const message = error.error || error.code ? errorText(error) : t('matchSelector.loadFailed');
  return (
    <p role="alert" className="text-caption text-loss">
      {t('matchSelector.loadError', { message })}{' '}
      <button type="button" className="font-[550] underline hover:no-underline" onClick={onRetry}>
        {t('matchSelector.retry')}
      </button>
    </p>
  );
}
