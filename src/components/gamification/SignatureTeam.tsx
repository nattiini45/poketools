'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { SIGNATURE_THRESHOLDS, type SignaturePokemon } from '@/types/signature';
import { useDataLocale, useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface SignatureTeamProps {
  signatures: SignaturePokemon[];
  compact?: boolean;
}

export default function SignatureTeam({ signatures, compact = false }: SignatureTeamProps) {
  const t = useT(gamificationMessages);
  const dl = useDataLocale();
  const ordered = [...signatures].sort((a, b) => a.slot_number - b.slot_number);

  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, index) => {
          const slot = index + 1;
          const signature = ordered.find((item) => item.slot_number === slot);
          const threshold = SIGNATURE_THRESHOLDS[index];

          if (!signature) {
            return (
              <div
                key={slot}
                className={`rounded-poke-lg border border-dashed border-poke-border bg-poke-elevated/40 text-center ${
                  compact ? 'p-2' : 'p-3'
                }`}
              >
                <div className="text-xl text-poke-text-tertiary">?</div>
                <div className="text-[11px] text-poke-text-tertiary mt-1">
                  {t('signatures.unlockAt', { count: threshold })}
                </div>
              </div>
            );
          }

          return (
            <div
              key={slot}
              className={`group rounded-poke-lg border border-poke-border bg-poke-elevated text-center transition-colors hover:border-poke-accent ${
                compact ? 'p-2' : 'p-3'
              }`}
            >
              <div className="flex justify-center transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-110 motion-reduce:transform-none">
                <PokemonSprite name={signature.pokemon_name} size={compact ? 36 : 44} />
              </div>
              <div className="text-xs font-heading font-semibold text-poke-text-primary mt-1 truncate">
                {localizeSpecies(signature.pokemon_name, dl)}
              </div>
              <div className="text-[11px] text-poke-text-tertiary">
                {t('signatures.games', { count: signature.games_played })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
