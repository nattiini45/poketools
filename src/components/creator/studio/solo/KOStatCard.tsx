'use client';

import { getSpriteUrl } from '@/lib/pkmn/sprites';
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
      ${isActive ? 'border-poke-accent bg-poke-accent/5' : 'border-poke-border bg-poke-surface'}
    `}>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getSpriteUrl(species)}
          alt={speciesLabel}
          className={`w-12 h-12 ${wasKoed ? 'grayscale opacity-60' : ''}`}
        />
        <div className="flex-1">
          <span className="font-heading font-bold text-sm text-poke-text-primary block">
            {speciesLabel}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-0.5">
              <button
                onClick={onDecrementKO}
                disabled={kosDealt === 0}
                className="text-xs font-mono bg-green-500/10 text-green-400 rounded-l px-1.5 py-0.5 hover:bg-green-500/20 transition-colors disabled:opacity-30"
              >
                &minus;
              </button>
              <button
                onClick={onIncrementKO}
                className="text-xs font-mono bg-green-500/20 text-green-400 rounded-r px-2 py-0.5 hover:bg-green-500/30 transition-colors"
              >
                {t('solo.kos', { count: kosDealt })}
              </button>
            </div>
            <button
              onClick={onToggleKoed}
              className={`text-xs font-mono rounded px-2 py-0.5 transition-colors ${
                wasKoed
                  ? 'bg-red-500/30 text-red-300 hover:bg-red-500/20'
                  : 'bg-poke-muted text-poke-text-secondary hover:bg-red-500/20 hover:text-red-400'
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
