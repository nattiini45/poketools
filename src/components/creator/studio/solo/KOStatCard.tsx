'use client';

import SpriteImg from '@/components/shared/SpriteImg';
import { useDataLocale, useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface KOStatCardProps {
  species: string;
  kosDealt: number;
  wasKoed: boolean;
  isActive: boolean;
  onIncrementKO: () => void;
  onDecrementKO: () => void;
  onToggleKoed: () => void;
}

/**
 * KOStatCard — single Pokémon KO/death tracker for solo streamers.
 * Reads from persisted TrackerSlot data via the parent KOTracker.
 */
export default function KOStatCard({
  species,
  kosDealt,
  wasKoed,
  isActive,
  onIncrementKO,
  onDecrementKO,
  onToggleKoed,
}: KOStatCardProps) {
  const t = useT(creatorStudioMessages);
  const dataLocale = useDataLocale();
  const speciesLabel = localizeSpecies(species, dataLocale);

  return (
    <div className={`
      rounded-poke-lg border p-3 transition-colors
      ${isActive ? 'border-accent-ink' : 'border-hairline bg-surface'}
    `}>
      <div className="flex items-center gap-3">
        <SpriteImg
          name={species}
          alt={speciesLabel}
          className={`w-12 h-12 ${wasKoed ? 'grayscale opacity-60' : ''}`}
        />
        <div className="flex-1">
          <span className="font-heading font-bold text-sm text-fg block">
            {speciesLabel}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-0.5">
              <button
                onClick={onDecrementKO}
                disabled={kosDealt === 0}
                className="text-xs font-mono bg-win-bg text-win rounded-l px-1.5 py-0.5 hover:bg-win-bg transition-colors disabled:opacity-30"
              >
                &minus;
              </button>
              <button
                onClick={onIncrementKO}
                className="text-xs font-mono bg-win-bg text-win rounded-r px-2 py-0.5 hover:bg-win-bg transition-colors"
              >
                {t('solo.kos', { count: kosDealt })}
              </button>
            </div>
            <button
              onClick={onToggleKoed}
              className={`text-xs font-mono rounded px-2 py-0.5 transition-colors ${
                wasKoed
                  ? 'bg-loss-bg text-loss hover:bg-loss-bg'
                  : 'bg-sunken text-fg-muted hover:bg-loss-bg hover:text-loss'
              }`}
            >
              {wasKoed ? t('solo.koed') : t('solo.alive')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
