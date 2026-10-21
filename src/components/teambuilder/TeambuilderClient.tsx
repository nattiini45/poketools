'use client';

import TeamsEditor from './v3/editor/TeamsEditor';
import Alert from '@/components/ui/Alert';
import { getGenFromBaseFormat } from '@/lib/pkmn/format-mapping';
import type { PokemonSet } from '@/types/team';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
// Save is handled internally by TeamsEditor via useTeamSave

interface TeambuilderClientProps {
  /** Tournament ID (null for standalone mode) */
  tournamentId: string | null;
  /** Ruleset ID for validation */
  rulesetId?: string;
  /** Pre-loaded team (for edit mode) */
  initialPokemon?: PokemonSet[];
  /** Existing team ID (for updates) */
  teamId?: string;
  /** Existing team name (for edit mode) */
  teamName?: string;
  /** Whether the team is locked */
  locked?: boolean;
  /**
   * Why it is locked: `'completed_match'` for a team of a completed match (its
   * roster is public and final; the API refuses the save with 409
   * `team_match_completed`), else the tournament lock.
   */
  lockReason?: 'tournament' | 'completed_match';
  /** Ruleset name for display */
  rulesetName?: string;
  /** Base format from ruleset (e.g. 'gen9ou') */
  baseFormat?: string;
  /** Season ID (for draft/league context) */
  seasonId?: string | null;
  /** Whether this is a draft league */
  isDraftLeague?: boolean;
}

export default function TeambuilderClient({
  tournamentId,
  rulesetId,
  initialPokemon,
  teamId,
  teamName,
  locked,
  lockReason = 'tournament',
  // rulesetName is accepted but unused — kept for API compatibility
  baseFormat,
  seasonId,
  isDraftLeague,
}: TeambuilderClientProps) {
  const t = useT(teambuilderMessages);
  const generation = getGenFromBaseFormat(baseFormat ?? 'gen9ou');

  return (
    <div className="flex flex-col h-full">
      {locked && (
        <div className="px-4 py-2">
          <Alert variant="warning">
            {t(lockReason === 'completed_match' ? 'page.completedMatchBanner' : 'page.lockedBanner')}
          </Alert>
        </div>
      )}

      <TeamsEditor
        mode="teambuilder"
        format={baseFormat ?? 'gen9ou'}
        generation={generation}
        tournamentId={tournamentId}
        seasonId={seasonId}
        initialPokemon={initialPokemon}
        teamId={teamId}
        teamName={teamName}
        locked={locked}
        rulesetId={rulesetId}
        isDraftLeague={isDraftLeague}
      />
    </div>
  );
}
