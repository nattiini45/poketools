'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Combobox from '@/components/ui/Combobox';
import SeedingTable from '@/components/tournament/SeedingTable';
import { apiFailure, type UiError } from '@/components/tournament/ui-error';
import { isFormatPhaseOwnedRefusal, useRosterForcePrompt, withRosterForce } from '@/components/tournament/roster-force';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import type { AdminTournamentParticipant, PublicPlayerRef } from '@/lib/players/public-player';
import type { ApiResult } from '@/types/api';
import type { EnrollmentSource } from '@/types/season';
import type { BracketType } from '@/types/tournament';

interface PhaseRosterManagerProps {
  seasonId: string;
  phaseId: string;
  bracketType: BracketType;
  editable: boolean;
  startedFormatPhase: boolean;
  rosterSeatsLocked: boolean;
  initialParticipants: AdminTournamentParticipant[];
  initialEnrollment: EnrollmentSource | null;
  sourcePhaseName: string | null;
  candidates: PublicPlayerRef[];
  ratings: Record<string, number>;
}

export default function PhaseRosterManager({
  seasonId, phaseId, bracketType, editable, startedFormatPhase, rosterSeatsLocked,
  initialParticipants, initialEnrollment, sourcePhaseName, candidates, ratings,
}: PhaseRosterManagerProps) {
  const router = useRouter();
  const t = useT(tournamentsAdminMessages);
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments);
  const { ask, dialog } = useRosterForcePrompt();
  const [participants, setParticipants] = useState(initialParticipants);
  const [enrollment, setEnrollment] = useState(initialEnrollment);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<UiError<'participants.loadFailed' | 'participants.addFailed' | 'seeding.removeFailed'> | null>(null);
  const url = `/api/seasons/${seasonId}/phases/${phaseId}/participants`;
  const enrolled = new Set(participants.map(player => player.id));
  const options = candidates.filter(player => !enrolled.has(player.id)).map(player => ({ value: player.id, label: player.name }));

  function updateParticipants(rows: AdminTournamentParticipant[]) {
    setParticipants(rows);
    router.refresh();
  }

  async function editRoster(method: 'POST' | 'DELETE', playerId: string, reason?: string) {
    if (!editable || rosterSeatsLocked || pending) return;
    setPending(true);
    setError(null);
    let committed = false;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withRosterForce({ player_id: playerId }, reason)),
      });
      const result: ApiResult<null> = await res.json();
      if (!result.success) {
        if (reason === undefined && isFormatPhaseOwnedRefusal(result)) ask(force => editRoster(method, playerId, force));
        else setError(apiFailure(result));
        return;
      }

      committed = true;
      setEnrollment(current => current && { ...current, frozen: true });
      router.refresh();
      if (method === 'DELETE') {
        setParticipants(current => current.filter(player => player.id !== playerId));
        return;
      }
      const roster = await fetch(`${url}?view=admin`);
      const refreshed: ApiResult<AdminTournamentParticipant[]> = await roster.json();
      if (refreshed.success) setParticipants(refreshed.data);
      else setError(apiFailure(refreshed));
    } catch {
      setError({ key: committed ? 'participants.loadFailed' : method === 'POST' ? 'participants.addFailed' : 'seeding.removeFailed' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4" aria-busy={pending}>
      {dialog}
      {error && <Alert variant="error">{'api' in error ? errorText(error.api) : t(error.key)}</Alert>}
      {rosterSeatsLocked && <Alert variant="info">{errorText({ code: 'PHASE_ELIMINATION_ROSTER_LOCKED' })}</Alert>}
      <SeedingTable
        phase={{ seasonId, phaseId, rosterSeatsLocked }}
        participants={participants}
        enrollmentSource={enrollment}
        sourcePhaseName={sourcePhaseName}
        ratings={ratings}
        allPlayers={[]}
        onParticipantsChange={updateParticipants}
        onEnrollmentChange={setEnrollment}
        onAddPlayer={id => editRoster('POST', id)}
        onRemovePlayer={id => editRoster('DELETE', id)}
        bracketType={bracketType}
        editable={editable}
        startedFormatPhase={startedFormatPhase}
      />
      {editable && !rosterSeatsLocked && options.length > 0 && (
        <Combobox
          mode="static"
          label={t('seeding.addPlayer')}
          placeholder={t('participants.searchPlaceholder')}
          value=""
          staticOptions={options}
          disabled={pending}
          onChange={id => { if (id) void editRoster('POST', id); }}
        />
      )}
    </div>
  );
}
