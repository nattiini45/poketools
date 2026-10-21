'use client';

import SpriteImg from '@/components/shared/SpriteImg';
import { SITE_DEFAULT_SPRITE_STYLE } from '@/lib/pkmn/sprite-styles';
import { useSoloBroadcastPoll } from '@/lib/broadcast/use-solo-broadcast';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface SoloKOStatsProps {
  sessionId: string;
  pollInterval?: number;
}

/**
 * SoloKOStats — OBS overlay showing per-Pokémon KO stats for a solo streamer.
 * Polls the cast session for tracker state updates.
 */
export default function SoloKOStats({ sessionId, pollInterval = 5000 }: SoloKOStatsProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  const state = useSoloBroadcastPoll(sessionId, pollInterval);

  if (!state) {
    return null; // Transparent — nothing to show yet
  }

  const player1 = state.current_game.player1;
  const slots = player1.slots.filter((s) => s.pokemon_name);

  return (
    <div className="flex flex-col gap-2 p-4">
      {slots.map((slot) => (
        <div
          key={slot.pokemon_name}
          className={`
            flex items-center gap-3 rounded-lg px-3 py-2
            ${slot.was_koed ? 'bg-red-900/40' : 'bg-black/60'}
            backdrop-blur-sm
          `}
        >
          <SpriteImg
            name={slot.pokemon_name!}
            spriteStyle={SITE_DEFAULT_SPRITE_STYLE}
            variant="full"
            alt={localizeSpecies(slot.pokemon_name!, dl)}
            className={`w-10 h-10 ${slot.was_koed ? 'grayscale opacity-50' : ''}`}
          />
          <div className="flex-1">
            <span className="font-bold text-white text-sm">
              {localizeSpecies(slot.pokemon_name!, dl)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {slot.kos_dealt > 0 && (
              <span className="bg-green-500/30 text-green-300 text-xs font-mono rounded px-1.5 py-0.5">
                {t('common.kos', { count: slot.kos_dealt })}
              </span>
            )}
            {slot.was_koed && (
              <span className="bg-red-500/30 text-red-300 text-xs font-mono rounded px-1.5 py-0.5">
                {t('statCard.koed')}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
