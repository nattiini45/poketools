'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import SkewPlate from '@/components/ui/SkewPlate';
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

  const tabsId = useId();
  const modes: { mode: Mode; label: string }[] = [
    { mode: 'replay', label: t('submitPage.tabReplay') },
    { mode: 'manual', label: t('submitPage.tabManual') },
    ...(isAdmin ? [{ mode: 'replay-import' as const, label: t('submitPage.tabReplayImport') }] : []),
  ];

  // Arrow keys move between the tabs, as in any tab list; the tab that gets focus is selected.
  function handleTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = modes.findIndex((entry) => entry.mode === mode);
    const next = modes[(index + (event.key === 'ArrowRight' ? 1 : modes.length - 1)) % modes.length];
    setMode(next.mode);
    document.getElementById(`${tabsId}-${next.mode}`)?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Mode Tabs */}
      <div role="tablist" aria-label={t('submitPage.tabsLabel')} className="flex flex-wrap gap-x-3 gap-y-2 px-1" onKeyDown={handleTabKey}>
        {modes.map((entry) => (
          <button
            key={entry.mode}
            id={`${tabsId}-${entry.mode}`}
            type="button"
            role="tab"
            aria-selected={mode === entry.mode}
            aria-controls={`${tabsId}-panel`}
            tabIndex={mode === entry.mode ? 0 : -1}
            onClick={() => setMode(entry.mode)}
            className="inline-flex min-h-11 items-stretch text-body"
          >
            <SkewPlate variant="tab" active={mode === entry.mode} glideId={`${tabsId}-glide`} className="px-4">
              {entry.label}
            </SkewPlate>
          </button>
        ))}
      </div>

      {/* Forms */}
      <div
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${mode}`}
        className="rounded-poke-lg border border-hairline bg-surface p-4 sm:p-5"
      >
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
          redirectTo={redirectTo}
          initialReplayUrl={carryUrl || undefined}
          autoParse={Boolean(carryUrl)}
        />
      )}
      </div>
    </div>
  );
}
