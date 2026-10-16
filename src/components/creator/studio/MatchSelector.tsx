'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCastStudio } from './CastStudioContext';
import { useLocale, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsTournaments } from '@/i18n/messages/errors';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';
import { translateEngineLabel } from '@/i18n/content/engine-labels';

// ─── Lightweight list shapes (only what we need for display) ───────

export interface SeasonOption { id: string; name: string }
interface TournamentOption { id: string; name: string }
interface RoundOption { id: string; name: string; round_number: number; best_of: number }
export interface MatchOption {
  id: string;
  player_1_name: string;
  player_2_name: string;
  status: string;
}

// ─── League (season) options ───────────────────────────────────────

/**
 * The League select's source. The plain `GET /api/seasons` is the public
 * list and leaves test leagues out; the studio is a creator/admin tool, and
 * rehearsing a cast on a test league is a supported use, so it asks for test
 * leagues too (`include_test=1`). The route grants it from the live roles to
 * site admins and creators in good standing, the people the studio admits;
 * anyone else gets the public list.
 */
export const STUDIO_SEASONS_URL = '/api/seasons?include_test=1';

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
  try {
    const res = await fetchImpl(`/api/tournaments/${tournamentId}/rounds/${roundId}`);
    const json = (await res.json()) as
      | { success: true; data: { matches: MatchOption[] } }
      | { success: false; error: string; code?: string };
    if (!json.success) return { ok: false, error: toApiErrorLike(json) };
    return { ok: true, matches: json.data.matches };
  } catch {
    return { ok: false, error: {} };
  }
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

  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [rounds, setRounds] = useState<RoundOption[]>([]);
  const [loadedMatches, setLoadedMatches] = useState<LoadedRoundMatches | null>(null);
  const [matchesAttempt, setMatchesAttempt] = useState(0);

  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(state.seasonId ?? '');
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>(state.tournamentId ?? '');
  const [selectedRoundId, setSelectedRoundId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [populating, setPopulating] = useState(false);

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

  // Fetch tournaments when season changes
  useEffect(() => {
    if (!selectedSeasonId) { setTournaments([]); return; }
    setLoading(true);
    fetch(`/api/tournaments?season_id=${selectedSeasonId}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setTournaments(res.data);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, [selectedSeasonId]);

  // Fetch rounds when tournament changes
  useEffect(() => {
    if (!selectedTournamentId) { setRounds([]); return; }
    setLoading(true);
    fetch(`/api/tournaments/${selectedTournamentId}/rounds`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setRounds(res.data);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, [selectedTournamentId]);

  // Fetch matches when the round changes. The result is kept with the
  // request it answers, and a response for a round no longer selected is
  // dropped, so the select never lists a previous round's matches.
  const matchesKey =
    selectedRoundId && selectedTournamentId
      ? roundMatchesKey(selectedTournamentId, selectedRoundId, matchesAttempt)
      : null;
  useEffect(() => {
    if (!matchesKey) return;
    let current = true;
    void fetchRoundMatchOptions(selectedTournamentId, selectedRoundId).then((result) => {
      if (current) setLoadedMatches({ key: matchesKey, result });
    });
    return () => {
      current = false;
    };
  }, [matchesKey, selectedRoundId, selectedTournamentId]);
  const matchOptions = matchOptionsFor(loadedMatches, matchesKey);

  // Populate session from selected match
  const handleMatchSelect = useCallback(async (matchId: string) => {
    setPopulating(true);
    try {
      const res = await fetch(`/api/cast-sessions/${state.sessionId}/populate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId }),
      });
      const json = await res.json();
      if (json.success) {
        dispatch({ type: 'populate_match', data: json.data });
      }
    } catch {
      // Populate failed — user can still edit manually
    } finally {
      setPopulating(false);
    }
  }, [state.sessionId, dispatch]);

  const selectClass = 'w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary focus:outline-none focus:ring-2 focus:ring-poke-accent';

  return (
    <div className="space-y-3">
      <h3 className="font-heading text-sm font-bold text-poke-text-secondary uppercase tracking-wide">
        {t('matchSelector.title')}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        {/* Season */}
        <div>
          <label className="block text-xs text-poke-text-secondary mb-1">{t('matchSelector.season')}</label>
          <select
            className={selectClass}
            value={selectedSeasonId}
            onChange={(e) => {
              setSelectedSeasonId(e.target.value);
              setSelectedTournamentId('');
              setSelectedRoundId('');
            }}
          >
            <option value="">{t('matchSelector.selectSeason')}</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Tournament */}
        <div>
          <label className="block text-xs text-poke-text-secondary mb-1">{t('matchSelector.tournament')}</label>
          <select
            className={selectClass}
            value={selectedTournamentId}
            disabled={!selectedSeasonId}
            onChange={(e) => {
              setSelectedTournamentId(e.target.value);
              setSelectedRoundId('');
            }}
          >
            <option value="">{t('matchSelector.selectTournament')}</option>
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
            ))}
          </select>
        </div>

        {/* Round */}
        <div>
          <label className="block text-xs text-poke-text-secondary mb-1">{t('matchSelector.round')}</label>
          <select
            className={selectClass}
            value={selectedRoundId}
            disabled={!selectedTournamentId}
            onChange={(e) => setSelectedRoundId(e.target.value)}
          >
            <option value="">{t('matchSelector.selectRound')}</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {t('matchSelector.roundOption', {
                  name: translateEngineLabel('round', r.name, locale),
                  bestOf: r.best_of,
                })}
              </option>
            ))}
          </select>
        </div>

        {/* Match */}
        <div>
          <label className="block text-xs text-poke-text-secondary mb-1">{t('matchSelector.match')}</label>
          <select
            className={selectClass}
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
          </select>
        </div>
      </div>

      {(loading || matchOptions.loading) && (
        <p className="text-xs text-poke-text-secondary animate-pulse">{t('matchSelector.loading')}</p>
      )}
      {matchOptions.error && (
        <MatchesLoadError
          error={matchOptions.error}
          onRetry={() => setMatchesAttempt((n) => n + 1)}
        />
      )}
      {populating && (
        <p className="text-xs text-poke-accent animate-pulse">{t('matchSelector.populating')}</p>
      )}
    </div>
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
    <p role="alert" className="text-xs text-poke-danger">
      {t('matchSelector.loadError', { message })}{' '}
      <button type="button" className="underline hover:no-underline" onClick={onRetry}>
        {t('matchSelector.retry')}
      </button>
    </p>
  );
}
