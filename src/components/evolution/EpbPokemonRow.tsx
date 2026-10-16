'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import Badge from '@/components/ui/Badge';
import { useDataLocale, useT } from '@/i18n/client';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { MatchEvolutionSnapshot } from '@/types/evolution';

interface EpbPokemonRowProps {
  snapshot: MatchEvolutionSnapshot;
  /** KO threshold for the next stage (null if fully evolved) */
  nextStageRequirement: number | null;
  /** Next form name (null if fully evolved) */
  nextForm: string | null;
  /** Price of this evolution line from the point-buy list */
  price: number | null;
}

/**
 * Evolution Point Buy Pokémon row for the match detail page.
 * Replaces the generic PokemonStatRow with evolution-specific data:
 * progress, KOs, stage, and source breakdown. No tier labels.
 * A client leaf (cheap) so it can translate with hooks; it receives plain snapshot data.
 */
export default function EpbPokemonRow({
  snapshot,
  nextStageRequirement,
  nextForm,
  price,
}: EpbPokemonRowProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const tLegacy = useT(draftLegacyMessages);
  const tShared = useT(draftSharedMessages);
  const dataLocale = useDataLocale();
  const speciesLabel = localizeSpecies(snapshot.species_at_match, dataLocale);
  const isFullyEvolved = nextStageRequirement === null;
  const progressPercent = nextStageRequirement && nextStageRequirement > 0
    ? Math.min(100, (snapshot.progress_after / nextStageRequirement) * 100)
    : 100;

  return (
    <div className="flex items-start gap-2.5 py-2">
      <PokemonLink name={snapshot.species_at_match} className="shrink-0">
        <PokemonSprite
          name={snapshot.species_at_match}
          size={44}
          aura={snapshot.evolution_triggered ? 'gold' : snapshot.real_kos > 0 ? 'green' : 'none'}
        />
      </PokemonLink>

      <div className="min-w-0 flex-1">
        {/* Name + stage + price */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <PokemonLink name={snapshot.species_at_match}>
            <span className="text-xs font-heading font-semibold text-poke-text-primary hover:underline">
              {speciesLabel}
            </span>
          </PokemonLink>
          <span className="rounded bg-poke-surface px-1.5 py-0.5 text-[10px] font-medium text-poke-text-secondary">
            {tLegacy('stageShort', { n: snapshot.stage_at_match })}
          </span>
          {price !== null && (
            <span className="text-[10px] text-poke-text-muted">{tLegacy('pts', { n: price })}</span>
          )}
          {snapshot.evolution_triggered && (
            <Badge variant="yellow" size="xs">
              <span aria-hidden="true">★ </span>
              {t('row.evolved')}
            </Badge>
          )}
        </div>

        {/* KOs this match */}
        {snapshot.real_kos > 0 && (
          <div className="mt-0.5">
            <Badge variant="green" size="xs">
              {tShared('progress.kos', { count: snapshot.real_kos })}
            </Badge>
          </div>
        )}

        {/* Progress bar */}
        {!isFullyEvolved && nextStageRequirement && (
          <div className="mt-1.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 overflow-hidden rounded-full bg-poke-surface">
                <div
                  className={`h-full rounded-full transition-all ${
                    snapshot.evolution_triggered
                      ? 'bg-poke-yellow'
                      : progressPercent >= 70
                        ? 'bg-poke-blue'
                        : 'bg-poke-text-muted'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-poke-text-secondary whitespace-nowrap">
                {snapshot.progress_before}/{nextStageRequirement} → {snapshot.progress_after}/{nextStageRequirement}
              </span>
            </div>
            {nextForm && (
              <p className="mt-0.5 text-[10px] text-poke-text-muted">
                {snapshot.evolution_triggered
                  ? t('row.evolvedInto', { form: localizeSpecies(nextForm, dataLocale) })
                  : nextStageRequirement - snapshot.progress_after > 0
                    ? t('row.nextMore', {
                        form: localizeSpecies(nextForm, dataLocale),
                        count: nextStageRequirement - snapshot.progress_after,
                      })
                    : t('row.next', { form: localizeSpecies(nextForm, dataLocale) })}
              </p>
            )}
          </div>
        )}

        {isFullyEvolved && (
          <p className="mt-0.5 text-[10px] text-poke-green">{t('row.fullyEvolved')}</p>
        )}

        {/* Per-match progress source breakdown (compact), with the spec's token names */}
        {(snapshot.draft_tokens_delta > 0 || snapshot.kill_tokens_delta > 0 || snapshot.cosmo_points_delta > 0) && (
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-poke-text-secondary">
            {snapshot.draft_tokens_delta > 0 && (
              <span className="flex items-center gap-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                {tShared('progress.draftKillChip', { count: snapshot.draft_tokens_delta })}
              </span>
            )}
            {snapshot.kill_tokens_delta > 0 && (
              <span className="flex items-center gap-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                {tShared('progress.comebackChip', { n: snapshot.kill_tokens_delta })}
              </span>
            )}
            {snapshot.cosmo_points_delta > 0 && (
              <span className="flex items-center gap-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-500" />
                {tShared('progress.cosmoChip', { n: snapshot.cosmo_points_delta })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
