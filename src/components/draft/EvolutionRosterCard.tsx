'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import ProgressSourceChips from '@/components/evolution/ProgressSourceChips';
import { useDataLocale, useT } from '@/i18n/client';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { breakdown } from '@/lib/draft-ui/progress-display';
import { progressChipLabels, type ProgressChipLabels } from '@/lib/draft-ui/progress-labels';
import type { EvolutionTrackerWithTier } from '@/types/evolution';

interface EvolutionRosterCardProps {
  playerName: string;
  trackers: EvolutionTrackerWithTier[];
  /** Non-evo Pokémon drafted normally (if league mixes evo + non-evo) */
  regularPokemon: string[];
  budget: number | null;
  isCurrentPicker: boolean;
  picksRemaining?: number;
}

export default function EvolutionRosterCard({
  playerName,
  trackers,
  regularPokemon,
  budget,
  isCurrentPicker,
  picksRemaining,
}: EvolutionRosterCardProps) {
  const tLegacy = useT(draftLegacyMessages);
  const chipLabels = progressChipLabels(useT(draftSharedMessages));
  const dataLocale = useDataLocale();
  return (
    <Card
      variant="outlined"
      padding="sm"
      className={isCurrentPicker ? 'border-poke-border-focus ring-1 ring-poke-border-focus/30' : ''}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-heading font-medium text-sm text-poke-text-primary">{playerName}</span>
        <div className="text-xs text-poke-text-muted text-right">
          {budget !== null && <div>{tLegacy('ptsRemaining', { n: budget })}</div>}
          {picksRemaining !== undefined && <div>{tLegacy('picksLeft', { count: picksRemaining })}</div>}
        </div>
      </div>

      {trackers.length === 0 && regularPokemon.length === 0 ? (
        <p className="text-xs text-poke-text-muted">{tLegacy('noPicksYet')}</p>
      ) : (
        <div className="space-y-1.5">
          {/* Evolution-tracked Pokémon */}
          {trackers.map((tracker) => (
            <EvolutionPokemonRow key={tracker.id} tracker={tracker} chipLabels={chipLabels} />
          ))}

          {/* Regular (non-evo) picks */}
          {regularPokemon.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {regularPokemon.map((name) => (
                <PokemonLink
                  key={name}
                  name={name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-poke-muted rounded-poke-sm text-xs text-poke-text-secondary"
                >
                  <PokemonSprite name={name} size={20} />
                  <span>{localizeSpecies(name, dataLocale)}</span>
                </PokemonLink>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function EvolutionPokemonRow({
  tracker,
  chipLabels,
}: {
  tracker: EvolutionTrackerWithTier;
  chipLabels: ProgressChipLabels;
}) {
  const t = useT(draftLegacyBoardMessages);
  const dataLocale = useDataLocale();
  const { tier } = tracker;
  // Total progress (all sources) drives evolution; only `real_kills` is labelled KOs (§8.3).
  const sources = breakdown(tracker);
  const totalProgress = sources.totalProgress;
  const isBase = tracker.current_stage === 1;
  const isStage2 = tracker.current_stage === 2;
  const isFinalForm = tracker.current_stage === (tier.stage3_pokemon ? 3 : 2);

  // Calculate progress toward next evolution
  let nextThreshold: number | null = null;
  let nextForm: string | null = null;

  if (isBase) {
    nextThreshold = tier.stage2_kos;
    nextForm = tier.stage2_pokemon;
  } else if (isStage2 && tier.stage3_pokemon && tier.stage3_kos) {
    nextThreshold = tier.stage3_kos;
    nextForm = tier.stage3_pokemon;
  }

  const progressPercent = nextThreshold
    ? Math.min(100, Math.round((totalProgress / nextThreshold) * 100))
    : 100;

  // Determine if this is a wildcard (bonus)
  const isWildcard = tier.player_id !== null;

  return (
    <div
      className={`p-2 rounded-poke-lg text-xs ${
        isFinalForm ? 'bg-poke-green-light border border-poke-green/20' : 'bg-poke-elevated'
      }`}
    >
      <div className="flex items-center gap-2">
        <PokemonSprite name={tracker.current_form} size={32} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <PokemonLink name={tracker.current_form} className="inline-flex">
              <span className="font-medium text-sm text-poke-text-primary">
                {localizeSpecies(tracker.current_form, dataLocale)}
              </span>
            </PokemonLink>
            {isWildcard && (
              <Badge variant="purple" size="sm" className="uppercase">{t('rosterCard.wild')}</Badge>
            )}
            {isFinalForm && (
              <Badge variant="green" size="sm" className="uppercase">{t('rosterCard.max')}</Badge>
            )}
          </div>

          {/* Show base form if evolved */}
          {!isBase && (
            <div className="text-[10px] text-poke-text-muted flex items-center gap-1">
              <PokemonSprite name={tracker.base_pokemon} size={12} />
              <span>{t('rosterCard.wasBase', { name: localizeSpecies(tracker.base_pokemon, dataLocale) })}</span>
            </div>
          )}
        </div>

        {/* Self-earned KOs plus one chip per other progress source */}
        <div className="flex flex-col items-end text-right">
          <ProgressSourceChips sources={sources} compact labels={chipLabels} className="justify-end" />
          {nextThreshold && nextForm && (
            <div className="text-[10px] text-poke-text-muted">
              {t('rosterCard.progressTo', {
                count: Math.max(0, nextThreshold - totalProgress),
                form: localizeSpecies(nextForm, dataLocale),
              })}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {nextThreshold && !isFinalForm && (
        <div className="mt-1.5">
          <div className="w-full bg-poke-muted rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${
                progressPercent >= 80
                  ? 'bg-poke-yellow'
                  : progressPercent >= 50
                  ? 'bg-poke-blue'
                  : 'bg-poke-text-muted'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Full evolution chain preview */}
      {!isFinalForm && (
        <div className="flex items-center gap-1 mt-1 text-[10px] text-poke-text-muted">
          <span className={isBase ? 'text-poke-text-primary font-medium' : ''}>
            {localizeSpecies(tier.base_pokemon, dataLocale)}
          </span>
          <span>&rarr;</span>
          <span className={isStage2 ? 'text-poke-text-primary font-medium' : ''}>
            {localizeSpecies(tier.stage2_pokemon, dataLocale)} ({tier.stage2_kos})
          </span>
          {tier.stage3_pokemon && (
            <>
              <span>&rarr;</span>
              <span className={tracker.current_stage === 3 ? 'text-poke-text-primary font-medium' : ''}>
                {localizeSpecies(tier.stage3_pokemon, dataLocale)} ({tier.stage3_kos})
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
