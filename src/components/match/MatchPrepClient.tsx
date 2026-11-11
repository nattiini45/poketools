'use client';

import { useState } from 'react';
import TeamsEditor from '@/components/teambuilder/v3/editor/TeamsEditor';
import { PlateLink } from '@/components/match/PlateButton';
import ScoutingReportCard from '@/components/match/ScoutingReportCard';
import { getGenFromBaseFormat } from '@/lib/pkmn/format-mapping';
import { useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import type { PokemonSet } from '@/types/team';
import type { MatchPrepAnalysis } from '@/types/game';

interface MatchPrepClientProps {
  matchId: string;
  /**
   * The match's tournament and its season. The editor needs both: the live check resolves the round of this match from
   * `match_id` + `tournament_id`, and the validation panel's pools card reads the season's kit league view.
   */
  tournamentId?: string | null;
  seasonId?: string | null;
  rulesetId?: string;
  /** The ruleset's name. The page's versus header shows it now; the prop stays so the page's contract is unchanged. */
  rulesetName?: string;
  /** Base format from the tournament's ruleset (e.g. 'gen9ou') */
  baseFormat?: string;
  /** The generation the ruleset is for (`ruleset.gen`); without one it is read from `baseFormat`. */
  gen?: number;
  opponentName: string;
  initialPokemon?: PokemonSet[];
  scoutingAnalysis?: MatchPrepAnalysis | null;
  /** Whether the user already had a prep team when the page loaded */
  hasExistingPrepTeam?: boolean;
  /** Only admins can repeat scouting */
  isAdmin?: boolean;
  /** Language of the stored scouting report (the league's content language). */
  contentLocale?: Locale;
  /** The types of the Pokémon the scouting report names, by English species name (resolved on the server). */
  speciesTypes?: Record<string, string[]>;
}

export default function MatchPrepClient({
  matchId,
  tournamentId,
  seasonId,
  rulesetId,
  baseFormat,
  gen,
  opponentName,
  initialPokemon,
  scoutingAnalysis = null,
  hasExistingPrepTeam = false,
  isAdmin = false,
  contentLocale,
  speciesTypes,
}: MatchPrepClientProps) {
  const tForms = useT(matchFormsMessages);
  const [teamSavedThisSession, setTeamSavedThisSession] = useState(false);
  const generation = gen ?? getGenFromBaseFormat(baseFormat ?? 'gen9ou');

  return (
    <div className="flex flex-col gap-4">
      {/* Played already? The step after preparing. */}
      <PlateLink href={`/dashboard/submit/${matchId}`} className="self-start">
        {tForms('common.submitResult')}
      </PlateLink>

      {/* Professor Linden scouting report */}
      <ScoutingReportCard
        analysis={scoutingAnalysis}
        matchId={matchId}
        showRescout={teamSavedThisSession || hasExistingPrepTeam}
        isAdmin={isAdmin}
        contentLocale={contentLocale}
        opponentName={opponentName}
        speciesTypes={speciesTypes}
      />

      {/* v3 TeamsEditor in plan mode.
          key={matchId} forces a fresh editor instance per match prep: it discards
          the (useMemo-frozen) reducer AND the AI chat's local thread/conversation id,
          so navigating between match preps never continues the previous one. */}
      <div className="h-[max(calc(100vh-64px),700px)]">
        <TeamsEditor
          key={matchId}
          mode="plan"
          format={baseFormat ?? 'gen9ou'}
          generation={generation}
          matchId={matchId}
          tournamentId={tournamentId}
          seasonId={seasonId}
          initialPokemon={initialPokemon}
          locked={false}
          rulesetId={rulesetId}
          onSaveSuccess={() => setTeamSavedThisSession(true)}
        />
      </div>

    </div>
  );
}
