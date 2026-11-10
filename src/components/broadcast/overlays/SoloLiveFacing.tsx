'use client';

import SpriteImg from '@/components/shared/SpriteImg';
import { SITE_DEFAULT_SPRITE_STYLE } from '@/lib/pkmn/sprite-styles';
import { useSoloBroadcastPoll } from '@/lib/broadcast/use-solo-broadcast';
import type { PublicSoloBroadcastSlot } from '@/types/broadcast';
import { useDataLocale, useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { soloPlaceholderOf } from '@/lib/broadcast/solo-defaults';

interface SoloLiveFacingProps {
  sessionId: string;
  pollInterval?: number;
}

/**
 * SoloLiveFacing — 120px lower-third OBS overlay showing currently active
 * Pokémon on each side with KO status. Polls the cast session tracker state.
 */
export default function SoloLiveFacing({ sessionId, pollInterval = 3000 }: SoloLiveFacingProps) {
  const t = useT(broadcastOverlaysMessages);
  const dl = useDataLocale();
  const state = useSoloBroadcastPoll(sessionId, pollInterval);

  /** Stored English placeholders ('Me'/'Opponent') read in the viewer's language; real names pass through. */
  const displayName = (name: string | null | undefined, fallback: string): string => {
    if (!name) return fallback;
    const placeholder = soloPlaceholderOf(name);
    if (placeholder === 'me') return t('common.me');
    if (placeholder === 'opponent') return t('common.opponent');
    return name;
  };

  if (!state) return null;

  const { player1, player2 } = state.current_game;
  const p1Slots = player1.slots.filter((s) => s.pokemon_name);
  const p2Slots = player2.slots.filter((s) => s.pokemon_name);

  if (p1Slots.length === 0 && p2Slots.length === 0) return null;

  const renderSlot = (slot: PublicSoloBroadcastSlot) => (
    <div
      key={slot.pokemon_name}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1 ${
        slot.was_koed
          ? 'bg-[rgb(127_29_29/0.4)]'
          : slot.was_brought
            ? 'bg-[rgb(20_83_45/0.3)]'
            : 'bg-[rgb(255_255_255/0.05)]'
      }`}
    >
      <SpriteImg
        name={slot.pokemon_name!}
        spriteStyle={SITE_DEFAULT_SPRITE_STYLE}
        variant="full"
        alt={localizeSpecies(slot.pokemon_name!, dl)}
        className={`w-8 h-8 ${slot.was_koed ? 'grayscale opacity-40' : ''}`}
      />
      {slot.kos_dealt > 0 && (
        <span className="text-green-300 text-[10px] font-mono font-bold">
          {slot.kos_dealt}
        </span>
      )}
    </div>
  );

  const p1KOs = p1Slots.filter((s) => !s.was_koed).length;
  const p2KOs = p2Slots.filter((s) => !s.was_koed).length;

  return (
    <div className="flex items-center justify-between h-[120px] px-6 bg-linear-to-r/srgb from-[rgb(0_0_0/0.8)] via-[rgb(0_0_0/0.6)] to-[rgb(0_0_0/0.8)] backdrop-blur-xs">
      {/* Player 1 side */}
      <div className="flex items-center gap-4">
        <div className="text-center">
          <span className="text-white font-bold text-sm block">{displayName(player1.player_name, t('common.me'))}</span>
          <span className="text-green-400 font-mono text-xs">{t('common.alive', { count: p1KOs })}</span>
        </div>
        <div className="flex gap-1">
          {p1Slots.map(renderSlot)}
        </div>
      </div>

      {/* Score */}
      <div className="text-[rgb(255_255_255/0.4)] font-bold text-lg">{t('common.vs')}</div>

      {/* Player 2 side */}
      <div className="flex items-center gap-4">
        <div className="flex gap-1">
          {p2Slots.map(renderSlot)}
        </div>
        <div className="text-center">
          <span className="text-white font-bold text-sm block">{displayName(player2.player_name, t('common.opponent'))}</span>
          <span className="text-green-400 font-mono text-xs">{t('common.alive', { count: p2KOs })}</span>
        </div>
      </div>
    </div>
  );
}
