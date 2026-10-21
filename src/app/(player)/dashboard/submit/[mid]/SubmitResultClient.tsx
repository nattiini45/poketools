'use client';

import { useState } from 'react';
import ReplaySubmitForm from '@/components/match/ReplaySubmitForm';
import ManualStatForm from '@/components/match/ManualStatForm';
import ReplayImportForm from '@/components/match/ReplayImportForm';
import { useT } from '@/i18n/client';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import type { PokemonSet } from '@/types/team';

interface PlayerInfo {
  id: string;
  name: string;
}

interface SubmitResultClientProps {
  matchId: string;
  players: [PlayerInfo, PlayerInfo];
  /** Match-prep rosters the viewer may see (spec §7, decided per side on the server). */
  prepTeams?: { player1: PokemonSet[]; player2: PokemonSet[] };
  generation?: number;
  redirectTo?: string;
  /** When true, expose the admin-only "Replay (manual assign)" tab + fallback. */
  isAdmin?: boolean;
}

type Mode = 'replay' | 'manual' | 'replay-import';

export default function SubmitResultClient({
  matchId,
  players,
  prepTeams,
  generation,
  redirectTo,
  isAdmin,
}: SubmitResultClientProps) {
  const t = useT(matchFormsMessages);
  // Fresh state per match comes from key={matchId} on the parent remount.
  const [mode, setMode] = useState<Mode>('replay');
  // URL carried over from a failed name-match in the normal replay flow.
  const [carryUrl, setCarryUrl] = useState('');

  function handleManualAssign(url: string) {
    setCarryUrl(url);
    setMode('replay-import');
  }

  const tabClass = (active: boolean) =>
    `px-4 py-2 text-sm font-heading font-semibold border-b-2 transition-colors ${
      active
        ? 'border-poke-accent text-poke-accent'
        : 'border-transparent text-poke-text-muted hover:text-poke-text-secondary'
    }`;

  return (
    <div className="space-y-4">
      {/* Mode Tabs */}
      <div className="flex gap-1 border-b border-poke-border">
        <button onClick={() => setMode('replay')} className={tabClass(mode === 'replay')}>
          {t('submitPage.tabReplay')}
        </button>
        <button onClick={() => setMode('manual')} className={tabClass(mode === 'manual')}>
          {t('submitPage.tabManual')}
        </button>
        {isAdmin && (
          <button
            onClick={() => setMode('replay-import')}
            className={tabClass(mode === 'replay-import')}
          >
            {t('submitPage.tabReplayImport')}
          </button>
        )}
      </div>

      {/* Forms */}
      {mode === 'replay' && (
        <ReplaySubmitForm
          matchId={matchId}
          redirectTo={redirectTo}
          isAdmin={isAdmin}
          onManualAssign={isAdmin ? handleManualAssign : undefined}
        />
      )}
      {mode === 'manual' && (
        <ManualStatForm
          matchId={matchId}
          players={players}
          initialTeams={prepTeams}
          generation={generation}
          redirectTo={redirectTo}
        />
      )}
      {mode === 'replay-import' && isAdmin && (
        <ReplayImportForm
          matchId={matchId}
          players={players}
          generation={generation}
          redirectTo={redirectTo}
          initialReplayUrl={carryUrl || undefined}
          autoParse={Boolean(carryUrl)}
        />
      )}
    </div>
  );
}
