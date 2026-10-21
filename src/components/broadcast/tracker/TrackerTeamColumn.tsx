'use client';

import PlayerAvatar from '@/components/shared/PlayerAvatar';
import TrackerPokemonSlot from './TrackerPokemonSlot';
import BringLeadStats from './BringLeadStats';
import type { TrackerPlayerState } from '@/types/broadcast';
import type { TrackerDispatchAction } from '@/lib/broadcast/tracker-reducer';
import { useT } from '@/i18n/client';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { usePlayerDisplayName } from './usePlayerDisplayName';

interface TrackerTeamColumnProps {
  playerState: TrackerPlayerState;
  player: 1 | 2;
  dispatch: (action: TrackerDispatchAction) => void;
  showMoves?: boolean;
}

export default function TrackerTeamColumn({
  playerState,
  player,
  dispatch,
  showMoves = false,
}: TrackerTeamColumnProps) {
  const t = useT(broadcastCasterMessages);
  const displayName = usePlayerDisplayName();
  const playerName = displayName(playerState.player_name);
  const broughtCount = playerState.slots.filter((s) => s.was_brought).length;
  const koedCount = playerState.slots.filter((s) => s.was_koed).length;
  const totalKoDealt = playerState.slots.reduce((sum, s) => sum + s.kos_dealt, 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Player header */}
      <div className="flex items-center gap-3 px-2">
        <PlayerAvatar
          name={playerName}
          avatarUrl={playerState.avatar_url}
          size={36}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-poke-text truncate">
            {playerName}
          </div>
          <div className="flex items-center gap-2 text-xs text-poke-text-secondary">
            <span>{t('tracker.broughtOfSix', { count: broughtCount })}</span>
            <span className="text-orange-400">{t('tracker.kosDealt', { count: totalKoDealt })}</span>
            <span className="text-red-400">{t('tracker.koedCount', { count: koedCount })}</span>
          </div>
        </div>
      </div>

      {/* Bring/Lead Predictions (F9) */}
      <BringLeadStats player={player} />

      {/* Pokémon grid */}
      <div className="flex flex-col gap-2">
        {playerState.slots.map((slot, i) => (
          <TrackerPokemonSlot
            key={`${player}-${i}`}
            slot={slot}
            slotIndex={i}
            player={player}
            dispatch={dispatch}
            showMoves={showMoves}
          />
        ))}
      </div>
    </div>
  );
}
