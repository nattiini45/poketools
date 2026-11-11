'use client';

import { Lock } from 'lucide-react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { SIGNATURE_THRESHOLDS, type SignaturePokemon } from '@/types/signature';
import { useDataLocale, useT } from '@/i18n/client';
import { gamificationMessages } from '@/i18n/messages/gamification';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { cn } from '@/lib/utils/cn';

interface SignatureTeamProps {
  signatures: SignaturePokemon[];
  compact?: boolean;
}

/** The six signature slots as character-select plates: an unlocked slot holds its sprite, a locked one names its threshold. */
export default function SignatureTeam({ signatures, compact = false }: SignatureTeamProps) {
  const t = useT(gamificationMessages);
  const dl = useDataLocale();
  const ordered = [...signatures].sort((a, b) => a.slot_number - b.slot_number);

  return (
    <ul className={cn('grid grid-cols-3 px-2.5', compact ? 'gap-x-3 gap-y-2' : 'gap-x-4 gap-y-3')}>
      {Array.from({ length: 6 }).map((_, index) => {
        const slot = index + 1;
        const signature = ordered.find((item) => item.slot_number === slot);
        const threshold = SIGNATURE_THRESHOLDS[index];

        if (!signature) {
          return (
            <li key={slot} className={cn('skew-plate content-center gap-1 px-2 text-center', compact ? 'min-h-20 py-2' : 'min-h-28 py-3')}>
              <span aria-hidden="true" className="skew-plate-bg border border-dashed border-hairline-strong" />
              <Lock aria-hidden="true" className="h-4 w-4 text-fg-muted" />
              <span className="sr-only">{t('signatures.locked')}: </span>
              <span className="text-micro text-fg-muted">{t('signatures.unlockAt', { count: threshold })}</span>
            </li>
          );
        }

        return (
          <li key={slot} className={cn('group skew-plate content-center px-2 text-center', compact ? 'min-h-20 py-2' : 'min-h-28 py-3')}>
            <span
              aria-hidden="true"
              className="skew-plate-bg border border-hairline-strong bg-surface transition-colors duration-80 ease-out group-hover:border-accent-ink"
            />
            <span className="flex justify-center transition-transform duration-160 ease-out group-hover:-translate-y-0.5 motion-reduce:transform-none">
              <PokemonSprite name={signature.pokemon_name} size={compact ? 36 : 48} />
            </span>
            <span className="mt-1 block max-w-full truncate text-caption font-[550] text-fg">{localizeSpecies(signature.pokemon_name, dl)}</span>
            <span className="block text-micro text-fg-muted">{t('signatures.games', { count: signature.games_played })}</span>
          </li>
        );
      })}
    </ul>
  );
}
