import type { AdminTournamentParticipant } from '@/lib/players/public-player';
import type { Tournament } from '@/types/tournament';
import type { EnrollmentSource } from '@/types/season';
import type { ApiResult } from '@/types/api';
import type { RatingLeaderboardEntry } from '@/types/rating';
import { apiFailure, type UiError } from './ui-error';

export type ParticipantsLoadError = UiError<'participants.loadFailed' | 'participants.addFailed'>;

/** What the participant manager shows after its first read of a tournament. */
export interface ParticipantsLoad {
  tournament: Tournament | null;
  enrollmentSource: EnrollmentSource | null;
  sourcePhaseName: string | null;
  /** `null` when the roster could not be read, which is not the same as an empty roster. */
  participants: AdminTournamentParticipant[] | null;
  ratings: Record<string, number | null>;
  error: ParticipantsLoadError | null;
}

/**
 * Reads the tournament, its roster and the ratings (and, for a league phase that may still change, syncs the
 * roster from the standings first). It never throws: a failed read leaves the matching field empty
 * (`participants: null` for the roster) and sets `error`, so the caller can tell a roster that failed to load
 * from one that is empty.
 */
export async function loadParticipants(
  tournamentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParticipantsLoad> {
  const result: ParticipantsLoad = {
    tournament: null,
    enrollmentSource: null,
    sourcePhaseName: null,
    participants: null,
    ratings: {},
    error: null,
  };
  try {
    const [tournamentRes, partRes] = await Promise.all([
      fetchImpl(`/api/tournaments/${tournamentId}`),
      fetchImpl(`/api/tournaments/${tournamentId}/participants`),
    ]);

    const tournamentJson: ApiResult<Tournament> = await tournamentRes.json();
    const partJson: ApiResult<AdminTournamentParticipant[]> = await partRes.json();

    if (!tournamentJson.success) {
      result.error = apiFailure(tournamentJson);
      return result;
    }

    const t = tournamentJson.data;
    result.tournament = t;
    result.enrollmentSource = t.enrollment_source;

    // A roster that fails to load is an error, not an empty tournament.
    if (!partJson.success) result.error = apiFailure(partJson);
    let currentParticipants = partJson.success ? partJson.data : null;

    if (t.season_id) {
      const hasRounds = t.current_round > 0;
      const shouldSync = !t.enrollment_source?.frozen && !hasRounds;

      if (shouldSync) {
        const syncRes = await fetchImpl(
          `/api/seasons/${t.season_id}/phases/${tournamentId}/participants/sync-standings`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        );
        const syncJson: ApiResult<{
          enrollment_source: EnrollmentSource;
          source_phase_name: string | null;
        }> = await syncRes.json();
        if (syncJson.success) {
          result.enrollmentSource = syncJson.data.enrollment_source;
          result.sourcePhaseName = syncJson.data.source_phase_name;
          const refreshed = await fetchImpl(`/api/tournaments/${tournamentId}/participants`);
          const refreshedJson: ApiResult<AdminTournamentParticipant[]> = await refreshed.json();
          if (refreshedJson.success) currentParticipants = refreshedJson.data;
        }
      }
    }

    result.participants = currentParticipants;

    const ratingsRes = await fetchImpl('/api/ratings');
    const ratingsJson: ApiResult<RatingLeaderboardEntry[]> = await ratingsRes.json();
    if (ratingsJson.success) {
      for (const entry of ratingsJson.data) {
        result.ratings[entry.player_id] = entry.rating;
      }
    }
  } catch {
    result.error = { key: 'participants.loadFailed' };
  }
  return result;
}
