'use client';

import { useLocale } from '@/i18n/client';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import type { PublicMatch } from '@/lib/match/public-match';
import type { Round } from '@/types/round';
import type { BracketSlotDef } from '@/lib/tournament/bracket-structure';
import BracketMatchCard from './BracketMatchCard';
import BracketSkeletonCard from './BracketSkeletonCard';
import { bracketLabelsFor, type BracketLabels } from './labels';

interface SingleElimBracketProps {
  rounds: Round[];
  matchesByRound: Record<string, PublicMatch[]>;
  tournamentId: string;
  structureSlots?: BracketSlotDef[];
  slotLabels?: Map<string, { label1: string; label2: string }>;
  slotIndexByKey?: Map<string, number>;
  /** When true, render flat match cards only (pre-revamp data). */
  legacyMode?: boolean;
  /** The renderer's words; the viewer's language by default. */
  labels?: BracketLabels;
}

/**
 * Single Elimination bracket renderer using CSS Grid.
 * Renders rounds as columns with matches connected visually. Client
 * component: the stored English round names and feeder labels are shown in
 * the viewer's language (`translateEngineLabel`; already-translated names
 * pass through unchanged).
 */
export default function SingleElimBracket({
  rounds,
  matchesByRound,
  tournamentId,
  structureSlots,
  slotLabels,
  slotIndexByKey,
  legacyMode = false,
  labels: labelsOverride,
}: SingleElimBracketProps) {
  const locale = useLocale();
  const labels = labelsOverride ?? bracketLabelsFor(locale);
  const sortedRounds = [...rounds].sort((a, b) => a.round_number - b.round_number);

  if (sortedRounds.length === 0) {
    return <p className="text-poke-text-muted text-sm">{labels.noRounds}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-8 min-w-fit">
        {sortedRounds.map((round) => {
          const matches = matchesByRound[round.id] ?? [];
          const roundSlots =
            !legacyMode && structureSlots
              ? structureSlots.filter((s) => s.global_round_number === round.round_number)
              : [];

          return (
            <div key={round.id} className="flex flex-col gap-4 min-w-[220px]">
              <h3 className="text-sm font-heading font-semibold text-poke-text-secondary text-center border-b border-poke-border pb-1">
                {translateEngineLabel('round', round.name, locale)}
              </h3>
              <div className="flex flex-col justify-around flex-1 gap-4">
                {roundSlots.length > 0
                  ? roundSlots.map((slotDef) => {
                      const match = matches.find(
                        (m) => m.bracket_pos === slotDef.bracket_pos
                      );
                      if (match) {
                        return (
                          <BracketMatchCard
                            key={match.id}
                            match={match}
                            tournamentId={tournamentId}
                            statusLabels={labels.matchStatus}
                          />
                        );
                      }
                      const slot = slotLabels?.get(slotDef.slotKey);
                      const matchNum = slotIndexByKey?.get(slotDef.slotKey);
                      return (
                        <BracketSkeletonCard
                          key={slotDef.slotKey}
                          label1={slot ? translateEngineLabel('slot', slot.label1, locale) : labels.tbd}
                          label2={slot ? translateEngineLabel('slot', slot.label2, locale) : labels.tbd}
                          matchNumber={matchNum}
                          labels={labels}
                        />
                      );
                    })
                  : matches.map((match) => (
                      <BracketMatchCard
                        key={match.id}
                        match={match}
                        tournamentId={tournamentId}
                        statusLabels={labels.matchStatus}
                      />
                    ))}
                {matches.length === 0 && roundSlots.length === 0 && (
                  <p className="text-xs text-poke-text-muted text-center">{labels.tbd}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
