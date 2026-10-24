'use client';

import { useState, useEffect, useRef } from 'react';
import type { AdminTournamentParticipant, PublicPlayerRef } from '@/lib/players/public-player';
import {
  PLAYER_SEARCH_MIN_QUERY,
  PLAYER_SEARCH_NETWORK_ERROR,
  parsePlayerSearch,
  playerSearchUrl,
  searchTruncation,
  unavailableForEnrolment,
  type PlayerSearchHit,
} from '@/lib/players/player-search';
import type { Tournament } from '@/types/tournament';
import type { EnrollmentSource } from '@/types/season';
import type { ApiResult } from '@/types/api';
import type { RatingLeaderboardEntry } from '@/types/rating';
import Alert from '@/components/ui/Alert';
import Combobox, { type ComboboxOption } from '@/components/ui/Combobox';
import GuestBadge from '@/components/shared/GuestBadge';
import SeedingTable from './SeedingTable';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { apiFailure, type UiError } from './ui-error';

interface ParticipantManagerProps {
  tournamentId: string;
}

/**
 * The participant row a freshly enrolled player gets in the table: unseeded,
 * in the winners bracket. Only the public fields of the pick are known here;
 * the avatar fills in on the next load.
 */
export function enrolledParticipant(hit: PlayerSearchHit): AdminTournamentParticipant {
  return { id: hit.id, name: hit.name, avatar_url: null, seed: null, starting_bracket: 'winners', is_guest: hit.is_guest };
}

/** No players for the table's own button list: this component's picker replaces it. */
const NO_PLAYERS: readonly PublicPlayerRef[] = [];

export default function ParticipantManager({ tournamentId }: ParticipantManagerProps) {
  const [participants, setParticipants] = useState<AdminTournamentParticipant[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [enrollmentSource, setEnrollmentSource] = useState<EnrollmentSource | null>(null);
  const [sourcePhaseName, setSourcePhaseName] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const t = useT(tournamentsAdminMessages);
  const errorText = useApiErrorText(errorsTournaments);
  const [error, setError] = useState<UiError<'participants.loadFailed' | 'participants.addFailed'> | null>(null);
  const [adding, setAdding] = useState(false);
  /** The picker's own failure (its search call), kept apart from the roster's errors. */
  const [searchError, setSearchError] = useState<ApiErrorLike | null>(null);
  const [searchMore, setSearchMore] = useState<{ shown: number; total: number } | null>(null);
  const seenHits = useRef(new Map<string, PlayerSearchHit>());

  useEffect(() => {
    async function load() {
      try {
        const [tournamentRes, partRes] = await Promise.all([
          fetch(`/api/tournaments/${tournamentId}`),
          fetch(`/api/tournaments/${tournamentId}/participants`),
        ]);

        const tournamentJson: ApiResult<Tournament> = await tournamentRes.json();
        const partJson: ApiResult<AdminTournamentParticipant[]> = await partRes.json();

        if (!tournamentJson.success) {
          setError(apiFailure(tournamentJson));
          return;
        }

        const t = tournamentJson.data;
        setTournament(t);
        setEnrollmentSource(t.enrollment_source);
        setSourcePhaseName(null);

        // A roster that fails to load is an error, not an empty tournament.
        if (!partJson.success) setError(apiFailure(partJson));
        let currentParticipants = partJson.success ? partJson.data : [];

        if (t.season_id) {
          const hasRounds = t.current_round > 0;
          const shouldSync = !t.enrollment_source?.frozen && !hasRounds;

          if (shouldSync) {
            const syncRes = await fetch(
              `/api/seasons/${t.season_id}/phases/${tournamentId}/participants/sync-standings`,
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
            );
            const syncJson: ApiResult<{
              enrollment_source: EnrollmentSource;
              source_phase_name: string | null;
            }> = await syncRes.json();
            if (syncJson.success) {
              setEnrollmentSource(syncJson.data.enrollment_source);
              setSourcePhaseName(syncJson.data.source_phase_name);
              const refreshed = await fetch(`/api/tournaments/${tournamentId}/participants`);
              const refreshedJson: ApiResult<AdminTournamentParticipant[]> = await refreshed.json();
              if (refreshedJson.success) currentParticipants = refreshedJson.data;
            }
          }
        }

        setParticipants(currentParticipants);

        const ratingsRes = await fetch('/api/ratings');
        const ratingsJson: ApiResult<RatingLeaderboardEntry[]> = await ratingsRes.json();
        if (ratingsJson.success) {
          const map: Record<string, number | null> = {};
          for (const entry of ratingsJson.data) {
            map[entry.player_id] = entry.rating;
          }
          setRatings(map);
        }

      } catch {
        setError({ key: 'participants.loadFailed' });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [tournamentId]);

  /** Enrol the player the picker returned for `playerId` (the server decides: duplicates, locked brackets). */
  async function addPlayer(playerId: string) {
    const hit = seenHits.current.get(playerId);
    if (!hit || adding || participants.some((p) => p.id === playerId)) return;
    setError(null);
    setAdding(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        setError(apiFailure(result));
        return;
      }
      setParticipants((prev) => [...prev, enrolledParticipant(hit)]);
      if (enrollmentSource) {
        setEnrollmentSource({ ...enrollmentSource, frozen: true });
      }
    } catch {
      setError({ key: 'participants.addFailed' });
    } finally {
      setAdding(false);
    }
  }

  /**
   * Turns a search answer into picker options. A refusal the API answers in JSON is shown under the
   * picker, never as "no matches". A request with no JSON answer (network failure, HTML 502) is
   * swallowed inside `Combobox` before it gets here.
   */
  function transformSearch(json: unknown): ComboboxOption[] {
    const outcome = parsePlayerSearch(json);
    if (!outcome.ok) {
      setSearchError(outcome.error);
      setSearchMore(null);
      return [];
    }
    setSearchError(null);
    setSearchMore(searchTruncation(outcome));
    const enrolledIds = new Set(participants.map((p) => p.id));
    return outcome.hits.map((hit) => {
      seenHits.current.set(hit.id, hit);
      const enrolled = unavailableForEnrolment(hit, enrolledIds) === 'enrolled';
      return { label: hit.name, value: hit.id, disabled: enrolled, meta: { is_guest: hit.is_guest, enrolled } };
    });
  }

  async function removePlayer(playerId: string) {
    setError(null);
    const res = await fetch(`/api/tournaments/${tournamentId}/participants`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId }),
    });
    const result: ApiResult<null> = await res.json();
    if (!result.success) {
      setError(apiFailure(result));
      return;
    }
    setParticipants((prev) => prev.filter((p) => p.id !== playerId));
    if (enrollmentSource) {
      setEnrollmentSource({ ...enrollmentSource, frozen: true });
    }
  }

  if (loading) return <p className="text-sm text-poke-text-muted">{t('participants.loading')}</p>;

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{'api' in error ? errorText(error.api) : t(error.key)}</Alert>}
      <SeedingTable
        tournamentId={tournamentId}
        seasonId={tournament?.season_id ?? null}
        enrollmentSource={enrollmentSource}
        sourcePhaseName={sourcePhaseName}
        participants={participants}
        ratings={ratings}
        // The table's own button list is off: the searchable picker below adds players.
        allPlayers={NO_PLAYERS}
        onParticipantsChange={setParticipants}
        onEnrollmentChange={setEnrollmentSource}
        onAddPlayer={addPlayer}
        onRemovePlayer={removePlayer}
        bracketType={tournament?.bracket_type ?? null}
        editable={tournament?.status === 'upcoming'}
      />

      {tournament?.status === 'upcoming' && (
        <div className="space-y-1">
          <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{t('seeding.addPlayer')}</h3>
          <Combobox
            mode="async"
            value=""
            onChange={(id) => {
              if (id) void addPlayer(id);
            }}
            disabled={adding}
            placeholder={t('participants.searchPlaceholder')}
            fetchUrl={playerSearchUrl({ tournamentId })}
            transformResults={transformSearch}
            onFetchError={() => {
              setSearchError(PLAYER_SEARCH_NETWORK_ERROR);
              setSearchMore(null);
            }}
            minQueryLength={PLAYER_SEARCH_MIN_QUERY}
            renderOption={(option) => (
              <span
                className={
                  option.meta?.enrolled ? 'flex items-center gap-2 text-poke-text-muted opacity-60' : 'flex items-center gap-2'
                }
              >
                <span>{option.label}</span>
                {option.meta?.is_guest ? <GuestBadge /> : null}
                {option.meta?.enrolled ? <span className="text-xs">{t('participants.alreadyEnrolled')}</span> : null}
              </span>
            )}
          />
          {searchError && <Alert variant="error">{errorText(searchError)}</Alert>}
          {searchMore && (
            <p className="text-xs text-poke-text-muted">
              {t('participants.searchTruncated', { shown: searchMore.shown, total: searchMore.total })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
