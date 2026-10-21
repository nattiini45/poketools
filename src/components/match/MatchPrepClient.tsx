'use client';

import { useState } from 'react';
import Link from 'next/link';
import TeamsEditor from '@/components/teambuilder/v3/editor/TeamsEditor';
import { getButtonClasses } from '@/components/ui/Button';
import ScoutingReportCard from '@/components/match/ScoutingReportCard';
import { getGenFromBaseFormat } from '@/lib/pkmn/format-mapping';
import { useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { matchAiMessages } from '@/i18n/messages/match/ai';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import type { PokemonSet } from '@/types/team';
import type { MatchPrepAnalysis } from '@/types/game';

interface MatchPrepClientProps {
  matchId: string;
  rulesetId?: string;
  rulesetName?: string;
  /** Base format from the tournament's ruleset (e.g. 'gen9ou') */
  baseFormat?: string;
  opponentName: string;
  initialPokemon?: PokemonSet[];
  scoutingAnalysis?: MatchPrepAnalysis | null;
  /** Whether the user already had a prep team when the page loaded */
  hasExistingPrepTeam?: boolean;
  /** Only admins can repeat scouting */
  isAdmin?: boolean;
  /** Language of the stored scouting report (the league's content language). */
  contentLocale?: Locale;
}

export default function MatchPrepClient({
  matchId,
  rulesetId,
  rulesetName,
  baseFormat,
  opponentName,
  initialPokemon,
  scoutingAnalysis = null,
  hasExistingPrepTeam = false,
  isAdmin = false,
  contentLocale,
}: MatchPrepClientProps) {
  const t = useT(matchAiMessages);
  const tForms = useT(matchFormsMessages);
  const [teamSavedThisSession, setTeamSavedThisSession] = useState(false);
  const generation = getGenFromBaseFormat(baseFormat ?? 'gen9ou');

  return (
    <div className="space-y-4">
      {/* Match-specific header */}
      <div className="text-sm text-poke-text-muted px-1">
        {t('prep.opponent')} <span className="font-medium text-poke-text-secondary">{opponentName}</span>
        {rulesetName && (
          <>
            {' · '}{t('prep.format')} <span className="font-medium text-poke-text-secondary">{rulesetName}</span>
          </>
        )}
        <Link
          href={`/dashboard/submit/${matchId}`}
          className={`ml-3 ${getButtonClasses('secondary', 'sm')}`}
        >
          {tForms('common.submitResult')}
        </Link>
      </div>

      {/* Professor Linden scouting report */}
      <ScoutingReportCard
        analysis={scoutingAnalysis}
        matchId={matchId}
        showRescout={teamSavedThisSession || hasExistingPrepTeam}
        isAdmin={isAdmin}
        contentLocale={contentLocale}
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
          initialPokemon={initialPokemon}
          locked={false}
          rulesetId={rulesetId}
          onSaveSuccess={() => setTeamSavedThisSession(true)}
        />
      </div>
    </div>
  );
}
