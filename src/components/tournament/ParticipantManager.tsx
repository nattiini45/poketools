'use client';

import { useState, useEffect } from 'react';
import type { Player } from '@/types/player';
import type { ParticipantWithSeed, Tournament } from '@/types/tournament';
import type { EnrollmentSource } from '@/types/season';
import type { ApiResult } from '@/types/api';
import type { RatingLeaderboardEntry } from '@/types/rating';
import Alert from '@/components/ui/Alert';
import SeedingTable from './SeedingTable';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { apiFailure, type UiError } from './ui-error';

interface ParticipantManagerProps {
  tournamentId: string;
}

export default function ParticipantManager({ tournamentId }: ParticipantManagerProps) {
  const [participants, setParticipants] = useState<ParticipantWithSeed[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [enrollmentSource, setEnrollmentSource] = useState<EnrollmentSource | null>(null);
  const [sourcePhaseName, setSourcePhaseName] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const t = useT(tournamentsAdminMessages);
  const errorText = useApiErrorText(errorsTournaments);
  const [error, setError] = useState<UiError<'participants.loadFailed'> | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [tournamentRes, partRes, playerRes] = await Promise.all([
          fetch(`/api/tournaments/${tournamentId}`),
          fetch(`/api/tournaments/${tournamentId}/participants`),
          fetch('/api/players'),
        ]);

        const tournamentJson: ApiResult<Tournament> = await tournamentRes.json();
        const partJson: ApiResult<ParticipantWithSeed[]> = await partRes.json();
        const playerJson: ApiResult<Player[]> = await playerRes.json();

        if (!tournamentJson.success) {
          setError(apiFailure(tournamentJson));
          return;
        }

        const t = tournamentJson.data;
        setTournament(t);
        setEnrollmentSource(t.enrollment_source);
        setSourcePhaseName(null);

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
              const refreshedJson: ApiResult<ParticipantWithSeed[]> = await refreshed.json();
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

        if (playerJson.success) setAllPlayers(playerJson.data);
      } catch {
        setError({ key: 'participants.loadFailed' });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [tournamentId]);

  async function addPlayer(playerId: string) {
    setError(null);
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
    const player = allPlayers.find((p) => p.id === playerId);
    if (player) {
      const withSeed: ParticipantWithSeed = {
        ...player,
        seed: null,
        starting_bracket: 'winners',
      };
      setParticipants((prev) => [...prev, withSeed]);
      if (enrollmentSource) {
        setEnrollmentSource({ ...enrollmentSource, frozen: true });
      }
    }
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
        allPlayers={allPlayers}
        onParticipantsChange={setParticipants}
        onEnrollmentChange={setEnrollmentSource}
        onAddPlayer={addPlayer}
        onRemovePlayer={removePlayer}
        bracketType={tournament?.bracket_type ?? null}
        editable={tournament?.status === 'upcoming'}
      />
    </div>
  );
}
