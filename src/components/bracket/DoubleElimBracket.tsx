'use client';

import type { Locale } from '@/i18n/config';
import { useLocale } from '@/i18n/client';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import type { PublicMatch } from '@/lib/match/public-match';
import type { Round } from '@/types/round';
import type { BracketSlotDef } from '@/lib/tournament/bracket-structure';
import BracketMatchCard from './BracketMatchCard';
import BracketSkeletonCard from './BracketSkeletonCard';
import type { EntryLosses } from './entry-losses';
import { bracketLabelsFor, type BracketLabels } from './labels';

interface DoubleElimBracketProps {
  rounds: Round[];
  matchesByRound: Record<string, PublicMatch[]>;
  tournamentId: string;
  structureSlots?: BracketSlotDef[];
  slotLabels?: Map<string, { label1: string; label2: string }>;
  slotIndexByKey?: Map<string, number>;
  /** Pre-revamp flat rendering keyed by player loss counts */
  legacyMode?: boolean;
  lossCount?: Record<string, number>;
  /**
   * Each entrant's losses going into each match, keyed by match id
   * (`lossesEnteringMatches`): printed on the match cards. `lossCount` above
   * is today's count and only sorts legacy rounds; it would mislabel every
   * match a player has already played.
   */
  entryLosses?: Record<string, EntryLosses>;
  /** The renderer's words; the viewer's language by default. */
  labels?: BracketLabels;
}

type LegacySection = 'winners' | 'losers' | 'grand_finals';

function classifyLegacyRound(
  matches: PublicMatch[],
  lossCount: Record<string, number>,
): LegacySection {
  if (matches.length === 0) {
    return 'winners';
  }

  const isGrandFinals = matches.every((m) => {
    const p1Losses = lossCount[m.player_1_id] ?? 0;
    const p2Losses = lossCount[m.player_2_id] ?? 0;
    return (
      (p1Losses === 0 && p2Losses === 1) || (p1Losses === 1 && p2Losses === 0)
    );
  });
  if (isGrandFinals) {
    return 'grand_finals';
  }

  const isLosersRound = matches.every((m) => {
    const p1Losses = lossCount[m.player_1_id] ?? 0;
    const p2Losses = lossCount[m.player_2_id] ?? 0;
    return p1Losses >= 1 && p2Losses >= 1;
  });
  if (isLosersRound) {
    return 'losers';
  }

  return 'winners';
}

function BracketSection({
  rounds,
  matchesByRound,
  tournamentId,
  structureSlots,
  slotLabels,
  slotIndexByKey,
  legacyMode,
  entryLosses,
  labels,
  locale,
}: {
  rounds: Round[];
  matchesByRound: Record<string, PublicMatch[]>;
  tournamentId: string;
  structureSlots?: BracketSlotDef[];
  slotLabels?: Map<string, { label1: string; label2: string }>;
  slotIndexByKey?: Map<string, number>;
  legacyMode?: boolean;
  entryLosses?: Record<string, EntryLosses>;
  labels: BracketLabels;
  locale: Locale;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-8 min-w-fit">
        {rounds.map((round) => {
          const matches = matchesByRound[round.id] ?? [];
          const roundSlots =
            !legacyMode && structureSlots
              ? structureSlots.filter((s) => s.global_round_number === round.round_number)
              : [];

          return (
            <div key={round.id} className="flex flex-col gap-4 min-w-[220px]">
              <h4 className="text-xs font-heading font-medium text-poke-text-secondary text-center border-b border-poke-border pb-1">
                {translateEngineLabel('round', round.name, locale)}
              </h4>
              <div className="flex flex-col justify-around flex-1 gap-4">
                {roundSlots.length > 0
                  ? roundSlots.map((slotDef) => {
                      const match = matches.find((m) => m.bracket_pos === slotDef.bracket_pos);
                      if (match) {
                        return (
                          <BracketMatchCard
                            key={match.id}
                            match={match}
                            tournamentId={tournamentId}
                            statusLabels={labels.matchStatus}
                            entryLosses={entryLosses?.[match.id]}
                            lossLabels={labels}
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
                        entryLosses={entryLosses?.[match.id]}
                        lossLabels={labels}
                      />
                    ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Double Elimination bracket renderer.
 * Structure-generated brackets use `bracket_side` / slot skeletons; legacy
 * brackets render flat match cards grouped by inferred winners/losers/GF.
 * The stored English round names and feeder labels are shown in the viewer's
 * language (`translateEngineLabel`; already-translated names pass through).
 */
export default function DoubleElimBracket({
  rounds,
  matchesByRound,
  tournamentId,
  structureSlots,
  slotLabels,
  slotIndexByKey,
  legacyMode = false,
  lossCount = {},
  entryLosses,
  labels: labelsOverride,
}: DoubleElimBracketProps) {
  const locale = useLocale();
  const labels = labelsOverride ?? bracketLabelsFor(locale);
  const sortedRounds = [...rounds].sort((a, b) => a.round_number - b.round_number);

  if (sortedRounds.length === 0) {
    return <p className="text-poke-text-muted text-sm">{labels.noRounds}</p>;
  }

  let winnersRounds: Round[];
  let losersRounds: Round[];
  let gfRounds: Round[];

  if (legacyMode) {
    winnersRounds = [];
    losersRounds = [];
    gfRounds = [];

    for (const round of sortedRounds) {
      const matches = matchesByRound[round.id] ?? [];
      const section = classifyLegacyRound(matches, lossCount);
      switch (section) {
        case 'winners':
          winnersRounds.push(round);
          break;
        case 'losers':
          losersRounds.push(round);
          break;
        case 'grand_finals':
          gfRounds.push(round);
          break;
        default: {
          const _exhaustive: never = section;
          return _exhaustive;
        }
      }
    }
  } else {
    winnersRounds = sortedRounds.filter((r) => r.bracket_side === 'winners');
    losersRounds = sortedRounds.filter((r) => r.bracket_side === 'losers');
    gfRounds = sortedRounds.filter((r) => r.bracket_side === 'grand_finals');
  }

  return (
    <div className="space-y-6">
      {winnersRounds.length > 0 && (
        <div>
          <h3 className="text-sm font-heading font-semibold text-poke-text-primary mb-2">
            {labels.winnersBracket}
          </h3>
          <BracketSection
            rounds={winnersRounds}
            matchesByRound={matchesByRound}
            tournamentId={tournamentId}
            structureSlots={structureSlots?.filter((s) => s.bracket_side === 'winners')}
            slotLabels={slotLabels}
            slotIndexByKey={slotIndexByKey}
            legacyMode={legacyMode}
            entryLosses={entryLosses}
            labels={labels}
            locale={locale}
          />
        </div>
      )}

      {losersRounds.length > 0 && (
        <div>
          <h3 className="text-sm font-heading font-semibold text-poke-text-primary mb-2">
            {labels.losersBracket}
          </h3>
          <BracketSection
            rounds={losersRounds}
            matchesByRound={matchesByRound}
            tournamentId={tournamentId}
            structureSlots={structureSlots?.filter((s) => s.bracket_side === 'losers')}
            slotLabels={slotLabels}
            slotIndexByKey={slotIndexByKey}
            legacyMode={legacyMode}
            entryLosses={entryLosses}
            labels={labels}
            locale={locale}
          />
        </div>
      )}

      {gfRounds.length > 0 && (
        <div>
          <h3 className="text-sm font-heading font-semibold text-poke-text-primary mb-2">
            {labels.grandFinals}
          </h3>
          <BracketSection
            rounds={gfRounds}
            matchesByRound={matchesByRound}
            tournamentId={tournamentId}
            structureSlots={structureSlots?.filter((s) => s.bracket_side === 'grand_finals')}
            slotLabels={slotLabels}
            slotIndexByKey={slotIndexByKey}
            legacyMode={legacyMode}
            entryLosses={entryLosses}
            labels={labels}
            locale={locale}
          />
        </div>
      )}
    </div>
  );
}
